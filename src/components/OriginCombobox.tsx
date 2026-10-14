import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, MapPin, Search } from 'lucide-react'
import { api } from '../lib/store'
import { origins as fallback } from '../lib/data'

interface OriginOption { city: string; shippers: number; curated: boolean }
let cached: OriginOption[] | null = null

/**
 * "Shipping from": a searchable list of pickup cities — the curated ones plus every verified shipper's declared
 * origins, ranked by how many shippers collect there — and a city that isn't listed is accepted as typed.
 */
export function OriginCombobox({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [opts, setOpts] = useState<OriginOption[]>(cached ?? fallback.map((city) => ({ city, shippers: 0, curated: true })))
  const [q, setQ] = useState(value)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  useEffect(() => { if (cached) return; api<{ origins: OriginOption[] }>('/meta/origins').then((r) => { cached = r.origins; setOpts(r.origins) }).catch(() => {}) }, [])
  useEffect(() => { setQ(value) }, [value])
  useEffect(() => { const on = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQ(value) } }; document.addEventListener('mousedown', on); return () => document.removeEventListener('mousedown', on) }, [value])
  const ql = q.trim().toLowerCase()
  const browsing = q === value // opened without editing: show the whole list, current pick first
  const filtered = useMemo(() => {
    const list = browsing || !ql ? [...opts].sort((a, b) => (b.city === value ? 1 : 0) - (a.city === value ? 1 : 0)) : opts.filter((o) => o.city.toLowerCase().includes(ql))
    return list.slice(0, browsing ? 30 : 12)
  }, [opts, ql, browsing, value])
  const exact = opts.some((o) => o.city.toLowerCase() === ql)
  const canUseTyped = ql.length >= 2 && !exact && !browsing
  const rows: { label: string; value: string; sub?: string; typed?: boolean }[] = [
    ...filtered.map((o) => ({ label: o.city, value: o.city, sub: o.shippers ? `${o.shippers} shipper${o.shippers === 1 ? ' collects' : 's collect'} here` : undefined })),
    ...(canUseTyped ? [{ label: `Use “${q.trim()}”`, value: q.trim(), sub: 'Not listed — shippers near you can still quote it', typed: true }] : []),
  ]
  const pick = (v: string) => { onChange(v); setQ(v); setOpen(false) }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) pick(rows[hi].value) }
    else if (e.key === 'Escape') { setOpen(false); setQ(value) }
  }
  return (
    <div ref={box} className="relative" data-testid="origin-combobox">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && rows[hi] ? `${listId}-${hi}` : undefined} className="input-dark !pl-9 !pr-9" value={q} placeholder="City, e.g. Houston, TX" autoComplete="off" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }} onKeyDown={onKey} onBlur={() => { if (canUseTyped && !open) onChange(q.trim()) }} />
        <button type="button" aria-label="Show cities" onClick={() => setOpen((o) => !o)} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-text-muted hover:text-text focus-ring"><ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      </div>
      {open && rows.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-surface py-1 shadow-xl">
          {rows.map((r, i) => (
            <li key={r.value + (r.typed ? '-typed' : '')} id={`${listId}-${i}`} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(r.value) }} className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === hi ? 'bg-gold/15' : ''} ${r.typed ? 'border-t border-border' : ''}`}>
              <MapPin size={14} className={`mt-0.5 shrink-0 ${r.typed ? 'text-text-muted' : 'text-gold-deep'}`} aria-hidden="true" />
              <span className="min-w-0"><span className="block">{r.label}</span>{r.sub && <span className="block text-xs text-text-muted">{r.sub}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      {open && rows.length === 0 && <p className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-muted shadow-xl">Keep typing — two letters or more.</p>}
    </div>
  )
}
