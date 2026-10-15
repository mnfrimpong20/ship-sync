import { api } from './store'
import type { Origin, OriginInfo } from './sourcingOrigins'
export { ORIGINS, ORIGIN_CODES, localPrice, asOrigin, type Origin, type OriginInfo } from './sourcingOrigins'

export type Tier = 'find' | 'order' | 'door'
export type Step = 'requested' | 'assigned' | 'sourcing' | 'quoted' | 'deposit_paid' | 'ordered' | 'in_production' | 'inspected' | 'balance_paid' | 'received_cn' | 'shipped' | 'delivered' | 'closed'
export type JobStatus = Step | 'cancelled'
export const STEPS: Step[] = ['requested', 'assigned', 'sourcing', 'quoted', 'deposit_paid', 'ordered', 'in_production', 'inspected', 'balance_paid', 'received_cn', 'shipped', 'delivered', 'closed']
export const FIND_STEPS: Step[] = ['requested', 'assigned', 'sourcing', 'quoted', 'closed']
export const stepLabels: Record<JobStatus, string> = {
  requested: 'Request received', assigned: 'Agent assigned', sourcing: 'Finding suppliers', quoted: 'Quotes ready', deposit_paid: 'Deposit paid', ordered: 'Order placed', in_production: 'In production', inspected: 'Quality inspected',
  balance_paid: 'Balance paid', received_cn: 'At our warehouse', shipped: 'Shipped', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
}
export const tierLabels: Record<Tier, string> = { find: 'Find me a supplier', order: 'Order & inspect', door: 'Door to door' }

export interface Audit { id?: string; auditor?: string; date: string; score: number; result: 'pass' | 'conditional' | 'fail'; findings?: string; categories?: Record<string, number> }
export interface Supplier { id: string; name: string; country: Origin; city: string; province: string; products: string[]; verified: boolean; rating: number; jobs: number; notes: string; contact: string; wechat: string; phone: string; website: string; storefront: string; active: boolean; createdAt: string | null; lastAudit: Audit | null }
export type SupplierInput = Omit<Supplier, 'id' | 'jobs' | 'createdAt' | 'lastAudit'>
export interface Quote {
  id: string; sourcingId: string; supplierId: string; supplier: Supplier | null; title: string; unitPriceCny: number; currency: string; qty: number; moq: number; leadDays: number; factoryUsd: number; serviceFeeUsd: number; inspectionUsd: number; handlingUsd: number; freightUsd: number; insuranceUsd: number; dutyEstUsd: number
  totalUsd: number; depositUsd: number; balanceUsd: number; tiers: PriceBreak[]; notes: string; sampleAvailable: boolean; status: 'proposed' | 'accepted' | 'rejected'; createdAt: string | null
}
export interface QuoteInput { supplierId: string; title: string; unitPriceCny: number; qty: number; moq?: number; leadDays: number; freightUsd?: number; insuranceUsd?: number; dutyEstUsd?: number; inspectionUsd?: number; handlingUsd?: number; serviceFeeUsd?: number; notes?: string; sampleAvailable?: boolean; tiers?: PriceBreak[] }
export interface Job {
  id: string; ref: string; tier: Tier; tierLabel: string; title: string; description: string; links: string[]; quantity: number; unit: string; targetPriceUsd: number | null; destination: string; destinationName: string; destinationCity: string; mode: 'ocean' | 'air' | 'either'; deadline: string | null
  origin: Origin; originName: string; currency: string
  customer?: { id: string; name: string; email: string; phone: string; company: string }; status: JobStatus; statusLabel: string; agent: { id: string; name: string; city: string } | null
  acceptedQuoteId: string | null; po: { number: string; incoterm: string; leadDays: number; readyBy: string; factoryPaidCny: number | null; supplier: string; placedAt: string; placedBy: string } | null; qc: { result?: 'pass' | 'rework' | 'fail'; checked?: number; defects?: number; notes?: string; at?: string; by?: string; items?: QcItem[]; sampleSize?: number; aql?: Aql } | null
  sample: Sample | null; reference: Reference | null; recurring: Recurring | null; parentId: string | null; parentRef: string | null; receipt: { cartons: number; grossKg: number; cbm: number; marks: string; siteName: string; receivedAt: string; by: string } | null; containerId: string | null; containerRef: string | null
  shipmentId: string | null; shipmentRef: string | null; shipmentStatus: string | null; supplierRevealed: boolean; timeline: { at: string; status: string; note: string; by: string }[]; createdAt: string | null; updatedAt: string | null; closedAt: string | null
}
export type Stage = 'fee' | 'deposit' | 'balance' | 'sample'
export interface Reference { url: string; platform: string; productId: string; title: string; image: string; priceCny: number | null; priceUsd: number | null; price?: number | null; currency?: string; origin?: Origin | null; moq: number | null }
export interface Recurring { active: boolean; everyWeeks: number; nextAt: string; quantity: number; placed: number; lastChildId?: string }
export interface PriceBreak { minQty: number; unitPriceCny: number }
export interface TodayItem extends Job { action: { label: string; step?: Step; kind: 'step' | 'quote' | 'sample' | 'assign' | 'wait' | 'reply' }; lastMessage: { author: string; role: string; body: string; at: string } | null; photos: number }
export interface QcItem { id: string; result: 'pass' | 'fail' | 'na'; note?: string }
export interface Aql { sampleSize: number; acceptMajor: number; acceptMinor: number }
export interface Sample { status: 'requested' | 'quoted' | 'paid' | 'shipped' | 'approved' | 'rejected'; note?: string; address?: string; costUsd?: number; factoryUsd?: number; handlingUsd?: number; quoteNote?: string; courier?: string; tracking?: string; shipNote?: string; feedback?: string; requestedAt?: string; quotedAt?: string; shippedAt?: string; feedbackAt?: string }
export interface OpenContainer { id: string; ref: string; number: string; size: string; line: string; destination: string; destinationPort: string; originPort: string; status: string; cutoffDate: string | null; etd: string | null; eta: string | null; loaded: number }
export interface Earning { id: string; sourcingId: string; ref: string; title: string; agentId: string; agentName: string; amountUsd: number; status: 'earned' | 'paid'; note: string; earnedAt: string | null; paidAt: string | null }
export interface QcReport { job: Job; qc: Job['qc']; checklist: { id: string; label: string; result?: 'pass' | 'fail' | 'na'; note?: string }[]; aql: Aql; supplier: { name: string; city: string } | null; po: Job['po']; photos: { id: string; title: string; by: string; at: string; url: string }[] }
export interface Payment { id: string; stage: Stage; amountUsd: number; status: string; provider: string; method: string | null; paidAt: string | null; items: { description: string; amountUsd: number }[] }
export interface Message { id: string; author: string; role: 'customer' | 'agent' | 'admin'; body: string; at: string; mine: boolean }
export interface SFile { id: string; kind: 'photo' | 'document' | 'qc'; title: string; mime: string; size: number; by: string; role: string; at: string; url: string }
export interface Due { stage: Stage; amountUsd: number; items: { description: string; amountUsd: number; kind: string }[] }
export interface Pricing { servicePct: number; minFeeUsd: number; findFeeUsd: number; depositPct: number; inspectionUsd: number; handlingUsd: number; cnyPerUsd: number; gbpPerUsd: number; note: string; agentCommissionPct?: number; sampleHandlingUsd?: number }
export interface Detail { job: Job; quotes: Quote[]; payments: Payment[]; messages: Message[]; files: SFile[]; due: Due | null; canPay: boolean; online: boolean; steps: { id: Step; label: string }[]; settings: Pricing }
export interface RequestInput { tier: Tier; origin: Origin; title: string; description: string; links: string[]; quantity: number; unit: string; targetPriceUsd: number | null; destination: string; destinationCity: string; mode: 'ocean' | 'air' | 'either'; deadline: string | null; contactName: string; contactEmail: string; contactPhone: string; company: string; reference?: Reference | null }
export interface StepInput { status: JobStatus; note?: string; po?: { number?: string; leadDays?: number; readyBy?: string; incoterm?: 'EXW' | 'FOB' | 'CIF' | 'DDP'; factoryPaidCny?: number }; qc?: { result: 'pass' | 'rework' | 'fail'; checked?: number; defects?: number; notes?: string; items?: QcItem[] }; receipt?: { cartons?: number; grossKg?: number; cbm?: number; marks?: string }; containerId?: string; ship?: { mode: 'ocean' | 'air'; originCity?: string; cargo?: string; eta: string; vesselName?: string; flight?: string; description?: string }; refund?: boolean }
export interface Settings extends Pricing { enabled: boolean; agentCommissionPct: number; sampleHandlingUsd: number }
export const QC_ITEMS: { id: string; label: string }[] = [
  { id: 'quantity', label: 'Quantity matches the PO' }, { id: 'packaging', label: 'Export packaging & carton strength' }, { id: 'labeling', label: 'Labels, barcodes & shipping marks' }, { id: 'appearance', label: 'Appearance, finish & colour' },
  { id: 'function', label: 'Function / performance test' }, { id: 'dimensions', label: 'Dimensions & weight' }, { id: 'safety', label: 'Safety marks & certificates (CE, CCC, RoHS…)' }, { id: 'damage', label: 'No damage, moisture or mould' },
]

export const SOURCING_SHIPPER = 'ship-sync-sourcing'
export const cny = (n: number) => `¥${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
export const usd2 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export interface SupplierUpdate { id: string; kind: 'confirm' | 'progress' | 'ready' | 'delay' | 'note'; body: string; by: string; readyBy: string | null; pct: number | null; at: string }
export interface SupplierLink { token: string; url: string; supplierId: string | null; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
export interface SupplierPortal {
  supplier: { name: string | null; contact: string | null }
  job: { ref: string; title: string; description: string; quantity: number; unit: string; status: string; destination: string }
  po: { number: string; incoterm: string; readyBy: string; leadDays: number; placedAt: string; confirmedAt: string | null; confirmedBy: string | null; readyAt: string | null; pct: number | null } | null
  quote: { title: string; unitPriceCny: number; currency?: string; origin?: Origin; leadDays: number; notes: string; moq: number | null } | null
  agent: string
  updates: SupplierUpdate[]
  photos: { id: string; title: string; by: string; at: string; url: string }[]
}
export const supplierApi = {
  portal: (token: string) => api<SupplierPortal>(`/s/${token}`),
  update: (token: string, b: { kind: SupplierUpdate['kind']; body: string; by: string; readyBy?: string; pct?: number }) => api<{ update: SupplierUpdate; status: string }>(`/s/${token}/update`, { json: b }),
  photo: (token: string, b: { title: string; mime: string; data: string; by: string }) => api<{ photo: SupplierPortal['photos'][number] }>(`/s/${token}/photos`, { json: b }).then((r) => r.photo),
}
export const sourcingApi = {
  supplierLink: (id: string) => api<{ link: SupplierLink | null; updates: SupplierUpdate[] }>(`/sourcing/${id}/supplier-link`),
  createSupplierLink: (id: string) => api<{ link: SupplierLink; reused: boolean }>(`/sourcing/${id}/supplier-link`, { json: {} }),
  revokeSupplierLink: (id: string) => api<{ ok: true }>(`/sourcing/${id}/supplier-link`, { method: 'DELETE' }),
  config: () => api<{ enabled: boolean; tiers: { id: Tier; label: string; blurb: string }[]; pricing: Pricing; origins: (OriginInfo & { perUsd: number })[]; stats: { agents: number; suppliers: number; verifiedSuppliers: number; completed: number }; steps: { id: Step; label: string }[] }>('/sourcing/config'),
  create: (b: RequestInput) => api<Detail>('/sourcing', { json: b }),
  mine: () => api<{ requests: Job[] }>('/sourcing/mine').then((r) => r.requests),
  get: (id: string) => api<Detail>(`/sourcing/${id}`),
  accept: (id: string, quoteId: string, qty?: number) => api<Detail>(`/sourcing/${id}/accept`, { json: { quoteId, qty } }),
  importLink: (url: string) => api<{ reference: Reference; origin: Origin | null; description: string; fetched: boolean; blocked: boolean; hint: string }>(`/sourcing/tools/import?url=${encodeURIComponent(url)}`),
  reorder: (id: string, quantity?: number) => api<Detail>(`/sourcing/${id}/reorder`, { json: { quantity } }),
  recurring: (id: string, b: { active: boolean; everyWeeks: number; nextAt?: string }) => api<Detail>(`/sourcing/${id}/recurring`, { method: 'PUT', json: b }),
  today: () => api<{ items: TodayItem[]; me: string; name: string }>('/sourcing/team/today'),
  checkout: (id: string) => api<{ url: string; paymentId: string }>(`/sourcing/${id}/checkout`, { json: {} }),
  verify: (id: string, pid: string) => api<{ payment: Payment }>(`/sourcing/${id}/payments/${pid}/verify`, { json: {} }).then((r) => r.payment),
  record: (id: string, method: string, note: string) => api<Detail>(`/sourcing/${id}/payments/record`, { json: { method, note } }),
  message: (id: string, body: string) => api<{ message: Message }>(`/sourcing/${id}/messages`, { json: { body } }).then((r) => r.message),
  upload: (id: string, f: { kind: SFile['kind']; title: string; mime: string; data: string }) => api<{ file: SFile }>(`/sourcing/${id}/files`, { json: f }).then((r) => r.file),
  cancel: (id: string, reason: string) => api<Detail>(`/sourcing/${id}/cancel`, { json: { reason } }),
  close: (id: string) => api<Detail>(`/sourcing/${id}/close`, { json: {} }),
  board: (q?: { mine?: boolean; status?: string }) => api<{ requests: Job[]; agents: { id: string; name: string; city: string; role: string; open: number }[]; me: string; isAdmin: boolean }>(`/sourcing?${q?.mine ? 'mine=1&' : ''}${q?.status ? `status=${q.status}` : ''}`),
  assign: (id: string, agentUserId: string | null) => api<Detail>(`/sourcing/${id}/assign`, { json: { agentUserId } }),
  addQuote: (id: string, q: QuoteInput) => api<Detail>(`/sourcing/${id}/quotes`, { json: q }),
  removeQuote: (id: string, qid: string) => api<Detail>(`/sourcing/${id}/quotes/${qid}`, { method: 'DELETE' }),
  step: (id: string, b: StepInput) => api<Detail>(`/sourcing/${id}/step`, { json: b }),
  suppliers: (q?: string, country?: Origin) => api<{ suppliers: Supplier[] }>(`/suppliers?${new URLSearchParams({ ...(q ? { q } : {}), ...(country ? { country } : {}) })}`).then((r) => r.suppliers),
  addSupplier: (b: Partial<SupplierInput> & { name: string }) => api<{ supplier: Supplier }>('/suppliers', { json: b }).then((r) => r.supplier),
  updateSupplier: (id: string, b: Partial<SupplierInput>) => api<{ supplier: Supplier }>(`/suppliers/${id}`, { method: 'PATCH', json: b }).then((r) => r.supplier),
  sampleRequest: (id: string, note: string, address: string) => api<Detail>(`/sourcing/${id}/sample`, { json: { note, address } }),
  sampleQuote: (id: string, costUsd: number, note: string) => api<Detail>(`/sourcing/${id}/sample/quote`, { json: { costUsd, note } }),
  sampleShip: (id: string, courier: string, tracking: string, note: string) => api<Detail>(`/sourcing/${id}/sample/ship`, { json: { courier, tracking, note } }),
  sampleFeedback: (id: string, result: 'approved' | 'rejected', note: string) => api<Detail>(`/sourcing/${id}/sample/feedback`, { json: { result, note } }),
  checklist: (id: string, items: QcItem[], sampleSize?: number) => api<Detail>(`/sourcing/${id}/qc/checklist`, { method: 'PUT', json: { items, sampleSize } }),
  qcReport: (id: string) => api<QcReport>(`/sourcing/${id}/qc-report`),
  openContainers: () => api<{ containers: OpenContainer[] }>('/sourcing/containers/open').then((r) => r.containers),
  earnings: () => api<{ earnings: Earning[]; totals: { earnedUsd: number; paidUsd: number }; isAdmin: boolean }>('/sourcing/team/earnings'),
  markEarningPaid: (id: string, reference: string) => api<{ ok: true }>(`/admin/sourcing/earnings/${id}/paid`, { json: { reference } }),
  addAudit: (supplierId: string, a: Audit) => api<{ supplier: Supplier; audit: Audit }>(`/suppliers/${supplierId}/audits`, { json: a }),
  audits: (supplierId: string) => api<{ audits: Audit[] }>(`/suppliers/${supplierId}/audits`).then((r) => r.audits),
  settings: () => api<{ settings: Settings }>('/admin/sourcing/settings').then((r) => r.settings),
  saveSettings: (b: Partial<Settings>) => api<{ settings: Settings }>('/admin/sourcing/settings', { method: 'PUT', json: b }).then((r) => r.settings),
}
