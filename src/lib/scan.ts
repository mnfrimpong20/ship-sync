import { api } from './store'
import type { ShipmentStatus } from './data'
import type { Piece } from './labels'

export type ScanKind = 'loading' | 'devanning' | 'delivery' | 'check'
export const scanKindLabels: Record<ScanKind, string> = { loading: 'Loading into container', devanning: 'Devanning at warehouse', delivery: 'Delivery to receiver', check: 'Check only' }
export const scanKindShort: Record<ScanKind, string> = { loading: 'Load', devanning: 'Devan', delivery: 'Deliver', check: 'Check' }
export interface ScanSummary {
  shipment: { id: string; ref: string; status: ShipmentStatus; mode: string; origin: string; destination: string; cargo: string; description: string; customer: string }
  container: { id: string; ref: string; number: string; seal: string; status: string; originPort: string; destinationPort: string } | null
  consignee: { name: string; phone: string; address: string; city: string; country: string } | null
  pieces: Piece[]; counts: { total: number; loaded: number; devanned: number; delivered: number }
}
export interface Lookup extends ScanSummary { piece: Piece; suggested: ScanKind }
export interface ScanResult extends ScanSummary { ok: true; scanId: string; piece: Piece; moved: ShipmentStatus | null; warnings: string[]; place: string; at: string }
export interface RecentScan { id: string; kind: ScanKind; at: string; place: string; note: string; by: string; seq: number; total: number; labelCode: string; ref: string; shipmentId: string }
export interface ScanInput { code: string; kind: ScanKind; containerId?: string; runId?: string; place?: string; note?: string; lat?: number; lon?: number; photo?: string; receivedBy?: string; signature?: string; at?: string }

export const scanApi = {
  lookup: (code: string) => api<Lookup>(`/scan/lookup?code=${encodeURIComponent(code)}`),
  scan: (b: ScanInput) => api<ScanResult>('/scan', { json: b }),
  recent: () => api<{ scans: RecentScan[] }>('/scans/recent').then((r) => r.scans),
}

/** Shrink a camera photo to a small JPEG data URL so proof-of-delivery stays under a few hundred KB. */
export async function shrinkPhoto(file: File, max = 1100, quality = 0.72): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } finally { URL.revokeObjectURL(url) }
}

/* ---------------- offline queue ----------------
 * A driver in a yard with no signal still scans; failed submissions wait in localStorage and go up
 * when the phone is back online (or on the next visit). The original scan time travels with them. */
const QUEUE_KEY = 'ss-scan-queue'
/** What a driver sends when closing a stop: status, note, proof and money taken at the door. */
export interface StopPatch { status?: 'done' | 'skipped' | 'pending'; note?: string; receivedBy?: string; photo?: string; signature?: string; pieces?: number; skipReason?: 'not_home' | 'wrong_address' | 'refused' | 'no_access' | 'other'; retry?: boolean; collected?: { method: 'cash' | 'mobile_money'; amountUsd: number } }
export interface QueuedScan { id: string; input: ScanInput; at: string; tries: number; error?: string; stop?: { runId: string; stopId: string; patch: StopPatch } }
export const SCAN_QUEUE_EVENT = 'ss:scan-queue'
const readQueue = (): QueuedScan[] => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] } }
const writeQueue = (q: QueuedScan[]) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* storage blocked */ } window.dispatchEvent(new Event(SCAN_QUEUE_EVENT)) }
export const scanQueue = {
  list: readQueue,
  add(input: ScanInput) { const q = readQueue(); const item: QueuedScan = { id: Math.random().toString(36).slice(2, 10), input: { ...input, at: input.at ?? new Date().toISOString() }, at: new Date().toISOString(), tries: 0 }; q.push(item); writeQueue(q); return item },
  remove(id: string) { writeQueue(readQueue().filter((x) => x.id !== id)) },
  clear() { writeQueue([]) },
  /** Try every queued scan in order; stops at the first network failure so order is preserved. Returns how many went up. */
  async flush(): Promise<{ sent: number; left: number }> {
    let sent = 0
    for (const item of readQueue()) {
      try { if (item.stop) await api(`/runs/${item.stop.runId}/stops/${item.stop.stopId}`, { method: 'PATCH', json: item.stop.patch }); else await scanApi.scan(item.input); this.remove(item.id); sent++ } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const q = readQueue(); const it = q.find((x) => x.id === item.id)
        if (it) { it.tries++; it.error = msg }
        // A server rejection (4xx) will never succeed — drop it after a few tries so the queue doesn't jam.
        if (it && /\(4\d\d\)|not found|no labels|not one of your|already|cannot|only/i.test(msg) && it.tries >= 2) { writeQueue(q.filter((x) => x.id !== item.id)); continue }
        writeQueue(q); break
      }
    }
    return { sent, left: readQueue().length }
  },
}
/** Submit now if we can, otherwise queue. Network errors (fetch failed, offline) queue; server errors throw. */
export async function scanOrQueue(input: ScanInput): Promise<{ queued: true; item: QueuedScan } | { queued: false; result: ScanResult }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { queued: true, item: scanQueue.add(input) }
  try { return { queued: false, result: await scanApi.scan(input) } } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return { queued: true, item: scanQueue.add(input) }
    throw e
  }
}
/** Mark a run stop done/skipped now if we can, otherwise queue it with the same offline rules as scans. */
export async function stopOrQueue(runId: string, stopId: string, patch: StopPatch): Promise<{ queued: boolean }> {
  const add = () => { const q = readQueue(); q.push({ id: Math.random().toString(36).slice(2, 10), input: { code: `stop:${stopId}`, kind: 'delivery' }, at: new Date().toISOString(), tries: 0, stop: { runId, stopId, patch } }); writeQueue(q); return { queued: true as const } }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return add()
  try { await api(`/runs/${runId}/stops/${stopId}`, { method: 'PATCH', json: patch }); return { queued: false } } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return add()
    throw e
  }
}
let flushing = false
export function startQueueSync() {
  const run = () => { if (flushing || !readQueue().length) return; flushing = true; scanQueue.flush().finally(() => { flushing = false }) }
  window.addEventListener('online', run); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run() }); setTimeout(run, 1500); setInterval(run, 60_000)
}
