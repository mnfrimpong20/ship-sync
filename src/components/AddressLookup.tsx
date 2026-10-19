import { useEffect, useRef, useState } from 'react'
import { Check, MapPin, Search } from 'lucide-react'
import { gpsRegion, isGps, mapLink, normaliseGps } from '../lib/address'

export interface AddressValue { address: string; city: string; gps?: string; lat?: number | null; lng?: number | null }
interface Hit { label: string; sub: string; address: string; city: string; lat: number; lng: number }

/** Rough centre of each destination so results stay in the right country. */
const BIAS: Record<string, [number, number]> = { GH: [5.6037, -0.187], NG: [6.5244, 3.3792], LR: [6.3156, -10.8074], TG: [6.1375, 1.2123], CI: [5.36, -4.0083], SL: [8.4657, -13.2317], SN: [14.7167, -17.4677], BJ: [6.3703, 2.3912], KE: [-1.2921, 36.8219], CM: [4.0511, 9.7679] }

/**
 * Address search (OpenStreetMap via Photon) that fills the street/landmark, town and a map pin,
 * plus a Ghana Post GPS digital address field when the country is Ghana. Typing by hand still works.
 */
export function AddressLookup({ country, value, onChange, compact = false, labels }: { country: string; value: AddressValue; onChange: (patch: Partial<AddressValue>) => void; compact?: boolean; labels?: { address?: string; city?: string } }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const [lat, lon] = BIAS[country] ?? [0, 0]
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${BIAS[country] ? `&lat=${lat}&lon=${lon}` : ''}`, { signal: ctl.signal })
        const j = await r.json() as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }
        const out = j.features.filter((f) => !country || String(f.properties.countrycode ?? '').toUpperCase() === country).slice(0, 5).map((f) => {
          const p = f.properties
          const street = [p.housenumber, p.street].filter(Boolean).join(' ')
          const address = [p.name && p.name !== p.street ? p.name : '', street, p.district || p.locality || ''].filter(Boolean).join(', ')
          const city = p.city || p.town || p.village || p.county || p.state || ''
          return { label: p.name || street || city, sub: [street && p.name ? street : '', p.district, city, p.state].filter(Boolean).join(' · '), address: address || city, city, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
        })
        setHits(out); setOpen(true)
      } catch { /* offline or aborted — manual entry still works */ } finally { setBusy(false) }
    }, 350)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, country])
  useEffect(() => { const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [])
  const pick = (h: Hit) => { onChange({ address: h.address, city: h.city, lat: h.lat, lng: h.lng }); setQ(''); setHits([]); setOpen(false) }
  const pinned = value.lat != null && value.lng != null
  const gpsBad = !!value.gps && !isGps(value.gps)
  const cls = compact ? 'input-dark !min-h-9 text-sm' : 'input-dark'
  return (
    <div className="grid gap-3" data-testid="address-lookup">
      <div ref={box} className="relative">
        <label className="grid gap-1 text-sm">
          <span className="text-text-muted">Find the address <span className="text-xs">(street, area, landmark)</span></span>
          <span className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input className={`${cls} !pl-9`} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} placeholder={country === 'GH' ? 'e.g. Spintex Road, Accra' : 'Start typing…'} role="combobox" aria-expanded={open} aria-controls="addr-hits" aria-autocomplete="list" data-testid="address-search" />
            {busy && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">…</span>}
          </span>
        </label>
        {open && hits.length > 0 && (
          <ul id="addr-hits" role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
            {hits.map((h, i) => <li key={i} role="option" aria-selected="false"><button type="button" onClick={() => pick(h)} className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"><MapPin size={14} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span className="min-w-0"><span className="block truncate">{h.label}</span><span className="block truncate text-xs text-text-muted">{h.sub}</span></span></button></li>)}
            <li className="px-3 py-1.5 text-[10px] text-text-muted">© OpenStreetMap contributors</li>
          </ul>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="grid gap-1 text-sm"><span className="text-text-muted">{labels?.address ?? 'Address or landmark'}</span><input className={cls} value={value.address} onChange={(e) => onChange({ address: e.target.value, lat: null, lng: null })} /></label>
        <label className="grid gap-1 text-sm"><span className="text-text-muted">{labels?.city ?? 'Town / city'}</span><input className={cls} value={value.city} onChange={(e) => onChange({ city: e.target.value })} /></label>
      </div>
      {country === 'GH' && (
        <label className="grid gap-1 text-sm">
          <span className="text-text-muted">GhanaPost GPS address <span className="text-xs">(optional — on the GhanaPost GPS app)</span></span>
          <input className={`${cls} font-mono uppercase ${gpsBad ? '!border-danger' : ''}`} value={value.gps ?? ''} maxLength={14} placeholder="GA-183-8164" onChange={(e) => onChange({ gps: e.target.value })} onBlur={() => { const g = normaliseGps(value.gps); if (g) onChange({ gps: g }) }} data-testid="gps-input" aria-invalid={gpsBad} />
          {gpsBad ? <span className="text-xs text-danger">A GhanaPost GPS address looks like GA-183-8164.</span> : value.gps && <span className="text-xs text-text-muted">{gpsRegion(value.gps)}</span>}
        </label>
      )}
      {pinned && <p className="inline-flex items-center gap-1.5 text-xs text-teal"><Check size={13} aria-hidden="true" /> Pinned on the map for the driver · <a className="text-gold-deep hover:underline" href={mapLink(value)} target="_blank" rel="noopener">check</a></p>}
    </div>
  )
}
