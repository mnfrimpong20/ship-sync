import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { isDriverRole } from '../src/lib/roles'
import { notify, notifyShipperStaff } from './notify'
import { hrSettings, periodFor, EXPIRY_LABEL, selfHr } from './driverHr'

/* Driver self-service extras: pay breakdown and queries, advance requests, pay-day countdown, cancel time off,
 * paper review status, driver ID badge (public check), clock-in reminders, and demo data for Gold Coast. */
type Row = Record<string, any>
interface Deps { getDb: () => Promise<Db>; requireUser: (db: Db, req: Request) => Promise<ApiUser>; HttpError: new (status: number, message: string) => Error; wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void }
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : (v as T))
const r2 = (n: number) => Math.round(n * 100) / 100
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const wkday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()

/** Local date and HH:MM in a time zone (rota times are the company's local time). */
const localNow = (tz: string) => { try { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'; return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` } } catch { const d = new Date().toISOString(); return { day: d.slice(0, 10), hm: d.slice(11, 16) } } }
const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }

/** Rota says you start at 08:00 and you haven't clocked in by 08:15 → one nudge (and the office knows at 45 min). */
export async function sweepClockIn(db: Db) {
  const { rows } = await db.query<Row>(`select ro.*, s.name, s.user_id, s.base, s.role, s.shipper_id as sid from rota ro join staff s on s.id = ro.staff_id where ro.kind = 'work' and ro.start_time <> '' and ro.day between current_date - 1 and current_date + 1 and s.status = 'active'`)
  for (const r of rows) {
    const st = await hrSettings(db, r.sid); if (!st.clockInReminder) continue
    const now = localNow(r.base === 'destination' ? st.tzDestination : st.tzOrigin); if (DATE(r.day) !== now.day) continue
    const late = minutes(now.hm) - minutes(r.start_time); if (late < 15 || late > 240) continue
    const { rows: sh } = await db.query('select 1 from shifts where staff_id = $1 and (end_at is null or start_at > now() - interval \'8 hours\') limit 1', [r.staff_id]); if (sh[0]) continue
    const { rows: lv } = await db.query(`select 1 from leave_requests where staff_id = $1 and status = 'approved' and $2::date between start_date and end_date`, [r.staff_id, now.day]); if (lv[0]) continue
    if (r.user_id) await notify(db, { userId: r.user_id, kind: 'system', title: `Your shift started at ${r.start_time} — clock in`, body: isDriverRole(r.role) ? 'Open My runs and tap Clock in. If you’re off today, tell the office.' : 'Open My time and tap Clock in. If you’re off today, tell the office.', link: isDriverRole(r.role) ? '/dashboard/runs' : '/dashboard/me/time', dedupe: `clockin:${r.id}` })
    if (late >= 45) await notifyShipperStaff(db, r.sid, { kind: 'system', title: `${r.name} hasn’t clocked in (shift ${r.start_time})`, body: 'They were reminded at 15 minutes.', link: '/dashboard/hr?tab=rota', dedupe: `clockin:${r.id}:o` }, ['owner', 'dispatcher'])
  }
}

export function mountDriverHr2(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staffOf = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'For shipping company staff.')
    const { rows } = await db.query<Row>('select * from staff where user_id = $1 and shipper_id = $2', [u.id, u.shipperId])
    const me = rows[0] ?? { id: 'owner:' + u.id, name: u.name, role: u.staffRole ?? 'owner' }
    return { u, me, shipperId: u.shipperId, role: String(me.role), driver: isDriverRole(me.role) }
  }
  const driverOnly = async (db: Db, req: Request) => { const x = await staffOf(db, req); if (!x.driver) throw new HttpError(403, 'For drivers.'); return x }
  /** Drivers and office staff with their own staff record. */
  const selfOnly = async (db: Db, req: Request) => { const x = await staffOf(db, req); if (String(x.me.id).startsWith('owner:')) throw new HttpError(403, 'Your account has no staff record.'); return x }
  const office = async (db: Db, req: Request, roles = ['owner', 'dispatcher', 'finance']) => { const x = await staffOf(db, req); if (x.driver || !roles.includes(x.role)) throw new HttpError(403, `This needs the ${roles.join(' / ')} role.`); return x }

  /* ---- what's behind the money: stops, runs and shifts for a payslip or the current period ---- */
  const detail = async (db: Db, staffId: string, shipperId: string, where: { slip?: Row; start?: string; end?: string }) => {
    const st = await hrSettings(db, shipperId); const hol = new Set(st.holidays)
    let stops: Row[], shifts: Row[]
    if (where.slip) {
      const refs = J<{ stops?: string[]; shifts?: string[] }>(where.slip.refs, {})
      stops = refs.stops?.length ? (await db.query<Row>(`select st.label, st.address, st.done_at, st.contact, r.name as run_name, r.kind from run_stops st join runs r on r.id = st.run_id where st.id = any($1::text[]) order by st.done_at`, [refs.stops])).rows : []
      shifts = refs.shifts?.length ? (await db.query<Row>(`select * from shifts where id = any($1::text[]) order by start_at`, [refs.shifts])).rows : []
    } else {
      stops = (await db.query<Row>(`select st.label, st.address, st.done_at, st.contact, r.name as run_name, r.kind from run_stops st join runs r on r.id = st.run_id where r.driver_id = $1 and st.status = 'done' and st.paid_slip is null and st.done_at::date <= $2::date order by st.done_at`, [staffId, where.end])).rows
      shifts = (await db.query<Row>(`select * from shifts where staff_id = $1 and paid_slip is null and end_at is not null and start_at::date <= $2::date order by start_at`, [staffId, where.end])).rows
    }
    const hours = (x: Row) => { const br = J<{ start: string; end?: string }[]>(x.breaks, []); const brMs = br.reduce((n, b) => n + ((b.end ? new Date(b.end).getTime() : new Date(x.end_at).getTime()) - new Date(b.start).getTime()), 0); return r2(Math.max(0, (new Date(x.end_at).getTime() - new Date(x.start_at).getTime() - brMs) / 3600000)) }
    return {
      stops: stops.map((x) => { const dd = DATE(x.done_at)!; return { label: x.contact || x.label, address: x.address, doneAt: ISO(x.done_at), run: x.run_name, kind: x.kind, holiday: hol.has(dd), weekend: !hol.has(dd) && [0, 6].includes(wkday(dd)) } }),
      shifts: shifts.map((x) => ({ start: ISO(x.start_at), end: ISO(x.end_at), breaks: J<unknown[]>(x.breaks, []).length, hours: hours(x), edited: J<unknown[]>(x.edits, []).length > 0 })),
    }
  }
  r.get('/drivers/payslips/:id/detail', wrap(async (req, res) => {
    const db = await getDb(); const x = await staffOf(db, req)
    const { rows } = await db.query<Row>('select * from payslips where id = $1 and shipper_id = $2', [String(req.params.id), x.shipperId]); const sl = rows[0]
    if (!sl) throw new HttpError(404, 'Payslip not found.')
    const own = sl.staff_id === x.me.id
    const { rows: who } = await db.query<Row>('select role from staff where id = $1', [sl.staff_id])
    const officeView = !x.driver && ['owner', 'dispatcher', 'finance'].includes(x.role) && (x.role !== 'dispatcher' || isDriverRole(who[0]?.role))
    if (!own && !officeView) throw new HttpError(404, 'Payslip not found.')
    if (own && !officeView && sl.status === 'draft') throw new HttpError(404, 'Payslip not found.')
    res.set('Cache-Control', 'no-store'); res.json(await detail(db, sl.staff_id, x.shipperId, { slip: sl }))
  }))
  r.get('/drivers/me/pay/detail', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await selfOnly(db, req); const st = await hrSettings(db, shipperId); const cur = periodFor(st, today())
    res.set('Cache-Control', 'no-store'); res.json(await detail(db, me.id, shipperId, { end: cur.end }))
  }))
  /** Pay day, earned today, last 12 payslips and the year so far — for the driver's pay screen and home card. */
  r.get('/drivers/me/pay/summary', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await selfOnly(db, req); const st = await hrSettings(db, shipperId); const cur = periodFor(st, today())
    const { rows: s } = await db.query<Row>('select * from staff where id = $1', [me.id]); const pay = J<{ perStop?: number; perRun?: number; perHour?: number; currency?: string }>(s[0]?.pay, {})
    const { rows: td } = await db.query<Row>(`select count(*) filter (where st.status = 'done')::int as stops, count(distinct r.id) filter (where st.status = 'done')::int as runs from run_stops st join runs r on r.id = st.run_id where r.driver_id = $1 and st.done_at::date = current_date`, [me.id])
    const { rows: hr } = await db.query<Row>(`select coalesce(sum(extract(epoch from (coalesce(end_at, now()) - start_at)) / 3600), 0) as h from shifts where staff_id = $1 and start_at::date = current_date`, [me.id])
    const todayEarned = r2((pay.perStop ?? 0) * td[0].stops + (pay.perRun ?? 0) * td[0].runs + (pay.perHour ?? 0) * Number(hr[0].h))
    const { rows: hist } = await db.query<Row>(`select x.net, x.currency, x.status, p.start_date, p.end_date, x.paid_at from payslips x join pay_periods p on p.id = x.period_id where x.staff_id = $1 and x.status <> 'draft' order by p.start_date desc limit 12`, [me.id])
    const { rows: yr } = await db.query<Row>(`select x.currency, sum(x.gross) as gross, sum(x.reimbursed) as reimb, sum(x.net) as net from payslips x where x.staff_id = $1 and x.status = 'paid' and extract(year from x.paid_at) = extract(year from now()) group by x.currency`, [me.id])
    const payDay = addDays(cur.end, st.payDayOffset)
    res.set('Cache-Control', 'no-store')
    res.json({ period: cur, closesIn: Math.max(0, Math.round((new Date(cur.end + 'T23:59:59Z').getTime() - Date.now()) / 86400000)), payDay, currency: pay.currency ?? 'USD', today: { ...td[0], hours: r2(Number(hr[0].h)), earned: todayEarned },
      history: hist.reverse().map((h) => ({ start: DATE(h.start_date), end: DATE(h.end_date), net: Number(h.net), currency: h.currency, status: h.status })),
      year: yr.map((y) => ({ currency: y.currency, gross: r2(Number(y.gross)), reimbursed: r2(Number(y.reimb)), net: r2(Number(y.net)) })) })
  }))

  /* ---- "Something's wrong" on a payslip ---- */
  r.post('/drivers/payslips/:id/query', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await selfOnly(db, req)
    const b = z.object({ line: z.string().trim().max(200).default(''), note: z.string().trim().min(5, 'Say what looks wrong.').max(1000) }).parse(req.body)
    const pid = String(req.params.id)
    if (pid !== 'current') { const { rows } = await db.query('select 1 from payslips where id = $1 and staff_id = $2', [pid, me.id]); if (!rows[0]) throw new HttpError(404, 'Payslip not found.') }
    const id = 'pq_' + uid()
    await db.query('insert into payslip_queries (id,payslip_id,shipper_id,staff_id,line,note) values ($1,$2,$3,$4,$5,$6)', [id, pid === 'current' ? null : pid, shipperId, me.id, b.line, b.note])
    await notifyShipperStaff(db, shipperId, { kind: 'payment', title: `${me.name} has a question about their pay`, body: `${b.line ? `${b.line}: ` : ''}${b.note.slice(0, 140)}`, link: '/dashboard/hr?tab=payroll', dedupe: `pq:${id}` }, ['owner', 'finance'])
    res.status(201).json({ ok: true })
  }))
  const qOut = (q: Row) => ({ id: q.id, payslipId: q.payslip_id, staffId: q.staff_id, name: q.name ?? undefined, line: q.line, note: q.note, status: q.status, answer: q.answer, answeredBy: q.answered_by, answeredAt: ISO(q.answered_at), at: ISO(q.at) })
  r.get('/drivers/me/queries', wrap(async (req, res) => { const db = await getDb(); const { me } = await selfOnly(db, req); const { rows } = await db.query<Row>('select * from payslip_queries where staff_id = $1 order by at desc limit 20', [me.id]); res.json({ queries: rows.map(qOut) }) }))
  r.get('/drivers/queries', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await office(db, req); const { rows } = await db.query<Row>(`select q.*, s.name from payslip_queries q join staff s on s.id = q.staff_id where q.shipper_id = $1 and (q.status = 'open' or q.at > now() - interval '30 days') order by q.status = 'open' desc, q.at desc`, [shipperId]); res.set('Cache-Control', 'no-store'); res.json({ queries: rows.map(qOut) }) }))
  r.post('/drivers/queries/:id/answer', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance', 'dispatcher'])
    const { answer } = z.object({ answer: z.string().trim().min(2).max(1000) }).parse(req.body)
    const { rows } = await db.query<Row>(`update payslip_queries set status = 'answered', answer = $3, answered_by = $4, answered_at = now() where id = $1 and shipper_id = $2 returning *`, [String(req.params.id), shipperId, answer, me.name]); const q = rows[0]; if (!q) throw new HttpError(404, 'Not found.')
    const { rows: u } = await db.query<Row>('select user_id, role from staff where id = $1', [q.staff_id])
    if (u[0]?.user_id) await notify(db, { userId: u[0].user_id, kind: 'payment', title: 'The office answered your pay question', body: answer.slice(0, 160), link: selfHr(u[0]?.role, 'pay'), dedupe: `pq:${q.id}:a` })
    res.json({ ok: true })
  }))

  /* ---- ask for an advance ---- */
  r.post('/drivers/me/advance', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await selfOnly(db, req)
    const b = z.object({ amount: z.number().positive().max(100000), currency: z.enum(['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR']), reason: z.string().trim().min(3, 'Say what it’s for.').max(300), installments: z.number().int().min(1).max(12) }).parse(req.body)
    const { rows: open } = await db.query(`select 1 from advance_requests where staff_id = $1 and status = 'pending'`, [me.id]); if (open[0]) throw new HttpError(409, 'You already have a request waiting.')
    const id = 'ar_' + uid()
    await db.query('insert into advance_requests (id,shipper_id,staff_id,amount,currency,reason,installments) values ($1,$2,$3,$4,$5,$6,$7)', [id, shipperId, me.id, b.amount, b.currency, b.reason, b.installments])
    await notifyShipperStaff(db, shipperId, { kind: 'payment', title: `${me.name} asks for an advance of ${b.currency} ${b.amount}`, body: `${b.reason} · repay over ${b.installments} payslip${b.installments === 1 ? '' : 's'}`, link: '/dashboard/hr?tab=payroll', dedupe: `ar:${id}` }, ['owner', 'finance'])
    res.status(201).json({ ok: true })
  }))
  const arOut = (a: Row) => ({ id: a.id, staffId: a.staff_id, name: a.name ?? undefined, amount: Number(a.amount), currency: a.currency, reason: a.reason, installments: Number(a.installments), status: a.status, decidedBy: a.decided_by, note: a.decision_note, at: ISO(a.at) })
  r.get('/drivers/me/advances', wrap(async (req, res) => { const db = await getDb(); const { me } = await selfOnly(db, req); const { rows } = await db.query<Row>('select * from advance_requests where staff_id = $1 order by at desc limit 10', [me.id]); res.json({ requests: rows.map(arOut) }) }))
  r.get('/drivers/advance-requests', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await office(db, req); const { rows } = await db.query<Row>(`select a.*, s.name from advance_requests a join staff s on s.id = a.staff_id where a.shipper_id = $1 and (a.status = 'pending' or a.at > now() - interval '30 days') order by a.status = 'pending' desc, a.at desc`, [shipperId]); res.set('Cache-Control', 'no-store'); res.json({ requests: rows.map(arOut) }) }))
  r.post('/drivers/advance-requests/:id/decide', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance'])
    const b = z.object({ status: z.enum(['approved', 'declined']), note: z.string().trim().max(300).default(''), amount: z.number().positive().max(100000).optional(), installments: z.number().int().min(1).max(12).optional() }).parse(req.body)
    const { rows } = await db.query<Row>(`select a.*, s.user_id, s.role from advance_requests a join staff s on s.id = a.staff_id where a.id = $1 and a.shipper_id = $2`, [String(req.params.id), shipperId]); const a = rows[0]
    if (!a) throw new HttpError(404, 'Not found.'); if (a.status !== 'pending') throw new HttpError(409, 'Already decided.')
    const amount = b.amount ?? Number(a.amount); const inst = b.installments ?? Number(a.installments)
    await db.query('update advance_requests set status = $2, decided_by = $3, decision_note = $4, amount = $5, installments = $6 where id = $1', [a.id, b.status, me.name, b.note, amount, inst])
    if (b.status === 'approved') await db.query('insert into pay_adjustments (id,shipper_id,staff_id,kind,amount,currency,note,installments,remaining,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$5,$9)', ['pa_' + uid(), shipperId, a.staff_id, 'advance', amount, a.currency, a.reason, inst, me.name])
    if (a.user_id) await notify(db, { userId: a.user_id, kind: 'payment', title: b.status === 'approved' ? `Advance approved: ${a.currency} ${amount}` : 'Advance not approved', body: b.status === 'approved' ? `Repaid over ${inst} payslip${inst === 1 ? '' : 's'}.${b.note ? ` ${b.note}` : ''}` : b.note || 'Talk to the office.', link: selfHr(a.role, 'pay') })
    res.json({ ok: true })
  }))

  /* ---- cancel a request that's still waiting ---- */
  r.delete('/drivers/me/leave/:id', wrap(async (req, res) => {
    const db = await getDb(); const { me } = await selfOnly(db, req)
    const { rows } = await db.query<Row>(`delete from leave_requests where id = $1 and staff_id = $2 and status = 'pending' returning id`, [String(req.params.id), me.id])
    if (!rows[0]) throw new HttpError(409, 'Only requests that are still waiting can be cancelled.'); res.json({ ok: true })
  }))

  /* ---- office checks the papers a driver uploads ---- */
  r.post('/drivers/docs/:id/review', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'dispatcher', 'finance'])
    const b = z.object({ status: z.enum(['checked', 'rejected']), note: z.string().trim().max(300).default('') }).parse(req.body)
    if (b.status === 'rejected' && b.note.length < 3) throw new HttpError(400, 'Say what’s wrong so they can fix it.')
    const { rows } = await db.query<Row>(`update driver_docs set status = $3, review_note = $4, reviewed_by = $5 where id = $1 and shipper_id = $2 returning *`, [String(req.params.id), shipperId, b.status, b.note, me.name]); const doc = rows[0]; if (!doc) throw new HttpError(404, 'Not found.')
    const { rows: u } = await db.query<Row>('select user_id, role from staff where id = $1', [doc.staff_id])
    const label = doc.kind === 'id' ? 'ID' : (EXPIRY_LABEL[doc.kind] ?? doc.title ?? doc.kind)
    if (u[0]?.user_id) await notify(db, { userId: u[0].user_id, kind: 'system', title: b.status === 'checked' ? `${label} checked` : `${label}: please upload it again`, body: b.status === 'checked' ? `By ${me.name}.` : b.note, link: b.status === 'rejected' ? `${selfHr(u[0]?.role, 'me')}?renew=${doc.kind}` : selfHr(u[0]?.role, 'me'), dedupe: `doc:${doc.id}:${b.status}` })
    res.json({ ok: true })
  }))

  /* ---- driver ID badge ---- */
  r.post('/drivers/me/photo', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId } = await driverOnly(db, req)
    const { dataUrl } = z.object({ dataUrl: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,/) }).parse(req.body)
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)!; const id = 'dd_' + uid()
    await db.query(`insert into driver_docs (id,staff_id,shipper_id,kind,title,data,mime,uploaded_by,status) values ($1,$2,$3,'photo','Badge photo',$4,$5,$6,'checked')`, [id, me.id, shipperId, m[2], m[1], me.name])
    await db.query('update driver_profiles set photo_doc = $2 where staff_id = $1', [me.id, id])
    res.json({ ok: true })
  }))
  const badgeOf = async (db: Db, staffId: string) => {
    const { rows } = await db.query<Row>(`select p.*, s.name, s.role, s.status as staff_status, s.shipper_id, sh.name as company, d.data as photo, d.mime as photo_mime from driver_profiles p join staff s on s.id = p.staff_id join shippers sh on sh.id = s.shipper_id left join driver_docs d on d.id = p.photo_doc where p.staff_id = $1`, [staffId])
    const p = rows[0]; if (!p) return null
    const exp = J<Record<string, string>>(p.expiries, {}); const expired = Object.entries(exp).filter(([, v]) => v && v < today()).map(([k]) => EXPIRY_LABEL[k] ?? k)
    const active = p.staff_status === 'active' && p.status !== 'offboarded'
    return { name: p.name, role: p.role, company: p.company, photo: p.photo ? `data:${p.photo_mime};base64,${p.photo}` : null, licenceClass: J<Row>(p.licence, {}).class ?? '', licenceExpires: exp.licence ?? null, active, papersOk: expired.length === 0, expired, since: DATE(p.start_date) }
  }
  r.get('/drivers/me/badge', wrap(async (req, res) => {
    const db = await getDb(); const { me } = await driverOnly(db, req)
    const { rows } = await db.query<Row>('select badge_token from driver_profiles where staff_id = $1', [me.id]); if (!rows[0]) throw new HttpError(404, 'Open My file first.')
    let token = rows[0].badge_token; if (!token) { token = randomBytes(12).toString('base64url'); await db.query('update driver_profiles set badge_token = $2 where staff_id = $1', [me.id, token]) }
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    res.set('Cache-Control', 'no-store'); res.json({ badge: await badgeOf(db, me.id), verifyUrl: `${base}/verify/driver/${token}` })
  }))
  /** Public: what a warehouse gate or checkpoint sees when they scan the badge. Name, photo, company, valid or not — nothing else. */
  r.get('/verify-driver/:token', wrap(async (req, res) => {
    const db = await getDb(); const { rows } = await db.query<Row>('select staff_id from driver_profiles where badge_token = $1', [String(req.params.token)])
    if (!rows[0]) throw new HttpError(404, 'This badge isn’t valid.')
    const b = await badgeOf(db, rows[0].staff_id); if (!b) throw new HttpError(404, 'This badge isn’t valid.')
    res.set('Cache-Control', 'no-store'); res.json({ name: b.name, role: b.role, company: b.company, photo: b.photo, valid: b.active && b.papersOk, active: b.active, papersOk: b.papersOk, checkedAt: new Date().toISOString() })
  }))
}

/* ---------------- demo pay, time and papers for Gold Coast's two drivers (runs once) ---------------- */
export const PNG_CARD = (label: string, color: string) => { const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" rx="24" fill="${color}"/><rect x="32" y="110" width="150" height="190" rx="10" fill="#ffffff55"/><text x="210" y="80" font-family="Arial" font-size="34" font-weight="bold" fill="#fff">${label}</text><text x="210" y="150" font-family="Arial" font-size="22" fill="#fff">SAMPLE — DEMO ONLY</text><rect x="210" y="190" width="360" height="16" rx="8" fill="#ffffff66"/><rect x="210" y="225" width="300" height="16" rx="8" fill="#ffffff66"/><rect x="210" y="260" width="250" height="16" rx="8" fill="#ffffff66"/></svg>`; return { mime: 'image/svg+xml', data: Buffer.from(svg).toString('base64') } }
export async function seedDriverHrDemo(db: Db) {
  const { rows: s } = await db.query<Row>(`select id, name, pay, base from staff where id in ('st_demo_kwesi','st_demo_efua') and shipper_id = 'gold-coast-freight'`)
  if (s.length < 2) return
  const { rows: done } = await db.query<Row>(`select settings from driver_hr_settings where shipper_id = 'gold-coast-freight'`)
  if (J<Row>(done[0]?.settings, {}).demoSeeded) return
  const st = await hrSettings(db, 'gold-coast-freight')
  const t = today(); const cur = periodFor(st, t)
  const K = 'st_demo_kwesi', E = 'st_demo_efua'
  // Pay rates.
  await db.query(`update staff set pay = $2 where id = $1 and (pay is null or pay = '{}'::jsonb)`, [K, JSON.stringify({ perStop: 12, perRun: 25, perHour: 15, currency: 'USD' })])
  await db.query(`update staff set pay = $2 where id = $1 and (pay is null or pay = '{}'::jsonb)`, [E, JSON.stringify({ perStop: 45, perRun: 60, perHour: 0, currency: 'GHS' })])
  // Profiles.
  const prof = async (id: string, b: Row) => db.query(`insert into driver_profiles (staff_id, shipper_id, employment, country, start_date, licence, emergency, payout, expiries, status, contract_signed_at, contract_name, training, leave_days, badge_token) values ($1,'gold-coast-freight',$2,$3,$4,$5,$6,$7,$8,'active',now() - interval '60 days',$9,$10,$11,$12)
    on conflict (staff_id) do update set employment = excluded.employment, country = excluded.country, start_date = excluded.start_date, licence = excluded.licence, emergency = excluded.emergency, payout = excluded.payout, expiries = excluded.expiries, status = 'active', contract_signed_at = coalesce(driver_profiles.contract_signed_at, excluded.contract_signed_at), contract_name = coalesce(nullif(driver_profiles.contract_name, ''), excluded.contract_name), training = coalesce(driver_profiles.training, excluded.training), badge_token = coalesce(driver_profiles.badge_token, excluded.badge_token)`,
    [id, b.employment, b.country, b.start, JSON.stringify(b.licence), JSON.stringify(b.emergency), JSON.stringify(b.payout), JSON.stringify(b.expiries), b.contractName, JSON.stringify({ score: 100, tries: 1, passedAt: new Date(Date.now() - 59 * 86400000).toISOString() }), b.leaveDays, randomBytes(12).toString('base64url')])
  await prof(K, { employment: 'contractor', country: 'US', start: addDays(t, -420), licence: { class: 'CDL-B', last4: '4471', state: 'Texas' }, emergency: { name: 'Akua Appiah', phone: '+1 713 555 0190', relation: 'Wife' }, payout: { method: 'zelle', zelle: 'kwesi.appiah@example.com' }, expiries: { licence: addDays(t, 21), medical: addDays(t, 200), insurance: addDays(t, 140) }, contractName: 'Kwesi Appiah (v1)', leaveDays: 15 })
  await prof(E, { employment: 'employee', country: 'GH', start: addDays(t, -300), licence: { class: 'C', last4: '0932', state: 'DVLA Ghana' }, emergency: { name: 'Kofi Danso', phone: '+233 24 555 0177', relation: 'Brother' }, payout: { method: 'momo', momo: '+233 24 555 0133' }, expiries: { licence: addDays(t, 400), permit: addDays(t, 6) }, contractName: 'Efua Danso (v1)', leaveDays: 20 })
  // Papers (clearly marked demo images).
  const doc = async (staff: string, kind: string, title: string, side: string, exp: string | null, status: string, note = '', color = '#1d4e89') => { const im = PNG_CARD(title, color); await db.query(`insert into driver_docs (id,staff_id,shipper_id,kind,title,data,mime,expires_on,uploaded_by,side,status,review_note,reviewed_by,created_at) values ($1,$2,'gold-coast-freight',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() - interval '20 days')`, ['dd_' + uid(), staff, kind, title, im.data, im.mime, exp, staff === K ? 'Kwesi Appiah' : 'Efua Danso', side, status, note, status === 'pending' ? '' : 'Nana Boateng']) }
  await doc(K, 'licence', 'Texas CDL — front', 'front', addDays(t, 21), 'checked'); await doc(K, 'licence', 'Texas CDL — back', 'back', addDays(t, 21), 'checked')
  await doc(K, 'id', 'US passport card', '', null, 'checked', '', '#2b3a55'); await doc(K, 'medical', 'DOT medical card', '', addDays(t, 200), 'checked', '', '#0a6842')
  await doc(K, 'insurance', 'Insurance certificate', '', addDays(t, 140), 'pending', '', '#6b4fa0')
  await doc(E, 'licence', 'DVLA licence — front', 'front', addDays(t, 400), 'checked', '', '#a3361d'); await doc(E, 'licence', 'DVLA licence — back', 'back', addDays(t, 400), 'checked', '', '#a3361d')
  await doc(E, 'id', 'Ghana Card', '', null, 'rejected', 'Photo is blurry — the number can’t be read. Please retake it in daylight.', '#0b6b5a')
  await doc(E, 'permit', 'Commercial driving permit', '', addDays(t, 6), 'checked', '', '#8a5a00')
  // Shifts for the last three periods (Mon–Fri / Mon–Sat), plus this period so far.
  const shiftDays: [string, string, number, number][] = []
  for (let i = 1; i <= 20; i++) { const dd = addDays(t, -i); const w = wkday(dd); if (w === 0) continue; if (w === 6 && i % 2) continue; shiftDays.push([K, dd, 8, 9 + (i % 3)]); if (w !== 6) shiftDays.push([E, dd, 7, 8 + (i % 2)]) }
  for (const [sid, dd, h0, len] of shiftDays) { const startH = sid === K ? h0 + 5 : h0; const start = new Date(`${dd}T${String(startH).padStart(2, '0')}:00:00Z`); const end = new Date(start.getTime() + len * 3600000); const br = [{ start: new Date(start.getTime() + 4 * 3600000).toISOString(), end: new Date(start.getTime() + 4.5 * 3600000).toISOString() }]; await db.query('insert into shifts (id,shipper_id,staff_id,start_at,end_at,breaks) values ($1,$2,$3,$4,$5,$6)', ['sh_' + uid(), 'gold-coast-freight', sid, start.toISOString(), end.toISOString(), JSON.stringify(br)]) }
  // Kwesi is on shift right now (clocked in at 8 am Houston time).
  await db.query(`insert into shifts (id,shipper_id,staff_id,start_at) values ($1,'gold-coast-freight',$2,$3)`, ['sh_' + uid(), K, new Date(`${t}T13:00:00Z`).getTime() < Date.now() ? `${t}T13:00:00Z` : new Date(Date.now() - 2 * 3600000).toISOString()])
  // Past pay periods with approved/paid payslips (fixed demo lines — history, not recomputed).
  const per = async (start: string) => { const end = addDays(start, st.periodDays - 1); const { rows } = await db.query<Row>(`insert into pay_periods (id,shipper_id,start_date,end_date,status,locked_by,locked_at) values ($1,'gold-coast-freight',$2,$3,'locked','Ama Serwaa',$4) on conflict (shipper_id, start_date) do update set status = 'locked' returning *`, ['pp_' + uid(), start, end, `${end}T18:00:00Z`]); return rows[0] }
  const slip = async (p: Row, staff: string, cur2: string, lines: Row[], status: 'approved' | 'paid', method = '', ref = '', stats: Row = {}) => {
    const gross = r2(lines.filter((l) => l.kind === 'earning' || l.kind === 'bonus').reduce((n, l) => n + l.amount, 0)); const reimb = r2(lines.filter((l) => l.kind === 'reimbursement').reduce((n, l) => n + l.amount, 0)); const ded = r2(-lines.filter((l) => l.kind === 'deduction').reduce((n, l) => n + l.amount, 0))
    const endD = DATE(p.end_date)!
    await db.query(`insert into payslips (id,period_id,shipper_id,staff_id,lines,gross,reimbursed,deducted,net,currency,status,approved_by,approved_at,paid_at,paid_method,paid_ref,stats) values ($1,$2,'gold-coast-freight',$3,$4,$5,$6,$7,$8,$9,$10,'Ama Serwaa',$11,$12,$13,$14,$15) on conflict (period_id, staff_id) do nothing`,
      ['ps_' + uid(), p.id, staff, JSON.stringify(lines), gross, reimb, ded, r2(gross + reimb - ded), cur2, status, `${addDays(endD, 1)}T15:00:00Z`, status === 'paid' ? `${addDays(endD, st.payDayOffset)}T16:00:00Z` : null, method, ref, JSON.stringify(stats)])
  }
  const periods = [3, 2, 1].map((n) => addDays(cur.start, -n * st.periodDays))
  let i = 0
  for (const ps of periods) {
    i++; const p = await per(ps); const last = i === 3
    await slip(p, K, 'USD', [{ label: 'Stops completed', kind: 'earning', qty: 30 + i * 4, rate: 12, amount: (30 + i * 4) * 12 }, { label: 'Runs', kind: 'earning', qty: 6, rate: 25, amount: 150 }, { label: 'Hours', kind: 'earning', qty: 38 + i, rate: 15, amount: (38 + i) * 15 }, ...(i === 2 ? [{ label: 'Overtime (over 40 h a week)', kind: 'earning', qty: 3, rate: 22.5, amount: 67.5 }] : []), ...(i === 1 ? [{ label: 'On-time bonus (97% on time)', kind: 'bonus', amount: 40 }] : []), { label: 'Expense: fuel — Shell, Katy', kind: 'reimbursement', amount: 58.2 + i }, ...(i >= 2 ? [{ label: 'Advance repayment — Car repair', kind: 'deduction', amount: -100 }] : [])], last ? 'approved' : 'paid', 'zelle', `ZL-${8820 + i}`, { stops: 30 + i * 4, runs: 6, hours: 38 + i, overtime: i === 2 ? 3 : 0, onTimePct: 92 + i })
    await slip(p, E, 'GHS', [{ label: 'Stops completed', kind: 'earning', qty: 24 + i * 3, rate: 45, amount: (24 + i * 3) * 45 }, { label: 'Runs', kind: 'earning', qty: 5, rate: 60, amount: 300 }, ...(i === 1 ? [{ label: 'No-damage bonus', kind: 'bonus', amount: 150 }] : []), { label: 'Expense: fuel — Goil, Spintex', kind: 'reimbursement', amount: 220 }], last ? 'approved' : 'paid', 'momo', `MM${55120 + i}`, { stops: 24 + i * 3, runs: 5, hours: 40, onTimePct: 95 })
  }
  // Everything done before this period counts as already paid (so the demo's current period starts clean).
  await db.query(`update run_stops st set paid_slip = 'demo' from runs r where r.id = st.run_id and r.driver_id in ($1,$2) and st.status = 'done' and st.done_at::date < $3::date and st.paid_slip is null`, [K, E, cur.start])
  await db.query(`update runs set paid_slip = 'demo' where driver_id in ($1,$2) and run_date < $3::date and paid_slip is null`, [K, E, cur.start])
  await db.query(`update shifts set paid_slip = 'demo' where staff_id in ($1,$2) and start_at::date < $3::date and paid_slip is null`, [K, E, cur.start])
  // An advance being repaid, expenses, a pay question.
  await db.query(`insert into pay_adjustments (id,shipper_id,staff_id,kind,amount,currency,note,installments,remaining,created_by,applied,at) values ($1,'gold-coast-freight',$2,'advance',300,'USD','Car repair',3,100,'Ama Serwaa','[{"amount":-100},{"amount":-100}]',now() - interval '25 days')`, ['pa_' + uid(), K])
  const ex = async (staff: string, kind: string, amount: number, cur2: string, usd: number, note: string, status: string, days: number) => { await db.query(`insert into driver_expenses (id,shipper_id,staff_id,kind,amount,currency,amount_usd,note,status,paid_by,at) values ($1,'gold-coast-freight',$2,$3,$4,$5,$6,$7,$8,'driver', now() - ($9 || ' days')::interval)`, ['dx_' + uid(), staff, kind, amount, cur2, usd, note, status, String(days)]) }
  await ex(K, 'toll', 6.5, 'USD', 6.5, 'Beltway 8', 'pending', 1); await ex(K, 'parking', 12, 'USD', 12, 'Port of Houston gate', 'approved', 3)
  await ex(E, 'fuel', 380, 'GHS', 34.55, 'Goil, Tema Motorway', 'pending', 0); await ex(E, 'meal', 60, 'GHS', 5.45, 'Long day, Kumasi run', 'rejected', 6)
  await db.query(`insert into payslip_queries (id,shipper_id,staff_id,line,note,status,answer,answered_by,answered_at,at) values ($1,'gold-coast-freight',$2,'Stops completed','I did 3 stops in Sugar Land on Saturday that I don’t see.','answered','They’re on this period — Saturday falls in the new week. You’ll see them on Friday’s payslip.','Ama Serwaa',now() - interval '2 days',now() - interval '3 days')`, ['pq_' + uid(), K])
  // Time off and the rota for the next two weeks.
  await db.query(`insert into leave_requests (id,shipper_id,staff_id,kind,start_date,end_date,note,status,decided_by,decided_at,at) values ($1,'gold-coast-freight',$2,'vacation',$3,$4,'Daughter’s graduation in Dallas','approved','Nana Boateng',now() - interval '5 days',now() - interval '6 days'), ($5,'gold-coast-freight',$6,'personal',$7,$7,'Ghana Card renewal at NIA','pending','',null,now() - interval '1 day')`, ['lv_' + uid(), K, addDays(t, 10), addDays(t, 11), 'lv_' + uid(), E, addDays(t, 4)])
  for (let n = 0; n < 14; n++) {
    const dd = addDays(t, n); const w = wkday(dd)
    for (const [sid, start, end] of [[K, '08:00', '17:00'], [E, '07:00', '16:00']] as const) {
      const kind = sid === K && (n === 10 || n === 11) ? 'leave' : w === 0 ? 'off' : sid === E && w === 6 ? 'off' : 'work'
      await db.query(`insert into rota (id,shipper_id,staff_id,day,kind,start_time,end_time,note) values ($1,'gold-coast-freight',$2,$3,$4,$5,$6,'') on conflict (staff_id, day) do nothing`, ['ro_' + uid(), sid, dd, kind, kind === 'work' ? start : '', kind === 'work' ? end : ''])
    }
  }
  await db.query(`insert into driver_hr_settings (shipper_id, settings) values ('gold-coast-freight', $1) on conflict (shipper_id) do update set settings = driver_hr_settings.settings || $1::jsonb`, [JSON.stringify({ demoSeeded: true })])
}
