import { api } from './store'
import type { Shipment, ShipmentStatus } from './data'

export const CONTAINER_STAGES = ['booked', 'loading', 'gated_in', 'sailed', 'arrived', 'customs', 'devanned', 'closed'] as const
export type ContainerStatus = (typeof CONTAINER_STAGES)[number]
export const stageLabels: Record<ContainerStatus, string> = { booked: 'Booked with line', loading: 'Loading', gated_in: 'Gated in at port', sailed: 'Sailed', arrived: 'Arrived', customs: 'Customs', devanned: 'Devanned', closed: 'Closed' }
export const stageBlurb: Record<ContainerStatus, string> = {
  booked: 'You have a booking with the shipping line. Start loading orders.',
  loading: 'Orders are being loaded at your yard. Loaded orders show as Picked up.',
  gated_in: 'Container delivered to the port. Orders show as At origin port.',
  sailed: 'On the vessel. Orders show as In transit and inherit the vessel & MMSI for live tracking.',
  arrived: 'Discharged at the destination port. Orders show as Arrived.',
  customs: 'Clearing customs. Orders show as Customs clearance.',
  devanned: 'Unloaded at your destination warehouse. Deliver orders with runs.',
  closed: 'All done — container returned to the line.',
}
export const SIZES = ['20ft', '40ft', '40hc', 'reefer'] as const
export type ContainerSize = (typeof SIZES)[number]
export const sizeLabels: Record<ContainerSize, string> = { '20ft': '20ft standard', '40ft': '40ft standard', '40hc': '40ft high-cube', reefer: '40ft reefer' }
/** Rough planning capacity so the load bar has meaning (cbm). Orders are estimated per cargo type. */
export const sizeCbm: Record<ContainerSize, number> = { '20ft': 33, '40ft': 67, '40hc': 76, reefer: 60 }
export const cargoCbm: Record<string, number> = { barrels: 1.2, boxes: 0.8, pallets: 2.2, vehicle: 14, container20: 33, container40: 67, commercial: 4 }

export interface Container { id: string; ref: string; number: string; size: ContainerSize; line: string; bookingRef: string; seal: string; vesselName: string; mmsi: string; voyage: string; originPort: string; destination: string; destinationPort: string; cutoffDate: string | null; etd: string | null; eta: string | null; status: ContainerStatus; notes: string; createdAt: string; loaded?: number }
export type ContainerInput = Partial<Omit<Container, 'id' | 'ref' | 'status' | 'createdAt' | 'loaded'>>
export interface ContainerEvent { status: ContainerStatus; at: string; place: string; note: string; by: string }
export interface ContainerDetail { container: Container; events: ContainerEvent[]; shipments: (Shipment & { clientName: string | null })[]; cascaded?: number }
export interface Candidate { id: string; ref: string; origin: string; destination: string; cargo: string; description: string; status: ShipmentStatus; customer: string; clientName: string | null; eta: string; sameLane: boolean }

export const isOpen = (s: ContainerStatus) => s !== 'devanned' && s !== 'closed'
export const canLoad = (s: ContainerStatus) => s === 'booked' || s === 'loading' || s === 'gated_in'

export const containersApi = {
  list: () => api<{ containers: Container[] }>('/containers').then((r) => r.containers),
  candidates: (destination?: string) => api<{ candidates: Candidate[] }>(`/containers/candidates${destination ? `?destination=${destination}` : ''}`).then((r) => r.candidates),
  create: (c: ContainerInput) => api<ContainerDetail>('/containers', { json: c }),
  get: (id: string) => api<ContainerDetail>(`/containers/${id}`),
  update: (id: string, c: ContainerInput) => api<ContainerDetail>(`/containers/${id}`, { method: 'PATCH', json: c }),
  load: (id: string, shipmentIds: string[]) => api<ContainerDetail>(`/containers/${id}/load`, { json: { shipmentIds } }),
  unload: (id: string, shipmentId: string) => api<ContainerDetail>(`/containers/${id}/unload`, { json: { shipmentId } }),
  advance: (id: string, b: { status: ContainerStatus; at?: string; place?: string; note?: string }) => api<ContainerDetail>(`/containers/${id}/advance`, { json: b }),
}
