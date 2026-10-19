import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Banknote, Box, Car, Check, ClipboardSignature, FileText, MapPin, Minus, Plus, Printer, Scale, ScanLine, Smartphone, Tag } from 'lucide-react'
import type { Run, RunStop } from '../../lib/ops'
import { driverApi, type StopDetails } from '../../lib/driverApi'
import { useT } from '../../lib/i18n'
import { MeasureCard } from '../MeasureCard'
import { SignaturePad } from '../SignaturePad'
import { Viewfinder } from '../../pages/Scan'
import { Big, Choice, Msg, PhotoField, Sheet, errText } from './DriverUi'

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const local = (n: number, cur: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n.toLocaleString()}` } }

/** The stop's extra details (pieces, supplies, papers, charges…) — loaded when the stop is open. */
export function useStopDetails(runId: string | undefined, stopId: string | undefined, online: boolean, status?: string) {
  const [d, setD] = useState<StopDetails | null>(null); const [tick, setTick] = useState(0)
  useEffect(() => { setD(null); if (!runId || !stopId || !online) return; let live = true; driverApi.details(runId, stopId).then((x) => live && setD(x)).catch(() => {}); return () => { live = false } }, [runId, stopId, online, tick, status])
  return { d, reload: () => setTick((n) => n + 1) }
}

type Tool = 'measure' | 'labels' | 'supplies' | 'vehicle' | 'price' | 'papers' | 'charges'
/** "At the door" buttons on the next-stop card. What shows depends on the run kind and the shipment. */
export function StopTools({ run, stop, d, reload, onInfo }: { run: Run; stop: RunStop; d: StopDetails | null; reload: () => void; onInfo: (s: string) => void }) {
  const t = useT(); const [open, setOpen] = useState<Tool | null>(null)
  if (!d?.shipment) return null
  const pickup = run.kind === 'pickup'
  const due = (d.charges ?? []).filter((c) => c.status === 'due')
  const btn = 'flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface px-3 text-base font-semibold focus-ring'
  const close = (msg?: string) => { setOpen(null); reload(); if (msg) onInfo(msg) }
  return (
    <div className="mt-4" data-testid="stop-tools">
      <p className="text-sm font-bold uppercase tracking-wider text-text-muted">{t('At the door')}</p>
      {!!d.adjustments?.length && <button onClick={() => setOpen('price')} className="mt-2 flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-gold bg-gold/15 px-4 text-left text-base font-semibold focus-ring" data-testid="tool-price"><ClipboardSignature size={20} aria-hidden="true" /> <span className="min-w-0 flex-1">{t('New price {amount} — get it signed', { amount: money(d.adjustments[0].newUsd) })}</span></button>}
      {!pickup && d.code.required && <p className={`mt-2 rounded-xl px-3 py-2 text-base ${d.code.verified ? 'bg-teal/10 text-teal' : 'bg-surface-2'}`} data-testid="code-hint">{d.code.verified ? t('Delivery code checked') : t('Ask for the 4-digit delivery code they got by text.')}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {pickup && <button className={btn} onClick={() => setOpen('measure')} data-testid="tool-measure"><Scale size={20} aria-hidden="true" /> {t('Weigh')}</button>}
        {pickup && <button className={btn} onClick={() => setOpen('labels')} data-testid="tool-labels"><Tag size={20} aria-hidden="true" /> {t('Labels')}</button>}
        {pickup && (d.supplies?.length || d.catalog?.length) ? <button className={btn} onClick={() => setOpen('supplies')} data-testid="tool-supplies"><Box size={20} aria-hidden="true" /> {t('Supplies')}{stop.suppliesDropped ? <Check size={16} className="text-teal" aria-label={t('Done')} /> : null}</button> : null}
        {pickup && d.shipment.cargo === 'vehicle' && <button className={btn} onClick={() => setOpen('vehicle')} data-testid="tool-vehicle"><Car size={20} aria-hidden="true" /> {t('Car check-in')}{d.vehicleReport ? <Check size={16} className="text-teal" aria-label={t('Done')} /> : null}</button>}
        {!pickup && !!due.length && <button className={`${btn} col-span-2 !border-gold`} onClick={() => setOpen('charges')} data-testid="tool-charges"><Banknote size={20} aria-hidden="true" /> {t('Collect {amount}', { amount: due.map((c) => local(c.amount, c.currency)).join(' + ') })}</button>}
        {!!d.documents?.length && <button className={btn} onClick={() => setOpen('papers')} data-testid="tool-papers"><FileText size={20} aria-hidden="true" /> {t('Papers')} <span className="text-text-muted">· {d.documents.length}</span></button>}
      </div>
      {!pickup && <DoorCard run={run} stop={stop} d={d} onSaved={(m) => { reload(); onInfo(m) }} />}
      {open === 'measure' && <MeasureSheet run={run} stop={stop} d={d} onClose={() => close()} />}
      {open === 'labels' && <LabelsSheet run={run} stop={stop} d={d} onClose={() => close()} />}
      {open === 'supplies' && <SuppliesSheet run={run} stop={stop} d={d} onClose={close} />}
      {open === 'vehicle' && <VehicleReportSheet run={run} stop={stop} d={d} onClose={close} />}
      {open === 'price' && <PriceSheet run={run} stop={stop} d={d} onClose={close} />}
      {open === 'papers' && <PapersSheet d={d} onClose={() => setOpen(null)} />}
      {open === 'charges' && <ChargesSheet run={run} stop={stop} d={d} onClose={close} />}
    </div>
  )
}

/* ---- delivery: GhanaPost GPS, landmark, save the exact door ---- */
function DoorCard({ run, stop, d, onSaved }: { run: Run; stop: RunStop; d: StopDetails; onSaved: (m: string) => void }) {
  const t = useT(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const r = d.receiver
  const save = () => {
    if (!navigator.geolocation) { setErr(t('This phone can’t share its location.')); return }
    setBusy(true); setErr('')
    navigator.geolocation.getCurrentPosition(async (p) => { try { await driverApi.pin(run.id, stop.id, Math.round(p.coords.latitude * 1e6) / 1e6, Math.round(p.coords.longitude * 1e6) / 1e6); onSaved(t('Door location saved — next time the pin goes straight here.')) } catch (e) { setErr(errText(e, t('Could not save.'))) } finally { setBusy(false) } }, () => { setBusy(false); setErr(t('Location is blocked. Allow it for this site.')) }, { enableHighAccuracy: true, timeout: 20000 })
  }
  if (!r?.gps && !r?.address) return <div className="mt-2"><button onClick={save} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-base font-semibold focus-ring" data-testid="save-door"><MapPin size={18} aria-hidden="true" /> {busy ? t('Finding you…') : t('I’m at the door — save this spot')}</button><Msg err={err} /></div>
  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface-2/60 p-3" data-testid="door-card">
      {r.gps && <p className="text-base"><span className="text-text-muted">{t('GhanaPost GPS')}:</span> <b className="font-mono">{r.gps}</b> <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.gps)}`} target="_blank" rel="noreferrer" className="ml-1 inline-flex min-h-11 items-center text-gold-deep underline">{t('Open')}</a></p>}
      {r.address && <p className="text-base"><span className="text-text-muted">{t('Landmark')}:</span> {r.address}{r.city ? `, ${r.city}` : ''}</p>}
      <button onClick={save} disabled={busy} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-surface text-base font-semibold focus-ring" data-testid="save-door"><MapPin size={18} aria-hidden="true" /> {busy ? t('Finding you…') : r.lat != null ? t('Update the door location') : t('I’m at the door — save this spot')}</button>
      <Msg err={err} />
    </div>
  )
}

/* ---- pickup: weigh & measure (piece count first) ---- */
function MeasureSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: () => void }) {
  const t = useT(); const [count, setCount] = useState(d.pieces?.length ?? 1); const [k, setK] = useState(0); const [err, setErr] = useState('')
  const setPieces = async (n: number) => { setCount(n); try { await driverApi.setPieces(run.id, stop.id, n); setK((x) => x + 1) } catch (e) { setErr(errText(e, t('Could not save.'))) } }
  return (
    <Sheet title={t('Weigh & measure')} onClose={onClose} testid="measure-sheet" footer={<Big tone="gold" onClick={onClose} testid="measure-done"><Check size={22} aria-hidden="true" /> {t('Done')}</Big>}>
      <p className="text-base text-text-muted">{d.shipment?.ref} · {d.shipment?.description}</p>
      <p className="label-dark mt-4" id="m-count">{t('How many pieces?')}</p>
      <div className="flex items-center gap-3" role="group" aria-labelledby="m-count">
        <button type="button" onClick={() => count > 1 && void setPieces(count - 1)} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-border focus-ring" aria-label={t('One fewer')}><Minus size={22} /></button>
        <span className="w-16 text-center text-3xl font-bold tabular-nums" data-testid="m-count">{count}</span>
        <button type="button" onClick={() => void setPieces(count + 1)} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-border focus-ring" aria-label={t('One more')}><Plus size={22} /></button>
      </div>
      <div className="mt-4"><MeasureCard key={k} shipmentId={d.shipment!.id} big /></div>
      <p className="mt-3 text-sm text-text-muted">{t('If the weight changes the price, the new price shows on this stop for the sender to sign.')}</p>
      <Msg err={err} />
    </Sheet>
  )
}

/* ---- pickup: print labels, or link pre-printed stickers ---- */
function LabelsSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: () => void }) {
  const t = useT(); const [pieces, setPieces] = useState(d.pieces ?? []); const [linking, setLinking] = useState<string | null>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [paused, setPaused] = useState(false)
  const link = async (code: string) => {
    if (!linking) return; setPaused(true); setErr('')
    try { await driverApi.sticker(run.id, stop.id, linking, code); setPieces((ps) => ps.map((p) => (p.id === linking ? { ...p, sticker: code } : p))); const nextP = pieces.find((p) => !p.sticker && p.id !== linking); setMsg(t('Sticker linked.')); setLinking(nextP?.id ?? null) }
    catch (e) { setErr(errText(e, t('Could not link.'))) } finally { setTimeout(() => setPaused(false), 1200) }
  }
  return (
    <Sheet title={t('Labels')} onClose={onClose} testid="labels-sheet">
      <Link to={`/dashboard/labels?shipments=${d.shipment!.id}&size=4x6`} target="_blank" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-base font-semibold text-on-accent focus-ring" data-testid="print-labels"><Printer size={20} aria-hidden="true" /> {t('Print {n} labels', { n: pieces.length })}</Link>
      <p className="mt-2 text-sm text-text-muted">{t('Opens the phone’s print screen — pick your Bluetooth or Wi-Fi label printer there.')}</p>
      <h3 className="mt-6 !text-lg">{t('Or use pre-printed stickers')}</h3>
      <p className="text-sm text-text-muted">{t('Stick one on each piece, then scan it here. Scans of that sticker find this piece from now on.')}</p>
      <ul className="mt-3 space-y-2">{pieces.map((p) => (
        <li key={p.id}><button type="button" onClick={() => setLinking(p.id)} aria-pressed={linking === p.id} className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-2xl border-2 px-4 text-left text-base focus-ring ${linking === p.id ? 'border-gold bg-gold/10' : 'border-border bg-surface'}`} data-testid="sticker-row">
          <span><b>P{p.seq}</b> <span className="font-mono text-sm text-text-muted">{p.labelCode}</span></span>
          <span className="text-sm">{p.sticker ? <span className="text-teal"><Check size={14} className="inline" aria-hidden="true" /> {p.sticker}</span> : linking === p.id ? t('Scan now') : t('Tap to link')}</span>
        </button></li>))}</ul>
      {linking && <div className="mt-3"><Viewfinder onCode={link} paused={paused} /><form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get('c') as string).trim(); if (v) void link(v); e.currentTarget.reset() }}><label htmlFor="st-code" className="sr-only">{t('Sticker code')}</label><input id="st-code" name="c" className="input-dark !min-h-12 flex-1 font-mono" placeholder={t('Or type the sticker code')} data-testid="sticker-code" /><button className="btn-gold !min-h-12"><ScanLine size={18} aria-hidden="true" /> {t('Link')}</button></form></div>}
      <Msg err={err} ok={msg} />
    </Sheet>
  )
}

/* ---- pickup: drop off packing supplies, sell extras ---- */
function SuppliesSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: (m?: string) => void }) {
  const t = useT()
  const lines = (d.supplies ?? []).filter((s) => s.status !== 'cancelled')
  const [dropped, setDropped] = useState<string[]>(d.suppliesDrop?.lines ?? []); const [sell, setSell] = useState(''); const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try { await driverApi.supplies(run.id, stop.id, { dropped, sell: sell ? { supplyId: sell, qty } : undefined }); onClose(sell ? t('Added to their bill.') : t('Supplies noted.')) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy(false) }
  }
  return (
    <Sheet title={t('Packing supplies')} onClose={() => onClose()} testid="supplies-sheet" footer={<Big tone="gold" onClick={save} disabled={busy || (!dropped.length && !sell)} testid="supplies-save"><Check size={22} aria-hidden="true" /> {busy ? t('Saving…') : t('Save')}</Big>}>
      {lines.length > 0 && <><p className="label-dark">{t('Tick what you dropped off')}</p>
        <div className="grid gap-2">{lines.map((l) => { const on = dropped.includes(l.id); return <button key={l.id} type="button" role="checkbox" aria-checked={on} onClick={() => setDropped((x) => (on ? x.filter((y) => y !== l.id) : [...x, l.id]))} className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 text-left text-base font-semibold focus-ring ${on ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`} data-testid="supply-line"><span className={`grid h-6 w-6 place-items-center rounded-md border-2 ${on ? 'border-gold bg-gold text-on-accent' : 'border-border'}`} aria-hidden="true">{on && <Check size={14} />}</span>{l.qty} × {l.name}</button> })}</div></>}
      {!!d.catalog?.length && <>
        <p className="label-dark mt-5">{t('They want more? Sell extras')}</p>
        <div className="grid gap-2" role="radiogroup" aria-label={t('Item')}>{d.catalog.map((c) => <Choice key={c.id} on={sell === c.id} onClick={() => setSell(sell === c.id ? '' : c.id)} testid="supply-sell">{c.name} <span className="font-normal text-text-muted">· {money(c.priceUsd)}</span></Choice>)}</div>
        {sell && <div className="mt-3 flex items-center gap-3"><span className="text-base">{t('How many?')}</span><button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-border" aria-label={t('One fewer')}><Minus size={20} /></button><span className="w-10 text-center text-2xl font-bold tabular-nums">{qty}</span><button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} className="grid h-12 w-12 place-items-center rounded-xl border-2 border-border" aria-label={t('One more')}><Plus size={20} /></button><span className="ml-auto text-base font-bold">{money((d.catalog.find((c) => c.id === sell)?.priceUsd ?? 0) * qty)}</span></div>}
      </>}
      <Msg err={err} />
    </Sheet>
  )
}

/* ---- pickup: car condition report ---- */
const SIDES = [['front', 'Front'], ['back', 'Back'], ['left', 'Left side'], ['right', 'Right side'], ['odometer', 'Odometer'], ['damage1', 'Damage'], ['damage2', 'Damage']] as const
function VehicleReportSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: (m?: string) => void }) {
  const t = useT()
  const [photos, setPhotos] = useState<Record<string, string>>({}); const [checks, setChecks] = useState({ title: false, keys: false, fuel: false, personalItems: false })
  const [mileage, setMileage] = useState(''); const [damage, setDamage] = useState(''); const [signer, setSigner] = useState(stop.contact || ''); const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const v = d.vehicle ?? {}
  const submit = async () => {
    if (!photos.front || !photos.back || !photos.left || !photos.right) { setErr(t('Take a photo of all four sides.')); return }
    if (!sig || signer.trim().length < 2) { setErr(t('The sender signs the report.')); return }
    setBusy(true); setErr('')
    try { const r = await driverApi.vehicleReport(run.id, stop.id, { photos, checks, mileage: mileage ? Number(mileage) : undefined, damage: damage.trim(), signerName: signer.trim(), signature: sig }); onClose(r.flags.length ? t('Saved. The office was told: {flags}.', { flags: r.flags.join(', ') }) : t('Condition report saved.')) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy(false) }
  }
  const tick = (k: keyof typeof checks, l: string) => <button type="button" role="checkbox" aria-checked={checks[k]} onClick={() => setChecks((c) => ({ ...c, [k]: !c[k] }))} className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 text-left text-base font-semibold focus-ring ${checks[k] ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`} data-testid={`vr-${k}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${checks[k] ? 'border-gold bg-gold text-on-accent' : 'border-border'}`} aria-hidden="true">{checks[k] && <Check size={14} />}</span>{l}</button>
  return (
    <Sheet title={t('Car check-in')} onClose={() => onClose()} testid="vreport-sheet" footer={<Big tone="gold" onClick={submit} disabled={busy} testid="vr-save"><ClipboardSignature size={20} aria-hidden="true" /> {busy ? t('Saving…') : t('Save signed report')}</Big>}>
      <p className="text-base">{[v.year, v.make, v.model].filter(Boolean).join(' ') || t('Vehicle')}{v.color ? ` · ${v.color}` : ''}{v.vin ? <span className="block font-mono text-sm text-text-muted">VIN {v.vin}</span> : null}</p>
      <p className="label-dark mt-4">{t('Photos')}</p>
      <div className="grid grid-cols-2 gap-2">{SIDES.map(([k, l]) => <PhotoField key={k} compact value={photos[k] ?? ''} onChange={(x) => setPhotos((p) => ({ ...p, [k]: x }))} label={`${t(l)}${k.startsWith('damage') ? '' : k === 'odometer' ? '' : ' *'}`} testid={`vr-photo-${k}`} />)}</div>
      <label htmlFor="vr-miles" className="label-dark mt-4">{t('Mileage')}</label>
      <input id="vr-miles" inputMode="numeric" className="input-dark !min-h-12 text-lg tabular-nums" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/\D/g, '').slice(0, 7))} />
      <div className="mt-4 grid gap-2">{tick('title', t('Title in hand'))}{tick('keys', t('Keys handed over'))}{tick('fuel', t('Fuel at ¼ tank or less'))}{tick('personalItems', t('Personal items inside'))}</div>
      {!checks.fuel && <p className="mt-2 text-sm text-gold-deep">{t('Ports refuse cars with more than ¼ tank. Ask them to run it down or note it.')}</p>}
      <label htmlFor="vr-damage" className="label-dark mt-4">{t('Existing damage')} <span className="font-normal text-text-muted">({t('optional')})</span></label>
      <input id="vr-damage" className="input-dark !min-h-12" value={damage} onChange={(e) => setDamage(e.target.value)} placeholder={t('e.g. scratch on rear bumper')} />
      <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">{t('Reminder: vehicles need an EEI (AES) filing before export — the office handles it, but the title must be in hand.')}</p>
      <label htmlFor="vr-signer" className="label-dark mt-4">{t('Sender’s name')}</label>
      <input id="vr-signer" className="input-dark !min-h-12" value={signer} onChange={(e) => setSigner(e.target.value)} />
      <p className="label-dark mt-3">{t('Sender signs to agree the condition')}</p>
      <SignaturePad value={sig} onChange={setSig} height={170} />
      <Msg err={err} />
    </Sheet>
  )
}

/* ---- pickup: new price after weighing, signed at the door ---- */
function PriceSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: (m?: string) => void }) {
  const t = useT(); const a = d.adjustments![0]
  const [signer, setSigner] = useState(stop.contact || ''); const [sig, setSig] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async (decision: 'approve' | 'decline') => {
    if (!sig || signer.trim().length < 2) { setErr(t('The sender signs to approve or decline.')); return }
    setBusy(true); setErr('')
    try { await driverApi.approvePrice(run.id, stop.id, { adjustmentId: a.id, signerName: signer.trim(), signature: sig, decision }); onClose(decision === 'approve' ? t('Approved — the invoice is updated.') : t('Declined — the office will call them.')) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy(false) }
  }
  return (
    <Sheet title={t('Updated price')} onClose={() => onClose()} testid="price-sheet">
      <div className="rounded-3xl border-2 border-gold bg-surface p-5 text-center">
        <p className="text-base text-text-muted line-through">{money(a.oldUsd)}</p>
        <p className="text-4xl font-bold tabular-nums">{money(a.newUsd)}</p>
        <p className="mt-2 text-base">{a.reason}</p>
      </div>
      <p className="mt-3 text-base">{t('Show this to the sender. They sign below to approve the new price.')}</p>
      <label htmlFor="pr-signer" className="label-dark mt-4">{t('Sender’s name')}</label>
      <input id="pr-signer" className="input-dark !min-h-12" value={signer} onChange={(e) => setSigner(e.target.value)} />
      <p className="label-dark mt-3">{t('Signature')}</p>
      <SignaturePad value={sig} onChange={setSig} height={170} />
      <Msg err={err} />
      <div className="mt-4 grid gap-2"><Big tone="gold" onClick={() => go('approve')} disabled={busy} testid="price-approve"><Check size={22} aria-hidden="true" /> {t('Approve {amount}', { amount: money(a.newUsd) })}</Big><Big onClick={() => go('decline')} disabled={busy} testid="price-decline">{t('They don’t agree')}</Big></div>
    </Sheet>
  )
}

/* ---- delivery: customs papers ---- */
function PapersSheet({ d, onClose }: { d: StopDetails; onClose: () => void }) {
  const t = useT()
  return (
    <Sheet title={t('Papers')} onClose={onClose} testid="papers-sheet">
      <p className="text-base text-text-muted">{d.shipment?.ref} · {t('Show these at a checkpoint or to customs.')}</p>
      <ul className="mt-3 space-y-2">{(d.documents ?? []).map((x) => <li key={x.id}><Link to={`/dashboard/documents/${x.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-border bg-surface px-4 text-base font-semibold focus-ring" data-testid="paper"><FileText size={20} aria-hidden="true" /> <span className="min-w-0 flex-1 truncate">{x.title}</span></Link></li>)}</ul>
    </Sheet>
  )
}

/* ---- delivery: duty & fees in local money ---- */
function ChargesSheet({ run, stop, d, onClose }: { run: Run; stop: RunStop; d: StopDetails; onClose: (m?: string) => void }) {
  const t = useT(); const due = (d.charges ?? []).filter((c) => c.status === 'due')
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [phone, setPhone] = useState(d.receiver?.phone ?? '')
  const pay = async (cid: string, method: 'cash' | 'momo_direct') => { setBusy(cid + method); setErr(''); try { await driverApi.payCharge(run.id, stop.id, cid, method, method === 'momo_direct' ? phone : ''); onClose(t('Payment recorded.')) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy('') } }
  return (
    <Sheet title={t('Duty & fees')} onClose={() => onClose()} testid="charges-sheet">
      <p className="text-base text-text-muted">{t('Collect in local money. It’s recorded on the shipment straight away.')}</p>
      <label htmlFor="ch-phone" className="label-dark mt-4">{t('MoMo number they paid from')} <span className="font-normal text-text-muted">({t('for MoMo')})</span></label>
      <input id="ch-phone" inputMode="tel" className="input-dark !min-h-12" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <ul className="mt-4 space-y-3">{due.map((c) => (
        <li key={c.id} className="rounded-2xl border-2 border-gold/60 bg-surface p-4" data-testid="charge">
          <p className="text-2xl font-bold tabular-nums">{local(c.amount, c.currency)}</p>
          <p className="text-base text-text-muted">{c.reason}</p>
          <div className="mt-3 grid grid-cols-2 gap-2"><Big tone="gold" onClick={() => pay(c.id, 'cash')} disabled={!!busy} testid="charge-cash"><Banknote size={20} aria-hidden="true" /> {t('Paid cash')}</Big><Big onClick={() => pay(c.id, 'momo_direct')} disabled={!!busy} testid="charge-momo"><Smartphone size={20} aria-hidden="true" /> {t('Paid MoMo')}</Big></div>
        </li>))}</ul>
      <Msg err={err} />
    </Sheet>
  )
}

/** A QR code for the card pay link, shown at the door. */
export function PayQr({ url }: { url: string }) {
  const t = useT(); const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 260 }).then(setSrc).catch(() => {}) }, [url])
  return <div className="mt-3 rounded-2xl bg-white p-3 text-center text-[#0D1424]" data-testid="pay-qr">{src && <img src={src} alt={t('QR code for the card payment link')} className="mx-auto h-52 w-52" />}<p className="mt-1 text-sm">{t('They scan this and pay by card on their phone.')}</p></div>
}
