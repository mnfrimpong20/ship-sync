import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setupMapLibre } from '../lib/mapSetup'
import { motion } from 'motion/react'
import type { FeatureCollection, Point } from 'geojson'
import { Anchor, ArrowRight, Plane, Radio, Ship, TriangleAlert } from 'lucide-react'
import { MAP_STYLE, brandBasemap, type LivePos } from '../components/LiveMap'
import { countries } from '../lib/data'
import { greatCircle, originCoords, destGeo, type LngLat } from '../lib/geo'
import { fadeUp, stagger } from '../lib/motion'
import { Pill } from '../components/ui'

interface RegionPayload {
  vessels: (LivePos & { id: string; kind: 'vessel' })[]
  flights: (LivePos & { id: string; kind: 'flight' })[]
  congestion: Record<string, { total: number; anchored: number }>
  ais: { status: 'off' | 'connecting' | 'live' | 'error'; enabled: boolean; lastMessageAt: string | null; error?: string }
  ports: Record<string, { name: string; at: LngLat; airport: { name: string; at: LngLat } }>
}

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
      m.addLayer({ id: 'vessels', type: 'circle', source: 'vessels', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.5, 7, 5], 'circle-color': ['case', ['<', ['get', 'speed'], 1], '#A3AEC2', '#2DD4BF'], 'circle-opacity': 0.9, 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 0.5 } })
      m.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'flights', type: 'circle', source: 'flights', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 7, 6], 'circle-color': '#7DD3FC', 'circle-opacity': 0.95, 'circle-stroke-color': '#0B1220', 'circle-stroke-width': 0.8 } })
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
      m.on('click', 'ports', (e) => { const f = e.features?.[0]; if (f) m.easeTo({ center: (f.geometry as Point).coordinates as LngLat, zoom: 8, duration: 900 }) })
    })
    // Port labels as DOM markers (independent of the basemap's glyph set).
    for (const [, g] of Object.entries(destGeo)) {
      const el = document.createElement('div'); el.className = 'ss-portlabel'; el.textContent = g.port.name.replace('Port of ', '')
      new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 8] }).setLngLat(g.port.at).addTo(m)
    }
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  // Push live points into the map whenever data refreshes.
  useEffect(() => {
    const m = map.current; if (!m || !data) return
    const apply = () => {
      const toFc = (pts: LivePos[]): FeatureCollection => ({ type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', properties: { name: p.name ?? '', speed: p.speed ?? 0, altitude: p.altitude, at: p.at }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) })
      ;(m.getSource('vessels') as maplibregl.GeoJSONSource | undefined)?.setData(toFc(data.vessels))
      ;(m.getSource('flights') as maplibregl.GeoJSONSource | undefined)?.setData(toFc(data.flights))
    }
    if (m.getSource('vessels')) apply(); else m.once('style.load', () => setTimeout(apply, 0))
  }, [data])

  const anchoredTotal = useMemo(() => Object.values(data?.congestion ?? {}).reduce((n, c) => n + c.anchored, 0), [data])
  const aisLabel = !data ? 'Connecting…' : data.ais.status === 'live' ? 'AIS live' : data.ais.enabled ? (data.ais.status === 'error' ? 'AIS error' : 'AIS connecting') : 'AIS not configured'

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger} className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <motion.p variants={fadeUp} className="eyebrow mb-2">Live lanes</motion.p>
            <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">The Gulf of Guinea, right now</motion.h1>
            <motion.p variants={fadeUp} className="mt-2 text-text-muted">Every ship on the West African coast and every aircraft over it, from public AIS and ADS-B feeds — plus the lanes Ship Sync shippers sail from North America, Europe and Asia.</motion.p>
          </div>
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone={data?.ais.status === 'live' ? 'gold' : 'muted'}><Radio size={12} className={`mr-1 ${data?.ais.status === 'live' ? 'animate-pulse' : ''}`} aria-hidden="true" /> {aisLabel}</Pill>
            <Pill tone="teal"><Ship size={12} className="mr-1" aria-hidden="true" /> {data?.vessels.length ?? '–'} vessels</Pill>
            <Pill tone="sky"><Plane size={12} className="mr-1" aria-hidden="true" /> {data?.flights.length ?? '–'} aircraft</Pill>
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
