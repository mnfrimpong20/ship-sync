import { useEffect, useState } from 'react'
import { BadgeCheck, Check, Pencil, Plus, X } from 'lucide-react'
import { partnersApi, serviceLabels, type Assignment, type DestPartner, type PartnerInput, type PartnerService } from '../lib/partners'
import { countries } from '../lib/data'

const blank: PartnerInput = { name: '', country: 'GH', cities: [], services: ['clearing'], contactName: '', phone: '', whatsapp: '', email: '', about: '', ratesNote: '', verified: false, active: true }

/** Admin: the destination partner directory and the partner desk (jobs to confirm with partners). */
export function AdminPartners() {
  const [d, setD] = useState<{ partners: DestPartner[]; assignments: Assignment[] } | null>(null)
  const [edit, setEdit] = useState<{ id?: string; f: PartnerInput; cities: string } | null>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => partnersApi.admin().then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (!edit) return; setBusy(true); setErr(''); const f = { ...edit.f, cities: edit.cities.split(',').map((c) => c.trim()).filter(Boolean) }; try { if (edit.id) await partnersApi.update(edit.id, f); else await partnersApi.create(f); setEdit(null); await load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not save.') } finally { setBusy(false) } }
  const setStatus = async (a: Assignment, s: 'accepted' | 'declined' | 'done') => { await partnersApi.setStatus(a.id, s); await load() }
  if (!d) return err ? <p className="mt-6 text-sm text-danger">{err}</p> : null
  const open = d.assignments.filter((a) => a.status === 'requested')
  const F = edit?.f
  return (
    <section className="mt-10" data-testid="admin-partners">
      <div className="card-dark p-5">
        <h2 className="!text-lg">Partner desk{open.length ? ` · ${open.length} to confirm` : ''}</h2>
        <p className="mt-1 text-sm text-text-muted">Shippers asked these partners to handle a container. Call or WhatsApp the partner, then record their answer — the shipper is told straight away.</p>
        {d.assignments.length === 0 ? <p className="mt-3 text-sm text-text-muted">No jobs yet.</p> : (
          <ul className="mt-3 divide-y divide-border/70 text-sm">{d.assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0"><b>{a.partnerName}</b> · {a.containerRef} for {a.shipper}<span className="block text-xs text-text-muted">{a.services.map((s) => serviceLabels[s]).join(', ')}{a.note ? ` — ${a.note}` : ''}{a.stars ? ` · rated ${'★'.repeat(a.stars)}` : ''}</span></span>
              {a.status === 'requested' ? <span className="flex gap-1.5"><button onClick={() => setStatus(a, 'accepted')} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="pa-accept"><Check size={13} aria-hidden="true" /> Accepted</button><button onClick={() => setStatus(a, 'declined')} className="btn-ghost !min-h-8 !px-3 text-xs"><X size={13} aria-hidden="true" /> Can’t do it</button></span>
                : <span className="text-xs capitalize text-text-muted">{a.status}</span>}
            </li>))}</ul>
        )}
      </div>
      <div className="mt-6 flex items-center justify-between gap-3"><h2 className="!text-lg">Directory · {d.partners.length}</h2><button onClick={() => setEdit({ f: blank, cities: '' })} className="btn-gold !min-h-9 text-sm" data-testid="partner-new"><Plus size={15} aria-hidden="true" /> Add partner</button></div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {edit && F && (
        <form onSubmit={save} className="card-dark mt-4 grid gap-3 p-5 sm:grid-cols-2" data-testid="partner-form">
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Company</span><input required className="input-dark !min-h-9 text-sm" value={F.name} onChange={(e) => setEdit({ ...edit, f: { ...F, name: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Country</span><select className="input-dark !min-h-9 text-sm" value={F.country} onChange={(e) => setEdit({ ...edit, f: { ...F, country: e.target.value } })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Cities (comma separated)</span><input className="input-dark !min-h-9 text-sm" value={edit.cities} onChange={(e) => setEdit({ ...edit, cities: e.target.value })} placeholder="Tema, Accra" /></label>
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">{(Object.keys(serviceLabels) as PartnerService[]).map((s) => <label key={s} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${F.services.includes(s) ? 'border-gold bg-gold/15' : 'border-border text-text-muted'}`}><input type="checkbox" className="sr-only" checked={F.services.includes(s)} onChange={(e) => setEdit({ ...edit, f: { ...F, services: e.target.checked ? [...F.services, s] : F.services.filter((x) => x !== s) } })} />{serviceLabels[s]}</label>)}</div>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Contact person</span><input className="input-dark !min-h-9 text-sm" value={F.contactName} onChange={(e) => setEdit({ ...edit, f: { ...F, contactName: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Email (gets the pre-alert)</span><input type="email" className="input-dark !min-h-9 text-sm" value={F.email} onChange={(e) => setEdit({ ...edit, f: { ...F, email: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Phone</span><input className="input-dark !min-h-9 text-sm" value={F.phone} onChange={(e) => setEdit({ ...edit, f: { ...F, phone: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">WhatsApp</span><input className="input-dark !min-h-9 text-sm" value={F.whatsapp} onChange={(e) => setEdit({ ...edit, f: { ...F, whatsapp: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">What they do (shippers see this)</span><textarea rows={2} className="input-dark py-2 text-sm" value={F.about} onChange={(e) => setEdit({ ...edit, f: { ...F, about: e.target.value } })} /></label>
          <label className="grid gap-1 text-xs sm:col-span-2"><span className="text-text-muted">Rates note (internal)</span><input className="input-dark !min-h-9 text-sm" value={F.ratesNote} onChange={(e) => setEdit({ ...edit, f: { ...F, ratesNote: e.target.value } })} /></label>
          <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2"><label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-gold" checked={F.verified} onChange={(e) => setEdit({ ...edit, f: { ...F, verified: e.target.checked } })} /> Verified (licence and premises checked)</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="accent-gold" checked={F.active} onChange={(e) => setEdit({ ...edit, f: { ...F, active: e.target.checked } })} /> Listed</label>
            <span className="ml-auto flex gap-2"><button type="button" onClick={() => setEdit(null)} className="btn-ghost !min-h-9 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 text-sm">Save</button></span></div>
        </form>
      )}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">{d.partners.map((p) => (
        <li key={p.id} className={`card-dark p-4 ${p.active ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold">{p.name}{p.verified && <BadgeCheck size={14} className="text-teal" aria-label="Verified" />}{p.demo && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-text-muted">demo</span>}</p><p className="text-xs text-text-muted">{p.country} · {p.cities.join(', ')} · {p.services.map((s) => serviceLabels[s]).join(', ')}</p><p className="mt-1 text-xs text-text-muted">{[p.contactName, p.phone, p.email].filter(Boolean).join(' · ')}{p.rating ? ` · ★ ${p.rating} (${p.ratingCount})` : ''} · {p.jobs} job{p.jobs === 1 ? '' : 's'}</p></div>
            <button onClick={() => setEdit({ id: p.id, f: { name: p.name, country: p.country, cities: p.cities, services: p.services, contactName: p.contactName, phone: p.phone, whatsapp: p.whatsapp, email: p.email, about: p.about, ratesNote: p.ratesNote, verified: p.verified, active: p.active }, cities: p.cities.join(', ') })} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text" aria-label={`Edit ${p.name}`}><Pencil size={14} /></button></div>
        </li>))}</ul>
    </section>
  )
}
