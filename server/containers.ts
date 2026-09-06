import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadShipments: (db: Db, where: string, params: unknown[]) => Promise<any[]>
}

/** Container lifecycle, in order. Each stage cascades a shipment status to everything loaded (forward-only). */
export const CONTAINER_STAGES = ['booked', 'loading', 'gated_in', 'sailed', 'arrived', 'customs', 'devanned', 'closed'] as const
export type ContainerStatus = (typeof CONTAINER_STAGES)[number]
export const stageLabels: Record<ContainerStatus, string> = { booked: 'Booked with line', loading: 'Loading', gated_in: 'Gated in at port', sailed: 'Sailed', arrived: 'Arrived', customs: 'Customs', devanned: 'Devanned', closed: 'Closed' }
/** What each container stage means for the orders inside it. */
const CASCADE: Partial<Record<ContainerStatus, ShipmentStatus>> = { loading: 'picked_up', gated_in: 'at_origin_port', sailed: 'in_transit', arrived: 'arrived', customs: 'customs' }
const OPEN = ['booked', 'loading', 'gated_in', 'sailed', 'arrived', 'customs']
export const SIZES = ['20ft', '40ft', '40hc', 'reefer'] as const

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

const containerOut = (r: Row) => ({
  id: r.id, ref: r.ref, number: r.number, size: r.size as (typeof SIZES)[number], line: r.line, bookingRef: r.booking_ref, seal: r.seal, vesselName: r.vessel_name, mmsi: r.mmsi, voyage: r.voyage,
  originPort: r.origin_port, destination: r.destination, destinationPort: r.destination_port, cutoffDate: DATE(r.cutoff_date), etd: DATE(r.etd), eta: DATE(r.eta),
  status: r.status as ContainerStatus, notes: r.notes, createdAt: ISO(r.created_at), loaded: r.loaded != null ? Number(r.loaded) : undefined,
})
const eventOut = (e: Row) => ({ status: e.status as ContainerStatus, at: ISO(e.at), place: e.place, note: e.note, by: e.by_name })

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
const zContainer = z.object({
  number: z.string().trim().max(20).default(''), size: z.enum(SIZES).default('40ft'), line: z.string().trim().max(60).default(''), bookingRef: z.string().trim().max(40).default(''), seal: z.string().trim().max(30).default(''),
  vesselName: z.string().trim().max(60).default(''), mmsi: z.string().trim().regex(/^\d{0,9}$/).default(''), voyage: z.string().trim().max(20).default(''),
  originPort: z.string().trim().max(60).default(''), destination: z.string().trim().length(2).default('GH'), destinationPort: z.string().trim().max(60).default(''),
  cutoffDate: zDate, etd: zDate, eta: zDate, notes: z.string().trim().max(1000).default(''),
})
const zAdvance = z.object({ status: z.enum(CONTAINER_STAGES), at: z.string().datetime().optional(), place: z.string().trim().max(80).default(''), note: z.string().trim().max(500).default('') })
const zLoad = z.object({ shipmentIds: z.array(z.string()).min(1).max(100) })

export function mountContainers(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap, loadShipments } = d
  /** Shipper staff except drivers can work containers. */
  const access = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    if (u.staffRole === 'driver') throw new HttpError(403, 'Drivers can’t manage containers.')
    return { u, sid: u.shipperId }
  }
  const nextRef = async (db: Db, sid: string) => {
    const year = new Date().getFullYear()
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from containers where shipper_id = $1 and ref like $2`, [sid, `CN-${year}-%`])
    return `CN-${year}-${String(Number(rows[0].n) + 1).padStart(3, '0')}`
  }
  const own = async (db: Db, sid: string, id: string) => {
    const { rows } = await db.query<Row>(`select c.*, (select count(*) from shipments s where s.container_id = c.id)::int as loaded from containers c where c.id = $1 and c.shipper_id = $2`, [id, sid])
    if (!rows[0]) throw new HttpError(404, 'Container not found.')
    return rows[0]
  }
  const detail = async (db: Db, sid: string, id: string) => {
    const c = await own(db, sid, id)
    const { rows: ev } = await db.query<Row>('select * from container_events where container_id = $1 order by at asc, id asc', [id])
    const shipments = await loadShipments(db, 'container_id = $1', [id])
    const { rows: clients } = await db.query<Row>('select id, name from clients where shipper_id = $1', [sid])
    const cname = new Map(clients.map((x) => [x.id, x.name]))
    return { container: containerOut(c), events: ev.map(eventOut), shipments: shipments.map((s) => ({ ...s, clientName: s.clientId ? cname.get(s.clientId) ?? null : null })) }
  }
  /** Raise a shipment to a status (never backwards), writing the tracking event and a client note. */
  async function raise(db: Db, s: Row, target: ShipmentStatus, place: string, note: string, extra?: { vessel?: string; mmsi?: string }) {
    if (statusOrder.indexOf(target) > statusOrder.indexOf(s.status as ShipmentStatus)) {
      await db.query('update shipments set status = $2 where id = $1', [s.id, target])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, target, place, note])
      if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} moved to “${statusLabels[target]}” — ${note}`])
    }
    if (extra && (extra.vessel || extra.mmsi)) await db.query('update shipments set vessel_name = coalesce(nullif($2, \'\'), vessel_name), mmsi = coalesce(nullif($3, \'\'), mmsi), departed_at = coalesce(departed_at, case when $4 then now() else null end) where id = $1', [s.id, extra.vessel ?? '', extra.mmsi ?? '', target === 'in_transit'])
  }

  r.get('/containers', wrap(async (req, res) => {
    const db = await getDb(); const { sid } = await access(db, req)
    const { rows } = await db.query<Row>(`select c.*, (select count(*) from shipments s where s.container_id = c.id)::int as loaded from containers c where c.shipper_id = $1 order by case when c.status in ('devanned','closed') then 1 else 0 end, coalesce(c.etd, c.cutoff_date, c.created_at::date) asc`, [sid])
    res.json({ containers: rows.map(containerOut) })
  }))
  /** Ocean orders that can be loaded: not delivered, not already in an open container. */
  r.get('/containers/candidates', wrap(async (req, res) => {
    const db = await getDb(); const { sid } = await access(db, req)
    const dest = String(req.query.destination ?? '')
    const { rows: clients } = await db.query<Row>('select id, name from clients where shipper_id = $1', [sid])
    const cname = new Map(clients.map((x) => [x.id, x.name]))
    const list = await loadShipments(db, `shipper_id = $1 and mode = 'ocean' and status in ('booked','picked_up','at_origin_port') and (container_id is null or container_id in (select id from containers where status in ('devanned','closed')))`, [sid])
    res.json({ candidates: list.map((s) => ({ id: s.id, ref: s.ref, origin: s.origin, destination: s.destination, cargo: s.cargo, description: s.description, status: s.status, customer: s.customer, clientName: s.clientId ? cname.get(s.clientId) ?? null : null, eta: s.eta, sameLane: !dest || s.destination === dest })) })
  }))
  r.post('/containers', wrap(async (req, res) => {
    const db = await getDb(); const { sid, u } = await access(db, req)
    const b = zContainer.parse(req.body); const id = 'cn_' + uid(); const ref = await nextRef(db, sid)
    await db.query(`insert into containers (id,shipper_id,ref,number,size,line,booking_ref,seal,vessel_name,mmsi,voyage,origin_port,destination,destination_port,cutoff_date,etd,eta,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, sid, ref, b.number, b.size, b.line, b.bookingRef, b.seal, b.vesselName, b.mmsi, b.voyage, b.originPort, b.destination, b.destinationPort, b.cutoffDate ?? null, b.etd ?? null, b.eta ?? null, b.notes])
    await db.query('insert into container_events (container_id,status,place,note,by_name) values ($1,\'booked\',$2,$3,$4)', [id, b.originPort, b.line ? `Booked ${b.size} with ${b.line}${b.bookingRef ? ` (${b.bookingRef})` : ''}.` : 'Container booked.', u.name])
    res.status(201).json(await detail(db, sid, id))
  }))
  r.get('/containers/:id', wrap(async (req, res) => { const db = await getDb(); const { sid } = await access(db, req); res.json(await detail(db, sid, String(req.params.id))) }))
  r.patch('/containers/:id', wrap(async (req, res) => {
    const db = await getDb(); const { sid } = await access(db, req)
    const c = await own(db, sid, String(req.params.id)); const b = zContainer.partial().parse(req.body)
    await db.query(`update containers set number=$2, size=$3, line=$4, booking_ref=$5, seal=$6, vessel_name=$7, mmsi=$8, voyage=$9, origin_port=$10, destination=$11, destination_port=$12, cutoff_date=$13, etd=$14, eta=$15, notes=$16 where id = $1`,
      [c.id, b.number ?? c.number, b.size ?? c.size, b.line ?? c.line, b.bookingRef ?? c.booking_ref, b.seal ?? c.seal, b.vesselName ?? c.vessel_name, b.mmsi ?? c.mmsi, b.voyage ?? c.voyage, b.originPort ?? c.origin_port, b.destination ?? c.destination, b.destinationPort ?? c.destination_port, b.cutoffDate === undefined ? c.cutoff_date : b.cutoffDate, b.etd === undefined ? c.etd : b.etd, b.eta === undefined ? c.eta : b.eta, b.notes ?? c.notes])
    // Vessel details entered after sailing still flow to the loaded orders.
    if ((b.vesselName || b.mmsi) && ['sailed', 'arrived', 'customs'].includes(c.status)) { const { rows } = await db.query<Row>('select * from shipments where container_id = $1', [c.id]); for (const s of rows) await raise(db, s, s.status, '', '', { vessel: b.vesselName, mmsi: b.mmsi }) }
    res.json(await detail(db, sid, c.id))
  }))
  r.post('/containers/:id/load', wrap(async (req, res) => {
    const db = await getDb(); const { sid, u } = await access(db, req)
    const c = await own(db, sid, String(req.params.id)); const b = zLoad.parse(req.body)
    if (!OPEN.includes(c.status) || ['sailed', 'arrived', 'customs'].includes(c.status)) throw new HttpError(409, `You can’t load orders once the container has ${stageLabels[c.status as ContainerStatus].toLowerCase()}.`)
    const { rows } = await db.query<Row>('select * from shipments where id = any($1::text[]) and shipper_id = $2', [b.shipmentIds, sid])
    if (rows.length !== b.shipmentIds.length) throw new HttpError(400, 'One of those orders isn’t yours.')
    for (const s of rows) {
      if (s.mode !== 'ocean') throw new HttpError(400, `${s.ref} is an air shipment.`)
      if (s.status === 'delivered') throw new HttpError(400, `${s.ref} is already delivered.`)
      if (s.container_id && s.container_id !== c.id) { const { rows: other } = await db.query<Row>('select ref, status from containers where id = $1', [s.container_id]); if (other[0] && OPEN.includes(other[0].status)) throw new HttpError(409, `${s.ref} is already loaded in ${other[0].ref}.`) }
      await db.query('update shipments set container_id = $2 where id = $1', [s.id, c.id])
      const target = CASCADE[c.status as ContainerStatus] ?? 'picked_up' // loading a box means the order has been collected
      await raise(db, s, target, c.origin_port || 'Origin yard', `Loaded into container ${c.ref}${c.number ? ` (${c.number})` : ''} by ${u.name}.`)
    }
    if (c.status === 'booked') { await db.query(`update containers set status = 'loading' where id = $1`, [c.id]); await db.query('insert into container_events (container_id,status,place,note,by_name) values ($1,\'loading\',$2,$3,$4)', [c.id, c.origin_port || '', 'First orders loaded.', u.name]) }
    res.json(await detail(db, sid, c.id))
  }))
  r.post('/containers/:id/unload', wrap(async (req, res) => {
    const db = await getDb(); const { sid } = await access(db, req)
    const c = await own(db, sid, String(req.params.id)); const shipmentId = String(req.body?.shipmentId ?? '')
    if (['sailed', 'arrived', 'customs'].includes(c.status)) throw new HttpError(409, 'The container has already sailed — orders can’t be removed now.')
    await db.query('update shipments set container_id = null where id = $1 and container_id = $2 and shipper_id = $3', [shipmentId, c.id, sid])
    res.json(await detail(db, sid, c.id))
  }))
  /** Move to a later stage; every loaded order follows. */
  r.post('/containers/:id/advance', wrap(async (req, res) => {
    const db = await getDb(); const { sid, u } = await access(db, req)
    const c = await own(db, sid, String(req.params.id)); const b = zAdvance.parse(req.body)
    const from = CONTAINER_STAGES.indexOf(c.status); const to = CONTAINER_STAGES.indexOf(b.status)
    if (to <= from) throw new HttpError(400, `Already ${stageLabels[c.status as ContainerStatus].toLowerCase()} — stages only move forward.`)
    if (b.status === 'sailed' && !c.vessel_name) throw new HttpError(400, 'Add the vessel name (and MMSI if you have it) before marking the container sailed.')
    const at = b.at ? new Date(b.at) : new Date()
    await db.query('update containers set status = $2 where id = $1', [c.id, b.status])
    await db.query('insert into container_events (container_id,status,at,place,note,by_name) values ($1,$2,$3,$4,$5,$6)', [c.id, b.status, at, b.place, b.note, u.name])
    const target = CASCADE[b.status]
    const { rows } = await db.query<Row>('select * from shipments where container_id = $1', [c.id])
    let cascaded = 0
    for (const s of rows) {
      if (target) { const before = s.status; await raise(db, s, target, b.place || (to >= CONTAINER_STAGES.indexOf('arrived') ? (c.destination_port || countryByCode(c.destination)?.name || c.destination) : c.origin_port), `${stageLabels[b.status]} — container ${c.ref}${c.vessel_name ? ` on ${c.vessel_name}` : ''}${b.note ? `. ${b.note}` : '.'}`, b.status === 'sailed' ? { vessel: c.vessel_name, mmsi: c.mmsi } : undefined); if (before !== target) cascaded++ }
    }
    res.json({ ...(await detail(db, sid, c.id)), cascaded })
  }))
}
