import { Router, type Request, type Response, type NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getDb, makeRef, uid, type Db } from './db'
import { statusOrder, type CargoType, type ShipmentStatus } from '../src/lib/data'
import { alongGreatCircle, destGeo, greatCircle, originCoords, type LngLat } from '../src/lib/geo'
import { ais, aircraft, airStatus, flightPosition, flightRoute, flightsInRegion, type Position } from './live'

/* ---------------- types (API shapes match the old client store) ---------------- */
export interface ApiUser { id: string; name: string; email: string; role: 'customer' | 'shipper'; company?: string; shipperId?: string }
type Row = Record<string, any>

const SESSION_COOKIE = 'ss_session'
const SESSION_DAYS = 30
const DEMO_AUTO_QUOTES = (process.env.DEMO_AUTO_QUOTES ?? 'true') !== 'false'

/* ---------------- helpers ---------------- */
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : String(v))
const DATE = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

const shipperOut = (r: Row) => ({
  id: r.id, name: r.name, tagline: r.tagline, hq: r.hq, founded: r.founded, modes: J(r.modes), destinations: J(r.destinations), origins: J(r.origins), cargo: J(r.cargo),
  rating: Number(r.rating), reviews: r.reviews, verified: r.verified, responseHours: r.response_hours, onTime: r.on_time, services: J(r.services), about: r.about,
  priceIndex: r.price_index, plan: r.plan, initials: r.initials, hue: r.hue, demo: r.demo,
})
const quoteOut = (r: Row) => ({ id: r.id, requestId: r.request_id, shipperId: r.shipper_id, price: r.price, currency: r.currency, transitDays: r.transit_days, validUntil: DATE(r.valid_until), notes: r.notes, includes: J(r.includes), status: r.status, sentAt: ISO(r.sent_at) })
const requestOut = (r: Row, quotes: Row[]) => ({
  id: r.id, ref: r.ref, userId: r.user_id, createdAt: ISO(r.created_at), origin: r.origin, destination: r.destination, mode: r.mode, cargo: r.cargo, quantity: r.quantity, weightKg: r.weight_kg ?? undefined,
  description: r.description, pickup: r.pickup, delivery: r.delivery, insurance: r.insurance, readyDate: DATE(r.ready_date),
  contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone }, status: r.status, quotes: quotes.map(quoteOut),
})
const shipmentOut = (r: Row, events: Row[]) => ({
  id: r.id, ref: r.ref, shipperId: r.shipper_id, mode: r.mode, origin: r.origin, destination: r.destination, cargo: r.cargo, description: r.description, status: r.status, eta: DATE(r.eta), customer: r.customer,
  vesselName: r.vessel_name ?? undefined, mmsi: r.mmsi ?? undefined, flight: r.flight ?? undefined, departedAt: r.departed_at ? ISO(r.departed_at) : undefined,
  events: events.map((e) => ({ status: e.status, at: ISO(e.at), place: e.place, note: e.note ?? undefined })),
})

/* ---------------- live position ---------------- */
const STALE_AIR_MIN = 30, STALE_SEA_MIN = 6 * 60
export async function resolvePosition(r: Row, events: Row[]) {
  const mode: 'air' | 'ocean' = r.mode
  const dest = destGeo[r.destination]
  const o: LngLat | undefined = originCoords[r.origin]
  const d: LngLat | undefined = dest ? (mode === 'air' ? dest.airport.at : dest.port.at) : undefined
  const idx = statusOrder.indexOf(r.status as ShipmentStatus)
  const transitIdx = statusOrder.indexOf('in_transit'), arrivedIdx = statusOrder.indexOf('arrived')
  const departed = r.departed_at ? new Date(r.departed_at) : events.find((e) => e.status === 'in_transit')?.at ? new Date(events.find((e) => e.status === 'in_transit')!.at) : null
  const eta = new Date(DATE(r.eta) + 'T12:00:00Z')
  let progress = idx < transitIdx ? 0 : idx >= arrivedIdx ? 1 : 0.5
  if (idx >= transitIdx && idx < arrivedIdx && departed) progress = Math.max(0.02, Math.min(0.98, (Date.now() - departed.getTime()) / Math.max(1, eta.getTime() - departed.getTime())))
  const estimated = o && d ? alongGreatCircle(o, d, progress) : undefined

  let live: Position | null = null, lastKnown: Position | null = null
  if (idx >= transitIdx && idx < arrivedIdx) {
    if (mode === 'air' && r.flight) live = await flightPosition(r.flight)
    if (mode === 'ocean' && r.mmsi) {
      const p = ais.get(r.mmsi)
      if (p) { const ageMin = (Date.now() - new Date(p.at).getTime()) / 60000; if (ageMin <= STALE_SEA_MIN) live = p; else lastKnown = p }
    }
    if (live && mode === 'air') { const ageMin = (Date.now() - new Date(live.at).getTime()) / 60000; if (ageMin > STALE_AIR_MIN) { lastKnown = live; live = null } }
  }
  const phase = idx < transitIdx ? 'pre' : idx >= arrivedIdx ? 'post' : 'transit'
  return {
    mode, phase, status: r.status, progress: Number(progress.toFixed(3)),
    route: o && d ? { origin: { name: r.origin, at: o }, destination: { name: mode === 'air' ? dest!.airport.name : dest!.port.name, at: d }, path: greatCircle(o, d, 96) } : null,
    carrier: { vesselName: r.vessel_name ?? undefined, mmsi: r.mmsi ?? undefined, flight: r.flight ?? undefined },
    live, lastKnown, estimated: estimated ? { lat: estimated[1], lon: estimated[0] } : null,
    sources: { ais: ais.status, adsb: 'public' },
    note: live ? (mode === 'air' ? 'Live position from public ADS-B (adsb.lol). Delayed and not for navigation.' : 'Live AIS position via AISStream. Terrestrial AIS only — ships go dark mid-ocean.')
      : lastKnown ? 'Last known position — no recent signal. Ships are often out of AIS range mid-ocean.'
      : phase === 'transit' ? (mode === 'ocean' && !r.mmsi ? 'Estimated from departure and ETA. Add the vessel MMSI for live AIS tracking.' : mode === 'air' && !r.flight ? 'Estimated from departure and ETA. Add the flight number for live tracking.' : 'Estimated from departure and ETA — no live signal right now.')
      : phase === 'pre' ? 'Not yet departed.' : 'Arrived at destination.',
  }
}
const userOut = (r: Row, company?: string): ApiUser => ({ id: r.id, name: r.name, email: r.email, role: r.role, shipperId: r.shipper_id ?? undefined, company })

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)

/* ---------------- auth ---------------- */
async function currentUser(db: Db, req: Request): Promise<ApiUser | null> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (!sid) return null
  const { rows } = await db.query<Row>(
    `select u.*, s.name as company from sessions se join users u on u.id = se.user_id left join shippers s on s.id = u.shipper_id where se.id = $1 and se.expires_at > now()`, [sid],
  )
  return rows[0] ? userOut(rows[0], rows[0].company ?? undefined) : null
}

async function createSession(db: Db, res: Response, userId: string) {
  const id = randomBytes(32).toString('hex')
  await db.query('insert into sessions (id,user_id,expires_at) values ($1,$2,$3)', [id, userId, new Date(Date.now() + SESSION_DAYS * 86400000)])
  res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_DAYS * 86400000, path: '/' })
}

const requireUser = async (db: Db, req: Request) => { const u = await currentUser(db, req); if (!u) throw new HttpError(401, 'Please sign in.'); return u }

async function loadUserWithCompany(db: Db, id: string) {
  const { rows } = await db.query<Row>('select u.*, s.name as company from users u left join shippers s on s.id = u.shipper_id where u.id = $1', [id])
  return userOut(rows[0], rows[0].company ?? undefined)
}

async function signupUser(db: Db, input: { name: string; email: string; password: string; role: 'customer' | 'shipper'; company?: string }) {
  const email = input.email.trim().toLowerCase()
  const { rows: existing } = await db.query('select id from users where email = $1', [email])
  if (existing.length) throw new HttpError(409, 'An account with that email already exists. Try signing in.')
  const id = uid()
  let shipperId: string | null = null
  if (input.role === 'shipper') {
    shipperId = 'sh_' + uid()
    const company = (input.company ?? '').trim() || `${input.name}'s Shipping`
    const initials = company.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    await db.query(
      `insert into shippers (id,name,tagline,hq,founded,modes,destinations,origins,cargo,verified,response_hours,services,about,price_index,plan,initials,hue,demo)
       values ($1,$2,$3,$4,$5,'["ocean","air"]','[]','[]','[]',false,24,'[]',$6,2,'starter',$7,$8,false)`,
      [shipperId, company, 'New on Ship Sync', '', new Date().getFullYear(), `${company} is a new shipping company on Ship Sync. Profile details coming soon.`, initials, '#E3B54A'],
    )
  }
  const hash = await bcrypt.hash(input.password, 10)
  await db.query('insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,$5,$6)', [id, email, input.name.trim(), hash, input.role, shipperId])
  return loadUserWithCompany(db, id)
}

/* ---------------- matching ---------------- */
type MatchInput = { origin: string; destination: string; mode: 'air' | 'ocean' | 'either'; cargo: CargoType }
async function matchShippers(db: Db, r: MatchInput) {
  const { rows } = await db.query<Row>('select * from shippers')
  return rows
    .map(shipperOut)
    .map((shipper) => {
      const reasons: string[] = []
      let score = 0
      if (!shipper.destinations.includes(r.destination)) return { shipper, score: -1, reasons }
      score += 40; reasons.push('Serves this destination')
      if (r.mode !== 'either') { if (shipper.modes.includes(r.mode)) { score += 20; reasons.push(`Offers ${r.mode} freight`) } else return { shipper, score: -1, reasons } }
      else score += 10
      if (shipper.cargo.includes(r.cargo)) { score += 20; reasons.push('Handles this cargo type') } else score -= 30
      if (shipper.origins.includes(r.origin)) { score += 15; reasons.push('Regular pickups from your area') }
      else if (shipper.origins.some((o: string) => o.split(', ')[1] === r.origin.split(', ')[1])) { score += 6; reasons.push('Operates in your country') }
      if (shipper.verified) { score += 5; reasons.push('Verified') }
      score += shipper.rating * 2
      return { shipper, score, reasons }
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Fictional demo shippers reply automatically so the marketplace can be tried without real forwarders. */
async function demoAutoQuotes(db: Db, req: Row) {
  const matches = (await matchShippers(db, { origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo })).filter((m) => m.shipper.demo).slice(0, 4)
  const base: Record<CargoType, number> = { barrels: 160, boxes: 95, pallets: 420, vehicle: 1650, container20: 3900, container40: 5600, commercial: 900 }
  const airMult = req.mode === 'air' ? 3.2 : 1
  for (const [i, m] of matches.entries()) {
    const priceIdx = [0.88, 1, 1.18][m.shipper.priceIndex - 1] ?? 1
    const price = Math.round(base[req.cargo as CargoType] * Math.max(1, req.quantity) * priceIdx * airMult + (req.pickup ? 60 : 0) + (req.delivery ? 90 : 0) + (req.insurance ? 45 : 0))
    const isAir = m.shipper.modes.includes('air') && req.mode !== 'ocean' && (req.mode === 'air' || !m.shipper.modes.includes('ocean'))
    const transit = isAir ? 4 + i : 30 + i * 2 + (m.shipper.priceIndex === 1 ? 3 : 0)
    const includes = [req.pickup ? 'Pickup' : 'Drop-off at warehouse', isAir ? 'Air freight' : 'Ocean freight', req.delivery ? 'Door delivery' : 'Port handling', ...(req.insurance ? ['All-risk insurance'] : [])]
    await db.query('insert into quotes (id,request_id,shipper_id,price,transit_days,valid_until,notes,includes) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing',
      [uid(), req.id, m.shipper.id, price, transit, new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), `${m.shipper.tagline}. ${req.delivery ? 'Door delivery included.' : 'Consignee collects at port/airport.'} Duty and destination taxes payable by consignee.`, JSON.stringify(includes)])
  }
}

/* ---------------- loaders ---------------- */
async function loadRequests(db: Db, where: string, params: unknown[]) {
  const { rows } = await db.query<Row>(`select * from requests where ${where} order by created_at desc`, params)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const { rows: quotes } = await db.query<Row>(`select * from quotes where request_id = any($1::text[]) order by sent_at asc`, [ids])
  return rows.map((r) => requestOut(r, quotes.filter((q) => q.request_id === r.id)))
}
async function loadShipments(db: Db, where: string, params: unknown[]) {
  const { rows } = await db.query<Row>(`select * from shipments where ${where} order by created_at desc`, params)
  if (!rows.length) return []
  const { rows: events } = await db.query<Row>(`select * from shipment_events where shipment_id = any($1::text[]) order by at asc, id asc`, [rows.map((r) => r.id)])
  return rows.map((r) => shipmentOut(r, events.filter((e) => e.shipment_id === r.id)))
}

/* ---------------- schemas ---------------- */
const zRole = z.enum(['customer', 'shipper'])
const zSignup = z.object({ name: z.string().trim().min(2, 'Enter your name.'), email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(8, 'Password must be at least 8 characters.'), role: zRole, company: z.string().trim().optional() })
const zLogin = z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.') })
const zMatch = z.object({ origin: z.string().min(1), destination: z.string().length(2), mode: z.enum(['air', 'ocean', 'either']), cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']) })
const zRequest = zMatch.extend({
  quantity: z.number().int().min(1), weightKg: z.number().int().min(0).optional(), description: z.string().max(2000).default(''), pickup: z.boolean(), delivery: z.boolean(), insurance: z.boolean(),
  readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), contact: z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), phone: z.string().trim().min(7) }),
  password: z.string().min(8).optional(),
})
const zTransit = z.object({
  vesselName: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
  mmsi: z.string().trim().regex(/^\d{9}$/, 'MMSI is a 9-digit number.').optional().or(z.literal('').transform(() => undefined)),
  flight: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,8}$/, 'Use the ICAO flight callsign, e.g. CLX775 or BAW75.').optional().or(z.literal('').transform(() => undefined)),
  departedAt: z.string().datetime().optional(),
})
const zQuote = z.object({ price: z.number().int().min(1), transitDays: z.number().int().min(1), notes: z.string().max(2000).default(''), includes: z.array(z.string()).default([]), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })

/* ---------------- router ---------------- */
export function apiRouter() {
  const r = Router()

  r.get('/health', wrap(async (_req, res) => { const db = await getDb(); res.json({ ok: true, db: db.kind }) }))

  // auth
  r.post('/auth/signup', wrap(async (req, res) => {
    const db = await getDb(); const body = zSignup.parse(req.body)
    const user = await signupUser(db, body)
    await createSession(db, res, user.id)
    res.status(201).json({ user })
  }))
  r.post('/auth/login', wrap(async (req, res) => {
    const db = await getDb(); const body = zLogin.parse(req.body)
    const { rows } = await db.query<Row>('select * from users where email = $1', [body.email.toLowerCase()])
    if (!rows[0] || !(await bcrypt.compare(body.password, rows[0].password_hash))) throw new HttpError(401, 'Email or password is incorrect.')
    await createSession(db, res, rows[0].id)
    res.json({ user: await loadUserWithCompany(db, rows[0].id) })
  }))
  r.post('/auth/logout', wrap(async (req, res) => {
    const db = await getDb(); const sid = req.cookies?.[SESSION_COOKIE]
    if (sid) await db.query('delete from sessions where id = $1', [sid])
    res.clearCookie(SESSION_COOKIE, { path: '/' }); res.json({ ok: true })
  }))
  r.get('/auth/me', wrap(async (req, res) => { const db = await getDb(); res.json({ user: await currentUser(db, req) }) }))

  // shippers (public)
  r.get('/shippers', wrap(async (_req, res) => { const db = await getDb(); const { rows } = await db.query<Row>('select * from shippers order by rating desc, reviews desc'); res.json({ shippers: rows.map(shipperOut) }) }))
  r.get('/shippers/:id', wrap(async (req, res) => { const db = await getDb(); const { rows } = await db.query<Row>('select * from shippers where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Shipper not found.'); res.json({ shipper: shipperOut(rows[0]) }) }))
  r.post('/match', wrap(async (req, res) => { const db = await getDb(); res.json({ matches: await matchShippers(db, zMatch.parse(req.body)) }) }))

  // requests
  r.get('/requests', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    if (user.role === 'customer') return res.json({ requests: await loadRequests(db, 'user_id = $1', [user.id]) })
    // shipper: open requests matching lanes + anything they've quoted
    const all = await loadRequests(db, `status = 'open' or id in (select request_id from quotes where shipper_id = $1)`, [user.shipperId])
    const { rows: me } = await db.query<Row>('select * from shippers where id = $1', [user.shipperId])
    const s = shipperOut(me[0])
    const mine = all.filter((q) => q.quotes.some((x) => x.shipperId === user.shipperId) || (s.destinations.includes(q.destination) && (q.mode === 'either' || s.modes.includes(q.mode))))
    // hide other shippers' prices from competitors — keep only count + own quote
    res.json({ requests: mine.map((q) => ({ ...q, quotes: q.quotes.filter((x) => x.shipperId === user.shipperId), competingQuotes: q.quotes.filter((x) => x.shipperId !== user.shipperId).length })) })
  }))
  r.post('/requests', wrap(async (req, res) => {
    const db = await getDb(); const body = zRequest.parse(req.body)
    let user = await currentUser(db, req)
    if (!user) {
      if (!body.password) throw new HttpError(401, 'Create a password to save your request and receive quotes.')
      user = await signupUser(db, { name: body.contact.name, email: body.contact.email, password: body.password, role: 'customer' })
      await createSession(db, res, user.id)
    }
    if (user.role !== 'customer') throw new HttpError(403, 'Shipper accounts cannot post shipment requests.')
    const id = uid()
    await db.query(
      `insert into requests (id,ref,user_id,origin,destination,mode,cargo,quantity,weight_kg,description,pickup,delivery,insurance,ready_date,contact_name,contact_email,contact_phone)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, makeRef(), user.id, body.origin, body.destination, body.mode, body.cargo, body.quantity, body.weightKg ?? null, body.description, body.pickup, body.delivery, body.insurance, body.readyDate, body.contact.name, body.contact.email, body.contact.phone],
    )
    const { rows } = await db.query<Row>('select * from requests where id = $1', [id])
    if (DEMO_AUTO_QUOTES) await demoAutoQuotes(db, rows[0])
    const [request] = await loadRequests(db, 'id = $1', [id])
    res.status(201).json({ request, user })
  }))

  // quotes
  r.post('/requests/:id/quotes', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    if (user.role !== 'shipper' || !user.shipperId) throw new HttpError(403, 'Only shipper accounts can send quotes.')
    const body = zQuote.parse(req.body)
    const { rows } = await db.query<Row>('select * from requests where id = $1', [req.params.id])
    if (!rows[0]) throw new HttpError(404, 'Request not found.')
    if (rows[0].status !== 'open') throw new HttpError(409, 'This request is no longer open.')
    await db.query('insert into quotes (id,request_id,shipper_id,price,transit_days,valid_until,notes,includes) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (request_id, shipper_id) do update set price = excluded.price, transit_days = excluded.transit_days, valid_until = excluded.valid_until, notes = excluded.notes, includes = excluded.includes, sent_at = now()',
      [uid(), req.params.id, user.shipperId, body.price, body.transitDays, body.validUntil ?? new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), body.notes, JSON.stringify(body.includes)])
    const [request] = await loadRequests(db, 'id = $1', [req.params.id])
    res.status(201).json({ request: { ...request, quotes: request.quotes.filter((x) => x.shipperId === user.shipperId), competingQuotes: request.quotes.filter((x) => x.shipperId !== user.shipperId).length } })
  }))
  r.post('/quotes/:id/accept', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const { rows: qs } = await db.query<Row>('select q.*, r.user_id as owner from quotes q join requests r on r.id = q.request_id where q.id = $1', [req.params.id])
    const q = qs[0]
    if (!q) throw new HttpError(404, 'Quote not found.')
    if (q.owner !== user.id) throw new HttpError(403, 'You can only accept quotes on your own requests.')
    if (q.status !== 'sent') throw new HttpError(409, 'This quote is no longer available.')
    const { rows: rs } = await db.query<Row>('select * from requests where id = $1', [q.request_id])
    const r0 = rs[0]
    if (r0.status !== 'open') throw new HttpError(409, 'This request has already been booked.')
    const { rows: ss } = await db.query<Row>('select * from shippers where id = $1', [q.shipper_id])
    const shipper = shipperOut(ss[0])
    const includes: string[] = J(q.includes)
    const mode = includes.includes('Air freight') ? 'air' : 'ocean'
    const sid = uid()
    await db.query(`update quotes set status = case when id = $1 then 'accepted' else 'declined' end where request_id = $2`, [q.id, q.request_id])
    await db.query(`update requests set status = 'booked' where id = $1`, [q.request_id])
    await db.query('insert into shipments (id,ref,request_id,shipper_id,user_id,mode,origin,destination,cargo,description,status,eta,customer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [sid, r0.ref, r0.id, q.shipper_id, user.id, mode, r0.origin, r0.destination, r0.cargo, r0.description || `${r0.quantity} × ${r0.cargo}`, 'booked', new Date(Date.now() + (q.transit_days + 4) * 86400000).toISOString().slice(0, 10), r0.contact_name])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, 'booked', r0.origin, `Booking confirmed with ${shipper.name}. Quote accepted at $${q.price}.`])
    const [shipment] = await loadShipments(db, 'id = $1', [sid])
    const [request] = await loadRequests(db, 'id = $1', [q.request_id])
    res.status(201).json({ shipment, request })
  }))

  // shipments
  r.get('/shipments', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const shipments = user.role === 'customer' ? await loadShipments(db, 'user_id = $1', [user.id]) : await loadShipments(db, 'shipper_id = $1', [user.shipperId])
    res.json({ shipments })
  }))
  r.post('/shipments/:id/advance', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [req.params.id])
    const s = rows[0]
    if (!s) throw new HttpError(404, 'Shipment not found.')
    if (user.role !== 'shipper' || s.shipper_id !== user.shipperId) throw new HttpError(403, 'Only the handling shipper can update this shipment.')
    const idx = statusOrder.indexOf(s.status as ShipmentStatus)
    if (idx >= statusOrder.length - 1) throw new HttpError(409, 'Shipment is already delivered.')
    const next = statusOrder[idx + 1]
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null
    await db.query('update shipments set status = $2 where id = $1', [s.id, next])
    if (next === 'in_transit') { await db.query('update shipments set departed_at = coalesce(departed_at, now()) where id = $1', [s.id]) }
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, next, idx < 3 ? s.origin : s.destination, note])
    const [shipment] = await loadShipments(db, 'id = $1', [s.id])
    res.json({ shipment })
  }))
  r.post('/shipments/:id/transit', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [req.params.id])
    const s = rows[0]
    if (!s) throw new HttpError(404, 'Shipment not found.')
    if (user.role !== 'shipper' || s.shipper_id !== user.shipperId) throw new HttpError(403, 'Only the handling shipper can update this shipment.')
    const body = zTransit.parse(req.body)
    await db.query('update shipments set vessel_name = $2, mmsi = $3, flight = $4, departed_at = coalesce($5, departed_at) where id = $1',
      [s.id, body.vesselName ?? null, body.mmsi ?? null, body.flight ?? null, body.departedAt ? new Date(body.departedAt) : null])
    await ais.refreshWatchlist()
    const [shipment] = await loadShipments(db, 'id = $1', [s.id])
    res.json({ shipment })
  }))
  r.get('/track/:ref/position', wrap(async (req, res) => {
    const db = await getDb()
    const { rows } = await db.query<Row>('select * from shipments where upper(ref) = upper($1)', [req.params.ref])
    if (!rows[0]) throw new HttpError(404, 'We couldn’t find a shipment with that reference.')
    const { rows: events } = await db.query<Row>('select * from shipment_events where shipment_id = $1 order by at asc', [rows[0].id])
    res.set('Cache-Control', 'no-store')
    res.json({ position: await resolvePosition(rows[0], events) })
  }))
  r.get('/live/region', wrap(async (_req, res) => {
    // Compact wire format: with Europe + US subscribed this is thousands of ships polled every 30s.
    const r3 = (n: number) => Math.round(n * 1000) / 1000
    const vessels = ais.region().map((p) => ({ id: p.id, name: p.name, lat: r3(p.lat), lon: r3(p.lon), speed: p.speed, course: p.course, at: p.at, source: p.source, kind: 'vessel' }))
    const flights = flightsInRegion().filter((a) => !a.onGround).map((a) => ({ id: a.id, name: a.name, lat: r3(a.lat), lon: r3(a.lon), speed: a.speed, course: a.course, altitude: a.altitude, at: a.at, source: a.source, cargo: a.cargo, kind: 'flight' }))
    res.set('Cache-Control', 'no-store')
    res.json({ vessels, flights, congestion: ais.congestion(), ais: { status: ais.status, enabled: ais.enabled, lastMessageAt: ais.lastMessageAt ? new Date(ais.lastMessageAt).toISOString() : null, coastVessels: ais.coast().length, error: ais.lastError || undefined }, adsb: airStatus(), ports: Object.fromEntries(Object.entries(destGeo).map(([k, g]) => [k, { name: g.port.name, at: g.port.at, airport: g.airport }])) })
  }))
  r.get('/live/vessel/:mmsi', wrap(async (req, res) => {
    const mmsi = String(req.params.mmsi)
    if (!/^\d{9}$/.test(mmsi)) throw new HttpError(400, 'Invalid MMSI.')
    const v = ais.detail(mmsi)
    if (!v) throw new HttpError(404, 'No recent AIS data for that vessel.')
    res.set('Cache-Control', 'no-store')
    res.json({ vessel: v })
  }))
  r.get('/live/flight/:hex', wrap(async (req, res) => {
    const hex = String(req.params.hex).toLowerCase()
    if (!/^~?[0-9a-f]{6}$/.test(hex)) throw new HttpError(400, 'Invalid aircraft id.')
    const a = aircraft(hex)
    if (!a) throw new HttpError(404, 'No recent ADS-B data for that aircraft.')
    const route = a.callsign ? await flightRoute(a.callsign) : null
    res.set('Cache-Control', 'no-store')
    res.json({ flight: { ...a, route } })
  }))
  r.get('/track/:ref', wrap(async (req, res) => {
    const db = await getDb()
    const [shipment] = await loadShipments(db, 'upper(ref) = upper($1)', [req.params.ref])
    if (!shipment) throw new HttpError(404, 'We couldn’t find a shipment with that reference.')
    res.json({ shipment })
  }))

  // errors
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' })
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' })
  })
  return r
}
