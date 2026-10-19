/**
 * Operations overview — one call for the "Operations" tab on the shipper overview and the "Activity" view in the
 * customer portal. Same shape for both so the screens share components:
 *   kpis (with the previous period for comparison), a volume series (shipments and money per week or month),
 *   a status snapshot, recent activity and an action list.
 *   GET /shipper/operations?range=30d|90d|ytd|12m|all
 *   GET /me/operations?range=…
 */
import type { Request, Response, NextFunction, Router } from 'express'
import type { Db } from './db'
import type { ApiUser } from './api'
import { statusLabels, type ShipmentStatus } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const r2 = (n: number) => Math.round(n * 100) / 100
export type Range = '30d' | '90d' | 'ytd' | '12m' | 'all'

/** Period start/end, the equally long period before it, and the bucket size for the chart. */
function period(range: Range, earliest: Date | null) {
  const now = new Date(); const day = 86400000
  let from: Date
  if (range === '30d') from = new Date(now.getTime() - 30 * day)
  else if (range === '90d') from = new Date(now.getTime() - 90 * day)
  else if (range === 'ytd') from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  else if (range === '12m') from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
  else from = earliest ? new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1)) : new Date(now.getTime() - 365 * day)
  const len = now.getTime() - from.getTime()
  const prevFrom = new Date(from.getTime() - len)
  const bucket: 'week' | 'month' = len <= 100 * day ? 'week' : 'month'
  return { from, to: now, prevFrom, bucket }
}
/** Empty buckets from `from` to now so the chart has no gaps. */
function buckets(from: Date, bucket: 'week' | 'month') {
  const out: string[] = []; const now = new Date()
  if (bucket === 'month') { let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); while (d <= now) { out.push(d.toISOString().slice(0, 10)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) } }
  else { const dow = (from.getUTCDay() + 6) % 7; let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - dow)); while (d <= now) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 7 * 86400000) } }
  return out
}
const bucketOf = (at: Date, bucket: 'week' | 'month') => { if (bucket === 'month') return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10); const dow = (at.getUTCDay() + 6) % 7; return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - dow)).toISOString().slice(0, 10) }
const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null)

/** The five groups the status chart shows (same everywhere). */
const GROUPS: { key: string; label: string; statuses: ShipmentStatus[] }[] = [
  { key: 'pickup', label: 'Waiting for pickup', statuses: ['booked'] },
  { key: 'origin', label: 'At origin', statuses: ['picked_up', 'at_origin_port'] },
  { key: 'transit', label: 'On the way', statuses: ['in_transit'] },
  { key: 'destination', label: 'At destination', statuses: ['arrived', 'customs', 'ready_for_collection', 'out_for_delivery'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
]

async function build(db: Db, scope: { shipperId?: string; userId?: string }, range: Range) {
  const own = scope.shipperId ? 's.shipper_id = $1' : 's.user_id = $1'
  const key = scope.shipperId ?? scope.userId!
  const { rows: first } = await db.query<Row>(`select min(s.created_at) as m from shipments s where ${own}`, [key])
  const p = period(range, first[0]?.m ? new Date(first[0].m) : null)

  // Shipments: picked up (shipper) / booked (customer) in the period, from the event log.
  const evStatus = scope.shipperId ? 'picked_up' : 'booked'
  const { rows: evs } = await db.query<Row>(`select e.shipment_id, min(e.at) as at from shipment_events e join shipments s on s.id = e.shipment_id where ${own} and e.status = $2 and s.cancelled_at is null group by e.shipment_id`, [key, evStatus])
  const inRange = (at: Date, a: Date, b: Date) => at >= a && at < b
  const shipCur = evs.filter((e) => inRange(new Date(e.at), p.from, p.to)).length
  const shipPrev = evs.filter((e) => inRange(new Date(e.at), p.prevFrom, p.from)).length

  // Money: shipper = collected (net of platform fee + direct/offline payments); customer = paid.
  type Pay = { at: Date; usd: number }
  let pays: Pay[] = []
  if (scope.shipperId) {
    const { rows: esc } = await db.query<Row>(`select paid_at, net_usd from escrow_payments where shipper_id = $1 and status in ('held','released','paid_out','direct') and paid_at is not null`, [key])
    const { rows: off } = await db.query<Row>(`select p.at, p.amount from payments p join invoices i on i.id = p.invoice_id where i.shipper_id = $1 and p.method <> 'ship_sync'`, [key])
    pays = [...esc.map((x) => ({ at: new Date(x.paid_at), usd: Number(x.net_usd) })), ...off.map((x) => ({ at: new Date(x.at), usd: Number(x.amount) }))]
  } else {
    const { rows: esc } = await db.query<Row>(`select paid_at, amount_usd from escrow_payments where user_id = $1 and status in ('held','released','paid_out','direct') and paid_at is not null`, [key])
    const { rows: off } = await db.query<Row>(`select p.at, p.amount from payments p join invoices i on i.id = p.invoice_id join clients c on c.id = i.client_id where c.user_id = $1 and p.method <> 'ship_sync'`, [key])
    pays = [...esc.map((x) => ({ at: new Date(x.paid_at), usd: Number(x.amount_usd) })), ...off.map((x) => ({ at: new Date(x.at), usd: Number(x.amount) }))]
  }
  const moneyCur = r2(pays.filter((x) => inRange(x.at, p.from, p.to)).reduce((a, x) => a + x.usd, 0))
  const moneyPrev = r2(pays.filter((x) => inRange(x.at, p.prevFrom, p.from)).reduce((a, x) => a + x.usd, 0))

  // Third tile: containers (shipper) / delivered (customer).
  let thirdCur = 0, thirdPrev = 0
  if (scope.shipperId) {
    const { rows: cs } = await db.query<Row>('select created_at from containers where shipper_id = $1', [key])
    thirdCur = cs.filter((c) => inRange(new Date(c.created_at), p.from, p.to)).length; thirdPrev = cs.filter((c) => inRange(new Date(c.created_at), p.prevFrom, p.from)).length
  } else {
    const { rows: ds } = await db.query<Row>(`select min(e.at) as at from shipment_events e join shipments s on s.id = e.shipment_id where s.user_id = $1 and e.status = 'delivered' group by e.shipment_id`, [key])
    thirdCur = ds.filter((d) => inRange(new Date(d.at), p.from, p.to)).length; thirdPrev = ds.filter((d) => inRange(new Date(d.at), p.prevFrom, p.from)).length
  }

  // Fourth tile: rating (shipper: reviews received; customer: shipments on the way now).
  let rating: { value: number | null; count: number } | null = null, onTheWay = 0
  if (scope.shipperId) {
    const { rows: rv } = await db.query<Row>(`select rating, created_at from reviews where shipper_id = $1 and status = 'published'`, [key])
    const cur = rv.filter((x) => inRange(new Date(x.created_at), p.from, p.to))
    rating = { value: cur.length ? Math.round((cur.reduce((a, x) => a + Number(x.rating), 0) / cur.length) * 10) / 10 : null, count: cur.length }
    if (!cur.length) { const { rows: sh } = await db.query<Row>('select rating, reviews from shippers where id = $1', [key]); rating = { value: sh[0]?.rating != null ? Number(sh[0].rating) : null, count: 0 } }
  } else {
    const { rows: ow } = await db.query<Row>(`select count(*)::int as n from shipments s where ${own} and s.cancelled_at is null and s.status not in ('booked','delivered')`, [key]); onTheWay = Number(ow[0]?.n ?? 0)
  }

  // Volume series.
  const keys = buckets(p.from, p.bucket)
  const series = keys.map((k) => ({ start: k, shipments: 0, usd: 0 }))
  const idx = new Map(keys.map((k, i) => [k, i]))
  for (const e of evs) { const at = new Date(e.at); if (!inRange(at, p.from, p.to)) continue; const i = idx.get(bucketOf(at, p.bucket)); if (i != null) series[i].shipments += 1 }
  for (const x of pays) { if (!inRange(x.at, p.from, p.to)) continue; const i = idx.get(bucketOf(x.at, p.bucket)); if (i != null) series[i].usd = r2(series[i].usd + x.usd) }

  // Status snapshot: everything not cancelled, active now plus delivered in the period.
  const { rows: st } = await db.query<Row>(`select s.status, count(*)::int as n from shipments s where ${own} and s.cancelled_at is null and (s.status <> 'delivered' or exists (select 1 from shipment_events e where e.shipment_id = s.id and e.status = 'delivered' and e.at >= $2)) group by s.status`, [key, p.from])
  const by = new Map(st.map((x) => [x.status, Number(x.n)]))
  const statuses = GROUPS.map((g) => ({ key: g.key, label: g.label, n: g.statuses.reduce((a, s) => a + (by.get(s) ?? 0), 0) }))

  // Recent activity.
  const { rows: act } = await db.query<Row>(`select e.status, e.at, e.place, e.note, s.id as shipment_id, s.ref, s.customer from shipment_events e join shipments s on s.id = e.shipment_id where ${own} order by e.at desc, e.id desc limit 10`, [key])
  const activity = act.map((a) => ({ shipmentId: a.shipment_id, ref: a.ref, customer: scope.shipperId ? a.customer : undefined, status: a.status as ShipmentStatus, label: statusLabels[a.status as ShipmentStatus] ?? a.status, at: ISO(a.at), place: a.place, note: a.note ?? '' }))

  // Action centre.
  const actions: { key: string; tone: 'critical' | 'warning' | 'info'; title: string; body: string; link: string; n: number }[] = []
  const add = (a: (typeof actions)[number]) => { if (a.n > 0) actions.push(a) }
  if (scope.shipperId) {
    const q = async (sql: string, params: unknown[] = [key]) => Number((await db.query<Row>(sql, params)).rows[0]?.n ?? 0)
    add({ key: 'pickups', tone: 'warning', title: 'Pickups to confirm', body: 'Customers picked a pickup slot — confirm and place them on a run.', link: '/dashboard/pickups', n: await q(`select count(*)::int as n from pickup_requests where shipper_id = $1 and status = 'requested'`) })
    add({ key: 'recipient', tone: 'warning', title: 'Shipments without a recipient', body: 'Add who receives it so the family gets updates and the driver can find them.', link: '/dashboard/shipments', n: await q(`select count(*)::int as n from shipments s where s.shipper_id = $1 and s.cancelled_at is null and s.status <> 'delivered' and s.consignee_id is null and s.request_id is not null and not exists (select 1 from requests r where r.id = s.request_id and r.consignee is not null)`) })
    add({ key: 'cutoff', tone: 'critical', title: 'Containers closing in 3 days', body: 'Cut-off is near — finish loading or move the shipments.', link: '/dashboard/containers', n: await q(`select count(*)::int as n from containers where shipper_id = $1 and status in ('booked','loading') and cutoff_date is not null and cutoff_date <= current_date + 3`) })
    add({ key: 'overdue', tone: 'critical', title: 'Overdue invoices', body: 'Send a reminder or a pay link.', link: '/dashboard/collections', n: await q(`select count(*)::int as n from invoices where shipper_id = $1 and status in ('sent','partial') and due_at < current_date`) })
    add({ key: 'leads', tone: 'info', title: 'Requests waiting for your quote', body: 'Reply fast — customers see your response time.', link: '/dashboard/leads', n: await q(`select count(*)::int as n from requests r where r.status = 'open' and r.preferred_shipper_id = $1 and not exists (select 1 from quotes q where q.request_id = r.id and q.shipper_id = $1)`) })
    add({ key: 'supplies', tone: 'info', title: 'Packing supplies to bring', body: 'Customers asked for barrels or boxes before pickup.', link: '/dashboard/supplies?tab=packing', n: await q(`select count(*)::int as n from shipment_supplies l join shipments s on s.id = l.shipment_id where s.shipper_id = $1 and l.source = 'shipper' and l.status <> 'cancelled' and s.status = 'booked'`) })
    try { add({ key: 'export', tone: 'critical', title: 'Export filing needed', body: 'These shipments need an EEI filing (ITN) or a vehicle title check before they sail.', link: '/dashboard/shipments', n: await q(`select count(*)::int as n from shipments s where s.shipper_id = $1 and s.cancelled_at is null and s.status in ('booked','picked_up','at_origin_port') and coalesce((s.export_compliance->>'required')::boolean, false) and coalesce(s.export_compliance->>'cleared', '') = ''`) }) } catch { /* column added by the compliance module */ }
  } else {
    const q = async (sql: string) => Number((await db.query<Row>(sql, [key])).rows[0]?.n ?? 0)
    add({ key: 'quotes', tone: 'warning', title: 'Quotes waiting for you', body: 'Compare and book before they expire.', link: '/dashboard?tab=requests', n: await q(`select count(*)::int as n from quotes q join requests r on r.id = q.request_id where r.user_id = $1 and r.status = 'open' and q.status = 'sent' and q.valid_until >= current_date`) })
    add({ key: 'pay', tone: 'critical', title: 'Shipments to pay', body: 'Pay through Ntemtem so the money is protected.', link: '/dashboard?tab=money', n: await q(`select count(*)::int as n from shipments s where s.user_id = $1 and s.cancelled_at is null and s.status = 'booked' and not exists (select 1 from escrow_payments p where p.shipment_id = s.id and p.status in ('held','released','paid_out','direct'))`) })
    add({ key: 'recipient', tone: 'warning', title: 'Add who receives it', body: 'So the family gets WhatsApp updates and the driver can find them.', link: '/dashboard?tab=shipments', n: await q(`select count(*)::int as n from shipments s where s.user_id = $1 and s.cancelled_at is null and s.status <> 'delivered' and s.consignee_id is null and s.request_id is not null and not exists (select 1 from requests r where r.id = s.request_id and r.consignee is not null)`) })
    add({ key: 'review', tone: 'info', title: 'Rate your delivered shipments', body: 'Your review helps others pick a good shipper.', link: '/dashboard?tab=shipments', n: await q(`select count(*)::int as n from shipments s where s.user_id = $1 and s.status = 'delivered' and not exists (select 1 from reviews r where r.shipment_id = s.id)`) })
  }
  actions.sort((a, b) => ['critical', 'warning', 'info'].indexOf(a.tone) - ['critical', 'warning', 'info'].indexOf(b.tone))

  return {
    range, from: p.from.toISOString().slice(0, 10), bucket: p.bucket,
    kpis: {
      money: { value: moneyCur, prev: moneyPrev, delta: delta(moneyCur, moneyPrev) },
      shipments: { value: shipCur, prev: shipPrev, delta: delta(shipCur, shipPrev) },
      third: { value: thirdCur, prev: thirdPrev, delta: delta(thirdCur, thirdPrev) },
      rating, onTheWay,
    },
    series, statuses, activity, actions,
  }
}

export function mountOperations(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const rangeOf = (req: Request): Range => (['30d', '90d', 'ytd', '12m', 'all'].includes(String(req.query.range)) ? (String(req.query.range) as Range) : 'ytd')
  r.get('/shipper/operations', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'For shipping companies only.')
    res.set('Cache-Control', 'no-store'); res.json(await build(db, { shipperId: u.shipperId }, rangeOf(req)))
  }))
  r.get('/me/operations', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'customer') throw new HttpError(403, 'For customer accounts.')
    res.set('Cache-Control', 'no-store'); res.json(await build(db, { userId: u.id }, rangeOf(req)))
  }))
}
