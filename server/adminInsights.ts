/**
 * Admin intelligence.
 *   GET  /admin/platform?days=        platform analytics: GMV, Ntemtem fees, growth, conversion by destination & source
 *   GET  /admin/marketplace?days=     lane liquidity: demand vs supply, unanswered share, quotes per request, gaps
 *   GET  /admin/scorecards            every shipper's quality score + metrics; POST /admin/scorecards/recompute
 *   POST /admin/shippers/:id/standing { standing, note, lock }   GET|PUT /admin/standing-rules
 *   GET  /admin/risk                  risk & fraud flags; POST /admin/risk/dismiss { key, note }
 *   GET  /admin/messaging?days=       email / SMS / WhatsApp delivery, failures, bounced addresses, cost
 *   GET|PUT /admin/messaging/costs
 *   CRUD /admin/announcements · GET /announcements · POST /announcements/:id/dismiss
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import { hideDemoShippers, uid, type Db } from './db'
import type { ApiUser } from './api'
import { countryByCode } from '../src/lib/data'
import { notify, notifyShipperStaff } from './notify'
import { audit } from './audit'
import { planPrices, type Plan } from './features'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  requireAdmin: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const DAY = 86400000
const num = (v: unknown) => Number(v ?? 0) || 0
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime())
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
const r1 = (v: number) => Math.round(v * 10) / 10
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const dest = (c: string) => countryByCode(c)?.name ?? c
const city = (o: string) => String(o).split(',')[0]
const demoSql = (alias: string) => (hideDemoShippers() ? ` and ${alias}.demo = false` : '')
const kpi = (value: number | null, prev: number | null) => ({ value, prev, delta: value == null || prev == null || prev === 0 ? null : Math.round(((value - prev) / Math.abs(prev)) * 100), unit: 'pct' as const })
const days = (req: Request) => Math.max(7, Math.min(365, Number(req.query.days) || 90))
function bucketsFor(from: number, now: number, monthly: boolean) {
  const start = (t: number) => { const x = new Date(t); x.setUTCHours(0, 0, 0, 0); if (monthly) x.setUTCDate(1); else x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime() }
  const out: number[] = []; let t = start(from); while (t <= now) { out.push(t); const x = new Date(t); if (monthly) x.setUTCMonth(x.getUTCMonth() + 1); else x.setUTCDate(x.getUTCDate() + 7); t = x.getTime() }
  return { list: out, idx: (v: number) => out.indexOf(start(v)) }
}

/* ============================== scorecards ============================== */
export interface StandingRules { auto: boolean; warn: number; probation: number; pause: number }
const DEFAULT_RULES: StandingRules = { auto: true, warn: 60, probation: 45, pause: 30 }
async function rules(db: Db): Promise<StandingRules> { const { rows } = await db.query<Row>(`select value from settings where id = 'standing'`); return { ...DEFAULT_RULES, ...(J(rows[0]?.value) ?? {}) } }

export async function computeScorecards(db: Db) {
  const since = new Date(Date.now() - 90 * DAY)
  const { rows: sh } = await db.query<Row>(`select id, name, rating, reviews, verified, plan, standing, standing_note, standing_locked, demo, quality from shippers where id <> 'ship-sync-sourcing'`)
  const { rows: q } = await db.query<Row>(`select q.shipper_id, q.status, extract(epoch from (q.sent_at - r.created_at)) / 3600 as h from quotes q join requests r on r.id = q.request_id where q.sent_at >= $1`, [since])
  const { rows: s } = await db.query<Row>(`select shipper_id, status, cancelled_at, delivered_at, eta_original, eta, created_at from shipments where created_at >= $1 or delivered_at >= $1`, [since])
  const { rows: dsp } = await db.query<Row>(`select shipper_id, count(*)::int as n from disputes where created_at >= $1 group by shipper_id`, [since])
  const { rows: rv } = await db.query<Row>(`select shipper_id, avg(rating)::float as a, count(*)::int as n from reviews where created_at >= $1 and status <> 'hidden' group by shipper_id`, [since])
  const cards = sh.map((x) => {
    const mq = q.filter((y) => y.shipper_id === x.id); const ms_ = s.filter((y) => y.shipper_id === x.id)
    const hrs = mq.map((y) => num(y.h)).filter((h) => h >= 0)
    const decided = mq.filter((y) => ['accepted', 'declined', 'expired'].includes(y.status)); const won = mq.filter((y) => y.status === 'accepted'); const withdrawn = mq.filter((y) => y.status === 'withdrawn')
    const delivered = ms_.filter((y) => y.status === 'delivered' && y.delivered_at && ms(y.delivered_at) >= since.getTime())
    const onTime = delivered.filter((y) => ms(y.delivered_at) <= ms(y.eta_original ?? y.eta) + 1.5 * DAY)
    const booked = ms_.filter((y) => ms(y.created_at) >= since.getTime()); const cancelled = booked.filter((y) => y.cancelled_at)
    const disputes = dsp.find((y) => y.shipper_id === x.id)?.n ?? 0; const rec = rv.find((y) => y.shipper_id === x.id)
    const rating = rec && rec.n >= 3 ? rec.a : num(x.rating)
    const m = {
      quotes: mq.length, replyMedianH: hrs.length ? r1(median(hrs)!) : null, winRatePct: pct(won.length, decided.length), withdrawPct: pct(withdrawn.length, mq.length),
      delivered: delivered.length, onTimePct: pct(onTime.length, delivered.length), bookings: booked.length, cancelPct: pct(cancelled.length, booked.length),
      disputes, disputePct: pct(disputes, Math.max(delivered.length, 1)), rating: r1(rating), reviews: rec?.n ?? 0,
    }
    const enough = mq.length >= 5 || delivered.length >= 3
    const part = {
      reply: m.replyMedianH == null ? 0.5 : Math.max(0, Math.min(1, 1 - Math.log2(Math.max(1, m.replyMedianH) / 2) / Math.log2(12))),
      onTime: m.onTimePct == null ? 0.6 : Math.max(0, Math.min(1, (m.onTimePct - 60) / 38)),
      rating: Math.max(0, Math.min(1, (rating - 3) / 1.9)),
      disputes: Math.max(0, 1 - (m.disputePct ?? 0) / 12), cancels: Math.max(0, 1 - (m.cancelPct ?? 0) / 20), withdraws: Math.max(0, 1 - (m.withdrawPct ?? 0) / 40),
      win: m.winRatePct == null ? 0.5 : Math.min(1, m.winRatePct / 45),
    }
    const score = Math.round(part.reply * 20 + part.onTime * 25 + part.rating * 20 + part.disputes * 10 + part.cancels * 10 + part.withdraws * 5 + part.win * 10)
    return { id: x.id, name: x.name, verified: !!x.verified, plan: x.plan as Plan, demo: !!x.demo, standing: x.standing ?? 'good', note: x.standing_note ?? '', locked: !!x.standing_locked, enough, score: enough ? score : null, parts: Object.fromEntries(Object.entries(part).map(([k, v]) => [k, Math.round(v * 100)])), metrics: m, previous: J(x.quality)?.score ?? null }
  })
  const ranked = cards.filter((c) => c.score != null).sort((a, b) => b.score! - a.score!)
  ranked.forEach((c, i) => Object.assign(c, { rank: i + 1 }))
  return { cards: cards.map((c) => ({ ...c, rank: (c as Row).rank ?? null, of: ranked.length, tier: c.score == null ? 'new' : c.score >= 80 ? 'top' : c.score >= 60 ? 'good' : c.score >= 45 ? 'watch' : 'at_risk' })), rules: await rules(db) }
}
/** Store scores on shippers and apply automatic standing (never pauses on its own — that's a human call). */
export async function sweepScorecards(db: Db) {
  const { cards, rules: R } = await computeScorecards(db)
  for (const c of cards) {
    await db.query('update shippers set quality = $2 where id = $1', [c.id, JSON.stringify({ score: c.score, tier: c.tier, metrics: c.metrics, parts: c.parts, rank: c.rank, of: c.of, computedAt: new Date().toISOString() })])
    if (!R.auto || c.locked || c.score == null || c.standing === 'paused') continue
    const next = c.score < R.probation ? 'probation' : c.score < R.warn ? 'warning' : 'good'
    if (next === c.standing) continue
    const note = next === 'good' ? 'Back in good standing — thanks for the improvement.' : `Quality score ${c.score} is below ${next === 'probation' ? R.probation : R.warn}. ${c.metrics.onTimePct != null && c.metrics.onTimePct < 85 ? `On time ${c.metrics.onTimePct}%. ` : ''}${c.metrics.replyMedianH != null && c.metrics.replyMedianH > 8 ? `Median reply ${c.metrics.replyMedianH} h. ` : ''}${(c.metrics.disputePct ?? 0) > 5 ? `Disputes ${c.metrics.disputePct}%. ` : ''}`.trim()
    await db.query('update shippers set standing = $2, standing_note = $3, standing_at = now() where id = $1', [c.id, next, note])
    await audit(db, { actor: null, action: `Standing changed to ${next} (score ${c.score})`, entity: 'shippers', entityId: c.id, shipperId: c.id })
    if (!c.demo) await notifyShipperStaff(db, c.id, { kind: 'system', title: next === 'good' ? 'You’re back in good standing' : `Marketplace standing: ${next}`, body: note + (next === 'probation' ? ' Shippers on probation rank lower in the directory; below the pause line an admin may pause your listing.' : ''), link: '/dashboard/analytics', dedupe: `standing:${c.id}:${next}:${new Date().toISOString().slice(0, 10)}` }, ['owner'])
  }
  return cards.length
}
export function startScorecardSweeps(getDb: () => Promise<Db>) { const run = () => getDb().then(sweepScorecards).catch((e) => console.error('[scorecards]', e)); setTimeout(run, 15_000); setInterval(run, 6 * 3600_000) }

/* ============================== risk ============================== */
interface Flag { key: string; severity: 'high' | 'medium' | 'low'; kind: string; title: string; detail: string; entity: { type: string; id: string; name: string }; link: string; at: string }
const digits = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-9)
export async function riskFlags(db: Db) {
  const flags: Flag[] = []; const now = new Date().toISOString()
  const d30 = new Date(Date.now() - 30 * DAY), d60 = new Date(Date.now() - 60 * DAY)
  const { rows: names } = await db.query<Row>('select id, name from shippers'); const nm = new Map(names.map((x) => [x.id, x.name]))
  // shippers: quote-then-withdraw, cancellation and dispute spikes, refunds
  const { rows: wd } = await db.query<Row>(`select shipper_id, count(*)::int as n, count(*) filter (where status = 'withdrawn')::int as w from quotes where sent_at >= $1 group by shipper_id`, [d60])
  for (const x of wd) if (x.n >= 5 && x.w / x.n >= 0.3) flags.push({ key: `withdraw:${x.shipper_id}`, severity: x.w / x.n >= 0.5 ? 'high' : 'medium', kind: 'Shipper', title: `${nm.get(x.shipper_id)} withdraws ${pct(x.w, x.n)}% of quotes`, detail: `${x.w} of ${x.n} quotes in 60 days were pulled after sending — possible bait pricing.`, entity: { type: 'shipper', id: x.shipper_id, name: nm.get(x.shipper_id) ?? x.shipper_id }, link: `/admin?view=scorecards&q=${encodeURIComponent(nm.get(x.shipper_id) ?? '')}`, at: now })
  const spike = async (sql: string, label: string, kind: string) => {
    const { rows } = await db.query<Row>(sql, [d30, d60])
    for (const x of rows) if (x.cur >= 3 && x.cur >= 2 * Math.max(1, x.prev)) flags.push({ key: `${kind}:${x.shipper_id}:${new Date().toISOString().slice(0, 7)}`, severity: x.cur >= 6 ? 'high' : 'medium', kind: 'Shipper', title: `${nm.get(x.shipper_id)}: ${label} up to ${x.cur} in 30 days`, detail: `${x.prev} in the 30 days before.`, entity: { type: 'shipper', id: x.shipper_id, name: nm.get(x.shipper_id) ?? x.shipper_id }, link: '/admin?view=disputes', at: now })
  }
  await spike(`select shipper_id, count(*) filter (where cancelled_at >= $1)::int as cur, count(*) filter (where cancelled_at >= $2 and cancelled_at < $1)::int as prev from shipments where cancelled_at >= $2 group by shipper_id`, 'cancellations', 'cancels')
  await spike(`select shipper_id, count(*) filter (where created_at >= $1)::int as cur, count(*) filter (where created_at >= $2 and created_at < $1)::int as prev from disputes where created_at >= $2 group by shipper_id`, 'disputes', 'disputes')
  const { rows: rf } = await db.query<Row>(`select shipper_id, count(*)::int as n, coalesce(sum(amount_usd),0)::float as amt from escrow_payments where status = 'refunded' and refunded_at >= $1 group by shipper_id`, [d30])
  for (const x of rf) if (x.n >= 3) flags.push({ key: `refunds:${x.shipper_id}:${new Date().toISOString().slice(0, 7)}`, severity: 'medium', kind: 'Payments', title: `${nm.get(x.shipper_id)}: ${x.n} refunds in 30 days`, detail: `$${Math.round(x.amt).toLocaleString()} refunded.`, entity: { type: 'shipper', id: x.shipper_id, name: nm.get(x.shipper_id) ?? x.shipper_id }, link: '/admin?view=payments', at: now })
  const { rows: big } = await db.query<Row>(`select p.id, p.shipper_id, p.amount_usd, p.created_at, (select percentile_cont(0.5) within group (order by e.amount_usd) from escrow_payments e where e.shipper_id = p.shipper_id and e.status in ('held','released','paid_out'))::float as med from escrow_payments p where p.created_at >= $1 and p.status in ('pending','held')`, [d30])
  for (const x of big) if (num(x.amount_usd) >= 2000 && x.med && num(x.amount_usd) >= 3 * x.med) flags.push({ key: `bigpay:${x.id}`, severity: 'medium', kind: 'Payments', title: `Unusually large payment to ${nm.get(x.shipper_id)}`, detail: `$${Math.round(num(x.amount_usd)).toLocaleString()} — ${Math.round(num(x.amount_usd) / x.med)}× this shipper’s usual payment.`, entity: { type: 'payment', id: x.id, name: x.id }, link: '/admin?view=payments', at: ISO(x.created_at)! })
  // requests: shared contact details across accounts, bursts, junk text
  const { rows: rq } = await db.query<Row>(`select r.id, r.ref, r.user_id, r.contact_email, r.contact_phone, r.contact_name, r.description, r.quantity, r.created_at, u.email from requests r join users u on u.id = r.user_id where r.created_at >= $1`, [d30])
  const byPhone = new Map<string, Set<string>>(); const byUser = new Map<string, Row[]>()
  for (const x of rq) { const p = digits(x.contact_phone); if (p.length >= 7) { const s = byPhone.get(p) ?? new Set(); s.add(x.user_id); byPhone.set(p, s) } byUser.set(x.user_id, [...(byUser.get(x.user_id) ?? []), x]) }
  for (const [p, users] of byPhone) if (users.size >= 3) flags.push({ key: `phone:${p}`, severity: 'high', kind: 'Accounts', title: `One phone number on ${users.size} different accounts`, detail: `…${p.slice(-4)} was used by ${users.size} customer accounts in 30 days — possible duplicate or fake accounts.`, entity: { type: 'phone', id: p, name: `…${p.slice(-4)}` }, link: '/admin?view=support', at: now })
  for (const [u, list] of byUser) { const sorted = list.map((x) => ms(x.created_at)).sort((a, b) => a - b); for (let i = 0; i + 4 < sorted.length; i++) if (sorted[i + 4] - sorted[i] < DAY) { flags.push({ key: `burst:${u}:${new Date(sorted[i]).toISOString().slice(0, 10)}`, severity: 'medium', kind: 'Requests', title: `${list[0].email} posted ${list.length} requests in a day`, detail: 'Bursts like this are usually testing, scraping shippers’ prices or spam.', entity: { type: 'user', id: u, name: list[0].email }, link: '/admin?view=support', at: ISO(list[0].created_at)! }); break } }
  const junk = (t: string) => { const s = String(t ?? '').trim(); return s.length > 0 && (s.length < 6 || !/[aeiou]/i.test(s) || /(.)\1{4,}/.test(s) || /^(test|asdf|qwer|xxx)/i.test(s)) }
  for (const x of rq) if (junk(x.description) || junk(x.contact_name) || num(x.quantity) >= 200) flags.push({ key: `junk:${x.id}`, severity: 'low', kind: 'Requests', title: `Request ${x.ref} looks fake`, detail: `“${String(x.description).slice(0, 60)}” · ${x.contact_name} · qty ${x.quantity}`, entity: { type: 'request', id: x.id, name: x.ref }, link: '/admin?view=support', at: ISO(x.created_at)! })
  // off-platform attempts the message masking caught
  const { rows: mk } = await db.query<Row>(`select shipper_id, author_role, count(*)::int as n from request_messages where masked and created_at >= $1 group by shipper_id, author_role`, [d30])
  for (const x of mk) if (x.n >= 3) flags.push({ key: `masked:${x.shipper_id}:${x.author_role}:${new Date().toISOString().slice(0, 7)}`, severity: x.author_role === 'shipper' && x.n >= 6 ? 'high' : 'medium', kind: 'Off-platform', title: `${x.author_role === 'shipper' ? nm.get(x.shipper_id) : 'Customers messaging ' + nm.get(x.shipper_id)} tried to share contact details ${x.n} times`, detail: 'Phone numbers or emails were hidden from pre-booking messages. Repeated attempts suggest taking deals off the platform.', entity: { type: 'shipper', id: x.shipper_id, name: nm.get(x.shipper_id) ?? x.shipper_id }, link: `/admin?view=scorecards`, at: now })
  const { rows: dis } = await db.query<Row>('select key from risk_dismissals'); const gone = new Set(dis.map((x) => x.key))
  const rank = { high: 0, medium: 1, low: 2 }
  return flags.filter((f) => !gone.has(f.key)).sort((a, b) => rank[a.severity] - rank[b.severity])
}

/* ============================== routes ============================== */
const zAnn = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().max(1000).default(''), audience: z.enum(['all', 'shippers', 'customers']), destination: z.string().max(4).nullable().optional(), level: z.enum(['info', 'warning', 'critical']).default('info'), link: z.string().trim().max(300).default(''), startsAt: z.string().optional(), endsAt: z.string().nullable().optional(), notify: z.boolean().default(false), active: z.boolean().default(true) })
const annOut = (a: Row) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, destination: a.destination ?? null, level: a.level, link: a.link, startsAt: ISO(a.starts_at), endsAt: ISO(a.ends_at), active: !!a.active, notify: !!a.notify, createdBy: a.created_by, createdAt: ISO(a.created_at), dismissals: a.dismissals ?? undefined })
const COSTS = { email: 0.001, sms: 0.0079, smsIntl: 0.05, whatsapp: 0.03 }

export function mountAdminInsights(r: Router, d: Deps) {
  const { getDb, requireUser, requireAdmin, HttpError, wrap } = d

  /* ---------- platform analytics ---------- */
  r.get('/admin/platform', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const n = days(req); const now = Date.now(); const from = now - n * DAY; const pFrom = from - n * DAY
    const B = bucketsFor(from, now, n > 120)
    const real = demoSql('s')
    const { rows: reqs } = await db.query<Row>(`select r.id, r.user_id, r.destination, r.origin, coalesce(r.source, case when r.preferred_shipper_id is not null then 'picked' else 'marketplace' end) as source, r.status, r.created_at, (select min(q.sent_at) from quotes q where q.request_id = r.id) as first_q, (select count(*) from quotes q where q.request_id = r.id)::int as nq, exists (select 1 from shipments sh where sh.request_id = r.id) as booked from requests r join users u on u.id = r.user_id where r.created_at >= $1 ${hideDemoShippers() ? `and u.email not like '%.demo'` : ''}`, [new Date(pFrom)])
    const { rows: bk } = await db.query<Row>(`select sh.id, sh.created_at, sh.user_id, sh.destination, sh.shipper_id, (select q.price from quotes q where q.request_id = sh.request_id and q.status = 'accepted' limit 1) as price, (select sum(i.total) from invoices i where i.shipment_id = sh.id and i.status not in ('void','draft'))::float as inv from shipments sh join shippers s on s.id = sh.shipper_id where sh.created_at >= $1 and sh.cancelled_at is null ${real}`, [new Date(pFrom)])
    const { rows: esc } = await db.query<Row>(`select p.paid_at, p.fee_usd, p.amount_usd, p.sourcing_id, p.stage from escrow_payments p join shippers s on s.id = p.shipper_id where p.paid_at >= $1 and p.status in ('held','released','paid_out') ${real}`, [new Date(pFrom)])
    const { rows: ins } = await db.query<Row>(`select created_at, commission_usd from insurance_policies where created_at >= $1 and status <> 'cancelled'`, [new Date(pFrom)])
    const { rows: subs } = await db.query<Row>(`select s.plan, b.amount_usd, b.status from shippers s left join subscriptions b on b.shipper_id = s.id where s.plan <> 'starter' and s.id <> 'ship-sync-sourcing' and b.provider = 'stripe' and b.status in ('active','past_due') ${real}`) // card billing only — hand-set plans aren't collected revenue
    const { rows: users } = await db.query<Row>(`select id, role, created_at, email from users where created_at >= $1 ${hideDemoShippers() ? `and email not like '%.demo'` : ''}`, [new Date(pFrom)])
    const { rows: firstShip } = await db.query<Row>(`select user_id, min(created_at) as first from shipments where user_id is not null group by user_id`)
    const firstBy = new Map(firstShip.map((x) => [x.user_id, ms(x.first)]))
    const inP = (t: number) => t >= from; const inPrev = (t: number) => t >= pFrom && t < from
    const gmv = (f: (t: number) => boolean) => bk.filter((x) => f(ms(x.created_at))).reduce((a, x) => a + (num(x.inv) || num(x.price)), 0)
    const prices = await planPrices(db); const mrr = subs.reduce((a, x) => a + (num(x.amount_usd) || prices[x.plan as Plan] || 0), 0)
    const fees = (f: (t: number) => boolean) => ({ takeRate: esc.filter((x) => !x.sourcing_id && f(ms(x.paid_at))).reduce((a, x) => a + num(x.fee_usd), 0), sourcing: esc.filter((x) => x.sourcing_id && x.stage === 'fee' && f(ms(x.paid_at))).reduce((a, x) => a + num(x.amount_usd), 0), insurance: ins.filter((x) => f(ms(x.created_at))).reduce((a, x) => a + num(x.commission_usd), 0), subscriptions: Math.round(mrr * (n / 30)) })
    const fC = fees(inP), fP = fees(inPrev); const feeTotal = (f: Row) => Math.round(f.takeRate + f.sourcing + f.insurance + f.subscriptions)
    const custC = new Set(bk.filter((x) => inP(ms(x.created_at)) && x.user_id).map((x) => x.user_id)); const returning = [...custC].filter((u) => (firstBy.get(u) ?? Infinity) < from).length
    const ser = B.list.map((b) => ({ start: new Date(b).toISOString().slice(0, 10), requests: 0, bookings: 0, gmv: 0, customers: 0, shippers: 0 }))
    for (const x of reqs) { const i = B.idx(ms(x.created_at)); if (i >= 0) ser[i].requests++ }
    for (const x of bk) { const i = B.idx(ms(x.created_at)); if (i >= 0) { ser[i].bookings++; ser[i].gmv += num(x.inv) || num(x.price) } }
    for (const u of users) { const i = B.idx(ms(u.created_at)); if (i >= 0) { if (u.role === 'customer') ser[i].customers++; else ser[i].shippers++ } }
    const conv = (key: 'destination' | 'source') => { const m = new Map<string, Row>(); for (const x of reqs.filter((y) => inP(ms(y.created_at)))) { const k = x[key]; const a = m.get(k) ?? { key: k, label: key === 'destination' ? dest(k) : ({ marketplace: 'Marketplace', picked: 'Picked a shipper', link: 'Shipper order link', branded: 'Branded page' } as Row)[k] ?? k, requests: 0, quoted: 0, booked: 0 }; a.requests++; if (x.nq) a.quoted++; if (x.booked) a.booked++; m.set(k, a) } return [...m.values()].map((a) => ({ ...a, quotedPct: pct(a.quoted, a.requests), bookedPct: pct(a.booked, a.requests) }) as Row).sort((a, b) => b.requests - a.requests) }
    const cur = reqs.filter((x) => inP(ms(x.created_at))), prv = reqs.filter((x) => inPrev(ms(x.created_at)))
    const hrs = cur.filter((x) => x.first_q).map((x) => (ms(x.first_q) - ms(x.created_at)) / 3600000).filter((h) => h >= 0)
    res.set('Cache-Control', 'no-store')
    res.json({
      period: { days: n, from: new Date(from).toISOString(), bucket: n > 120 ? 'month' : 'week' },
      kpis: {
        gmv: kpi(Math.round(gmv(inP)), Math.round(gmv(inPrev))), fees: kpi(feeTotal(fC), feeTotal(fP)), mrr: Math.round(mrr),
        requests: kpi(cur.length, prv.length), bookings: kpi(bk.filter((x) => inP(ms(x.created_at))).length, bk.filter((x) => inPrev(ms(x.created_at))).length),
        conversionPct: kpi(pct(cur.filter((x) => x.booked).length, cur.length), pct(prv.filter((x) => x.booked).length, prv.length)),
        quotesPerRequest: cur.length ? r1(cur.reduce((a, x) => a + x.nq, 0) / cur.length) : null, hoursToFirstQuote: hrs.length ? r1(median(hrs)!) : null,
        newCustomers: kpi(users.filter((u) => u.role === 'customer' && inP(ms(u.created_at))).length, users.filter((u) => u.role === 'customer' && inPrev(ms(u.created_at))).length),
        newShippers: kpi(users.filter((u) => u.role === 'shipper' && inP(ms(u.created_at))).length, users.filter((u) => u.role === 'shipper' && inPrev(ms(u.created_at))).length),
        activeCustomers: custC.size, returningPct: pct(returning, custC.size),
      },
      feesBreakdown: [{ label: 'Payment take rate', amount: Math.round(fC.takeRate) }, { label: 'Subscriptions (pro-rated)', amount: fC.subscriptions }, { label: 'Sourcing service fees', amount: Math.round(fC.sourcing) }, { label: 'Insurance commission', amount: Math.round(fC.insurance) }],
      series: ser.map((x) => ({ ...x, gmv: Math.round(x.gmv) })), byDestination: conv('destination'), bySource: conv('source'),
    })
  }))

  /* ---------- marketplace health ---------- */
  r.get('/admin/marketplace', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const n = days(req); const from = new Date(Date.now() - n * DAY)
    const { rows: reqs } = await db.query<Row>(`select r.id, r.origin, r.destination, r.mode, r.cargo, r.status, r.created_at, (select count(*) from quotes q where q.request_id = r.id)::int as nq, (select min(q.sent_at) from quotes q where q.request_id = r.id) as first_q, exists (select 1 from shipments sh where sh.request_id = r.id) as booked from requests r join users u on u.id = r.user_id where r.created_at >= $1 ${hideDemoShippers() ? `and u.email not like '%.demo'` : ''}`, [from])
    const { rows: sh } = await db.query<Row>(`select id, destinations, modes, origins, verified from shippers where id <> 'ship-sync-sourcing' and coalesce(standing,'good') <> 'paused' ${hideDemoShippers() ? 'and demo = false' : ''}`)
    const lanes = new Map<string, Row>()
    for (const x of reqs) {
      const k = `${city(x.origin)}|${x.destination}`; const a = lanes.get(k) ?? { key: k, origin: city(x.origin), destination: x.destination, label: `${city(x.origin)} → ${dest(x.destination)}`, requests: 0, unanswered: 0, quotes: 0, booked: 0, hrs: [] as number[], modes: new Set<string>() }
      a.requests++; a.quotes += x.nq; if (!x.nq) a.unanswered++; if (x.booked) a.booked++; if (x.first_q) a.hrs.push((ms(x.first_q) - ms(x.created_at)) / 3600000); a.modes.add(x.mode); lanes.set(k, a)
    }
    const serving = (d0: string, modes: Set<string>, origin?: string) => sh.filter((s) => (J(s.destinations) ?? []).includes(d0) && [...modes].some((m) => m === 'either' || (J(s.modes) ?? []).includes(m)) && (!origin || (J(s.origins) ?? []).some((o: string) => city(o) === origin)))
    const rows = [...lanes.values()].map((a) => {
      const sup = serving(a.destination, a.modes); const local = serving(a.destination, a.modes, a.origin)
      const unPct = pct(a.unanswered, a.requests)!; const qpr = r1(a.quotes / a.requests)
      const flag = a.requests >= 3 && (local.length === 0 || sup.length <= 1) ? 'recruit' : a.requests >= 3 && unPct >= 40 ? 'unanswered' : a.requests >= 3 && qpr < 1.5 ? 'thin' : null
      return { key: a.key, label: a.label, origin: a.origin, destination: a.destination, requests: a.requests, shippers: sup.length, localShippers: local.length, verifiedShippers: sup.filter((s) => s.verified).length, unansweredPct: unPct, quotesPerRequest: qpr, bookedPct: pct(a.booked, a.requests), hoursToFirstQuote: a.hrs.length ? r1(median(a.hrs)!) : null, demandPerShipper: r1(a.requests / Math.max(1, sup.length)), flag }
    }).sort((a, b) => b.requests - a.requests)
    const dmap = new Map<string, Row>(); for (const l of rows) { const a = dmap.get(l.destination) ?? { code: l.destination, label: dest(l.destination), requests: 0, unanswered: 0, lanes: 0 }; a.requests += l.requests; a.unanswered += Math.round((l.unansweredPct * l.requests) / 100); a.lanes++; dmap.set(l.destination, a) }
    const total = reqs.length; const unanswered = reqs.filter((x) => !x.nq).length
    res.set('Cache-Control', 'no-store')
    res.json({
      period: { days: n }, kpis: { requests: total, unansweredPct: pct(unanswered, total), quotesPerRequest: total ? r1(reqs.reduce((a, x) => a + x.nq, 0) / total) : null, bookedPct: pct(reqs.filter((x) => x.booked).length, total), lanes: rows.length, gaps: rows.filter((x) => x.flag).length, activeShippers: sh.length },
      lanes: rows, destinations: [...dmap.values()].map((x) => ({ ...x, unansweredPct: pct(x.unanswered, x.requests), shippers: sh.filter((s) => (J(s.destinations) ?? []).includes(x.code)).length }) as Row).sort((a, b) => b.requests - a.requests),
      gaps: rows.filter((x) => x.flag).slice(0, 12),
    })
  }))

  /* ---------- scorecards & standing ---------- */
  r.get('/admin/scorecards', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.set('Cache-Control', 'no-store'); res.json(await computeScorecards(db)) }))
  r.post('/admin/scorecards/recompute', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); const n = await sweepScorecards(db); res.json({ ok: true, shippers: n }) }))
  r.get('/admin/standing-rules', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json({ rules: await rules(db) }) }))
  r.put('/admin/standing-rules', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const b = z.object({ auto: z.boolean(), warn: z.number().int().min(0).max(100), probation: z.number().int().min(0).max(100), pause: z.number().int().min(0).max(100) }).parse(req.body)
    if (!(b.pause <= b.probation && b.probation <= b.warn)) throw new HttpError(400, 'Keep pause ≤ probation ≤ warning.')
    await db.query(`insert into settings (id,value,updated_at) values ('standing',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(b)]); res.json({ rules: b })
  }))
  r.post('/admin/shippers/:id/standing', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const b = z.object({ standing: z.enum(['good', 'warning', 'probation', 'paused']), note: z.string().trim().max(400).default(''), lock: z.boolean().default(false) }).parse(req.body)
    const { rows } = await db.query<Row>('update shippers set standing = $2, standing_note = $3, standing_locked = $4, standing_at = now() where id = $1 returning id, name, demo', [req.params.id, b.standing, b.note, b.lock])
    if (!rows[0]) throw new HttpError(404, 'Shipper not found.')
    if (!rows[0].demo) await notifyShipperStaff(db, rows[0].id, { kind: 'system', title: b.standing === 'paused' ? 'Your marketplace listing is paused' : b.standing === 'good' ? 'You’re in good standing' : `Marketplace standing: ${b.standing}`, body: b.note || (b.standing === 'paused' ? 'You won’t receive new requests or appear in the directory until Ntemtem restores your listing. Existing shipments are not affected.' : ''), link: '/dashboard/analytics' }, ['owner'])
    void admin; res.json({ ok: true })
  }))

  /* ---------- risk ---------- */
  r.get('/admin/risk', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); const flags = await riskFlags(db); res.set('Cache-Control', 'no-store'); res.json({ flags, counts: { high: flags.filter((f) => f.severity === 'high').length, medium: flags.filter((f) => f.severity === 'medium').length, low: flags.filter((f) => f.severity === 'low').length } }) }))
  r.post('/admin/risk/dismiss', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const b = z.object({ key: z.string().min(3).max(200), note: z.string().trim().max(300).default('') }).parse(req.body)
    await db.query(`insert into risk_dismissals (key,by_name,note) values ($1,$2,$3) on conflict (key) do update set by_name = $2, note = $3, at = now()`, [b.key, admin.name, b.note]); res.json({ ok: true })
  }))

  /* ---------- messaging ---------- */
  const costs = async (db: Db) => { const { rows } = await db.query<Row>(`select value from settings where id = 'messagingCosts'`); return { ...COSTS, ...(J(rows[0]?.value) ?? {}) } as typeof COSTS }
  r.get('/admin/messaging/costs', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); res.json({ costs: await costs(db) }) }))
  r.put('/admin/messaging/costs', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = z.object({ email: z.number().min(0).max(5), sms: z.number().min(0).max(5), smsIntl: z.number().min(0).max(5), whatsapp: z.number().min(0).max(5) }).parse(req.body)
    await db.query(`insert into settings (id,value,updated_at) values ('messagingCosts',$1,now()) on conflict (id) do update set value = $1, updated_at = now()`, [JSON.stringify(b)]); res.json({ costs: b })
  }))
  r.get('/admin/messaging', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const n = Math.max(1, Math.min(180, Number(req.query.days) || 30)); const from = new Date(Date.now() - n * DAY); const now = Date.now(); const B = bucketsFor(from.getTime(), now, false)
    const C = await costs(db)
    const { rows: em } = await db.query<Row>(`select kind, email_status, email_to, last_error, at from notifications where at >= $1 and email_status is not null and email_status <> 'skipped'`, [from])
    const { rows: tx } = await db.query<Row>(`select channel, kind, status, to_phone, error, created_at from recipient_messages where created_at >= $1`, [from])
    const { rows: cp } = await db.query<Row>(`select r.channel, r.status, r.to_addr, r.error, coalesce(r.sent_at, c.created_at) as at from campaign_recipients r join campaigns c on c.id = r.campaign_id where c.created_at >= $1`, [from])
    type Rec = { channel: string; kind: string; ok: boolean; failed: boolean; to: string; error: string; at: number }
    const all: Rec[] = [
      ...em.map((x) => ({ channel: 'email', kind: x.kind, ok: x.email_status === 'sent', failed: x.email_status === 'failed', to: x.email_to ?? '', error: x.last_error ?? '', at: ms(x.at) })),
      ...tx.map((x) => ({ channel: x.channel === 'whatsapp' ? 'whatsapp' : 'sms', kind: `recipient:${x.kind}`, ok: ['sent', 'delivered'].includes(x.status), failed: x.status === 'failed', to: x.to_phone ?? '', error: x.error ?? '', at: ms(x.created_at) })),
      ...cp.map((x) => ({ channel: x.channel, kind: 'campaign', ok: x.status === 'sent', failed: x.status === 'failed', to: x.to_addr ?? '', error: x.error ?? '', at: ms(x.at) })),
    ]
    const intl = (p: string) => !/^\+?1\d{10}$/.test(String(p).replace(/[^\d+]/g, ''))
    const costOf = (x: Rec) => (!x.ok ? 0 : x.channel === 'email' ? C.email : x.channel === 'whatsapp' ? C.whatsapp : intl(x.to) ? C.smsIntl : C.sms)
    const channels = ['email', 'sms', 'whatsapp'].map((ch) => { const xs = all.filter((x) => x.channel === ch); return { channel: ch, total: xs.length, sent: xs.filter((x) => x.ok).length, failed: xs.filter((x) => x.failed).length, pending: xs.filter((x) => !x.ok && !x.failed).length, failRatePct: pct(xs.filter((x) => x.failed).length, xs.length), cost: Math.round(xs.reduce((a, x) => a + costOf(x), 0) * 100) / 100 } })
    const kinds = new Map<string, Row>(); for (const x of all) { const k = `${x.channel}|${x.kind}`; const a = kinds.get(k) ?? { channel: x.channel, kind: x.kind, total: 0, sent: 0, failed: 0 }; a.total++; if (x.ok) a.sent++; if (x.failed) a.failed++; kinds.set(k, a) }
    const bad = new Map<string, Row>(); for (const x of all.filter((y) => y.failed && y.to)) { const a = bad.get(x.to) ?? { to: x.to, channel: x.channel, failures: 0, lastError: '', lastAt: 0 }; a.failures++; if (x.at > a.lastAt) { a.lastAt = x.at; a.lastError = x.error } bad.set(x.to, a) }
    const ser = B.list.map((b) => ({ start: new Date(b).toISOString().slice(0, 10), sent: 0, failed: 0 })); for (const x of all) { const i = B.idx(x.at); if (i >= 0) { if (x.ok) ser[i].sent++; if (x.failed) ser[i].failed++ } }
    const { emailProvider } = await import('./notify'); const { smsProvider, whatsappProvider } = await import('./sms')
    res.set('Cache-Control', 'no-store')
    res.json({ period: { days: n }, providers: { email: emailProvider().label, sms: smsProvider().label, whatsapp: whatsappProvider().label }, channels, totalCost: Math.round(channels.reduce((a, c) => a + c.cost, 0) * 100) / 100, byKind: [...kinds.values()].map((k) => ({ ...k, failRatePct: pct(k.failed, k.total) }) as Row).sort((a, b) => b.total - a.total), bounced: [...bad.values()].sort((a, b) => b.failures - a.failures).slice(0, 25).map((x) => ({ ...x, lastAt: new Date(x.lastAt).toISOString() })), series: ser, costs: C })
  }))

  /* ---------- announcements ---------- */
  r.get('/admin/announcements', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); const { rows } = await db.query<Row>(`select a.*, (select count(*) from announcement_dismissals d where d.announcement_id = a.id)::int as dismissals from announcements a order by a.created_at desc limit 100`); res.json({ announcements: rows.map(annOut) }) }))
  r.post('/admin/announcements', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req); const b = zAnn.parse(req.body); const id = 'ann_' + uid()
    await db.query(`insert into announcements (id,title,body,audience,destination,level,link,starts_at,ends_at,active,notify,created_by) values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()),$9,$10,$11,$12)`, [id, b.title, b.body, b.audience, b.destination || null, b.level, b.link, b.startsAt || null, b.endsAt || null, b.active, b.notify, admin.name])
    let notified = 0
    if (b.notify) {
      const { rows: us } = await db.query<Row>(`select u.id from users u left join shippers s on s.id = u.shipper_id where ($1 = 'all' or ($1 = 'shippers' and u.role = 'shipper') or ($1 = 'customers' and u.role = 'customer')) and ($2::text is null or (u.role = 'shipper' and s.destinations::text like '%' || $2 || '%') or (u.role = 'customer' and exists (select 1 from requests r where r.user_id = u.id and r.destination = $2))) limit 2000`, [b.audience, b.destination || null])
      for (const u of us) if (await notify(db, { userId: u.id, kind: 'system', title: b.title, body: b.body, link: b.link || undefined, dedupe: `ann:${id}` })) notified++
    }
    res.status(201).json({ id, notified })
  }))
  r.patch('/admin/announcements/:id', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const b = zAnn.partial().parse(req.body)
    const { rows } = await db.query<Row>(`update announcements set title = coalesce($2, title), body = coalesce($3, body), level = coalesce($4, level), active = coalesce($5, active), ends_at = case when $6::text = 'clear' then null when $6::text is null then ends_at else $6::timestamptz end where id = $1 returning *`, [req.params.id, b.title ?? null, b.body ?? null, b.level ?? null, b.active ?? null, b.endsAt === null ? 'clear' : b.endsAt ?? null])
    if (!rows[0]) throw new HttpError(404, 'Announcement not found.'); res.json({ announcement: annOut(rows[0]) })
  }))
  r.delete('/admin/announcements/:id', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); await db.query('delete from announcements where id = $1', [req.params.id]); res.json({ ok: true }) }))
  r.get('/announcements', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { rows } = await db.query<Row>(`select a.* from announcements a where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now()) and (a.audience = 'all' or (a.audience = 'shippers' and $2 = 'shipper') or (a.audience = 'customers' and $2 = 'customer')) and not exists (select 1 from announcement_dismissals d where d.announcement_id = a.id and d.user_id = $1) order by case a.level when 'critical' then 0 when 'warning' then 1 else 2 end, a.created_at desc limit 5`, [u.id, u.role])
    let list = rows
    if (rows.some((a) => a.destination)) {
      let dests: string[] = []
      if (u.shipperId) { const { rows: s } = await db.query<Row>('select destinations from shippers where id = $1', [u.shipperId]); dests = J(s[0]?.destinations) ?? [] }
      else { const { rows: rq } = await db.query<Row>('select distinct destination from requests where user_id = $1', [u.id]); dests = rq.map((x) => x.destination) }
      list = rows.filter((a) => !a.destination || dests.includes(a.destination))
    }
    res.json({ announcements: list.map((a) => { const o = annOut(a); return { id: o.id, title: o.title, body: o.body, level: o.level, link: o.link } }) })
  }))
  r.post('/announcements/:id/dismiss', wrap(async (req, res) => { const db = await getDb(); const u = await requireUser(db, req); await db.query('insert into announcement_dismissals (announcement_id,user_id) values ($1,$2) on conflict do nothing', [req.params.id, u.id]); res.json({ ok: true }) }))
}
