/**
 * The request side of the marketplace — from "I need a price" to a booked shipment.
 *
 *   Customer   PATCH /requests/:id (edit details; quoted shippers are told) · POST /requests/:id/cancel
 *              POST /requests/:id/open-market (a "chose one shipper" request nobody answered → every matching shipper)
 *   Shipper    POST /quotes/:id/withdraw
 *   Both       GET|POST /requests/:id/messages — one thread per request × shipper. Before booking, emails and phone
 *              numbers are stripped so the deal (and its protection) stays on Ship Sync.
 *   Sweeps     quotes past valid-until → expired (shipper told) · quotes 2 days from expiry → client reminded
 *              requests past expires_at → expired (client + quoting shippers told) · no quotes after 24 h → client told
 *              (one-shipper requests are offered the open marketplace) · leads unanswered past a shipper's usual reply time → one reminder
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'

type Row = Record<string, any>
type ReqOut = { id: string; ref: string; contact: { name: string; email: string; phone: string }; source?: string; preferredShipperId?: string; quotes: { shipperId: string; status: string }[] } & Record<string, unknown>
export interface RequestFlowDeps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
  loadRequests: (db: Db, where: string, params: unknown[]) => Promise<ReqOut[]>
  /** Instant quotes from rate cards + alerts to matching shippers — what a fresh marketplace request gets. */
  announce: (db: Db, row: Row) => Promise<void>
  /** Shippers who should see this lead (eligible + local), for reply reminders. */
  leadShippers: (db: Db, row: Row) => Promise<{ id: string; responseHours: number }[]>
}
const DATE = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const today = () => new Date().toISOString().slice(0, 10)
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** Strip ways to take the conversation off-platform until there's a booking. */
export function maskContacts(text: string) {
  let masked = false
  const out = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => { masked = true; return '[email hidden until booking]' })
    .replace(/(?:\+|00)?\d[\d\s().-]{7,}\d/g, (m) => { if (m.replace(/\D/g, '').length < 8) return m; masked = true; return '[number hidden until booking]' })
    .replace(/\b(?:wa\.me|whatsapp\.com|t\.me)\/\S+/gi, () => { masked = true; return '[link hidden until booking]' })
  return { text: out, masked }
}

export function mountRequestFlow(r: Router, d: RequestFlowDeps) {
  const { getDb, requireUser, HttpError, wrap, loadRequests, announce } = d
  const ownRequest = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from requests where id = $1', [req.params.id]); const r0 = rows[0]
    if (!r0 || r0.user_id !== u.id) throw new HttpError(404, 'Request not found.')
    return { u, r0 }
  }
  const quotedShippers = async (db: Db, requestId: string, statuses = ['sent']) => (await db.query<Row>('select shipper_id from quotes where request_id = $1 and status = any($2::text[])', [requestId, statuses])).rows.map((x) => x.shipper_id as string)
  const fresh = async (db: Db, id: string) => (await loadRequests(db, 'id = $1', [id]))[0]

  /* ---- 4 · edit / cancel ---- */
  const zEdit = z.object({
    readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), quantity: z.number().int().min(1).max(5000).optional(), weightKg: z.number().int().min(0).max(100000).nullable().optional(),
    dims: z.string().trim().max(80).optional(), declaredValueUsd: z.number().min(0).max(5_000_000).nullable().optional(), description: z.string().max(2000).optional(),
    pickup: z.boolean().optional(), delivery: z.boolean().optional(), insurance: z.boolean().optional(),
    contact: z.object({ phone: z.string().trim().min(7).max(30) }).optional(),
  })
  r.patch('/requests/:id', wrap(async (req, res) => {
    const db = await getDb(); const { r0 } = await ownRequest(db, req)
    if (r0.status !== 'open') throw new HttpError(409, 'Only open requests can be changed.')
    const b = zEdit.parse(req.body)
    if (b.readyDate && b.readyDate < today()) throw new HttpError(400, 'The ready date is in the past.')
    const changed: string[] = []
    const set: Record<string, unknown> = {}
    const add = (col: string, val: unknown, label: string) => { const before = col === 'ready_date' ? DATE(r0[col]) : r0[col]; if (val !== undefined && String(val ?? '') !== String(before ?? '')) { set[col] = val; changed.push(label) } }
    add('ready_date', b.readyDate, `ready date ${b.readyDate ? fmtDay(b.readyDate) : ''}`); add('quantity', b.quantity, `${b.quantity} pieces`); add('weight_kg', b.weightKg, b.weightKg ? `${b.weightKg} kg` : 'weight removed')
    add('dims', b.dims, 'dimensions'); add('declared_value_usd', b.declaredValueUsd, 'declared value'); add('description', b.description, 'description')
    add('pickup', b.pickup, b.pickup ? 'pickup wanted' : 'no pickup'); add('delivery', b.delivery, b.delivery ? 'door delivery wanted' : 'recipient collects'); add('insurance', b.insurance, b.insurance ? 'insurance wanted' : 'no insurance')
    if (b.contact?.phone) add('contact_phone', b.contact.phone, 'phone')
    if (!changed.length) return res.json({ request: await fresh(db, r0.id), changed })
    const keys = Object.keys(set)
    await db.query(`update requests set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), expires_at = least(coalesce($${keys.length + 2}::date, ready_date) + 14, created_at::date + 45) where id = $1`, [r0.id, ...keys.map((k) => set[k]), b.readyDate ?? null])
    const material = changed.filter((c) => c !== 'phone' && c !== 'description')
    if (material.length) for (const sid of await quotedShippers(db, r0.id)) await notifyShipperStaff(db, sid, { kind: 'request_update', title: `${r0.ref} changed — check your quote`, body: `The client updated: ${material.join(', ')}. Your quote still stands unless you send a new one.`, link: `/dashboard/leads?open=${r0.id}&b=all`, dedupe: `edit:${r0.id}:${Date.now()}` }, ['owner', 'dispatcher', 'agent'])
    res.json({ request: await fresh(db, r0.id), changed })
  }))
  r.post('/requests/:id/cancel', wrap(async (req, res) => {
    const db = await getDb(); const { r0 } = await ownRequest(db, req)
    if (r0.status !== 'open') throw new HttpError(409, r0.status === 'booked' ? 'It’s already booked — cancel the shipment with your shipper instead.' : `This request is already ${r0.status}.`)
    const b = z.object({ reason: z.string().trim().max(200).default('') }).parse(req.body ?? {})
    const sids = await quotedShippers(db, r0.id)
    await db.query(`update requests set status = 'cancelled', cancelled_at = now(), cancel_reason = $2 where id = $1`, [r0.id, b.reason])
    await db.query(`update quotes set status = 'declined' where request_id = $1 and status = 'sent'`, [r0.id])
    for (const sid of sids) await notifyShipperStaff(db, sid, { kind: 'request_update', title: `${r0.ref} was cancelled by the client`, body: b.reason || 'No reason given. Nothing to do on your side.', link: `/dashboard/leads?b=lost`, dedupe: `cancel:${r0.id}` }, ['owner', 'dispatcher', 'agent'])
    res.json({ request: await fresh(db, r0.id) })
  }))

  /* ---- 7 · one-shipper request → open marketplace ---- */
  r.post('/requests/:id/open-market', wrap(async (req, res) => {
    const db = await getDb(); const { r0 } = await ownRequest(db, req)
    if (r0.status !== 'open' || !r0.preferred_shipper_id) throw new HttpError(409, 'This request is already open to every matching shipper.')
    const { rows: sh } = await db.query<Row>('select name from shippers where id = $1', [r0.preferred_shipper_id])
    await db.query(`update requests set preferred_shipper_id = null, source = 'marketplace', opened_to_market_at = now() where id = $1`, [r0.id])
    const { rows } = await db.query<Row>('select * from requests where id = $1', [r0.id])
    await announce(db, rows[0])
    const had = await quotedShippers(db, r0.id)
    const quotedFirst = had.includes(r0.preferred_shipper_id)
    await notifyShipperStaff(db, r0.preferred_shipper_id, { kind: 'request_update', title: `${r0.ref} went to other shippers`, body: quotedFirst ? 'The client asked you first and has now opened it to every matching shipper to compare prices. Your quote still stands.' : 'The client asked you first but didn’t hear back, so it’s now open to every matching shipper. You can still quote it.', link: `/dashboard/leads?open=${r0.id}&b=all`, dedupe: `market:${r0.id}` }, ['owner', 'dispatcher'])
    res.json({ request: await fresh(db, r0.id), from: sh[0]?.name ?? '' })
  }))

  /* ---- 5 · withdraw a quote ---- */
  r.post('/quotes/:id/withdraw', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select q.*, r.user_id as owner, r.ref from quotes q join requests r on r.id = q.request_id where q.id = $1', [req.params.id]); const q = rows[0]
    if (!q || u.role !== 'shipper' || q.shipper_id !== u.shipperId || u.staffRole === 'driver') throw new HttpError(404, 'Quote not found.')
    if (q.status !== 'sent') throw new HttpError(409, q.status === 'accepted' ? 'It’s already accepted — cancel the shipment instead.' : 'This quote is no longer live.')
    const b = z.object({ reason: z.string().trim().max(200).default('') }).parse(req.body ?? {})
    await db.query(`update quotes set status = 'withdrawn', updated_at = now() where id = $1`, [q.id])
    await notify(db, { userId: q.owner, kind: 'request_update', title: `${u.company ?? 'A shipper'} withdrew their quote on ${q.ref}`, body: b.reason || 'Their price is no longer available. Your other quotes are unaffected.', link: '/dashboard', dedupe: `wd:${q.id}` })
    res.json({ ok: true })
  }))

  /* ---- 11 · message thread (request × shipper) ---- */
  const threadAccess = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from requests where id = $1', [req.params.id]); const r0 = rows[0]; if (!r0) throw new HttpError(404, 'Request not found.')
    let shipperId: string
    if (u.role === 'customer') { if (r0.user_id !== u.id) throw new HttpError(404, 'Request not found.'); shipperId = String(req.query.shipperId ?? req.body?.shipperId ?? ''); if (!shipperId) throw new HttpError(400, 'Which shipper?') }
    else { if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.'); shipperId = u.shipperId; if (r0.preferred_shipper_id && r0.preferred_shipper_id !== shipperId) throw new HttpError(403, 'This client asked another shipper.') }
    const { rows: q } = await db.query<Row>('select status from quotes where request_id = $1 and shipper_id = $2', [r0.id, shipperId])
    if (u.role === 'customer' && !q[0] && r0.preferred_shipper_id !== shipperId) throw new HttpError(403, 'You can message shippers who quoted your request.')
    const booked = q[0]?.status === 'accepted'
    return { u, r0, shipperId, booked, role: u.role === 'customer' ? 'customer' as const : 'shipper' as const }
  }
  const msgOut = (m: Row) => ({ id: m.id, from: m.author_role as 'customer' | 'shipper', name: m.author_name, body: m.body, masked: !!m.masked, at: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at), read: !!m.read_at })
  r.get('/requests/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { r0, shipperId, role, booked } = await threadAccess(db, req)
    const { rows } = await db.query<Row>('select * from request_messages where request_id = $1 and shipper_id = $2 order by created_at', [r0.id, shipperId])
    await db.query('update request_messages set read_at = now() where request_id = $1 and shipper_id = $2 and author_role <> $3 and read_at is null', [r0.id, shipperId, role])
    res.json({ messages: rows.map(msgOut), contactsShared: booked })
  }))
  r.post('/requests/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { u, r0, shipperId, role, booked } = await threadAccess(db, req)
    if (r0.status === 'cancelled' || r0.status === 'expired') throw new HttpError(409, `This request is ${r0.status}.`)
    const b = z.object({ body: z.string().trim().min(1, 'Write a message.').max(1500) }).parse(req.body)
    const m = booked ? { text: b.body, masked: false } : maskContacts(b.body)
    const id = 'rm_' + uid()
    const name = role === 'customer' ? r0.contact_name.split(' ')[0] : (u.company ?? u.name)
    await db.query('insert into request_messages (id,request_id,shipper_id,author_role,author_name,body,masked) values ($1,$2,$3,$4,$5,$6,$7)', [id, r0.id, shipperId, role, name, m.text, m.masked])
    const preview = m.text.length > 140 ? m.text.slice(0, 137) + '…' : m.text
    if (role === 'customer') await notifyShipperStaff(db, shipperId, { kind: 'request_update', title: `Message on ${r0.ref} from ${name}`, body: preview, link: `/dashboard/leads?open=${r0.id}&b=all`, dedupe: `msg:${id}` }, ['owner', 'dispatcher', 'agent'])
    else await notify(db, { userId: r0.user_id, kind: 'request_update', title: `${name} replied about ${r0.ref}`, body: preview, link: `/dashboard?open=${r0.id}&thread=${shipperId}`, dedupe: `msg:${id}` })
    const { rows } = await db.query<Row>('select * from request_messages where id = $1', [id])
    res.status(201).json({ message: msgOut(rows[0]) })
  }))
}

/* ---------------- sweeps (2, 3, 7, 14) ---------------- */

export async function sweepRequests(db: Db, d: Pick<RequestFlowDeps, 'leadShippers'>) {
  // Quotes past their date → expired; the shipper can re-quote with a fresh price.
  const { rows: exp } = await db.query<Row>(`update quotes q set status = 'expired' from requests r where r.id = q.request_id and q.status = 'sent' and q.valid_until < current_date and r.status = 'open' returning q.*, r.ref, r.id as rid`)
  for (const q of exp) await notifyShipperStaff(db, q.shipper_id, { kind: 'request_update', title: `Your quote on ${q.ref} expired`, body: 'The client hasn’t booked yet. Send a fresh price to stay in the running.', link: `/dashboard/leads?open=${q.rid}&b=all`, dedupe: `qexp:${q.id}` }, ['owner', 'dispatcher', 'agent'])
  // Quotes 2 days from expiry → remind the client once.
  const { rows: soon } = await db.query<Row>(`select q.*, r.user_id, r.ref, s.name as shipper_name from quotes q join requests r on r.id = q.request_id join shippers s on s.id = q.shipper_id where q.status = 'sent' and r.status = 'open' and q.expiry_reminded_at is null and q.valid_until between current_date and current_date + 2`)
  for (const q of soon) {
    await db.query('update quotes set expiry_reminded_at = now() where id = $1', [q.id])
    await notify(db, { userId: q.user_id, kind: 'request_update', title: `${q.shipper_name}’s $${Number(q.price).toLocaleString()} quote on ${q.ref} ends ${fmtDay(DATE(q.valid_until))}`, body: 'Book before then to lock the price, or message them if you need more time.', link: '/dashboard', dedupe: `qsoon:${q.id}` })
  }
  // Requests past their window → expired; tell the client and anyone who quoted.
  const { rows: rx } = await db.query<Row>(`update requests set status = 'expired' where status = 'open' and expires_at is not null and expires_at < now() returning *`)
  for (const r0 of rx) {
    const { rows: qs } = await db.query<Row>(`update quotes set status = 'expired' where request_id = $1 and status = 'sent' returning shipper_id`, [r0.id])
    await notify(db, { userId: r0.user_id, kind: 'request_update', title: `${r0.ref} closed without a booking`, body: `Its ready date has passed. Still shipping? Post it again in one tap — we’ll keep your details.`, link: `/quote?again=${r0.id}`, dedupe: `rexp:${r0.id}` })
    for (const q of qs) await notifyShipperStaff(db, q.shipper_id, { kind: 'quote_lost', title: `${r0.ref} closed without a booking`, body: 'The client didn’t book any quote before the request expired.', link: '/dashboard/leads?b=lost', dedupe: `rexp:${r0.id}:${q.shipper_id}` }, ['owner', 'dispatcher'])
  }
  // No quotes after a day → tell the client (one-shipper requests get the marketplace offer).
  const { rows: quiet } = await db.query<Row>(`select r.*, s.name as preferred_name from requests r left join shippers s on s.id = r.preferred_shipper_id where r.status = 'open' and r.no_quote_notified_at is null and r.created_at < now() - interval '24 hours' and not exists (select 1 from quotes q where q.request_id = r.id and q.status = 'sent')`)
  for (const r0 of quiet) {
    await db.query('update requests set no_quote_notified_at = now() where id = $1', [r0.id])
    if (r0.preferred_shipper_id && r0.source === 'picked') await notify(db, { userId: r0.user_id, kind: 'request_update', title: `${r0.preferred_name ?? 'The shipper'} hasn’t replied on ${r0.ref}`, body: 'Open it to every matching shipper and get more prices — one tap, your details stay the same.', link: `/dashboard?open=${r0.id}&market=1`, dedupe: `quiet:${r0.id}` })
    else if (!r0.preferred_shipper_id) await notify(db, { userId: r0.user_id, kind: 'request_update', title: `No quotes yet on ${r0.ref}`, body: 'We’ve reminded shippers on this lane. Adding weight, dimensions or a flexible ready date helps them price it.', link: `/dashboard?open=${r0.id}`, dedupe: `quiet:${r0.id}` })
  }
  // Leads unanswered past the shipper's usual reply time → one reminder each (dedupe keeps it to one).
  const { rows: open } = await db.query<Row>(`select * from requests where status = 'open' and created_at > now() - interval '7 days' and created_at < now() - interval '6 hours'`)
  for (const r0 of open) {
    const ageH = (Date.now() - new Date(r0.created_at).getTime()) / 3600_000
    const quoted = new Set((await db.query<Row>('select shipper_id from quotes where request_id = $1', [r0.id])).rows.map((x) => x.shipper_id))
    for (const s of await d.leadShippers(db, r0)) {
      if (quoted.has(s.id) || ageH < Math.max(6, s.responseHours)) continue
      await notifyShipperStaff(db, s.id, { kind: 'new_lead', title: `Still waiting for your price — ${r0.ref}`, body: `${r0.quantity} × ${r0.cargo}, ${r0.origin} → ${r0.destination}, ready ${fmtDay(DATE(r0.ready_date))}. Clients see your reply time on your profile.`, link: `/dashboard/leads?open=${r0.id}`, dedupe: `nudge:${r0.id}:${s.id}` }, ['owner', 'dispatcher', 'agent'])
    }
  }
}
export function startRequestSweeps(getDb: () => Promise<Db>, d: Pick<RequestFlowDeps, 'leadShippers'>) {
  const run = () => void getDb().then((db) => sweepRequests(db, d)).catch((e) => console.error('[requests] sweep', e))
  setInterval(run, 30 * 60_000); setTimeout(run, 30_000)
}
