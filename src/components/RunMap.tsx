import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import { setupMapLibre } from '../lib/mapSetup'
import { MAP_STYLE, brandBasemap } from './LiveMap'

export interface MapStop { id: string; seq: number; label: string; lat?: number; lon?: number; status?: 'pending' | 'done' | 'skipped' }
export interface MapStart { label: string; lat: number; lon: number }

interface Props {
  start: MapStart | null
  stops: MapStop[]
  /** Pins can be dragged to correct a bad geocode. */
  draggable?: boolean
  onMove?: (id: string | 'start', lat: number, lon: number) => void
  /** Clicking an empty spot on the map (used to place the start point when nothing is geocoded). */
  onClickMap?: (lat: number, lon: number) => void
  focusId?: string | null
  className?: string
}

function pinEl(text: string, tone: 'start' | 'pending' | 'done' | 'skipped') {
  // MapLibre positions the marker element with its own transform, so the teardrop rotation lives on a child.
  const el = document.createElement('div')
  const bg = tone === 'start' ? '#2DD4BF' : tone === 'done' ? '#3FB950' : tone === 'skipped' ? '#6B7A99' : '#E3B54A'
  el.className = 'ss-pin'
  el.style.cssText = 'width:30px;height:34px;cursor:pointer'
  el.innerHTML = `<div style="width:28px;height:28px;margin:1px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${bg};border:2px solid #0B1220;box-shadow:0 4px 12px rgba(0,0,0,.5);display:grid;place-items:center"><span style="transform:rotate(45deg);font:700 11px/1 Inter,system-ui,sans-serif;color:#0B1220">${text}</span></div>`
  return el
}

/** A small planning map: start pin, numbered stop pins in run order, and straight legs between them. */
export default function RunMap({ start, stops, draggable = false, onMove, onClickMap, focusId, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map())
  const styled = useRef(false)
  const pending = useRef<(() => void) | null>(null)
  const fitKey = useRef('')
  const cb = useRef({ onMove, onClickMap }); cb.current = { onMove, onClickMap }

  useEffect(() => {
    if (!box.current || map.current) return
    setupMapLibre()
    const m = new maplibregl.Map({ container: box.current, style: MAP_STYLE, center: [-10, 20], zoom: 2, attributionControl: { compact: true }, cooperativeGestures: true })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => { brandBasemap(m); styled.current = true; pending.current?.(); pending.current = null })
    m.on('click', (e) => cb.current.onClickMap?.(e.lngLat.lat, e.lngLat.lng))
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __ssrunmap?: maplibregl.Map }).__ssrunmap = m
    return () => { m.remove(); map.current = null; markers.current.clear(); styled.current = false }
  }, [])

  // Markers + legs
  useEffect(() => {
    const m = map.current
    if (!m) return
    const wanted = new Map<string, { lat: number; lon: number; el: HTMLElement; title: string }>()
    if (start) wanted.set('start', { lat: start.lat, lon: start.lon, el: pinEl('S', 'start'), title: start.label || 'Start' })
    const ordered = [...stops].sort((a, b) => a.seq - b.seq)
    let n = 0
    for (const s of ordered) { n++; if (s.lat != null && s.lon != null) wanted.set(s.id, { lat: s.lat, lon: s.lon, el: pinEl(String(n), s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : 'pending'), title: s.label }) }
    for (const [id, mk] of markers.current) if (!wanted.has(id)) { mk.remove(); markers.current.delete(id) }
    for (const [id, w] of wanted) {
      let mk = markers.current.get(id)
      if (!mk) {
        mk = new maplibregl.Marker({ element: w.el, anchor: 'bottom', offset: [0, 2], draggable }).setLngLat([w.lon, w.lat]).setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText(w.title)).addTo(m)
        mk.on('dragend', () => { const p = mk!.getLngLat(); cb.current.onMove?.(id, Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5) })
        markers.current.set(id, mk)
      } else {
        const cur = mk.getLngLat(); if (Math.abs(cur.lat - w.lat) > 1e-7 || Math.abs(cur.lng - w.lon) > 1e-7) mk.setLngLat([w.lon, w.lat])
        mk.getElement().replaceChildren(...w.el.childNodes)
        mk.setDraggable(draggable); mk.getPopup()?.setText(w.title)
      }
    }
    const pts: [number, number][] = [...(start ? [[start.lon, start.lat] as [number, number]] : []), ...ordered.filter((s) => s.lat != null && s.lon != null).map((s) => [s.lon!, s.lat!] as [number, number])]
    const draw = () => {
      const fc: FeatureCollection = { type: 'FeatureCollection', features: pts.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }] : [] }
      const src = m.getSource('legs') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(fc)
      else {
        m.addSource('legs', { type: 'geojson', data: fc })
        m.addLayer({ id: 'legs-glow', type: 'line', source: 'legs', paint: { 'line-color': '#E3B54A', 'line-width': 7, 'line-opacity': 0.15 } })
        m.addLayer({ id: 'legs', type: 'line', source: 'legs', paint: { 'line-color': '#E3B54A', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
      }
    }
    if (styled.current) draw(); else pending.current = draw
    // Re-frame only when the set of pins changes — not while someone drags one.
    const key = [...wanted.keys()].join('|'); if (key === fitKey.current) return; fitKey.current = key
    const frame = () => {
      m.resize() // the container may have been mid-layout (page transition) when the map was created
      const duration = m.loaded() ? 600 : 0 // animations only run once the style is up; jump if the basemap is slow or blocked
      if (pts.length === 1) m.easeTo({ center: pts[0], zoom: Math.max(m.getZoom(), 10), duration })
      else if (pts.length > 1) { const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0])); m.fitBounds(b, { padding: 60, maxZoom: 13, duration }) }
    }
    frame()
  }, [start, stops, draggable])

  useEffect(() => {
    const m = map.current; if (!m || !focusId) return
    const mk = markers.current.get(focusId); if (!mk) return
    m.easeTo({ center: mk.getLngLat(), zoom: Math.max(m.getZoom(), 12), duration: m.loaded() ? 500 : 0 })
    mk.togglePopup()
    const t = setTimeout(() => { if (mk.getPopup()?.isOpen()) mk.togglePopup() }, 2500)
    return () => clearTimeout(t)
  }, [focusId])

  // .ss-map is unlayered CSS (height:100%), so sizing utilities go on a wrapper.
  return <div className={`overflow-hidden rounded-2xl border border-border bg-[#0B1220] ${className}`}><div ref={box} className="ss-map" role="img" aria-label="Route planning map" /></div>
}
