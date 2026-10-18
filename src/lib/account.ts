import { useEffect, useState } from 'react'
import { api } from './store'

export interface ChecklistItem { id: 'phone' | 'recipient' | 'request' | 'alerts' | 'family'; label: string; done: boolean; link: string }
export interface Summary { owe: number; overdue: number; credit: number; unread: number; openRequests: number; quotesWaiting: number; activeShipments: number; delivered: number; dueByShipment: Record<string, number>; checklist: ChecklistItem[]; checklistDone: number }
export interface Profile { name: string; email: string; phone: string; createdAt: string | null; actingFor: string | null }
export interface Device { key: string; current: boolean; device: string; createdAt: string | null; lastSeenAt: string | null }
/** Fired after anything that changes the menu counts (payments, reading messages). */
export const SUMMARY_EVENT = 'ss:summary'
export const refreshSummary = () => window.dispatchEvent(new Event(SUMMARY_EVENT))

export const accountApi = {
  summary: () => api<Summary>('/me/summary'),
  profile: () => api<Profile>('/me/profile'),
  setProfile: (b: { name?: string; phone?: string }) => api<{ ok: boolean }>('/me/profile', { method: 'PATCH', json: b }),
  password: (current: string, next: string) => api<{ ok: boolean; signedOut: number }>('/me/password', { json: { current, next } }),
  sessions: () => api<{ sessions: Device[] }>('/me/sessions').then((r) => r.sessions),
  revoke: (key: string) => api(`/me/sessions/${key}`, { method: 'DELETE' }),
  revokeOthers: () => api<{ ok: boolean; signedOut: number }>('/me/sessions/revoke-others', { json: {} }),
  exportUrl: '/api/me/export',
  remove: (password: string) => api<{ ok: boolean }>('/me/delete', { json: { password, confirm: 'DELETE' } }),
}

/** Live counts for the overview and the menu badges. One shared fetch for every component that asks; refetched when refreshSummary() fires. */
let cached: Summary | null = null; let inflight: Promise<void> | null = null; const subs = new Set<(s: Summary) => void>()
const fetchSummary = () => { if (!inflight) inflight = accountApi.summary().then((s) => { cached = s; subs.forEach((f) => f(s)) }).catch(() => {}).finally(() => { inflight = null }); return inflight }
if (typeof window !== 'undefined') window.addEventListener(SUMMARY_EVENT, () => { void fetchSummary() })
export function useSummary(enabled = true) {
  const [s, setS] = useState<Summary | null>(cached)
  useEffect(() => {
    if (!enabled) return
    subs.add(setS); if (!cached) void fetchSummary(); else setS(cached)
    return () => { subs.delete(setS) }
  }, [enabled])
  return enabled ? s : null
}
