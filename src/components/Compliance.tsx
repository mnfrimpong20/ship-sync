/** Compliance pieces: the sender's declaration (request form), Export filing (EEI/ITN) on a shipment, the admin
 *  sanctions-screening queue, and the sales-tax settings for what Ntemtem sells. */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, FileCheck2, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { complianceApi, PROHIBITED, RESTRICTED, restrictedLabel, type ExportView, type ScreeningView, type TaxSettings } from '../lib/compliance'
import { fmtDate } from './ui'

/* ------------------------------------------------------------------ request form */
export function DeclarationBox({ value, onChange, error }: { value: { accepted: boolean; includes: string[] } | undefined; onChange: (v: { accepted: boolean; includes: string[] }) => void; error?: string }) {
  const v = value ?? { accepted: false, includes: [] }
  const toggle = (k: string) => onChange({ ...v, includes: v.includes.includes(k) ? v.includes.filter((x) => x !== k) : [...v.includes, k] })
  return (
    <div className={`rounded-[var(--radius-sm)] border p-4 ${error ? 'border-danger' : 'border-border'} bg-surface-2`} data-testid="declaration">
      <p className="font-semibold text-text">What’s inside — your declaration</p>
      <p className="mt-1 text-xs text-text-muted">Shippers can’t carry these, and customs can seize them: {PROHIBITED.join(' · ')}.</p>
      <p className="mt-3 text-sm font-medium text-text">Does your shipment include any of these? <span className="font-normal text-text-muted">They’re often allowed, but the shipper must know.</span></p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {RESTRICTED.map(([k, l]) => <label key={k} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-gold" checked={v.includes.includes(k)} onChange={() => toggle(k)} data-testid={`decl-${k}`} />{l}</label>)}
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-gold" checked={v.accepted} onChange={(e) => onChange({ ...v, accepted: e.target.checked })} data-testid="declaration-accept" />
        <span>I confirm my shipment contains nothing on the prohibited list, that I’ve ticked anything above that applies, and that the description and value I’ve given are true.</span>
      </label>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
/** Shipper side: restricted items the sender declared. */
export function DeclaredItems({ includes }: { includes?: string[] }) {
  if (!includes?.length) return null
  return <p className="flex items-start gap-1.5 rounded-lg border border-gold/50 bg-gold-soft/40 px-3 py-2 text-xs text-ink" data-testid="declared-items"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><span><b>Sender declared:</b> {includes.map(restrictedLabel).join('; ')}.</span></p>
}

/* ------------------------------------------------------------------ export filing */
export function ExportCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<ExportView | null>(null)
  const [f, setF] = useState({ itn: '', exemption: '', value: '', note: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [ok, setOk] = useState('')
  useEffect(() => { complianceApi.exportFor(shipmentId).then((x) => { setD(x); setF({ itn: x.export.itn, exemption: x.export.exemption, value: x.export.valueUsd != null ? String(x.export.valueUsd) : '', note: x.export.note }) }).catch(() => setD(null)) }, [shipmentId])
  if (!d || !d.export.applies) return null
  const e = d.export
  const save = async (ev: React.FormEvent) => { ev.preventDefault(); setBusy(true); setError(''); try { const r = await complianceApi.saveExport(shipmentId, { itn: f.itn.trim(), exemption: f.itn.trim() ? '' : f.exemption, valueUsd: f.value === '' ? null : Number(f.value), note: f.note }); setD(r); setOk('Saved.') } catch (er) { setError(er instanceof Error ? er.message : 'Could not save.') } finally { setBusy(false) } }
  const tone = e.cleared ? 'border-teal/40' : e.required ? 'border-danger/40' : 'border-border'
  return (
    <div className={`min-w-0 rounded-xl border bg-surface p-4 ${tone}`} data-testid="export-card">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><FileCheck2 size={14} className="text-gold-deep" aria-hidden="true" /> US export filing</p>
      <p className={`mt-1 text-sm font-semibold ${e.cleared ? 'text-teal' : e.required ? 'text-danger' : 'text-text'}`} data-testid="export-status">{e.cleared ? (e.cleared === 'under-threshold' ? 'No EEI needed (value under $2,500)' : `Cleared — ${e.cleared}`) : e.required ? 'EEI filing needed before it leaves the US' : 'Check the declared value'}</p>
      {e.reasons.length > 0 && !e.cleared && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-muted">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {e.vehicle && <p className={`mt-2 text-xs ${e.titleOk ? 'text-teal' : 'text-danger'}`}>{e.titleOk ? '✓ Title filed with CBP' : 'Title not yet filed with CBP — update the vehicle checklist (72-hour rule).'}</p>}
      {d.canEdit ? (
        <form onSubmit={save} className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-text-muted">ITN from AES<input className="input-dark mt-1 !min-h-9 font-mono text-sm uppercase" placeholder="X20261018123456" value={f.itn} onChange={(x) => setF({ ...f, itn: x.target.value })} data-testid="export-itn" /></label>
          {!e.vehicle && <label className="text-xs text-text-muted">…or the exemption used<select className="input-dark mt-1 !min-h-9 text-sm" value={f.exemption} disabled={!!f.itn.trim()} onChange={(x) => setF({ ...f, exemption: x.target.value })} data-testid="export-exemption"><option value="">—</option>{d.exemptions.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.label}</option>)}</select></label>}
          <label className="text-xs text-text-muted">Declared value (USD)<input type="number" min={0} className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.value} onChange={(x) => setF({ ...f, value: x.target.value })} /></label>
          <label className="text-xs text-text-muted">Note<input className="input-dark mt-1 !min-h-9 text-sm" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} placeholder="Filed by our broker…" /></label>
          {error && <p role="alert" className="text-xs text-danger sm:col-span-2">{error}</p>}
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{ok && <span className="text-xs text-teal">{ok}</span>}<button disabled={busy} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="export-save">{busy ? 'Saving…' : 'Save filing'}</button></div>
          <p className="text-[11px] text-text-muted sm:col-span-2">File through AESDirect (ACE) or your customs broker. The shipment can’t be moved to “At origin port” until this is cleared. {e.filedBy ? `Last recorded by ${e.filedBy}${e.filedAt ? ` on ${fmtDate(e.filedAt)}` : ''}.` : ''}</p>
        </form>
      ) : e.cleared ? null : <p className="mt-2 text-xs text-text-muted">Your shipper files this with US Customs. Keep your ID{e.vehicle ? ' and the original title' : ''} ready.</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ admin: sanctions screening */
export function AdminScreening() {
  const [d, setD] = useState<ScreeningView | null>(null); const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('')
  const [name, setName] = useState(''); const [check, setCheck] = useState<{ matched: string; program: string; score: number }[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = () => complianceApi.screening().then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => { setBusy(key); setError(''); try { await fn(); await load(); setMsg(done) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') } }
  if (!d) return <section className="mt-12"><p className="text-sm text-text-muted">{error || 'Loading…'}</p></section>
  const open = d.hits.filter((h) => h.status === 'open')
  return (
    <section className="mt-14" data-testid="admin-screening">
      <p className="eyebrow mb-1">Compliance</p>
      <h2 className="!text-[clamp(1.5rem,3vw,2rem)]">Sanctions screening</h2>
      <p className="mt-1 max-w-3xl text-text-muted">Senders, receivers and shipping companies are checked against the US Treasury OFAC list. A possible match holds the booking (or verification) until someone here reviews it. Most matches are just a shared name — clear them with a short note.</p>
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="card-dark p-5"><p className="text-sm text-text-muted">List</p><p className="mt-1 font-heading text-2xl font-bold">{d.list ? `${d.list.count.toLocaleString()} names` : 'Not loaded'}</p><p className="mt-1 text-xs text-text-muted">{d.list ? `Updated ${fmtDate(d.list.refreshedAt)}` : d.lastError ? `Last try failed: ${d.lastError.error}` : 'Downloads daily from treasury.gov'}</p><button disabled={busy === 'refresh'} onClick={() => act('refresh', async () => { const r = await complianceApi.refreshList(); if (!r.ok) throw new Error(r.error ?? 'Download failed.') }, 'List refreshed.')} className="btn-ghost mt-3 !min-h-8 !px-3 text-xs" data-testid="screening-refresh"><RefreshCw size={13} aria-hidden="true" /> {busy === 'refresh' ? 'Downloading…' : 'Refresh now'}</button></div>
        <div className="card-dark p-5"><p className="text-sm text-text-muted">To review</p><p className={`mt-1 font-heading text-2xl font-bold ${open.length ? 'text-danger' : ''}`}>{open.length}</p><p className="mt-1 text-xs text-text-muted">{open.length ? 'Bookings are on hold until reviewed' : 'Nothing waiting'}</p></div>
        <form className="card-dark p-5" onSubmit={async (e) => { e.preventDefault(); if (name.trim().length < 2) return; setCheck((await complianceApi.checkName(name)).matches) }}><p className="text-sm text-text-muted">Check a name</p><div className="mt-2 flex gap-2"><input className="input-dark !min-h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name or company" aria-label="Name to check" data-testid="screening-name" /><button className="btn-ghost !min-h-9 !px-3"><Search size={14} aria-label="Check" /></button></div>{check && <p className="mt-2 text-xs" data-testid="screening-check-result">{check.length ? check.map((m) => `${m.matched} (${m.program})`).join('; ') : 'No match on the list.'}</p>}</form>
      </div>
      <div className="mt-6 card-dark overflow-hidden">
        {d.hits.length === 0 ? <p className="p-6 text-sm text-text-muted">No matches so far.</p> : (
          <ul className="divide-y divide-border">{d.hits.map((h) => (
            <li key={h.id} className="grid gap-2 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" data-testid="screening-hit">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2">{h.status === 'open' ? <ShieldAlert size={15} className="text-danger" aria-hidden="true" /> : h.status === 'cleared' ? <ShieldCheck size={15} className="text-teal" aria-hidden="true" /> : <AlertTriangle size={15} className="text-danger" aria-hidden="true" />}<b>{h.name}</b><span className="text-text-muted">({h.role} on {h.subjectType} {h.subjectType === 'shipper' ? <Link to={`/shippers/${h.subjectId}`} className="underline">{h.subjectId}</Link> : h.subjectId})</span></p>
                <p className="mt-1 text-xs text-text-muted">Possible match: <b className="text-text">{h.matched}</b>{h.program ? ` · ${h.program}` : ''} · {fmtDate(h.createdAt)}</p>
                {h.status !== 'open' && <p className="mt-1 text-xs">{h.status === 'cleared' ? 'Cleared' : 'Confirmed match — blocked'} by {h.reviewedBy}: “{h.note}”</p>}
              </div>
              {h.status === 'open' && <div className="flex flex-wrap items-start gap-2"><input className="input-dark !min-h-8 flex-1 text-xs" placeholder="Why (e.g. different date of birth)" value={notes[h.id] ?? ''} onChange={(e) => setNotes({ ...notes, [h.id]: e.target.value })} aria-label={`Review note for ${h.name}`} /><button disabled={!!busy} onClick={() => act(h.id, () => complianceApi.review(h.id, 'cleared', notes[h.id] ?? ''), 'Cleared — the booking can go ahead.')} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="screening-clear">Not a match</button><button disabled={!!busy} onClick={() => act(h.id, () => complianceApi.review(h.id, 'confirmed', notes[h.id] ?? ''), 'Marked as a real match — it stays blocked.')} className="btn-ghost !min-h-8 !px-3 text-xs text-danger">Real match</button></div>}
            </li>
          ))}</ul>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ admin: sales tax */
export function SalesTaxCard() {
  const [t, setT] = useState<TaxSettings | null>(null); const [msg, setMsg] = useState(''); const [error, setError] = useState(''); const [st, setSt] = useState(''); const [rate, setRate] = useState('')
  useEffect(() => { complianceApi.tax().then(setT).catch(() => {}) }, [])
  if (!t) return null
  const save = async (n: TaxSettings) => { setError(''); try { setT(await complianceApi.saveTax(n)); setMsg('Saved.'); setTimeout(() => setMsg(''), 2500) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } }
  return (
    <div className="card-dark p-5" data-testid="sales-tax">
      <div className="flex items-center justify-between gap-2"><h3 className="!text-base">Sales tax</h3>{msg && <span className="text-xs text-teal">{msg}</span>}</div>
      <p className="mt-1 text-xs text-text-muted">Charged on what Ntemtem sells (equipment and its packing supplies), by the US state it ships to. Shippers handle tax on their own supplies. Confirm the states and rates with your accountant.</p>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={t.enabled} onChange={(e) => save({ ...t, enabled: e.target.checked })} /> Charge sales tax</label>
      <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={t.taxShipping} onChange={(e) => save({ ...t, taxShipping: e.target.checked })} /> Include shipping charges</label>
      <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={t.taxRentals} onChange={(e) => save({ ...t, taxRentals: e.target.checked })} /> Tax monthly rentals</label>
      <ul className="mt-3 divide-y divide-border text-sm">{Object.entries(t.rates).map(([s, r]) => <li key={s} className="flex items-center justify-between py-1.5"><span><b>{s}</b> · {Math.round(r * 10000) / 100}%</span><button onClick={() => { const n = { ...t.rates }; delete n[s]; void save({ ...t, rates: n }) }} className="text-xs text-danger hover:underline">Remove</button></li>)}</ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const s = st.trim().toUpperCase(); const r = Number(rate) / 100; if (!/^[A-Z]{2}$/.test(s) || !(r >= 0 && r <= 0.2)) { setError('Use a 2-letter state and a rate between 0 and 20%.'); return } void save({ ...t, rates: { ...t.rates, [s]: r } }); setSt(''); setRate('') }}>
        <input className="input-dark !min-h-8 w-20 text-sm uppercase" maxLength={2} placeholder="State" value={st} onChange={(e) => setSt(e.target.value)} aria-label="State" />
        <input className="input-dark !min-h-8 w-24 text-sm" type="number" step="0.01" min={0} max={20} placeholder="Rate %" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Rate percent" />
        <button className="btn-ghost !min-h-8 !px-3 text-xs">Add state</button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
