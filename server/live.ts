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

/* ------------------------------------------------------------------ AIS */
const AIS_URL = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream'
const WEST_AFRICA_BOX: [LngLat, LngLat] = [[-20, 3.5], [10, 16]] // Dakar → Lagos, incl. approaches
const ATLANTIC_BOX: [LngLat, LngLat] = [[-80, 3.5], [10, 55]] // wide box so subscribed MMSIs are reported anywhere on the lane

type Box = [LngLat, LngLat]
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
    this.regional = new AisSocket(this.key, () => ({ BoundingBoxes: [toAis(WEST_AFRICA_BOX)] }), (m) => this.onMessage(m, false))
    this.watch = new AisSocket(this.key, () => (this.mmsis.size ? { BoundingBoxes: [toAis(ATLANTIC_BOX)], FiltersShipMMSI: [...this.mmsis] } : null), (m) => this.onMessage(m, true))
    await this.refreshWatchlist()
    if (!this.enabled) return
    this.regional.start(); this.watch.start()
    setInterval(() => this.refreshWatchlist().catch(() => {}), 60_000)
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
      const n = (msg.Message?.ShipStaticData?.Name ?? meta.ShipName ?? '').trim()
      if (n) this.names.set(mmsi, n)
      return
    }
    if (msg.MessageType !== 'PositionReport') return
    const p = msg.Message?.PositionReport ?? {}
    const lat = Number(meta.latitude ?? p.Latitude), lon = Number(meta.longitude ?? p.Longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    const name = (meta.ShipName ?? '').trim() || this.names.get(mmsi)
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
  /** Everything currently known in the West Africa region (for the live map / congestion). */
  region(maxAgeMin = 180) {
    const cutoff = Date.now() - maxAgeMin * 60_000
    return [...this.latest.values()].filter((p) => inBox([p.lon, p.lat], WEST_AFRICA_BOX) && new Date(p.at).getTime() > cutoff)
  }
  /** Vessels within each port's approach box, and how many of them look anchored (< 1 kn). */
  congestion() {
    const out: Record<string, { total: number; anchored: number }> = {}
    const pts = this.region()
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
const flightCache = new Map<string, { at: number; pos: Position | null }>()
const FLIGHT_TTL = 30_000

export async function flightPosition(callsignRaw: string): Promise<Position | null> {
  const cs = callsignRaw.replace(/\s+/g, '').toUpperCase()
  if (!cs) return null
  const hit = flightCache.get(cs)
  if (hit && Date.now() - hit.at < FLIGHT_TTL) return hit.pos
  let pos: Position | null = null
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(cs)}`, { signal: ctl.signal, headers: { accept: 'application/json' } })
    clearTimeout(t)
    if (res.ok) {
      const data = (await res.json()) as { ac?: any[] }
      const ac = (data.ac ?? []).find((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
      if (ac) pos = { id: cs, lat: ac.lat, lon: ac.lon, speed: num(ac.gs), course: num(ac.track), altitude: typeof ac.alt_baro === 'number' ? ac.alt_baro : undefined, at: new Date(Date.now() - (ac.seen ?? 0) * 1000).toISOString(), source: 'adsb.lol', name: (ac.flight ?? cs).trim() }
    }
  } catch { /* offline or blocked — treat as no data */ }
  flightCache.set(cs, { at: Date.now(), pos })
  return pos
}

/** Live flights over the West Africa region (for the live map). */
let regionCache: { at: number; list: Position[] } = { at: 0, list: [] }
export async function flightsInRegion(): Promise<Position[]> {
  if (Date.now() - regionCache.at < FLIGHT_TTL) return regionCache.list
  const list: Position[] = []
  try {
    // adsb.lol point queries: 250 nm is the API's maximum radius, so three circles cover Dakar → Lagos.
    const centres: [number, number][] = [[6.0, 1.5], [7.5, -8.5], [14.0, -17.0]]
    const all = await Promise.all(centres.map(async ([lat, lon]) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
      const res = await fetch(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`, { signal: ctl.signal, headers: { accept: 'application/json' } })
      clearTimeout(t)
      if (!res.ok) return []
      const d = (await res.json()) as { ac?: any[] }
      return (d.ac ?? []).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    }))
    const seen = new Set<string>()
    for (const a of all.flat()) {
      if (seen.has(a.hex)) continue; seen.add(a.hex)
      list.push({ id: a.hex, lat: a.lat, lon: a.lon, speed: num(a.gs), course: num(a.track), altitude: typeof a.alt_baro === 'number' ? a.alt_baro : undefined, at: new Date(Date.now() - (a.seen ?? 0) * 1000).toISOString(), source: 'adsb.lol', name: (a.flight ?? '').trim() || a.r || a.hex })
    }
    regionCache = { at: Date.now(), list }
  } catch { regionCache = { at: Date.now(), list: regionCache.list } }
  return regionCache.list
}
