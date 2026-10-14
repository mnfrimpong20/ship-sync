/**
 * Where customers ship from and to — no longer hard-coded.
 *   Destinations live in the `destinations` table (seeded from the original list), editable under Admin → Destinations:
 *   add Cameroon or Gambia with its ports, airports, transit days and dial code without a code push. Inactive ones
 *   disappear from every form but keep their history.
 *   Origins are the curated city list plus every verified shipper's declared pickup cities, ranked by how many shippers
 *   serve each — and the quote form accepts a city that isn't listed.
 *   GET /meta/destinations · GET /meta/origins · GET /admin/destinations · PUT /admin/destinations/:code · POST /admin/destinations/:code/active
 */
import type { Request, Response, NextFunction, Router } from 'express'
import { z } from 'zod'
import type { Db } from './db'
import { countries as SEED, origins as CURATED } from '../src/lib/data'

type Row = Record<string, any>
interface Deps {
  getDb: () => Promise<Db>
  requireAdmin: (db: Db, req: Request) => Promise<unknown>
  HttpError: new (status: number, message: string) => Error
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void
}
const J = (v: unknown) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v)
const DIAL: Record<string, string> = { GH: '233', NG: '234', LR: '231', TG: '228', CI: '225', SL: '232', SN: '221' }

export interface Destination { code: string; name: string; flag: string; ports: string[]; airports: string[]; oceanDays: string; airDays: string; note: string; dialCode: string; active: boolean; sort: number }
const out = (r: Row): Destination => ({ code: r.code, name: r.name, flag: r.flag, ports: J(r.ports) ?? [], airports: J(r.airports) ?? [], oceanDays: r.ocean_days ?? '', airDays: r.air_days ?? '', note: r.note ?? '', dialCode: r.dial_code ?? '', active: !!r.active, sort: Number(r.sort ?? 0) })

/** Seed once from the static list; later edits in admin win (insert … on conflict do nothing). */
export async function seedDestinations(db: Db) {
  for (const [i, c] of SEED.entries()) await db.query(`insert into destinations (code,name,flag,ports,airports,ocean_days,air_days,note,dial_code,active,sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) on conflict (code) do nothing`, [c.code, c.name, c.flag, JSON.stringify(c.ports), JSON.stringify(c.airports), c.oceanDays, c.airDays, c.note, DIAL[c.code] ?? '', i])
}

let cache: { at: number; list: Destination[] } | null = null
export async function activeDestinations(db: Db): Promise<Destination[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list
  const { rows } = await db.query<Row>('select * from destinations where active order by sort, name')
  cache = { at: Date.now(), list: rows.map(out) }; return cache.list
}
export const bustDestinations = () => { cache = null }
export async function isActiveDestination(db: Db, code: string) { return (await activeDestinations(db)).some((d) => d.code === code.toUpperCase()) }
export async function dialCodeFor(db: Db, code: string) { return (await activeDestinations(db)).find((d) => d.code === code.toUpperCase())?.dialCode ?? DIAL[code.toUpperCase()] ?? '' }

const zDest = z.object({
  name: z.string().trim().min(2).max(60), flag: z.string().trim().max(8).default(''), ports: z.array(z.string().trim().min(1).max(60)).max(10).default([]), airports: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  oceanDays: z.string().trim().max(20).default(''), airDays: z.string().trim().max(20).default(''), note: z.string().trim().max(300).default(''), dialCode: z.string().trim().regex(/^\d{0,4}$/).default(''), active: z.boolean().default(true), sort: z.number().int().min(0).max(999).optional(),
})

/** Curated cities plus verified shippers' pickup cities, with how many shippers collect there. Cached a minute. */
let originCache: { at: number; list: { city: string; shippers: number; curated: boolean }[] } | null = null
export async function originList(db: Db) {
  if (originCache && Date.now() - originCache.at < 60_000) return originCache.list
  const { rows } = await db.query<Row>(`select o as city, count(*)::int as n from shippers s, jsonb_array_elements_text(s.origins) o where s.verified and s.demo = false and s.id <> 'ship-sync-sourcing' group by o`)
  const counts = new Map<string, number>(); for (const r of rows) counts.set(String(r.city).trim(), Number(r.n))
  // Demo shippers count too until the demo flag hides them — otherwise the list is empty on a fresh install.
  if (!rows.length) { const { rows: demo } = await db.query<Row>(`select o as city, count(*)::int as n from shippers s, jsonb_array_elements_text(s.origins) o where s.id <> 'ship-sync-sourcing' group by o`); for (const r of demo) counts.set(String(r.city).trim(), Number(r.n)) }
  const all = new Map<string, { city: string; shippers: number; curated: boolean }>()
  for (const c of CURATED) all.set(c, { city: c, shippers: counts.get(c) ?? 0, curated: true })
  for (const [c, n] of counts) if (!all.has(c)) all.set(c, { city: c, shippers: n, curated: false })
  const list = [...all.values()].sort((a, b) => b.shippers - a.shippers || a.city.localeCompare(b.city))
  originCache = { at: Date.now(), list }; return list
}
export const bustOrigins = () => { originCache = null }

export function mountGeoMeta(r: Router, d: Deps) {
  const { getDb, requireAdmin, HttpError, wrap } = d
  r.get('/meta/destinations', wrap(async (_req, res) => { const db = await getDb(); res.set('Cache-Control', 'public, max-age=60'); res.json({ destinations: await activeDestinations(db) }) }))
  r.get('/meta/origins', wrap(async (_req, res) => { const db = await getDb(); res.set('Cache-Control', 'public, max-age=60'); res.json({ origins: await originList(db) }) }))

  r.get('/admin/destinations', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); const { rows } = await db.query<Row>('select * from destinations order by active desc, sort, name'); res.set('Cache-Control', 'no-store'); res.json({ destinations: rows.map(out) }) }))
  r.put('/admin/destinations/:code', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const code = String(req.params.code).toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) throw new HttpError(400, 'Use the two-letter ISO country code, e.g. CM.')
    const b = zDest.parse(req.body)
    const { rows: ex } = await db.query<Row>('select sort from destinations where code = $1', [code])
    const { rows: mx } = await db.query<Row>('select coalesce(max(sort), -1)::int as m from destinations')
    const sort = b.sort ?? (ex[0] ? Number(ex[0].sort) : Number(mx[0].m) + 1)
    await db.query(`insert into destinations (code,name,flag,ports,airports,ocean_days,air_days,note,dial_code,active,sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (code) do update set name = excluded.name, flag = excluded.flag, ports = excluded.ports, airports = excluded.airports, ocean_days = excluded.ocean_days, air_days = excluded.air_days, note = excluded.note, dial_code = excluded.dial_code, active = excluded.active, sort = excluded.sort`,
      [code, b.name, b.flag || flagFor(code), JSON.stringify(b.ports), JSON.stringify(b.airports), b.oceanDays, b.airDays, b.note, b.dialCode, b.active, sort])
    bustDestinations()
    const { rows } = await db.query<Row>('select * from destinations where code = $1', [code]); res.json({ destination: out(rows[0]) })
  }))
  r.post('/admin/destinations/:code/active', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req); const code = String(req.params.code).toUpperCase(); const b = z.object({ active: z.boolean() }).parse(req.body)
    if (!b.active) { const { rows: live } = await db.query<Row>(`select count(*)::int as n from shippers s where s.destinations ? $1 and s.demo = false`, [code]); if (Number(live[0].n) > 0 && req.query.force !== '1') throw new HttpError(409, `${live[0].n} real shipper${Number(live[0].n) === 1 ? '' : 's'} list${Number(live[0].n) === 1 ? 's' : ''} this destination. Add ?force=1 to hide it anyway.`) }
    await db.query('update destinations set active = $2 where code = $1', [code, b.active]); bustDestinations()
    const { rows } = await db.query<Row>('select * from destinations where code = $1', [code]); if (!rows[0]) throw new HttpError(404, 'Destination not found.'); res.json({ destination: out(rows[0]) })
  }))
}

/** Regional-indicator flag from the ISO code, so admins don't have to paste an emoji. */
export const flagFor = (code: string) => String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
