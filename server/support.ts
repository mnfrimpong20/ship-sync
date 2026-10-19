/**
 * Customer support: tickets with a conversation, for customers, shippers and anyone who used the contact form.
 *
 *   Signed-in people open tickets from /support (optionally about one of their shipments); contact-form
 *   messages become tickets too, answered by email. Ntemtem staff (admins) reply, add internal notes, set the
 *   status (open → waiting on customer → solved) and see how long each has waited for a first answer.
 *   A reply from the person reopens a solved ticket.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, emailProvider, emailTemplate, sendEmail } from './notify'

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
export const TICKET_CATEGORIES = ['shipment', 'payment', 'account', 'shipper', 'damage', 'other'] as const
const makeRef = () => 'T-' + Math.random().toString(36).slice(2, 8).toUpperCase()

const ticketOut = (t: Row) => ({ id: t.id, ref: t.ref, subject: t.subject, category: t.category, status: t.status as 'open' | 'waiting' | 'solved', priority: t.priority as 'normal' | 'high', shipmentRef: t.shipment_ref ?? '', name: t.name, email: t.email, role: t.role, source: t.source as 'app' | 'contact', assignedTo: t.assigned_to ?? '', createdAt: ISO(t.created_at), updatedAt: ISO(t.updated_at), firstResponseAt: ISO(t.first_response_at), lastFrom: t.last_from as 'person' | 'staff', messages: t.messages != null ? Number(t.messages) : undefined })
const msgOut = (m: Row, staffView: boolean) => ({ id: m.id, body: m.body, fromStaff: !!m.from_staff, authorName: m.from_staff && !staffView ? 'Ntemtem support' : m.author_name, internal: !!m.internal, at: ISO(m.created_at) })

async function adminsNotify(db: Db, title: string, body: string, link: string, dedupe: string) {
  const { rows } = await db.query<Row>('select id from users where is_admin')
  for (const a of rows) await notify(db, { userId: a.id, kind: 'system', title, body, link, dedupe: `${dedupe}:${a.id}` })
}

/** Contact-form messages become tickets so nothing lives only in an inbox. */
export async function ticketFromContact(db: Db, c: { name: string; email: string; topic: string; message: string; contactId: string }) {
  const id = 'tk_' + uid(); const ref = makeRef()
  const category = c.topic === 'tracking' ? 'shipment' : c.topic === 'shipper' ? 'shipper' : 'other'
  await db.query(`insert into support_tickets (id,ref,user_id,name,email,role,subject,category,source,status,last_from) values ($1,$2,null,$3,$4,'guest',$5,$6,'contact','open','person')`, [id, ref, c.name, c.email, `${c.topic[0].toUpperCase()}${c.topic.slice(1)} enquiry`, category])
  await db.query(`insert into support_messages (id,ticket_id,author_name,from_staff,body) values ($1,$2,$3,false,$4)`, ['sm_' + uid(), id, c.name, c.message])
  await adminsNotify(db, `New support ticket ${ref} from ${c.name}`, c.message.slice(0, 200), `/admin?view=tickets&t=${id}`, `tk:${id}`)
  return { id, ref }
}

const zNew = z.object({ subject: z.string().trim().min(4, 'Give it a short subject.').max(120), category: z.enum(TICKET_CATEGORIES).default('other'), shipmentRef: z.string().trim().max(20).default(''), body: z.string().trim().min(10, 'Tell us a little more (10+ characters).').max(4000) })
const zReply = z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false), status: z.enum(['open', 'waiting', 'solved']).optional() })

export function mountSupport(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const mine = async (db: Db, req: Request) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from support_tickets where id = $1', [String(req.params.id)]); const t = rows[0]
    if (!t || (t.user_id !== u.id && !u.admin)) throw new HttpError(404, 'Ticket not found.')
    return { u, t }
  }
  const thread = async (db: Db, id: string, staffView: boolean) => (await db.query<Row>(`select * from support_messages where ticket_id = $1 ${staffView ? '' : 'and not internal'} order by created_at`, [id])).rows.map((m) => msgOut(m, staffView))

  r.get('/support/tickets', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`select t.*, (select count(*) from support_messages m where m.ticket_id = t.id and not m.internal)::int as messages from support_tickets t where t.user_id = $1 order by t.updated_at desc limit 100`, [u.id])
    res.set('Cache-Control', 'no-store'); res.json({ tickets: rows.map(ticketOut) })
  }))
  r.post('/support/tickets', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const b = zNew.parse(req.body)
    const { rows: open } = await db.query<Row>(`select count(*)::int as n from support_tickets where user_id = $1 and status <> 'solved'`, [u.id]); if (Number(open[0].n) >= 10) throw new HttpError(429, 'You have 10 open tickets — we’ll get to them; add to an existing one instead.')
    let shipmentRef = b.shipmentRef.toUpperCase()
    if (shipmentRef) { const { rows } = await db.query<Row>(`select ref from shipments where ref = $1 and (user_id = $2 or shipper_id = $3)`, [shipmentRef, u.id, u.shipperId ?? '']); if (!rows[0]) throw new HttpError(400, 'That shipment reference isn’t on your account.') }
    const { rows: us } = await db.query<Row>('select email from users where id = $1', [u.id])
    const id = 'tk_' + uid(); const ref = makeRef()
    const priority = b.category === 'damage' || b.category === 'payment' ? 'high' : 'normal'
    await db.query(`insert into support_tickets (id,ref,user_id,name,email,role,subject,category,shipment_ref,priority,source,status,last_from) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'app','open','person')`, [id, ref, u.id, u.name, us[0]?.email ?? '', u.role, b.subject, b.category, shipmentRef, priority])
    await db.query(`insert into support_messages (id,ticket_id,author_id,author_name,from_staff,body) values ($1,$2,$3,$4,false,$5)`, ['sm_' + uid(), id, u.id, u.name, b.body])
    await adminsNotify(db, `New support ticket ${ref}: ${b.subject}`, `${u.name}${shipmentRef ? ` · ${shipmentRef}` : ''} — ${b.body.slice(0, 160)}`, `/admin?view=tickets&t=${id}`, `tk:${id}`)
    res.status(201).json({ ticket: ticketOut({ id, ref, subject: b.subject, category: b.category, status: 'open', priority, shipment_ref: shipmentRef, name: u.name, role: u.role, source: 'app', last_from: 'person', created_at: new Date(), updated_at: new Date() }) })
  }))
  r.get('/support/tickets/:id', wrap(async (req, res) => {
    const db = await getDb(); const { u, t } = await mine(db, req)
    const staffView = !!u.admin && t.user_id !== u.id
    res.set('Cache-Control', 'no-store'); res.json({ ticket: ticketOut(t), messages: await thread(db, t.id, staffView) })
  }))
  r.post('/support/tickets/:id/messages', wrap(async (req, res) => {
    const db = await getDb(); const { u, t } = await mine(db, req); const b = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body)
    await db.query(`insert into support_messages (id,ticket_id,author_id,author_name,from_staff,body) values ($1,$2,$3,$4,false,$5)`, ['sm_' + uid(), t.id, u.id, u.name, b.body])
    await db.query(`update support_tickets set status = 'open', last_from = 'person', updated_at = now() where id = $1`, [t.id])
    await adminsNotify(db, `${u.name} replied on ${t.ref}`, b.body.slice(0, 200), `/admin?view=tickets&t=${t.id}`, `tkr:${t.id}:${Date.now()}`)
    res.status(201).json({ messages: await thread(db, t.id, false) })
  }))
  r.post('/support/tickets/:id/solved', wrap(async (req, res) => {
    const db = await getDb(); const { t } = await mine(db, req)
    await db.query(`update support_tickets set status = 'solved', updated_at = now() where id = $1`, [t.id]); res.json({ ok: true })
  }))

  /* ---- staff ---- */
  r.get('/admin/tickets', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const status = String(req.query.status ?? 'active')
    const where = status === 'all' ? '' : status === 'solved' ? `where t.status = 'solved'` : `where t.status <> 'solved'`
    const { rows } = await db.query<Row>(`select t.*, (select count(*) from support_messages m where m.ticket_id = t.id and not m.internal)::int as messages from support_tickets t ${where} order by (t.status = 'open' and t.last_from = 'person') desc, (t.priority = 'high') desc, t.updated_at asc limit 300`)
    const { rows: st } = await db.query<Row>(`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'waiting')::int as waiting, count(*) filter (where status = 'solved' and updated_at > now() - interval '7 days')::int as solved7, coalesce(round(avg(extract(epoch from (first_response_at - created_at)) / 3600) filter (where first_response_at is not null and created_at > now() - interval '30 days'))::int, 0) as frt_hours from support_tickets`)
    res.set('Cache-Control', 'no-store'); res.json({ tickets: rows.map(ticketOut), stats: { open: st[0].open, waiting: st[0].waiting, solved7: st[0].solved7, firstResponseHours: Number(st[0].frt_hours) } })
  }))
  r.get('/admin/tickets/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>('select * from support_tickets where id = $1', [String(req.params.id)]); if (!rows[0]) throw new HttpError(404, 'Ticket not found.')
    const t = rows[0]
    const { rows: ships } = t.user_id ? await db.query<Row>(`select ref, status, origin, destination from shipments where user_id = $1 order by created_at desc limit 5`, [t.user_id]) : { rows: [] as Row[] }
    res.set('Cache-Control', 'no-store'); res.json({ ticket: ticketOut(t), messages: await thread(db, t.id, true), recentShipments: ships })
  }))
  r.post('/admin/tickets/:id/reply', wrap(async (req, res) => {
    const db = await getDb(); const a = await requireAdmin(db, req); const b = zReply.parse(req.body)
    const { rows } = await db.query<Row>('select * from support_tickets where id = $1', [String(req.params.id)]); const t = rows[0]; if (!t) throw new HttpError(404, 'Ticket not found.')
    await db.query(`insert into support_messages (id,ticket_id,author_id,author_name,from_staff,internal,body) values ($1,$2,$3,$4,true,$5,$6)`, ['sm_' + uid(), t.id, a.id, a.name, b.internal, b.body])
    const status = b.status ?? (b.internal ? t.status : 'waiting')
    await db.query(`update support_tickets set status = $2, ${b.internal ? '' : `last_from = 'staff', first_response_at = coalesce(first_response_at, now()),`} assigned_to = coalesce(nullif(assigned_to, ''), $3), updated_at = now() where id = $1`, [t.id, status, a.name])
    if (!b.internal) {
      if (t.user_id) await notify(db, { userId: t.user_id, kind: 'system', title: `Ntemtem support replied on ${t.ref}`, body: b.body.slice(0, 300), link: `/support?t=${t.id}`, dedupe: `tka:${t.id}:${Date.now()}` })
      else if (t.email && emailProvider().id !== 'off') await sendEmail(t.email, `Re: ${t.subject} [${t.ref}]`, emailTemplate({ title: t.subject, body: `${b.body}\n\n— Ntemtem support\nReply to this email or write to us again at ${appUrl()}/contact and quote ${t.ref}.`, name: String(t.name).split(' ')[0] })).catch((e) => console.error('[support] email', e))
    }
    const { rows: now } = await db.query<Row>('select * from support_tickets where id = $1', [t.id])
    res.status(201).json({ ticket: ticketOut(now[0]), messages: await thread(db, t.id, true) })
  }))
  r.patch('/admin/tickets/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = z.object({ status: z.enum(['open', 'waiting', 'solved']).optional(), priority: z.enum(['normal', 'high']).optional(), assignedTo: z.string().trim().max(80).optional() }).parse(req.body)
    await db.query(`update support_tickets set status = coalesce($2, status), priority = coalesce($3, priority), assigned_to = coalesce($4, assigned_to), updated_at = now() where id = $1`, [String(req.params.id), b.status ?? null, b.priority ?? null, b.assignedTo ?? null])
    res.json({ ok: true })
  }))
}
