import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import { countryByCode, type CargoType, type Mode, type Shipper } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  shipperOut: (r: Row) => Shipper
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}

export type Priority = 'price' | 'speed' | 'reliability' | 'door'
export const PAGE_SIZE = 9

const zSearch = z.object({
  q: z.string().trim().max(80).default(''),
  destination: z.string().trim().max(2).default(''),
  origin: z.string().trim().max(60).default(''),
  mode: z.enum(['air', 'ocean', 'either']).default('either'),
  cargo: z.string().trim().max(20).default(''),
  verified: z.enum(['1', '0', 'true', 'false', '']).default(''),
  price: z.enum(['1', '2', '3', '']).default(''),
  sort: z.enum(['recommended', 'rating', 'reviews', 'response', 'ontime', 'newest', 'name']).default('recommended'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(3).max(30).default(PAGE_SIZE),
})
const zNeeds = z.object({
  origin: z.string().trim().max(60).default(''),
  destination: z.string().trim().length(2),
  mode: z.enum(['air', 'ocean', 'either']).default('either'),
  cargo: z.string().trim().max(20).default(''),
  priority: z.enum(['price', 'speed', 'reliability', 'door']).default('reliability'),
  urgency: z.enum(['asap', 'weeks', 'flexible']).default('weeks'),
  verifiedOnly: z.boolean().default(false),
})

/** Featured = Enterprise plan ("Featured on destination pages" in pricing); Pro gets priority placement. */
export const isFeatured = (s: Shipper) => s.plan === 'enterprise'
const planRank = (s: Shipper) => (s.plan === 'enterprise' ? 2 : s.plan === 'pro' ? 1 : 0)
const years = (s: Shipper) => new Date().getFullYear() - s.founded
const hasDoor = (s: Shipper) => s.services.some((x) => /door/i.test(x))
const country = (place: string) => place.split(', ').pop() ?? ''

function textScore(s: Shipper, q: string) {
  if (!q) return 1
  const hay = [s.name, s.tagline, s.hq, s.about, ...s.services, ...s.origins, ...s.destinations.map((d) => countryByCode(d)?.name ?? d)].join(' ').toLowerCase()
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  let hits = 0
  for (const t of terms) { if (s.name.toLowerCase().includes(t)) hits += 3; else if (hay.includes(t)) hits += 1 }
  return hits
}

/** Directory ranking when the user hasn't chosen a sort: plan tier, then verified, then rating weighted by review count. */
function recommendedScore(s: Shipper) {
  return planRank(s) * 100 + (s.verified ? 30 : 0) + s.rating * 10 + Math.min(20, Math.log10(s.reviews + 1) * 8) + s.onTime / 10 - s.responseHours
}

/** Needs-based recommendation: hard filters first, then weighted signals with human-readable reasons. */
export function recommend(all: Shipper[], n: z.infer<typeof zNeeds>) {
  const out = all.map((s) => {
    const reasons: string[] = []
    const cautions: string[] = []
    if (!s.destinations.includes(n.destination)) return null
    if (n.mode !== 'either' && !s.modes.includes(n.mode as Mode)) return null
    if (n.verifiedOnly && !s.verified) return null
    let score = 40
    reasons.push(`Serves ${countryByCode(n.destination)?.name ?? n.destination}`)
    if (n.cargo) { if (s.cargo.includes(n.cargo as CargoType)) { score += 15; reasons.push('Handles your cargo type') } else { score -= 35; cautions.push('Doesn’t list your cargo type') } }
    if (n.origin) {
      if (s.origins.includes(n.origin)) { score += 12; reasons.push(`Regular pickups in ${n.origin.split(', ')[0]}`) }
      else if (s.origins.some((o) => country(o) === country(n.origin))) { score += 5; reasons.push(`Operates in your country (${country(n.origin)})`) }
      else { score -= 20; cautions.push('No regular pickups near you') }
    }
    if (s.verified) { score += 6; reasons.push('Licence & insurance verified') } else cautions.push('Not yet verified')
    // urgency ↔ mode
    if (n.urgency === 'asap') { if (s.modes.includes('air')) { score += 10; reasons.push('Air option for urgent cargo') } else { score -= 10; cautions.push('Ocean only — allow 4–6 weeks') } }
    if (n.urgency === 'flexible' && s.priceIndex === 1) { score += 4 }
    // priority weighting
    switch (n.priority) {
      case 'price': score += (3 - s.priceIndex) * 12; if (s.priceIndex === 1) reasons.push('Budget pricing'); else if (s.priceIndex === 3) cautions.push('Premium pricing'); break
      case 'speed': score += (s.modes.includes('air') ? 10 : 0) + Math.max(0, 8 - s.responseHours) * 1.5; if (s.responseHours <= 2) reasons.push(`Replies in ~${s.responseHours}h`); break
      case 'reliability': score += (s.onTime - 88) * 1.5 + (s.rating - 4) * 15 + Math.min(10, years(s) / 2); if (s.onTime >= 95) reasons.push(`${s.onTime}% on-time record`); if (years(s) >= 10) reasons.push(`${years(s)} years in business`); break
      case 'door': if (hasDoor(s)) { score += 18; reasons.push('Door pickup / delivery included') } else { score -= 12; cautions.push('No door service listed') } break
    }
    // baseline quality
    score += (s.rating - 4) * 10 + Math.min(8, Math.log10(s.reviews + 1) * 3) + planRank(s) * 3
    if (s.rating >= 4.8 && !reasons.some((r) => r.includes('on-time'))) reasons.push(`Rated ${s.rating} by ${s.reviews} customers`)
    const fit = Math.max(5, Math.min(99, Math.round(score * 0.75)))
    return { shipper: s, fit, reasons: reasons.slice(0, 4), cautions: cautions.slice(0, 2) }
  }).filter((x): x is NonNullable<typeof x> => !!x)
  out.sort((a, b) => b.fit - a.fit || b.shipper.rating - a.shipper.rating)
  return out
}

export function mountDirectory(r: Router, d: Deps) {
  const { getDb, shipperOut, wrap } = d
  const loadAll = async (db: Db) => (await db.query<Row>('select * from shippers')).rows.map(shipperOut)

  /** Search + filter + sort + paginate. Public. */
  r.get('/shippers/search', wrap(async (req, res) => {
    const db = await getDb(); const p = zSearch.parse(req.query)
    let list = await loadAll(db)
    const facets = { destinations: new Map<string, number>(), cargo: new Map<string, number>(), modes: new Map<string, number>() }
    for (const s of list) { for (const c of s.destinations) facets.destinations.set(c, (facets.destinations.get(c) ?? 0) + 1); for (const c of s.cargo) facets.cargo.set(c, (facets.cargo.get(c) ?? 0) + 1); for (const m of s.modes) facets.modes.set(m, (facets.modes.get(m) ?? 0) + 1) }
    if (p.destination) list = list.filter((s) => s.destinations.includes(p.destination))
    if (p.mode !== 'either') list = list.filter((s) => s.modes.includes(p.mode as Mode))
    if (p.cargo) list = list.filter((s) => s.cargo.includes(p.cargo as CargoType))
    if (p.verified === '1' || p.verified === 'true') list = list.filter((s) => s.verified)
    if (p.price) list = list.filter((s) => s.priceIndex === Number(p.price))
    if (p.origin) list = list.filter((s) => s.origins.includes(p.origin) || s.origins.some((o) => country(o) === country(p.origin)))
    const scored = list.map((s) => ({ s, t: textScore(s, p.q) })).filter((x) => x.t > 0)
    const cmp: Record<typeof p.sort, (a: Shipper, b: Shipper) => number> = {
      recommended: (a, b) => recommendedScore(b) - recommendedScore(a),
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
      reviews: (a, b) => b.reviews - a.reviews,
      response: (a, b) => a.responseHours - b.responseHours || b.rating - a.rating,
      ontime: (a, b) => b.onTime - a.onTime || b.rating - a.rating,
      newest: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.founded - a.founded,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    scored.sort((a, b) => (p.q ? b.t - a.t : 0) || cmp[p.sort](a.s, b.s))
    const total = scored.length; const pages = Math.max(1, Math.ceil(total / p.size)); const page = Math.min(p.page, pages)
    res.json({
      shippers: scored.slice((page - 1) * p.size, page * p.size).map((x) => x.s), total, page, pages, size: p.size,
      facets: { destinations: [...facets.destinations].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n), cargo: [...facets.cargo].map(([id, n]) => ({ id, n })), modes: [...facets.modes].map(([id, n]) => ({ id, n })) },
    })
  }))

  /** Featured shippers (Enterprise plan), optionally for a destination — the "advertising" strip. */
  r.get('/shippers/featured', wrap(async (req, res) => {
    const db = await getDb(); const dest = String(req.query.destination ?? '')
    let list = (await loadAll(db)).filter(isFeatured)
    if (dest) list = list.filter((s) => s.destinations.includes(dest))
    list.sort((a, b) => recommendedScore(b) - recommendedScore(a))
    res.json({ shippers: list.slice(0, 6) })
  }))

  /** Needs assessment → ranked recommendations with reasons. Public. */
  r.post('/shippers/recommend', wrap(async (req, res) => {
    const db = await getDb(); const n = zNeeds.parse(req.body)
    const all = await loadAll(db)
    const ranked = recommend(all, n)
    const c = countryByCode(n.destination)
    res.json({ matches: ranked.slice(0, 6), total: ranked.length, lane: c ? { country: c.name, oceanDays: c.oceanDays, airDays: c.airDays, ports: c.ports, airports: c.airports } : null })
  }))
}
