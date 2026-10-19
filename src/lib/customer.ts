import type { Handover } from './data'
import { api } from './store'

export interface Consignee { id: string; name: string; phone: string; address: string; city: string; country: string; relationship: string; gps: string; lat: number | null; lng: number | null; isDefault: boolean; lastUsedAt: string | null; createdAt: string }
export type ConsigneeInput = { name: string; phone?: string; address?: string; city?: string; country?: string; relationship?: string; isDefault?: boolean; gps?: string; lat?: number | null; lng?: number | null }
export interface AttentionItem { kind: 'quote' | 'duty' | 'recipient' | 'invoice' | 'sourcing' | 'review'; severity: 'critical' | 'warning' | 'info'; title: string; body: string; to: string; at?: string }
export interface NextArrival { id: string; ref: string; status: string; stepIndex: number; steps: number; handover?: Handover; origin: string; destination: string; destinationName: string; eta: string; daysToEta: number; mode: 'air' | 'ocean'; vessel: string | null; flight: string | null; shipper: string; cargo: string; description: string; lastEvent: { status: string; at: string; place: string } | null; recipient: { name: string; city: string; phone: string } | null; receiverPath: string | null }

export const customerApi = {
  attention: () => api<{ items: AttentionItem[]; nextArrival: NextArrival | null; activeCount: number }>('/me/attention'),
  consignees: () => api<{ consignees: Consignee[] }>('/me/consignees').then((r) => r.consignees),
  addConsignee: (b: ConsigneeInput) => api<{ consignee: Consignee }>('/me/consignees', { json: b }).then((r) => r.consignee),
  updateConsignee: (id: string, b: Partial<ConsigneeInput>) => api<{ consignee: Consignee }>(`/me/consignees/${id}`, { method: 'PUT', json: b }).then((r) => r.consignee),
  removeConsignee: (id: string) => api<{ ok: true }>(`/me/consignees/${id}`, { method: 'DELETE' }),
}
