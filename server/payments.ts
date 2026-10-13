/**
 * Payments & escrow — the customer pays Ship Sync, the money is held until the goods are on their way
 * (or delivered — platform setting), then it is released to the shipper's balance less the take-rate;
 * the shipper requests a payout and the platform pays it out by bank transfer (Stripe Connect / mobile
 * money partners can slot in behind the same ledger later).
 *
 *   customer  booked shipment → "Pay securely" → Stripe Checkout → funds held in escrow → receipt in documents
 *   shipper   sees held / available / paid-out balance, requests payouts, can record a direct (offline) payment
 *   platform  take-rate + release rule in `settings`; marks payouts paid; can refund or release early
 *
 * Stripe is called over plain HTTPS (no SDK) with STRIPE_SECRET_KEY; webhooks are verified with
 * STRIPE_WEBHOOK_SECRET. STRIPE_API_URL overrides the host for the local mock. Without a key the module
 * runs in "manual" mode: online checkout is off, offline payments can still be recorded.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { shipmentContext } from './documents'
import { groupageAmount } from './groupage'
import { onInvoicePaid } from './collections'
import { statusLabels, statusOrder, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const r2 = (n: number) => Math.round(n * 100) / 100
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

/* ------------------------------------------------------------------ settings */
export interface PaymentSettings {
  enabled: boolean
  /** Ship Sync's share of every freight payment collected online. */
  takeRatePct: number
  /** Milestone that releases held funds to the shipper's balance. */
  releaseOn: 'in_transit' | 'delivered'
  /** Shown to customers on the pay card. */
  customerNote: string
  /** Shown to shippers on the payments page. */
  payoutNote: string
}
export const DEFAULT_SETTINGS: PaymentSettings = {
  enabled: true, takeRatePct: 0.08, releaseOn: 'in_transit',
  customerNote: 'Your money is held by Ship Sync and only released to the shipper once your goods are on their way. Card, Apple Pay and Google Pay.',
  payoutNote: 'Payouts are sent by bank transfer within 2 business days of your request. Mobile money payouts for Ghana and Nigeria are coming.',
}
export async function getSettings(db: Db): Promise<PaymentSettings> {
  const { rows } = await db.query<Row>(`select value from settings where id = 'payments'`)
  const v = rows[0]?.value; return { ...DEFAULT_SETTINGS, ...(v ? J(v) : {}) }
}

/* ------------------------------------------------------------------ stripe */
const STRIPE_URL = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '')
export const stripeKey = () => process.env.STRIPE_SECRET_KEY?.trim() || ''
export const stripeMode = (): 'off' | 'test' | 'live' => (!stripeKey() ? 'off' : stripeKey().startsWith('sk_live') ? 'live' : 'test')

/** Flatten nested params the way Stripe's form encoding expects: line_items[0][price_data][currency]. */
function encode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))))
    else if (typeof v === 'object') encode(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}
export async function stripe<T = Row>(path: string, params?: Record<string, unknown>, method: 'POST' | 'GET' = params ? 'POST' : 'GET'): Promise<T> {
  const key = stripeKey(); if (!key) throw new Error('Stripe is not configured.')
  const res = await fetch(`${STRIPE_URL()}/v1${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }, body: method === 'POST' ? encode(params ?? {}).toString() : undefined })
  const data = (await res.json().catch(() => ({}))) as Row
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`)
  return data as T
}
/** Verify a Stripe-Signature header against the raw body (t=…,v1=…; 5-minute tolerance). */
export function verifyStripeSignature(raw: Buffer | string, header: string | undefined, secret: string): boolean {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = parts.t, v1 = parts.v1; if (!t || !v1) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const expected = createHmac('sha256', secret).update(`${t}.${typeof raw === 'string' ? raw : raw.toString('utf8')}`).digest('hex')
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(v1)) } catch { return false }
}

/* ------------------------------------------------------------------ shapes */
export type PaymentStatus = 'pending' | 'held' | 'released' | 'paid_out' | 'refunded' | 'cancelled' | 'direct'
export const paymentOut = (p: Row) => ({
  id: p.id, shipmentId: p.shipment_id ?? null, invoiceId: p.invoice_id ?? null, shipmentRef: p.ref ?? undefined, customer: p.customer ?? undefined, shipperId: p.shipper_id, shipperName: p.shipper_name ?? undefined,
  items: J(p.items ?? '[]') as { description: string; amountUsd: number }[], amountUsd: Number(p.amount_usd), feeUsd: Number(p.fee_usd), netUsd: Number(p.net_usd),
  status: p.status as PaymentStatus, provider: p.provider as 'stripe' | 'manual', method: p.method ?? null, paidAt: ISO(p.paid_at), releasedAt: ISO(p.released_at), releaseReason: p.release_reason ?? null,
  refundedAt: ISO(p.refunded_at), refundReason: p.refund_reason ?? null, payoutId: p.payout_id ?? null, recordedBy: p.recorded_by ?? null, receiptDocumentId: p.receipt_document_id ?? null, createdAt: ISO(p.created_at),
})
export const payoutOut = (p: Row) => ({
  id: p.id, shipperId: p.shipper_id, shipperName: p.shipper_name ?? undefined, amountUsd: Number(p.amount_usd), status: p.status as 'requested' | 'paid' | 'rejected', method: p.method, details: J(p.details ?? '{}') as PayoutDetails,
  reference: p.reference ?? '', note: p.note ?? '', requestedBy: p.requested_by ?? '', requestedAt: ISO(p.requested_at), paidAt: ISO(p.paid_at), paidBy: p.paid_by ?? null, payments: Number(p.n_payments ?? 0),
})
export interface PayoutDetails { bankName: string; accountName: string; accountNumber: string; routing: string; country: string; mobileMoney: string }
const zDetails = z.object({ bankName: z.string().trim().max(80).default(''), accountName: z.string().trim().max(80).default(''), accountNumber: z.string().trim().max(40).default(''), routing: z.string().trim().max(40).default(''), country: z.string().trim().max(2).default(''), mobileMoney: z.string().trim().max(40).default('') })
const maskDetails = (d: Partial<PayoutDetails> | null | undefined, full: boolean): PayoutDetails => {
  const x = { bankName: '', accountName: '', accountNumber: '', routing: '', country: '', mobileMoney: '', ...(d ?? {}) }
  return full ? x : { ...x, accountNumber: x.accountNumber ? `····${x.accountNumber.slice(-4)}` : '', routing: x.routing ? `····${x.routing.slice(-3)}` : '' }
}
const SELECT = `select p.*, s.ref, s.customer, sh.name as shipper_name from escrow_payments p left join shipments s on s.id = p.shipment_id join shippers sh on sh.id = p.shipper_id`
const PAYOUT_SELECT = `select o.*, sh.name as shipper_name, (select count(*) from escrow_payments e where e.payout_id = o.id)::int as n_payments from payouts o join shippers sh on sh.id = o.shipper_id`

/* ------------------------------------------------------------------ core */
/** What the customer still owes on a shipment: the accepted quote plus any insurance premium not yet collected. */
export async function amountDue(db: Db, s: Row) {
  const items: { description: string; amountUsd: number; kind: 'freight' | 'insurance' }[] = []
  const { rows: q } = s.request_id ? await db.query<Row>(`select price, includes from quotes where request_id = $1 and status = 'accepted' limit 1`, [s.request_id]) : { rows: [] as Row[] }
  const { rows: inv } = await db.query<Row>(`select total from invoices where shipment_id = $1 and status in ('sent','draft') order by created_at desc limit 1`, [s.id])
  const grp = await groupageAmount(db, s)
  if (inv[0]) items.push({ description: `Freight & services — ${s.ref} (invoice)`, amountUsd: Number(inv[0].total), kind: 'freight' })
  else if (grp) items.push({ ...grp, kind: 'freight' })
  else if (q[0]) items.push({ description: `${s.mode === 'air' ? 'Air' : 'Ocean'} freight ${s.origin} → ${s.destination} — ${s.ref}`, amountUsd: Number(q[0].price), kind: 'freight' })
  const { rows: pol } = await db.query<Row>(`select premium_usd from insurance_policies where shipment_id = $1 and status <> 'cancelled' and payment_status = 'due' limit 1`, [s.id])
  if (pol[0]) items.push({ description: 'All-risk cargo insurance premium', amountUsd: Number(pol[0].premium_usd), kind: 'insurance' })
  const amountUsd = r2(items.reduce((n, i) => n + i.amountUsd, 0))
  return { items, amountUsd }
}

/** Money arrived (webhook, verify, or an office record). Idempotent per payment row. */
export async function markPaid(db: Db, p: Row, opts: { intent?: string | null; method?: string | null; direct?: boolean; by?: string }) {
  if (!['pending'].includes(p.status)) return p
  const cfg = await getSettings(db)
  const amount = Number(p.amount_usd)
  const fee = opts.direct ? 0 : r2(amount * cfg.takeRatePct)
  // No shipment behind the payment (a standalone invoice) → nothing to escrow against; released to the shipper's balance at once.
  const status: PaymentStatus = opts.direct ? 'direct' : p.shipment_id ? 'held' : 'released'
  await db.query(`update escrow_payments set status = $2, fee_usd = $3, net_usd = $4, provider_payment_intent = coalesce($5, provider_payment_intent), method = coalesce($6, method), paid_at = now(), recorded_by = coalesce($7, recorded_by), released_at = case when $2 = 'released' then now() else released_at end, release_reason = case when $2 = 'released' then 'invoice:no-shipment' else release_reason end where id = $1`, [p.id, status, fee, r2(amount - fee), opts.intent ?? null, opts.method ?? null, opts.by ?? null])
  const { rows: ss } = p.shipment_id ? await db.query<Row>('select * from shipments where id = $1', [p.shipment_id]) : { rows: [] as Row[] }; const s = ss[0]
  const items = J(p.items ?? '[]') as { kind?: string }[]
  // Insurance premium included → collected.
  if (p.shipment_id && items.some((i) => i.kind === 'insurance')) await db.query(`update insurance_policies set payment_status = 'collected', collected_at = now() where shipment_id = $1 and payment_status = 'due' and status <> 'cancelled'`, [p.shipment_id])
  // Open invoice on the shipment → record the payment against it.
  const { rows: inv } = p.invoice_id ? await db.query<Row>(`select * from invoices where id = $1`, [p.invoice_id]) : p.shipment_id ? await db.query<Row>(`select * from invoices where shipment_id = $1 and status in ('sent','draft') order by created_at desc limit 1`, [p.shipment_id]) : { rows: [] as Row[] }
  if (inv[0]) {
    const freight = (J(p.items ?? '[]') as { kind?: string; amountUsd: number }[]).filter((i) => i.kind !== 'insurance').reduce((n, i) => n + i.amountUsd, 0)
    await db.query('insert into payments (id,invoice_id,amount,method,at,note) values ($1,$2,$3,$4,current_date,$5)', ['pay_' + uid(), inv[0].id, Math.round(freight), opts.direct ? opts.method ?? 'bank' : 'ship_sync', opts.direct ? `Recorded by ${opts.by ?? 'office'}` : `Paid online via Ship Sync (${p.id})`])
    const { rows: sum } = await db.query<{ s: string }>('select coalesce(sum(amount),0)::text as s from payments where invoice_id = $1', [inv[0].id])
    await db.query(`update invoices set status = case when $2::int >= total then 'paid' else 'sent' end where id = $1`, [inv[0].id, Number(sum[0].s)])
    if (Number(sum[0].s) >= Number(inv[0].total) && !opts.direct) await onInvoicePaid(db, inv[0].id)
    if (!s) await notifyShipperStaff(db, p.shipper_id, { kind: 'payment', title: `Invoice ${inv[0].number} paid online — $${amount.toLocaleString()}`, body: `$${r2(amount - fee).toLocaleString()} after the ${Math.round(cfg.takeRatePct * 100)}% platform fee is in your available balance.`, link: '/dashboard/payments', dedupe: `pay:${p.id}:office` }, ['owner', 'dispatcher'])
  }
  // Receipt into the documents vault (online payments only — the office issues its own receipt for cash).
  if (!opts.direct && s) {
    const ctx = await shipmentContext(db, s)
    const docId = 'doc_' + uid(); const number = `RCT-${new Date().getFullYear()}-${s.ref.replace(/^SS-/, '')}`
    const payload = { ...ctx, generatedAt: new Date().toISOString(), number, receipt: { id: p.id, number, items: J(p.items ?? '[]'), amountUsd: amount, method: opts.method ?? 'card', paidAt: new Date().toISOString(), payer: s.customer, escrow: `Held by Ship Sync until the shipment is ${cfg.releaseOn === 'delivered' ? 'delivered' : 'on its way'}, then released to ${ctx.shipper.name}.` } }
    await db.query(`insert into documents (id,shipment_id,shipper_id,kind,title,filename,mime,size,payload,source,visibility,uploaded_by,uploaded_by_role) values ($1,$2,$3,'receipt',$4,'','',0,$5,'generated','shared','Ship Sync','shipper')`, [docId, s.id, s.shipper_id, `Payment receipt ${number}`, JSON.stringify(payload)])
    await db.query('update escrow_payments set receipt_document_id = $2 where id = $1', [p.id, docId])
  }
  if (s) {
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, opts.direct ? `Payment of $${amount.toLocaleString()} recorded (${opts.method ?? 'bank'}).` : `$${amount.toLocaleString()} paid online — held in escrow by Ship Sync.`])
    if (s.user_id) await notify(db, { userId: s.user_id, kind: 'payment', title: opts.direct ? `Payment recorded on ${s.ref}` : `Payment received — ${s.ref}`, body: opts.direct ? `${p.shipper_name ?? 'The shipper'} recorded your $${amount.toLocaleString()} payment.` : `$${amount.toLocaleString()} is held safely by Ship Sync and will be released to the shipper once your goods are ${cfg.releaseOn === 'delivered' ? 'delivered' : 'on their way'}. Your receipt is in the documents.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `pay:${p.id}:paid`, emailSubject: `Payment received — ${s.ref}` })
    if (!opts.direct) await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `${s.customer} paid $${amount.toLocaleString()} on ${s.ref}`, body: `Held in escrow. $${r2(amount - fee).toLocaleString()} (after the ${Math.round(cfg.takeRatePct * 100)}% platform fee) is released to your balance when the shipment is ${cfg.releaseOn === 'delivered' ? 'delivered' : 'in transit'}.`, link: '/dashboard/payments', dedupe: `pay:${p.id}:office` }, ['owner', 'dispatcher'])
  }
  return (await db.query<Row>(`${SELECT} where p.id = $1`, [p.id])).rows[0]
}

export async function releasePayment(db: Db, p: Row, reason: string) {
  if (p.status !== 'held') return
  await db.query(`update escrow_payments set status = 'released', released_at = now(), release_reason = $2 where id = $1`, [p.id, reason])
  const { rows: ss } = await db.query<Row>('select * from shipments where id = $1', [p.shipment_id]); const s = ss[0]
  if (s) {
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `Escrow released: $${Number(p.net_usd).toLocaleString()} credited to ${p.shipper_name ?? 'the shipper'}.`])
    await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `$${Number(p.net_usd).toLocaleString()} released on ${s.ref}`, body: `Funds from ${s.customer} are now in your available balance. Request a payout any time from Payments.`, link: '/dashboard/payments', dedupe: `pay:${p.id}:released` }, ['owner'])
  }
}

/** Status-change hook: release held funds once the shipment reaches the configured milestone. */
export async function escrowOnStatus(db: Db, s: Row, status: ShipmentStatus) {
  try {
    const cfg = await getSettings(db)
    if (statusOrder.indexOf(status) < statusOrder.indexOf(cfg.releaseOn)) return
    const { rows } = await db.query<Row>(`${SELECT} where p.shipment_id = $1 and p.status = 'held'`, [s.id])
    for (const p of rows) await releasePayment(db, p, `status:${status}`)
  } catch (e) { console.error('[payments] release on status failed', e) }
}

async function balanceFor(db: Db, shipperId: string) {
  const { rows } = await db.query<Row>(`select
      coalesce(sum(case when status = 'held' then net_usd end),0)::float as held,
      coalesce(sum(case when status = 'released' and payout_id is null then net_usd end),0)::float as available,
      coalesce(sum(case when status in ('released','paid_out') and payout_id is not null then net_usd end),0)::float as requested_or_paid,
      coalesce(sum(case when status in ('held','released','paid_out') then amount_usd end),0)::float as collected,
      coalesce(sum(case when status in ('held','released','paid_out') then fee_usd end),0)::float as fees
    from escrow_payments where shipper_id = $1`, [shipperId])
  const { rows: po } = await db.query<Row>(`select coalesce(sum(case when status = 'requested' then amount_usd end),0)::float as pending, coalesce(sum(case when status = 'paid' then amount_usd end),0)::float as paid from payouts where shipper_id = $1`, [shipperId])
  const b = rows[0], o = po[0]
  return { heldUsd: r2(b.held), availableUsd: r2(b.available), pendingPayoutUsd: r2(o.pending), paidOutUsd: r2(o.paid), collectedUsd: r2(b.collected), feesUsd: r2(b.fees) }
}

/* ------------------------------------------------------------------ webhook (mounted before express.json) */
export function stripeWebhook(getDb: () => Promise<Db>) {
  return async (req: Request, res: Response) => {
    const raw: Buffer | string = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
    if (secret) { if (!verifyStripeSignature(raw, req.header('stripe-signature'), secret)) return res.status(400).json({ error: 'Bad signature.' }) }
    else if (!process.env.STRIPE_API_URL) return res.status(401).json({ error: 'Webhook secret not configured.' })
    let evt: Row; try { evt = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'Bad payload.' }) }
    const db = await getDb()
    if (evt.id) { const { rows } = await db.query('select 1 from stripe_events where id = $1', [evt.id]); if (rows.length) return res.json({ received: true, duplicate: true }); await db.query('insert into stripe_events (id,type) values ($1,$2)', [evt.id, evt.type ?? '']) }
    const obj: Row = evt.data?.object ?? {}
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      const pid = obj.client_reference_id || obj.metadata?.payment_id
      const { rows } = await db.query<Row>(`${SELECT} where p.id = $1 or p.provider_session_id = $2`, [pid ?? '', obj.id ?? ''])
      if (rows[0] && obj.payment_status === 'paid') await markPaid(db, rows[0], { intent: typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id ?? null, method: obj.payment_method_types?.[0] ?? 'card' })
    } else if (evt.type === 'checkout.session.expired') {
      await db.query(`update escrow_payments set status = 'cancelled' where provider_session_id = $1 and status = 'pending'`, [obj.id ?? ''])
    } else if (evt.type === 'charge.refunded') {
      const intent = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id
      if (intent) await db.query(`update escrow_payments set status = 'refunded', refunded_at = now(), refund_reason = coalesce(refund_reason, 'Refunded in Stripe') where provider_payment_intent = $1 and status in ('held','released')`, [intent])
    }
    res.json({ received: true })
  }
}

/* ------------------------------------------------------------------ routes */
const zSettings = z.object({ enabled: z.boolean(), takeRatePct: z.number().min(0).max(0.5), releaseOn: z.enum(['in_transit', 'delivered']), customerNote: z.string().trim().max(400), payoutNote: z.string().trim().max(400) })
const zRecord = z.object({ amountUsd: z.number().min(1).max(10_000_000).optional(), method: z.enum(['bank', 'cash', 'mobile_money', 'card', 'other']), note: z.string().trim().max(200).default('') })
const zRefund = z.object({ reason: z.string().trim().min(3).max(300) })
const zPayout = z.object({ amountUsd: z.number().min(1).max(10_000_000).optional() })

export function mountPayments(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.'); return u }
  const byId = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${SELECT} where p.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Payment not found.'); return rows[0] }
  const latest = async (db: Db, shipmentId: string) => (await db.query<Row>(`${SELECT} where p.shipment_id = $1 and p.status <> 'cancelled' order by p.created_at desc limit 1`, [shipmentId])).rows[0] ?? null
  const publicCfg = (c: PaymentSettings) => ({ enabled: c.enabled, online: c.enabled && stripeMode() !== 'off', mode: stripeMode(), releaseOn: c.releaseOn, customerNote: c.customerNote, takeRatePct: c.takeRatePct })

  r.get('/payments/config', wrap(async (req, res) => { const db = await getDb(); await requireUser(db, req); res.json({ config: publicCfg(await getSettings(db)) }) }))

  /* ---- per shipment ---- */
  r.get('/shipments/:id/payment', wrap(async (req, res) => {
    const db = await getDb(); const { s, office, owner } = await access(db, req, String(req.params.id))
    const cfg = await getSettings(db); const p = await latest(db, s.id)
    const due = p && ['held', 'released', 'paid_out', 'direct'].includes(p.status) ? null : await amountDue(db, s)
    res.set('Cache-Control', 'no-store')
    res.json({ payment: p ? paymentOut(p) : null, due: due && due.amountUsd > 0 ? due : null, config: publicCfg(cfg), canPay: owner && !!due && due.amountUsd > 0 && cfg.enabled && stripeMode() !== 'off' && s.status !== 'delivered', canManage: office })
  }))
  r.post('/shipments/:id/payment/checkout', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, owner } = await access(db, req, String(req.params.id))
    if (!owner) throw new HttpError(403, 'Only the customer can pay for this shipment.')
    const cfg = await getSettings(db); if (!cfg.enabled || stripeMode() === 'off') throw new HttpError(409, 'Online payments are not available right now — pay the shipper directly.')
    const existing = await latest(db, s.id)
    if (existing && ['held', 'released', 'paid_out', 'direct'].includes(existing.status)) throw new HttpError(409, 'This shipment is already paid.')
    const due = await amountDue(db, s); if (!(due.amountUsd > 0)) throw new HttpError(409, 'Nothing to pay yet — wait for the shipper’s price.')
    if (existing && existing.status === 'pending') await db.query(`update escrow_payments set status = 'cancelled' where id = $1`, [existing.id])
    const id = 'esc_' + uid()
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const session = await stripe('/checkout/sessions', {
      mode: 'payment', client_reference_id: id, customer_email: u.email || undefined,
      success_url: `${base}/#/dashboard?tab=shipments&s=${s.id}&paid=${id}`, cancel_url: `${base}/#/dashboard?tab=shipments&s=${s.id}&paid=cancel`,
      metadata: { payment_id: id, shipment_id: s.id, shipment_ref: s.ref },
      payment_intent_data: { description: `Ship Sync ${s.ref} — ${s.origin} → ${s.destination}`, metadata: { payment_id: id, shipment_ref: s.ref } },
      line_items: due.items.map((i) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(i.amountUsd * 100), product_data: { name: i.description } } })),
    })
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,status,provider,provider_session_id) values ($1,$2,$3,$4,$5,$6,'pending','stripe',$7)`, [id, s.id, s.shipper_id, u.id, JSON.stringify(due.items), due.amountUsd, session.id])
    res.status(201).json({ url: session.url, paymentId: id })
  }))
  /** Back from Checkout before the webhook landed (or no webhook configured): ask Stripe directly. */
  r.post('/payments/:id/verify', wrap(async (req, res) => {
    const db = await getDb(); let p = await byId(db, String(req.params.id)); await access(db, req, p.shipment_id)
    if (p.status === 'pending' && p.provider === 'stripe' && p.provider_session_id && stripeMode() !== 'off') {
      const session = await stripe<Row>(`/checkout/sessions/${p.provider_session_id}`)
      if (session.payment_status === 'paid') p = await markPaid(db, p, { intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, method: session.payment_method_types?.[0] ?? 'card' })
    }
    res.json({ payment: paymentOut(p) })
  }))
  /** The office records money received outside the platform (bank, cash, mobile money). No escrow, no fee. */
  r.post('/shipments/:id/payment/record', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office: isOffice } = await access(db, req, String(req.params.id))
    if (!isOffice) throw new HttpError(403, 'Only the shipper can record a payment.')
    const existing = await latest(db, s.id)
    if (existing && ['held', 'released', 'paid_out', 'direct'].includes(existing.status)) throw new HttpError(409, 'This shipment is already paid.')
    const b = zRecord.parse(req.body)
    const due = await amountDue(db, s)
    const amount = b.amountUsd ?? due.amountUsd; if (!(amount > 0)) throw new HttpError(409, 'Enter the amount received.')
    if (existing && existing.status === 'pending') await db.query(`update escrow_payments set status = 'cancelled' where id = $1`, [existing.id])
    const id = 'esc_' + uid()
    const items = due.items.length && b.amountUsd === undefined ? due.items : [{ description: `Payment received (${b.method})${b.note ? ` — ${b.note}` : ''}`, amountUsd: amount, kind: 'freight' }]
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,status,provider,method) values ($1,$2,$3,$4,$5,$6,'pending','manual',$7)`, [id, s.id, s.shipper_id, s.user_id ?? null, JSON.stringify(items), amount, b.method])
    const p = await markPaid(db, await byId(db, id), { method: b.method, direct: true, by: u.name })
    res.status(201).json({ payment: paymentOut(p) })
  }))
  r.post('/payments/:id/refund', wrap(async (req, res) => {
    const db = await getDb(); const p = await byId(db, String(req.params.id)); const { u, office: isOffice } = await access(db, req, p.shipment_id)
    if (!isOffice && !u.admin) throw new HttpError(403, 'Not allowed.')
    if (!['held', 'released'].includes(p.status)) throw new HttpError(409, 'Only held or released (not yet paid out) funds can be refunded.')
    if (p.status === 'released' && !u.admin) throw new HttpError(409, 'Released funds can only be refunded by Ship Sync — contact support.')
    const b = zRefund.parse(req.body)
    let refundId: string | null = null
    if (p.provider === 'stripe' && p.provider_payment_intent) { const rf = await stripe<Row>('/refunds', { payment_intent: p.provider_payment_intent, metadata: { payment_id: p.id, reason: b.reason.slice(0, 200) } }); refundId = rf.id ?? null }
    await db.query(`update escrow_payments set status = 'refunded', refunded_at = now(), refund_reason = $2, provider_refund_id = $3 where id = $1`, [p.id, b.reason, refundId])
    if (p.receipt_document_id) await db.query('delete from documents where id = $1', [p.receipt_document_id])
    const { rows: ss } = await db.query<Row>('select * from shipments where id = $1', [p.shipment_id]); const s = ss[0]
    if (s) {
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.origin, `Payment of $${Number(p.amount_usd).toLocaleString()} refunded — ${b.reason}`])
      if (s.user_id) await notify(db, { userId: s.user_id, kind: 'payment', title: `Refund issued on ${s.ref}`, body: `$${Number(p.amount_usd).toLocaleString()} is on its way back to your card (3–10 business days). Reason: ${b.reason}`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `pay:${p.id}:refund` })
    }
    res.json({ payment: paymentOut(await byId(db, p.id)) })
  }))
  r.post('/payments/:id/release', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const p = await byId(db, String(req.params.id))
    if (p.status !== 'held') throw new HttpError(409, 'Only held funds can be released.')
    await releasePayment(db, p, `manual:${admin.name}`)
    res.json({ payment: paymentOut(await byId(db, p.id)) })
  }))

  /* ---- shipper: balance, ledger, payouts ---- */
  r.get('/payments', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); const cfg = await getSettings(db)
    const { rows } = await db.query<Row>(`${SELECT} where p.shipper_id = $1 and p.status <> 'cancelled' order by p.created_at desc limit 300`, [u.shipperId])
    const { rows: pos } = await db.query<Row>(`${PAYOUT_SELECT} where o.shipper_id = $1 order by o.requested_at desc limit 100`, [u.shipperId])
    const { rows: sh } = await db.query<Row>('select payout_details from shippers where id = $1', [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ payments: rows.map(paymentOut), payouts: pos.map(payoutOut), balance: await balanceFor(db, u.shipperId!), payoutDetails: maskDetails(J(sh[0]?.payout_details ?? '{}'), u.staffRole === 'owner'), canPayout: u.staffRole === 'owner', config: { ...publicCfg(cfg), payoutNote: cfg.payoutNote } })
  }))
  r.put('/payments/payout-details', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); if (u.staffRole !== 'owner') throw new HttpError(403, 'Only the owner can change payout details.')
    const b = zDetails.parse(req.body)
    await db.query('update shippers set payout_details = $2 where id = $1', [u.shipperId, JSON.stringify(b)])
    res.json({ payoutDetails: maskDetails(b, true) })
  }))
  r.post('/payouts', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); if (u.staffRole !== 'owner') throw new HttpError(403, 'Only the owner can request a payout.')
    const b = zPayout.parse(req.body ?? {})
    const bal = await balanceFor(db, u.shipperId!)
    const amount = r2(b.amountUsd ?? bal.availableUsd)
    if (!(amount > 0)) throw new HttpError(409, 'Nothing available to pay out yet.')
    if (amount > bal.availableUsd + 0.005) throw new HttpError(409, `Only $${bal.availableUsd.toLocaleString()} is available.`)
    const { rows: sh } = await db.query<Row>('select payout_details from shippers where id = $1', [u.shipperId]); const det = J(sh[0]?.payout_details ?? '{}') as Partial<PayoutDetails>
    if (!det.accountNumber && !det.mobileMoney) throw new HttpError(409, 'Add your bank or mobile-money details first.')
    const id = 'po_' + uid()
    await db.query(`insert into payouts (id,shipper_id,amount_usd,status,method,details,requested_by) values ($1,$2,$3,'requested',$4,$5,$6)`, [id, u.shipperId, amount, det.mobileMoney && !det.accountNumber ? 'mobile_money' : 'bank', JSON.stringify(det), u.name])
    // Attach released payments oldest-first until the amount is covered (partial payouts leave the remainder available).
    const { rows: rel } = await db.query<Row>(`select id, net_usd from escrow_payments where shipper_id = $1 and status = 'released' and payout_id is null order by released_at asc`, [u.shipperId])
    let left = amount; const ids: string[] = []
    for (const p of rel) { if (left <= 0.005) break; ids.push(p.id); left = r2(left - Number(p.net_usd)) }
    if (ids.length) await db.query(`update escrow_payments set payout_id = $2 where id = any($1::text[])`, [ids, id])
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'payment', title: `Payout requested — $${amount.toLocaleString()}`, body: `${u.company ?? 'A shipper'} asked for a payout to their ${det.mobileMoney && !det.accountNumber ? 'mobile money' : 'bank'} account. Mark it paid in Admin once sent.`, link: '/admin', dedupe: `po:${id}` })
    res.status(201).json({ payout: payoutOut((await db.query<Row>(`${PAYOUT_SELECT} where o.id = $1`, [id])).rows[0]), balance: await balanceFor(db, u.shipperId!) })
  }))

  /* ---- admin ---- */
  r.get('/admin/payments', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where p.status <> 'cancelled' order by p.created_at desc limit 500`)
    const { rows: pos } = await db.query<Row>(`${PAYOUT_SELECT} order by (o.status = 'requested') desc, o.requested_at desc limit 200`)
    const { rows: t } = await db.query<Row>(`select coalesce(sum(case when status in ('held','released','paid_out') then amount_usd end),0)::float as volume, coalesce(sum(case when status in ('held','released','paid_out') then fee_usd end),0)::float as fees, coalesce(sum(case when status = 'held' then net_usd end),0)::float as held, coalesce(sum(case when status = 'released' and payout_id is null then net_usd end),0)::float as owed, coalesce(sum(case when status = 'refunded' then amount_usd end),0)::float as refunded from escrow_payments`)
    const { rows: po } = await db.query<Row>(`select coalesce(sum(case when status = 'requested' then amount_usd end),0)::float as pending from payouts`)
    res.json({ settings: await getSettings(db), stripe: { mode: stripeMode(), webhook: !!process.env.STRIPE_WEBHOOK_SECRET }, payments: rows.map(paymentOut), payouts: pos.map((p) => ({ ...payoutOut(p), details: maskDetails(J(p.details ?? '{}'), true) })), totals: { volume: r2(t[0].volume), fees: r2(t[0].fees), held: r2(t[0].held), owed: r2(t[0].owed), refunded: r2(t[0].refunded), pendingPayouts: r2(po[0].pending) } })
  }))
  r.put('/admin/payments/settings', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = zSettings.parse({ ...(await getSettings(db)), ...req.body })
    await db.query(`insert into settings (id,value,updated_at) values ('payments',$1,now()) on conflict (id) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(b)])
    res.json({ settings: b })
  }))
  r.post('/admin/payouts/:id/paid', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`${PAYOUT_SELECT} where o.id = $1`, [req.params.id]); const po = rows[0]; if (!po) throw new HttpError(404, 'Payout not found.')
    if (po.status !== 'requested') throw new HttpError(409, 'This payout is already settled.')
    const b = z.object({ reference: z.string().trim().max(80).default(''), note: z.string().trim().max(300).default('') }).parse(req.body ?? {})
    await db.query(`update payouts set status = 'paid', reference = $2, note = $3, paid_at = now(), paid_by = $4 where id = $1`, [po.id, b.reference, b.note, admin.name])
    await db.query(`update escrow_payments set status = 'paid_out' where payout_id = $1 and status = 'released'`, [po.id])
    await notifyShipperStaff(db, po.shipper_id, { kind: 'payment', title: `Payout of $${Number(po.amount_usd).toLocaleString()} sent`, body: `${b.reference ? `Reference ${b.reference}. ` : ''}It should reach your account within 2 business days.`, link: '/dashboard/payments', dedupe: `po:${po.id}:paid` }, ['owner'])
    res.json({ payout: payoutOut((await db.query<Row>(`${PAYOUT_SELECT} where o.id = $1`, [po.id])).rows[0]) })
  }))
  r.post('/admin/payouts/:id/reject', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`${PAYOUT_SELECT} where o.id = $1`, [req.params.id]); const po = rows[0]; if (!po) throw new HttpError(404, 'Payout not found.')
    if (po.status !== 'requested') throw new HttpError(409, 'This payout is already settled.')
    const b = z.object({ note: z.string().trim().min(3).max(300) }).parse(req.body ?? {})
    await db.query(`update payouts set status = 'rejected', note = $2, paid_at = now(), paid_by = $3 where id = $1`, [po.id, b.note, admin.name])
    await db.query(`update escrow_payments set payout_id = null where payout_id = $1`, [po.id])
    await notifyShipperStaff(db, po.shipper_id, { kind: 'payment', title: `Payout request needs attention`, body: b.note, link: '/dashboard/payments', dedupe: `po:${po.id}:rej` }, ['owner'])
    res.json({ payout: payoutOut((await db.query<Row>(`${PAYOUT_SELECT} where o.id = $1`, [po.id])).rows[0]) })
  }))
}

/** Seed: the Gold Coast demo gets a released payment and a paid payout so the page has numbers. Idempotent. */
export async function seedPaymentsDemo(db: Db) {
  const { rows } = await db.query('select 1 from escrow_payments where id = $1', ['esc_demo_1']); if (rows.length) return
  const { rows: ss } = await db.query<Row>(`select s.* from shipments s where s.shipper_id = 'gold-coast-freight' and s.status in ('in_transit','arrived','customs','out_for_delivery') and s.user_id is not null order by s.created_at desc limit 2`)
  if (!ss.length) return
  const cfg = await getSettings(db)
  const mk = async (id: string, s: Row, amount: number, status: string, daysAgo: number, payoutId: string | null) => {
    const fee = r2(amount * cfg.takeRatePct)
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,items,amount_usd,fee_usd,net_usd,status,provider,method,paid_at,released_at,release_reason,payout_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'stripe','card',$10,$11,'status:in_transit',$12,$10)`,
      [id, s.id, s.shipper_id, s.user_id, JSON.stringify([{ description: `Ocean freight ${s.origin} → ${s.destination} — ${s.ref}`, amountUsd: amount, kind: 'freight' }]), amount, fee, r2(amount - fee), status, new Date(Date.now() - daysAgo * 86400000), status === 'held' ? null : new Date(Date.now() - (daysAgo - 2) * 86400000), payoutId])
  }
  await mk('esc_demo_1', ss[0], 1450, 'paid_out', 30, 'po_demo_1')
  await db.query(`insert into payouts (id,shipper_id,amount_usd,status,method,details,reference,requested_by,requested_at,paid_at,paid_by) values ('po_demo_1','gold-coast-freight',$1,'paid','bank','{"bankName":"Chase","accountName":"Gold Coast Freight LLC","accountNumber":"····4417","country":"US"}','ACH 88213','Nana Boateng',$2,$3,'Ship Sync') on conflict (id) do nothing`, [r2(1450 * (1 - cfg.takeRatePct)), new Date(Date.now() - 26 * 86400000), new Date(Date.now() - 25 * 86400000)])
  const { rows: held } = await db.query<Row>(`select s.* from shipments s where s.shipper_id = 'gold-coast-freight' and s.status in ('booked','picked_up','at_origin_port') and s.user_id is not null and s.id not in (select shipment_id from escrow_payments) order by s.created_at desc limit 1`)
  if (held[0]) await mk('esc_demo_2', held[0], 980, 'held', 4, null)
}
