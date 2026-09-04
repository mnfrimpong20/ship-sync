import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setupMapLibre } from '../lib/mapSetup'
import { motion } from 'motion/react'
import type { FeatureCollection, Point } from 'geojson'
import { Anchor, ArrowRight, MapPin, Plane, Radio, Ship, TriangleAlert } from 'lucide-react'
import { MAP_STYLE, brandBasemap, type LivePos } from '../components/LiveMap'
import { countries } from '../lib/data'
import { greatCircle, originCoords, destGeo, type LngLat } from '../lib/geo'
import { fadeUp, stagger } from '../lib/motion'
import { Pill } from '../components/ui'
import { useStore } from '../lib/store'
import { countryByCode } from '../lib/data'
import { FlightCard, VesselCard, type FlightDetail, type VesselDetail } from '../components/CarrierCards'

interface RegionPayload {
  vessels: (LivePos & { id: string; kind: 'vessel' })[]
  flights: (LivePos & { id: string; kind: 'flight'; cargo: boolean })[]
  congestion: Record<string, { total: number; anchored: number }>
  ais: { status: 'off' | 'connecting' | 'live' | 'error'; enabled: boolean; lastMessageAt: string | null; coastVessels?: number; error?: string }
  ports: Record<string, { name: string; at: LngLat; airport: { name: string; at: LngLat } }>
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
  const { user, shipments, setTransit } = useStore()
  const [assignMsg, setAssignMsg] = useState('')
  const [params, setParams] = useSearchParams()
  const [selected, setSelectedState] = useState<Selection | null>(() => {
    const v = params.get('vessel'), f = params.get('flight')
    return v && /^\d{9}$/.test(v) ? { kind: 'vessel', id: v } : f && /^~?[0-9a-f]{6}$/i.test(f) ? { kind: 'flight', id: f.toLowerCase() } : null
  })
  /** Selection lives in the URL too (?vessel=MMSI / ?flight=HEX) so a ship or plane can be shared or refreshed. */
  const setSelected = (sel: Selection | null) => {
    setSelectedState(sel); setAssignMsg('')
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

  /** Signed-in shippers can attach the selected ship/plane to one of their active shipments straight from the map. */
  const assignFooter = (kind: 'vessel' | 'flight', carrier: { id: string; name?: string; callsign?: string } | null) => {
    if (!user || user.role !== 'shipper' || !carrier) return null
    const mode = kind === 'vessel' ? 'ocean' : 'air'
    const mine = shipments.filter((x) => x.mode === mode && x.status !== 'delivered')
    const already = mine.find((x) => (kind === 'vessel' ? x.mmsi === carrier.id : x.flight && carrier.callsign && x.flight.toUpperCase() === carrier.callsign.toUpperCase()))
    if (!mine.length) return null
    const label = kind === 'vessel' ? (carrier.name || `MMSI ${carrier.id}`) : (carrier.callsign || carrier.id)
    return (
      <div className="mt-4 border-t border-border pt-3">
        {already ? <p className="text-xs text-teal">Assigned to your shipment <span className="font-mono">{already.ref}</span>.</p> : (
          <label className="block text-xs text-text-muted">Assign {label} to a shipment
            <select className="input-dark mt-1 !min-h-10 text-sm" defaultValue="" onChange={async (e) => {
              const id = e.target.value; if (!id) return
              try {
                await setTransit(id, kind === 'vessel' ? { vesselName: carrier.name, mmsi: carrier.id } : { flight: carrier.callsign })
                setAssignMsg(`Saved — customers tracking ${mine.find((x) => x.id === id)?.ref} now see this ${kind === 'vessel' ? 'ship' : 'flight'}.`)
              } catch (err) { setAssignMsg(err instanceof Error ? err.message : 'Could not assign.') }
            }}>
              <option value="">Choose a shipment…</option>
              {mine.map((x) => <option key={x.id} value={x.id}>{x.ref} · {x.origin} → {countryByCode(x.destination)?.name ?? x.destination}</option>)}
            </select>
          </label>
        )}
        {assignMsg && <p className="mt-2 text-xs text-gold" role="status">{assignMsg}</p>}
      </div>
    )
  }
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
            <p className="mt-2 flex items-start gap-2 text-xs text-text-muted"><TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> Positions come from public, delayed feeds (AISStream, adsb.fi, adsb.lol). Terrestrial AIS only covers the coast, so ships mid-ocean are not shown. Not for navigation or safety decisions. Basemap © CARTO, © OpenStreetMap contributors.</p>
          </div>
          <aside className="lg:col-span-3">
            {selected?.kind === 'vessel' && <VesselCard mmsi={selected.id} v={vessel} err={detailErr} onClose={clearSelection} footer={assignFooter('vessel', vessel)} />}
            {selected?.kind === 'flight' && <FlightCard f={flight} err={detailErr} onClose={clearSelection} footer={assignFooter('flight', flight && (flight.callsign ? flight : null))} />}
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
              {data && data.flights.length === 0 && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">No aircraft right now — the public ADS-B feeds (adsb.fi, adsb.lol) may be briefly unavailable. Aircraft are polled around the hub airports on these lanes; community receivers over West Africa itself are sparse.</p>}
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

