import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { isDriverRole } from '../src/lib/roles'
import { notify, notifyShipperStaff } from './notify'
import { FX } from './driverOps'
import { TRAINING, CONTRACT_VERSION } from '../src/lib/driverHr'

/* Driver HR, payroll, time and analytics. Office: owners, dispatchers, finance (pay: owner/finance; private notes: owner). */
type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) : (v as T))
const r2 = (n: number) => Math.round(n * 100) / 100
const conv = (amount: number, from: string, to: string) => (from === to ? amount : r2((amount / (FX[from] ?? 1)) * (FX[to] ?? 1)))
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
const DRIVER_ROLES = `('pickup_driver','delivery_driver','driver')`
const DEDUCT_KINDS = ['advance', 'deduction', 'shortfall', 'damage', 'fuel_card']
const EXPIRY_KINDS = ['licence', 'medical', 'insurance', 'permit'] as const
export const EXPIRY_LABEL: Record<string, string> = { licence: 'Driving licence', medical: 'Medical card', insurance: 'Insurance', permit: 'Work / DOT / DVLA permit' }

export interface HrSettings {
  periodDays: 7 | 14; periodAnchor: string; overtimeAfter: number; overtimeRate: number; weekendRate: number; holidayRate: number; holidays: string[]
  warnShiftHours: number; maxShiftHours: number; bonusOnTime: { pct: number; amount: number }; bonusNoDamage: number
  showLeaderboard: boolean; threshold1099: number; leaveDays: number; trainingVideos: { title: string; url: string }[]
  payDayOffset: number; tzOrigin: string; tzDestination: string; clockInReminder: boolean
}
export const HR_DEFAULTS: HrSettings = { periodDays: 7, periodAnchor: '2026-01-05', overtimeAfter: 40, overtimeRate: 1.5, weekendRate: 1, holidayRate: 1.5, holidays: [], warnShiftHours: 10, maxShiftHours: 12, bonusOnTime: { pct: 95, amount: 0 }, bonusNoDamage: 0, showLeaderboard: false, threshold1099: 2000, leaveDays: 15, trainingVideos: [], payDayOffset: 3, tzOrigin: 'America/Chicago', tzDestination: 'Africa/Accra', clockInReminder: true }
export async function hrSettings(db: Db, shipperId: string): Promise<HrSettings> {
  const { rows } = await db.query<Row>('select settings from driver_hr_settings where shipper_id = $1', [shipperId])
  return { ...HR_DEFAULTS, ...J<Partial<HrSettings>>(rows[0]?.settings, {}) }
}
export const periodFor = (s: HrSettings, day: string) => { const n = Math.floor(daysBetween(s.periodAnchor, day) / s.periodDays); const start = addDays(s.periodAnchor, n * s.periodDays); return { start, end: addDays(start, s.periodDays - 1) } }

/** Why a driver can't be put on a run on `day` (expired papers, offboarded) — null when fine. Used by the run planner. */
export async function driverBlock(db: Db, staffId: string, day = today()): Promise<string | null> {
  const { rows } = await db.query<Row>('select p.*, s.name from driver_profiles p join staff s on s.id = p.staff_id where p.staff_id = $1', [staffId]); const p = rows[0]
  if (!p) return null
  if (p.status === 'offboarded') return `${p.name} has left the company.`
  const exp = J<Record<string, string>>(p.expiries, {})
  for (const k of EXPIRY_KINDS) if (exp[k] && exp[k] < day) return `${p.name}’s ${EXPIRY_LABEL[k].toLowerCase()} expired on ${exp[k]} — upload the new one under Drivers → People first.`
  return null
}
/** Who is away on a day (approved leave or rota "off"). */
export async function availability(db: Db, shipperId: string, day: string) {
  const out: Record<string, string> = {}
  const { rows: lv } = await db.query<Row>(`select staff_id, kind from leave_requests where shipper_id = $1 and status = 'approved' and kind <> 'swap' and $2::date between start_date and end_date`, [shipperId, day])
  for (const x of lv) out[x.staff_id] = x.kind === 'sick' ? 'off sick' : 'on leave'
  const { rows: ro } = await db.query<Row>(`select staff_id, kind from rota where shipper_id = $1 and day = $2::date and kind <> 'work'`, [shipperId, day])
  for (const x of ro) out[x.staff_id] ??= x.kind === 'leave' ? 'on leave' : 'day off'
  const { rows: st } = await db.query<Row>(`select id from staff where shipper_id = $1 and role in ${DRIVER_ROLES}`, [shipperId])
  for (const x of st) { const b = await driverBlock(db, x.id, day); if (b) out[x.id] = 'papers expired' }
  return out
}

/* ---------------- payslip maths ---------------- */
interface Line { label: string; kind: 'earning' | 'bonus' | 'reimbursement' | 'deduction'; qty?: number; rate?: number; amount: number; ref?: string }
export async function computeSlip(db: Db, staff: Row, start: string, end: string, s: HrSettings) {
  const pay = J<{ perStop?: number; perRun?: number; perHour?: number; currency?: string }>(staff.pay, {}); const cur = pay.currency ?? 'USD'
  const holidays = new Set(s.holidays); const weekend = (d: string) => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())
  // Everything done up to the end of the period that no approved payslip has covered yet (so closing a period early loses nothing).
  // Work from before the company's first pay period is never paid through the app.
  const { rows: fl } = await db.query<Row>('select min(start_date) as d from pay_periods where shipper_id = $1', [staff.shipper_id]); const floor = DATE(fl[0]?.d) ?? start
  const { rows: stops } = await db.query<Row>(`select st.id, st.done_at, st.eta_to, st.tries, r.id as run_id, r.paid_slip as run_paid from run_stops st join runs r on r.id = st.run_id where r.driver_id = $1 and st.status = 'done' and st.paid_slip is null and st.done_at::date between $2::date and $3::date`, [staff.id, floor < start ? floor : start, end])
  const { rows: shifts } = await db.query<Row>(`select * from shifts where staff_id = $1 and paid_slip is null and start_at::date between $2::date and $3::date and end_at is not null`, [staff.id, floor < start ? floor : start, end])
  const lines: Line[] = []
  const nStops = stops.length; const runIds = [...new Set(stops.filter((x) => !x.run_paid).map((x) => x.run_id))]; const runs = runIds.length
  const day = (v: unknown) => DATE(v)!
  if (pay.perStop) {
    lines.push({ label: 'Stops completed', kind: 'earning', qty: nStops, rate: pay.perStop, amount: r2(nStops * pay.perStop) })
    const hol = stops.filter((x) => holidays.has(day(x.done_at))).length; const wk = stops.filter((x) => !holidays.has(day(x.done_at)) && weekend(day(x.done_at))).length
    if (hol && s.holidayRate > 1) lines.push({ label: 'Public holiday stops (extra)', kind: 'earning', qty: hol, rate: r2(pay.perStop * (s.holidayRate - 1)), amount: r2(hol * pay.perStop * (s.holidayRate - 1)) })
    if (wk && s.weekendRate > 1) lines.push({ label: 'Weekend stops (extra)', kind: 'earning', qty: wk, rate: r2(pay.perStop * (s.weekendRate - 1)), amount: r2(wk * pay.perStop * (s.weekendRate - 1)) })
  }
  if (pay.perRun) lines.push({ label: 'Runs', kind: 'earning', qty: runs, rate: pay.perRun, amount: r2(runs * pay.perRun) })
  // Hours: overtime is counted per calendar week (Mon–Sun) above the weekly threshold.
  const hoursOf = (x: Row) => { const br = J<{ start: string; end?: string }[]>(x.breaks, []); const brMs = br.reduce((n, b) => n + ((b.end ? new Date(b.end).getTime() : new Date(x.end_at).getTime()) - new Date(b.start).getTime()), 0); return Math.max(0, (new Date(x.end_at).getTime() - new Date(x.start_at).getTime() - brMs) / 3600000) }
  const byWeek = new Map<string, number>(); let holHours = 0, wkHours = 0, total = 0
  for (const x of shifts) { const h = hoursOf(x); total += h; const d = day(x.start_at); const dt = new Date(d + 'T00:00:00Z'); const monday = addDays(d, -((dt.getUTCDay() + 6) % 7)); byWeek.set(monday, (byWeek.get(monday) ?? 0) + h); if (holidays.has(d)) holHours += h; else if (weekend(d)) wkHours += h }
  const ot = [...byWeek.values()].reduce((n, h) => n + Math.max(0, h - s.overtimeAfter), 0)
  if (pay.perHour) {
    lines.push({ label: 'Hours', kind: 'earning', qty: r2(total - ot), rate: pay.perHour, amount: r2((total - ot) * pay.perHour) })
    if (ot > 0) lines.push({ label: `Overtime (over ${s.overtimeAfter} h a week)`, kind: 'earning', qty: r2(ot), rate: r2(pay.perHour * s.overtimeRate), amount: r2(ot * pay.perHour * s.overtimeRate) })
    if (holHours && s.holidayRate > 1) lines.push({ label: 'Public holiday hours (extra)', kind: 'earning', qty: r2(holHours), rate: r2(pay.perHour * (s.holidayRate - 1)), amount: r2(holHours * pay.perHour * (s.holidayRate - 1)) })
    if (wkHours && s.weekendRate > 1) lines.push({ label: 'Weekend hours (extra)', kind: 'earning', qty: r2(wkHours), rate: r2(pay.perHour * (s.weekendRate - 1)), amount: r2(wkHours * pay.perHour * (s.weekendRate - 1)) })
  }
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].kind === 'earning' && !lines[i].qty) lines.splice(i, 1)
  // Bonuses by rule.
  const timed = stops.filter((x) => x.eta_to && x.done_at); const onTime = timed.filter((x) => new Date(x.done_at).toTimeString().slice(0, 5) <= String(x.eta_to)).length
  const onTimePct = timed.length ? Math.round((onTime / timed.length) * 100) : null
  if (s.bonusOnTime.amount > 0 && timed.length >= 5 && onTimePct! >= s.bonusOnTime.pct) lines.push({ label: `On-time bonus (${onTimePct}% on time)`, kind: 'bonus', amount: conv(s.bonusOnTime.amount, 'USD', cur) })
  const { rows: inc } = await db.query<{ n: number }>(`select count(*)::int as n from incidents where staff_id = $1 and kind in ('damage','accident') and at::date between $2::date and $3::date`, [staff.id, start, end])
  if (s.bonusNoDamage > 0 && nStops > 0 && inc[0].n === 0) lines.push({ label: 'No-damage bonus', kind: 'bonus', amount: conv(s.bonusNoDamage, 'USD', cur) })
  const { rows: adj } = await db.query<Row>(`select * from pay_adjustments where staff_id = $1 and remaining > 0 order by at`, [staff.id])
  for (const a of adj.filter((x) => x.kind === 'bonus')) lines.push({ label: `Bonus${a.note ? ` — ${a.note}` : ''}`, kind: 'bonus', amount: conv(Number(a.remaining), a.currency, cur), ref: a.id })
  // Expenses the driver paid for and the office approved.
  const { rows: ex } = await db.query<Row>(`select * from driver_expenses where staff_id = $1 and status = 'approved' and payslip_id is null and paid_by = 'driver' order by at`, [staff.id])
  for (const e of ex) lines.push({ label: `Expense: ${e.kind}${e.note ? ` — ${e.note}` : ''}`, kind: 'reimbursement', amount: conv(Number(e.amount), e.currency, cur), ref: e.id })
  const gross = r2(lines.filter((l) => l.kind === 'earning' || l.kind === 'bonus').reduce((n, l) => n + l.amount, 0))
  const reimbursed = r2(lines.filter((l) => l.kind === 'reimbursement').reduce((n, l) => n + l.amount, 0))
  // Deductions: one instalment each, never taking the payslip below zero.
  let room = gross + reimbursed; let deducted = 0
  for (const a of adj.filter((x) => DEDUCT_KINDS.includes(x.kind))) {
    const per = Math.min(Number(a.remaining), r2(Number(a.amount) / Math.max(1, Number(a.installments))))
    const amt = Math.min(conv(per, a.currency, cur), room); if (amt <= 0) continue
    room -= amt; deducted += amt
    lines.push({ label: `${{ advance: 'Advance repayment', deduction: 'Deduction', shortfall: 'Cash shortfall', damage: 'Damage', fuel_card: 'Fuel card' }[a.kind as string] ?? 'Deduction'}${a.note ? ` — ${a.note}` : ''}`, kind: 'deduction', amount: -r2(amt), ref: a.id })
  }
  const stats = { stops: nStops, runs, hours: r2(total), overtime: r2(ot), onTimePct, incidents: inc[0].n }
  return { lines, gross, reimbursed, deducted: r2(deducted), net: r2(gross + reimbursed - deducted), currency: cur, stats, refs: { stops: stops.map((x) => x.id), shifts: shifts.map((x) => x.id), runs: runIds } }
}
const slipOut = (x: Row) => ({ id: x.id, periodId: x.period_id, staffId: x.staff_id, name: x.name ?? undefined, start: DATE(x.start_date), end: DATE(x.end_date), lines: J<Line[]>(x.lines, []), gross: Number(x.gross), reimbursed: Number(x.reimbursed), deducted: Number(x.deducted), net: Number(x.net), currency: x.currency, status: x.status as 'draft' | 'approved' | 'paid', approvedBy: x.approved_by, approvedAt: ISO(x.approved_at), paidAt: ISO(x.paid_at), paidMethod: x.paid_method, paidRef: x.paid_ref, stats: J<Row>(x.stats, {}), company: x.company ?? undefined })


/** Leaderboard over the last 30 days: on time 40%, first try 30%, rating 20%, no damage 10 points. Same numbers for the office and the driver. */
async function leaderboard(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>(`select r.driver_id, s.name,
      count(*) filter (where st.status = 'done')::int as done,
      count(*) filter (where st.status = 'done' and st.eta_to <> '' and st.done_at is not null)::int as timed,
      count(*) filter (where st.status = 'done' and st.eta_to <> '' and to_char(st.done_at, 'HH24:MI') <= st.eta_to)::int as ontime,
      count(*) filter (where st.status = 'done' and coalesce(st.tries,0) = 0)::int as first,
      avg(st.rating) filter (where st.rating is not null) as rating,
      (select count(*)::int from incidents i where i.staff_id = r.driver_id and i.kind in ('damage','accident','theft') and i.at > now() - interval '30 days') as inc
    from run_stops st join runs r on r.id = st.run_id join staff s on s.id = r.driver_id where r.shipper_id = $1 and r.run_date >= current_date - 30 group by r.driver_id, s.name`, [shipperId])
  return rows.filter((x) => x.done >= 3).map((x) => ({ staffId: x.driver_id as string, name: x.name as string, score: Math.round((x.timed ? (x.ontime / x.timed) * 100 : 80) * 0.4 + (x.done ? (x.first / x.done) * 100 : 80) * 0.3 + ((x.rating != null ? Number(x.rating) : 4) / 5) * 100 * 0.2 + (x.inc ? 0 : 10)) })).sort((a, b) => b.score - a.score)
}

/* ---------------- sweeps: papers expiring, long shifts, missed clock-outs ---------------- */
export async function sweepDriverHr(db: Db) {
  await import('./driverHr2').then((m) => m.sweepClockIn(db)).catch((e) => console.error('[driver-hr] clock-in', e))
  const { rows: profs } = await db.query<Row>(`select p.*, s.name, s.user_id, s.shipper_id from driver_profiles p join staff s on s.id = p.staff_id where p.status <> 'offboarded'`)
  const t = today()
  for (const p of profs) {
    const exp = J<Record<string, string>>(p.expiries, {})
    for (const k of EXPIRY_KINDS) {
      const d = exp[k]; if (!d) continue; const left = daysBetween(t, d)
      const step = left < 0 ? 'expired' : left <= 7 ? '7' : left <= 30 ? '30' : null; if (!step) continue
      const title = step === 'expired' ? `${p.name}’s ${EXPIRY_LABEL[k].toLowerCase()} has expired` : `${p.name}’s ${EXPIRY_LABEL[k].toLowerCase()} expires ${d}`
      await notifyShipperStaff(db, p.shipper_id, { kind: 'system', title, body: step === 'expired' ? 'They can’t be put on runs until a new one is uploaded.' : `${left} days left. Ask for the renewed one.`, link: `/dashboard/drivers?tab=people&p=${p.staff_id}`, dedupe: `exp:${p.staff_id}:${k}:${d}:${step}` }, ['owner', 'dispatcher'])
      if (p.user_id) await notify(db, { userId: p.user_id, kind: 'system', title: step === 'expired' ? `Your ${EXPIRY_LABEL[k].toLowerCase()} has expired` : `Your ${EXPIRY_LABEL[k].toLowerCase()} expires ${d}`, body: 'Upload the new one under My file so you can keep driving.', link: `/dashboard/runs/me?renew=${k}`, dedupe: `exp:${p.staff_id}:${k}:${d}:${step}:me` })
    }
  }
  const { rows: open } = await db.query<Row>(`select sh.*, s.name, s.user_id from shifts sh join staff s on s.id = sh.staff_id where sh.end_at is null`)
  for (const x of open) {
    const st = await hrSettings(db, x.shipper_id); const h = (Date.now() - new Date(x.start_at).getTime()) / 3600000
    const level = h >= st.maxShiftHours + 2 ? 'missed' : h >= st.maxShiftHours ? 'max' : h >= st.warnShiftHours ? 'warn' : null; if (!level) continue
    const flags = J<Record<string, boolean>>(x.flags, {}); if (flags[level]) continue
    await db.query('update shifts set flags = $2 where id = $1', [x.id, JSON.stringify({ ...flags, [level]: true })])
    if (x.user_id) await notify(db, { userId: x.user_id, kind: 'system', title: level === 'missed' ? 'Did you forget to clock out?' : `You’ve been on shift ${Math.floor(h)} hours`, body: level === 'missed' ? 'Clock out now, or tell the office what time you finished.' : level === 'max' ? 'That’s the longest shift allowed — finish up and clock out.' : 'Take a break if you haven’t.', link: '/dashboard/runs', dedupe: `shift:${x.id}:${level}` })
    if (level !== 'warn') await notifyShipperStaff(db, x.shipper_id, { kind: 'system', title: level === 'missed' ? `${x.name} may have forgotten to clock out` : `${x.name} has been on shift ${Math.floor(h)} hours`, body: 'Fix the clock-out time under Drivers → Hours if needed.', link: '/dashboard/drivers?tab=time', dedupe: `shift:${x.id}:${level}:o` }, ['owner', 'dispatcher'])
  }
}
export function startDriverHrSweeps(getDb: () => Promise<Db>) {
  const run = () => getDb().then(sweepDriverHr).catch((e) => console.error('[driver-hr] sweep', e))
  setTimeout(run, 20_000); setInterval(run, 30 * 60_000)
}

/* ---------------- routes ---------------- */
const zDataUrl = z.string().max(4_000_000).regex(/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/)
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export function mountDriverHr(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staffOf = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'For shipping company staff.')
    const { rows } = await db.query<Row>('select * from staff where user_id = $1 and shipper_id = $2', [u.id, u.shipperId])
    const me = rows[0] ?? { id: 'owner:' + u.id, name: u.name, role: u.staffRole ?? 'owner' }
    return { u, me, shipperId: u.shipperId, role: String(me.role), driver: isDriverRole(me.role) }
  }
  const office = async (db: Db, req: Request, roles = ['owner', 'dispatcher', 'finance']) => { const x = await staffOf(db, req); if (x.driver || !roles.includes(x.role)) throw new HttpError(403, roles.length === 1 ? 'Only the owner can do this.' : `This needs the ${roles.join(' / ')} role.`); return x }
  const driverOf = async (db: Db, shipperId: string, staffId: string) => { const { rows } = await db.query<Row>(`select * from staff where id = $1 and shipper_id = $2`, [staffId, shipperId]); if (!rows[0]) throw new HttpError(404, 'Driver not found.'); return rows[0] }
  const profileOf = async (db: Db, staff: Row) => {
    const { rows } = await db.query<Row>('select * from driver_profiles where staff_id = $1', [staff.id])
    if (rows[0]) return rows[0]
    const st = await hrSettings(db, staff.shipper_id)
    await db.query(`insert into driver_profiles (staff_id, shipper_id, country, start_date, leave_days, status) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`, [staff.id, staff.shipper_id, staff.base === 'destination' ? 'GH' : 'US', DATE(staff.created_at), st.leaveDays, staff.status === 'inactive' ? 'offboarded' : 'onboarding'])
    return (await db.query<Row>('select * from driver_profiles where staff_id = $1', [staff.id])).rows[0]
  }
  const leaveUsed = async (db: Db, staffId: string) => {
    const y = today().slice(0, 4)
    const { rows } = await db.query<Row>(`select start_date, end_date from leave_requests where staff_id = $1 and status = 'approved' and kind = 'vacation' and extract(year from start_date) = $2`, [staffId, Number(y)])
    return rows.reduce((n, x) => n + daysBetween(DATE(x.start_date)!, DATE(x.end_date)!) + 1, 0)
  }
  const checklist = async (db: Db, p: Row) => {
    const { rows: docs } = await db.query<Row>(`select kind from driver_docs where staff_id = $1 and status <> 'rejected'`, [p.staff_id])
    const has = (k: string) => docs.some((x) => x.kind === k)
    const em = J<Row>(p.emergency, {}); const po = J<Row>(p.payout, {}); const tr = J<Row | null>(p.training, null)
    return [
      { key: 'licence', label: 'Driving licence uploaded', done: has('licence') },
      { key: 'id', label: 'ID uploaded', done: has('id') },
      { key: 'emergency', label: 'Emergency contact', done: !!(em.name && em.phone) },
      { key: 'payout', label: 'How you get paid', done: !!(po.method && (po.momo || po.zelle || po.bankLast4 || po.method === 'cash')) },
      { key: 'contract', label: 'Agreement signed', done: !!p.contract_signed_at },
      { key: 'training', label: 'Training quiz passed', done: !!tr?.passedAt },
    ]
  }
  const profileOut = async (db: Db, p: Row, staff: Row, full: boolean) => {
    const { rows: docs } = await db.query<Row>(`select id, kind, title, mime, expires_on, uploaded_by, created_at, status, review_note, reviewed_by, side from driver_docs where staff_id = $1 and kind <> 'photo' order by created_at desc`, [staff.id])
    const used = await leaveUsed(db, staff.id)
    const exp = J<Record<string, string>>(p.expiries, {})
    return {
      staffId: staff.id, name: staff.name, role: staff.role, phone: staff.phone, email: staff.email, staffStatus: staff.status,
      employment: p.employment, country: p.country, startDate: DATE(p.start_date), status: p.status, trialUntil: DATE(p.trial_until),
      licence: J<Row>(p.licence, {}), emergency: J<Row>(p.emergency, {}), payout: J<Row>(p.payout, {}), expiries: exp,
      contractSignedAt: ISO(p.contract_signed_at), contractName: p.contract_name, training: J<Row | null>(p.training, null), offboarding: J<Row | null>(p.offboarding, null),
      leave: { allowance: Number(p.leave_days), used, left: Number(p.leave_days) - used },
      checklist: await checklist(db, p), docs: docs.map((x) => ({ id: x.id, kind: x.kind, title: x.title, mime: x.mime, expiresOn: DATE(x.expires_on), uploadedBy: x.uploaded_by, at: ISO(x.created_at), status: x.status as 'pending' | 'checked' | 'rejected', reviewNote: x.review_note, reviewedBy: x.reviewed_by, side: x.side })),
      expiringSoon: EXPIRY_KINDS.filter((k) => exp[k] && daysBetween(today(), exp[k]) <= 30).map((k) => ({ kind: k, label: EXPIRY_LABEL[k], date: exp[k], expired: exp[k] < today() })),
      pay: J<Row>(staff.pay, {}), ...(full ? {} : {}),
    }
  }

  /* ---- settings ---- */
  r.get('/drivers/hr/settings', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await staffOf(db, req); res.json({ settings: await hrSettings(db, shipperId) }) }))
  r.put('/drivers/hr/settings', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance'])
    const b = z.object({ periodDays: z.union([z.literal(7), z.literal(14)]), periodAnchor: zDate, overtimeAfter: z.number().min(0).max(80), overtimeRate: z.number().min(1).max(3), weekendRate: z.number().min(1).max(3), holidayRate: z.number().min(1).max(3), holidays: z.array(zDate).max(40), warnShiftHours: z.number().min(4).max(24), maxShiftHours: z.number().min(4).max(24), bonusOnTime: z.object({ pct: z.number().min(50).max(100), amount: z.number().min(0).max(10000) }), bonusNoDamage: z.number().min(0).max(10000), showLeaderboard: z.boolean(), threshold1099: z.number().min(0).max(100000), leaveDays: z.number().int().min(0).max(60), trainingVideos: z.array(z.object({ title: z.string().trim().min(1).max(80), url: z.string().url().max(400) })).max(10), payDayOffset: z.number().int().min(0).max(30), tzOrigin: z.string().max(60), tzDestination: z.string().max(60), clockInReminder: z.boolean() }).partial().parse(req.body)
    const next = { ...(await hrSettings(db, shipperId)), ...b }
    await db.query(`insert into driver_hr_settings (shipper_id, settings) values ($1,$2) on conflict (shipper_id) do update set settings = excluded.settings`, [shipperId, JSON.stringify(next)])
    res.json({ settings: next })
  }))

  /* ---- people (HR file) ---- */
  r.get('/drivers/people', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req)
    const { rows } = await db.query<Row>(`select * from staff where shipper_id = $1 and role in ${DRIVER_ROLES} order by status = 'inactive', name`, [shipperId])
    const out = []
    for (const s of rows) { const p = await profileOf(db, s); const o = await profileOut(db, p, s, false); const { rows: owed } = await db.query<Row>(`select coalesce(sum(net),0) as n from payslips where staff_id = $1 and status = 'approved'`, [s.id]); out.push({ ...o, owed: Number(owed[0].n), docs: undefined, docCount: o.docs.length }) }
    res.set('Cache-Control', 'no-store'); res.json({ people: out })
  }))
  r.get('/drivers/people/:staffId', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, role } = await office(db, req)
    const s = await driverOf(db, shipperId, String(req.params.staffId)); const p = await profileOf(db, s)
    const notes = role === 'owner' ? (await db.query<Row>('select * from driver_notes where staff_id = $1 order by at desc', [s.id])).rows.map((n) => ({ id: n.id, kind: n.kind, body: n.body, by: n.by_name, at: ISO(n.at) })) : null
    const { rows: adj } = await db.query<Row>('select * from pay_adjustments where staff_id = $1 order by at desc limit 50', [s.id])
    res.set('Cache-Control', 'no-store'); res.json({ person: await profileOut(db, p, s, true), notes, adjustments: adj.map((a) => ({ id: a.id, kind: a.kind, amount: Number(a.amount), currency: a.currency, note: a.note, installments: Number(a.installments), remaining: Number(a.remaining), applied: J<Row[]>(a.applied, []).length, by: a.created_by, at: ISO(a.at) })) })
  }))
  const zProfile = z.object({
    employment: z.enum(['employee', 'contractor']), country: z.enum(['US', 'GH', 'NG', 'CI', 'SN', 'TG', 'BJ', 'GB', 'OTHER']), startDate: zDate.nullable(), trialUntil: zDate.nullable(), leaveDays: z.number().int().min(0).max(60),
    licence: z.object({ class: z.string().trim().max(20).default(''), last4: z.string().trim().max(4).default(''), state: z.string().trim().max(40).default('') }),
    emergency: z.object({ name: z.string().trim().max(80).default(''), phone: z.string().trim().max(30).default(''), relation: z.string().trim().max(40).default('') }),
    payout: z.object({ method: z.enum(['momo', 'bank', 'zelle', 'cash', '']).default(''), momo: z.string().trim().max(30).default(''), zelle: z.string().trim().max(80).default(''), bankName: z.string().trim().max(60).default(''), bankLast4: z.string().trim().regex(/^\d{0,4}$/).default('') }),
    expiries: z.object({ licence: zDate.nullable().optional(), medical: zDate.nullable().optional(), insurance: zDate.nullable().optional(), permit: zDate.nullable().optional() }),
    status: z.enum(['onboarding', 'active', 'offboarded']),
  }).partial()
  const saveProfile = async (db: Db, staff: Row, b: z.infer<typeof zProfile>) => {
    const p = await profileOf(db, staff)
    const exp: Record<string, string | null | undefined> = { ...J<Record<string, string | null>>(p.expiries, {}), ...(b.expiries ?? {}) }; for (const k of Object.keys(exp)) if (!exp[k]) delete exp[k]
    await db.query(`update driver_profiles set employment = coalesce($2, employment), country = coalesce($3, country), start_date = case when $4::text = '__keep' then start_date else $4::date end, trial_until = case when $5::text = '__keep' then trial_until else $5::date end, leave_days = coalesce($6, leave_days), licence = coalesce($7, licence), emergency = coalesce($8, emergency), payout = coalesce($9, payout), expiries = $10, status = coalesce($11, status), updated_at = now() where staff_id = $1`,
      [staff.id, b.employment ?? null, b.country ?? null, b.startDate === undefined ? '__keep' : b.startDate, b.trialUntil === undefined ? '__keep' : b.trialUntil, b.leaveDays ?? null, b.licence ? JSON.stringify(b.licence) : null, b.emergency ? JSON.stringify(b.emergency) : null, b.payout ? JSON.stringify(b.payout) : null, JSON.stringify(exp), b.status ?? null])
    return (await db.query<Row>('select * from driver_profiles where staff_id = $1', [staff.id])).rows[0]
  }
  r.put('/drivers/people/:staffId', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'dispatcher', 'finance'])
    const s = await driverOf(db, shipperId, String(req.params.staffId)); const p = await saveProfile(db, s, zProfile.parse(req.body))
    res.json({ person: await profileOut(db, p, s, true) })
  }))
  /** The driver's own file: contact, payout and their papers. */
  r.get('/drivers/me/profile', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const s = await driverOf(db, shipperId, me.id); const p = await profileOf(db, s); res.set('Cache-Control', 'no-store'); res.json({ person: await profileOut(db, p, s, true), settings: { trainingVideos: (await hrSettings(db, shipperId)).trainingVideos }, company: (await db.query<Row>('select name from shippers where id = $1', [shipperId])).rows[0]?.name ?? '' })
  }))
  r.put('/drivers/me/profile', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const b = zProfile.pick({ emergency: true, payout: true, licence: true }).parse(req.body)
    const s = await driverOf(db, shipperId, me.id); const p = await saveProfile(db, s, b); res.json({ person: await profileOut(db, p, s, true) })
  }))
  // Papers: office or the driver themself. Expiry dates on licence/medical/insurance/permit feed the reminders and the run block.
  const addDoc = async (db: Db, staff: Row, by: string, b: { kind: string; title: string; dataUrl: string; expiresOn?: string | null; side?: string }) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(b.dataUrl)!; const id = 'dd_' + uid()
    await db.query('insert into driver_docs (id,staff_id,shipper_id,kind,title,data,mime,expires_on,uploaded_by,side,status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, staff.id, staff.shipper_id, b.kind, b.title, m[2], m[1], b.expiresOn ?? null, by, b.side ?? '', by === staff.name ? 'pending' : 'checked'])
    if (b.expiresOn && (EXPIRY_KINDS as readonly string[]).includes(b.kind)) { const p = await profileOf(db, staff); await db.query('update driver_profiles set expiries = $2 where staff_id = $1', [staff.id, JSON.stringify({ ...J<Row>(p.expiries, {}), [b.kind]: b.expiresOn })]) }
    return id
  }
  const zDoc = z.object({ kind: z.enum(['licence', 'id', 'medical', 'insurance', 'permit', 'contract', 'other']), title: z.string().trim().max(80).default(''), dataUrl: zDataUrl, expiresOn: zDate.nullable().optional(), side: z.enum(['', 'front', 'back']).default('') })
  r.post('/drivers/people/:staffId/docs', wrap(async (req, res) => { const db = await getDb(); const { shipperId, me } = await office(db, req); const s = await driverOf(db, shipperId, String(req.params.staffId)); res.status(201).json({ id: await addDoc(db, s, me.name, zDoc.parse(req.body)) }) }))
  r.post('/drivers/me/docs', wrap(async (req, res) => { const db = await getDb(); const { shipperId, me, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.'); const s = await driverOf(db, shipperId, me.id); const b = zDoc.parse(req.body); const id = await addDoc(db, s, me.name, b); await notifyShipperStaff(db, shipperId, { kind: 'system', title: `${me.name} uploaded a new ${b.kind === 'id' ? 'ID' : (EXPIRY_LABEL[b.kind] ?? b.kind).toLowerCase()}`, body: b.expiresOn ? `Expires ${b.expiresOn}.` : '', link: `/dashboard/drivers?tab=people&p=${me.id}` }, ['owner', 'dispatcher']); res.status(201).json({ id }) }))
  r.get('/drivers/docs/:id', wrap(async (req, res) => {
    const db = await getDb(); const x = await staffOf(db, req)
    const { rows } = await db.query<Row>('select * from driver_docs where id = $1 and shipper_id = $2', [String(req.params.id), x.shipperId]); const doc = rows[0]
    if (!doc || (x.driver && doc.staff_id !== x.me.id)) throw new HttpError(404, 'Not found.')
    res.set('Cache-Control', 'private, no-store'); res.json({ title: doc.title, kind: doc.kind, dataUrl: `data:${doc.mime};base64,${doc.data}` })
  }))
  r.delete('/drivers/docs/:id', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'dispatcher']); await db.query('delete from driver_docs where id = $1 and shipper_id = $2', [String(req.params.id), shipperId]); res.json({ ok: true }) }))
  // Private notes, warnings and commendations — owner only.
  r.post('/drivers/people/:staffId/notes', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner'])
    const s = await driverOf(db, shipperId, String(req.params.staffId)); const b = z.object({ kind: z.enum(['note', 'warning', 'commendation', 'follow_up']), body: z.string().trim().min(2).max(2000) }).parse(req.body)
    await db.query('insert into driver_notes (id,staff_id,shipper_id,kind,body,by_name) values ($1,$2,$3,$4,$5,$6)', ['dn_' + uid(), s.id, shipperId, b.kind, b.body, me.name]); res.status(201).json({ ok: true })
  }))
  r.delete('/drivers/notes/:id', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await office(db, req, ['owner']); await db.query('delete from driver_notes where id = $1 and shipper_id = $2', [String(req.params.id), shipperId]); res.json({ ok: true }) }))

  /* ---- onboarding: agreement + training ---- */
  r.get('/drivers/training', wrap(async (req, res) => { const db = await getDb(); await staffOf(db, req); res.json({ questions: TRAINING.map(({ answer: _a, ...q }) => q), passMark: 80 }) }))
  r.post('/drivers/me/training', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const { answers } = z.object({ answers: z.array(z.number().int().min(0).max(5)).length(TRAINING.length) }).parse(req.body)
    const right = TRAINING.filter((q, i) => answers[i] === q.answer).length; const score = Math.round((right / TRAINING.length) * 100); const passed = score >= 80
    const s = await driverOf(db, shipperId, me.id); const p = await profileOf(db, s); const prev = J<Row | null>(p.training, null)
    await db.query('update driver_profiles set training = $2 where staff_id = $1', [me.id, JSON.stringify({ score, tries: (prev?.tries ?? 0) + 1, passedAt: passed ? prev?.passedAt ?? new Date().toISOString() : prev?.passedAt ?? null, at: new Date().toISOString() })])
    res.json({ score, passed, wrong: TRAINING.map((q, i) => (answers[i] === q.answer ? null : i)).filter((x) => x != null) })
  }))
  r.post('/drivers/me/contract', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const b = z.object({ name: z.string().trim().min(2).max(80), signature: z.string().max(120_000).regex(/^data:image\/png;base64,/), version: z.string().max(20) }).parse(req.body)
    if (b.version !== CONTRACT_VERSION) throw new HttpError(409, 'The agreement changed — reload and read it again.')
    const s = await driverOf(db, shipperId, me.id); await profileOf(db, s)
    await db.query('update driver_profiles set contract_signed_at = now(), contract_sig = $2, contract_name = $3 where staff_id = $1', [me.id, b.signature, `${b.name} (v${b.version})`])
    await notifyShipperStaff(db, shipperId, { kind: 'system', title: `${me.name} signed the driver agreement`, body: '', link: `/dashboard/drivers?tab=people&p=${me.id}` }, ['owner'])
    res.json({ ok: true })
  }))

  /* ---- offboarding ---- */
  r.post('/drivers/people/:staffId/offboard', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance'])
    const s = await driverOf(db, shipperId, String(req.params.staffId)); await profileOf(db, s)
    const b = z.object({ lastDay: zDate, reason: z.string().trim().max(300).default(''), returned: z.object({ equipment: z.boolean(), fuelCard: z.boolean(), keys: z.boolean(), uniform: z.boolean() }), finalPay: z.boolean() }).parse(req.body)
    await db.query(`update staff set status = 'inactive' where id = $1`, [s.id])
    if (s.user_id) { await db.query('delete from sessions where user_id = $1', [s.user_id]).catch(() => {}); await db.query('delete from device_pins where user_id = $1', [s.user_id]).catch(() => {}) }
    await db.query(`update runs set driver_id = null where driver_id = $1 and status = 'planned'`, [s.id])
    await db.query(`update shifts set end_at = now() where staff_id = $1 and end_at is null`, [s.id])
    let slip: string | null = null
    if (b.finalPay) {
      const st = await hrSettings(db, shipperId); const pr = periodFor(st, b.lastDay)
      const { rows: per } = await db.query<Row>(`insert into pay_periods (id,shipper_id,start_date,end_date) values ($1,$2,$3,$4) on conflict (shipper_id, start_date) do update set end_date = pay_periods.end_date returning *`, ['pp_' + uid(), shipperId, pr.start, pr.end])
      const c = await computeSlip(db, { ...s, pay: s.pay }, pr.start, b.lastDay, st); slip = 'ps_' + uid()
      await db.query(`insert into payslips (id,period_id,shipper_id,staff_id,lines,gross,reimbursed,deducted,net,currency,stats,refs) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (period_id, staff_id) do update set lines = excluded.lines, gross = excluded.gross, reimbursed = excluded.reimbursed, deducted = excluded.deducted, net = excluded.net, stats = excluded.stats, refs = excluded.refs returning id`, [slip, per[0].id, shipperId, s.id, JSON.stringify(c.lines), c.gross, c.reimbursed, c.deducted, c.net, c.currency, JSON.stringify({ ...c.stats, final: true }), JSON.stringify(c.refs)])
    }
    await db.query(`update driver_profiles set status = 'offboarded', offboarding = $2 where staff_id = $1`, [s.id, JSON.stringify({ ...b, by: me.name, at: new Date().toISOString(), payslipId: slip })])
    res.json({ ok: true, payslipId: slip, unreturned: Object.entries(b.returned).filter(([, v]) => !v).map(([k]) => k) })
  }))

  /* ---- pay: adjustments, expenses approval, periods, payslips ---- */
  r.post('/drivers/people/:staffId/adjustments', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance'])
    const s = await driverOf(db, shipperId, String(req.params.staffId))
    const b = z.object({ kind: z.enum(['bonus', 'advance', 'deduction', 'shortfall', 'damage', 'fuel_card']), amount: z.number().positive().max(1_000_000), currency: z.enum(['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR']).default('USD'), note: z.string().trim().max(200).default(''), installments: z.number().int().min(1).max(52).default(1) }).parse(req.body)
    await db.query('insert into pay_adjustments (id,shipper_id,staff_id,kind,amount,currency,note,installments,remaining,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$5,$9)', ['pa_' + uid(), shipperId, s.id, b.kind, b.amount, b.currency, b.note, b.kind === 'bonus' ? 1 : b.installments, me.name])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'payment', title: b.kind === 'bonus' ? `Bonus added: ${b.currency} ${b.amount}` : b.kind === 'advance' ? `Advance recorded: ${b.currency} ${b.amount}` : `Deduction recorded: ${b.currency} ${b.amount}`, body: `${b.note}${b.kind !== 'bonus' && b.installments > 1 ? ` · repaid over ${b.installments} payslips` : ''}`, link: '/dashboard/runs/pay' })
    res.status(201).json({ ok: true })
  }))
  r.delete('/drivers/adjustments/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance'])
    const { rows } = await db.query<Row>('select * from pay_adjustments where id = $1 and shipper_id = $2', [String(req.params.id), shipperId]); if (!rows[0]) throw new HttpError(404, 'Not found.')
    if (J<Row[]>(rows[0].applied, []).length) throw new HttpError(409, 'Already on an approved payslip — add a correcting entry instead.')
    await db.query('delete from pay_adjustments where id = $1', [rows[0].id]); res.json({ ok: true })
  }))
  r.post('/drivers/expenses/:id/decide', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance', 'dispatcher'])
    const b = z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(200).default(''), paidBy: z.enum(['driver', 'company']).optional() }).parse(req.body)
    const { rows } = await db.query<Row>(`select e.*, s.user_id from driver_expenses e join staff s on s.id = e.staff_id where e.id = $1 and e.shipper_id = $2`, [String(req.params.id), shipperId]); const e = rows[0]
    if (!e) throw new HttpError(404, 'Not found.'); if (e.payslip_id) throw new HttpError(409, 'Already paid back on a payslip.')
    await db.query('update driver_expenses set status = $2, decided_by = $3, paid_by = coalesce($4, paid_by) where id = $1', [e.id, b.status, me.name, b.paidBy ?? null])
    if (b.status === 'rejected' && e.cost_id) await db.query('delete from costs where id = $1', [e.cost_id])
    if (b.status === 'approved' && e.cost_id) { const { rows: c } = await db.query('select 1 from costs where id = $1', [e.cost_id]); if (!c[0]) await db.query('insert into costs (id,shipper_id,category,description,amount_usd,created_by) values ($1,$2,$3,$4,$5,$6)', [e.cost_id, shipperId, e.kind === 'fuel' || e.kind === 'repair' ? 'fuel' : e.kind === 'toll' || e.kind === 'parking' ? 'trucking' : 'other', `${e.kind} — driver expense`, Number(e.amount_usd), me.name]) }
    if (e.user_id) await notify(db, { userId: e.user_id, kind: 'payment', title: b.status === 'approved' ? `Expense approved: ${e.currency} ${Number(e.amount)}` : `Expense not approved: ${e.currency} ${Number(e.amount)}`, body: b.status === 'approved' ? (e.paid_by === 'company' || b.paidBy === 'company' ? 'Paid on the company card.' : 'It will be on your next payslip.') : b.note || 'Ask the office why.', link: '/dashboard/runs/pay' })
    res.json({ ok: true })
  }))
  const periodsOut = async (db: Db, shipperId: string) => {
    const { rows } = await db.query<Row>(`select p.*, (select count(*)::int from payslips x where x.period_id = p.id) as slips, (select coalesce(sum(net),0) from payslips x where x.period_id = p.id) as total, (select count(*)::int from payslips x where x.period_id = p.id and x.status = 'paid') as paid from pay_periods p where p.shipper_id = $1 order by start_date desc limit 26`, [shipperId])
    return rows.map((p) => ({ id: p.id, start: DATE(p.start_date), end: DATE(p.end_date), status: p.status, lockedBy: p.locked_by, slips: p.slips, paid: p.paid, total: Number(p.total) }))
  }
  r.get('/drivers/pay', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req)
    const st = await hrSettings(db, shipperId); const cur = periodFor(st, today())
    const { rows: drivers } = await db.query<Row>(`select * from staff where shipper_id = $1 and role in ${DRIVER_ROLES} and status <> 'inactive' order by name`, [shipperId])
    const preview = []; for (const s of drivers) { const c = await computeSlip(db, s, cur.start, cur.end, st); preview.push({ staffId: s.id, name: s.name, ...c }) }
    const { rows: slips } = await db.query<Row>(`select x.*, s.name, p.start_date, p.end_date from payslips x join staff s on s.id = x.staff_id join pay_periods p on p.id = x.period_id where x.shipper_id = $1 order by p.start_date desc, s.name limit 200`, [shipperId])
    const { rows: ex } = await db.query<Row>(`select e.*, s.name from driver_expenses e join staff s on s.id = e.staff_id where e.shipper_id = $1 and (e.status = 'pending' or e.at > now() - interval '35 days') order by e.status = 'pending' desc, e.at desc`, [shipperId])
    const { rows: adj } = await db.query<Row>(`select a.*, s.name from pay_adjustments a join staff s on s.id = a.staff_id where a.shipper_id = $1 and (a.remaining > 0 or a.at > now() - interval '60 days') order by a.at desc`, [shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ settings: st, current: cur, preview, periods: await periodsOut(db, shipperId), payslips: slips.map(slipOut),
      expenses: ex.map((e) => ({ id: e.id, name: e.name, staffId: e.staff_id, kind: e.kind, amount: Number(e.amount), currency: e.currency, amountUsd: Number(e.amount_usd), note: e.note, photo: e.photo, status: e.status, paidBy: e.paid_by, payslipId: e.payslip_id, at: ISO(e.at) })),
      adjustments: adj.map((a) => ({ id: a.id, name: a.name, staffId: a.staff_id, kind: a.kind, amount: Number(a.amount), currency: a.currency, note: a.note, installments: Number(a.installments), remaining: Number(a.remaining), applied: J<Row[]>(a.applied, []).length, at: ISO(a.at) })) })
  }))
  /** Close a pay period: lock it and make a draft payslip for every driver with pay or activity. */
  r.post('/drivers/pay/close', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance'])
    const st = await hrSettings(db, shipperId); const { start } = z.object({ start: zDate }).parse(req.body); const pr = periodFor(st, start)
    if (pr.start > today()) throw new HttpError(400, 'That period hasn’t started yet.')
    // Closing early is fine: anything done after this point goes on the next payslip.
    const { rows: per } = await db.query<Row>(`insert into pay_periods (id,shipper_id,start_date,end_date,status,locked_by,locked_at) values ($1,$2,$3,$4,'locked',$5,now()) on conflict (shipper_id, start_date) do update set status = 'locked', locked_by = excluded.locked_by, locked_at = now() returning *`, ['pp_' + uid(), shipperId, pr.start, pr.end, me.name])
    const { rows: drivers } = await db.query<Row>(`select * from staff where shipper_id = $1 and role in ${DRIVER_ROLES}`, [shipperId])
    let n = 0
    for (const s of drivers) {
      const { rows: ex } = await db.query<Row>('select status from payslips where period_id = $1 and staff_id = $2', [per[0].id, s.id]); if (ex[0] && ex[0].status !== 'draft') continue
      const c = await computeSlip(db, s, pr.start, pr.end, st); if (!c.lines.length) continue
      await db.query(`insert into payslips (id,period_id,shipper_id,staff_id,lines,gross,reimbursed,deducted,net,currency,stats,refs) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (period_id, staff_id) do update set lines = excluded.lines, gross = excluded.gross, reimbursed = excluded.reimbursed, deducted = excluded.deducted, net = excluded.net, currency = excluded.currency, stats = excluded.stats, refs = excluded.refs`, ['ps_' + uid(), per[0].id, shipperId, s.id, JSON.stringify(c.lines), c.gross, c.reimbursed, c.deducted, c.net, c.currency, JSON.stringify(c.stats), JSON.stringify(c.refs)]); n++
    }
    res.json({ ok: true, periodId: per[0].id, payslips: n })
  }))
  const slipById = async (db: Db, id: string, shipperId: string) => {
    const { rows } = await db.query<Row>(`select x.*, s.name, s.user_id, p.start_date, p.end_date, sp.name as company from payslips x join staff s on s.id = x.staff_id join pay_periods p on p.id = x.period_id join shippers sp on sp.id = x.shipper_id where x.id = $1 and x.shipper_id = $2`, [id, shipperId])
    if (!rows[0]) throw new HttpError(404, 'Payslip not found.'); return rows[0]
  }
  r.get('/drivers/payslips/:id', wrap(async (req, res) => {
    const db = await getDb(); const x = await staffOf(db, req); const sl = await slipById(db, String(req.params.id), x.shipperId)
    if (x.driver && sl.staff_id !== x.me.id) throw new HttpError(404, 'Payslip not found.')
    if (x.driver && sl.status === 'draft') throw new HttpError(404, 'Not ready yet.')
    if (!x.driver && !['owner', 'dispatcher', 'finance'].includes(x.role)) throw new HttpError(403, 'Not allowed.')
    const { rows: pr } = await db.query<Row>('select employment, payout from driver_profiles where staff_id = $1', [sl.staff_id])
    res.set('Cache-Control', 'private, no-store'); res.json({ payslip: slipOut(sl), employment: pr[0]?.employment ?? 'contractor', payout: J<Row>(pr[0]?.payout, {}) })
  }))
  r.post('/drivers/payslips/:id/recalc', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance']); const sl = await slipById(db, String(req.params.id), shipperId)
    if (sl.status !== 'draft') throw new HttpError(409, 'Only drafts can be recalculated.')
    const s = await driverOf(db, shipperId, sl.staff_id); const c = await computeSlip(db, s, DATE(sl.start_date)!, DATE(sl.end_date)!, await hrSettings(db, shipperId))
    await db.query('update payslips set lines = $2, gross = $3, reimbursed = $4, deducted = $5, net = $6, currency = $7, stats = $8, refs = $9 where id = $1', [sl.id, JSON.stringify(c.lines), c.gross, c.reimbursed, c.deducted, c.net, c.currency, JSON.stringify(c.stats), JSON.stringify(c.refs)])
    res.json({ payslip: slipOut(await slipById(db, sl.id, shipperId)) })
  }))
  const approve = async (db: Db, sl: Row, by: string) => {
    if (sl.status !== 'draft') return false
    const { rows } = await db.query<Row>(`update payslips set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft' returning *`, [sl.id, by]); if (!rows[0]) return false
    const refs = J<{ stops?: string[]; shifts?: string[]; runs?: string[] }>(sl.refs, {})
    if (refs.stops?.length) await db.query('update run_stops set paid_slip = $2 where id = any($1::text[]) and paid_slip is null', [refs.stops, sl.id])
    if (refs.shifts?.length) await db.query('update shifts set paid_slip = $2 where id = any($1::text[]) and paid_slip is null', [refs.shifts, sl.id])
    if (refs.runs?.length) await db.query('update runs set paid_slip = $2 where id = any($1::text[]) and paid_slip is null', [refs.runs, sl.id])
    for (const l of J<Line[]>(sl.lines, [])) {
      if (!l.ref) continue
      if (l.kind === 'reimbursement') await db.query(`update driver_expenses set payslip_id = $2, status = 'reimbursed' where id = $1`, [l.ref, sl.id])
      else if (l.kind === 'bonus') await db.query(`update pay_adjustments set remaining = 0, applied = applied || $2::jsonb where id = $1`, [l.ref, JSON.stringify([{ payslip: sl.id, amount: l.amount }])])
      else if (l.kind === 'deduction') { const { rows: a } = await db.query<Row>('select * from pay_adjustments where id = $1', [l.ref]); if (a[0]) { const back = conv(-l.amount, sl.currency, a[0].currency); await db.query(`update pay_adjustments set remaining = greatest(0, remaining - $2), applied = applied || $3::jsonb where id = $1`, [l.ref, back, JSON.stringify([{ payslip: sl.id, amount: l.amount }])]) } }
    }
    if (sl.user_id) await notify(db, { userId: sl.user_id, kind: 'payment', title: `Payslip ready: ${sl.currency} ${Number(sl.net).toLocaleString()}`, body: `${DATE(sl.start_date)} to ${DATE(sl.end_date)}.`, link: `/dashboard/runs/pay?slip=${sl.id}`, dedupe: `slip:${sl.id}:ok` })
    return true
  }
  r.post('/drivers/payslips/:id/approve', wrap(async (req, res) => { const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance']); const sl = await slipById(db, String(req.params.id), shipperId); if (!(await approve(db, sl, me.name))) throw new HttpError(409, 'Already approved.'); res.json({ payslip: slipOut(await slipById(db, sl.id, shipperId)) }) }))
  r.post('/drivers/pay/periods/:id/approve-all', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'finance'])
    const { rows } = await db.query<Row>(`select x.id from payslips x where x.period_id = $1 and x.shipper_id = $2 and x.status = 'draft'`, [String(req.params.id), shipperId]); let n = 0
    for (const x of rows) if (await approve(db, await slipById(db, x.id, shipperId), me.name)) n++
    res.json({ ok: true, approved: n })
  }))
  r.post('/drivers/payslips/:id/paid', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance']); const sl = await slipById(db, String(req.params.id), shipperId)
    if (sl.status !== 'approved') throw new HttpError(409, sl.status === 'paid' ? 'Already marked paid.' : 'Approve it first.')
    const b = z.object({ method: z.enum(['momo', 'bank', 'zelle', 'cash', 'check', 'other']), ref: z.string().trim().max(80).default('') }).parse(req.body)
    await db.query(`update payslips set status = 'paid', paid_at = now(), paid_method = $2, paid_ref = $3 where id = $1`, [sl.id, b.method, b.ref])
    if (sl.user_id) await notify(db, { userId: sl.user_id, kind: 'payment', title: `You’ve been paid ${sl.currency} ${Number(sl.net).toLocaleString()}`, body: `By ${b.method}${b.ref ? ` · ref ${b.ref}` : ''}.`, link: `/dashboard/runs/pay?slip=${sl.id}`, dedupe: `slip:${sl.id}:paid` })
    res.json({ payslip: slipOut(await slipById(db, sl.id, shipperId)) })
  }))
  /** The driver's own pay: payslips, what's coming this period, advances and expenses. */
  r.get('/drivers/me/pay', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const st = await hrSettings(db, shipperId); const cur = periodFor(st, today()); const s = await driverOf(db, shipperId, me.id)
    const { rows } = await db.query<Row>(`select x.*, p.start_date, p.end_date from payslips x join pay_periods p on p.id = x.period_id where x.staff_id = $1 and x.status <> 'draft' order by p.start_date desc limit 26`, [me.id])
    const { rows: adj } = await db.query<Row>(`select * from pay_adjustments where staff_id = $1 and remaining > 0 order by at`, [me.id])
    const { rows: ex } = await db.query<Row>(`select * from driver_expenses where staff_id = $1 and at > now() - interval '60 days' order by at desc`, [me.id])
    res.set('Cache-Control', 'no-store')
    res.json({ current: { ...cur, ...(await computeSlip(db, s, cur.start, cur.end, st)) }, payslips: rows.map(slipOut), owed: rows.filter((x) => x.status === 'approved').reduce((n, x) => n + Number(x.net), 0),
      adjustments: adj.map((a) => ({ id: a.id, kind: a.kind, amount: Number(a.amount), currency: a.currency, note: a.note, remaining: Number(a.remaining), installments: Number(a.installments) })),
      expenses: ex.map((e) => ({ id: e.id, kind: e.kind, amount: Number(e.amount), currency: e.currency, note: e.note, status: e.status, at: ISO(e.at) })) })
  }))
  const csv = (rows: unknown[][]) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  r.get('/drivers/year-end.csv', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance'])
    const year = Number(req.query.year) || new Date().getFullYear(); const st = await hrSettings(db, shipperId)
    const { rows } = await db.query<Row>(`select s.id, s.name, s.email, s.phone, p.employment, p.country, x.currency, sum(x.gross) as gross, sum(x.reimbursed) as reimb, sum(x.deducted) as ded, sum(x.net) as net from payslips x join staff s on s.id = x.staff_id left join driver_profiles p on p.staff_id = s.id join pay_periods pp on pp.id = x.period_id where x.shipper_id = $1 and x.status = 'paid' and extract(year from x.paid_at) = $2 group by s.id, s.name, s.email, s.phone, p.employment, p.country, x.currency order by s.name`, [shipperId, year])
    const out = [['Name', 'Email', 'Phone', 'Employment', 'Country', 'Currency', 'Pay (gross)', 'Expenses paid back', 'Deductions', 'Paid out (net)', `Needs a 1099-NEC (US contractor, pay ≥ $${st.threshold1099})`]]
    for (const x of rows) out.push([x.name, x.email, x.phone, x.employment ?? 'contractor', x.country ?? '', x.currency, r2(Number(x.gross)), r2(Number(x.reimb)), r2(Number(x.ded)), r2(Number(x.net)), (x.employment ?? 'contractor') === 'contractor' && (x.country ?? 'US') === 'US' && conv(Number(x.gross), x.currency, 'USD') >= st.threshold1099 ? 'Yes' : 'No'])
    res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="driver-pay-${year}.csv"`); res.send(csv(out))
  }))
  r.get('/drivers/monthly.csv', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'finance']); const year = Number(req.query.year) || new Date().getFullYear()
    const { rows } = await db.query<Row>(`select s.name, p.employment, p.country, to_char(pp.end_date, 'YYYY-MM') as month, x.currency, sum(x.gross) as gross, sum(x.reimbursed) as reimb, sum(x.deducted) as ded, sum(x.net) as net, sum((x.stats->>'hours')::numeric) as hours from payslips x join staff s on s.id = x.staff_id left join driver_profiles p on p.staff_id = s.id join pay_periods pp on pp.id = x.period_id where x.shipper_id = $1 and x.status in ('approved','paid') and extract(year from pp.end_date) = $2 group by s.name, p.employment, p.country, month, x.currency order by month, s.name`, [shipperId, year])
    const out = [['Month', 'Name', 'Employment', 'Country', 'Currency', 'Hours', 'Gross pay', 'Expenses paid back', 'Deductions', 'Net']]
    for (const x of rows) out.push([x.month, x.name, x.employment ?? 'contractor', x.country ?? '', x.currency, r2(Number(x.hours ?? 0)), r2(Number(x.gross)), r2(Number(x.reimb)), r2(Number(x.ded)), r2(Number(x.net))])
    res.set('Content-Type', 'text/csv'); res.set('Content-Disposition', `attachment; filename="driver-pay-monthly-${year}.csv"`); res.send(csv(out))
  }))

  /* ---- time: shift corrections ---- */
  r.patch('/drivers/shifts/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'dispatcher', 'finance'])
    const b = z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }).nullable(), reason: z.string().trim().min(3, 'Say why you changed it.').max(200) }).parse(req.body)
    if (b.end && b.end <= b.start) throw new HttpError(400, 'Clock-out must be after clock-in.')
    const { rows } = await db.query<Row>('select sh.*, s.user_id from shifts sh join staff s on s.id = sh.staff_id where sh.id = $1 and sh.shipper_id = $2', [String(req.params.id), shipperId]); const x = rows[0]; if (!x) throw new HttpError(404, 'Shift not found.')
    const edits = [...J<Row[]>(x.edits, []), { by: me.name, at: new Date().toISOString(), reason: b.reason, before: { start: ISO(x.start_at), end: ISO(x.end_at) } }]
    await db.query('update shifts set start_at = $2, end_at = $3, edits = $4 where id = $1', [x.id, b.start, b.end, JSON.stringify(edits)])
    if (x.user_id) await notify(db, { userId: x.user_id, kind: 'system', title: 'Your shift times were changed', body: `${me.name}: ${b.reason}`, link: '/dashboard/runs' })
    res.json({ ok: true })
  }))

  /* ---- rota & time off ---- */
  r.get('/drivers/rota', wrap(async (req, res) => {
    const db = await getDb(); const x = await staffOf(db, req)
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : today(); const days = Math.min(28, Math.max(1, Number(req.query.days) || 7)); const to = addDays(from, days - 1)
    const { rows: staff } = await db.query<Row>(`select id, name, role from staff where shipper_id = $1 and role in ${DRIVER_ROLES} and status <> 'inactive' ${x.driver ? 'and id = $2' : ''} order by name`, x.driver ? [x.shipperId, x.me.id] : [x.shipperId])
    const ids = staff.map((s) => s.id)
    const { rows: ro } = await db.query<Row>(`select * from rota where staff_id = any($1::text[]) and day between $2::date and $3::date`, [ids, from, to])
    const { rows: lv } = await db.query<Row>(`select * from leave_requests where staff_id = any($1::text[]) and status = 'approved' and kind <> 'swap' and end_date >= $2::date and start_date <= $3::date`, [ids, from, to])
    const { rows: runs } = await db.query<Row>(`select id, name, run_date, driver_id, kind from runs where driver_id = any($1::text[]) and run_date between $2::date and $3::date and status <> 'cancelled'`, [ids, from, to])
    res.set('Cache-Control', 'no-store')
    res.json({ from, days, staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role })), entries: ro.map((e) => ({ staffId: e.staff_id, day: DATE(e.day), kind: e.kind, start: e.start_time, end: e.end_time, note: e.note })), leave: lv.map((l) => ({ staffId: l.staff_id, start: DATE(l.start_date), end: DATE(l.end_date), kind: l.kind })), runs: runs.map((r0) => ({ id: r0.id, name: r0.name, day: DATE(r0.run_date), staffId: r0.driver_id, kind: r0.kind })) })
  }))
  r.put('/drivers/rota', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'dispatcher'])
    const b = z.object({ staffId: z.string(), day: zDate, kind: z.enum(['work', 'off', 'leave', 'clear']), start: z.string().regex(/^(\d{2}:\d{2})?$/).default(''), end: z.string().regex(/^(\d{2}:\d{2})?$/).default(''), note: z.string().trim().max(120).default('') }).parse(req.body)
    await driverOf(db, shipperId, b.staffId)
    if (b.kind === 'clear') await db.query('delete from rota where staff_id = $1 and day = $2', [b.staffId, b.day])
    else await db.query(`insert into rota (id,shipper_id,staff_id,day,kind,start_time,end_time,note) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (staff_id, day) do update set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time, note = excluded.note`, ['ro_' + uid(), shipperId, b.staffId, b.day, b.kind, b.start, b.end, b.note])
    res.json({ ok: true })
  }))
  r.post('/drivers/me/leave', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const b = z.object({ kind: z.enum(['vacation', 'sick', 'personal', 'swap']), start: zDate, end: zDate, swapWith: z.string().optional(), note: z.string().trim().max(300).default('') }).parse(req.body)
    if (b.end < b.start) throw new HttpError(400, 'The last day is before the first day.')
    if (b.kind === 'swap') { if (!b.swapWith) throw new HttpError(400, 'Pick who you’re swapping with.'); await driverOf(db, shipperId, b.swapWith); b.end = b.start }
    if (b.kind === 'vacation') { const s = await driverOf(db, shipperId, me.id); const p = await profileOf(db, s); const left = Number(p.leave_days) - (await leaveUsed(db, me.id)); const want = daysBetween(b.start, b.end) + 1; if (want > left) throw new HttpError(400, `That’s ${want} days — you have ${left} left this year.`) }
    const id = 'lv_' + uid()
    await db.query('insert into leave_requests (id,shipper_id,staff_id,kind,start_date,end_date,swap_with,note) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, shipperId, me.id, b.kind, b.start, b.end, b.swapWith ?? null, b.note])
    await notifyShipperStaff(db, shipperId, { kind: 'system', title: b.kind === 'swap' ? `${me.name} asks to swap ${b.start}` : b.kind === 'sick' ? `${me.name} is off sick ${b.start === b.end ? b.start : `${b.start} to ${b.end}`}` : `${me.name} asks for time off ${b.start === b.end ? b.start : `${b.start} to ${b.end}`}`, body: b.note, link: '/dashboard/drivers?tab=rota', dedupe: `leave:${id}` }, ['owner', 'dispatcher'])
    res.status(201).json({ ok: true, id })
  }))
  const leaveOut = (l: Row) => ({ id: l.id, staffId: l.staff_id, name: l.name ?? undefined, swapName: l.swap_name ?? undefined, kind: l.kind, start: DATE(l.start_date), end: DATE(l.end_date), swapWith: l.swap_with, note: l.note, status: l.status, decidedBy: l.decided_by, decisionNote: l.decision_note ?? '', at: ISO(l.at) })
  r.get('/drivers/me/leave', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const s = await driverOf(db, shipperId, me.id); const p = await profileOf(db, s); const used = await leaveUsed(db, me.id)
    const { rows } = await db.query<Row>(`select l.*, w.name as swap_name from leave_requests l left join staff w on w.id = l.swap_with where l.staff_id = $1 order by l.at desc limit 30`, [me.id])
    const { rows: mates } = await db.query<Row>(`select id, name from staff where shipper_id = $1 and role in ${DRIVER_ROLES} and status = 'active' and id <> $2 order by name`, [shipperId, me.id])
    res.set('Cache-Control', 'no-store'); res.json({ balance: { allowance: Number(p.leave_days), used, left: Number(p.leave_days) - used }, requests: rows.map(leaveOut), mates: mates.map((m) => ({ id: m.id, name: m.name })) })
  }))
  r.get('/drivers/leave', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req)
    const { rows } = await db.query<Row>(`select l.*, s.name, w.name as swap_name from leave_requests l join staff s on s.id = l.staff_id left join staff w on w.id = l.swap_with where l.shipper_id = $1 and (l.status = 'pending' or l.end_date >= current_date - 30) order by l.status = 'pending' desc, l.start_date`, [shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ requests: rows.map(leaveOut) })
  }))
  r.post('/drivers/leave/:id/decide', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await office(db, req, ['owner', 'dispatcher'])
    const { status, note } = z.object({ status: z.enum(['approved', 'declined']), note: z.string().trim().max(300).default('') }).parse(req.body)
    const { rows } = await db.query<Row>(`select l.*, s.user_id, s.name from leave_requests l join staff s on s.id = l.staff_id where l.id = $1 and l.shipper_id = $2`, [String(req.params.id), shipperId]); const l = rows[0]
    if (!l) throw new HttpError(404, 'Not found.'); if (l.status !== 'pending') throw new HttpError(409, 'Already decided.')
    await db.query('update leave_requests set status = $2, decided_by = $3, decided_at = now(), decision_note = $4 where id = $1', [l.id, status, me.name, note])
    const start = DATE(l.start_date)!, end = DATE(l.end_date)!
    let clash: Row[] = []
    if (status === 'approved' && l.kind !== 'swap') {
      for (let d = start; d <= end; d = addDays(d, 1)) await db.query(`insert into rota (id,shipper_id,staff_id,day,kind,note) values ($1,$2,$3,$4,'leave',$5) on conflict (staff_id, day) do update set kind = 'leave', note = excluded.note`, ['ro_' + uid(), shipperId, l.staff_id, d, l.kind])
      clash = (await db.query<Row>(`select id, name, run_date from runs where driver_id = $1 and run_date between $2::date and $3::date and status = 'planned'`, [l.staff_id, start, end])).rows
    }
    if (status === 'approved' && l.kind === 'swap' && l.swap_with) {
      const get = async (sid: string) => (await db.query<Row>('select * from rota where staff_id = $1 and day = $2', [sid, start])).rows[0]
      const a = await get(l.staff_id), b2 = await get(l.swap_with)
      const put = async (sid: string, e: Row | undefined) => { if (e) await db.query(`insert into rota (id,shipper_id,staff_id,day,kind,start_time,end_time,note) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (staff_id, day) do update set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time, note = excluded.note`, ['ro_' + uid(), shipperId, sid, start, e.kind, e.start_time, e.end_time, 'swapped']); else await db.query('delete from rota where staff_id = $1 and day = $2', [sid, start]) }
      await put(l.staff_id, b2); await put(l.swap_with, a)
      await db.query(`update runs set driver_id = case when driver_id = $1 then $2 else $1 end where driver_id in ($1, $2) and run_date = $3::date and status = 'planned'`, [l.staff_id, l.swap_with, start])
    }
    if (l.user_id) await notify(db, { userId: l.user_id, kind: 'system', title: status === 'approved' ? `Approved: ${l.kind === 'swap' ? 'shift swap' : 'time off'} ${start}${end !== start ? ` to ${end}` : ''}` : `Not approved: ${l.kind === 'swap' ? 'shift swap' : 'time off'} ${start}`, body: `By ${me.name}.${note ? ` “${note}”` : ''}`, link: '/dashboard/runs/time' })
    res.json({ ok: true, clashes: clash.map((c) => ({ id: c.id, name: c.name, day: DATE(c.run_date) })) })
  }))
  r.get('/drivers/availability', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'dispatcher', 'finance', 'agent']); const day = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : today(); res.json({ day, away: await availability(db, shipperId, day) }) }))

  /* ---- analytics ---- */
  r.get('/drivers/analytics', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req)
    const weeks = Math.min(26, Math.max(4, Number(req.query.weeks) || 12)); const since = addDays(today(), -weeks * 7)
    const { rows: drivers } = await db.query<Row>(`select id, name, role, pay from staff where shipper_id = $1 and role in ${DRIVER_ROLES} order by name`, [shipperId])
    const wk = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return addDays(d, -((dt.getUTCDay() + 6) % 7)) }
    const weekList: string[] = []; for (let w = wk(since); w <= today(); w = addDays(w, 7)) weekList.push(w)
    const scorecards = []
    for (const dr of drivers) {
      const { rows: st } = await db.query<Row>(`select st.status, st.done_at, st.eta_to, st.tries, st.rating, r.run_date from run_stops st join runs r on r.id = st.run_id where r.driver_id = $1 and r.run_date >= $2::date and r.status in ('in_progress','done')`, [dr.id, since])
      const { rows: inc } = await db.query<Row>(`select at from incidents where staff_id = $1 and at >= $2::date and kind in ('damage','accident','theft')`, [dr.id, since])
      const { rows: ho } = await db.query<Row>(`select at, expected, received from cash_handovers where staff_id = $1 and at >= $2::date`, [dr.id, since])
      const series = weekList.map((w) => {
        const inW = (d: unknown) => { const x = DATE(d)!; return x >= w && x <= addDays(w, 6) }
        const s = st.filter((x) => inW(x.run_date)); const done = s.filter((x) => x.status === 'done'); const timed = done.filter((x) => x.eta_to && x.done_at)
        const rated = done.filter((x) => x.rating != null); const h = ho.filter((x) => inW(x.at))
        return { week: w, stops: s.length, done: done.length, onTimePct: timed.length ? Math.round((timed.filter((x) => new Date(x.done_at).toTimeString().slice(0, 5) <= String(x.eta_to)).length / timed.length) * 100) : null, firstTryPct: done.length ? Math.round((done.filter((x) => !Number(x.tries)).length / done.length) * 100) : null, incidents: inc.filter((x) => inW(x.at)).length, rating: rated.length ? r2(rated.reduce((n, x) => n + Number(x.rating), 0) / rated.length) : null, cashOkPct: h.length ? Math.round((h.filter((x) => Number(x.expected) === Number(x.received)).length / h.length) * 100) : null }
      })
      const done = st.filter((x) => x.status === 'done'); const timed = done.filter((x) => x.eta_to && x.done_at); const rated = done.filter((x) => x.rating != null)
      scorecards.push({ staffId: dr.id, name: dr.name, role: dr.role, done: done.length, stops: st.length, onTimePct: timed.length ? Math.round((timed.filter((x) => new Date(x.done_at).toTimeString().slice(0, 5) <= String(x.eta_to)).length / timed.length) * 100) : null, firstTryPct: done.length ? Math.round((done.filter((x) => !Number(x.tries)).length / done.length) * 100) : null, incidents: inc.length, rating: rated.length ? r2(rated.reduce((n, x) => n + Number(x.rating), 0) / rated.length) : null, ratings: rated.length, cashOkPct: ho.length ? Math.round((ho.filter((x) => Number(x.expected) === Number(x.received)).length / ho.length) * 100) : null, series })
    }
    // Run economics: what each run cost (pay + expenses) against the freight invoiced on its stops.
    const { rows: runs } = await db.query<Row>(`select r.*, s.pay, s.name as driver_name, v.name as vehicle_name from runs r left join staff s on s.id = r.driver_id left join vehicles v on v.id = r.vehicle_id where r.shipper_id = $1 and r.run_date >= current_date - 30 and r.status in ('in_progress','done') order by r.run_date desc`, [shipperId])
    const econ = []; const areas = new Map<string, { area: string; stops: number; cost: number; revenue: number }>()
    for (const r0 of runs) {
      const { rows: st } = await db.query<Row>(`select st.status, st.address, st.shipment_id from run_stops st where st.run_id = $1`, [r0.id])
      const done = st.filter((x) => x.status === 'done').length; const pay = J<Row>(r0.pay, {}); const payCur = pay.currency ?? 'USD'
      const { rows: hrs } = await db.query<Row>(`select coalesce(sum(extract(epoch from (coalesce(end_at, now()) - start_at)) / 3600), 0) as h from shifts where staff_id = $1 and start_at::date = $2::date`, [r0.driver_id, DATE(r0.run_date)])
      const { rows: runsThatDay } = await db.query<{ n: number }>(`select count(*)::int as n from runs where driver_id = $1 and run_date = $2::date`, [r0.driver_id, DATE(r0.run_date)])
      const payCost = conv((pay.perStop ?? 0) * done + (pay.perRun ?? 0) + ((pay.perHour ?? 0) * Number(hrs[0].h)) / Math.max(1, runsThatDay[0].n), payCur, 'USD')
      const { rows: ex } = await db.query<Row>(`select coalesce(sum(amount_usd),0) as n from driver_expenses where run_id = $1 and status <> 'rejected'`, [r0.id])
      const ids = st.map((x) => x.shipment_id).filter(Boolean)
      const { rows: inv } = ids.length ? await db.query<Row>(`select coalesce(sum(total),0) as n from invoices where shipment_id = any($1::text[]) and status <> 'void'`, [ids]) : { rows: [{ n: 0 }] }
      const cost = r2(payCost + Number(ex[0].n)); const km = Number(r0.distance_km ?? 0); const revenue = Number(inv[0].n)
      econ.push({ id: r0.id, name: r0.name, date: DATE(r0.run_date), kind: r0.kind, driver: r0.driver_name, vehicle: r0.vehicle_name, stops: st.length, done, km, payCost: r2(payCost), expenses: r2(Number(ex[0].n)), cost, perStop: done ? r2(cost / done) : null, perKm: km ? r2(cost / km) : null, revenue: r2(revenue), costPct: revenue ? Math.round((cost / revenue) * 1000) / 10 : null })
      for (const x of st) { const parts = String(x.address || '').split(',').map((p) => p.trim()).filter(Boolean); const area = parts.length >= 2 ? parts[parts.length - (/\d/.test(parts[parts.length - 1]) || parts[parts.length - 1].length <= 3 ? 2 : 1)] : parts[0] || 'No address'; const a = areas.get(area) ?? { area, stops: 0, cost: 0, revenue: 0 }; a.stops++; a.cost += st.length ? cost / st.length : 0; a.revenue += st.length ? revenue / st.length : 0; areas.set(area, a) }
    }
    // Fleet: distance from odometer readings, fuel spend, service due.
    const { rows: veh } = await db.query<Row>(`select * from vehicles where shipper_id = $1 and status <> 'retired' order by name`, [shipperId])
    const fleet = []
    for (const v of veh) {
      const { rows: od } = await db.query<Row>(`select odometer, at from vehicle_checks where vehicle_id = $1 and odometer is not null order by at`, [v.id])
      const last = od.length ? Number(od[od.length - 1].odometer) : null; const d30 = od.filter((x) => new Date(x.at).getTime() > Date.now() - 30 * 86400000)
      const km30 = d30.length >= 2 ? Number(d30[d30.length - 1].odometer) - Number(d30[0].odometer) : null
      const { rows: fuel } = await db.query<Row>(`select coalesce(sum(e.amount_usd),0) as n from driver_expenses e join runs r on r.id = e.run_id where r.vehicle_id = $1 and e.kind = 'fuel' and e.at > now() - interval '30 days' and e.status <> 'rejected'`, [v.id])
      const { rows: issues } = await db.query<{ n: number }>(`select count(*)::int as n from vehicle_checks where vehicle_id = $1 and at > now() - interval '30 days' and (not safe or items::text like '%issue%')`, [v.id])
      const nextKm = v.service_every_km && v.last_service_km != null ? Number(v.last_service_km) + Number(v.service_every_km) : null
      fleet.push({ id: v.id, name: v.name, plate: v.plate, status: v.status, odometer: last, km30, fuelUsd30: r2(Number(fuel[0].n)), fuelPerKm: km30 ? r2(Number(fuel[0].n) / km30) : null, checkIssues30: issues[0].n, serviceEveryKm: v.service_every_km ?? null, lastServiceKm: v.last_service_km ?? null, lastServiceAt: DATE(v.last_service_at), nextServiceKm: nextKm, serviceDue: nextKm != null && last != null ? last >= nextKm - 500 : false })
    }
    const board = await leaderboard(db, shipperId)
    res.set('Cache-Control', 'no-store'); res.json({ weeks: weekList, scorecards, runs: econ, areas: [...areas.values()].map((a) => ({ ...a, cost: r2(a.cost), revenue: r2(a.revenue), perStop: a.stops ? r2(a.cost / a.stops) : null })).sort((a, b) => b.stops - a.stops).slice(0, 15), fleet, leaderboard: board, showLeaderboard: (await hrSettings(db, shipperId)).showLeaderboard })
  }))
  r.put('/drivers/fleet/:vehicleId/service', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await office(db, req, ['owner', 'dispatcher'])
    const b = z.object({ everyKm: z.number().int().min(500).max(100000).nullable(), lastKm: z.number().int().min(0).max(5_000_000).nullable(), lastAt: zDate.nullable() }).parse(req.body)
    const { rows } = await db.query<Row>('update vehicles set service_every_km = $3, last_service_km = $4, last_service_at = $5 where id = $1 and shipper_id = $2 returning id', [String(req.params.vehicleId), shipperId, b.everyKm, b.lastKm, b.lastAt]); if (!rows[0]) throw new HttpError(404, 'Vehicle not found.')
    res.json({ ok: true })
  }))
  /** Drivers see their place on the leaderboard only when the office turns it on. */
  r.get('/drivers/me/rank', wrap(async (req, res) => {
    const db = await getDb(); const { me, shipperId, driver } = await staffOf(db, req); if (!driver) throw new HttpError(403, 'For drivers.')
    const st = await hrSettings(db, shipperId); if (!st.showLeaderboard) { res.json({ show: false }); return }
    const scored = await leaderboard(db, shipperId); const i = scored.findIndex((x) => x.staffId === me.id); res.json({ show: true, rank: i >= 0 ? i + 1 : null, of: scored.length })
  }))

  /* ---- public: rate the delivery (from the tracking page) ---- */
  r.post('/track/:ref/rate', wrap(async (req, res) => {
    const db = await getDb(); const b = z.object({ stars: z.number().int().min(1).max(5), note: z.string().trim().max(300).default('') }).parse(req.body)
    const { rows } = await db.query<Row>(`select st.id, st.rating, r.driver_id, r.shipper_id, s.name from run_stops st join runs r on r.id = st.run_id join shipments sh on sh.id = st.shipment_id left join staff s on s.id = r.driver_id where upper(sh.ref) = upper($1) and st.status = 'done' and r.kind = 'delivery' and st.done_at > now() - interval '30 days' order by st.done_at desc limit 1`, [String(req.params.ref)])
    const st = rows[0]; if (!st) throw new HttpError(404, 'There’s no recent delivery to rate.'); if (st.rating != null) throw new HttpError(409, 'Thanks — this delivery was already rated.')
    await db.query('update run_stops set rating = $2, rating_note = $3 where id = $1', [st.id, b.stars, b.note])
    if (b.stars <= 2) await notifyShipperStaff(db, st.shipper_id, { kind: 'review', title: `${b.stars}★ delivery rating for ${st.name ?? 'a driver'}`, body: b.note || 'No comment left.', link: '/dashboard/drivers?tab=analytics' }, ['owner', 'dispatcher'])
    res.json({ ok: true })
  }))
}
