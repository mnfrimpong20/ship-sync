/**
 * Shipment operations the office needs after (and while) booking:
 *   PUT    /shipments/:id/consignee     add or change who receives it (creates/updates the client's consignee)
 *   POST   /shipments/:id/revert        one status step back, with a reason (owner/dispatcher)
 *   DELETE /shipments/:id               remove a booked shipment that nothing depends on yet (reopens the request)
 *   GET    /shipments/:id/automation    what moves this shipment automatically, and what's expected next
 *   POST   /clients/:id/shipments/full  the comprehensive booking: pieces, consignee, pickup, vehicle, price → invoice, tracking link
 * plus `invoiceForBooking()` — the invoice a marketplace booking creates automatically when the shipper has it on.
 */
import { ensurePieces } from './labels'
import { pickupRow, placePickupOnRun } from './pickups'
import { generateDocument } from './documents'
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { makeRef, uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff, notifyShipmentStatus } from './notify'
import { sendInvoiceMessage } from './collections'
import { countryByCode, nextStatus, prevStatus, statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'
import { zConsignee } from './customer'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadShipments: (db: Db, where: string, params: unknown[]) => Promise<Row[]>
}
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const addDays = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86_400_000).toISOString().slice(0, 10)

/* ---------------- invoices ---------------- */

export interface InvoiceLine { description: string; qty: number; unit: number }
/** Create an invoice for a client + shipment and (optionally) send it. Numbering is per shipper per year. */
export async function createInvoice(db: Db, o: { shipperId: string; clientId: string; shipmentId?: string | null; items: InvoiceLine[]; tax?: number; dueAt?: string | null; notes?: string; status?: 'draft' | 'sent'; by?: string; send?: boolean }) {
  o = { ...o, items: o.items.map((i) => ({ ...i, description: i.description.slice(0, 160) })) }
  const subtotal = Math.round(o.items.reduce((n, i) => n + i.qty * i.unit, 0)); const tax = o.tax ?? 0; const total = subtotal + tax
  const year = new Date().getFullYear()
  const { rows: seq } = await db.query<{ n: string }>(`select count(*)::text as n from invoices where shipper_id = $1 and number like $2`, [o.shipperId, `INV-${year}-%`])
  let number = `INV-${year}-${String(Number(seq[0].n) + 1).padStart(4, '0')}`
  for (let i = 0; i < 8; i++) { const { rows: dup } = await db.query('select 1 from invoices where shipper_id = $1 and number = $2', [o.shipperId, number]); if (!dup.length) break; number = `INV-${year}-${String(Number(seq[0].n) + 2 + i).padStart(4, '0')}` }
  const id = 'inv_' + uid()
  await db.query(`insert into invoices (id,shipper_id,client_id,shipment_id,number,status,items,subtotal,tax,total,issued_at,due_at,notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, o.shipperId, o.clientId, o.shipmentId ?? null, number, o.status ?? 'sent', JSON.stringify(o.items), subtotal, tax, total, new Date().toISOString().slice(0, 10), o.dueAt ?? null, o.notes ?? ''])
  await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), o.clientId, o.shipperId, `Invoice ${number} ${o.status === 'draft' ? 'drafted' : 'created'} for $${total.toLocaleString()}${o.shipmentId ? ' from the booking' : ''}.`])
  let sent: string[] = []
  if (o.send && (o.status ?? 'sent') === 'sent') {
    try {
      const { rows } = await db.query<Row>(`select i.*, c.email as client_email, c.user_id as client_user_id, c.name as client_name, c.phone as client_phone, s.name as shipper_name from invoices i join clients c on c.id = i.client_id join shippers s on s.id = i.shipper_id where i.id = $1`, [id])
      if (rows[0] && (rows[0].client_email || rows[0].client_user_id)) sent = await sendInvoiceMessage(db, rows[0], 'invoice', { by: o.by })
    } catch (e) { console.error('[invoice] auto-send', e) }
  }
  return { id, number, total, sent }
}

/** Per-shipper booking preferences (stored in shippers.prefs). */
export interface ShipperPrefs {
  autoInvoice: boolean; invoiceDueDays: number; autoLabels: boolean; autoTrackingLink: boolean
  /** How recipients usually get their goods. Each booking can override it. */
  defaultHandover: 'delivery' | 'collection'
  /** Unpaid balance at handover: off · warn the driver/desk · block until paid (owners can override). */
  holdUnpaid: 'off' | 'warn' | 'block'
  /** Offered to collection recipients on arrival; 0 hides the offer. */
  doorDeliveryUsd: number
  /** Customer-requested pickups in an open slot go straight onto the day's run. */
  autoConfirmPickups: boolean
  /** Ask the client (email/notification) for the recipient when a booking has none. */
  recipientNudges: boolean
  /** Shown in the collection text, e.g. opening hours or what ID to bring. */
  collectionNote: string
  /** Packing list (and commercial invoice when there's a declared value) generated at booking. */
  autoDocuments: boolean
  /** Office alert when a shipment sits in one status much longer than usual. */
  stuckAlerts: boolean
}
export const DEFAULT_PREFS: ShipperPrefs = { autoInvoice: true, invoiceDueDays: 14, autoLabels: true, autoTrackingLink: true, defaultHandover: 'collection', holdUnpaid: 'warn', doorDeliveryUsd: 0, autoConfirmPickups: false, recipientNudges: true, collectionNote: 'Bring a photo ID and your collection code.', autoDocuments: true, stuckAlerts: true }
export async function prefsOf(db: Db, shipperId: string): Promise<ShipperPrefs> { const { rows } = await db.query<Row>('select prefs from shippers where id = $1', [shipperId]); return { ...DEFAULT_PREFS, ...((J(rows[0]?.prefs) ?? {}) as Partial<ShipperPrefs>) } }

/** Marketplace booking (quote accepted): the invoice follows the quote — price, what it includes, due in N days. */
export async function invoiceForBooking(db: Db, shipmentId: string, quote: Row) {
  const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s?.client_id) return null
  const prefs = await prefsOf(db, s.shipper_id); if (!prefs.autoInvoice) return null
  const includes = (J(quote.includes) ?? []) as string[]
  const dest = countryByCode(s.destination)?.name ?? s.destination
  const items: InvoiceLine[] = [{ description: `${s.mode === 'air' ? 'Air' : 'Ocean'} freight, ${s.origin} → ${dest} — ${s.description}${includes.length ? ` (includes ${includes.join(', ')})` : ''}`, qty: 1, unit: Number(quote.price) }]
  const { rows: po } = s.request_id ? await db.query<Row>(`select r.po_number, u.company_name from requests r join users u on u.id = r.user_id where r.id = $1`, [s.request_id]) : { rows: [] as Row[] }
  if (po[0]?.company_name) await db.query(`update clients set company = $2 where id = $1 and company = ''`, [s.client_id, po[0].company_name])
  const inv = await createInvoice(db, { shipperId: s.shipper_id, clientId: s.client_id, shipmentId: s.id, items, dueAt: addDays(new Date().toISOString().slice(0, 10), prefs.invoiceDueDays), notes: `${po[0]?.po_number ? `PO ${po[0].po_number}. ` : ''}Per your accepted quote. Duty and destination charges, if any, are payable at destination.`, status: 'sent', send: false })
  await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `Invoice ${inv.number} issued for $${inv.total.toLocaleString()}.`])
  return inv
}

/** Everything that follows a new booking, whichever way it was made: handover default, original ETA, documents. */
export async function afterBooking(db: Db, shipmentId: string, o: { delivery?: boolean; handover?: 'delivery' | 'collection'; by?: string }) {
  const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) return
  const prefs = await prefsOf(db, s.shipper_id)
  const handover = o.handover ?? (o.delivery ? 'delivery' : prefs.defaultHandover)
  await db.query('update shipments set handover = $2, eta_original = coalesce(eta_original, eta) where id = $1', [s.id, handover]); s.handover = handover
  if (prefs.autoDocuments) {
    await generateDocument(db, s, 'packing_list', 'shared', o.by ?? 'Ntemtem').catch((e) => console.error('[booking] packing list', e instanceof Error ? e.message : e))
    const b = (typeof s.booking === 'string' ? JSON.parse(s.booking) : s.booking) ?? {}
    if (Number(b.declaredValueUsd) > 0) await generateDocument(db, s, 'commercial_invoice', 'shipper', o.by ?? 'Ntemtem').catch((e) => console.error('[booking] commercial invoice', e instanceof Error ? e.message : e))
  }
}

/* ---------------- automation summary ---------------- */
const TRIGGERS: { from: ShipmentStatus; to: ShipmentStatus; how: string }[] = [
  { from: 'picked_up', to: 'in_transit', how: 'the flight is seen airborne on ADS-B (air shipments with a flight number)' },
  { from: 'booked', to: 'picked_up', how: 'a pickup run stop is marked done, or a piece is scanned as collected/received at the warehouse' },
  { from: 'picked_up', to: 'at_origin_port', how: 'the container it is loaded in is gated in at port' },
  { from: 'at_origin_port', to: 'in_transit', how: 'the container sails (carrier milestone or manual), or a vessel/flight is assigned with a departure' },
  { from: 'in_transit', to: 'arrived', how: 'the container arrives (carrier milestone) or the vessel reaches the destination port' },
  { from: 'arrived', to: 'customs', how: 'the container moves to customs' },
  { from: 'customs', to: 'out_for_delivery', how: 'a delivery run containing it is started' },
  { from: 'ready_for_collection', to: 'delivered', how: 'the recipient’s collection code is entered at the desk' },
  { from: 'out_for_delivery', to: 'delivered', how: 'the driver marks the stop done / scans proof of delivery, or the recipient confirms on their link' },
]

export function mountShipmentOps(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap, loadShipments } = d
  const office = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    if (u.role !== 'shipper' || s.shipper_id !== u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Only the handling shipper’s office can do this.')
    return { u, s }
  }

  /** Add or change the recipient. Works for marketplace shipments too (they always have a client record). */
  r.put('/shipments/:id/consignee', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    const b = z.object({ consigneeId: z.string().optional() }).merge(zConsignee.partial()).parse(req.body)
    let clientId = s.client_id as string | null
    if (!clientId) {
      // Older marketplace shipment without a client record: make one from the customer.
      const { rows: cu } = s.user_id ? await db.query<Row>('select name, email from users where id = $1', [s.user_id]) : { rows: [] as Row[] }
      clientId = 'cl_' + uid()
      await db.query(`insert into clients (id,shipper_id,user_id,name,email,source) values ($1,$2,$3,$4,$5,'marketplace') on conflict (shipper_id, user_id) do nothing`, [clientId, s.shipper_id, s.user_id ?? null, cu[0]?.name ?? s.customer, cu[0]?.email ?? ''])
      const { rows: ex } = s.user_id ? await db.query<Row>('select id from clients where shipper_id = $1 and user_id = $2', [s.shipper_id, s.user_id]) : { rows: [{ id: clientId }] }
      clientId = ex[0].id; await db.query('update shipments set client_id = $2 where id = $1', [s.id, clientId])
    }
    let cid = b.consigneeId
    if (cid) { const { rows } = await db.query<Row>('select id from client_consignees where id = $1 and client_id = $2', [cid, clientId]); if (!rows[0]) throw new HttpError(400, 'That recipient belongs to another client.') }
    else {
      if (!b.name || b.name.trim().length < 2) throw new HttpError(400, 'Enter the recipient’s name.')
      if (s.consignee_id) { await db.query('update client_consignees set name=$2, phone=$3, address=$4, city=$5, country=$6, relationship=$7, gps=$9, lat=$10, lng=$11 where id = $1 and client_id = $8', [s.consignee_id, b.name, b.phone ?? '', b.address ?? '', b.city ?? '', b.country ?? s.destination, b.relationship ?? '', clientId, b.gps ?? '', b.lat ?? null, b.lng ?? null]); cid = s.consignee_id }
      else { cid = 'cs_' + uid(); await db.query('insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,gps,lat,lng,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)', [cid, clientId, b.name, b.phone ?? '', b.address ?? '', b.city ?? '', b.country ?? s.destination, b.relationship ?? '', b.gps ?? '', b.lat ?? null, b.lng ?? null]) }
    }
    await db.query('update shipments set consignee_id = $2 where id = $1', [s.id, cid])
    const { rows: c } = await db.query<Row>('select * from client_consignees where id = $1', [cid])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, countryByCode(s.destination)?.name ?? s.destination, `Recipient set: ${c[0].name}${c[0].city ? `, ${c[0].city}` : ''} (by ${u.name}).`])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref}: recipient set to ${c[0].name}`, body: `${u.company ?? 'Your shipper'} added who receives this shipment${c[0].city ? ` in ${c[0].city}` : ''}. They'll get the arrival text.`, link: `/dashboard?tab=shipments&open=${s.id}`, dedupe: `cons:${s.id}:${cid}` })
    res.json({ consignee: { id: c[0].id, name: c[0].name, phone: c[0].phone, address: c[0].address, city: c[0].city, country: c[0].country, relationship: c[0].relationship, gps: c[0].gps ?? '', lat: c[0].lat == null ? null : Number(c[0].lat), lng: c[0].lng == null ? null : Number(c[0].lng) } })
  }))

  /** One step back. Managers only; the reason goes on the timeline and to the customer. */
  r.post('/shipments/:id/revert', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    if (!['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Only owners and dispatchers can move a shipment back.')
    const b = z.object({ reason: z.string().trim().min(3, 'Say why — the customer sees it.').max(300) }).parse(req.body)
    if (s.cancelled_at) throw new HttpError(409, 'This shipment was cancelled.')
    const prev = prevStatus(s.status as ShipmentStatus, s.handover); if (!prev) throw new HttpError(409, 'Already at the first step.')
    const idx = statusOrder.indexOf(s.status as ShipmentStatus)
    await db.query('update shipments set status = $2 where id = $1', [s.id, prev])
    if (statusOrder.indexOf(prev) < statusOrder.indexOf('in_transit')) await db.query('update shipments set departed_at = null where id = $1', [s.id])
    if (s.status === 'ready_for_collection') await db.query('update shipments set collection_code = null where id = $1', [s.id])
    if (s.status === 'delivered') await db.query('update shipments set delivered_at = null where id = $1', [s.id])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, prev, statusOrder.indexOf(prev) < 3 ? s.origin : (countryByCode(s.destination)?.name ?? s.destination), `Moved back to “${statusLabels[prev]}” by ${u.name}: ${b.reason}`])
    if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} moved back to “${statusLabels[prev]}” — ${b.reason}`])
    await notifyShipmentStatus(db, s, prev, `Corrected: ${b.reason}`)
    const [shipment] = await loadShipments(db, 'id = $1', [s.id]); res.json({ shipment })
  }))

  /** Delete a booking nothing depends on yet. Anything paid, invoiced, scanned or loaded has to be unwound first. */
  r.delete('/shipments/:id', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    if (!['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Only owners and dispatchers can delete a shipment.')
    if (s.status !== 'booked') throw new HttpError(409, `Only shipments still at “Booked” can be deleted — this one is “${statusLabels[s.status as ShipmentStatus]}”. Move it back first if it was advanced by mistake.`)
    const blockers: string[] = []
    const count = async (sql: string, label: string) => { const { rows } = await db.query<Row>(sql, [s.id]); if (Number(rows[0].n) > 0) blockers.push(label) }
    await count(`select count(*)::int as n from escrow_payments where shipment_id = $1 and status in ('held','released','paid_out')`, 'a payment')
    await count(`select count(*)::int as n from invoices where shipment_id = $1 and status in ('sent','paid')`, 'an invoice (void it first)')
    await count(`select count(*)::int as n from scans where shipment_id = $1`, 'scans')
    await count(`select count(*)::int as n from run_stops where shipment_id = $1 and status = 'done'`, 'a completed run stop')
    if (s.container_id) blockers.push('a container (unload it first)')
    if (blockers.length) throw new HttpError(409, `Can’t delete: this shipment has ${blockers.join(', ')}.`)
    const b = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {})
    if (s.request_id) {
      await db.query(`update requests set status = 'open' where id = $1`, [s.request_id])
      await db.query(`update quotes set status = 'sent' where request_id = $1 and status in ('accepted','declined')`, [s.request_id])
    }
    if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} deleted by ${u.name}${b.reason ? ` — ${b.reason}` : ''}.`])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref} was cancelled by ${u.company ?? 'your shipper'}`, body: `${b.reason || 'The booking was removed.'}${s.request_id ? ' Your request is open again and other shippers can quote it.' : ''}`, link: '/dashboard', dedupe: `del:${s.id}` })
    await db.query('delete from shipments where id = $1', [s.id])
    res.json({ ok: true, reopenedRequest: !!s.request_id })
  }))

  /** What will move this shipment on its own, and what the office still has to do by hand. */
  r.get('/shipments/:id/automation', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [req.params.id]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    if (!(u.role === 'shipper' && s.shipper_id === u.shipperId) && !(u.role === 'customer' && s.user_id === u.id)) throw new HttpError(403, 'Not yours.')
    const { rows: c } = s.container_id ? await db.query<Row>('select ref, status, tracking_status, eta from containers where id = $1', [s.container_id]) : { rows: [] as Row[] }
    const { rows: runs } = await db.query<Row>(`select r.kind, r.status, r.run_date from run_stops rs join runs r on r.id = rs.run_id where rs.shipment_id = $1 and rs.status = 'pending' order by r.run_date`, [s.id])
    const { rows: pcs } = await db.query<Row>('select count(*)::int as n from pieces where shipment_id = $1', [s.id])
    const idx = statusOrder.indexOf(s.status as ShipmentStatus)
    const nx = nextStatus(s.status as ShipmentStatus, s.handover)
    const next = s.handover === 'collection' && (s.status === 'customs' || s.status === 'arrived') && s.container_id ? { from: s.status, to: 'ready_for_collection' as ShipmentStatus, how: 'the container is marked unloaded at your destination warehouse — the recipient gets their collection code' }
      : s.status === 'ready_for_collection' ? { from: s.status, to: 'delivered' as ShipmentStatus, how: 'the recipient shows their collection code at the desk (Manage → Hand over), or the destination agent enters it' }
      : TRIGGERS.find((t) => t.from === s.status && t.to === nx) ?? (nx ? { from: s.status, to: nx, how: 'someone moves it on by hand — nothing automatic is connected for this step' } : undefined)
    const wired = { container: c[0] ? { ref: c[0].ref, status: c[0].status, carrierTracking: c[0].tracking_status === 'live', eta: DATE(c[0].eta) } : null, pickupRun: runs.find((x) => x.kind === 'pickup') ? { status: runs.find((x) => x.kind === 'pickup')!.status, date: DATE(runs.find((x) => x.kind === 'pickup')!.run_date) } : null, deliveryRun: runs.find((x) => x.kind === 'delivery') ? { status: runs.find((x) => x.kind === 'delivery')!.status, date: DATE(runs.find((x) => x.kind === 'delivery')!.run_date) } : null, pieces: Number(pcs[0].n), vessel: s.vessel_name || s.flight || null, recipient: !!s.consignee_id }
    const missing: string[] = []
    if (idx < 1 && !wired.pickupRun && !wired.pieces) missing.push('Plan a pickup run or print piece labels — either collection moves it to Picked up automatically.')
    if (idx >= 1 && idx < 3 && !wired.container && s.mode === 'ocean') missing.push('Load it into a container — gate-in and sailing then update it from the carrier.')
    if (idx >= 2 && idx < 4 && !wired.vessel && !wired.container) missing.push('Assign the vessel or flight so the tracking page shows a live position.')
    if (s.handover !== 'collection' && idx >= statusOrder.indexOf('arrived') && idx < statusOrder.indexOf('out_for_delivery') && !wired.deliveryRun) missing.push('Add it to a delivery run — starting the run marks it Out for delivery; the driver’s scan marks it Delivered.')
    if (s.mode === 'air' && idx >= 1 && idx < statusOrder.indexOf('in_transit') && !s.flight) missing.push('Add the flight number — takeoff and landing then move it to In transit and Arrived on their own.')
    if (!wired.recipient) missing.push('Add the recipient so they get the arrival text and the driver can find them.')
    res.json({ status: s.status, next: next ? { to: next.to, how: next.how } : null, wired, missing, triggers: TRIGGERS })
  }))

  /** Automation preferences — what happens on its own when a marketplace quote is accepted or a booking is made. */
  r.get('/shipper/prefs', wrap(async (req, res) => { const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.'); res.json({ prefs: await prefsOf(db, u.shipperId) }) }))
  r.put('/shipper/prefs', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher', 'finance'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners, dispatchers and finance can change automation settings.')
    const b = z.object({ autoInvoice: z.boolean().optional(), invoiceDueDays: z.number().int().min(0).max(120).optional(), autoLabels: z.boolean().optional(), autoTrackingLink: z.boolean().optional(), defaultHandover: z.enum(['delivery', 'collection']).optional(), holdUnpaid: z.enum(['off', 'warn', 'block']).optional(), doorDeliveryUsd: z.number().min(0).max(5000).optional(), autoConfirmPickups: z.boolean().optional(), recipientNudges: z.boolean().optional(), collectionNote: z.string().trim().max(200).optional(), autoDocuments: z.boolean().optional(), stuckAlerts: z.boolean().optional() }).parse(req.body)
    const next = { ...(await prefsOf(db, u.shipperId)), ...b }
    await db.query('update shippers set prefs = $2 where id = $1', [u.shipperId, JSON.stringify(next)])
    res.json({ prefs: next })
  }))

  /** The comprehensive booking. Everything optional beyond the basics; each extra block sets up the next step. */
  const zFull = z.object({
    mode: z.enum(['air', 'ocean']), origin: z.string().trim().min(2).max(80), destination: z.string().trim().length(2).toUpperCase(),
    cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']), description: z.string().trim().max(500).default(''),
    quantity: z.number().int().min(1).max(5000).default(1), weightKg: z.number().min(0).max(100000).optional(), dims: z.string().trim().max(80).default(''), declaredValueUsd: z.number().min(0).max(5_000_000).optional(),
    eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(500).default(''),
    consigneeId: z.string().optional(), consignee: zConsignee.optional(),
    pickup: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), windowStart: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'), windowEnd: z.string().regex(/^\d{2}:\d{2}$/).default('12:00'), address: z.string().trim().min(3).max(200), city: z.string().trim().max(80).default(''), contactName: z.string().trim().max(80).default(''), contactPhone: z.string().trim().max(30).default(''), notes: z.string().trim().max(300).default('') }).optional(),
    vehicle: z.object({ vin: z.string().trim().max(20).default(''), year: z.number().int().min(1950).max(2030).nullable().default(null), make: z.string().trim().max(40).default(''), model: z.string().trim().max(40).default(''), running: z.boolean().default(true), method: z.enum(['roro', 'container']).default('roro'), titleStatus: z.enum(['clean', 'salvage', 'rebuilt', 'lien']).default('clean') }).optional(),
    price: z.object({ freightUsd: z.number().min(0).max(1_000_000), pickupUsd: z.number().min(0).max(100000).default(0), deliveryUsd: z.number().min(0).max(100000).default(0), insuranceUsd: z.number().min(0).max(100000).default(0), otherUsd: z.number().min(0).max(100000).default(0), otherLabel: z.string().trim().max(80).default(''), taxUsd: z.number().min(0).max(100000).default(0), dueDays: z.number().int().min(0).max(120).default(14), createInvoice: z.boolean().default(true), sendInvoice: z.boolean().default(true) }).optional(),
    labels: z.boolean().default(true), sendTracking: z.boolean().default(true), handover: z.enum(['delivery', 'collection']).optional(),
  })
  r.post('/clients/:id/shipments/full', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.')
    const { rows: cs } = await db.query<Row>('select * from clients where id = $1 and shipper_id = $2', [req.params.id, u.shipperId]); const c = cs[0]; if (!c) throw new HttpError(404, 'Client not found.')
    const b = zFull.parse(req.body)
    const { rows: dest } = await db.query<Row>('select 1 from destinations where code = $1 and active', [b.destination]); if (!dest[0]) throw new HttpError(400, 'That destination is not served yet.')
    // consignee
    let consigneeId: string | null = null
    if (b.consigneeId) { const { rows } = await db.query<Row>('select id from client_consignees where id = $1 and client_id = $2', [b.consigneeId, c.id]); if (!rows[0]) throw new HttpError(400, 'That recipient belongs to another client.'); consigneeId = rows[0].id }
    else if (b.consignee?.name) { consigneeId = 'cs_' + uid(); await db.query('insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,gps,lat,lng,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)', [consigneeId, c.id, b.consignee.name, b.consignee.phone ?? '', b.consignee.address ?? '', b.consignee.city ?? '', b.consignee.country ?? b.destination, b.consignee.relationship ?? '', b.consignee.gps ?? '', b.consignee.lat ?? null, b.consignee.lng ?? null]) }
    // shipment
    const id = uid(); const ref = makeRef()
    const descr = b.description || `${b.quantity} × ${b.cargo}${b.vehicle?.make ? ` — ${[b.vehicle.year, b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ')}` : ''} for ${c.name}`
    await db.query(`insert into shipments (id,ref,shipper_id,user_id,client_id,consignee_id,mode,origin,destination,cargo,description,status,eta,customer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'booked',$12,$13)`, [id, ref, u.shipperId, c.user_id ?? null, c.id, consigneeId, b.mode, b.origin, b.destination, b.cargo, descr, b.eta, c.name])
    void import('./integrations').then((m) => m.emitShipment(db, id, 'shipment.booked')).catch(() => {})
    const extras = JSON.stringify({ quantity: b.quantity, weightKg: b.weightKg ?? null, dims: b.dims, declaredValueUsd: b.declaredValueUsd ?? null, readyDate: b.readyDate ?? null, bookedBy: u.name })
    await db.query('update shipments set booking = $2 where id = $1', [id, extras])
    const did: string[] = []
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [id, 'booked', b.origin, `Booked by ${u.name}${b.note ? ` — ${b.note}` : '.'}`])
    // vehicle
    if (b.cargo === 'vehicle' && b.vehicle) { await db.query(`insert into shipment_vehicles (id,shipment_id,vin,year,make,model,running,method,title_status,declared_value_usd) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (shipment_id) do nothing`, ['veh_' + uid(), id, b.vehicle.vin, b.vehicle.year, b.vehicle.make, b.vehicle.model, b.vehicle.running, b.vehicle.method, b.vehicle.titleStatus, b.declaredValueUsd ?? 0]).catch(() => {}); did.push('vehicle recorded') }
    // pieces / labels
    if (b.labels && b.cargo !== 'vehicle' && b.quantity > 0 && b.quantity <= 500) {
      await ensurePieces(db, { id, ref, request_id: null, description: descr }, b.quantity)
      did.push(`${b.quantity} label${b.quantity === 1 ? '' : 's'} ready to print`)
    }
    // pickup
    let pickupId: string | null = null
    if (b.pickup) {
      pickupId = 'pk_' + uid()
      await db.query(`insert into pickup_requests (id,shipment_id,shipper_id,user_id,pickup_date,window_start,window_end,address,city,contact_name,contact_phone,notes,status,by_role) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed','shipper')`, [pickupId, id, u.shipperId, c.user_id ?? null, b.pickup.date, b.pickup.windowStart, b.pickup.windowEnd, b.pickup.address, b.pickup.city, b.pickup.contactName || c.name, b.pickup.contactPhone || c.phone || '', b.pickup.notes])
      const pr = await pickupRow(db, pickupId); if (pr) await placePickupOnRun(db, pr).catch((e) => console.error('[booking] pickup run', e))
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [id, 'booked', b.origin, `Pickup booked for ${b.pickup.date}, ${b.pickup.windowStart}–${b.pickup.windowEnd} at ${b.pickup.address} — on the pickup run for that day.`])
      did.push(`pickup on ${b.pickup.date} (on that day’s run)`)
    }
    // invoice
    let invoice: { id: string; number: string; total: number; sent: string[] } | null = null
    if (b.price && b.price.createInvoice) {
      const destName = countryByCode(b.destination)?.name ?? b.destination
      const items: InvoiceLine[] = [{ description: `${b.mode === 'air' ? 'Air' : 'Ocean'} freight, ${b.origin} → ${destName} — ${descr}`, qty: 1, unit: Math.round(b.price.freightUsd) }]
      if (b.price.pickupUsd) items.push({ description: `Pickup${b.pickup ? ` on ${b.pickup.date}` : ''}`, qty: 1, unit: Math.round(b.price.pickupUsd) })
      if (b.price.deliveryUsd) items.push({ description: `Door delivery at destination`, qty: 1, unit: Math.round(b.price.deliveryUsd) })
      if (b.price.insuranceUsd) items.push({ description: `Cargo insurance${b.declaredValueUsd ? ` (declared $${b.declaredValueUsd.toLocaleString()})` : ''}`, qty: 1, unit: Math.round(b.price.insuranceUsd) })
      if (b.price.otherUsd) items.push({ description: b.price.otherLabel || 'Other charges', qty: 1, unit: Math.round(b.price.otherUsd) })
      invoice = await createInvoice(db, { shipperId: u.shipperId, clientId: c.id, shipmentId: id, items, tax: Math.round(b.price.taxUsd), dueAt: addDays(new Date().toISOString().slice(0, 10), b.price.dueDays), notes: 'Duty and destination charges, if any, are payable at destination.', status: 'sent', by: u.name, send: b.price.sendInvoice })
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [id, 'booked', b.origin, `Invoice ${invoice.number} issued for $${invoice.total.toLocaleString()}${invoice.sent.length ? ` and sent by ${invoice.sent.join(' + ')}` : ''}.`])
      did.push(`invoice ${invoice.number}${invoice.sent.length ? ' sent' : ''}`)
    }
    await afterBooking(db, id, { handover: b.handover, by: u.name }).catch((e) => console.error('[booking] after', e))
    // tracking link to the customer
    if (b.sendTracking && c.user_id) { await notify(db, { userId: c.user_id, kind: 'booking_confirmed', title: `Booking confirmed — ${ref}`, body: `${u.company ?? 'Your shipper'} booked your ${b.mode} shipment ${b.origin} → ${countryByCode(b.destination)?.name ?? b.destination}, ETA ${b.eta}. Track it any time with reference ${ref}.`, link: `/dashboard?tab=shipments&open=${id}`, dedupe: `book:${id}` }); did.push('customer told') }
    await db.query(`insert into client_activities (id,client_id,shipper_id,type,body,created_by) values ($1,$2,$3,'system',$4,$5)`, [uid(), c.id, u.shipperId, `Shipment ${ref} booked (${b.mode}, ${b.origin} → ${countryByCode(b.destination)?.name ?? b.destination})${did.length ? ` — ${did.join(', ')}` : ''}.`, u.id])
    await notifyShipperStaff(db, u.shipperId, { kind: 'booking_confirmed', title: `${ref} booked for ${c.name}`, body: did.join(' · ') || 'No extras.', link: `/dashboard/shipments`, dedupe: `book:${id}:staff` }, ['owner', 'dispatcher'])
    const [shipment] = await loadShipments(db, 'id = $1', [id])
    res.status(201).json({ shipment, invoice, pickupId, did })
  }))
}
