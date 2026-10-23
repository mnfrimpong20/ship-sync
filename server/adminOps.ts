/**
 * Admin working tools: platform-wide search, a shipment case view (who to call, what happened, the money),
 * messaging a shipping company about a shipment, and snoozing items on the Attention board.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { type Db } from './db'
import type { ApiUser } from './api'
import { notifyShipperStaff } from './notify'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (d: unknown) => (d ? new Date(String(d)).toISOString() : null)
const DATE = (d: unknown) => (d ? new Date(String(d)).toISOString().slice(0, 10) : null)

/** Keys of Attention items someone has snoozed or marked handled, still in force. */
export async function snoozedKeys(db: Db): Promise<Map<string, Row>> {
  const { rows } = await db.query<Row>(`select * from admin_snoozes where until > now()`)
  return new Map(rows.map((r) => [r.key, r]))
}

export function mountAdminOps(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d

  /** One box for everything: companies, people, shipments (by reference or customer). */
  r.get('/admin/search', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const q = String(req.query.q ?? '').trim().slice(0, 80); if (q.length < 2) return res.json({ shippers: [], users: [], shipments: [] })
    const like = `%${q.toLowerCase()}%`
    const { rows: sh } = await db.query<Row>(`select id, name, verified, plan, archived_at from shippers where lower(name) like $1 or lower(id) like $1 order by archived_at is not null, verified desc, name limit 6`, [like])
    const { rows: us } = await db.query<Row>(`select u.id, u.name, u.email, u.role, s.name as company from users u left join shippers s on s.id = u.shipper_id where lower(u.name) like $1 or lower(u.email) like $1 or lower(coalesce(u.phone, '')) like $1 order by u.name limit 6`, [like])
    const { rows: sp } = await db.query<Row>(`select x.id, x.ref, x.customer, x.status, x.origin, x.destination, s.name as shipper from shipments x join shippers s on s.id = x.shipper_id where lower(x.ref) like $1 or lower(x.customer) like $1 order by x.created_at desc limit 6`, [like])
    res.set('Cache-Control', 'no-store')
    res.json({
      shippers: sh.map((x) => ({ id: x.id, name: x.name, verified: !!x.verified, plan: x.plan, archived: !!x.archived_at })),
      users: us.map((x) => ({ id: x.id, name: x.name, email: x.email, role: x.role, company: x.company ?? null })),
      shipments: sp.map((x) => ({ id: x.id, ref: x.ref, customer: x.customer, status: x.status, route: `${x.origin} → ${x.destination}`, shipper: x.shipper })),
    })
  }))

  /** The case view behind an Attention card or a search hit. */
  r.get('/admin/shipments/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`select x.*, s.name as shipper_name, s.verified as shipper_verified from shipments x join shippers s on s.id = x.shipper_id where x.id = $1 or x.ref = $1`, [String(req.params.id)])
    const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const { rows: owner } = await db.query<Row>(`select name, email, phone from users where shipper_id = $1 order by created_at limit 1`, [s.shipper_id])
    const { rows: cust } = s.user_id ? await db.query<Row>(`select name, email, phone from users where id = $1`, [s.user_id]) : { rows: [] as Row[] }
    const { rows: ev } = await db.query<Row>(`select status, place, note, at from shipment_events where shipment_id = $1 order by at desc limit 12`, [s.id])
    const { rows: msg } = await db.query<Row>(`select author_role, author_name, body, photo is not null as has_photo, created_at from shipment_messages where shipment_id = $1 order by created_at desc limit 20`, [s.id])
    const { rows: pay } = await db.query<Row>(`select id, amount_usd, fee_usd, status, hold, paid_at, released_at from escrow_payments where shipment_id = $1 order by created_at desc`, [s.id])
    const { rows: dsp } = await db.query<Row>(`select id, status, reason, created_at from disputes where shipment_id = $1 order by created_at desc limit 3`, [s.id])
    const { rows: snz } = await db.query<Row>(`select key, until, note, by_name, at from admin_snoozes where key like $1 and until > now()`, [`%:${s.id}`])
    res.set('Cache-Control', 'no-store')
    res.json({
      shipment: { id: s.id, ref: s.ref, status: s.status, mode: s.mode, origin: s.origin, destination: s.destination, cargo: s.cargo, description: s.description, eta: DATE(s.eta), customer: s.customer, createdAt: ISO(s.created_at) },
      shipper: { id: s.shipper_id, name: s.shipper_name, verified: !!s.shipper_verified, owner: owner[0] ? { name: owner[0].name, email: owner[0].email, phone: owner[0].phone || '' } : null },
      customer: cust[0] ? { name: cust[0].name, email: cust[0].email, phone: cust[0].phone || '' } : null,
      events: ev.map((e) => ({ status: e.status, place: e.place, note: e.note ?? '', at: ISO(e.at) })),
      messages: msg.map((m) => ({ from: m.author_name || m.author_role, role: m.author_role, body: m.body, photo: !!m.has_photo, at: ISO(m.created_at) })),
      payments: pay.map((p) => ({ id: p.id, amountUsd: Number(p.amount_usd), feeUsd: Number(p.fee_usd ?? 0), status: p.status, hold: !!p.hold, paidAt: ISO(p.paid_at), releasedAt: ISO(p.released_at) })),
      disputes: dsp.map((x) => ({ id: x.id, status: x.status, reason: x.reason, createdAt: ISO(x.created_at) })),
      snoozes: snz.map((x) => ({ key: x.key, until: ISO(x.until), note: x.note, by: x.by_name, at: ISO(x.at) })),
    })
  }))

  /** Ask the shipping company about a shipment — it lands in their notifications (and email/WhatsApp per their settings). */
  r.post('/admin/shipments/:id/message', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req) // the audit log records who sent it
    const b = z.object({ body: z.string().trim().min(5, 'Write a short message.').max(1000) }).parse(req.body)
    const { rows } = await db.query<Row>(`select id, ref, shipper_id from shipments where id = $1`, [String(req.params.id)]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    await notifyShipperStaff(db, s.shipper_id, { kind: 'system', title: `Ntemtem support about ${s.ref}`, body: b.body, link: `/dashboard/shipments?b=all&q=${encodeURIComponent(s.ref)}`, dedupe: `admin-msg:${s.id}:${Date.now()}` }, ['owner', 'dispatcher'])
    res.json({ ok: true })
  }))

  /** Snooze an Attention item for a few days, or mark it handled (30 days) — with a note for whoever looks next. */
  r.post('/admin/attention/snooze', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const b = z.object({ key: z.string().min(3).max(120), days: z.number().int().min(1).max(30), note: z.string().trim().max(300).default('') }).parse(req.body)
    await db.query(`insert into admin_snoozes (key, until, note, by_name, at) values ($1, now() + ($2 || ' days')::interval, $3, $4, now()) on conflict (key) do update set until = excluded.until, note = excluded.note, by_name = excluded.by_name, at = now()`, [b.key, String(b.days), b.note, admin.name])
    res.json({ ok: true })
  }))
  r.post('/admin/attention/unsnooze', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { key } = z.object({ key: z.string().min(3).max(120) }).parse(req.body)
    await db.query(`delete from admin_snoozes where key = $1`, [key]); res.json({ ok: true })
  }))
}
