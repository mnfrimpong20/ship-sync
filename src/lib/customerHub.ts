import { api } from './store'

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>
export interface Spending { year: number; years: number[]; total: number; prevTotal: number; shipments: number; invoices: number; outstanding: number; saved: number; comparedBookings: number; byDestination: { key: string; label: string; amount: number }[]; byShipper: { key: string; label: string; amount: number }[]; months: { start: string; spent: number }[]; perUnit: { cargo: string; avg: number; units: number; shipments: number }[] }
export interface OpenInvoice { id: string; number: string; shipper: string; shipmentRef: string | null; total: number; paid: number; balance: number; dueAt: string | null; overdue: boolean; plan: { parts: { due: string; amount: number }[] } | null; payToken: string | null }
export interface Balance { total: number; overdue: number; credit: number; online: boolean; invoices: OpenInvoice[]; history: { amount: number; method: string; at: string; number: string; shipper: string }[] }
export interface CalEvent { date: string; kind: string; title: string; body: string; link: string }
export interface Item { id: string; piece: number | null; description: string; category: string; qty: number; valueUsd: number; flag: { level: 'banned' | 'restricted' | 'check'; note: string } | null }
export interface Thread { kind: 'request' | 'shipment'; id: string; requestId?: string; shipperId?: string; shipmentId?: string; ref: string; shipper: string; lastAt: string; unread: number; last: string }
export interface Message { id: string; role: string; author: string; body: string; photo: string | null; at: string; mine: boolean }

export const hubApi = {
  spending: (year?: number) => api<Spending>(`/me/spending${year ? `?year=${year}` : ''}`),
  balance: () => api<Balance>('/me/balance'),
  pay: (items: { invoiceId: string; amountUsd: number }[], useCredit = true) => api<{ url: string; sessionId: string; charged: number; credit: number }>('/me/pay', { json: { items, useCredit } }),
  verifyPay: (session: string) => api<{ paid: boolean; amount: number; invoices: number }>('/me/pay/verify', { json: { session } }),
  plan: (id: string, parts: number) => api<{ plan: R }>(`/me/invoices/${id}/plan`, { json: { parts } }),
  dropPlan: (id: string) => api(`/me/invoices/${id}/plan`, { method: 'DELETE' }),
  calendar: (days = 30) => api<{ days: number; events: CalEvent[] }>(`/me/calendar?days=${days}`),
  timeline: (id: string) => api<{ next: { title: string; body: string; you: string | null }; eta: string | null; etaOriginal: string | null; slipDays: number; etaChanges: { at: string; to: string | null; from: string | null; reason: string }[] }>(`/me/shipments/${id}/timeline`),
  items: (id: string) => api<{ items: Item[]; totalValueUsd: number; flags: number; canEdit: boolean; categories: string[] }>(`/shipments/${id}/items`),
  addItems: (id: string, items: Partial<Item>[]) => api<{ ok: boolean; declaredValueUsd: number; flagged: number }>(`/shipments/${id}/items`, { json: { items } }),
  updateItem: (id: string, b: Partial<Item>) => api(`/shipment-items/${id}`, { method: 'PATCH', json: b }),
  deleteItem: (id: string) => api(`/shipment-items/${id}`, { method: 'DELETE' }),
  restricted: (destination: string) => api<{ rules: { level: string; note: string }[] }>(`/items/restricted?destination=${destination}`),
  documents: () => api<{ documents: R[]; invoices: R[] }>('/me/documents'),
  family: (id: string) => api<{ link: string; code: string | null; recipient: { name: string; phone: string | null } | null; text: string; whatsapp: string; receipt: { name: string; note: string; allGood: boolean; at: string } | null }>(`/me/shipments/${id}/family`),
  duty: (id: string) => api<{ estimate: { usd: number; local: number; currency: string; basis: string } | null; confirmed: R | null; valueUsd: number; supported: boolean }>(`/me/shipments/${id}/duty`),
  dutyPreview: (b: { destination: string; cargo: string; valueUsd: number; freightUsd?: number }) => api<{ estimate: { usd: number; local: number; currency: string; basis: string } | null }>('/me/duty-preview', { json: b }),
  favorites: () => api<{ favorites: R[]; usedBefore: R[] }>('/me/favorites'),
  favorite: (id: string, on: boolean) => api(`/me/favorites/${id}`, { method: on ? 'PUT' : 'DELETE', json: on ? {} : undefined }),
  repeats: () => api<{ repeats: R[] }>('/me/repeats').then((r) => r.repeats),
  addRepeat: (b: R) => api<{ repeat: R }>('/me/repeats', { json: b }),
  updateRepeat: (id: string, b: R) => api(`/me/repeats/${id}`, { method: 'PATCH', json: b }),
  deleteRepeat: (id: string) => api(`/me/repeats/${id}`, { method: 'DELETE' }),
  postRepeat: (id: string) => api<{ request: R }>(`/me/repeats/${id}/post`, { json: {} }),
  alerts: () => api<{ alerts: R[] }>('/me/alerts').then((r) => r.alerts),
  addAlert: (b: R) => api('/me/alerts', { json: b }),
  deleteAlert: (id: string) => api(`/me/alerts/${id}`, { method: 'DELETE' }),
  inbox: () => api<{ threads: Thread[]; unread: number }>('/me/inbox'),
  shipmentMessages: (id: string) => api<{ messages: Message[] }>(`/shipments/${id}/messages`).then((r) => r.messages),
  sendShipmentMessage: (id: string, body: string, photo?: string) => api(`/shipments/${id}/messages`, { json: { body, photo } }),
  issues: () => api<{ issues: R[] }>('/me/issues').then((r) => r.issues),
  notifyPrefs: () => api<R>('/me/notify-prefs'),
  setNotifyPrefs: (b: R) => api('/me/notify-prefs', { method: 'PUT', json: b }),
  referral: () => api<R>('/me/referral'),
  accounts: () => api<R>('/me/accounts'),
  invite: (email: string, role = 'member') => api<{ ok: boolean; link: string }>('/me/members', { json: { email, role } }),
  removeMember: (id: string) => api(`/me/members/${id}`, { method: 'DELETE' }),
  accept: (token: string) => api<{ ok: boolean; ownerId: string }>('/me/accounts/accept', { json: { token } }),
  switchTo: (ownerId: string | null) => api('/me/accounts/switch', { json: { ownerId } }),
  business: () => api<{ companyName: string; taxId: string; billingAddress: string; poRequired: boolean }>('/me/business'),
  setBusiness: (b: R) => api('/me/business', { method: 'PUT', json: b }),
}
export const statementUrl = (q: { year?: number; month?: string; format?: 'csv' | 'html' }) => `/api/me/statement?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))}`
/** Read an image file as a data URL, scaled down so uploads stay small. */
export function readImage(file: File, max = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader(); fr.onerror = () => reject(new Error('Could not read the photo.'))
    fr.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.8)) }; img.onerror = () => reject(new Error('That file is not an image.')); img.src = String(fr.result) }
    fr.readAsDataURL(file)
  })
}
