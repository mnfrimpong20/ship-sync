import { api } from './store'
import type { CargoType } from './data'

export interface InsuranceProductPublic { provider: string; coverage: string; rate: number; minPremiumUsd: number; maxValueUsd: number; deductiblePct: number; terms: string }
export interface InsuranceProduct { enabled: boolean; provider: string; coverage: string; rates: Record<CargoType, number>; minPremiumUsd: number; maxValueUsd: number; deductiblePct: number; commissionPct: number; terms: string }
export interface Claim { description: string; amountUsd: number; contact: string; filedBy: string; filedAt: string; outcome: 'paid' | 'declined' | null; settledUsd: number | null; note: string; resolvedAt: string | null; resolvedBy?: string }
export interface Policy {
  id: string; shipmentId: string; shipmentRef?: string; customer?: string; shipperId: string; shipperName?: string; certificateNo: string; provider: string; coverage: string
  declaredValueUsd: number; rate: number; premiumUsd: number; commissionUsd: number; deductibleUsd: number
  status: 'active' | 'cancelled' | 'claim_open' | 'claim_paid' | 'claim_declined'; paymentStatus: 'due' | 'collected'; startsAt: string | null; endsAt: string | null; documentId: string | null; claim: Claim | null; createdAt: string | null
}
export const policyStatusLabels: Record<Policy['status'], string> = { active: 'Covered', cancelled: 'Cancelled', claim_open: 'Claim open', claim_paid: 'Claim settled', claim_declined: 'Claim declined' }

export const insuranceApi = {
  product: () => api<{ product: Omit<InsuranceProduct, 'commissionPct'> }>('/insurance/product').then((r) => r.product),
  quote: (cargo: CargoType, valueUsd: number) => api<{ quote: { valueUsd: number; rate: number; premiumUsd: number; deductibleUsd: number; capped: boolean }; enabled: boolean }>('/insurance/quote', { json: { cargo, valueUsd } }),
  forShipment: (id: string) => api<{ policy: Policy | null; product: InsuranceProductPublic | null; suggestedValueUsd: number | null; canBuy: boolean; canManage: boolean }>(`/shipments/${id}/insurance`),
  buy: (id: string, declaredValueUsd: number) => api<{ policy: Policy }>(`/shipments/${id}/insurance`, { json: { declaredValueUsd, accept: true } }).then((r) => r.policy),
  collected: (policyId: string) => api<{ policy: Policy }>(`/insurance/${policyId}/collected`, { json: {} }).then((r) => r.policy),
  cancel: (policyId: string) => api<{ ok: true }>(`/insurance/${policyId}/cancel`, { json: {} }),
  claim: (policyId: string, b: { description: string; amountUsd: number; contact: string }) => api<{ policy: Policy }>(`/insurance/${policyId}/claim`, { json: b }).then((r) => r.policy),
  resolve: (policyId: string, b: { outcome: 'paid' | 'declined'; amountUsd?: number; note: string }) => api<{ policy: Policy }>(`/insurance/${policyId}/resolve`, { json: b }).then((r) => r.policy),
  admin: () => api<{ policies: Policy[]; product: InsuranceProduct; totals: { premiums: number; commission: number; insured: number; claims: number } }>('/admin/insurance'),
  saveProduct: (p: Partial<InsuranceProduct>) => api<{ product: InsuranceProduct }>('/admin/insurance/product', { method: 'PUT', json: p }).then((r) => r.product),
}
