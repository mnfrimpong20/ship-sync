import { api } from './store'
import type { CargoType, Mode, Shipment } from './data'

export interface Client {
  id: string; shipperId: string; userId?: string; name: string; company: string; email: string; phone: string; whatsapp: string; city: string
  tags: string[]; notes: string; source: 'marketplace' | 'manual'; status: 'active' | 'archived'; createdAt: string; updatedAt: string
  shipmentCount?: number; activeShipments?: number; invoiced?: number; paid?: number; lastActivityAt?: string; nextReminderAt?: string
}
export type ClientInput = Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'whatsapp' | 'city' | 'tags' | 'notes'>
export interface Consignee { id: string; clientId: string; name: string; phone: string; address: string; city: string; country: string; relationship: string; isDefault: boolean }
export type ConsigneeInput = Omit<Consignee, 'id' | 'clientId'>
export type ActivityType = 'note' | 'call' | 'email' | 'whatsapp' | 'meeting' | 'reminder' | 'system'
export interface Activity { id: string; clientId: string; type: ActivityType; body: string; at: string; dueAt?: string; done: boolean; createdBy?: string; clientName?: string }
export interface InvoiceItem { description: string; qty: number; unit: number }
export interface Payment { id: string; amount: number; method: string; at: string; note: string }
export interface Invoice {
  id: string; clientId: string; shipmentId?: string; number: string; status: 'draft' | 'sent' | 'paid' | 'void'; currency: string
  items: InvoiceItem[]; subtotal: number; tax: number; total: number; paid: number; balance: number; issuedAt: string; dueAt: string | null; notes: string; createdAt: string; payments: Payment[]
}
export interface ClientDetail { client: Client; consignees: Consignee[]; activities: Activity[]; shipments: Shipment[]; invoices: Invoice[] }
export interface BookingInput { mode: Mode; origin: string; destination: string; cargo: CargoType; description: string; eta: string; consigneeId?: string; note?: string }
export interface InvoiceInput { shipmentId?: string; items: InvoiceItem[]; tax: number; issuedAt?: string; dueAt?: string; notes: string; status: 'draft' | 'sent' }

export const clientsApi = {
  list: () => api<{ clients: Client[] }>('/clients').then((r) => r.clients),
  create: (c: ClientInput) => api<{ client: Client }>('/clients', { json: c }).then((r) => r.client),
  get: (id: string) => api<ClientDetail>(`/clients/${id}`),
  update: (id: string, p: Partial<ClientInput> & { status?: Client['status'] }) => api<{ client: Client }>(`/clients/${id}`, { method: 'PATCH', json: p }).then((r) => r.client),
  addConsignee: (id: string, c: ConsigneeInput) => api<{ consignees: Consignee[] }>(`/clients/${id}/consignees`, { json: c }).then((r) => r.consignees),
  updateConsignee: (id: string, c: Partial<ConsigneeInput>) => api<{ consignees: Consignee[] }>(`/consignees/${id}`, { method: 'PATCH', json: c }).then((r) => r.consignees),
  deleteConsignee: (id: string) => api<{ consignees: Consignee[] }>(`/consignees/${id}`, { method: 'DELETE' }).then((r) => r.consignees),
  addActivity: (id: string, a: { type: Exclude<ActivityType, 'system'>; body: string; dueAt?: string }) => api<{ activities: Activity[] }>(`/clients/${id}/activities`, { json: a }).then((r) => r.activities),
  updateActivity: (id: string, p: { body?: string; done?: boolean; dueAt?: string | null }) => api<{ activities: Activity[] }>(`/activities/${id}`, { method: 'PATCH', json: p }).then((r) => r.activities),
  deleteActivity: (id: string) => api<{ activities: Activity[] }>(`/activities/${id}`, { method: 'DELETE' }).then((r) => r.activities),
  remindersDue: () => api<{ reminders: Activity[] }>('/clients/reminders/due').then((r) => r.reminders),
  book: (id: string, b: BookingInput) => api<{ shipment: Shipment }>(`/clients/${id}/shipments`, { json: b }).then((r) => r.shipment),
  createInvoice: (id: string, i: InvoiceInput) => api<{ invoice: Invoice }>(`/clients/${id}/invoices`, { json: i }).then((r) => r.invoice),
  updateInvoice: (id: string, p: { status?: 'draft' | 'sent' | 'void'; dueAt?: string | null; notes?: string }) => api<{ invoice: Invoice }>(`/invoices/${id}`, { method: 'PATCH', json: p }).then((r) => r.invoice),
  addPayment: (id: string, p: { amount: number; method: string; at?: string; note?: string }) => api<{ invoice: Invoice }>(`/invoices/${id}/payments`, { json: p }).then((r) => r.invoice),
  invoice: (id: string) => api<{ invoice: Invoice; client: Client; shipper: { id: string; name: string; hq: string; initials: string; hue: string }; shipment: Shipment | null }>(`/invoices/${id}`),
}

export const activityLabel: Record<ActivityType, string> = { note: 'Note', call: 'Call', email: 'Email', whatsapp: 'WhatsApp', meeting: 'Meeting', reminder: 'Reminder', system: 'Ship Sync' }
export const paymentMethods: [string, string][] = [['bank', 'Bank transfer'], ['cash', 'Cash'], ['card', 'Card'], ['mobile_money', 'Mobile money'], ['other', 'Other']]
