import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setupMapLibre } from '../lib/mapSetup'
import { motion } from 'motion/react'
import type { FeatureCollection, Point } from 'geojson'
import { Anchor, ArrowRight, Compass, Flag, MapPin, Navigation, Plane, Radio, Ship, TriangleAlert, X } from 'lucide-react'
import { MAP_STYLE, brandBasemap, type LivePos } from '../components/LiveMap'
import { countries } from '../lib/data'
import { greatCircle, originCoords, destGeo, type LngLat } from '../lib/geo'
import { fadeUp, stagger } from '../lib/motion'
import { Pill } from '../components/ui'
import { compass, flagFromMmsi, formatEta, navStatusLabel, shipTypeLabel } from '../lib/ais'

interface RegionPayload {
  vessels: (LivePos & { id: string; kind: 'vessel' })[]
  flights: (LivePos & { id: string; kind: 'flight'; cargo: boolean })[]
  congestion: Record<string, { total: number; anchored: number }>
  ais: { status: 'off' | 'connecting' | 'live' | 'error'; enabled: boolean; lastMessageAt: string | null; coastVessels?: number; error?: string }
  ports: Record<string, { name: string; at: LngLat; airport: { name: string; at: LngLat } }>
}

interface VesselDetail extends LivePos {
  id: string; callSign?: string; imo?: string; type?: number; destination?: string
  eta?: { month: number; day: number; hour: number; minute: number }
  length?: number; beam?: number; draught?: number; navStatus?: number
  firstSeen: { lat: number; lon: number; at: string } | null; watched: boolean
}
interface Airport { icao: string; iata?: string; name: string; city?: string; country?: string; lat: number; lon: number }
interface FlightDetail extends LivePos {
  id: string; callsign?: string; registration?: string; type?: string; description?: string; squawk?: string; category?: string
  cargo: boolean; onGround: boolean; vertRate?: number
  route: { origin: Airport; destination: Airport; via?: Airport[]; plausible: boolean } | null
}
type Selection = { kind: 'vessel' | 'flight'; id: string }

/** The lanes Ship Sync's shippers actually run — drawn as great-circle arcs into the Gulf of Guinea. */
const lanes: [string, string][] = [
  ['New York, NY', 'GH'], ['Houston, TX', 'GH'], ['Atlanta, GA', 'NG'], ['Philadelphia, PA', 'LR'], ['Minneapolis, MN', 'LR'],
  ['London, UK', 'GH'], ['London, UK', 'NG'], ['Hamburg, DE', 'TG'], ['Paris, FR', 'SN'], ['Paris, FR', 'CI'], ['Guangzhou, CN', 'NG'], ['Dubai, AE', 'GH'],
]

export default function Live() {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [data, setData] = useState<RegionPayload | null>(null)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState<Date | null>(null)
  const [params, setParams] = useSearchParams()
  const [selected, setSelectedState] = useState<Selection | null>(() => {
    const v = params.get('vessel'), f = params.get('flight')
    return v && /^\d{9}$/.test(v) ? { kind: 'vessel', id: v } : f && /^~?[0-9a-f]{6}$/i.test(f) ? { kind: 'flight', id: f.toLowerCase() } : null
  })
  /** Selection lives in the URL too (?vessel=MMSI / ?flight=HEX) so a ship or plane can be shared or refreshed. */
  const setSelected = (sel: Selection | null) => {
    setSelectedState(sel)
    setParams((prev) => { const n = new URLSearchParams(prev); n.delete('vessel'); n.delete('flight'); if (sel) n.set(sel.kind, sel.id); return n }, { replace: true })
  }
  const [vessel, setVessel] = useState<VesselDetail | null>(null)
  const [flight, setFlight] = useState<FlightDetail | null>(null)
  const [detailErr, setDetailErr] = useState('')
  const [cargoOnly, setCargoOnly] = useState(true)
  const selectedRef = useRef<Selection | null>(null)
  const flownTo = useRef<string | null>(null)
  selectedRef.current = selected

  // Detail for the clicked ship/plane; re-fetched with each 30s refresh so speed/position stay current.
  useEffect(() => {
    if (!selected) { setVessel(null); setFlight(null); setDetailErr(''); return }
    let live = true
    const url = selected.kind === 'vessel' ? `/api/live/vessel/${selected.id}` : `/api/live/flight/${selected.id}`
    fetch(url).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Unavailable'); return (j.vessel ?? j.flight) as VesselDetail | FlightDetail })
      .then((d) => {
        if (!live) return
        if (selected.kind === 'vessel') { setVessel(d as VesselDetail); setFlight(null) } else { setFlight(d as FlightDetail); setVessel(null) }
        setDetailErr('')
        // Selected via URL (shared link / refresh): highlight and fly to it once.
        const m = map.current
        if (m && flownTo.current !== d.id) {
          flownTo.current = d.id
          const put = () => { (m.getSource('selected') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } }] }); m.easeTo({ center: [d.lon, d.lat], zoom: Math.max(m.getZoom(), 6), duration: 900 }) }
          if (m.getSource('selected')) put(); else m.once('style.load', () => setTimeout(put, 0))
        }
      })
      .catch((e: Error) => { if (live) setDetailErr(e.message) })
    return () => { live = false }
  }, [selected, data])

  useEffect(() => {
    let live = true
    const load = () => fetch('/api/live/region').then((r) => r.json()).then((d) => { if (live) { setData(d); setUpdated(new Date()); setError('') } }).catch(() => live && setError('Live feed unavailable right now.'))
    load(); const t = setInterval(load, 30_000)
    return () => { live = false; clearInterval(t) }
  }, [])

  // Map init: globe projection, framed on the Atlantic lanes.
  useEffect(() => {
    if (!box.current || map.current) return
    setupMapLibre()
    const m = new maplibregl.Map({ container: box.current, style: MAP_STYLE, center: [-15, 18], zoom: 2.1, attributionControl: { compact: true }, cooperativeGestures: true })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('style.load', () => {
      try { m.setProjection({ type: 'globe' }) } catch { /* older maplibre: stays mercator */ }
      brandBasemap(m)
      const laneFc: FeatureCollection = { type: 'FeatureCollection', features: lanes.filter(([o, d]) => originCoords[o] && destGeo[d]).map(([o, d]) => ({ type: 'Feature', properties: { o, d }, geometry: { type: 'LineString', coordinates: greatCircle(originCoords[o], destGeo[d].port.at, 64) } })) }
      m.addSource('lanes', { type: 'geojson', data: laneFc })
      m.addLayer({ id: 'lanes-glow', type: 'line', source: 'lanes', paint: { 'line-color': '#E3B54A', 'line-width': 5, 'line-opacity': 0.08 } })
      m.addLayer({ id: 'lanes', type: 'line', source: 'lanes', paint: { 'line-color': '#E3B54A', 'line-width': 1, 'line-dasharray': [2, 4], 'line-opacity': 0.55 } })
      const portFc: FeatureCollection = { type: 'FeatureCollection', features: Object.entries(destGeo).map(([code, g]) => ({ type: 'Feature', properties: { code, name: g.port.name }, geometry: { type: 'Point', coordinates: g.port.at } })) }
      m.addSource('ports', { type: 'geojson', data: portFc })
      m.addLayer({ id: 'ports-halo', type: 'circle', source: 'ports', paint: { 'circle-radius': 12, 'circle-color': '#E3B54A', 'circle-opacity': 0.15 } })
      m.addLayer({ id: 'ports', type: 'circle', source: 'ports', paint: { 'circle-radius': 4.5, 'circle-color': '#E3B54A', 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 1.5 } })
      m.addSource('vessels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'vessels', type: 'circle', source: 'vessels', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1.5, 1.4, 4, 2.5, 7, 5], 'circle-color': ['case', ['<', ['get', 'speed'], 1], '#A3AEC2', '#2DD4BF'], 'circle-opacity': 0.9, 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 0.5 } })
      m.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'selected-halo', type: 'circle', source: 'selected', paint: { 'circle-radius': 14, 'circle-color': '#E3B54A', 'circle-opacity': 0.25 } })
      m.addLayer({ id: 'selected', type: 'circle', source: 'selected', paint: { 'circle-radius': 6, 'circle-color': '#E3B54A', 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 1.5 } })
      m.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'flights', type: 'circle', source: 'flights', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1.5, 1.6, 4, 3, 7, 6], 'circle-color': ['case', ['get', 'cargo'], '#7DD3FC', '#5B8DB8'], 'circle-opacity': ['case', ['get', 'cargo'], 0.95, 0.7], 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 0.6 } })
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
      for (const layer of ['vessels', 'flights']) {
        m.on('mouseenter', layer, (e) => {
          m.getCanvas().style.cursor = 'pointer'
          const f = e.features?.[0]; if (!f) return
          const p = f.properties as { name: string; speed?: number; altitude?: number; at: string }
          const g = f.geometry as Point
          popup.setLngLat(g.coordinates as LngLat).setHTML(`<strong>${p.name || (layer === 'flights' ? 'Aircraft' : 'Vessel')}</strong><br/>${p.speed != null ? `${Math.round(p.speed)} ${layer === 'flights' ? 'kt' : 'kn'}` : ''}${p.altitude != null ? ` · ${Math.round(p.altitude).toLocaleString()} ft` : ''}<br/><span style="color:#A3AEC2">${new Date(p.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>`).addTo(m)
        })
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; popup.remove() })
      }
      for (const [layer, kind] of [['vessels', 'vessel'], ['flights', 'flight']] as const) m.on('click', layer, (e) => {
        const f = e.features?.[0]; if (!f) return
        const id = String((f.properties as { id: string }).id)
        flownTo.current = id
        setSelected({ kind, id })
        const c = (f.geometry as Point).coordinates as LngLat
        ;(m.getSource('selected') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }] })
        if (m.getZoom() < 5) m.easeTo({ center: c, zoom: 6, duration: 900 })
      })
      m.on('click', 'ports', (e) => { const f = e.features?.[0]; if (f) m.easeTo({ center: (f.geometry as Point).coordinates as LngLat, zoom: 8, duration: 900 }) })
    })
    // Port labels as DOM markers (independent of the basemap's glyph set).
    for (const [, g] of Object.entries(destGeo)) {
      const el = document.createElement('div'); el.className = 'ss-portlabel'; el.textContent = g.port.name.replace('Port of ', '')
      new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 8] }).setLngLat(g.port.at).addTo(m)
    }
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __ssmap?: maplibregl.Map }).__ssmap = m // for local smoke tests
    return () => { m.remove(); map.current = null }
  }, [])

  // Push live points into the map whenever data refreshes.
  useEffect(() => {
    const m = map.current; if (!m || !data) return
    const apply = () => {
      const toFc = (pts: LivePos[]): FeatureCollection => ({ type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', properties: { id: (p as { id?: string }).id ?? '', name: p.name ?? '', speed: p.speed ?? 0, altitude: p.altitude, at: p.at, cargo: !!(p as { cargo?: boolean }).cargo }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) })
      ;(m.getSource('vessels') as maplibregl.GeoJSONSource | undefined)?.setData(toFc(data.vessels))
      ;(m.getSource('flights') as maplibregl.GeoJSONSource | undefined)?.setData(toFc(cargoOnly ? data.flights.filter((f) => f.cargo) : data.flights))
      const s = selectedRef.current
      const sel = s && (s.kind === 'vessel' ? data.vessels : data.flights).find((v) => v.id === s.id)
      ;(m.getSource('selected') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: sel ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [sel.lon, sel.lat] } }] : [] })
    }
    if (m.getSource('vessels')) apply(); else m.once('style.load', () => setTimeout(apply, 0))
  }, [data, cargoOnly])

  const clearSelection = () => { setSelected(null); (map.current?.getSource('selected') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] }) }
  const anchoredTotal = useMemo(() => Object.values(data?.congestion ?? {}).reduce((n, c) => n + c.anchored, 0), [data])
  const aisLabel = !data ? 'Connecting…' : data.ais.status === 'live' ? 'AIS live' : data.ais.enabled ? (data.ais.status === 'error' ? 'AIS error' : 'AIS connecting') : 'AIS not configured'

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger} className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <motion.p variants={fadeUp} className="eyebrow mb-2">Live lanes</motion.p>
            <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">The Gulf of Guinea, right now</motion.h1>
            <motion.p variants={fadeUp} className="mt-2 text-text-muted">Ships across Europe, the US coasts, the Atlantic approach and the West African coast, and aircraft over them, from public AIS and ADS-B feeds — plus the lanes Ship Sync shippers sail from North America, Europe and Asia.</motion.p>
          </div>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={data?.ais.status === 'live' ? 'gold' : 'muted'}><Radio size={12} className={`mr-1 ${data?.ais.status === 'live' ? 'animate-pulse' : ''}`} aria-hidden="true" /> {aisLabel}</Pill>
            <Pill tone="teal"><Ship size={12} className="mr-1" aria-hidden="true" /> {data?.vessels.length ?? '–'} vessels</Pill>
            <Pill tone="sky"><Plane size={12} className="mr-1" aria-hidden="true" /> {data ? (cargoOnly ? data.flights.filter((f) => f.cargo).length : data.flights.length) : '–'} aircraft</Pill>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted"><input type="checkbox" checked={cargoOnly} onChange={(e) => setCargoOnly(e.target.checked)} className="accent-gold" /> Cargo flights only</label>
            {updated && <span className="text-xs text-text-muted">Updated {updated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
          </motion.div>
        </motion.div>

        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-9">
            <div ref={box} className="ss-map h-[62vh] min-h-[420px]" role="img" aria-label="Live map of vessels and aircraft around West Africa" />
            <p className="mt-2 flex items-start gap-2 text-xs text-text-muted"><TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> Positions come from public, delayed feeds (AISStream, adsb.lol). Terrestrial AIS only covers the coast, so ships mid-ocean are not shown. Not for navigation or safety decisions. Basemap © CARTO, © OpenStreetMap contributors.</p>
          </div>
          <aside className="lg:col-span-3">
            {selected?.kind === 'vessel' && <VesselCard mmsi={selected.id} v={vessel} err={detailErr} onClose={clearSelection} />}
            {selected?.kind === 'flight' && <FlightCard f={flight} err={detailErr} onClose={clearSelection} />}
            {!selected && data && (data.vessels.length > 0 || data.flights.length > 0) && <p className="mb-4 text-xs text-text-muted"><MapPin size={12} className="mr-1 inline" aria-hidden="true" />Click any ship or aircraft for its details, origin/destination and ETA.</p>}
            <div className="card-dark p-5">
              <h2 className="!text-lg">Port approaches</h2>
              <p className="mt-1 text-xs text-text-muted">Vessels within each port's approach box; grey ones are stopped (under 1 knot) — usually waiting at anchor.</p>
              <ul className="mt-4 divide-y divide-border">
                {countries.map((c) => {
                  const cg = data?.congestion[c.code]
                  return (
                    <li key={c.code} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="flex items-center gap-2 text-text"><span aria-hidden="true">{c.flag}</span>{destGeo[c.code]?.port.name.replace('Port of ', '') ?? c.name}</span>
                      <span className="flex items-center gap-3 tabular-nums">
                        <span className="text-text-muted" title="Vessels in approach"><Ship size={12} className="mr-1 inline" aria-hidden="true" />{cg?.total ?? '–'}</span>
                        <span className={cg && cg.anchored >= 8 ? 'text-gold' : 'text-text'} title="Stopped / at anchor"><Anchor size={12} className="mr-1 inline" aria-hidden="true" />{cg?.anchored ?? '–'}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
              {data && !data.ais.enabled && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">Vessel data appears once an AISStream key is configured on the server.</p>}
              {data && data.ais.status === 'live' && (data.ais.coastVessels ?? 0) === 0 && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">Counts are 0 because no community AIS receiver on the Gulf of Guinea coast is feeding AISStream right now. Ships are still tracked across Europe, the US coasts and the Atlantic approach, and reappear here when a coastal receiver comes online.</p>}
              {data && data.flights.length === 0 && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">No aircraft right now — the public ADS-B feed (adsb.lol) may be briefly unavailable. Aircraft are polled around the hub airports on these lanes; community receivers over West Africa itself are sparse.</p>}
              {anchoredTotal >= 15 && <p className="mt-3 text-xs text-gold">High congestion across the region — expect extra days for clearance.</p>}
            </div>
            <div className="card-dark mt-4 p-5">
              <h2 className="!text-lg">Ship on these lanes</h2>
              <p className="mt-1 text-xs text-text-muted">Verified shippers quote every lane drawn on the map.</p>
              <Link to="/quote" className="btn-gold mt-4 w-full !min-h-10 text-sm">Get free quotes <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return <div className="flex justify-between gap-3 py-1.5 text-sm"><dt className="shrink-0 text-text-muted">{label}</dt><dd className="text-right text-text">{value}</dd></div>
}

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 60 * 48 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`
}

/** Everything AIS tells us about one ship. AIS carries the *next* destination and ETA but never the port of origin, so
 *  "first seen" (where our feed first heard it) is the closest honest stand-in. */
function VesselCard({ mmsi, v, err, onClose }: { mmsi: string; v: VesselDetail | null; err: string; onClose: () => void }) {
  const flag = flagFromMmsi(mmsi)
  const type = shipTypeLabel(v?.type)
  const status = navStatusLabel(v?.navStatus)
  const moving = (v?.speed ?? 0) >= 1
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-dark mb-4 p-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Vessel</p>
          <h2 className="!text-lg leading-tight">{v?.name || 'Unnamed vessel'}</h2>
          <p className="mt-1 text-xs text-text-muted">{[flag, type].filter(Boolean).join(' · ') || 'Awaiting static data'}</p>
        </div>
        <button type="button" onClick={onClose} className="focus-ring -mr-2 -mt-2 rounded-md p-2 text-text-muted hover:text-text" aria-label="Close vessel details"><X size={16} aria-hidden="true" /></button>
      </div>
      {err && <p className="mt-3 text-xs text-danger">{err}</p>}
      {v && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone={moving ? 'teal' : 'muted'}><Navigation size={11} className="mr-1" aria-hidden="true" />{status ?? (moving ? 'Under way' : 'Stopped')}</Pill>
            {v.watched && <Pill tone="gold"><Ship size={11} className="mr-1" aria-hidden="true" />Carrying a Ship Sync shipment</Pill>}
          </div>
          <dl className="mt-3 divide-y divide-border">
            <Row label="Reported destination" value={v.destination} />
            <Row label="Reported ETA" value={formatEta(v.eta)} />
            <Row label="Speed" value={v.speed != null ? `${v.speed.toFixed(1)} kn` : undefined} />
            <Row label="Course" value={v.course != null ? `${Math.round(v.course)}° ${compass(v.course) ?? ''}` : undefined} />
            <Row label="Heading" value={v.heading != null ? `${Math.round(v.heading)}°` : undefined} />
            <Row label="Position" value={`${Math.abs(v.lat).toFixed(3)}° ${v.lat >= 0 ? 'N' : 'S'}, ${Math.abs(v.lon).toFixed(3)}° ${v.lon >= 0 ? 'E' : 'W'}`} />
            <Row label="Size" value={v.length ? `${v.length} m × ${v.beam ?? '?'} m` : undefined} />
            <Row label="Draught" value={v.draught ? `${v.draught} m` : undefined} />
            <Row label="MMSI" value={v.id} />
            <Row label="IMO" value={v.imo && v.imo !== '0' ? v.imo : undefined} />
            <Row label="Call sign" value={v.callSign} />
            <Row label="Last signal" value={ago(v.at)} />
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted"><Compass size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {v.firstSeen
              ? <span>Origin isn't broadcast by AIS — ships only report their next port. Our feed first heard this ship {ago(v.firstSeen.at)} at {Math.abs(v.firstSeen.lat).toFixed(2)}° {v.firstSeen.lat >= 0 ? 'N' : 'S'}, {Math.abs(v.firstSeen.lon).toFixed(2)}° {v.firstSeen.lon >= 0 ? 'E' : 'W'}.</span>
              : <span>Origin isn't broadcast by AIS — ships only report their next port.</span>}
          </p>
          {!v.destination && <p className="mt-2 flex items-start gap-2 text-xs text-text-muted"><Flag size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Destination, ETA and dimensions arrive with the ship's static broadcast (every 6 minutes) — check back shortly.</p>}
        </>
      )}
      {!v && !err && <p className="mt-3 text-xs text-text-muted">Loading…</p>}
    </motion.div>
  )
}

const airportLabel = (a: Airport) => `${a.city ?? a.name}${a.iata ? ` (${a.iata})` : ''}`

/** Everything public ADS-B tells us about one aircraft, plus adsb.lol's crowd-sourced route (origin → destination). */
function FlightCard({ f, err, onClose }: { f: FlightDetail | null; err: string; onClose: () => void }) {
  const climbing = (f?.vertRate ?? 0) > 300, descending = (f?.vertRate ?? 0) < -300
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-dark mb-4 p-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Aircraft</p>
          <h2 className="!text-lg leading-tight">{f?.callsign || f?.registration || 'Aircraft'}</h2>
          <p className="mt-1 text-xs text-text-muted">{[f?.description ?? f?.type, f?.registration].filter(Boolean).join(' · ') || 'Awaiting identification'}</p>
        </div>
        <button type="button" onClick={onClose} className="focus-ring -mr-2 -mt-2 rounded-md p-2 text-text-muted hover:text-text" aria-label="Close aircraft details"><X size={16} aria-hidden="true" /></button>
      </div>
      {err && <p className="mt-3 text-xs text-danger">{err}</p>}
      {f && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone={f.cargo ? 'gold' : 'sky'}><Plane size={11} className="mr-1" aria-hidden="true" />{f.cargo ? 'Cargo flight' : 'Passenger / other'}</Pill>
            {f.onGround ? <Pill tone="muted">On the ground</Pill> : climbing ? <Pill tone="teal">Climbing</Pill> : descending ? <Pill tone="teal">Descending</Pill> : <Pill tone="teal">Cruising</Pill>}
          </div>
          {f.route ? (
            <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex items-center gap-2"><span className="text-text">{airportLabel(f.route.origin)}</span><ArrowRight size={14} className="shrink-0 text-gold" aria-hidden="true" /><span className="text-text">{airportLabel(f.route.destination)}</span></div>
              <p className="mt-1 text-xs text-text-muted">{f.route.origin.name} → {f.route.destination.name}{f.route.via?.length ? ` via ${f.route.via.map(airportLabel).join(', ')}` : ''}{f.route.plausible ? '' : ' · route unconfirmed'}</p>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">{f.callsign ? 'No route on file for this callsign — the public route database (adsb.lol) covers scheduled flights best.' : 'No callsign broadcast, so the route can\'t be looked up.'}</p>
          )}
          <dl className="mt-3 divide-y divide-border">
            <Row label="Altitude" value={f.onGround ? 'Ground' : f.altitude != null ? `${Math.round(f.altitude).toLocaleString()} ft` : undefined} />
            <Row label="Ground speed" value={f.speed != null ? `${Math.round(f.speed)} kt (${Math.round(f.speed * 1.852)} km/h)` : undefined} />
            <Row label="Track" value={f.course != null ? `${Math.round(f.course)}° ${compass(f.course) ?? ''}` : undefined} />
            <Row label="Vertical rate" value={f.vertRate != null && f.vertRate !== 0 ? `${f.vertRate > 0 ? '+' : ''}${f.vertRate} ft/min` : undefined} />
            <Row label="Position" value={`${Math.abs(f.lat).toFixed(3)}° ${f.lat >= 0 ? 'N' : 'S'}, ${Math.abs(f.lon).toFixed(3)}° ${f.lon >= 0 ? 'E' : 'W'}`} />
            <Row label="Aircraft type" value={f.type} />
            <Row label="Registration" value={f.registration} />
            <Row label="ICAO hex" value={f.id} />
            <Row label="Squawk" value={f.squawk} />
            <Row label="Last signal" value={ago(f.at)} />
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted"><Compass size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Position from public ADS-B receivers (adsb.lol); the route comes from a community database matched on callsign, so it is a best effort, not the airline's record.</p>
        </>
      )}
      {!f && !err && <p className="mt-3 text-xs text-text-muted">Loading…</p>}
    </motion.div>
  )
}
