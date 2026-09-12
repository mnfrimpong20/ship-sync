/**
 * Piece scanning. A sticker (see labels.ts) is scanned at three moments and each scan means one thing:
 *   loading   — the piece went into a container at the origin yard (piece → loaded; the order joins the container if it
 *               isn't in one yet, so scanning IS loading — no separate step in the office)
 *   devanning — the piece came out of the container at the destination warehouse (piece → devanned)
 *   delivery  — the piece was handed to the consignee (piece → delivered; when the last piece is delivered the order is
 *               Delivered, and a pending stop for it on the driver's run is ticked off)
 *   check     — just "I saw this piece here" — nothing moves, but the customer sees it.
 * Every scan is a row in `scans` and a customer-visible event on the order. Staff only; customers' own scans of the QR
 * simply open the tracking page.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { pieceOut } from './labels'
import { countryByCode, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
export type ScanKind = 'loading' | 'devanning' | 'delivery' | 'check'
const KINDS: ScanKind[] = ['loading', 'devanning', 'delivery', 'check']
const NEXT_STATUS: Record<ScanKind, string | null> = { loading: 'loaded', devanning: 'devanned', delivery: 'delivered', check: null }
const ORDER = ['labelled', 'loaded', 'devanned', 'delivered']
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

/** Accepts the printed code (SS-9KD4LM-P2), a scanned tracking URL (…#/track?ref=SS-9KD4LM&p=2), or ref + piece. */
export function parseCode(raw: string): { ref: string; seq: number } | null {
  const s = raw.trim()
  const url = /ref=([A-Z0-9-]+)[^#]*?(?:&|\?)p=(\d+)/i.exec(s); if (url) return { ref: url[1].toUpperCase(), seq: Number(url[2]) }
  const code = /^([A-Z]{2}-[A-Z0-9]{4,})-P(\d{1,3})$/i.exec(s); if (code) return { ref: code[1].toUpperCase(), seq: Number(code[2]) }
  const bare = /^([A-Z]{2}-[A-Z0-9]{4,})$/i.exec(s); if (bare) return { ref: bare[1].toUpperCase(), seq: 1 }
  return null
}

const zScan = z.object({
  code: z.string().trim().min(3).max(300), kind: z.enum(['loading', 'devanning', 'delivery', 'check']),
  containerId: z.string().optional(), runId: z.string().optional(), place: z.string().trim().max(120).default(''), note: z.string().trim().max(500).default(''),
  lat: z.number().optional(), lon: z.number().optional(), photo: z.string().max(600_000).optional(), receivedBy: z.string().trim().max(80).default(''),
})

export function mountScans(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const staff = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Staff only.')
    return u
  }
  const find = async (db: Db, sid: string, raw: string) => {
    const p = parseCode(raw); if (!p) throw new HttpError(400, 'That doesn’t look like a Ship Sync label. Codes look like SS-9KD4LM-P2.')
    const { rows: ships } = await db.query<Row>('select * from shipments where upper(ref) = $1 and shipper_id = $2', [p.ref, sid])
    const s = ships[0]; if (!s) throw new HttpError(404, `${p.ref} isn’t one of your shipments.`)
    const { rows: pieces } = await db.query<Row>('select * from pieces where shipment_id = $1 order by seq', [s.id])
    const piece = pieces.find((x) => Number(x.seq) === p.seq)
    if (!piece) throw new HttpError(404, pieces.length ? `${p.ref} only has ${pieces.length} piece${pieces.length === 1 ? '' : 's'} — no piece ${p.seq}.` : `${p.ref} has no labels yet. Print them from the Shipments board first.`)
    return { s, piece, pieces }
  }
  const summary = async (db: Db, s: Row) => {
    const { rows: pieces } = await db.query<Row>('select * from pieces where shipment_id = $1 order by seq', [s.id])
    const container = s.container_id ? (await db.query<Row>('select id, ref, number, seal, status, origin_port, destination_port from containers where id = $1', [s.container_id])).rows[0] : null
    const consignee = s.consignee_id ? (await db.query<Row>('select name, phone, address, city, country from client_consignees where id = $1', [s.consignee_id])).rows[0] : null
    const counts = { total: pieces.length, loaded: pieces.filter((p) => ORDER.indexOf(p.status) >= 1).length, devanned: pieces.filter((p) => ORDER.indexOf(p.status) >= 2).length, delivered: pieces.filter((p) => p.status === 'delivered').length }
    return {
      shipment: { id: s.id, ref: s.ref, status: s.status, mode: s.mode, origin: s.origin, destination: s.destination, cargo: s.cargo, description: s.description, customer: s.customer },
      container: container ? { id: container.id, ref: container.ref, number: container.number, seal: container.seal, status: container.status, originPort: container.origin_port, destinationPort: container.destination_port } : null,
      consignee: consignee ? { name: consignee.name, phone: consignee.phone, address: consignee.address, city: consignee.city, country: consignee.country } : null,
      pieces: pieces.map(pieceOut), counts,
    }
  }
  const raise = async (db: Db, s: Row, target: ShipmentStatus, place: string, note: string) => {
    if (statusOrder.indexOf(target) <= statusOrder.indexOf(s.status as ShipmentStatus)) return false
    await db.query('update shipments set status = $2 where id = $1', [s.id, target])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, target, place, note])
    if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} moved to “${statusLabels[target]}” — ${note}`])
    s.status = target
    return true
  }

  /** What is this sticker, and what would the next sensible scan be? */
  r.get('/scan/lookup', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const { s, piece } = await find(db, u.shipperId!, String(req.query.code ?? ''))
    const sum = await summary(db, s)
    const suggested: ScanKind = piece.status === 'labelled' ? 'loading' : piece.status === 'loaded' ? (sum.container && ['arrived', 'customs', 'devanned', 'closed'].includes(sum.container.status) ? 'devanning' : 'check') : piece.status === 'devanned' ? 'delivery' : 'check'
    res.json({ piece: pieceOut(piece), ...sum, suggested })
  }))

  r.post('/scan', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const b = zScan.parse(req.body)
    const { s, piece } = await find(db, u.shipperId!, b.code)
    const who = u.name
    const nextStatus = NEXT_STATUS[b.kind]
    const already = nextStatus && ORDER.indexOf(piece.status) >= ORDER.indexOf(nextStatus)
    let container: Row | null = s.container_id ? (await db.query<Row>('select * from containers where id = $1', [s.container_id])).rows[0] ?? null : null
    const warnings: string[] = []

    if (b.kind === 'loading') {
      if (s.mode !== 'ocean') throw new HttpError(400, `${s.ref} is an air shipment — it doesn’t go in a container.`)
      if (b.containerId && (!container || container.id !== b.containerId)) {
        const { rows } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [b.containerId, u.shipperId]); const c = rows[0]
        if (!c) throw new HttpError(404, 'Container not found.')
        if (!['booked', 'loading', 'gated_in'].includes(c.status)) throw new HttpError(409, `${c.ref} has already ${c.status === 'sailed' ? 'sailed' : c.status}. Pick an open container.`)
        if (container && ['sailed', 'arrived', 'customs'].includes(container.status)) throw new HttpError(409, `${s.ref} is already in ${container.ref}, which has sailed.`)
        if (container && container.id !== c.id) warnings.push(`${s.ref} was assigned to ${container.ref}; moved to ${c.ref}.`)
        await db.query('update shipments set container_id = $2 where id = $1', [s.id, c.id]); s.container_id = c.id; container = c
        if (c.status === 'booked') { await db.query(`update containers set status = 'loading' where id = $1`, [c.id]); await db.query('insert into container_events (container_id,status,place,note,by_name) values ($1,\'loading\',$2,$3,$4)', [c.id, c.origin_port || '', 'First pieces scanned in.', who]) }
        if (c.destination !== s.destination) warnings.push(`${s.ref} is bound for ${countryByCode(s.destination)?.name ?? s.destination} but ${c.ref} goes to ${countryByCode(c.destination)?.name ?? c.destination}.`)
      }
      if (!container) throw new HttpError(400, 'Choose the container this piece is going into.')
    }
    if (b.kind === 'devanning' && !container) warnings.push(`${s.ref} was never recorded in a container — devanning scan logged anyway.`)

    const place = b.place || (b.kind === 'loading' ? container?.origin_port || s.origin : b.kind === 'devanning' ? container?.destination_port || countryByCode(s.destination)?.name || s.destination : b.kind === 'delivery' ? (s.consignee_id ? (await db.query<Row>('select city from client_consignees where id = $1', [s.consignee_id])).rows[0]?.city : '') || countryByCode(s.destination)?.name || s.destination : '')
    const scanId = 'sc_' + uid()
    await db.query('insert into scans (id,piece_id,shipment_id,kind,place,note,by_name,by_staff_id,lat,lon,photo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [scanId, piece.id, s.id, b.kind, place, b.note, who, null, b.lat ?? null, b.lon ?? null, b.photo ?? null])
    if (nextStatus && !already) await db.query('update pieces set status = $2, last_scan_at = now(), last_scan_kind = $3, last_scan_place = $4, last_scan_by = $5 where id = $1', [piece.id, nextStatus, b.kind, place, who])
    else await db.query('update pieces set last_scan_at = now(), last_scan_kind = $2, last_scan_place = $3, last_scan_by = $4 where id = $1', [piece.id, b.kind, place, who])
    if (already) warnings.push(`Piece ${piece.seq} was already ${piece.status} — scan recorded, nothing changed.`)

    // What the customer sees, and what moves on the order.
    const { rows: pieces } = await db.query<Row>('select * from pieces where shipment_id = $1 order by seq', [s.id])
    const n = pieces.length; const label = `Piece ${piece.seq} of ${n}`
    const noteTail = b.note ? ` — ${b.note}` : ''
    let moved: string | null = null
    // Move the order first (if this scan warrants it), then log the piece under the order's new status.
    const event = (note: string) => db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, place, note])
    if (b.kind === 'loading') {
      const loaded = pieces.filter((p) => ORDER.indexOf(p.status) >= 1).length
      if (await raise(db, s, 'picked_up', place, `Loaded into container ${container!.ref} by ${who}.`)) moved = 'picked_up'
      await event(`${label} loaded into container ${container!.ref}${container!.number ? ` (${container!.number})` : ''} by ${who}${loaded === n ? ' — all pieces loaded' : ` (${loaded} of ${n})`}${noteTail}.`)
    } else if (b.kind === 'devanning') {
      const dev = pieces.filter((p) => ORDER.indexOf(p.status) >= 2).length
      if (await raise(db, s, 'customs', place, `Devanned at ${place} by ${who}.`)) moved = 'customs'
      await event(`${label} received at the destination warehouse by ${who}${dev === n ? ' — all pieces received' : ` (${dev} of ${n})`}${noteTail}.`)
    } else if (b.kind === 'delivery') {
      const del = pieces.filter((p) => p.status === 'delivered').length
      if (del === n && (await raise(db, s, 'delivered', place, `All ${n === 1 ? 'pieces' : `${n} pieces`} delivered${b.receivedBy ? ` to ${b.receivedBy}` : ''} by ${who}.`))) moved = 'delivered'
      await event(`${label} handed over${b.receivedBy ? ` to ${b.receivedBy}` : ''} by ${who}${b.photo ? ' (photo on file)' : ''}${del === n ? ' — all pieces delivered' : ` (${del} of ${n})`}${noteTail}.`)
      if (del === n) {
        // Tick the stop on whichever open delivery run carries this shipment (the driver's or the one given).
        const { rows: stops } = await db.query<Row>(`select st.id, st.run_id from run_stops st join runs r on r.id = st.run_id where st.shipment_id = $1 and st.status = 'pending' and r.status in ('planned','in_progress') and r.kind = 'delivery' ${b.runId ? 'and r.id = $2' : ''} order by r.run_date limit 1`, b.runId ? [s.id, b.runId] : [s.id])
        if (stops[0]) {
          await db.query(`update run_stops set status = 'done', done_at = now(), note = case when note = '' then $2 else note end where id = $1`, [stops[0].id, `Delivered by scan${b.receivedBy ? ` — received by ${b.receivedBy}` : ''}.`])
          const { rows: rest } = await db.query<Row>(`select count(*)::int as n from run_stops where run_id = $1 and status = 'pending'`, [stops[0].run_id])
          if (rest[0].n === 0) { await db.query(`update runs set status = 'done' where id = $1 and status = 'in_progress'`, [stops[0].run_id]); await db.query(`update vehicles set status = 'available' where id = (select vehicle_id from runs where id = $1) and status = 'on_run'`, [stops[0].run_id]) }
        }
      }
    } else {
      await event(`${label} checked by ${who}${noteTail}.`)
    }
    const sum = await summary(db, s)
    const { rows: fresh } = await db.query<Row>('select * from pieces where id = $1', [piece.id])
    res.json({ ok: true, scanId, piece: pieceOut(fresh[0]), ...sum, moved, warnings, place, at: new Date().toISOString() })
  }))

  /** Recent scans by this company — the scanner page shows the last few as a running tally. */
  r.get('/scans/recent', wrap(async (req, res) => {
    const db = await getDb(); const u = await staff(db, req)
    const { rows } = await db.query<Row>(`select sc.id, sc.kind, sc.at, sc.place, sc.note, sc.by_name, p.seq, p.label_code, s.ref, s.id as shipment_id, (select count(*) from pieces where shipment_id = s.id)::int as total from scans sc join pieces p on p.id = sc.piece_id join shipments s on s.id = sc.shipment_id where s.shipper_id = $1 order by sc.at desc limit 30`, [u.shipperId])
    res.json({ scans: rows.map((x) => ({ id: x.id, kind: x.kind, at: ISO(x.at), place: x.place, note: x.note, by: x.by_name, seq: Number(x.seq), total: x.total, labelCode: x.label_code, ref: x.ref, shipmentId: x.shipment_id })) })
  }))
}

/** Public tracking: piece list without staff names, so customers see "3 of 4 loaded". */
export async function piecesForTracking(db: Db, shipmentId: string) {
  const { rows } = await db.query<Row>('select seq, status, last_scan_at, last_scan_kind, last_scan_place from pieces where shipment_id = $1 order by seq', [shipmentId])
  return rows.map((p) => ({ seq: Number(p.seq), status: p.status, lastScanAt: ISO(p.last_scan_at), lastScanKind: p.last_scan_kind, lastScanPlace: p.last_scan_place }))
}
