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
export interface ShipperPrefs {
  autoInvoice: boolean; invoiceDueDays: number; autoLabels: boolean; autoTrackingLink: boolean
  defaultHandover: 'delivery' | 'collection'; holdUnpaid: 'off' | 'warn' | 'block'; doorDeliveryUsd: number; autoConfirmPickups: boolean
  recipientNudges: boolean; collectionNote: string; autoDocuments: boolean; stuckAlerts: boolean
}
export interface ReleaseInfo { invoiceUsd: number; storageUsd: number; totalUsd: number; rule: ShipperPrefs['holdUnpaid']; storage: { days: number; amountUsd: number; freeUntil: string | null; rateUsd?: number } | null; collection: { attempts: number; locked: boolean; readyAt: string | null } | null }
export interface StuckRow { id: string; ref: string; customer: string; status: string; statusLabel: string; days: number; typical: number }
export interface LaneTimes { lanes: { mode: string; destination: string; shipments: number; medianDays: number; onTimeRate: number }[]; overall: { shipments: number; onTimeRate: number | null } }
export interface PartnerLink { id: string; name: string; email: string; phone: string; url: string; path: string; createdAt: string; lastSeenAt: string | null; preAlertSentAt: string | null; revoked: boolean }
export interface ManifestRow { id: string; ref: string; status: ShipmentStatus; handover: 'delivery' | 'collection'; description: string; cargo: string; pieces: number | null; piecesUnloaded: number; weightKg: number | null; declaredValueUsd: number | null; sender: string; senderPhone: string; recipient: { name: string; phone: string; address: string; city: string } | null; owedUsd?: number; paymentDue?: boolean; readyAt: string | null }
export interface Manifest { container: { id: string; ref: string; number: string; seal: string; size: string; line: string; vesselName: string; voyage: string; originPort: string; destinationPort: string; destination: string; etd: string | null; eta: string | null; status: string }; shipments: ManifestRow[]; totals: { shipments: number; pieces: number; weightKg: number | null }; shipper?: string }
export interface PartnerView extends Omit<Manifest, 'shipper'> { partner: { name: string }; shipper: { name: string }; holdUnpaid: ShipperPrefs['holdUnpaid'] }
export interface Offer { kind: 'door_delivery' | 'duty_prepay'; title: string; body: string; amountUsd: number; local?: { amount: number; currency: string } }
export interface RecipientForm { ref: string; shipper: string; sender: string; origin: string; destination: string; destinationName: string; description: string; status: string; done: boolean; recipient: { name: string; city: string } | null }
type Override = { reason: string } | null
export interface FullBooking {
  mode: Mode; origin: string; destination: string; cargo: CargoType; description: string; quantity: number; weightKg?: number; dims: string; declaredValueUsd?: number
  eta: string; readyDate?: string; note: string
  consigneeId?: string; consignee?: Partial<ConsigneeInput> & { name: string }
  pickup?: { date: string; windowStart: string; windowEnd: string; address: string; city: string; contactName: string; contactPhone: string; notes: string }
  vehicle?: { vin: string; year: number | null; make: string; model: string; running: boolean; method: 'roro' | 'container'; titleStatus: 'clean' | 'salvage' | 'rebuilt' | 'lien' }
  price?: { freightUsd: number; pickupUsd: number; deliveryUsd: number; insuranceUsd: number; otherUsd: number; otherLabel: string; taxUsd: number; dueDays: number; createInvoice: boolean; sendInvoice: boolean }
  labels: boolean; sendTracking: boolean; handover?: 'delivery' | 'collection'
}

export const shipmentOpsApi = {
  setConsignee: (id: string, b: { consigneeId?: string } & Partial<ConsigneeInput>) => api<{ consignee: { id: string; name: string; city: string } }>(`/shipments/${id}/consignee`, { method: 'PUT', json: b }).then((r) => r.consignee),
  revert: (id: string, reason: string) => api<{ shipment: Shipment }>(`/shipments/${id}/revert`, { json: { reason } }).then((r) => r.shipment),
  remove: (id: string, reason: string) => api<{ ok: true; reopenedRequest: boolean }>(`/shipments/${id}`, { method: 'DELETE', json: { reason } }),
  automation: (id: string) => api<Automation>(`/shipments/${id}/automation`),
  book: (clientId: string, b: FullBooking) => api<{ shipment: Shipment; invoice: { id: string; number: string; total: number; sent: string[] } | null; pickupId: string | null; did: string[] }>(`/clients/${clientId}/shipments/full`, { json: b }),
  advance: (id: string, o: { note?: string; override?: Override } = {}) => api<{ shipment: Shipment }>(`/shipments/${id}/advance`, { json: o }).then((r) => r.shipment),
  handover: (id: string, handover: 'delivery' | 'collection') => api<{ shipment: Shipment }>(`/shipments/${id}/handover`, { method: 'PUT', json: { handover } }).then((r) => r.shipment),
  collect: (id: string, b: { code?: string; receivedBy: string; override?: Override }) => api<{ shipment: Shipment }>(`/shipments/${id}/collect`, { json: b }).then((r) => r.shipment),
  resendCode: (id: string) => api<{ sent: string; to: string | null }>(`/shipments/${id}/collection-code/resend`, { json: {} }),
  checkin: (id: string, b: { pieces: number; weightKg?: number; note?: string; adjustment?: { description: string; amountUsd: number } }) => api<{ shipment: Shipment; pieces: number; invoice: string | null }>(`/shipments/${id}/checkin`, { json: b }),
  charge: (id: string, b: { description: string; amountUsd: number }) => api<{ invoice: string }>(`/shipments/${id}/charges`, { json: b }),
  cancel: (id: string, b: { reason: string; refund: boolean }) => api<{ voided: number; refunded: number; paidInvoices: string[] }>(`/shipments/${id}/cancel`, { json: b }),
  release: (id: string) => api<ReleaseInfo>(`/shipments/${id}/release`),
  stuck: () => api<{ stuck: StuckRow[] }>('/shipper/stuck').then((r) => r.stuck),
  laneTimes: () => api<LaneTimes>('/shipper/lane-times'),
  manifest: (containerId: string) => api<Manifest>(`/containers/${containerId}/manifest`),
  partners: (containerId: string) => api<{ partners: PartnerLink[] }>(`/containers/${containerId}/partners`).then((r) => r.partners),
  addPartner: (containerId: string, b: { name: string; email: string; phone: string }) => api<{ partner: PartnerLink }>(`/containers/${containerId}/partners`, { json: b }).then((r) => r.partner),
  revokePartner: (id: string) => api<{ ok: true }>(`/partners/${id}`, { method: 'DELETE' }),
  preAlert: (id: string) => api<{ sent: number }>(`/partners/${id}/pre-alert`, { json: {} }),
  offers: (id: string) => api<{ offers: Offer[] }>(`/me/shipments/${id}/offers`).then((r) => r.offers),
  acceptOffer: (id: string, kind: Offer['kind']) => api<{ invoice: string | null; shipment: Shipment }>(`/me/shipments/${id}/offers/${kind}`, { json: {} }),
  recipientForm: (token: string) => api<RecipientForm>(`/add-recipient/${token}`),
  submitRecipient: (token: string, b: { name: string; phone: string; address: string; city: string; country: string; relationship: string }) => api<{ ok: true }>(`/add-recipient/${token}`, { json: b }),
  partnerView: (token: string) => api<PartnerView>(`/p/${token}`),
  partnerStage: (token: string, stage: 'arrived' | 'customs' | 'devanned', note = '') => api<Manifest>(`/p/${token}/container`, { json: { stage, note } }),
  partnerHandover: (token: string, sid: string, b: { code?: string; receivedBy: string }) => api<{ ok: true }>(`/p/${token}/shipments/${sid}/handover`, { json: b }),
  partnerNote: (token: string, sid: string, note: string) => api<{ ok: true }>(`/p/${token}/shipments/${sid}/note`, { json: { note } }),
  prefs: () => api<{ prefs: ShipperPrefs }>('/shipper/prefs').then((r) => r.prefs),
  savePrefs: (p: Partial<ShipperPrefs>) => api<{ prefs: ShipperPrefs }>('/shipper/prefs', { method: 'PUT', json: p }).then((r) => r.prefs),
}
