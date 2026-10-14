import { api, type QuoteRequest } from './store'

export interface RequestMessage { id: string; from: 'customer' | 'shipper'; name: string; body: string; masked: boolean; at: string; read: boolean }
export interface RequestEdit { readyDate?: string; quantity?: number; weightKg?: number | null; dims?: string; declaredValueUsd?: number | null; description?: string; pickup?: boolean; delivery?: boolean; insurance?: boolean; contact?: { phone: string } }

export const requestsApi = {
  edit: (id: string, b: RequestEdit) => api<{ request: QuoteRequest; changed: string[] }>(`/requests/${id}`, { method: 'PATCH', json: b }),
  cancel: (id: string, reason: string) => api<{ request: QuoteRequest }>(`/requests/${id}/cancel`, { json: { reason } }).then((r) => r.request),
  openMarket: (id: string) => api<{ request: QuoteRequest; from: string }>(`/requests/${id}/open-market`, { json: {} }),
  withdraw: (quoteId: string, reason: string) => api<{ ok: true }>(`/quotes/${quoteId}/withdraw`, { json: { reason } }),
  messages: (id: string, shipperId?: string) => api<{ messages: RequestMessage[]; contactsShared: boolean }>(`/requests/${id}/messages${shipperId ? `?shipperId=${encodeURIComponent(shipperId)}` : ''}`),
  send: (id: string, body: string, shipperId?: string) => api<{ message: RequestMessage }>(`/requests/${id}/messages`, { json: { body, shipperId } }).then((r) => r.message),
}

/** What the client asked for vs what a quote includes. */
export function missingServices(r: Pick<QuoteRequest, 'pickup' | 'delivery' | 'insurance'>, includes: string[]) {
  const has = (re: RegExp) => includes.some((i) => re.test(i))
  const out: string[] = []
  if (r.pickup && !has(/pickup/i)) out.push('pickup')
  if (r.delivery && !has(/door delivery/i)) out.push('door delivery')
  if (r.insurance && !has(/insurance/i)) out.push('insurance')
  return out
}
