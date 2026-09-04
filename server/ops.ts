/**
 * Operations for shippers: team & roles, fleet, and route planning (pickup runs at the origin, delivery runs to
 * consignees in West Africa). Staff sign in as normal users linked to the company; what they may do depends on their role.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'
import { distanceKm } from '../src/lib/geo'

type Row = Record<string, any>
export type StaffRole = 'owner' | 'dispatcher' | 'agent' | 'driver'
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
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const num = (v: unknown) => (v == null ? undefined : Number(v))

export const staffOut = (r: Row) => ({ id: r.id, shipperId: r.shipper_id, userId: r.user_id ?? undefined, name: r.name, email: r.email, phone: r.phone, role: r.role as StaffRole, status: r.status as 'invited' | 'active' | 'inactive', base: r.base as 'origin' | 'destination', city: r.city, inviteToken: r.invite_token ?? undefined, createdAt: ISO(r.created_at), runCount: r.run_count != null ? Number(r.run_count) : undefined })
const vehicleOut = (r: Row) => ({ id: r.id, name: r.name, type: r.type, plate: r.plate, capacityKg: num(r.capacity_kg), capacityNote: r.capacity_note, base: r.base as 'origin' | 'destination', city: r.city, country: r.country, status: r.status as 'available' | 'on_run' | 'maintenance' | 'retired', driverId: r.driver_id ?? undefined, notes: r.notes, createdAt: ISO(r.created_at) })
const stopOut = (r: Row) => ({ id: r.id, runId: r.run_id, seq: Number(r.seq), shipmentId: r.shipment_id ?? undefined, label: r.label, address: r.address, lat: num(r.lat), lon: num(r.lon), contact: r.contact, phone: r.phone, status: r.status as 'pending' | 'done' | 'skipped', doneAt: r.done_at ? ISO(r.done_at) : undefined, note: r.note, shipmentRef: r.shipment_ref ?? undefined, shipmentStatus: r.shipment_status ?? undefined })
const runOut = (r: Row, stops: Row[]) => ({
  id: r.id, name: r.name, kind: r.kind as 'pickup' | 'delivery', date: DATE(r.run_date), driverId: r.driver_id ?? undefined, vehicleId: r.vehicle_id ?? undefined,
  start: r.start_lat != null ? { label: r.start_label, lat: Number(r.start_lat), lon: Number(r.start_lon) } : null,
  status: r.status as 'planned' | 'in_progress' | 'done' | 'cancelled', distanceKm: num(r.distance_km), notes: r.notes, createdAt: ISO(r.created_at),
  stops: stops.map(stopOut), driverName: r.driver_name ?? undefined, vehicleName: r.vehicle_name ?? undefined,
})

/* ---------------- schemas ---------------- */
const zRole = z.enum(['owner', 'dispatcher', 'agent', 'driver'])
const zBase = z.enum(['origin', 'destination'])
const zInvite = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email('Enter a valid email.'), phone: z.string().trim().max(30).default(''), role: zRole.default('agent'), base: zBase.default('origin'), city: z.string().trim().max(60).default('') })
const zStaffPatch = z.object({ role: zRole.optional(), status: z.enum(['active', 'inactive']).optional(), phone: z.string().trim().max(30).optional(), base: zBase.optional(), city: z.string().trim().max(60).optional(), name: z.string().trim().min(2).max(80).optional() })
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
const zStopPatch = z.object({ status: z.enum(['pending', 'done', 'skipped']).optional(), note: z.string().trim().max(500).optional(), seq: z.number().int().min(0).optional(), lat: z.number().optional(), lon: z.number().optional(), label: z.string().trim().min(1).max(120).optional(), address: z.string().trim().max(240).optional(), contact: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional() })

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
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'ShipSync route planner (+https://github.com/mnfrimpong20/ship-sync)' } })
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
  const loadRuns = async (db: Db, where: string, params: unknown[]) => {
    const { rows } = await db.query<Row>(`select r.*, s.name as driver_name, v.name as vehicle_name from runs r left join staff s on s.id = r.driver_id left join vehicles v on v.id = r.vehicle_id where ${where} order by r.run_date desc, r.created_at desc`, params)
    if (!rows.length) return []
    const { rows: stops } = await db.query<Row>(`select st.*, sh.ref as shipment_ref, sh.status as shipment_status from run_stops st left join shipments sh on sh.id = st.shipment_id where st.run_id = any($1::text[]) order by st.seq asc`, [rows.map((x) => x.id)])
    return rows.map((x) => runOut(x, stops.filter((s) => s.run_id === x.id)))
  }
  const ownRun = async (db: Db, shipperId: string, id: string) => { const [run] = await loadRuns(db, 'r.id = $1 and r.shipper_id = $2', [id, shipperId]); if (!run) throw new HttpError(404, 'Run not found.'); return run }

  // ---- me (role for the UI)
  r.get('/team/me', wrap(async (req, res) => { const db = await getDb(); const { me } = await staffOf(db, req); res.json({ staff: staffOut(me) }) }))

  // ---- team
  r.get('/team', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req)
    const { rows } = await db.query<Row>(`select s.*, (select count(*) from runs r where r.driver_id = s.id)::int as run_count from staff s where s.shipper_id = $1 order by case s.role when 'owner' then 0 when 'dispatcher' then 1 when 'agent' then 2 else 3 end, s.name`, [shipperId])
    res.json({ team: rows.map(staffOut) })
  }))
  r.post('/team/invite', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await staffOf(db, req, ...MANAGE)
    const b = zInvite.parse(req.body)
    if (b.role === 'owner' && me.role !== 'owner') throw new HttpError(403, 'Only an owner can add another owner.')
    const email = b.email.toLowerCase()
    const { rows: dup } = await db.query('select 1 from staff where shipper_id = $1 and email = $2', [shipperId, email])
    if (dup.length) throw new HttpError(409, 'That person is already on your team.')
    const { rows: existing } = await db.query<Row>('select id, shipper_id from users where email = $1', [email])
    if (existing[0] && existing[0].shipper_id && existing[0].shipper_id !== shipperId) throw new HttpError(409, 'That email already belongs to another company on Ship Sync.')
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
    const statuses = kind === 'pickup' ? ['booked'] : ['arrived', 'customs', 'out_for_delivery']
    const { rows } = await db.query<Row>(`select s.*, c.name as client_name, c.phone as client_phone, c.city as client_city, cs.name as cons_name, cs.phone as cons_phone, cs.address as cons_address, cs.city as cons_city, cs.country as cons_country
      from shipments s left join clients c on c.id = s.client_id left join client_consignees cs on cs.id = s.consignee_id
      where s.shipper_id = $1 and s.status = any($2::text[]) and not exists (select 1 from run_stops st join runs r on r.id = st.run_id where st.shipment_id = s.id and r.status in ('planned','in_progress')) order by s.eta asc`, [shipperId, statuses])
    res.json({ candidates: rows.map((s) => ({
      shipmentId: s.id, ref: s.ref, mode: s.mode, status: s.status, description: s.description, eta: DATE(s.eta),
      label: kind === 'pickup' ? `${s.customer} · ${s.origin}` : `${s.cons_name || s.customer} · ${s.cons_city || countryByCode(s.destination)?.name || s.destination}`,
      address: kind === 'pickup' ? s.origin : [s.cons_address, s.cons_city, countryByCode(s.cons_country || s.destination)?.name].filter(Boolean).join(', '),
      contact: kind === 'pickup' ? s.customer : (s.cons_name || s.customer), phone: kind === 'pickup' ? (s.client_phone || '') : (s.cons_phone || s.client_phone || ''),
    })) })
  }))
  r.get('/runs', wrap(async (req, res) => { const db = await getDb(); const { shipperId } = await staffOf(db, req, 'owner', 'dispatcher', 'agent'); res.json({ runs: await loadRuns(db, 'r.shipper_id = $1', [shipperId]) }) }))
  r.get('/runs/mine', wrap(async (req, res) => { const db = await getDb(); const { shipperId, me } = await staffOf(db, req); res.json({ runs: await loadRuns(db, `r.shipper_id = $1 and r.driver_id = $2 and r.status in ('planned','in_progress')`, [shipperId, me.id]) }) }))
  r.post('/runs', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me } = await staffOf(db, req, ...MANAGE)
    const b = zRun.parse(req.body); const id = 'run_' + uid()
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
    const isDriver = role === 'driver'
    if (isDriver && (run.driverId !== me.id || Object.keys(b).some((k) => k !== 'status') || (b.status && !['in_progress', 'done'].includes(b.status)))) throw new HttpError(403, 'Drivers can only start or finish their own runs.')
    if (!isDriver && !MANAGE.includes(role)) throw new HttpError(403, 'This needs the owner or dispatcher role.')
    await db.query('update runs set name=$2, run_date=$3, driver_id=$4, vehicle_id=$5, status=$6, notes=$7, start_label=$8, start_lat=$9, start_lon=$10 where id = $1',
      [run.id, b.name ?? run.name, b.date ?? run.date, b.driverId === undefined ? run.driverId ?? null : b.driverId, b.vehicleId === undefined ? run.vehicleId ?? null : b.vehicleId, b.status ?? run.status, b.notes ?? run.notes, b.start === undefined ? run.start?.label ?? '' : b.start?.label ?? '', b.start === undefined ? run.start?.lat ?? null : b.start?.lat ?? null, b.start === undefined ? run.start?.lon ?? null : b.start?.lon ?? null])
    if (b.status === 'in_progress') {
      if (run.vehicleId) await db.query(`update vehicles set status = 'on_run' where id = $1 and status = 'available'`, [run.vehicleId])
      // Delivery run starting → shipments are out for delivery.
      if (run.kind === 'delivery') for (const st of run.stops) if (st.shipmentId && st.shipmentStatus && ['arrived', 'customs'].includes(st.shipmentStatus)) await setShipmentStatus(db, st.shipmentId, 'out_for_delivery', `Out for delivery on run “${run.name}”.`)
    }
    if (b.status === 'done' || b.status === 'cancelled') { if (run.vehicleId) await db.query(`update vehicles set status = 'available' where id = $1 and status = 'on_run'`, [run.vehicleId]) }
    res.json({ run: await ownRun(db, shipperId, run.id) })
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
    res.json({ run: await ownRun(db, shipperId, run.id) })
  }))
  r.post('/runs/:id/stops', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId } = await staffOf(db, req, ...MANAGE)
    const run = await ownRun(db, shipperId, String(req.params.id)); const b = zStopIn.parse(req.body)
    await db.query('insert into run_stops (id,run_id,seq,shipment_id,label,address,lat,lon,contact,phone) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['stp_' + uid(), run.id, run.stops.length, b.shipmentId ?? null, b.label, b.address, b.lat ?? null, b.lon ?? null, b.contact, b.phone])
    const updated = await ownRun(db, shipperId, run.id)
    await db.query('update runs set distance_km = $2 where id = $1', [run.id, runDistance(updated.start, updated.stops)])
    res.status(201).json({ run: await ownRun(db, shipperId, run.id) })
  }))
  r.patch('/runs/:id/stops/:sid', wrap(async (req, res) => {
    const db = await getDb(); const { shipperId, me, role } = await staffOf(db, req)
    const run = await ownRun(db, shipperId, String(req.params.id)); const st = run.stops.find((s) => s.id === req.params.sid); if (!st) throw new HttpError(404, 'Stop not found.')
    const b = zStopPatch.parse(req.body)
    if (role === 'driver' && (run.driverId !== me.id || Object.keys(b).some((k) => !['status', 'note'].includes(k)))) throw new HttpError(403, 'Drivers can only mark their own stops.')
    if (role === 'agent') throw new HttpError(403, 'Agents cannot edit runs.')
    await db.query('update run_stops set status=$2, note=$3, seq=$4, lat=$5, lon=$6, label=$7, address=$8, contact=$9, phone=$10, done_at = case when $2 = \'done\' then coalesce(done_at, now()) else null end where id = $1',
      [st.id, b.status ?? st.status, b.note ?? st.note, b.seq ?? st.seq, b.lat ?? st.lat ?? null, b.lon ?? st.lon ?? null, b.label ?? st.label, b.address ?? st.address, b.contact ?? st.contact, b.phone ?? st.phone])
    // Completed stops move the shipment along and show up on the customer's tracking page.
    if (b.status === 'done' && st.shipmentId && st.status !== 'done') {
      if (run.kind === 'pickup') await setShipmentStatus(db, st.shipmentId, 'picked_up', `Collected by ${me.name}${b.note ? ` — ${b.note}` : '.'}`)
      else await setShipmentStatus(db, st.shipmentId, 'delivered', `Delivered by ${me.name}${b.note ? ` — ${b.note}` : '.'}`)
    }
    const updated = await ownRun(db, shipperId, run.id)
    if (updated.stops.length && updated.stops.every((s) => s.status !== 'pending') && updated.status === 'in_progress') { await db.query(`update runs set status = 'done' where id = $1`, [run.id]); if (run.vehicleId) await db.query(`update vehicles set status = 'available' where id = $1 and status = 'on_run'`, [run.vehicleId]) }
    res.json({ run: await ownRun(db, shipperId, run.id) })
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
  }
}
