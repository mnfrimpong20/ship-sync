/**
 * Broker dashboard (/broker-portal). Customs brokers get their own accounts (broker_members) and sessions,
 * separate from customers and shipping companies. A broker company works its clearance jobs, uploads
 * customs papers onto the shipment, talks to the shipper's office, bills fees and disbursements, and
 * sees analytics and reports. The old one-job link (/broker/<token>) keeps working.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { emailProvider, emailTemplate, notify, notifyShipperStaff, sendEmail } from './notify'
import { JOB_SELECT, JOB_STEPS, advanceJob, brokerOut, jobOut, jobStepLabels, zStep, type JobStep } from './brokers'
import { cargoLabel, type CargoType } from '../src/lib/data'
import { isDriverRole } from '../src/lib/roles'

type Row = Record<string, any>
interface Deps { getDb: () => Promise<Db>; requireUser: (db: Db, req: Request) => Promise<ApiUser>; HttpError: new (status: number, message: string) => Error; wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void }
const COOKIE = 'ntb_session'
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : (v as T))
const r2 = (n: number) => Math.round(n * 100) / 100
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const FX: Record<string, number> = { USD: 1, GHS: Number(process.env.GHS_PER_USD || 11), NGN: Number(process.env.NGN_PER_USD || 1550), XOF: 600, EUR: 0.92, GBP: 0.79 }
const toUsd = (n: number, cur: string) => r2(n / (FX[cur] ?? 1))
export const CHARGE_KINDS = { port: 'Port / terminal charges', storage: 'Storage / rent', examination: 'Examination', transport: 'Haulage to yard', duty_advance: 'Duty paid on your behalf', permits: 'Permits (FDA, GSA…)', other: 'Other' } as const
export const CHECKLIST = [['bl', 'Bill of lading received'], ['invoice', 'Commercial invoice / packing list'], ['idf', 'IDF / pre-arrival lodged'], ['permits', 'Permits in hand (if needed)'], ['declaration', 'Declaration lodged (ICUMS / NICIS)'], ['exam', 'Examination booked or waived'], ['receipt', 'Duty receipt filed'], ['release', 'Release order received'], ['gatepass', 'Gate pass / waybill issued']] as const

/** Broker in-app notification + email to the broker's members (the office or customer did something on a job). */
export async function notifyBroker(db: Db, brokerId: string, n: { title: string; body?: string; link?: string }) {
  await db.query('insert into broker_notifications (id,broker_id,title,body,link) values ($1,$2,$3,$4,$5)', ['bn_' + uid(), brokerId, n.title.slice(0, 200), (n.body ?? '').slice(0, 600), n.link ?? ''])
  if (emailProvider().id === 'off') return
  const { rows } = await db.query<Row>(`select name, email from broker_members where broker_id = $1 and status = 'active' and role = 'owner'`, [brokerId])
  for (const m of rows) { try { await sendEmail(m.email, n.title, emailTemplate({ name: m.name, title: n.title, body: n.body ?? '', link: n.link ? `${appUrl()}${n.link}` : undefined, cta: 'Open in your broker dashboard' })) } catch (e) { console.error('[broker] email', e) } }
}

const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export function mountBrokerPortal(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  /* ---------------- sign-in ---------------- */
  const session = async (db: Db, res: Response, memberId: string) => {
    const id = randomBytes(32).toString('hex'); const days = 30
    await db.query('insert into broker_sessions (id,member_id,expires_at) values ($1,$2,$3)', [id, memberId, new Date(Date.now() + days * 86400000)])
    await db.query('update broker_members set last_seen_at = now() where id = $1', [memberId])
    res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: days * 86400000, path: '/' })
  }
  const me = async (db: Db, req: Request) => {
    const sid = req.cookies?.[COOKIE]; if (!sid) throw new HttpError(401, 'Please sign in.')
    const { rows } = await db.query<Row>(`select m.*, b.name as b_name, b.company as b_company from broker_sessions s join broker_members m on m.id = s.member_id join brokers b on b.id = m.broker_id where s.id = $1 and s.expires_at > now() and m.status = 'active'`, [sid])
    if (!rows[0]) throw new HttpError(401, 'Please sign in.')
    return rows[0]
  }
  const owner = async (db: Db, req: Request) => { const m = await me(db, req); if (m.role !== 'owner') throw new HttpError(403, 'Only the account owner can do this.'); return m }
  const memberOut = (m: Row) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, role: m.role as 'owner' | 'agent', status: m.status, lastSeenAt: ISO(m.last_seen_at) })
  const tries = new Map<string, number[]>()
  const brake = (k: string) => { const now = Date.now(); const t = (tries.get(k) ?? []).filter((x) => now - x < 15 * 60000); if (t.length >= 8) throw new HttpError(429, 'Too many attempts — wait a few minutes.'); t.push(now); tries.set(k, t) }

  r.post('/bp/login', wrap(async (req, res) => {
    const db = await getDb(); const b = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body)
    brake('l:' + b.email + ':' + req.ip)
    const { rows } = await db.query<Row>(`select * from broker_members where lower(email) = $1 and status = 'active'`, [b.email]); const m = rows[0]
    if (!m?.password_hash || !(await bcrypt.compare(b.password, m.password_hash))) throw new HttpError(401, 'Wrong email or password.')
    tries.delete('l:' + b.email + ':' + req.ip) // only wrong passwords count toward the limit
    await session(db, res, m.id); res.json({ ok: true })
  }))
  r.post('/bp/logout', wrap(async (req, res) => { const db = await getDb(); const sid = req.cookies?.[COOKIE]; if (sid) await db.query('delete from broker_sessions where id = $1', [sid]); res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }) }))
  /** Emailed one-time sign-in link (also how a broker who forgot their password gets back in). */
  r.post('/bp/link', wrap(async (req, res) => {
    const db = await getDb(); const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body); brake('k:' + email)
    const { rows } = await db.query<Row>(`select * from broker_members where lower(email) = $1 and status = 'active'`, [email]); const m = rows[0]
    if (m) { const t = randomBytes(24).toString('base64url'); await db.query('insert into broker_login_links (token,member_id,expires_at) values ($1,$2,$3)', [t, m.id, new Date(Date.now() + 20 * 60000)]); const url = `${appUrl()}/broker-portal/signin?token=${t}`; if (emailProvider().id !== 'off') await sendEmail(m.email, 'Your Ntemtem broker sign-in link', emailTemplate({ name: m.name, title: 'Sign in to your broker dashboard', body: 'This link works once and expires in 20 minutes.', link: url, cta: 'Sign in' })).catch(() => {}); else console.log(`[broker] sign-in link for ${m.email}: ${url}`) }
    res.json({ ok: true })
  }))
  r.post('/bp/link/use', wrap(async (req, res) => {
    const db = await getDb(); const { token } = z.object({ token: z.string().min(10).max(100) }).parse(req.body)
    const { rows } = await db.query<Row>(`update broker_login_links set used_at = now() where token = $1 and used_at is null and expires_at > now() returning member_id`, [token]); if (!rows[0]) throw new HttpError(400, 'This link has expired or was already used.')
    await session(db, res, rows[0].member_id); res.json({ ok: true })
  }))
  /** Invited team member sets a password. */
  r.get('/bp/join/:token', wrap(async (req, res) => { const db = await getDb(); const { rows } = await db.query<Row>(`select m.name, m.email, b.name as b_name, b.company from broker_members m join brokers b on b.id = m.broker_id where m.invite_token = $1 and m.status = 'invited'`, [String(req.params.token)]); if (!rows[0]) throw new HttpError(404, 'This invitation is no longer valid.'); res.json({ name: rows[0].name, email: rows[0].email, company: rows[0].company || rows[0].b_name }) }))
  r.post('/bp/join/:token', wrap(async (req, res) => {
    const db = await getDb(); const { password } = z.object({ password: z.string().min(8, 'Use at least 8 characters.').max(200) }).parse(req.body)
    const { rows } = await db.query<Row>(`update broker_members set password_hash = $2, status = 'active', invite_token = null where invite_token = $1 and status = 'invited' returning id`, [String(req.params.token), await bcrypt.hash(password, 10)]); if (!rows[0]) throw new HttpError(404, 'This invitation is no longer valid.')
    await session(db, res, rows[0].id); res.json({ ok: true })
  }))
  r.post('/bp/password', wrap(async (req, res) => { const db = await getDb(); const m = await me(db, req); const { password } = z.object({ password: z.string().min(8, 'Use at least 8 characters.').max(200) }).parse(req.body); await db.query('update broker_members set password_hash = $2 where id = $1', [m.id, await bcrypt.hash(password, 10)]); res.json({ ok: true }) }))

  r.get('/bp/me', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req)
    const { rows: b } = await db.query<Row>(`select b.*, (select count(*) from broker_jobs j where j.broker_id = b.id and j.status not in ('cancelled','declined'))::int as n_jobs from brokers b where b.id = $1`, [m.broker_id])
    const { rows: n } = await db.query<{ n: number }>('select count(*)::int as n from broker_notifications where broker_id = $1 and read_at is null', [m.broker_id])
    const { rows: u } = await db.query<{ n: number }>(`select count(*)::int as n from broker_job_messages x join broker_jobs j on j.id = x.job_id where j.broker_id = $1 and x.from_side <> 'broker' and not x.read_by_broker`, [m.broker_id])
    const { rows: rq } = await db.query<{ n: number }>(`select count(*)::int as n from broker_jobs where broker_id = $1 and status = 'requested'`, [m.broker_id])
    const { rows: tm } = await db.query<{ n: number }>(`select count(*)::int as n from broker_members where broker_id = $1`, [m.broker_id])
    res.set('Cache-Control', 'no-store'); res.json({ member: memberOut(m), broker: { ...brokerOut(b[0], true), accepting: !!b[0].accepting, settings: J<Row>(b[0].settings, {}), licenceExpires: DATE(b[0].licence_expires) }, counts: { notifications: n[0].n, unread: u[0].n, requests: rq[0].n, team: tm[0].n } })
  }))

  /* ---------------- jobs ---------------- */
  const jobsOf = async (db: Db, brokerId: string) => (await db.query<Row>(`${JOB_SELECT} where j.broker_id = $1 order by j.updated_at desc`, [brokerId])).rows
  const stepAt = (j: Row, step: string) => (J<Row[]>(j.timeline, []).find((t) => t.status === step)?.at as string | undefined) ?? null
  const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0)
  const lastMove = (j: Row) => { const t = J<Row[]>(j.timeline, []); return t.length ? t[t.length - 1].at as string : ISO(j.created_at)! }
  const OPEN = (s: string) => !['done', 'cancelled', 'declined'].includes(s)
  const jobRow = (j: Row, extra: Row = {}) => ({ ...jobOut(j), shipmentStatus: j.s_status, daysAtStep: Math.round(daysSince(lastMove(j)) * 10) / 10, ...extra })
  const ownJob = async (db: Db, req: Request) => {
    const m = await me(db, req); const { rows } = await db.query<Row>(`${JOB_SELECT} where j.id = $1 and j.broker_id = $2`, [String(req.params.id), m.broker_id])
    if (!rows[0]) throw new HttpError(404, 'Job not found.'); return { m, job: rows[0] }
  }

  /** Released or cleared jobs not on an invoice yet, plus their rebillable charges — the same figure on Overview and Finance. */
  const readyToBill = async (db: Db, brokerId: string) => {
    const { rows } = await db.query<Row>(`with ready as (select j.id, j.fee_usd from broker_jobs j where j.broker_id = $1 and j.status in ('released','done') and not exists (select 1 from broker_invoices i where i.broker_id = j.broker_id and i.status <> 'void' and i.job_ids ? j.id))
      select (select coalesce(sum(fee_usd),0) from ready) + (select coalesce(sum(c.amount_usd),0) from broker_charges c where c.job_id in (select id from ready) and c.rebill and c.invoice_id is null) as n`, [brokerId])
    return r2(Number(rows[0]?.n ?? 0))
  }
  /** Job rows with who they're assigned to and unread messages — used by Overview and the Jobs board. */
  const withNames = async (db: Db, brokerId: string, jobs: Row[]) => {
    const { rows: unread } = await db.query<Row>(`select x.job_id, count(*)::int as n from broker_job_messages x join broker_jobs j on j.id = x.job_id where j.broker_id = $1 and x.from_side <> 'broker' and not x.read_by_broker group by x.job_id`, [brokerId])
    const um = new Map(unread.map((x) => [x.job_id, x.n]))
    const { rows: team } = await db.query<Row>('select id, name from broker_members where broker_id = $1', [brokerId]); const names = new Map(team.map((t) => [t.id, t.name]))
    return jobs.map((j) => jobRow(j, { unread: um.get(j.id) ?? 0, assignedName: j.assigned_to ? names.get(j.assigned_to) ?? null : null }))
  }
  r.get('/bp/overview', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req); const jobs = await jobsOf(db, m.broker_id)
    const open = jobs.filter((j) => OPEN(j.status)); const done = jobs.filter((j) => j.status === 'done')
    const month = new Date().toISOString().slice(0, 7)
    const doneMonth = done.filter((j) => (stepAt(j, 'done') ?? '').slice(0, 7) === month)
    const clearDays = done.map((j) => { const e = stepAt(j, 'done'); return e ? (new Date(e).getTime() - new Date(j.created_at).getTime()) / 86400000 : null }).filter((x): x is number => x != null)
    const { rows: inv } = await db.query<Row>(`select status, total_usd, due_at from broker_invoices where broker_id = $1 and status in ('sent','draft')`, [m.broker_id])
    const unbilledUsd = await readyToBill(db, m.broker_id)
    const isOwner = m.role === 'owner'
    const attention: Row[] = []
    for (const j of open) {
      const d0 = daysSince(lastMove(j))
      if (j.status === 'requested') attention.push({ kind: 'request', jobId: j.id, ref: j.ref, title: `New request: ${j.ref} from ${j.shipper_name}`, detail: `${cargoLabel(j.cargo as CargoType)} · fee ${fmtUsd(Number(j.fee_usd))}`, age: Math.round(d0 * 24) })
      else if (d0 >= 3) attention.push({ kind: 'stuck', jobId: j.id, ref: j.ref, title: `${j.ref} has been at “${jobStepLabels[j.status as JobStep]}” for ${Math.floor(d0)} days`, detail: `${j.shipper_name} · ${j.customer}`, age: Math.round(d0 * 24) })
    }
    const overdue = inv.filter((i) => i.status === 'sent' && i.due_at && DATE(i.due_at)! < new Date().toISOString().slice(0, 10))
    if (overdue.length && isOwner) attention.push({ kind: 'overdue', title: `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} overdue`, detail: fmtUsd(overdue.reduce((n, i) => n + Number(i.total_usd), 0)), link: '/broker-portal/finance' })
    const { rows: msgs } = await db.query<Row>(`select x.*, j.id as jid, s.ref from broker_job_messages x join broker_jobs j on j.id = x.job_id join shipments s on s.id = j.shipment_id where j.broker_id = $1 and x.from_side <> 'broker' and not x.read_by_broker order by x.at desc limit 5`, [m.broker_id])
    for (const x of msgs) attention.push({ kind: 'message', jobId: x.jid, ref: x.ref, title: `Message on ${x.ref} from ${x.from_name}`, detail: x.body.slice(0, 120), age: Math.round(daysSince(ISO(x.at)) * 24) })
    const pipeline = JOB_STEPS.filter((s) => s !== 'done').map((s) => ({ step: s, label: jobStepLabels[s], n: open.filter((j) => j.status === s).length }))
    const { rows: dutyRows } = await db.query<Row>(`select duty_currency, sum(duty_local) as n from broker_jobs where broker_id = $1 and duty_local is not null and to_char(updated_at, 'YYYY-MM') = $2 group by duty_currency`, [m.broker_id, month])
    res.set('Cache-Control', 'no-store')
    res.json({
      kpis: { open: open.length, requests: open.filter((j) => j.status === 'requested').length, doneMonth: doneMonth.length, feesMonth: isOwner ? r2(doneMonth.reduce((n, j) => n + Number(j.fee_usd), 0)) : null, avgClearDays: clearDays.length ? Math.round((clearDays.reduce((a, x) => a + x, 0) / clearDays.length) * 10) / 10 : null, outstanding: isOwner ? r2(inv.filter((i) => i.status === 'sent').reduce((n, i) => n + Number(i.total_usd), 0)) : null, unbilled: isOwner ? unbilledUsd : null, dutyMonth: dutyRows.map((x) => ({ currency: x.duty_currency, amount: Number(x.n) })) },
      attention: attention.sort((a, b) => (a.kind === 'request' ? -1 : 0) - (b.kind === 'request' ? -1 : 0)).slice(0, 12), pipeline,
      recent: await withNames(db, m.broker_id, jobs.slice(0, 8)),
    })
  }))
  r.get('/bp/jobs', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req); const jobs = await jobsOf(db, m.broker_id)
    res.set('Cache-Control', 'no-store'); res.json({ jobs: await withNames(db, m.broker_id, jobs) })
  }))
  r.get('/bp/jobs/:id', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req)
    const sid = job.shipment_id
    const { rows: sh } = await db.query<Row>('select * from shipments where id = $1', [sid]); const s = sh[0]
    const { rows: cons } = await db.query<Row>('select name, phone, address, city, gps from client_consignees where id = $1', [s.consignee_id ?? ''])
    const { rows: pieces } = await db.query<{ n: number }>('select count(*)::int as n from pieces where shipment_id = $1', [sid])
    const { rows: veh } = await db.query<Row>('select vin, year, make, model, engine_l, body, declared_value_usd from shipment_vehicles where shipment_id = $1', [sid])
    const { rows: cont } = await db.query<Row>(`select c.number, c.seal, c.vessel_name, c.eta, c.line from containers c where c.id = $1`, [s.container_id ?? ''])
    const { rows: docs } = await db.query<Row>(`select id, kind, title, mime, uploaded_by, uploaded_by_role, created_at, (data is not null) as has_file from documents where shipment_id = $1 and (visibility = 'shared' or uploaded_by_role = 'broker') order by created_at desc`, [sid])
    const { rows: charges } = await db.query<Row>('select * from broker_charges where job_id = $1 order by at', [job.id])
    const { rows: msgs } = await db.query<Row>('select * from broker_job_messages where job_id = $1 order by at', [job.id])
    await db.query(`update broker_job_messages set read_by_broker = true where job_id = $1 and from_side <> 'broker'`, [job.id])
    const { rows: team } = await db.query<Row>(`select id, name, role from broker_members where broker_id = $1 and status = 'active' order by name`, [m.broker_id])
    const { rows: inv } = await db.query<Row>(`select id, number, status from broker_invoices where broker_id = $1 and status <> 'void' and job_ids ? $2`, [m.broker_id, job.id])
    const decl = J<Row>(s.declaration, {})
    res.set('Cache-Control', 'no-store')
    res.json({
      job: jobRow(job), checklistItems: CHECKLIST.map(([k, l]) => ({ key: k, label: l })), chargeKinds: CHARGE_KINDS,
      shipment: { id: s.id, ref: s.ref, customer: s.customer, origin: s.origin, destination: s.destination, mode: s.mode, cargo: s.cargo, cargoLabel: cargoLabel(s.cargo as CargoType), description: s.description, status: s.status, eta: DATE(s.eta), pieces: pieces[0].n, weightKg: s.weight_kg == null ? null : Number(s.weight_kg), declaredValueUsd: decl.valueUsd ?? s.declared_value_usd ?? null, items: decl.items ?? null },
      consignee: cons[0] ? { name: cons[0].name, phone: cons[0].phone, address: cons[0].address, city: cons[0].city, gps: cons[0].gps ?? '' } : null,
      vehicle: veh[0] ? { vin: veh[0].vin, label: [veh[0].year, veh[0].make, veh[0].model].filter(Boolean).join(' '), engineL: veh[0].engine_l == null ? null : Number(veh[0].engine_l), body: veh[0].body, valueUsd: veh[0].declared_value_usd == null ? null : Number(veh[0].declared_value_usd) } : null,
      container: cont[0] ? { number: cont[0].number, seal: cont[0].seal, vessel: cont[0].vessel_name, eta: DATE(cont[0].eta), line: cont[0].line } : null,
      documents: docs.map((x) => ({ id: x.id, kind: x.kind, title: x.title, mime: x.mime, byBroker: x.uploaded_by_role === 'broker', by: x.uploaded_by, hasFile: !!x.has_file, at: ISO(x.created_at) })),
      charges: charges.map(chargeOut), messages: msgs.map(msgOut), team: team.map((t) => ({ id: t.id, name: t.name, role: t.role })), invoices: inv.map((i) => ({ id: i.id, number: i.number, status: i.status })),
    })
  }))
  r.post('/bp/jobs/:id/step', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req); const b = zStep.parse(req.body)
    if (b.status === 'cancelled') throw new HttpError(403, 'Brokers decline rather than cancel.')
    await advanceJob(db, job, b, `${m.name}${m.b_company ? ` (${m.b_company})` : ''}`, 'broker', HttpError)
    if (b.status === 'accepted' && !job.assigned_to) await db.query('update broker_jobs set assigned_to = $2 where id = $1', [job.id, m.id])
    res.json({ ok: true })
  }))
  r.patch('/bp/jobs/:id', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req)
    const b = z.object({ assignedTo: z.string().nullable().optional(), checklist: z.record(z.string(), z.boolean()).optional(), reference: z.string().trim().max(60).optional(), port: z.string().trim().max(40).optional() }).parse(req.body)
    if (b.assignedTo) { const { rows } = await db.query('select 1 from broker_members where id = $1 and broker_id = $2', [b.assignedTo, m.broker_id]); if (!rows[0]) throw new HttpError(400, 'Not on your team.') }
    await db.query(`update broker_jobs set assigned_to = case when $2::boolean then $3 else assigned_to end, checklist = coalesce($4, checklist), reference = coalesce($5, reference), port = coalesce($6, port), updated_at = now() where id = $1`, [job.id, b.assignedTo !== undefined, b.assignedTo ?? null, b.checklist ? JSON.stringify(b.checklist) : null, b.reference ?? null, b.port ?? null])
    res.json({ ok: true })
  }))
  /** Customs papers the broker produces go straight onto the shipment (office and customer see them). */
  r.post('/bp/jobs/:id/docs', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req)
    const b = z.object({ title: z.string().trim().min(2).max(100), kind: z.enum(['customs', 'receipt', 'other']).default('customs'), dataUrl: z.string().max(6_000_000).regex(/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/), filename: z.string().max(120).default('') }).parse(req.body)
    const mm = /^data:([^;]+);base64,(.*)$/.exec(b.dataUrl)!; const id = 'doc_' + uid()
    await db.query(`insert into documents (id,shipment_id,shipper_id,kind,title,filename,mime,size,data,source,visibility,uploaded_by,uploaded_by_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'upload','shared',$10,'broker')`, [id, job.shipment_id, job.shipper_id, b.kind, b.title, b.filename, mm[1], Math.round(mm[2].length * 0.75), mm[2], `${m.name} (${m.b_company || m.b_name})`])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [job.shipment_id, job.s_status, job.destination, `Customs paper added by the broker: ${b.title}.`])
    await notifyShipperStaff(db, job.shipper_id, { kind: 'customs', title: `${job.ref}: broker added “${b.title}”`, body: `${m.name} · ${m.b_company || m.b_name}`, link: `/dashboard/shipments?q=${job.ref}&b=all`, dedupe: `bdoc:${id}` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json({ id })
  }))
  r.get('/bp/docs/:id', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req)
    const { rows } = await db.query<Row>(`select d.* from documents d join broker_jobs j on j.shipment_id = d.shipment_id where d.id = $1 and j.broker_id = $2 and (d.visibility = 'shared' or d.uploaded_by_role = 'broker') limit 1`, [String(req.params.id), m.broker_id])
    if (!rows[0]) throw new HttpError(404, 'Not found.')
    res.set('Cache-Control', 'private, no-store'); res.json({ title: rows[0].title, dataUrl: rows[0].data ? `data:${rows[0].mime};base64,${rows[0].data}` : null, payload: J(rows[0].payload, null), kind: rows[0].kind })
  }))

  /* ---------------- messages (broker ↔ shipper office, customer can read/write too) ---------------- */
  const msgOut = (x: Row) => ({ id: x.id, side: x.from_side as 'broker' | 'office' | 'customer', from: x.from_name, body: x.body, docId: x.doc_id ?? null, at: ISO(x.at) })
  r.post('/bp/jobs/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req); const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body)
    const id = 'bm_' + uid(); await db.query('insert into broker_job_messages (id,job_id,from_side,from_name,body,read_by_broker) values ($1,$2,$3,$4,$5,true)', [id, job.id, 'broker', `${m.name}${m.b_company ? ` · ${m.b_company}` : ''}`, body])
    await notifyShipperStaff(db, job.shipper_id, { kind: 'customs', title: `${job.ref}: message from the broker`, body: `${m.name}: ${body.slice(0, 140)}`, link: `/dashboard/shipments?q=${job.ref}&b=all`, dedupe: `bmsg:${id}` }, ['owner', 'dispatcher', 'agent'])
    res.status(201).json({ ok: true })
  }))
  r.get('/bp/inbox', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req)
    const { rows } = await db.query<Row>(`select j.id, s.ref, s.customer, sh.name as shipper_name, j.status, (select x.body from broker_job_messages x where x.job_id = j.id order by x.at desc limit 1) as last_body, (select x.from_name from broker_job_messages x where x.job_id = j.id order by x.at desc limit 1) as last_from, (select max(x.at) from broker_job_messages x where x.job_id = j.id) as last_at, (select count(*)::int from broker_job_messages x where x.job_id = j.id and x.from_side <> 'broker' and not x.read_by_broker) as unread from broker_jobs j join shipments s on s.id = j.shipment_id join shippers sh on sh.id = j.shipper_id where j.broker_id = $1 and exists (select 1 from broker_job_messages x where x.job_id = j.id) order by last_at desc`, [m.broker_id])
    res.set('Cache-Control', 'no-store'); res.json({ threads: rows.map((x) => ({ jobId: x.id, ref: x.ref, customer: x.customer, shipper: x.shipper_name, status: x.status, last: x.last_body, lastFrom: x.last_from, lastAt: ISO(x.last_at), unread: x.unread })) })
  }))
  // Office / customer side of the same thread (from the shipment's customs card).
  const sideAccess = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`${JOB_SELECT} where j.id = $1`, [String(req.params.id)]); const job = rows[0]; if (!job) throw new HttpError(404, 'Job not found.')
    const office = u.role === 'shipper' && u.shipperId === job.shipper_id && !isDriverRole(u.staffRole); const cust = u.role === 'customer' && job.s_user_id === u.id
    if (!office && !cust && !u.admin) throw new HttpError(403, 'Not allowed.')
    return { u, job, side: (office || u.admin ? 'office' : 'customer') as 'office' | 'customer' }
  }
  r.get('/customs/jobs/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { job, side } = await sideAccess(db, req)
    const { rows } = await db.query<Row>('select * from broker_job_messages where job_id = $1 order by at', [job.id])
    if (side === 'office') await db.query(`update broker_job_messages set read_by_office = true where job_id = $1 and from_side = 'broker'`, [job.id])
    const { rows: inv } = await db.query<Row>(`select id, number, status, total_usd, due_at from broker_invoices where job_ids ? $1 and status in ('sent','paid')`, [job.id])
    res.set('Cache-Control', 'no-store'); res.json({ messages: rows.map(msgOut), invoices: side === 'office' ? inv.map((i) => ({ id: i.id, number: i.number, status: i.status, totalUsd: Number(i.total_usd), dueAt: DATE(i.due_at) })) : [] })
  }))
  r.post('/customs/jobs/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { u, job, side } = await sideAccess(db, req); const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body)
    const id = 'bm_' + uid(); await db.query('insert into broker_job_messages (id,job_id,from_side,from_name,body,read_by_office) values ($1,$2,$3,$4,$5,$6)', [id, job.id, side, side === 'office' ? `${u.name} · ${job.shipper_name}` : u.name, body, side === 'office'])
    await notifyBroker(db, job.broker_id, { title: `${job.ref}: message from ${side === 'office' ? job.shipper_name : 'the customer'}`, body: `${u.name}: ${body.slice(0, 200)}`, link: `/broker-portal/jobs/${job.id}` })
    res.status(201).json({ ok: true })
  }))

  /* ---------------- money: charges, invoices ---------------- */
  const chargeOut = (c: Row) => ({ id: c.id, jobId: c.job_id, kind: c.kind, label: (CHARGE_KINDS as Record<string, string>)[c.kind] ?? c.kind, description: c.description, amount: Number(c.amount), currency: c.currency, amountUsd: Number(c.amount_usd), rebill: !!c.rebill, invoiceId: c.invoice_id ?? null, hasReceipt: !!c.receipt, at: ISO(c.at), by: c.created_by })
  r.post('/bp/jobs/:id/charges', wrap(async (req, res) => {
    const db = await getDb(); const { m, job } = await ownJob(db, req)
    const b = z.object({ kind: z.enum(Object.keys(CHARGE_KINDS) as [keyof typeof CHARGE_KINDS]), description: z.string().trim().max(200).default(''), amount: z.number().positive().max(100_000_000), currency: z.enum(['USD', 'GHS', 'NGN', 'XOF', 'EUR', 'GBP']), rebill: z.boolean().default(true), receipt: z.string().max(3_000_000).regex(/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/).optional() }).parse(req.body)
    await db.query('insert into broker_charges (id,job_id,broker_id,kind,description,amount,currency,amount_usd,rebill,receipt,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', ['bc_' + uid(), job.id, m.broker_id, b.kind, b.description, b.amount, b.currency, toUsd(b.amount, b.currency), b.rebill, b.receipt ?? null, m.name])
    res.status(201).json({ ok: true })
  }))
  r.delete('/bp/charges/:id', wrap(async (req, res) => { const db = await getDb(); const m = await me(db, req); const { rows } = await db.query<Row>('delete from broker_charges where id = $1 and broker_id = $2 and invoice_id is null returning id', [String(req.params.id), m.broker_id]); if (!rows[0]) throw new HttpError(409, 'Already on an invoice.'); res.json({ ok: true }) }))
  const invOut = (i: Row) => ({ id: i.id, number: i.number, shipperId: i.shipper_id, shipper: i.shipper_name ?? undefined, lines: J<Row[]>(i.lines, []), jobIds: J<string[]>(i.job_ids, []), totalUsd: Number(i.total_usd), status: i.status as 'draft' | 'sent' | 'paid' | 'void', dueAt: DATE(i.due_at), sentAt: ISO(i.sent_at), paidAt: ISO(i.paid_at), paidRef: i.paid_ref, remindedAt: ISO(i.reminded_at), notes: i.notes, createdAt: ISO(i.created_at), overdue: i.status === 'sent' && !!i.due_at && DATE(i.due_at)! < new Date().toISOString().slice(0, 10) })
  r.get('/bp/finance', wrap(async (req, res) => {
    const db = await getDb(); const m = await owner(db, req)
    const { rows: inv } = await db.query<Row>(`select i.*, sh.name as shipper_name from broker_invoices i join shippers sh on sh.id = i.shipper_id where i.broker_id = $1 order by i.created_at desc`, [m.broker_id])
    // Ready to bill: finished (or released) jobs not yet on an invoice, with their rebillable charges.
    const { rows: ready } = await db.query<Row>(`${JOB_SELECT} where j.broker_id = $1 and j.status in ('released','done') and not exists (select 1 from broker_invoices i where i.broker_id = j.broker_id and i.status <> 'void' and i.job_ids ? j.id) order by j.updated_at desc`, [m.broker_id])
    const { rows: ch } = await db.query<Row>(`select * from broker_charges where broker_id = $1 and invoice_id is null and rebill`, [m.broker_id])
    const unbilled = ready.map((j) => ({ jobId: j.id, ref: j.ref, shipperId: j.shipper_id, shipper: j.shipper_name, customer: j.customer, status: j.status, feeUsd: Number(j.fee_usd), charges: ch.filter((c) => c.job_id === j.id).map(chargeOut) }))
    const { rows: months } = await db.query<Row>(`select to_char(coalesce(paid_at, created_at), 'YYYY-MM') as m, sum(total_usd) filter (where status = 'paid') as paid, sum(total_usd) filter (where status in ('sent','paid')) as billed from broker_invoices where broker_id = $1 and created_at > now() - interval '12 months' group by 1 order by 1`, [m.broker_id])
    const byShipper = new Map<string, { shipper: string; billed: number; paid: number; outstanding: number }>()
    for (const i of inv.filter((x) => x.status !== 'void' && x.status !== 'draft')) { const k = byShipper.get(i.shipper_id) ?? { shipper: i.shipper_name, billed: 0, paid: 0, outstanding: 0 }; k.billed += Number(i.total_usd); if (i.status === 'paid') k.paid += Number(i.total_usd); else k.outstanding += Number(i.total_usd); byShipper.set(i.shipper_id, k) }
    const { rows: disb } = await db.query<Row>(`select coalesce(sum(amount_usd) filter (where invoice_id is null and rebill),0) as open, coalesce(sum(amount_usd),0) as total from broker_charges where broker_id = $1`, [m.broker_id])
    const st = J<Row>((await db.query<Row>('select settings from brokers where id = $1', [m.broker_id])).rows[0]?.settings, {})
    res.set('Cache-Control', 'no-store')
    res.json({ invoices: inv.map(invOut), unbilled, months: months.map((x) => ({ month: x.m, paid: r2(Number(x.paid ?? 0)), billed: r2(Number(x.billed ?? 0)) })), byShipper: [...byShipper.values()].map((x) => ({ ...x, billed: r2(x.billed), paid: r2(x.paid), outstanding: r2(x.outstanding) })),
      totals: { outstanding: r2(inv.filter((i) => i.status === 'sent').reduce((n, i) => n + Number(i.total_usd), 0)), paidYear: r2(inv.filter((i) => i.status === 'paid' && (ISO(i.paid_at) ?? '').slice(0, 4) === new Date().toISOString().slice(0, 4)).reduce((n, i) => n + Number(i.total_usd), 0)), unbilled: r2(unbilled.reduce((n, u) => n + u.feeUsd + u.charges.reduce((a, c) => a + c.amountUsd, 0), 0)), disbursementsOpen: r2(Number(disb[0].open)) }, settings: { termsDays: Number(st.termsDays ?? 14), bank: st.bank ?? '', invoiceNote: st.invoiceNote ?? '' } })
  }))
  r.post('/bp/invoices', wrap(async (req, res) => {
    const db = await getDb(); const m = await owner(db, req); const { jobIds, notes } = z.object({ jobIds: z.array(z.string()).min(1).max(50), notes: z.string().trim().max(500).default('') }).parse(req.body)
    const { rows: jobs } = await db.query<Row>(`${JOB_SELECT} where j.broker_id = $1 and j.id = any($2::text[])`, [m.broker_id, jobIds])
    if (jobs.length !== jobIds.length) throw new HttpError(400, 'Some jobs aren’t yours.')
    const shippers = new Set(jobs.map((j) => j.shipper_id)); if (shippers.size > 1) throw new HttpError(400, 'One invoice per shipping company — pick jobs for the same company.')
    const { rows: already } = await db.query(`select 1 from broker_invoices where broker_id = $1 and status <> 'void' and job_ids ?| $2::text[]`, [m.broker_id, jobIds]); if (already[0]) throw new HttpError(409, 'One of these jobs is already invoiced.')
    const { rows: ch } = await db.query<Row>(`select * from broker_charges where job_id = any($1::text[]) and invoice_id is null and rebill order by at`, [jobIds])
    const lines: Row[] = []
    for (const j of jobs) { lines.push({ jobId: j.id, ref: j.ref, label: `Clearance fee — ${j.ref} (${cargoLabel(j.cargo as CargoType)})`, amountUsd: Number(j.fee_usd) }); for (const c of ch.filter((x) => x.job_id === j.id)) lines.push({ jobId: j.id, ref: j.ref, chargeId: c.id, label: `${(CHARGE_KINDS as Record<string, string>)[c.kind] ?? c.kind}${c.description ? ` — ${c.description}` : ''} (${j.ref})${c.currency !== 'USD' ? ` · ${c.currency} ${Number(c.amount).toLocaleString()}` : ''}`, amountUsd: Number(c.amount_usd) }) }
    const st = J<Row>((await db.query<Row>('select settings from brokers where id = $1', [m.broker_id])).rows[0]?.settings, {})
    const { rows: n } = await db.query<{ n: number }>('select count(*)::int as n from broker_invoices where broker_id = $1', [m.broker_id])
    const id = 'binv_' + uid(); const number = `BRK-${new Date().getFullYear()}-${String(n[0].n + 1).padStart(4, '0')}`
    const due = new Date(Date.now() + Number(st.termsDays ?? 14) * 86400000).toISOString().slice(0, 10)
    await db.query('insert into broker_invoices (id,broker_id,shipper_id,number,lines,job_ids,total_usd,due_at,notes,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, m.broker_id, jobs[0].shipper_id, number, JSON.stringify(lines), JSON.stringify(jobIds), r2(lines.reduce((a, l) => a + l.amountUsd, 0)), due, notes || st.invoiceNote || '', m.name])
    await db.query('update broker_charges set invoice_id = $2 where id = any($1::text[])', [ch.map((c) => c.id), id])
    res.status(201).json({ id })
  }))
  const ownInv = async (db: Db, req: Request) => { const m = await owner(db, req); const { rows } = await db.query<Row>(`select i.*, sh.name as shipper_name from broker_invoices i join shippers sh on sh.id = i.shipper_id where i.id = $1 and i.broker_id = $2`, [String(req.params.id), m.broker_id]); if (!rows[0]) throw new HttpError(404, 'Invoice not found.'); return { m, inv: rows[0] } }
  r.get('/bp/invoices/:id', wrap(async (req, res) => {
    const db = await getDb(); const { m, inv } = await ownInv(db, req)
    const { rows: b } = await db.query<Row>('select * from brokers where id = $1', [m.broker_id])
    res.set('Cache-Control', 'no-store'); res.json({ invoice: invOut(inv), broker: { name: b[0].name, company: b[0].company, licence: b[0].licence_no, authority: b[0].licence_authority, phone: b[0].phone, email: b[0].email, bank: J<Row>(b[0].settings, {}).bank ?? '' } })
  }))
  r.post('/bp/invoices/:id/send', wrap(async (req, res) => {
    const db = await getDb(); const { m, inv } = await ownInv(db, req); if (inv.status !== 'draft') throw new HttpError(409, 'Already sent.')
    await db.query(`update broker_invoices set status = 'sent', sent_at = now() where id = $1`, [inv.id])
    await notifyShipperStaff(db, inv.shipper_id, { kind: 'payment', title: `Broker invoice ${inv.number}: ${fmtUsd(Number(inv.total_usd))}`, body: `${m.b_company || m.b_name} · due ${DATE(inv.due_at)} · ${J<string[]>(inv.job_ids, []).length} job(s)`, link: `/dashboard/broker-invoices/${inv.id}`, dedupe: `binv:${inv.id}` }, ['owner', 'finance'])
    res.json({ ok: true })
  }))
  /** A polite nudge to the shipping company about a sent invoice — at most once a day. */
  r.post('/bp/invoices/:id/remind', wrap(async (req, res) => {
    const db = await getDb(); const { m, inv } = await ownInv(db, req); if (inv.status !== 'sent') throw new HttpError(409, 'Only sent, unpaid invoices can be chased.')
    if (inv.reminded_at && Date.now() - new Date(inv.reminded_at).getTime() < 20 * 3600000) throw new HttpError(429, `You sent a reminder ${new Date(inv.reminded_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} — try again tomorrow.`)
    const late = inv.due_at && DATE(inv.due_at)! < new Date().toISOString().slice(0, 10)
    await notifyShipperStaff(db, inv.shipper_id, { kind: 'payment', title: `Reminder: broker invoice ${inv.number} ${late ? 'is overdue' : 'is due'} — ${fmtUsd(Number(inv.total_usd))}`, body: `${m.b_company || m.b_name} · due ${DATE(inv.due_at)}`, link: `/dashboard/broker-invoices/${inv.id}`, dedupe: `binv-remind:${inv.id}:${new Date().toISOString().slice(0, 10)}` })
    await db.query('update broker_invoices set reminded_at = now() where id = $1', [inv.id])
    res.json({ ok: true })
  }))
  r.post('/bp/invoices/:id/paid', wrap(async (req, res) => { const db = await getDb(); const { inv } = await ownInv(db, req); if (inv.status !== 'sent') throw new HttpError(409, 'Only sent invoices can be marked paid.'); const { ref } = z.object({ ref: z.string().trim().max(80).default('') }).parse(req.body); await db.query(`update broker_invoices set status = 'paid', paid_at = now(), paid_ref = $2 where id = $1`, [inv.id, ref]); res.json({ ok: true }) }))
  r.post('/bp/invoices/:id/void', wrap(async (req, res) => { const db = await getDb(); const { inv } = await ownInv(db, req); if (inv.status === 'paid') throw new HttpError(409, 'Paid invoices can’t be voided.'); await db.query(`update broker_invoices set status = 'void' where id = $1`, [inv.id]); await db.query('update broker_charges set invoice_id = null where invoice_id = $1', [inv.id]); res.json({ ok: true }) }))
  // The shipping company can open and settle a broker invoice addressed to it.
  r.get('/customs/broker-invoices/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office only.')
    const { rows } = await db.query<Row>(`select i.*, sh.name as shipper_name, b.name as b_name, b.company as b_company, b.licence_no, b.licence_authority, b.phone, b.email, b.settings from broker_invoices i join shippers sh on sh.id = i.shipper_id join brokers b on b.id = i.broker_id where i.id = $1 and i.shipper_id = $2 and i.status <> 'draft'`, [String(req.params.id), u.shipperId])
    if (!rows[0]) throw new HttpError(404, 'Invoice not found.'); const i = rows[0]
    res.json({ invoice: invOut(i), broker: { name: i.b_name, company: i.b_company, licence: i.licence_no, authority: i.licence_authority, phone: i.phone, email: i.email, bank: J<Row>(i.settings, {}).bank ?? '' } })
  }))

  /* ---------------- analytics & reports ---------------- */
  r.get('/bp/analytics', wrap(async (req, res) => {
    const db = await getDb(); const m = await owner(db, req); const months = Math.min(24, Math.max(3, Number(req.query.months) || 6))
    const jobs = (await jobsOf(db, m.broker_id)).filter((j) => new Date(j.created_at).getTime() > Date.now() - months * 31 * 86400000)
    const keys: string[] = []; for (let i = months - 1; i >= 0; i--) { const d0 = new Date(); d0.setUTCDate(1); d0.setUTCMonth(d0.getUTCMonth() - i); keys.push(d0.toISOString().slice(0, 7)) }
    const done = jobs.filter((j) => j.status === 'done')
    const clear = (j: Row) => { const e = stepAt(j, 'done'); return e ? (new Date(e).getTime() - new Date(j.created_at).getTime()) / 86400000 : null }
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : null)
    const monthly = keys.map((k) => { const inM = jobs.filter((j) => ISO(j.created_at)!.slice(0, 7) === k); const dM = done.filter((j) => (stepAt(j, 'done') ?? '').slice(0, 7) === k); return { start: `${k}-01`, month: k, received: inM.length, cleared: dM.length, fees: r2(dM.reduce((n, j) => n + Number(j.fee_usd), 0)), avgDays: avg(dM.map(clear).filter((x): x is number => x != null)) ?? 0 } })
    // Average days spent in each step (from consecutive timeline entries).
    const stepDur = new Map<string, number[]>()
    for (const j of jobs) { const t = J<Row[]>(j.timeline, []); for (let i = 0; i < t.length - 1; i++) { const a = t[i], b = t[i + 1]; const k = a.status as string; const v = (new Date(b.at).getTime() - new Date(a.at).getTime()) / 86400000; if (v >= 0) stepDur.set(k, [...(stepDur.get(k) ?? []), v]) } }
    const group = (key: (j: Row) => string) => { const mp = new Map<string, Row[]>(); for (const j of jobs) mp.set(key(j), [...(mp.get(key(j)) ?? []), j]); return [...mp.entries()].map(([k, js]) => ({ key: k, jobs: js.length, cleared: js.filter((j) => j.status === 'done').length, avgDays: avg(js.map(clear).filter((x): x is number => x != null)), fees: r2(js.filter((j) => j.status === 'done').reduce((n, j) => n + Number(j.fee_usd), 0)) })).sort((a, b) => b.jobs - a.jobs) }
    const decided = jobs.filter((j) => J<Row[]>(j.timeline, []).some((t) => t.status === 'accepted' || t.status === 'declined'))
    const accepted = decided.filter((j) => J<Row[]>(j.timeline, []).some((t) => t.status === 'accepted'))
    const resp = decided.map((j) => { const t = J<Row[]>(j.timeline, []).find((x) => x.status === 'accepted' || x.status === 'declined'); return t ? (new Date(t.at).getTime() - new Date(j.created_at).getTime()) / 3600000 : null }).filter((x): x is number => x != null)
    const { rows: duty } = await db.query<Row>(`select duty_currency as cur, sum(duty_local) as n, count(*)::int as c from broker_jobs where broker_id = $1 and duty_local is not null and created_at > now() - ($2::int || ' months')::interval group by 1`, [m.broker_id, months])
    res.set('Cache-Control', 'no-store')
    res.json({ months: keys, monthly, kpis: { received: jobs.length, cleared: done.length, avgClearDays: avg(done.map(clear).filter((x): x is number => x != null)), acceptRate: decided.length ? Math.round((accepted.length / decided.length) * 100) : null, avgResponseHours: resp.length ? Math.round((resp.reduce((a, x) => a + x, 0) / resp.length) * 10) / 10 : null, fees: r2(done.reduce((n, j) => n + Number(j.fee_usd), 0)) },
      steps: JOB_STEPS.filter((s) => s !== 'done').map((s) => ({ step: s, label: jobStepLabels[s], avgDays: avg(stepDur.get(s) ?? []) ?? 0, n: (stepDur.get(s) ?? []).length })),
      byCargo: group((j) => cargoLabel(j.cargo as CargoType)), byShipper: group((j) => j.shipper_name), byPort: group((j) => j.port || (j.destination === 'NG' ? 'Lagos' : 'Tema')), duty: duty.map((x) => ({ currency: x.cur, amount: Number(x.n), jobs: x.c })) })
  }))
  const csv = (rows: unknown[][]) => rows.map((rr) => rr.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const range = (req: Request) => { const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10); const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10); return { from, to } }
  r.get('/bp/reports/:kind', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req); const { from, to } = range(req); const kind = String(req.params.kind).replace(/\.csv$/, ''); if (kind === 'finance' && m.role !== 'owner') throw new HttpError(403, 'Only the account owner can download invoices.')
    let out: unknown[][] = []
    if (kind === 'jobs') {
      const jobs = (await jobsOf(db, m.broker_id)).filter((j) => { const d0 = ISO(j.created_at)!.slice(0, 10); return d0 >= from && d0 <= to })
      out = [['Job', 'Shipment', 'Shipping company', 'Customer', 'Cargo', 'Port', 'Status', 'Received', 'Accepted', 'Assessed', 'Released', 'Cleared', 'Days to clear', 'Fee (USD)', 'Duty', 'Declaration ref']]
      for (const j of jobs) { const e = stepAt(j, 'done'); out.push([j.id, j.ref, j.shipper_name, j.customer, cargoLabel(j.cargo as CargoType), j.port || (j.destination === 'NG' ? 'Lagos' : 'Tema'), jobStepLabels[j.status as JobStep] ?? j.status, DATE(j.created_at), DATE(stepAt(j, 'accepted')), DATE(stepAt(j, 'assessed')), DATE(stepAt(j, 'released')), DATE(e), e ? r2((new Date(e).getTime() - new Date(j.created_at).getTime()) / 86400000) : '', Number(j.fee_usd), j.duty_local != null ? `${j.duty_currency} ${Number(j.duty_local)}` : '', j.reference]) }
    } else if (kind === 'finance') {
      const { rows } = await db.query<Row>(`select i.*, sh.name as shipper_name from broker_invoices i join shippers sh on sh.id = i.shipper_id where i.broker_id = $1 and i.created_at::date between $2::date and $3::date order by i.created_at`, [m.broker_id, from, to])
      out = [['Invoice', 'Shipping company', 'Created', 'Due', 'Status', 'Total (USD)', 'Paid on', 'Payment ref', 'Jobs']]
      for (const i of rows) out.push([i.number, i.shipper_name, DATE(i.created_at), DATE(i.due_at), i.status, Number(i.total_usd), DATE(i.paid_at), i.paid_ref, J<string[]>(i.job_ids, []).length])
    } else if (kind === 'duty') {
      const { rows } = await db.query<Row>(`${JOB_SELECT} where j.broker_id = $1 and j.duty_local is not null and j.updated_at::date between $2::date and $3::date order by j.updated_at`, [m.broker_id, from, to])
      out = [['Shipment', 'Shipping company', 'Customer', 'Cargo', 'Assessed on', 'Duty', 'Currency', 'Declaration ref']]
      for (const j of rows) out.push([j.ref, j.shipper_name, j.customer, cargoLabel(j.cargo as CargoType), DATE(stepAt(j, 'assessed')), Number(j.duty_local), j.duty_currency, j.reference])
    } else if (kind === 'disbursements') {
      const { rows } = await db.query<Row>(`select c.*, s.ref from broker_charges c join broker_jobs j on j.id = c.job_id join shipments s on s.id = j.shipment_id where c.broker_id = $1 and c.at::date between $2::date and $3::date order by c.at`, [m.broker_id, from, to])
      out = [['Date', 'Shipment', 'Type', 'Description', 'Amount', 'Currency', 'USD', 'Rebill', 'Invoice']]
      for (const c of rows) out.push([DATE(c.at), c.ref, (CHARGE_KINDS as Record<string, string>)[c.kind] ?? c.kind, c.description, Number(c.amount), c.currency, Number(c.amount_usd), c.rebill ? 'Yes' : 'No', c.invoice_id ?? ''])
    } else throw new HttpError(404, 'Unknown report.')
    res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="broker-${kind}-${from}-to-${to}.csv"`); res.send(csv(out))
  }))

  /* ---------------- profile, settings, team, notifications ---------------- */
  r.put('/bp/profile', wrap(async (req, res) => {
    const db = await getDb(); const m = await owner(db, req)
    const b = z.object({ about: z.string().trim().max(600), phone: z.string().trim().max(30), whatsapp: z.string().trim().max(30), email: z.string().trim().email().or(z.literal('')), specialties: z.array(z.string().trim().min(2).max(40)).max(8), ports: z.array(z.string().trim().min(2).max(40)).min(1).max(6), fees: z.record(z.string(), z.number().min(0).max(100000)), responseHours: z.number().int().min(1).max(168), dutyAdvance: z.boolean(), accepting: z.boolean(), licenceExpires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), settings: z.object({ termsDays: z.number().int().min(0).max(120), bank: z.string().trim().max(400), invoiceNote: z.string().trim().max(400) }) }).partial().parse(req.body)
    const { rows } = await db.query<Row>('select * from brokers where id = $1', [m.broker_id]); const cur = rows[0]
    await db.query(`update brokers set about = $2, phone = $3, whatsapp = $4, email = $5, specialties = $6, ports = $7, fees = $8, response_hours = $9, duty_advance = $10, accepting = $11, licence_expires = $12, settings = $13 where id = $1`,
      [cur.id, b.about ?? cur.about, b.phone ?? cur.phone, b.whatsapp ?? cur.whatsapp, b.email ?? cur.email, JSON.stringify(b.specialties ?? J(cur.specialties, [])), JSON.stringify(b.ports ?? J(cur.ports, [])), JSON.stringify(b.fees ?? J(cur.fees, {})), b.responseHours ?? cur.response_hours, b.dutyAdvance ?? cur.duty_advance, b.accepting ?? cur.accepting, b.licenceExpires === undefined ? cur.licence_expires : b.licenceExpires, JSON.stringify({ ...J<Row>(cur.settings, {}), ...(b.settings ?? {}) })])
    res.json({ ok: true })
  }))
  r.get('/bp/team', wrap(async (req, res) => {
    const db = await getDb(); const m = await me(db, req)
    const { rows } = await db.query<Row>(`select m.*, (select count(*)::int from broker_jobs j where j.assigned_to = m.id and j.status not in ('done','cancelled','declined')) as open_jobs, (select count(*)::int from broker_jobs j where j.assigned_to = m.id and j.status = 'done') as done_jobs from broker_members m where m.broker_id = $1 order by m.role = 'owner' desc, m.name`, [m.broker_id])
    res.set('Cache-Control', 'no-store'); res.json({ members: rows.map((x) => ({ ...memberOut(x), openJobs: x.open_jobs, doneJobs: x.done_jobs })) })
  }))
  r.post('/bp/team', wrap(async (req, res) => {
    const db = await getDb(); const m = await owner(db, req)
    const b = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().max(30).default(''), role: z.enum(['owner', 'agent']).default('agent') }).parse(req.body)
    const { rows: ex } = await db.query('select 1 from broker_members where lower(email) = $1', [b.email]); if (ex[0]) throw new HttpError(409, 'Someone with that email already has a broker account.')
    const token = randomBytes(18).toString('base64url')
    await db.query('insert into broker_members (id,broker_id,name,email,phone,role,status,invite_token) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['bmem_' + uid(), m.broker_id, b.name, b.email, b.phone, b.role, 'invited', token])
    const link = `/broker-portal/join/${token}`
    if (emailProvider().id !== 'off') await sendEmail(b.email, `${m.name} invited you to ${m.b_company || m.b_name} on Ntemtem`, emailTemplate({ name: b.name, title: 'Join your clearing team on Ntemtem', body: `${m.name} added you to the broker dashboard for ${m.b_company || m.b_name}.`, link: `${appUrl()}${link}`, cta: 'Set your password' })).catch(() => {})
    res.status(201).json({ ok: true, link })
  }))
  r.delete('/bp/team/:id', wrap(async (req, res) => { const db = await getDb(); const m = await owner(db, req); if (req.params.id === m.id) throw new HttpError(400, 'You can’t remove yourself.'); await db.query(`update broker_jobs set assigned_to = null where assigned_to = $1`, [String(req.params.id)]); await db.query(`delete from broker_members where id = $1 and broker_id = $2`, [String(req.params.id), m.broker_id]); res.json({ ok: true }) }))
  r.get('/bp/notifications', wrap(async (req, res) => { const db = await getDb(); const m = await me(db, req); const { rows } = await db.query<Row>('select * from broker_notifications where broker_id = $1 order by at desc limit 40', [m.broker_id]); res.set('Cache-Control', 'no-store'); res.json({ notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: !!n.read_at, at: ISO(n.at) })) }) }))
  r.post('/bp/notifications/read', wrap(async (req, res) => { const db = await getDb(); const m = await me(db, req); await db.query('update broker_notifications set read_at = now() where broker_id = $1 and read_at is null', [m.broker_id]); res.json({ ok: true }) }))
}

/** Demo jobs still being cleared shouldn't sit on shipments that were already delivered — move them onto shipments at the port. */
async function alignDemoJobs(db: Db) {
  const { rows: bad } = await db.query<Row>(`select j.id, j.shipper_id from broker_jobs j join shipments s on s.id = j.shipment_id where j.id like 'job_demo_%' and j.status not in ('done','declined','cancelled') and s.status in ('delivered','out_for_delivery','booked','picked_up')`)
  for (const j of bad) {
    const { rows: free } = await db.query<Row>(`select s.id, s.shipper_id from shipments s where s.destination = 'GH' and s.status in ('customs','arrived','in_transit') and s.cancelled_at is null and not exists (select 1 from broker_jobs x where x.shipment_id = s.id) order by (s.shipper_id = $1) desc, (s.status = 'customs') desc, (s.status = 'arrived') desc, s.created_at limit 1`, [j.shipper_id])
    if (!free[0]) break
    await db.query('update broker_jobs set shipment_id = $2, shipper_id = $3 where id = $1', [j.id, free[0].id, free[0].shipper_id])
  }
}

/* ---------------- demo: logins for two brokers and a realistic job history (runs once) ---------------- */
export async function seedBrokerPortalDemo(db: Db) {
  const { rows: b } = await db.query<Row>(`select id from brokers where id = 'brk_tema_1'`); if (!b[0]) return
  const { rows: done } = await db.query<Row>(`select 1 from broker_members where broker_id = 'brk_tema_1' limit 1`); if (done[0]) return alignDemoJobs(db)
  const hash = await bcrypt.hash('shipsync', 10)
  await db.query(`insert into broker_members (id,broker_id,name,email,phone,role,password_hash,status) values ('bmem_demo_1','brk_tema_1','Kwabena Osei','kwabena@oseiclearing.demo','+233 24 400 1182','owner',$1,'active'), ('bmem_demo_2','brk_tema_1','Adwoa Owusu','adwoa@oseiclearing.demo','+233 24 400 1190','agent',$1,'active'), ('bmem_demo_3','brk_lag_1','Chinedu Okafor','chinedu@okaforbrokerage.demo','+234 803 555 0871','owner',$1,'active') on conflict do nothing`, [hash])
  await db.query(`update brokers set settings = $2, licence_expires = (current_date + 140), accepting = true where id = $1`, ['brk_tema_1', JSON.stringify({ termsDays: 14, bank: 'Osei Clearing Services · GCB Bank, Tema Main · Acc 1234-5678-901 · MoMo +233 24 400 1182', invoiceNote: 'Thank you for your business. Disbursements are charged at cost with receipts.' })])
  // A spread of jobs: history for analytics, plus live ones at each step.
  const { rows: ships } = await db.query<Row>(`select s.id, s.ref, s.shipper_id, s.cargo, s.status from shipments s where s.destination = 'GH' and not exists (select 1 from broker_jobs j where j.shipment_id = s.id) order by s.created_at limit 14`)
  const steps = ['requested', 'accepted', 'documents', 'assessed', 'duty_paid', 'released', 'done'] as const
  const day = 86400000; const now = Date.now()
  const plan: { stop: (typeof steps)[number]; ageDays: number; gap: number }[] = [
    { stop: 'done', ageDays: 150, gap: 1.2 }, { stop: 'done', ageDays: 120, gap: 0.9 }, { stop: 'done', ageDays: 95, gap: 1.5 }, { stop: 'done', ageDays: 70, gap: 0.8 }, { stop: 'done', ageDays: 48, gap: 1.1 }, { stop: 'done', ageDays: 30, gap: 0.7 }, { stop: 'done', ageDays: 16, gap: 0.6 },
    { stop: 'released', ageDays: 6, gap: 1 }, { stop: 'assessed', ageDays: 5, gap: 1.6 }, { stop: 'documents', ageDays: 6, gap: 2.2 }, { stop: 'accepted', ageDays: 2, gap: 1 }, { stop: 'requested', ageDays: 0.3, gap: 0 }, { stop: 'requested', ageDays: 0.1, gap: 0 },
  ]
  const fees: Record<string, number> = { barrels: 55, boxes: 55, pallets: 110, vehicle: 260, container20: 380, container40: 520, commercial: 220 }
  const names = ['Kwabena Osei (Osei Clearing Services)', 'Adwoa Owusu (Osei Clearing Services)']
  for (let i = 0; i < Math.min(plan.length, ships.length); i++) {
    const p = plan[i], s = ships[i]; const t0 = now - p.ageDays * day; const upto = steps.indexOf(p.stop)
    const tl = [{ at: new Date(t0).toISOString(), status: 'requested', note: '', by: 'Nana Boateng' }]
    for (let k = 1; k <= upto; k++) tl.push({ at: new Date(t0 + k * p.gap * day * (k === 1 ? 0.15 : 1)).toISOString(), status: steps[k], note: k === 3 ? 'ICUMS assessment received.' : '', by: names[k % 2] })
    const duty = upto >= 3 ? Math.round(1800 + ((i * 1371) % 5200)) : null; const id = 'job_demo_' + (i + 1)
    await db.query(`insert into broker_jobs (id,shipment_id,broker_id,shipper_id,booked_by,booked_by_role,status,fee_usd,duty_local,duty_currency,reference,notes,token,timeline,created_at,updated_at,assigned_to,checklist,port) values ($1,$2,'brk_tema_1',$3,'Nana Boateng','office',$4,$5,$6,'GHS',$7,$8,$9,$10,$11,$12,$13,$14,'Tema') on conflict do nothing`,
      [id, s.id, s.shipper_id, p.stop, fees[s.cargo] ?? 60, duty, upto >= 2 ? `ICUMS-40${2600 + i}-26` : '', i === 11 ? 'Customer wants delivery to Kumasi after release.' : '', randomBytes(12).toString('base64url'), JSON.stringify(tl), new Date(t0).toISOString(), tl[tl.length - 1].at, upto >= 1 ? (i % 2 ? 'bmem_demo_2' : 'bmem_demo_1') : null, JSON.stringify(Object.fromEntries(['bl', 'invoice', 'idf', 'permits', 'declaration', 'exam', 'receipt', 'release', 'gatepass'].slice(0, Math.min(9, upto * 2)).map((k) => [k, true]))) ])
    if (upto >= 4) await db.query(`insert into broker_charges (id,job_id,broker_id,kind,description,amount,currency,amount_usd,rebill,created_by,at) values ($1,$2,'brk_tema_1','port','MPS terminal handling',$3,'GHS',$4,true,'Adwoa Owusu',$5), ($6,$2,'brk_tema_1','transport','Truck to Spintex yard',$7,'GHS',$8,true,'Kwabena Osei',$5)`, ['bc_demo_a' + i, id, 650 + i * 20, toUsd(650 + i * 20, 'GHS'), new Date(t0 + 3 * day).toISOString(), 'bc_demo_b' + i, 400, toUsd(400, 'GHS')])
  }
  // Invoices: older jobs paid, a recent one sent (one overdue), the latest finished job left unbilled.
  const { rows: jobs } = await db.query<Row>(`select j.*, s.ref from broker_jobs j join shipments s on s.id = j.shipment_id where j.broker_id = 'brk_tema_1' and j.status = 'done' order by j.created_at`)
  const groups = [jobs.slice(0, 2), jobs.slice(2, 4), jobs.slice(4, 5), jobs.slice(5, 6)]
  let n = 0
  for (const g of groups) {
    if (!g.length || new Set(g.map((x) => x.shipper_id)).size > 1) continue; n++
    const { rows: ch } = await db.query<Row>(`select * from broker_charges where job_id = any($1::text[])`, [g.map((x) => x.id)])
    const lines = g.flatMap((j) => [{ jobId: j.id, ref: j.ref, label: `Clearance fee — ${j.ref}`, amountUsd: Number(j.fee_usd) }, ...ch.filter((c) => c.job_id === j.id).map((c) => ({ jobId: j.id, ref: j.ref, chargeId: c.id, label: `${(CHARGE_KINDS as Record<string, string>)[c.kind]} — ${c.description} (${j.ref}) · GHS ${Number(c.amount)}`, amountUsd: Number(c.amount_usd) }))])
    const created = new Date(new Date(g[g.length - 1].updated_at).getTime() + day); const status = n <= 2 ? 'paid' : 'sent'; const due = new Date(created.getTime() + (n === 3 ? -2 : 14) * day)
    const id = 'binv_demo_' + n
    await db.query(`insert into broker_invoices (id,broker_id,shipper_id,number,lines,job_ids,total_usd,status,due_at,sent_at,paid_at,paid_ref,created_by,created_at) values ($1,'brk_tema_1',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Kwabena Osei',$9) on conflict do nothing`,
      [id, g[0].shipper_id, `BRK-2026-${String(n).padStart(4, '0')}`, JSON.stringify(lines), JSON.stringify(g.map((x) => x.id)), r2(lines.reduce((a, l) => a + l.amountUsd, 0)), status, due.toISOString().slice(0, 10), created.toISOString(), status === 'paid' ? new Date(created.getTime() + 9 * day).toISOString() : null, status === 'paid' ? `GCB-TRF-${8800 + n}` : ''])
    await db.query('update broker_charges set invoice_id = $2 where job_id = any($1::text[])', [g.map((x) => x.id), id])
  }
  // A conversation and notifications.
  const live = (await db.query<Row>(`select j.id, s.ref from broker_jobs j join shipments s on s.id = j.shipment_id where j.broker_id = 'brk_tema_1' and j.status in ('documents','assessed') order by j.created_at limit 2`)).rows
  if (live[0]) await db.query(`insert into broker_job_messages (id,job_id,from_side,from_name,body,read_by_broker,read_by_office,at) values ($1,$2,'office','Nana Boateng · Gold Coast Freight','Hi Kwabena — the commercial invoice is attached to the shipment now. Can you confirm the HS code for the generators?',true,true,now() - interval '30 hours'), ($3,$2,'broker','Kwabena Osei · Osei Clearing Services','Got it, thanks. Generators go under 8502.11 — duty 10% plus levies. Lodging today.',true,true,now() - interval '28 hours'), ($4,$2,'office','Nana Boateng · Gold Coast Freight','Great. The customer asks if it can go out on Thursday.',false,true,now() - interval '3 hours')`, ['bm_demo_1', live[0].id, 'bm_demo_2', 'bm_demo_3'])
  const reqs = (await db.query<Row>(`select j.id, s.ref from broker_jobs j join shipments s on s.id = j.shipment_id where j.broker_id = 'brk_tema_1' and j.status = 'requested'`)).rows
  for (const r0 of reqs) await db.query('insert into broker_notifications (id,broker_id,title,body,link) values ($1,$2,$3,$4,$5)', ['bn_' + uid(), 'brk_tema_1', `New clearance request: ${r0.ref}`, 'Gold Coast Freight · accept or decline from the job page', `/broker-portal/jobs/${r0.id}`])
  await alignDemoJobs(db)
}
