import { api } from './store'
import type { Invoice } from './clients'
import type { Payment } from './payments'

export interface InvoiceFull extends Invoice {
  clientName: string; clientEmail: string; shipmentRef: string | null; shipper: { id: string; name: string; hq: string; initials: string; hue: string }; overdue: boolean
  payToken: string | null; sentAt: string | null; remindersSent: { kind: string; at: string; channel: string; by?: string; step?: string }[]; lastReminderAt: string | null
}
export interface CollectionSettings { autoRemind: boolean; beforeDays: number; afterDays: number[]; sms: boolean; message: string; howToPay: string }
export const payLink = (token: string) => `${window.location.origin}/pay/${token}`

export const collectionsApi = {
  pay: (token: string) => api<{ invoice: InvoiceFull; payment: Payment | null; online: boolean; mode: 'off' | 'test' | 'live'; howToPay: string; contact: { email: string; phone: string } | null }>(`/pay/${token}`),
  checkout: (token: string) => api<{ url: string; paymentId: string }>(`/pay/${token}/checkout`, { json: {} }),
  verify: (token: string) => api<{ invoice: InvoiceFull; payment: Payment | null }>(`/pay/${token}/verify`, { json: {} }),
  mine: () => api<{ invoices: InvoiceFull[]; totals: { outstanding: number; overdue: number } }>('/my/invoices'),
  list: () => api<{ invoices: InvoiceFull[]; settings: CollectionSettings; channels: { email: boolean; sms: boolean }; totals: { outstanding: number; overdue: number; overdueCount: number; collected30: number } }>('/collections'),
  saveSettings: (s: Partial<CollectionSettings>) => api<{ settings: CollectionSettings }>('/collections/settings', { method: 'PUT', json: s }).then((r) => r.settings),
  send: (id: string, kind: 'invoice' | 'reminder' | 'overdue' = 'invoice', note = '') => api<{ invoice: InvoiceFull; channels: string[]; payLink: string }>(`/invoices/${id}/send`, { json: { kind, note } }),
}
