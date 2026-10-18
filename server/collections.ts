/**
 * Online invoices & collections — the customer side of invoicing. Every invoice gets a pay link
 * (`/pay/<token>`, no sign-in needed) that shows the invoice and takes a card through the same
 * Stripe / escrow rails as shipment payments; customers with an account also see all their invoices
 * on the dashboard. The office sends the invoice by email/SMS with one click, and reminders go out
 * automatically before the due date and after it (per-shipper schedule), with a log on the invoice.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import { can, type ApiUser } from './api'
import { emailTemplate, notify, notifyShipperStaff, sendEmail, emailProvider } from './notify'
import { invoiceOut } from './clients'
import { normalisePhone, sendText, smsProvider } from './sms'
import { getSettings as paymentSettings, markPaid, paymentOut, stripeMode } from './payments'

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
const today = () => new Date().toISOString().slice(0, 10)
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')

export interface CollectionSettings { autoRemind: boolean; beforeDays: number; afterDays: number[]; sms: boolean; message: string }
export const DEFAULT_COLLECTIONS: CollectionSettings = { autoRemind: true, beforeDays: 3, afterDays: [3, 10, 21], sms: false, message: 'Thank you for shipping with us. You can pay securely online with the button below, or reply to this email to arrange a bank transfer or mobile money.' }
export async function collectionSettings(db: Db, shipperId: string): Promise<CollectionSettings> {
  const { rows } = await db.query<Row>('select collections from shippers where id = $1', [shipperId])
  return { ...DEFAULT_COLLECTIONS, ...(J(rows[0]?.collections) ?? {}) }
}

const SELECT = `select i.*, c.name as client_name, c.email as client_email, c.phone as client_phone, c.whatsapp as client_whatsapp, c.user_id as client_user_id, sh.name as shipper_name, sh.hq as shipper_hq, sh.initials as shipper_initials, sh.hue as shipper_hue, s.ref as shipment_ref
  from invoices i join clients c on c.id = i.client_id join shippers sh on sh.id = i.shipper_id left join shipments s on s.id = i.shipment_id`
async function withPayments(db: Db, rows: Row[]) {
  if (!rows.length) return []
  const { rows: pays } = await db.query<Row>('select * from payments where invoice_id = any($1::text[]) order by at asc', [rows.map((x) => x.id)])
  return rows.map((r) => ({ ...invoiceOut(r, pays.filter((p) => p.invoice_id === r.id)), clientName: r.client_name, clientEmail: r.client_email, shipmentRef: r.shipment_ref ?? null, shipper: { id: r.shipper_id, name: r.shipper_name, hq: r.shipper_hq, initials: r.shipper_initials, hue: r.shipper_hue }, overdue: r.status === 'sent' && !!r.due_at && DATE(r.due_at)! < today() }))
}
async function ensureToken(db: Db, inv: Row) {
  if (inv.pay_token) return inv.pay_token as string
  const t = randomBytes(12).toString('base64url'); await db.query('update invoices set pay_token = $2 where id = $1', [inv.id, t]); return t
}
const payLink = (token: string) => `${appUrl()}/pay/${token}`

/** Email (+ optional SMS) the invoice or a reminder to the client. Returns which channels went out. */
export async function sendInvoiceMessage(db: Db, inv: Row, kind: 'invoice' | 'reminder' | 'overdue' | 'receipt', opts: { by?: string; note?: string } = {}) {
  const token = await ensureToken(db, inv); const cfg = await collectionSettings(db, inv.shipper_id)
  const { rows: pays } = await db.query<Row>('select coalesce(sum(amount),0)::float as paid from payments where invoice_id = $1', [inv.id])
  const balance = Math.max(0, Number(inv.total) - Number(pays[0].paid))
  const due = DATE(inv.due_at)
  const titles = { invoice: `Invoice ${inv.number} from ${inv.shipper_name} — $${balance.toLocaleString()}`, reminder: `Reminder: invoice ${inv.number} is due ${due ?? 'soon'}`, overdue: `Overdue: invoice ${inv.number} — $${balance.toLocaleString()} outstanding`, receipt: `Paid — invoice ${inv.number}` }
  const bodies = {
    invoice: `${cfg.message}${inv.shipment_ref ? ` This invoice is for shipment ${inv.shipment_ref}.` : ''}${due ? ` Due ${due}.` : ''}`,
    reminder: `A quick reminder that $${balance.toLocaleString()} on invoice ${inv.number}${inv.shipment_ref ? ` (shipment ${inv.shipment_ref})` : ''} is due ${due ?? 'soon'}. ${opts.note ?? ''}`.trim(),
    overdue: `Invoice ${inv.number}${inv.shipment_ref ? ` for shipment ${inv.shipment_ref}` : ''} was due ${due} and $${balance.toLocaleString()} is still outstanding. Please pay online below or contact us if something is wrong. ${opts.note ?? ''}`.trim(),
    receipt: `We received your payment on invoice ${inv.number}. Thank you — nothing more to pay.`,
  }
  const channels: string[] = []
  const html = emailTemplate({ name: inv.client_name, title: titles[kind], body: bodies[kind], link: payLink(token), cta: kind === 'receipt' ? 'View invoice' : `Pay $${balance.toLocaleString()} online` })
  if (inv.client_email && emailProvider().id !== 'off') { try { await sendEmail(inv.client_email, titles[kind], html); channels.push('email') } catch (e) { console.error('[collections] email', e) } }
  if (inv.client_user_id) { await notify(db, { userId: inv.client_user_id, kind: 'payment', title: titles[kind], body: bodies[kind], link: `/pay/${token}`, dedupe: `inv:${inv.id}:${kind}:${today()}` }); channels.push('app') }
  const phone = inv.client_whatsapp || inv.client_phone
  if (cfg.sms && phone && kind !== 'receipt' && smsProvider().id !== 'off') {
    const to = normalisePhone(phone, 'US'); if (to) { try { await sendText(to, `${inv.shipper_name}: ${kind === 'invoice' ? 'invoice' : kind === 'reminder' ? 'reminder — invoice' : 'OVERDUE — invoice'} ${inv.number} $${balance.toLocaleString()}${due ? ` due ${due}` : ''}. Pay online: ${payLink(token)}`); channels.push('sms') } catch (e) { console.error('[collections] sms', e) } }
  }
  const log = (J(inv.reminders_sent) ?? []) as Row[]
  log.push({ kind, at: new Date().toISOString(), channel: channels.join('+') || 'none', by: opts.by ?? 'auto' })
  await db.query(`update invoices set reminders_sent = $2, last_reminder_at = now(), sent_at = coalesce(sent_at, case when $3 = 'invoice' then now() else null end) where id = $1`, [inv.id, JSON.stringify(log.slice(-30)), kind])
  return channels
}

/** Every 6 h: reminders before due, then on the configured days after due. One message per step per invoice. */
export async function sweepCollections(db: Db) {
  const { rows } = await db.query<Row>(`${SELECT} where i.status = 'sent' and i.due_at is not null`)
  for (const inv of rows) {
    try {
      const cfg = await collectionSettings(db, inv.shipper_id); if (!cfg.autoRemind) continue
      const due = new Date(DATE(inv.due_at)! + 'T12:00:00Z').getTime(); const days = Math.floor((Date.now() - due) / 86400000) // negative = before due
      const log = (J(inv.reminders_sent) ?? []) as Row[]
      const has = (k: string) => log.some((l) => l.step === k)
      let step: string | null = null; let kind: 'reminder' | 'overdue' = 'reminder'
      if (days < 0 && -days <= cfg.beforeDays && !has('before')) step = 'before'
      else if (days >= 0) { const hit = [...cfg.afterDays].sort((a, b) => b - a).find((d) => days >= d); if (hit != null && !has(`after:${hit}`)) { step = `after:${hit}`; kind = 'overdue' } }
      if (!step) continue
      if (!inv.sent_at && !log.length) continue // never sent to the customer at all — don't start nagging
      await sendInvoiceMessage(db, inv, kind)
      const log2 = (J((await db.query<Row>('select reminders_sent from invoices where id = $1', [inv.id])).rows[0].reminders_sent) ?? []) as Row[]
      log2[log2.length - 1].step = step
      await db.query('update invoices set reminders_sent = $2 where id = $1', [inv.id, JSON.stringify(log2)])
      if (kind === 'overdue') await notifyShipperStaff(db, inv.shipper_id, { kind: 'invoice_overdue', title: `Reminder sent — ${inv.number} is ${days} day${days === 1 ? '' : 's'} overdue`, body: `${inv.client_name} · $${Number(inv.total).toLocaleString()}. Automatic reminder #${log.length + 1} went out.`, link: `/dashboard/clients/${inv.client_id}?tab=invoices`, dedupe: `inv:${inv.id}:${step}` }, ['owner', 'dispatcher'])
    } catch (e) { console.error('[collections] sweep', inv.id, e) }
  }
}
export function startCollectionSweeps(getDb: () => Promise<Db>) {
  const run = () => getDb().then(sweepCollections).catch((e) => console.error('[collections]', e))
  setTimeout(run, 40_000); setInterval(run, 6 * 3600_000)
}

const zSettings = z.object({ autoRemind: z.boolean(), beforeDays: z.number().int().min(0).max(30), afterDays: z.array(z.number().int().min(1).max(120)).max(6), sms: z.boolean(), message: z.string().trim().max(400) })

export function mountCollections(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const office = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !can(u, 'collections')) throw new HttpError(403, 'Collections access is needed for this.'); return u }
  const byToken = async (db: Db, token: string) => { const { rows } = await db.query<Row>(`${SELECT} where i.pay_token = $1`, [token]); if (!rows[0] || rows[0].status === 'void') throw new HttpError(404, 'This invoice link is not valid.'); return rows[0] }
  const latestPayment = async (db: Db, invId: string) => (await db.query<Row>(`select p.*, s.ref, s.customer, sh.name as shipper_name from escrow_payments p left join shipments s on s.id = p.shipment_id join shippers sh on sh.id = p.shipper_id where p.invoice_id = $1 and p.status <> 'cancelled' order by p.created_at desc limit 1`, [invId])).rows[0] ?? null
  const checkout = async (db: Db, inv: Row, email: string | null, userId: string | null, returnBase: string) => {
    const cfg = await paymentSettings(db); if (!cfg.enabled || stripeMode() === 'off') throw new HttpError(409, 'Online payment is not available right now — pay by bank transfer or contact the shipper.')
    if (inv.status === 'paid') throw new HttpError(409, 'This invoice is already paid.')
    const [full] = await withPayments(db, [inv]); const balance = full.balance; if (!(balance > 0)) throw new HttpError(409, 'Nothing left to pay.')
    const existing = await latestPayment(db, inv.id)
    if (existing && ['held', 'released', 'paid_out', 'direct'].includes(existing.status)) throw new HttpError(409, 'A payment is already on this invoice.')
    if (existing?.status === 'pending') await db.query(`update escrow_payments set status = 'cancelled' where id = $1`, [existing.id])
    const id = 'esc_' + uid()
    const { stripe } = await import('./payments')
    const session = await stripe('/checkout/sessions', {
      mode: 'payment', client_reference_id: id, customer_email: email || undefined,
      success_url: `${returnBase}?paid=${id}`, cancel_url: `${returnBase}?paid=cancel`,
      metadata: { payment_id: id, invoice_id: inv.id, invoice_number: inv.number },
      payment_intent_data: { description: `Ntemtem invoice ${inv.number} — ${inv.shipper_name}`, metadata: { payment_id: id, invoice_number: inv.number } },
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(balance * 100), product_data: { name: `Invoice ${inv.number} — ${inv.shipper_name}${inv.shipment_ref ? ` (${inv.shipment_ref})` : ''}` } } }],
    })
    await db.query(`insert into escrow_payments (id,shipment_id,shipper_id,user_id,invoice_id,items,amount_usd,status,provider,provider_session_id) values ($1,$2,$3,$4,$5,$6,$7,'pending','stripe',$8)`, [id, inv.shipment_id ?? null, inv.shipper_id, userId, inv.id, JSON.stringify([{ description: `Invoice ${inv.number}`, amountUsd: balance, kind: 'freight' }]), balance, session.id])
    return { url: session.url as string, paymentId: id }
  }

  /* ---- public pay page ---- */
  r.get('/pay/:token', wrap(async (req, res) => {
    const db = await getDb(); const inv = await byToken(db, String(req.params.token))
    const [full] = await withPayments(db, [inv]); const p = await latestPayment(db, inv.id); const cfg = await paymentSettings(db)
    res.set('Cache-Control', 'no-store')
    res.json({ invoice: full, payment: p ? paymentOut(p) : null, online: cfg.enabled && stripeMode() !== 'off', mode: stripeMode(), bank: (J((await db.query<Row>('select payout_details from shippers where id = $1', [inv.shipper_id])).rows[0]?.payout_details) ?? {}).bankName ? 'Bank transfer details available from the shipper.' : null })
  }))
  r.post('/pay/:token/checkout', wrap(async (req, res) => {
    const db = await getDb(); const inv = await byToken(db, String(req.params.token))
    let userId: string | null = null; try { userId = (await requireUser(db, req)).id } catch { /* guest */ }
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    res.status(201).json(await checkout(db, inv, inv.client_email || null, userId, `${base}/pay/${inv.pay_token}`))
  }))
  r.post('/pay/:token/verify', wrap(async (req, res) => {
    const db = await getDb(); const inv = await byToken(db, String(req.params.token))
    let p = await latestPayment(db, inv.id)
    if (p && p.status === 'pending' && p.provider_session_id && stripeMode() !== 'off') {
      const { stripe } = await import('./payments'); const session = await stripe<Row>(`/checkout/sessions/${p.provider_session_id}`)
      if (session.payment_status === 'paid') p = await markPaid(db, p, { intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, method: session.payment_method_types?.[0] ?? 'card' })
    }
    const [full] = await withPayments(db, [(await db.query<Row>(`${SELECT} where i.id = $1`, [inv.id])).rows[0]])
    res.json({ invoice: full, payment: p ? paymentOut(p) : null })
  }))

  /* ---- customer: my invoices ---- */
  r.get('/my/invoices', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where c.user_id = $1 and i.status <> 'draft' order by (i.status = 'sent') desc, i.due_at asc nulls last, i.created_at desc`, [u.id])
    for (const inv of rows) inv.pay_token = await ensureToken(db, inv)
    const list = await withPayments(db, rows)
    res.set('Cache-Control', 'no-store')
    res.json({ invoices: list, totals: { outstanding: list.filter((i) => i.status === 'sent').reduce((n, i) => n + i.balance, 0), overdue: list.filter((i) => i.overdue).reduce((n, i) => n + i.balance, 0) } })
  }))

  /* ---- office ---- */
  r.get('/collections', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where i.shipper_id = $1 and i.status in ('sent','paid') order by (i.status = 'sent') desc, i.due_at asc nulls last, i.created_at desc limit 300`, [u.shipperId])
    for (const inv of rows) inv.pay_token = await ensureToken(db, inv)
    const list = await withPayments(db, rows)
    const open = list.filter((i) => i.status === 'sent')
    res.set('Cache-Control', 'no-store')
    res.json({ invoices: list, settings: await collectionSettings(db, u.shipperId!), channels: { email: emailProvider().id !== 'off', sms: smsProvider().id !== 'off' }, totals: { outstanding: open.reduce((n, i) => n + i.balance, 0), overdue: open.filter((i) => i.overdue).reduce((n, i) => n + i.balance, 0), overdueCount: open.filter((i) => i.overdue).length, collected30: list.filter((i) => i.status === 'paid').flatMap((i) => i.payments).filter((p) => (p.at ?? "") >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).reduce((n, p) => n + p.amount, 0) } })
  }))
  r.put('/collections/settings', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req); if (u.staffRole !== 'owner' && u.staffRole !== 'dispatcher') throw new HttpError(403, 'Owners and dispatchers only.')
    const b = zSettings.parse({ ...(await collectionSettings(db, u.shipperId!)), ...req.body })
    await db.query('update shippers set collections = $2 where id = $1', [u.shipperId, JSON.stringify(b)])
    res.json({ settings: b })
  }))
  r.post('/invoices/:id/send', wrap(async (req, res) => {
    const db = await getDb(); const u = await office(db, req)
    const { rows } = await db.query<Row>(`${SELECT} where i.id = $1 and i.shipper_id = $2`, [req.params.id, u.shipperId]); const inv = rows[0]; if (!inv) throw new HttpError(404, 'Invoice not found.')
    if (inv.status === 'void') throw new HttpError(409, 'This invoice is void.')
    const b = z.object({ kind: z.enum(['invoice', 'reminder', 'overdue']).default('invoice'), note: z.string().trim().max(300).default('') }).parse(req.body ?? {})
    if (inv.status === 'paid') throw new HttpError(409, 'Already paid — nothing to send.')
    if (inv.status === 'draft') await db.query(`update invoices set status = 'sent' where id = $1`, [inv.id])
    if (!inv.client_email && !inv.client_user_id) throw new HttpError(409, 'This client has no email address on file — add one first.')
    const channels = await sendInvoiceMessage(db, inv, b.kind, { by: u.name, note: b.note })
    const [full] = await withPayments(db, [(await db.query<Row>(`${SELECT} where i.id = $1`, [inv.id])).rows[0]])
    res.json({ invoice: full, channels, payLink: payLink(full.payToken!) })
  }))
}

/** After an invoice is paid online (called from payments.markPaid): thank-you receipt to the client. */
export async function onInvoicePaid(db: Db, invoiceId: string) {
  const { rows } = await db.query<Row>(`${SELECT} where i.id = $1`, [invoiceId]); if (!rows[0]) return
  await sendInvoiceMessage(db, rows[0], 'receipt').catch((e) => console.error('[collections] receipt', e))
}
