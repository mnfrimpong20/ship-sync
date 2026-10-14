/**
 * Shipment flow automation — the parts that move a shipment between booking and handover without anyone clicking.
 *
 *   ETA cascade         carrier (or office) changes a container's ETA → every loaded shipment's ETA + a message to the client
 *   Unloading           container "Unloaded at warehouse" → pieces into the destination yard; collection shipments become
 *                       Ready for collection (code texted to the recipient), delivery shipments are flagged ready for a run
 *   Collection          6-digit code checked at the desk (or by the destination agent) → Delivered
 *   Release check       unpaid invoices + storage due are shown to the driver/desk; with holdUnpaid=block the handover is refused
 *   Recipient nudges    a booking with no recipient → the client gets a link to add one (up to 3 reminders)
 *   Air / AIS           flight seen airborne → In transit; landed at the destination airport → Arrived; vessel at the port → Arrived
 *   Stuck               days in the current status vs this shipper's normal for the lane → flagged on the board + office alert
 *   Storage             pieces in the destination yard past the free days → storage due, recipient warned, billed at handover
 *   Offers              door delivery on arrival, duty prepayment once customs confirms it → one tap for the client, added to the invoice
 *   Lane times          real transit days and on-time rate per lane → booking ETAs and the shipper's on-time badge
 *   Cancellation        unload, void unpaid invoices, refund held payments, tell everyone
 */
import { randomBytes, randomInt } from 'node:crypto'
import type { Db } from './db'
import { uid } from './db'
import { emailTemplate, notify, notifyShipmentStatus, notifyShipperStaff, sendEmail } from './notify'
import { consigneeOf, messageRecipient } from './recipient'
import { createInvoice, prefsOf, type InvoiceLine } from './shipmentOps'
import { attachShipmentToClient } from './clients'
import { storageCharge } from './warehouse'
import { ais, flightPosition } from './live'
import { destGeo, type LngLat } from '../src/lib/geo'
import { countryByCode, statusLabels, statusOrder, type Handover, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const ISO = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const flowError = (status: number, message: string) => Object.assign(new Error(message), { httpStatus: status })
/** Local currency per USD for duty prepayments. */
const FX: Record<string, number> = { GHS: Number(process.env.GHS_PER_USD || 11), NGN: Number(process.env.NGN_PER_USD || 1550) }

/* ---------------- shared status setter ---------------- */

/** Raise a shipment to a status (never backwards), with the tracking event, client note and every downstream hook. */
export async function raiseStatus(db: Db, s: Row, target: ShipmentStatus, place: string, note: string, extra?: { photo?: boolean; receivedBy?: string }) {
  if (statusOrder.indexOf(target) <= statusOrder.indexOf(s.status as ShipmentStatus)) return false
  await db.query('update shipments set status = $2 where id = $1', [s.id, target])
  await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, target, place, note])
  if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} moved to “${statusLabels[target]}” — ${note}`])
  s.status = target
  await notifyShipmentStatus(db, s, target, note, extra)
  return true
}
const destPlace = (s: Row) => countryByCode(s.destination)?.name ?? s.destination

/** The shipper's destination yard (first active one), used for collection texts and storage. */
export async function destinationSite(db: Db, shipperId: string, country?: string) {
  const { rows } = await db.query<Row>(`select * from sites where shipper_id = $1 and kind = 'destination' and active order by (country = $2) desc, created_at limit 1`, [shipperId, country ?? ''])
  return rows[0] ?? null
}

/* ---------------- hooks on every status change (called from notifyShipmentStatus) ---------------- */

export async function onStatusEntered(db: Db, s: Row, status: ShipmentStatus) {
  void import('./integrations').then(async (m) => { await m.emitShipment(db, s.id, 'shipment.status'); if (status === 'delivered') await m.emitShipment(db, s.id, 'shipment.delivered') }).catch(() => {})
  if (status === 'ready_for_collection') await openCollection(db, s)
  if (status === 'delivered') {
    await db.query('update shipments set delivered_at = coalesce(delivered_at, now()) where id = $1', [s.id])
    await billStorage(db, s).catch((e) => console.error('[flow] storage bill', e))
  }
  if (status === 'arrived' || status === 'customs') await sendOffers(db, s).catch((e) => console.error('[flow] offers', e))
}

/* ---------------- 1 · ETA cascade ---------------- */

/** A container's ETA moved: copy it to every open shipment inside and tell the clients once per new date. */
export async function cascadeEta(db: Db, containerId: string, eta: string, source: string) {
  const { rows } = await db.query<Row>(`select * from shipments where container_id = $1 and status <> 'delivered' and cancelled_at is null and (eta is null or eta <> $2::date)`, [containerId, eta])
  for (const s of rows) {
    const was = DATE(s.eta)
    await db.query('update shipments set eta_original = coalesce(eta_original, eta), eta = $2 where id = $1', [s.id, eta])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `New arrival date ${fmtDay(eta)}${was ? ` (was ${fmtDay(was)})` : ''} — ${source}.`])
    const later = was && eta > was
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref}: new arrival date ${fmtDay(eta)}`, body: `${later ? 'The shipping line has pushed the arrival back' : 'The shipping line has updated the arrival'}${was ? ` from ${fmtDay(was)}` : ''}. We’ll keep you posted at every step.`, link: `/track?ref=${s.ref}`, dedupe: `eta:${s.id}:${eta}` })
  }
  return rows.length
}

/* ---------------- 2 · unloading at destination ---------------- */

/** Container unloaded at the destination warehouse: pieces into the yard, collection shipments open for collection, delivery ones flagged for a run. */
export async function devanShipments(db: Db, c: Row, byName: string) {
  const site = await destinationSite(db, c.shipper_id, c.destination)
  const { rows } = await db.query<Row>(`select * from shipments where container_id = $1 and status <> 'delivered' and cancelled_at is null`, [c.id])
  let collection = 0, delivery = 0
  for (const s of rows) {
    if (site) await db.query(`update pieces set site_id = $2, bin_id = null, received_at = now(), released_at = null, status = case when status in ('labelled','loaded') then 'devanned' else status end where shipment_id = $1 and site_id is null and status <> 'delivered'`, [s.id, site.id])
    await db.query('update shipments set ready_at = coalesce(ready_at, now()) where id = $1', [s.id])
    const place = site?.name ?? destPlace(s)
    if (s.handover === 'collection') { if (await raiseStatus(db, s, 'ready_for_collection', place, `Unloaded from ${c.ref} at ${place}. Ready for collection.`)) collection++ }
    else {
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, place, `Unloaded from ${c.ref} at ${place} — ready for a delivery run.`])
      delivery++
    }
  }
  if (delivery) await notifyShipperStaff(db, c.shipper_id, { kind: 'container_update', title: `${c.ref} unloaded — ${delivery} shipment${delivery === 1 ? '' : 's'} ready for delivery`, body: `${collection ? `${collection} are ready for collection (codes sent). ` : ''}Plan the deliveries from Routes → Suggested runs.`, link: '/dashboard/routes', dedupe: `devan:${c.id}` }, ['owner', 'dispatcher'])
  void byName
  return { collection, delivery }
}

/* ---------------- 3 · collection with a code ---------------- */

async function openCollection(db: Db, s: Row) {
  const code = String(randomInt(100000, 1000000))
  await db.query('update shipments set collection_code = $2, collection_attempts = 0, ready_at = coalesce(ready_at, now()) where id = $1', [s.id, code])
  s.collection_code = code
  const prefs = await prefsOf(db, s.shipper_id)
  const site = await destinationSite(db, s.shipper_id, s.destination)
  const where = site ? `${site.name}${site.address ? `, ${site.address}` : ''}${site.city ? `, ${site.city}` : ''}${site.hours ? ` (${site.hours})` : ''}` : ''
  const note = `Collection code ${code}.${where ? ` Collect at ${where}.` : ''}${prefs.collectionNote ? ` ${prefs.collectionNote}` : ''}`
  await messageRecipient(db, s, 'ready', { note }).catch((e) => console.error('[flow] ready text', e))
  if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref} is ready for collection — code ${code}`, body: `${where ? `Your recipient can collect it at ${where}. ` : ''}They’ll need code ${code}${prefs.collectionNote ? ` — ${prefs.collectionNote.toLowerCase()}` : ''}. Forward it if they didn’t get our text.`, link: `/track?ref=${s.ref}`, dedupe: `code:${s.id}:${code}` })
}

/** Hand over at the desk (or by the destination agent). Checks the code, the release rule, and closes the shipment. */
export async function collect(db: Db, s: Row, o: { code?: string; receivedBy: string; by: string; byRole?: string; override?: { reason: string } | null; partner?: boolean }) {
  if (s.status !== 'ready_for_collection') throw flowError(409, `${s.ref} isn’t waiting for collection — it’s “${statusLabels[s.status as ShipmentStatus] ?? s.status}”.`)
  if (Number(s.collection_attempts) >= 5 && !o.override) throw flowError(423, 'Too many wrong codes. An owner or dispatcher can release it after checking ID.')
  const codeOk = !!o.code && String(o.code).trim() === String(s.collection_code ?? '')
  if (!codeOk) {
    const managerSkip = o.override && !o.partner && ['owner', 'dispatcher'].includes(o.byRole ?? 'owner')
    if (!managerSkip) {
      await db.query('update shipments set collection_attempts = collection_attempts + 1 where id = $1', [s.id])
      throw flowError(400, o.code ? 'That code doesn’t match. Ask the recipient to check the text, or resend it.' : 'Enter the recipient’s collection code.')
    }
  }
  await assertRelease(db, s, { by: o.by, byRole: o.byRole, override: o.partner ? null : o.override ?? null })
  const site = await destinationSite(db, s.shipper_id, s.destination)
  await db.query(`update pieces set status = 'delivered', site_id = null, bin_id = null, released_at = now() where shipment_id = $1`, [s.id])
  const how = codeOk ? 'code verified' : `released without code — ${o.override!.reason}`
  await raiseStatus(db, s, 'delivered', site?.name ?? destPlace(s), `Collected by ${o.receivedBy} (${how}; handed over by ${o.by}).`, { receivedBy: o.receivedBy })
  return { ok: true, codeVerified: codeOk }
}

/* ---------------- 8 · release check (unpaid + storage) ---------------- */

export async function owedFor(db: Db, s: Row) {
  const { rows: inv } = await db.query<Row>(`select i.total, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)::numeric as paid from invoices i where i.shipment_id = $1 and i.status in ('sent','partial')`, [s.id])
  const invoiceOwed = inv.reduce((n, i) => n + Math.max(0, Number(i.total) - Number(i.paid)), 0)
  const { rows: esc } = await db.query<Row>(`select coalesce(sum(amount_usd), 0)::numeric as n from escrow_payments where shipment_id = $1 and status in ('held','released','paid_out','direct')`, [s.id])
  const invoiceUsd = Math.max(0, invoiceOwed - Number(esc[0]?.n ?? 0))
  const sd = J(s.storage_due) as { amountUsd?: number } | null
  const storageUsd = s.storage_billed ? 0 : Number(sd?.amountUsd ?? 0)
  return { invoiceUsd: Math.round(invoiceUsd), storageUsd: Math.round(storageUsd * 100) / 100, totalUsd: Math.round((invoiceUsd + storageUsd) * 100) / 100 }
}

/** Refuse a handover while money is owed, when the shipper asked for that. Owners, dispatchers and finance can override with a reason. */
export async function assertRelease(db: Db, s: Row, o: { by: string; byRole?: string; override?: { reason: string } | null }) {
  const prefs = await prefsOf(db, s.shipper_id)
  if (prefs.holdUnpaid !== 'block') return
  const owed = await owedFor(db, s)
  if (owed.totalUsd <= 0) return
  if (o.override && ['owner', 'dispatcher', 'finance'].includes(o.byRole ?? 'owner')) {
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Released with ${money(owed.totalUsd)} unpaid — approved by ${o.by}: ${o.override.reason}`])
    return
  }
  throw flowError(402, `${s.ref} has ${money(owed.totalUsd)} unpaid${owed.storageUsd ? ` (incl. ${money(owed.storageUsd)} storage)` : ''}. Collect it before handing over — an owner, dispatcher or finance can release it anyway.`)
}

/* ---------------- invoice lines (storage, upgrades, adjustments) ---------------- */

async function clientIdFor(db: Db, s: Row) {
  if (s.client_id) return s.client_id as string
  if (!s.user_id) return null
  const { rows: us } = await db.query<Row>('select name, email from users where id = $1', [s.user_id])
  await attachShipmentToClient(db, s.shipper_id, s.user_id, s.id, us[0]?.name ?? s.customer, us[0]?.email ?? '')
  const { rows } = await db.query<Row>('select client_id from shipments where id = $1', [s.id]); s.client_id = rows[0]?.client_id ?? null
  return s.client_id as string | null
}

/** Add a line to the shipment's open invoice, or raise a new one if it's paid or missing. Returns the invoice number. */
export async function addInvoiceLine(db: Db, s: Row, line: InvoiceLine, o: { by?: string; notes?: string } = {}) {
  const clientId = await clientIdFor(db, s); if (!clientId) return null
  line = { ...line, description: line.description.slice(0, 160) }
  const { rows } = await db.query<Row>(`select * from invoices where shipment_id = $1 and status in ('draft','sent','partial') order by created_at desc limit 1`, [s.id])
  if (rows[0]) {
    const inv = rows[0]; const items = [...((J(inv.items) ?? []) as InvoiceLine[]), line]
    const subtotal = Math.round(items.reduce((n, i) => n + i.qty * i.unit, 0))
    await db.query('update invoices set items = $2, subtotal = $3, total = $3 + tax where id = $1', [inv.id, JSON.stringify(items), subtotal])
    await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), clientId, s.shipper_id, `${inv.number}: added “${line.description}” (${money(line.qty * line.unit)}).`])
    return inv.number as string
  }
  const prefs = await prefsOf(db, s.shipper_id)
  const due = new Date(Date.now() + prefs.invoiceDueDays * 86400000).toISOString().slice(0, 10)
  const inv = await createInvoice(db, { shipperId: s.shipper_id, clientId, shipmentId: s.id, items: [line], dueAt: due, notes: o.notes ?? `Additional charges for ${s.ref}.`, status: 'sent', by: o.by, send: true })
  return inv.number
}

/* ---------------- 13 · storage at destination ---------------- */

/** Recompute storage due for pieces sitting in destination yards; warn the recipient the day before the free days end. */
export async function sweepStorage(db: Db) {
  const { rows } = await db.query<Row>(`select p.*, s.id as sid, s.cargo, st.free_days, st.rate_usd, st.vehicle_rate_usd from pieces p join shipments s on s.id = p.shipment_id join sites st on st.id = p.site_id
    where st.kind = 'destination' and s.status <> 'delivered' and s.cancelled_at is null`)
  const by = new Map<string, Row[]>(); for (const p of rows) { if (!by.has(p.sid)) by.set(p.sid, []); by.get(p.sid)!.push(p) }
  for (const [sid, ps] of by) {
    const ch = storageCharge(ps[0], ps, ps[0].cargo)
    const first = ps.map((p) => new Date(p.received_at).getTime()).sort((a, b) => a - b)[0]
    const freeUntil = new Date(first + Number(ps[0].free_days) * 86400000).toISOString().slice(0, 10)
    await db.query('update shipments set storage_due = $2 where id = $1', [sid, JSON.stringify({ days: ch.billableDays, amountUsd: ch.amountUsd, freeUntil, rateUsd: ch.rateUsd })])
    const msLeft = new Date(freeUntil + 'T23:59:59Z').getTime() - Date.now()
    if (msLeft > 0 && msLeft < 36 * 3600_000 && ch.rateUsd > 0) {
      const { rows: s } = await db.query<Row>('select * from shipments where id = $1 and storage_warned_at is null', [sid])
      if (s[0]) {
        await db.query('update shipments set storage_warned_at = now() where id = $1', [sid])
        const note = `collect by ${fmtDay(freeUntil)} — after that storage is $${ch.rateUsd}/${ps[0].cargo === 'vehicle' ? 'day' : 'piece per day'}`
        await messageRecipient(db, s[0], 'reminder', { note, force: false }).catch(() => {})
        if (s[0].user_id) await notify(db, { userId: s[0].user_id, kind: 'shipment_status', title: `${s[0].ref}: free storage ends ${fmtDay(freeUntil)}`, body: `Please make sure your recipient ${note}.`, link: `/track?ref=${s[0].ref}`, dedupe: `storage:${sid}` })
      }
    }
  }
}
async function billStorage(db: Db, s: Row) {
  const { rows } = await db.query<Row>('select storage_due, storage_billed from shipments where id = $1', [s.id])
  const sd = J(rows[0]?.storage_due) as { days: number; amountUsd: number; rateUsd: number } | null
  if (!sd || rows[0].storage_billed || !(sd.amountUsd > 0)) return
  const n = await addInvoiceLine(db, s, { description: `Storage at destination — ${sd.days} ${s.cargo === 'vehicle' ? 'day' : 'piece-day'}${sd.days === 1 ? '' : 's'} beyond the free period`, qty: sd.days, unit: sd.rateUsd })
  await db.query('update shipments set storage_billed = true where id = $1', [s.id])
  if (n) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Storage of ${money(sd.amountUsd)} added to ${n}.`])
}

/* ---------------- 7 · ask the client for a missing recipient ---------------- */

export async function ensureDetailsToken(db: Db, s: Row) {
  if (s.details_token) return s.details_token as string
  const t = randomBytes(12).toString('base64url')
  await db.query('update shipments set details_token = $2 where id = $1 and details_token is null', [s.id, t])
  const { rows } = await db.query<Row>('select details_token from shipments where id = $1', [s.id]); s.details_token = rows[0]?.details_token ?? t
  return s.details_token as string
}
export const recipientFormUrl = (token: string) => `${appUrl()}/#/add-recipient/${token}`

/** minAgeMin: give the office time to add the recipient themselves before the client is asked. */
export async function sweepRecipientNudges(db: Db, minAgeMin = 10) {
  const { rows } = await db.query<Row>(`select s.*, c.email as client_email, c.name as client_name from shipments s left join clients c on c.id = s.client_id
    where s.consignee_id is null and s.status not in ('delivered','ready_for_collection','out_for_delivery') and s.cancelled_at is null and s.recipient_nudges < 3
      and (s.recipient_nudged_at is null or s.recipient_nudged_at < now() - interval '48 hours') and s.created_at < now() - ($1::int * interval '1 minute') limit 100`, [minAgeMin])
  for (const s of rows) {
    if (!(await prefsOf(db, s.shipper_id)).recipientNudges) continue
    // A client-level default recipient already covers it.
    if (await consigneeOf(db, s)) { await db.query('update shipments set recipient_nudges = 3 where id = $1', [s.id]); continue }
    const token = await ensureDetailsToken(db, s); const link = recipientFormUrl(token)
    const { rows: sh } = await db.query<Row>('select name from shippers where id = $1', [s.shipper_id])
    const title = `Who should receive ${s.ref}?`
    const body = `${sh[0]?.name ?? 'Your shipper'} needs the name and phone number of the person collecting your shipment in ${destPlace(s)}, so we can text them when it arrives. It takes 30 seconds.`
    let told = false
    if (s.user_id) { await notify(db, { userId: s.user_id, kind: 'shipment_status', title, body, link: `/add-recipient/${token}`, dedupe: `nudge:${s.id}:${s.recipient_nudges}` }); told = true }
    else if (s.client_email) { await sendEmail(s.client_email, title, emailTemplate({ title, body, link, cta: 'Add the recipient', name: s.client_name })).then(() => { told = true }).catch((e) => console.error('[flow] nudge email', e)) }
    await db.query('update shipments set recipient_nudges = recipient_nudges + 1, recipient_nudged_at = now() where id = $1', [s.id])
    if (told) await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Asked ${s.client_name || s.customer} for the recipient’s details.`])
  }
}

/* ---------------- 5 · air (ADS-B) and vessel-only (AIS) arrivals ---------------- */

const km = (a: LngLat, b: LngLat) => { const R = 6371, r = Math.PI / 180; const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) }
export async function sweepCarrierPositions(db: Db) {
  const { rows: air } = await db.query<Row>(`select * from shipments where mode = 'air' and flight is not null and flight <> '' and status in ('booked','picked_up','at_origin_port','in_transit') and cancelled_at is null`)
  for (const s of air) {
    const pos = await flightPosition(s.flight).catch(() => null); if (!pos) continue
    const alt = typeof pos.altitude === 'number' ? pos.altitude : 0
    if (s.status !== 'in_transit' && alt > 2000) {
      await db.query('update shipments set flight_airborne_at = coalesce(flight_airborne_at, now()), departed_at = coalesce(departed_at, now()) where id = $1', [s.id])
      await raiseStatus(db, s, 'in_transit', s.origin, `Flight ${s.flight} is airborne (seen on ADS-B).`)
    } else if (s.status === 'in_transit') {
      const ap = destGeo[s.destination]?.airport; if (!ap) continue
      if (km([pos.lon, pos.lat], ap.at) < 40 && alt < 1500 && (pos.speed ?? 0) < 200) await raiseStatus(db, s, 'arrived', ap.name, `Flight ${s.flight} landed at ${ap.name} (ADS-B).`)
    }
  }
  const { rows: sea } = await db.query<Row>(`select * from shipments where mode = 'ocean' and mmsi is not null and mmsi <> '' and container_id is null and status = 'in_transit' and cancelled_at is null`)
  for (const s of sea) {
    const p = ais.get(s.mmsi); const port = destGeo[s.destination]?.port; if (!p || !port) continue
    if (km([p.lon, p.lat], port.at) < 25 && (p.speed ?? 0) < 2) await raiseStatus(db, s, 'arrived', port.name, `${s.vessel_name || 'The vessel'} is at ${port.name} (AIS).`)
  }
}

/* ---------------- 9 · stuck shipments ---------------- */

const DEFAULT_DAYS: Record<string, number> = { booked: 10, picked_up: 14, at_origin_port: 7, in_transit_ocean: 40, in_transit_air: 4, arrived: 5, customs: 7, ready_for_collection: 10, out_for_delivery: 2 }
const typicalCache = new Map<string, { at: number; map: Map<string, number> }>()
async function typicalFor(db: Db, shipperId: string) {
  const hit = typicalCache.get(shipperId); if (hit && Date.now() - hit.at < 30 * 60_000) return hit.map
  const { rows } = await db.query<Row>(`select e.shipment_id, e.status, min(e.at) as at, s.mode from shipment_events e join shipments s on s.id = e.shipment_id where s.shipper_id = $1 and s.created_at > now() - interval '365 days' group by e.shipment_id, e.status, s.mode`, [shipperId])
  const per = new Map<string, Row[]>(); for (const r of rows) { if (!per.has(r.shipment_id)) per.set(r.shipment_id, []); per.get(r.shipment_id)!.push(r) }
  const samples = new Map<string, number[]>()
  for (const evs of per.values()) {
    evs.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status))
    for (let i = 0; i < evs.length - 1; i++) {
      const k = evs[i].status === 'in_transit' ? `in_transit_${evs[i].mode}` : evs[i].status
      const d = (new Date(evs[i + 1].at).getTime() - new Date(evs[i].at).getTime()) / 86400000; if (d < 0) continue
      if (!samples.has(k)) samples.set(k, []); samples.get(k)!.push(d)
    }
  }
  const map = new Map<string, number>()
  for (const [k, v] of samples) if (v.length >= 5) { v.sort((a, b) => a - b); map.set(k, Math.max(1, Math.round(v[Math.floor(v.length / 2)]))) }
  typicalCache.set(shipperId, { at: Date.now(), map }); return map
}
/** Days in the current status vs normal — only shipments clearly over (1.5× and at least two days more). */
export async function stuckFor(db: Db, s: Row, events: Row[]) {
  if (['delivered'].includes(s.status) || s.cancelled_at) return undefined
  const since = events.filter((e) => e.status === s.status).map((e) => new Date(e.at).getTime()).sort((a, b) => a - b)[0]; if (!since) return undefined
  const days = Math.floor((Date.now() - since) / 86400000)
  const key = s.status === 'in_transit' ? `in_transit_${s.mode}` : s.status
  const typical = (await typicalFor(db, s.shipper_id)).get(key) ?? DEFAULT_DAYS[key] ?? 7
  return days > typical * 1.5 && days >= typical + 2 ? { days, typical } : undefined
}
export async function sweepStuck(db: Db) {
  const { rows } = await db.query<Row>(`select * from shipments where status <> 'delivered' and cancelled_at is null and coalesce(stuck_notified, '') <> status`)
  const byShipper = new Map<string, Row[]>(); for (const s of rows) { if (!byShipper.has(s.shipper_id)) byShipper.set(s.shipper_id, []); byShipper.get(s.shipper_id)!.push(s) }
  for (const [sid, list] of byShipper) {
    if (!(await prefsOf(db, sid)).stuckAlerts) continue
    const { rows: evs } = await db.query<Row>('select shipment_id, status, at from shipment_events where shipment_id = any($1::text[])', [list.map((s) => s.id)])
    for (const s of list) {
      const st = await stuckFor(db, s, evs.filter((e) => e.shipment_id === s.id)); if (!st) continue
      await db.query('update shipments set stuck_notified = $2 where id = $1', [s.id, s.status])
      await notifyShipperStaff(db, sid, { kind: 'shipment_status', title: `${s.ref} looks stuck — ${st.days} days in ${statusLabels[s.status as ShipmentStatus]}`, body: `Usually about ${st.typical} day${st.typical === 1 ? '' : 's'} for this lane. ${s.customer} · ${s.origin} → ${destPlace(s)}.`, link: `/dashboard/shipments?b=stuck&q=${s.ref}`, dedupe: `stuck:${s.id}:${s.status}` }, ['owner', 'dispatcher'])
    }
  }
}

/* ---------------- 14 · offers on arrival ---------------- */

export interface Offer { kind: 'door_delivery' | 'duty_prepay'; title: string; body: string; amountUsd: number; local?: { amount: number; currency: string } }
export async function offersFor(db: Db, s: Row): Promise<Offer[]> {
  if (s.cancelled_at || s.status === 'delivered') return []
  const ups = (J(s.upgrades) ?? {}) as Record<string, unknown>
  const out: Offer[] = []
  const prefs = await prefsOf(db, s.shipper_id)
  const idx = statusOrder.indexOf(s.status as ShipmentStatus)
  if (s.handover === 'collection' && prefs.doorDeliveryUsd > 0 && !ups.door_delivery && idx >= statusOrder.indexOf('in_transit')) {
    const c = await consigneeOf(db, s)
    out.push({ kind: 'door_delivery', title: `Deliver to ${c?.city || 'the door'} for ${money(prefs.doorDeliveryUsd)}`, body: 'Skip the trip to the warehouse — a driver brings it to your recipient and they confirm on their phone.', amountUsd: prefs.doorDeliveryUsd })
  }
  const duty = J(s.duty) as { confirmed?: { amountLocal: number; currency: string }; prepaid?: boolean } | null
  if (duty?.confirmed && !duty.prepaid && !ups.duty_prepay && FX[duty.confirmed.currency]) {
    const usd = Math.ceil(duty.confirmed.amountLocal / FX[duty.confirmed.currency])
    out.push({ kind: 'duty_prepay', title: `Prepay duty — ${duty.confirmed.currency} ${Number(duty.confirmed.amountLocal).toLocaleString()} (≈ ${money(usd)})`, body: 'Pay it with your invoice so clearance isn’t held up waiting for payment at the port.', amountUsd: usd, local: { amount: duty.confirmed.amountLocal, currency: duty.confirmed.currency } })
  }
  return out
}
async function sendOffers(db: Db, s: Row) {
  if (!s.user_id) return
  for (const o of await offersFor(db, s)) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref}: ${o.title}`, body: o.body, link: `/dashboard?tab=shipments&open=${s.id}`, dedupe: `offer:${s.id}:${o.kind}` })
}
export async function acceptOffer(db: Db, s: Row, kind: Offer['kind'], by: string) {
  const o = (await offersFor(db, s)).find((x) => x.kind === kind); if (!o) throw flowError(409, 'That offer isn’t available any more.')
  const ups = { ...((J(s.upgrades) ?? {}) as Record<string, unknown>), [kind]: { at: new Date().toISOString(), amountUsd: o.amountUsd, by } }
  await db.query('update shipments set upgrades = $2 where id = $1', [s.id, JSON.stringify(ups)])
  let n: string | null = null
  if (kind === 'door_delivery') {
    const c = await consigneeOf(db, s)
    await db.query(`update shipments set handover = 'delivery', collection_code = null where id = $1`, [s.id])
    n = await addInvoiceLine(db, s, { description: `Door delivery${c?.city ? ` to ${c.city}` : ''}`, qty: 1, unit: o.amountUsd }, { by })
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `${by} switched to door delivery (${money(o.amountUsd)}${n ? `, added to ${n}` : ''}).`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.ref} upgraded to door delivery`, body: `${by} added door delivery for ${money(o.amountUsd)}. Add it to a delivery run.`, link: '/dashboard/routes', dedupe: `up:${s.id}:door` }, ['owner', 'dispatcher'])
  } else {
    const duty = { ...(J(s.duty) ?? {}), prepaid: true }
    await db.query('update shipments set duty = $2 where id = $1', [s.id, JSON.stringify(duty)])
    n = await addInvoiceLine(db, s, { description: `Duty prepayment — ${o.local!.currency} ${Number(o.local!.amount).toLocaleString()} at ${FX[o.local!.currency]}/USD`, qty: 1, unit: o.amountUsd }, { by })
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `${by} chose to prepay duty (${money(o.amountUsd)}${n ? `, added to ${n}` : ''}).`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.ref}: client is prepaying duty`, body: `${money(o.amountUsd)} added to ${n ?? 'their invoice'}. Pay customs once it clears.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `up:${s.id}:duty` }, ['owner', 'dispatcher', 'finance'])
  }
  return { invoice: n, offer: o }
}

/* ---------------- 15 · lane transit times and on-time rate ---------------- */

export async function laneTimes(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>(`select mode, destination, extract(epoch from (delivered_at - created_at)) / 86400 as days, (delivered_at::date <= coalesce(eta_original, eta) + 2) as on_time
    from shipments where shipper_id = $1 and delivered_at is not null and cancelled_at is null and delivered_at > now() - interval '365 days'`, [shipperId])
  const g = new Map<string, { days: number[]; onTime: number }>()
  for (const r of rows) { const k = `${r.mode}:${r.destination}`; if (!g.has(k)) g.set(k, { days: [], onTime: 0 }); const x = g.get(k)!; x.days.push(Number(r.days)); if (r.on_time) x.onTime++ }
  const lanes = [...g.entries()].map(([k, v]) => { const [mode, destination] = k.split(':'); v.days.sort((a, b) => a - b); return { mode, destination, shipments: v.days.length, medianDays: Math.round(v.days[Math.floor(v.days.length / 2)]), onTimeRate: Math.round((v.onTime / v.days.length) * 100) } })
  const total = rows.length; const onTime = rows.filter((r) => r.on_time).length
  return { lanes, overall: { shipments: total, onTimeRate: total ? Math.round((onTime / total) * 100) : null } }
}
/** Replace the seeded on-time figure with the real one once a shipper has enough deliveries. */
export async function sweepOnTime(db: Db) {
  await db.query('update shipments set eta_original = eta where eta_original is null')
  const { rows } = await db.query<Row>(`select shipper_id, count(*)::int as n, sum(case when delivered_at::date <= coalesce(eta_original, eta) + 2 then 1 else 0 end)::int as ok from shipments where delivered_at is not null and cancelled_at is null and delivered_at > now() - interval '365 days' group by shipper_id having count(*) >= 5`)
  for (const r of rows) await db.query('update shippers set on_time = $2 where id = $1', [r.shipper_id, Math.round((Number(r.ok) / Number(r.n)) * 100)])
}

/* ---------------- 12 · cancellation ---------------- */

export async function cancelShipment(db: Db, s: Row, o: { reason: string; refund: boolean; by: string }) {
  if (s.cancelled_at) throw flowError(409, 'Already cancelled.')
  if (s.status === 'delivered') throw flowError(409, 'Delivered shipments can’t be cancelled — open a dispute or issue a refund instead.')
  if (s.container_id) {
    const { rows: c } = await db.query<Row>('select ref, status from containers where id = $1', [s.container_id])
    if (c[0] && !['booked', 'loading'].includes(c[0].status)) throw flowError(409, `It’s in ${c[0].ref}, which has already left the yard. Cancel at destination by handing it back to the client instead.`)
    await db.query('update shipments set container_id = null where id = $1', [s.id])
    await db.query(`update pieces set status = 'labelled' where shipment_id = $1 and status = 'loaded'`, [s.id])
  }
  await db.query(`delete from run_stops st using runs r where st.shipment_id = $1 and r.id = st.run_id and st.status = 'pending' and r.status in ('planned','in_progress')`, [s.id])
  await db.query(`update pickup_requests set status = 'cancelled', status_note = $2, run_id = null, stop_id = null, updated_at = now() where shipment_id = $1 and status in ('requested','confirmed')`, [s.id, `Shipment cancelled: ${o.reason}`])
  const { rows: inv } = await db.query<Row>(`select i.*, coalesce((select sum(amount) from payments p where p.invoice_id = i.id), 0)::int as paid from invoices i where shipment_id = $1 and status in ('draft','sent','partial')`, [s.id])
  let voided = 0; const paidInvoices: string[] = []
  for (const i of inv) { if (Number(i.paid) > 0) { paidInvoices.push(i.number); continue } await db.query(`update invoices set status = 'void', notes = trim(notes || ' Voided: ' || $2) where id = $1`, [i.id, `shipment cancelled — ${o.reason}`]); voided++ }
  let refunded = 0
  if (o.refund) {
    const { refundPayment } = await import('./payments')
    const { rows: pays } = await db.query<Row>(`select * from escrow_payments where shipment_id = $1 and status in ('held','released')`, [s.id])
    for (const p of pays) { await refundPayment(db, p, null, `Shipment cancelled: ${o.reason}`); refunded += Number(p.amount_usd) }
  }
  await db.query('update shipments set cancelled_at = now(), cancel_reason = $2 where id = $1', [s.id, o.reason])
  await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Cancelled by ${o.by}: ${o.reason}.${voided ? ` ${voided} invoice${voided === 1 ? '' : 's'} voided.` : ''}${refunded ? ` ${money(refunded)} refunded.` : ''}`])
  if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} cancelled — ${o.reason}`])
  if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title: `${s.ref} was cancelled`, body: `${o.reason}.${refunded ? ` A refund of ${money(refunded)} is on its way.` : ''}${paidInvoices.length ? ` Payments on ${paidInvoices.join(', ')} will be settled with you directly.` : ''}`, link: `/track?ref=${s.ref}`, dedupe: `cancel:${s.id}` })
  return { voided, refunded, paidInvoices }
}

/* ---------------- 10/11 · manifest and destination partners ---------------- */

export async function manifestFor(db: Db, c: Row) {
  const { rows } = await db.query<Row>(`select s.*, cl.name as client_name, cl.phone as client_phone, cs.name as rcp_name, cs.phone as rcp_phone, cs.address as rcp_address, cs.city as rcp_city,
      (select count(*) from pieces p where p.shipment_id = s.id)::int as n_pieces, (select count(*) from pieces p where p.shipment_id = s.id and p.status in ('devanned','delivered'))::int as n_devanned
    from shipments s left join clients cl on cl.id = s.client_id left join client_consignees cs on cs.id = s.consignee_id where s.container_id = $1 and s.cancelled_at is null order by s.ref`, [c.id])
  const out = []
  for (const s of rows) {
    const b = (J(s.booking) ?? {}) as Row
    const owed = await owedFor(db, s)
    out.push({ id: s.id, ref: s.ref, status: s.status, handover: (s.handover ?? 'delivery') as Handover, description: s.description, cargo: s.cargo, pieces: Number(s.n_pieces) || Number(b.quantity ?? 0) || null, piecesUnloaded: Number(s.n_devanned), weightKg: b.weightKg ?? null, declaredValueUsd: b.declaredValueUsd ?? null,
      sender: s.client_name || s.customer, senderPhone: s.client_phone || '', recipient: s.rcp_name ? { name: s.rcp_name, phone: s.rcp_phone, address: s.rcp_address, city: s.rcp_city } : null, owedUsd: owed.totalUsd, readyAt: ISO(s.ready_at) })
  }
  return {
    container: { id: c.id, ref: c.ref, number: c.number, seal: c.seal, size: c.size, line: c.line, vesselName: c.vessel_name, voyage: c.voyage, originPort: c.origin_port, destinationPort: c.destination_port, destination: c.destination, etd: DATE(c.etd), eta: DATE(c.eta), status: c.status },
    shipments: out,
    totals: { shipments: out.length, pieces: out.reduce((n, x) => n + (x.pieces ?? 0), 0), weightKg: out.reduce((n, x) => n + Number(x.weightKg ?? 0), 0) || null },
  }
}
export const partnerUrl = (token: string) => `${appUrl()}/#/p/${token}`

/** Container sailed → email each destination partner the manifest link once. */
export async function sendPreAlerts(db: Db, c: Row, force = false) {
  const { rows } = await db.query<Row>(`select * from partner_links where container_id = $1 and revoked_at is null and email <> '' ${force ? '' : 'and pre_alert_sent_at is null'}`, [c.id])
  const { rows: sh } = await db.query<Row>('select name from shippers where id = $1', [c.shipper_id])
  let sent = 0
  for (const l of rows) {
    const m = await manifestFor(db, c)
    const title = `Pre-alert: ${c.ref}${c.number ? ` (${c.number})` : ''} — ${m.totals.shipments} shipments${c.eta ? `, ETA ${fmtDay(DATE(c.eta)!)}` : ''}`
    const body = `${sh[0]?.name ?? 'Your partner'} has shipped ${c.ref}${c.vessel_name ? ` on ${c.vessel_name}${c.voyage ? ` ${c.voyage}` : ''}` : ''} to ${c.destination_port || destPlace({ destination: c.destination })}. ${m.totals.pieces ? `${m.totals.pieces} pieces. ` : ''}The manifest with every recipient and their phone number is on the link below — use the same page to mark customs, unloading and handovers.`
    try { await sendEmail(l.email, title, emailTemplate({ title, body, link: partnerUrl(l.token), cta: 'Open the manifest', name: l.name })); await db.query('update partner_links set pre_alert_sent_at = now() where id = $1', [l.id]); sent++ } catch (e) { console.error('[flow] pre-alert', e) }
  }
  if (sent) await db.query('insert into container_events (container_id,status,place,note,by_name,source,code) values ($1,$2,$3,$4,$5,\'manual\',\'\')', [c.id, c.status, '', `Pre-alert with the manifest sent to ${sent} destination partner${sent === 1 ? '' : 's'}.`, 'Ship Sync'])
  return sent
}

/* ---------------- sweeps ---------------- */

export function startFlowSweeps(getDb: () => Promise<Db>) {
  const run = (name: string, fn: (db: Db) => Promise<unknown>) => () => void getDb().then(fn).catch((e) => console.error(`[flow] ${name}`, e))
  setInterval(run('nudges', sweepRecipientNudges), 30 * 60_000)
  setInterval(run('positions', sweepCarrierPositions), 10 * 60_000)
  setInterval(run('storage', sweepStorage), 3 * 3600_000)
  setInterval(run('stuck', sweepStuck), 6 * 3600_000)
  setInterval(run('ontime', sweepOnTime), 12 * 3600_000)
  setTimeout(() => { run('storage', sweepStorage)(); run('ontime', sweepOnTime)() }, 20_000)
}
