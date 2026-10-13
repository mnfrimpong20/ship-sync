/**
 * Warehouse / yard — where the pieces physically are between pickup and loading (origin) and
 * between devanning and delivery (destination). Each shipper defines sites with zones and bins,
 * free days and a daily storage rate. Pieces are received into a bin (by sticker code or a whole
 * shipment at once), moved, and released; loading and devanning scans keep the yard in sync.
 * Storage beyond the free days is priced per piece-day and can be dropped onto an invoice.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { ensurePieces } from './labels'
import { parseCode } from './scans'
import { attachShipmentToClient } from './clients'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const r2 = (n: number) => Math.round(n * 100) / 100
const dayDiff = (from: Date, to = new Date()) => Math.floor((to.getTime() - from.getTime()) / 86400000)

export const siteOut = (s: Row) => ({ id: s.id, shipperId: s.shipper_id, name: s.name, kind: s.kind as 'origin' | 'destination', address: s.address, city: s.city, country: s.country, freeDays: Number(s.free_days), rateUsd: Number(s.rate_usd), vehicleRateUsd: Number(s.vehicle_rate_usd), hours: s.hours, active: !!s.active, onHand: Number(s.on_hand ?? 0), bins: Number(s.n_bins ?? 0) })
export const binOut = (b: Row) => ({ id: b.id, siteId: b.site_id, code: b.code, zone: b.zone, capacity: Number(b.capacity), note: b.note, count: Number(b.count ?? 0), shipments: Number(b.n_shipments ?? 0) })
const SITE_SELECT = `select s.*, (select count(*) from pieces p where p.site_id = s.id)::int as on_hand, (select count(*) from bins b where b.site_id = s.id)::int as n_bins from sites s`
const BIN_SELECT = `select b.*, (select count(*) from pieces p where p.bin_id = b.id)::int as count, (select count(distinct p.shipment_id) from pieces p where p.bin_id = b.id)::int as n_shipments from bins b`

const zSite = z.object({ name: z.string().trim().min(2).max(60), kind: z.enum(['origin', 'destination']), address: z.string().trim().max(160).default(''), city: z.string().trim().max(60).default(''), country: z.string().trim().max(2).default('US'), freeDays: z.number().int().min(0).max(90).default(7), rateUsd: z.number().min(0).max(1000).default(1.5), vehicleRateUsd: z.number().min(0).max(1000).default(15), hours: z.string().trim().max(80).default(''), active: z.boolean().default(true) })
const zBins = z.object({ zone: z.string().trim().min(1).max(10), from: z.number().int().min(1).max(500), to: z.number().int().min(1).max(500), capacity: z.number().int().min(1).max(1000).default(8) })
const zReceive = z.object({ siteId: z.string().min(1), binId: z.string().optional(), code: z.string().trim().max(300).optional(), shipmentId: z.string().optional(), note: z.string().trim().max(300).default('') })
const zMove = z.object({ pieceIds: z.array(z.string()).min(1).max(500), binId: z.string().nullable() })
const zRelease = z.object({ shipmentId: z.string().optional(), pieceIds: z.array(z.string()).optional(), note: z.string().trim().max(300).default('') })

/** Storage due on a shipment's pieces at a site: piece-days beyond the free days × rate (vehicles use the vehicle rate per day, not per piece). */
export function storageCharge(site: Row, pieces: Row[], cargo: string, now = new Date()) {
  const free = Number(site.free_days); const rate = cargo === 'vehicle' ? Number(site.vehicle_rate_usd) : Number(site.rate_usd)
  const billable = pieces.map((p) => Math.max(0, dayDiff(new Date(p.received_at), now) - free))
  const days = cargo === 'vehicle' ? Math.max(0, ...billable, 0) : billable.reduce((n, d) => n + d, 0)
  const longest = pieces.length ? Math.max(...pieces.map((p) => dayDiff(new Date(p.received_at), now))) : 0
  return { daysInStorage: longest, freeDays: free, billableDays: days, rateUsd: rate, amountUsd: r2(days * rate) }
}

/** Keep the yard in step with scans: a loading scan takes the piece out of the origin yard; a devanning scan puts it in the default destination yard. */
export async function warehouseOnScan(db: Db, piece: Row, kind: string, shipperId: string, byName: string) {
  if (kind === 'loading' && piece.site_id) {
    await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,bin_id,by_name,note) values ($1,$2,$3,$4,'release',$5,$6,'Loaded — released from yard by scan')`, ['mv_' + uid(), piece.site_id, piece.id, piece.shipment_id, piece.bin_id ?? null, byName])
    await db.query('update pieces set site_id = null, bin_id = null, released_at = now() where id = $1', [piece.id])
  } else if (kind === 'devanning' && !piece.site_id) {
    const { rows } = await db.query<Row>(`select id from sites where shipper_id = $1 and kind = 'destination' and active order by created_at limit 1`, [shipperId])
    if (rows[0]) { await db.query('update pieces set site_id = $2, bin_id = null, received_at = now(), released_at = null where id = $1', [piece.id, rows[0].id]); await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,by_name,note) values ($1,$2,$3,$4,'receive',$5,'Devanned — received into yard by scan')`, ['mv_' + uid(), rows[0].id, piece.id, piece.shipment_id, byName]) }
  }
}

export function mountWarehouse(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staff = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Staff only.'); return u }
  const office = async (db: Db, req: Request) => { const u = await staff(db, req); if (u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.'); return u }
  const ownSite = async (db: Db, sid: string, id: string) => { const { rows } = await db.query<Row>(`${SITE_SELECT} where s.id = $1 and s.shipper_id = $2`, [id, sid]); if (!rows[0]) throw new HttpError(404, 'Site not found.'); return rows[0] }
  const onHand = async (db: Db, sid: string, siteId?: string) => {
    const { rows } = await db.query<Row>(`select p.*, s.ref, s.customer, s.cargo, s.status as s_status, s.client_id, s.destination, s.origin, b.code as bin_code, b.zone as bin_zone, st.free_days, st.rate_usd, st.vehicle_rate_usd, st.name as site_name
      from pieces p join shipments s on s.id = p.shipment_id join sites st on st.id = p.site_id left join bins b on b.id = p.bin_id where s.shipper_id = $1 ${siteId ? 'and p.site_id = $2' : ''} order by p.received_at asc, s.ref, p.seq`, siteId ? [sid, siteId] : [sid])
    const by = new Map<string, Row[]>(); for (const p of rows) { const k = `${p.site_id}|${p.shipment_id}`; if (!by.has(k)) by.set(k, []); by.get(k)!.push(p) }
    return [...by.values()].map((ps) => { const p0 = ps[0]; const site = { free_days: p0.free_days, rate_usd: p0.rate_usd, vehicle_rate_usd: p0.vehicle_rate_usd }; const ch = storageCharge(site, ps, p0.cargo)
      return { siteId: p0.site_id, siteName: p0.site_name, shipmentId: p0.shipment_id, ref: p0.ref, customer: p0.customer, cargo: p0.cargo, status: p0.s_status, clientId: p0.client_id ?? null, pieces: ps.map((p) => ({ id: p.id, seq: Number(p.seq), labelCode: p.label_code, binId: p.bin_id ?? null, bin: p.bin_code ?? null, zone: p.bin_zone ?? null, receivedAt: ISO(p.received_at) })), receivedAt: ISO(p0.received_at), ...ch } })
  }

  r.get('/warehouse', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const { rows: sites } = await db.query<Row>(`${SITE_SELECT} where s.shipper_id = $1 order by s.kind desc, s.created_at`, [u.shipperId])
    const { rows: bins } = sites.length ? await db.query<Row>(`${BIN_SELECT} where b.site_id = any($1::text[]) order by b.zone, b.code`, [sites.map((s) => s.id)]) : { rows: [] as Row[] }
    const stock = await onHand(db, u.shipperId!)
    const { rows: moves } = await db.query<Row>(`select m.*, s.ref, b.code as bin_code from stock_moves m join shipments s on s.id = m.shipment_id left join bins b on b.id = m.bin_id where s.shipper_id = $1 order by m.at desc limit 40`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ sites: sites.map(siteOut), bins: bins.map(binOut), stock, moves: moves.map((m) => ({ id: m.id, siteId: m.site_id, shipmentRef: m.ref, kind: m.kind, bin: m.bin_code ?? null, at: ISO(m.at), by: m.by_name, note: m.note })), canManage: u.staffRole === 'owner' || u.staffRole === 'dispatcher', totals: { onHand: stock.reduce((n, s) => n + s.pieces.length, 0), shipments: stock.length, overdue: stock.filter((s) => s.billableDays > 0).length, storageDue: r2(stock.reduce((n, s) => n + s.amountUsd, 0)) } })
  }))
  r.post('/warehouse/sites', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = zSite.parse(req.body); const id = 'site_' + uid()
    await db.query(`insert into sites (id,shipper_id,name,kind,address,city,country,free_days,rate_usd,vehicle_rate_usd,hours,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, u.shipperId, b.name, b.kind, b.address, b.city, b.country, b.freeDays, b.rateUsd, b.vehicleRateUsd, b.hours, b.active])
    res.status(201).json({ site: siteOut(await ownSite(db, u.shipperId!, id)) })
  }))
  r.patch('/warehouse/sites/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const cur = await ownSite(db, u.shipperId!, String(req.params.id)); const b = zSite.partial().parse(req.body)
    await db.query(`update sites set name=$2, kind=$3, address=$4, city=$5, country=$6, free_days=$7, rate_usd=$8, vehicle_rate_usd=$9, hours=$10, active=$11 where id=$1`, [cur.id, b.name ?? cur.name, b.kind ?? cur.kind, b.address ?? cur.address, b.city ?? cur.city, b.country ?? cur.country, b.freeDays ?? cur.free_days, b.rateUsd ?? cur.rate_usd, b.vehicleRateUsd ?? cur.vehicle_rate_usd, b.hours ?? cur.hours, b.active ?? cur.active])
    res.json({ site: siteOut(await ownSite(db, u.shipperId!, cur.id)) })
  }))
  /** Add a run of bins: zone A, 1..12 → A-01 … A-12. Existing codes are kept. */
  r.post('/warehouse/sites/:id/bins', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const site = await ownSite(db, u.shipperId!, String(req.params.id)); const b = zBins.parse(req.body)
    if (b.to < b.from) throw new HttpError(400, 'Range is backwards.'); if (b.to - b.from > 200) throw new HttpError(400, 'At most 200 bins at a time.')
    for (let i = b.from; i <= b.to; i++) await db.query(`insert into bins (id,site_id,code,zone,capacity) values ($1,$2,$3,$4,$5) on conflict (site_id, code) do nothing`, ['bin_' + uid(), site.id, `${b.zone.toUpperCase()}-${String(i).padStart(2, '0')}`, b.zone.toUpperCase(), b.capacity])
    const { rows } = await db.query<Row>(`${BIN_SELECT} where b.site_id = $1 order by b.zone, b.code`, [site.id]); res.status(201).json({ bins: rows.map(binOut) })
  }))
  r.delete('/warehouse/bins/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`select b.*, (select count(*) from pieces p where p.bin_id = b.id)::int as count from bins b join sites s on s.id = b.site_id where b.id = $1 and s.shipper_id = $2`, [req.params.id, u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Bin not found.')
    if (rows[0].count > 0) throw new HttpError(409, 'Move the pieces out first.')
    await db.query('delete from bins where id = $1', [rows[0].id]); res.json({ ok: true })
  }))

  /** Receive by sticker code (one piece) or by shipment (every piece, created if the stickers were never printed). */
  r.post('/warehouse/receive', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const b = zReceive.parse(req.body)
    const site = await ownSite(db, u.shipperId!, b.siteId)
    let bin: Row | null = null; if (b.binId) { const { rows } = await db.query<Row>(`${BIN_SELECT} where b.id = $1 and b.site_id = $2`, [b.binId, site.id]); bin = rows[0]; if (!bin) throw new HttpError(404, 'Bin not found at this site.') }
    let pieces: Row[] = []; let shipment: Row | null = null
    if (b.code) {
      const parsed = parseCode(b.code); if (!parsed) throw new HttpError(400, 'That doesn’t look like a Ship Sync sticker code.')
      const { rows: ss } = await db.query<Row>('select * from shipments where upper(ref) = $1 and shipper_id = $2', [parsed.ref, u.shipperId]); shipment = ss[0]; if (!shipment) throw new HttpError(404, `${parsed.ref} is not one of your shipments.`)
      const all = await ensurePieces(db, shipment); const one = all.find((p) => Number(p.seq) === parsed.seq); if (!one) throw new HttpError(404, `Piece ${parsed.seq} does not exist on ${parsed.ref}.`)
      pieces = [one]
    } else if (b.shipmentId) {
      const { rows: ss } = await db.query<Row>('select * from shipments where id = $1 and shipper_id = $2', [b.shipmentId, u.shipperId]); shipment = ss[0]; if (!shipment) throw new HttpError(404, 'Shipment not found.')
      pieces = await ensurePieces(db, shipment)
    } else throw new HttpError(400, 'Scan a sticker or pick a shipment.')
    if (bin && Number(bin.count) + pieces.filter((p) => p.bin_id !== bin!.id).length > Number(bin.capacity)) throw new HttpError(409, `${bin.code} only has room for ${Number(bin.capacity) - Number(bin.count)} more.`)
    let received = 0
    for (const p of pieces) {
      const already = p.site_id === site.id
      await db.query('update pieces set site_id = $2, bin_id = $3, received_at = case when site_id = $2 then received_at else now() end, released_at = null where id = $1', [p.id, site.id, bin?.id ?? null])
      await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,bin_id,by_name,note) values ($1,$2,$3,$4,$5,$6,$7,$8)`, ['mv_' + uid(), site.id, p.id, shipment!.id, already ? 'move' : 'receive', bin?.id ?? null, u.name, b.note])
      if (!already) received++
    }
    if (received) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [shipment!.id, shipment!.status, site.name, `${received === 1 && pieces.length === 1 ? `Piece ${pieces[0].seq}` : `${received} piece${received === 1 ? '' : 's'}`} received at ${site.name}${bin ? ` (${bin.code})` : ''} by ${u.name}${b.note ? ` — ${b.note}` : ''}.`])
    if (received && site.kind === 'origin' && shipment!.status === 'booked') { await db.query(`update shipments set status = 'picked_up' where id = $1 and status = 'booked'`, [shipment!.id]); await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [shipment!.id, 'picked_up', site.name, `Received at ${site.name}.`]) }
    res.status(201).json({ received, moved: pieces.length - received, shipment: { id: shipment!.id, ref: shipment!.ref }, bin: bin ? binOut(bin) : null })
  }))
  r.post('/warehouse/move', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const b = zMove.parse(req.body)
    const { rows: pieces } = await db.query<Row>('select p.* from pieces p join shipments s on s.id = p.shipment_id where p.id = any($1::text[]) and s.shipper_id = $2 and p.site_id is not null', [b.pieceIds, u.shipperId]); if (!pieces.length) throw new HttpError(404, 'No pieces on hand with those ids.')
    let bin: Row | null = null; if (b.binId) { const { rows } = await db.query<Row>(`${BIN_SELECT} where b.id = $1`, [b.binId]); bin = rows[0]; if (!bin || bin.site_id !== pieces[0].site_id) throw new HttpError(400, 'That bin is at another site.'); if (Number(bin.count) + pieces.filter((p) => p.bin_id !== bin!.id).length > Number(bin.capacity)) throw new HttpError(409, `${bin.code} is full.`) }
    for (const p of pieces) { await db.query('update pieces set bin_id = $2 where id = $1', [p.id, bin?.id ?? null]); await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,bin_id,by_name) values ($1,$2,$3,$4,'move',$5,$6)`, ['mv_' + uid(), p.site_id, p.id, p.shipment_id, bin?.id ?? null, u.name]) }
    res.json({ moved: pieces.length })
  }))
  /** Hand pieces out of the yard (customer collected, loaded onto a truck, delivered by hand). */
  r.post('/warehouse/release', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req); const b = zRelease.parse(req.body)
    const { rows: pieces } = b.shipmentId ? await db.query<Row>('select p.* from pieces p join shipments s on s.id = p.shipment_id where p.shipment_id = $1 and s.shipper_id = $2 and p.site_id is not null', [b.shipmentId, u.shipperId]) : await db.query<Row>('select p.* from pieces p join shipments s on s.id = p.shipment_id where p.id = any($1::text[]) and s.shipper_id = $2 and p.site_id is not null', [b.pieceIds ?? [], u.shipperId])
    if (!pieces.length) throw new HttpError(404, 'Nothing on hand to release.')
    const { rows: ss } = await db.query<Row>('select * from shipments where id = $1', [pieces[0].shipment_id]); const s = ss[0]; const site = await ownSite(db, u.shipperId!, pieces[0].site_id)
    const charge = storageCharge(site, pieces, s.cargo)
    for (const p of pieces) { await db.query('update pieces set site_id = null, bin_id = null, released_at = now() where id = $1', [p.id]); await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,bin_id,by_name,note) values ($1,$2,$3,$4,'release',$5,$6,$7)`, ['mv_' + uid(), site.id, p.id, p.shipment_id, p.bin_id ?? null, u.name, b.note]) }
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, site.name, `${pieces.length} piece${pieces.length === 1 ? '' : 's'} released from ${site.name} by ${u.name}${charge.amountUsd ? ` — storage ${charge.billableDays} day${charge.billableDays === 1 ? '' : 's'} beyond the free period, $${charge.amountUsd}` : ''}${b.note ? ` — ${b.note}` : ''}.`])
    res.json({ released: pieces.length, charge })
  }))
  /** Put the storage due onto a draft invoice for the client (or add a line to their open one). */
  r.post('/warehouse/charges/invoice', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const b = z.object({ shipmentId: z.string().min(1) }).parse(req.body)
    const items = (await onHand(db, u.shipperId!)).filter((x) => x.shipmentId === b.shipmentId); if (!items.length) throw new HttpError(404, 'Nothing on hand for that shipment.')
    const it = items[0]; if (!it.amountUsd) throw new HttpError(409, 'No storage due yet — still within the free days.')
    if (!it.clientId) { const { rows: sh } = await db.query<Row>('select * from shipments where id = $1', [it.shipmentId]); if (sh[0]?.user_id) { const { rows: us } = await db.query<Row>('select name, email from users where id = $1', [sh[0].user_id]); await attachShipmentToClient(db, u.shipperId!, sh[0].user_id, sh[0].id, sh[0].customer, us[0]?.email ?? ''); it.clientId = (await db.query<Row>('select client_id from shipments where id = $1', [sh[0].id])).rows[0]?.client_id ?? null } }
    if (!it.clientId) throw new HttpError(409, 'This shipment has no client record to invoice — add the customer as a client first.')
    const line = { description: `Storage at ${it.siteName} — ${it.ref}, ${it.billableDays} ${it.cargo === 'vehicle' ? 'day' : 'piece-day'}${it.billableDays === 1 ? '' : 's'} beyond ${it.freeDays} free`, qty: it.billableDays, unit: it.rateUsd }
    const { rows: open } = await db.query<Row>(`select * from invoices where shipment_id = $1 and shipper_id = $2 and status = 'draft' order by created_at desc limit 1`, [it.shipmentId, u.shipperId])
    let invoiceId: string
    if (open[0]) { const items2 = [...(typeof open[0].items === 'string' ? JSON.parse(open[0].items) : open[0].items), line]; const subtotal = Math.round(items2.reduce((n: number, i: Row) => n + i.qty * i.unit, 0)); await db.query('update invoices set items = $2, subtotal = $3, total = $3 + tax where id = $1', [open[0].id, JSON.stringify(items2), subtotal]); invoiceId = open[0].id }
    else {
      const year = new Date().getFullYear(); const { rows: seq } = await db.query<{ n: string }>(`select count(*)::text as n from invoices where shipper_id = $1 and number like $2`, [u.shipperId, `INV-${year}-%`])
      invoiceId = 'inv_' + uid(); const subtotal = Math.round(line.qty * line.unit)
      await db.query(`insert into invoices (id,shipper_id,client_id,shipment_id,number,status,items,subtotal,tax,total,issued_at,due_at,notes) values ($1,$2,$3,$4,$5,'draft',$6,$7,0,$7,current_date,current_date + 14,'Storage charges')`, [invoiceId, u.shipperId, it.clientId, it.shipmentId, `INV-${year}-${String(Number(seq[0].n) + 1).padStart(4, '0')}`, JSON.stringify([line]), subtotal])
    }
    res.status(201).json({ invoiceId, line })
  }))
}

/** Demo: Gold Coast gets a Houston warehouse and a Tema yard with bins, and a few pieces on hand (one past its free days). Idempotent. */
export async function seedWarehouseDemo(db: Db) {
  const { rows } = await db.query('select 1 from sites where id = $1', ['site_demo_hou']); if (rows.length) return
  await db.query(`insert into sites (id,shipper_id,name,kind,address,city,country,free_days,rate_usd,vehicle_rate_usd,hours) values
    ('site_demo_hou','gold-coast-freight','Houston warehouse','origin','1200 Port Rd, Bay 4','Houston, TX','US',7,1.5,15,'Mon–Sat 8am–6pm'),
    ('site_demo_tema','gold-coast-freight','Tema yard','destination','Community 1, near the fishing harbour','Tema','GH',5,2,20,'Mon–Fri 8am–5pm, Sat 9am–1pm') on conflict (id) do nothing`)
  for (const [site, zone, n] of [['site_demo_hou', 'A', 12], ['site_demo_hou', 'B', 12], ['site_demo_tema', 'Y', 8]] as const) for (let i = 1; i <= n; i++) await db.query(`insert into bins (id,site_id,code,zone,capacity) values ($1,$2,$3,$4,8) on conflict (site_id, code) do nothing`, ['bin_' + uid(), site, `${zone}-${String(i).padStart(2, '0')}`, zone])
  const { rows: ss } = await db.query<Row>(`select * from shipments where shipper_id = 'gold-coast-freight' and status in ('booked','picked_up') order by (client_id is not null) desc, (user_id is not null) desc, created_at asc limit 3`)
  const { rows: bins } = await db.query<Row>(`select id from bins where site_id = 'site_demo_hou' order by code limit 3`)
  for (const [i, s] of ss.entries()) {
    const pieces = await ensurePieces(db, s); const ago = i === 0 ? 12 : i === 1 ? 4 : 1
    for (const p of pieces) { await db.query('update pieces set site_id = $2, bin_id = $3, received_at = now() - ($4 || \' days\')::interval where id = $1', [p.id, 'site_demo_hou', bins[i]?.id ?? null, String(ago)]); await db.query(`insert into stock_moves (id,site_id,piece_id,shipment_id,kind,bin_id,by_name,at) values ($1,$2,$3,$4,'receive',$5,'Nana Boateng', now() - ($6 || ' days')::interval)`, ['mv_' + uid(), 'site_demo_hou', p.id, s.id, bins[i]?.id ?? null, String(ago)]) }
  }
}
