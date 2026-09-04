/** Coordinates for the origins and destinations Ship Sync serves. [lon, lat] as GeoJSON expects. */
export type LngLat = [number, number]

export const originCoords: Record<string, LngLat> = {
  'New York, NY': [-74.006, 40.7128], 'Newark, NJ': [-74.1724, 40.7357], 'Houston, TX': [-95.3698, 29.7604], 'Atlanta, GA': [-84.388, 33.749],
  'Chicago, IL': [-87.6298, 41.8781], 'Minneapolis, MN': [-93.265, 44.9778], 'Philadelphia, PA': [-75.1652, 39.9526], 'Providence, RI': [-71.4128, 41.824],
  'Los Angeles, CA': [-118.2437, 34.0522], 'Baltimore, MD': [-76.6122, 39.2904], 'London, UK': [-0.1276, 51.5072], 'Manchester, UK': [-2.2426, 53.4808],
  'Toronto, CA': [-79.3832, 43.6532], 'Hamburg, DE': [9.9937, 53.5511], 'Rotterdam, NL': [4.4777, 51.9244], 'Paris, FR': [2.3522, 48.8566],
  'Dubai, AE': [55.2708, 25.2048], 'Guangzhou, CN': [113.2644, 23.1291], 'Shanghai, CN': [121.4737, 31.2304],
}

/** Main seaport and airport per destination country, plus a bounding box of the port approach used for congestion counts. */
export const destGeo: Record<string, { port: { name: string; at: LngLat }; airport: { name: string; at: LngLat }; approach: [LngLat, LngLat] }> = {
  GH: { port: { name: 'Port of Tema', at: [0.0166, 5.6265] }, airport: { name: 'Accra (ACC)', at: [-0.1719, 5.6052] }, approach: [[-0.35, 5.35], [0.35, 5.75]] },
  NG: { port: { name: 'Lagos (Apapa)', at: [3.3592, 6.4396] }, airport: { name: 'Lagos (LOS)', at: [3.3212, 6.5774] }, approach: [[3.0, 6.05], [3.75, 6.5]] },
  LR: { port: { name: 'Freeport of Monrovia', at: [-10.8015, 6.3494] }, airport: { name: 'Monrovia (ROB)', at: [-10.3623, 6.2337] }, approach: [[-11.15, 6.05], [-10.65, 6.5]] },
  TG: { port: { name: 'Port of Lomé', at: [1.2833, 6.1333] }, airport: { name: 'Lomé (LFW)', at: [1.2545, 6.1656] }, approach: [[1.0, 5.85], [1.55, 6.2]] },
  CI: { port: { name: 'Port of Abidjan', at: [-4.0083, 5.2833] }, airport: { name: 'Abidjan (ABJ)', at: [-3.9263, 5.2614] }, approach: [[-4.3, 5.0], [-3.7, 5.35]] },
  SL: { port: { name: 'Freetown (QEII Quay)', at: [-13.2167, 8.4833] }, airport: { name: 'Freetown (FNA)', at: [-13.1955, 8.6164] }, approach: [[-13.55, 8.25], [-13.05, 8.65]] },
  SN: { port: { name: 'Port of Dakar', at: [-17.4283, 14.6837] }, airport: { name: 'Dakar (DSS)', at: [-17.0733, 14.67] }, approach: [[-17.75, 14.45], [-17.3, 14.85]] },
}

const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** Points along the great-circle between two coordinates (inclusive). */
export function greatCircle(a: LngLat, b: LngLat, n = 64): LngLat[] {
  const [lon1, lat1] = a.map(toRad), [lon2, lat2] = b.map(toRad)
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2))
  if (d === 0) return [a, b]
  const pts: LngLat[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
    const z = A * Math.sin(lat1) + B * Math.sin(lat2)
    pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))])
  }
  return pts
}

/** Position at fraction f (0..1) along the great-circle path. */
export function alongGreatCircle(a: LngLat, b: LngLat, f: number): LngLat {
  const pts = greatCircle(a, b, 200)
  return pts[Math.max(0, Math.min(pts.length - 1, Math.round(f * (pts.length - 1))))]
}

export function distanceKm(a: LngLat, b: LngLat) {
  const [lon1, lat1] = a.map(toRad), [lon2, lat2] = b.map(toRad)
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export function inBox(p: LngLat, box: [LngLat, LngLat]) {
  return p[0] >= box[0][0] && p[0] <= box[1][0] && p[1] >= box[0][1] && p[1] <= box[1][1]
}
