import { api } from './store'

export type NotifyKind = 'quote_received' | 'booking_confirmed' | 'shipment_status' | 'quote_accepted' | 'new_lead' | 'container_update' | 'invoice_overdue' | 'system'
export interface Notification { id: string; kind: NotifyKind; title: string; body: string; link: string; at: string; readAt: string | null; emailStatus: 'pending' | 'sent' | 'skipped' | 'failed' }
export interface NotifyPrefs { email: boolean; muted: NotifyKind[] }
export interface NotificationsResponse { notifications: Notification[]; unread: number; prefs: NotifyPrefs; kinds: { id: NotifyKind; label: string }[]; email: { provider: 'resend' | 'log' | 'off'; to: string } }

/** Fired whenever notifications change from anywhere in the app, so the bell and the page stay in step. */
export const NOTIFY_EVENT = 'ss:notifications'
const ping = <T,>(v: T) => { window.dispatchEvent(new Event(NOTIFY_EVENT)); return v }

export const notificationsApi = {
  list: (limit = 50) => api<NotificationsResponse>(`/notifications?limit=${limit}`),
  markRead: (ids?: string[]) => api<{ ok: true; unread: number }>('/notifications/read', { json: ids ? { ids } : {} }).then(ping),
  remove: (id: string) => api<{ ok: true }>(`/notifications/${id}`, { method: 'DELETE' }).then(ping),
  setPrefs: (p: Partial<NotifyPrefs>) => api<{ prefs: NotifyPrefs }>('/notifications/prefs', { method: 'PATCH', json: p }).then((r) => r.prefs),
  sendTest: () => api<{ notification: Notification; error?: string }>('/notifications/test', { json: {} }),
}

export const ago = (iso: string) => {
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.floor(m)}m ago`
  if (m < 60 * 24) return `${Math.floor(m / 60)}h ago`
  if (m < 60 * 24 * 7) return `${Math.floor(m / 1440)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
