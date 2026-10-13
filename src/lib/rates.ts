import { api } from './store'
import type { CargoType, Mode } from './data'

export interface RateCard {
  id: string; shipperId: string; origin: string; destination: string; mode: Mode; cargo: CargoType
  price: number; unit: 'unit' | 'kg'; minCharge: number; pickupFee: number; deliveryFee: number; insuranceFee: number
  transitDays: number; validDays: number; notes: string; autoSend: boolean; active: boolean; updatedAt: string | null
}
export type RateInput = Omit<RateCard, 'id' | 'shipperId' | 'updatedAt'>
export interface RatePreview { price: number; transitDays: number; mode: Mode; includes: string[]; notes: string; validUntil: string; breakdown: { base: number; pickup: number; delivery: number; insurance: number; minApplied: boolean }; autoSend: boolean }
export interface PreviewInput { origin: string; destination: string; mode: Mode | 'either'; cargo: CargoType; quantity: number; weightKg?: number; pickup: boolean; delivery: boolean; insurance: boolean }

export const ratesApi = {
  list: () => api<{ rates: RateCard[]; canEdit: boolean }>('/rates'),
  add: (r: RateInput) => api<{ rate: RateCard }>('/rates', { json: r }).then((x) => x.rate),
  update: (id: string, r: Partial<RateInput>) => api<{ rate: RateCard }>(`/rates/${id}`, { method: 'PATCH', json: r }).then((x) => x.rate),
  remove: (id: string) => api<{ ok: true }>(`/rates/${id}`, { method: 'DELETE' }),
  preview: (p: PreviewInput) => api<{ quote: RatePreview | null; card: RateCard | null }>('/rates/preview', { json: p }),
}

export const blankRate: RateInput = { origin: '', destination: 'GH', mode: 'ocean', cargo: 'barrels', price: 0, unit: 'unit', minCharge: 0, pickupFee: 0, deliveryFee: 0, insuranceFee: 0, transitDays: 30, validDays: 10, notes: '', autoSend: false, active: true }
export const unitLabel = (cargo: CargoType, unit: 'unit' | 'kg') => unit === 'kg' ? 'per kg' : ({ barrels: 'per barrel', boxes: 'per box', pallets: 'per pallet', vehicle: 'per vehicle', container20: 'per container', container40: 'per container', commercial: 'per unit' } as Record<CargoType, string>)[cargo]
