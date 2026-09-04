/**
 * Live position sources.
 *  - Sea: AISStream (wss://stream.aisstream.io) — free API key. Two long-lived sockets: an unfiltered feed for the
 *    West African coast (live map + congestion counts) and a filtered feed for the specific vessels carrying active
 *    shipments, anywhere on the lane.
 *  - Air: adsb.lol public ADS-B API — no key. Looked up on demand by flight callsign, cached briefly.
 * Both are public, delayed and incomplete by nature. Everything here is labelled an estimate downstream.
 */
import WebSocket from 'ws'
import { destGeo, inBox, type LngLat } from '../src/lib/geo'
import type { Db } from './db'

export interface Position {
  lat: number; lon: number; speed?: number; course?: number; heading?: number; altitude?: number
  at: string; source: 'aisstream' | 'adsb.lol'; name?: string; id: string
}

export interface VesselStatic {
  callSign?: string; imo?: string; type?: number; destination?: string
  eta?: { month: number; day: number; hour: number; minute: number }
  length?: number; beam?: number; draught?: number
}

/* ------------------------------------------------------------------ AIS */
const AIS_URL = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream'
type Box = [LngLat, LngLat]
const WEST_AFRICA_BOX: Box = [[-20, 3.5], [10, 16]] // Dakar → Lagos, incl. approaches
/** Atlantic approach to the lane: Cape Verde, Canaries, Moroccan and Portuguese coasts. AISStream's community receivers
 *  are dense here and almost absent on the Gulf of Guinea coast, so this is where southbound ships are actually seen. */
const APPROACH_BOX: Box = [[-26, 16], [-5, 40]]
/** Origin regions the lanes start from: Europe (Atlantic, North Sea, Baltic, Mediterranean) and the US coasts. */
const EUROPE_BOX: Box = [[-12, 35], [32, 62]]
const US_EAST_GULF_BOX: Box = [[-98, 24], [-65, 46]]
const US_WEST_BOX: Box = [[-130, 30], [-115, 50]]
const REGION_BOXES: Box[] = [WEST_AFRICA_BOX, APPROACH_BOX, EUROPE_BOX, US_EAST_GULF_BOX, US_WEST_BOX]
const ATLANTIC_BOX: Box = [[-80, 3.5], [10, 55]] // wide box so subscribed MMSIs are reported anywhere on the lane

const toAis = (b: Box) => [[b[0][1], b[0][0]], [b[1][1], b[1][0]]] // AISStream wants [[lat,lon],[lat,lon]]

/** One AISStream socket with auto-reconnect. Subscription payload is rebuilt on every (re)connect. */
class AisSocket {
  private ws: WebSocket | null = null
  private backoff = 5000
  private stopped = false
  status: 'off' | 'connecting' | 'live' | 'error' = 'off'
  lastError = ''
  constructor(private key: string, private sub: () => object | null, private onMsg: (m: any) => void) {}
  start() { this.stopped = false; this.connect() }
  resubscribe() { if (this.ws?.readyState === WebSocket.OPEN) this.send() }
  private send() {
    const body = this.sub()
    if (!body) { this.ws?.close(); return }
    this.ws?.send(JSON.stringify({ APIKey: this.key, FilterMessageTypes: ['PositionReport', 'ShipStaticData'], ...body }))
  }
  private connect() {
    if (this.stopped || !this.sub()) { this.status = 'off'; return }
    this.status = 'connecting'
    try {
      const ws = new WebSocket(AIS_URL); this.ws = ws
      ws.on('open', () => { this.status = 'live'; this.backoff = 5000; this.send() })
      ws.on('message', (buf) => { try { this.onMsg(JSON.parse(buf.toString())) } catch { /* ignore */ } })
      ws.on('error', (e) => { this.lastError = e.message; this.status = 'error' })
      ws.on('close', () => { if (this.stopped) return; this.status = 'connecting'; setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(this.backoff * 2, 120_000) })
    } catch (e) { this.lastError = (e as Error).message; this.status = 'error' }
  }
}

class AisWorker {
  private key = process.env.AISSTREAM_API_KEY?.trim() || ''
  private mmsis = new Set<string>()
  private latest = new Map<string, Position>()
  private names = new Map<string, string>()
  /** Voyage/static data from ShipStaticData (message 5): broadcast every 6 min, so it trickles in after the first fix. */
  private statics = new Map<string, VesselStatic>()
  /** Where and when we first heard each ship this session — the closest thing AIS gives to an origin. */
  private firstSeen = new Map<string, { lat: number; lon: number; at: string }>()
  private navStatus = new Map<string, number>()
  private db: Db | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = new Set<string>()
  /** Regional feed: every ship near the West African coast (live map + congestion). */
  private regional!: AisSocket
  /** Watch feed: only the vessels carrying active shipments, anywhere on the lane. */
  private watch!: AisSocket
  lastMessageAt = 0

  get enabled() { return !!this.key }
  get status() {
    if (!this.enabled) return 'off' as const
    return this.regional.status === 'live' || this.watch.status === 'live' ? 'live' as const : this.regional.status === 'error' ? 'error' as const : 'connecting' as const
  }
  get lastError() { return this.regional?.lastError || this.watch?.lastError || '' }

  async start(db: Db) {
    this.db = db
    const { rows } = await db.query<any>('select * from vessel_positions')
    for (const r of rows) this.latest.set(r.mmsi, { id: r.mmsi, lat: Number(r.lat), lon: Number(r.lon), speed: r.sog ?? undefined, course: r.cog ?? undefined, heading: r.heading ?? undefined, at: new Date(r.at).toISOString(), source: 'aisstream', name: r.name ?? undefined })
    this.regional = new AisSocket(this.key, () => ({ BoundingBoxes: REGION_BOXES.map(toAis) }), (m) => this.onMessage(m, false))
    this.watch = new AisSocket(this.key, () => (this.mmsis.size ? { BoundingBoxes: [toAis(ATLANTIC_BOX)], FiltersShipMMSI: [...this.mmsis] } : null), (m) => this.onMessage(m, true))
    await this.refreshWatchlist()
    if (!this.enabled) return
    this.regional.start(); this.watch.start()
    setInterval(() => this.refreshWatchlist().catch(() => {}), 60_000)
    setInterval(() => this.prune(), 10 * 60_000)
  }

  /** Drop regional traffic not heard from in 6h; watched vessels are kept so "last known" survives. */
  private prune() {
    const cutoff = Date.now() - 6 * 60 * 60_000
    for (const [id, p] of this.latest) if (!this.mmsis.has(id) && new Date(p.at).getTime() < cutoff) { this.latest.delete(id); this.names.delete(id); this.statics.delete(id); this.firstSeen.delete(id); this.navStatus.delete(id) }
  }

  async refreshWatchlist() {
    if (!this.db) return
    const { rows } = await this.db.query<{ mmsi: string }>(`select distinct mmsi from shipments where mmsi is not null and mmsi <> '' and status <> 'delivered'`)
    const next = new Set(rows.map((r) => r.mmsi))
    const changed = next.size !== this.mmsis.size || [...next].some((m) => !this.mmsis.has(m))
    const wasEmpty = this.mmsis.size === 0
    this.mmsis = next
    if (changed && this.enabled) { if (wasEmpty) this.watch.start(); else this.watch.resubscribe() }
  }

  private onMessage(msg: any, fromWatch: boolean) {
    if (msg.error) { (fromWatch ? this.watch : this.regional).lastError = String(msg.error); return }
    const meta = msg.MetaData ?? {}
    const mmsi = String(meta.MMSI ?? '')
    if (!mmsi) return
    this.lastMessageAt = Date.now()
    if (msg.MessageType === 'ShipStaticData') {
      const d = msg.Message?.ShipStaticData ?? {}
      const n = (d.Name ?? meta.ShipName ?? '').trim()
      if (n) this.names.set(mmsi, n)
      const dim = d.Dimension ?? {}
      const eta = d.Eta ?? {}
      const length = num(dim.A) != null && num(dim.B) != null ? dim.A + dim.B : undefined
      const beam = num(dim.C) != null && num(dim.D) != null ? dim.C + dim.D : undefined
      this.statics.set(mmsi, {
        callSign: (d.CallSign ?? '').trim() || undefined,
        imo: d.ImoNumber ? String(d.ImoNumber) : undefined,
        type: num(d.Type),
        destination: (d.Destination ?? '').trim() || undefined,
        eta: eta.Month && eta.Day ? { month: eta.Month, day: eta.Day, hour: eta.Hour ?? 0, minute: eta.Minute ?? 0 } : undefined,
        length: length && length > 0 ? length : undefined,
        beam: beam && beam > 0 ? beam : undefined,
        draught: num(d.MaximumStaticDraught) || undefined,
      })
      return
    }
    if (msg.MessageType !== 'PositionReport') return
    const p = msg.Message?.PositionReport ?? {}
    const lat = Number(meta.latitude ?? p.Latitude), lon = Number(meta.longitude ?? p.Longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    const name = (meta.ShipName ?? '').trim() || this.names.get(mmsi)
    if (num(p.NavigationalStatus) != null) this.navStatus.set(mmsi, p.NavigationalStatus)
    if (!this.firstSeen.has(mmsi)) this.firstSeen.set(mmsi, { lat, lon, at: new Date(meta.time_utc ?? Date.now()).toISOString() })
    this.latest.set(mmsi, { id: mmsi, lat, lon, speed: num(p.Sog), course: num(p.Cog), heading: p.TrueHeading === 511 ? undefined : num(p.TrueHeading), at: new Date(meta.time_utc ?? Date.now()).toISOString(), source: 'aisstream', name: name || undefined })
    // Persist watched vessels (so a restart keeps last-known); the regional feed stays in memory.
    if (this.mmsis.has(mmsi)) { this.dirty.add(mmsi); this.scheduleFlush() }
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush().catch(() => {}) }, 5000)
  }

  private async flush() {
    if (!this.db) return
    const ids = [...this.dirty]; this.dirty.clear()
    for (const id of ids) {
      const p = this.latest.get(id); if (!p) continue
      await this.db.query(
        `insert into vessel_positions (mmsi,name,lat,lon,sog,cog,heading,at,updated) values ($1,$2,$3,$4,$5,$6,$7,$8,now())
         on conflict (mmsi) do update set name = coalesce(excluded.name, vessel_positions.name), lat = excluded.lat, lon = excluded.lon, sog = excluded.sog, cog = excluded.cog, heading = excluded.heading, at = excluded.at, updated = now()`,
        [p.id, p.name ?? null, p.lat, p.lon, p.speed ?? null, p.course ?? null, p.heading ?? null, p.at],
      )
    }
  }

  get(mmsi: string) { return this.latest.get(mmsi) ?? null }
  /** Everything known about one ship: last fix + voyage data + where we first heard it. */
  detail(mmsi: string) {
    const p = this.latest.get(mmsi); if (!p) return null
    return { ...p, ...(this.statics.get(mmsi) ?? {}), navStatus: this.navStatus.get(mmsi), firstSeen: this.firstSeen.get(mmsi) ?? null, watched: this.mmsis.has(mmsi) }
  }
  /** Everything currently known on the lane — Gulf of Guinea coast plus the Atlantic approach (for the live map). */
  region(maxAgeMin = 180) {
    const cutoff = Date.now() - maxAgeMin * 60_000
    return [...this.latest.values()].filter((p) => REGION_BOXES.some((b) => inBox([p.lon, p.lat], b)) && new Date(p.at).getTime() > cutoff)
  }
  /** Vessels reported on the West African coast itself — 0 means no AIS receiver there is currently feeding AISStream. */
  coast(maxAgeMin = 180) {
    return this.region(maxAgeMin).filter((p) => inBox([p.lon, p.lat], WEST_AFRICA_BOX))
  }
  /** Vessels within each port's approach box, and how many of them look anchored (< 1 kn). */
  congestion() {
    const out: Record<string, { total: number; anchored: number }> = {}
    const pts = this.coast()
    for (const [code, g] of Object.entries(destGeo)) {
      const inApproach = pts.filter((p) => inBox([p.lon, p.lat], g.approach))
      out[code] = { total: inApproach.length, anchored: inApproach.filter((p) => (p.speed ?? 0) < 1).length }
    }
    return out
  }
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const ais = new AisWorker()

/* ------------------------------------------------------------------ ADS-B */
const ADSB_URL = process.env.ADSB_URL || 'https://api.adsb.lol' // override for local mocks
const flightCache = new Map<string, { at: number; pos: Position | null }>()
const FLIGHT_TTL = 30_000

export async function flightPosition(callsignRaw: string): Promise<Position | null> {
  const cs = callsignRaw.replace(/\s+/g, '').toUpperCase()
  if (!cs) return null
  const hit = flightCache.get(cs)
  if (hit && Date.now() - hit.at < FLIGHT_TTL) return hit.pos
  // The hub sweep may already have it — free and instant.
  const swept = regionList.find((a) => a.callsign === cs)
  if (swept) { flightCache.set(cs, { at: Date.now(), pos: swept }); return swept }
  let pos: Position | null = null
  const p = pickProvider() ?? PROVIDERS[0]
  const list = await adsbGet(p, p.callsign(cs))
  const ac = list?.[0]
  if (ac) pos = { id: cs, lat: ac.lat, lon: ac.lon, speed: num(ac.gs), course: num(ac.track), altitude: typeof ac.alt_baro === 'number' ? ac.alt_baro : undefined, at: new Date(Date.now() - (ac.seen ?? 0) * 1000).toISOString(), source: 'adsb.lol', name: (ac.flight ?? cs).trim() }
  flightCache.set(cs, { at: Date.now(), pos })
  return pos
}

/** Aircraft as kept for the live map. `id` is the ICAO hex (stable per airframe); callsign changes per flight. */
export interface Aircraft extends Position {
  callsign?: string; registration?: string; type?: string; description?: string; squawk?: string; category?: string
  cargo: boolean; onGround: boolean; vertRate?: number
}

/** Hubs the lanes start from and pass over; adsb.lol caps a point query at 250 nm, so each hub is one circle. */
const AIR_HUBS: [string, number, number][] = [
  ['London', 51.5, -0.1], ['Frankfurt', 50.1, 8.7], ['Madrid', 40.4, -3.7], ['Lisbon', 38.7, -9.1], ['Milan', 45.5, 9.2],
  ['New York', 40.7, -74.0], ['Atlanta', 33.7, -84.4], ['Houston', 29.8, -95.4], ['Chicago', 41.9, -87.6], ['Miami', 25.8, -80.2], ['Los Angeles', 34.0, -118.2], ['Minneapolis', 44.9, -93.3],
  ['Canary Islands', 28.0, -15.5], ['Dakar', 14.0, -17.0], ['Monrovia', 7.5, -8.5], ['Accra–Lagos', 6.0, 1.5],
  ['Dubai', 25.3, 55.4], ['Guangzhou', 23.4, 113.3],
]

/** ICAO airline prefixes of all-cargo operators (the ones that actually fly freight into West Africa and the big integrators). */
const CARGO_AIRLINES = new Set(['GTI', 'CLX', 'CLU', 'BOX', 'FDX', 'UPS', 'ABW', 'MPH', 'GEC', 'CKS', 'ABX', 'ATN', 'NCA', 'CAO', 'SQC', 'TAY', 'ABR', 'BCS', 'DAE', 'DHK', 'SRR', 'CKK', 'GSS', 'ICL', 'AZG', 'MSX', 'PAC', 'QAC', 'TPA', 'AHK', 'SOO', 'SWN', 'AJK', 'NPT', 'LCO', 'KYE', 'CJT', 'RCF', 'MAA', 'ETV'])
/** Freighter-only airframe types (ADS-B type codes). */
const FREIGHTER_TYPES = new Set(['MD11', 'B748', 'B77L', 'A124', 'B74F', 'A30B', 'B762', 'DC10', 'A332F', 'A33F'])

function isCargo(callsign: string, type: string, desc: string) {
  const prefix = callsign.replace(/[^A-Z].*$/, '').slice(0, 3)
  return CARGO_AIRLINES.has(prefix) || FREIGHTER_TYPES.has(type) || /freighter|cargo|\bF\b/i.test(desc)
}

const aircraftOf = (a: any): Aircraft => {
  const callsign = String(a.flight ?? '').trim()
  const type = String(a.t ?? '')
  return {
    id: a.hex, lat: a.lat, lon: a.lon, speed: num(a.gs), course: num(a.track), altitude: typeof a.alt_baro === 'number' ? a.alt_baro : undefined,
    at: new Date(Date.now() - (a.seen ?? 0) * 1000).toISOString(), source: 'adsb.lol', name: callsign || a.r || a.hex,
    callsign: callsign || undefined, registration: a.r || undefined, type: type || undefined, description: a.desc || undefined, squawk: a.squawk || undefined, category: a.category || undefined,
    cargo: isCargo(callsign, type, String(a.desc ?? '')), onGround: a.alt_baro === 'ground', vertRate: num(a.baro_rate),
  }
}

/* Public ADS-B aggregators (all readsb-style JSON). adsb.lol allows only a few requests per ~10 s per IP, adsb.fi about
 * one per second, so the sweep is a paced background loop that rotates hubs across providers instead of a burst. */
interface AdsbProvider { name: string; point: (lat: number, lon: number) => string; callsign: (cs: string) => string; key: 'ac' | 'aircraft'; minGapMs: number; backoffUntil: number; lastAt: number; ok: number; fail: number }
const PROVIDERS: AdsbProvider[] = [
  { name: 'adsb.fi', point: (la, lo) => `${process.env.ADSBFI_URL || 'https://opendata.adsb.fi/api'}/v2/lat/${la}/lon/${lo}/dist/250`, callsign: (cs) => `${process.env.ADSBFI_URL || 'https://opendata.adsb.fi/api'}/v2/callsign/${encodeURIComponent(cs)}`, key: 'aircraft', minGapMs: 1500, backoffUntil: 0, lastAt: 0, ok: 0, fail: 0 },
  { name: 'adsb.lol', point: (la, lo) => `${ADSB_URL}/v2/point/${la}/${lo}/250`, callsign: (cs) => `${ADSB_URL}/v2/callsign/${encodeURIComponent(cs)}`, key: 'ac', minGapMs: 6000, backoffUntil: 0, lastAt: 0, ok: 0, fail: 0 },
  { name: 'airplanes.live', point: (la, lo) => `${process.env.AIRPLANESLIVE_URL || 'https://api.airplanes.live'}/v2/point/${la}/${lo}/250`, callsign: (cs) => `${process.env.AIRPLANESLIVE_URL || 'https://api.airplanes.live'}/v2/callsign/${encodeURIComponent(cs)}`, key: 'ac', minGapMs: 1500, backoffUntil: 0, lastAt: 0, ok: 0, fail: 0 },
]
const UA = 'ShipSync live map (+https://github.com/mnfrimpong20/ship-sync)'

async function adsbGet(p: AdsbProvider, url: string): Promise<any[] | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
  try {
    p.lastAt = Date.now()
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': UA } })
    if (res.status === 429 || res.status === 403) { p.backoffUntil = Date.now() + 30_000; p.fail++; return null }
    if (!res.ok) { p.fail++; return null }
    const d = (await res.json()) as Record<string, any[]>
    p.ok++
    return (d[p.key] ?? d.ac ?? d.aircraft ?? []).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
  } catch { p.fail++; return null } finally { clearTimeout(t) }
}

/** The provider that is free right now and has waited longest since its last call; null when all are cooling down. */
function pickProvider(): AdsbProvider | null {
  const now = Date.now()
  const free = PROVIDERS.filter((p) => p.backoffUntil <= now && now - p.lastAt >= p.minGapMs)
  return free.sort((a, b) => a.lastAt - b.lastAt)[0] ?? null
}

/** Live flights across the hubs (for the live map). A background loop refreshes one hub at a time, so no provider is burst. */
const hubCache = new Map<string, { at: number; list: Aircraft[] }>()
let regionList: Aircraft[] = []
let sweepStarted = false
export function startAirSweep() {
  if (sweepStarted) return; sweepStarted = true
  let i = 0
  const tick = async () => {
    const p = pickProvider()
    if (p) {
      const [name, lat, lon] = AIR_HUBS[i % AIR_HUBS.length]; i++
      const list = await adsbGet(p, p.point(lat, lon))
      if (list) {
        hubCache.set(name, { at: Date.now(), list: list.map(aircraftOf) })
        const seen = new Map<string, Aircraft>()
        const cutoff = Date.now() - 5 * 60_000
        for (const h of hubCache.values()) { if (h.at < cutoff) continue; for (const a of h.list) if (!seen.has(a.id)) seen.set(a.id, a) }
        regionList = [...seen.values()]
      }
    }
    setTimeout(tick, 700)
  }
  tick()
}
export function flightsInRegion(): Aircraft[] { return regionList }
/** Health for the API: how many hubs are fresh and what each provider has done. */
export function airStatus() {
  const fresh = [...hubCache.values()].filter((h) => Date.now() - h.at < 2 * 60_000).length
  return { hubs: AIR_HUBS.length, freshHubs: fresh, providers: PROVIDERS.map((p) => ({ name: p.name, ok: p.ok, fail: p.fail, coolingDown: p.backoffUntil > Date.now() })), routes: routeStats }
}

export interface Airport { icao: string; iata?: string; name: string; city?: string; country?: string; lat: number; lon: number }
export interface FlightRoute { origin: Airport; destination: Airport; via?: Airport[]; airline?: string; plausible: boolean }
const routeCache = new Map<string, { at: number; route: FlightRoute | null }>()
const ROUTE_TTL = 15 * 60_000

let routeStats: { ok: number; fail: number; lastStatus: number } = { ok: 0, fail: 0, lastStatus: 0 }
const ADSBDB_URL = process.env.ADSBDB_URL || 'https://api.adsbdb.com'
let lastRouteCall = 0
/** adsbdb.com's open callsign lookup: scheduled origin/destination airports and the airline. Not every callsign is on
 *  file (charters, positioning flights, GA). Looked up per click, cached 15 min, never stored. */
export async function flightRoute(callsign: string): Promise<FlightRoute | null> {
  const cs = callsign.trim().toUpperCase(); if (!cs) return null
  const hit = routeCache.get(cs); if (hit && Date.now() - hit.at < ROUTE_TTL) return hit.route
  const wait = 400 - (Date.now() - lastRouteCall); if (wait > 0) await new Promise((r) => setTimeout(r, wait)) // be polite: ≤ ~2/s
  lastRouteCall = Date.now()
  let route: FlightRoute | null = null
  let status = 0
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`${ADSBDB_URL}/v0/callsign/${encodeURIComponent(cs)}`, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': UA } })
    clearTimeout(t)
    status = res.status
    if (res.ok) {
      const fr = ((await res.json()) as any)?.response?.flightroute
      const ap = (a: any): Airport | null => (a && a.icao_code ? { icao: a.icao_code, iata: a.iata_code || undefined, name: a.name, city: a.municipality || undefined, country: a.country_iso_name || undefined, lat: Number(a.latitude), lon: Number(a.longitude) } : null)
      const o = ap(fr?.origin), d = ap(fr?.destination)
      if (o && d) route = { origin: o, destination: d, airline: fr.airline?.name || undefined, plausible: true }
    }
  } catch { /* offline — no route */ }
  const good = res200(status)
  routeStats = { ok: routeStats.ok + (good ? 1 : 0), fail: routeStats.fail + (good ? 0 : 1), lastStatus: status }
  // "Not on file" (404) is a real answer and is cached for the full TTL; rate-limits and outages are retried after 20 s.
  routeCache.set(cs, { at: good ? Date.now() : Date.now() - ROUTE_TTL + 20_000, route })
  return route
}
const res200 = (s: number) => s === 200 || s === 404

/** One aircraft from the last hub sweep, by ICAO hex. */
export function aircraft(hex: string): Aircraft | null {
  return regionList.find((a) => a.id === hex.toLowerCase()) ?? null
}
