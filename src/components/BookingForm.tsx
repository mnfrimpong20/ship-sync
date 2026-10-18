import { useEffect, useMemo, useState } from 'react'
import { Car, Check, FileText, MapPin, Package, Store, Truck, UserRound, Zap } from 'lucide-react'
import { cargoTypes, countries, countryByCode, type CargoType, type Mode } from '../lib/data'
import type { Client, Consignee } from '../lib/clients'
import { shipmentOpsApi, type FullBooking, type LaneTimes } from '../lib/shipmentOps'
import { OriginCombobox } from './OriginCombobox'
import { money } from './ui'

const plusDays = (n: number, from?: string) => { const d = from ? new Date(from + 'T12:00:00Z') : new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v) || 0))
/** Typical door-to-door days, used to suggest an ETA from the ready date. */
const transitDays = (mode: Mode, dest: string) => { const c = countryByCode(dest); const span = (mode === 'air' ? c?.airDays : c?.oceanDays) ?? ''; const hi = Number(String(span).split(/[–-]/).pop()); return Number.isFinite(hi) && hi > 0 ? hi + (mode === 'air' ? 2 : 5) : mode === 'air' ? 7 : 40 }

function Section({ icon: I, title, hint, children, aside }: { icon: typeof Package; title: string; hint?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="inline-flex items-center gap-2 text-sm font-semibold"><I size={15} className="text-gold-deep" aria-hidden="true" /> {title}</p>{hint && <p className="text-xs text-text-muted">{hint}</p>}</div>{aside}</div>
      {children}
    </fieldset>
  )
}
const L = ({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) => <label className={`grid gap-1 text-xs ${className}`}><span className="text-text-muted">{label}</span>{children}</label>

/**
 * The comprehensive booking. Each optional block sets up a next step on its own:
 *   recipient → arrival texts + driver address · pickup → appears on the pickup board/run · pieces → labels whose scans move the status
 *   price → invoice created and sent · vehicle → vehicle export checklist.
 */
export function BookingForm({ client, consignees, onDone, onCancel }: { client: Client; consignees: Consignee[]; onDone: (toast: string) => void | Promise<void>; onCancel: () => void }) {
  const def = consignees.find((k) => k.isDefault) ?? consignees[0]
  const [mode, setMode] = useState<Mode>('ocean')
  const [origin, setOrigin] = useState(client.city || '')
  const [destination, setDestination] = useState(def?.country ?? 'GH')
  const [cargo, setCargo] = useState<CargoType>('barrels')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1'); const [weight, setWeight] = useState(''); const [dims, setDims] = useState(''); const [declared, setDeclared] = useState('')
  const [readyDate, setReadyDate] = useState(plusDays(2))
  const [eta, setEta] = useState(plusDays(2 + transitDays('ocean', def?.country ?? 'GH')))
  const [etaTouched, setEtaTouched] = useState(false)
  const [note, setNote] = useState('')
  const [rcpMode, setRcpMode] = useState<'saved' | 'new' | 'later'>(def ? 'saved' : 'new')
  const [consigneeId, setConsigneeId] = useState(def?.id ?? '')
  const [rcp, setRcp] = useState({ name: '', phone: '', address: '', city: '', relationship: '' })
  const [wantPickup, setWantPickup] = useState(false)
  const [pickup, setPickup] = useState({ date: plusDays(2), windowStart: '09:00', windowEnd: '12:00', address: '', city: client.city || '', contactName: client.name, contactPhone: client.phone || '', notes: '' })
  const [veh, setVeh] = useState({ vin: '', year: '', make: '', model: '', running: true, method: 'roro' as 'roro' | 'container', titleStatus: 'clean' as 'clean' | 'salvage' | 'rebuilt' | 'lien' })
  const [price, setPrice] = useState({ freight: '', pickup: '', delivery: '', insurance: '', other: '', otherLabel: '', tax: '' })
  const [dueDays, setDueDays] = useState(14)
  const [invoice, setInvoice] = useState(true); const [sendInvoice, setSendInvoice] = useState(true)
  const [labels, setLabels] = useState(true); const [sendTracking, setSendTracking] = useState(true)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [handover, setHandover] = useState<'delivery' | 'collection'>('collection')
  const [lanes, setLanes] = useState<LaneTimes | null>(null)

  useEffect(() => { shipmentOpsApi.prefs().then((p) => { setDueDays(p.invoiceDueDays); setLabels(p.autoLabels); setSendTracking(p.autoTrackingLink); setHandover(p.defaultHandover) }).catch(() => {}); shipmentOpsApi.laneTimes().then(setLanes).catch(() => {}) }, [])
  /** Your own median door-to-door days on this lane once there are 3+ deliveries, else the typical range. */
  const learned = lanes?.lanes.find((l) => l.mode === mode && l.destination === destination && l.shipments >= 3)
  const laneDays = learned ? learned.medianDays : transitDays(mode, destination)
  // ETA follows the ready date and lane until someone edits it by hand.
  useEffect(() => { if (!etaTouched) setEta(plusDays(laneDays, readyDate || today())) }, [laneDays, readyDate, etaTouched])
  useEffect(() => { if (wantPickup) setPickup((p) => ({ ...p, date: readyDate || p.date })) }, [readyDate, wantPickup])

  const total = useMemo(() => num(price.freight) + num(price.pickup) + num(price.delivery) + num(price.insurance) + num(price.other) + num(price.tax), [price])
  const qty = Math.max(1, Math.round(num(quantity)))
  const isVehicle = cargo === 'vehicle'
  const steps = [
    rcpMode !== 'later' ? (handover === 'collection' ? 'recipient gets arrival texts and a collection code' : 'recipient gets arrival texts') : 'client asked for the recipient',
    wantPickup && `pickup on ${pickup.date} goes on the pickup board`,
    labels && !isVehicle && `${qty} label${qty === 1 ? '' : 's'} — scans move the status`,
    invoice && total > 0 && `invoice for ${money(total)}${sendInvoice ? ' sent to the client' : ' saved'}`,
    'packing list generated',
    sendTracking && client.userId && 'client gets the tracking link',
    isVehicle && 'vehicle export checklist starts',
  ].filter(Boolean) as string[]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (origin.trim().length < 2) return setErr('Enter where it ships from.')
    if (rcpMode === 'new' && rcp.name.trim().length < 2) return setErr('Enter the recipient’s name, or choose “Add later”.')
    if (wantPickup && pickup.address.trim().length < 3) return setErr('Enter the pickup address.')
    if (invoice && num(price.freight) <= 0) return setErr('Enter the freight price for the invoice, or untick “Create the invoice”.')
    const b: FullBooking = {
      mode, origin: origin.trim(), destination, cargo, description: description.trim(), quantity: qty, weightKg: weight ? num(weight) : undefined, dims: dims.trim(), declaredValueUsd: declared ? num(declared) : undefined,
      eta, readyDate: readyDate || undefined, note: note.trim(),
      consigneeId: rcpMode === 'saved' && consigneeId ? consigneeId : undefined,
      consignee: rcpMode === 'new' ? { ...rcp, country: destination } : undefined,
      pickup: wantPickup ? pickup : undefined,
      vehicle: isVehicle ? { ...veh, year: veh.year ? Number(veh.year) : null } : undefined,
      price: num(price.freight) > 0 ? { freightUsd: num(price.freight), pickupUsd: num(price.pickup), deliveryUsd: num(price.delivery), insuranceUsd: num(price.insurance), otherUsd: num(price.other), otherLabel: price.otherLabel, taxUsd: num(price.tax), dueDays, createInvoice: invoice, sendInvoice } : undefined,
      labels: labels && !isVehicle, sendTracking, handover,
    }
    setBusy(true)
    try { const r = await shipmentOpsApi.book(client.id, b); await onDone(`${r.shipment.ref} booked${r.did.length ? ` — ${r.did.join(', ')}` : ''}.`) }
    catch (er) { setErr(er instanceof Error ? er.message : 'Could not book.') } finally { setBusy(false) }
  }

  const P = (k: keyof typeof price, label: string) => <L label={label}><input inputMode="decimal" className="input-dark !min-h-10" value={price[k]} onChange={(e) => setPrice({ ...price, [k]: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" data-testid={`price-${k}`} /></L>

  return (
    <form onSubmit={submit} className="card-dark mt-4 grid gap-5 p-5" aria-label="New shipment" data-testid="booking-form">
      <Section icon={Package} title="Route & cargo" hint="What’s going where. The ETA fills in from the lane’s typical transit.">
        <div className="grid gap-3 md:grid-cols-3">
          <L label="Mode"><div className="flex gap-2">{(['ocean', 'air'] as Mode[]).map((m) => <button type="button" key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize focus-ring ${mode === m ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted'}`}>{m}</button>)}</div></L>
          <div className="grid gap-1 text-xs"><label htmlFor="bk-origin" className="text-text-muted">Ships from</label><OriginCombobox id="bk-origin" value={origin} onChange={setOrigin} /></div>
          <L label="Destination"><select className="input-dark !min-h-10" value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="bk-dest">{countries.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}</select></L>
          <L label="Cargo"><select className="input-dark !min-h-10" value={cargo} onChange={(e) => setCargo(e.target.value as CargoType)} data-testid="bk-cargo">{cargoTypes.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></L>
          <L label={isVehicle ? 'Vehicles' : 'Pieces (barrels, boxes, pallets…)'}><input type="number" min={1} max={500} className="input-dark !min-h-10" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="bk-qty" /></L>
          <L label="Total weight, kg (optional)"><input inputMode="decimal" className="input-dark !min-h-10" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 240" /></L>
          <L label="Description" className="md:col-span-2"><input className="input-dark !min-h-10" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isVehicle ? '2017 Honda Accord, keys + spare tyre' : '3 blue barrels of provisions and clothing'} data-testid="bk-desc" /></L>
          <L label="Dimensions (optional)"><input className="input-dark !min-h-10" value={dims} onChange={(e) => setDims(e.target.value)} placeholder="L×W×H, e.g. 90×60×60 cm" /></L>
          <L label="Ready to collect"><input type="date" min={today()} className="input-dark !min-h-10" value={readyDate} onChange={(e) => setReadyDate(e.target.value)} /></L>
          <L label={learned ? `ETA — your median on this lane is ${learned.medianDays} days (${learned.onTimeRate}% on time)` : 'ETA at destination'}><input type="date" required min={today()} className="input-dark !min-h-10" value={eta} onChange={(e) => { setEta(e.target.value); setEtaTouched(true) }} data-testid="bk-eta" /></L>
          <L label="Declared value, USD (optional)"><input inputMode="decimal" className="input-dark !min-h-10" value={declared} onChange={(e) => setDeclared(e.target.value.replace(/[^\d.]/g, ''))} placeholder="For insurance & customs" /></L>
        </div>
      </Section>

      {isVehicle && (
        <Section icon={Car} title="Vehicle" hint="Starts the export checklist (title, AES filing) on the shipment.">
          <div className="grid gap-3 md:grid-cols-4">
            <L label="VIN" className="md:col-span-2"><input className="input-dark !min-h-10 font-mono uppercase" maxLength={17} value={veh.vin} onChange={(e) => setVeh({ ...veh, vin: e.target.value.toUpperCase() })} /></L>
            <L label="Year"><input type="number" min={1950} max={2030} className="input-dark !min-h-10" value={veh.year} onChange={(e) => setVeh({ ...veh, year: e.target.value })} /></L>
            <L label="Make"><input className="input-dark !min-h-10" value={veh.make} onChange={(e) => setVeh({ ...veh, make: e.target.value })} placeholder="Honda" /></L>
            <L label="Model"><input className="input-dark !min-h-10" value={veh.model} onChange={(e) => setVeh({ ...veh, model: e.target.value })} placeholder="Accord" /></L>
            <L label="Shipping method"><select className="input-dark !min-h-10" value={veh.method} onChange={(e) => setVeh({ ...veh, method: e.target.value as 'roro' })}><option value="roro">RoRo</option><option value="container">In a container</option></select></L>
            <L label="Title"><select className="input-dark !min-h-10" value={veh.titleStatus} onChange={(e) => setVeh({ ...veh, titleStatus: e.target.value as 'clean' })}><option value="clean">Clean</option><option value="salvage">Salvage</option><option value="rebuilt">Rebuilt</option><option value="lien">Has a lien</option></select></L>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-text-muted"><input type="checkbox" className="accent-gold" checked={veh.running} onChange={(e) => setVeh({ ...veh, running: e.target.checked })} /> Runs and drives</label>
          </div>
        </Section>
      )}

      <Section icon={UserRound} title="Recipient in West Africa" hint="Who collects it. They get arrival texts and a link to confirm receipt.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Recipient">
          {consignees.length > 0 && <button type="button" role="radio" aria-checked={rcpMode === 'saved'} onClick={() => setRcpMode('saved')} className={`rounded-full border px-3 py-1.5 text-xs focus-ring ${rcpMode === 'saved' ? 'border-gold bg-gold/15 text-gold-deep font-semibold' : 'border-border text-text-muted'}`}>Saved recipient</button>}
          <button type="button" role="radio" aria-checked={rcpMode === 'new'} onClick={() => setRcpMode('new')} className={`rounded-full border px-3 py-1.5 text-xs focus-ring ${rcpMode === 'new' ? 'border-gold bg-gold/15 text-gold-deep font-semibold' : 'border-border text-text-muted'}`} data-testid="rcp-new">New recipient</button>
          <button type="button" role="radio" aria-checked={rcpMode === 'later'} onClick={() => setRcpMode('later')} className={`rounded-full border px-3 py-1.5 text-xs focus-ring ${rcpMode === 'later' ? 'border-gold bg-gold/15 text-gold-deep font-semibold' : 'border-border text-text-muted'}`} data-testid="rcp-later">Add later</button>
        </div>
        {rcpMode === 'saved' && <L label="Recipient"><select className="input-dark !min-h-10" value={consigneeId} onChange={(e) => { setConsigneeId(e.target.value); const k = consignees.find((x) => x.id === e.target.value); if (k) setDestination(k.country) }}>{consignees.map((k) => <option key={k.id} value={k.id}>{k.name}{k.city ? ` · ${k.city}` : ''}{k.phone ? ` · ${k.phone}` : ''}</option>)}</select></L>}
        {rcpMode === 'new' && (
          <div className="grid gap-3 md:grid-cols-3">
            <L label="Full name"><input className="input-dark !min-h-10" value={rcp.name} onChange={(e) => setRcp({ ...rcp, name: e.target.value })} data-testid="bk-rcp-name" /></L>
            <L label="Phone"><input className="input-dark !min-h-10" value={rcp.phone} onChange={(e) => setRcp({ ...rcp, phone: e.target.value })} placeholder="+233 24 …" data-testid="bk-rcp-phone" /></L>
            <L label="City"><input className="input-dark !min-h-10" value={rcp.city} onChange={(e) => setRcp({ ...rcp, city: e.target.value })} placeholder="Kumasi" /></L>
            <L label="Delivery address" className="md:col-span-2"><input className="input-dark !min-h-10" value={rcp.address} onChange={(e) => setRcp({ ...rcp, address: e.target.value })} placeholder="House no., street, landmark" /></L>
            <L label="Relationship (optional)"><input className="input-dark !min-h-10" value={rcp.relationship} onChange={(e) => setRcp({ ...rcp, relationship: e.target.value })} placeholder="Brother" /></L>
          </div>
        )}
        {rcpMode === 'later' && <p className="text-xs text-text-muted">We’ll ask {client.name.split(' ')[0]} for it{client.email || client.userId ? '' : ' (add their email so we can)'} — and it’s flagged on the shipment until it’s in.</p>}
        <div className="grid gap-1 text-xs"><span className="text-text-muted">At destination</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Handover at destination">
            {(['collection', 'delivery'] as const).map((h) => <button key={h} type="button" role="radio" aria-checked={handover === h} onClick={() => setHandover(h)} className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs focus-ring ${handover === h ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted'}`} data-testid={`bk-handover-${h}`}>{h === 'collection' ? <Store size={14} aria-hidden="true" /> : <Truck size={14} aria-hidden="true" />}<span><span className="block font-semibold">{h === 'collection' ? 'Recipient collects' : 'Door delivery'}</span><span className="block">{h === 'collection' ? 'From your warehouse with a 6-digit code' : 'A driver brings it; recipient confirms'}</span></span></button>)}
          </div>
        </div>
      </Section>

      <Section icon={Truck} title="Pickup" hint="Collecting from the client? It goes straight on the pickup board, ready for a run." aside={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-gold" checked={wantPickup} onChange={(e) => setWantPickup(e.target.checked)} data-testid="bk-pickup" /> We collect it</label>}>
        {wantPickup ? (
          <div className="grid gap-3 md:grid-cols-4">
            <L label="Date"><input type="date" min={today()} className="input-dark !min-h-10" value={pickup.date} onChange={(e) => setPickup({ ...pickup, date: e.target.value })} /></L>
            <L label="From"><input type="time" className="input-dark !min-h-10" value={pickup.windowStart} onChange={(e) => setPickup({ ...pickup, windowStart: e.target.value })} /></L>
            <L label="To"><input type="time" className="input-dark !min-h-10" value={pickup.windowEnd} onChange={(e) => setPickup({ ...pickup, windowEnd: e.target.value })} /></L>
            <L label="City"><input className="input-dark !min-h-10" value={pickup.city} onChange={(e) => setPickup({ ...pickup, city: e.target.value })} /></L>
            <L label="Pickup address" className="md:col-span-2"><input className="input-dark !min-h-10" value={pickup.address} onChange={(e) => setPickup({ ...pickup, address: e.target.value })} placeholder="Street address" data-testid="bk-pickup-addr" /></L>
            <L label="Contact"><input className="input-dark !min-h-10" value={pickup.contactName} onChange={(e) => setPickup({ ...pickup, contactName: e.target.value })} /></L>
            <L label="Contact phone"><input className="input-dark !min-h-10" value={pickup.contactPhone} onChange={(e) => setPickup({ ...pickup, contactPhone: e.target.value })} /></L>
            <L label="Driver notes (optional)" className="md:col-span-4"><input className="input-dark !min-h-10" value={pickup.notes} onChange={(e) => setPickup({ ...pickup, notes: e.target.value })} placeholder="Gate code, call on arrival, loading help needed…" /></L>
          </div>
        ) : <p className="text-xs text-text-muted">Client drops off at your warehouse.</p>}
      </Section>

      <Section icon={FileText} title="Price & invoice" hint="Enter the price once — the invoice is built from it and the shipment details.">
        <div className="grid gap-3 md:grid-cols-4">
          {P('freight', `${mode === 'air' ? 'Air' : 'Ocean'} freight, USD`)}{P('pickup', 'Pickup, USD')}{P('delivery', 'Door delivery, USD')}{P('insurance', 'Insurance, USD')}
          {P('other', 'Other charge, USD')}<L label="Other charge — label"><input className="input-dark !min-h-10" value={price.otherLabel} onChange={(e) => setPrice({ ...price, otherLabel: e.target.value })} placeholder="Packing, storage…" /></L>{P('tax', 'Tax / fees, USD')}
          <L label="Due after (days)"><input type="number" min={0} max={120} className="input-dark !min-h-10" value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} /></L>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-gold" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} data-testid="bk-invoice" /> Create the invoice</label>
            <label className={`flex items-center gap-2 ${invoice ? '' : 'opacity-50'}`}><input type="checkbox" className="accent-gold" disabled={!invoice} checked={sendInvoice} onChange={(e) => setSendInvoice(e.target.checked)} /> Send it to {client.name.split(' ')[0]}{client.email ? '' : ' (no email on file)'}</label>
          </div>
          <p className="text-sm">Total <strong className="font-heading text-lg tabular-nums" data-testid="bk-total">{money(total)}</strong></p>
        </div>
      </Section>

      <Section icon={Zap} title="Automation" hint="These keep the status moving without anyone clicking.">
        <div className="flex flex-wrap gap-4 text-sm">
          {!isVehicle && <label className="flex items-center gap-2"><input type="checkbox" className="accent-gold" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Create {qty} scannable label{qty === 1 ? '' : 's'}</label>}
          <label className={`flex items-center gap-2 ${client.userId ? '' : 'opacity-50'}`} title={client.userId ? '' : 'This client has no Ntemtem account yet'}><input type="checkbox" className="accent-gold" disabled={!client.userId} checked={sendTracking && !!client.userId} onChange={(e) => setSendTracking(e.target.checked)} /> Send the tracking link</label>
        </div>
        <L label="Internal note on the timeline (optional)"><input className="input-dark !min-h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fragile — keep upright" /></L>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-text-muted" data-testid="bk-summary"><MapPin size={13} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />{steps.length ? <>On booking: {steps.join(' · ')}.</> : 'Books the shipment only.'}</p>
        {err && <p role="alert" className="w-full text-sm text-danger" data-testid="bk-error">{err}</p>}
        <div className="flex gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-5 text-sm disabled:opacity-60" data-testid="bk-submit"><Check size={15} aria-hidden="true" /> {busy ? 'Booking…' : 'Book shipment'}</button></div>
      </div>
    </form>
  )
}
