import { api } from './store'

export type GroupageKind = 'barrel' | 'container20' | 'container40'
export interface GroupageKindInfo { id: GroupageKind; label: string; unit: string; unitPlural: string; defaultCapacity: number; cargo: string; hint: string }
export interface Groupage {
  id: string; shipperId: string; shipperName?: string; shipperHue?: string; shipperInitials?: string; shipperVerified?: boolean
  kind: GroupageKind; kindLabel: string; unit: string; unitPlural: string; title: string; origin: string; destination: string; destinationName: string; destinationCity: string
  capacity: number; reserved: number; left: number; fillPct: number; participants: number; pricePerUnitUsd: number; minUnits: number; maxUnits: number | null; includes: string[]
  closesAt: string | null; departsAt: string | null; transitDays: number; status: 'open' | 'full' | 'closed' | 'cancelled'; notes: string; containerId: string | null; createdAt: string | null; closedAt: string | null
}
export interface Spot {
  id: string; groupageId: string; userId: string | null; name: string; email: string; phone: string; units: number; description: string; pickup: boolean; status: 'reserved' | 'booked' | 'cancelled'
  amountUsd: number; shipmentId: string | null; shipmentRef: string | null; shipmentStatus: string | null; createdAt: string | null
  groupage?: { title: string; kind: GroupageKind; origin: string; destination: string; closesAt: string | null; departsAt: string | null; status: Groupage['status']; shipperName: string; fillPct: number }
}
export interface GroupageInput { kind: GroupageKind; title: string; origin: string; destination: string; destinationCity: string; capacity: number; pricePerUnitUsd: number; minUnits: number; maxUnits: number | null; includes: string[]; closesAt: string; departsAt: string; transitDays: number; notes: string }
export const groupageStatusLabels: Record<Groupage['status'], string> = { open: 'Open', full: 'Full', closed: 'Booked', cancelled: 'Cancelled' }
export const unitsLabel = (g: Pick<Groupage, 'unit' | 'unitPlural'>, n: number) => `${n} ${n === 1 ? g.unit : g.unitPlural}`

export const groupageApi = {
  list: (q: { destination?: string; origin?: string; kind?: string } = {}) => { const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]); return api<{ groupages: Groupage[]; kinds: GroupageKindInfo[] }>(`/groupage${p.toString() ? `?${p}` : ''}`) },
  get: (id: string) => api<{ groupage: Groupage; mySpots: Spot[] }>(`/groupage/${id}`),
  join: (id: string, b: { units: number; description: string; phone: string; pickup: boolean }) => api<{ spot: Spot; groupage: Groupage }>(`/groupage/${id}/join`, { json: b }),
  mine: () => api<{ spots: Spot[] }>('/groupage/spots/mine').then((r) => r.spots),
  cancelSpot: (id: string) => api<{ ok: true }>(`/groupage/spots/${id}/cancel`, { json: {} }),
  manage: () => api<{ groupages: (Groupage & { spots: Spot[] })[]; kinds: GroupageKindInfo[] }>('/groupage/manage/list'),
  create: (b: GroupageInput) => api<{ groupage: Groupage }>('/groupage', { json: b }).then((r) => r.groupage),
  update: (id: string, b: Partial<GroupageInput>) => api<{ groupage: Groupage }>(`/groupage/${id}`, { method: 'PATCH', json: b }).then((r) => r.groupage),
  close: (id: string) => api<{ groupage: Groupage; shipmentIds: string[] }>(`/groupage/${id}/close`, { json: {} }),
  cancel: (id: string, reason: string) => api<{ groupage: Groupage }>(`/groupage/${id}/cancel`, { json: { reason } }).then((r) => r.groupage),
}
