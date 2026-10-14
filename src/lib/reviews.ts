import { api } from './store'

export interface Review { id: string; shipmentId: string; shipmentRef?: string; shipperId: string; shipperName?: string; userId?: string; author: string; rating: number; tags: string[]; body: string; reply: string; repliedAt: string | null; status: 'published' | 'hidden'; lane?: string; cargo?: string; createdAt: string | null }
export interface ReviewSummary { count: number; average: number | null; distribution: { stars: number; count: number }[]; tags: { tag: string; count: number }[] }
export type DisputeReason = 'damaged' | 'missing' | 'late' | 'overcharged' | 'not_delivered' | 'other'
export interface Dispute { id: string; shipmentId: string; shipmentRef?: string; customer?: string; shipperId: string; shipperName?: string; openedBy: string; openedByRole: 'customer' | 'office'; reason: DisputeReason; reasonLabel: string; description: string; amountClaimedUsd: number | null; status: 'open' | 'resolved' | 'withdrawn'; messages: { at: string; by: string; role: string; text: string }[]; resolution: { outcome: string; amountUsd: number; note: string; by: string; at: string } | null; paymentId: string | null; paymentAmountUsd: number | null; paymentStatus: string | null; createdAt: string | null; updatedAt: string | null }
export const outcomeLabels: Record<string, string> = { refund_full: 'Full refund', refund_partial: 'Partial refund', release: 'Released to shipper', no_action: 'No action', withdrawn: 'Withdrawn' }

export const reviewsApi = {
  forShipper: (id: string) => api<{ reviews: Review[]; summary: ReviewSummary }>(`/shippers/${id}/reviews`),
  forShipment: (id: string) => api<{ review: Review | null; canReview: boolean; canReply: boolean; tags: string[] }>(`/shipments/${id}/review`),
  create: (id: string, b: { rating: number; tags: string[]; body: string }) => api<{ review: Review }>(`/shipments/${id}/review`, { json: b }).then((r) => r.review),
  reply: (reviewId: string, reply: string) => api<{ review: Review }>(`/reviews/${reviewId}/reply`, { json: { reply } }).then((r) => r.review),
  mine: () => api<{ reviews: Review[]; rating: number; count: number; awaiting: number }>('/reviews'),
  hide: (id: string, status: 'published' | 'hidden') => api<{ ok: true }>(`/admin/reviews/${id}`, { method: 'PATCH', json: { status } }),
  dispute: (shipmentId: string) => api<{ dispute: Dispute | null; canOpen: boolean; reasons: { id: DisputeReason; label: string }[]; role: 'office' | 'customer' | 'admin' }>(`/shipments/${shipmentId}/dispute`),
  openDispute: (shipmentId: string, b: { reason: DisputeReason; description: string; amountClaimedUsd?: number; photos?: string[] }) => api<{ dispute: Dispute }>(`/shipments/${shipmentId}/dispute`, { json: b }).then((r) => r.dispute),
  message: (id: string, text: string) => api<{ dispute: Dispute }>(`/disputes/${id}/message`, { json: { text } }).then((r) => r.dispute),
  withdraw: (id: string) => api<{ dispute: Dispute }>(`/disputes/${id}/withdraw`, { json: {} }).then((r) => r.dispute),
  resolve: (id: string, b: { outcome: 'refund_full' | 'refund_partial' | 'release' | 'no_action'; amountUsd?: number; note: string }) => api<{ dispute: Dispute }>(`/disputes/${id}/resolve`, { json: b }).then((r) => r.dispute),
  disputes: () => api<{ disputes: Dispute[] }>('/disputes').then((r) => r.disputes),
  admin: () => api<{ disputes: Dispute[]; reviews: Review[] }>('/admin/disputes'),
}
