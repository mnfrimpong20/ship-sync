/**
 * Charges collected from the receiver — duty the shipper paid on arrival, local delivery, storage, a balance —
 * paid by mobile money (MTN MoMo, Telecel Cash, AirtelTigo, M-Pesa, Orange Money…) through Paystack.
 *
 *   The shipper's office adds a charge in the destination currency; the receiver sees it on their page
 *   (/r/<token>) and pays. Paystack calls the webhook (signature = HMAC-SHA512 of the body with the secret key)
 *   and we also verify on return. When the shipper has a Paystack subaccount the money settles straight to
 *   them (Ntemtem keeps its fee via the split); otherwise it settles to Ntemtem and shows as owed to the shipper.
 *   Without PAYSTACK_SECRET_KEY the receiver is told to pay at collection and the office records cash/MoMo by hand.
 *   PAYSTACK_API_URL overrides the host for a local mock.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { LOCAL_CURRENCY, fmtMoney, localCurrency } from '../src/lib/address'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const key = () => process.env.PAYSTACK_SECRET_KEY?.trim() || ''
const host = () => (process.env.PAYSTACK_API_URL?.trim() || 'https://api.paystack.co').replace(/\/$/, '')
export const paystackReady = () => !!key()
const NTEMTEM_PCT = () => Math.min(10, Math.max(0, Number(process.env.RECEIVER_FEE_PCT ?? 2)))
/** Paystack amounts are in the smallest unit (pesewas, kobo, cents); XOF has none. */
const minor = (amount: number, currency: string) => Math.round(amount * (currency === 'XOF' ? 1 : 100))
const CHANNELS: Record<string, string[]> = { GHS: ['mobile_money', 'card'], KES: ['mobile_money', 'card'], XOF: ['mobile_money', 'card'], NGN: ['bank_transfer', 'ussd', 'card'], ZAR: ['eft', 'card'] }
export const payableOnline = (currency: string) => paystackReady() && !!CHANNELS[currency]

async function paystack<T = Row>(path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000)
  try {
    const res = await fetch(host() + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal })
    const j = (await res.json().catch(() => ({}))) as Row
    if (!res.ok || j.status === false) throw new Error(j.message || `Paystack error (${res.status})`)
    return j.data as T
  } finally { clearTimeout(t) }
}

export const chargeOut = (c: Row, lang: 'en' | 'fr' = 'en') => ({
  id: c.id, amount: Number(c.amount), currency: c.currency, label: fmtMoney(Number(c.amount), c.currency, lang), reason: c.reason, status: c.status as 'draft' | 'due' | 'paid' | 'cancelled',
  method: c.method as '' | 'paystack' | 'cash' | 'momo_direct', paidAt: ISO(c.paid_at), paidPhone: c.paid_phone ?? '', recordedBy: c.recorded_by ?? '', createdBy: c.created_by ?? '', settledTo: (c.settled_to ?? '') as '' | 'shipper' | 'ntemtem', payoutDone: !!c.payout_done, createdAt: ISO(c.created_at),
})

/** Mark a charge paid once (webhook, return-verify, or by hand). */
async function markPaid(db: Db, c: Row, how: { method: string; ref?: string | null; phone?: string; by?: string; settledTo?: string }) {
  const { rows } = await db.query<Row>(`update receiver_charges set status = 'paid', method = $2, provider_ref = coalesce($3, provider_ref), paid_phone = $4, recorded_by = $5, paid_at = now(), settled_to = $6 where id = $1 and status = 'due' returning *`, [c.id, how.method, how.ref ?? null, how.phone ?? '', how.by ?? '', how.settledTo ?? (how.method === 'paystack' ? 'ntemtem' : 'shipper')])
  const p = rows[0]; if (!p) return false
  const { rows: ss } = await db.query<Row>('select * from shipments where id = $1', [p.shipment_id]); const s = ss[0]; if (!s) return true
  const label = fmtMoney(Number(p.amount), p.currency)
  await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', `Receiver paid ${label}${p.reason ? ` (${p.reason})` : ''}${how.method === 'paystack' ? ' by mobile money' : how.method === 'cash' ? ' in cash' : ''}.`])
  await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `Receiver paid ${label} on ${s.ref}`, body: p.reason || 'Charge collected from the receiver.', link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `rcharge:${p.id}` }, ['owner', 'finance', 'dispatcher'])
  if (s.user_id) await notify(db, { userId: s.user_id, kind: 'payment', title: `Your receiver paid ${label} on ${s.ref}`, body: p.reason || '', link: `/track?ref=${s.ref}`, dedupe: `rcharge:${p.id}:c` })
  return true
}

/** Paystack webhook (mounted before express.json so the signature covers the exact bytes). */
export function paystackWebhook(getDb: () => Promise<Db>) {
  return async (req: Request, res: Response) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))
    if (!key()) return res.status(401).json({ error: 'Paystack not configured.' })
    const sig = String(req.header('x-paystack-signature') ?? ''); const want = createHmac('sha512', key()).update(raw).digest('hex')
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(400).json({ error: 'Bad signature.' })
    let evt: Row; try { evt = JSON.parse(raw.toString()) } catch { return res.status(400).json({ error: 'Bad payload.' }) }
    if (evt.event === 'charge.success') {
      const d = evt.data ?? {}; const db = await getDb()
      const { rows } = await db.query<Row>('select * from receiver_charges where provider_ref = $1', [String(d.reference ?? '')])
      const c = rows[0]
      if (c && Number(d.amount) >= minor(Number(c.amount), c.currency) && String(d.currency).toUpperCase() === c.currency) await markPaid(db, c, { method: 'paystack', ref: d.reference, phone: d.authorization?.mobile_money_number ?? d.customer?.phone ?? '', settledTo: d.subaccount?.subaccount_code ? 'shipper' : 'ntemtem' })
    }
    res.json({ received: true })
  }
}

const zCharge = z.object({ amount: z.number().positive('Enter an amount.').max(1_000_000), currency: z.string().trim().length(3).toUpperCase(), reason: z.string().trim().min(2, 'Say what it’s for (duty, delivery, storage…).').max(120), notify: z.boolean().default(true) })

export function mountMomo(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const isOffice = u.role === 'shipper' && s.shipper_id === u.shipperId && u.staffRole !== 'driver'
    if (!isOffice && !(u.role === 'customer' && s.user_id === u.id) && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, isOffice }
  }
  const list = async (db: Db, shipmentId: string) => (await db.query<Row>(`select * from receiver_charges where shipment_id = $1 and status <> 'cancelled' order by created_at`, [shipmentId])).rows

  r.get('/shipments/:id/receiver-charges', wrap(async (req, res) => {
    const db = await getDb(); const { s, isOffice } = await office(db, req)
    res.set('Cache-Control', 'no-store')
    res.json({ charges: (await list(db, s.id)).map((c) => chargeOut(c)), currency: localCurrency(s.destination), online: payableOnline(localCurrency(s.destination)), methods: LOCAL_CURRENCY[s.destination]?.label ?? '', canEdit: isOffice })
  }))
  r.post('/shipments/:id/receiver-charges', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, isOffice } = await office(db, req); if (!isOffice) throw new HttpError(403, 'Only the shipper adds charges.')
    const b = zCharge.parse(req.body)
    if ((await list(db, s.id)).filter((c) => c.status === 'due').length >= 5) throw new HttpError(409, 'There are already 5 unpaid charges on this shipment.')
    const id = 'rc_' + uid()
    await db.query('insert into receiver_charges (id,shipment_id,shipper_id,amount,currency,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, s.id, s.shipper_id, b.amount, b.currency, b.reason, u.name])
    if (b.notify) { const { messageRecipient } = await import('./recipient'); await messageRecipient(db, s, 'charge', { force: true, note: b.reason, amount: fmtMoney(b.amount, b.currency), by: u.name }).catch(() => null) }
    res.status(201).json({ charges: (await list(db, s.id)).map((c) => chargeOut(c)) })
  }))
  r.patch('/shipments/:id/receiver-charges/:cid', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, isOffice } = await office(db, req); if (!isOffice) throw new HttpError(403, 'Only the shipper can change charges.')
    const b = z.object({ action: z.enum(['cash', 'momo_direct', 'cancel']), phone: z.string().trim().max(30).default('') }).parse(req.body)
    const { rows } = await db.query<Row>(`select * from receiver_charges where id = $1 and shipment_id = $2`, [String(req.params.cid), s.id]); const c = rows[0]
    if (!c) throw new HttpError(404, 'Charge not found.'); if (c.status !== 'due' && !(c.status === 'draft' && b.action === 'cancel')) throw new HttpError(409, c.status === 'draft' ? 'Send this charge to the receiver first.' : 'This charge is already settled.')
    if (b.action === 'cancel') await db.query(`update receiver_charges set status = 'cancelled', recorded_by = $2 where id = $1`, [c.id, u.name])
    else await markPaid(db, c, { method: b.action, phone: b.phone, by: u.name, settledTo: 'shipper' })
    res.json({ charges: (await list(db, s.id)).map((x) => chargeOut(x)) })
  }))

  /* ---- receiver (public, by token) ---- */
  const byToken = async (db: Db, token: string) => { const { rows } = await db.query<Row>('select * from shipments where recipient_token = $1', [token]); if (!rows[0]) throw new HttpError(404, 'This link is not valid.'); return rows[0] }
  r.post('/r/:token/charges/:cid/pay', wrap(async (req, res) => {
    const db = await getDb(); const s = await byToken(db, String(req.params.token))
    const { rows } = await db.query<Row>(`select * from receiver_charges where id = $1 and shipment_id = $2`, [String(req.params.cid), s.id]); const c = rows[0]
    if (!c) throw new HttpError(404, 'Charge not found.'); if (c.status !== 'due') throw new HttpError(409, c.status === 'draft' ? 'Charge not found.' : 'This has already been paid.')
    if (!payableOnline(c.currency)) throw new HttpError(409, 'Online payment isn’t available for this one — please pay at collection.')
    const { rows: sh } = await db.query<Row>('select paystack_subaccount from shippers where id = $1', [s.shipper_id])
    const reference = `NTR-${s.ref}-${c.id.slice(-6)}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9-]/g, '')
    const sub = String(sh[0]?.paystack_subaccount ?? '').trim()
    const data = await paystack<{ authorization_url: string; reference: string }>('/transaction/initialize', {
      email: `receiver+${s.ref.toLowerCase()}@ntemtem.com`, amount: minor(Number(c.amount), c.currency), currency: c.currency, reference, channels: CHANNELS[c.currency],
      callback_url: `${appUrl() || `${req.protocol}://${req.get('host')}`}/r/${s.recipient_token}?charge=${c.id}`,
      metadata: { shipment: s.ref, charge: c.id, reason: c.reason, custom_fields: [{ display_name: 'Shipment', variable_name: 'shipment', value: s.ref }] },
      ...(sub ? { subaccount: sub, transaction_charge: Math.round(minor(Number(c.amount), c.currency) * NTEMTEM_PCT() / 100), bearer: 'subaccount' } : {}),
    })
    await db.query('update receiver_charges set provider_ref = $2 where id = $1', [c.id, data.reference])
    res.json({ url: data.authorization_url })
  }))
  r.post('/r/:token/charges/:cid/verify', wrap(async (req, res) => {
    const db = await getDb(); const s = await byToken(db, String(req.params.token))
    const { rows } = await db.query<Row>(`select * from receiver_charges where id = $1 and shipment_id = $2`, [String(req.params.cid), s.id]); const c = rows[0]
    if (!c) throw new HttpError(404, 'Charge not found.')
    if (c.status === 'due' && c.provider_ref && paystackReady()) {
      const t = await paystack<Row>(`/transaction/verify/${encodeURIComponent(c.provider_ref)}`).catch(() => null)
      if (t?.status === 'success' && Number(t.amount) >= minor(Number(c.amount), c.currency)) await markPaid(db, c, { method: 'paystack', ref: c.provider_ref, phone: t.authorization?.mobile_money_number ?? '', settledTo: t.subaccount?.subaccount_code ? 'shipper' : 'ntemtem' })
    }
    const { rows: now } = await db.query<Row>('select * from receiver_charges where id = $1', [c.id])
    res.json({ charge: chargeOut(now[0]) })
  }))

  /* ---- admin: receiver payments that settled to Ntemtem and are owed to the shipper ---- */
  r.get('/admin/receiver-payments', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select c.*, s.ref, sh.name as shipper_name from receiver_charges c join shipments s on s.id = c.shipment_id join shippers sh on sh.id = c.shipper_id where c.status = 'paid' and c.method = 'paystack' order by c.paid_at desc limit 200`)
    res.json({ configured: paystackReady(), payments: rows.map((c) => ({ ...chargeOut(c), ref: c.ref, shipper: c.shipper_name })) })
  }))
  r.post('/admin/receiver-payments/:cid/paid-out', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    await db.query(`update receiver_charges set payout_done = true where id = $1 and settled_to = 'ntemtem'`, [String(req.params.cid)]); res.json({ ok: true })
  }))
  r.put('/admin/shippers/:id/paystack', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = z.object({ subaccount: z.string().trim().regex(/^$|^ACCT_[A-Za-z0-9]+$/, 'A Paystack subaccount code looks like ACCT_xxxxxxxx.') }).parse(req.body)
    await db.query('update shippers set paystack_subaccount = $2 where id = $1', [String(req.params.id), b.subaccount]); res.json({ ok: true })
  }))
}

/** For the receiver page: the charges in the receiver's language. */
export async function receiverCharges(db: Db, s: Row, lang: 'en' | 'fr') {
  const { rows } = await db.query<Row>(`select * from receiver_charges where shipment_id = $1 and status not in ('cancelled','draft') order by created_at`, [s.id])
  return { charges: rows.map((c) => chargeOut(c, lang)), online: payableOnline(localCurrency(s.destination)), methods: LOCAL_CURRENCY[s.destination]?.label ?? '' }
}
