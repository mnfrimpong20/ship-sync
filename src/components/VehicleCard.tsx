import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Car, Check, ClipboardCheck, Loader2, Pencil, ShieldAlert } from 'lucide-react'
import { methodLabels, titleLabels, vehicleLabel, vehiclesApi, emptyVehicle, type Decoded, type ExportStep, type RequestVehicle, type Vehicle, type VehicleInput, type VehicleMeta } from '../lib/vehicles'
import { money } from './ui'

/** VIN field with live decode — shared by the quote wizard and the shipment card. */
export function VinField({ value, onChange, onDecoded, label = 'VIN (17 characters)' }: { value: string; onChange: (v: string) => void; onDecoded: (d: Decoded) => void; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Decoded | null>(null)
  useEffect(() => {
    const vin = value.trim().toUpperCase(); if (vin.length !== 17) { setD(null); return }
    let live = true; setBusy(true)
    const t = setTimeout(() => vehiclesApi.decode(vin).then((r) => { if (!live) return; setD(r); onDecoded(r) }).catch(() => {}).finally(() => live && setBusy(false)), 300)
    return () => { live = false; clearTimeout(t) }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <label className="text-xs text-text-muted">{label}<span className="relative block"><input aria-label="VIN" maxLength={17} className="input-dark mt-1 !min-h-10 w-full font-mono text-sm uppercase tracking-wider" placeholder="e.g. 1HGCV1F3XKA000000" value={value} onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17))} />{busy && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted" aria-hidden="true" />}</span></label>
      {d && <p className={`mt-1 text-xs ${d.valid && d.checkDigitOk ? 'text-teal' : 'text-gold-deep'}`} data-testid="vin-decoded">{d.valid ? <>{vehicleLabel(d as never)}{d.body ? ` · ${d.body}` : ''}{d.engineL ? ` · ${d.engineL} L` : ''}{d.source === 'builtin' ? ' (offline decode)' : ''}</> : null}{d.warnings.length ? ` — ${d.warnings[0]}` : ''}</p>}
      <p className="mt-1 text-xs text-text-muted">On the driver’s door jamb, the dashboard by the windscreen, and the title. We decode year, make and model automatically.</p>
    </div>
  )
}

/** Compact vehicle block for the quote wizard. */
export function RequestVehicleFields({ value, onChange }: { value: RequestVehicle; onChange: (v: RequestVehicle) => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface-2/40 p-4" data-testid="request-vehicle">
      <p className="inline-flex items-center gap-2 text-sm font-semibold"><Car size={15} className="text-gold-deep" aria-hidden="true" /> About the vehicle</p>
      <VinField value={value.vin} onChange={(vin) => onChange({ ...value, vin })} onDecoded={(d) => onChange({ ...value, vin: d.vin, year: d.year ?? value.year, make: d.make ?? value.make, model: d.model ?? value.model })} />
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-text-muted">Year<input type="number" min={1950} max={new Date().getFullYear() + 1} aria-label="Year" className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={value.year ?? ''} onChange={(e) => onChange({ ...value, year: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="text-xs text-text-muted">Make<input aria-label="Make" className="input-dark mt-1 !min-h-10 text-sm" value={value.make} onChange={(e) => onChange({ ...value, make: e.target.value })} /></label>
        <label className="text-xs text-text-muted">Model<input aria-label="Model" className="input-dark mt-1 !min-h-10 text-sm" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-text-muted">How should it ship?<select aria-label="Shipping method" className="input-dark mt-1 !min-h-10 text-sm" value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value as RequestVehicle['method'] })}><option value="roro">RoRo — cheapest, vehicle must be empty</option><option value="container">Container — can ship goods inside, safer</option></select></label>
        <label className="text-xs text-text-muted">Title<select aria-label="Title status" className="input-dark mt-1 !min-h-10 text-sm" value={value.titleStatus} onChange={(e) => onChange({ ...value, titleStatus: e.target.value as RequestVehicle['titleStatus'] })}>{Object.entries(titleLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={value.running} onChange={(e) => onChange({ ...value, running: e.target.checked })} /> It runs and drives</label>
      {value.titleStatus === 'lien' && <p className="text-xs text-gold-deep">US Customs won’t release a vehicle with a lien unless the lender gives written permission — ask them for a lien release letter now; it can take two weeks.</p>}
      {value.titleStatus === 'salvage' && <p className="text-xs text-gold-deep">Salvage titles are fine to export, but Ghana and Nigeria assess duty on the vehicle’s normal value, not the salvage price.</p>}
    </div>
  )
}

const stepTone = (s: ExportStep) => (s === 'cleared' || s === 'loaded' ? 'text-teal' : s === 'pending' ? 'text-gold-deep' : 'text-text')

/** Shipment card: vehicle details, title & lien status, US export clearance, handover and the shipper's checklist. */
export function VehicleCard({ shipmentId, destination }: { shipmentId: string; destination: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof vehiclesApi.forShipment>> | null>(null)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState<VehicleInput>(emptyVehicle())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [ho, setHo] = useState<{ location: string; date: string; contact: string; note: string } | null>(null)
  const [exp, setExp] = useState<{ step: ExportStep; aesItn: string; note: string } | null>(null)
  const load = () => vehiclesApi.forShipment(shipmentId).then((r) => { setD(r); if (r.vehicle) setF({ ...emptyVehicle(), ...r.vehicle }); setEditing(!r.vehicle && r.isVehicle) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  if (!d) return null
  if (!d.isVehicle && !d.vehicle) return null
  const v = d.vehicle; const meta: VehicleMeta = d.meta
  const act = async (fn: () => Promise<unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(''); setEditing(false); setHo(null); setExp(null) } }
  const tick = (k: keyof Vehicle['checklist'], on: boolean) => act(() => vehiclesApi.checklist(shipmentId, { [k]: on }), on ? 'Ticked.' : 'Unticked.', 'ck')
  const done = meta.checklist.filter((c) => v?.checklist[c.id]).length
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="vehicle-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Car size={14} className="text-gold-deep" aria-hidden="true" /> Vehicle</p>
        {v && !editing && <button onClick={() => setEditing(true)} className="btn-ghost !min-h-7 !px-2 text-xs"><Pencil size={11} aria-hidden="true" /> Edit</button>}
      </div>
      {toast && <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal"><Check size={12} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void act(() => vehiclesApi.save(shipmentId, f), 'Vehicle saved.', 'save') }} className="mt-3 grid gap-3" aria-label="Vehicle details" data-testid="vehicle-form">
          <VinField value={f.vin} onChange={(vin) => setF({ ...f, vin })} onDecoded={(dd) => setF((x) => ({ ...x, year: x.year ?? dd.year, make: x.make || dd.make || '', model: x.model || dd.model || '', body: x.body || dd.body || '', engineL: x.engineL ?? dd.engineL, fuel: x.fuel || dd.fuel || '' }))} />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-text-muted">Year<input type="number" aria-label="Year" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.year ?? ''} onChange={(e) => setF({ ...f, year: e.target.value ? Number(e.target.value) : null })} /></label>
            <label className="text-xs text-text-muted">Make<input aria-label="Make" className="input-dark mt-1 !min-h-9 text-sm" value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} /></label>
            <label className="text-xs text-text-muted">Model<input aria-label="Model" className="input-dark mt-1 !min-h-9 text-sm" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-text-muted">Body<input aria-label="Body" className="input-dark mt-1 !min-h-9 text-sm" placeholder="Sedan, SUV, Pickup…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
            <label className="text-xs text-text-muted">Engine (L)<input type="number" step="0.1" aria-label="Engine litres" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.engineL ?? ''} onChange={(e) => setF({ ...f, engineL: e.target.value ? Number(e.target.value) : null })} /></label>
            <label className="text-xs text-text-muted">Mileage<input type="number" aria-label="Mileage" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.mileage ?? ''} onChange={(e) => setF({ ...f, mileage: e.target.value ? Number(e.target.value) : null })} /></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-text-muted">Shipping method<select aria-label="Shipping method" className="input-dark mt-1 !min-h-9 text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as VehicleInput['method'] })}>{Object.entries(methodLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-xs text-text-muted">Title<select aria-label="Title status" className="input-dark mt-1 !min-h-9 text-sm" value={f.titleStatus} onChange={(e) => setF({ ...f, titleStatus: e.target.value as VehicleInput['titleStatus'] })}>{Object.entries(titleLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {f.titleStatus === 'lien' && <label className="text-xs text-text-muted sm:col-span-2">Lien holder (lender)<input aria-label="Lien holder" className="input-dark mt-1 !min-h-9 text-sm" value={f.lienHolder} onChange={(e) => setF({ ...f, lienHolder: e.target.value })} /></label>}
            <label className="text-xs text-text-muted">Owner on the title<input aria-label="Owner name" className="input-dark mt-1 !min-h-9 text-sm" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></label>
            <label className="text-xs text-text-muted">Value (USD) — for duty<input type="number" aria-label="Declared value" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={f.declaredValueUsd ?? ''} onChange={(e) => setF({ ...f, declaredValueUsd: e.target.value ? Number(e.target.value) : null })} /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={f.running} onChange={(e) => setF({ ...f, running: e.target.checked })} /> Runs and drives</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={f.titleInHand} onChange={(e) => setF({ ...f, titleInHand: e.target.checked })} /> I have the original title</label></div>
          {f.method === 'container' && <label className="text-xs text-text-muted">Goods packed inside the vehicle / container<textarea rows={2} aria-label="Personal items" className="input-dark mt-1 py-2 text-sm" placeholder="e.g. 6 boxes of clothing in the trunk, 2 barrels beside the car" value={f.personalItems} onChange={(e) => setF({ ...f, personalItems: e.target.value })} /></label>}
          <label className="text-xs text-text-muted">Notes<input aria-label="Notes" className="input-dark mt-1 !min-h-9 text-sm" placeholder="Damage, modifications, spare key…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2">{v && <button type="button" onClick={() => setEditing(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button>}<button disabled={busy === 'save'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy === 'save' ? 'Saving…' : 'Save vehicle'}</button></div>
        </form>
      ) : v ? (
        <div className="mt-3 text-sm">
          <p className="font-semibold">{vehicleLabel(v)}{v.trim ? ` ${v.trim}` : ''}</p>
          <p className="text-xs text-text-muted">{[v.body, v.engineL ? `${v.engineL} L` : '', v.fuel, v.color, v.mileage ? `${v.mileage.toLocaleString()} mi` : ''].filter(Boolean).join(' · ')}{v.vin ? <span className="block font-mono">{v.vin}</span> : null}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-surface-2 px-2 py-0.5">{v.method === 'roro' ? 'RoRo' : 'Container'}</span>
            <span className={`rounded-full px-2 py-0.5 ${v.titleStatus === 'clean' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold-deep'}`}>{titleLabels[v.titleStatus]}{v.titleStatus === 'lien' && v.lienHolder ? ` · ${v.lienHolder}` : ''}</span>
            <span className={`rounded-full px-2 py-0.5 ${v.running ? 'bg-surface-2' : 'bg-danger/15 text-danger'}`}>{v.running ? 'Runs' : 'Non-running'}</span>
            {v.declaredValueUsd != null && <span className="rounded-full bg-surface-2 px-2 py-0.5">Value {money(v.declaredValueUsd)}</span>}
          </div>
          {v.titleStatus === 'lien' && <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-gold-deep"><ShieldAlert size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> A lien release letter from {v.lienHolder || 'the lender'} is required before US Customs will clear the vehicle.</p>}
          {!v.running && <p className="mt-2 text-xs text-text-muted">Non-running vehicles need a forklift or winch at the yard and usually ship in a container.</p>}
          {v.personalItems && <p className="mt-2 text-xs text-text-muted">Inside: {v.personalItems}</p>}

          <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3 text-xs">
            <p className="flex items-center justify-between"><span className="font-semibold">US export clearance</span><span className={stepTone(v.exportStep)} data-testid="export-step">{meta.exportSteps.find((s) => s.id === v.exportStep)?.label}</span></p>
            {v.aesItn && <p className="mt-1 text-text-muted">AES ITN {v.aesItn}</p>}
            <p className="mt-1 text-text-muted">The original title must be with US Customs at least 72 hours before the vessel sails (19 CFR 192.2). {destination.toUpperCase() === 'GH' ? 'Ghana allows vehicles up to 10 years old without the over-age penalty.' : destination.toUpperCase() === 'NG' ? 'Nigeria bans vehicles older than 12 years from import.' : ''}</p>
            {d.canManage && !exp && <button onClick={() => setExp({ step: v.exportStep, aesItn: v.aesItn, note: '' })} className="btn-ghost mt-2 !min-h-7 !px-2 text-xs">Update clearance</button>}
            {exp && (
              <form onSubmit={(e) => { e.preventDefault(); void act(() => vehiclesApi.exportStep(shipmentId, exp), 'Clearance updated.', 'exp') }} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" aria-label="Export clearance">
                <select aria-label="Clearance step" className="input-dark !min-h-8 text-xs" value={exp.step} onChange={(e) => setExp({ ...exp, step: e.target.value as ExportStep })}>{meta.exportSteps.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
                <input aria-label="AES ITN" className="input-dark !min-h-8 font-mono text-xs" placeholder="AES ITN (X2026…)" value={exp.aesItn} onChange={(e) => setExp({ ...exp, aesItn: e.target.value })} />
                <div className="flex gap-1"><button type="button" onClick={() => setExp(null)} className="btn-ghost !min-h-8 !px-2 text-xs">Cancel</button><button disabled={busy === 'exp'} className="btn-gold !min-h-8 !px-2.5 text-xs disabled:opacity-60">Save</button></div>
              </form>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-border p-3 text-xs">
            <p className="flex items-center justify-between"><span className="font-semibold">Handover</span>{!ho && (d.canManage || true) && <button onClick={() => setHo(v.handover ?? { location: '', date: '', contact: '', note: '' })} className="btn-ghost !min-h-7 !px-2 text-xs">{v.handover ? 'Change' : 'Arrange'}</button>}</p>
            {v.handover && !ho ? <p className="mt-1" data-testid="handover">{v.handover.date} at {v.handover.location}{v.handover.contact ? ` · ${v.handover.contact}` : ''}{v.handover.note ? ` — ${v.handover.note}` : ''}</p> : !ho ? <p className="mt-1 text-text-muted">Agree where and when the vehicle is dropped off (or collected).</p> : null}
            {ho && (
              <form onSubmit={(e) => { e.preventDefault(); void act(() => vehiclesApi.handover(shipmentId, ho), 'Handover arranged — the other side has been told.', 'ho') }} className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="Handover">
                <input required minLength={2} aria-label="Location" className="input-dark !min-h-8 text-xs sm:col-span-2" placeholder="Yard / address" value={ho.location} onChange={(e) => setHo({ ...ho, location: e.target.value })} />
                <input type="date" required aria-label="Date" className="input-dark !min-h-8 text-xs" value={ho.date} onChange={(e) => setHo({ ...ho, date: e.target.value })} />
                <input aria-label="Contact" className="input-dark !min-h-8 text-xs" placeholder="Who to ask for" value={ho.contact} onChange={(e) => setHo({ ...ho, contact: e.target.value })} />
                <input aria-label="Handover note" className="input-dark !min-h-8 text-xs sm:col-span-2" placeholder="Note" value={ho.note} onChange={(e) => setHo({ ...ho, note: e.target.value })} />
                <div className="flex justify-end gap-1 sm:col-span-2"><button type="button" onClick={() => setHo(null)} className="btn-ghost !min-h-8 !px-2 text-xs">Cancel</button><button disabled={busy === 'ho'} className="btn-gold !min-h-8 !px-2.5 text-xs disabled:opacity-60">Save</button></div>
              </form>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-border p-3 text-xs" data-testid="vehicle-checklist">
            <p className="flex items-center justify-between font-semibold"><span className="inline-flex items-center gap-1.5"><ClipboardCheck size={13} className="text-gold-deep" aria-hidden="true" /> Handover checklist</span><span className="text-text-muted">{done}/{meta.checklist.length}</span></p>
            <ul className="mt-2 space-y-1.5">
              {meta.checklist.filter((c) => c.id !== 'lien' || v.titleStatus === 'lien').map((c) => (
                <li key={c.id}><label className="flex items-start gap-2"><input type="checkbox" disabled={!d.canManage || busy === 'ck'} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-gold)]" checked={!!v.checklist[c.id]} onChange={(e) => tick(c.id, e.target.checked)} /><span className={v.checklist[c.id] ? 'text-text-muted line-through' : ''}>{c.label}</span></label></li>
              ))}
            </ul>
            {!d.canManage && <p className="mt-2 text-text-muted">Bring these to the handover — the shipper ticks them off.</p>}
          </div>
          {(destination.toUpperCase() === 'GH' || destination.toUpperCase() === 'NG') && <p className="mt-3 text-xs text-text-muted">Duty on arrival is estimated in the <strong>Duty</strong> card below from this year, engine size and value. <Link to={`/duty?destination=${destination}&goods=vehicle`} className="text-gold-deep hover:underline">Open the estimator</Link></p>}
        </div>
      ) : null}
    </div>
  )
}
