import { useEffect, useState } from 'react'

export interface Congestion { total: number; anchored: number }
interface Snapshot { congestion: Record<string, Congestion>; enabled: boolean; live: boolean; at: number }

let cache: Snapshot | null = null
let inflight: Promise<Snapshot | null> | null = null
const TTL = 60_000

async function load(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.at < TTL) return cache
  if (inflight) return inflight
  inflight = fetch('/api/live/region').then((r) => r.json()).then((d) => {
    cache = { congestion: d.congestion ?? {}, enabled: !!d.ais?.enabled, live: d.ais?.status === 'live', at: Date.now() }
    return cache
  }).catch(() => null).finally(() => { inflight = null })
  return inflight
}

/** Per-port vessel counts from the live AIS feed (null until loaded; `enabled` false when no AIS key is configured). */
export function useCongestion() {
  const [snap, setSnap] = useState<Snapshot | null>(cache)
  useEffect(() => { let live = true; load().then((s) => live && s && setSnap(s)); return () => { live = false } }, [])
  return snap
}

/** Plain-language reading of a port's approach, or null when there's nothing worth saying. */
export function congestionLabel(c?: Congestion): { text: string; level: 'clear' | 'busy' | 'heavy' } | null {
  if (!c) return null
  if (c.anchored >= 10) return { text: `${c.anchored} ships waiting at anchor — expect delays`, level: 'heavy' }
  if (c.anchored >= 4) return { text: `${c.anchored} ships waiting at anchor`, level: 'busy' }
  if (c.total > 0) return { text: `${c.total} ship${c.total === 1 ? '' : 's'} in the approach, flowing`, level: 'clear' }
  return null
}
