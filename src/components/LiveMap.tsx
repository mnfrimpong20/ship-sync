import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
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

const shipSvg = (color: string) => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L17 12 L12 22 L7 12 Z" fill="${color}" fill-opacity="0.9"/></svg>`
const planeSvg = (color: string) => `<svg width="34" height="34" viewBox="0 0 24 24" fill="${color}"><path d="M12 2 L14 9 L21 12 L14 13.5 L13 20 L15 22 L12 21 L9 22 L11 20 L10 13.5 L3 12 L10 9 Z"/></svg>`

function markerEl(kind: 'live' | 'last' | 'est', mode: 'air' | 'ocean', course?: number) {
  const el = document.createElement('div')
  const color = kind === 'live' ? '#E3B54A' : kind === 'last' ? '#A3AEC2' : '#2DD4BF'
  el.innerHTML = mode === 'air' ? planeSvg(color) : shipSvg(color)
  el.style.width = '34px'; el.style.height = '34px'; el.style.transform = `rotate(${course ?? 0}deg)`
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
    if (m.isStyleLoaded()) drawRoute(); else m.once('load', drawRoute)
    const draw = () => {
      markers.current.forEach((k) => k.remove()); markers.current = []
      const pts: LngLat[] = []
      if (route) {
        for (const [pt, label] of [[route.origin.at, route.origin.name], [route.destination.at, route.destination.name]] as [LngLat, string][]) {
          const el = document.createElement('div'); el.className = 'ss-endpoint'; el.innerHTML = `<span></span><b>${label}</b>`
          markers.current.push(new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(pt).addTo(m)); pts.push(pt)
        }
      }
      const pos = data.live ?? data.lastKnown
      if (pos) {
        const kind = data.live ? 'live' : 'last'
        if (data.live) markers.current.push(new maplibregl.Marker({ element: pulseEl(), anchor: 'center' }).setLngLat([pos.lon, pos.lat]).addTo(m))
        const mk = new maplibregl.Marker({ element: markerEl(kind, data.mode, pos.course ?? pos.heading), anchor: 'center', rotationAlignment: 'map' }).setLngLat([pos.lon, pos.lat])
        const when = new Date(pos.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        mk.setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`<strong>${pos.name ?? (data.mode === 'air' ? 'Flight' : 'Vessel')}</strong><br/>${kind === 'live' ? 'Live' : 'Last known'} · ${when}${pos.speed != null ? `<br/>${Math.round(pos.speed)} ${data.mode === 'air' ? 'kt' : 'kn'}` : ''}${pos.altitude != null ? ` · ${Math.round(pos.altitude).toLocaleString()} ft` : ''}`))
        markers.current.push(mk.addTo(m)); pts.push([pos.lon, pos.lat])
      } else if (data.estimated && data.phase === 'transit') {
        const mk = new maplibregl.Marker({ element: markerEl('est', data.mode), anchor: 'center' }).setLngLat([data.estimated.lon, data.estimated.lat])
        mk.setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`<strong>Estimated position</strong><br/>${Math.round(data.progress * 100)}% of the way`))
        markers.current.push(mk.addTo(m)); pts.push([data.estimated.lon, data.estimated.lat])
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
