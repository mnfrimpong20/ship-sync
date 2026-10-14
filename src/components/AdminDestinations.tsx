import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Pencil, Plus } from 'lucide-react'
import { api } from '../lib/store'
import { Pill } from './ui'

export interface Destination { code: string; name: string; flag: string; ports: string[]; airports: string[]; oceanDays: string; airDays: string; note: string; dialCode: string; active: boolean; sort: number }
const destApi = {
  list: () => api<{ destinations: Destination[] }>('/admin/destinations').then((r) => r.destinations),
  save: (code: string, b: Omit<Destination, 'code'>) => api<{ destination: Destination }>(`/admin/destinations/${code}`, { method: 'PUT', json: b }).then((r) => r.destination),
  active: (code: string, active: boolean, force = false) => api<{ destination: Destination }>(`/admin/destinations/${code}/active${force ? '?force=1' : ''}`, { json: { active } }).then((r) => r.destination),
}
const blank = (): Destination => ({ code: '', name: '', flag: '', ports: [], airports: [], oceanDays: '', airDays: '', note: '', dialCode: '', active: true, sort: 0 })
const split = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)

/** Admin → Destinations: the countries customers can ship to, with ports, airports, transit days and dial codes. Live everywhere within a minute. */
export function AdminDestinations() {
  const [list, setList] = useState<Destination[] | null>(null)
  const [editing, setEditing] = useState<Destination | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = () => destApi.list().then(setList).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { load() }, [])
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editing) return
    if (!/^[A-Za-z]{2}$/.test(editing.code)) return setErr('Use the two-letter ISO country code, e.g. CM for Cameroon.')
    if (editing.name.trim().length < 2) return setErr('Enter the country name.')
    setBusy(true); setErr('')
    try { const { code, ...rest } = editing; await destApi.save(code.toUpperCase(), rest); setEditing(null); setIsNew(false); await load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not save.') } finally { setBusy(false) }
  }
  const toggle = async (d: Destination) => {
    setBusy(true); setErr('')
    try { await destApi.active(d.code, !d.active) } catch (er) {
      const msg = er instanceof Error ? er.message : ''
      if (/force=1/.test(msg) && confirm(`${msg.replace(' Add ?force=1 to hide it anyway.', '')}\n\nHide it anyway? Customers won’t be able to pick it; existing shipments are unaffected.`)) { try { await destApi.active(d.code, false, true) } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed.') } }
      else setErr(msg || 'Failed.')
    } finally { setBusy(false); await load() }
  }
  const Field = ({ label, k, placeholder, hint }: { label: string; k: keyof Destination; placeholder?: string; hint?: string }) => (
    <label className="grid gap-1 text-xs"><span className="text-text-muted">{label}</span><input className="input-dark !min-h-10" value={Array.isArray(editing![k]) ? (editing![k] as string[]).join(', ') : String(editing![k] ?? '')} placeholder={placeholder} onChange={(e) => setEditing({ ...editing!, [k]: Array.isArray(editing![k]) ? split(e.target.value) : e.target.value })} disabled={k === 'code' && !isNew} data-testid={`dest-${k}`} />{hint && <span className="text-[11px] text-text-muted">{hint}</span>}</label>
  )
  return (
    <div className="mt-8" data-testid="admin-destinations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">Countries customers can ship to. Changes reach the quote form, directory filters, footer and duty estimator within a minute — no code push.</p>
        {!editing && <button onClick={() => { setEditing(blank()); setIsNew(true) }} className="btn-gold !min-h-10 text-sm" data-testid="add-destination"><Plus size={16} aria-hidden="true" /> Add a destination</button>}
      </div>
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      {editing && (
        <form onSubmit={save} className="card-dark mt-4 grid gap-3 p-5 md:grid-cols-2" aria-label={isNew ? 'New destination' : `Edit ${editing.name}`} data-testid="destination-form">
          <Field label="ISO code" k="code" placeholder="CM" hint={isNew ? 'Two letters. The flag is generated from it.' : undefined} />
          <Field label="Country name" k="name" placeholder="Cameroon" />
          <Field label="Sea ports (comma-separated)" k="ports" placeholder="Douala, Kribi" />
          <Field label="Airports (comma-separated)" k="airports" placeholder="Douala (DLA), Yaoundé (NSI)" />
          <Field label="Typical ocean transit, days" k="oceanDays" placeholder="30–40" />
          <Field label="Typical air transit, days" k="airDays" placeholder="3–6" />
          <Field label="Phone dial code" k="dialCode" placeholder="237" hint="Used to format recipients’ numbers for texts." />
          <Field label="Flag (optional override)" k="flag" placeholder="🇨🇲" />
          <label className="grid gap-1 text-xs md:col-span-2"><span className="text-text-muted">Note shown to customers (optional)</span><textarea className="input-dark min-h-16" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} maxLength={300} placeholder="Weekly consolidations from Paris and Houston; customs pre-clearance recommended." /></label>
          <div className="flex gap-2 md:col-span-2"><button type="button" onClick={() => { setEditing(null); setIsNew(false) }} className="btn-ghost !min-h-10 text-sm">Cancel</button><button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="dest-save"><Check size={16} aria-hidden="true" /> Save</button></div>
        </form>
      )}
      <ul className="mt-4 divide-y divide-border rounded-xl border border-border" aria-label="Destinations">
        {list?.map((d) => (
          <li key={d.code} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${d.active ? '' : 'opacity-60'}`} data-testid="destination-row">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold">{d.flag} {d.name} <span className="font-mono text-xs text-text-muted">{d.code}</span>{!d.active && <Pill tone="muted">hidden</Pill>}</p>
              <p className="text-xs text-text-muted">Ports: {d.ports.join(', ') || '—'} · Airports: {d.airports.join(', ') || '—'} · Ocean {d.oceanDays || '—'} d · Air {d.airDays || '—'} d{d.dialCode ? ` · +${d.dialCode}` : ''}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button onClick={() => { setEditing(d); setIsNew(false) }} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Pencil size={13} aria-hidden="true" /> Edit</button>
              <button onClick={() => toggle(d)} disabled={busy} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="dest-toggle">{d.active ? <><EyeOff size={13} aria-hidden="true" /> Hide</> : <><Eye size={13} aria-hidden="true" /> Show</>}</button>
            </div>
          </li>
        ))}
        {list && list.length === 0 && <li className="px-4 py-6 text-sm text-text-muted">No destinations yet.</li>}
      </ul>
    </div>
  )
}
