/**
 * Recipient experience — the person in Ghana / Nigeria / … who is actually waiting for the goods.
 *
 * Each shipment gets a receiver link (`/#/r/<token>`): a phone-friendly page with the status, where and
 * when to expect it, the pieces, a QR of the reference, and an "I received it" button. The consignee is
 * texted (SMS or WhatsApp, see sms.ts) when the shipment sails, lands, is out for delivery, is ready for
 * collection, and when it is delivered — only if the shipper has recipient messages on and a provider is
 * configured. Every message is logged in `recipient_messages`, failures are retried by the sweep.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { messagingReady, normalisePhone, sendText, smsProvider, whatsappProvider } from './sms'
import { countryByCode, statusLabels, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
export const receiverUrl = (token: string) => `${appUrl()}/#/r/${token}`

export type RecipientKind = 'notice' | 'sailed' | 'arrived' | 'ready' | 'out_for_delivery' | 'delivered' | 'reminder'
export const messageOut = (m: Row) => ({ id: m.id, shipmentId: m.shipment_id, to: m.to_phone, channel: m.channel as 'sms' | 'whatsapp', kind: m.kind as RecipientKind, text: m.text, status: m.status as 'pending' | 'sent' | 'skipped' | 'failed', error: m.error ?? '', attempts: Number(m.attempts ?? 0), createdAt: ISO(m.created_at), sentAt: ISO(m.sent_at) })

/** Make sure a shipment has a receiver token; returns it. */
export async function ensureReceiverToken(db: Db, s: Row) {
  if (s.recipient_token) return s.recipient_token as string
  const token = randomBytes(12).toString('base64url')
  await db.query('update shipments set recipient_token = $2 where id = $1 and recipient_token is null', [s.id, token])
  const { rows } = await db.query<Row>('select recipient_token from shipments where id = $1', [s.id])
  s.recipient_token = rows[0]?.recipient_token ?? token
  return s.recipient_token as string
}

/** The consignee for a shipment: explicit consignee, else the client's default. */
export async function consigneeOf(db: Db, s: Row) {
  if (s.consignee_id) { const { rows } = await db.query<Row>('select * from client_consignees where id = $1', [s.consignee_id]); if (rows[0]) return rows[0] }
  if (s.client_id) { const { rows } = await db.query<Row>('select * from client_consignees where client_id = $1 order by is_default desc, id limit 1', [s.client_id]); if (rows[0]) return rows[0] }
  return null
}

const firstName = (n: string) => String(n ?? '').trim().split(' ')[0] || 'there'
/** Short, plain texts — SMS segments cost money and signal is patchy. */
function compose(kind: RecipientKind, s: Row, shipperName: string, link: string, receiver: Row | null, extra?: { note?: string }) {
  const hi = `Hi ${firstName(receiver?.name ?? '')},`
  const dest = countryByCode(s.destination)
  const port = dest?.ports?.[0] ?? dest?.name ?? s.destination
  const ref = s.ref
  switch (kind) {
    case 'notice': return `${hi} ${s.customer} is sending you a shipment via ${shipperName}. Ref ${ref}. Track it and confirm when it arrives: ${link}`
    case 'sailed': return `${hi} shipment ${ref} from ${s.customer} is on its way${s.vessel_name ? ` on ${s.vessel_name}` : ''}${s.eta ? `, expected around ${new Date(s.eta).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}. Follow it: ${link}`
    case 'arrived': return `${hi} shipment ${ref} has arrived at ${port} and is going through clearance. We'll tell you when it's ready. ${link}`
    case 'ready': return `${hi} shipment ${ref} is cleared and ready for collection at ${shipperName}${extra?.note ? ` — ${extra.note}` : ''}. Bring your ID and the ref. ${link}`
    case 'out_for_delivery': return `${hi} shipment ${ref} is out for delivery today. Please keep ${receiver?.phone || 'this number'} reachable. ${link}`
    case 'delivered': return `${hi} shipment ${ref} has been delivered. If that's right, tap to confirm: ${link} — or reply if something is missing.`
    case 'reminder': return `${hi} reminder: shipment ${ref} is waiting for collection at ${shipperName}. ${link}`
  }
}

async function shipperOf(db: Db, id: string) { const { rows } = await db.query<Row>('select name, recipient_sms from shippers where id = $1', [id]); return rows[0] }

/** Queue (and try to send) one text to the shipment's consignee. Returns the message row or null when there's nobody to text / messages are off. */
export async function messageRecipient(db: Db, s: Row, kind: RecipientKind, o: { force?: boolean; note?: string; by?: string } = {}) {
  const sh = await shipperOf(db, s.shipper_id); if (!sh) return null
  if (!o.force && !sh.recipient_sms) return null
  const receiver = await consigneeOf(db, s)
  const to = receiver ? normalisePhone(receiver.phone, receiver.country || s.destination) : null
  if (!to) return null
  if (!o.force) { const { rows } = await db.query<Row>(`select 1 from recipient_messages where shipment_id = $1 and kind = $2 and status <> 'failed' limit 1`, [s.id, kind]); if (rows[0]) return null }
  const token = await ensureReceiverToken(db, s)
  const text = compose(kind, s, sh.name, receiverUrl(token), receiver, { note: o.note })
  const ready = messagingReady()
  const waOn = await (await import('./features')).featureOn(db, 'whatsapp', s.shipper_id)
  const channel = waOn && whatsappProvider().id !== 'off' ? 'whatsapp' : 'sms'
  const id = 'rm_' + uid()
  await db.query(`insert into recipient_messages (id,shipment_id,shipper_id,to_phone,channel,kind,text,status,by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, s.id, s.shipper_id, to, channel, kind, text, ready ? 'pending' : 'skipped', o.by ?? ''])
  if (ready) void sendPendingTexts(db)
  const { rows } = await db.query<Row>('select * from recipient_messages where id = $1', [id])
  return rows[0]
}

let inflight: Promise<void> | null = null
export function sendPendingTexts(db: Db): Promise<void> {
  if (!messagingReady()) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    try {
      // Rows queued while a pass is running are picked up by the next loop, not left for the sweep.
      for (let pass = 0; pass < 10; pass++) {
        const { rows } = await db.query<Row>(`select * from recipient_messages where status = 'pending' and attempts < 5 order by created_at asc limit 50`)
        if (!rows.length) break
        for (const m of rows) {
          try { const pid = await sendText(m.to_phone, m.text, m.channel); await db.query(`update recipient_messages set status = 'sent', provider_id = $2, attempts = attempts + 1, error = '', sent_at = now() where id = $1`, [m.id, pid]) }
          catch (e) { const msg = e instanceof Error ? e.message : String(e)
            // WhatsApp not delivered (no account, template, window) → same text by SMS if we have it.
            if (m.channel === 'whatsapp' && smsProvider().id !== 'off') { await db.query(`update recipient_messages set channel = 'sms', status = 'pending', error = $2 where id = $1`, [m.id, `WhatsApp failed, retrying by SMS: ${msg}`.slice(0, 300)]); continue }
            await db.query(`update recipient_messages set status = case when attempts + 1 >= 5 then 'failed' else 'pending' end, attempts = attempts + 1, error = $2 where id = $1`, [m.id, msg.slice(0, 300)]); console.error('[recipient] send', m.id, msg) }
        }
        const { rows: more } = await db.query<Row>(`select 1 from recipient_messages where status = 'pending' and attempts = 0 limit 1`); if (!more.length) break
      }
    } catch (e) { console.error('[recipient] sendPending', e) } finally { inflight = null }
  })()
  return inflight
}
export function startRecipientSweeps(getDb: () => Promise<Db>) {
  setInterval(() => void getDb().then(sendPendingTexts).catch(() => {}), 5 * 60_000)
  console.log(`[recipient] texts via ${smsProvider().label}${whatsappProvider().id !== 'off' ? ` + ${whatsappProvider().label}` : ''}`)
}

/** Called from notifyShipmentStatus — milestones the receiver cares about. */
export async function recipientOnStatus(db: Db, s: Row, status: ShipmentStatus, note?: string) {
  const map: Partial<Record<ShipmentStatus, RecipientKind>> = { in_transit: 'sailed', arrived: 'arrived', ready_for_collection: 'ready', out_for_delivery: 'out_for_delivery', delivered: 'delivered' }
  const kind = map[status]; if (!kind) return
  try { await messageRecipient(db, s, kind, { note }) } catch (e) { console.error('[recipient] status', e) }
}

const zReceived = z.object({ name: z.string().trim().min(2).max(80), note: z.string().trim().max(300).default(''), allGood: z.boolean().default(true) })
const zSend = z.object({ kind: z.enum(['notice', 'ready', 'reminder', 'sailed', 'arrived', 'out_for_delivery', 'delivered']), note: z.string().trim().max(160).default('') })

export function mountRecipient(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId])
    const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office }
  }
  const settingsOut = async (db: Db, shipperId: string) => { const sh = await shipperOf(db, shipperId); const p = smsProvider(); const w = whatsappProvider(); return { enabled: Boolean(sh?.recipient_sms), provider: messagingReady() ? (p.id !== 'off' ? p.id : w.id) : 'off', providerLabel: [p.id !== 'off' ? p.label : '', w.id !== 'off' ? w.label : ''].filter(Boolean).join(' + ') || 'Not configured', channel: w.id !== 'off' ? 'whatsapp' : 'sms', whatsapp: w.id !== 'off', appUrl: appUrl() } }

  /** Receiver link, consignee, message history and any receipt confirmation. */
  r.get('/shipments/:id/recipient', wrap(async (req, res) => {
    const db = await getDb(); const { s, office } = await access(db, req, String(req.params.id))
    const token = await ensureReceiverToken(db, s)
    const receiver = await consigneeOf(db, s)
    const { rows: msgs } = office ? await db.query<Row>('select * from recipient_messages where shipment_id = $1 order by created_at desc limit 20', [s.id]) : { rows: [] as Row[] }
    const { rows: rc } = await db.query<Row>('select * from recipient_receipts where shipment_id = $1 order by created_at desc limit 1', [s.id])
    res.set('Cache-Control', 'no-store')
    res.json({
      token, url: receiverUrl(token), path: `/r/${token}`,
      receiver: receiver ? { name: receiver.name, phone: receiver.phone, phoneE164: normalisePhone(receiver.phone, receiver.country || s.destination), city: receiver.city, country: receiver.country } : null,
      messages: msgs.map(messageOut), receipt: rc[0] ? { name: rc[0].name, note: rc[0].note, allGood: Boolean(rc[0].all_good), at: ISO(rc[0].created_at) } : null,
      settings: office ? await settingsOut(db, s.shipper_id) : null, canManage: office,
    })
  }))
  /** Office sends a text now (intro notice, "ready for collection", reminder, or re-send a milestone). */
  r.post('/shipments/:id/recipient/send', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office } = await access(db, req, String(req.params.id))
    if (!office) throw new HttpError(403, 'Only the shipper can message the receiver.')
    const b = zSend.parse(req.body)
    const receiver = await consigneeOf(db, s)
    if (!receiver || !normalisePhone(receiver.phone, receiver.country || s.destination)) throw new HttpError(409, 'No receiver phone number on this shipment. Add a consignee with a phone number on the client first.')
    const m = await messageRecipient(db, s, b.kind, { force: true, note: b.note, by: u.name })
    if (b.kind === 'ready') await db.query(`insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)`, [s.id, s.status, countryByCode(s.destination)?.name ?? s.destination, `Receiver told the shipment is ready for collection${b.note ? ` — ${b.note}` : ''}.`])
    await sendPendingTexts(db)
    const { rows } = await db.query<Row>('select * from recipient_messages where id = $1', [m!.id])
    res.status(201).json({ message: messageOut(rows[0]) })
  }))
  r.get('/recipient/settings', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    res.json(await settingsOut(db, u.shipperId))
  }))
  r.patch('/recipient/settings', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.')
    const enabled = z.object({ enabled: z.boolean() }).parse(req.body).enabled
    await db.query('update shippers set recipient_sms = $2 where id = $1', [u.shipperId, enabled])
    res.json(await settingsOut(db, u.shipperId))
  }))

  /* ---- public receiver page ---- */
  const byToken = async (db: Db, token: string) => {
    const { rows } = await db.query<Row>('select * from shipments where recipient_token = $1', [token])
    if (!rows[0]) throw new HttpError(404, 'This link is not valid.')
    return rows[0]
  }
  r.get('/r/:token', wrap(async (req, res) => {
    const db = await getDb(); const s = await byToken(db, String(req.params.token))
    const sh = await shipperOf(db, s.shipper_id)
    const receiver = await consigneeOf(db, s)
    const { rows: events } = await db.query<Row>('select status, at, place, note from shipment_events where shipment_id = $1 order by at asc', [s.id])
    const { rows: pieces } = await db.query<Row>('select seq, status from pieces where shipment_id = $1 order by seq', [s.id])
    const { rows: rc } = await db.query<Row>('select * from recipient_receipts where shipment_id = $1 order by created_at desc limit 1', [s.id])
    const { rows: ready } = await db.query<Row>(`select 1 from recipient_messages where shipment_id = $1 and kind = 'ready' limit 1`, [s.id])
    const dest = countryByCode(s.destination)
    res.set('Cache-Control', 'no-store')
    res.json({
      shipment: { ref: s.ref, status: s.status, statusLabel: statusLabels[s.status as ShipmentStatus] ?? s.status, mode: s.mode, origin: s.origin, destination: s.destination, destinationName: dest?.name ?? s.destination, port: dest?.ports?.[0] ?? '', description: s.description, eta: ISO(s.eta)?.slice(0, 10) ?? null, sender: s.customer, vesselName: s.vessel_name ?? '' },
      shipper: { name: sh?.name ?? '' }, receiver: receiver ? { name: receiver.name } : null, readyForCollection: ready.length > 0,
      events: events.map((e) => ({ status: e.status, label: statusLabels[e.status as ShipmentStatus] ?? e.status, at: ISO(e.at), place: e.place, note: e.note ?? '' })),
      pieces: pieces.map((p) => ({ seq: Number(p.seq), status: p.status })), trackUrl: `${appUrl()}/#/track?ref=${s.ref}`,
      receipt: rc[0] ? { name: rc[0].name, note: rc[0].note, allGood: Boolean(rc[0].all_good), at: ISO(rc[0].created_at) } : null,
    })
  }))
  r.post('/r/:token/received', wrap(async (req, res) => {
    const db = await getDb(); const s = await byToken(db, String(req.params.token))
    const b = zReceived.parse(req.body)
    const { rows: ex } = await db.query<Row>('select id from recipient_receipts where shipment_id = $1', [s.id])
    if (ex[0]) throw new HttpError(409, 'Receipt was already confirmed for this shipment — thank you.')
    await db.query('insert into recipient_receipts (id,shipment_id,name,note,all_good,ip) values ($1,$2,$3,$4,$5,$6)', ['rr_' + uid(), s.id, b.name, b.note, b.allGood, String(req.ip ?? '').slice(0, 60)])
    const place = countryByCode(s.destination)?.name ?? s.destination
    if (b.allGood && s.status !== 'delivered') {
      await db.query(`update shipments set status = 'delivered' where id = $1`, [s.id])
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, 'delivered', place, `Receiver ${b.name} confirmed receipt online${b.note ? ` — “${b.note}”` : ''}.`])
      await db.query(`update pieces set status = 'delivered', last_scan_at = now(), last_scan_kind = 'delivery', last_scan_place = $2, last_scan_by = $3 where shipment_id = $1 and status <> 'delivered'`, [s.id, place, `${b.name} (receiver)`])
      if (s.client_id) await db.query(`insert into client_activities (id,client_id,shipper_id,type,body) values ($1,$2,$3,'system',$4)`, [uid(), s.client_id, s.shipper_id, `${s.ref} confirmed received by ${b.name} (receiver link).`])
    } else {
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, place, `Receiver ${b.name} reported a problem${b.note ? `: “${b.note}”` : ''}.`])
    }
    const title = b.allGood ? `${s.ref} received by ${b.name}` : `Problem reported on ${s.ref}`
    const body = b.allGood ? `${b.name} confirmed receipt from the receiver link.${b.note ? ` “${b.note}”` : ''}` : `${b.name} says something is wrong${b.note ? `: “${b.note}”` : ''}. Follow up with the receiver.`
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title, body, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `receipt:${s.id}` }, ['owner', 'dispatcher', 'agent'])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'shipment_status', title, body: b.allGood ? `${b.name} confirmed they received ${s.ref}.${b.note ? ` “${b.note}”` : ''}` : body, link: `/track?ref=${s.ref}`, dedupe: `receipt:${s.id}:c` })
    res.status(201).json({ ok: true, delivered: b.allGood })
  }))
}
