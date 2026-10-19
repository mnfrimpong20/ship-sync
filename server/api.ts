import { Router, type Request, type Response, type NextFunction } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { publicShipperSql, getDb, makeRef, uid, type Db } from './db'
import { nextStatus, statusLabels, statusOrder, type CargoType, type ShipmentStatus } from '../src/lib/data'
import { alongGreatCircle, destGeo, greatCircle, originCoords, type LngLat } from '../src/lib/geo'
import { ais, aircraft, airStatus, flightPosition, flightRoute, flightsInRegion, type Position } from './live'
import { attachShipmentToClient, logShipmentActivity, mountClients } from './clients'
import { mountOps } from './ops'
import { mountDriverOps, driverForShipment } from './driverOps'
import { mountDriverHr } from './driverHr'
import { mountDriverHr2 } from './driverHr2'
import { mountDirectory } from './directory'
import { mountInsights } from './insights'
import { mountAnalytics } from './analytics'
import { auditMiddleware, mountAudit } from './audit'
import { mountBilling, startBillingSweeps } from './billing'
import { mountCosts } from './costs'
import { mountGrowth, startGrowthSweeps } from './growth'
import { mountIntegrations, startWebhookSweeps } from './integrations'
import { mountAdminInsights, startScorecardSweeps } from './adminInsights'
import { mountCustomerHub, startCustomerSweeps } from './customerHub'
import { mountAccount } from './account'
import { mountContainers } from './containers'
import { mountLabels } from './labels'
import { mountScans, piecesForTracking, proofOfDelivery } from './scans'
import { emailProvider, emailTemplate, mountNotifications, notify, notifyShipmentStatus, notifyShipperStaff, sendEmail } from './notify'
import { autoQuoteFromRates, instantQuote, mountRates, type PriceInput } from './rates'
import { documentCounts, mountDocuments } from './documents'
import { mountPickups } from './pickups'
import { mountRecipient } from './recipient'
import { mountDuty } from './duty'
import { mountInsurance } from './insurance'
import { mountPayments } from './payments'
import { mountGroupage } from './groupage'
import { mountVehicles, vehicleFromRequest, zRequestVehicle } from './vehicles'
import { mountCollections } from './collections'
import { mountBrokers } from './brokers'
import { mountSourcing } from './sourcing'
import { mountSite } from './site'
import { errorRecorder, mountSystem } from './system'
import { mountBusiness } from './business'
import { mountSupplierPortal } from './supplierPortal'
import { mountOnboarding, onVerified } from './onboarding'
import { consigneeToClient, mountCustomer, rememberConsignee, zConsignee } from './customer'
import { isActiveDestination, mountGeoMeta, bustOrigins } from './geoMeta'
import { afterBooking, invoiceForBooking, mountShipmentOps } from './shipmentOps'
import { assertRelease, stuckFor } from './flow'
import { mountFlow } from './flowRoutes'
import { mountRequestFlow, startRequestSweeps, sweepRequests } from './requestFlow'
import { mountBooking } from './booking'
import { mountWarehouse } from './warehouse'
import { mountLanes } from './lanes'
import { mountOperations } from './operations'
import { mountScreening, screenSubject, screeningHold } from './screening'
import { mountMomo } from './momo'
import { mountMeasure } from './measure'
import { mountSupport } from './support'
import { mountPush } from './push'
import { mountPartners } from './partners'
import { mountLineBooking } from './lineBooking'
import { mountQuickBooks } from './quickbooks'
import { mountAutopilot } from './autopilot'
import { mountAutopilotOps } from './autopilotOps'
import { mountRules } from './rules'
import { mountAssistant } from './assistant'
import { mountCompliance, evaluateExport, assertExportCleared, zDeclaration, DECLARATION_VERSION } from './compliance'
import { mountSupplies, attachDefaultSupplies, defaultQuoteSupplies, resolveQuoteSupplies, suppliesFromQuote, suppliesTotal, type QuoteSupplyLine, type SupplyNeed } from './supplies'
import { mountReviews } from './reviews'
import { mountBrand } from './brand'

/* ---------------- types (API shapes match the old client store) ---------------- */
export interface ApiUser { id: string; name: string; email: string; role: 'customer' | 'shipper'; company?: string; shipperId?: string; admin: boolean; staffRole?: 'owner' | 'dispatcher' | 'agent' | 'finance' | 'warehouse' | 'pickup_driver' | 'delivery_driver' | 'driver'; perms?: StaffPerms; staffId?: string; display?: DisplayPrefs; readOnly?: boolean; viewAsBy?: string; actingBy?: { id: string; name: string; email: string } }
export interface StaffPerms { allow?: Area[]; deny?: Area[] }
export interface DisplayPrefs { lang?: 'en' | 'fr'; textSize?: 'normal' | 'large' | 'larger'; theme?: 'light' | 'dark' | 'system'; road?: boolean }
/** Areas a company can grant or withhold per person on top of their role. Mirrors ROLE_AREAS in src/lib/ops.ts. */
export const AREAS = ['leads', 'rates', 'lanes', 'groupage', 'brand', 'shipments', 'containers', 'sailings', 'pickups', 'routes', 'warehouse', 'clients', 'payments', 'collections', 'reviews', 'fleet', 'team', 'verification', 'sourcing', 'analytics'] as const
export type Area = (typeof AREAS)[number]
const ROLE_BASE: Record<string, Area[] | 'all'> = {
  owner: 'all', dispatcher: 'all',
  agent: ['leads', 'rates', 'lanes', 'groupage', 'shipments', 'containers', 'sailings', 'pickups', 'routes', 'warehouse', 'clients', 'reviews', 'team', 'sourcing', 'analytics'],
  finance: ['clients', 'payments', 'collections', 'reviews', 'shipments', 'team', 'analytics'],
  warehouse: ['warehouse', 'containers', 'pickups', 'shipments', 'team', 'analytics'],
  pickup_driver: ['routes'], delivery_driver: ['routes'], driver: ['routes'],
}
/** Role + per-person overrides → may this staff member use this area? Admins and customers are handled by callers. */
export function can(u: ApiUser, area: Area): boolean {
  if (u.role !== 'shipper') return false
  const role = u.staffRole ?? 'owner'
  if (u.perms?.deny?.includes(area)) return false
  if (u.perms?.allow?.includes(area)) return true
  const base = ROLE_BASE[role] ?? []
  return base === 'all' || base.includes(area)
}
type Row = Record<string, any>

const SESSION_COOKIE = 'ss_session'
const SESSION_DAYS = 30
const DEMO_AUTO_QUOTES = (process.env.DEMO_AUTO_QUOTES ?? 'true') !== 'false'

/* ---------------- helpers ---------------- */
const ISO = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : String(v))
const DATE = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const J = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)

/** A shipper's uploaded logo, served as its own cacheable image (never inlined into lists — logos can be 250 KB). */
const brandLogo = (r: Row): string => { const b = J(r.brand) as { logo?: string } | null; return typeof b?.logo === 'string' ? b.logo : '' }
const logoUrl = (r: Row) => { const l = brandLogo(r); return l ? `/api/shippers/${encodeURIComponent(r.id)}/logo?v=${createHash('sha1').update(l).digest('hex').slice(0, 10)}` : null }
const shipperOut = (r: Row) => ({
  logo: logoUrl(r),
  id: r.id, name: r.name, tagline: r.tagline, hq: r.hq, founded: r.founded, modes: J(r.modes), destinations: J(r.destinations), origins: J(r.origins), cargo: J(r.cargo),
  rating: Number(r.rating), reviews: r.reviews, verified: r.verified, responseHours: r.response_hours, onTime: r.on_time, services: J(r.services), about: r.about,
  priceIndex: r.price_index, plan: r.plan, standing: r.standing ?? 'good', qualityScore: J(r.quality)?.score ?? null, initials: r.initials, hue: r.hue, demo: r.demo, verifiedAt: r.verified_at ? ISO(r.verified_at) : undefined, createdAt: r.created_at ? ISO(r.created_at) : undefined,
})
const quoteMode = (r: Row) => (r.mode === 'air' || r.mode === 'ocean' ? r.mode : (J(r.includes) as string[] ?? []).includes('Air freight') ? 'air' : 'ocean')
const quoteOut = (r: Row) => ({ id: r.id, requestId: r.request_id, shipperId: r.shipper_id, price: r.price, currency: r.currency, transitDays: r.transit_days, validUntil: DATE(r.valid_until), notes: r.notes, includes: J(r.includes), status: r.status, sentAt: ISO(r.sent_at), updatedAt: r.updated_at ? ISO(r.updated_at) : undefined,
  kind: (r.kind ?? 'firm') as 'firm' | 'estimate', mode: quoteMode(r) as 'air' | 'ocean', supplies: J(r.supplies ?? '[]') as QuoteSupplyLine[], suppliesUsd: suppliesTotal(J(r.supplies ?? '[]') as QuoteSupplyLine[]), expired: r.status === 'sent' && DATE(r.valid_until) < new Date().toISOString().slice(0, 10) })
/** Shippers see only the town of the supplies address until the job is theirs (same rule as the contact details). */
const maskSupAddr = (a: unknown, full: boolean) => (!a ? undefined : full ? a : { city: (a as Row).city, state: (a as Row).state, country: (a as Row).country })
const requestOut = (r: Row, quotes: Row[]) => ({
  id: r.id, ref: r.ref, userId: r.user_id, createdAt: ISO(r.created_at), origin: r.origin, destination: r.destination, mode: r.mode, cargo: r.cargo, quantity: r.quantity, weightKg: r.weight_kg ?? undefined,
  description: r.description, pickup: r.pickup, delivery: r.delivery, insurance: r.insurance, readyDate: DATE(r.ready_date),
  contact: { name: r.contact_name, email: r.contact_email, phone: r.contact_phone }, status: r.status, quotes: quotes.map((q) => ({ ...quoteOut(q), stale: !!r.updated_at && new Date(q.updated_at ?? q.sent_at) < new Date(r.updated_at) })),
  declaration: r.declaration ? (J(r.declaration) as { accepted: boolean; includes: string[]; at: string; version: string }) : undefined,
  supplies: r.supplies ? (J(r.supplies) as SupplyNeed[]) : [], suppliesAddress: r.supplies_address ? J(r.supplies_address) : undefined,
  dims: r.dims ?? '', declaredValueUsd: r.declared_value_usd == null ? undefined : Number(r.declared_value_usd), expiresAt: r.expires_at ? ISO(r.expires_at) : undefined, updatedAt: r.updated_at ? ISO(r.updated_at) : undefined, cancelReason: r.cancel_reason ?? undefined, openedToMarket: !!r.opened_to_market_at, vehicle: r.vehicle ? J(r.vehicle) : undefined, consignee: r.consignee ? J(r.consignee) : undefined, source: r.source ?? 'marketplace', preferredShipperId: r.preferred_shipper_id ?? undefined,
})
const shipmentOut = (r: Row, events: Row[]) => ({
  id: r.id, ref: r.ref, shipperId: r.shipper_id, mode: r.mode, origin: r.origin, destination: r.destination, cargo: r.cargo, description: r.description, status: r.status, eta: DATE(r.eta), customer: r.customer,
  vesselName: r.vessel_name ?? undefined, mmsi: r.mmsi ?? undefined, flight: r.flight ?? undefined, departedAt: r.departed_at ? ISO(r.departed_at) : undefined, clientId: r.client_id ?? undefined, consigneeId: r.consignee_id ?? undefined, containerId: r.container_id ?? undefined, requestId: r.request_id ?? undefined, groupageId: r.groupage_id ?? undefined,
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
  // Everything the live map knows about the carrier itself (flag, type, reported destination / scheduled route…).
  let detail: Record<string, unknown> | null = null
  if (mode === 'ocean' && r.mmsi) { const v = ais.detail(r.mmsi); if (v) detail = { kind: 'vessel', ...v } }
  if (mode === 'air' && r.flight) {
    const cs = String(r.flight).toUpperCase()
    const a = flightsInRegion().find((x) => x.callsign === cs)
    const route = await flightRoute(cs)
    if (a) detail = { kind: 'flight', ...a, route }
    else if (route || live || lastKnown) detail = { kind: 'flight', id: cs, callsign: cs, cargo: false, onGround: false, ...(live ?? lastKnown ?? {}), route }
  }
  return {
    detail,
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
const userOut = (r: Row, company?: string): ApiUser => ({ id: r.id, name: r.name, email: r.email, role: r.role, shipperId: r.shipper_id ?? undefined, company, admin: !!r.is_admin, staffRole: r.shipper_id ? (r.staff_role ?? 'owner') : undefined, perms: r.shipper_id ? ((J(r.staff_perms) ?? {}) as StaffPerms) : undefined, staffId: r.staff_id ?? undefined, display: (J(r.display) ?? {}) as DisplayPrefs })

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
    `select u.*, s.name as company, st.role as staff_role, st.perms as staff_perms, st.id as staff_id, st.last_active_at, se.read_only as se_read_only, se.impersonator_id as se_impersonator, se.acting_as as se_acting_as from sessions se join users u on u.id = se.user_id left join shippers s on s.id = u.shipper_id left join staff st on st.user_id = u.id and st.shipper_id = u.shipper_id where se.id = $1 and se.expires_at > now()`, [sid],
  )
  const r = rows[0]; if (!r) return null
  // "Where you're signed in" — last seen, touched at most every 10 minutes.
  db.query(`update sessions set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '10 minutes')`, [sid]).catch(() => {})
  // Staff "last active" — touched at most every 10 minutes so the team page can show who's really using the app.
  if (r.staff_id && (!r.last_active_at || Date.now() - new Date(r.last_active_at).getTime() > 10 * 60_000)) db.query('update staff set last_active_at = now() where id = $1', [r.staff_id]).catch(() => {})
  let u = userOut(r, r.company ?? undefined)
  // Household / business accounts: a member who switched into a shared account acts as its owner.
  if (r.se_acting_as && r.role === 'customer') {
    const { rows: m } = await db.query<Row>(`select o.* from account_members am join users o on o.id = am.owner_id where am.owner_id = $1 and am.member_id = $2 and am.status = 'active'`, [r.se_acting_as, r.id])
    if (m[0]) { u = userOut(m[0]); u.actingBy = { id: r.id, name: r.name, email: r.email } }
  }
  if (r.se_impersonator) { u.readOnly = !!r.se_read_only; u.viewAsBy = r.se_impersonator }
  ;(req as Request & { ssUser?: ApiUser }).ssUser = u
  return u
}

async function createSession(db: Db, res: Response, userId: string, req?: Request, days = SESSION_DAYS) {
  const id = randomBytes(32).toString('hex')
  await db.query('insert into sessions (id,user_id,expires_at,user_agent,last_seen_at) values ($1,$2,$3,$4,now())', [id, userId, new Date(Date.now() + days * 86400000), String(req?.headers['user-agent'] ?? '').slice(0, 300)])
  res.cookie(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: days * 86400000, path: '/' })
}

/** In-memory sliding-window brake for auth endpoints (per process; good enough for one Replit instance). */
const buckets = new Map<string, number[]>()
function throttle(key: string, max: number, windowMs: number, Err: typeof HttpError) {
  const now = Date.now(); const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) throw new Err(429, 'Too many attempts — please wait a few minutes and try again.')
  hits.push(now); buckets.set(key, hits)
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.every((t) => now - t > windowMs)) buckets.delete(k)
}
const clearThrottle = (key: string) => buckets.delete(key)
const clientIp = (req: Request) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown'

const requireUser = async (db: Db, req: Request) => {
  const u = await currentUser(db, req); if (!u) throw new HttpError(401, 'Please sign in.')
  // An admin "viewing as" someone can look but never change anything.
  if (u.readOnly && req.method !== 'GET' && !/\/(view-as\/exit|auth\/logout)$/.test(req.path)) throw new HttpError(403, 'Read-only view — exit “View as” to make changes.')
  return u
}
const requireAdmin = async (db: Db, req: Request) => { const u = await requireUser(db, req); if (!u.admin) throw new HttpError(403, 'Admin access only.'); return u }
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'SS'

async function loadUserWithCompany(db: Db, id: string) {
  const { rows } = await db.query<Row>('select u.*, s.name as company, st.role as staff_role, st.perms as staff_perms, st.id as staff_id from users u left join shippers s on s.id = u.shipper_id left join staff st on st.user_id = u.id and st.shipper_id = u.shipper_id where u.id = $1', [id])
  return userOut(rows[0], rows[0].company ?? undefined)
}

/** New customers who posted without a password get a link to set one (valid 3 days). */
async function sendSetPasswordLink(db: Db, userId: string, name: string, email: string, req: Request) {
  const token = randomBytes(24).toString('base64url')
  await db.query(`insert into password_resets (token,user_id,expires_at) values ($1,$2,now() + interval '3 days')`, [token, userId])
  const link = `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/reset?token=${token}&welcome=1`
  if (emailProvider().id === 'off') { console.log('[auth] set-password link (email off):', link); return false }
  try { await sendEmail(email, 'Your Ntemtem quotes — set a password', emailTemplate({ name, title: 'Your request is in', body: 'Shippers are pricing your shipment now. Quotes appear in your dashboard and we email you as each one arrives. Set a password so you can sign back in from any device.', link, cta: 'Set my password' })); return true } catch (e) { console.error('[auth] set-password email', e); return false }
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
      `insert into shippers (id,name,tagline,hq,founded,modes,destinations,origins,cargo,verified,response_hours,services,about,price_index,plan,initials,hue,demo,trial_ends_at)
       values ($1,$2,$3,$4,$5,'["ocean","air"]','[]','[]','[]',false,24,'[]',$6,2,'starter',$7,$8,false,now() + interval '14 days')`,
      [shipperId, company, 'New on Ntemtem', '', new Date().getFullYear(), `${company} is a new shipping company on Ntemtem. Profile details coming soon.`, initials, '#F5B82E'],
    )
  }
  const hash = await bcrypt.hash(input.password, 10)
  await db.query('insert into users (id,email,name,password_hash,role,shipper_id) values ($1,$2,$3,$4,$5,$6)', [id, email, input.name.trim(), hash, input.role, shipperId])
  return loadUserWithCompany(db, id)
}

/* ---------------- matching ---------------- */
type MatchInput = { origin: string; destination: string; mode: 'air' | 'ocean' | 'either'; cargo: CargoType }
/**
 * The one lead rule, used by alerts, the Requests board and the customer's matching list:
 *   eligible = serves the destination, offers the mode (or the request says either), handles the cargo type.
 *   local    = also collects in that city or state ("Houston, TX" covers "Katy, TX"). Alerts go to local shippers;
 *              the board shows every eligible lead and flags the ones outside the shipper's pickup area.
 */
export function leadFit(shipper: { destinations: string[]; modes: string[]; cargo: string[]; origins: string[] }, r: { destination: string; mode: string; cargo: string; origin: string }) {
  const eligible = shipper.destinations.includes(r.destination) && (r.mode === 'either' || shipper.modes.includes(r.mode)) && (!shipper.cargo.length || shipper.cargo.includes(r.cargo))
  const region = (o: string) => (o.split(',')[1] ?? '').trim().toUpperCase()
  const local = shipper.origins.includes(r.origin) || (!!region(r.origin) && shipper.origins.some((o) => region(o) === region(r.origin)))
  return { eligible, local }
}
async function matchShippers(db: Db, r: MatchInput) {
  const { rows } = await db.query<Row>(`select * from shippers where ${publicShipperSql()}`)
  return rows
    .map(shipperOut)
    .map((shipper) => {
      const reasons: string[] = []
      let score = 0
      if (!shipper.destinations.includes(r.destination)) return { shipper, score: -1, reasons }
      score += 40; reasons.push('Serves this destination')
      if (r.mode !== 'either') { if (shipper.modes.includes(r.mode)) { score += 20; reasons.push(`Offers ${r.mode} freight`) } else return { shipper, score: -1, reasons } }
      else score += 10
      if (shipper.cargo.length && !shipper.cargo.includes(r.cargo)) return { shipper, score: -1, reasons }
      score += 20; reasons.push('Handles this cargo type')
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
  // Shippers that publish rate cards price for themselves — the simulator leaves them alone.
  const { rows: priced } = await db.query<Row>('select distinct shipper_id from rate_cards where active')
  const real = new Set(priced.map((p) => p.shipper_id))
  const matches = (await matchShippers(db, { origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo })).filter((m) => m.shipper.demo && !real.has(m.shipper.id)).slice(0, 4)
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
  if (matches.length) await notify(db, { userId: req.user_id, kind: 'quote_received', title: `${matches.length} quote${matches.length === 1 ? '' : 's'} for ${req.ref}`, body: `${matches.map((m) => m.shipper.name).join(', ')} ${matches.length === 1 ? 'has' : 'have'} priced your ${req.origin} → ${req.destination} request. Compare and accept the one you like.`, link: '/dashboard', dedupe: `rq:${req.id}:demo-quotes` })
}

/** Shippers with a published, auto-send rate card for this lane quote instantly; the customer hears about it right away. */
async function instantQuotesFromRates(db: Db, req: Row) {
  const matches = await matchShippers(db, { origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo })
  const quoted = await autoQuoteFromRates(db, req, matches.map((m) => m.shipper.id))
  for (const q of quoted) {
    const name = matches.find((m) => m.shipper.id === q.shipperId)?.shipper.name ?? 'A shipper'
    await notify(db, { userId: req.user_id, kind: 'quote_received', title: `Instant quote: ${name} — $${q.price.toLocaleString()} for ${req.ref}`, body: `${name} publishes rates for this lane, so your price is ready now. Open your dashboard to compare and accept.`, link: '/dashboard', dedupe: `rq:${req.id}:rate:${q.shipperId}` })
    await notifyShipperStaff(db, q.shipperId, { kind: 'new_lead', title: `Instant quote sent — ${req.ref}`, body: `$${q.price.toLocaleString()} went to ${req.contact_name} from your rate card (${req.quantity} × ${req.cargo}, ${req.origin} → ${req.destination}).`, link: '/dashboard/leads', dedupe: `lead:${req.id}:auto` }, ['owner', 'dispatcher', 'agent'])
  }
  return quoted
}

/** Shippers whose lanes match a fresh request hear about it as a lead (unless they already auto-quoted it). */
async function notifyNewLead(db: Db, req: Row) {
  const { rows: quoted } = await db.query<Row>('select shipper_id from quotes where request_id = $1', [req.id])
  const done = new Set(quoted.map((q) => q.shipper_id))
  const matches = (await matchShippers(db, { origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo })).filter((m) => !done.has(m.shipper.id) && leadFit(m.shipper, req as never).local)
  for (const m of matches) {
    void import('./rules').then((x) => x.fireRules(db, m.shipper.id, 'request.received', { request: req })).catch(() => {})
    void import('./integrations').then((x) => x.emitWebhook(db, m.shipper.id, 'request.received', { request: { id: req.id, ref: req.ref, origin: req.origin, destination: req.destination, mode: req.mode, cargo: req.cargo, quantity: req.quantity, readyDate: String(req.ready_date ?? '').slice(0, 10) } })).catch(() => {})
    await notifyShipperStaff(db, m.shipper.id, { kind: 'new_lead', title: `New client request: ${req.quantity} × ${req.cargo} to ${req.destination}`, body: `${req.contact_name} wants to ship from ${req.origin} (${req.mode === 'either' ? 'air or ocean' : req.mode}), ready ${String(req.ready_date).slice(0, 10)}. Send a quote before the competition does.`, link: '/dashboard/leads', dedupe: `lead:${req.id}` }, ['owner', 'dispatcher', 'agent'])
  }
}

/* ---------------- loaders ---------------- */
/** Before booking a shipper sees the client's first name and initial only — contact details unlock when their quote is accepted (their own link/branded-page clients excepted). */
function contactFor(q: { contact: { name: string; email: string; phone: string }; source?: string; preferredShipperId?: string }, shipperId: string, won: boolean) {
  if (won || ((q.source === 'link' || q.source === 'branded') && q.preferredShipperId === shipperId)) return { ...q.contact, hidden: false }
  const [first, ...rest] = q.contact.name.trim().split(/\s+/)
  return { name: `${first}${rest.length ? ` ${rest[rest.length - 1][0]}.` : ''}`, email: '', phone: '', hidden: true }
}
async function loadRequests(db: Db, where: string, params: unknown[], opts: { limit?: number } = {}) {
  const { rows } = await db.query<Row>(`select * from requests where ${where} order by created_at desc${opts.limit ? ` limit ${Number(opts.limit)}` : ''}`, params)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const { rows: quotes } = await db.query<Row>(`select * from quotes where request_id = any($1::text[]) order by sent_at asc`, [ids])
  return rows.map((r) => requestOut(r, quotes.filter((q) => q.request_id === r.id)))
}
async function loadShipments(db: Db, where: string, params: unknown[], opts: { includeCancelled?: boolean } = {}) {
  const { rows } = await db.query<Row>(`select * from shipments where (${where})${opts.includeCancelled ? '' : ' and cancelled_at is null'} order by created_at desc`, params)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [{ rows: events }, auto, { rows: inv }, { rows: esc }] = await Promise.all([
    db.query<Row>(`select * from shipment_events where shipment_id = any($1::text[]) order by at asc, id asc`, [ids]),
    autoDrivers(db, rows),
    db.query<Row>(`select i.shipment_id, sum(greatest(i.total - coalesce(p.paid, 0), 0))::numeric as owed from invoices i left join (select invoice_id, sum(amount) as paid from payments group by invoice_id) p on p.invoice_id = i.id where i.shipment_id = any($1::text[]) and i.status in ('sent','partial') group by i.shipment_id`, [ids]),
    db.query<Row>(`select shipment_id, sum(amount_usd)::numeric as paid from escrow_payments where shipment_id = any($1::text[]) and status in ('held','released','paid_out','direct') group by shipment_id`, [ids]),
  ])
  const out = []
  for (const r of rows) {
    const evs = events.filter((e) => e.shipment_id === r.id)
    const sd = r.storage_due ? J(r.storage_due) as { days: number; amountUsd: number; freeUntil: string | null } : null
    const owedInv = Math.max(0, Number(inv.find((x) => x.shipment_id === r.id)?.owed ?? 0) - Number(esc.find((x) => x.shipment_id === r.id)?.paid ?? 0))
    const owed = Math.round((owedInv + (r.storage_billed ? 0 : Number(sd?.amountUsd ?? 0))) * 100) / 100
    out.push({ ...shipmentOut(r, evs), autoBy: auto.get(r.id), handover: (r.handover ?? 'delivery') as 'delivery' | 'collection', readyAt: r.ready_at ? ISO(r.ready_at) : undefined, etaOriginal: r.eta_original ? DATE(r.eta_original) : undefined,
      cancelledAt: r.cancelled_at ? ISO(r.cancelled_at) : undefined, cancelReason: r.cancel_reason ?? undefined, stuck: await stuckFor(db, r, evs), owedUsd: owed > 0 ? owed : undefined, storageDue: sd && sd.amountUsd > 0 && !r.storage_billed ? sd : undefined })
  }
  return out
}
/**
 * What will move each shipment's status without a click, if anything:
 *   a pending run stop (pickup → Picked up; delivery → Out for delivery/Delivered),
 *   its container (cascades through Customs), or piece labels (a scan → Picked up).
 */
async function autoDrivers(db: Db, rows: Row[]) {
  const out = new Map<string, { kind: 'run' | 'container' | 'scan'; label: string }>()
  const ids = rows.map((r) => r.id)
  const cids = [...new Set(rows.map((r) => r.container_id).filter(Boolean))]
  const [{ rows: stops }, { rows: cons }, { rows: pcs }] = await Promise.all([
    db.query<Row>(`select rs.shipment_id, r.kind, r.status, r.run_date from run_stops rs join runs r on r.id = rs.run_id where rs.shipment_id = any($1::text[]) and rs.status = 'pending' and r.status <> 'cancelled' order by r.run_date`, [ids]),
    cids.length ? db.query<Row>('select id, ref from containers where id = any($1::text[])', [cids]) : Promise.resolve({ rows: [] as Row[] }),
    db.query<Row>(`select shipment_id, count(*)::int as n from pieces where shipment_id = any($1::text[]) group by shipment_id`, [ids]),
  ])
  const at = (s: string) => statusOrder.indexOf(s as ShipmentStatus)
  for (const r of rows) {
    const i = at(r.status)
    const del = stops.find((x) => x.shipment_id === r.id && x.kind !== 'pickup')
    const pick = stops.find((x) => x.shipment_id === r.id && x.kind === 'pickup')
    const c = cons.find((x) => x.id === r.container_id)
    const n = Number(pcs.find((x) => x.shipment_id === r.id)?.n ?? 0)
    if (del && i >= at('arrived') && i < at('delivered')) out.set(r.id, { kind: 'run', label: del.status === 'in_progress' ? 'driver on the way' : `delivery run ${DATE(del.run_date)}` })
    else if (pick && r.status === 'booked') out.set(r.id, { kind: 'run', label: `pickup run ${DATE(pick.run_date)}` })
    else if (c && (i < at('customs') || (r.handover === 'collection' && i < at('ready_for_collection')))) out.set(r.id, { kind: 'container', label: `follows ${c.ref}` })
    else if (n > 0 && r.status === 'booked') out.set(r.id, { kind: 'scan', label: 'label scan' })
  }
  return out
}

/* ---------------- schemas ---------------- */
const zRole = z.enum(['customer', 'shipper'])
const zSignup = z.object({ name: z.string().trim().min(2, 'Enter your name.'), email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(8, 'Password must be at least 8 characters.'), role: zRole, company: z.string().trim().optional(), ref: z.string().trim().max(24).optional() })
const zLogin = z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.') })
const zMatch = z.object({ origin: z.string().min(1), destination: z.string().length(2), mode: z.enum(['air', 'ocean', 'either']), cargo: z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial']) })
const zMatchPriced = zMatch.extend({ quantity: z.number().int().min(1).max(10_000).optional(), weightKg: z.number().min(0).optional(), pickup: z.boolean().optional(), delivery: z.boolean().optional(), insurance: z.boolean().optional() })
const zRequest = zMatch.extend({
  quantity: z.number().int().min(1), weightKg: z.number().int().min(0).optional(), description: z.string().max(2000).default(''), pickup: z.boolean(), delivery: z.boolean(), insurance: z.boolean(),
  dims: z.string().trim().max(80).default(''), declaredValueUsd: z.number().min(0).max(5_000_000).optional(),
  readyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), contact: z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), phone: z.string().trim().min(7) }),
  password: z.string().min(8).optional(),
  vehicle: zRequestVehicle.optional(),
  /** White-label: lead goes only to this shipper. */
  preferredShipperId: z.string().max(80).optional(),
  /** Who receives it at destination — saved to the customer's recipients and handed to the shipper on booking. */
  consignee: zConsignee.optional(),
  /** How the request reached a specific shipper: picked in the form, the shipper's order link, or their branded page. */
  source: z.enum(['marketplace', 'picked', 'link', 'branded']).optional(),
  /** Packing supplies the customer needs before pickup (from their shipper, or sent by Ntemtem). */
  supplies: z.array(z.object({ kind: z.enum(['barrel', 'box', 'lock', 'tape', 'other']), qty: z.number().int().min(1).max(50) })).max(5).optional(),
  /** The sender confirms nothing prohibited is inside, and flags restricted items for the shipper. */
  declaration: zDeclaration,
  suppliesAddress: z.object({ name: z.string().trim().min(2).max(80), line1: z.string().trim().min(3).max(160), line2: z.string().trim().max(160).default(''), city: z.string().trim().min(2).max(80), state: z.string().trim().max(40).default(''), zip: z.string().trim().max(20).default(''), country: z.string().trim().min(2).max(40).default('US'), phone: z.string().trim().max(40).default('') }).optional(),
})
const zTransit = z.object({
  vesselName: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
  mmsi: z.string().trim().regex(/^\d{9}$/, 'MMSI is a 9-digit number.').optional().or(z.literal('').transform(() => undefined)),
  flight: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,8}$/, 'Use the ICAO flight callsign, e.g. CLX775 or BAW75.').optional().or(z.literal('').transform(() => undefined)),
  departedAt: z.string().datetime().optional(),
})
const zProfile = z.object({
  /** Company logo: a PNG, JPG, WebP or SVG as a data URL; '' removes it. Stored with the branded-page settings. */
  logo: z.string().max(260_000).regex(/^$|^data:image\/(png|jpeg|webp|svg\+xml);base64,/, 'Upload a PNG, JPG, WebP or SVG.').optional(),
  name: z.string().trim().min(2, 'Company name is too short.').max(80),
  tagline: z.string().trim().max(120).default(''),
  hq: z.string().trim().max(80).default(''),
  founded: z.number().int().min(1900).max(new Date().getFullYear()),
  modes: z.array(z.enum(['air', 'ocean'])).min(1, 'Choose at least one mode.'),
  destinations: z.array(z.string().trim().length(2).toUpperCase()).min(1, 'Choose at least one destination.'),
  origins: z.array(z.string().trim().min(2).max(60)).max(25),
  cargo: z.array(z.enum(['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40', 'commercial'])).min(1, 'Choose at least one cargo type.'),
  services: z.array(z.string().trim().min(2).max(60)).max(12),
  about: z.string().trim().max(2000).default(''),
  priceIndex: z.number().int().min(1).max(3),
  responseHours: z.number().int().min(1).max(168),
})
const zVerify = z.object({ verified: z.boolean(), plan: z.enum(['starter', 'pro', 'enterprise']).optional(), note: z.string().trim().max(500).optional() })
const zQuote = z.object({ price: z.number().int().min(1), transitDays: z.number().int().min(1), notes: z.string().max(2000).default(''), includes: z.array(z.string()).default([]), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), kind: z.enum(['firm', 'estimate']).default('firm'), mode: z.enum(['air', 'ocean']).optional() , supplies: z.array(z.object({ kind: z.enum(['barrel', 'box', 'lock', 'tape', 'other']), qty: z.number().int().min(1).max(50), source: z.enum(['shipper', 'ntemtem', 'none']), supplyId: z.string().max(60).optional(), productId: z.string().max(60).optional() })).max(5).optional() })

/* ---------------- router ---------------- */
export function apiRouter() {
  const r = Router()
  r.use(auditMiddleware(getDb))

  r.get('/health', wrap(async (_req, res) => { const db = await getDb(); res.json({ ok: true, db: db.kind }) }))

  // auth
  r.post('/auth/signup', wrap(async (req, res) => {
    const db = await getDb(); const body = zSignup.parse(req.body)
    throttle(`signup:ip:${clientIp(req)}`, 10, 60 * 60_000, HttpError)
    const user = await signupUser(db, body)
    if (body.ref && user.role === 'customer') await (await import('./customerHub')).applyReferral(db, user.id, body.ref).catch(() => {})
    await createSession(db, res, user.id, req)
    res.status(201).json({ user })
  }))
  r.post('/auth/login', wrap(async (req, res) => {
    const db = await getDb(); const body = zLogin.parse(req.body)
    const email = body.email.toLowerCase(); const ip = clientIp(req)
    throttle(`login:ip:${ip}`, 30, 15 * 60_000, HttpError); throttle(`login:email:${email}`, 10, 15 * 60_000, HttpError)
    const { rows } = await db.query<Row>('select * from users where email = $1', [email])
    if (!rows[0] || !(await bcrypt.compare(body.password, rows[0].password_hash))) throw new HttpError(401, 'Email or password is incorrect.')
    clearThrottle(`login:email:${email}`)
    await createSession(db, res, rows[0].id, req)
    res.json({ user: await loadUserWithCompany(db, rows[0].id) })
  }))
  /** Sign-in link (no password): by email, or by text to a team member's phone. Always answers OK. Links work once, for 15 minutes. */
  r.post('/auth/link', wrap(async (req, res) => {
    const db = await getDb(); const { who } = z.object({ who: z.string().trim().min(5).max(120) }).parse(req.body)
    throttle(`link:ip:${clientIp(req)}`, 10, 60 * 60_000, HttpError); throttle(`link:who:${who.toLowerCase()}`, 3, 30 * 60_000, HttpError)
    const isEmail = who.includes('@'); const digits = who.replace(/\D/g, '')
    let target: { id: string; name: string; email: string; phone: string } | null = null
    if (isEmail) { const { rows } = await db.query<Row>('select id, name, email from users where email = $1', [who.toLowerCase()]); if (rows[0]) target = { id: rows[0].id, name: rows[0].name, email: rows[0].email, phone: '' } }
    else if (digits.length >= 7) {
      const { rows } = await db.query<Row>(`select u.id, u.name, u.email, st.phone from staff st join users u on u.id = st.user_id where st.status = 'active' and regexp_replace(st.phone, '[^0-9]', '', 'g') like '%' || $1`, [digits.slice(-9)])
      if (rows.length === 1) target = { id: rows[0].id, name: rows[0].name, email: rows[0].email, phone: rows[0].phone }
    }
    if (target) {
      const token = randomBytes(24).toString('base64url')
      await db.query(`insert into login_links (token,user_id,expires_at) values ($1,$2,now() + interval '15 minutes')`, [token, target.id])
      const link = `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/signin?token=${token}`
      if (!isEmail) {
        const sms = await import('./sms')
        const to = sms.normalisePhone(target.phone, 'US') ?? sms.normalisePhone(target.phone, 'GH')
        if (to && sms.smsProvider().id !== 'off') { try { await sms.sendText(to, `Ntemtem: tap to sign in (works once, for 15 minutes): ${link}`) } catch (e) { console.error('[auth] link text', e) } } else console.log('[auth] sign-in link (texts off):', link)
      } else if (emailProvider().id !== 'off') { try { await sendEmail(target.email, 'Your Ntemtem sign-in link', emailTemplate({ name: target.name, title: 'Sign in to Ntemtem', body: 'Tap the button to sign in. The link works once, for 15 minutes. If you didn’t ask for it, ignore this email.', link, cta: 'Sign in' })) } catch (e) { console.error('[auth] link email', e) } }
      else console.log('[auth] sign-in link (email off):', link)
    }
    res.json({ ok: true })
  }))
  r.post('/auth/link/use', wrap(async (req, res) => {
    const db = await getDb(); const { token } = z.object({ token: z.string().min(10).max(80) }).parse(req.body)
    throttle(`linkuse:ip:${clientIp(req)}`, 30, 60 * 60_000, HttpError)
    const { rows } = await db.query<Row>(`update login_links set used_at = now() where token = $1 and used_at is null and expires_at > now() returning user_id`, [token])
    if (!rows[0]) throw new HttpError(400, 'This sign-in link has expired or was already used. Ask for a new one.')
    await createSession(db, res, rows[0].user_id, req)
    res.json({ user: await loadUserWithCompany(db, rows[0].user_id) })
  }))
  /** A PIN for this phone: the phone keeps a secret, the person remembers 4–6 digits. Five wrong tries removes it. */
  r.post('/auth/pin', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const { pin, label } = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits.'), label: z.string().trim().max(80).default('') }).parse(req.body)
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new HttpError(400, 'Pick a PIN that isn’t a run like 1234 or 1111.')
    const id = 'pin_' + uid(); const secret = randomBytes(24).toString('base64url')
    await db.query('insert into device_pins (id,user_id,secret_hash,pin_hash,label) values ($1,$2,$3,$4,$5)', [id, u.id, await bcrypt.hash(secret, 8), await bcrypt.hash(pin, 10), label || String(req.headers['user-agent'] ?? '').slice(0, 80)])
    res.status(201).json({ device: { id, secret, name: u.name.split(' ')[0], email: u.email } })
  }))
  r.post('/auth/pin/login', wrap(async (req, res) => {
    const db = await getDb(); const b = z.object({ id: z.string().min(5).max(40), secret: z.string().min(10).max(80), pin: z.string().regex(/^\d{4,6}$/) }).parse(req.body)
    throttle(`pin:ip:${clientIp(req)}`, 20, 15 * 60_000, HttpError)
    const { rows } = await db.query<Row>('select * from device_pins where id = $1', [b.id]); const d = rows[0]
    if (!d || !(await bcrypt.compare(b.secret, d.secret_hash))) throw new HttpError(401, 'This phone’s PIN was removed. Sign in with your email and password.')
    if (!(await bcrypt.compare(b.pin, d.pin_hash))) {
      const fails = Number(d.fails) + 1
      if (fails >= 5) { await db.query('delete from device_pins where id = $1', [d.id]); throw new HttpError(401, 'Too many wrong PINs — the PIN was removed. Sign in with your email and password.') }
      await db.query('update device_pins set fails = $2 where id = $1', [d.id, fails]); throw new HttpError(401, `Wrong PIN. ${5 - fails} ${5 - fails === 1 ? 'try' : 'tries'} left.`)
    }
    await db.query('update device_pins set fails = 0, last_used_at = now() where id = $1', [d.id])
    await createSession(db, res, d.user_id, req, 90)
    res.json({ user: await loadUserWithCompany(db, d.user_id) })
  }))
  r.delete('/auth/pin/:id', wrap(async (req, res) => { const db = await getDb(); const u = await requireUser(db, req); await db.query('delete from device_pins where id = $1 and user_id = $2', [req.params.id, u.id]); res.json({ ok: true }) }))
  /** Forgot password: always answers OK (no account enumeration); emails a 1-hour link when the account exists. */
  r.post('/auth/forgot', wrap(async (req, res) => {
    const db = await getDb(); const { email } = z.object({ email: z.string().trim().email() }).parse(req.body); const e = email.toLowerCase()
    throttle(`forgot:ip:${clientIp(req)}`, 10, 60 * 60_000, HttpError); throttle(`forgot:email:${e}`, 3, 60 * 60_000, HttpError)
    const { rows } = await db.query<Row>('select id, name from users where email = $1', [e])
    if (rows[0]) {
      const token = randomBytes(24).toString('base64url')
      await db.query(`insert into password_resets (token,user_id,expires_at) values ($1,$2,now() + interval '1 hour')`, [token, rows[0].id])
      const link = `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/reset?token=${token}`
      if (emailProvider().id !== 'off') { try { await sendEmail(e, 'Reset your Ntemtem password', emailTemplate({ name: rows[0].name, title: 'Reset your password', body: 'Someone asked to reset the password for this Ntemtem account. The link below works for one hour. If that was not you, you can ignore this email — nothing changes.', link, cta: 'Choose a new password' })) } catch (err) { console.error('[auth] reset email', err) } }
      else console.log('[auth] password reset link (email off):', link)
    }
    res.json({ ok: true })
  }))
  r.post('/auth/reset', wrap(async (req, res) => {
    const db = await getDb(); const b = z.object({ token: z.string().min(10).max(80), password: z.string().min(8).max(200) }).parse(req.body)
    throttle(`reset:ip:${clientIp(req)}`, 20, 60 * 60_000, HttpError)
    const { rows } = await db.query<Row>(`select * from password_resets where token = $1 and used_at is null and expires_at > now()`, [b.token])
    if (!rows[0]) throw new HttpError(400, 'This reset link has expired or was already used. Request a new one.')
    const hash = await bcrypt.hash(b.password, 10)
    await db.query('update users set password_hash = $2 where id = $1', [rows[0].user_id, hash])
    await db.query('update password_resets set used_at = now() where token = $1', [b.token])
    await db.query('delete from sessions where user_id = $1', [rows[0].user_id]) // sign out everywhere else
    await createSession(db, res, rows[0].user_id, req)
    res.json({ user: await loadUserWithCompany(db, rows[0].user_id) })
  }))
  r.post('/auth/logout', wrap(async (req, res) => {
    const db = await getDb(); const sid = req.cookies?.[SESSION_COOKIE]
    if (sid) await db.query('delete from sessions where id = $1', [sid])
    res.clearCookie(SESSION_COOKIE, { path: '/' }); res.json({ ok: true })
  }))
  r.get('/auth/me', wrap(async (req, res) => { const db = await getDb(); res.json({ user: await currentUser(db, req) }) }))
  /** Text size, theme and language follow the person to every device. */
  r.put('/me/display', wrap(async (req, res) => {
    const db = await getDb(); const u = await requireUser(db, req)
    const b = z.object({ lang: z.enum(['en', 'fr']).optional(), textSize: z.enum(['normal', 'large', 'larger']).optional(), theme: z.enum(['light', 'dark', 'system']).optional(), road: z.boolean().optional() }).parse(req.body)
    const { rows } = await db.query<Row>('select display from users where id = $1', [u.id])
    const next = { ...((J(rows[0]?.display) ?? {}) as DisplayPrefs), ...b }
    await db.query('update users set display = $2 where id = $1', [u.id, JSON.stringify(next)]); res.json({ display: next })
  }))

  // shippers (public)
  mountDirectory(r, { getDb, shipperOut, wrap })
  r.get('/shippers', wrap(async (_req, res) => { const db = await getDb(); const { rows } = await db.query<Row>(`select * from shippers where ${publicShipperSql()} order by rating desc, reviews desc`); res.json({ shippers: rows.map(shipperOut) }) }))
  r.get('/shippers/:id/logo', wrap(async (req, res) => {
    const db = await getDb(); const { rows } = await db.query<Row>('select brand from shippers where id = $1', [req.params.id])
    const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.+)$/.exec(rows[0] ? brandLogo(rows[0]) : '')
    if (!m) throw new HttpError(404, 'No logo.')
    // Uploaded SVGs are untrusted: sandbox them so opening the URL directly can never run script on our origin.
    res.set({ 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" })
    res.send(Buffer.from(m[2], 'base64'))
  }))
  r.get('/shippers/:id', wrap(async (req, res) => { const db = await getDb(); const { rows } = await db.query<Row>('select * from shippers where id = $1', [req.params.id]); if (!rows[0]) throw new HttpError(404, 'Shipper not found.'); res.json({ shipper: shipperOut(rows[0]) }) }))
  r.patch('/shippers/me', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    if (user.role !== 'shipper' || !user.shipperId) throw new HttpError(403, 'Only shipper accounts have a company profile.')
    const b = zProfile.parse(req.body)
    for (const c of b.destinations) if (!(await isActiveDestination(db, c))) throw new HttpError(400, `${c} is not a destination Ntemtem serves yet.`)
    bustOrigins()
    await db.query(
      `update shippers set name=$2, tagline=$3, hq=$4, founded=$5, modes=$6, destinations=$7, origins=$8, cargo=$9, services=$10, about=$11, price_index=$12, response_hours=$13, initials=$14 where id = $1`,
      [user.shipperId, b.name, b.tagline, b.hq, b.founded, JSON.stringify(b.modes), JSON.stringify([...new Set(b.destinations)]), JSON.stringify([...new Set(b.origins)]), JSON.stringify([...new Set(b.cargo)]), JSON.stringify([...new Set(b.services)]), b.about, b.priceIndex, b.responseHours, initialsOf(b.name)],
    )
    if (b.logo !== undefined) await db.query(`update shippers set brand = coalesce(brand, '{}'::jsonb) || jsonb_build_object('logo', $2::text) where id = $1`, [user.shipperId, b.logo])
    const { rows } = await db.query<Row>('select * from shippers where id = $1', [user.shipperId])
    res.json({ shipper: shipperOut(rows[0]), user: await loadUserWithCompany(db, user.id) })
  }))

  // admin
  r.get('/admin/shippers', wrap(async (req, res) => {
    const db = await getDb(); await requireAdmin(db, req)
    const { rows } = await db.query<Row>(`
      select s.*, u.email as owner_email, u.name as owner_name,
        (select count(*) from quotes q where q.shipper_id = s.id)::int as quote_count,
        (select count(*) from shipments x where x.shipper_id = s.id)::int as shipment_count,
        (select count(*) from company_documents cd where cd.shipper_id = s.id)::int as doc_count,
        (select count(*) from company_documents cd where cd.shipper_id = s.id and cd.status = 'submitted')::int as docs_pending
      from shippers s left join users u on u.id = (select id from users x where x.shipper_id = s.id order by x.created_at limit 1) order by s.verified asc, (s.verification_requested_at is null) asc, s.verification_requested_at desc, s.created_at desc`)
    res.json({ shippers: rows.map((r) => ({ ...shipperOut(r), paystackSubaccount: r.paystack_subaccount ?? '', owner: r.owner_email ? { email: r.owner_email, name: r.owner_name } : null, quoteCount: r.quote_count, shipmentCount: r.shipment_count, docCount: r.doc_count, docsPending: r.docs_pending, verificationRequestedAt: r.verification_requested_at ? ISO(r.verification_requested_at) : null })) })
  }))
  r.post('/admin/shippers/:id/verify', wrap(async (req, res) => {
    const db = await getDb(); const admin = await requireAdmin(db, req)
    const b = zVerify.parse(req.body)
    const { rows: ex } = await db.query<Row>('select id, verified from shippers where id = $1', [req.params.id])
    if (!ex[0]) throw new HttpError(404, 'Shipper not found.')
    if (b.verified && (await screeningHold(db, 'shipper', String(req.params.id)))) throw new HttpError(409, 'This company has a sanctions-screening match to review first (Admin → Screening).')
    await db.query('update shippers set verified = $2, verified_at = case when $2 then now() else null end, verified_by = case when $2 then $3 else null end, plan = coalesce($4, plan) where id = $1', [req.params.id, b.verified, admin.email, b.plan ?? null])
    const { rows } = await db.query<Row>('select * from shippers where id = $1', [req.params.id])
    if (b.verified !== !!ex[0].verified || b.note) await onVerified(db, String(req.params.id), b.verified, b.note ?? '')
    res.json({ shipper: shipperOut(rows[0]) })
  }))

  r.post('/match', wrap(async (req, res) => {
    const db = await getDb(); const b = zMatchPriced.parse(req.body)
    const matches = await matchShippers(db, b)
    const priced = []
    for (const m of matches) { const q = await instantQuote(db, m.shipper.id, b as PriceInput); priced.push({ ...m, estimate: q ? { price: q.price, transitDays: q.transitDays, mode: q.mode, instant: q.autoSend } : null }) }
    res.json({ matches: priced })
  }))

  // requests
  r.get('/requests', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    if (user.role === 'customer') return res.json({ requests: await loadRequests(db, 'user_id = $1', [user.id]) })
    // shipper: eligible open requests (one rule: leadFit) + anything they've quoted. Filtered in SQL first so it scales.
    const { rows: me } = await db.query<Row>('select * from shippers where id = $1', [user.shipperId])
    const s = shipperOut(me[0])
    const all = await loadRequests(db, `(status = 'open' and (preferred_shipper_id = $1 or (preferred_shipper_id is null and destination = any($2::text[]) and (mode = 'either' or mode = any($3::text[])) and (cardinality($4::text[]) = 0 or cargo = any($4::text[]))))) or id in (select request_id from quotes where shipper_id = $1)`, [user.shipperId, s.destinations, s.modes, s.cargo], { limit: 400 })
    const out = []
    let priced = 0
    for (const q of all) {
      const mineQ = q.quotes.filter((x) => x.shipperId === user.shipperId)
      const fit = leadFit(s, q)
      const suggested = q.status === 'open' && !mineQ.length && priced++ < 40 ? await instantQuote(db, user.shipperId!, { origin: q.origin, destination: q.destination, mode: q.mode, cargo: q.cargo, quantity: q.quantity, weightKg: q.weightKg, pickup: q.pickup, delivery: q.delivery, insurance: q.insurance }).catch(() => null) : null
      const won = mineQ.some((x) => x.status === 'accepted')
      const suggestedSupplies = q.status === 'open' && q.supplies?.length ? await defaultQuoteSupplies(db, user.shipperId!, q.supplies) : undefined
      out.push({ ...q, suggestedSupplies, suppliesAddress: maskSupAddr(q.suppliesAddress, won), contact: contactFor(q, user.shipperId!, won), quotes: mineQ, competingQuotes: q.quotes.filter((x) => x.shipperId !== user.shipperId).length, outsideArea: q.status === 'open' && !fit.local && q.preferredShipperId !== user.shipperId, suggested: suggested ? { price: suggested.price, transitDays: suggested.transitDays, notes: suggested.notes, includes: suggested.includes, breakdown: suggested.breakdown } : null })
    }
    res.json({ requests: out })
  }))
  r.post('/requests', wrap(async (req, res) => {
    const db = await getDb(); const body = zRequest.parse(req.body)
    if (!(await isActiveDestination(db, body.destination))) throw new HttpError(400, 'We don’t ship to that destination yet.')
    let user = await currentUser(db, req)
    throttle(`request:ip:${clientIp(req)}`, 20, 24 * 3600_000, HttpError)
    let passwordLinkSent = false
    if (!user) {
      // No password needed to get quotes: we open the account and email a link to set one.
      const password = body.password ?? randomBytes(18).toString('base64url')
      user = await signupUser(db, { name: body.contact.name, email: body.contact.email, password, role: 'customer' })
      await createSession(db, res, user.id, req)
      if (!body.password) passwordLinkSent = await sendSetPasswordLink(db, user.id, user.name, body.contact.email.trim().toLowerCase(), req)
    }
    if (user.role !== 'customer') throw new HttpError(403, 'Shipper accounts cannot post shipment requests.')
    throttle(`request:user:${user.id}`, 10, 24 * 3600_000, HttpError)
    const { rows: openN } = await db.query<Row>(`select count(*)::int as n from requests where user_id = $1 and status = 'open'`, [user.id])
    if (Number(openN[0].n) >= 15) throw new HttpError(429, 'You have 15 open requests. Book or cancel some before posting more.')
    const today = new Date().toISOString().slice(0, 10)
    if (body.readyDate < today) throw new HttpError(400, 'The ready date is in the past.')
    const id = uid()
    await db.query(
      `insert into requests (id,ref,user_id,origin,destination,mode,cargo,quantity,weight_kg,description,pickup,delivery,insurance,ready_date,contact_name,contact_email,contact_phone,vehicle,preferred_shipper_id,consignee,source,dims,declared_value_usd,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,least($14::date + 14, current_date + 45))`,
      [id, makeRef(), user.id, body.origin, body.destination, body.mode, body.cargo, body.quantity, body.weightKg ?? null, body.description, body.pickup, body.delivery, body.insurance, body.readyDate, body.contact.name, body.contact.email, body.contact.phone, body.cargo === 'vehicle' && body.vehicle ? JSON.stringify(body.vehicle) : null, body.preferredShipperId ?? null, body.consignee ? JSON.stringify(body.consignee) : null, body.preferredShipperId ? (body.source ?? 'picked') : 'marketplace', body.dims, body.declaredValueUsd ?? null],
    )
    { // PO number (business accounts) and who placed it (household members act for the owner)
      const { rows: bz } = await db.query<Row>('select po_required from users where id = $1', [user.id])
      if (bz[0]?.po_required && !String(req.body?.poNumber ?? '').trim()) { await db.query('delete from requests where id = $1', [id]); throw new HttpError(400, 'Your business account needs a PO number on every request.') }
      await db.query('update requests set po_number = $2, created_by_name = $3 where id = $1', [id, String(req.body?.poNumber ?? '').trim().slice(0, 40), user.actingBy?.name ?? user.name])
    }
    if (body.consignee) await rememberConsignee(db, user.id, body.consignee)
    await screenSubject(db, { type: 'request', id, names: [{ role: 'sender', name: body.contact.name }, { role: 'receiver', name: body.consignee?.name ?? '' }, { role: 'supplies', name: body.suppliesAddress?.name ?? '' }] }).catch((e) => console.error('[screening]', e))
    await db.query('update requests set declaration = $2 where id = $1', [id, JSON.stringify({ accepted: true, includes: body.declaration.includes, at: new Date().toISOString(), ip: clientIp(req), version: DECLARATION_VERSION })])
    if (body.supplies?.length) {
      if (!body.suppliesAddress) { await db.query('delete from requests where id = $1', [id]); throw new HttpError(400, 'Add the address the packing supplies should go to.') }
      const merged = Object.values(body.supplies.reduce<Record<string, { kind: string; qty: number }>>((a, n) => { a[n.kind] = { kind: n.kind, qty: Math.min(50, (a[n.kind]?.qty ?? 0) + n.qty) }; return a }, {}))
      await db.query('update requests set supplies = $2, supplies_address = $3 where id = $1', [id, JSON.stringify(merged), JSON.stringify(body.suppliesAddress)])
    }
    const { rows } = await db.query<Row>('select * from requests where id = $1', [id])
    if (body.preferredShipperId) {
      // White-label lead: only that shipper sees it; price it from their rate cards if they have them.
      const quoted = await autoQuoteFromRates(db, rows[0], [body.preferredShipperId])
      const { rows: sh } = await db.query<Row>('select name from shippers where id = $1', [body.preferredShipperId])
      for (const q of quoted) await notify(db, { userId: user.id, kind: 'quote_received', title: `Your quote from ${sh[0]?.name ?? 'the shipper'}: $${q.price.toLocaleString()} for ${rows[0].ref}`, body: 'Priced instantly from their published rates. Open your dashboard to accept.', link: '/dashboard', dedupe: `rq:${id}:rate:${q.shipperId}` })
      await notifyShipperStaff(db, body.preferredShipperId, { kind: 'new_lead', title: `${quoted.length ? 'Instant quote sent — ' : body.source === 'link' ? 'New order from your link — ' : body.source === 'branded' ? 'New client request from your branded page — ' : 'A customer chose you — '}${rows[0].ref}`, body: `${body.contact.name} · ${body.quantity} × ${body.cargo} · ${body.origin} → ${body.destination}${quoted.length ? ` · $${quoted[0].price.toLocaleString()} from your rate card` : '. Send a quote.'}`, link: '/dashboard/leads', dedupe: `lead:${id}` }, ['owner', 'dispatcher', 'agent'])
    } else {
      await instantQuotesFromRates(db, rows[0])
      if (DEMO_AUTO_QUOTES) await demoAutoQuotes(db, rows[0])
      await notifyNewLead(db, rows[0])
    }
    await attachDefaultSupplies(db, rows[0]).catch((e) => console.error('[supplies] defaults', e))
    const [request] = await loadRequests(db, 'id = $1', [id])
    res.status(201).json({ request, user, passwordLinkSent })
  }))

  // quotes
  r.post('/requests/:id/quotes', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    if (user.role !== 'shipper' || !user.shipperId) throw new HttpError(403, 'Only shipper accounts can send quotes.')
    if (!can(user, 'leads')) throw new HttpError(403, 'Your role can’t send quotes — ask an owner or dispatcher to give you Leads access.')
    { const { rows: st } = await db.query<Row>('select standing from shippers where id = $1', [user.shipperId]); if (st[0]?.standing === 'paused') throw new HttpError(403, 'Your marketplace listing is paused — contact Ntemtem to restore it before quoting.') }
    const body = zQuote.parse(req.body)
    const { rows } = await db.query<Row>('select * from requests where id = $1', [req.params.id])
    if (!rows[0]) throw new HttpError(404, 'Request not found.')
    if (rows[0].status !== 'open') throw new HttpError(409, 'This request is no longer open.')
    if (rows[0].preferred_shipper_id && rows[0].preferred_shipper_id !== user.shipperId) throw new HttpError(403, 'This client asked another shipper.')
    const today = new Date().toISOString().slice(0, 10)
    if (body.validUntil && body.validUntil < today) throw new HttpError(400, 'The quote can’t be valid until a date in the past.')
    const qMode = rows[0].mode === 'either' ? body.mode ?? (body.includes.includes('Air freight') ? 'air' : 'ocean') : rows[0].mode
    if (rows[0].mode !== 'either' && body.mode && body.mode !== rows[0].mode) throw new HttpError(400, `The client asked for ${rows[0].mode} freight.`)
    const prev = await db.query<Row>('select status from quotes where request_id = $1 and shipper_id = $2', [req.params.id, user.shipperId])
    if (prev.rows[0]?.status === 'withdrawn' || prev.rows[0]?.status === 'expired') await db.query(`update quotes set status = 'sent' where request_id = $1 and shipper_id = $2`, [req.params.id, user.shipperId])
    await db.query('insert into quotes (id,request_id,shipper_id,price,transit_days,valid_until,notes,includes,sent_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (request_id, shipper_id) do update set price = excluded.price, transit_days = excluded.transit_days, valid_until = excluded.valid_until, notes = excluded.notes, includes = excluded.includes, sent_at = now(), sent_by = excluded.sent_by',
      [uid(), req.params.id, user.shipperId, body.price, body.transitDays, body.validUntil ?? new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), body.notes, JSON.stringify(body.includes), user.staffId ?? null])
    await db.query(`update quotes set kind = $3, mode = $4, updated_at = now(), status = case when status in ('withdrawn','expired') then 'sent' else status end, expiry_reminded_at = null where request_id = $1 and shipper_id = $2`, [req.params.id, user.shipperId, body.kind, qMode])
    { // Packing supplies the customer asked for: priced from the shipper's list or Ntemtem's catalogue.
      const needs = rows[0].supplies ? (J(rows[0].supplies) as SupplyNeed[]) : []
      const lines = needs.length ? (body.supplies ? await resolveQuoteSupplies(db, user.shipperId!, needs, body.supplies as QuoteSupplyLine[]) : await defaultQuoteSupplies(db, user.shipperId!, needs)) : []
      await db.query('update quotes set supplies = $3 where request_id = $1 and shipper_id = $2', [req.params.id, user.shipperId, JSON.stringify(lines)])
    }
    await notify(db, { userId: rows[0].user_id, kind: 'quote_received', title: `${user.company ?? 'A shipper'} quoted $${body.price.toLocaleString()} on ${rows[0].ref}`, body: `${body.transitDays} days transit${body.includes.length ? ` · ${body.includes.join(', ')}` : ''}. Open your dashboard to compare and accept.`, link: '/dashboard', dedupe: `rq:${rows[0].id}:q:${user.shipperId}:${Date.now()}` })
    const [request] = await loadRequests(db, 'id = $1', [req.params.id])
    res.status(201).json({ request: { ...request, suppliesAddress: maskSupAddr(request.suppliesAddress, false), contact: contactFor(request, user.shipperId!, false), quotes: request.quotes.filter((x) => x.shipperId === user.shipperId), competingQuotes: request.quotes.filter((x) => x.shipperId !== user.shipperId).length } })
  }))
  r.post('/quotes/:id/accept', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const { rows: qs } = await db.query<Row>('select q.*, r.user_id as owner from quotes q join requests r on r.id = q.request_id where q.id = $1', [req.params.id])
    const q = qs[0]
    if (!q) throw new HttpError(404, 'Quote not found.')
    if (q.owner !== user.id) throw new HttpError(403, 'You can only accept quotes on your own requests.')
    if (q.status === 'withdrawn') throw new HttpError(409, 'The shipper withdrew this quote.')
    if (q.status !== 'sent') throw new HttpError(409, 'This quote is no longer available.')
    if (DATE(q.valid_until) < new Date().toISOString().slice(0, 10)) throw new HttpError(409, `This quote expired on ${DATE(q.valid_until)}. Message the shipper for an updated price.`)
    const { rows: rs } = await db.query<Row>('select * from requests where id = $1', [q.request_id])
    const r0 = rs[0]
    if (r0.status !== 'open') throw new HttpError(409, r0.status === 'booked' ? 'This request has already been booked.' : `This request is ${r0.status}.`)
    { const hold = await screeningHold(db, 'request', r0.id); if (hold) throw new HttpError(409, hold === 'confirmed' ? 'We can’t book this shipment. Please contact Ntemtem support.' : 'This request is going through a routine compliance check. We’ll email you as soon as you can book — usually within a business day.') }
    const { rows: ss } = await db.query<Row>('select * from shippers where id = $1', [q.shipper_id])
    const shipper = shipperOut(ss[0])
    const includes: string[] = J(q.includes)
    const mode = q.mode === 'air' || q.mode === 'ocean' ? q.mode : includes.includes('Air freight') ? 'air' : 'ocean'
    void includes
    const sid = uid()
    await db.query(`update quotes set status = case when id = $1 then 'accepted' else 'declined' end where request_id = $2`, [q.id, q.request_id])
    await db.query(`update requests set status = 'booked' where id = $1`, [q.request_id])
    const { rows: losers } = await db.query<Row>(`select * from quotes where request_id = $1 and id <> $2 and status = 'declined'`, [q.request_id, q.id])
    await db.query('insert into shipments (id,ref,request_id,shipper_id,user_id,mode,origin,destination,cargo,description,status,eta,customer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [sid, r0.ref, r0.id, q.shipper_id, user.id, mode, r0.origin, r0.destination, r0.cargo, r0.description || `${r0.quantity} × ${r0.cargo}`, 'booked', new Date(Date.now() + (q.transit_days + 4) * 86400000).toISOString().slice(0, 10), r0.contact_name])
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, 'booked', r0.origin, `Booking confirmed with ${shipper.name}. Quote accepted at $${q.price}.`])
    await attachShipmentToClient(db, q.shipper_id, user.id, sid, r0.contact_name, r0.contact_email)
    await consigneeToClient(db, sid, r0.consignee ? J(r0.consignee) : null)
    if (r0.cargo === 'vehicle') await vehicleFromRequest(db, r0.id, sid)
    await suppliesFromQuote(db, sid, q, r0).catch((e) => console.error('[supplies] booking', e))
    await db.query('update shipments set booking = $2 where id = $1', [sid, JSON.stringify({ quantity: r0.quantity, weightKg: r0.weight_kg ?? null, dims: r0.dims ?? '', declaredValueUsd: r0.declared_value_usd == null ? null : Number(r0.declared_value_usd), readyDate: DATE(r0.ready_date), quoteKind: q.kind ?? 'firm', bookedBy: r0.contact_name })])
    if (q.kind === 'estimate') await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [sid, 'booked', r0.origin, 'Price is an estimate — final amount confirmed when the pieces are weighed at check-in.'])
    await invoiceForBooking(db, sid, q).catch((e) => console.error('[invoice] auto', e))
    void import('./integrations').then((m) => m.emitShipment(db, sid, 'shipment.booked')).catch(() => {})
    // Shippers who didn't win hear how they compared — no names, no exact winning price.
    for (const l of losers) {
      const diff = Math.round(((Number(l.price) - Number(q.price)) / Number(q.price)) * 100)
      await notifyShipperStaff(db, l.shipper_id, { kind: 'quote_lost', title: `Not chosen — ${r0.ref}`, body: `The client booked another quote. Yours was ${diff === 0 ? 'about the same price' : `${Math.abs(diff)}% ${diff > 0 ? 'higher' : 'lower'}`}${Number(l.transit_days) !== Number(q.transit_days) ? ` and ${Math.abs(Number(l.transit_days) - Number(q.transit_days))} days ${Number(l.transit_days) > Number(q.transit_days) ? 'slower' : 'faster'}` : ''}.`, link: '/dashboard/leads?b=lost', dedupe: `lost:${l.id}` }, ['owner', 'dispatcher', 'agent'])
    }
    await afterBooking(db, sid, { delivery: !!r0.delivery }).catch((e) => console.error('[booking] after', e))
    { const { rows: sx } = await db.query<Row>('select * from shipments where id = $1', [sid]); if (sx[0]) { await evaluateExport(db, sx[0]).catch((e) => console.error('[export] eval', e)); const { rows: sy } = await db.query<Row>('select * from shipments where id = $1', [sid]); void import('./autopilotOps').then((m) => m.onBookedPaperwork(db, sy[0])).catch(() => {}) } }
    await notify(db, { userId: user.id, kind: 'booking_confirmed', title: `Booking confirmed — ${r0.ref}`, body: `${shipper.name} will handle your ${r0.origin} → ${r0.destination} shipment for $${Number(q.price).toLocaleString()}. Track it any time with reference ${r0.ref}.`, link: `/track?ref=${r0.ref}`, dedupe: `ship:${sid}:booked` })
    await notifyShipperStaff(db, q.shipper_id, { kind: 'quote_accepted', title: `${r0.contact_name} accepted your quote — ${r0.ref}`, body: `$${Number(q.price).toLocaleString()} · ${r0.quantity} × ${r0.cargo} · ${r0.origin} → ${r0.destination}. The order is now booked; arrange pickup or drop-off.`, link: '/dashboard/shipments', dedupe: `ship:${sid}:accepted` }, ['owner', 'dispatcher', 'agent'])
    const [shipment] = await loadShipments(db, 'id = $1', [sid])
    const [request] = await loadRequests(db, 'id = $1', [q.request_id])
    res.status(201).json({ shipment, request })
  }))

  // shipments
  r.get('/shipments', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const shipments = user.role === 'customer' ? await loadShipments(db, 'user_id = $1', [user.id]) : await loadShipments(db, 'shipper_id = $1', [user.shipperId])
    const docs = await documentCounts(db, shipments.map((s) => s.id), user.role === 'customer')
    res.json({ shipments: shipments.map((s) => ({ ...s, documents: docs[s.id] ?? 0 })) })
  }))
  r.post('/shipments/:id/advance', wrap(async (req, res) => {
    const db = await getDb(); const user = await requireUser(db, req)
    const { rows } = await db.query<Row>('select * from shipments where id = $1', [req.params.id])
    const s = rows[0]
    if (!s) throw new HttpError(404, 'Shipment not found.')
    if (user.role !== 'shipper' || s.shipper_id !== user.shipperId) throw new HttpError(403, 'Only the handling shipper can update this shipment.')
    if (s.cancelled_at) throw new HttpError(409, 'This shipment was cancelled.')
    const next = nextStatus(s.status as ShipmentStatus, s.handover)
    if (!next) throw new HttpError(409, 'Shipment is already delivered.')
    await assertExportCleared(db, s, next)
    const manualCollect = next === 'delivered' && s.status === 'ready_for_collection'
    if (manualCollect && !['owner', 'dispatcher'].includes(user.staffRole ?? 'owner')) throw new HttpError(409, 'Collections are closed with the recipient’s code — use “Hand over” under Manage.')
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : manualCollect ? `Marked collected by ${user.name} (no code entered).` : null
    if (next === 'delivered') await assertRelease(db, s, { by: user.name, byRole: user.staffRole, override: req.body?.override?.reason ? { reason: String(req.body.override.reason).slice(0, 200) } : null })
    await db.query('update shipments set status = $2 where id = $1', [s.id, next])
    if (next === 'in_transit') { await db.query('update shipments set departed_at = coalesce(departed_at, now()) where id = $1', [s.id]) }
    await db.query('insert into shipment_events (shipment_id,status,place,note) values ($1,$2,$3,$4)', [s.id, next, statusOrder.indexOf(next) < 3 ? s.origin : s.destination, note])
    await logShipmentActivity(db, s.id, `${s.ref} moved to “${statusLabels[next]}”${note ? ` — ${note}` : '.'}`)
    await notifyShipmentStatus(db, s, next, note ?? undefined)
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
  mountClients(r, { getDb, requireUser, HttpError, wrap, loadShipments })
  mountDriverOps(r, { getDb, requireUser, HttpError, wrap })
  mountDriverHr(r, { getDb, requireUser, HttpError, wrap })
  mountDriverHr2(r, { getDb, requireUser, HttpError, wrap })
  mountOps(r, { getDb, requireUser, createSession, loadUserWithCompany, HttpError, wrap, loadShipments })
  mountInsights(r, { getDb, requireUser, HttpError, wrap })
  mountAnalytics(r, { getDb, requireUser, HttpError, wrap })
  mountAudit(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountBilling(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  startBillingSweeps(getDb)
  mountCosts(r, { getDb, requireUser, HttpError, wrap })
  mountGrowth(r, { getDb, requireUser, HttpError, wrap })
  mountIntegrations(r, { getDb, requireUser, HttpError, wrap })
  startGrowthSweeps(getDb); startWebhookSweeps(getDb)
  mountAdminInsights(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  startScorecardSweeps(getDb)
  mountCustomerHub(r, { getDb, requireUser, HttpError, wrap })
  mountAccount(r, { getDb, requireUser, HttpError, wrap })
  startCustomerSweeps(getDb)
  mountContainers(r, { getDb, requireUser, HttpError, wrap, loadShipments })
  mountLabels(r, { getDb, requireUser, HttpError, wrap })
  mountScans(r, { getDb, requireUser, HttpError, wrap })
  mountNotifications(r, { getDb, requireUser, HttpError, wrap })
  mountRates(r, { getDb, requireUser, HttpError, wrap })
  mountDocuments(r, { getDb, requireUser, HttpError, wrap })
  mountPickups(r, { getDb, requireUser, HttpError, wrap })
  mountRecipient(r, { getDb, requireUser, HttpError, wrap })
  mountDuty(r, { getDb, requireUser, HttpError, wrap })
  mountInsurance(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountPayments(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountGroupage(r, { getDb, requireUser, HttpError, wrap })
  mountVehicles(r, { getDb, requireUser, HttpError, wrap })
  mountCollections(r, { getDb, requireUser, HttpError, wrap })
  mountBrokers(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountBooking(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountWarehouse(r, { getDb, requireUser, HttpError, wrap })
  mountLanes(r, { getDb, requireUser, HttpError, wrap })
  mountOperations(r, { getDb, requireUser, HttpError, wrap })
  mountCompliance(r, { getDb, requireUser, HttpError, wrap })
  mountScreening(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountMomo(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountMeasure(r, { getDb, requireUser, HttpError, wrap })
  mountSupport(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountPush(r, { getDb, requireUser, HttpError, wrap })
  mountPartners(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountLineBooking(r, { getDb, requireUser, HttpError, wrap })
  mountQuickBooks(r, { getDb, requireUser, HttpError, wrap })
  mountAutopilot(r, { getDb, requireUser, HttpError, wrap })
  mountAutopilotOps(r, { getDb, requireUser, HttpError, wrap })
  mountRules(r, { getDb, requireUser, HttpError, wrap })
  mountAssistant(r, { getDb, requireUser, HttpError, wrap })
  mountSupplies(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountReviews(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountBrand(r, { getDb, requireUser, HttpError, wrap })
  mountSourcing(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountSite(r, { getDb, requireAdmin, HttpError, wrap })
  mountSystem(r, { getDb, requireAdmin, HttpError, wrap })
  mountBusiness(r, { getDb, requireAdmin, wrap })
  mountSupplierPortal(r, { getDb, requireUser, HttpError, wrap })
  mountOnboarding(r, { getDb, requireUser, requireAdmin, HttpError, wrap })
  mountCustomer(r, { getDb, requireUser, HttpError, wrap })
  mountGeoMeta(r, { getDb, requireAdmin, HttpError, wrap })
  mountShipmentOps(r, { getDb, requireUser, HttpError, wrap, loadShipments })
  mountFlow(r, { getDb, requireUser, HttpError, wrap, loadShipments })
  const requestDeps = {
    leadShippers: async (db: Db, row: Row) => {
      if (row.preferred_shipper_id) { const { rows } = await db.query<Row>('select id, response_hours from shippers where id = $1', [row.preferred_shipper_id]); return rows.map((x) => ({ id: x.id, responseHours: Number(x.response_hours ?? 24) })) }
      return (await matchShippers(db, { origin: row.origin, destination: row.destination, mode: row.mode, cargo: row.cargo })).filter((m) => leadFit(m.shipper, row as never).local).map((m) => ({ id: m.shipper.id, responseHours: Number(m.shipper.responseHours ?? 24) }))
    },
  }
  mountRequestFlow(r, { getDb, requireUser, HttpError, wrap, loadRequests: loadRequests as never, ...requestDeps,
    announce: async (db, row) => { await instantQuotesFromRates(db, row); if (DEMO_AUTO_QUOTES) await demoAutoQuotes(db, row); await notifyNewLead(db, row) } })
  startRequestSweeps(getDb, requestDeps)
  r.post('/admin/sweeps-requests', wrap(async (req, res) => { const db = await getDb(); await requireAdmin(db, req); await sweepRequests(db, requestDeps); res.json({ ok: true }) }))

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
    const [shipment] = await loadShipments(db, 'upper(ref) = upper($1)', [req.params.ref], { includeCancelled: true })
    if (!shipment) throw new HttpError(404, 'We couldn’t find a shipment with that reference.')
    res.json({ shipment, pieces: await piecesForTracking(db, shipment.id), pod: shipment.status === 'delivered' ? await proofOfDelivery(db, shipment.id) : null, driver: shipment.status === 'delivered' ? null : await driverForShipment(db, shipment.id).catch(() => null) })
  }))

  // errors
  const record = errorRecorder(getDb, async (req) => (await currentUser(await getDb(), req))?.id ?? null)
  r.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' })
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    if (err && typeof (err as { httpStatus?: unknown }).httpStatus === 'number') return res.status((err as { httpStatus: number }).httpStatus).json({ error: (err as Error).message })
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' })
    console.error(err)
    record(err, req).catch(() => {})
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' })
  })
  return r
}
