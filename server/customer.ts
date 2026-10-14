/**
 * The customer's home screen: what needs them today, the shipment they're most likely asking about,
 * and the people they ship to again and again.
 *   GET  /me/attention            needs-you items + the next arrival
 *   GET  /me/consignees           saved recipients (name, phone, address, city, country)
 *   POST /me/consignees           add one (also happens automatically when a request carries a recipient)
 *   PUT  /me/consignees/:id       edit / make default
 *   DELETE /me/consignees/:id
 * Requests carry `consignee` (jsonb); on booking the recipient is copied to the shipper's client consignees,
 * so the receiver link and the shipper's delivery run know who's waiting in Kumasi.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode, statusOrder, type ShipmentStatus, flowFor, flowIndex } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const DATE = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const n = (v: unknown) => Number(v ?? 0)

export const zConsignee = z.object({
  name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).default(''), address: z.string().trim().max(200).default(''), city: z.string().trim().max(80).default(''),
  country: z.string().trim().length(2).toUpperCase().default('GH'), relationship: z.string().trim().max(40).default(''), isDefault: z.boolean().optional(),
})
export type ConsigneeInput = z.infer<typeof zConsignee>
export const consigneeOut = (r: Row) => ({ id: r.id, name: r.name, phone: r.phone, address: r.address, city: r.city, country: r.country, relationship: r.relationship, isDefault: !!r.is_default, lastUsedAt: ISO(r.last_used_at), createdAt: ISO(r.created_at) })

/** Save (or refresh) a recipient on the customer's list; returns its id. Matches on name + phone so the same brother isn't saved five times. */
export async function rememberConsignee(db: Db, userId: string, c: ConsigneeInput) {
  const digits = (v: string) => v.replace(/\D/g, '')
  const { rows: all } = await db.query<Row>('select id, phone from customer_consignees where user_id = $1 and lower(name) = lower($2)', [userId, c.name])
  const hit = all.find((x) => digits(String(x.phone)) === digits(c.phone))
  if (hit) {
    await db.query(`update customer_consignees set address = coalesce(nullif($2, ''), address), city = coalesce(nullif($3, ''), city), country = $4, relationship = coalesce(nullif($5, ''), relationship), phone = coalesce(nullif($6, ''), phone), last_used_at = now() where id = $1`, [hit.id, c.address, c.city, c.country, c.relationship, c.phone])
    return String(hit.id)
  }
  const { rows: cnt } = await db.query<Row>('select count(*)::int as n from customer_consignees where user_id = $1', [userId])
  const id = 'cc_' + uid()
  await db.query('insert into customer_consignees (id,user_id,name,phone,address,city,country,relationship,is_default,last_used_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [id, userId, c.name, c.phone, c.address, c.city, c.country, c.relationship, n(cnt[0].n) === 0])
  return id
}

/** On booking: copy the request's recipient to the shipper's client record so recipient texts and delivery runs have a name and phone. */
export async function consigneeToClient(db: Db, shipmentId: string, consignee: ConsigneeInput | null) {
  if (!consignee) return
  const { rows } = await db.query<Row>('select client_id from shipments where id = $1', [shipmentId]); const clientId = rows[0]?.client_id
  if (!clientId) return
  const { rows: ex } = await db.query<Row>('select id from client_consignees where client_id = $1 and lower(name) = lower($2) limit 1', [clientId, consignee.name])
  let id = ex[0]?.id as string | undefined
  if (!id) { id = 'cs_' + uid(); await db.query('insert into client_consignees (id,client_id,name,phone,address,city,country,relationship,is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,false)', [id, clientId, consignee.name, consignee.phone, consignee.address, consignee.city, consignee.country, consignee.relationship]) }
  await db.query('update shipments set consignee_id = $2 where id = $1', [shipmentId, id])
}

export interface AttentionItem { kind: 'quote' | 'duty' | 'recipient' | 'invoice' | 'sourcing' | 'review'; severity: 'critical' | 'warning' | 'info'; title: string; body: string; to: string; at?: string }

export async function customerAttention(db: Db, userId: string) {
  const items: AttentionItem[] = []
  const now = Date.now()
  // quotes waiting for a decision
  const { rows: reqs } = await db.query<Row>(`select r.id, r.ref, r.origin, r.destination, r.cargo, r.quantity, (select json_agg(json_build_object('price', q.price, 'days', q.transit_days, 'valid', q.valid_until, 'shipper', s.name, 'id', q.id) order by q.price) from quotes q join shippers s on s.id = q.shipper_id where q.request_id = r.id and q.status = 'sent') as quotes from requests r where r.user_id = $1 and r.status = 'open'`, [userId])
  for (const r of reqs) {
    const qs = (J(r.quotes) ?? []) as { price: number; days: number; valid: string; shipper: string; id: string }[]
    if (!qs.length) continue
    const cheapest = qs[0]; const fastest = [...qs].sort((a, b) => a.days - b.days)[0]
    const soonest = qs.map((q) => new Date(String(q.valid).slice(0, 10) + 'T23:59:59Z').getTime()).sort((a, b) => a - b)[0]
    const daysLeft = Math.ceil((soonest - now) / 86_400_000)
    const dest = countryByCode(r.destination)?.name ?? r.destination
    items.push({ kind: 'quote', severity: daysLeft <= 2 ? 'critical' : 'warning', title: `${qs.length} quote${qs.length === 1 ? '' : 's'} waiting on ${r.ref} · ${r.origin} → ${dest}`, body: `Cheapest $${n(cheapest.price).toLocaleString()} (${cheapest.shipper}, ${cheapest.days} days)${fastest.id !== cheapest.id ? ` · fastest ${fastest.days} days ($${n(fastest.price).toLocaleString()}, ${fastest.shipper})` : ''} · ${daysLeft <= 0 ? 'expiring today' : daysLeft === 1 ? 'expires tomorrow' : `${daysLeft} days to decide`}.`, to: `/dashboard?request=${r.id}`, at: new Date(soonest).toISOString() })
  }
  // shipments at port: duty assessment confirmed → pay it; or at customs without a recipient
  const { rows: ships } = await db.query<Row>(`select s.id, s.ref, s.status, s.destination, s.eta, s.duty, s.consignee_id, s.cargo, sp.name as shipper from shipments s join shippers sp on sp.id = s.shipper_id where s.user_id = $1 and s.status <> 'delivered'`, [userId])
  for (const s of ships) {
    const duty = J(s.duty) as { confirmed?: { amountLocal: number; currency: string; paid?: boolean } } | null
    const dest = countryByCode(s.destination)?.name ?? s.destination
    if (duty?.confirmed && !duty.confirmed.paid && ['arrived', 'customs', 'out_for_delivery'].includes(s.status)) items.push({ kind: 'duty', severity: 'critical', title: `${s.ref}: customs duty ${duty.confirmed.currency} ${n(duty.confirmed.amountLocal).toLocaleString()} is due`, body: `${s.shipper} confirmed the assessment at ${dest}. Pay it (or arrange it with your shipper) so the goods can be released.`, to: `/track?ref=${s.ref}`, at: ISO(s.eta) ?? undefined })
    else if (s.status === 'customs' && !duty?.confirmed) items.push({ kind: 'duty', severity: 'warning', title: `${s.ref} is clearing customs at ${dest}`, body: 'Duty will be assessed shortly — keep your receipts and ID handy for the consignee.', to: `/track?ref=${s.ref}` })
    if (!s.consignee_id && ['booked', 'picked_up', 'at_origin_port', 'in_transit'].includes(s.status)) items.push({ kind: 'recipient', severity: 'info', title: `${s.ref}: who receives it in ${dest}?`, body: 'Add the recipient’s name and phone so they get the arrival text and the driver can find them.', to: `/dashboard?tab=shipments&recipient=${s.id}` })
  }
  // invoices due
  const { rows: inv } = await db.query<Row>(`select i.id, i.number, i.total, i.due_at, coalesce((select sum(amount) from payments p where p.invoice_id = i.id),0) as paid, sp.name as shipper from invoices i join clients c on c.id = i.client_id join shippers sp on sp.id = i.shipper_id where c.user_id = $1 and i.status = 'sent'`, [userId])
  for (const i of inv) {
    const bal = n(i.total) - n(i.paid); if (bal <= 0) continue
    const overdue = i.due_at && new Date(i.due_at).getTime() < now
    items.push({ kind: 'invoice', severity: overdue ? 'critical' : 'warning', title: `${overdue ? 'Overdue' : 'Invoice due'}: ${i.number} — $${bal.toLocaleString()} to ${i.shipper}`, body: i.due_at ? `Due ${DATE(i.due_at)}.` : 'Pay online or arrange a bank transfer.', to: `/dashboard?tab=invoices`, at: ISO(i.due_at) ?? undefined })
  }
  // sourcing: a stage is waiting on their payment or a decision
  const { rows: src } = await db.query<Row>(`select id, ref, title, status, updated_at from sourcing_requests where user_id = $1 and status in ('quoted', 'inspected', 'sourcing')`, [userId])
  for (const s of src) {
    if (s.status === 'quoted') items.push({ kind: 'sourcing', severity: 'warning', title: `${s.ref}: factory quotes are in for "${s.title}"`, body: 'Pick an option and pay the deposit so the order can be placed.', to: `/sourcing/${s.id}`, at: ISO(s.updated_at) ?? undefined })
    if (s.status === 'inspected') items.push({ kind: 'sourcing', severity: 'warning', title: `${s.ref}: inspection done — balance due`, body: 'Review the QC report and pay the balance so the goods ship.', to: `/sourcing/${s.id}`, at: ISO(s.updated_at) ?? undefined })
  }
  // delivered without a review (gentle)
  const { rows: rv } = await db.query<Row>(`select s.id, s.ref, sp.name as shipper from shipments s join shippers sp on sp.id = s.shipper_id where s.user_id = $1 and s.status = 'delivered' and not exists (select 1 from reviews r where r.shipment_id = s.id) and s.created_at > now() - interval '60 days' order by s.created_at desc limit 1`, [userId])
  for (const r of rv) items.push({ kind: 'review', severity: 'info', title: `How did ${r.shipper} do on ${r.ref}?`, body: 'A 30-second review helps the next customer choose.', to: `/dashboard?tab=shipments&review=${r.id}` })
  const order = { critical: 0, warning: 1, info: 2 }
  items.sort((a, b) => order[a.severity] - order[b.severity])

  // next arrival: the active shipment closest to delivery
  const { rows: nx } = await db.query<Row>(`select s.*, sp.name as shipper_name from shipments s join shippers sp on sp.id = s.shipper_id where s.user_id = $1 and s.status <> 'delivered' order by s.eta asc limit 1`, [userId])
  let nextArrival: Row | null = null
  if (nx[0]) {
    const s = nx[0]
    const { rows: ev } = await db.query<Row>('select status, at, place from shipment_events where shipment_id = $1 order by at desc limit 1', [s.id])
    const { rows: cs } = s.consignee_id ? await db.query<Row>('select name, city, phone from client_consignees where id = $1', [s.consignee_id]) : { rows: [] as Row[] }
    nextArrival = { id: s.id, ref: s.ref, status: s.status, stepIndex: flowIndex(s.status as ShipmentStatus, s.handover), steps: flowFor(s.handover).length, handover: s.handover ?? 'delivery', origin: s.origin, destination: s.destination, destinationName: countryByCode(s.destination)?.name ?? s.destination, eta: DATE(s.eta), daysToEta: Math.ceil((new Date(String(DATE(s.eta))).getTime() - now) / 86_400_000), mode: s.mode, vessel: s.vessel_name ?? null, flight: s.flight ?? null, shipper: s.shipper_name, cargo: s.cargo, description: s.description, lastEvent: ev[0] ? { status: ev[0].status, at: ISO(ev[0].at), place: ev[0].place } : null, recipient: cs[0] ? { name: cs[0].name, city: cs[0].city, phone: cs[0].phone } : null, receiverPath: s.recipient_token ? `/r/${s.recipient_token}` : null }
  }
  return { items, nextArrival, activeCount: ships.length }
}

export function mountCustomer(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const customer = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'customer') throw new HttpError(403, 'Customer accounts only.'); return u }
  r.get('/me/attention', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); res.set('Cache-Control', 'no-store'); res.json(await customerAttention(db, u.id)) }))
  r.get('/me/consignees', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); const { rows } = await db.query<Row>('select * from customer_consignees where user_id = $1 order by is_default desc, last_used_at desc nulls last, name', [u.id]); res.json({ consignees: rows.map(consigneeOut) }) }))
  r.post('/me/consignees', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const b = zConsignee.parse(req.body)
    const { rows: c } = await db.query<Row>('select count(*)::int as n from customer_consignees where user_id = $1', [u.id]); if (n(c[0].n) >= 25) throw new HttpError(429, 'That’s a lot of recipients — remove one you no longer use.')
    const id = await rememberConsignee(db, u.id, b)
    if (b.isDefault) { await db.query('update customer_consignees set is_default = (id = $2) where user_id = $1', [u.id, id]) }
    const { rows } = await db.query<Row>('select * from customer_consignees where id = $1', [id]); res.status(201).json({ consignee: consigneeOut(rows[0]) })
  }))
  r.put('/me/consignees/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); const b = zConsignee.partial().parse(req.body)
    const { rows: ex } = await db.query<Row>('select id from customer_consignees where id = $1 and user_id = $2', [req.params.id, u.id]); if (!ex[0]) throw new HttpError(404, 'Recipient not found.')
    const sets: string[] = []; const params: unknown[] = [req.params.id]
    for (const [k, col] of [['name', 'name'], ['phone', 'phone'], ['address', 'address'], ['city', 'city'], ['country', 'country'], ['relationship', 'relationship']] as const) if (b[k] !== undefined) { params.push(b[k]); sets.push(`${col} = $${params.length}`) }
    if (sets.length) await db.query(`update customer_consignees set ${sets.join(', ')} where id = $1`, params)
    if (b.isDefault) await db.query('update customer_consignees set is_default = (id = $2) where user_id = $1', [u.id, req.params.id])
    const { rows } = await db.query<Row>('select * from customer_consignees where id = $1', [req.params.id]); res.json({ consignee: consigneeOut(rows[0]) })
  }))
  r.delete('/me/consignees/:id', wrap(async (req, res) => { const db = await getDb(); const u = await customer(db, req); await db.query('delete from customer_consignees where id = $1 and user_id = $2', [req.params.id, u.id]); res.json({ ok: true }) }))
}
