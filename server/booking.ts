/**
 * Carrier booking — book space with the shipping line from inside Ship Sync instead of by email.
 * A rolling schedule of sailings per lane (container services and RoRo car carriers) carries rates,
 * document cut-off, ETD/ETA and space left; the office books slots against a sailing — for an
 * existing container, a new one, or a RoRo vehicle shipment — and the confirmation (booking ref,
 * vessel, voyage, dates) is written straight onto the container / shipment so consolidation and
 * carrier tracking pick it up.
 *
 * Providers: the built-in schedule (`SCHEDULE_PROVIDER=builtin`, default) generates weekly sailings
 * for the seeded lanes and confirms bookings instantly with a reference; a real INTTRA / line API
 * slots in behind the same `requestBooking()` seam later. Admins can also add sailings by hand.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

export const UNITS = { container20: '20 ft dry', container40: '40 ft dry', container40hc: '40 ft high-cube', roro_car: 'RoRo — car / sedan', roro_suv: 'RoRo — SUV / pickup', roro_truck: 'RoRo — truck / bus' } as const
export type Unit = keyof typeof UNITS
const CONTAINER_UNITS: Unit[] = ['container20', 'container40', 'container40hc']

/** Weekly lane templates the built-in provider rolls forward: [line, service, kind, vessels, originPort, originCity, destPort, destCountry, weekday(0=Sun), transitDays, cutoffDaysBefore, rates, space]. */
const LANES: [string, string, 'container' | 'roro', string[], string, string, string, string, number, number, number, Partial<Record<Unit, number>>, number][] = [
  ['Maersk', 'WAF1 — Gulf to West Africa', 'container', ['Maersk Cabo Verde', 'Maersk Nairobi', 'Safmarine Nokwanda'], 'Houston, TX', 'Houston', 'Tema', 'GH', 4, 32, 4, { container20: 3650, container40: 5200, container40hc: 5450 }, 14],
  ['MSC', 'Africa Express', 'container', ['MSC Giulia', 'MSC Lisbon', 'MSC Maria Elena'], 'Houston, TX', 'Houston', 'Lagos (Apapa)', 'NG', 1, 35, 5, { container20: 3800, container40: 5500, container40hc: 5750 }, 10],
  ['CMA CGM', 'AMERIGO', 'container', ['CMA CGM Rhone', 'CMA CGM Kribi', 'CMA CGM Bangui'], 'Newark, NJ', 'Newark', 'Tema', 'GH', 3, 24, 4, { container20: 3400, container40: 4900, container40hc: 5100 }, 12],
  ['Hapag-Lloyd', 'MWX', 'container', ['Santos Express', 'Seoul Express', 'Kobe Express'], 'Newark, NJ', 'Newark', 'Lagos (Tin Can)', 'NG', 5, 27, 5, { container20: 3550, container40: 5050, container40hc: 5300 }, 8],
  ['Grimaldi', 'Grimaldi RoRo — US Gulf / West Africa', 'roro', ['Grande Benin', 'Grande Togo', 'Grande Lagos', 'Grande Ghana'], 'Houston, TX', 'Houston', 'Tema', 'GH', 2, 30, 6, { roro_car: 1350, roro_suv: 1650, roro_truck: 2900 }, 60],
  ['Grimaldi', 'Grimaldi RoRo — US East Coast / West Africa', 'roro', ['Grande Nigeria', 'Grande Senegal', 'Grande Cotonou'], 'Baltimore, MD', 'Baltimore', 'Lagos (Tin Can)', 'NG', 0, 26, 6, { roro_car: 1500, roro_suv: 1800, roro_truck: 3200 }, 50],
  ['Sallaum Lines', 'Sallaum RoRo', 'roro', ['Silver Sun', 'Silver Ray', 'Silver Glory'], 'Newark, NJ', 'Newark', 'Tema', 'GH', 6, 22, 5, { roro_car: 1250, roro_suv: 1500, roro_truck: 2700 }, 40],
]

export const sailingOut = (s: Row) => ({
  id: s.id, line: s.line, service: s.service, kind: s.kind as 'container' | 'roro', vesselName: s.vessel_name, voyage: s.voyage, originPort: s.origin_port, originCity: s.origin_city, destinationPort: s.destination_port, destination: s.destination,
  etd: DATE(s.etd), eta: DATE(s.eta), cutoff: DATE(s.cutoff), transitDays: Number(s.transit_days), rates: (J(s.rates) ?? {}) as Partial<Record<Unit, number>>, spaceLeft: Number(s.space_left), status: s.status as 'open' | 'closed' | 'sailed', source: s.source, notes: s.notes ?? '',
})
export const bookingOut = (b: Row) => ({
  id: b.id, shipperId: b.shipper_id, sailingId: b.sailing_id, sailing: b.s_line ? { line: b.s_line, vesselName: b.s_vessel, voyage: b.s_voyage, originPort: b.s_origin, destinationPort: b.s_dest, etd: DATE(b.s_etd), eta: DATE(b.s_eta), cutoff: DATE(b.s_cutoff), kind: b.s_kind } : undefined,
  unit: b.unit as Unit, unitLabel: UNITS[b.unit as Unit] ?? b.unit, quantity: Number(b.quantity), rateUsd: Number(b.rate_usd), totalUsd: Number(b.total_usd), status: b.status as 'requested' | 'confirmed' | 'rejected' | 'cancelled', bookingRef: b.booking_ref ?? '',
  containerId: b.container_id ?? null, containerRef: b.c_ref ?? null, shipmentId: b.shipment_id ?? null, shipmentRef: b.sh_ref ?? null, note: b.note ?? '', carrierNote: b.carrier_note ?? '', requestedBy: b.requested_by, createdAt: ISO(b.created_at), confirmedAt: ISO(b.confirmed_at),
})
const BOOKING_SELECT = `select b.*, s.line as s_line, s.vessel_name as s_vessel, s.voyage as s_voyage, s.origin_port as s_origin, s.destination_port as s_dest, s.etd as s_etd, s.eta as s_eta, s.cutoff as s_cutoff, s.kind as s_kind, c.ref as c_ref, sh.ref as sh_ref
  from carrier_bookings b join sailings s on s.id = b.sailing_id left join containers c on c.id = b.container_id left join shipments sh on sh.id = b.shipment_id`

/** Built-in provider: keep ~9 weeks of sailings ahead for every lane; mark past ones sailed. Idempotent. */
export async function rollSchedule(db: Db) {
  if ((process.env.SCHEDULE_PROVIDER || 'builtin') !== 'builtin') return
  const today = new Date(); today.setUTCHours(12, 0, 0, 0)
  for (const [line, service, kind, vessels, originPort, originCity, destPort, dest, weekday, transit, cutoffDays, rates, space] of LANES) {
    const first = new Date(today); first.setUTCDate(first.getUTCDate() + ((weekday - first.getUTCDay() + 7) % 7 || 7))
    for (let w = 0; w < 9; w++) {
      const etd = addDays(first, w * 7); const vessel = vessels[(Math.floor(etd.getTime() / 604800000) + w) % vessels.length]
      const voyage = `${etd.getUTCFullYear().toString().slice(2)}${String(Math.ceil((etd.getTime() - Date.UTC(etd.getUTCFullYear(), 0, 1)) / 604800000)).padStart(2, '0')}${kind === 'roro' ? 'R' : 'W'}`
      const id = `sl_${line.toLowerCase().replace(/[^a-z]/g, '')}_${originCity.toLowerCase()}_${dest.toLowerCase()}_${DATE(etd)}`
      await db.query(`insert into sailings (id,line,service,kind,vessel_name,voyage,origin_port,origin_city,destination_port,destination,etd,eta,cutoff,transit_days,rates,space_left,status,source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'open','builtin') on conflict (id) do nothing`,
        [id, line, service, kind, vessel, voyage, originPort, originCity, destPort, dest, DATE(etd), DATE(addDays(etd, transit)), DATE(addDays(etd, -cutoffDays)), transit, JSON.stringify(rates), space])
    }
  }
  await db.query(`update sailings set status = 'sailed' where status <> 'sailed' and etd < current_date`)
  await db.query(`update sailings set status = 'closed' where status = 'open' and cutoff < current_date`)
}
export function startScheduleSweeps(getDb: () => Promise<Db>) {
  const run = () => getDb().then(rollSchedule).catch((e) => console.error('[booking] schedule', e))
  setTimeout(run, 5_000); setInterval(run, 12 * 3600_000)
}

/** The seam for a real carrier / INTTRA integration: returns the carrier's answer to a booking request. */
async function requestBooking(sailing: Row, unit: Unit, quantity: number): Promise<{ status: 'confirmed' | 'rejected'; bookingRef: string; note: string }> {
  const prefix = sailing.line.replace(/[^A-Z]/gi, '').slice(0, 4).toUpperCase()
  if (Number(sailing.space_left) < quantity) return { status: 'rejected', bookingRef: '', note: `Only ${sailing.space_left} slot${Number(sailing.space_left) === 1 ? '' : 's'} left on this sailing.` }
  return { status: 'confirmed', bookingRef: `${prefix}${randomBytes(4).toString('hex').toUpperCase()}`, note: `Confirmed on ${sailing.vessel_name} ${sailing.voyage}. Documents by ${DATE(sailing.cutoff)}.` }
}

const zBook = z.object({ sailingId: z.string().min(1), unit: z.enum(Object.keys(UNITS) as [Unit, ...Unit[]]), quantity: z.number().int().min(1).max(50).default(1), containerId: z.string().optional(), shipmentId: z.string().optional(), newContainer: z.boolean().default(false), note: z.string().trim().max(400).default('') })
const zSailing = z.object({
  line: z.string().trim().min(2).max(60), service: z.string().trim().max(80).default(''), kind: z.enum(['container', 'roro']), vesselName: z.string().trim().min(2).max(60), voyage: z.string().trim().max(20).default(''), originPort: z.string().trim().min(2).max(60), originCity: z.string().trim().max(40).default(''), destinationPort: z.string().trim().min(2).max(60), destination: z.string().trim().length(2),
  etd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rates: z.record(z.string(), z.number().min(0)).default({}), spaceLeft: z.number().int().min(0).max(1000).default(10), status: z.enum(['open', 'closed', 'sailed']).default('open'), notes: z.string().trim().max(400).default(''),
})

export function mountBooking(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.'); return u }
  const byId = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${BOOKING_SELECT} where b.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Booking not found.'); return rows[0] }

  r.get('/sailings', wrap(async (req, res) => {
    const db = await getDb()
    const q = req.query; const params: unknown[] = []; const where = [`s.status = 'open'`, `s.etd >= current_date`]
    if (typeof q.destination === 'string' && q.destination.length === 2) { params.push(q.destination.toUpperCase()); where.push(`s.destination = $${params.length}`) }
    if (typeof q.origin === 'string' && q.origin.trim()) { params.push(`%${q.origin.trim().toLowerCase()}%`); where.push(`(lower(s.origin_port) like $${params.length} or lower(s.origin_city) like $${params.length})`) }
    if (q.kind === 'container' || q.kind === 'roro') { params.push(q.kind); where.push(`s.kind = $${params.length}`) }
    const { rows } = await db.query<Row>(`select s.* from sailings s where ${where.join(' and ')} order by s.etd asc, s.line asc limit 80`, params)
    res.set('Cache-Control', 'no-store')
    res.json({ sailings: rows.map(sailingOut), units: Object.entries(UNITS).map(([id, label]) => ({ id, label })), provider: process.env.SCHEDULE_PROVIDER || 'builtin' })
  }))
  r.get('/bookings', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`${BOOKING_SELECT} where b.shipper_id = $1 order by b.created_at desc limit 200`, [u.shipperId])
    res.set('Cache-Control', 'no-store'); res.json({ bookings: rows.map(bookingOut) })
  }))
  r.post('/bookings', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zBook.parse(req.body)
    const { rows: ss } = await db.query<Row>('select * from sailings where id = $1', [b.sailingId]); const s = ss[0]; if (!s) throw new HttpError(404, 'Sailing not found.')
    if (s.status !== 'open') throw new HttpError(409, 'Bookings on this sailing are closed.')
    const isContainer = CONTAINER_UNITS.includes(b.unit)
    if (isContainer !== (s.kind === 'container')) throw new HttpError(400, s.kind === 'roro' ? 'This is a RoRo sailing — pick a vehicle slot.' : 'This is a container service — pick a container size.')
    const rate = Number((J(s.rates) as Row)?.[b.unit]); if (!(rate > 0)) throw new HttpError(400, `${UNITS[b.unit]} is not offered on this sailing.`)
    let container: Row | null = null, shipment: Row | null = null
    if (b.containerId) { const { rows } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [b.containerId, u.shipperId]); container = rows[0]; if (!container) throw new HttpError(404, 'Container not found.'); if (!['booked', 'loading'].includes(container.status)) throw new HttpError(409, 'That container has already gated in or sailed.') }
    if (b.shipmentId) { const { rows } = await db.query<Row>('select * from shipments where id = $1 and shipper_id = $2', [b.shipmentId, u.shipperId]); shipment = rows[0]; if (!shipment) throw new HttpError(404, 'Shipment not found.') }
    if (!isContainer && !shipment) throw new HttpError(400, 'Pick the vehicle shipment this RoRo slot is for.')
    const answer = await requestBooking(s, b.unit, b.quantity)
    const id = 'bk_' + uid()
    await db.query(`insert into carrier_bookings (id,shipper_id,sailing_id,unit,quantity,rate_usd,total_usd,status,booking_ref,container_id,shipment_id,note,carrier_note,requested_by,confirmed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, u.shipperId, s.id, b.unit, b.quantity, rate, rate * b.quantity, answer.status, answer.bookingRef, container?.id ?? null, shipment?.id ?? null, b.note, answer.note, u.name, answer.status === 'confirmed' ? new Date() : null])
    if (answer.status === 'confirmed') {
      await db.query('update sailings set space_left = greatest(0, space_left - $2) where id = $1', [s.id, b.quantity])
      if (isContainer) {
        if (!container && b.newContainer) {
          const year = new Date().getFullYear(); const { rows: n } = await db.query<{ n: string }>(`select count(*)::text as n from containers where shipper_id = $1 and ref like $2`, [u.shipperId, `CN-${year}-%`])
          const cid = 'cn_' + uid(); const ref = `CN-${year}-${String(Number(n[0].n) + 1).padStart(3, '0')}`
          await db.query(`insert into containers (id,shipper_id,ref,size,line,booking_ref,vessel_name,voyage,origin_port,destination,destination_port,cutoff_date,etd,eta,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [cid, u.shipperId, ref, b.unit === 'container20' ? '20ft' : b.unit === 'container40hc' ? '40hc' : '40ft', s.line, answer.bookingRef, s.vessel_name, s.voyage, s.origin_port, s.destination, s.destination_port, DATE(s.cutoff), DATE(s.etd), DATE(s.eta), b.note])
          await db.query(`insert into container_events (container_id,status,place,note,by_name) values ($1,'booked',$2,$3,$4)`, [cid, s.origin_port, `Space booked with ${s.line} via Ship Sync — ${answer.bookingRef}, ${s.vessel_name} ${s.voyage}, ETD ${DATE(s.etd)}.`, u.name])
          await db.query('update carrier_bookings set container_id = $2 where id = $1', [id, cid]); container = { id: cid, ref }
        } else if (container) {
          await db.query(`update containers set line = $2, booking_ref = $3, vessel_name = $4, voyage = $5, origin_port = case when origin_port = '' then $6 else origin_port end, destination_port = case when destination_port = '' then $7 else destination_port end, cutoff_date = $8, etd = $9, eta = $10 where id = $1`,
            [container.id, s.line, answer.bookingRef, s.vessel_name, s.voyage, s.origin_port, s.destination_port, DATE(s.cutoff), DATE(s.etd), DATE(s.eta)])
          await db.query(`insert into container_events (container_id,status,place,note,by_name) values ($1,$2,$3,$4,$5)`, [container.id, container.status, s.origin_port, `Space booked with ${s.line} via Ship Sync — ${answer.bookingRef}, ${s.vessel_name} ${s.voyage}, ETD ${DATE(s.etd)}.`, u.name])
        }
      } else if (shipment) {
        await db.query('update shipments set vessel_name = $2, eta = $3 where id = $1', [shipment.id, s.vessel_name, DATE(s.eta)])
        await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [shipment.id, shipment.status, s.origin_port, `RoRo space booked with ${s.line} — ${answer.bookingRef}, ${s.vessel_name} ${s.voyage}, sails ${DATE(s.etd)}, ETA ${DATE(s.eta)}. Vehicle must be at the port by ${DATE(s.cutoff)}.`])
        if (shipment.user_id) await notify(db, { userId: shipment.user_id, kind: 'shipment_status', title: `Sailing booked — ${shipment.ref} on ${s.vessel_name}`, body: `Departs ${s.origin_port} ${DATE(s.etd)}, arrives ${s.destination_port} around ${DATE(s.eta)}. Your vehicle must be handed over by ${DATE(s.cutoff)}.`, link: `/track?ref=${shipment.ref}`, dedupe: `bk:${id}` })
      }
    }
    await notifyShipperStaff(db, u.shipperId!, { kind: 'container_update', title: answer.status === 'confirmed' ? `Booking confirmed: ${answer.bookingRef} on ${s.vessel_name}` : `Booking rejected — ${s.line} ${s.vessel_name}`, body: `${b.quantity} × ${UNITS[b.unit]} · ${s.origin_port} → ${s.destination_port} · ETD ${DATE(s.etd)}. ${answer.note}`, link: container ? `/dashboard/containers/${container.id}` : '/dashboard/sailings', dedupe: `bk:${id}:o` }, ['owner', 'dispatcher'])
    res.status(201).json({ booking: bookingOut(await byId(db, id)), container: container ? { id: container.id, ref: container.ref } : null })
  }))
  r.post('/bookings/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const bk = await byId(db, String(req.params.id)); if (bk.shipper_id !== u.shipperId) throw new HttpError(403, 'Not your booking.')
    if (bk.status !== 'confirmed' && bk.status !== 'requested') throw new HttpError(409, 'Already closed.')
    if (bk.container_id) { const { rows } = await db.query<Row>('select status from containers where id = $1', [bk.container_id]); if (rows[0] && !['booked', 'loading'].includes(rows[0].status)) throw new HttpError(409, 'The container has already gated in — cancel with the line directly.') }
    await db.query(`update carrier_bookings set status = 'cancelled' where id = $1`, [bk.id])
    if (bk.status === 'confirmed') await db.query('update sailings set space_left = space_left + $2 where id = $1', [bk.sailing_id, bk.quantity])
    if (bk.container_id) { await db.query(`update containers set booking_ref = '', vessel_name = '', voyage = '', etd = null, eta = null, cutoff_date = null where id = $1 and booking_ref = $2`, [bk.container_id, bk.booking_ref]); await db.query(`insert into container_events (container_id,status,place,note,by_name) values ($1,'booked',$2,$3,$4)`, [bk.container_id, bk.s_origin, `Booking ${bk.booking_ref} with ${bk.s_line} cancelled.`, u.name]) }
    res.json({ booking: bookingOut(await byId(db, bk.id)) })
  }))

  /* ---- admin: manual sailings ---- */
  r.post('/admin/sailings', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zSailing.parse(req.body); const id = 'sl_' + uid()
    await db.query(`insert into sailings (id,line,service,kind,vessel_name,voyage,origin_port,origin_city,destination_port,destination,etd,eta,cutoff,transit_days,rates,space_left,status,source,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'manual',$18)`,
      [id, b.line, b.service, b.kind, b.vesselName, b.voyage, b.originPort, b.originCity || b.originPort.split(',')[0], b.destinationPort, b.destination.toUpperCase(), b.etd, b.eta, b.cutoff, Math.max(1, Math.round((new Date(b.eta).getTime() - new Date(b.etd).getTime()) / 86400000)), JSON.stringify(b.rates), b.spaceLeft, b.status, b.notes])
    res.status(201).json({ sailing: sailingOut((await db.query<Row>('select * from sailings where id = $1', [id])).rows[0]) })
  }))
  r.patch('/admin/sailings/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const { rows } = await db.query<Row>('select * from sailings where id = $1', [req.params.id]); const cur = rows[0]; if (!cur) throw new HttpError(404, 'Sailing not found.')
    const b = zSailing.partial().parse(req.body)
    await db.query(`update sailings set rates = $2, space_left = $3, status = $4, notes = $5, etd = $6, eta = $7, cutoff = $8, vessel_name = $9, voyage = $10 where id = $1`, [cur.id, JSON.stringify(b.rates ? { ...J(cur.rates), ...b.rates } : J(cur.rates)), b.spaceLeft ?? cur.space_left, b.status ?? cur.status, b.notes ?? cur.notes, b.etd ?? DATE(cur.etd), b.eta ?? DATE(cur.eta), b.cutoff ?? DATE(cur.cutoff), b.vesselName ?? cur.vessel_name, b.voyage ?? cur.voyage])
    res.json({ sailing: sailingOut((await db.query<Row>('select * from sailings where id = $1', [cur.id])).rows[0]) })
  }))
}
