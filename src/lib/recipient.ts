import { api } from './store'

export type RecipientKind = 'notice' | 'sailed' | 'arrived' | 'ready' | 'out_for_delivery' | 'delivered' | 'reminder'
export const recipientKindLabels: Record<RecipientKind, string> = { notice: 'Intro + link', sailed: 'On its way', arrived: 'Arrived at port', ready: 'Ready for collection', out_for_delivery: 'Out for delivery', delivered: 'Delivered — please confirm', reminder: 'Collection reminder' }
export interface RecipientMessage { id: string; shipmentId: string; to: string; channel: 'sms' | 'whatsapp'; kind: RecipientKind; text: string; status: 'pending' | 'sent' | 'skipped' | 'failed'; error: string; attempts: number; createdAt: string | null; sentAt: string | null }
export interface Receipt { name: string; note: string; allGood: boolean; at: string | null }
export interface RecipientInfo {
  token: string; url: string; path: string
  receiver: { name: string; phone: string; phoneE164: string | null; city: string; country: string } | null
  messages: RecipientMessage[]; receipt: Receipt | null
  settings: { enabled: boolean; provider: string; providerLabel: string; channel: 'sms' | 'whatsapp'; appUrl: string } | null; canManage: boolean
}
export interface ReceiverPage {
  shipment: { ref: string; status: string; statusLabel: string; mode: 'air' | 'ocean'; origin: string; destination: string; destinationName: string; port: string; description: string; eta: string | null; sender: string; vesselName: string }
  shipper: { name: string }; receiver: { name: string } | null; readyForCollection: boolean
  events: { status: string; label: string; at: string | null; place: string; note: string }[]
  pieces: { seq: number; status: string }[]; trackUrl: string; receipt: Receipt | null
}

export const recipientApi = {
  forShipment: (shipmentId: string) => api<RecipientInfo>(`/shipments/${shipmentId}/recipient`),
  send: (shipmentId: string, kind: RecipientKind, note = '') => api<{ message: RecipientMessage }>(`/shipments/${shipmentId}/recipient/send`, { json: { kind, note } }).then((r) => r.message),
  settings: () => api<NonNullable<RecipientInfo['settings']>>('/recipient/settings'),
  setEnabled: (enabled: boolean) => api<NonNullable<RecipientInfo['settings']>>('/recipient/settings', { method: 'PATCH', json: { enabled } }),
  page: (token: string) => api<ReceiverPage>(`/r/${encodeURIComponent(token)}`),
  received: (token: string, b: { name: string; note: string; allGood: boolean }) => api<{ ok: true; delivered: boolean }>(`/r/${encodeURIComponent(token)}/received`, { json: b }),
}
/** Link as the receiver will open it from this browser (the server's APP_URL may be unset in dev). */
export const receiverLink = (path: string) => `${location.origin}/#${path}`
export const waLink = (phoneE164: string | null, text: string) => (phoneE164 ? `https://wa.me/${phoneE164.replace('+', '')}?text=${encodeURIComponent(text)}` : null)
