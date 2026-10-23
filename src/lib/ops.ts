import { api } from './store'
import { isDriverRole } from './roles'
import type { Mode, ShipmentStatus } from './data'

export type StaffRole = 'owner' | 'dispatcher' | 'agent' | 'finance' | 'warehouse' | 'pickup_driver' | 'delivery_driver' | 'driver'
export type StaffBase = 'origin' | 'destination'
export type Area = 'leads' | 'rates' | 'lanes' | 'groupage' | 'brand' | 'shipments' | 'containers' | 'sailings' | 'pickups' | 'routes' | 'warehouse' | 'clients' | 'payments' | 'collections' | 'reviews' | 'fleet' | 'team' | 'verification' | 'sourcing' | 'analytics'
export interface StaffPerms { allow?: Area[]; deny?: Area[] }
export interface StaffActivity { runsWeek: number; stopsWeek: number; scansWeek: number; quotesWeek: number; quotesWonWeek: number; lastScanAt: string | null }
export interface Staff { id: string; shipperId: string; userId?: string; name: string; email: string; phone: string; role: StaffRole; status: 'invited' | 'active' | 'inactive'; base: StaffBase; city: string; inviteToken?: string; createdAt: string; runCount?: number; perms?: StaffPerms; lastActiveAt?: string | null; activity?: StaffActivity }
export interface InviteInput { name: string; email: string; phone?: string; role: StaffRole; base: StaffBase; city?: string }
export type VehicleType = 'van' | 'truck' | 'box_truck' | 'pickup' | 'trailer' | 'car' | 'motorbike'
export type VehicleStatus = 'available' | 'on_run' | 'maintenance' | 'retired'
export interface Vehicle { id: string; name: string; type: VehicleType; plate: string; capacityKg?: number; capacityNote: string; base: StaffBase; city: string; country: string; status: VehicleStatus; driverId?: string; notes: string; createdAt: string }
export type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'driverId' | 'capacityKg'> & { driverId?: string | null; capacityKg?: number | null }
export interface RunStop { id: string; runId: string; seq: number; shipmentId?: string; label: string; address: string; lat?: number; lon?: number; contact: string; phone: string; status: 'pending' | 'done' | 'skipped'; doneAt?: string; note: string; collectUsd?: number; collectRule?: 'off' | 'warn' | 'block'; shipmentRef?: string; shipmentStatus?: ShipmentStatus; etaFrom?: string; etaTo?: string; pod?: { receivedBy: string; pieces?: number; hasPhoto: boolean; hasSignature: boolean; by: string; leftWith?: { kind: string; name: string } }; skipReason?: string; tries?: number; onWayAt?: string; collected?: { method: 'cash' | 'mobile_money' | 'zelle' | 'card'; amountUsd: number; at: string }; codeRequired?: boolean; codeOk?: boolean; idChecked?: boolean; nearAt?: string; vehicleReport?: boolean; suppliesDropped?: boolean; handedOver?: boolean }
export interface RunStart { label: string; lat: number; lon: number }
export type RunKind = 'pickup' | 'delivery'
export type RunStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'
export interface Run { id: string; name: string; kind: RunKind; date: string; driverId?: string; vehicleId?: string; start: RunStart | null; status: RunStatus; distanceKm?: number; notes: string; createdAt: string; stops: RunStop[]; driverName?: string; vehicleName?: string; summarySentAt?: string; vehicleCheck?: { at: string; by: string; issues: string[]; safe: boolean; odometer: number | null } }
export interface StopInput { shipmentId?: string; label: string; address?: string; lat?: number; lon?: number; contact?: string; phone?: string }
export interface RunInput { name: string; kind: RunKind; date: string; driverId?: string | null; vehicleId?: string | null; start?: RunStart | null; notes?: string; stops: StopInput[] }
export interface Candidate { shipmentId: string; ref: string; mode: Mode; status: ShipmentStatus; description: string; eta: string | null; label: string; address: string; contact: string; phone: string; readyAt?: string | null; city?: string }
export interface GeoHit { lat: number; lon: number; label: string; cached?: boolean }
export interface JoinInvite { name: string; email: string; role: StaffRole; company: string }

export const roleLabels: Record<StaffRole, string> = { owner: 'Owner', dispatcher: 'Dispatcher', agent: 'Agent', finance: 'Finance', warehouse: 'Warehouse', pickup_driver: 'Pickup driver', delivery_driver: 'Delivery driver', driver: 'Driver (pickups & deliveries)' }
export const roleBlurb: Record<StaffRole, string> = {
  owner: 'Full access, including billing, team and company profile.',
  dispatcher: 'Plans routes, manages the fleet and team, works clients and shipments.',
  agent: 'Works leads, clients, shipments and bookings. No payments, fleet or company settings.',
  finance: 'Payments, invoices, collections and client accounts. Sees shipments read-only.',
  warehouse: 'Receiving, scanning, containers and pickups at the warehouse. Nothing commercial.',
  pickup_driver: 'Collects from senders at origin: only their own pickup runs, proof of collection, piece checks.',
  delivery_driver: 'Delivers to receivers at destination: only their own delivery runs, proof of delivery, money at the door.',
  driver: 'Older single driver role — can be given pickup and delivery runs. Switch to Pickup or Delivery driver.',
}
export const vehicleTypeLabels: Record<VehicleType, string> = { van: 'Van', truck: 'Truck', box_truck: 'Box truck', pickup: 'Pickup', trailer: 'Trailer', car: 'Car', motorbike: 'Motorbike' }
export const vehicleStatusLabels: Record<VehicleStatus, string> = { available: 'Available', on_run: 'On a run', maintenance: 'In maintenance', retired: 'Retired' }
export const runStatusLabels: Record<RunStatus, string> = { planned: 'Planned', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' }
export const canManageOps = (role?: StaffRole) => role === 'owner' || role === 'dispatcher'
/** Which /dashboard areas each role gets. Owners and dispatchers see everything; the lists are prefixes of pathnames. */
/** Which /dashboard areas each role gets by default; a person's `perms` add (allow) or remove (deny) areas on top. */
export const AREA_PATHS: Record<Area, string> = { leads: '/dashboard/leads', rates: '/dashboard/rates', lanes: '/dashboard/lanes', groupage: '/dashboard/groupage', brand: '/dashboard/brand', shipments: '/dashboard/shipments', containers: '/dashboard/containers', sailings: '/dashboard/sailings', pickups: '/dashboard/pickups', routes: '/dashboard/routes', warehouse: '/dashboard/warehouse', clients: '/dashboard/clients', payments: '/dashboard/payments', collections: '/dashboard/collections', reviews: '/dashboard/reviews', fleet: '/dashboard/fleet', team: '/dashboard/team', verification: '/dashboard/verification', sourcing: '/dashboard/sourcing', analytics: '/dashboard/analytics' }
export const AREA_LABELS: Record<Area, string> = { leads: 'Requests', rates: 'Rate cards', lanes: 'Lane intelligence', groupage: 'Fill a barrel', brand: 'Branded page', shipments: 'Client shipments', containers: 'Containers', sailings: 'Book a sailing', pickups: 'Pickups', routes: 'Routes', warehouse: 'Warehouse', clients: 'Clients', payments: 'Payments', collections: 'Collections', reviews: 'Reviews', fleet: 'Fleet', team: 'Team', verification: 'Verification', sourcing: 'Sourcing', analytics: 'Analytics' }
export const ROLE_BASE: Record<StaffRole, Area[] | 'all'> = {
  owner: 'all', dispatcher: 'all',
  agent: ['leads', 'rates', 'lanes', 'groupage', 'shipments', 'containers', 'sailings', 'pickups', 'routes', 'warehouse', 'clients', 'reviews', 'team', 'sourcing', 'analytics'],
  finance: ['clients', 'payments', 'collections', 'reviews', 'shipments', 'team', 'analytics'],
  warehouse: ['warehouse', 'containers', 'pickups', 'shipments', 'team', 'analytics'],
  pickup_driver: ['routes'],
  delivery_driver: ['routes'],
  driver: ['routes'],
}
const ALWAYS = ['/dashboard/hr', '/dashboard/me', '/dashboard/costs', '/dashboard/campaigns', '/dashboard/integrations', '/dashboard/activity', '/dashboard/billing', '/dashboard/shipper', '/dashboard/notifications', '/dashboard/scan', '/dashboard/labels', '/dashboard/documents', '/dashboard/invoices', '/dashboard/runs', '/dashboard/suppliers', '/dashboard/drivers', '/dashboard/payslip']
/** Effective areas for a person: role defaults + allow − deny. */
export function areasFor(role: StaffRole | undefined, perms?: StaffPerms): Area[] | 'all' {
  const base = ROLE_BASE[role ?? 'owner']
  if (base === 'all') return perms?.deny?.length ? (Object.keys(AREA_PATHS) as Area[]).filter((a) => !perms.deny!.includes(a)) : 'all'
  const set = new Set<Area>([...base, ...(perms?.allow ?? [])]); for (const d of perms?.deny ?? []) set.delete(d)
  return [...set]
}
export const roleHome: Record<StaffRole, string> = { owner: '/dashboard/shipper', dispatcher: '/dashboard/shipper', agent: '/dashboard/shipper', finance: '/dashboard/shipper', warehouse: '/dashboard/warehouse', pickup_driver: '/dashboard/runs', delivery_driver: '/dashboard/runs', driver: '/dashboard/runs' }
export const roleAllows = (role: StaffRole | undefined, pathname: string, perms?: StaffPerms) => {
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?')
  if (isDriverRole(role) && (hit('/dashboard/shipper') || hit('/dashboard/drivers'))) return false
  if (ALWAYS.some(hit)) return true
  const a = areasFor(role, perms); if (a === 'all') return true
  return a.some((x) => hit(AREA_PATHS[x]))
}

export const opsApi = {
  me: () => api<{ staff: Staff }>('/team/me').then((r) => r.staff),
  team: () => api<{ team: Staff[] }>('/team').then((r) => r.team),
  invite: (i: InviteInput) => api<{ staff: Staff }>('/team/invite', { json: i }).then((r) => r.staff),
  updateStaff: (id: string, p: Partial<Pick<Staff, 'role' | 'status' | 'phone' | 'base' | 'city' | 'name'>> & { perms?: { allow: Area[]; deny: Area[] } }) => api<{ staff: Staff }>(`/team/${id}`, { method: 'PATCH', json: p }).then((r) => r.staff),
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
  startRun: (id: string) => api<{ run: Run; clockedIn?: boolean }>(`/runs/${id}`, { method: 'PATCH', json: { status: 'in_progress' } }),
  reorderFrom: (id: string, lat: number, lon: number) => api<{ run: Run; changed: boolean }>(`/runs/${id}/reorder-from`, { json: { lat, lon } }),
  optimise: (id: string) => api<{ run: Run }>(`/runs/${id}/optimise`, { method: 'POST' }).then((r) => r.run),
  addStop: (id: string, s: StopInput) => api<{ run: Run }>(`/runs/${id}/stops`, { json: s }).then((r) => r.run),
  onWay: (id: string, sid: string, minutes: number) => api<{ ok: true; texted: boolean; told: boolean; text: string }>(`/runs/${id}/stops/${sid}/on-way`, { json: { minutes } }),
  summary: (id: string, note = '') => api<{ ok: true; body: string }>(`/runs/${id}/summary`, { json: { note } }),
  dispatch: () => api<{ people: { name: string; phone: string; role: string }[]; office: { name: string; phone: string; whatsapp: string } }>('/runs/dispatch'),
  late: (id: string, minutes: number, note = '') => api<{ ok: true; told: number; pending: number }>(`/runs/${id}/late`, { json: { minutes, note } }),
  updateStop: (id: string, sid: string, p: Partial<StopInput> & { status?: RunStop['status']; note?: string; seq?: number }) => api<{ run: Run }>(`/runs/${id}/stops/${sid}`, { method: 'PATCH', json: p }).then((r) => r.run),
  deleteStop: (id: string, sid: string) => api<{ run: Run }>(`/runs/${id}/stops/${sid}`, { method: 'DELETE' }).then((r) => r.run),
}

/** The one-time link a teammate opens to set their password and join the company. */
export const joinLink = (token: string) => `${location.origin}/join?token=${encodeURIComponent(token)}`
