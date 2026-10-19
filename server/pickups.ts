/**
 * Pickup scheduling — the customer books a collection slot; the shipper confirms it onto a pickup run.
 *
 *   pickup_windows   the shipper's weekly availability: weekday + time window (+ optional area, capacity)
 *   pickup_requests  one live booking per shipment: date + window + address; requested → confirmed → done
 *
 * Confirming creates (or reuses) a planned pickup run on that date and adds the address as a stop, so the
 * existing route planner / driver app take it from there; when the driver marks the stop done the shipment
 * moves to Picked up and the booking shows as done.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { geocode } from './ops'
import { prefsOf } from './shipmentOps'
import { notify, notifyShipperStaff } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DAY = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}` }
export const windowLabel = (a: string, b: string) => `${fmtTime(a)}–${fmtTime(b)}`

export const windowOut = (w: Row) => ({ id: w.id, weekday: Number(w.weekday), start: w.start_time, end: w.end_time, area: w.area ?? '', capacity: Number(w.capacity ?? 6), active: Boolean(w.active) })
export const pickupOut = (p: Row) => ({
  id: p.id, shipmentId: p.shipment_id, shipmentRef: p.ref ?? undefined, customer: p.customer ?? undefined, date: DAY(p.pickup_date), windowStart: p.window_start, windowEnd: p.window_end, windowLabel: windowLabel(p.window_start, p.window_end),
  address: p.address, city: p.city ?? '', contactName: p.contact_name ?? '', contactPhone: p.contact_phone ?? '', notes: p.notes ?? '',
  status: (p.stop_status === 'done' ? 'done' : p.status) as 'requested' | 'confirmed' | 'cancelled' | 'done', runId: p.run_id ?? null, stopId: p.stop_id ?? null, byRole: p.by_role ?? '', note: p.status_note ?? '', createdAt: ISO(p.created_at), updatedAt: ISO(p.updated_at),
})

/** Bookable slots for a shipment over the next `days` days: the shipper's windows that serve this origin, minus lead time, with remaining capacity. */
export async function slotsFor(db: Db, s: Row, days = 14) {
  const { rows: sh } = await db.query<Row>('select pickup_lead_days from shippers where id = $1', [s.shipper_id])
  const lead = Math.max(0, Number(sh[0]?.pickup_lead_days ?? 1))
  const { rows: wins } = await db.query<Row>('select * from pickup_windows where shipper_id = $1 and active order by weekday, start_time', [s.shipper_id])
  const origin = String(s.origin ?? '').toLowerCase()
  const city = origin.split(',')[0].trim()
  const fits = wins.filter((w) => !w.area || origin.includes(String(w.area).toLowerCase()) || String(w.area).toLowerCase().includes(city))
  if (!fits.length) return { leadDays: lead, slots: [] as { date: string; weekday: string; start: string; end: string; label: string; left: number }[] }
  const first = new Date(); first.setUTCHours(12, 0, 0, 0); first.setUTCDate(first.getUTCDate() + lead)
  const last = new Date(first); last.setUTCDate(last.getUTCDate() + days)
  const { rows: taken } = await db.query<Row>(`select pickup_date, window_start, count(*)::int as n from pickup_requests where shipper_id = $1 and status in ('requested','confirmed') and pickup_date between $2 and $3 group by pickup_date, window_start`, [s.shipper_id, DAY(first), DAY(last)])
  const used = new Map(taken.map((t) => [`${DAY(t.pickup_date)}|${t.window_start}`, Number(t.n)]))
  const slots = []
  for (let i = 0; i < days; i++) {
    const d = new Date(first); d.setUTCDate(first.getUTCDate() + i)
    const date = DAY(d); const wd = d.getUTCDay()
    for (const w of fits.filter((x) => Number(x.weekday) === wd)) {
      const left = Math.max(0, Number(w.capacity) - (used.get(`${date}|${w.start_time}`) ?? 0))
      slots.push({ date, weekday: WEEKDAYS[wd], start: w.start_time, end: w.end_time, label: windowLabel(w.start_time, w.end_time), left })
    }
  }
  return { leadDays: lead, slots }
}

const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
const zWindow = z.object({ weekday: z.number().int().min(0).max(6), start: zTime, end: zTime, area: z.string().trim().max(60).default(''), capacity: z.number().int().min(1).max(100).default(6), active: z.boolean().default(true) })
const zAvailability = z.object({ leadDays: z.number().int().min(0).max(14).default(1), windows: z.array(zWindow).max(40) })
const zBook = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), windowStart: zTime, windowEnd: zTime, address: z.string().trim().min(5).max(240), city: z.string().trim().max(80).default(''), contactName: z.string().trim().min(2).max(80), contactPhone: z.string().trim().min(7).max(30), notes: z.string().trim().max(500).default('') })
const zReschedule = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), windowStart: zTime, windowEnd: zTime, note: z.string().trim().max(300).default('') })
const SELECT = `select p.*, s.ref, s.customer, s.origin, s.user_id as owner_id, st.status as stop_status from pickup_requests p join shipments s on s.id = p.shipment_id left join run_stops st on st.id = p.stop_id`

/** Put a confirmed pickup on a planned pickup run for its date (creating one if needed). */
export async function placePickupOnRun(db: Db, p: Row, runId?: string | null) {
  let run: Row | undefined
  if (runId) { run = (await db.query<Row>(`select * from runs where id = $1 and shipper_id = $2 and kind = 'pickup' and status in ('planned','in_progress')`, [runId, p.shipper_id])).rows[0]; if (!run) throw Object.assign(new Error('That run is not open.'), { httpStatus: 404 }) }
  else {
    run = (await db.query<Row>(`select * from runs where shipper_id = $1 and kind = 'pickup' and run_date = $2 and status = 'planned' order by created_at limit 1`, [p.shipper_id, DAY(p.pickup_date)])).rows[0]
    if (!run) { const id = 'run_' + uid(); await db.query(`insert into runs (id,shipper_id,name,kind,run_date,notes) values ($1,$2,$3,'pickup',$4,'Created from customer pickup bookings.')`, [id, p.shipper_id, `Pickups ${DAY(p.pickup_date)}`, DAY(p.pickup_date)]); run = (await db.query<Row>('select * from runs where id = $1', [id])).rows[0] }
  }
  const geo = await geocode(db, [p.address, p.city].filter(Boolean).join(', ')).catch(() => null)
  const { rows: n } = await db.query<{ n: number }>('select count(*)::int as n from run_stops where run_id = $1', [run.id])
  const stopId = 'stp_' + uid()
  await db.query('insert into run_stops (id,run_id,seq,shipment_id,label,address,lat,lon,contact,phone,note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [stopId, run.id, n[0].n, p.shipment_id, `${p.ref} · ${p.customer}`, [p.address, p.city].filter(Boolean).join(', '), geo?.lat ?? null, geo?.lon ?? null, p.contact_name, p.contact_phone, `Pickup window ${windowLabel(p.window_start, p.window_end)}${p.notes ? ` · ${p.notes}` : ''}`])
  await db.query('update pickup_requests set run_id = $2, stop_id = $3 where id = $1', [p.id, run.id, stopId])
  return run
}

/** A pickup row joined the way the board reads it. */
export async function pickupRow(db: Db, id: string) { const { rows } = await db.query<Row>(`${SELECT} where p.id = $1`, [id]); return rows[0] ?? null }

export function mountPickups(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  const office = async (db: Db, req: Request, manage = false) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Shipper office staff only.')
    if (manage && u.staffRole === 'agent') throw new HttpError(403, 'Only owners and dispatchers can change pickup availability.')
    return u
  }
  /** Who may act on this shipment's pickup: the office, or the customer who owns it. */
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId])
    const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const isOffice = u.role === 'shipper' && s.shipper_id === u.shipperId && !isDriverRole(u.staffRole)
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!isOffice && !owner) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office: isOffice }
  }
  const live = async (db: Db, shipmentId: string) => (await db.query<Row>(`${SELECT} where p.shipment_id = $1 and p.status in ('requested','confirmed') order by p.created_at desc limit 1`, [shipmentId])).rows[0] ?? null
  const byId = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${SELECT} where p.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Pickup not found.'); return rows[0] }
  const validSlot = async (db: Db, s: Row, b: { date: string; windowStart: string; windowEnd: string }, ignoreId?: string) => {
    const { slots, leadDays } = await slotsFor(db, s, 60)
    const slot = slots.find((x) => x.date === b.date && x.start === b.windowStart && x.end === b.windowEnd)
    if (!slot) throw new HttpError(409, leadDays ? `That slot isn’t available — pickups need ${leadDays} day${leadDays === 1 ? '' : 's'}’ notice and must fall in the shipper’s pickup hours.` : 'That slot isn’t available.')
    if (ignoreId) { const { rows } = await db.query<Row>(`select id from pickup_requests where id = $1 and pickup_date = $2 and window_start = $3 and status in ('requested','confirmed')`, [ignoreId, b.date, b.windowStart]); if (rows[0]) return slot }
    if (slot.left <= 0) throw new HttpError(409, 'That slot is full — pick another time.')
    return slot
  }
  const placeOnRun = (db: Db, p: Row, runId?: string | null) => placePickupOnRun(db, p, runId)
  const detach = async (db: Db, p: Row) => {
    if (p.stop_id) await db.query(`delete from run_stops st using runs r where st.id = $1 and r.id = st.run_id and st.status = 'pending' and r.status = 'planned'`, [p.stop_id])
    await db.query('update pickup_requests set run_id = null, stop_id = null where id = $1', [p.id])
  }
  const tellCustomer = async (db: Db, p: Row, title: string, body: string) => { if (p.owner_id) await notify(db, { userId: p.owner_id, kind: 'pickup', title, body, link: `/dashboard?tab=shipments&s=${p.shipment_id}` }) }
  const tellOffice = (db: Db, p: Row, title: string, body: string) => notifyShipperStaff(db, p.shipper_id, { kind: 'pickup', title, body, link: '/dashboard/pickups' }, ['owner', 'dispatcher', 'agent'])
  const when = (p: Row) => `${new Date(DAY(p.pickup_date) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${windowLabel(p.window_start, p.window_end)}`

  /* ---- shipper availability ---- */
  r.get('/pickups/availability', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows: sh } = await db.query<Row>('select pickup_lead_days, origins from shippers where id = $1', [u.shipperId])
    const { rows } = await db.query<Row>('select * from pickup_windows where shipper_id = $1 order by weekday, start_time', [u.shipperId])
    res.json({ leadDays: Number(sh[0]?.pickup_lead_days ?? 1), windows: rows.map(windowOut), origins: typeof sh[0]?.origins === 'string' ? JSON.parse(sh[0].origins) : sh[0]?.origins ?? [], canEdit: u.staffRole !== 'agent' })
  }))
  r.put('/pickups/availability', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req, true)
    const b = zAvailability.parse(req.body)
    for (const w of b.windows) if (w.end <= w.start) throw new HttpError(400, `${WEEKDAYS[w.weekday]} ${w.start}–${w.end}: the window must end after it starts.`)
    await db.query('update shippers set pickup_lead_days = $2 where id = $1', [u.shipperId, b.leadDays])
    await db.query('delete from pickup_windows where shipper_id = $1', [u.shipperId])
    for (const w of b.windows) await db.query('insert into pickup_windows (id,shipper_id,weekday,start_time,end_time,area,capacity,active) values ($1,$2,$3,$4,$5,$6,$7,$8)', ['pw_' + uid(), u.shipperId, w.weekday, w.start, w.end, w.area, w.capacity, w.active])
    const { rows } = await db.query<Row>('select * from pickup_windows where shipper_id = $1 order by weekday, start_time', [u.shipperId])
    res.json({ leadDays: b.leadDays, windows: rows.map(windowOut) })
  }))

  /* ---- per shipment (customer or office) ---- */
  r.get('/shipments/:id/pickup', wrap(async (req, res) => {
    const db = await getDb(); const { s, office: isOffice } = await access(db, req, String(req.params.id))
    const cur = await live(db, s.id)
    const { slots, leadDays } = await slotsFor(db, s)
    const { rows: hist } = await db.query<Row>(`${SELECT} where p.shipment_id = $1 and p.status = 'cancelled' order by p.updated_at desc limit 5`, [s.id])
    res.set('Cache-Control', 'no-store')
    res.json({ pickup: cur ? pickupOut(cur) : null, slots, leadDays, offersPickup: slots.length > 0 || (await db.query<Row>('select 1 from pickup_windows where shipper_id = $1 and active limit 1', [s.shipper_id])).rows.length > 0, canManage: isOffice, history: hist.map(pickupOut) })
  }))
  r.post('/shipments/:id/pickup', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office: isOffice } = await access(db, req, String(req.params.id))
    if (!['booked', 'picked_up'].includes(s.status) && s.status !== 'booked') throw new HttpError(409, 'This shipment is already on its way — a pickup can only be booked before collection.')
    if (await live(db, s.id)) throw new HttpError(409, 'A pickup is already booked for this shipment. Reschedule or cancel it instead.')
    const b = zBook.parse(req.body)
    await validSlot(db, s, b)
    const id = 'pk_' + uid()
    await db.query(`insert into pickup_requests (id,shipment_id,shipper_id,user_id,pickup_date,window_start,window_end,address,city,contact_name,contact_phone,notes,status,by_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, s.id, s.shipper_id, s.user_id ?? null, b.date, b.windowStart, b.windowEnd, b.address, b.city, b.contactName, b.contactPhone, b.notes, isOffice ? 'confirmed' : 'requested', isOffice ? 'shipper' : 'customer'])
    let p = await byId(db, id)
    if (isOffice) { await placeOnRun(db, p); p = await byId(db, id); await tellCustomer(db, p, `Pickup booked for ${s.ref}`, `${u.name} scheduled collection for ${when(p)} at ${p.address}.`) }
    else if ((await prefsOf(db, s.shipper_id)).autoConfirmPickups) {
      // The slot was validated against the shipper's hours and capacity — put it straight on the day's run.
      await placeOnRun(db, p); await db.query(`update pickup_requests set status = 'confirmed', updated_at = now() where id = $1`, [p.id]); p = await byId(db, id)
      await tellCustomer(db, p, `Pickup confirmed — ${s.ref}`, `${when(p)} at ${p.address}. Have the pieces packed and labelled.`)
      await tellOffice(db, p, `Pickup booked — ${s.ref}`, `${p.contact_name} booked ${when(p)} at ${p.address}. It’s on that day’s pickup run.`)
    }
    else await tellOffice(db, p, `Pickup requested — ${s.ref}`, `${p.contact_name} asked for ${when(p)} at ${p.address}${p.city ? `, ${p.city}` : ''}. Confirm it to add it to a run.`)
    res.status(201).json({ pickup: pickupOut(p) })
  }))
  r.post('/pickups/:id/confirm', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    let p = await byId(db, String(req.params.id)); if (p.shipper_id !== u.shipperId) throw new HttpError(404, 'Pickup not found.')
    if (p.status === 'cancelled') throw new HttpError(409, 'This pickup was cancelled.')
    const runId = typeof req.body?.runId === 'string' ? req.body.runId : null
    if (!p.stop_id) await placeOnRun(db, p, runId)
    await db.query(`update pickup_requests set status = 'confirmed', status_note = '', updated_at = now() where id = $1`, [p.id])
    p = await byId(db, p.id)
    await tellCustomer(db, p, `Pickup confirmed — ${p.ref}`, `${u.company ?? 'Your shipper'} will collect on ${when(p)} at ${p.address}. Have the pieces packed and labelled.`)
    res.json({ pickup: pickupOut(p) })
  }))
  r.post('/pickups/:id/reschedule', wrap(async (req, res) => {
    const db = await getDb()
    let p = await byId(db, String(req.params.id))
    const { u, s, office: isOffice } = await access(db, req, p.shipment_id)
    if (p.status === 'cancelled' || p.stop_status === 'done') throw new HttpError(409, 'This pickup can no longer be changed.')
    const b = zReschedule.parse(req.body)
    await validSlot(db, s, b, p.id)
    await detach(db, p)
    await db.query(`update pickup_requests set pickup_date = $2, window_start = $3, window_end = $4, status = $5, status_note = $6, by_role = $7, updated_at = now() where id = $1`, [p.id, b.date, b.windowStart, b.windowEnd, isOffice ? 'confirmed' : 'requested', b.note, isOffice ? 'shipper' : 'customer'])
    p = await byId(db, p.id)
    if (isOffice) { await placeOnRun(db, p); p = await byId(db, p.id); await tellCustomer(db, p, `Pickup moved — ${p.ref}`, `${u.name} rescheduled your collection to ${when(p)}.${b.note ? ` “${b.note}”` : ''}`) }
    else await tellOffice(db, p, `Pickup change requested — ${p.ref}`, `${p.contact_name} now asks for ${when(p)}.${b.note ? ` “${b.note}”` : ''} Confirm to put it on a run.`)
    res.json({ pickup: pickupOut(p) })
  }))
  r.post('/pickups/:id/cancel', wrap(async (req, res) => {
    const db = await getDb()
    let p = await byId(db, String(req.params.id))
    const { u, office: isOffice } = await access(db, req, p.shipment_id)
    if (p.status === 'cancelled') return res.json({ pickup: pickupOut(p) })
    if (p.stop_status === 'done') throw new HttpError(409, 'This pickup has already happened.')
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : ''
    await detach(db, p)
    await db.query(`update pickup_requests set status = 'cancelled', status_note = $2, by_role = $3, updated_at = now() where id = $1`, [p.id, note, isOffice ? 'shipper' : 'customer'])
    p = await byId(db, p.id)
    if (isOffice) await tellCustomer(db, p, `Pickup cancelled — ${p.ref}`, `${u.name} cancelled the collection planned for ${when(p)}.${note ? ` “${note}”` : ''} You can book another slot from your dashboard.`)
    else await tellOffice(db, p, `Pickup cancelled by customer — ${p.ref}`, `${p.contact_name} cancelled ${when(p)}.${note ? ` “${note}”` : ''}`)
    res.json({ pickup: pickupOut(p) })
  }))

  /* ---- office list ---- */
  r.get('/pickups', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where p.shipper_id = $1 order by case p.status when 'requested' then 0 when 'confirmed' then 1 else 2 end, p.pickup_date, p.window_start`, [u.shipperId])
    const { rows: runs } = await db.query<Row>(`select id, name, run_date, status from runs where shipper_id = $1 and kind = 'pickup' and status in ('planned','in_progress') order by run_date`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ pickups: rows.map(pickupOut), runs: runs.map((x) => ({ id: x.id, name: x.name, date: DAY(x.run_date), status: x.status })) })
  }))
}

/** Gold Coast publishes Mon/Wed/Fri mornings + afternoons from Houston so the demo customer can book. */
export async function seedPickupsDemo(db: Db) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from pickup_windows where shipper_id = 'gold-coast-freight'`)
  if (rows[0].n > 0) return
  for (const wd of [1, 3, 5]) for (const [a, b] of [['09:00', '12:00'], ['13:00', '17:00']]) await db.query(`insert into pickup_windows (id,shipper_id,weekday,start_time,end_time,area,capacity,active) values ($1,'gold-coast-freight',$2,$3,$4,'Houston',6,true)`, ['pw_' + uid(), wd, a, b])
  await db.query(`insert into pickup_windows (id,shipper_id,weekday,start_time,end_time,area,capacity,active) values ($1,'gold-coast-freight',6,'09:00','13:00','',4,true)`, ['pw_' + uid()])
  await db.query(`update shippers set pickup_lead_days = 1 where id = 'gold-coast-freight'`)
}
