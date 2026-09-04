import * as maplibregl from 'maplibre-gl'

/**
 * MapLibre 6 spawns its tile-parsing Web Worker from a file resolved relative to its own module URL.
 * Vite moves that module (pre-bundling in dev, hashing in prod), so the default resolution 404s and the
 * map silently never loads tiles. We serve the worker + its shared chunk from public/vendor/maplibre
 * (copied on `npm install` via the vendor:maplibre script) and point MapLibre at that stable path.
 */
let done = false
export function setupMapLibre() {
  if (done) return
  done = true
  maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs')
}
