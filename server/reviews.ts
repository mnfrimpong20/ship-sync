/**
 * Reviews & disputes.
 *   Reviews — only the customer of a delivered shipment can rate the shipper (1–5, tags, text); the
 *   shipper can reply once; admins can hide. The shipper's public rating blends the real reviews with
 *   the listing's baseline so a new shipper's first review doesn't swing it to 1.0 or 5.0.
 *   Disputes — either side opens one on a shipment (damaged, missing, late, overcharged, other). Opening
 *   a dispute puts the escrow on hold (no release while open); messages go back and forth with Ntemtem
 *   in the thread; an admin resolves with a full / partial refund, a release, or no action.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import { publicShipperSql, uid, type Db } from './db'
import type { ApiUser } from './api'
import { notify, notifyShipperStaff } from './notify'
import { refundPayment, releasePayment } from './payments'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const initial = (name: string) => { const [a, ...rest] = String(name || 'Customer').trim().split(/\s+/); return rest.length ? `${a} ${rest[rest.length - 1][0]}.` : a }

export const REVIEW_TAGS = ['Great communication', 'On time', 'Careful handling', 'Good value', 'Easy pickup', 'Smooth customs', 'Late', 'Damaged items', 'Hard to reach', 'Hidden charges'] as const
export const DISPUTE_REASONS = { damaged: 'Goods damaged', missing: 'Pieces missing', late: 'Far later than promised', overcharged: 'Charged more than agreed', not_delivered: 'Never delivered', other: 'Something else' } as const
export type DisputeReason = keyof typeof DISPUTE_REASONS

export const reviewOut = (r: Row, full = false) => ({
  id: r.id, shipmentId: r.shipment_id, shipmentRef: r.ref ?? undefined, shipperId: r.shipper_id, shipperName: r.shipper_name ?? undefined, userId: full ? r.user_id : undefined, author: initial(r.author ?? ''), rating: Number(r.rating), tags: (J(r.tags) ?? []) as string[], body: r.body,
  reply: r.reply ?? '', repliedAt: ISO(r.replied_at), status: r.status as 'published' | 'hidden', lane: r.origin ? `${String(r.origin).split(',')[0]} → ${r.destination}` : undefined, cargo: r.cargo ?? undefined, createdAt: ISO(r.created_at),
})
export const disputeOut = (d: Row) => ({ photos: (J(d.photos) ?? []) as string[],
  id: d.id, shipmentId: d.shipment_id, shipmentRef: d.ref ?? undefined, customer: d.customer ?? undefined, shipperId: d.shipper_id, shipperName: d.shipper_name ?? undefined, openedBy: d.opened_by, openedByRole: d.opened_by_role as 'customer' | 'office', reason: d.reason as DisputeReason, reasonLabel: DISPUTE_REASONS[d.reason as DisputeReason] ?? d.reason, description: d.description, amountClaimedUsd: d.amount_claimed_usd == null ? null : Number(d.amount_claimed_usd),
  status: d.status as 'open' | 'resolved' | 'withdrawn', messages: (J(d.messages) ?? []) as { at: string; by: string; role: string; text: string }[], resolution: J(d.resolution) as { outcome: string; amountUsd: number; note: string; by: string; at: string } | null, paymentId: d.payment_id ?? null, paymentAmountUsd: d.p_amount == null ? null : Number(d.p_amount), paymentStatus: d.p_status ?? null, createdAt: ISO(d.created_at), updatedAt: ISO(d.updated_at),
})
const REVIEW_SELECT = `select r.*, s.ref, s.origin, s.destination, s.cargo, u.name as author, sh.name as shipper_name from reviews r join shipments s on s.id = r.shipment_id left join users u on u.id = r.user_id join shippers sh on sh.id = r.shipper_id`
const DISPUTE_SELECT = `select d.*, s.ref, s.customer, sh.name as shipper_name, p.amount_usd as p_amount, p.status as p_status from disputes d join shipments s on s.id = d.shipment_id join shippers sh on sh.id = d.shipper_id left join escrow_payments p on p.id = d.payment_id`

/** Blend real reviews with the listing's baseline (seeded rating × seeded count) and write it to the shipper. */
export async function recomputeRating(db: Db, shipperId: string) {
  const { rows: sh } = await db.query<Row>('select rating, reviews, base_rating, base_reviews from shippers where id = $1', [shipperId]); const s = sh[0]; if (!s) return
  if (s.base_reviews == null) { await db.query('update shippers set base_rating = rating, base_reviews = reviews where id = $1', [shipperId]); s.base_rating = s.rating; s.base_reviews = s.reviews }
  const { rows } = await db.query<Row>(`select count(*)::int as n, coalesce(avg(rating),0)::float as avg from reviews where shipper_id = $1 and status = 'published'`, [shipperId])
  const n = Number(rows[0].n), avg = Number(rows[0].avg); const bn = Number(s.base_reviews), br = Number(s.base_rating)
  const total = bn + n; const rating = total ? (br * bn + avg * n) / total : 0
  await db.query('update shippers set rating = $2, reviews = $3 where id = $1', [shipperId, Math.round(rating * 10) / 10, total])
}

const zReview = z.object({ rating: z.number().int().min(1).max(5), tags: z.array(z.enum(REVIEW_TAGS)).max(5).default([]), body: z.string().trim().min(10).max(1200) })
const zReply = z.object({ reply: z.string().trim().min(2).max(800) })
const zDispute = z.object({ reason: z.enum(Object.keys(DISPUTE_REASONS) as [DisputeReason, ...DisputeReason[]]), description: z.string().trim().min(10).max(2000), amountClaimedUsd: z.number().min(0).max(1_000_000).optional(), photos: z.array(z.string().max(2_800_000).regex(/^data:image\/(png|jpe?g|webp);base64,/)).max(4).default([]) })
const zMessage = z.object({ text: z.string().trim().min(1).max(2000) })
const zResolve = z.object({ outcome: z.enum(['refund_full', 'refund_partial', 'release', 'no_action']), amountUsd: z.number().min(0).max(1_000_000).optional(), note: z.string().trim().min(2).max(1000) })

export function mountReviews(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d
  const access = async (db: Db, req: Request, shipmentId: string) => {
    const u = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [shipmentId]); const s = rows[0]; if (!s) throw new HttpError(404, 'Shipment not found.')
    const office = u.role === 'shipper' && s.shipper_id === u.shipperId && !isDriverRole(u.staffRole)
    const owner = u.role === 'customer' && s.user_id === u.id
    if (!office && !owner && !u.admin) throw new HttpError(403, 'You do not have access to this shipment.')
    return { u, s, office, owner }
  }
  const reviewFor = async (db: Db, sid: string) => (await db.query<Row>(`${REVIEW_SELECT} where r.shipment_id = $1`, [sid])).rows[0] ?? null
  const disputeFor = async (db: Db, sid: string) => (await db.query<Row>(`${DISPUTE_SELECT} where d.shipment_id = $1 order by d.created_at desc limit 1`, [sid])).rows[0] ?? null
  const disputeById = async (db: Db, id: string) => { const { rows } = await db.query<Row>(`${DISPUTE_SELECT} where d.id = $1`, [id]); if (!rows[0]) throw new HttpError(404, 'Dispute not found.'); return rows[0] }

  /* ---- reviews ---- */
  r.get('/shippers/:id/reviews', wrap(async (req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>(`${REVIEW_SELECT} where r.shipper_id = $1 and r.status = 'published' order by r.created_at desc limit 50`, [req.params.id])
    const dist = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: rows.filter((x) => Number(x.rating) === n).length }))
    const tags: Record<string, number> = {}; for (const x of rows) for (const t of (J(x.tags) ?? []) as string[]) tags[t] = (tags[t] ?? 0) + 1
    res.set('Cache-Control', 'no-store')
    res.json({ reviews: rows.map((x) => reviewOut(x)), summary: { count: rows.length, average: rows.length ? Math.round((rows.reduce((n, x) => n + Number(x.rating), 0) / rows.length) * 10) / 10 : null, distribution: dist, tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, count]) => ({ tag, count })) } })
  }))
  /** Home page: the latest real reviews (verified bookings, published, with something to say) — never sample text. */
  r.get('/reviews/recent', wrap(async (_req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>(`${REVIEW_SELECT} where r.status = 'published' and r.rating >= 4 and length(r.body) >= 40 and ${publicShipperSql('sh.')} order by r.created_at desc limit 3`)
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ reviews: rows.map((x) => reviewOut(x)) })
  }))
  r.get('/shipments/:id/review', wrap(async (req, res) => {
    const db = await getDb(); const { s, office, owner } = await access(db, req, String(req.params.id)); const rv = await reviewFor(db, s.id)
    res.set('Cache-Control', 'no-store')
    res.json({ review: rv ? reviewOut(rv, true) : null, canReview: owner && s.status === 'delivered' && !rv, canReply: office && !!rv && !rv.reply, tags: REVIEW_TAGS })
  }))
  r.post('/shipments/:id/review', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, owner } = await access(db, req, String(req.params.id))
    if (!owner) throw new HttpError(403, 'Only the customer can review a shipment.')
    if (s.status !== 'delivered') throw new HttpError(409, 'You can review once the shipment is delivered.')
    if (await reviewFor(db, s.id)) throw new HttpError(409, 'You already reviewed this shipment.')
    const b = zReview.parse(req.body); const id = 'rev_' + uid()
    await db.query(`insert into reviews (id,shipment_id,shipper_id,user_id,rating,tags,body,status) values ($1,$2,$3,$4,$5,$6,$7,'published')`, [id, s.id, s.shipper_id, u.id, b.rating, JSON.stringify(b.tags), b.body])
    await recomputeRating(db, s.shipper_id)
    await notifyShipperStaff(db, s.shipper_id, { kind: 'review', title: `${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)} — ${initial(u.name)} reviewed ${s.ref}`, body: `“${b.body.slice(0, 140)}${b.body.length > 140 ? '…' : ''}”${b.tags.length ? ` · ${b.tags.join(', ')}` : ''}. Reply from the Reviews page.`, link: '/dashboard/reviews', dedupe: `rev:${id}` }, ['owner', 'dispatcher'])
    res.status(201).json({ review: reviewOut((await reviewFor(db, s.id))!, true) })
  }))
  r.post('/reviews/:id/reply', wrap(async (req, res) => {
    const db = await getDb(); const { rows } = await db.query<Row>(`${REVIEW_SELECT} where r.id = $1`, [req.params.id]); const rv = rows[0]; if (!rv) throw new HttpError(404, 'Review not found.')
    const { office, u } = await access(db, req, rv.shipment_id); if (!office) throw new HttpError(403, 'Only the shipper replies.')
    if (rv.reply) throw new HttpError(409, 'Already replied.')
    const b = zReply.parse(req.body)
    await db.query('update reviews set reply = $2, replied_at = now(), replied_by = $3 where id = $1', [rv.id, b.reply, u.name])
    if (rv.user_id) await notify(db, { userId: rv.user_id, kind: 'review', title: `${rv.shipper_name} replied to your review`, body: b.reply.slice(0, 200), link: `/shippers/${rv.shipper_id}`, dedupe: `rev:${rv.id}:reply` })
    res.json({ review: reviewOut((await reviewFor(db, rv.shipment_id))!, true) })
  }))
  r.get('/reviews', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>(`${REVIEW_SELECT} where r.shipper_id = $1 order by r.created_at desc limit 200`, [u.shipperId])
    const { rows: sh } = await db.query<Row>('select rating, reviews from shippers where id = $1', [u.shipperId])
    const { rows: pending } = await db.query<Row>(`select count(*)::int as n from shipments s where s.shipper_id = $1 and s.status = 'delivered' and s.user_id is not null and not exists (select 1 from reviews r where r.shipment_id = s.id)`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ reviews: rows.map((x) => reviewOut(x, true)), rating: Number(sh[0]?.rating ?? 0), count: Number(sh[0]?.reviews ?? 0), awaiting: pending[0]?.n ?? 0 })
  }))
  r.patch('/admin/reviews/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = z.object({ status: z.enum(['published', 'hidden']) }).parse(req.body)
    const { rows } = await db.query<Row>('select shipper_id from reviews where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Review not found.')
    await db.query('update reviews set status = $2 where id = $1', [req.params.id, b.status]); await recomputeRating(db, rows[0].shipper_id)
    res.json({ ok: true })
  }))

  /* ---- disputes ---- */
  r.get('/shipments/:id/dispute', wrap(async (req, res) => {
    const db = await getDb(); const { s, office, owner } = await access(db, req, String(req.params.id)); const dp = await disputeFor(db, s.id)
    res.set('Cache-Control', 'no-store')
    res.json({ dispute: dp ? disputeOut(dp) : null, canOpen: (owner || office) && (!dp || dp.status !== 'open') && ['in_transit', 'arrived', 'customs', 'out_for_delivery', 'delivered'].includes(s.status), reasons: Object.entries(DISPUTE_REASONS).map(([id, label]) => ({ id, label })), role: office ? 'office' : owner ? 'customer' : 'admin' })
  }))
  r.post('/shipments/:id/dispute', wrap(async (req, res) => {
    const db = await getDb(); const { u, s, office, owner } = await access(db, req, String(req.params.id)); if (!office && !owner) throw new HttpError(403, 'Not allowed.')
    const cur = await disputeFor(db, s.id); if (cur && cur.status === 'open') throw new HttpError(409, 'A dispute is already open on this shipment.')
    const b = zDispute.parse(req.body); const id = 'dsp_' + uid()
    const { rows: pays } = await db.query<Row>(`select * from escrow_payments where shipment_id = $1 and status in ('held','released') order by created_at desc limit 1`, [s.id]); const pay = pays[0] ?? null
    if (pay) await db.query('update escrow_payments set hold = true where id = $1', [pay.id])
    const msg = { at: new Date().toISOString(), by: u.name, role: office ? 'office' : 'customer', text: b.description }
    await db.query(`insert into disputes (id,shipment_id,shipper_id,user_id,opened_by,opened_by_role,reason,description,amount_claimed_usd,status,messages,payment_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11)`, [id, s.id, s.shipper_id, s.user_id ?? null, u.name, office ? 'office' : 'customer', b.reason, b.description, b.amountClaimedUsd ?? null, JSON.stringify([msg]), pay?.id ?? null])
    if (b.photos.length) await db.query('update disputes set photos = $2 where id = $1', [id, JSON.stringify(b.photos)])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, s.status, s.destination, `Dispute opened by ${u.name}: ${DISPUTE_REASONS[b.reason]}.${pay ? ' Escrow on hold.' : ''}`])
    const { rows: admins } = await db.query<Row>('select id from users where is_admin')
    for (const a of admins) await notify(db, { userId: a.id, kind: 'dispute', title: `Dispute: ${DISPUTE_REASONS[b.reason]} — ${s.ref}`, body: `${u.name} (${office ? 'shipper' : 'customer'})${b.amountClaimedUsd ? ` claims $${b.amountClaimedUsd.toLocaleString()}` : ''}. ${pay ? `$${Number(pay.amount_usd).toLocaleString()} in escrow is on hold.` : 'No platform payment on this shipment.'}`, link: '/admin', dedupe: `dsp:${id}:a` })
    if (owner) await notifyShipperStaff(db, s.shipper_id, { kind: 'dispute', title: `${s.customer} opened a dispute on ${s.ref}`, body: `${DISPUTE_REASONS[b.reason]}: “${b.description.slice(0, 160)}”. Reply on the shipment; Ntemtem mediates.${pay ? ' The escrow payment is on hold until it is resolved.' : ''}`, link: `/dashboard/shipments?q=${s.ref}&b=all`, dedupe: `dsp:${id}:o` }, ['owner', 'dispatcher'])
    else if (s.user_id) await notify(db, { userId: s.user_id, kind: 'dispute', title: `${u.company ?? 'Your shipper'} opened a dispute on ${s.ref}`, body: `${DISPUTE_REASONS[b.reason]}: “${b.description.slice(0, 160)}”. Reply from your dashboard; Ntemtem mediates.`, link: `/dashboard?tab=shipments&s=${s.id}`, dedupe: `dsp:${id}:c` })
    res.status(201).json({ dispute: disputeOut(await disputeById(db, id)) })
  }))
  r.post('/disputes/:id/message', wrap(async (req, res) => {
    const db = await getDb(); const dp = await disputeById(db, String(req.params.id)); const { u, office, owner } = await access(db, req, dp.shipment_id)
    if (dp.status !== 'open') throw new HttpError(409, 'This dispute is closed.')
    const b = zMessage.parse(req.body); const role = u.admin && !office && !owner ? 'shipsync' : office ? 'office' : 'customer'
    const photo = typeof req.body?.photo === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(req.body.photo) && req.body.photo.length < 2_800_000 ? req.body.photo : undefined
    const msgs = (J(dp.messages) ?? []) as Row[]; msgs.push({ at: new Date().toISOString(), by: u.name, role, text: b.text, ...(photo ? { photo } : {}) })
    await db.query('update disputes set messages = $2, updated_at = now() where id = $1', [dp.id, JSON.stringify(msgs.slice(-60))])
    if (role !== 'customer' && dp.user_id) await notify(db, { userId: dp.user_id, kind: 'dispute', title: `New message on your dispute — ${dp.ref}`, body: `${u.name}: ${b.text.slice(0, 160)}`, link: `/dashboard?tab=shipments&s=${dp.shipment_id}`, dedupe: `dsp:${dp.id}:m:${msgs.length}` })
    if (role !== 'office') await notifyShipperStaff(db, dp.shipper_id, { kind: 'dispute', title: `New message on dispute — ${dp.ref}`, body: `${u.name}: ${b.text.slice(0, 160)}`, link: `/dashboard/shipments?q=${dp.ref}&b=all`, dedupe: `dsp:${dp.id}:m:${msgs.length}:o` }, ['owner', 'dispatcher'])
    res.json({ dispute: disputeOut(await disputeById(db, dp.id)) })
  }))
  r.post('/disputes/:id/withdraw', wrap(async (req, res) => {
    const db = await getDb(); const dp = await disputeById(db, String(req.params.id)); const { u, office, owner } = await access(db, req, dp.shipment_id)
    if (dp.status !== 'open') throw new HttpError(409, 'Already closed.')
    if ((dp.opened_by_role === 'customer' && !owner) || (dp.opened_by_role === 'office' && !office)) throw new HttpError(403, 'Only whoever opened the dispute can withdraw it.')
    await db.query(`update disputes set status = 'withdrawn', resolution = $2, updated_at = now() where id = $1`, [dp.id, JSON.stringify({ outcome: 'withdrawn', amountUsd: 0, note: 'Withdrawn', by: u.name, at: new Date().toISOString() })])
    if (dp.payment_id) await db.query('update escrow_payments set hold = false where id = $1', [dp.payment_id])
    res.json({ dispute: disputeOut(await disputeById(db, dp.id)) })
  }))
  r.post('/disputes/:id/resolve', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const dp = await disputeById(db, String(req.params.id)); if (dp.status !== 'open') throw new HttpError(409, 'Already closed.')
    const b = zResolve.parse(req.body)
    const { rows: pays } = dp.payment_id ? await db.query<Row>(`select p.*, sh.name as shipper_name from escrow_payments p join shippers sh on sh.id = p.shipper_id where p.id = $1`, [dp.payment_id]) : { rows: [] as Row[] }; const pay = pays[0] ?? null
    let amount = 0
    if (b.outcome === 'refund_full' || b.outcome === 'refund_partial') {
      if (!pay) throw new HttpError(409, 'No platform payment to refund on this shipment.')
      if (b.outcome === 'refund_partial' && !(b.amountUsd! > 0)) throw new HttpError(400, 'Enter the partial refund amount.')
      amount = await refundPayment(db, pay, b.outcome === 'refund_full' ? null : b.amountUsd!, `Dispute ${dp.id}: ${b.note}`)
      if (b.outcome === 'refund_partial' && pay.status === 'held') { const { rows: fresh } = await db.query<Row>('select p.*, sh.name as shipper_name from escrow_payments p join shippers sh on sh.id = p.shipper_id where p.id = $1', [pay.id]); await releasePayment(db, fresh[0], `dispute:${dp.id}`) }
    } else if (pay) { await db.query('update escrow_payments set hold = false where id = $1', [pay.id]); if (b.outcome === 'release' && pay.status === 'held') { const { rows: fresh } = await db.query<Row>('select p.*, sh.name as shipper_name from escrow_payments p join shippers sh on sh.id = p.shipper_id where p.id = $1', [pay.id]); await releasePayment(db, fresh[0], `dispute:${dp.id}`) } }
    const resolution = { outcome: b.outcome, amountUsd: amount, note: b.note, by: admin.name, at: new Date().toISOString() }
    await db.query(`update disputes set status = 'resolved', resolution = $2, updated_at = now() where id = $1`, [dp.id, JSON.stringify(resolution)])
    const label = b.outcome === 'refund_full' ? `full refund of $${amount.toLocaleString()}` : b.outcome === 'refund_partial' ? `partial refund of $${amount.toLocaleString()}` : b.outcome === 'release' ? 'payment released to the shipper' : 'no action'
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [dp.shipment_id, (await db.query<Row>('select status from shipments where id = $1', [dp.shipment_id])).rows[0].status, '', `Dispute resolved by Ntemtem: ${label}. ${b.note}`])
    if (dp.user_id) await notify(db, { userId: dp.user_id, kind: 'dispute', title: `Dispute resolved — ${dp.ref}`, body: `Outcome: ${label}. ${b.note}`, link: `/dashboard?tab=shipments&s=${dp.shipment_id}`, dedupe: `dsp:${dp.id}:res` })
    await notifyShipperStaff(db, dp.shipper_id, { kind: 'dispute', title: `Dispute resolved — ${dp.ref}`, body: `Outcome: ${label}. ${b.note}`, link: `/dashboard/shipments?q=${dp.ref}&b=all`, dedupe: `dsp:${dp.id}:res:o` }, ['owner', 'dispatcher'])
    res.json({ dispute: disputeOut(await disputeById(db, dp.id)) })
  }))
  r.get('/disputes', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>(`${DISPUTE_SELECT} where d.shipper_id = $1 order by (d.status = 'open') desc, d.updated_at desc limit 100`, [u.shipperId]); res.json({ disputes: rows.map(disputeOut) })
  }))
  r.get('/admin/disputes', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`${DISPUTE_SELECT} order by (d.status = 'open') desc, d.updated_at desc limit 200`)
    const { rows: rv } = await db.query<Row>(`${REVIEW_SELECT} order by r.created_at desc limit 100`)
    res.json({ disputes: rows.map(disputeOut), reviews: rv.map((x) => reviewOut(x, true)) })
  }))
}
