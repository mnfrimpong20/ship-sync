import { api } from './store'

export interface Ticket { id: string; ref: string; subject: string; category: 'shipment' | 'payment' | 'account' | 'shipper' | 'damage' | 'other'; status: 'open' | 'waiting' | 'solved'; priority: 'normal' | 'high'; shipmentRef: string; name?: string; email?: string; role?: string; source: 'app' | 'contact'; assignedTo?: string; createdAt: string | null; updatedAt: string | null; firstResponseAt?: string | null; lastFrom: 'person' | 'staff'; messages?: number }
export interface TicketMessage { id: string; body: string; fromStaff: boolean; authorName: string; internal: boolean; at: string | null }
export const ticketCategoryLabels: Record<Ticket['category'], string> = { shipment: 'A shipment', payment: 'Payment or refund', damage: 'Damage or loss', shipper: 'A shipping company', account: 'My account', other: 'Something else' }

export const supportApi = {
  mine: () => api<{ tickets: Ticket[] }>('/support/tickets').then((r) => r.tickets),
  create: (b: { subject: string; category: Ticket['category']; shipmentRef: string; body: string }) => api<{ ticket: Ticket }>('/support/tickets', { json: b }).then((r) => r.ticket),
  get: (id: string) => api<{ ticket: Ticket; messages: TicketMessage[] }>(`/support/tickets/${id}`),
  reply: (id: string, body: string) => api<{ messages: TicketMessage[] }>(`/support/tickets/${id}/messages`, { json: { body } }).then((r) => r.messages),
  solved: (id: string) => api<{ ok: true }>(`/support/tickets/${id}/solved`, { json: {} }),
  adminList: (status: 'active' | 'solved' | 'all') => api<{ tickets: Ticket[]; stats: { open: number; waiting: number; solved7: number; firstResponseHours: number } }>(`/admin/tickets?status=${status}`),
  adminGet: (id: string) => api<{ ticket: Ticket; messages: TicketMessage[]; recentShipments: { ref: string; status: string; origin: string; destination: string }[] }>(`/admin/tickets/${id}`),
  adminReply: (id: string, b: { body: string; internal: boolean; status?: Ticket['status'] }) => api<{ ticket: Ticket; messages: TicketMessage[] }>(`/admin/tickets/${id}/reply`, { json: b }),
  adminPatch: (id: string, b: { status?: Ticket['status']; priority?: Ticket['priority'] }) => api<{ ok: true }>(`/admin/tickets/${id}`, { method: 'PATCH', json: b }),
}
