/**
 * White-label — a shipper's own branded page on Ntemtem: `/t/<slug>` with their logo, colour,
 * tagline and contact details, a tracking box and a quote form whose leads go only to them (and are
 * priced instantly from their rate cards). A custom domain can point at Ntemtem; requests arriving
 * on that host are sent to the branded page.
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { isDriverRole } from '../src/lib/roles'
import { z } from 'zod'
import type { Db } from './db'
import type { ApiUser } from './api'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireUser: (db: Db, req: Request) => Promise<ApiUser>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)

export interface Brand { slug: string; enabled: boolean; logo: string; accent: string; headline: string; tagline: string; intro: string; phone: string; whatsapp: string; email: string; website: string; domain: string; showRates: boolean; poweredBy: boolean; origins: string[] }
export const DEFAULT_BRAND: Omit<Brand, 'slug'> = { enabled: false, logo: '', accent: '#F5B82E', headline: '', tagline: '', intro: '', phone: '', whatsapp: '', email: '', website: '', domain: '', showRates: true, poweredBy: true, origins: [] }
const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
export const brandOf = (sh: Row): Brand => ({ ...DEFAULT_BRAND, slug: slugify(sh.name), ...(J(sh.brand) ?? {}) })

const zBrand = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, 'Use 3–40 letters, numbers or dashes.').optional(), enabled: z.boolean().optional(), logo: z.string().max(260_000).regex(/^$|^data:image\/(png|jpeg|webp|svg\+xml);base64,/, 'Upload a PNG, JPG, WebP or SVG.').optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  headline: z.string().trim().max(90).optional(), tagline: z.string().trim().max(120).optional(), intro: z.string().trim().max(600).optional(), phone: z.string().trim().max(30).optional(), whatsapp: z.string().trim().max(30).optional(), email: z.string().trim().email().or(z.literal('')).optional(), website: z.string().trim().max(120).optional(),
  domain: z.string().trim().toLowerCase().max(120).regex(/^$|^[a-z0-9.-]+\.[a-z]{2,}$/, 'Enter a domain like ship.yourcompany.com').optional(), showRates: z.boolean().optional(), poweredBy: z.boolean().optional(), origins: z.array(z.string().trim().max(60)).max(12).optional(),
})

/** Host → slug map for custom domains, refreshed every minute. */
let domainCache: { at: number; map: Map<string, string> } = { at: 0, map: new Map() }
export async function slugForHost(db: Db, host: string | undefined) {
  if (!host) return null
  const h = host.toLowerCase().split(':')[0]
  if (Date.now() - domainCache.at > 60_000) {
    const { rows } = await db.query<Row>(`select name, brand from shippers where brand is not null and brand->>'domain' <> '' and (brand->>'enabled')::boolean`)
    domainCache = { at: Date.now(), map: new Map(rows.map((r) => [String(J(r.brand)?.domain ?? '').toLowerCase(), brandOf(r).slug])) }
  }
  return domainCache.map.get(h) ?? null
}

export function mountBrand(r: Router, d: Deps) {
  const { getDb, requireUser, HttpError, wrap } = d
  const owner = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (u.role !== 'shipper' || !u.shipperId || (u.staffRole !== 'owner' && u.staffRole !== 'dispatcher')) throw new HttpError(403, 'Owners and dispatchers only.'); return u }
  const bySlug = async (db: Db, slug: string) => {
    const { rows } = await db.query<Row>(`select * from shippers where brand->>'slug' = $1 or (brand->>'slug' is null and lower(regexp_replace(regexp_replace(replace(name, '&', 'and'), '[^A-Za-z0-9]+', '-', 'g'), '^-|-$', '', 'g')) = $1)`, [slug])
    const sh = rows[0]; if (!sh) throw new HttpError(404, 'Page not found.')
    return sh
  }

  r.get('/brand', wrap(async (req, res) => {
    const db = await getDb(); const u = await owner(db, req)
    const { rows } = await db.query<Row>('select * from shippers where id = $1', [u.shipperId]); const sh = rows[0]
    const b = brandOf(sh); const { rows: rates } = await db.query<Row>(`select count(*)::int as n from rate_cards where shipper_id = $1 and active`, [u.shipperId])
    const { rows: leads } = await db.query<Row>(`select count(*)::int as n from requests where preferred_shipper_id = $1`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ brand: b, shipper: { id: sh.id, name: sh.name, hq: sh.hq, initials: sh.initials, hue: sh.hue, destinations: J(sh.destinations), origins: J(sh.origins) }, rateCards: rates[0].n, leads: leads[0].n, appUrl: (process.env.APP_URL || '').replace(/\/$/, '') })
  }))
  r.put('/brand', wrap(async (req, res) => {
    const db = await getDb(); const u = await owner(db, req); const b = zBrand.parse(req.body)
    await (await import('./features')).requirePerk(db, u.shipperId!, 'brand', HttpError)
    const { rows } = await db.query<Row>('select * from shippers where id = $1', [u.shipperId]); const cur = brandOf(rows[0])
    const next: Brand = { ...cur, ...b, slug: b.slug ?? cur.slug }
    if (b.slug) { const { rows: dup } = await db.query<Row>(`select id from shippers where id <> $1 and (brand->>'slug' = $2 or lower(regexp_replace(regexp_replace(replace(name, '&', 'and'), '[^A-Za-z0-9]+', '-', 'g'), '^-|-$', '', 'g')) = $2)`, [u.shipperId, b.slug]); if (dup.length) throw new HttpError(409, 'That address is taken — try another.') }
    if (b.domain) { const { rows: dup } = await db.query<Row>(`select id from shippers where id <> $1 and brand->>'domain' = $2`, [u.shipperId, b.domain]); if (dup.length) throw new HttpError(409, 'That domain is already connected to another shipper.') }
    await db.query('update shippers set brand = $2 where id = $1', [u.shipperId, JSON.stringify(next)]); domainCache.at = 0
    res.json({ brand: next })
  }))

  /** Public: the shipper behind an order link (`/order/<slug-or-id>`), enough to show who the customer is ordering from. */
  r.get('/order/:code', wrap(async (req, res) => {
    const db = await getDb(); const code = String(req.params.code).toLowerCase()
    let { rows } = await db.query<Row>('select * from shippers where id = $1', [code]); let sh = rows[0]
    if (!sh) sh = await bySlug(db, code)
    const b = brandOf(sh)
    const { rows: rates } = await db.query<Row>(`select count(*)::int as n from rate_cards where shipper_id = $1 and active`, [sh.id])
    res.set('Cache-Control', 'public, max-age=120')
    res.json({ shipper: { id: sh.id, name: sh.name, tagline: sh.tagline, hq: sh.hq, verified: !!sh.verified, rating: Number(sh.rating), reviews: Number(sh.reviews), modes: J(sh.modes), destinations: J(sh.destinations), origins: J(sh.origins), cargo: J(sh.cargo), initials: sh.initials, hue: sh.hue, responseHours: Number(sh.response_hours), onTime: Number(sh.on_time) }, instantQuotes: rates[0].n > 0, brand: { logo: b.logo, accent: b.accent, phone: b.phone, whatsapp: b.whatsapp, email: b.email, slug: b.slug }, poweredBy: true })
  }))
  /** Office: the company's order link, ready to share (every shipper has one — no setup needed). */
  r.get('/shipper/order-link', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    if (u.role !== 'shipper' || !u.shipperId || isDriverRole(u.staffRole)) throw new HttpError(403, 'Office staff only.')
    const { rows } = await db.query<Row>('select * from shippers where id = $1', [u.shipperId]); const sh = rows[0]; const b = brandOf(sh)
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const { rows: c } = await db.query<Row>(`select count(*)::int as n, count(*) filter (where created_at > now() - interval '30 days')::int as n30 from requests where preferred_shipper_id = $1 and source in ('link','branded')`, [u.shipperId])
    res.set('Cache-Control', 'no-store')
    res.json({ url: `${base}/order/${b.slug}`, slug: b.slug, shipperName: sh.name, viaLink: c[0].n, viaLink30: c[0].n30, brandedEnabled: !!b.enabled, brandedUrl: b.enabled ? `${base}/t/${b.slug}` : null })
  }))

  /** Public: everything the branded page needs. */
  r.get('/t/:slug', wrap(async (req, res) => {
    const db = await getDb(); const sh = await bySlug(db, String(req.params.slug).toLowerCase()); const b = brandOf(sh)
    if (!b.enabled) throw new HttpError(404, 'This page is not published yet.')
    const { rows: rates } = await db.query<Row>(`select origin, destination, mode, cargo, unit as basis, price, min_charge, transit_days from rate_cards where shipper_id = $1 and active order by destination, cargo`, [sh.id]).catch(() => ({ rows: [] as Row[] }))
    const { rows: rv } = await db.query<Row>(`select r.rating, r.body, r.created_at, u.name from reviews r left join users u on u.id = r.user_id where r.shipper_id = $1 and r.status = 'published' order by r.created_at desc limit 3`, [sh.id])
    res.set('Cache-Control', 'no-store')
    res.json({ brand: b, shipper: { id: sh.id, name: sh.name, hq: sh.hq, tagline: sh.tagline, about: sh.about, initials: sh.initials, hue: sh.hue, rating: Number(sh.rating), reviews: Number(sh.reviews), verified: !!sh.verified, modes: J(sh.modes), destinations: J(sh.destinations), origins: J(sh.origins), cargo: J(sh.cargo), services: J(sh.services), founded: sh.founded },
      rates: b.showRates ? rates.map((x) => ({ origin: x.origin, destination: x.destination, mode: x.mode, cargo: x.cargo, basis: x.basis, price: Number(x.price), minCharge: Number(x.min_charge ?? 0), transitDays: Number(x.transit_days) })) : [],
      reviews: rv.map((x) => ({ rating: Number(x.rating), body: x.body, author: x.name ? `${String(x.name).split(' ')[0]} ${String(x.name).split(' ').slice(-1)[0][0]}.` : 'Customer', at: x.created_at })) })
  }))
}
