import { api } from './store'

export type Unit = 'container20' | 'container40' | 'container40hc' | 'roro_car' | 'roro_suv' | 'roro_truck'
export interface Sailing { id: string; line: string; service: string; kind: 'container' | 'roro'; vesselName: string; voyage: string; originPort: string; originCity: string; destinationPort: string; destination: string; etd: string | null; eta: string | null; cutoff: string | null; transitDays: number; rates: Partial<Record<Unit, number>>; spaceLeft: number; status: 'open' | 'closed' | 'sailed'; source: string; notes: string }
export interface Booking {
  id: string; shipperId: string; sailingId: string; sailing?: { line: string; vesselName: string; voyage: string; originPort: string; destinationPort: string; etd: string | null; eta: string | null; cutoff: string | null; kind: 'container' | 'roro' }
  unit: Unit; unitLabel: string; quantity: number; rateUsd: number; totalUsd: number; status: 'requested' | 'confirmed' | 'rejected' | 'cancelled'; bookingRef: string; containerId: string | null; containerRef: string | null; shipmentId: string | null; shipmentRef: string | null; note: string; carrierNote: string; requestedBy: string; createdAt: string | null; confirmedAt: string | null
}
export const unitLabels: Record<Unit, string> = { container20: '20 ft dry', container40: '40 ft dry', container40hc: '40 ft high-cube', roro_car: 'RoRo — car / sedan', roro_suv: 'RoRo — SUV / pickup', roro_truck: 'RoRo — truck / bus' }
export const bookingApi = {
  sailings: (q: { destination?: string; origin?: string; kind?: string } = {}) => { const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]); return api<{ sailings: Sailing[]; units: { id: Unit; label: string }[]; provider: string }>(`/sailings${p.toString() ? `?${p}` : ''}`) },
  list: () => api<{ bookings: Booking[] }>('/bookings').then((r) => r.bookings),
  book: (b: { sailingId: string; unit: Unit; quantity: number; containerId?: string; shipmentId?: string; newContainer?: boolean; note?: string }) => api<{ booking: Booking; container: { id: string; ref: string } | null }>('/bookings', { json: b }),
  cancel: (id: string) => api<{ booking: Booking }>(`/bookings/${id}/cancel`, { json: {} }).then((r) => r.booking),
}
