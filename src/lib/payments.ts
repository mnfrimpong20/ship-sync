import { api } from './store'

export type PaymentStatus = 'pending' | 'held' | 'released' | 'paid_out' | 'refunded' | 'cancelled' | 'direct'
export interface PaymentItem { description: string; amountUsd: number; kind?: 'freight' | 'insurance' }
export interface Payment {
  id: string; shipmentId: string; shipmentRef?: string; customer?: string; shipperId: string; shipperName?: string
  items: PaymentItem[]; amountUsd: number; feeUsd: number; netUsd: number
  status: PaymentStatus; provider: 'stripe' | 'manual'; method: string | null
  paidAt: string | null; releasedAt: string | null; releaseReason: string | null; refundedAt: string | null; refundReason: string | null
  payoutId: string | null; recordedBy: string | null; receiptDocumentId: string | null; createdAt: string | null
}
export interface PayoutDetails { bankName: string; accountName: string; accountNumber: string; routing: string; country: string; mobileMoney: string }
export interface Payout { id: string; shipperId: string; shipperName?: string; amountUsd: number; status: 'requested' | 'paid' | 'rejected'; method: string; details: PayoutDetails; reference: string; note: string; requestedBy: string; requestedAt: string | null; paidAt: string | null; paidBy: string | null; payments: number }
export interface PaymentConfig { enabled: boolean; online: boolean; mode: 'off' | 'test' | 'live'; releaseOn: 'in_transit' | 'delivered'; customerNote: string; takeRatePct: number; payoutNote?: string }
export interface PaymentSettings { enabled: boolean; takeRatePct: number; releaseOn: 'in_transit' | 'delivered'; customerNote: string; payoutNote: string }
export interface Balance { heldUsd: number; availableUsd: number; pendingPayoutUsd: number; paidOutUsd: number; collectedUsd: number; feesUsd: number }

export const paymentStatusLabels: Record<PaymentStatus, string> = { pending: 'Awaiting payment', held: 'In escrow', released: 'Released', paid_out: 'Paid out', refunded: 'Refunded', cancelled: 'Cancelled', direct: 'Paid directly' }
export const methodLabels: Record<string, string> = { card: 'Card', bank: 'Bank transfer', cash: 'Cash', mobile_money: 'Mobile money', other: 'Other', link: 'Link', ship_sync: 'Ship Sync' }
export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n)

export const paymentsApi = {
  config: () => api<{ config: PaymentConfig }>('/payments/config').then((r) => r.config),
  forShipment: (id: string) => api<{ payment: Payment | null; due: { items: PaymentItem[]; amountUsd: number } | null; config: PaymentConfig; canPay: boolean; canManage: boolean }>(`/shipments/${id}/payment`),
  checkout: (id: string) => api<{ url: string; paymentId: string }>(`/shipments/${id}/payment/checkout`, { json: {} }),
  verify: (paymentId: string) => api<{ payment: Payment }>(`/payments/${paymentId}/verify`, { json: {} }).then((r) => r.payment),
  record: (id: string, b: { amountUsd?: number; method: string; note: string }) => api<{ payment: Payment }>(`/shipments/${id}/payment/record`, { json: b }).then((r) => r.payment),
  refund: (paymentId: string, reason: string) => api<{ payment: Payment }>(`/payments/${paymentId}/refund`, { json: { reason } }).then((r) => r.payment),
  release: (paymentId: string) => api<{ payment: Payment }>(`/payments/${paymentId}/release`, { json: {} }).then((r) => r.payment),
  list: () => api<{ payments: Payment[]; payouts: Payout[]; balance: Balance; payoutDetails: PayoutDetails; canPayout: boolean; config: PaymentConfig }>('/payments'),
  savePayoutDetails: (d: PayoutDetails) => api<{ payoutDetails: PayoutDetails }>('/payments/payout-details', { method: 'PUT', json: d }).then((r) => r.payoutDetails),
  requestPayout: (amountUsd?: number) => api<{ payout: Payout; balance: Balance }>('/payouts', { json: amountUsd ? { amountUsd } : {} }),
  admin: () => api<{ settings: PaymentSettings; stripe: { mode: 'off' | 'test' | 'live'; webhook: boolean }; payments: Payment[]; payouts: Payout[]; totals: { volume: number; fees: number; held: number; owed: number; refunded: number; pendingPayouts: number } }>('/admin/payments'),
  saveSettings: (s: Partial<PaymentSettings>) => api<{ settings: PaymentSettings }>('/admin/payments/settings', { method: 'PUT', json: s }).then((r) => r.settings),
  payoutPaid: (id: string, b: { reference: string; note: string }) => api<{ payout: Payout }>(`/admin/payouts/${id}/paid`, { json: b }).then((r) => r.payout),
  payoutReject: (id: string, note: string) => api<{ payout: Payout }>(`/admin/payouts/${id}/reject`, { json: { note } }).then((r) => r.payout),
}
