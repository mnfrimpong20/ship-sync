import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Building2, FileText, Package, Search, UserRound } from 'lucide-react'
import { api, useStore } from '../lib/store'
import { clientsApi, type Client } from '../lib/clients'
import { countryByCode } from '../lib/data'
import { useT } from '../lib/i18n'

export interface QuickPage { to: string; label: string; group?: string }
interface Hit { key: string; kind: 'page' | 'shipment' | 'client' | 'company'; label: string; sub: string; to: string }
type AdminHits = { shippers: { id: string; name: string; verified: boolean; plan: string; archived: boolean }[]; users: { id: string; name: string; email: string; role: string; company: string | null }[]; shipments: { id: string; ref: string; customer: string; status: string; route: string; shipper: string }[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Every word typed must appear somewhere; earlier matches rank higher. */
function score(hay: string, words: string[]) { const h = norm(hay); let sc = 0; for (const w of words) { const i = h.indexOf(w); if (i < 0) return -1; sc += i === 0 ? 3 : h[i - 1] === ' ' ? 2 : 1 } return sc }

/**
 * Ctrl+K (⌘K on Mac) — jump to any page, shipment or client by typing a few letters.
 * The button in the top bar opens the same box, for touch screens.
 */
export function QuickSearch({ pages, isShipper, admin = false }: { pages: QuickPage[]; isShipper: boolean; admin?: boolean }) {
  const { shipments } = useStore(); const nav = useNavigate(); const t = useT()
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [i, setI] = useState(0)
  const [clients, setClients] = useState<Client[] | null>(null)
  const [adm, setAdm] = useState<AdminHits | null>(null)
  useEffect(() => { if (!admin || !open) return; const term = q.trim(); if (term.length < 2) { setAdm(null); return } const h = setTimeout(() => { api<AdminHits>(`/admin/search?q=${encodeURIComponent(term)}`).then(setAdm).catch(() => setAdm(null)) }, 180); return () => clearTimeout(h) }, [q, admin, open])
  const input = useRef<HTMLInputElement>(null); const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); opener.current = document.activeElement as HTMLElement; setOpen((v) => !v) } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 20); if (isShipper && clients === null) clientsApi.list().then(setClients).catch(() => setClients([])) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); setTimeout(() => opener.current?.focus(), 20) }

  const hits = useMemo<Hit[]>(() => {
    const words = norm(q.trim()).split(/\s+/).filter(Boolean)
    const pageHits = pages.map((p) => ({ key: 'p' + p.to, kind: 'page' as const, label: p.label, sub: p.group ?? '', to: p.to, s: words.length ? score(`${p.label} ${p.group ?? ''}`, words) : 0 }))
    if (!words.length) return pageHits.slice(0, 8)
    if (admin) {
      const top = pageHits.filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 4)
      const a = adm ?? { shippers: [], users: [], shipments: [] }
      return [...top,
        ...a.shipments.map((x) => ({ key: 'as' + x.id, kind: 'shipment' as const, label: `${x.ref} · ${x.customer}`, sub: `${x.route} · ${x.shipper} · ${x.status.replace(/_/g, ' ')}`, to: `/admin?view=shipment&id=${x.id}` })),
        ...a.shippers.map((x) => ({ key: 'ac' + x.id, kind: 'company' as const, label: x.name, sub: [x.archived ? 'archived' : x.verified ? 'verified' : 'not verified', x.plan].filter(Boolean).join(' · '), to: `/admin?view=shippers&f=all&q=${encodeURIComponent(x.name)}` })),
        ...a.users.map((x) => ({ key: 'au' + x.id, kind: 'client' as const, label: x.name, sub: [x.email, x.role, x.company].filter(Boolean).join(' · '), to: `/admin?view=support&q=${encodeURIComponent(x.email)}` })),
      ]
    }
    const shipHits = shipments.map((s) => { const dest = countryByCode(s.destination)?.name ?? s.destination; return { key: 's' + s.id, kind: 'shipment' as const, label: `${s.ref} · ${s.customer}`, sub: `${s.origin} → ${dest} · ${s.description || s.cargo}`, to: isShipper ? `/dashboard/shipments?b=all&q=${encodeURIComponent(s.ref)}` : `/dashboard?tab=shipments&s=${s.id}`, s: score(`${s.ref} ${s.customer} ${s.origin} ${dest} ${s.description} ${s.vesselName ?? ''} ${s.flight ?? ''}`, words) } })
    const clientHits = (clients ?? []).map((c) => ({ key: 'c' + c.id, kind: 'client' as const, label: c.name, sub: [c.company, c.city, c.phone].filter(Boolean).join(' · '), to: `/dashboard/clients/${c.id}`, s: score(`${c.name} ${c.company} ${c.city} ${c.email} ${c.phone}`, words) }))
    const take = <T extends { s: number }>(xs: T[], n: number) => xs.filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, n)
    return [...take(pageHits, 5), ...take(shipHits, 6), ...take(clientHits, 5)]
  }, [q, pages, shipments, clients, isShipper, admin, adm])
  useEffect(() => { setI(0) }, [q])
  const go = (h?: Hit) => { if (!h) return; setOpen(false); nav(h.to) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[i]) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  }
  const Icon = { page: FileText, shipment: Package, client: UserRound, company: Building2 }
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <>
      <button onClick={() => { opener.current = document.activeElement as HTMLElement; setOpen(true) }} className="flex h-10 items-center gap-2 rounded-lg border border-border px-2.5 text-sm text-text-muted hover:text-text focus-ring sm:min-w-[13rem] sm:px-3" aria-label={t('Search')} data-testid="quick-search-btn">
        <Search size={16} aria-hidden="true" /><span className="hidden sm:inline">{admin ? 'Find a company, person or shipment' : isShipper ? t('Find a shipment, client or page') : t('Search')}</span><kbd className="ml-auto hidden rounded border border-border px-1.5 text-xs font-sans sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <AnimatePresence>{open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={close}>
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} role="dialog" aria-modal="true" aria-label={t('Search')} className="card-dark w-full max-w-xl overflow-hidden p-0" onMouseDown={(e) => e.stopPropagation()} data-testid="quick-search">
            <div className="flex items-center gap-2 border-b border-border px-4"><Search size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} role="combobox" aria-expanded="true" aria-controls="qs-list" aria-activedescendant={hits[i] ? `qs-${i}` : undefined} aria-autocomplete="list" aria-label={t('Search')} placeholder={admin ? 'Company, email, name, reference or page…' : isShipper ? t('Reference, client, place or page…') : t('Reference, place or page…')} className="h-14 w-full bg-transparent text-base outline-none placeholder:text-text-muted" data-testid="quick-search-input" />
              <kbd className="hidden rounded border border-border px-1.5 text-xs text-text-muted sm:inline">Esc</kbd>
            </div>
            <ul id="qs-list" role="listbox" aria-label={t('Results')} className="max-h-[60vh] overflow-y-auto p-2">
              {hits.length === 0 && !(admin && q.trim().length >= 2 && adm === null) && <li className="px-3 py-6 text-center text-sm text-text-muted">{t('Nothing matches “{q}”.', { q })}</li>}
              {hits.map((h, k) => { const I = Icon[h.kind]; const first = k === 0 || hits[k - 1].kind !== h.kind; return (
                <li key={h.key} role="presentation">
                  {first && q && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-text-muted" role="presentation">{t(h.kind === 'page' ? 'Pages' : h.kind === 'shipment' ? 'Shipments' : h.kind === 'company' ? 'Shipping companies' : admin ? 'People' : 'Clients')}</p>}
                  <div id={`qs-${k}`} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => go(h)} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${k === i ? 'bg-gold/15' : ''}`} data-testid="quick-hit">
                    <I size={16} className="shrink-0 text-gold-deep" aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{h.label}</span>{h.sub && <span className="block truncate text-xs text-text-muted">{h.sub}</span>}</span>
                    {k === i && <ArrowRight size={15} className="text-text-muted" aria-hidden="true" />}
                  </div>
                </li>
              ) })}
            </ul>
            <p className="border-t border-border px-4 py-2 text-xs text-text-muted">↑ ↓ {t('to move')} · Enter {t('to open')} · Esc {t('to close')}</p>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>
    </>
  )
}
