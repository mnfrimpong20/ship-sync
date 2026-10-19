/**
 * Autopilot — the shipper's office chores done automatically, each one switchable, all of it logged.
 *
 *   1  Unpaid bookings     marketplace bookings with nothing paid → the customer is reminded 2 days after booking,
 *                          3 days before the ready date and when the cargo reaches the port (invoices already have their
 *                          own reminder schedule in collections.ts, so shipments with an invoice are left to it)
 *   2  Re-pricing          weighed in heavier than declared → a proposed new price (pro-rata to chargeable weight);
 *                          the office reviews it or it goes straight to the customer, who approves in one tap
 *   3  Container fill      before the cut-off: tell the office what would fill each open container, optionally load
 *                          it automatically N days before; once ≥ target full with no line booking → "book space"
 *   4  Pickup planning     the evening before: split tomorrow's pickups into runs by area, order the stops, hand them
 *                          to drivers and text every customer a two-hour arrival window
 *   5  Quote follow-up     a quote with no answer after N hours → a polite follow-up from the shipper (or a nudge to send one)
 *   6  Paperwork           container gated in → house bill of lading drafts; US exports → shipper's letter of instruction
 *   7  Destination charges shipment lands with a duty estimate → receiver charge drafted (or sent) in local currency
 *   Rules (rules.ts) and the WhatsApp assistant (assistant.ts) report into the same log.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { normalisePhone, sendText, smsProvider } from './sms'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const D = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const J = <T>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const r2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export interface AutopilotSettings {
  unpaidReminders: boolean
  reprice: 'off' | 'review' | 'auto'; repriceThresholdPct: number
  containerFill: boolean; autoLoadDays: number; fillTargetPct: number
  pickupPlanning: boolean; planHour: number; timezone: string; dayStart: string; maxStopsPerRun: number; textWindows: boolean
  quoteFollowUp: 'off' | 'remind' | 'auto'; followUpHours: number; followUpMessage: string
  paperwork: boolean
  destinationCharges: 'off' | 'draft' | 'send'
  assistant: boolean
}
export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  unpaidReminders: true, reprice: 'review', repriceThresholdPct: 10,
  containerFill: true, autoLoadDays: 0, fillTargetPct: 80,
  pickupPlanning: true, planHour: 17, timezone: 'America/Chicago', dayStart: '09:00', maxStopsPerRun: 12, textWindows: true,
  quoteFollowUp: 'remind', followUpHours: 48, followUpMessage: 'Hi {name}, just checking in on our quote for {ref} ({price}). Happy to answer any questions — reply here and we can book your pickup.',
  paperwork: true, destinationCharges: 'draft', assistant: true,
}
export async function autopilotOf(db: Db, shipperId: string): Promise<AutopilotSettings> {
  const { rows } = await db.query<Row>('select value from autopilot_settings where shipper_id = $1', [shipperId])
  return { ...DEFAULT_AUTOPILOT, ...J<Partial<AutopilotSettings>>(rows[0]?.value, {}) }
}
/** One line in the shipper's Autopilot log (also what the office reads to trust it). */
export async function logAuto(db: Db, shipperId: string, kind: string, title: string, o: { body?: string; link?: string; ref?: string } = {}) {
  await db.query('insert into autopilot_log (id,shipper_id,kind,title,body,link,ref) values ($1,$2,$3,$4,$5,$6,$7)', ['al_' + uid(), shipperId, kind, title.slice(0, 200), (o.body ?? '').slice(0, 600), o.link ?? '', o.ref ?? ''])
}
/** Do-once marker so sweeps never repeat themselves. Returns false when already done. */
async function once(db: Db, key: string) { const { rows } = await db.query<Row>('insert into autopilot_marks (key) values ($1) on conflict do nothing returning key', [key]); return !!rows[0] }
async function textTo(phone: string | null | undefined, country: string, text: string) {
  if (smsProvider().id === 'off' || !phone) return false
  const to = normalisePhone(phone, country); if (!to) return false
  try { await sendText(to, text); return true } catch { return false }
}

/* ============================== 1 · unpaid bookings ============================== */
async function paidUsd(db: Db, shipmentId: string) { const { rows } = await db.query<Row>(`select coalesce(sum(amount_usd),0)::float as n from escrow_payments where shipment_id = $1 and status in ('held','released','direct')`, [shipmentId]); return Number(rows[0].n) }
export async function sweepUnpaid(db: Db) {
  const { rows } = await db.query<Row>(`select s.*, r.contact_phone, r.ready_date, sh.name as shipper_name,
      (select i.id from invoices i where i.shipment_id = s.id and i.status in ('sent','draft') order by i.created_at desc limit 1) as inv_id
    from shipments s join requests r on r.id = s.request_id join shippers sh on sh.id = s.shipper_id
    where s.cancelled_at is null and s.status not in ('delivered') and s.user_id is not null and s.created_at < now() - ($1 || ' hours')::interval and s.created_at > now() - interval '120 days'`, [String(Math.max(0, Number(process.env.AUTOPILOT_UNPAID_AFTER_HOURS ?? 48)))])
  const { amountDue } = await import('./payments')
  for (const s of rows) {
    const cfg = await autopilotOf(db, s.shipper_id); if (!cfg.unpaidReminders) continue
    let owed: number
    if (s.inv_id) { const { rows: iv } = await db.query<Row>(`select i.total, coalesce((select sum(amount) from payments p where p.invoice_id = i.id),0)::float as paid from invoices i where i.id = $1`, [s.inv_id]); owed = r2(Number(iv[0].total) - Number(iv[0].paid)) }
    else { const due = await amountDue(db, s); owed = r2(due.amountUsd - (await paidUsd(db, s.id))) }
    if (owed <= 0) continue
    const ready = D(s.ready_date); const daysToReady = ready ? Math.round((new Date(ready + 'T12:00:00Z').getTime() - Date.now()) / 86400000) : null
    const atPort = ['at_origin_port', 'in_transit'].includes(s.status)
    const step = atPort ? 'port' : daysToReady != null && daysToReady <= 3 && daysToReady >= 0 && s.status === 'booked' ? 'ready' : s.inv_id ? null : 'booked' // invoices already get due-date reminders
    if (!step || !(await once(db, `unpaid:${s.id}:${step}`))) continue
    const what = step === 'port' ? 'it’s at the port and about to sail' : step === 'ready' ? `pickup is ${daysToReady === 0 ? 'today' : `in ${daysToReady} day${daysToReady === 1 ? '' : 's'}`}` : 'your booking is confirmed'
    const link = s.inv_id ? '/dashboard?tab=invoices' : '/dashboard?tab=money'
    await notify(db, { userId: s.user_id, kind: 'payment', title: `${money(owed)} to pay for ${s.ref}`, body: `${s.shipper_name}: ${what}. Pay securely on Ntemtem — the money is held until your goods are on their way.`, link, dedupe: `unpaid:${s.id}:${step}` })
    const texted = await textTo(s.contact_phone, 'US', `${s.shipper_name}: ${money(owed)} is due for ${s.ref} — ${what}. Pay securely: ${(process.env.APP_URL || '').replace(/\/$/, '')}${link}`)
    await logAuto(db, s.shipper_id, 'unpaid', `Payment reminder sent for ${s.ref} (${money(owed)})`, { body: `${s.customer} · ${step === 'port' ? 'at the port' : step === 'ready' ? 'before pickup' : '2 days after booking'}${texted ? ' · email + text' : ' · email/app'}`, link: `/dashboard/shipments?q=${s.ref}&b=all`, ref: s.ref })
  }
}

/* ============================== 2 · re-pricing after weighing ============================== */
export const adjustmentOut = (a: Row) => ({ id: a.id, shipmentId: a.shipment_id, oldUsd: Number(a.old_usd), newUsd: Number(a.new_usd), diffUsd: r2(Number(a.new_usd) - Number(a.old_usd)), reason: a.reason, status: a.status as 'proposed' | 'sent' | 'approved' | 'declined' | 'withdrawn', createdAt: ISO(a.created_at), decidedAt: ISO(a.decided_at), decidedBy: a.decided_by ?? '' })
async function freightPrice(db: Db, s: Row) {
  const { rows: inv } = await db.query<Row>(`select * from invoices where shipment_id = $1 and status in ('draft','sent') order by created_at desc limit 1`, [s.id])
  if (inv[0]) return { usd: Number(inv[0].total), source: 'invoice' as const, invoice: inv[0] }
  const { rows: q } = s.request_id ? await db.query<Row>(`select id, price from quotes where request_id = $1 and status = 'accepted' limit 1`, [s.request_id]) : { rows: [] as Row[] }
  if (q[0]) return { usd: Number(q[0].price), source: 'quote' as const, quoteId: q[0].id }
  return null
}
/** Called by measure.ts when every piece has been weighed. */
export async function onMeasured(db: Db, s: Row, v: { totals: { chargeableKg: number; cbm: number }; declared: { chargeableKg: number | null }; diffPct: number | null }) {
  const cfg = await autopilotOf(db, s.shipper_id); if (cfg.reprice === 'off') return
  if (v.diffPct == null || v.diffPct < cfg.repriceThresholdPct || !v.declared.chargeableKg) return
  const { rows: open } = await db.query<Row>(`select 1 from price_adjustments where shipment_id = $1 and status in ('proposed','sent','approved')`, [s.id]); if (open[0]) return
  const base = await freightPrice(db, s); if (!base || base.usd <= 0) return
  const newUsd = Math.round(base.usd * (v.totals.chargeableKg / v.declared.chargeableKg))
  const reason = `Weighed and measured at ${v.totals.chargeableKg.toLocaleString()} kg chargeable${s.mode === 'ocean' ? ` (${v.totals.cbm} m³)` : ''} against ${v.declared.chargeableKg.toLocaleString()} kg declared (+${v.diffPct}%).`
  const id = 'adj_' + uid()
  await db.query(`insert into price_adjustments (id,shipment_id,shipper_id,old_usd,new_usd,reason,status,token) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, s.id, s.shipper_id, base.usd, newUsd, reason, cfg.reprice === 'auto' ? 'sent' : 'proposed', randomBytes(12).toString('base64url')])
  if (cfg.reprice === 'auto') await sendAdjustment(db, s, id)
  else await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `New price suggested for ${s.ref}: ${money(base.usd)} → ${money(newUsd)}`, body: `${reason} Review and send it to ${s.customer} from the shipment.`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `adj:${id}` }, ['owner', 'dispatcher', 'finance'])
  await logAuto(db, s.shipper_id, 'reprice', `${cfg.reprice === 'auto' ? 'Sent' : 'Suggested'} a new price for ${s.ref}: ${money(base.usd)} → ${money(newUsd)}`, { body: reason, link: `/dashboard/shipments?q=${s.ref}&b=all`, ref: s.ref })
}
async function sendAdjustment(db: Db, s: Row, id: string) {
  const { rows } = await db.query<Row>(`update price_adjustments set status = 'sent', sent_at = now() where id = $1 and status in ('proposed','sent') returning *`, [id]); const a = rows[0]; if (!a) return
  if (s.user_id) await notify(db, { userId: s.user_id, kind: 'payment', title: `Please approve the updated price for ${s.ref}`, body: `${a.reason} New price ${money(Number(a.new_usd))} (was ${money(Number(a.old_usd))}).`, link: `/dashboard?tab=shipments&open=${s.id}&view=pay`, dedupe: `adj:${a.id}:c` })
}
/** Approved → the money owed goes up in the right place: open invoice, else the accepted quote, else a new invoice for the difference. */
export async function applyAdjustment(db: Db, s: Row, a: Row, by: string) {
  const diff = Math.round(Number(a.new_usd) - Number(a.old_usd)); const base = await freightPrice(db, s); const paid = await paidUsd(db, s.id)
  const line = { description: `Weight adjustment — ${String(a.reason).slice(0, 120)}`, qty: 1, unit: diff }
  if (base?.source === 'invoice' && base.invoice.status !== 'paid') {
    const items = [...J<Row[]>(base.invoice.items, []), line]; const subtotal = Math.round(items.reduce((n, i) => n + Number(i.qty) * Number(i.unit), 0))
    await db.query('update invoices set items = $2, subtotal = $3, total = $3 + tax where id = $1', [base.invoice.id, JSON.stringify(items), subtotal])
  } else if (base?.source === 'quote' && paid <= 0) {
    await db.query('update quotes set original_price = coalesce(original_price, price), price = $2 where id = $1', [base.quoteId, Number(a.new_usd)])
  } else if (s.client_id) {
    const { createInvoice } = await import('./shipmentOps')
    await createInvoice(db, { shipperId: s.shipper_id, clientId: s.client_id, shipmentId: s.id, items: [line], status: 'sent', by, send: true, notes: 'Difference after weighing.' })
  }
}

/* ============================== 5 · quote follow-ups ============================== */
export async function sweepQuoteFollowUps(db: Db) {
  const { rows } = await db.query<Row>(`select q.*, r.ref, r.user_id, r.contact_name, r.id as rid, sh.name as shipper_name from quotes q join requests r on r.id = q.request_id join shippers sh on sh.id = q.shipper_id
    where q.status = 'sent' and r.status = 'open' and q.sent_at < now() - interval '6 hours' and q.sent_at > now() - interval '14 days'
      and not exists (select 1 from request_messages m where m.request_id = r.id and m.shipper_id = q.shipper_id and m.author_role = 'customer' and m.created_at > q.sent_at)`)
  for (const q of rows) {
    const cfg = await autopilotOf(db, q.shipper_id); if (cfg.quoteFollowUp === 'off') continue
    if (Date.now() - new Date(q.sent_at).getTime() < cfg.followUpHours * 3600_000) continue
    if (!(await once(db, `qfu:${q.id}`))) continue
    if (cfg.quoteFollowUp === 'auto') {
      const text = cfg.followUpMessage.replace(/\{name\}/g, String(q.contact_name ?? '').split(' ')[0] || 'there').replace(/\{ref\}/g, q.ref).replace(/\{price\}/g, money(Number(q.price)))
      await db.query('insert into request_messages (id,request_id,shipper_id,author_role,author_name,body,masked) values ($1,$2,$3,$4,$5,$6,false)', ['rm_' + uid(), q.rid, q.shipper_id, 'shipper', q.shipper_name, text.slice(0, 1500)])
      if (q.user_id) await notify(db, { userId: q.user_id, kind: 'request_update', title: `${q.shipper_name} followed up on ${q.ref}`, body: text.slice(0, 200), link: `/dashboard?open=${q.rid}&thread=${q.shipper_id}`, dedupe: `qfu:${q.id}` })
      await logAuto(db, q.shipper_id, 'followup', `Followed up on your quote for ${q.ref}`, { body: text, link: `/dashboard/leads?open=${q.rid}&b=all`, ref: q.ref })
    } else {
      await notifyShipperStaff(db, q.shipper_id, { kind: 'request_update', title: `No answer yet on your ${money(Number(q.price))} quote for ${q.ref}`, body: 'A short follow-up message often wins it. Open the lead to send one.', link: `/dashboard/leads?open=${q.rid}&b=all`, dedupe: `qfu:${q.id}` }, ['owner', 'dispatcher', 'agent'])
      await logAuto(db, q.shipper_id, 'followup', `Reminded the team to follow up on ${q.ref}`, { link: `/dashboard/leads?open=${q.rid}&b=all`, ref: q.ref })
    }
  }
}

/* ============================== routes ============================== */
const zSettings = z.object({
  unpaidReminders: z.boolean(), reprice: z.enum(['off', 'review', 'auto']), repriceThresholdPct: z.number().int().min(3).max(100),
  containerFill: z.boolean(), autoLoadDays: z.number().int().min(0).max(10), fillTargetPct: z.number().int().min(50).max(100),
  pickupPlanning: z.boolean(), planHour: z.number().int().min(12).max(22), timezone: z.string().max(60).refine((t) => { try { new Intl.DateTimeFormat('en', { timeZone: t }); return true } catch { return false } }, 'Unknown time zone.'),
  dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), maxStopsPerRun: z.number().int().min(3).max(40), textWindows: z.boolean(),
  quoteFollowUp: z.enum(['off', 'remind', 'auto']), followUpHours: z.number().int().min(12).max(168), followUpMessage: z.string().trim().min(10).max(600),
  paperwork: z.boolean(), destinationCharges: z.enum(['off', 'draft', 'send']), assistant: z.boolean(),
}).partial()

export function mountAutopilot(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const managers = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers only.'); return u }
  r.get('/autopilot', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req)
    const { rows: log } = await db.query<Row>('select * from autopilot_log where shipper_id = $1 order by created_at desc limit 80', [u.shipperId])
    const { rows: wk } = await db.query<Row>(`select kind, count(*)::int as n from autopilot_log where shipper_id = $1 and created_at > now() - interval '7 days' group by kind`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ settings: await autopilotOf(db, u.shipperId!), log: log.map((l) => ({ id: l.id, kind: l.kind, title: l.title, body: l.body, link: l.link, ref: l.ref, at: ISO(l.created_at) })), week: Object.fromEntries(wk.map((x) => [x.kind, Number(x.n)])), texting: smsProvider().id !== 'off' })
  }))
  r.put('/autopilot', wrap(async (req, res) => {
    const db = await getDb(); const u = await managers(db, req); const b = zSettings.parse(req.body)
    const next = { ...(await autopilotOf(db, u.shipperId!)), ...b }
    await db.query(`insert into autopilot_settings (shipper_id,value) values ($1,$2) on conflict (shipper_id) do update set value = $2`, [u.shipperId, JSON.stringify(next)])
    res.json({ settings: next })
  }))

  /** Run every automation now (admins; also handy after changing settings). */
  r.post('/admin/autopilot/run', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (!u.admin) throw new HttpError(403, 'Admins only.')
    await sweepUnpaid(db); await sweepQuoteFollowUps(db); await (await import('./autopilotOps')).sweepOps(db)
    res.json({ ok: true })
  }))

  /* price adjustments */
  const access = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && ['owner', 'dispatcher', 'finance'].includes(u.staffRole ?? 'owner')
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const list = async (db: Db, id: string, office: boolean) => (await db.query<Row>(`select * from price_adjustments where shipment_id = $1 ${office ? '' : `and status in ('sent','approved','declined')`} order by created_at desc`, [id])).rows.map(adjustmentOut)
  r.get('/shipments/:id/adjustments', wrap(async (req, res) => { const db = await getDb(); const { s, office } = await access(db, req); res.set('Cache-Control', 'no-store'); res.json({ adjustments: await list(db, s.id, office), canEdit: office }) }))
  r.post('/shipments/:id/adjustments/:aid/:action', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req); const action = String(req.params.action)
    const { rows } = await db.query<Row>('select * from price_adjustments where id = $1 and shipment_id = $2', [String(req.params.aid), s.id]); const a = rows[0]; if (!a) throw new HttpError(404, 'Not found.')
    if (office && action === 'send') {
      if (a.status !== 'proposed') throw new HttpError(409, 'Already sent.')
      const newUsd = z.object({ newUsd: z.number().min(1).max(1_000_000).optional() }).parse(req.body ?? {}).newUsd
      if (newUsd) await db.query('update price_adjustments set new_usd = $2 where id = $1', [a.id, Math.round(newUsd)])
      await sendAdjustment(db, s, a.id)
    } else if (office && action === 'withdraw') {
      if (!['proposed', 'sent'].includes(a.status)) throw new HttpError(409, 'Already decided.')
      await db.query(`update price_adjustments set status = 'withdrawn', decided_at = now(), decided_by = $2 where id = $1`, [a.id, u.name])
    } else if (owner && (action === 'approve' || action === 'decline')) {
      if (a.status !== 'sent') throw new HttpError(409, 'This has already been decided.')
      await db.query(`update price_adjustments set status = $2, decided_at = now(), decided_by = $3 where id = $1`, [a.id, action === 'approve' ? 'approved' : 'declined', u.name])
      if (action === 'approve') await applyAdjustment(db, s, a, u.name)
      await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, '', action === 'approve' ? `Customer approved the updated price ${money(Number(a.new_usd))}.` : 'Customer declined the updated price — the shipper will be in touch.'])
      await notifyShipperStaff(db, s.shipper_id, { kind: 'payment', title: `${s.customer} ${action === 'approve' ? 'approved' : 'declined'} the new price for ${s.ref}`, body: action === 'approve' ? `${money(Number(a.new_usd))} is now due.` : 'Call them before it ships — or keep the original price.', link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `adj:${a.id}:${action}` }, ['owner', 'dispatcher', 'finance'])
      await logAuto(db, s.shipper_id, 'reprice', `${s.customer} ${action === 'approve' ? 'approved' : 'declined'} the new price for ${s.ref}`, { ref: s.ref, link: `/dashboard/shipments?q=${s.ref}&b=all` })
    } else throw new HttpError(403, 'Not allowed.')
    res.json({ adjustments: await list(db, s.id, office) })
  }))
}

export function startAutopilotSweeps(getDb: () => Promise<Db>) {
  const run = async () => {
    const db = await getDb()
    for (const [name, fn] of [['unpaid', sweepUnpaid], ['followups', sweepQuoteFollowUps]] as const) await fn(db).catch((e) => console.error(`[autopilot] ${name}`, e))
    const b = await import('./autopilotOps'); await b.sweepOps(db).catch((e) => console.error('[autopilot] ops', e))
  }
  setTimeout(() => void run(), 60_000)
  setInterval(() => void run(), 30 * 60_000).unref?.()
}
