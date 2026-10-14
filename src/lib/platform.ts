/** Client for plans & billing, feature switches, audit log, view-as, announcements, costs, growth tools, integrations and the admin consoles. */
import { api } from './store'
import type { Kpi } from './analytics'

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>
const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : '' }

export interface PlanInfo { key: 'starter' | 'pro' | 'enterprise'; label: string; priceUsd: number; team: number | null; perks: string[]; blurb: string }
export interface Billing { plan: PlanInfo['key']; billed: PlanInfo['key']; trial: boolean; trialEndsAt: string | null; prices: Record<string, number>; online: boolean; usage: { team: number; teamLimit: number | null }; plans: PlanInfo[]; subscription: { plan: string; status: string; provider: string; amountUsd: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null; history: { kind: string; plan: string; amountUsd: number; at: string; by: string }[] }
export interface FeatureState { flags: Record<string, boolean>; plan: { plan: string; billed: string; trial: boolean; trialEndsAt: string | null } | null; perks: string[] }
export interface AuditEntry { id: string; at: string; actorId: string | null; actor: string; actorEmail: string; role: string; viewAsBy: string | null; shipperId: string | null; shipperName: string | null; method: string; path: string; action: string; entity: string; entityId: string | null; status: number | null; data: unknown; ip: string | null }
export interface Announcement { id: string; title: string; body: string; level: 'info' | 'warning' | 'critical'; link: string; audience?: string; destination?: string | null; startsAt?: string; endsAt?: string | null; active?: boolean; notify?: boolean; createdBy?: string; createdAt?: string; dismissals?: number }
export interface Cost { id: string; category: string; amountUsd: number; description: string; vendor: string; incurredOn: string; containerId: string | null; containerRef: string | null; shipmentId: string | null; shipmentRef: string | null; customer: string | null; scope: 'shipment' | 'container' | 'overhead'; createdBy: string }
export interface QuoteTemplate { id: string; name: string; mode: 'ocean' | 'air'; cargo: string; unitPrice: number; minCharge: number; pickupFee: number; deliveryFee: number; insurancePct: number; transitDays: number; validDays: number; kind: 'firm' | 'estimate'; includes: string[]; notes: string }
export interface Webhook { id: string; url: string; events: string[]; active: boolean; failures: number; lastStatus: number | null; lastAt: string | null; createdAt: string; secretHint: string }
export interface PlannerShipment { id: string; ref: string; customer: string; cargo: string; origin: string; destination: string; status: string; readyDate: string | null; cbm: number; kg: number; qty: number; estimated: boolean }
export interface PlannerContainer { id: string; ref: string; number: string; size: string; sizeLabel: string; destination: string; status: string; cutoff: string | null; daysToCutoff: number | null; shipments: number; cbm: number; kg: number; capacityCbm: number; capacityKg: number; fillPct: number; warning: boolean; suggest: string[]; suggestFillPct: number }
export interface Planner { waiting: PlannerShipment[]; containers: PlannerContainer[]; leftover: { shipments: number; cbm: number; kg: number; recommend: { size: string; label: string; fillPct: number; containers: number } | null }; capacity: Record<string, { cbm: number; kg: number; label: string }> }

export const platformApi = {
  /* plans & features */
  billing: () => api<Billing>('/billing'),
  checkout: (plan: 'pro' | 'enterprise') => api<{ url: string }>('/billing/checkout', { json: { plan } }),
  confirm: (session: string) => api<{ active: boolean; plan: string }>(`/billing/confirm${qs({ session })}`),
  cancel: () => api<{ ok: boolean; endsAt: string }>('/billing/cancel', { json: {} }),
  resume: () => api<{ ok: boolean }>('/billing/resume', { json: {} }),
  features: () => api<FeatureState>('/features'),
  /* audit & view-as */
  teamAudit: (q: R = {}) => api<{ entries: AuditEntry[]; more: boolean }>(`/team/audit${qs(q)}`),
  exitViewAs: () => api<{ ok: boolean; restored: boolean }>('/view-as/exit', { json: {} }),
  /* announcements */
  announcements: () => api<{ announcements: Announcement[] }>('/announcements').then((r) => r.announcements),
  dismiss: (id: string) => api(`/announcements/${id}/dismiss`, { json: {} }),
  /* costs & targets */
  costs: (days = 90) => api<{ costs: Cost[]; total: number; byCategory: { key: string; label: string; amount: number }[]; categories: { key: string; label: string }[]; containers: { id: string; label: string }[]; shipments: { id: string; label: string }[] }>(`/costs?days=${days}`),
  addCost: (b: R) => api<{ id: string }>('/costs', { json: b }),
  deleteCost: (id: string) => api(`/costs/${id}`, { method: 'DELETE' }),
  setTargets: (b: R) => api('/shipper/targets', { method: 'PUT', json: b }),
  /* growth */
  weekly: () => api<{ prefs: { email: boolean; whatsapp: boolean; phone: string }; on: boolean }>('/shipper/weekly-report'),
  setWeekly: (b: R) => api('/shipper/weekly-report', { method: 'PUT', json: b }),
  previewWeekly: () => api<{ subject: string; body: string; whatsapp: string; sent: number }>('/shipper/weekly-report/preview', { json: {} }),
  audience: (kind: string) => api<{ clients: { id: string; name: string; company: string; email: string; phone: string; shipments: number; lastAt: string | null }[] }>(`/campaigns/audience${qs({ kind })}`).then((r) => r.clients),
  campaigns: () => api<{ campaigns: R[]; enabled: boolean }>('/campaigns'),
  campaign: (id: string) => api<{ campaign: R; recipients: R[] }>(`/campaigns/${id}`),
  sendCampaign: (b: R) => api<{ id: string; recipients: number; skipped: number }>('/campaigns', { json: b }),
  planner: () => api<Planner>('/containers/planner'),
  templates: () => api<{ templates: QuoteTemplate[] }>('/quote-templates').then((r) => r.templates),
  saveTemplate: (b: Partial<QuoteTemplate>) => api<{ template: QuoteTemplate }>('/quote-templates', { json: b }).then((r) => r.template),
  deleteTemplate: (id: string) => api(`/quote-templates/${id}`, { method: 'DELETE' }),
  /* integrations */
  currency: () => api<{ currency: string; rate: number | null; rates: Record<string, number | null> }>('/shipper/currency'),
  setCurrency: (currency: string) => api<{ currency: string; rate: number | null }>('/shipper/currency', { method: 'PUT', json: { currency } }),
  webhooks: () => api<{ webhooks: Webhook[]; events: { key: string; label: string }[]; enabled: boolean }>('/webhooks'),
  addWebhook: (b: { url: string; events: string[] }) => api<{ webhook: Webhook; secret: string }>('/webhooks', { json: b }),
  updateWebhook: (id: string, b: R) => api<{ webhook: Webhook }>(`/webhooks/${id}`, { method: 'PATCH', json: b }),
  deleteWebhook: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }),
  testWebhook: (id: string) => api<{ ok: boolean; status: number | null; error: string }>(`/webhooks/${id}/test`, { json: {} }),
  deliveries: (id: string) => api<{ deliveries: R[] }>(`/webhooks/${id}/deliveries`).then((r) => r.deliveries),
  retryDelivery: (id: string) => api(`/webhook-deliveries/${id}/retry`, { json: {} }),
  widget: (id: string) => api<{ id: string; name: string; color: string; logo: string | null; initials: string }>(`/widget/${id}`),
  widgetTrack: (id: string, ref: string) => api<R>(`/widget/${id}/track/${encodeURIComponent(ref)}`),
}

export const adminConsoleApi = {
  platform: (days: number) => api<R & { kpis: Record<string, Kpi | number | null> }>(`/admin/platform?days=${days}`),
  marketplace: (days: number) => api<R>(`/admin/marketplace?days=${days}`),
  scorecards: () => api<{ cards: R[]; rules: R }>('/admin/scorecards'),
  recompute: () => api('/admin/scorecards/recompute', { json: {} }),
  setRules: (b: R) => api('/admin/standing-rules', { method: 'PUT', json: b }),
  setStanding: (id: string, b: R) => api(`/admin/shippers/${id}/standing`, { json: b }),
  risk: () => api<{ flags: R[]; counts: R }>('/admin/risk'),
  dismissRisk: (key: string, note: string) => api('/admin/risk/dismiss', { json: { key, note } }),
  messaging: (days: number) => api<R>(`/admin/messaging?days=${days}`),
  setMessagingCosts: (b: R) => api('/admin/messaging/costs', { method: 'PUT', json: b }),
  announcements: () => api<{ announcements: Announcement[] }>('/admin/announcements').then((r) => r.announcements),
  addAnnouncement: (b: R) => api<{ id: string; notified: number }>('/admin/announcements', { json: b }),
  updateAnnouncement: (id: string, b: R) => api(`/admin/announcements/${id}`, { method: 'PATCH', json: b }),
  deleteAnnouncement: (id: string) => api(`/admin/announcements/${id}`, { method: 'DELETE' }),
  audit: (q: R = {}) => api<{ entries: AuditEntry[]; more: boolean }>(`/admin/audit${qs(q)}`),
  users: (q: string) => api<{ users: R[] }>(`/admin/users${qs({ q })}`).then((r) => r.users),
  viewAs: (userId: string) => api<{ ok: boolean }>('/admin/view-as', { json: { userId } }),
  billing: () => api<R>('/admin/billing'),
  setPrices: (b: R) => api('/admin/billing/prices', { method: 'PUT', json: b }),
  setPlan: (id: string, b: R) => api(`/admin/billing/${id}`, { json: b }),
  features: () => api<{ features: R[]; overrides: R[] }>('/admin/features'),
  setFeature: (key: string, on: boolean) => api('/admin/features', { method: 'PUT', json: { key, on } }),
  setShipperFeature: (id: string, key: string, value: boolean | null) => api(`/admin/features/shippers/${id}`, { method: 'PUT', json: { key, value } }),
}
export const auditCsvUrl = (q: R, admin = true) => `/api/${admin ? 'admin/audit' : 'team/audit'}${qs({ ...q, format: 'csv' })}`
export const accountingCsvUrl = (q: R) => `/api/shipper/exports/accounting${qs(q)}`
