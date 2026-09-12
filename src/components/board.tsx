/** Shared building blocks for the workspace boards (Shipments, Leads, Routes, Fleet, Team…): stat cards that filter,
 *  chips, search, a table shell and a pager. Keeps every list page looking and behaving the same. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react'

export function usePaged<T>(list: T[], perPage: number, resetKey: unknown) {
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(list.length / perPage)); const cur = Math.min(page, pages)
  const rows = useMemo(() => list.slice((cur - 1) * perPage, cur * perPage), [list, cur, perPage])
  return { rows, page: cur, pages, setPage, from: list.length ? (cur - 1) * perPage + 1 : 0, to: Math.min(cur * perPage, list.length), total: list.length }
}

export function Pager({ p, noun, note }: { p: ReturnType<typeof usePaged<unknown>>; noun: string; note?: string }) {
  const { page: cur, pages, setPage } = p
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-text-muted">
      <span>{p.total === 0 ? 'No results' : `Showing ${p.from}–${p.to} of ${p.total} ${noun}${p.total === 1 ? '' : 's'}`}{note ? ` · ${note}` : ''}</span>
      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button onClick={() => setPage(cur - 1)} disabled={cur <= 1} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Previous page"><ChevronLeft size={14} /></button>
          {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1).map((n, i, arr) => <span key={n} className="contents">{i > 0 && arr[i - 1] !== n - 1 && <span className="px-1">…</span>}<button onClick={() => setPage(n)} aria-current={n === cur ? 'page' : undefined} className={`h-8 min-w-8 rounded-md border px-2 focus-ring ${n === cur ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border'}`}>{n}</button></span>)}
          <button onClick={() => setPage(cur + 1)} disabled={cur >= pages} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Next page"><ChevronRight size={14} /></button>
        </nav>
      )}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: I, active, warn, onClick }: { label: string; value: ReactNode; hint?: string; icon: LucideIcon; active?: boolean; warn?: boolean; onClick?: () => void }) {
  const cls = `card-dark p-4 text-left transition-colors focus-ring ${onClick ? 'hover:border-gold/40' : ''} ${active ? '!border-gold' : ''} ${warn ? 'border-l-4 border-l-danger' : ''}`
  const body = <><div className="flex items-center justify-between"><p className="text-xs text-text-muted">{label}</p><I size={15} className={warn ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /></div><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>{hint && <p className="text-[11px] text-text-muted">{hint}</p>}</>
  return onClick ? <button onClick={onClick} aria-pressed={!!active} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return <button onClick={onClick} aria-pressed={active} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${active ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{children}{count !== undefined && <span className="ml-1 tabular-nums opacity-70">{count}</span>}</button>
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return <div className="relative min-w-[220px] flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label={label} className="input-dark !min-h-10 !pl-9 text-sm" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></div>
}

export const Th = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <th className={`px-3 py-3 ${className}`}>{children}</th>
export const thead = 'border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted'
export const trow = (open = false, dim = false) => `border-b border-border/70 align-top transition-colors hover:bg-surface-2/60 ${open ? 'bg-surface-2/40' : ''} ${dim ? 'opacity-60' : ''}`

/** The chevron that opens an expandable row. */
export function Expander({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${label}`}><ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
}

/** Little confirm dialog for destructive actions — never do those on a single click. */
export function Confirm({ title, body, confirmLabel, danger = true, busy, onClose, onConfirm }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-h" className="card-dark w-full max-w-md p-6">
        <h2 id="confirm-h" className="!text-lg">{title}</h2>
        <div className="mt-2 text-sm text-text-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button onClick={onConfirm} disabled={busy} className={danger ? 'inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 focus-ring disabled:opacity-60' : 'btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60'}>{busy ? 'Working…' : confirmLabel}</button></div>
      </div>
    </div>
  )
}
