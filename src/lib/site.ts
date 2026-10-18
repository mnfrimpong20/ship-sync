import { useEffect, useState } from 'react'
import { api } from './store'

export interface SiteConfig { email: string; phone: string; whatsapp: string; whatsappUrl: string; address: string; social: Record<string, string>; hoursNote: string; demoHidden: boolean }
export interface SiteStats { shippers: number; verifiedShippers: number; quotes: number; shipments: number; delivered: number; onTimePct: number; destinations: number; requests30?: number }
export interface ContactInput { name: string; email: string; phone: string; company: string; topic: 'quote' | 'tracking' | 'shipper' | 'sourcing' | 'partnership' | 'other'; message: string; website?: string }

export const siteApi = {
  config: () => api<SiteConfig>('/site/config'),
  stats: () => api<SiteStats>('/site/stats'),
  contact: (b: ContactInput) => api<{ ok: true; id: string }>('/site/contact', { json: b }),
  adminMessages: () => api<{ messages: { id: string; name: string; email: string; phone: string; company: string; topic: string; message: string; handled: boolean; createdAt: string }[] }>('/admin/contact').then((r) => r.messages),
  handled: (id: string) => api<{ ok: true }>(`/admin/contact/${id}/handled`, { json: {} }),
  errors: (resolved = false) => api<{ errors: AppError[]; open: number; last24h: number }>(`/admin/errors${resolved ? '?resolved=1' : ''}`),
  resolveError: (id: string) => api<{ ok: true }>(`/admin/errors/${id}/resolve`, { json: {} }),
  resolveAllErrors: () => api<{ ok: true }>('/admin/errors/resolve-all', { json: {} }),
  exports: () => api<{ exports: DbExport[]; nightly: boolean; hourUtc: number; keep: number }>('/admin/exports'),
  runExport: () => api<DbExport & { tables: number }>('/admin/exports/run', { json: {} }),
  system: () => api<SystemInfo>('/admin/system'),
}
export interface AppError { id: string; source: 'api' | 'client' | 'job'; route: string | null; method: string | null; status: number | null; message: string; stack: string | null; userId: string | null; userAgent: string | null; resolvedAt: string | null; createdAt: string }
export interface DbExport { name: string; bytes: number; at?: string }
export interface SystemInfo { version: string | null; node: string; uptimeSec: number; env: string; database: string; demoShippersHidden: boolean; demoAutoQuotes: boolean; email: string; sms: string; whatsapp?: string; stripe: boolean; ais: boolean; terminal49: boolean; appUrl: string | null; contact: { email: boolean; phone: boolean; whatsapp: boolean }; users: { total: number; real: number }; shippers: { total: number; real: number } }

let cached: SiteConfig | null = null
/** Public contact details (cached for the session). */
export function useSiteConfig() {
  const [c, setC] = useState<SiteConfig | null>(cached)
  useEffect(() => { if (cached) return; siteApi.config().then((x) => { cached = x; setC(x) }).catch(() => {}) }, [])
  return c
}

/** Per-route browser title + description + Open Graph tags. */
const TITLES: [RegExp, string, string?][] = [
  [/^\/$/, '', 'Compare verified shippers to Ghana, Nigeria and across West Africa. Clear prices, protected payments, tracked all the way home.'],
  [/^\/for-shippers/, 'For shipping companies', 'Run your shipping business on Ntemtem: matched leads, rate cards, containers, warehouse scanning, protected payments and more.'],
  [/^\/quote/, 'Get freight quotes', 'Post your shipment once and let verified shippers compete with itemised quotes.'],
  [/^\/shippers\/[^/]+/, 'Shipper profile'], [/^\/shippers/, 'Verified shippers directory'], [/^\/track/, 'Track a shipment'], [/^\/duty/, 'Duty & landed-cost estimator'],
  [/^\/groupage/, 'Fill a barrel — shared barrels & containers'], [/^\/brokers/, 'Customs brokers'], [/^\/sailings/, 'Sailing schedule'], [/^\/lanes/, 'Lane prices'], [/^\/live/, 'Live map'],
  [/^\/sourcing\/new/, 'Start a sourcing request'], [/^\/sourcing\/[^/]+/, 'Sourcing request'], [/^\/sourcing/, 'Source from China, the UK and the USA', 'Our own team finds the factory, wholesaler or store, buys in Ntemtem’s name, inspects and ships it to you.'],
  [/^\/about/, 'About Ntemtem'], [/^\/contact/, 'Contact us'], [/^\/privacy/, 'Privacy policy'], [/^\/terms/, 'Terms of service'], [/^\/shipper-agreement/, 'Shipper agreement'],
  [/^\/s\//, 'Supplier portal · 供应商门户'], [/^\/order\//, 'Place your order'], [/^\/login/, 'Sign in'], [/^\/forgot/, 'Reset your password'], [/^\/reset/, 'Choose a new password'], [/^\/signup/, 'Create an account'], [/^\/dashboard\/shipper/, 'Shipper workspace'], [/^\/dashboard\/sourcing/, 'Sourcing board'], [/^\/dashboard\/verification/, 'Verification'], [/^\/dashboard\/(\w+)/, 'Workspace'], [/^\/dashboard/, 'My dashboard'], [/^\/admin/, 'Admin'],
]
const DEFAULT_DESC = 'Ntemtem — Twi for quickly-quickly — connects you with verified air and ocean shippers carrying boxes, barrels, cars and cargo home to Ghana, Nigeria and across West Africa.'
export function applyPageMeta(pathname: string) {
  const hit = TITLES.find(([re]) => re.test(pathname))
  const HOME_TITLE = 'Ntemtem — Send it. Shipping home to Ghana & West Africa'
  const title = hit && hit[1] ? `${hit[1]} · Ntemtem` : HOME_TITLE
  const desc = hit?.[2] ?? DEFAULT_DESC
  document.title = title
  const set = (sel: string, attr: string, val: string) => { let el = document.head.querySelector<HTMLMetaElement>(sel); if (!el) { el = document.createElement('meta'); const [k, v] = sel.replace('meta[', '').replace(']', '').split('='); el.setAttribute(k, v.replace(/"/g, '')); document.head.appendChild(el) } el.setAttribute(attr, val) }
  set('meta[name="description"]', 'content', desc); set('meta[property="og:title"]', 'content', title); set('meta[property="og:description"]', 'content', desc); set('meta[property="og:url"]', 'content', `${location.origin}/#${pathname}`)
}
