import { useState } from 'react'
import { motion } from 'motion/react'
import { Check, Plus, X } from 'lucide-react'
import { cargoTypes, countries, origins as originCities, type Shipper } from '../lib/data'
import { useStore, type ShipperProfileInput } from '../lib/store'

/** Shipper's own listing — the fields customers see on the directory and profile pages. */
export default function ProfileEditor({ shipper, onDone }: { shipper: Shipper; onDone: (msg: string) => void }) {
  const { updateShipper } = useStore()
  const [f, setF] = useState<ShipperProfileInput>({
    name: shipper.name, tagline: shipper.tagline, hq: shipper.hq, founded: shipper.founded, modes: shipper.modes, destinations: shipper.destinations,
    origins: shipper.origins, cargo: shipper.cargo, services: shipper.services, about: shipper.about, priceIndex: shipper.priceIndex, responseHours: shipper.responseHours,
  })
  const [newService, setNewService] = useState('')
  const [newOrigin, setNewOrigin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await updateShipper(f); onDone('Profile saved — changes are live on your public page.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save your profile.') }
    finally { setBusy(false) }
  }

  const chip = (active: boolean) => `rounded-full border px-3 py-1.5 text-sm transition-colors focus-ring ${active ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`

  return (
    <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="card-dark mt-6 p-6" aria-label="Edit company profile">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="!text-xl">Your public profile</h2><p className="mt-1 text-sm text-text-muted">This is what customers see in the directory, on your profile page and next to your quotes.</p></div>
        <button type="button" onClick={() => onDone('')} className="focus-ring rounded-md p-2 text-text-muted hover:text-text" aria-label="Close editor"><X size={18} aria-hidden="true" /></button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div><label htmlFor="pf-name" className="label-dark">Company name</label><input id="pf-name" className="input-dark" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label htmlFor="pf-tag" className="label-dark">Tagline</label><input id="pf-tag" className="input-dark" maxLength={120} placeholder="e.g. Weekly consolidations to Tema & Lagos" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></div>
        <div><label htmlFor="pf-hq" className="label-dark">Headquarters</label><input id="pf-hq" className="input-dark" maxLength={80} placeholder="City, ST" value={f.hq} onChange={(e) => setF({ ...f, hq: e.target.value })} /></div>
        <div><label htmlFor="pf-founded" className="label-dark">Founded</label><input id="pf-founded" type="number" className="input-dark" min={1900} max={new Date().getFullYear()} value={f.founded} onChange={(e) => setF({ ...f, founded: Number(e.target.value) })} /></div>
      </div>

      <fieldset className="mt-6"><legend className="label-dark">Modes</legend>
        <div className="mt-2 flex flex-wrap gap-2">{(['ocean', 'air'] as const).map((m) => <button type="button" key={m} aria-pressed={f.modes.includes(m)} onClick={() => setF({ ...f, modes: toggle(f.modes, m) })} className={chip(f.modes.includes(m))}>{m === 'ocean' ? 'Ocean freight' : 'Air freight'}</button>)}</div>
      </fieldset>
      <fieldset className="mt-5"><legend className="label-dark">Destinations you serve</legend>
        <div className="mt-2 flex flex-wrap gap-2">{countries.map((c) => <button type="button" key={c.code} aria-pressed={f.destinations.includes(c.code)} onClick={() => setF({ ...f, destinations: toggle(f.destinations, c.code) })} className={chip(f.destinations.includes(c.code))}>{c.flag} {c.name}</button>)}</div>
      </fieldset>
      <fieldset className="mt-5"><legend className="label-dark">Cargo you handle</legend>
        <div className="mt-2 flex flex-wrap gap-2">{cargoTypes.map((c) => <button type="button" key={c.id} aria-pressed={f.cargo.includes(c.id)} onClick={() => setF({ ...f, cargo: toggle(f.cargo, c.id) })} className={chip(f.cargo.includes(c.id))}>{c.label}</button>)}</div>
      </fieldset>
      <fieldset className="mt-5"><legend className="label-dark">Pickup origins</legend>
        <p className="text-xs text-text-muted">Cities where you collect regularly. Matching uses these to rank you for nearby customers.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {originCities.map((o) => <button type="button" key={o} aria-pressed={f.origins.includes(o)} onClick={() => setF({ ...f, origins: toggle(f.origins, o) })} className={chip(f.origins.includes(o))}>{o}</button>)}
          {f.origins.filter((o) => !originCities.includes(o)).map((o) => <button type="button" key={o} aria-pressed onClick={() => setF({ ...f, origins: f.origins.filter((x) => x !== o) })} className={chip(true)}>{o} <X size={12} className="ml-1 inline" aria-hidden="true" /></button>)}
        </div>
        <div className="mt-2 flex gap-2"><input aria-label="Add another origin city" className="input-dark !min-h-10 max-w-xs text-sm" placeholder="Other city, e.g. Boston, MA" maxLength={60} value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newOrigin.trim().length >= 2 && f.origins.length < 25) { setF({ ...f, origins: [...new Set([...f.origins, newOrigin.trim()])] }); setNewOrigin('') } } }} /><button type="button" className="btn-ghost !min-h-10 !px-3 text-sm" onClick={() => { if (newOrigin.trim().length >= 2 && f.origins.length < 25) { setF({ ...f, origins: [...new Set([...f.origins, newOrigin.trim()])] }); setNewOrigin('') } }}><Plus size={14} aria-hidden="true" /> Add</button></div>
      </fieldset>
      <fieldset className="mt-5"><legend className="label-dark">Services</legend>
        <div className="mt-2 flex flex-wrap gap-2">{f.services.map((sv) => <button type="button" key={sv} onClick={() => setF({ ...f, services: f.services.filter((x) => x !== sv) })} className={chip(true)} aria-label={`Remove ${sv}`}>{sv} <X size={12} className="ml-1 inline" aria-hidden="true" /></button>)}</div>
        <div className="mt-2 flex gap-2"><input aria-label="Add a service" className="input-dark !min-h-10 max-w-xs text-sm" placeholder="e.g. Door delivery Kumasi" maxLength={60} value={newService} onChange={(e) => setNewService(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newService.trim().length >= 2 && f.services.length < 12) { setF({ ...f, services: [...new Set([...f.services, newService.trim()])] }); setNewService('') } } }} /><button type="button" className="btn-ghost !min-h-10 !px-3 text-sm" onClick={() => { if (newService.trim().length >= 2 && f.services.length < 12) { setF({ ...f, services: [...new Set([...f.services, newService.trim()])] }); setNewService('') } }}><Plus size={14} aria-hidden="true" /> Add</button></div>
      </fieldset>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div><label htmlFor="pf-price" className="label-dark">Pricing position</label>
          <select id="pf-price" className="input-dark" value={f.priceIndex} onChange={(e) => setF({ ...f, priceIndex: Number(e.target.value) })}><option value={1}>Budget — lowest rates on the lane</option><option value={2}>Mid-market</option><option value={3}>Premium — white-glove service</option></select></div>
        <div><label htmlFor="pf-resp" className="label-dark">Typical reply time (hours)</label><input id="pf-resp" type="number" className="input-dark" min={1} max={168} value={f.responseHours} onChange={(e) => setF({ ...f, responseHours: Number(e.target.value) })} /></div>
      </div>
      <div className="mt-4"><label htmlFor="pf-about" className="label-dark">About your company</label><textarea id="pf-about" rows={5} maxLength={2000} className="input-dark py-2" placeholder="Who you are, how long you've shipped to West Africa, what makes you different…" value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /><p className="mt-1 text-right text-[11px] text-text-muted">{f.about.length}/2000</p></div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-text-muted">Ratings, reviews and the verified badge are managed by Ship Sync and can't be edited here.</p>
        <div className="flex gap-2"><button type="button" onClick={() => onDone('')} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy || !f.modes.length || !f.destinations.length || !f.cargo.length} className="btn-gold !min-h-10 !px-5 text-sm disabled:opacity-60"><Check size={16} aria-hidden="true" /> {busy ? 'Saving…' : 'Save profile'}</button></div>
      </div>
    </motion.form>
  )
}
