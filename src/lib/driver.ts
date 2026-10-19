import { useEffect, useState } from 'react'
import { opsApi, type Run, type RunStop } from './ops'
import { SCAN_QUEUE_EVENT, scanQueue } from './scan'

/* ---------------- today's runs, kept on the phone ----------------
 * A driver loses signal in yards and on rural roads. The last copy of their runs stays in localStorage so the
 * screen still works; stop updates made offline go through the scan queue and are applied to the cached copy. */
const CACHE = 'ss-driver-runs'
export const cachedRuns = (): Run[] | null => { try { return JSON.parse(localStorage.getItem(CACHE) || 'null') } catch { return null } }
const saveRuns = (r: Run[]) => { try { localStorage.setItem(CACHE, JSON.stringify(r)) } catch { /* storage full or blocked */ } }

/** My runs: live when online, the saved copy when not. `offline` says which one you're looking at. */
export function useMyRuns() {
  const [runs, setRuns] = useState<Run[] | null>(() => cachedRuns())
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    try { const r = await opsApi.myRuns(); setRuns(r); saveRuns(r); setOffline(false); setError('') }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); if (/failed to fetch|network|load failed/i.test(msg) || navigator.onLine === false) setOffline(true); else setError(msg) }
  }
  useEffect(() => {
    void load()
    const on = () => void load()
    window.addEventListener('online', on); document.addEventListener('visibilitychange', on)
    return () => { window.removeEventListener('online', on); document.removeEventListener('visibilitychange', on) }
  }, [])
  /** Apply a stop change locally (used when it was queued for later). */
  const patchLocal = (runId: string, stopId: string, p: Partial<RunStop>) => setRuns((rs) => { const next = (rs ?? []).map((r) => (r.id !== runId ? r : { ...r, stops: r.stops.map((s) => (s.id === stopId ? { ...s, ...p } : s)) })); saveRuns(next); return next })
  const setRun = (run: Run) => setRuns((rs) => { const next = (rs ?? []).some((r) => r.id === run.id) ? (rs ?? []).map((r) => (r.id === run.id ? run : r)) : [...(rs ?? []), run]; saveRuns(next); return next })
  return { runs, offline, error, reload: load, patchLocal, setRun }
}

/** Whether the phone has signal right now (browser's view). */
export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); window.addEventListener('online', a); window.addEventListener('offline', b); return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b) } }, [])
  return on
}
/** How many stop updates and scans are waiting for signal. */
export function useQueued() {
  const [n, setN] = useState(() => scanQueue.list().length)
  useEffect(() => { const on = () => setN(scanQueue.list().length); window.addEventListener(SCAN_QUEUE_EVENT, on); return () => window.removeEventListener(SCAN_QUEUE_EVENT, on) }, [])
  return n
}

/** Keep the screen on while a run is in progress (Screen Wake Lock; silently does nothing where unsupported). */
export function useWakeLock(on: boolean) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!on) return
    type Lock = { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void }
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock
    if (!wl) return
    let lock: Lock | null = null; let live = true
    const get = () => { if (document.visibilityState !== 'visible') return; wl.request('screen').then((l) => { if (!live) { void l.release(); return } lock = l; setHeld(true); l.addEventListener('release', () => setHeld(false)) }).catch(() => setHeld(false)) }
    get(); document.addEventListener('visibilitychange', get)
    return () => { live = false; document.removeEventListener('visibilitychange', get); void lock?.release(); setHeld(false) }
  }, [on])
  return held
}

/** Google Maps directions through every remaining stop, in order (mobile allows 9 waypoints after the first leg). */
export function routeLink(stops: RunStop[]) {
  const where = (s: RunStop) => (s.lat != null && s.lon != null ? `${s.lat},${s.lon}` : s.address)
  const list = stops.filter((s) => s.lat != null || s.address).slice(0, 10)
  if (!list.length) return null
  const dest = list[list.length - 1]; const via = list.slice(0, -1)
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(where(dest))}${via.length ? `&waypoints=${encodeURIComponent(via.map(where).join('|'))}` : ''}`
}
export const stopLink = (s: RunStop) => (s.lat != null ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${s.lat},${s.lon}` : `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(s.address)}`)
export const telLink = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`
export const waLink = (p: string, text = '') => `https://wa.me/${p.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`

/** The people a driver calls: dispatchers first, then owners, then the office line. Cached for offline. */
export function useDispatch() {
  const [d, setD] = useState<Awaited<ReturnType<typeof opsApi.dispatch>> | null>(() => { try { return JSON.parse(localStorage.getItem('ss-dispatch') || 'null') } catch { return null } })
  useEffect(() => { opsApi.dispatch().then((x) => { setD(x); try { localStorage.setItem('ss-dispatch', JSON.stringify(x)) } catch { /* ignore */ } }).catch(() => {}) }, [])
  const first = d?.people.find((p) => p.phone) ?? null
  const phone = first?.phone || d?.office.phone || ''
  return { dispatch: d, phone, who: first?.name ?? d?.office.name ?? '' }
}

/* ---------------- a PIN on this phone ---------------- */
const PIN_KEY = 'ss-device-pin'
export interface DevicePin { id: string; secret: string; name: string; email: string }
export const devicePin = (): DevicePin | null => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null') } catch { return null } }
export const saveDevicePin = (p: DevicePin | null) => { try { if (p) localStorage.setItem(PIN_KEY, JSON.stringify(p)); else localStorage.removeItem(PIN_KEY) } catch { /* ignore */ } }

/* ---------------- end of the day ---------------- */
export function daySummary(runs: Run[]) {
  const stops = runs.flatMap((r) => r.stops)
  const done = stops.filter((s) => s.status === 'done'); const skipped = stops.filter((s) => s.status === 'skipped'); const left = stops.filter((s) => s.status === 'pending')
  const pieces = done.reduce((n, s) => n + (s.pod?.pieces ?? 0), 0)
  const cash = stops.reduce((n, s) => n + (s.collected?.method === 'cash' ? s.collected.amountUsd : 0), 0)
  const momo = stops.reduce((n, s) => n + (s.collected?.method === 'mobile_money' ? s.collected.amountUsd : 0), 0)
  return { done: done.length, skipped: skipped.length, left: left.length, pieces, cash, momo, skippedList: skipped }
}
