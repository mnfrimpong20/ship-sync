/**
 * Analytics extras: monthly targets, profit (revenue − allocated costs − overhead), demand forecast,
 * per-person team scorecards and the shipper's marketplace standing. Computed alongside the main
 * analytics response; adds its own insights.
 *   PUT /shipper/targets { bookings, revenue, winRatePct, onTimePct }  (owners & dispatchers)
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'
import { allocate, COST_CATEGORIES } from './costs'
import { countryByCode } from '../src/lib/data'
import type { Insight } from './analytics'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const DAY = 86400000
const num = (v: unknown) => Number(v ?? 0) || 0
const J = <T,>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v) as T } catch { return d } } return v as T }
const ms = (v: unknown) => (v == null ? NaN : v instanceof Date ? v.getTime() : new Date(String(v).length === 10 ? `${v}T12:00:00Z` : String(v)).getTime())
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
const r1 = (v: number) => Math.round(v * 10) / 10
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const laneName = (o: string, d: string) => `${String(o).split(',')[0]} → ${countryByCode(d)?.name ?? d}`
const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`

export interface Targets { bookings?: number | null; revenue?: number | null; winRatePct?: number | null; onTimePct?: number | null }
export const zTargets = z.object({ bookings: z.number().int().min(0).max(100000).nullable().optional(), revenue: z.number().min(0).max(100_000_000).nullable().optional(), winRatePct: z.number().min(0).max(100).nullable().optional(), onTimePct: z.number().min(0).max(100).nullable().optional() })

interface Ctx { days: number; from: number; now: number; eligible: Row[]; quotesBy: Map<string, Row[]>; ships: Row[]; shipsAll: Row[]; evBy: Map<string, Row[]>; deliveredAt: (s: Row) => number; sales: Row | null; finance: Row | null; operations: Row | null; bucketStart: (t: number) => number; buckets: number[] }

export async function extrasFor(db: Db, u: ApiUser, c: Ctx) {
  const sid = u.shipperId!; const insights: Insight[] = []
  const { rows: [me] } = await db.query<Row>('select prefs, quality, standing, standing_note, destinations, modes, cargo from shippers where id = $1', [sid])
  const prefs = J<Row>(me?.prefs, {}); const manager = ['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')

  /* ---------------- targets (this calendar month) ---------------- */
  const t: Targets = prefs.targets ?? {}
  const n0 = new Date(); const mStart = Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth(), 1); const dim = new Date(Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth() + 1, 0)).getUTCDate(); const dom = n0.getUTCDate()
  const inM = (x: number) => x >= mStart && x <= c.now
  const bookedM = c.shipsAll.filter((s) => !s.cancelled_at && inM(ms(s.created_at))).length
  const { rows: [revM] } = await db.query<Row>(`select coalesce(sum(total),0)::float as t from invoices where shipper_id = $1 and status not in ('void','draft') and issued_at >= $2`, [sid, new Date(mStart).toISOString().slice(0, 10)])
  const { rows: [qM] } = await db.query<Row>(`select count(*) filter (where status = 'accepted')::int as won, count(*) filter (where status in ('accepted','declined','expired'))::int as decided from quotes where shipper_id = $1 and sent_at >= $2`, [sid, new Date(mStart)])
  const delM = c.shipsAll.filter((s) => s.status === 'delivered' && !s.cancelled_at && inM(c.deliveredAt(s)))
  const okM = delM.filter((s) => c.deliveredAt(s) <= ms(s.eta_original ?? s.eta) + DAY).length
  const proj = (v: number) => Math.round((v / Math.max(1, dom)) * dim)
  const row = (key: string, label: string, target: number | null | undefined, actual: number | null, projected: number | null, unit: '' | '$' | '%') => {
    if (target == null) return { key, label, target: null, actual, projected, unit, status: 'unset' as const, pct: null }
    const basis = projected ?? actual ?? 0
    return { key, label, target, actual, projected, unit, pct: target ? Math.round(((actual ?? 0) / target) * 100) : null, status: (actual ?? 0) >= target ? 'achieved' as const : basis >= target ? 'on_track' as const : basis >= target * 0.85 ? 'close' as const : 'behind' as const }
  }
  const targets = {
    month: new Date(mStart).toISOString().slice(0, 7), dayOfMonth: dom, daysInMonth: dim, canEdit: manager,
    rows: [
      row('bookings', 'Bookings', t.bookings, bookedM, proj(bookedM), ''),
      row('revenue', 'Revenue invoiced', t.revenue, Math.round(num(revM?.t)), proj(num(revM?.t)), '$'),
      row('winRatePct', 'Win rate', t.winRatePct, pct(num(qM?.won), num(qM?.decided)), null, '%'),
      row('onTimePct', 'On-time delivery', t.onTimePct, pct(okM, delM.length), null, '%'),
    ],
  }
  const behind = targets.rows.filter((r) => r.status === 'behind')
  if (behind.length && dom >= 7) insights.push({ id: 'targets', tone: 'warning', area: 'sales', weight: 68, title: `Behind on ${behind.map((b) => b.label.toLowerCase()).join(' and ')} this month`, body: behind.map((b) => `${b.label}: ${b.unit === '$' ? money(b.actual ?? 0) : `${b.actual ?? 0}${b.unit}`}${b.projected != null ? ` (on pace for ${b.unit === '$' ? money(b.projected) : b.projected})` : ''} against ${b.unit === '$' ? money(b.target!) : `${b.target}${b.unit}`}`).join(' · '), action: { label: 'See targets', to: '/dashboard/analytics' } })

  /* ---------------- profit ---------------- */
  let profit: Row | null = null
  if (c.finance) {
    const { byShip, overhead, unallocated } = await allocate(db, sid)
    const { rows: inv } = await db.query<Row>(`select i.shipment_id, i.client_id, i.total, i.issued_at, cl.name as client_name from invoices i left join clients cl on cl.id = i.client_id where i.shipper_id = $1 and i.status not in ('void','draft') and i.issued_at >= $2`, [sid, new Date(c.from).toISOString().slice(0, 10)])
    const shipById = new Map(c.shipsAll.map((s) => [s.id, s]))
    const revBy = new Map<string, { rev: number; client: string; clientId: string; at: number }>()
    for (const i of inv) if (i.shipment_id) { const x = revBy.get(i.shipment_id) ?? { rev: 0, client: i.client_name ?? 'Client', clientId: i.client_id, at: ms(i.issued_at) }; x.rev += num(i.total); revBy.set(i.shipment_id, x) }
    const unlinkedRev = inv.filter((i) => !i.shipment_id).reduce((a, i) => a + num(i.total), 0)
    const agg = () => ({ revenue: 0, cost: 0, n: 0 })
    const lanes = new Map<string, Row>(); const clients = new Map<string, Row>(); const conts = new Map<string, Row>(); const cats: Record<string, number> = {}
    const ser = c.buckets.map((b) => ({ start: new Date(b).toISOString().slice(0, 10), revenue: 0, cost: 0, profit: 0 }))
    let revenue = 0, direct = 0, covered = 0
    for (const [shId, x] of revBy) {
      const s = shipById.get(shId); if (!s) continue
      const cost = byShip.get(shId); const cv = cost?.total ?? 0
      revenue += x.rev; direct += cv; if (cost) covered++
      for (const [k, v] of Object.entries(cost?.byCat ?? {})) cats[k] = (cats[k] ?? 0) + v
      const lk = `${s.origin}|${s.destination}`; const l = lanes.get(lk) ?? { label: laneName(s.origin, s.destination), ...agg() }; l.revenue += x.rev; l.cost += cv; l.n++; lanes.set(lk, l)
      const cl = clients.get(x.clientId) ?? { id: x.clientId, label: x.client, ...agg() }; cl.revenue += x.rev; cl.cost += cv; cl.n++; clients.set(x.clientId, cl)
      if (s.container_id) { const ct = conts.get(s.container_id) ?? { id: s.container_id, label: s.container_id, ...agg() }; ct.revenue += x.rev; ct.cost += cv; ct.n++; conts.set(s.container_id, ct) }
      const bi = c.buckets.indexOf(c.bucketStart(x.at)); if (bi >= 0) { ser[bi].revenue += x.rev; ser[bi].cost += cv }
    }
    if (conts.size) { const { rows } = await db.query<Row>('select id, ref, number from containers where id = any($1)', [[...conts.keys()]]); for (const r of rows) { const ct = conts.get(r.id); if (ct) ct.label = `${r.ref}${r.number ? ` · ${r.number}` : ''}` } }
    const ovh = overhead.filter((o) => ms(o.incurred_on) >= c.from).reduce((a, o) => a + num(o.amount_usd), 0)
    for (const o of overhead.filter((o) => ms(o.incurred_on) >= c.from)) { const bi = c.buckets.indexOf(c.bucketStart(ms(o.incurred_on))); if (bi >= 0) ser[bi].cost += num(o.amount_usd) }
    const out = (x: Row) => ({ ...x, revenue: Math.round(x.revenue), cost: Math.round(x.cost), profit: Math.round(x.revenue - x.cost), marginPct: x.revenue ? Math.round(((x.revenue - x.cost) / x.revenue) * 100) : null })
    const gross = revenue - direct
    profit = {
      revenue: Math.round(revenue + unlinkedRev), shipmentRevenue: Math.round(revenue), directCost: Math.round(direct), grossProfit: Math.round(gross), grossMarginPct: revenue ? Math.round((gross / revenue) * 100) : null,
      overhead: Math.round(ovh), netProfit: Math.round(gross + unlinkedRev - ovh), netMarginPct: revenue + unlinkedRev ? Math.round(((gross + unlinkedRev - ovh) / (revenue + unlinkedRev)) * 100) : null,
      coveragePct: pct(covered, revBy.size), unallocated: unallocated.length,
      series: ser.map((s) => ({ ...s, revenue: Math.round(s.revenue), cost: Math.round(s.cost), profit: Math.round(s.revenue - s.cost) })),
      byLane: [...lanes.values()].map(out).sort((a, b) => b.revenue - a.revenue), byClient: [...clients.values()].map(out).sort((a, b) => b.profit - a.profit), byContainer: [...conts.values()].map(out).sort((a, b) => b.revenue - a.revenue),
      byCategory: COST_CATEGORIES.map((k) => ({ key: k.key, label: k.label, amount: Math.round(cats[k.key] ?? 0) })).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount),
    }
    if (revBy.size >= 3 && (profit.coveragePct ?? 0) < 50) insights.push({ id: 'costs-missing', tone: 'info', area: 'finance', weight: 63, title: `Only ${profit.coveragePct ?? 0}% of invoiced shipments have costs recorded`, body: 'Add what the shipping line, trucking and port charged — per container is enough — and profit by lane and client fills in.', action: { label: 'Add costs', to: '/dashboard/costs' } })
    else {
      const floor = Math.max(12, (profit.grossMarginPct ?? 0) - 12); const thin = profit.byLane.filter((l: Row) => l.n >= 3 && l.marginPct != null && l.marginPct < floor).sort((a: Row, b: Row) => a.marginPct - b.marginPct)[0]
      if (thin) insights.push({ id: 'thin-lane', tone: thin.marginPct < 0 ? 'critical' : 'warning', area: 'finance', weight: 77, title: `${thin.label} earns a ${thin.marginPct}% margin — ${profit.grossMarginPct}% overall`, body: `${money(thin.revenue)} revenue against ${money(thin.cost)} cost over ${thin.n} shipments. Raise the rate card or renegotiate trucking and port fees on this lane.`, action: { label: 'Rate cards', to: '/dashboard/rates' } })
      const loser = profit.byClient.filter((x: Row) => x.n >= 2 && x.profit < 0)[0]
      if (loser) insights.push({ id: 'loss-client', tone: 'warning', area: 'finance', weight: 66, title: `You lost ${money(-loser.profit)} on ${loser.label}`, body: `${loser.n} shipments, ${loser.marginPct}% margin. Check the price you agreed against what the move really cost.`, action: { label: 'Open client', to: `/dashboard/clients/${loser.id}` } })
      if (profit.grossMarginPct != null && revBy.size >= 5) insights.push({ id: 'margin', tone: profit.grossMarginPct >= 25 ? 'good' : 'info', area: 'finance', weight: 44, title: `Gross margin ${profit.grossMarginPct}% · net ${profit.netMarginPct ?? '—'}% after overhead`, body: `${money(profit.grossProfit)} gross profit on ${money(profit.shipmentRevenue)} of shipment revenue; overhead ${money(profit.overhead)}.` })
    }
  }

  /* ---------------- demand forecast (next 8 weeks) ---------------- */
  let forecast: Row | null = null
  if (c.sales) {
    const dests: string[] = J(me?.destinations, []); const modes: string[] = J(me?.modes, []); const cargo: string[] = J(me?.cargo, [])
    const { rows: reqs } = await db.query<Row>(`select origin, destination, mode, cargo, created_at, preferred_shipper_id from requests where created_at >= now() - interval '440 days' and (preferred_shipper_id = $1 or (preferred_shipper_id is null and destination = any($2)))`, [sid, dests.length ? dests : ['__']])
    const fit = reqs.filter((x) => x.preferred_shipper_id === sid || ((x.mode === 'either' || modes.includes(x.mode)) && (!cargo.length || cargo.includes(x.cargo))))
    const W = 7 * DAY; const wk0 = (() => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime() })()
    const idx = (t: number) => Math.floor((wk0 - t) / W) // 0 = this week, 1 = last week …
    const weeks = (list: Row[]) => { const a = Array(62).fill(0); for (const x of list) { const i = idx(ms(x.created_at)); if (i >= 0 && i < 62) a[i]++ } return a }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((p, v) => p + v, 0) / xs.length : 0)
    /** Recent 8-week average, scaled by how last year's same weeks compared with last year's equivalent of "recent". */
    const project = (w: number[]) => {
      const base = mean(w.slice(1, 9)); const recentLY = mean(w.slice(53, 61))
      return Array.from({ length: 8 }, (_, k) => {
        const c0 = 52 - (k + 1); const futureLY = mean(w.slice(Math.max(9, c0 - 2), c0 + 3))
        const factor = recentLY > 0 && futureLY > 0 ? Math.min(2, Math.max(0.5, futureLY / recentLY)) : 1
        return Math.max(0, r1(base * factor))
      })
    }
    const all = weeks(fit); const next = project(all)
    const laneMap = new Map<string, Row[]>(); for (const x of fit) { const k = `${x.origin}|${x.destination}`; laneMap.set(k, [...(laneMap.get(k) ?? []), x]) }
    const lanes = [...laneMap].map(([k, list]) => { const w = weeks(list); const n = project(w); const last8 = w.slice(1, 9).reduce((a, b) => a + b, 0); const next8 = r1(n.reduce((a, b) => a + b, 0)); const [o, dd] = k.split('|'); return { label: laneName(o, dd), last8, next8, changePct: last8 ? Math.round(((next8 - last8) / last8) * 100) : null } }).filter((l) => l.last8 + l.next8 >= 2).sort((a, b) => b.next8 - a.next8).slice(0, 6)
    const last8 = all.slice(1, 9).reduce((a, b) => a + b, 0); const next8 = r1(next.reduce((a, b) => a + b, 0))
    const qr = (c.sales.kpis?.quoteRate?.value ?? 80) / 100; const wr = (c.sales.kpis?.winRate?.value ?? 40) / 100
    forecast = {
      history: all.slice(1, 13).reverse().map((n, i) => ({ start: new Date(wk0 - (12 - i) * W).toISOString().slice(0, 10), requests: n, forecast: 0 })),
      next: next.map((n, i) => ({ start: new Date(wk0 + (i + 1) * W).toISOString().slice(0, 10), requests: 0, forecast: n })),
      last8, next8, changePct: last8 ? Math.round(((next8 - last8) / last8) * 100) : null, expectedBookings: Math.round(next8 * qr * wr), lanes, seasonal: all.slice(53, 61).some((v) => v > 0),
    }
    if (forecast.changePct != null && forecast.changePct >= 20 && next8 >= 4) insights.push({ id: 'demand-up', tone: 'info', area: 'sales', weight: 64, title: `Expect about ${Math.round(next8)} requests in the next 8 weeks (+${forecast.changePct}%)`, body: `Based on the last 8 weeks and the same weeks last year. That’s roughly ${forecast.expectedBookings} bookings at your current rates — book container space and trucks early.`, action: { label: 'Book a sailing', to: '/dashboard/sailings' } })
    if (forecast.changePct != null && forecast.changePct <= -25 && last8 >= 6) insights.push({ id: 'demand-down', tone: 'info', area: 'sales', weight: 46, title: `A quieter stretch ahead (${forecast.changePct}% requests)`, body: 'A good time for a win-back campaign or a shared-barrel offer to keep containers full.', action: { label: 'Campaigns', to: '/dashboard/campaigns' } })
  }

  /* ---------------- team scorecards ---------------- */
  const { rows: staff } = await db.query<Row>(`select id, name, role, status, last_active_at, user_id from staff where shipper_id = $1 and status <> 'inactive'`, [sid])
  const { rows: owners } = await db.query<Row>(`select u.id, u.name from users u where u.shipper_id = $1 and not exists (select 1 from staff s where s.user_id = u.id and s.shipper_id = $1) limit 1`, [sid])
  const { rows: quotes } = await db.query<Row>(`select q.sent_by, q.status, q.sent_at, r.created_at as req_at from quotes q join requests r on r.id = q.request_id where q.shipper_id = $1 and q.sent_at >= $2`, [sid, new Date(c.from)])
  const { rows: scans } = await db.query<Row>(`select by_staff_id, count(*)::int as n from scans sc join shipments s on s.id = sc.shipment_id where s.shipper_id = $1 and sc.at >= $2 group by by_staff_id`, [sid, new Date(c.from)])
  const { rows: stops } = await db.query<Row>(`select r.driver_id, st.status, count(*)::int as n from run_stops st join runs r on r.id = st.run_id where r.shipper_id = $1 and r.run_date >= $2 group by r.driver_id, st.status`, [sid, new Date(c.from).toISOString().slice(0, 10)])
  const people = [...(owners[0] ? [{ id: 'owner', name: owners[0].name, role: 'owner', status: 'active', last_active_at: null }] : []), ...staff]
  const ownerKey = staff.find((x) => x.role === 'owner')?.id ?? 'owner'
  const team = people.map((p) => {
    const mine = quotes.filter((q) => (q.sent_by ?? ownerKey) === p.id)
    const decided = mine.filter((q) => ['accepted', 'declined', 'expired'].includes(q.status)); const won = mine.filter((q) => q.status === 'accepted')
    const resp = mine.map((q) => (ms(q.sent_at) - ms(q.req_at)) / 3600000).filter((h) => h >= 0)
    const done = stops.filter((s) => s.driver_id === p.id && s.status === 'done').reduce((a, s) => a + s.n, 0); const missed = stops.filter((s) => s.driver_id === p.id && s.status === 'skipped').reduce((a, s) => a + s.n, 0)
    return { id: p.id, name: p.name, role: p.role, quotes: mine.length, won: won.length, winRate: pct(won.length, decided.length), replyMedianH: resp.length ? r1(median(resp)!) : null, scans: scans.find((s) => s.by_staff_id === p.id)?.n ?? 0, stopsDone: done, stopsMissed: missed, completionPct: pct(done, done + missed), lastActive: p.last_active_at ? new Date(p.last_active_at).toISOString() : null, you: (u.staffId ?? ownerKey) === p.id }
  }).filter((p) => p.quotes + p.scans + p.stopsDone + p.stopsMissed > 0 || p.you)
  const teamOut = manager ? team : team.filter((p) => p.you)

  /* ---------------- marketplace standing (from the platform scorecard) ---------------- */
  const q = J<Row | null>(me?.quality, null)
  const standing = q ? { score: q.score, tier: q.tier, standing: me.standing, note: me.standing_note, metrics: q.metrics, computedAt: q.computedAt, rank: q.rank ?? null, of: q.of ?? null } : null
  if (standing && ['warning', 'probation', 'paused'].includes(me.standing)) insights.push({ id: 'standing', tone: me.standing === 'warning' ? 'warning' : 'critical', area: 'operations', weight: 92, title: `Marketplace standing: ${me.standing}`, body: me.standing_note || 'Your quality score is below the marketplace minimum. Reply faster, deliver on time and resolve disputes to recover.', action: { label: 'See your scorecard', to: '/dashboard/analytics' } })

  return { targets, profit, forecast, team: teamOut, teamIsManager: manager, standing, insights }
}

export function mountAnalyticsExtras(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  r.put('/shipper/targets', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Owners and dispatchers set targets.')
    const b = zTargets.parse(req.body)
    await db.query(`update shippers set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('targets', $2::jsonb) where id = $1`, [u.shipperId, JSON.stringify(b)])
    res.json({ targets: b })
  }))
}
