/**
 * Shipper analytics — GET /shipper/analytics?days=90&origin=&cargo=
 * One pass over the shipper's requests, quotes, shipments, events, invoices, payments, reviews,
 * runs, pickups, containers and warehouse pieces for the period (plus the previous equal period
 * for deltas), returned as four sections — sales, operations, finance, customers — and a ranked
 * list of plain-language insights. Each section is gated by the person's areas.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import type { Db } from './db'
import { can, type ApiUser } from './api'
import { countryByCode, statusLabels, type ShipmentStatus } from '../src/lib/data'
import { extrasFor, mountAnalyticsExtras } from './analyticsExtras'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

const DAY = 86400000
const num = (v: unknown) => Number(v ?? 0) || 0
const ms = (v: unknown) => (v == null ? NaN : v instanceof Date ? v.getTime() : new Date(String(v).length === 10 ? `${v}T12:00:00Z` : String(v)).getTime())
const J = <T,>(v: unknown, d: T): T => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v) as T } catch { return d } } return v as T }
const r1 = (v: number) => Math.round(v * 10) / 10
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
const delta = (cur: number | null, prev: number | null) => (cur == null || prev == null ? null : prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 100))
function quantile(xs: number[], q: number) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const median = (xs: number[]) => quantile(xs, 0.5)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const kpi = (value: number | null, prev: number | null) => ({ value, prev, delta: delta(value, prev), unit: 'pct' as const })
/** For rates and ratings the change is in points, not a percentage of a percentage. */
const kpiPts = (value: number | null, prev: number | null) => ({ value, prev, delta: value == null || prev == null ? null : r1(value - prev), unit: 'pts' as const })
const laneName = (origin: string, dest: string) => `${String(origin).split(',')[0]} → ${countryByCode(dest)?.name ?? dest}`

const STAGES: { to: ShipmentStatus[]; key: string; label: string }[] = [
  { to: ['picked_up'], key: 'pickup', label: 'Booked → picked up' },
  { to: ['at_origin_port'], key: 'to_port', label: 'Picked up → at origin port' },
  { to: ['in_transit'], key: 'sailing', label: 'Waiting to depart' },
  { to: ['arrived'], key: 'transit', label: 'Ocean / air transit' },
  { to: ['customs'], key: 'arrival', label: 'Arrival → customs' },
  { to: ['ready_for_collection', 'out_for_delivery'], key: 'clearance', label: 'Customs clearance' },
  { to: ['delivered'], key: 'handover', label: 'Final mile / handover' },
]
const SPEED = [{ key: 'lt1', label: 'Under 1 h', max: 1 }, { key: '1to2', label: '1–2 h', max: 2 }, { key: '2to8', label: '2–8 h', max: 8 }, { key: '8to24', label: '8–24 h', max: 24 }, { key: 'gt24', label: 'Over 24 h', max: Infinity }]
const PRICE = [{ key: 'cheapest', label: 'Cheapest quote' }, { key: 'within5', label: 'Within 5% of cheapest' }, { key: 'within15', label: '5–15% above' }, { key: 'over15', label: 'More than 15% above' }, { key: 'alone', label: 'No competing quote' }]
const SERVICE = (d: string) => (/storage/i.test(d) ? 'Storage' : /insur/i.test(d) ? 'Insurance' : /door|deliver/i.test(d) ? 'Door delivery' : /pick/i.test(d) ? 'Pickup' : /duty|customs|clear/i.test(d) ? 'Duty & customs' : /freight|ocean|air|container|barrel|ship/i.test(d) ? 'Freight' : 'Other')
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface Insight { id: string; tone: 'good' | 'warning' | 'critical' | 'info'; area: 'sales' | 'operations' | 'finance' | 'customers'; title: string; body: string; action?: { label: string; to: string }; weight: number }

export function mountAnalytics(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d

  r.get('/shipper/analytics', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId) throw new HttpError(403, 'Shippers only.')
    if (!can(u, 'analytics') && !['owner', 'dispatcher'].includes(u.staffRole ?? 'owner')) throw new HttpError(403, 'Analytics access is needed for this.')
    if (!(await (await import('./features')).featureOn(db, 'analytics', u.shipperId))) throw new HttpError(403, 'Analytics is switched off for your account.')
    res.set('Cache-Control', 'no-store')
    res.json(await computeAnalytics(db, u, { days: Number(req.query.days) || 90, origin: String(req.query.origin ?? ''), cargo: String(req.query.cargo ?? '') }, HttpError))
  }))
  mountAnalyticsExtras(r, d)
}

/** Everything on the analytics page for one person (sections gated by their areas and the plan). Also used by the Monday report. */
export async function computeAnalytics(db: Db, u: ApiUser, q: { days: number; origin?: string; cargo?: string }, HttpError: new (status: number, message: string) => Error) {
    const sid = u.shipperId!
    const full = await (await import('./features')).hasPerk(db, sid, 'fullAnalytics')
    const access = { sales: can(u, 'leads'), operations: full && can(u, 'shipments'), finance: full && can(u, 'payments'), customers: full && can(u, 'clients') }
    const days = Math.max(7, Math.min(730, Number(q.days) || 90))
    const fOrigin = String(q.origin ?? '').trim(); const fCargo = String(q.cargo ?? '').trim()
    const now = Date.now(); const from = now - days * DAY; const pFrom = from - days * DAY
    const inP = (t: number) => t >= from && t <= now; const inPrev = (t: number) => t >= pFrom && t < from
    const monthly = days > 120
    const bucketStart = (t: number) => { const x = new Date(t); x.setUTCHours(0, 0, 0, 0); if (monthly) x.setUTCDate(1); else x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.getTime() }
    const buckets: number[] = []; { let t = bucketStart(from); while (t <= now) { buckets.push(t); const x = new Date(t); if (monthly) x.setUTCMonth(x.getUTCMonth() + 1); else x.setUTCDate(x.getUTCDate() + 7); t = x.getTime() } }
    const bIndex = (t: number) => { const s = bucketStart(t); return buckets.indexOf(s) }
    const series = <T extends object>(mk: () => T) => buckets.map((b) => ({ start: new Date(b).toISOString().slice(0, 10), ...mk() }))

    const { rows: [me] } = await db.query<Row>('select * from shippers where id = $1', [sid])
    if (!me) throw new HttpError(404, 'Shipper not found.')
    const dests: string[] = J(me.destinations, []); const modes: string[] = J(me.modes, []); const cargoList: string[] = J(me.cargo, [])
    const fits = (q: Row) => (fOrigin ? String(q.origin) === fOrigin : true) && (fCargo ? q.cargo === fCargo : true)

    /* ------------------------------ load ------------------------------ */
    const { rows: reqs0 } = await db.query<Row>(`select r.* from requests r where r.created_at >= $1 and (r.preferred_shipper_id = $2 or (r.preferred_shipper_id is null and r.destination = any($3)))`, [new Date(pFrom), sid, dests.length ? dests : ['__']])
    const eligible = reqs0.filter((x) => x.preferred_shipper_id === sid || ((x.mode === 'either' || modes.includes(x.mode)) && (!cargoList.length || cargoList.includes(x.cargo))))
    const reqIds = eligible.map((x) => x.id)
    const { rows: allQuotes } = reqIds.length ? await db.query<Row>(`select id, request_id, shipper_id, price, transit_days, status, sent_at, kind from quotes where request_id = any($1)`, [reqIds]) : { rows: [] as Row[] }
    const quotesBy = new Map<string, Row[]>(); for (const q of allQuotes) { const a = quotesBy.get(q.request_id) ?? []; a.push(q); quotesBy.set(q.request_id, a) }
    const { rows: shipsAll } = await db.query<Row>(`select s.*, (select max(at) from shipment_events e where e.shipment_id = s.id) as last_event from shipments s where s.shipper_id = $1`, [sid])
    const ships = shipsAll.filter(fits)
    const shipIds = ships.map((s) => s.id)
    const { rows: events } = shipIds.length ? await db.query<Row>(`select shipment_id, status, at from shipment_events where shipment_id = any($1) order by at`, [shipIds]) : { rows: [] as Row[] }
    const evBy = new Map<string, Row[]>(); for (const e of events) { const a = evBy.get(e.shipment_id) ?? []; a.push(e); evBy.set(e.shipment_id, a) }
    const deliveredAt = (s: Row) => { if (s.delivered_at) return ms(s.delivered_at); const e = (evBy.get(s.id) ?? []).filter((x) => x.status === 'delivered').at(-1); return e ? ms(e.at) : s.status === 'delivered' && s.last_event ? ms(s.last_event) : NaN }

    /* ------------------------------ sales ------------------------------ */
    const sales = (() => {
      const period = (inF: (t: number) => boolean) => {
        const list = eligible.filter((x) => inF(ms(x.created_at)) && fits(x))
        let quoted = 0, won = 0, value = 0; const resp: number[] = []
        for (const x of list) { const mine = (quotesBy.get(x.id) ?? []).find((q) => q.shipper_id === sid); if (!mine) continue; quoted++; const h = (ms(mine.sent_at) - ms(x.created_at)) / 3600000; if (h >= 0) resp.push(h); if (mine.status === 'accepted') { won++; value += num(mine.price) } }
        const decided = list.filter((x) => { const mine = (quotesBy.get(x.id) ?? []).find((q) => q.shipper_id === sid); return mine && ['accepted', 'declined', 'expired', 'withdrawn'].includes(mine.status) && x.status !== 'open' }).length
        return { list, requests: list.length, quoted, won, value, resp, decided }
      }
      const cur = period(inP); const prev = period(inPrev)
      const winRate = pct(cur.won, cur.decided); const prevWin = pct(prev.won, prev.decided)
      const delivered = ships.filter((s) => s.request_id && cur.list.some((x) => x.id === s.request_id) && s.status === 'delivered').length

      type Acc = { key: string; label: string; requests: number; quoted: number; won: number; decided: number; prices: number[]; gaps: number[]; value: number }
      const acc = (key: string, label: string): Acc => ({ key, label, requests: 0, quoted: 0, won: 0, decided: 0, prices: [], gaps: [], value: 0 })
      const lanes = new Map<string, Acc>(); const cargo = new Map<string, Acc>(); const source = new Map<string, Acc>()
      const speed = SPEED.map((s) => acc(s.key, s.label)); const price = PRICE.map((p) => acc(p.key, p.label)); const kind = [acc('firm', 'Firm quotes'), acc('estimate', 'Estimates')]
      const weekday = DOW.map((d) => ({ day: d, requests: 0, resp: [] as number[] }))
      const loss = new Map<string, number>(); let missed = 0
      const ser = series(() => ({ requests: 0, quoted: 0, won: 0, value: 0 }))
      for (const x of cur.list) {
        const qs = quotesBy.get(x.id) ?? []; const mine = qs.find((q) => q.shipper_id === sid); const others = qs.filter((q) => q.shipper_id !== sid)
        const isDecided = !!mine && x.status !== 'open' && ['accepted', 'declined', 'expired', 'withdrawn'].includes(mine.status)
        const isWon = mine?.status === 'accepted'
        const lk = `${x.origin}|${x.destination}`; const lane = lanes.get(lk) ?? acc(lk, laneName(x.origin, x.destination)); lanes.set(lk, lane)
        const cg = cargo.get(x.cargo) ?? acc(x.cargo, x.cargo); cargo.set(x.cargo, cg)
        const srcKey = x.source || (x.preferred_shipper_id ? 'picked' : 'marketplace'); const sr = source.get(srcKey) ?? acc(srcKey, ({ marketplace: 'Marketplace', picked: 'Picked you directly', link: 'Your order link', branded: 'Your branded page' } as Record<string, string>)[srcKey] ?? srcKey); source.set(srcKey, sr)
        const bi = bIndex(ms(x.created_at)); if (bi >= 0) { ser[bi].requests++; if (mine) ser[bi].quoted++; if (isWon) { ser[bi].won++; ser[bi].value += num(mine!.price) } }
        const wd = weekday[new Date(ms(x.created_at)).getUTCDay()]; wd.requests++
        const bump = (a: Acc) => { a.requests++; if (mine) { a.quoted++; a.prices.push(num(mine.price)) } if (isDecided) a.decided++; if (isWon) { a.won++; a.value += num(mine!.price) } }
        bump(lane); bump(cg); bump(sr)
        if (!mine) { missed++; continue }
        const h = (ms(mine.sent_at) - ms(x.created_at)) / 3600000; if (h >= 0) wd.resp.push(h)
        const sp = speed[SPEED.findIndex((s) => h < s.max)] ?? speed[speed.length - 1]; sp.quoted++; if (isDecided) sp.decided++; if (isWon) sp.won++
        const kd = kind[mine.kind === 'estimate' ? 1 : 0]; kd.quoted++; if (isDecided) kd.decided++; if (isWon) kd.won++
        const minOther = others.length ? Math.min(...others.map((o) => num(o.price))) : null
        const medOther = others.length ? median(others.map((o) => num(o.price)))! : null
        if (medOther) { const g = (num(mine.price) / medOther - 1) * 100; lane.gaps.push(g); cg.gaps.push(g) }
        const pk = minOther == null ? 'alone' : num(mine.price) <= minOther ? 'cheapest' : num(mine.price) <= minOther * 1.05 ? 'within5' : num(mine.price) <= minOther * 1.15 ? 'within15' : 'over15'
        const pb = price.find((p) => p.key === pk)!; pb.quoted++; if (isDecided) pb.decided++; if (isWon) pb.won++
        if (isDecided && !isWon) {
          const w = others.find((o) => o.status === 'accepted')
          const reason = !w ? (x.status === 'cancelled' ? 'Client cancelled the request' : 'Client didn’t book anyone') : num(w.price) < num(mine.price) * 0.97 ? 'Undercut on price' : ms(w.sent_at) < ms(mine.sent_at) ? 'Competitor replied first' : num(w.transit_days) < num(mine.transit_days) ? 'Faster transit offered' : 'Client preference (rating, reviews)'
          loss.set(reason, (loss.get(reason) ?? 0) + 1)
        }
      }
      const out = (a: Acc) => ({ key: a.key, label: a.label, requests: a.requests, quoted: a.quoted, won: a.won, winRate: pct(a.won, a.decided), avgQuote: a.prices.length ? Math.round(mean(a.prices)!) : null, priceGapPct: a.gaps.length ? r1(mean(a.gaps)!) : null, value: a.value })
      const rate = (a: Acc) => ({ key: a.key, label: a.label, quoted: a.quoted, won: a.won, winRate: pct(a.won, a.decided) })
      const avgDeal = cur.won ? Math.round(cur.value / cur.won) : null
      return {
        kpis: {
          requests: kpi(cur.requests, prev.requests), quoted: kpi(cur.quoted, prev.quoted), quoteRate: kpiPts(pct(cur.quoted, cur.requests), pct(prev.quoted, prev.requests)), won: kpi(cur.won, prev.won),
          winRate: kpiPts(winRate, prevWin), bookedValue: kpi(cur.value, prev.value), avgDeal: kpi(avgDeal, prev.won ? Math.round(prev.value / prev.won) : null),
          responseMedianH: kpi(cur.resp.length ? r1(median(cur.resp)!) : null, prev.resp.length ? r1(median(prev.resp)!) : null), responseP90H: cur.resp.length ? r1(quantile(cur.resp, 0.9)!) : null,
          within2hPct: kpiPts(pct(cur.resp.filter((h) => h < 2).length, cur.resp.length), pct(prev.resp.filter((h) => h < 2).length, prev.resp.length)),
        },
        funnel: [{ key: 'requests', label: 'Matching requests', n: cur.requests }, { key: 'quoted', label: 'You quoted', n: cur.quoted }, { key: 'won', label: 'Won', n: cur.won }, { key: 'delivered', label: 'Delivered', n: delivered }],
        missed, missedValue: avgDeal && winRate != null ? Math.round(missed * avgDeal * (winRate / 100)) : null,
        series: ser.map((s) => ({ ...s, winRate: pct(s.won, s.quoted) })),
        byLane: [...lanes.values()].map(out).sort((a, b) => b.requests - a.requests), byCargo: [...cargo.values()].map(out).sort((a, b) => b.requests - a.requests), bySource: [...source.values()].map(out).sort((a, b) => b.requests - a.requests),
        bySpeed: speed.map(rate), byPrice: price.map(rate).filter((p) => p.quoted > 0), byKind: kind.map(rate),
        weekday: weekday.map((w) => ({ day: w.day, requests: w.requests, medianH: w.resp.length ? r1(median(w.resp)!) : null })),
        lossReasons: [...loss].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
      }
    })()

    /* ---------------------------- operations ---------------------------- */
    const operations = await (async () => {
      const booked = (f: (t: number) => boolean) => ships.filter((s) => f(ms(s.created_at)) && !s.cancelled_at)
      const deliv = (f: (t: number) => boolean) => ships.filter((s) => !s.cancelled_at && s.status === 'delivered' && f(deliveredAt(s)))
      const curD = deliv(inP), prevD = deliv(inPrev)
      const onTimeOf = (list: Row[]) => { const withEta = list.filter((s) => s.eta_original || s.eta); const ok = withEta.filter((s) => deliveredAt(s) <= ms(s.eta_original ?? s.eta) + DAY); return { n: withEta.length, ok: ok.length, pct: pct(ok.length, withEta.length), lateDays: withEta.filter((s) => !ok.includes(s)).map((s) => (deliveredAt(s) - ms(s.eta_original ?? s.eta)) / DAY) } }
      const otC = onTimeOf(curD), otP = onTimeOf(prevD)
      const d2d = (list: Row[]) => list.map((s) => (deliveredAt(s) - ms(s.created_at)) / DAY).filter((x) => x > 0)
      // stage durations (mine) and the platform's, for the same stages, as a benchmark
      const stageDur = (evs: Row[], st: ShipmentStatus[]) => { for (let i = 1; i < evs.length; i++) if (st.includes(evs[i].status)) { const dd = (ms(evs[i].at) - ms(evs[i - 1].at)) / DAY; return dd >= 0 ? dd : null } return null }
      const mineStages = STAGES.map(() => [] as number[])
      for (const s of curD) { const evs = evBy.get(s.id) ?? []; STAGES.forEach((st, i) => { const v = stageDur(evs, st.to); if (v != null) mineStages[i].push(v) }) }
      const { rows: platEv } = await db.query<Row>(`select e.shipment_id, e.status, e.at from shipment_events e join shipments s on s.id = e.shipment_id where s.shipper_id <> $1 and s.status = 'delivered' and s.created_at >= $2 order by e.shipment_id, e.at`, [sid, new Date(now - 365 * DAY)])
      const platBy = new Map<string, Row[]>(); for (const e of platEv) { const a = platBy.get(e.shipment_id) ?? []; a.push(e); platBy.set(e.shipment_id, a) }
      const platStages = STAGES.map(() => [] as number[]); for (const evs of platBy.values()) STAGES.forEach((st, i) => { const v = stageDur(evs, st.to); if (v != null) platStages[i].push(v) })
      const stages = STAGES.map((st, i) => ({ key: st.key, label: st.label, n: mineStages[i].length, medianDays: mineStages[i].length ? r1(median(mineStages[i])!) : null, p90Days: mineStages[i].length ? r1(quantile(mineStages[i], 0.9)!) : null, platformMedianDays: platStages[i].length >= 3 ? r1(median(platStages[i])!) : null }))
      const ser = series(() => ({ booked: 0, delivered: 0, onTime: 0 }))
      for (const s of booked(inP)) { const i = bIndex(ms(s.created_at)); if (i >= 0) ser[i].booked++ }
      for (const s of curD) { const i = bIndex(deliveredAt(s)); if (i >= 0) { ser[i].delivered++; if (deliveredAt(s) <= ms(s.eta_original ?? s.eta) + DAY) ser[i].onTime++ } }
      const lanes = new Map<string, { label: string; delivered: number; ok: number; d2d: number[] }>()
      for (const s of curD) { const k = `${s.origin}|${s.destination}`; const l = lanes.get(k) ?? { label: laneName(s.origin, s.destination), delivered: 0, ok: 0, d2d: [] }; l.delivered++; if (deliveredAt(s) <= ms(s.eta_original ?? s.eta) + DAY) l.ok++; l.d2d.push((deliveredAt(s) - ms(s.created_at)) / DAY); lanes.set(k, l) }
      // live board right now
      const active = ships.filter((s) => s.status !== 'delivered' && !s.cancelled_at)
      const today = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()
      const byStatus = new Map<string, { n: number; ages: number[] }>()
      for (const s of active) { const b = byStatus.get(s.status) ?? { n: 0, ages: [] }; b.n++; if (s.last_event) b.ages.push((now - ms(s.last_event)) / DAY); byStatus.set(s.status, b) }
      const late = active.filter((s) => s.eta && ms(s.eta) < today).length
      const quiet = active.filter((s) => s.last_event && now - ms(s.last_event) > 7 * DAY).length
      // runs & drivers
      const { rows: runs } = await db.query<Row>(`select r.id, r.run_date, r.driver_id, r.kind, r.status, r.distance_km, st.name as driver_name from runs r left join staff st on st.id = r.driver_id where r.shipper_id = $1 and r.run_date >= $2`, [sid, new Date(pFrom).toISOString().slice(0, 10)])
      const runIds = runs.map((x) => x.id)
      const { rows: stops } = runIds.length ? await db.query<Row>(`select run_id, status, note from run_stops where run_id = any($1)`, [runIds]) : { rows: [] as Row[] }
      const stopsBy = new Map<string, Row[]>(); for (const s of stops) { const a = stopsBy.get(s.run_id) ?? []; a.push(s); stopsBy.set(s.run_id, a) }
      const runsC = runs.filter((x) => inP(ms(x.run_date)) && x.status !== 'cancelled')
      const drivers = new Map<string, { name: string; runs: number; stops: number; done: number; skipped: number; km: number }>()
      const skipReasons = new Map<string, number>(); let tStops = 0, tDone = 0, tSkip = 0, tKm = 0
      for (const x of runsC) {
        const ss = stopsBy.get(x.id) ?? []; const k = x.driver_id ?? '—'; const dr = drivers.get(k) ?? { name: x.driver_name ?? 'Unassigned', runs: 0, stops: 0, done: 0, skipped: 0, km: 0 }
        dr.runs++; dr.stops += ss.length; dr.done += ss.filter((s) => s.status === 'done').length; dr.skipped += ss.filter((s) => s.status === 'skipped').length; dr.km += num(x.distance_km); drivers.set(k, dr)
        tStops += ss.length; tDone += ss.filter((s) => s.status === 'done').length; tSkip += ss.filter((s) => s.status === 'skipped').length; tKm += num(x.distance_km)
        for (const s of ss) if (s.status === 'skipped') { const why = String(s.note || 'No reason given').slice(0, 60); skipReasons.set(why, (skipReasons.get(why) ?? 0) + 1) }
      }
      const { rows: pickups } = await db.query<Row>(`select status, run_id, created_at, pickup_date from pickup_requests where shipper_id = $1 and created_at >= $2`, [sid, new Date(from)])
      const { rows: containers } = await db.query<Row>(`select c.id, c.status, c.size, c.created_at, (select count(*) from shipments s where s.container_id = c.id)::int as loaded from containers c where c.shipper_id = $1 and c.created_at >= $2`, [sid, new Date(from)])
      const { rows: pieces } = await db.query<Row>(`select p.received_at, p.released_at, p.site_id from pieces p join shipments s on s.id = p.shipment_id where s.shipper_id = $1 and (p.received_at >= $2 or p.site_id is not null)`, [sid, new Date(from)])
      const dwell = pieces.filter((p) => p.received_at && p.released_at && inP(ms(p.released_at))).map((p) => (ms(p.released_at) - ms(p.received_at)) / DAY)
      const { rows: disputes } = await db.query<Row>(`select reason, status, created_at from disputes where shipper_id = $1 and created_at >= $2`, [sid, new Date(pFrom)])
      const cancelled = ships.filter((s) => s.cancelled_at && inP(ms(s.cancelled_at))).length
      return {
        kpis: {
          booked: kpi(booked(inP).length, booked(inPrev).length), delivered: kpi(curD.length, prevD.length), onTimePct: kpiPts(otC.pct, otP.pct),
          avgLateDays: otC.lateDays.length ? r1(mean(otC.lateDays)!) : null,
          doorToDoorDays: kpi(d2d(curD).length ? r1(median(d2d(curD))!) : null, d2d(prevD).length ? r1(median(d2d(prevD))!) : null), doorToDoorP90: d2d(curD).length ? r1(quantile(d2d(curD), 0.9)!) : null,
          active: active.length, late, quiet, cancelled,
        },
        series: ser.map((s) => ({ ...s, onTimePct: pct(s.onTime, s.delivered) })),
        stages,
        byLane: [...lanes.values()].map((l) => ({ label: l.label, delivered: l.delivered, onTimePct: pct(l.ok, l.delivered), medianDays: r1(median(l.d2d) ?? 0) })).sort((a, b) => b.delivered - a.delivered),
        board: [...byStatus].map(([status, b]) => ({ status, label: statusLabels[status as ShipmentStatus] ?? status, n: b.n, avgAgeDays: b.ages.length ? r1(mean(b.ages)!) : null })),
        runs: { runs: runsC.length, stops: tStops, done: tDone, skipped: tSkip, completionPct: pct(tDone, tDone + tSkip), stopsPerRun: runsC.length ? r1(tStops / runsC.length) : null, kmPerStop: tStops && tKm ? r1(tKm / tStops) : null, km: Math.round(tKm) },
        drivers: [...drivers.values()].map((x) => ({ ...x, km: Math.round(x.km), completionPct: pct(x.done, x.done + x.skipped) })).sort((a, b) => b.stops - a.stops),
        skipReasons: [...skipReasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n).slice(0, 6),
        pickups: { requested: pickups.length, confirmed: pickups.filter((p) => ['confirmed', 'done'].includes(p.status)).length, cancelled: pickups.filter((p) => p.status === 'cancelled').length, onRunPct: pct(pickups.filter((p) => p.run_id).length, pickups.filter((p) => p.status !== 'cancelled').length) },
        containers: { count: containers.length, shipped: containers.filter((c) => !['booked', 'loading'].includes(c.status)).length, avgShipments: containers.length ? r1(mean(containers.map((c) => num(c.loaded)))!) : null },
        warehouse: { received: pieces.filter((p) => p.received_at && inP(ms(p.received_at))).length, inYard: pieces.filter((p) => p.site_id && !p.released_at).length, avgDwellDays: dwell.length ? r1(mean(dwell)!) : null },
        exceptions: { disputes: disputes.filter((x) => inP(ms(x.created_at))).length, disputesPrev: disputes.filter((x) => inPrev(ms(x.created_at))).length, disputeRatePct: pct(disputes.filter((x) => inP(ms(x.created_at))).length, curD.length), cancelled, skippedStops: tSkip, lateDeliveries: otC.n - otC.ok },
      }
    })()

    /* ------------------------------ finance ------------------------------ */
    const finance = await (async () => {
      const { rows: invAll } = await db.query<Row>(`select i.*, c.name as client_name, coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)::float as paid, (select max(p.at) from payments p where p.invoice_id = i.id) as paid_at from invoices i left join clients c on c.id = i.client_id where i.shipper_id = $1 and i.status not in ('void','draft')`, [sid])
      const shipById = new Map(shipsAll.map((s) => [s.id, s]))
      const inv = invAll.filter((i) => !fOrigin && !fCargo ? true : i.shipment_id && fits(shipById.get(i.shipment_id) ?? {}))
      const invIds = inv.map((i) => i.id)
      const { rows: pays } = invIds.length ? await db.query<Row>(`select invoice_id, amount, method, at from payments where invoice_id = any($1)`, [invIds]) : { rows: [] as Row[] }
      const invoiced = (f: (t: number) => boolean) => inv.filter((i) => f(ms(i.issued_at))).reduce((a, i) => a + num(i.total), 0)
      const collected = (f: (t: number) => boolean) => pays.filter((p) => f(ms(p.at))).reduce((a, p) => a + num(p.amount), 0)
      const iC = invoiced(inP), iP = invoiced(inPrev), cC = collected(inP), cP = collected(inPrev)
      const open = inv.filter((i) => num(i.total) - num(i.paid) > 0.5)
      const outstanding = open.reduce((a, i) => a + num(i.total) - num(i.paid), 0)
      const today = Date.now()
      const aging = [{ key: 'current', label: 'Not yet due', min: -Infinity, max: 0 }, { key: 'd30', label: '1–30 days late', min: 0, max: 30 }, { key: 'd60', label: '31–60 days', min: 30, max: 60 }, { key: 'd90', label: '61–90 days', min: 60, max: 90 }, { key: 'd90p', label: 'Over 90 days', min: 90, max: Infinity }].map((b) => {
        const xs = open.filter((i) => { const late = i.due_at ? (today - ms(i.due_at)) / DAY : -1; return late > b.min && late <= b.max })
        return { key: b.key, label: b.label, n: xs.length, amount: Math.round(xs.reduce((a, i) => a + num(i.total) - num(i.paid), 0)) }
      })
      const overdue = open.filter((i) => i.due_at && ms(i.due_at) < today)
      const dsoOf = (f: (t: number) => boolean) => { const xs = inv.filter((i) => i.paid_at && num(i.paid) >= num(i.total) - 0.5 && f(ms(i.paid_at))).map((i) => (ms(i.paid_at) - ms(i.issued_at)) / DAY).filter((x) => x >= 0); return xs.length ? Math.round(mean(xs)!) : null }
      const ser = series(() => ({ invoiced: 0, collected: 0 }))
      for (const i of inv) { const k = bIndex(ms(i.issued_at)); if (k >= 0) ser[k].invoiced += num(i.total) }
      for (const p of pays) { const k = bIndex(ms(p.at)); if (k >= 0) ser[k].collected += num(p.amount) }
      const services = new Map<string, number>()
      for (const i of inv.filter((x) => inP(ms(x.issued_at)))) for (const l of J<Row[]>(i.items, [])) { const k = SERVICE(String(l.description ?? '')); services.set(k, (services.get(k) ?? 0) + num(l.qty) * num(l.unit)) }
      const svcTotal = [...services.values()].reduce((a, b) => a + b, 0)
      const lanes = new Map<string, { label: string; revenue: number; shipments: number; kg: number }>()
      const clients = new Map<string, { id: string; name: string; revenue: number; outstanding: number; invoices: number; lastAt: number }>()
      for (const i of inv) {
        const s = i.shipment_id ? shipById.get(i.shipment_id) : null
        if (inP(ms(i.issued_at))) {
          if (s) { const k = `${s.origin}|${s.destination}`; const l = lanes.get(k) ?? { label: laneName(s.origin, s.destination), revenue: 0, shipments: 0, kg: 0 }; l.revenue += num(i.total); l.shipments++; l.kg += num(J<Row>(s.booking, {}).weightKg); lanes.set(k, l) }
          const c = clients.get(i.client_id) ?? { id: i.client_id, name: i.client_name ?? 'Client', revenue: 0, outstanding: 0, invoices: 0, lastAt: 0 }; c.revenue += num(i.total); c.invoices++; c.lastAt = Math.max(c.lastAt, ms(i.issued_at)); clients.set(i.client_id, c)
        }
        if (num(i.total) - num(i.paid) > 0.5) { const c = clients.get(i.client_id) ?? { id: i.client_id, name: i.client_name ?? 'Client', revenue: 0, outstanding: 0, invoices: 0, lastAt: 0 }; c.outstanding += num(i.total) - num(i.paid); clients.set(i.client_id, c) }
      }
      const methods = new Map<string, number>(); for (const p of pays.filter((x) => inP(ms(x.at)))) methods.set(p.method || 'other', (methods.get(p.method || 'other') ?? 0) + num(p.amount))
      const { rows: esc } = await db.query<Row>(`select status, amount_usd, net_usd from escrow_payments where shipper_id = $1 and created_at >= $2`, [sid, new Date(from)])
      const { rows: ins } = await db.query<Row>(`select coalesce(sum(commission_usd),0)::float as c, count(*)::int as n from insurance_policies where shipper_id = $1 and created_at >= $2 and status <> 'cancelled'`, [sid, new Date(from)])
      const nInvC = inv.filter((i) => inP(ms(i.issued_at))).length
      const kgC = [...lanes.values()].reduce((a, l) => a + l.kg, 0)
      const top = [...clients.values()].sort((a, b) => b.revenue - a.revenue)
      return {
        kpis: { invoiced: kpi(Math.round(iC), Math.round(iP)), collected: kpi(Math.round(cC), Math.round(cP)), collectionRatePct: kpiPts(pct(cC, iC), pct(cP, iP)), outstanding: Math.round(outstanding), overdue: Math.round(overdue.reduce((a, i) => a + num(i.total) - num(i.paid), 0)), overdueCount: overdue.length, dsoDays: kpi(dsoOf(inP), dsoOf(inPrev)), avgInvoice: nInvC ? Math.round(iC / nInvC) : null, revenuePerKg: kgC ? Math.round((iC / kgC) * 100) / 100 : null },
        series: ser.map((s) => ({ ...s, invoiced: Math.round(s.invoiced), collected: Math.round(s.collected) })),
        aging, byService: [...services].map(([label, amount]) => ({ label, amount: Math.round(amount), sharePct: pct(amount, svcTotal) })).sort((a, b) => b.amount - a.amount),
        byLane: [...lanes.values()].map((l) => ({ label: l.label, revenue: Math.round(l.revenue), shipments: l.shipments, perShipment: l.shipments ? Math.round(l.revenue / l.shipments) : null, perKg: l.kg ? Math.round((l.revenue / l.kg) * 100) / 100 : null })).sort((a, b) => b.revenue - a.revenue),
        topClients: top.filter((c) => c.revenue > 0).slice(0, 10).map((c) => ({ ...c, revenue: Math.round(c.revenue), outstanding: Math.round(c.outstanding), lastAt: c.lastAt ? new Date(c.lastAt).toISOString() : null })),
        owing: [...clients.values()].filter((c) => c.outstanding > 0.5).sort((a, b) => b.outstanding - a.outstanding).slice(0, 8).map((c) => ({ id: c.id, name: c.name, outstanding: Math.round(c.outstanding) })),
        concentrationPct: pct(top.slice(0, 5).reduce((a, c) => a + c.revenue, 0), iC),
        methods: [...methods].map(([method, amount]) => ({ method, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
        escrow: { held: Math.round(esc.filter((e) => e.status === 'held').reduce((a, e) => a + num(e.net_usd), 0)), released: Math.round(esc.filter((e) => e.status === 'released').reduce((a, e) => a + num(e.net_usd), 0)) },
        insurance: { policies: ins[0]?.n ?? 0, commission: Math.round(num(ins[0]?.c)) },
      }
    })()

    /* ------------------------------ customers ------------------------------ */
    const customers = await (async () => {
      const real = ships.filter((s) => !s.cancelled_at)
      const firstBy = new Map<string, number>(); const countBy = new Map<string, number>(); const lastBy = new Map<string, number>()
      const keyOf = (s: Row) => s.client_id ?? s.user_id ?? s.customer
      for (const s of real) { const k = keyOf(s); const t = ms(s.created_at); firstBy.set(k, Math.min(firstBy.get(k) ?? Infinity, t)); lastBy.set(k, Math.max(lastBy.get(k) ?? 0, t)); countBy.set(k, (countBy.get(k) ?? 0) + 1) }
      const activeIn = (f: (t: number) => boolean) => new Set(real.filter((s) => f(ms(s.created_at))).map(keyOf))
      const act = activeIn(inP), actPrev = activeIn(inPrev)
      const fresh = [...act].filter((k) => inP(firstBy.get(k)!)).length
      const repeaters = [...countBy.values()].filter((n) => n >= 2).length
      const { rows: reviews } = await db.query<Row>(`select rating, tags, created_at from reviews where shipper_id = $1 and status <> 'hidden' and created_at >= $2`, [sid, new Date(pFrom)])
      const revC = reviews.filter((x) => inP(ms(x.created_at))), revP = reviews.filter((x) => inPrev(ms(x.created_at)))
      const tags = new Map<string, number>(); for (const rv of revC) for (const t of J<string[]>(rv.tags, [])) tags.set(t, (tags.get(t) ?? 0) + 1)
      const ser = series(() => ({ reviews: 0, sum: 0 })); for (const rv of revC) { const i = bIndex(ms(rv.created_at)); if (i >= 0) { ser[i].reviews++; ser[i].sum += num(rv.rating) } }
      const { rows: names } = await db.query<Row>(`select id, name from clients where shipper_id = $1`, [sid])
      const nameOf = new Map(names.map((c) => [c.id, c.name]))
      const custName = new Map<string, string>(); for (const s of real) custName.set(keyOf(s), s.customer)
      const { rows: rev } = await db.query<Row>(`select client_id, sum(total)::float as t from invoices where shipper_id = $1 and status not in ('void','draft') and issued_at >= $2 group by client_id`, [sid, new Date(now - 365 * DAY).toISOString().slice(0, 10)])
      const revBy = new Map(rev.map((x) => [x.client_id, num(x.t)]))
      const dormant = [...countBy].filter(([k, n]) => n >= 2 && now - lastBy.get(k)! > 90 * DAY).map(([k, n]) => ({ id: String(k), name: nameOf.get(k) ?? custName.get(k) ?? 'Client', shipments: n, lastAt: new Date(lastBy.get(k)!).toISOString(), revenue12m: Math.round(revBy.get(k) ?? 0), isClient: nameOf.has(k) })).sort((a, b) => b.revenue12m - a.revenue12m).slice(0, 8)
      const srcMap = new Map<string, number>(); for (const x of eligible.filter((q) => inP(ms(q.created_at)) && q.status === 'booked')) { const won = (quotesBy.get(x.id) ?? []).some((q) => q.shipper_id === sid && q.status === 'accepted'); if (!won) continue; const k = x.source || 'marketplace'; srcMap.set(k, (srcMap.get(k) ?? 0) + 1) }
      const avg = (xs: Row[]) => (xs.length ? Math.round((xs.reduce((a, x) => a + num(x.rating), 0) / xs.length) * 10) / 10 : null)
      return {
        kpis: { active: kpi(act.size, actPrev.size), new: fresh, returning: act.size - fresh, repeatRatePct: pct(repeaters, countBy.size), shipmentsPerClient: countBy.size ? r1(real.length / countBy.size) : null, rating: kpiPts(avg(revC), avg(revP)), reviews: revC.length, lifetimeClients: countBy.size },
        ratingDist: [5, 4, 3, 2, 1].map((star) => ({ star, n: revC.filter((x) => num(x.rating) === star).length })),
        tags: [...tags].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
        ratingSeries: ser.map((s) => ({ start: s.start, reviews: s.reviews, avg: s.reviews ? r1(s.sum / s.reviews) : null })),
        dormant, wonBySource: [...srcMap].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
      }
    })()

    /* ------------------------------ insights ------------------------------ */
    const insights: Insight[] = []
    const add = (i: Insight) => insights.push(i)
    const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
    if (access.sales) {
      const fast = sales.bySpeed.filter((s) => ['lt1', '1to2'].includes(s.key)); const slow = sales.bySpeed.filter((s) => ['8to24', 'gt24'].includes(s.key))
      const rateOf = (xs: typeof fast) => { const w = xs.reduce((a, s) => a + s.won, 0); const q = xs.reduce((a, s) => a + s.quoted, 0); return { w, q, r: pct(w, q) } }
      const F = rateOf(fast), Sl = rateOf(slow)
      if (F.q >= 5 && Sl.q >= 4 && F.r != null && Sl.r != null && F.r - Sl.r >= 12) add({ id: 'speed', tone: 'info', area: 'sales', weight: 80 + (F.r - Sl.r), title: `Replies under 2 hours win ${F.r}% — slow ones win ${Sl.r}%`, body: `${sales.kpis.within2hPct.value ?? 0}% of your quotes went out within 2 hours this period. Turn on rate cards with auto-send for your common lanes so the first price lands in minutes.`, action: { label: 'Set up rate cards', to: '/dashboard/rates' } })
      const wk = sales.weekday; const wkend = [wk[0], wk[6]].map((w) => w.medianH).filter((x): x is number => x != null); const wkday = wk.slice(1, 6).map((w) => w.medianH).filter((x): x is number => x != null)
      const we = median(wkend), wd = median(wkday)
      if (we != null && wd != null && we > Math.max(4, wd * 2)) add({ id: 'weekend', tone: 'warning', area: 'sales', weight: 70, title: `Weekend requests wait ${r1(we)} h for a quote`, body: `On weekdays you answer in about ${r1(wd)} h. Clients often book with whoever replies first — an auto-sending rate card or a weekend rota would close the gap.`, action: { label: 'See requests', to: '/dashboard/leads' } })
      if (sales.missed >= 3) add({ id: 'missed', tone: 'warning', area: 'sales', weight: 75 + sales.missed, title: `${sales.missed} matching requests got no quote from you`, body: `${sales.missedValue ? `At your current win rate and deal size that is roughly ${money(sales.missedValue)} of bookings left on the table. ` : ''}They matched your destinations, modes and cargo.`, action: { label: 'Open requests', to: '/dashboard/leads' } })
      const pricey = sales.byLane.filter((l) => l.quoted >= 4 && (l.priceGapPct ?? 0) >= 6 && (l.winRate ?? 100) < (sales.kpis.winRate.value ?? 0)).sort((a, b) => (b.priceGapPct ?? 0) - (a.priceGapPct ?? 0))[0]
      if (pricey) add({ id: 'price-lane', tone: 'warning', area: 'sales', weight: 72, title: `${pricey.label}: you price ${pricey.priceGapPct}% above competing quotes`, body: `Win rate on this lane is ${pricey.winRate ?? 0}% against ${sales.kpis.winRate.value ?? 0}% overall. Check your rate card or consolidate this origin with a cheaper feeder.`, action: { label: 'Lane intelligence', to: '/dashboard/lanes' } })
      const best = [...sales.byLane].filter((l) => l.won >= 3).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0]
      if (best && (best.winRate ?? 0) >= (sales.kpis.winRate.value ?? 0) + 10) add({ id: 'best-lane', tone: 'good', area: 'sales', weight: 50, title: `${best.label} is your strongest lane — ${best.winRate}% win rate`, body: `${best.won} bookings worth ${money(best.value)}. Feature it on your branded page and a shared-barrel offer to pull more volume.`, action: { label: 'Fill a barrel', to: '/dashboard/groupage' } })
      const [firm, est] = sales.byKind
      if (firm.quoted >= 5 && est.quoted >= 4 && firm.winRate != null && est.winRate != null && firm.winRate - est.winRate >= 12) add({ id: 'firm', tone: 'info', area: 'sales', weight: 60, title: `Firm quotes win ${firm.winRate}% — estimates ${est.winRate}%`, body: 'Clients prefer a price they can count on. Where you can, confirm the weight with a photo or a quick message and send a firm price.' })
      const lostPrice = sales.lossReasons.find((l) => l.reason === 'Undercut on price'); const lostTotal = sales.lossReasons.reduce((a, l) => a + l.n, 0)
      if (lostPrice && lostTotal >= 5 && lostPrice.n / lostTotal >= 0.45) add({ id: 'undercut', tone: 'info', area: 'sales', weight: 55, title: `${pct(lostPrice.n, lostTotal)}% of lost quotes went to a cheaper shipper`, body: 'Bundle pickup and door delivery into one clear price, or offer a shared-barrel rate for small loads where you’re being undercut.' })
      const qd = sales.kpis.winRate.delta
      if (sales.kpis.won.value && qd != null && Math.abs(qd) >= 10 && (sales.kpis.won.prev ?? 0) >= 3) add({ id: 'win-trend', tone: qd > 0 ? 'good' : 'warning', area: 'sales', weight: 58, title: `Win rate ${qd > 0 ? 'up' : 'down'} ${Math.abs(qd)} points on the previous ${days} days`, body: `${sales.kpis.winRate.value}% now against ${sales.kpis.winRate.prev}% before.` })
    }
    if (access.operations) {
      const o = operations
      const bottleneck = o.stages.filter((s) => s.medianDays != null && s.platformMedianDays != null && s.medianDays - s.platformMedianDays >= 1).sort((a, b) => (b.medianDays! - b.platformMedianDays!) - (a.medianDays! - a.platformMedianDays!))[0]
      if (bottleneck) add({ id: 'bottleneck', tone: 'warning', area: 'operations', weight: 74, title: `${bottleneck.label} takes ${bottleneck.medianDays} days — platform median ${bottleneck.platformMedianDays}`, body: `That is ${r1(bottleneck.medianDays! - bottleneck.platformMedianDays!)} extra days on every shipment. The slowest 10% take ${bottleneck.p90Days} days.`, action: { label: 'Client shipments', to: '/dashboard/shipments' } })
      const ot = o.kpis.onTimePct.value
      if (ot != null && o.kpis.delivered.value! >= 4) add(ot >= 95 ? { id: 'ontime', tone: 'good', area: 'operations', weight: 40, title: `${ot}% delivered on time`, body: 'That is above the 95% target verified shippers aim for — it shows on your directory profile.' } : { id: 'ontime', tone: ot < 85 ? 'critical' : 'warning', area: 'operations', weight: 78 + (95 - ot), title: `${ot}% on time — ${o.exceptions.lateDeliveries} late deliveries`, body: `Late ones ran ${o.kpis.avgLateDays ?? 0} days over on average. Quote transit from your real lane times and push ETA changes to clients early.`, action: { label: 'Client shipments', to: '/dashboard/shipments' } })
      if (o.kpis.late > 0) add({ id: 'late-now', tone: 'critical', area: 'operations', weight: 90, title: `${o.kpis.late} active shipment${o.kpis.late === 1 ? ' is' : 's are'} past ETA right now`, body: 'Update the status or the ETA so clients aren’t left guessing.', action: { label: 'Open the board', to: '/dashboard/shipments?b=all' } })
      const weak = o.drivers.filter((x) => x.stops >= 10 && (x.completionPct ?? 100) < 90)[0]
      if (weak) add({ id: 'driver', tone: 'warning', area: 'operations', weight: 52, title: `${weak.name} completes ${weak.completionPct}% of stops`, body: `${weak.skipped} skipped of ${weak.stops}. ${o.skipReasons[0] ? `Top reason: “${o.skipReasons[0].reason}”. ` : ''}A reminder text the evening before cuts no-shows.`, action: { label: 'Routes', to: '/dashboard/routes' } })
      if ((o.exceptions.disputeRatePct ?? 0) >= 5) add({ id: 'disputes', tone: 'warning', area: 'operations', weight: 50, title: `${o.exceptions.disputes} disputes — ${o.exceptions.disputeRatePct}% of deliveries`, body: 'Photo the pieces at pickup and devanning so claims can be settled quickly.', action: { label: 'Reviews & disputes', to: '/dashboard/reviews' } })
    }
    if (access.finance) {
      const f = finance
      if (f.kpis.overdue > 0) add({ id: 'overdue', tone: 'critical', area: 'finance', weight: 88, title: `${money(f.kpis.overdue)} overdue across ${f.kpis.overdueCount} invoice${f.kpis.overdueCount === 1 ? '' : 's'}`, body: `${f.aging.find((a) => a.key === 'd90p')?.amount ? `${money(f.aging.find((a) => a.key === 'd90p')!.amount)} is over 90 days late. ` : ''}Turn on automatic reminders and use the release check to hold cargo until it’s paid.`, action: { label: 'Collections', to: '/dashboard/collections' } })
      if ((f.kpis.dsoDays.value ?? 0) > 30) add({ id: 'dso', tone: 'warning', area: 'finance', weight: 60, title: `Clients take ${f.kpis.dsoDays.value} days to pay on average`, body: 'Ask for a deposit at booking or send the pay-online link with the invoice — card and bank links get paid faster.', action: { label: 'Payments', to: '/dashboard/payments' } })
      if ((f.concentrationPct ?? 0) >= 45 && f.topClients.length >= 5) add({ id: 'concentration', tone: 'info', area: 'finance', weight: 42, title: `Your top 5 clients are ${f.concentrationPct}% of revenue`, body: 'Healthy, but losing one would hurt. Win-back campaigns to dormant clients spread the risk.' })
      const ins = f.byService.find((s) => s.label === 'Insurance')
      if ((ins?.sharePct ?? 0) < 2 && f.kpis.invoiced.value! > 0) add({ id: 'attach-ins', tone: 'info', area: 'finance', weight: 45, title: 'Few shipments carry cargo insurance', body: `Insurance is ${ins?.sharePct ?? 0}% of revenue. Offer it on every quote — you earn commission and claims get simpler.`, action: { label: 'Rate cards', to: '/dashboard/rates' } })
      const rd = f.kpis.invoiced.delta
      if (rd != null && Math.abs(rd) >= 15 && (f.kpis.invoiced.prev ?? 0) > 0) add({ id: 'revenue-trend', tone: rd > 0 ? 'good' : 'warning', area: 'finance', weight: 65, title: `Revenue ${rd > 0 ? 'up' : 'down'} ${Math.abs(rd)}% on the previous ${days} days`, body: `${money(f.kpis.invoiced.value!)} invoiced against ${money(f.kpis.invoiced.prev!)}.` })
    }
    if (access.customers) {
      const c = customers
      if (c.dormant.length >= 2) add({ id: 'dormant', tone: 'info', area: 'customers', weight: 62, title: `${c.dormant.length} repeat clients haven’t shipped in 90+ days`, body: `Together they spent ${money(c.dormant.reduce((a, x) => a + x.revenue12m, 0))} in the last year. A message before the holiday rush brings many back.`, action: { label: 'Clients', to: '/dashboard/clients' } })
      const rd = c.kpis.rating.value != null && c.kpis.rating.prev != null ? r1(c.kpis.rating.value - c.kpis.rating.prev) : null
      if (rd != null && rd <= -0.3) add({ id: 'rating', tone: 'warning', area: 'customers', weight: 66, title: `Average rating fell to ${c.kpis.rating.value}★ (from ${c.kpis.rating.prev}★)`, body: `${c.tags.filter((t) => ['Late', 'Hard to reach', 'Damaged items', 'Hidden charges'].includes(t.tag)).map((t) => `${t.tag} ×${t.n}`).join(', ') || 'Read the latest reviews'} — reply to each one publicly.`, action: { label: 'Reviews', to: '/dashboard/reviews' } })
      else if (c.kpis.rating.value != null && c.kpis.rating.value >= 4.6 && c.kpis.reviews >= 5) add({ id: 'rating', tone: 'good', area: 'customers', weight: 35, title: `${c.kpis.rating.value}★ from ${c.kpis.reviews} reviews`, body: 'Clients rate you highly — keep asking every delivered client for a review.' })
      if ((c.kpis.repeatRatePct ?? 0) >= 35) add({ id: 'repeat', tone: 'good', area: 'customers', weight: 38, title: `${c.kpis.repeatRatePct}% of your clients ship again`, body: 'Repeat clients are your cheapest bookings. A saved-recipient list and your order link make the next one one tap.', action: { label: 'Order link', to: '/dashboard/shipper' } })
    }
    insights.sort((a, b) => b.weight - a.weight)

    // filter values available
    const origins = [...new Set([...eligible.map((x) => x.origin), ...shipsAll.map((s) => s.origin)])].sort()
    const cargos = [...new Set([...eligible.map((x) => x.cargo), ...shipsAll.map((s) => s.cargo)])].sort()
    const extras = await extrasFor(db, u, { days, from, now, eligible, quotesBy, ships, shipsAll, evBy, deliveredAt, sales: access.sales ? sales : null, finance: access.finance ? finance : null, operations: access.operations ? operations : null, bucketStart, buckets })
    for (const i of extras.insights) if (access[i.area as keyof typeof access] ?? true) insights.push(i)
    insights.sort((a, b) => b.weight - a.weight)
    const { insights: _x, ...extra } = extras
    return {
      period: { days, from: new Date(from).toISOString(), to: new Date(now).toISOString(), prevFrom: new Date(pFrom).toISOString(), bucket: monthly ? 'month' : 'week' },
      filters: { origin: fOrigin || null, cargo: fCargo || null, origins, cargos },
      access, locked: !full,
      sales: access.sales ? sales : null, operations: access.operations ? operations : null, finance: access.finance ? finance : null, customers: access.customers ? customers : null,
      insights: insights.map(({ weight: _w, ...i }) => i),
      ...extra,
    }
}
