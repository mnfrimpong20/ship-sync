import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
export const pieceOut = (p: Row) => ({ id: p.id, shipmentId: p.shipment_id, seq: Number(p.seq), labelCode: p.label_code, status: p.status as 'labelled' | 'loaded' | 'devanned' | 'delivered', printedAt: ISO(p.printed_at), lastScanAt: ISO(p.last_scan_at), lastScanKind: p.last_scan_kind, lastScanPlace: p.last_scan_place, lastScanBy: p.last_scan_by })

/** Make sure a shipment has `count` pieces (1..N). Extra unscanned pieces at the end are removed when the count shrinks. */
export async function ensurePieces(db: Db, shipment: Row, count?: number) {
  const { rows } = await db.query<Row>('select * from pieces where shipment_id = $1 order by seq', [shipment.id])
  let want = count
  if (want == null) {
    if (rows.length) return rows
    // Default to the quantity the customer asked for on the quote request, else one piece.
    const { rows: rq } = shipment.request_id ? await db.query<{ quantity: number }>('select quantity from requests where id = $1', [shipment.request_id]) : { rows: [] as { quantity: number }[] }
    // …or the count at the front of the description ("4 barrels — …", "12 boxes of …") for direct bookings.
    const fromText = /^(\d{1,3})\s*(?:x|×)?\s*(barrel|drum|box|carton|pallet|bag|crate|piece|item|sack|bale)/i.exec(String(shipment.description ?? ''))?.[1]
    want = Math.max(1, Math.min(200, Number(rq[0]?.quantity ?? fromText ?? 1) || 1))
  }
  for (let seq = rows.length + 1; seq <= want; seq++) await db.query('insert into pieces (id,shipment_id,seq,label_code) values ($1,$2,$3,$4)', ['pc_' + uid(), shipment.id, seq, `${shipment.ref}-P${seq}`])
  if (want < rows.length) await db.query(`delete from pieces where shipment_id = $1 and seq > $2 and last_scan_at is null`, [shipment.id, want])
  const { rows: out } = await db.query<Row>('select * from pieces where shipment_id = $1 order by seq', [shipment.id])
  return out
}

const zCount = z.object({ count: z.number().int().min(1).max(200) })

export function mountLabels(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const shipperOnly = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    return u
  }

  /** Everything the label needs for one or more shipments (own shipments only). Creates default pieces on first call. */
  r.get('/labels', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipperOnly(db, req)
    const ids = String(req.query.shipments ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
    if (!ids.length) throw new HttpError(400, 'Which shipments?')
    const { rows: ships } = await db.query<Row>('select * from shipments where id = any($1::text[]) and shipper_id = $2', [ids, u.shipperId])
    const { rows: shipper } = await db.query<Row>('select name, hq from shippers where id = $1', [u.shipperId])
    const { rows: clients } = await db.query<Row>('select * from clients where shipper_id = $1', [u.shipperId])
    const { rows: consignees } = await db.query<Row>('select * from client_consignees where client_id = any($1::text[])', [clients.map((c) => c.id)])
    const { rows: containers } = await db.query<Row>('select id, ref, number, seal, vessel_name, destination_port from containers where shipper_id = $1', [u.shipperId])
    const labels = []
    for (const s of ships.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))) {
      const pieces = await ensurePieces(db, s)
      const client = clients.find((c) => c.id === s.client_id)
      const consignee = consignees.find((c) => c.id === s.consignee_id) ?? (client ? consignees.find((c) => c.client_id === client.id && c.is_default) : undefined)
      const container = containers.find((c) => c.id === s.container_id)
      labels.push({
        shipment: { id: s.id, ref: s.ref, mode: s.mode, origin: s.origin, destination: s.destination, cargo: s.cargo, description: s.description, status: s.status, customer: s.customer, createdAt: ISO(s.created_at) },
        sender: client ? { name: client.name, company: client.company, phone: client.phone || client.whatsapp, city: client.city } : { name: s.customer, company: '', phone: '', city: s.origin },
        receiver: consignee ? { name: consignee.name, phone: consignee.phone, address: consignee.address, city: consignee.city, country: consignee.country } : null,
        container: container ? { ref: container.ref, number: container.number, seal: container.seal, vesselName: container.vessel_name, destinationPort: container.destination_port } : null,
        pieces: pieces.map(pieceOut),
      })
    }
    res.json({ shipper: { name: shipper[0]?.name ?? '', hq: shipper[0]?.hq ?? '' }, labels })
  }))

  r.get('/shipments/:id/pieces', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipperOnly(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1 and shipper_id = $2', [req.params.id, u.shipperId])
    if (!rows[0]) throw new HttpError(404, 'Shipment not found.')
    res.json({ pieces: (await ensurePieces(db, rows[0])).map(pieceOut) })
  }))
  r.post('/shipments/:id/pieces', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipperOnly(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1 and shipper_id = $2', [req.params.id, u.shipperId])
    if (!rows[0]) throw new HttpError(404, 'Shipment not found.')
    const b = zCount.parse(req.body)
    res.json({ pieces: (await ensurePieces(db, rows[0], b.count)).map(pieceOut) })
  }))
  /** The print page calls this when the labels have actually gone to the printer. */
  r.post('/pieces/printed', wrap(async (req, res) => {
    const db = await getDb(); const u = await shipperOnly(db, req)
    const ids = z.object({ pieceIds: z.array(z.string()).min(1).max(1000) }).parse(req.body).pieceIds
    await db.query(`update pieces set printed_at = now() where id = any($1::text[]) and shipment_id in (select id from shipments where shipper_id = $2)`, [ids, u.shipperId])
    res.json({ ok: true })
  }))
}
