/**
 * Analytics & lane intelligence — what the whole marketplace knows about a lane, anonymised:
 * typical price (p25 / median / p75 of quotes), quoted and actual transit, demand per week,
 * win rate by price band. Public benchmarks help customers sanity-check a quote; the shipper view
 * adds "you vs the market" on every lane you quote, and the busiest lanes you don't serve yet.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import type { Db } from './db'
import type { ApiUser } from './api'
import { cargoLabel, countryByCode, type CargoType } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const r0 = (n: number) => Math.round(n)
const pct = (sorted: number[], p: number) => { if (!sorted.length) return null; const i = (sorted.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return r0(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) }
const city = (origin: string) => origin.split(',')[0].trim()
const weekKey = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
const last12 = () => { const out: string[] = []; const now = new Date(); for (let i = 11; i >= 0; i--) out.push(weekKey(new Date(now.getTime() - i * 7 * 86400000))); return out }

interface Filter { origin?: string | null; destination?: string | null; cargo?: string | null; mode?: string | null }
const laneWhere = (f: Filter, params: unknown[], prefix = 'r') => {
  const w: string[] = []
  if (f.origin) { params.push(`${f.origin.toLowerCase()}%`); w.push(`lower(${prefix}.origin) like $${params.length}`) }
  if (f.destination) { params.push(f.destination.toUpperCase()); w.push(`${prefix}.destination = $${params.length}`) }
  if (f.cargo) { params.push(f.cargo); w.push(`${prefix}.cargo = $${params.length}`) }
  if (f.mode && f.mode !== 'either') { params.push(f.mode); w.push(`(${prefix}.mode = $${params.length} or ${prefix}.mode = 'either')`) }
  return w.length ? ' and ' + w.join(' and ') : ''
}

/** Price, transit, demand and win-rate benchmarks for a lane over the last 180 days. */
export async function benchmark(db: Db, f: Filter) {
  const params: unknown[] = []; const where = laneWhere(f, params)
  const { rows: quotes } = await db.query<Row>(`select q.price, q.transit_days, q.status, q.shipper_id, q.sent_at, r.mode, r.cargo from quotes q join requests r on r.id = q.request_id where q.sent_at > now() - interval '180 days'${where}`, params)
  const prices = quotes.map((q) => Number(q.price)).sort((a, b) => a - b)
  const median = pct(prices, 0.5), p25 = pct(prices, 0.25), p75 = pct(prices, 0.75)
  const transit = quotes.map((q) => Number(q.transit_days)).sort((a, b) => a - b)
  const decided = quotes.filter((q) => q.status === 'accepted' || q.status === 'declined')
  const band = (lo: number | null, hi: number | null) => { const b = decided.filter((q) => (lo == null || Number(q.price) >= lo) && (hi == null || Number(q.price) < hi)); return { n: b.length, winRate: b.length ? Math.round((b.filter((q) => q.status === 'accepted').length / b.length) * 100) : null } }
  const params2: unknown[] = []; const where2 = laneWhere(f, params2)
  const { rows: reqs } = await db.query<Row>(`select r.created_at, r.cargo, r.destination, r.origin from requests r where r.created_at > now() - interval '84 days'${where2}`, params2)
  const weeks = last12(); const counts = Object.fromEntries(weeks.map((w) => [w, 0])) as Record<string, number>
  for (const r of reqs) { const k = weekKey(new Date(r.created_at)); if (k in counts) counts[k]++ }
  const series = weeks.map((w) => counts[w]); const recent = series.slice(-4).reduce((a, b) => a + b, 0), prior = series.slice(-8, -4).reduce((a, b) => a + b, 0)
  const params3: unknown[] = []; const where3 = laneWhere(f, params3, 's')
  const { rows: actual } = await db.query<Row>(`select s.departed_at, (select min(e.at) from shipment_events e where e.shipment_id = s.id and e.status = 'delivered') as delivered_at from shipments s where s.departed_at is not null and s.status = 'delivered'${where3}`, params3)
  const actualDays = actual.filter((a) => a.delivered_at).map((a) => Math.round((new Date(a.delivered_at).getTime() - new Date(a.departed_at).getTime()) / 86400000)).filter((d) => d > 0 && d < 200).sort((a, b) => a - b)
  const shippers = new Set(quotes.map((q) => q.shipper_id)).size
  return {
    sample: { quotes: quotes.length, shippers, requests: reqs.length, delivered: actualDays.length },
    price: { p25, median, p75, min: prices[0] ?? null, max: prices[prices.length - 1] ?? null },
    transit: { quotedMedian: pct(transit, 0.5), quotedP25: pct(transit, 0.25), quotedP75: pct(transit, 0.75), actualMedian: pct(actualDays, 0.5) },
    demand: { weeks, series, recent4: recent, prior4: prior, trendPct: prior ? Math.round(((recent - prior) / prior) * 100) : recent ? 100 : 0 },
    winRate: { overall: decided.length ? Math.round((decided.filter((q) => q.status === 'accepted').length / decided.length) * 100) : null, decided: decided.length, belowMedian: band(null, median), aboveMedian: band(median, null), aboveP75: band(p75, null) },
  }
}

/** Busiest lanes on the platform (requests in the last 84 days), with median price and shipper count. */
export async function topLanes(db: Db, limit = 12) {
  const { rows } = await db.query<Row>(`select l.origin, l.destination, l.cargo, l.requests, (select count(distinct q.shipper_id) from quotes q join requests r2 on r2.id = q.request_id where split_part(r2.origin, ',', 1) = l.origin and r2.destination = l.destination and r2.cargo = l.cargo)::int as shippers
    from (select split_part(r.origin, ',', 1) as origin, r.destination, r.cargo, count(*)::int as requests from requests r where r.created_at > now() - interval '84 days' group by 1, 2, 3) l order by l.requests desc limit $1`, [limit])
  const out = []
  for (const l of rows) {
    const { rows: q } = await db.query<Row>(`select q.price from quotes q join requests r on r.id = q.request_id where split_part(r.origin, ',', 1) = $1 and r.destination = $2 and r.cargo = $3 and q.sent_at > now() - interval '180 days'`, [l.origin, l.destination, l.cargo])
    const prices = q.map((x) => Number(x.price)).sort((a, b) => a - b)
    out.push({ origin: l.origin, destination: l.destination, destinationName: countryByCode(l.destination)?.name ?? l.destination, cargo: l.cargo, cargoLabel: cargoLabel(l.cargo as CargoType), requests: l.requests, shippers: l.shippers, median: pct(prices, 0.5), quotes: prices.length })
  }
  return out
}

export function mountLanes(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const filt = (q: Request['query']): Filter => ({ origin: typeof q.origin === 'string' ? city(q.origin) : null, destination: typeof q.destination === 'string' && q.destination.length === 2 ? q.destination : null, cargo: typeof q.cargo === 'string' && q.cargo ? q.cargo : null, mode: typeof q.mode === 'string' ? q.mode : null })

  r.get('/lanes/benchmark', wrap(async (req, res) => { const db = await getDb(); res.set('Cache-Control', 'no-store'); res.json({ filter: filt(req.query), benchmark: await benchmark(db, filt(req.query)) }) }))
  /** Home-page destination cards: typical price per barrel to each country (median of the last 180 days' quotes,
   *  per barrel). Countries with fewer than 3 quotes get no figure rather than a misleading one. */
  r.get('/lanes/destinations', wrap(async (_req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>(`select r.destination, q.price::float / greatest(coalesce(r.quantity, 1), 1) as unit
      from quotes q join requests r on r.id = q.request_id where r.cargo = 'barrels' and q.sent_at > now() - interval '180 days' and q.price > 0`)
    const by = new Map<string, number[]>()
    for (const x of rows) { const l = by.get(x.destination) ?? []; l.push(Number(x.unit)); by.set(x.destination, l) }
    const out: Record<string, { barrelUsd: number | null; quotes: number }> = {}
    for (const [d, l] of by) { l.sort((m, n) => m - n); out[d] = { barrelUsd: l.length >= 3 ? Math.round((pct(l, 0.5) ?? 0) / 5) * 5 : null, quotes: l.length } }
    res.set('Cache-Control', 'public, max-age=600'); res.json({ destinations: out })
  }))
  r.get('/lanes/top', wrap(async (_req, res) => { const db = await getDb(); res.set('Cache-Control', 'no-store'); res.json({ lanes: await topLanes(db) }) }))
  /** The shipper's lanes vs the market, plus demand they don't serve. */
  r.get('/shipper/lanes', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || u.staffRole === 'driver') throw new HttpError(403, 'Office staff only.')
    const { rows: mine } = await db.query<Row>(`select split_part(r.origin, ',', 1) as origin, r.destination, r.cargo, count(*)::int as quotes, sum(case when q.status = 'accepted' then 1 else 0 end)::int as won, sum(case when q.status in ('accepted','declined') then 1 else 0 end)::int as decided, avg(q.price)::float as avg_price, avg(q.transit_days)::float as avg_transit,
        avg(extract(epoch from (q.sent_at - r.created_at)) / 3600)::float as response_h
      from quotes q join requests r on r.id = q.request_id where q.shipper_id = $1 and q.sent_at > now() - interval '180 days' group by 1, 2, 3 order by quotes desc limit 20`, [u.shipperId])
    const lanes = []
    for (const l of mine) {
      const b = await benchmark(db, { origin: l.origin, destination: l.destination, cargo: l.cargo })
      const myMedianQ = (await db.query<Row>(`select q.price from quotes q join requests r on r.id = q.request_id where q.shipper_id = $1 and split_part(r.origin, ',', 1) = $2 and r.destination = $3 and r.cargo = $4 and q.sent_at > now() - interval '180 days'`, [u.shipperId, l.origin, l.destination, l.cargo])).rows.map((x) => Number(x.price)).sort((a, b) => a - b)
      const myMedian = pct(myMedianQ, 0.5); const vsMarket = myMedian != null && b.price.median ? Math.round(((myMedian - b.price.median) / b.price.median) * 100) : null
      const myWin = l.decided ? Math.round((l.won / l.decided) * 100) : null
      let tip = ''
      if (vsMarket != null && vsMarket > 15 && myWin != null && b.winRate.overall != null && myWin < b.winRate.overall) tip = `You quote ~${vsMarket}% above the market median and win less often than average — a price nearer $${b.price.median} would likely lift your win rate.`
      else if (vsMarket != null && vsMarket < -15 && myWin != null && myWin > 60) tip = `You're ~${-vsMarket}% below the market median with a strong win rate — there may be room to raise prices toward $${b.price.median}.`
      else if (l.response_h > 24) tip = `Average reply time ${Math.round(l.response_h)}h — shippers who reply within a day win noticeably more on this lane.`
      lanes.push({ origin: l.origin, destination: l.destination, destinationName: countryByCode(l.destination)?.name ?? l.destination, cargo: l.cargo, cargoLabel: cargoLabel(l.cargo as CargoType), quotes: l.quotes, won: l.won, decided: l.decided, myWinRate: myWin, myMedian, myAvgTransit: l.avg_transit == null ? null : Math.round(l.avg_transit), responseHours: l.response_h == null ? null : Math.round(l.response_h), market: b, vsMarketPct: vsMarket, tip })
    }
    const { rows: me } = await db.query<Row>('select origins, destinations, cargo from shippers where id = $1', [u.shipperId])
    const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as string[]
    const origins = J(me[0]?.origins ?? '[]').map(city), dests = J(me[0]?.destinations ?? '[]'), cargo = J(me[0]?.cargo ?? '[]')
    const top = await topLanes(db, 25)
    const opportunities = top.filter((t) => !(origins.includes(t.origin) && dests.includes(t.destination) && cargo.includes(t.cargo))).slice(0, 8)
    res.set('Cache-Control', 'no-store')
    res.json({ lanes, opportunities, top: top.slice(0, 10), served: { origins, destinations: dests, cargo } })
  }))
}
