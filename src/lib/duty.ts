import { api } from './store'

export type GoodsKind = 'personal_effects' | 'household_new' | 'electronics' | 'food' | 'clothing_new' | 'building' | 'machinery' | 'vehicle' | 'motorcycle' | 'other'
export interface DutyInput { destination: string; goods: GoodsKind; valueUsd: number; freightUsd?: number; insuranceUsd?: number; vehicle?: { year: number; cc: number; kind: 'car' | 'suv' | 'van' | 'truck' }; fx?: number; exemptPersonalEffects?: boolean }
export interface DutyLine { key: string; label: string; rate: number | null; base: string; amount: number; note?: string }
export interface DutyEstimate { destination: string; currency: string; fx: number; checked: string; supported: boolean; cifUsd: number; cifLocal: number; lines: DutyLine[]; totalLocal: number; totalUsd: number; landedUsd: number; effectiveRate: number; notes: string[]; verifyUrl: string | null; confidence: 'low' | 'medium' }
export interface DutyConfirmed { amountLocal: number; currency: string; reference: string; note: string; by: string; at: string }
export interface DutyMeta { goods: { id: GoodsKind; label: string }[]; checked: string; fx: Record<string, number>; supported: string[] }

export const dutyApi = {
  meta: () => api<DutyMeta>('/duty/meta'),
  estimate: (i: DutyInput) => api<{ estimate: DutyEstimate }>('/duty/estimate', { json: i }).then((r) => r.estimate),
  forShipment: (id: string) => api<{ input: DutyInput; estimate: DutyEstimate | null; confirmed: DutyConfirmed | null; canManage: boolean }>(`/shipments/${id}/duty`),
  save: (id: string, i: Omit<DutyInput, 'destination'>) => api<{ input: DutyInput; estimate: DutyEstimate }>(`/shipments/${id}/duty`, { method: 'PUT', json: i }),
  confirm: (id: string, b: { amountLocal: number; currency: string; reference: string; note: string }) => api<{ confirmed: DutyConfirmed }>(`/shipments/${id}/duty/confirm`, { json: b }).then((r) => r.confirmed),
  unconfirm: (id: string) => api<{ ok: true }>(`/shipments/${id}/duty/confirm`, { method: 'DELETE' }),
}
export const local = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
export const pct = (r: number | null) => (r == null ? '' : `${(r * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)
