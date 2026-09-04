import { api } from './store'
import type { Mode, ShipmentStatus } from './data'

export type StaffRole = 'owner' | 'dispatcher' | 'agent' | 'driver'
export type StaffBase = 'origin' | 'destination'
export interface Staff { id: string; shipperId: string; userId?: string; name: string; email: string; phone: string; role: StaffRole; status: 'invited' | 'active' | 'inactive'; base: StaffBase; city: string; inviteToken?: string; createdAt: string; runCount?: number }
export interface InviteInput { name: string; email: string; phone?: string; role: StaffRole; base: StaffBase; city?: string }
export type VehicleType = 'van' | 'truck' | 'box_truck' | 'pickup' | 'trailer' | 'car' | 'motorbike'
export type VehicleStatus = 'available' | 'on_run' | 'maintenance' | 'retired'
export interface Vehicle { id: string; name: string; type: VehicleType; plate: string; capacityKg?: number; capacityNote: string; base: StaffBase; city: string; country: string; status: VehicleStatus; driverId?: string; notes: string; createdAt: string }
export type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'driverId' | 'capacityKg'> & { driverId?: string | null; capacityKg?: number | null }
export interface RunStop { id: string; runId: string; seq: number; shipmentId?: string; label: string; address: string; lat?: number; lon?: number; contact: string; phone: string; status: 'pending' | 'done' | 'skipped'; doneAt?: string; note: string; shipmentRef?: string; shipmentStatus?: ShipmentStatus }
export interface RunStart { label: string; lat: number; lon: number }
export type RunKind = 'pickup' | 'delivery'
export type RunStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'
export interface Run { id: string; name: string; kind: RunKind; date: string; driverId?: string; vehicleId?: string; start: RunStart | null; status: RunStatus; distanceKm?: number; notes: string; createdAt: string; stops: RunStop[]; driverName?: string; vehicleName?: string }
export interface StopInput { shipmentId?: string; label: string; address?: string; lat?: number; lon?: number; contact?: string; phone?: string }
export interface RunInput { name: string; kind: RunKind; date: string; driverId?: string | null; vehicleId?: string | null; start?: RunStart | null; notes?: string; stops: StopInput[] }
export interface Candidate { shipmentId: string; ref: string; mode: Mode; status: ShipmentStatus; description: string; eta: string | null; label: string; address: string; contact: string; phone: string }
export interface GeoHit { lat: number; lon: number; label: string; cached?: boolean }
export interface JoinInvite { name: string; email: string; role: StaffRole; company: string }

export const roleLabels: Record<StaffRole, string> = { owner: 'Owner', dispatcher: 'Dispatcher', agent: 'Agent', driver: 'Driver' }
export const roleBlurb: Record<StaffRole, string> = {
  owner: 'Full access, including billing, team and company profile.',
  dispatcher: 'Plans routes, manages the fleet and team, works clients and shipments.',
  agent: 'Works leads, clients, shipments and invoices. Read-only on routes.',
  driver: 'Sees only their own runs and marks stops done from the road.',
}
export const vehicleTypeLabels: Record<VehicleType, string> = { van: 'Van', truck: 'Truck', box_truck: 'Box truck', pickup: 'Pickup', trailer: 'Trailer', car: 'Car', motorbike: 'Motorbike' }
export const vehicleStatusLabels: Record<VehicleStatus, string> = { available: 'Available', on_run: 'On a run', maintenance: 'In maintenance', retired: 'Retired' }
export const runStatusLabels: Record<RunStatus, string> = { planned: 'Planned', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' }
export const canManageOps = (role?: StaffRole) => role === 'owner' || role === 'dispatcher'

export const opsApi = {
  me: () => api<{ staff: Staff }>('/team/me').then((r) => r.staff),
  team: () => api<{ team: Staff[] }>('/team').then((r) => r.team),
  invite: (i: InviteInput) => api<{ staff: Staff }>('/team/invite', { json: i }).then((r) => r.staff),
  updateStaff: (id: string, p: Partial<Pick<Staff, 'role' | 'status' | 'phone' | 'base' | 'city' | 'name'>>) => api<{ staff: Staff }>(`/team/${id}`, { method: 'PATCH', json: p }).then((r) => r.staff),
  reinvite: (id: string) => api<{ staff: Staff }>(`/team/${id}/reinvite`, { method: 'POST' }).then((r) => r.staff),
  joinInfo: (token: string) => api<{ invite: JoinInvite }>(`/join/${encodeURIComponent(token)}`).then((r) => r.invite),
  join: (token: string, b: { name: string; password: string }) => api<{ user: unknown }>(`/join/${encodeURIComponent(token)}`, { json: b }),
  vehicles: () => api<{ vehicles: Vehicle[] }>('/vehicles').then((r) => r.vehicles),
  addVehicle: (v: Partial<VehicleInput> & { name: string }) => api<{ vehicle: Vehicle }>('/vehicles', { json: v }).then((r) => r.vehicle),
  updateVehicle: (id: string, p: Partial<VehicleInput>) => api<{ vehicle: Vehicle }>(`/vehicles/${id}`, { method: 'PATCH', json: p }).then((r) => r.vehicle),
  geocode: (q: string) => api<{ result: GeoHit | null }>(`/geocode?q=${encodeURIComponent(q)}`).then((r) => r.result),
  candidates: (kind: RunKind) => api<{ candidates: Candidate[] }>(`/runs/candidates?kind=${kind}`).then((r) => r.candidates),
  runs: () => api<{ runs: Run[] }>('/runs').then((r) => r.runs),
  myRuns: () => api<{ runs: Run[] }>('/runs/mine').then((r) => r.runs),
  createRun: (i: RunInput) => api<{ run: Run }>('/runs', { json: i }).then((r) => r.run),
  updateRun: (id: string, p: Partial<Omit<RunInput, 'stops' | 'kind'>> & { status?: RunStatus }) => api<{ run: Run }>(`/runs/${id}`, { method: 'PATCH', json: p }).then((r) => r.run),
  optimise: (id: string) => api<{ run: Run }>(`/runs/${id}/optimise`, { method: 'POST' }).then((r) => r.run),
  addStop: (id: string, s: StopInput) => api<{ run: Run }>(`/runs/${id}/stops`, { json: s }).then((r) => r.run),
  updateStop: (id: string, sid: string, p: Partial<StopInput> & { status?: RunStop['status']; note?: string; seq?: number }) => api<{ run: Run }>(`/runs/${id}/stops/${sid}`, { method: 'PATCH', json: p }).then((r) => r.run),
  deleteStop: (id: string, sid: string) => api<{ run: Run }>(`/runs/${id}/stops/${sid}`, { method: 'DELETE' }).then((r) => r.run),
}

/** The one-time link a teammate opens to set their password and join the company. */
export const joinLink = (token: string) => `${location.origin}${location.pathname}#/join?token=${encodeURIComponent(token)}`
