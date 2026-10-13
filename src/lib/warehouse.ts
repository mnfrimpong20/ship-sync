import { api } from './store'

export interface Site { id: string; shipperId: string; name: string; kind: 'origin' | 'destination'; address: string; city: string; country: string; freeDays: number; rateUsd: number; vehicleRateUsd: number; hours: string; active: boolean; onHand: number; bins: number }
export interface Bin { id: string; siteId: string; code: string; zone: string; capacity: number; note: string; count: number; shipments: number }
export interface StockItem { siteId: string; siteName: string; shipmentId: string; ref: string; customer: string; cargo: string; status: string; clientId: string | null; pieces: { id: string; seq: number; labelCode: string; binId: string | null; bin: string | null; zone: string | null; receivedAt: string | null }[]; receivedAt: string | null; daysInStorage: number; freeDays: number; billableDays: number; rateUsd: number; amountUsd: number }
export interface StockMove { id: string; siteId: string; shipmentRef: string; kind: 'receive' | 'move' | 'release'; bin: string | null; at: string | null; by: string; note: string }
export type SiteInput = Omit<Site, 'id' | 'shipperId' | 'onHand' | 'bins'>
export const warehouseApi = {
  get: () => api<{ sites: Site[]; bins: Bin[]; stock: StockItem[]; moves: StockMove[]; canManage: boolean; totals: { onHand: number; shipments: number; overdue: number; storageDue: number } }>('/warehouse'),
  createSite: (s: SiteInput) => api<{ site: Site }>('/warehouse/sites', { json: s }).then((r) => r.site),
  updateSite: (id: string, s: Partial<SiteInput>) => api<{ site: Site }>(`/warehouse/sites/${id}`, { method: 'PATCH', json: s }).then((r) => r.site),
  addBins: (siteId: string, b: { zone: string; from: number; to: number; capacity: number }) => api<{ bins: Bin[] }>(`/warehouse/sites/${siteId}/bins`, { json: b }).then((r) => r.bins),
  deleteBin: (id: string) => api<{ ok: true }>(`/warehouse/bins/${id}`, { method: 'DELETE' }),
  receive: (b: { siteId: string; binId?: string; code?: string; shipmentId?: string; note?: string }) => api<{ received: number; moved: number; shipment: { id: string; ref: string }; bin: Bin | null }>('/warehouse/receive', { json: b }),
  move: (pieceIds: string[], binId: string | null) => api<{ moved: number }>('/warehouse/move', { json: { pieceIds, binId } }),
  release: (b: { shipmentId?: string; pieceIds?: string[]; note?: string }) => api<{ released: number; charge: { billableDays: number; amountUsd: number } }>('/warehouse/release', { json: b }),
  invoiceStorage: (shipmentId: string) => api<{ invoiceId: string; line: { description: string; qty: number; unit: number } }>('/warehouse/charges/invoice', { json: { shipmentId } }),
}
