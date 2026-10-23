import { api } from './store'
import type { Broker, BrokerJob, JobStatus, StepInput } from './brokers'

export type BpJob = BrokerJob & { assignedTo: string | null; port: string; checklist: Record<string, boolean>; shipmentStatus?: string; daysAtStep: number; unread?: number; assignedName?: string | null }
export interface BpMe { member: { id: string; name: string; email: string; phone: string; role: 'owner' | 'agent'; status: string }; broker: Broker & { accepting: boolean; settings: { termsDays?: number; bank?: string; invoiceNote?: string }; licenceExpires: string | null }; counts: { notifications: number; unread: number; requests: number; team?: number } }
export interface BpAttention { kind: 'request' | 'stuck' | 'overdue' | 'message'; jobId?: string; ref?: string; title: string; detail: string; age?: number; link?: string }
export interface BpOverview { kpis: { open: number; requests: number; doneMonth: number; feesMonth: number | null; avgClearDays: number | null; outstanding: number | null; unbilled: number | null; dutyMonth: { currency: string; amount: number }[] }; attention: BpAttention[]; pipeline: { step: string; label: string; n: number }[]; recent: BpJob[] }
export interface BpCharge { id: string; jobId: string; kind: string; label: string; description: string; amount: number; currency: string; amountUsd: number; rebill: boolean; invoiceId: string | null; hasReceipt: boolean; at: string; by: string }
export interface BpMessage { id: string; side: 'broker' | 'office' | 'customer'; from: string; body: string; docId: string | null; at: string }
export interface BpDetail {
  job: BpJob; checklistItems: { key: string; label: string }[]; chargeKinds: Record<string, string>
  shipment: { id: string; ref: string; customer: string; origin: string; destination: string; mode: string; cargo: string; cargoLabel: string; description: string; status: string; eta: string | null; pieces: number; weightKg: number | null; declaredValueUsd: number | null; items: unknown }
  consignee: { name: string; phone: string; address: string; city: string; gps: string } | null
  vehicle: { vin: string; label: string; engineL: number | null; body: string; valueUsd: number | null } | null
  container: { number: string; seal: string; vessel: string; eta: string | null; line: string } | null
  documents: { id: string; kind: string; title: string; mime: string; byBroker: boolean; by: string; hasFile: boolean; at: string }[]
  charges: BpCharge[]; messages: BpMessage[]; team: { id: string; name: string; role: string }[]; invoices: { id: string; number: string; status: string }[]
}
export interface BpInvoice { id: string; number: string; shipperId: string; shipper?: string; lines: { jobId: string; ref: string; chargeId?: string; label: string; amountUsd: number }[]; jobIds: string[]; totalUsd: number; status: 'draft' | 'sent' | 'paid' | 'void'; dueAt: string | null; sentAt: string | null; paidAt: string | null; paidRef: string; remindedAt?: string | null; notes: string; createdAt: string; overdue: boolean }
export interface BpFinance { invoices: BpInvoice[]; unbilled: { jobId: string; ref: string; shipperId: string; shipper: string; customer: string; status: string; feeUsd: number; charges: BpCharge[] }[]; months: { month: string; paid: number; billed: number }[]; byShipper: { shipper: string; billed: number; paid: number; outstanding: number }[]; totals: { outstanding: number; paidYear: number; unbilled: number; disbursementsOpen: number }; settings: { termsDays: number; bank: string; invoiceNote: string } }
export interface BpGroup { key: string; jobs: number; cleared: number; avgDays: number | null; fees: number }
export interface BpAnalytics { months: string[]; monthly: { start: string; month: string; received: number; cleared: number; fees: number; avgDays: number }[]; kpis: { received: number; cleared: number; avgClearDays: number | null; acceptRate: number | null; avgResponseHours: number | null; fees: number }; steps: { step: string; label: string; avgDays: number; n: number }[]; byCargo: BpGroup[]; byShipper: BpGroup[]; byPort: BpGroup[]; duty: { currency: string; amount: number; jobs: number }[] }
export interface BpMember { id: string; name: string; email: string; phone: string; role: 'owner' | 'agent'; status: string; lastSeenAt: string | null; openJobs: number; doneJobs: number }
export interface BpThread { jobId: string; ref: string; customer: string; shipper: string; status: JobStatus; last: string; lastFrom: string; lastAt: string; unread: number }
export interface BpInvoiceView { invoice: BpInvoice; broker: { name: string; company: string; licence: string; authority: string; phone: string; email: string; bank: string } }

export const bpApi = {
  login: (email: string, password: string) => api('/bp/login', { json: { email, password } }),
  logout: () => api('/bp/logout', { json: {} }),
  link: (email: string) => api('/bp/link', { json: { email } }),
  useLink: (token: string) => api('/bp/link/use', { json: { token } }),
  joinInfo: (token: string) => api<{ name: string; email: string; company: string }>(`/bp/join/${token}`),
  join: (token: string, password: string) => api(`/bp/join/${token}`, { json: { password } }),
  password: (password: string) => api('/bp/password', { json: { password } }),
  me: () => api<BpMe>('/bp/me'),
  overview: () => api<BpOverview>('/bp/overview'),
  jobs: () => api<{ jobs: BpJob[] }>('/bp/jobs').then((r) => r.jobs),
  job: (id: string) => api<BpDetail>(`/bp/jobs/${id}`),
  step: (id: string, b: StepInput) => api(`/bp/jobs/${id}/step`, { json: b }),
  patch: (id: string, b: { assignedTo?: string | null; checklist?: Record<string, boolean>; reference?: string; port?: string }) => api(`/bp/jobs/${id}`, { method: 'PATCH', json: b }),
  addDoc: (id: string, b: { title: string; kind: string; dataUrl: string; filename: string }) => api(`/bp/jobs/${id}/docs`, { json: b }),
  doc: (id: string) => api<{ title: string; dataUrl: string | null; payload: unknown; kind: string }>(`/bp/docs/${id}`),
  send: (id: string, body: string) => api(`/bp/jobs/${id}/messages`, { json: { body } }),
  inbox: () => api<{ threads: BpThread[] }>('/bp/inbox').then((r) => r.threads),
  addCharge: (id: string, b: { kind: string; description: string; amount: number; currency: string; rebill: boolean; receipt?: string }) => api(`/bp/jobs/${id}/charges`, { json: b }),
  delCharge: (id: string) => api(`/bp/charges/${id}`, { method: 'DELETE' }),
  finance: () => api<BpFinance>('/bp/finance'),
  invoice: (jobIds: string[], notes = '') => api<{ id: string }>('/bp/invoices', { json: { jobIds, notes } }),
  viewInvoice: (id: string) => api<BpInvoiceView>(`/bp/invoices/${id}`),
  sendInvoice: (id: string) => api(`/bp/invoices/${id}/send`, { json: {} }),
  paidInvoice: (id: string, ref: string) => api(`/bp/invoices/${id}/paid`, { json: { ref } }),
  voidInvoice: (id: string) => api(`/bp/invoices/${id}/void`, { json: {} }),
  remindInvoice: (id: string) => api(`/bp/invoices/${id}/remind`, { json: {} }),
  analytics: (months = 6) => api<BpAnalytics>(`/bp/analytics?months=${months}`),
  profile: (b: Record<string, unknown>) => api('/bp/profile', { method: 'PUT', json: b }),
  team: () => api<{ members: BpMember[] }>('/bp/team').then((r) => r.members),
  invite: (b: { name: string; email: string; phone: string; role: 'owner' | 'agent' }) => api<{ ok: true; link: string }>('/bp/team', { json: b }),
  remove: (id: string) => api(`/bp/team/${id}`, { method: 'DELETE' }),
  notifications: () => api<{ notifications: { id: string; title: string; body: string; link: string; read: boolean; at: string }[] }>('/bp/notifications').then((r) => r.notifications),
  readAll: () => api('/bp/notifications/read', { json: {} }),
  // shipping company side
  officeMessages: (jobId: string) => api<{ messages: BpMessage[]; invoices: { id: string; number: string; status: string; totalUsd: number; dueAt: string | null }[] }>(`/customs/jobs/${jobId}/messages`),
  officeSend: (jobId: string, body: string) => api(`/customs/jobs/${jobId}/messages`, { json: { body } }),
  officeInvoice: (id: string) => api<BpInvoiceView>(`/customs/broker-invoices/${id}`),
}

export const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
export const usdShort = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${Math.round(n)}`)
export const local = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n) } catch { return `${cur} ${n.toLocaleString()}` } }
export const shortDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')
export const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }
export const statusTone = (s: string) => (s === 'done' ? 'bg-teal/15 text-teal' : s === 'requested' ? 'bg-gold/20 text-gold-deep' : s === 'declined' || s === 'cancelled' ? 'bg-danger/10 text-danger' : 'bg-sky/10 text-sky')
