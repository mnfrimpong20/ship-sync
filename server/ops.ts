/**
 * Operations for shippers: team & roles, fleet, and route planning (pickup runs at the origin, delivery runs to
 * consignees in West Africa). Staff sign in as normal users linked to the company; what they may do depends on their role.
 */
import { assertRelease, owedFor } from './flow'
import { canDriveKind, isDriverRole } from '../src/lib/roles'
import { humanizeDates } from '../src/lib/dates'
import { prefsOf } from './shipmentOps'
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'
import { distanceKm } from '../src/lib/geo'
import { notify, notifyShipmentStatus, notifyShipperStaff } from './notify'
import { normalisePhone, sendText, smsProvider } from './sms'

type Row = Record<string, any>
export type StaffRole = 'owner' | 'dispatcher' | 'agent' | 'finance' | 'warehouse' | 'pickup_driver' | 'delivery_driver' | 'driver'
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  createSession: (db: Db, res: Response, userId: string) => Promise<void>
  loadUserWithCompany: (db: Db, id: string) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadShipments: (db: Db, where: string, params: unknown[]) => Promise<any[]>
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const num = (v: unknown) => (v == null ? undefined : Number(v))

export const staffOut = (r: Row) => ({ id: r.id, shipperId: r.shipper_id, userId: r.user_id ?? undefined, name: r.name, email: r.email, phone: r.phone, role: r.role as StaffRole, status: r.status as 'invited' | 'active' | 'inactive', base: r.base as 'origin' | 'destination', city: r.city, inviteToken: r.invite_token ?? undefined, createdAt: ISO(r.created_at), runCount: r.run_count != null ? Number(r.run_count) : undefined, perms: (J(r.perms) ?? {}) as { allow?: string[]; deny?: string[] }, lastActiveAt: ISO(r.last_active_at), activity: r.runs_week != null ? { runsWeek: Number(r.runs_week), stopsWeek: Number(r.stops_week), scansWeek: Number(r.scans_week), quotesWeek: Number(r.quotes_week), quotesWonWeek: Number(r.quotes_won_week), lastScanAt: ISO(r.last_scan_at) } : undefined })
const vehicleOut = (r: Row) => ({ id: r.id, name: r.name, type: r.type, plate: r.plate, capacityKg: num(r.capacity_kg), capacityNote: r.capacity_note, base: r.base as 'origin' | 'destination', city: r.city, country: r.country, status: r.status as 'available' | 'on_run' | 'maintenance' | 'retired', driverId: r.driver_id ?? undefined, notes: r.notes, createdAt: ISO(r.created_at) })
const podOut = (v: unknown) => { const p = J(v) as { receivedBy?: string; photo?: string; signature?: string; pieces?: number; by?: string; leftWith?: { kind: string; name: string } } | null; return p ? { receivedBy: p.receivedBy ?? '', pieces: p.pieces ?? undefined, hasPhoto: !!p.photo, hasSignature: !!p.signature, by: p.by ?? '', leftWith: p.leftWith ?? undefined } : undefined }
const stopOut = (r: Row) => ({ codeRequired: !!r.code || undefined, codeOk: r.code_ok ? true : undefined, idChecked: r.id_check ? true : undefined, nearAt: r.near_at ? ISO(r.near_at) : undefined, arrivedAt: r.arrived_at ? ISO(r.arrived_at) : undefined, outsideAt: r.outside_at ? ISO(r.outside_at) : undefined, vehicleReport: r.vehicle_report ? true : undefined, suppliesDropped: r.supplies_drop ? true : undefined, handedOver: r.handed_over_id ? true : undefined, etaFrom: r.eta_from || undefined, etaTo: r.eta_to || undefined, pod: podOut(r.pod), skipReason: r.skip_reason || undefined, tries: Number(r.tries ?? 0), onWayAt: r.on_way_at ? ISO(r.on_way_at) : undefined, collected: (J(r.collected) as { method: string; amountUsd: number; at: string } | null) ?? undefined, collectUsd: r.collect_usd ?? undefined, collectRule: r.collect_rule ?? undefined, id: r.id, runId: r.run_id, seq: Number(r.seq), shipmentId: r.shipment_id ?? undefined, label: r.label, address: r.address, lat: num(r.lat), lon: num(r.lon), contact: r.contact, phone: r.phone, status: r.status as 'pending' | 'done' | 'skipped', doneAt: r.done_at ? ISO(r.done_at) : undefined, note: r.note, shipmentRef: r.shipment_ref ?? undefined, shipmentStatus: r.shipment_status ?? undefined })
const runOut = (r: Row, stops: Row[]) => ({
  id: r.id, name: humanizeDates(r.name), kind: r.kind as 'pickup' | 'delivery', date: DATE(r.run_date), driverId: r.driver_id ?? undefined, vehicleId: r.vehicle_id ?? undefined,
  start: r.start_lat != null ? { label: r.start_label, lat: Number(r.start_lat), lon: Number(r.start_lon) } : null,
  status: r.status as 'planned' | 'in_progress' | 'done' | 'cancelled', distanceKm: num(r.distance_km), notes: r.notes, createdAt: ISO(r.created_at), summarySentAt: r.summary_sent_at ? ISO(r.summary_sent_at) : undefined,
  vehicleCheck: (J(r.vehicle_check) as { at: string; by: string; issues: string[]; safe: boolean; odometer: number | null } | null) ?? undefined,
  stops: stops.map(stopOut), driverName: r.driver_name ?? undefined, vehicleName: r.vehicle_name ?? undefined,
})

/* ---------------- schemas ---------------- */
const zRole = z.enum(['owner', 'dispatcher', 'agent', 'finance', 'warehouse', 'pickup_driver', 'delivery_driver', 'driver'])
const zBase = z.enum(['origin', 'destination'])
const zInvite = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email('Enter a valid email.'), phone: z.string().trim().max(30).default(''), role: zRole.default('agent'), base: zBase.default('origin'), city: z.string().trim().max(60).default('') })
const zArea = z.enum(['leads', 'rates', 'lanes', 'groupage', 'brand', 'shipments', 'containers', 'sailings', 'pickups', 'routes', 'warehouse', 'clients', 'payments', 'collections', 'reviews', 'fleet', 'team', 'verification', 'sourcing'])
const zStaffPatch = z.object({ role: zRole.optional(), status: z.enum(['active', 'inactive']).optional(), phone: z.string().trim().max(30).optional(), base: zBase.optional(), city: z.string().trim().max(60).optional(), name: z.string().trim().min(2).max(80).optional(), perms: z.object({ allow: z.array(zArea).max(30).default([]), deny: z.array(zArea).max(30).default([]) }).optional() })
const zJoin = z.object({ name: z.string().trim().min(2).max(80), password: z.string().min(8, 'Password must be at least 8 characters.') })
const zVehicle = z.object({
  name: z.string().trim().min(2).max(60), type: z.enum(['van', 'truck', 'box_truck', 'pickup', 'trailer', 'car', 'motorbike']).default('van'), plate: z.string().trim().max(20).default(''),
  capacityKg: z.number().int().min(0).max(100000).nullable().optional(), capacityNote: z.string().trim().max(120).default(''), base: zBase.default('origin'), city: z.string().trim().max(60).default(''), country: z.string().trim().max(2).default(''),
  status: z.enum(['available', 'on_run', 'maintenance', 'retired']).default('available'), driverId: z.string().nullable().optional(), notes: z.string().trim().max(1000).default(''),
})
const zStopIn = z.object({ shipmentId: z.string().optional(), label: z.string().trim().min(1).max(120), address: z.string().trim().max(240).default(''), lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), contact: z.string().trim().max(80).default(''), phone: z.string().trim().max(30).default('') })
const zRun = z.object({
  name: z.string().trim().min(2).max(80), kind: z.enum(['pickup', 'delivery']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), driverId: z.string().nullable().optional(), vehicleId: z.string().nullable().optional(),
  start: z.object({ label: z.string().trim().max(120).default(''), lat: z.number(), lon: z.number() }).nullable().optional(), notes: z.string().trim().max(1000).default(''), stops: z.array(zStopIn).max(60).default([]),
})
const zRunPatch = z.object({ name: z.string().trim().min(2).max(80).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), driverId: z.string().nullable().optional(), vehicleId: z.string().nullable().optional(), status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).optional(), notes: z.string().trim().max(1000).optional(), start: z.object({ label: z.string().trim().max(120).default(''), lat: z.number(), lon: z.number() }).nullable().optional() })
export const SKIP_REASONS = { not_home: 'Nobody home', wrong_address: 'Wrong address', refused: 'Refused', no_access: 'Couldn’t get in', other: 'Other' } as const
const DRIVER_STOP_KEYS = ['status', 'note', 'receivedBy', 'photo', 'signature', 'pieces', 'skipReason', 'retry', 'collected', 'code', 'idCheck', 'leftWith']
export const ID_TYPES = { ghana_card: 'Ghana Card', passport: 'Passport', drivers_license: 'Driver’s licence', voter_id: 'Voter ID', other: 'Other ID' } as const
export const LEFT_WITH = { neighbour: 'a neighbour', gate: 'the gate / security', reception: 'reception', family: 'a family member', other: 'someone else' } as const
const zStopPatch = z.object({ status: z.enum(['pending', 'done', 'skipped']).optional(), note: z.string().trim().max(500).optional(),
  receivedBy: z.string().trim().max(80).optional(), photo: z.string().max(600_000).regex(/^data:image\/(jpeg|png|webp);base64,/).optional(), signature: z.string().max(120_000).regex(/^data:image\/png;base64,/).optional(),
  pieces: z.number().int().min(0).max(999).optional(), skipReason: z.enum(['not_home', 'wrong_address', 'refused', 'no_access', 'other']).optional(), retry: z.boolean().optional(),
  code: z.string().trim().regex(/^\d{4}$/, 'The code is 4 digits.').optional(), idCheck: z.object({ type: z.enum(['ghana_card', 'passport', 'drivers_license', 'voter_id', 'other']), last4: z.string().trim().regex(/^[A-Za-z0-9]{2,4}$/, 'Only the last 4 characters of the ID.') }).optional(),
  leftWith: z.object({ kind: z.enum(['neighbour', 'gate', 'reception', 'family', 'other']), name: z.string().trim().max(80).default('') }).optional(),
  collected: z.object({ method: z.enum(['cash', 'mobile_money', 'zelle', 'card']), amountUsd: z.number().min(0.01).max(1_000_000) }).optional(), seq: z.number().int().min(0).optional(), lat: z.number().optional(), lon: z.number().optional(), label: z.string().trim().min(1).max(120).optional(), address: z.string().trim().max(240).optional(), contact: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional() })

/* ---------------- geocoding (OpenStreetMap Nominatim, cached, ≤1 req/s per their policy) ---------------- */
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org'
let lastGeo = 0
export async function geocode(db: Db, q: string): Promise<{ lat: number; lon: number; label: string; cached?: boolean } | null> {
  const key = q.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!key) return null
  const { rows } = await db.query<Row>('select * from geocache where q = $1', [key])
  if (rows[0]) return rows[0].lat == null ? null : { lat: Number(rows[0].lat), lon: Number(rows[0].lon), label: rows[0].label, cached: true }
  const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastGeo = Date.now()
  let hit: { lat: number; lon: number; label: string } | null = null
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'Ntemtem route planner (+https://github.com/mnfrimpong20/ship-sync)' } })
    clearTimeout(t)
    if (res.ok) { const [r] = (await res.json()) as any[]; if (r) hit = { lat: Number(r.lat), lon: Number(r.lon), label: r.display_name } }
    await db.query('insert into geocache (q,lat,lon,label) values ($1,$2,$3,$4) on conflict (q) do nothing', [key, hit?.lat ?? null, hit?.lon ?? null, hit?.label ?? null])
  } catch { /* offline — no result, not cached */ }
  return hit
}

/** Nearest-neighbour from the start, then 2-opt — good enough for a day's run of a few dozen stops. */
export function optimiseOrder(start: { lat: number; lon: number } | null, stops: { lat?: number; lon?: number }[]): number[] {
  const idx = stops.map((s, i) => i).filter((i) => stops[i].lat != null && stops[i].lon != null)
  const rest = stops.map((s, i) => i).filter((i) => stops[i].lat == null || stops[i].lon == null)
  if (idx.length < 2) return [...idx, ...rest]
  const d = (a: { lat?: number; lon?: number }, b: { lat?: number; lon?: number }) => distanceKm([a.lon!, a.lat!], [b.lon!, b.lat!])
  const order: number[] = []
  let cur: { lat?: number; lon?: number } = start ?? stops[idx[0]]
  const pool = new Set(idx)
  if (!start) { order.push(idx[0]); pool.delete(idx[0]) }
  while (pool.size) { let best = -1, bd = Infinity; for (const i of pool) { const dd = d(cur, stops[i]); if (dd < bd) { bd = dd; best = i } } order.push(best); pool.delete(best); cur = stops[best] }
  const total = (o: number[]) => { let t = start ? d(start, stops[o[0]]) : 0; for (let i = 1; i < o.length; i++) t += d(stops[o[i - 1]], stops[o[i]]); return t }
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < order.length - 1; i++) for (let k = i + 1; k < order.length; k++) {
      const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)]
      if (total(cand) + 1e-9 < total(order)) { order.splice(0, order.length, ...cand); improved = true }
    }
  }
  return [...order, ...rest]
}
const runDistance = (start: { lat: number; lon: number } | null, stops: { lat?: number; lon?: number }[]) => {
  const pts = stops.filter((s) => s.lat != null && s.lon != null)
  let t = 0; let prev: { lat?: number; lon?: number } | null = start
  for (const s of pts) { if (prev) t += distanceKm([prev.lon!, prev.lat!], [s.lon!, s.lat!]); prev = s }
  return Math.round(t * 10) / 10
}

let autoSummaries: ((db: Db) => Promise<void>) | null = null
/** Sweep: send end-of-run summaries drivers forgot to send. */
export async function runAutoSummaries(db: Db) { if (autoSummaries) await autoSummaries(db) }
type SummaryRun = { id: string; name: string; stops: { status: string; label: string; note: string; pod?: { pieces?: number } | null; collected?: { method: string; amountUsd: number } | null }[] }
export async function sendRunSummary(db: Db, run: SummaryRun, shipperId: string, by: string, note: string, auto = false) {
  const done = run.stops.filter((s) => s.status === 'done'); const skipped = run.stops.filter((s) => s.status === 'skipped'); const pending = run.stops.filter((s) => s.status === 'pending')
  const pieces = done.reduce((n, s) => n + (s.pod?.pieces ?? 0), 0)
  const cash = run.stops.reduce((n, s) => n + (s.collected?.method === 'cash' ? s.collected.amountUsd : 0), 0); const momo = run.stops.reduce((n, s) => n + (s.collected?.method === 'mobile_money' ? s.collected.amountUsd : 0), 0)
  const body = [`${done.length} done`, skipped.length ? `${skipped.length} skipped (${skipped.map((s) => `${s.label}: ${s.note || 'no reason'}`).join('; ')})` : '', pending.length ? `${pending.length} not reached` : '', pieces ? `${pieces} pieces` : '', cash ? `$${cash.toLocaleString()} cash` : '', momo ? `$${momo.toLocaleString()} mobile money` : '', note, auto ? 'Sent automatically an hour after the last stop.' : ''].filter(Boolean).join(' · ')
  await notifyShipperStaff(db, shipperId, { kind: 'shipment_status', title: `${by} finished “${run.name}”`, body, link: `/dashboard/routes/${run.id}`, dedupe: auto ? `autosum:${run.id}` : undefined }, ['owner', 'dispatcher'])
  await db.query('update runs set summary_sent_at = now() where id = $1', [run.id])
  return body
}

export function mountOps(r: Router, d: Deps) {
  const { getDb, requireUser, createSession, loadUserWithCompany, HttpError, wrap, loadShipments } = d
  /** The signed-in staff member and their role; owners without a staff row are created on the fly. */
  const staffOf = async (db: Db, req: Request, ...allowed: StaffRole[]) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'This area is for shipper teams.')
    let { rows } = await db.query<Row>('select * from staff where user_id = $1 and shipper_id = $2', [u.id, u.shipperId])
    if (!rows[0]) { await db.query(`insert into staff (id,shipper_id,user_id,name,email,role,status) values ($1,$2,$3,$4,$5,'owner','active') on conflict (shipper_id, email) do update set user_id = excluded.user_id, status = 'active'`, ['st_' + uid(), u.shipperId, u.id, u.name, u.email]); rows = (await db.query<Row>('select * from staff where user_id = $1 and shipper_id = $2', [u.id, u.shipperId])).rows }
    const me = rows[0]
    if (me.status === 'inactive') throw new HttpError(403, 'Your access to this company has been switched off.')
    if (allowed.length && !allowed.includes(me.role)) throw new HttpError(403, `This needs the ${allowed.join(' or ')} role.`)
    return { user: u, shipperId: u.shipperId, me, role: me.role as StaffRole }
  }
  const MANAGE: StaffRole[] = ['owner', 'dispatcher']
  /** A pickup driver only gets pickup runs; a delivery driver only delivery runs. */
  const assertDriverFits = async (db: Db, shipperId: string, driverId: string | null | undefined, kind: string, date?: string) => {
    if (!driverId) return
    const { rows } = await db.query<Row>('select name, role from staff where id = $1 and shipper_id = $2', [driverId, shipperId]); const d = rows[0]
    if (!d) throw new HttpError(400, 'That driver isn’t on your team.')
    if (isDriverRole(d.role) && !canDriveKind(d.role, kind as 'pickup' | 'delivery')) throw new HttpError(400, `${d.name} is a ${d.role === 'pickup_driver' ? 'pickup' : 'delivery'} driver — choose a ${kind === 'pickup' ? 'pickup' : 'delivery'} driver for this run.`)
    // Expired licence / medical / insurance / permit, or someone who has left, can't be put on a run.
    const { driverBlock } = await import('./driverHr'); const why = await driverBlock(db, driverId, date); if (why) throw new HttpError(400, why)
  }
  const loadRuns = async (db: Db, where: string, params: unknown[]) => {
    const { rows } = await db.query<Row>(`select r.*, s.name as driver_name, v.name as vehicle_name from runs r left join staff s on s.id = r.driver_id left join vehicles v on v.id = r.vehicle_id where ${where} order by r.run_date desc, r.created_at desc`, params)
    if (!rows.length) return []
    const { rows: stops } = await db.query<Row>(`select st.*, sh.ref as shipment_ref, sh.status as shipment_status, sh.storage_due, sh.storage_billed, sh.shipper_id as sh_shipper from run_stops st left join shipments sh on sh.id = st.shipment_id where st.run_id = any($1::text[]) order by st.seq asc`, [rows.map((x) => x.id)])
    // What the driver has to collect at each delivery stop.
    const kinds = new Map(rows.map((x) => [x.id, x.kind]))
    const holds = new Map<string, string>()
    for (const st of stops) if (st.shipment_id && st.status === 'pending') {
      const o = await owedFor(db, { id: st.shipment_id, storage_due: st.storage_due, storage_billed: st.storage_billed })
      // Pickups: a deposit or full payment can be taken at the door, never required.
      if (o.totalUsd > 0 && kinds.get(st.run_id) === 'pickup') { st.collect_usd = o.totalUsd; st.collect_rule = 'off' }
      else if (o.totalUsd > 0) { st.collect_usd = o.totalUsd; if (!holds.has(st.sh_shipper)) holds.set(st.sh_shipper, (await prefsOf(db, st.sh_shipper)).holdUnpaid); st.collect_rule = holds.get(st.sh_shipper) }
    }
    return rows.map((x) => runOut(x, stops.filter((s) => s.run_id === x.id)))
  }
  const ownRun = async (db: Db, shipperId: string, id: string) => { const [run] = await loadRuns(db, 'r.id = $1 and r.shipper_id = $2', [id, shipperId]); if (!run) throw new HttpError(404, 'Run not found.'); return run }
  /** Every stop closed an hour ago and no summary yet: send it for the driver and finish the run. */
  autoSummaries = async (db: Db) => {
    const { rows } = await db.query<Row>(`select r.id, r.shipper_id, r.status, r.vehicle_id, s.name as driver from runs r join staff s on s.id = r.driver_id
      where r.summary_sent_at is null and r.status in ('in_progress','done') and r.run_date >= current_date - 1
        and exists (select 1 from run_stops st where st.run_id = r.id)
        and not exists (select 1 from run_stops st where st.run_id = r.id and st.status = 'pending')
        and (select max(st.done_at) from run_stops st where st.run_id = r.id) between now() - interval '24 hours' and now() - interval '60 minutes'`)
    for (const x of rows) {
      const run = await ownRun(db, x.shipper_id, x.id)
      await sendRunSummary(db, run, x.shipper_id, x.driver, '', true)
      if (x.status === 'in_progress') { await db.query(`update runs set status = 'done' where id = $1`, [x.id]); if (x.vehicle_id) await db.query(`update vehicles set status = 'available' where id = $1 and status = 'on_run'`, [x.vehicle_id]) }
    }
  }

  // ---- me (role for the UI)
  r.get('/team/me', wrap(async (req, res) => { const db = await getDb(); const { me } = await staffOf(db, req); res.json({ staff: staffOut(me) }) }))

  // ---- team
  r.get('/team', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, role, me } = await staffOf(db, req)
    // Drivers don't need the office list (emails, phones); they get their own record, and dispatch via /runs/dispatch.
    if (isDriverRole(role)) { res.json({ team: [staffOut(me)] }); return }
    const { rows } = await db.query<Row>(`select s.*, (select count(*) from runs r where r.driver_id = s.id)::int as run_count,
        (select count(*) from runs r where r.driver_id = s.id and r.run_date >= current_date - 6)::int as runs_week,
        (select count(*) from run_stops rs join runs r on r.id = rs.run_id where r.driver_id = s.id and rs.status = 'done' and rs.done_at >= now() - interval '7 days')::int as stops_week,
        (select count(*) from scans sc where sc.by_staff_id = s.id and sc.at >= now() - interval '7 days')::int as scans_week,
        (select max(sc.at) from scans sc where sc.by_staff_id = s.id) as last_scan_at,
        (select count(*) from quotes q where q.sent_by = s.id and q.sent_at >= now() - interval '7 days')::int as quotes_week,
        (select count(*) from quotes q where q.sent_by = s.id and q.sent_at >= now() - interval '30 days' and q.status = 'accepted')::int as quotes_won_week
      from staff s where s.shipper_id = $1 order by case s.role when 'owner' then 0 when 'dispatcher' then 1 when 'agent' then 2 when 'finance' then 3 when 'warehouse' then 4 else 5 end, s.name`, [shipperId])
    res.json({ team: rows.map(staffOut) })
  }))
  r.post('/team/invite', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await staffOf(db, req, ...MANAGE)
    const b = zInvite.parse(req.body)
    if (b.role === 'owner' && me.role !== 'owner') throw new HttpError(403, 'Only an owner can add another owner.')
    const email = b.email.toLowerCase()
    const { rows: dup } = await db.query('select 1 from staff where shipper_id = $1 and email = $2', [shipperId, email])
    if (dup.length) throw new HttpError(409, 'That person is already on your team.')
    { // plan team limit (staff besides the owner account)
      const { effectivePlan, PLANS } = await import('./features')
      const { rows: sp } = await db.query<Row>('select plan, trial_ends_at from shippers where id = $1', [shipperId]); const plan = PLANS[effectivePlan(sp[0] ?? {}).plan]
      const { rows: cnt } = await db.query<Row>(`select count(*)::int as n from staff where shipper_id = $1 and status in ('active','invited')`, [shipperId])
      if (plan.team != null && Number(cnt[0]?.n ?? 0) >= plan.team) throw new HttpError(402, `Your ${plan.label} plan includes ${plan.team} team members. Upgrade under Plan & billing to add more.`)
    }
    const { rows: existing } = await db.query<Row>('select id, shipper_id from users where email = $1', [email])
    if (existing[0] && existing[0].shipper_id && existing[0].shipper_id !== shipperId) throw new HttpError(409, 'That email already belongs to another company on Ntemtem.')
    const token = randomBytes(18).toString('base64url')
    const id = 'st_' + uid()
    await db.query(`insert into staff (id,shipper_id,user_id,name,email,phone,role,status,base,city,invite_token) values ($1,$2,$3,$4,$5,$6,$7,'invited',$8,$9,$10)`, [id, shipperId, null, b.name, email, b.phone, b.role, b.base, b.city, token])
    const { rows } = await db.query<Row>('select * from staff where id = $1', [id])
    res.status(201).json({ staff: staffOut(rows[0]) })
  }))
  r.patch('/team/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await staffOf(db, req, ...MANAGE)
    const { rows } = await db.query<Row>('select * from staff where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    const s = rows[0]; if (!s) throw new HttpError(404, 'Team member not found.')
    const b = zStaffPatch.parse(req.body)
    if ((s.role === 'owner' || b.role === 'owner') && me.role !== 'owner') throw new HttpError(403, 'Only an owner can change owners.')
    if (s.id === me.id && (b.status === 'inactive' || (b.role && b.role !== 'owner' && me.role === 'owner'))) {
      const { rows: owners } = await db.query<{ n: string }>(`select count(*)::text as n from staff where shipper_id = $1 and role = 'owner' and status = 'active' and id <> $2`, [shipperId, me.id])
      if (Number(owners[0].n) === 0) throw new HttpError(409, 'Add another owner before stepping down.')
    }
    if (b.perms) await db.query('update staff set perms = $2 where id = $1', [s.id, JSON.stringify(b.perms)])
    await db.query('update staff set role=$2, status=$3, phone=$4, base=$5, city=$6, name=$7 where id = $1', [s.id, b.role ?? s.role, b.status ?? (s.status === 'invited' ? 'invited' : s.status), b.phone ?? s.phone, b.base ?? s.base, b.city ?? s.city, b.name ?? s.name])
    if (b.status === 'inactive' && s.user_id) await db.query('delete from sessions where user_id = $1', [s.user_id])
    const { rows: out } = await db.query<Row>('select * from staff where id = $1', [s.id])
    res.json({ staff: staffOut(out[0]) })
  }))
  r.post('/team/:id/reinvite', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const { rows } = await db.query<Row>('select * from staff where id = $1 and shipper_id = $2', [req.params.id, shipperId])
    if (!rows[0]) throw new HttpError(404, 'Team member not found.')
    if (rows[0].status !== 'invited') throw new HttpError(409, 'This person has already joined.')
    const token = randomBytes(18).toString('base64url')
    await db.query('update staff set invite_token = $2 where id = $1', [rows[0].id, token])
    const { rows: out } = await db.query<Row>('select * from staff where id = $1', [rows[0].id])
    res.json({ staff: staffOut(out[0]) })
  }))
  // public: accept an invitation
  r.get('/join/:token', wrap(async (req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>('select s.name, s.email, s.role, s.status, sh.name as company from staff s join shippers sh on sh.id = s.shipper_id where s.invite_token = $1', [req.params.token])
    if (!rows[0] || rows[0].status !== 'invited') throw new HttpError(404, 'This invitation is no longer valid.')
    res.json({ invite: { name: rows[0].name, email: rows[0].email, role: rows[0].role, company: rows[0].company } })
  }))
  r.post('/join/:token', wrap(async (req, res) => {
    const db = await getDb(); const b = zJoin.parse(req.body)
    const { rows } = await db.query<Row>('select * from staff where invite_token = $1', [req.params.token])
    const s = rows[0]; if (!s || s.status !== 'invited') throw new HttpError(404, 'This invitation is no longer valid.')
    const { rows: ex } = await db.query<Row>('select * from users where email = $1', [s.email])
    let userId: string
    if (ex[0]) {
      if (ex[0].shipper_id && ex[0].shipper_id !== s.shipper_id) throw new HttpError(409, 'This email is already attached to another company.')
      if (!(await bcrypt.compare(b.password, ex[0].password_hash))) throw new HttpError(401, 'An account with this email exists — enter its password to link it.')
      userId = ex[0].id
      await db.query(`update users set role = 'shipper', shipper_id = $2 where id = $1`, [userId, s.shipper_id])
    } else {
      userId = uid()
      await db.query('insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,$5,$6)', [userId, s.email, b.name, await bcrypt.hash(b.password, 10), 'shipper', s.shipper_id])
    }
    await db.query(`update staff set user_id = $2, name = $3, status = 'active', invite_token = null where id = $1`, [s.id, userId, b.name])
    await createSession(db, res, userId)
    res.status(201).json({ user: await loadUserWithCompany(db, userId) })
  }))

  // ---- fleet
  r.get('/vehicles', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await staffOf(db, req); const { rows } = await db.query<Row>(`select * from vehicles where shipper_id = $1 order by status = 'retired', base, name`, [shipperId]); res.json({ vehicles: rows.map(vehicleOut) }) }))
  r.post('/vehicles', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const b = zVehicle.parse(req.body); const id = 'vh_' + uid()
    await db.query('insert into vehicles (id,shipper_id,name,type,plate,capacity_kg,capacity_note,base,city,country,status,driver_id,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [id, shipperId, b.name, b.type, b.plate, b.capacityKg ?? null, b.capacityNote, b.base, b.city, b.country, b.status, b.driverId ?? null, b.notes])
    const { rows } = await db.query<Row>('select * from vehicles where id = $1', [id]); res.status(201).json({ vehicle: vehicleOut(rows[0]) })
  }))
  r.patch('/vehicles/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const { rows } = await db.query<Row>('select * from vehicles where id = $1 and shipper_id = $2', [req.params.id, shipperId]); const v = rows[0]; if (!v) throw new HttpError(404, 'Vehicle not found.')
    const b = zVehicle.partial().parse(req.body)
    await db.query('update vehicles set name=$2, type=$3, plate=$4, capacity_kg=$5, capacity_note=$6, base=$7, city=$8, country=$9, status=$10, driver_id=$11, notes=$12 where id = $1',
      [v.id, b.name ?? v.name, b.type ?? v.type, b.plate ?? v.plate, b.capacityKg === undefined ? v.capacity_kg : b.capacityKg, b.capacityNote ?? v.capacity_note, b.base ?? v.base, b.city ?? v.city, b.country ?? v.country, b.status ?? v.status, b.driverId === undefined ? v.driver_id : b.driverId, b.notes ?? v.notes])
    const { rows: out } = await db.query<Row>('select * from vehicles where id = $1', [v.id]); res.json({ vehicle: vehicleOut(out[0]) })
  }))

  // ---- geocoding
  r.get('/geocode', wrap(async (req, res) => {
    const db = await getDb(); await staffOf(db, req)
    const q = String(req.query.q ?? '').slice(0, 200)
    if (q.trim().length < 3) throw new HttpError(400, 'Type at least 3 characters.')
    res.json({ result: await geocode(db, q) })
  }))

  // ---- route planning
  /** Shipments that can become stops: booked ones for pickup runs, arrived/customs/out-for-delivery ones for delivery runs. */
  r.get('/runs/candidates', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req)
    const kind = req.query.kind === 'pickup' ? 'pickup' : 'delivery'
    const statuses = kind === 'pickup' ? ['booked'] : ['arrived', 'customs', 'ready_for_collection', 'out_for_delivery']
    const { rows } = await db.query<Row>(`select s.*, c.name as client_name, c.phone as client_phone, c.city as client_city, cs.name as cons_name, cs.phone as cons_phone, cs.address as cons_address, cs.city as cons_city, cs.country as cons_country
      from shipments s left join clients c on c.id = s.client_id left join client_consignees cs on cs.id = s.consignee_id
      where s.shipper_id = $1 and s.status = any($2::text[]) and s.cancelled_at is null ${kind === 'delivery' ? `and coalesce(s.handover, 'delivery') = 'delivery'` : ''} and not exists (select 1 from run_stops st join runs r on r.id = st.run_id where st.shipment_id = s.id and r.status in ('planned','in_progress')) order by s.eta asc`, [shipperId, statuses])
    res.json({ candidates: rows.map((s) => ({
      shipmentId: s.id, ref: s.ref, mode: s.mode, status: s.status, description: s.description, eta: DATE(s.eta), readyAt: s.ready_at ? ISO(s.ready_at) : null, city: kind === 'pickup' ? s.origin : (s.cons_city || ''),
      label: kind === 'pickup' ? `${s.customer} · ${s.origin}` : `${s.cons_name || s.customer} · ${s.cons_city || countryByCode(s.destination)?.name || s.destination}`,
      address: kind === 'pickup' ? s.origin : [s.cons_address, s.cons_city, countryByCode(s.cons_country || s.destination)?.name].filter(Boolean).join(', '),
      contact: kind === 'pickup' ? s.customer : (s.cons_name || s.customer), phone: kind === 'pickup' ? (s.client_phone || '') : (s.cons_phone || s.client_phone || ''),
    })) })
  }))
  r.get('/runs', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await staffOf(db, req, 'owner', 'dispatcher', 'agent'); res.json({ runs: await loadRuns(db, 'r.shipper_id = $1', [shipperId]) }) }))
  r.get('/runs/mine', wrap(async (req, res) => { const db = await getDb(); const { shipperId, me } = await staffOf(db, req); res.json({ runs: await loadRuns(db, `r.shipper_id = $1 and r.driver_id = $2 and (r.status in ('planned','in_progress') or (r.status = 'done' and r.run_date >= current_date - 1))`, [shipperId, me.id]) }) }))
  /** Who a driver calls: the company's dispatchers and owners with a phone number. */
  r.get('/runs/dispatch', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req)
    const { rows } = await db.query<Row>(`select name, phone, role from staff where shipper_id = $1 and status = 'active' and role in ('dispatcher','owner') order by case role when 'dispatcher' then 0 else 1 end, name`, [shipperId])
    const { rows: co } = await db.query<Row>('select name, brand from shippers where id = $1', [shipperId]); const br = (J(co[0]?.brand) ?? {}) as { phone?: string; whatsapp?: string }
    res.json({ people: rows.map((x) => ({ name: x.name, phone: x.phone || '', role: x.role })), office: { name: co[0]?.name ?? '', phone: br.phone || '', whatsapp: br.whatsapp || '' } })
  }))
  /** "On my way": tells the customer (notification) and texts the person at the stop. */
  r.post('/runs/:id/stops/:sid/on-way', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id)); const st = run.stops.find((s) => s.id === req.params.sid); if (!st) throw new HttpError(404, 'Stop not found.')
    if (isDriverRole(role) && run.driverId !== me.id) throw new HttpError(403, 'Not your run.')
    const { minutes } = z.object({ minutes: z.number().int().min(1).max(600) }).parse(req.body)
    const { rows: co } = await db.query<Row>('select name from shippers where id = $1', [shipperId])
    const first = me.name.split(' ')[0]; const company = co[0]?.name ?? 'your shipper'
    const text = `${first} from ${company} is on the way${run.kind === 'pickup' ? ' to collect your shipment' : ' with your delivery'}${st.shipmentRef ? ` (${st.shipmentRef})` : ''} — about ${minutes} minutes away.`
    let texted = false
    const to = st.phone ? normalisePhone(st.phone, 'US') ?? normalisePhone(st.phone, 'GH') : null
    if (to && smsProvider().id !== 'off') { try { await sendText(to, text); texted = true } catch (e) { console.error('[on-way] text', e) } }
    let told = false
    if (st.shipmentId) {
      const { rows } = await db.query<Row>('select id, ref, status, user_id from shipments where id = $1', [st.shipmentId]); const sh = rows[0]
      if (sh) {
        await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, st.label || '', `Driver ${first} is on the way — about ${minutes} minutes.`])
        if (sh.user_id) { await notify(db, { userId: sh.user_id, kind: 'shipment_status', title: `${sh.ref}: driver on the way — about ${minutes} min`, body: text, link: `/dashboard?tab=shipments&open=${sh.id}`, dedupe: `onway:${st.id}:${Math.floor(Date.now() / 600000)}` }); told = true }
      }
    }
    await db.query('update run_stops set on_way_at = now() where id = $1', [st.id])
    res.json({ ok: true, texted, told, text })
  }))
  /** End of the day: the driver sends dispatch a short summary of the run. */
  r.post('/runs/:id/summary', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id))
    if (isDriverRole(role) && run.driverId !== me.id) throw new HttpError(403, 'Not your run.')
    const { note } = z.object({ note: z.string().trim().max(500).default('') }).parse(req.body ?? {})
    const body = await sendRunSummary(db, run, shipperId, me.name, note)
    res.json({ ok: true, body })
  }))
  r.post('/runs', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await staffOf(db, req, ...MANAGE)
    const b = zRun.parse(req.body); const id = 'run_' + uid()
    await assertDriverFits(db, shipperId, b.driverId, b.kind, b.date)
    for (const st of b.stops) if (st.shipmentId) { const { rows } = await db.query('select 1 from shipments where id = $1 and shipper_id = $2', [st.shipmentId, shipperId]); if (!rows.length) throw new HttpError(400, 'A stop refers to a shipment that is not yours.') }
    const order = optimiseOrder(b.start ?? null, b.stops)
    await db.query('insert into runs (id,shipper_id,name,kind,run_date,driver_id,vehicle_id,start_label,start_lat,start_lon,notes,distance_km) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, shipperId, b.name, b.kind, b.date, b.driverId ?? null, b.vehicleId ?? null, b.start?.label ?? '', b.start?.lat ?? null, b.start?.lon ?? null, b.notes, runDistance(b.start ?? null, order.map((i) => b.stops[i]))])
    for (const [seq, i] of order.entries()) { const st = b.stops[i]; await db.query('insert into run_stops (id,run_id,seq,shipment_id,label,address,lat,lon,contact,phone) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['stp_' + uid(), id, seq, st.shipmentId ?? null, st.label, st.address, st.lat ?? null, st.lon ?? null, st.contact, st.phone]) }
    void me
    res.status(201).json({ run: await ownRun(db, shipperId, id) })
  }))
  r.patch('/runs/:id', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id))
    const b = zRunPatch.parse(req.body)
    const isDriver = isDriverRole(role)
    if (isDriver && (run.driverId !== me.id || Object.keys(b).some((k) => k !== 'status') || (b.status && !['in_progress', 'done'].includes(b.status)))) throw new HttpError(403, 'Drivers can only start or finish their own runs.')
    if (!isDriver && !MANAGE.includes(role)) throw new HttpError(403, 'This needs the owner or dispatcher role.')
    if (b.driverId) await assertDriverFits(db, shipperId, b.driverId, run.kind, b.date ?? run.date ?? undefined)
    await db.query('update runs set name=$2, run_date=$3, driver_id=$4, vehicle_id=$5, status=$6, notes=$7, start_label=$8, start_lat=$9, start_lon=$10 where id = $1',
      [run.id, b.name ?? run.name, b.date ?? run.date, b.driverId === undefined ? run.driverId ?? null : b.driverId, b.vehicleId === undefined ? run.vehicleId ?? null : b.vehicleId, b.status ?? run.status, b.notes ?? run.notes, b.start === undefined ? run.start?.label ?? '' : b.start?.label ?? '', b.start === undefined ? run.start?.lat ?? null : b.start?.lat ?? null, b.start === undefined ? run.start?.lon ?? null : b.start?.lon ?? null])
    if (b.status === 'in_progress') {
      if (run.vehicleId) await db.query(`update vehicles set status = 'on_run' where id = $1 and status = 'available'`, [run.vehicleId])
      // Delivery run starting → shipments are out for delivery.
      if (run.kind === 'delivery') for (const st of run.stops) if (st.shipmentId && st.shipmentStatus && ['arrived', 'customs', 'ready_for_collection'].includes(st.shipmentStatus)) await setShipmentStatus(db, st.shipmentId, 'out_for_delivery', `Out for delivery on run “${run.name}”.`)
      if (run.kind === 'delivery' && run.status !== 'in_progress') { const { issueDeliveryCodes } = await import('./driverOps'); await issueDeliveryCodes(db, run.id).catch((e) => console.error('[codes]', e)) }
    }
    if (b.status === 'done' || b.status === 'cancelled') { if (run.vehicleId) await db.query(`update vehicles set status = 'available' where id = $1 and status = 'on_run'`, [run.vehicleId]) }
    // Starting a run clocks the driver in if they forgot.
    let clockedIn = false
    if (isDriver && b.status === 'in_progress' && run.status !== 'in_progress' && !String(me.id).startsWith('owner:')) {
      const { rows: open } = await db.query('select 1 from shifts where staff_id = $1 and end_at is null limit 1', [me.id])
      if (!open.length) { await db.query('insert into shifts (id,shipper_id,staff_id) values ($1,$2,$3)', ['sh_' + uid(), shipperId, me.id]); clockedIn = true }
    }
    res.json({ run: await ownRun(db, shipperId, run.id), clockedIn })
  }))
  r.post('/runs/:id/optimise', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const run = await ownRun(db, shipperId, String(req.params.id))
    const pending = run.stops.filter((s) => s.status === 'pending'); const done = run.stops.filter((s) => s.status !== 'pending')
    const order = optimiseOrder(run.start, pending)
    let seq = 0
    for (const s of done) await db.query('update run_stops set seq = $2 where id = $1', [s.id, seq++])
    for (const i of order) await db.query('update run_stops set seq = $2 where id = $1', [pending[i].id, seq++])
    await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(run.start, [...done, ...order.map((i) => pending[i])])])
    if (run.status === 'in_progress') { const { notifyDriver } = await import('./driverOps'); await notifyDriver(db, run.id, `Your stops on “${run.name}” were reordered`, 'Open your run for the new order.').catch(() => {}) }
    res.json({ run: await ownRun(db, shipperId, run.id) })
  }))
  /** Driver: put the stops still to do in the shortest order from where they are now. */
  r.post('/runs/:id/reorder-from', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id))
    if (isDriverRole(role) && run.driverId !== me.id) throw new HttpError(403, 'Not your run.')
    if (!isDriverRole(role) && !MANAGE.includes(role)) throw new HttpError(403, 'This needs the owner or dispatcher role.')
    if (run.status === 'done' || run.status === 'cancelled') throw new HttpError(409, 'This run is finished.')
    const at = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).parse(req.body)
    const pending = run.stops.filter((s) => s.status === 'pending'); const done = run.stops.filter((s) => s.status !== 'pending')
    if (pending.filter((s) => s.lat != null && s.lon != null).length < 2) throw new HttpError(400, 'Not enough stops with a map location to reorder.')
    const order = optimiseOrder(at, pending)
    const before = pending.map((s) => s.id).join(); const after = order.map((i) => pending[i].id).join()
    let seq = 0
    for (const s of done) await db.query('update run_stops set seq = $2 where id = $1', [s.id, seq++])
    for (const i of order) await db.query('update run_stops set seq = $2 where id = $1', [pending[i].id, seq++])
    await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(run.start, [...done, ...order.map((i) => pending[i])])])
    if (before !== after && isDriverRole(role)) await notifyShipperStaff(db, shipperId, { kind: 'shipment_status', title: `${me.name} reordered the stops on “${run.name}”`, body: `Next: ${pending[order[0]].label}. Customers’ time windows weren’t changed.`, link: `/dashboard/routes/${run.id}`, dedupe: `reorder:${run.id}:${after}` }, ['owner', 'dispatcher']).catch(() => {})
    res.json({ run: await ownRun(db, shipperId, run.id), changed: before !== after })
  }))
  r.post('/runs/:id/stops', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const run = await ownRun(db, shipperId, String(req.params.id)); const b = zStopIn.parse(req.body)
    await db.query('insert into run_stops (id,run_id,seq,shipment_id,label,address,lat,lon,contact,phone) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['stp_' + uid(), run.id, run.stops.length, b.shipmentId ?? null, b.label, b.address, b.lat ?? null, b.lon ?? null, b.contact, b.phone])
    const updated = await ownRun(db, shipperId, run.id)
    await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(updated.start, updated.stops)])
    if (run.status === 'in_progress' || run.status === 'planned') { const { notifyDriver, issueDeliveryCodes } = await import('./driverOps'); if (run.status === 'in_progress' && run.kind === 'delivery') await issueDeliveryCodes(db, run.id).catch(() => {}); await notifyDriver(db, run.id, `New stop on “${run.name}”: ${b.label}`, b.address || 'Open your run to see it.').catch(() => {}) }
    res.status(201).json({ run: await ownRun(db, shipperId, run.id) })
  }))
  r.patch('/runs/:id/stops/:sid', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id)); const st = run.stops.find((s) => s.id === req.params.sid); if (!st) throw new HttpError(404, 'Stop not found.')
    const b = zStopPatch.parse(req.body)
    if (isDriverRole(role) && (run.driverId !== me.id || Object.keys(b).some((k) => !DRIVER_STOP_KEYS.includes(k)))) throw new HttpError(403, 'Drivers can only mark their own stops.')
    if (role === 'agent') throw new HttpError(403, 'Agents cannot edit runs.')
    // Delivery code: the receiver got 4 digits by text. Closing the stop needs the code, an ID check, or a "left with" + photo.
    const { rows: raw } = await db.query<Row>('select code, code_ok, phone from run_stops where id = $1', [st.id])
    if (b.status === 'done' && st.status !== 'done' && run.kind === 'delivery' && raw[0]?.code && !raw[0].code_ok && isDriverRole(role)) {
      if (b.code) { if (b.code !== raw[0].code) throw new HttpError(400, 'That code doesn’t match. Ask the receiver to check their texts, or check their ID instead.'); await db.query('update run_stops set code_ok = true where id = $1', [st.id]) }
      else if (b.idCheck) await db.query('update run_stops set id_check = $2 where id = $1', [st.id, JSON.stringify({ ...b.idCheck, last4: b.idCheck.last4.toUpperCase(), by: me.name, at: new Date().toISOString() })])
      else if (b.leftWith) { if (!b.photo) throw new HttpError(400, 'Take a photo of where you left it.') }
      else throw new HttpError(400, 'Enter the 4-digit delivery code the receiver got by text, or check their ID.')
    } else if (b.idCheck) await db.query('update run_stops set id_check = $2 where id = $1', [st.id, JSON.stringify({ ...b.idCheck, last4: b.idCheck.last4.toUpperCase(), by: me.name, at: new Date().toISOString() })])
    // Money taken at the door goes onto the shipment's open invoices (oldest first) before any release check.
    if (b.collected && st.shipmentId) {
      let left = b.collected.amountUsd
      const { rows: invs } = await db.query<Row>(`select i.*, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)::numeric as paid from invoices i where i.shipment_id = $1 and i.status in ('draft','sent','partial') order by i.created_at asc`, [st.shipmentId])
      for (const inv of invs) {
        if (left <= 0) break
        const due = Math.max(0, Number(inv.total) - Number(inv.paid)); if (!due) continue
        const pay = Math.min(due, left); left -= pay
        await db.query('insert into payments (id,invoice_id,amount,method,at,note) values ($1,$2,$3,$4,current_date,$5)', ['pay_' + uid(), inv.id, Math.round(pay * 100) / 100, b.collected.method, `Collected at the door by ${me.name}`])
        await db.query(`update invoices set status = $2 where id = $1`, [inv.id, pay >= due ? 'paid' : 'partial'])
      }
      await db.query('update run_stops set collected = $2 where id = $1', [st.id, JSON.stringify({ method: b.collected.method, amountUsd: b.collected.amountUsd, at: new Date().toISOString(), by: me.name, unapplied: Math.round(left * 100) / 100 })])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [st.shipmentId, st.shipmentStatus ?? 'out_for_delivery', st.label || '', `$${b.collected.amountUsd.toLocaleString()} collected ${({ cash: 'in cash', mobile_money: 'by mobile money', zelle: 'by Zelle', card: 'by card' } as Record<string, string>)[b.collected.method]} by ${me.name}.`])
    }
    // "Try again later today": the stop goes to the back of the run instead of closing.
    if (b.status === 'skipped' && b.retry) {
      const last = Math.max(...run.stops.map((x) => x.seq)) + 1
      const why = b.skipReason ? SKIP_REASONS[b.skipReason] : 'Skipped'
      await db.query(`update run_stops set seq = $2, skip_reason = $3, tries = tries + 1, note = $4 where id = $1`, [st.id, last, b.skipReason ?? 'other', `${why}${b.note ? ` — ${b.note}` : ''} · trying again later`])
      await notifyShipperStaff(db, shipperId, { kind: 'shipment_status', title: `${me.name} will retry ${st.label} later`, body: `${why}${b.note ? ` — ${b.note}` : ''}. Moved to the end of “${run.name}”.`, link: `/dashboard/routes/${run.id}` }, ['owner', 'dispatcher']).catch(() => {})
      res.json({ run: await ownRun(db, shipperId, run.id) }); return
    }
    if (b.status === 'skipped' && st.status !== 'skipped') {
      const why = b.skipReason ? SKIP_REASONS[b.skipReason] : 'Skipped'
      await db.query('update run_stops set skip_reason = $2 where id = $1', [st.id, b.skipReason ?? 'other'])
      b.note = `${why}${b.note ? ` — ${b.note}` : ''}`
      if (isDriverRole(role)) await notifyShipperStaff(db, shipperId, { kind: 'shipment_status', title: `${me.name} skipped ${st.label}`, body: `${b.note}. On “${run.name}”.`, link: `/dashboard/routes/${run.id}` }, ['owner', 'dispatcher']).catch(() => {})
    }
    if (b.status === 'done' && (b.receivedBy || b.photo || b.signature || b.pieces != null || b.leftWith)) await db.query('update run_stops set pod = $2 where id = $1', [st.id, JSON.stringify({ receivedBy: b.receivedBy ?? '', photo: b.photo, signature: b.signature, pieces: b.pieces, by: me.name, at: new Date().toISOString(), leftWith: b.leftWith })])
    // Left with a neighbour / the gate: tell the receiver where it is.
    if (b.status === 'done' && b.leftWith && st.status !== 'done' && raw[0]?.phone) {
      const n = normalisePhone(raw[0].phone, 'GH') ?? normalisePhone(raw[0].phone, 'US')
      if (n && smsProvider().id !== 'off') await sendText(n, `Your delivery${st.shipmentRef ? ` ${st.shipmentRef}` : ''} was left with ${LEFT_WITH[b.leftWith.kind]}${b.leftWith.name ? ` (${b.leftWith.name})` : ''} by ${me.name.split(' ')[0]}. A photo is on file. Call us if anything is wrong.`).catch((e) => console.error('[leftWith] text', e))
    }
    await db.query('update run_stops set status=$2, note=$3, seq=$4, lat=$5, lon=$6, label=$7, address=$8, contact=$9, phone=$10, done_at = case when $2 = \'done\' then coalesce(done_at, now()) else null end where id = $1',
      [st.id, b.status ?? st.status, b.note ?? st.note, b.seq ?? st.seq, b.lat ?? st.lat ?? null, b.lon ?? st.lon ?? null, b.label ?? st.label, b.address ?? st.address, b.contact ?? st.contact, b.phone ?? st.phone])
    // Completed stops move the shipment along and show up on the customer's tracking page.
    if (b.status === 'done' && st.shipmentId && st.status !== 'done' && run.kind !== 'pickup') {
      // Money first: with "block unpaid" on, the stop can't close until it's settled (office can override with a reason).
      const { rows: sh } = await db.query<Row>('select * from shipments where id = $1', [st.shipmentId])
      if (sh[0]) await assertRelease(db, sh[0], { by: me.name, byRole: role, override: !isDriverRole(role) && req.body?.override?.reason ? { reason: String(req.body.override.reason).slice(0, 200) } : null })
    }
    if (b.status === 'done' && st.shipmentId && st.status !== 'done') {
      const proof = [b.pieces != null ? `${b.pieces} piece${b.pieces === 1 ? '' : 's'}` : '', b.photo ? 'photo on file' : '', b.signature ? 'signed' : ''].filter(Boolean).join(', ')
      if (run.kind === 'pickup') await setShipmentStatus(db, st.shipmentId, 'picked_up', `Collected by ${me.name}${proof ? ` (${proof})` : ''}${b.note ? ` — ${b.note}` : '.'}`)
      else await setShipmentStatus(db, st.shipmentId, 'delivered', `Delivered${b.leftWith ? ` — left with ${LEFT_WITH[b.leftWith.kind]}${b.leftWith.name ? ` (${b.leftWith.name})` : ''}` : b.receivedBy ? ` to ${b.receivedBy}` : ''}${b.idCheck ? ` (${ID_TYPES[b.idCheck.type]} checked)` : b.code ? ' (delivery code matched)' : ''} by ${me.name}${proof ? ` (${proof})` : ''}${b.note ? ` — ${b.note}` : '.'}`)
    }
    const updated = await ownRun(db, shipperId, run.id)
    if (b.lat != null || b.lon != null || b.seq != null) await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(updated.start, updated.stops)])
    if (updated.stops.length && updated.stops.every((s) => s.status !== 'pending') && updated.status === 'in_progress') { await db.query(`update runs set status = 'done' where id = $1`, [run.id]); if (run.vehicleId) await db.query(`update vehicles set status = 'available' where id = $1 and status = 'on_run'`, [run.vehicleId]) }
    res.json({ run: await ownRun(db, shipperId, run.id) })
  }))
  /** Driver on the road: "running ~N minutes late" — every customer with a pending stop on this run is told, once per message. */
  r.post('/runs/:id/late', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id))
    if (isDriverRole(role) && run.driverId !== me.id) throw new HttpError(403, 'Not your run.')
    const b = z.object({ minutes: z.number().int().min(5).max(480), note: z.string().trim().max(200).default('') }).parse(req.body)
    const pending = run.stops.filter((st) => st.status === 'pending' && st.shipmentId)
    let told = 0
    for (const st of pending) {
      const { rows } = await db.query<Row>('select id, ref, user_id, status from shipments where id = $1', [st.shipmentId]); const sh = rows[0]; if (!sh) continue
      const human = b.minutes >= 60 ? `${Math.round(b.minutes / 60 * 10) / 10} hour${b.minutes >= 90 ? 's' : ''}` : `${b.minutes} minutes`
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sh.id, sh.status, st.label || '', `Driver ${me.name} is running about ${human} late${b.note ? ` — ${b.note}` : '.'}`])
      if (sh.user_id) { await notify(db, { userId: sh.user_id, kind: 'shipment_status', title: `${sh.ref}: your ${run.kind === 'pickup' ? 'pickup' : 'delivery'} is running about ${human} late`, body: `${me.name} will be there as soon as possible${b.note ? ` — ${b.note}` : '.'} You'll get another update when they're close.`, link: `/dashboard?tab=shipments&open=${sh.id}`, dedupe: `late:${run.id}:${sh.id}:${Date.now().toString().slice(0, -5)}` }); told++ }
    }
    await db.query('update runs set notes = $2 where id = $1', [run.id, `${run.notes ? run.notes + '\n' : ''}${new Date().toISOString().slice(11, 16)} running ~${b.minutes} min late${b.note ? ` — ${b.note}` : ''}`])
    res.json({ ok: true, told, pending: pending.length })
  }))
  r.delete('/runs/:id/stops/:sid', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const run = await ownRun(db, shipperId, String(req.params.id))
    await db.query('delete from run_stops where id = $1 and run_id = $2', [req.params.sid, run.id])
    const updated = await ownRun(db, shipperId, run.id)
    await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(updated.start, updated.stops)])
    res.json({ run: await ownRun(db, shipperId, run.id) })
  }))
  void loadShipments

  /** Advance a shipment to a given status (only forwards), writing the tracking event. */
  async function setShipmentStatus(db: Db, shipmentId: string, target: ShipmentStatus, note: string) {
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) return
    if (statusOrder.indexOf(target) <= statusOrder.indexOf(s.status as ShipmentStatus)) return
    await db.query('update shipments set status = $2 where id = $1', [s.id, target])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, target, statusOrder.indexOf(target) < 3 ? s.origin : (countryByCode(s.destination)?.name ?? s.destination), note])
    if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} moved to “${statusLabels[target]}” — ${note}`])
    await notifyShipmentStatus(db, s, target, note)
  }
}
