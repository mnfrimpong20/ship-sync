import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setupMapLibre } from '../lib/mapSetup'
import type { LngLat } from '../lib/geo'
import type { FeatureCollection } from 'geojson'

export interface LivePos { lat: number; lon: number; speed?: number; course?: number; heading?: number; altitude?: number; at: string; source: string; name?: string }
export interface PositionPayload {
  mode: 'air' | 'ocean'
  phase: 'pre' | 'transit' | 'post'
  status: string
  progress: number
  route: { origin: { name: string; at: LngLat }; destination: { name: string; at: LngLat }; path: LngLat[] } | null
  carrier: { vesselName?: string; mmsi?: string; flight?: string }
  live: LivePos | null
  lastKnown: LivePos | null
  estimated: { lat: number; lon: number } | null
  note: string
}

/** Free, keyless dark basemap (CARTO, attribution required and shown). */
export const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const shipSvg = (color: string) => `<svg width="40" height="40" viewBox="0 0 24 24" fill="${color}" stroke="#0B1220" stroke-width="0.6" stroke-linejoin="round"><path d="M12 1.5 L16.5 8 L16.5 17 L12 22.5 L7.5 17 L7.5 8 Z"/><rect x="10" y="7" width="4" height="7" rx="0.8" fill="#0B1220" opacity="0.55"/></svg>`
const planeSvg = (color: string) => `<svg width="40" height="40" viewBox="0 0 24 24" fill="${color}" stroke="#0B1220" stroke-width="0.6" stroke-linejoin="round"><path d="M12 2 L14 9 L21 12 L14 13.5 L13 20 L15 22 L12 21 L9 22 L11 20 L10 13.5 L3 12 L10 9 Z"/></svg>`

function bearing(a: LngLat, b: LngLat) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const [lon1, lat1] = [toRad(a[0]), toRad(a[1])], [lon2, lat2] = [toRad(b[0]), toRad(b[1])]
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2), x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** CARTO dark-matter is near-black; tint it so sea and land read in Ship Sync's navy palette. */
export function brandBasemap(m: maplibregl.Map) {
  for (const layer of m.getStyle().layers ?? []) {
    try {
      if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', '#1A2640')
      else if (layer.type === 'fill' && /water|ocean|sea/i.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', '#0B1220')
      else if (layer.type === 'fill' && /land|earth|park|green/i.test(layer.id)) m.setPaintProperty(layer.id, 'fill-color', '#1A2640')
    } catch { /* layer may not support the property */ }
  }
}

function markerEl(kind: 'live' | 'last' | 'est', mode: 'air' | 'ocean', course?: number) {
  const el = document.createElement('div')
  const color = kind === 'live' ? '#E3B54A' : kind === 'last' ? '#A3AEC2' : '#2DD4BF'
  el.innerHTML = mode === 'air' ? planeSvg(color) : shipSvg(color)
  el.style.width = '40px'; el.style.height = '40px'; el.style.transform = `rotate(${course ?? 0}deg)`
  el.style.filter = kind === 'live' ? 'drop-shadow(0 0 8px rgba(227,181,74,0.8))' : 'none'
  if (kind === 'est') el.style.opacity = '0.85'
  el.setAttribute('aria-label', kind === 'live' ? 'Live position' : kind === 'last' ? 'Last known position' : 'Estimated position')
  return el
}

function pulseEl() {
  const el = document.createElement('div')
  el.className = 'ss-pulse'
  return el
}

export default function LiveMap({ data, className = '' }: { data: PositionPayload; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!box.current || map.current) return
    setupMapLibre()
    const m = new maplibregl.Map({ container: box.current, style: MAP_STYLE, center: [-20, 20], zoom: 1.5, attributionControl: { compact: true }, cooperativeGestures: true })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const route = data.route
    // Route line needs the style; markers don't — so markers draw immediately even if the basemap is slow or blocked.
    const drawRoute = () => {
      const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined
      const fc = { type: 'FeatureCollection', features: route ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: route.path }, properties: {} }] : [] } as FeatureCollection
      if (src) src.setData(fc)
      else {
        m.addSource('route', { type: 'geojson', data: fc })
        m.addLayer({ id: 'route-glow', type: 'line', source: 'route', paint: { 'line-color': '#E3B54A', 'line-width': 6, 'line-opacity': 0.15 } })
        m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#E3B54A', 'line-width': 1.5, 'line-dasharray': [2, 3], 'line-opacity': 0.9 } })
      }
    }
    let routeDone = false
    const tryRoute = () => { if (routeDone) return; try { drawRoute(); brandBasemap(m); routeDone = true } catch { /* style not ready yet */ } }
    tryRoute()
    if (!routeDone) { m.once('load', tryRoute); m.on('styledata', tryRoute); m.once('idle', tryRoute) }
    const draw = () => {
      markers.current.forEach((k) => k.remove()); markers.current = []
      const pts: LngLat[] = []
      if (route) {
        for (const [pt, label] of [[route.origin.at, route.origin.name], [route.destination.at, route.destination.name]] as [LngLat, string][]) {
          const el = document.createElement('div'); el.className = 'ss-endpoint'; el.innerHTML = `<span></span><b>${label}</b>`
          markers.current.push(new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(pt).addTo(m)); pts.push(pt)
        }
      }
      const tag = (text: string, tone: string) => { const el = document.createElement('div'); el.className = 'ss-tag'; el.style.borderColor = tone; el.textContent = text; return el }
      const pos = data.live ?? data.lastKnown
      if (pos) {
        const kind = data.live ? 'live' : 'last'
        if (data.live) markers.current.push(new maplibregl.Marker({ element: pulseEl(), anchor: 'center' }).setLngLat([pos.lon, pos.lat]).addTo(m))
        const mk = new maplibregl.Marker({ element: markerEl(kind, data.mode, pos.course ?? pos.heading), anchor: 'center', rotationAlignment: 'map' }).setLngLat([pos.lon, pos.lat])
        const when = new Date(pos.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        mk.setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`<strong>${pos.name ?? (data.mode === 'air' ? 'Flight' : 'Vessel')}</strong><br/>${kind === 'live' ? 'Live' : 'Last known'} · ${when}${pos.speed != null ? `<br/>${Math.round(pos.speed)} ${data.mode === 'air' ? 'kt' : 'kn'}` : ''}${pos.altitude != null ? ` · ${Math.round(pos.altitude).toLocaleString()} ft` : ''}`))
        markers.current.push(mk.addTo(m)); pts.push([pos.lon, pos.lat])
        markers.current.push(new maplibregl.Marker({ element: tag(`${pos.name ?? (data.mode === 'air' ? 'Flight' : 'Vessel')} · ${kind === 'live' ? 'live' : 'last known'}`, kind === 'live' ? '#E3B54A' : '#A3AEC2'), anchor: 'left', offset: [24, 0] }).setLngLat([pos.lon, pos.lat]).addTo(m))
      } else if (data.estimated && data.phase === 'transit') {
        const at: LngLat = [data.estimated.lon, data.estimated.lat]
        const heading = data.route ? bearing(data.route.origin.at, data.route.destination.at) : 0
        const mk = new maplibregl.Marker({ element: markerEl('est', data.mode, heading), anchor: 'center', rotationAlignment: 'map' }).setLngLat(at)
        mk.setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`<strong>Estimated position</strong><br/>${Math.round(data.progress * 100)}% of the way, based on departure and ETA`))
        markers.current.push(mk.addTo(m)); pts.push(at)
        markers.current.push(new maplibregl.Marker({ element: tag(`Estimated · ${Math.round(data.progress * 100)}% of the way`, '#2DD4BF'), anchor: 'left', offset: [24, 0] }).setLngLat(at).addTo(m))
      }
      if (pts.length >= 2) {
        const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
        m.fitBounds(b, { padding: { top: 40, bottom: 40, left: 60, right: 140 }, maxZoom: 6, duration: 600 })
      } else if (pts.length === 1) m.easeTo({ center: pts[0], zoom: 5 })
    }
    draw()
  }, [data])

  return <div ref={box} className={`ss-map ${className}`} role="img" aria-label="Map of the shipment route and current position" />
}
