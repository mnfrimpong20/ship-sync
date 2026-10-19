/**
 * Consolidation — "fill a barrel". A shipper opens a shared slot on a lane: one barrel that several
 * people fill with bags and boxes, or a container that several people fill with barrels. Customers
 * reserve units, the fill bar climbs, and when the shipper closes the slot every spot becomes a
 * normal shipment (ref, tracking, payment, pickup, labels, documents all apply) grouped under the slot.
 *
 *   customer  browse open slots on /groupage (or the quote flow) → reserve N units → pay once booked
 *   shipper   open a slot (lane, kind, capacity, price per unit, closing date) → watch it fill → close → book everyone
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import { uid, makeRef, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { attachShipmentToClient } from './clients'
import { countryByCode } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10))

export const GROUPAGE_KINDS = {
  barrel: { label: 'Shared barrel', unit: 'bag or box', unitPlural: 'bags / boxes', defaultCapacity: 8, cargo: 'boxes', hint: 'One 55-gallon barrel shared by several people — pay per bag or box.' },
  container20: { label: 'Shared 20 ft container', unit: 'barrel', unitPlural: 'barrels', defaultCapacity: 80, cargo: 'barrels', hint: 'Put your own barrels in a container that several people share.' },
  container40: { label: 'Shared 40 ft container', unit: 'barrel', unitPlural: 'barrels', defaultCapacity: 160, cargo: 'barrels', hint: 'Put your own barrels in a container that several people share.' },
} as const
export type GroupageKind = keyof typeof GROUPAGE_KINDS

export const groupageOut = (g: Row) => {
  const reserved = Number(g.reserved ?? 0), capacity = Number(g.capacity)
  return {
    id: g.id, shipperId: g.shipper_id, shipperName: g.shipper_name ?? undefined, shipperHue: g.shipper_hue ?? undefined, shipperInitials: g.shipper_initials ?? undefined, shipperVerified: g.shipper_verified ?? undefined,
    kind: g.kind as GroupageKind, kindLabel: GROUPAGE_KINDS[g.kind as GroupageKind]?.label ?? g.kind, unit: GROUPAGE_KINDS[g.kind as GroupageKind]?.unit ?? 'unit', unitPlural: GROUPAGE_KINDS[g.kind as GroupageKind]?.unitPlural ?? 'units',
    title: g.title, origin: g.origin, destination: g.destination, destinationName: countryByCode(g.destination)?.name ?? g.destination, destinationCity: g.destination_city ?? '',
    capacity, reserved, left: Math.max(0, capacity - reserved), fillPct: capacity ? Math.min(100, Math.round((reserved / capacity) * 100)) : 0, participants: Number(g.participants ?? 0),
    pricePerUnitUsd: Number(g.price_per_unit_usd), minUnits: Number(g.min_units), maxUnits: g.max_units == null ? null : Number(g.max_units), includes: (typeof g.includes === 'string' ? JSON.parse(g.includes) : g.includes) as string[],
    closesAt: DATE(g.closes_at), departsAt: DATE(g.departs_at), transitDays: Number(g.transit_days), status: g.status as 'open' | 'full' | 'closed' | 'cancelled', notes: g.notes ?? '', containerId: g.container_id ?? null, createdAt: ISO(g.created_at), closedAt: ISO(g.closed_at),
  }
}
export const spotOut = (s: Row) => ({
  id: s.id, groupageId: s.groupage_id, userId: s.user_id, name: s.name, email: s.email, phone: s.phone, units: Number(s.units), description: s.description, pickup: !!s.pickup, status: s.status as 'reserved' | 'booked' | 'cancelled',
  amountUsd: Number(s.amount_usd), shipmentId: s.shipment_id ?? null, shipmentRef: s.ref ?? null, shipmentStatus: s.shipment_status ?? null, createdAt: ISO(s.created_at),
  groupage: s.g_title ? { title: s.g_title, kind: s.g_kind, origin: s.g_origin, destination: s.g_destination, closesAt: DATE(s.g_closes_at), departsAt: DATE(s.g_departs_at), status: s.g_status, shipperName: s.g_shipper, fillPct: Number(s.g_capacity) ? Math.min(100, Math.round((Number(s.g_reserved) / Number(s.g_capacity)) * 100)) : 0 } : undefined,
})

const SELECT = `select g.*, sh.name as shipper_name, sh.hue as shipper_hue, sh.initials as shipper_initials, sh.verified as shipper_verified,
  (select coalesce(sum(units),0) from groupage_spots s where s.groupage_id = g.id and s.status <> 'cancelled')::int as reserved,
  (select count(*) from groupage_spots s where s.groupage_id = g.id and s.status <> 'cancelled')::int as participants
  from groupages g join shippers sh on sh.id = g.shipper_id`
const SPOT_SELECT = `select s.*, sp.ref, sp.status as shipment_status, g.title as g_title, g.kind as g_kind, g.origin as g_origin, g.destination as g_destination, g.closes_at as g_closes_at, g.departs_at as g_departs_at, g.status as g_status, g.capacity as g_capacity, sh.name as g_shipper,
  (select coalesce(sum(units),0) from groupage_spots x where x.groupage_id = g.id and x.status <> 'cancelled')::int as g_reserved
  from groupage_spots s join groupages g on g.id = s.groupage_id join shippers sh on sh.id = g.shipper_id left join shipments sp on sp.id = s.shipment_id`

const zKind = z.enum(['barrel', 'container20', 'container40'])
const zGroupage = z.object({
  kind: zKind, title: z.string().trim().min(3).max(80), origin: z.string().trim().min(2).max(80), destination: z.enum(['GH', 'NG', 'LR', 'TG', 'CI', 'SL', 'SN']), destinationCity: z.string().trim().max(60).default(''),
  capacity: z.number().int().min(2).max(2000), pricePerUnitUsd: z.number().min(1).max(100_000), minUnits: z.number().int().min(1).max(100).default(1), maxUnits: z.number().int().min(1).max(2000).nullable().default(null),
  includes: z.array(z.string().trim().min(1).max(60)).max(8).default([]), closesAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), departsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), transitDays: z.number().int().min(1).max(120).default(35), notes: z.string().trim().max(600).default(''),
})
const zJoin = z.object({ units: z.number().int().min(1).max(2000), description: z.string().trim().min(2).max(500), phone: z.string().trim().min(7).max(30), pickup: z.boolean().default(false), name: z.string().trim().min(2).max(80).optional() })

export function mountGroupage(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.'); return u }
  const byId = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${SELECT} where g.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Shared slot not found.'); return rows[0] }
  const spots = async (db: Db, gid: string) => (await db.query<Row>(`${SPOT_SELECT} where s.groupage_id = $1 order by s.created_at asc`, [gid])).rows
  const refreshFull = async (db: Db, gid: string) => {
    const g = await byId(db, gid)
    if (g.status === 'open' && Number(g.reserved) >= Number(g.capacity)) { await db.query(`update groupages set status = 'full' where id = $1`, [gid]); await notifyShipperStaff(db, g.shipper_id, { kind: 'groupage', title: `${g.title} is full`, body: `${g.participants} people reserved all ${g.capacity} ${GROUPAGE_KINDS[g.kind as GroupageKind].unitPlural}. Close it to book everyone.`, link: '/dashboard/groupage', dedupe: `grp:${gid}:full` }, ['owner', 'dispatcher']) }
    else if (g.status === 'full' && Number(g.reserved) < Number(g.capacity)) await db.query(`update groupages set status = 'open' where id = $1`, [gid])
  }

  /* ---- public ---- */
  r.get('/groupage', wrap(async (req, res) => {
    const db = await getDb()
    const dest = typeof req.query.destination === 'string' && req.query.destination.length === 2 ? req.query.destination.toUpperCase() : null
    const origin = typeof req.query.origin === 'string' && req.query.origin.trim() ? req.query.origin.trim().toLowerCase() : null
    const kind = typeof req.query.kind === 'string' && req.query.kind in GROUPAGE_KINDS ? req.query.kind : null
    const params: unknown[] = []; const where = [`g.status in ('open','full')`, `g.closes_at >= current_date`]
    if (dest) { params.push(dest); where.push(`g.destination = $${params.length}`) }
    if (origin) { params.push(`%${origin}%`); where.push(`lower(g.origin) like $${params.length}`) }
    if (kind) { params.push(kind); where.push(`g.kind = $${params.length}`) }
    const { rows } = await db.query<Row>(`${SELECT} where ${where.join(' and ')} order by g.closes_at asc, g.created_at desc limit 60`, params)
    res.set('Cache-Control', 'no-store')
    res.json({ groupages: rows.map(groupageOut), kinds: Object.entries(GROUPAGE_KINDS).map(([id, k]) => ({ id, ...k })) })
  }))
  r.get('/groupage/:id', wrap(async (req, res) => {
    const db = await getDb(); const g = await byId(db, String(req.params.id))
    let mine: Row[] = []
    try { const u = await requireUser(db, req); mine = (await spots(db, g.id)).filter((s) => s.user_id === u.id && s.status !== 'cancelled') } catch { /* anonymous */ }
    res.set('Cache-Control', 'no-store')
    res.json({ groupage: groupageOut(g), mySpots: mine.map(spotOut) })
  }))
  /** Reserve units. Needs an account (so the spot can become a shipment the customer can track and pay). */
  r.post('/groupage/:id/join', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const g = await byId(db, String(req.params.id))
    if (u.role !== 'customer') throw new HttpError(403, 'Sign in as a customer to reserve space.')
    if (g.status !== 'open') throw new HttpError(409, g.status === 'full' ? 'This slot is already full — try another one.' : 'This slot is closed.')
    if (DATE(g.closes_at)! < new Date().toISOString().slice(0, 10)) throw new HttpError(409, 'Bookings for this slot have closed.')
    const b = zJoin.parse(req.body)
    const left = Number(g.capacity) - Number(g.reserved)
    if (b.units < Number(g.min_units)) throw new HttpError(400, `Minimum is ${g.min_units} ${GROUPAGE_KINDS[g.kind as GroupageKind].unitPlural}.`)
    if (g.max_units != null && b.units > Number(g.max_units)) throw new HttpError(400, `Maximum per person is ${g.max_units}.`)
    if (b.units > left) throw new HttpError(409, `Only ${left} ${left === 1 ? GROUPAGE_KINDS[g.kind as GroupageKind].unit : GROUPAGE_KINDS[g.kind as GroupageKind].unitPlural} left.`)
    const id = 'gs_' + uid(); const amount = Math.round(b.units * Number(g.price_per_unit_usd) * 100) / 100
    await db.query(`insert into groupage_spots (id,groupage_id,user_id,name,email,phone,units,description,pickup,status,amount_usd) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',$10)`, [id, g.id, u.id, b.name ?? u.name, u.email, b.phone, b.units, b.description, b.pickup, amount])
    await refreshFull(db, g.id)
    await notifyShipperStaff(db, g.shipper_id, { kind: 'groupage', title: `${u.name} reserved ${b.units} ${b.units === 1 ? GROUPAGE_KINDS[g.kind as GroupageKind].unit : GROUPAGE_KINDS[g.kind as GroupageKind].unitPlural} in ${g.title}`, body: `${b.description} · $${amount.toLocaleString()}. ${Number(g.reserved) + b.units}/${g.capacity} filled.`, link: '/dashboard/groupage', dedupe: `grp:${id}` }, ['owner', 'dispatcher', 'agent'])
    await notify(db, { userId: u.id, kind: 'groupage', title: `Space reserved — ${g.title}`, body: `${b.units} ${b.units === 1 ? GROUPAGE_KINDS[g.kind as GroupageKind].unit : GROUPAGE_KINDS[g.kind as GroupageKind].unitPlural} with ${g.shipper_name}, $${amount.toLocaleString()}. You'll get a shipment reference and payment link when ${g.shipper_name} closes the slot (by ${DATE(g.closes_at)}).`, link: '/dashboard?tab=groupage', dedupe: `grp:${id}:c`, emailSubject: `Space reserved — ${g.title}` })
    res.status(201).json({ spot: spotOut((await db.query<Row>(`${SPOT_SELECT} where s.id = $1`, [id])).rows[0]), groupage: groupageOut(await byId(db, g.id)) })
  }))
  r.get('/groupage/spots/mine', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`${SPOT_SELECT} where s.user_id = $1 order by s.created_at desc`, [u.id])
    res.set('Cache-Control', 'no-store'); res.json({ spots: rows.map(spotOut) })
  }))
  r.post('/groupage/spots/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`${SPOT_SELECT} where s.id = $1`, [req.params.id]); const s = rows[0]; if (!s) throw new HttpError(404, 'Reservation not found.')
    const g = await byId(db, s.groupage_id)
    const isOffice = u.role === 'shipper' && u.shipperId === g.shipper_id && !isDriverRole(u.staffRole)
    if (s.user_id !== u.id && !isOffice) throw new HttpError(403, 'Not your reservation.')
    if (s.status !== 'reserved') throw new HttpError(409, s.status === 'booked' ? 'Already booked — contact the shipper to cancel the shipment.' : 'Already cancelled.')
    await db.query(`update groupage_spots set status = 'cancelled' where id = $1`, [s.id])
    await refreshFull(db, g.id)
    if (isOffice && s.user_id) await notify(db, { userId: s.user_id, kind: 'groupage', title: `Reservation removed — ${g.title}`, body: `${g.shipper_name} removed your ${s.units}-unit reservation. Reply to them or pick another slot.`, link: '/groupage', dedupe: `grp:${s.id}:x` })
    res.json({ ok: true })
  }))

  /* ---- shipper ---- */
  r.get('/groupage/manage/list', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where g.shipper_id = $1 order by (g.status in ('open','full')) desc, g.closes_at asc`, [u.shipperId])
    const ids = rows.map((g) => g.id)
    const { rows: sp } = ids.length ? await db.query<Row>(`${SPOT_SELECT} where s.groupage_id = any($1::text[]) order by s.created_at asc`, [ids]) : { rows: [] as Row[] }
    res.set('Cache-Control', 'no-store')
    res.json({ groupages: rows.map((g) => ({ ...groupageOut(g), spots: sp.filter((s) => s.groupage_id === g.id).map(spotOut) })), kinds: Object.entries(GROUPAGE_KINDS).map(([id, k]) => ({ id, ...k })) })
  }))
  r.post('/groupage', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zGroupage.parse(req.body)
    if (!(await (await import('./features')).featureOn(db, 'groupage', u.shipperId))) throw new HttpError(403, 'Shared barrels are switched off for your account.')
    if (b.departsAt < b.closesAt) throw new HttpError(400, 'Departure must be on or after the closing date.')
    const id = 'grp_' + uid()
    await db.query(`insert into groupages (id,shipper_id,kind,title,origin,destination,destination_city,capacity,price_per_unit_usd,min_units,max_units,includes,closes_at,departs_at,transit_days,notes,status,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'open',$17)`,
      [id, u.shipperId, b.kind, b.title, b.origin, b.destination, b.destinationCity, b.capacity, b.pricePerUnitUsd, b.minUnits, b.maxUnits, JSON.stringify(b.includes), b.closesAt, b.departsAt, b.transitDays, b.notes, u.name])
    res.status(201).json({ groupage: groupageOut(await byId(db, id)) })
  }))
  r.patch('/groupage/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const g = await byId(db, String(req.params.id)); if (g.shipper_id !== u.shipperId) throw new HttpError(403, 'Not your slot.')
    if (!['open', 'full'].includes(g.status)) throw new HttpError(409, 'Closed slots cannot be edited.')
    const b = zGroupage.partial().parse(req.body)
    if (b.capacity != null && b.capacity < Number(g.reserved)) throw new HttpError(400, `Capacity can't go below the ${g.reserved} already reserved.`)
    await db.query(`update groupages set title = $2, origin = $3, destination = $4, destination_city = $5, capacity = $6, price_per_unit_usd = $7, min_units = $8, max_units = $9, includes = $10, closes_at = $11, departs_at = $12, transit_days = $13, notes = $14 where id = $1`,
      [g.id, b.title ?? g.title, b.origin ?? g.origin, b.destination ?? g.destination, b.destinationCity ?? g.destination_city, b.capacity ?? g.capacity, b.pricePerUnitUsd ?? g.price_per_unit_usd, b.minUnits ?? g.min_units, b.maxUnits === undefined ? g.max_units : b.maxUnits, JSON.stringify(b.includes ?? (typeof g.includes === 'string' ? JSON.parse(g.includes) : g.includes)), b.closesAt ?? g.closes_at, b.departsAt ?? g.departs_at, b.transitDays ?? g.transit_days, b.notes ?? g.notes])
    await refreshFull(db, g.id)
    res.json({ groupage: groupageOut(await byId(db, g.id)) })
  }))
  /** Close the slot: every reservation becomes a booked shipment (customer notified with the ref + payment). */
  r.post('/groupage/:id/close', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const g = await byId(db, String(req.params.id)); if (g.shipper_id !== u.shipperId) throw new HttpError(403, 'Not your slot.')
    if (!['open', 'full'].includes(g.status)) throw new HttpError(409, 'Already closed.')
    const list = (await spots(db, g.id)).filter((s) => s.status === 'reserved')
    const k = GROUPAGE_KINDS[g.kind as GroupageKind]
    const eta = new Date(new Date(g.departs_at).getTime() + Number(g.transit_days) * 86400000).toISOString().slice(0, 10)
    const made: string[] = []
    for (const s of list) {
      const sid = uid(); const ref = makeRef()
      const desc = `${s.units} × ${s.units === 1 ? k.unit : k.unitPlural} in ${g.title}${s.description ? ` — ${s.description}` : ''}`
      await db.query('insert into shipments (id,ref,shipper_id,user_id,mode,origin,destination,cargo,description,status,eta,customer,groupage_id,groupage_spot_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [sid, ref, g.shipper_id, s.user_id, 'ocean', g.origin, g.destination, k.cargo, desc, 'booked', eta, s.name, g.id, s.id])
      void import('./integrations').then((m) => m.emitShipment(db, sid, 'shipment.booked')).catch(() => {})
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, 'booked', g.origin, `Booked in shared ${k.label.toLowerCase().replace('shared ', '')} "${g.title}" with ${g.shipper_name}. ${s.units} ${s.units === 1 ? k.unit : k.unitPlural} at $${Number(g.price_per_unit_usd)} each.`])
      await db.query(`update groupage_spots set status = 'booked', shipment_id = $2 where id = $1`, [s.id, sid])
      if (s.user_id) { await attachShipmentToClient(db, g.shipper_id, s.user_id, sid, s.name, s.email); await notify(db, { userId: s.user_id, kind: 'booking_confirmed', title: `Booked — ${ref} in ${g.title}`, body: `${g.shipper_name} closed the slot. Your ${s.units} ${s.units === 1 ? k.unit : k.unitPlural} sail from ${g.origin} around ${DATE(g.departs_at)}. Pay $${Number(s.amount_usd).toLocaleString()} from your dashboard${s.pickup ? ' and book a pickup' : ''}.`, link: `/dashboard?tab=shipments&s=${sid}`, dedupe: `ship:${sid}:booked`, emailSubject: `Booked — ${ref}` }) }
      made.push(sid)
    }
    await db.query(`update groupages set status = 'closed', closed_at = now() where id = $1`, [g.id])
    res.json({ groupage: groupageOut(await byId(db, g.id)), shipmentIds: made })
  }))
  r.post('/groupage/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const g = await byId(db, String(req.params.id)); if (g.shipper_id !== u.shipperId) throw new HttpError(403, 'Not your slot.')
    if (!['open', 'full'].includes(g.status)) throw new HttpError(409, 'Already closed.')
    const b = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {})
    const list = (await spots(db, g.id)).filter((s) => s.status === 'reserved')
    await db.query(`update groupage_spots set status = 'cancelled' where groupage_id = $1 and status = 'reserved'`, [g.id])
    await db.query(`update groupages set status = 'cancelled', closed_at = now(), notes = case when $2 = '' then notes else notes || E'\n' || 'Cancelled: ' || $2 end where id = $1`, [g.id, b.reason])
    for (const s of list) if (s.user_id) await notify(db, { userId: s.user_id, kind: 'groupage', title: `${g.title} was cancelled`, body: `${g.shipper_name} cancelled this shared slot${b.reason ? `: ${b.reason}` : ''}. Nothing was charged — pick another slot or request a quote.`, link: '/groupage', dedupe: `grp:${g.id}:cancel:${s.id}` })
    res.json({ groupage: groupageOut(await byId(db, g.id)) })
  }))
}

/** Shipment amount for a groupage spot (used by payments.amountDue). */
export async function groupageAmount(db: Db, s: Row) {
  if (!s.groupage_spot_id) return null
  const { rows } = await db.query<Row>(`select s.amount_usd, s.units, g.title, g.kind from groupage_spots s join groupages g on g.id = s.groupage_id where s.id = $1`, [s.groupage_spot_id])
  if (!rows[0]) return null
  const k = GROUPAGE_KINDS[rows[0].kind as GroupageKind]
  return { description: `${rows[0].units} × ${Number(rows[0].units) === 1 ? k.unit : k.unitPlural} in ${rows[0].title}`, amountUsd: Number(rows[0].amount_usd) }
}

/** Demo: Gold Coast has a barrel 5/8 full and a 40 ft container 72/160 full, both Houston → Tema. Idempotent. */
export async function seedGroupageDemo(db: Db) {
  const { rows } = await db.query('select 1 from groupages where id = $1', ['grp_demo_barrel']); if (rows.length) return
  const closes = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
  await db.query(`insert into groupages (id,shipper_id,kind,title,origin,destination,destination_city,capacity,price_per_unit_usd,min_units,max_units,includes,closes_at,departs_at,transit_days,notes,status,created_by) values
    ('grp_demo_barrel','gold-coast-freight','barrel','October barrel to Tema','Houston, TX','GH','Tema',8,45,1,4,'["Barrel & packing","Ocean freight","Port handling at Tema"]',$1,$2,35,'Drop your bags at our Houston warehouse (Mon–Sat) or book a pickup after booking. Food items welcome; no liquids over 1 L.','open','Nana Boateng'),
    ('grp_demo_40','gold-coast-freight','container40','November 40 ft to Tema','Houston, TX','GH','Tema',160,320,1,20,'["Loading at Houston","Ocean freight","Devanning at Tema","Door delivery in Accra"]',$3,$4,32,'Bring sealed barrels to the yard by the closing date. Door delivery in Greater Accra included; elsewhere quoted separately.','open','Nana Boateng'),
    ('grp_demo_ab','atlantic-bridge','barrel','Shared barrel to Lagos','Newark, NJ','NG','Lagos',8,55,1,3,'["Barrel & packing","Ocean freight","Apapa handling"]',$5,$6,30,'','open','Atlantic Bridge')
    on conflict (id) do nothing`, [closes(12), closes(16), closes(26), closes(30), closes(9), closes(14)])
  const { rows: users } = await db.query<Row>(`select id, name, email from users where email in ('demo@shipsync.demo') or id like 'u_hist_%' order by email limit 6`)
  const spots: [string, string, Row, number, string][] = [['gs_demo_1', 'grp_demo_barrel', users[0], 2, 'Two boxes of clothes and shoes for family in Kumasi'], ['gs_demo_2', 'grp_demo_barrel', users[1] ?? users[0], 3, 'Rice, cooking oil, toiletries'], ['gs_demo_3', 'grp_demo_40', users[2] ?? users[0], 40, '40 barrels — provisions for a shop in Madina'], ['gs_demo_4', 'grp_demo_40', users[3] ?? users[0], 32, '32 barrels of household goods']]
  for (const [id, gid, u, units, desc] of spots) { if (!u) continue; const price = gid === 'grp_demo_barrel' ? 45 : 320; await db.query(`insert into groupage_spots (id,groupage_id,user_id,name,email,phone,units,description,pickup,status,amount_usd) values ($1,$2,$3,$4,$5,'+1 713 555 0100',$6,$7,false,'reserved',$8) on conflict (id) do nothing`, [id, gid, u.id, u.name, u.email, units, desc, units * price]) }
}
