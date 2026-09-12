/**
 * Notifications — one in-app record per user per event, mirrored to email when the user
 * wants it and an email provider is configured.
 *
 *   RESEND_API_KEY + EMAIL_FROM   send through Resend (https://resend.com)
 *   EMAIL_PROVIDER=log            print emails to the console instead (dev)
 *   otherwise                     emails are skipped; the bell still works
 *
 * Every event goes through notify() → notifications row → sendPending() picks up rows
 * whose email is still pending (immediately, and again on a 5-minute sweep so a provider
 * hiccup is retried instead of lost).
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { uid, type Db } from './db'
import type { ApiUser } from './api'
import type { ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

export const NOTIFY_KINDS = ['quote_received', 'booking_confirmed', 'shipment_status', 'quote_accepted', 'new_lead', 'container_update', 'invoice_overdue', 'system'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]
export const kindLabels: Record<NotifyKind, string> = {
  quote_received: 'New quotes', booking_confirmed: 'Booking confirmations', shipment_status: 'Shipment progress', quote_accepted: 'Quotes accepted',
  new_lead: 'New leads on your lanes', container_update: 'Container updates from the line', invoice_overdue: 'Overdue invoices', system: 'Account',
}
/** Which kinds each side can receive — drives the preferences page. */
export const kindsFor = (role: 'customer' | 'shipper'): NotifyKind[] => (role === 'customer' ? ['quote_received', 'booking_confirmed', 'shipment_status'] : ['new_lead', 'quote_accepted', 'shipment_status', 'container_update', 'invoice_overdue'])

export interface NotifyInput {
  userId: string
  kind: NotifyKind
  title: string
  body?: string
  /** In-app link (hash route, e.g. /dashboard/shipments). */
  link?: string
  /** Same key twice = one notification (e.g. a status that gets raised by two code paths). */
  dedupe?: string
  emailSubject?: string
  emailHtml?: string
}

const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
export const notificationOut = (n: Row) => ({ id: n.id, kind: n.kind as NotifyKind, title: n.title, body: n.body, link: n.link, at: ISO(n.at), readAt: ISO(n.read_at), emailStatus: n.email_status as 'pending' | 'sent' | 'skipped' | 'failed' })

/* ---------------- email transport ---------------- */
export function emailProvider(): { id: 'resend' | 'log' | 'off'; label: string } {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return { id: 'resend', label: 'Resend' }
  if ((process.env.EMAIL_PROVIDER || '').toLowerCase() === 'log') return { id: 'log', label: 'Console (dev)' }
  return { id: 'off', label: 'Not configured' }
}
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '')
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** A small branded email around a title, a paragraph and a button. */
export function emailTemplate(o: { title: string; body: string; link?: string; cta?: string; name?: string }) {
  const url = o.link ? (o.link.startsWith('http') ? o.link : `${appUrl()}/#${o.link}`) : ''
  return `<!doctype html><html><body style="margin:0;background:#0b1620;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e8eef3">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1620;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#12202b;border:1px solid #21323f;border-radius:14px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:1px solid #21323f"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E3B54A;margin-right:8px"></span><strong style="letter-spacing:.08em;font-size:13px;color:#E3B54A">SHIP SYNC</strong></td></tr>
<tr><td style="padding:28px">
${o.name ? `<p style="margin:0 0 10px;color:#9fb0bd;font-size:14px">Hi ${esc(o.name)},</p>` : ''}
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#fff">${esc(o.title)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#c9d4dc">${esc(o.body)}</p>
${url ? `<a href="${esc(url)}" style="display:inline-block;background:#E3B54A;color:#0b1620;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px;font-size:14px">${esc(o.cta || 'Open in Ship Sync')}</a>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #21323f;color:#6f8291;font-size:12px;line-height:1.5">You're receiving this because notifications are on for your Ship Sync account. Turn individual alerts off under Notifications → Preferences.</td></tr>
</table></td></tr></table></body></html>`
}

async function deliver(to: string, subject: string, html: string) {
  const p = emailProvider()
  if (p.id === 'log') { console.log(`[email → ${to}] ${subject}`); return }
  if (p.id !== 'resend') throw new Error('No email provider configured')
  const res = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

let inflight: Promise<void> | null = null
/** Send every queued email (called right after notify(), and by the sweep). Never throws; concurrent callers share one pass. */
export function sendPending(db: Db): Promise<void> {
  if (emailProvider().id === 'off') return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { rows } = await db.query<Row>(`select * from notifications where email_status = 'pending' and attempts < 5 order by at asc limit 50`)
      for (const n of rows) {
        try {
          await deliver(n.email_to, n.email_subject || n.title, n.email_html || emailTemplate({ title: n.title, body: n.body, link: n.link }))
          await db.query(`update notifications set email_status = 'sent', attempts = attempts + 1, last_error = '' where id = $1`, [n.id])
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          await db.query(`update notifications set email_status = case when attempts + 1 >= 5 then 'failed' else 'pending' end, attempts = attempts + 1, last_error = $2 where id = $1`, [n.id, msg.slice(0, 300)])
          console.error('[notify] email', n.id, msg)
        }
      }
    } catch (e) { console.error('[notify] sendPending', e) } finally { inflight = null }
  })()
  return inflight
}

/* ---------------- core ---------------- */
async function prefsOf(db: Db, userId: string) {
  const { rows } = await db.query<Row>('select * from notification_prefs where user_id = $1', [userId])
  const p = rows[0]
  const muted: string[] = p ? (typeof p.muted === 'string' ? JSON.parse(p.muted) : p.muted) : []
  return { email: p ? Boolean(p.email) : true, muted }
}

/** Record one notification for one user. Returns the id, or null when the user has muted that kind. */
export async function notify(db: Db, n: NotifyInput): Promise<string | null> {
  const { rows: us } = await db.query<Row>('select id, email, name from users where id = $1', [n.userId])
  const u = us[0]; if (!u) return null
  const prefs = await prefsOf(db, u.id)
  if (prefs.muted.includes(n.kind)) return null
  const wantEmail = prefs.email && emailProvider().id !== 'off' && Boolean(u.email)
  const id = 'nt_' + uid()
  const html = n.emailHtml ?? emailTemplate({ title: n.title, body: n.body ?? '', link: n.link, name: String(u.name || '').split(' ')[0] })
  const { rows } = await db.query<Row>(
    `insert into notifications (id,user_id,kind,title,body,link,dedupe,email_status,email_to,email_subject,email_html) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing returning id`,
    [id, u.id, n.kind, n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), n.link ?? '', n.dedupe ?? '', wantEmail ? 'pending' : 'skipped', wantEmail ? u.email : '', n.emailSubject ?? '', wantEmail ? html : ''],
  )
  if (!rows[0]) return null
  if (wantEmail) void sendPending(db)
  return id
}

/** Everyone on a shipper's team (owner + staff with logins), optionally limited to some staff roles. */
export async function notifyShipperStaff(db: Db, shipperId: string, n: Omit<NotifyInput, 'userId'>, roles?: string[]) {
  const { rows } = await db.query<Row>(
    `select u.id, coalesce(st.role, 'owner') as role from users u left join staff st on st.user_id = u.id and st.shipper_id = u.shipper_id where u.shipper_id = $1 and u.role = 'shipper'`, [shipperId])
  let count = 0
  for (const u of rows) {
    if (roles && !roles.includes(u.role)) continue
    if (await notify(db, { ...n, userId: u.id, dedupe: n.dedupe ? `${n.dedupe}:${u.id}` : undefined })) count++
  }
  return count
}

/** Customer-facing milestones. Other statuses are internal steps the customer does not need a ping for. */
const MILESTONES: Partial<Record<ShipmentStatus, { title: (s: Row) => string; body: (s: Row, note: string) => string }>> = {
  picked_up: { title: (s) => `${s.ref} picked up`, body: (s, note) => note || `Your shipment${s.description ? ` (${s.description})` : ''} has been collected and is on its way to the warehouse.` },
  in_transit: { title: (s) => `${s.ref} is on its way`, body: (s, note) => note || `Your shipment has ${s.mode === 'air' ? 'departed' : 'sailed'}${s.vessel_name ? ` on ${s.vessel_name}` : ''}. Follow it live on the tracking page.` },
  arrived: { title: (s) => `${s.ref} has arrived`, body: (s, note) => note || `Your shipment has reached the destination ${s.mode === 'air' ? 'airport' : 'port'} and is going through clearance.` },
  out_for_delivery: { title: (s) => `${s.ref} is out for delivery`, body: (_s, note) => note || 'A driver has your shipment today. Make sure someone is available to receive it.' },
  delivered: { title: (s) => `${s.ref} delivered`, body: (_s, note) => note || 'Your shipment has been handed over. Thank you for shipping with Ship Sync.' },
}

/** Tell the customer (and, for delivery, the office) that a shipment moved. Safe to call from every status-change path — dedupes per shipment+status. */
export async function notifyShipmentStatus(db: Db, s: Row, status: ShipmentStatus, note?: string, extra?: { photo?: boolean; receivedBy?: string }) {
  const m = MILESTONES[status]
  if (!m) return
  const clean = (note ?? '').replace(/\s+/g, ' ').trim()
  if (s.user_id) {
    const body = status === 'delivered' && extra?.receivedBy ? `Received by ${extra.receivedBy}.${extra.photo ? ' A proof-of-delivery photo is on the tracking page.' : ''}` : m.body(s, clean)
    await notify(db, { userId: s.user_id, kind: 'shipment_status', title: m.title(s), body, link: `/track?ref=${s.ref}`, dedupe: `ship:${s.id}:${status}`, emailSubject: m.title(s) })
  }
  if (status === 'delivered') {
    await notifyShipperStaff(db, s.shipper_id, { kind: 'shipment_status', title: `${s.ref} delivered${extra?.receivedBy ? ` to ${extra.receivedBy}` : ''}`, body: `${s.customer} · ${s.origin} → ${s.destination}.${extra?.photo ? ' POD photo attached to the scan.' : ''}`, link: `/dashboard/shipments`, dedupe: `ship:${s.id}:delivered` }, ['owner', 'dispatcher', 'agent'])
  }
}

const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

/** Invoices past due that nobody has been told about yet → one alert per invoice to the office. */
export async function sweepOverdueInvoices(db: Db) {
  const { rows } = await db.query<Row>(`select i.*, c.name as client_name from invoices i join clients c on c.id = i.client_id where i.status in ('sent','partial') and i.due_at is not null and i.due_at < current_date and i.overdue_notified_at is null`)
  for (const inv of rows) {
    const { rows: paid } = await db.query<{ n: number }>('select coalesce(sum(amount),0)::int as n from payments where invoice_id = $1', [inv.id])
    const owed = Number(inv.total) - Number(paid[0]?.n ?? 0)
    if (owed <= 0) { await db.query('update invoices set overdue_notified_at = now() where id = $1', [inv.id]); continue }
    const days = Math.max(1, Math.round((Date.now() - new Date(inv.due_at).getTime()) / 86400000))
    await notifyShipperStaff(db, inv.shipper_id, { kind: 'invoice_overdue', title: `${inv.number} is ${days} day${days === 1 ? '' : 's'} overdue`, body: `${inv.client_name} still owes ${inv.currency} ${owed.toLocaleString()} on ${inv.number} (due ${day(inv.due_at)}).`, link: `/dashboard/clients/${inv.client_id}`, dedupe: `inv:${inv.id}:overdue` }, ['owner', 'dispatcher'])
    await db.query('update invoices set overdue_notified_at = now() where id = $1', [inv.id])
  }
}

export function startNotifySweeps(getDb: () => Promise<Db>) {
  const run = async (fn: (db: Db) => Promise<void>, label: string) => { try { await fn(await getDb()) } catch (e) { console.error(`[notify] ${label}`, e) } }
  setTimeout(() => void run(sweepOverdueInvoices, 'overdue'), 20_000)
  setInterval(() => void run(sweepOverdueInvoices, 'overdue'), 6 * 3600_000)
  setInterval(() => void run(sendPending, 'email'), 5 * 60_000)
  console.log(`[notify] email via ${emailProvider().label}`)
}

/* ---------------- routes ---------------- */
const zPrefs = z.object({ email: z.boolean().optional(), muted: z.array(z.enum(NOTIFY_KINDS)).max(20).optional() })

export function mountNotifications(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  r.get('/notifications', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const { rows } = await db.query<Row>('select * from notifications where user_id = $1 order by at desc limit $2', [u.id, limit])
    const { rows: c } = await db.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [u.id])
    const prefs = await prefsOf(db, u.id)
    res.set('Cache-Control', 'no-store')
    res.json({ notifications: rows.map(notificationOut), unread: c[0].n, prefs, kinds: kindsFor(u.role).map((k) => ({ id: k, label: kindLabels[k] })), email: { provider: emailProvider().id, to: u.email } })
  }))
  r.post('/notifications/read', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const ids = z.object({ ids: z.array(z.string()).max(500).optional() }).parse(req.body ?? {}).ids
    if (ids?.length) await db.query('update notifications set read_at = coalesce(read_at, now()) where user_id = $1 and id = any($2::text[])', [u.id, ids])
    else await db.query('update notifications set read_at = coalesce(read_at, now()) where user_id = $1 and read_at is null', [u.id])
    const { rows: c } = await db.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [u.id])
    res.json({ ok: true, unread: c[0].n })
  }))
  r.delete('/notifications/:id', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    await db.query('delete from notifications where id = $1 and user_id = $2', [req.params.id, u.id])
    res.json({ ok: true })
  }))
  r.patch('/notifications/prefs', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const b = zPrefs.parse(req.body)
    const cur = await prefsOf(db, u.id)
    const next = { email: b.email ?? cur.email, muted: b.muted ?? cur.muted }
    await db.query('insert into notification_prefs (user_id,email,muted,updated_at) values ($1,$2,$3,now()) on conflict (user_id) do update set email = excluded.email, muted = excluded.muted, updated_at = now()', [u.id, next.email, JSON.stringify(next.muted)])
    res.json({ prefs: next })
  }))
  /** Send yourself a test so the email setup can be checked without waiting for a real event. */
  r.post('/notifications/test', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (emailProvider().id === 'off') throw new HttpError(400, 'No email provider is configured. Set RESEND_API_KEY and EMAIL_FROM.')
    const id = await notify(db, { userId: u.id, kind: 'system', title: 'Test notification', body: 'If you can read this in your inbox, email alerts are working.', link: '/dashboard/notifications' })
    if (!id) throw new HttpError(409, 'Nothing sent — check your preferences.')
    await sendPending(db); await sendPending(db)
    const { rows } = await db.query<Row>('select * from notifications where id = $1', [id])
    res.json({ notification: notificationOut(rows[0]), error: rows[0].last_error || undefined })
  }))
}
