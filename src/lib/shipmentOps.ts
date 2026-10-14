import { api } from './store'
import type { CargoType, Mode, Shipment, ShipmentStatus } from './data'
import type { ConsigneeInput } from './clients'

export interface Automation {
  status: ShipmentStatus
  next: { to: ShipmentStatus; how: string } | null
  wired: { container: { ref: string; status: string; carrierTracking: boolean; eta: string | null } | null; pickupRun: { status: string; date: string } | null; deliveryRun: { status: string; date: string } | null; pieces: number; vessel: string | null; recipient: boolean }
  missing: string[]
  triggers: { from: ShipmentStatus; to: ShipmentStatus; how: string }[]
}
export interface ShipperPrefs { autoInvoice: boolean; invoiceDueDays: number; autoLabels: boolean; autoTrackingLink: boolean }
export interface FullBooking {
  mode: Mode; origin: string; destination: string; cargo: CargoType; description: string; quantity: number; weightKg?: number; dims: string; declaredValueUsd?: number
  eta: string; readyDate?: string; note: string
  consigneeId?: string; consignee?: Partial<ConsigneeInput> & { name: string }
  pickup?: { date: string; windowStart: string; windowEnd: string; address: string; city: string; contactName: string; contactPhone: string; notes: string }
  vehicle?: { vin: string; year: number | null; make: string; model: string; running: boolean; method: 'roro' | 'container'; titleStatus: 'clean' | 'salvage' | 'rebuilt' | 'lien' }
  price?: { freightUsd: number; pickupUsd: number; deliveryUsd: number; insuranceUsd: number; otherUsd: number; otherLabel: string; taxUsd: number; dueDays: number; createInvoice: boolean; sendInvoice: boolean }
  labels: boolean; sendTracking: boolean
}

export const shipmentOpsApi = {
  setConsignee: (id: string, b: { consigneeId?: string } & Partial<ConsigneeInput>) => api<{ consignee: { id: string; name: string; city: string } }>(`/shipments/${id}/consignee`, { method: 'PUT', json: b }).then((r) => r.consignee),
  revert: (id: string, reason: string) => api<{ shipment: Shipment }>(`/shipments/${id}/revert`, { json: { reason } }).then((r) => r.shipment),
  remove: (id: string, reason: string) => api<{ ok: true; reopenedRequest: boolean }>(`/shipments/${id}`, { method: 'DELETE', json: { reason } }),
  automation: (id: string) => api<Automation>(`/shipments/${id}/automation`),
  book: (clientId: string, b: FullBooking) => api<{ shipment: Shipment; invoice: { id: string; number: string; total: number; sent: string[] } | null; pickupId: string | null; did: string[] }>(`/clients/${clientId}/shipments/full`, { json: b }),
  prefs: () => api<{ prefs: ShipperPrefs }>('/shipper/prefs').then((r) => r.prefs),
  savePrefs: (p: Partial<ShipperPrefs>) => api<{ prefs: ShipperPrefs }>('/shipper/prefs', { method: 'PUT', json: p }).then((r) => r.prefs),
}
