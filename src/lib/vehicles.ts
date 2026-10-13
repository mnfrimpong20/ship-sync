import { api } from './store'

export interface Decoded { vin: string; valid: boolean; checkDigitOk: boolean; year: number | null; make: string | null; model: string | null; trim: string | null; body: string | null; engineL: number | null; cylinders: number | null; fuel: string | null; driveType: string | null; plantCountry: string | null; source: 'vpic' | 'builtin'; warnings: string[] }
export type ChecklistKey = 'title' | 'id' | 'lien' | 'bill_of_sale' | 'keys' | 'fuel' | 'personal_items' | 'photos'
export type ExportStep = 'pending' | 'docs_received' | 'cbp_filed' | 'cleared' | 'loaded'
export interface Vehicle {
  id: string; shipmentId: string | null; requestId: string | null; vin: string; year: number | null; make: string; model: string; trim: string; body: string; engineL: number | null; fuel: string; color: string; mileage: number | null
  running: boolean; method: 'roro' | 'container'; titleStatus: 'clean' | 'lien' | 'salvage' | 'rebuilt'; lienHolder: string; titleInHand: boolean; ownerName: string; declaredValueUsd: number | null; personalItems: string; notes: string
  decoded: Decoded | null; checklist: Partial<Record<ChecklistKey, boolean>>; exportStep: ExportStep; aesItn: string; handover: { location: string; date: string; contact: string; note: string } | null; updatedAt: string | null
}
export type VehicleInput = Omit<Vehicle, 'id' | 'shipmentId' | 'requestId' | 'decoded' | 'checklist' | 'exportStep' | 'aesItn' | 'handover' | 'updatedAt'>
/** What the quote wizard captures up front. */
export interface RequestVehicle { vin: string; year: number | null; make: string; model: string; running: boolean; method: 'roro' | 'container'; titleStatus: 'clean' | 'lien' | 'salvage' | 'rebuilt' }
export interface VehicleMeta { checklist: { id: ChecklistKey; label: string }[]; exportSteps: { id: ExportStep; label: string }[] }
export const methodLabels = { roro: 'RoRo (drive on, drive off)', container: 'In a container' } as const
export const titleLabels = { clean: 'Clean title', lien: 'Lien on title', salvage: 'Salvage title', rebuilt: 'Rebuilt title' } as const
export const vehicleLabel = (v: { year?: number | null; make?: string; model?: string }) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'
export const emptyVehicle = (): VehicleInput => ({ vin: '', year: null, make: '', model: '', trim: '', body: '', engineL: null, fuel: '', color: '', mileage: null, running: true, method: 'roro', titleStatus: 'clean', lienHolder: '', titleInHand: false, ownerName: '', declaredValueUsd: null, personalItems: '', notes: '' })

export const vehiclesApi = {
  decode: (vin: string) => api<{ decoded: Decoded }>(`/vehicles/decode/${encodeURIComponent(vin)}`).then((r) => r.decoded),
  forShipment: (id: string) => api<{ vehicle: Vehicle | null; canManage: boolean; isVehicle: boolean; meta: VehicleMeta }>(`/shipments/${id}/vehicle`),
  save: (id: string, v: VehicleInput) => api<{ vehicle: Vehicle }>(`/shipments/${id}/vehicle`, { method: 'PUT', json: v }).then((r) => r.vehicle),
  checklist: (id: string, checklist: Partial<Record<ChecklistKey, boolean>>) => api<{ vehicle: Vehicle }>(`/shipments/${id}/vehicle/checklist`, { method: 'PATCH', json: { checklist } }).then((r) => r.vehicle),
  handover: (id: string, h: { location: string; date: string; contact: string; note: string }) => api<{ vehicle: Vehicle }>(`/shipments/${id}/vehicle/handover`, { method: 'PUT', json: h }).then((r) => r.vehicle),
  exportStep: (id: string, b: { step: ExportStep; aesItn?: string; note?: string }) => api<{ vehicle: Vehicle }>(`/shipments/${id}/vehicle/export`, { json: b }).then((r) => r.vehicle),
}
