/**
 * Routes for the shipment flow (see flow.ts for the automation itself).
 *   Office:   PUT /shipments/:id/handover · POST /shipments/:id/collect · POST /shipments/:id/collection-code/resend
 *             POST /shipments/:id/checkin · POST /shipments/:id/charges · POST /shipments/:id/cancel · GET /shipments/:id/release
 *             GET /shipper/stuck · GET /shipper/lane-times
 *             GET /containers/:id/manifest · GET|POST /containers/:id/partners · DELETE /partners/:id · POST /partners/:id/pre-alert
 *   Customer: GET /me/shipments/:id/offers · POST /me/shipments/:id/offers/:kind
 *   Public:   GET|POST /add-recipient/:token (the client adds the recipient without logging in)
 *             GET /p/:token · POST /p/:token/container · POST /p/:token/shipments/:sid/handover · POST /p/:token/shipments/:sid/note
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { ensurePieces } from './labels'
import { messageRecipient } from './recipient'
import { advanceContainer } from './containers'
import { zConsignee } from './customer'
import { acceptOffer, addInvoiceLine, cancelShipment, collect, destinationSite, ensureDetailsToken, laneTimes, manifestFor, offersFor, owedFor, partnerUrl, raiseStatus, recipientFormUrl, sendPreAlerts, stuckFor } from './flow'
import { prefsOf } from './shipmentOps'
import { countryByCode, statusLabels, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadShipments: (db: Db, where: string, params: unknown[], opts?: { includeCancelled?: boolean }) => Promise<unknown[]>
}
const ISO = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const zOverride = z.object({ reason: z.string().trim().min(3).max(200) }).nullable().optional()

export function mountFlow(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap, loadShipments } = d
  /** Office staff of the handling shipper (drivers excluded unless allowed). */
  const office = async (db: Db, req: Request, id: string, o: { drivers?: boolean; managers?: boolean } = {}) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [id]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    if (u.role !== 'shipper' || s.shipper_id !== u.shipperId) throw new HttpError(403, 'Only the handling shipper can do this.')
    if (!o.drivers && isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    if (o.managers && !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Only owners and dispatchers can do this.')
    return { u, s }
  }
  const fresh = async (db: Db, id: string) => (await loadShipments(db, 'id = $1', [id], { includeCancelled: true }))[0]

  /* ---- handover choice ---- */
  r.put('/shipments/:id/handover', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    const b = z.object({ handover: z.enum(['delivery', 'collection']) }).parse(req.body)
    if (s.status === 'delivered' || s.status === 'out_for_delivery') throw new HttpError(409, 'Too late to change how it’s handed over.')
    if (b.handover !== s.handover) {
      await db.query('update shipments set handover = $2 where id = $1', [s.id, b.handover])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `${b.handover === 'collection' ? 'Recipient will collect from the warehouse' : 'Switched to door delivery'} (by ${u.name}).`])
      // Already unloaded? A collection shipment opens for collection straight away.
      if (b.handover === 'collection' && s.ready_at && ['arrived', 'customs'].includes(s.status)) await raiseStatus(db, { ...s, handover: 'collection' }, 'ready_for_collection', countryByCode(s.destination)?.name ?? s.destination, 'Ready for collection.')
      if (b.handover === 'delivery') await db.query('update shipments set collection_code = null where id = $1', [s.id])
    }
    res.json({ shipment: await fresh(db, s.id) })
  }))

  /* ---- collection at the desk ---- */
  r.post('/shipments/:id/collect', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    const b = z.object({ code: z.string().trim().max(12).optional(), receivedBy: z.string().trim().min(2, 'Enter the name of the person collecting.').max(80), override: zOverride }).parse(req.body)
    await collect(db, s, { code: b.code, receivedBy: b.receivedBy, by: u.name, byRole: u.staffRole, override: b.override ?? null })
    res.json({ shipment: await fresh(db, s.id) })
  }))
  r.post('/shipments/:id/collection-code/resend', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    if (s.status !== 'ready_for_collection' || !s.collection_code) throw new HttpError(409, 'There’s no open collection for this shipment.')
    const m = await messageRecipient(db, s, 'ready', { force: true, note: `Collection code ${s.collection_code}.`, by: u.name })
    await db.query('update shipments set collection_attempts = 0 where id = $1', [s.id])
    res.json({ sent: m ? m.status : 'no_recipient_phone', to: m?.to_phone ?? null })
  }))

  /* ---- warehouse check-in: actual pieces/weight, adjust the invoice ---- */
  r.post('/shipments/:id/checkin', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    const b = z.object({ pieces: z.number().int().min(1).max(500), weightKg: z.number().min(0).max(100000).optional(), note: z.string().trim().max(300).default(''), adjustment: z.object({ description: z.string().trim().min(2).max(120), amountUsd: z.number().min(-100000).max(100000) }).optional() }).parse(req.body)
    const booking = (J(s.booking) ?? {}) as Row
    const before = { pieces: Number(booking.quantity ?? 0) || null, weightKg: booking.weightKg ?? null }
    const pieces = await ensurePieces(db, s, b.pieces)
    const { rows: site } = await db.query<Row>(`select * from sites where shipper_id = $1 and kind = 'origin' and active order by created_at limit 1`, [s.shipper_id])
    if (site[0]) await db.query('update pieces set site_id = $2, received_at = coalesce(received_at, now()), released_at = null where shipment_id = $1 and site_id is null and status = \'labelled\'', [s.id, site[0].id])
    const received = { pieces: b.pieces, weightKg: b.weightKg ?? null, at: new Date().toISOString(), by: u.name, note: b.note }
    await db.query('update shipments set booking = $2 where id = $1', [s.id, JSON.stringify({ ...booking, quantity: b.pieces, weightKg: b.weightKg ?? booking.weightKg ?? null, received, declared: booking.declared ?? before })])
    const diff = [before.pieces && before.pieces !== b.pieces ? `${b.pieces} pieces (booked ${before.pieces})` : `${b.pieces} piece${b.pieces === 1 ? '' : 's'}`, b.weightKg != null ? `${b.weightKg} kg${before.weightKg ? ` (booked ${before.weightKg} kg)` : ''}` : ''].filter(Boolean).join(', ')
    const place = site[0]?.name ?? s.origin
    if (!(await raiseStatus(db, s, 'picked_up', place, `Received at ${place}: ${diff}${b.note ? ` — ${b.note}` : ''}.`))) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, place, `Checked in: ${diff}${b.note ? ` — ${b.note}` : ''}.`])
    let invoice: string | null = null
    if (b.adjustment && b.adjustment.amountUsd !== 0) invoice = await addInvoiceLine(db, s, { description: b.adjustment.description, qty: 1, unit: Math.round(b.adjustment.amountUsd) }, { by: u.name })
    res.json({ shipment: await fresh(db, s.id), pieces: pieces.length, invoice })
  }))
  r.post('/shipments/:id/charges', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id))
    const b = z.object({ description: z.string().trim().min(2).max(120), amountUsd: z.number().min(-100000).max(100000) }).parse(req.body)
    const n = await addInvoiceLine(db, s, { description: b.description, qty: 1, unit: Math.round(b.amountUsd) }, { by: u.name })
    if (!n) throw new HttpError(409, 'This shipment has no client to invoice.')
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `${b.description} (${b.amountUsd < 0 ? '−' : ''}$${Math.abs(Math.round(b.amountUsd))}) added to ${n} by ${u.name}.`])
    res.status(201).json({ invoice: n })
  }))

  /* ---- release status, cancellation ---- */
  r.get('/shipments/:id/release', wrap(async (req, res) => {
    const db = await getDb(); const { s } = await office(db, req, String(req.params.id), { drivers: true })
    const prefs = await prefsOf(db, s.shipper_id)
    res.json({ ...(await owedFor(db, s)), rule: prefs.holdUnpaid, storage: J(s.storage_due), collection: s.status === 'ready_for_collection' ? { attempts: Number(s.collection_attempts), locked: Number(s.collection_attempts) >= 5, readyAt: ISO(s.ready_at) } : null })
  }))
  r.post('/shipments/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await office(db, req, String(req.params.id), { managers: true })
    const b = z.object({ reason: z.string().trim().min(3, 'Say why — the client sees it.').max(300), refund: z.boolean().default(true) }).parse(req.body)
    const r2 = await cancelShipment(db, s, { reason: b.reason, refund: b.refund, by: u.name })
    res.json({ ...r2, shipment: await fresh(db, s.id) })
  }))

  /* ---- insight lists ---- */
  r.get('/shipper/stuck', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    const { rows } = await db.query<Row>(`select * from shipments where shipper_id = $1 and status <> 'delivered' and cancelled_at is null`, [u.shipperId])
    const { rows: evs } = rows.length ? await db.query<Row>('select shipment_id, status, at from shipment_events where shipment_id = any($1::text[])', [rows.map((x) => x.id)]) : { rows: [] as Row[] }
    const out = []
    for (const s of rows) { const st = await stuckFor(db, s, evs.filter((e) => e.shipment_id === s.id)); if (st) out.push({ id: s.id, ref: s.ref, customer: s.customer, status: s.status, statusLabel: statusLabels[s.status as ShipmentStatus], ...st }) }
    out.sort((a, b) => b.days / b.typical - a.days / a.typical)
    res.json({ stuck: out })
  }))
  r.get('/shipper/lane-times', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    res.json(await laneTimes(db, u.shipperId))
  }))

  /* ---- manifest + destination partners ---- */
  const ownContainer = async (db: Db, req: Request, id: string) => {
    const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>('select * from containers where id = $1 and shipper_id = $2', [id, u.shipperId]); if (!rows[0]) throw new HttpError(404, 'Container not found.')
    return { u, c: rows[0] }
  }
  const linkOut = (l: Row) => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, url: partnerUrl(l.token), path: `/p/${l.token}`, createdAt: ISO(l.created_at), lastSeenAt: ISO(l.last_seen_at), preAlertSentAt: ISO(l.pre_alert_sent_at), revoked: !!l.revoked_at })
  r.get('/containers/:id/manifest', wrap(async (req, res) => { const db = await getDb(); const { c } = await ownContainer(db, req, String(req.params.id)); const { rows: sh } = await db.query<Row>('select name from shippers where id = $1', [c.shipper_id]); res.json({ ...(await manifestFor(db, c)), shipper: sh[0]?.name ?? '' }) }))
  r.get('/containers/:id/partners', wrap(async (req, res) => { const db = await getDb(); const { c } = await ownContainer(db, req, String(req.params.id)); const { rows } = await db.query<Row>('select * from partner_links where container_id = $1 and revoked_at is null order by created_at', [c.id]); res.json({ partners: rows.map(linkOut) }) }))
  r.post('/containers/:id/partners', wrap(async (req, res) => {
    const db = await getDb(); const { u, c } = await ownContainer(db, req, String(req.params.id))
    const b = z.object({ name: z.string().trim().min(2, 'Name the agent or company.').max(80), email: z.string().trim().email().or(z.literal('')).default(''), phone: z.string().trim().max(30).default('') }).parse(req.body)
    const id = 'pl_' + uid(); const token = randomBytes(15).toString('base64url')
    await db.query('insert into partner_links (id,token,shipper_id,container_id,name,email,phone,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, token, c.shipper_id, c.id, b.name, b.email, b.phone, u.name])
    await db.query('insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,$3,$4,$5,\'manual\',\'\')', [c.id, c.status, '', `Destination agent link created for ${b.name}.`, u.name])
    if (b.email && ['sailed', 'arrived', 'customs'].includes(c.status)) await sendPreAlerts(db, c)
    const { rows } = await db.query<Row>('select * from partner_links where id = $1', [id]); res.status(201).json({ partner: linkOut(rows[0]) })
  }))
  r.delete('/partners/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from partner_links where id = $1 and shipper_id = $2', [req.params.id, u.shipperId ?? '']); if (!rows[0] || isDriverRole(u.staffRole)) throw new HttpError(404, 'Link not found.')
    await db.query('update partner_links set revoked_at = now() where id = $1', [rows[0].id]); res.json({ ok: true })
  }))
  r.post('/partners/:id/pre-alert', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select l.*, c.id as cid from partner_links l join containers c on c.id = l.container_id where l.id = $1 and l.shipper_id = $2 and l.revoked_at is null', [req.params.id, u.shipperId ?? '']); if (!rows[0] || isDriverRole(u.staffRole)) throw new HttpError(404, 'Link not found.')
    if (!rows[0].email) throw new HttpError(400, 'Add an email for this agent first.')
    const { rows: c } = await db.query<Row>('select * from containers where id = $1', [rows[0].cid]); await db.query('update partner_links set pre_alert_sent_at = null where id = $1', [rows[0].id])
    res.json({ sent: await sendPreAlerts(db, c[0]) })
  }))

  /* ---- public: destination partner page ---- */
  const partner = async (db: Db, token: string) => {
    const { rows } = await db.query<Row>('select l.*, s.name as shipper_name from partner_links l join shippers s on s.id = l.shipper_id where l.token = $1 and l.revoked_at is null', [token])
    if (!rows[0]) throw new HttpError(404, 'This link has expired or was switched off by the shipper.')
    const { rows: c } = await db.query<Row>('select * from containers where id = $1', [rows[0].container_id]); if (!c[0]) throw new HttpError(404, 'Container not found.')
    await db.query('update partner_links set last_seen_at = now() where id = $1', [rows[0].id])
    return { l: rows[0], c: c[0] }
  }
  r.get('/p/:token', wrap(async (req, res) => {
    const db = await getDb(); const { l, c } = await partner(db, String(req.params.token))
    const m = await manifestFor(db, c); const prefs = await prefsOf(db, c.shipper_id)
    res.set('Cache-Control', 'no-store')
    res.json({ partner: { name: l.name }, shipper: { name: l.shipper_name }, holdUnpaid: prefs.holdUnpaid, ...m, shipments: m.shipments.map((x) => ({ ...x, owedUsd: undefined, paymentDue: x.owedUsd > 0 })) })
  }))
  r.post('/p/:token/container', wrap(async (req, res) => {
    const db = await getDb(); const { l, c } = await partner(db, String(req.params.token))
    const b = z.object({ stage: z.enum(['arrived', 'customs', 'devanned']), note: z.string().trim().max(300).default('') }).parse(req.body)
    const order = ['sailed', 'arrived', 'customs', 'devanned']
    if (order.indexOf(b.stage) <= order.indexOf(c.status)) throw new HttpError(409, `${c.ref} is already past that.`)
    if (order.indexOf(c.status) < 0) throw new HttpError(409, `${c.ref} hasn’t sailed yet.`)
    await advanceContainer(db, c, b.stage, { note: b.note || `Updated by ${l.name} (destination agent).`, by: `${l.name} (agent)`, place: c.destination_port || '' })
    await notifyShipperStaff(db, c.shipper_id, { kind: 'container_update', title: `${l.name}: ${c.ref} ${b.stage === 'devanned' ? 'unloaded at the warehouse' : b.stage === 'customs' ? 'in customs' : 'arrived'}`, body: b.note || 'Updated from the agent link.', link: `/dashboard/containers/${c.id}`, dedupe: `partner:${c.id}:${b.stage}` }, ['owner', 'dispatcher'])
    res.json(await manifestFor(db, (await db.query<Row>('select * from containers where id = $1', [c.id])).rows[0]))
  }))
  const partnerShipment = async (db: Db, c: Row, sid: string) => { const { rows } = await db.query<Row>('select * from shipments where id = $1 and container_id = $2 and cancelled_at is null', [sid, c.id]); if (!rows[0]) throw new HttpError(404, 'That shipment isn’t in this container.'); return rows[0] }
  r.post('/p/:token/shipments/:sid/handover', wrap(async (req, res) => {
    const db = await getDb(); const { l, c } = await partner(db, String(req.params.token)); const s = await partnerShipment(db, c, String(req.params.sid))
    const b = z.object({ code: z.string().trim().max(12).optional(), receivedBy: z.string().trim().min(2, 'Enter the name of the person receiving it.').max(80) }).parse(req.body)
    if (s.handover === 'collection') await collect(db, s, { code: b.code, receivedBy: b.receivedBy, by: `${l.name} (agent)`, partner: true })
    else {
      if (!['arrived', 'customs', 'out_for_delivery', 'ready_for_collection'].includes(s.status)) throw new HttpError(409, `${s.ref} hasn’t reached you yet.`)
      const { assertRelease } = await import('./flow'); await assertRelease(db, s, { by: l.name, override: null })
      await db.query(`update pieces set status = 'delivered', site_id = null, bin_id = null, released_at = now() where shipment_id = $1`, [s.id])
      await raiseStatus(db, s, 'delivered', countryByCode(s.destination)?.name ?? s.destination, `Delivered to ${b.receivedBy} by ${l.name} (destination agent).`, { receivedBy: b.receivedBy })
    }
    res.json({ ok: true })
  }))
  r.post('/p/:token/shipments/:sid/note', wrap(async (req, res) => {
    const db = await getDb(); const { l, c } = await partner(db, String(req.params.token)); const s = await partnerShipment(db, c, String(req.params.sid))
    const b = z.object({ note: z.string().trim().min(2).max(300) }).parse(req.body)
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `${l.name}: ${b.note}`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${l.name} on ${s.ref}`, body: b.note, link: `/dashboard/shipments?q=${s.ref}&b=all` }, ['owner', 'dispatcher'])
    res.status(201).json({ ok: true })
  }))

  /* ---- public: the client adds the recipient ---- */
  const byDetails = async (db: Db, token: string) => { const { rows } = await db.query<Row>('select s.*, sh.name as shipper_name from shipments s join shippers sh on sh.id = s.shipper_id where s.details_token = $1', [token]); if (!rows[0]) throw new HttpError(404, 'This link is no longer valid.'); return rows[0] }
  r.get('/add-recipient/:token', wrap(async (req, res) => {
    const db = await getDb(); const s = await byDetails(db, String(req.params.token))
    const { rows: cons } = s.consignee_id ? await db.query<Row>('select name, city from client_consignees where id = $1', [s.consignee_id]) : { rows: [] as Row[] }
    res.set('Cache-Control', 'no-store')
    res.json({ ref: s.ref, shipper: s.shipper_name, sender: s.customer, origin: s.origin, destination: s.destination, destinationName: countryByCode(s.destination)?.name ?? s.destination, description: s.description, status: s.status, done: !!s.consignee_id, recipient: cons[0] ?? null })
  }))
  r.post('/add-recipient/:token', wrap(async (req, res) => {
    const db = await getDb(); const s = await byDetails(db, String(req.params.token))
    const b = zConsignee.parse(req.body)
    if (!b.phone || b.phone.replace(/\D/g, '').length < 7) throw new HttpError(400, 'Add a phone number so we can text them when it arrives.')
    let clientId = s.client_id as string | null
    if (!clientId && s.user_id) { const { attachShipmentToClient } = await import('./clients'); const { rows: us } = await db.query<Row>('select name, email from users where id = $1', [s.user_id]); await attachShipmentToClient(db, s.shipper_id, s.user_id, s.id, us[0]?.name ?? s.customer, us[0]?.email ?? ''); clientId = (await db.query<Row>('select client_id from shipments where id = $1', [s.id])).rows[0]?.client_id ?? null }
    if (!clientId) throw new HttpError(409, 'Ask your shipper to add the recipient — this booking has no client record.')
    const cid = 'cs_' + uid()
    await db.query('insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,gps,lat,lng,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)', [cid, clientId, b.name, b.phone ?? '', b.address ?? '', b.city ?? '', b.country ?? s.destination, b.relationship ?? '', b.gps ?? '', b.lat ?? null, b.lng ?? null])
    await db.query('update shipments set consignee_id = $2 where id = $1', [s.id, cid])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Recipient added by the sender: ${b.name}${b.city ? `, ${b.city}` : ''}.`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.customer} added the recipient for ${s.ref}`, body: `${b.name}${b.city ? ` · ${b.city}` : ''}${b.phone ? ` · ${b.phone}` : ''}`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `rcp:${s.id}` }, ['owner', 'dispatcher'])
    await messageRecipient(db, { ...s, consignee_id: cid }, 'notice').catch(() => {})
    res.status(201).json({ ok: true })
  }))
  void ensureDetailsToken; void recipientFormUrl

  /* ---- customer offers ---- */
  const mine = async (db: Db, req: Request, id: string) => { const u = await requireUser(db, req); const { rows } = await db.query<Row>('select * from shipments where id = $1 and user_id = $2', [id, u.id]); if (!rows[0]) throw new HttpError(404, 'Shipment not found.'); return { u, s: rows[0] } }
  r.get('/me/shipments/:id/offers', wrap(async (req, res) => { const db = await getDb(); const { s } = await mine(db, req, String(req.params.id)); res.json({ offers: await offersFor(db, s) }) }))
  r.post('/me/shipments/:id/offers/:kind', wrap(async (req, res) => {
    const db = await getDb(); const { u, s } = await mine(db, req, String(req.params.id))
    const kind = z.enum(['door_delivery', 'duty_prepay']).parse(req.params.kind)
    const r2 = await acceptOffer(db, s, kind, u.name)
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref}: ${kind === 'door_delivery' ? 'door delivery added' : 'duty prepayment added'}`, body: `${r2.invoice ? `Added to invoice ${r2.invoice}. ` : ''}Thank you!`, link: `/dashboard?tab=shipments&open=${s.id}`, dedupe: `upok:${s.id}:${kind}` })
    res.json({ ...r2, shipment: await fresh(db, s.id) })
  }))
  void destinationSite

  /** Run an automation sweep now (admins) — the same jobs run on a timer. */
  r.post('/admin/sweeps/:name', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (!u.admin) throw new HttpError(403, 'Admins only.')
    const f = await import('./flow')
    const jobs: Record<string, (db: Db) => Promise<unknown>> = { nudges: (db2) => f.sweepRecipientNudges(db2, Number(req.body?.minAgeMinutes ?? 10)), positions: f.sweepCarrierPositions, storage: f.sweepStorage, stuck: f.sweepStuck, ontime: f.sweepOnTime }
    const g = await import('./growth'); const ai = await import('./adminInsights'); const bl = await import('./billing'); const ig = await import('./integrations')
    Object.assign(jobs, { weekly: (db2: Db) => g.sweepWeekly(db2, true), halfEmpty: g.sweepHalfEmpty, scorecards: ai.sweepScorecards, billing: bl.sweepBilling, webhooks: ig.deliverDue })
    const job = jobs[String(req.params.name)]; if (!job) throw new HttpError(404, `Sweeps: ${Object.keys(jobs).join(', ')}.`)
    await job(db); res.json({ ok: true })
  }))
}
