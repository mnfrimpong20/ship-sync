import { api } from './store'

export interface PickupWindow { id?: string; weekday: number; start: string; end: string; area: string; capacity: number; active: boolean }
export interface PickupSlot { date: string; weekday: string; start: string; end: string; label: string; left: number }
export type PickupStatus = 'requested' | 'confirmed' | 'cancelled' | 'done'
export interface Pickup {
  id: string; shipmentId: string; shipmentRef?: string; customer?: string; date: string; windowStart: string; windowEnd: string; windowLabel: string
  address: string; city: string; contactName: string; contactPhone: string; notes: string; status: PickupStatus; runId: string | null; stopId: string | null; byRole: string; note: string; createdAt: string | null; updatedAt: string | null
}
export interface PickupBooking { date: string; windowStart: string; windowEnd: string; address: string; city: string; contactName: string; contactPhone: string; notes: string }

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const pickupStatusLabels: Record<PickupStatus, string> = { requested: 'Awaiting confirmation', confirmed: 'Confirmed', cancelled: 'Cancelled', done: 'Collected' }

export const pickupsApi = {
  availability: () => api<{ leadDays: number; windows: PickupWindow[]; origins: string[]; canEdit: boolean }>('/pickups/availability'),
  saveAvailability: (leadDays: number, windows: PickupWindow[]) => api<{ leadDays: number; windows: PickupWindow[] }>('/pickups/availability', { method: 'PUT', json: { leadDays, windows: windows.map(({ id: _id, ...w }) => w) } }),
  forShipment: (shipmentId: string) => api<{ pickup: Pickup | null; slots: PickupSlot[]; leadDays: number; offersPickup: boolean; canManage: boolean; history: Pickup[] }>(`/shipments/${shipmentId}/pickup`),
  book: (shipmentId: string, b: PickupBooking) => api<{ pickup: Pickup }>(`/shipments/${shipmentId}/pickup`, { json: b }).then((r) => r.pickup),
  confirm: (id: string, runId?: string | null) => api<{ pickup: Pickup }>(`/pickups/${id}/confirm`, { json: { runId: runId ?? null } }).then((r) => r.pickup),
  reschedule: (id: string, b: { date: string; windowStart: string; windowEnd: string; note?: string }) => api<{ pickup: Pickup }>(`/pickups/${id}/reschedule`, { json: b }).then((r) => r.pickup),
  cancel: (id: string, note = '') => api<{ pickup: Pickup }>(`/pickups/${id}/cancel`, { json: { note } }).then((r) => r.pickup),
  list: () => api<{ pickups: Pickup[]; runs: { id: string; name: string; date: string; status: string }[] }>('/pickups'),
}

export const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
