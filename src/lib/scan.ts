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
export interface ScanInput { code: string; kind: ScanKind; containerId?: string; runId?: string; place?: string; note?: string; lat?: number; lon?: number; photo?: string; receivedBy?: string }

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
