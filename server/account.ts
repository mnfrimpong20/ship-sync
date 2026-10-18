/**
 * Customer account: the overview summary (counts for the home page and menu badges, getting-started
 * checklist), profile & security (name, phone, password, signed-in devices) and the data rights
 * (download everything, delete the account).
 *
 *   GET    /me/summary                  owe · unread · open requests · quotes waiting · due per shipment · checklist
 *   GET    /me/profile   PATCH /me/profile { name, phone }
 *   POST   /me/password                 { current, next } — signs out every other device
 *   GET    /me/sessions                 devices signed in (current flagged)
 *   DELETE /me/sessions/:key            sign one out · POST /me/sessions/revoke-others
 *   GET    /me/export                   JSON download of the customer's data
 *   POST   /me/delete                   { password, confirm: 'DELETE' } — refused while goods or money are in flight
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'
import { creditBalance, myInvoices } from './customerHub'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const keyOf = (sid: string) => createHash('sha256').update(sid).digest('hex').slice(0, 16)
/** "Chrome on Windows" from a user-agent string — good enough to recognise your own devices. */
export function deviceName(ua: string) {
  if (!ua) return 'Unknown device'
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici|axios/i.test(ua) ? 'App / script' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${b} on ${os}` : b
}
const ACTIVE = `status not in ('delivered','cancelled') and cancelled_at is null`

export function mountAccount(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const customer = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'customer') throw new HttpError(403, 'Customer accounts only.'); return u }
  const self = (u: ApiUser) => (u.actingBy ? u.actingBy.id : u.id)

  /* ---------- overview summary ---------- */
  r.get('/me/summary', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req)
    const inv = await myInvoices(db, u.id); const open = inv.filter((i) => i.balance > 0); const now = Date.now()
    const dueByShipment: Record<string, number> = {}
    for (const i of open) if (i.shipment_id) dueByShipment[i.shipment_id] = Math.round(((dueByShipment[i.shipment_id] ?? 0) + i.balance) * 100) / 100
    const { rows: [c] } = await db.query<Row>(`select
      (select count(*) from requests where user_id = $1 and status = 'open')::int as open_requests,
      (select count(*) from quotes q join requests r2 on r2.id = q.request_id where r2.user_id = $1 and r2.status = 'open' and q.status = 'sent')::int as quotes_waiting,
      (select count(*) from shipments where user_id = $1 and ${ACTIVE})::int as active,
      (select count(*) from shipments where user_id = $1 and status = 'delivered')::int as delivered,
      (select count(*) from request_messages m join requests r3 on r3.id = m.request_id where r3.user_id = $1 and m.author_role = 'shipper' and m.read_at is null)::int as unread_pre,
      (select count(*) from shipment_messages m join shipments s on s.id = m.shipment_id where s.user_id = $1 and m.author_role = 'office' and not m.read_by_customer)::int as unread_post,
      (select count(*) from requests where user_id = $1)::int as requests_ever,
      (select count(*) from customer_consignees where user_id = $1)::int as recipients,
      (select count(*) from account_members where owner_id = $1)::int as members,
      (select phone from users where id = $1) as phone,
      (select coalesce(text_channel, 'off') from notification_prefs where user_id = $1) as text_channel,
      (select phone from notification_prefs where user_id = $1) as text_phone,
      (select contact_phone from requests where user_id = $1 and contact_phone <> '' order by created_at desc limit 1) as req_phone`, [u.id])
    const checklist = [
      { id: 'phone', label: 'Add your mobile number', done: !!(c.phone || c.text_phone || c.req_phone), link: '/dashboard?tab=account&section=profile' },
      { id: 'recipient', label: 'Save who receives your goods', done: Number(c.recipients) > 0, link: '/dashboard?tab=recipients' },
      { id: 'request', label: 'Post your first shipment request', done: Number(c.requests_ever) > 0, link: '/quote' },
      { id: 'alerts', label: 'Get updates on WhatsApp or SMS', done: !!c.text_channel && c.text_channel !== 'off', link: '/dashboard?tab=account&section=alerts' },
      { id: 'family', label: 'Invite family to follow along', done: Number(c.members) > 0, link: '/dashboard?tab=account&section=family' },
    ]
    res.set('Cache-Control', 'no-store')
    res.json({
      owe: Math.round(open.reduce((a, i) => a + i.balance, 0) * 100) / 100, overdue: Math.round(open.filter((i) => i.due_at && new Date(i.due_at).getTime() < now).reduce((a, i) => a + i.balance, 0) * 100) / 100,
      credit: await creditBalance(db, u.id), unread: Number(c.unread_pre) + Number(c.unread_post), openRequests: Number(c.open_requests), quotesWaiting: Number(c.quotes_waiting),
      activeShipments: Number(c.active), delivered: Number(c.delivered), dueByShipment, checklist, checklistDone: checklist.filter((x) => x.done).length,
    })
  }))

  /* ---------- profile ---------- */
  r.get('/me/profile', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows: [p] } = await db.query<Row>('select name, email, phone, created_at from users where id = $1', [self(u)])
    res.json({ name: p.name, email: p.email, phone: p.phone ?? '', createdAt: ISO(p.created_at), actingFor: u.actingBy ? u.name : null })
  }))
  r.patch('/me/profile', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const b = z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).optional() }).parse(req.body)
    if (b.phone && !/^\+?[\d\s().-]{7,}$/.test(b.phone)) throw new HttpError(400, 'Enter a phone number with the country code, e.g. +1 713 555 0100.')
    await db.query('update users set name = coalesce($2, name), phone = coalesce($3, phone) where id = $1', [self(u), b.name ?? null, b.phone ?? null])
    if (b.name && u.role === 'customer' && !u.actingBy) await db.query(`update clients set name = $2 where user_id = $1`, [u.id, b.name]).catch(() => {})
    res.json({ ok: true })
  }))
  r.post('/me/password', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const b = z.object({ current: z.string().min(1).max(200), next: z.string().min(8, 'Use at least 8 characters.').max(200) }).parse(req.body)
    const { rows: [p] } = await db.query<Row>('select password_hash from users where id = $1', [self(u)])
    if (!(await bcrypt.compare(b.current, p.password_hash))) throw new HttpError(400, 'Your current password is not right.')
    if (b.current === b.next) throw new HttpError(400, 'Choose a password you haven’t used here.')
    await db.query('update users set password_hash = $2 where id = $1', [self(u), await bcrypt.hash(b.next, 10)])
    const { rows: gone } = await db.query('delete from sessions where user_id = $1 and id <> $2 returning id', [self(u), req.cookies?.ss_session ?? ''])
    res.json({ ok: true, signedOut: gone.length })
  }))

  /* ---------- devices ---------- */
  r.get('/me/sessions', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const cur = req.cookies?.ss_session ?? ''
    const { rows } = await db.query<Row>(`select id, created_at, last_seen_at, user_agent, read_only from sessions where user_id = $1 and expires_at > now() and not coalesce(read_only, false) order by (id = $2) desc, coalesce(last_seen_at, created_at) desc nulls last`, [self(u), cur])
    res.set('Cache-Control', 'no-store')
    res.json({ sessions: rows.map((s) => ({ key: keyOf(s.id), current: s.id === cur, device: deviceName(s.user_agent ?? ''), createdAt: ISO(s.created_at), lastSeenAt: ISO(s.last_seen_at ?? s.created_at) })) })
  }))
  r.delete('/me/sessions/:key', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); const cur = req.cookies?.ss_session ?? ''
    const { rows } = await db.query<Row>('select id from sessions where user_id = $1', [self(u)]); const hit = rows.find((s) => keyOf(s.id) === req.params.key)
    if (!hit) throw new HttpError(404, 'That device is already signed out.'); if (hit.id === cur) throw new HttpError(400, 'Use Sign out to end this session.')
    await db.query('delete from sessions where id = $1', [hit.id]); res.json({ ok: true })
  }))
  r.post('/me/sessions/revoke-others', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows: gone } = await db.query('delete from sessions where user_id = $1 and id <> $2 and not coalesce(read_only, false) returning id', [self(u), req.cookies?.ss_session ?? ''])
    res.json({ ok: true, signedOut: gone.length })
  }))

  /* ---------- data rights ---------- */
  r.get('/me/export', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); if (u.actingBy) throw new HttpError(403, 'Only the account owner can download its data.')
    const q = async (sql: string) => { try { return (await db.query<Row>(sql, [u.id])).rows } catch (e) { console.error('[export]', (e as Error).message); return [] } }
    const out = {
      exportedAt: new Date().toISOString(),
      account: (await q('select id, email, name, phone, company_name, tax_id, billing_address, referral_code, created_at from users where id = $1'))[0],
      notificationPrefs: (await q('select email, muted, phone, text_channel, text_kinds, quiet_start, quiet_end from notification_prefs where user_id = $1'))[0] ?? null,
      recipients: await q('select name, phone, address, city, country, relationship, created_at from customer_consignees where user_id = $1'),
      requests: await q('select ref, origin, destination, mode, cargo, quantity, description, status, created_at from requests where user_id = $1 order by created_at'),
      quotes: await q(`select r.ref as request, q.price, q.transit_days, q.status, q.sent_at, s.name as shipper from quotes q join requests r on r.id = q.request_id join shippers s on s.id = q.shipper_id where r.user_id = $1 order by q.sent_at`),
      shipments: await q('select ref, origin, destination, mode, cargo, description, status, eta, created_at from shipments where user_id = $1 order by created_at'),
      packingLists: await q('select s.ref as shipment, i.description, i.category, i.qty, i.value_usd from shipment_items i join shipments s on s.id = i.shipment_id where s.user_id = $1'),
      invoices: (await myInvoices(db, u.id)).map((i) => ({ number: i.number, shipper: i.shipper_name, shipment: i.shipment_ref, total: Number(i.total), paid: Number(i.paid), issuedAt: ISO(i.issued_at) })),
      payments: await q(`select amount_usd, status, method, paid_at, created_at from escrow_payments where user_id = $1 order by created_at`),
      messagesAfterBooking: await q(`select s.ref as shipment, m.author_name, m.body, m.created_at from shipment_messages m join shipments s on s.id = m.shipment_id where s.user_id = $1 order by m.created_at`),
      messagesBeforeBooking: await q(`select r.ref as request, m.author_role, m.body, m.created_at from request_messages m join requests r on r.id = m.request_id where r.user_id = $1 order by m.created_at`),
      reviews: await q('select rating, body, created_at from reviews where user_id = $1'),
      disputes: await q(`select s.ref as shipment, d.reason, d.status, d.description, d.created_at from disputes d join shipments s on s.id = d.shipment_id where s.user_id = $1`),
      sourcing: await q('select ref, title, description, quantity, unit, origin_country, destination, status, created_at from sourcing_requests where user_id = $1'),
      credits: await q('select amount_usd, reason, used_at, created_at from credits where user_id = $1'),
      familyMembers: await q('select email, role, status, created_at from account_members where owner_id = $1'),
    }
    res.set('Content-Type', 'application/json'); res.set('Content-Disposition', `attachment; filename="ntemtem-my-data-${new Date().toISOString().slice(0, 10)}.json"`)
    res.send(JSON.stringify(out, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2))
  }))
  r.post('/me/delete', wrap(async (req, res) => {
    const db = await getDb(); const u = await customer(db, req); if (u.actingBy) throw new HttpError(403, 'Only the account owner can delete it.')
    const b = z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE', { message: 'Type DELETE to confirm.' }) }).parse(req.body)
    const { rows: [p] } = await db.query<Row>('select password_hash from users where id = $1', [u.id])
    if (!(await bcrypt.compare(b.password, p.password_hash))) throw new HttpError(400, 'Your password is not right.')
    const { rows: [busy] } = await db.query<Row>(`select (select count(*) from shipments where user_id = $1 and ${ACTIVE})::int as active`, [u.id])
    const owe = (await myInvoices(db, u.id)).reduce((a, i) => a + i.balance, 0)
    const { rows: [held] } = await db.query<Row>(`select count(*)::int as n from escrow_payments where user_id = $1 and status in ('pending','held')`, [u.id])
    if (Number(busy.active) > 0) throw new HttpError(409, `You have ${busy.active} shipment${busy.active === 1 ? '' : 's'} on the way. You can delete your account once ${busy.active === 1 ? 'it’s' : 'they’re'} delivered.`)
    if (owe > 0.01) throw new HttpError(409, 'Please settle your open invoices first — then you can delete your account.')
    if (Number(held.n) > 0) throw new HttpError(409, 'A payment of yours is still being held. Once it’s released or refunded you can delete your account.')
    // Keep the shipping and payment records (tax and customs law), remove everything that identifies you.
    const anon = `deleted+${u.id}@shipsync.invalid`
    await db.query(`update users set email = $2, name = 'Deleted customer', phone = '', password_hash = $3, company_name = '', tax_id = '', billing_address = '', referral_code = null, deleted_at = now() where id = $1`, [u.id, anon, await bcrypt.hash(randomBytes(24).toString('hex'), 4)])
    for (const sql of ['delete from customer_consignees where user_id = $1', 'delete from notification_prefs where user_id = $1', 'delete from favorites where user_id = $1', 'delete from alerts where user_id = $1', 'delete from repeat_plans where user_id = $1', 'delete from account_members where owner_id = $1 or member_id = $1', 'delete from user_texts where user_id = $1', 'delete from notifications where user_id = $1', 'delete from sessions where user_id = $1'])
      await db.query(sql, [u.id]).catch(() => {})
    await db.query(`update requests set contact_name = 'Deleted customer', contact_email = $2, contact_phone = '' where user_id = $1`, [u.id, anon]).catch(() => {})
    res.clearCookie('ss_session', { path: '/' })
    res.json({ ok: true })
  }))
}
