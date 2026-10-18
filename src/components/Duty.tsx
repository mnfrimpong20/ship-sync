import { useEffect, useState } from 'react'
import { BadgeCheck, Calculator, Check, ExternalLink, Pencil, ShieldCheck, X } from 'lucide-react'
import { dutyApi, local, pct, type DutyConfirmed, type DutyEstimate, type DutyInput, type DutyMeta, type GoodsKind } from '../lib/duty'
import { money } from './ui'

/** Line-by-line breakdown of an estimate, in local currency with the USD equivalent. */
export function DutyBreakdown({ e, compact = false }: { e: DutyEstimate; compact?: boolean }) {
  if (!e.supported) return <p className="text-sm text-text-muted">{e.notes[0]}</p>
  return (
    <div data-testid="duty-breakdown">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><p className="text-xs text-text-muted">Estimated duty & taxes</p><p className="font-heading text-2xl font-bold tabular-nums">{local(e.totalLocal, e.currency)}</p><p className="text-xs text-text-muted">≈ {money(e.totalUsd)} · {pct(e.effectiveRate)} of CIF · at {e.fx.toLocaleString()} {e.currency}/USD</p></div>
        <div className="text-right"><p className="text-xs text-text-muted">Landed cost (goods + freight + duty)</p><p className="font-semibold tabular-nums">{money(e.landedUsd)}</p></div>
      </div>
      <table className="mt-3 w-full text-xs">
        <tbody>
          <tr className="border-b border-border/70"><td className="py-1.5 text-text-muted">CIF value (goods + freight + insurance)</td><td className="py-1.5 text-right text-text-muted"></td><td className="whitespace-nowrap py-1.5 text-right tabular-nums">{local(e.cifLocal, e.currency)}</td></tr>
          {e.lines.map((l) => <tr key={l.key} className="border-b border-border/70"><td className="py-1.5">{l.label}{!compact && l.note && <span className="block text-[11px] text-text-muted">{l.note}</span>}</td><td className="py-1.5 text-right text-text-muted">{pct(l.rate)}{l.base === 'cif_duty' ? ' of CIF+duty' : l.base === 'duty' ? ' of duty' : l.base === 'fob' ? ' of FOB' : ''}</td><td className="whitespace-nowrap py-1.5 text-right tabular-nums">{local(l.amount, e.currency)}</td></tr>)}
          <tr><td className="pt-2 font-semibold">Total to customs</td><td /><td className="whitespace-nowrap pt-2 text-right font-semibold tabular-nums">{local(e.totalLocal, e.currency)}</td></tr>
        </tbody>
      </table>
      {!compact && <ul className="mt-3 space-y-1 text-[11px] text-text-muted">{e.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>}
      <p className="mt-2 text-[11px] text-text-muted">Rates checked {e.checked}. {e.destination === 'GH' ? 'Structure follows GRA’s ICUMS assessment (duty, VAT 15% + NHIL 2.5% + GETFund 2.5% on CIF + duty, ECOWAS/AU/EXIM levies).' : ''} Estimate only — the official figure comes from customs.</p>
      {e.verifyUrl && <a href={e.verifyUrl} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-deep hover:underline"><ShieldCheck size={13} aria-hidden="true" /> Verify on the official GRA ICUMS calculator <ExternalLink size={11} aria-hidden="true" /></a>}
    </div>
  )
}

/** The inputs form, shared by the public calculator and the per-shipment card. */
export function DutyForm({ value, onChange, meta, lockDestination, cargo }: { value: DutyInput; onChange: (v: DutyInput) => void; meta: DutyMeta | null; lockDestination?: boolean; cargo?: string }) {
  const set = (p: Partial<DutyInput>) => onChange({ ...value, ...p })
  const isVehicle = value.goods === 'vehicle'
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {!lockDestination && <select aria-label="Destination" className="input-dark !min-h-9 text-sm" value={value.destination} onChange={(e) => set({ destination: e.target.value })}><option value="GH">Ghana (Tema / Takoradi)</option><option value="NG">Nigeria (Lagos)</option><option value="LR">Liberia</option><option value="TG">Togo</option><option value="CI">Côte d’Ivoire</option><option value="SL">Sierra Leone</option><option value="SN">Senegal</option></select>}
      <select aria-label="Goods" className={`input-dark !min-h-9 text-sm ${lockDestination ? 'sm:col-span-2' : ''}`} value={value.goods} onChange={(e) => set({ goods: e.target.value as GoodsKind })}>{(meta?.goods ?? [{ id: 'personal_effects', label: 'Used personal effects & household goods' }, { id: 'vehicle', label: 'Vehicle' }]).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
      <label className="text-xs text-text-muted">Value of goods (USD){cargo === 'vehicle' || isVehicle ? ' — what the vehicle is worth' : ''}<input type="number" min={0} aria-label="Value of goods (USD)" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={value.valueUsd || ''} placeholder="e.g. 1500" onChange={(e) => set({ valueUsd: Number(e.target.value) || 0 })} /></label>
      <label className="text-xs text-text-muted">Freight paid (USD)<input type="number" min={0} aria-label="Freight (USD)" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={value.freightUsd ?? ''} placeholder="e.g. 600" onChange={(e) => set({ freightUsd: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} /></label>
      {isVehicle && (
        <>
          <label className="text-xs text-text-muted">Model year<input type="number" min={1960} max={new Date().getFullYear() + 1} aria-label="Model year" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={value.vehicle?.year ?? ''} placeholder="2016" onChange={(e) => set({ vehicle: { year: Number(e.target.value) || new Date().getFullYear(), cc: value.vehicle?.cc ?? 2000, kind: value.vehicle?.kind ?? 'car' } })} /></label>
          <label className="text-xs text-text-muted">Engine (cc)<input type="number" min={50} aria-label="Engine cc" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={value.vehicle?.cc ?? ''} placeholder="2400" onChange={(e) => set({ vehicle: { year: value.vehicle?.year ?? 2016, cc: Number(e.target.value) || 2000, kind: value.vehicle?.kind ?? 'car' } })} /></label>
          <select aria-label="Vehicle type" className="input-dark !min-h-9 text-sm sm:col-span-2" value={value.vehicle?.kind ?? 'car'} onChange={(e) => set({ vehicle: { year: value.vehicle?.year ?? 2016, cc: value.vehicle?.cc ?? 2000, kind: e.target.value as 'car' } })}><option value="car">Car / saloon</option><option value="suv">SUV / 4×4</option><option value="van">Van / minibus</option><option value="truck">Pickup / truck</option></select>
        </>
      )}
      {value.goods === 'personal_effects' && value.destination === 'GH' && <label className="inline-flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={Boolean(value.exemptPersonalEffects)} onChange={(e) => set({ exemptPersonalEffects: e.target.checked })} /> Returning resident — personal effects exempt from duty</label>}
      <label className="grid gap-1 text-xs text-text-muted sm:col-span-2"><span>Exchange rate ({value.destination === 'NG' ? 'NGN' : 'GHS'} per USD) — leave blank for today’s indicative rate</span><input type="number" min={0} step="0.01" aria-label="Exchange rate" className="input-dark !min-h-9 !w-40 text-sm tabular-nums" value={value.fx ?? ''} placeholder={String(meta?.fx[value.destination] ?? '')} onChange={(e) => set({ fx: e.target.value === '' ? undefined : Number(e.target.value) || undefined })} /></label>
    </div>
  )
}

/** Per-shipment card: customer enters the value and sees the estimate; the office can replace it with the official assessment. */
export function DutyCard({ shipmentId, destination, cargo }: { shipmentId: string; destination: string; cargo: string }) {
  const [meta, setMeta] = useState<DutyMeta | null>(null)
  const [input, setInput] = useState<DutyInput | null>(null)
  const [est, setEst] = useState<DutyEstimate | null>(null)
  const [confirmed, setConfirmed] = useState<DutyConfirmed | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cf, setCf] = useState({ amountLocal: '', reference: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    dutyApi.meta().then(setMeta).catch(() => {})
    dutyApi.forShipment(shipmentId).then((d) => { setInput(d.input); setEst(d.estimate); setConfirmed(d.confirmed); setCanManage(d.canManage); setEditing(!d.estimate && !d.confirmed) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  }, [shipmentId])
  if (hidden || !meta?.supported.includes(destination.toUpperCase())) return null
  if (!input) return <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">{error || 'Loading duty estimate…'}</div>
  const save = async () => { setBusy(true); setError(''); try { const r = await dutyApi.save(shipmentId, input); setEst(r.estimate); setEditing(false) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  const confirm = async () => { setBusy(true); setError(''); try { setConfirmed(await dutyApi.confirm(shipmentId, { amountLocal: Number(cf.amountLocal) || 0, currency: est?.currency ?? (destination === 'NG' ? 'NGN' : 'GHS'), reference: cf.reference, note: cf.note })); setConfirming(false) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  const unconfirm = async () => { setBusy(true); try { await dutyApi.unconfirm(shipmentId); setConfirmed(null) } finally { setBusy(false) } }
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="duty-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Calculator size={14} className="text-gold-deep" aria-hidden="true" /> Duty at {destination.toUpperCase() === 'GH' ? 'Tema' : 'Lagos'}</p>
        <div className="flex gap-1">{!editing && !confirmed && <button onClick={() => setEditing(true)} className="btn-ghost !min-h-7 !px-2 text-[11px]"><Pencil size={11} aria-hidden="true" /> {est ? 'Edit values' : 'Estimate'}</button>}{!est && !confirmed && !editing && <button onClick={() => setHidden(true)} className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:text-text focus-ring" aria-label="Hide"><X size={12} /></button>}</div>
      </div>
      {error && <p role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      {confirmed ? (
        <div className="mt-3 rounded-lg border border-teal/40 bg-teal/10 p-3 text-sm" data-testid="duty-confirmed">
          <p className="flex items-start gap-2"><BadgeCheck size={16} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" /><span><strong>Official assessment: {local(confirmed.amountLocal, confirmed.currency)}</strong>{confirmed.reference ? ` · ${confirmed.reference}` : ''}<span className="block text-xs text-text-muted">Entered by {confirmed.by} · {new Date(confirmed.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{confirmed.note ? ` — “${confirmed.note}”` : ''}</span></span></p>
          {est && <p className="mt-2 text-xs text-text-muted">Our estimate was {local(est.totalLocal, est.currency)}.</p>}
          {canManage && <button onClick={unconfirm} disabled={busy} className="btn-ghost mt-2 !min-h-7 !px-2 text-[11px]">Remove</button>}
        </div>
      ) : editing ? (
        <div className="mt-3">
          <p className="mb-2 text-xs text-text-muted">Tell us roughly what the goods are worth and we’ll estimate what customs will charge on arrival.</p>
          <DutyForm value={input} onChange={setInput} meta={meta} lockDestination cargo={cargo} />
          <div className="mt-3 flex justify-end gap-2">{est && <button onClick={() => setEditing(false)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button>}<button onClick={save} disabled={busy || !input.valueUsd} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><Check size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Estimate'}</button></div>
        </div>
      ) : est ? (
        <div className="mt-3">
          <DutyBreakdown e={est} compact />
          {canManage && !confirming && <button onClick={() => { setConfirming(true); setCf({ amountLocal: String(Math.round(est.totalLocal)), reference: '', note: '' }) }} className="btn-ghost mt-3 !min-h-8 !px-3 text-xs"><BadgeCheck size={13} aria-hidden="true" /> Enter official assessment</button>}
          {canManage && confirming && (
            <div className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3 sm:grid-cols-3" data-testid="duty-confirm-form">
              <input type="number" min={0} aria-label="Assessed amount" className="input-dark !min-h-9 text-sm tabular-nums" placeholder={`Amount (${est.currency})`} value={cf.amountLocal} onChange={(e) => setCf({ ...cf, amountLocal: e.target.value })} />
              <input aria-label="Reference" className="input-dark !min-h-9 text-sm" placeholder="ICUMS / declaration no." value={cf.reference} onChange={(e) => setCf({ ...cf, reference: e.target.value })} />
              <input aria-label="Note" className="input-dark !min-h-9 text-sm" placeholder="Note for the customer" value={cf.note} onChange={(e) => setCf({ ...cf, note: e.target.value })} />
              <div className="sm:col-span-3 flex justify-end gap-2"><button onClick={() => setConfirming(false)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button onClick={confirm} disabled={busy || !Number(cf.amountLocal)} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60">{busy ? 'Saving…' : 'Confirm & tell customer'}</button></div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
