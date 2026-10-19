import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowLeft, Banknote, Camera, Check, CheckCircle2, ChevronDown, Clock, Flag, Map as MapIcon, MessageCircle, Minus, Navigation, Package, Phone, Play, Plus, Route, Send, SkipForward, Smartphone, Sun, Undo2, WifiOff, X } from 'lucide-react'
import { opsApi, type Run, type RunStop } from '../lib/ops'
import { shrinkPhoto, stopOrQueue, startQueueSync, type StopPatch } from '../lib/scan'
import { daySummary, routeLink, stopLink, telLink, useDispatch, useMyRuns, useOnline, useQueued, useWakeLock, waLink } from '../lib/driver'
import { setDisplay, useDisplay } from '../lib/prefs'
import { useT } from '../lib/i18n'
import { niceDay } from '../lib/dates'
import { BrandLoader } from '../components/BrandLoader'
import { SignaturePad } from '../components/SignaturePad'
import RunMap from '../components/RunMap'
import { fmtDateTime } from '../components/ui'

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const SKIPS = [['not_home', 'Nobody home'], ['wrong_address', 'Wrong address'], ['refused', 'Refused'], ['no_access', 'Couldn’t get in']] as const

/** Full-screen sheet for one task at a stop (proof, skip, on my way). Escape or Back closes it. */
function Sheet({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid?: string }) {
  const back = useRef<HTMLButtonElement>(null); const t = useT()
  useEffect(() => { const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; setTimeout(() => back.current?.focus(), 30); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', k) } }, [onClose])
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="ss-app fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-bg text-text" data-testid={testid}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur-xl">
        <button ref={back} onClick={onClose} className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-2 text-base font-semibold focus-ring"><ArrowLeft size={20} aria-hidden="true" /> {t('Back')}</button>
        <h2 id="sheet-title" className="ml-1 truncate !text-lg">{title}</h2>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 px-4 pb-32 pt-4">{children}</div>
    </div>, document.body)
}

/** Big, full-width action button for gloves and sunlight. */
const Big = ({ children, onClick, tone = 'ghost', disabled, testid, type = 'button' }: { children: ReactNode; onClick?: () => void; tone?: 'gold' | 'ghost' | 'danger'; disabled?: boolean; testid?: string; type?: 'button' | 'submit' }) => (
  <button type={type} onClick={onClick} disabled={disabled} data-testid={testid} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold focus-ring disabled:opacity-50 ${tone === 'gold' ? 'bg-gold text-on-accent hover:brightness-105' : tone === 'danger' ? 'border-2 border-danger text-danger' : 'border-2 border-border bg-surface hover:border-gold'}`}>{children}</button>
)

/** Proof at the stop: who took it, pieces, a photo, a signature — and any money taken at the door. */
function ProofSheet({ run, stop, onClose, onSubmit }: { run: Run; stop: RunStop; onClose: () => void; onSubmit: (p: StopPatch) => Promise<void> }) {
  const t = useT(); const delivery = run.kind === 'delivery'
  const [receivedBy, setReceivedBy] = useState(stop.contact || ''); const [pieces, setPieces] = useState<number | ''>(''); const [photo, setPhoto] = useState(''); const [signature, setSignature] = useState(''); const [note, setNote] = useState('')
  const owe = stop.collectUsd ?? 0
  const [paid, setPaid] = useState<'' | 'cash' | 'mobile_money' | 'none'>(owe ? '' : 'none'); const [amount, setAmount] = useState(String(owe || ''))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const blocked = owe > 0 && stop.collectRule === 'block' && (paid === 'none' || paid === '')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (owe && !paid) { setErr(t('Say whether you collected the money.')); return }
    setBusy(true); setErr('')
    try { await onSubmit({ status: 'done', note: note.trim() || undefined, receivedBy: delivery ? receivedBy.trim() || undefined : undefined, pieces: pieces === '' ? undefined : pieces, photo: photo || undefined, signature: signature || undefined, collected: paid === 'cash' || paid === 'mobile_money' ? { method: paid, amountUsd: Number(amount) || owe } : undefined }) }
    catch (er) { setErr(er instanceof Error ? er.message : t('Could not save.')); setBusy(false) }
  }
  return (
    <Sheet title={delivery ? t('Proof of delivery') : t('Pickup done')} onClose={onClose} testid="proof-sheet">
      <p className="text-sm text-text-muted">{stop.label}{stop.shipmentRef ? ` · ${stop.shipmentRef}` : ''}</p>
      <form onSubmit={submit} className="mt-4 space-y-5">
        {delivery && <div><label htmlFor="pod-name" className="label-dark">{t('Who received it?')}</label><input id="pod-name" className="input-dark !min-h-14 text-lg" autoComplete="off" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder={t('Their name')} required data-testid="pod-name" /></div>}
        <div>
          <p className="label-dark" id="pieces-l">{delivery ? t('Pieces handed over') : t('Pieces collected')}</p>
          <div className="flex items-center gap-3" role="group" aria-labelledby="pieces-l">
            <button type="button" onClick={() => setPieces((p) => Math.max(0, (p === '' ? 1 : p) - 1))} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-border text-text focus-ring" aria-label={t('One fewer')}><Minus size={22} /></button>
            <input aria-labelledby="pieces-l" inputMode="numeric" className="input-dark !min-h-14 w-24 text-center text-2xl font-bold tabular-nums" value={pieces} onChange={(e) => setPieces(e.target.value === '' ? '' : Math.max(0, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0)))} placeholder="–" data-testid="pod-pieces" />
            <button type="button" onClick={() => setPieces((p) => (p === '' ? 1 : p + 1))} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-border text-text focus-ring" aria-label={t('One more')}><Plus size={22} /></button>
          </div>
        </div>
        <div>
          <p className="label-dark">{t('Photo')} <span className="font-normal text-text-muted">({delivery ? t('the goods at the door') : t('the goods in the truck')})</span></p>
          {photo ? <div className="relative"><img src={photo} alt={t('Proof photo')} className="max-h-64 w-full rounded-2xl object-cover" /><button type="button" onClick={() => setPhoto('')} className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white" aria-label={t('Remove photo')}><X size={18} /></button></div>
            : <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface text-base font-semibold focus-within:ring-2 focus-within:ring-gold"><Camera size={20} aria-hidden="true" /> {t('Take a photo')}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f)) }} data-testid="pod-photo" /></label>}
        </div>
        {delivery && <div><p className="label-dark">{t('Signature')} <span className="font-normal text-text-muted">({t('optional')})</span></p><SignaturePad value={signature} onChange={setSignature} height={170} /></div>}
        {owe > 0 && (
          <fieldset className={`rounded-2xl border-2 p-4 ${stop.collectRule === 'block' ? 'border-danger/60' : 'border-gold/60'}`} data-testid="collect-box">
            <legend className="px-1 text-base font-bold">{t('Collect {amount}', { amount: money(owe) })}</legend>
            <p className="text-sm text-text-muted">{stop.collectRule === 'block' ? t('The office asked for this to be paid before handing over.') : t('Still owed on this shipment.')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={paid === 'cash'} onClick={() => setPaid('cash')} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold focus-ring ${paid === 'cash' ? 'border-gold bg-gold/15' : 'border-border'}`} data-testid="paid-cash"><Banknote size={20} aria-hidden="true" /> {t('Paid cash')}</button>
              <button type="button" aria-pressed={paid === 'mobile_money'} onClick={() => setPaid('mobile_money')} className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold focus-ring ${paid === 'mobile_money' ? 'border-gold bg-gold/15' : 'border-border'}`} data-testid="paid-momo"><Smartphone size={20} aria-hidden="true" /> {t('Paid MoMo')}</button>
              <button type="button" aria-pressed={paid === 'none'} onClick={() => setPaid('none')} className={`col-span-2 min-h-12 rounded-2xl border-2 text-base focus-ring ${paid === 'none' ? 'border-text bg-surface-2' : 'border-border'}`}>{t('Not paid')}</button>
            </div>
            {(paid === 'cash' || paid === 'mobile_money') && <div className="mt-3"><label htmlFor="paid-amt" className="label-dark">{t('Amount taken (USD)')}</label><input id="paid-amt" inputMode="decimal" className="input-dark !min-h-12 text-lg tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></div>}
            {blocked && paid === 'none' && <p className="mt-3 text-sm font-semibold text-danger" role="alert">{t('Don’t hand it over yet — call dispatch to release it.')}</p>}
          </fieldset>
        )}
        <div><label htmlFor="pod-note" className="label-dark">{t('Note')} <span className="font-normal text-text-muted">({t('optional')})</span></label><input id="pod-note" className="input-dark !min-h-12" value={note} onChange={(e) => setNote(e.target.value)} placeholder={delivery ? t('e.g. left with the neighbour') : t('e.g. one barrel taped again')} /></div>
        {err && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-bg/95 p-3 backdrop-blur-xl"><div className="mx-auto max-w-xl"><Big type="submit" tone="gold" disabled={busy || blocked} testid="pod-save"><Check size={22} aria-hidden="true" /> {busy ? t('Saving…') : delivery ? t('Mark delivered') : t('Mark collected')}</Big></div></div>
      </form>
    </Sheet>
  )
}

/** Skip with one tap: why, and whether to come back later today. */
function SkipSheet({ stop, onClose, onSubmit }: { stop: RunStop; onClose: () => void; onSubmit: (p: StopPatch) => Promise<void> }) {
  const t = useT()
  const [reason, setReason] = useState<StopPatch['skipReason']>(); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async (retry: boolean) => { if (!reason) { setErr(t('Pick a reason first.')); return } setBusy(true); setErr(''); try { await onSubmit({ status: 'skipped', skipReason: reason, retry, note: note.trim() || undefined }) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not save.')); setBusy(false) } }
  return (
    <Sheet title={t('Skip this stop')} onClose={onClose} testid="skip-sheet">
      <p className="text-sm text-text-muted">{stop.label}</p>
      <div className="mt-4 grid gap-2" role="radiogroup" aria-label={t('Why?')}>
        {[...SKIPS, ['other', 'Something else'] as const].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={reason === k} onClick={() => setReason(k)} className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 text-left text-base font-semibold focus-ring ${reason === k ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`} data-testid={`skip-${k}`}><span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${reason === k ? 'border-gold bg-gold text-on-accent' : 'border-border'}`} aria-hidden="true">{reason === k && <Check size={14} />}</span>{t(l)}</button>)}
      </div>
      <label htmlFor="skip-note" className="label-dark mt-4">{t('Anything the office should know?')} <span className="font-normal text-text-muted">({t('optional')})</span></label>
      <input id="skip-note" className="input-dark !min-h-12" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. gate locked, phone off')} />
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <div className="mt-6 grid gap-2">
        <Big tone="gold" onClick={() => go(true)} disabled={busy} testid="skip-retry"><Undo2 size={20} aria-hidden="true" /> {t('Try again later today')}</Big>
        <Big onClick={() => go(false)} disabled={busy} testid="skip-today"><SkipForward size={20} aria-hidden="true" /> {t('Skip for today')}</Big>
      </div>
      <p className="mt-3 text-sm text-text-muted">{t('Dispatch is told either way. “Later today” moves it to the end of your run.')}</p>
    </Sheet>
  )
}

function OnWaySheet({ stop, onClose, onSend }: { stop: RunStop; onClose: () => void; onSend: (minutes: number) => Promise<string> }) {
  const t = useT(); const [busy, setBusy] = useState(0); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const send = async (m: number) => { setBusy(m); setErr(''); try { setMsg(await onSend(m)) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not send.')) } finally { setBusy(0) } }
  return (
    <Sheet title={t('On my way')} onClose={onClose} testid="onway-sheet">
      <p className="text-base">{t('How far away are you from {name}?', { name: stop.contact || stop.label })}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">{[10, 20, 30, 60].map((m) => <Big key={m} onClick={() => send(m)} disabled={!!busy} tone={m === 20 ? 'gold' : 'ghost'} testid={`onway-${m}`}>{busy === m ? '…' : m === 60 ? t('About 1 hour') : t('{n} min', { n: m })}</Big>)}</div>
      {msg && <p role="status" className="mt-4 rounded-2xl border border-teal/40 bg-teal/10 p-4 text-base" data-testid="onway-sent">{msg}</p>}
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
    </Sheet>
  )
}

/** The driver's run: one big card for the next stop, the rest as a short list, done stops folded away. */
export default function DriverRun({ id }: { id: string }) {
  const t = useT(); const disp = useDisplay()
  const { runs, offline: stale, error, reload, patchLocal, setRun } = useMyRuns(); const online = useOnline(); const offline = stale || !online
  const queued = useQueued(); const { phone: dispatchPhone, who: dispatchWho } = useDispatch()
  const run = runs?.find((r) => r.id === id) ?? null
  const [sheet, setSheet] = useState<null | { kind: 'proof' | 'skip' | 'onway'; stop: RunStop }>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false); const [showDone, setShowDone] = useState(false)
  const [late, setLate] = useState(false); const [info, setInfo] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [sumNote, setSumNote] = useState('')
  useEffect(() => { startQueueSync() }, [])
  useEffect(() => { if (!info) return; const x = setTimeout(() => setInfo(''), 6000); return () => clearTimeout(x) }, [info])
  const awake = useWakeLock(run?.status === 'in_progress')
  const ordered = useMemo(() => [...(run?.stops ?? [])].sort((a, b) => a.seq - b.seq), [run])
  const pending = ordered.filter((s) => s.status === 'pending'); const finished = ordered.filter((s) => s.status !== 'pending')
  const next = pending.find((s) => s.id === pick) ?? pending[0]
  if (!runs && !offline) return <BrandLoader partner />
  if (!run) return <div className="container-x py-10"><p className="text-text-muted">{error || t('This run isn’t on your list any more.')}</p><Link to="/dashboard/runs" className="btn-gold mt-4 !min-h-12">{t('Back to my runs')}</Link></div>

  const closeStop = async (stop: RunStop, p: StopPatch) => {
    const r = await stopOrQueue(run.id, stop.id, p)
    setSheet(null); setPick(null)
    if (r.queued) {
      if (p.status === 'skipped' && p.retry) patchLocal(run.id, stop.id, { seq: Math.max(...run.stops.map((s) => s.seq)) + 1, tries: (stop.tries ?? 0) + 1, note: t('Trying again later') })
      else patchLocal(run.id, stop.id, { status: p.status as RunStop['status'], doneAt: new Date().toISOString(), note: p.note ?? '', pod: p.status === 'done' ? { receivedBy: p.receivedBy ?? '', pieces: p.pieces, hasPhoto: !!p.photo, hasSignature: !!p.signature, by: '' } : undefined, collected: p.collected ? { ...p.collected, at: new Date().toISOString() } : undefined })
      setInfo(t('No signal — saved on this phone. It goes up when you’re back online.'))
    } else { await reload(); setInfo(p.status === 'done' ? t('{label} — done.', { label: stop.label }) : p.retry ? t('Moved to the end of your run.') : t('Skipped — dispatch has been told.')) }
    if (navigator.vibrate) navigator.vibrate(40)
  }
  const act = async (fn: () => Promise<Run>) => { setBusy(true); setErr(''); try { setRun(await fn()) } catch (e) { setErr(e instanceof Error ? e.message : t('Something went wrong.')) } finally { setBusy(false) } }
  const all = routeLink(pending)
  const sum = daySummary([run])

  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-2xl py-5 pb-28 md:py-8">
        <Link to="/dashboard/runs" className="inline-flex min-h-11 items-center gap-1.5 text-base text-text-muted hover:text-text focus-ring"><ArrowLeft size={18} aria-hidden="true" /> {t('My runs')}</Link>
        <h1 className="mt-1 !text-[1.7rem] leading-tight">{run.name}</h1>
        <p className="mt-1 text-base text-text-muted">{run.kind === 'pickup' ? t('Pickups') : t('Deliveries')} · {niceDay(run.date, { lang: disp.lang })}{run.vehicleName ? ` · ${run.vehicleName}` : ''}{run.distanceKm ? ` · ~${run.distanceKm} km` : ''}</p>
        <div className="mt-3 flex items-center gap-3" aria-label={t('{done} of {n} stops done', { done: finished.length, n: ordered.length })}>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${ordered.length ? (finished.length / ordered.length) * 100 : 0}%` }} /></div>
          <span className="text-base font-semibold tabular-nums" data-testid="run-progress">{finished.length}/{ordered.length}</span>
        </div>

        {(offline || queued > 0) && <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl border border-gold/50 bg-gold/10 px-4 py-3 text-base" data-testid="offline-banner"><WifiOff size={18} aria-hidden="true" /> {offline ? t('Offline') : t('Back online')}{queued ? ` · ${t('{n} updates waiting', { n: queued })}` : ''}</p>}
        {awake && <p className="mt-2 flex items-center gap-1.5 text-sm text-text-muted"><Sun size={14} aria-hidden="true" /> {t('Screen stays on during the run')}</p>}
        {info && <p role="status" className="mt-3 rounded-2xl border border-teal/40 bg-teal/10 px-4 py-3 text-base">{info}</p>}
        {err && <p role="alert" className="mt-3 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-base text-danger">{err}</p>}
        {run.notes && <details className="mt-3 rounded-2xl border border-border bg-surface px-4 py-3"><summary className="min-h-8 cursor-pointer text-base font-semibold">{t('Notes from dispatch')}</summary><p className="mt-2 whitespace-pre-line text-base">{run.notes}</p></details>}

        {run.status === 'planned' && <div className="mt-5"><Big tone="gold" onClick={() => act(() => opsApi.updateRun(run.id, { status: 'in_progress' }))} disabled={busy || offline} testid="start-run"><Play size={22} aria-hidden="true" /> {t('Start run')}</Big></div>}

        {/* ---- next stop ---- */}
        {next && (
          <section className="mt-5 rounded-3xl border-2 border-gold bg-surface p-5 shadow-sm" aria-labelledby="next-h" data-testid="next-stop">
            <p className="text-sm font-bold uppercase tracking-wider text-gold-deep">{t('Next stop')} · {ordered.indexOf(next) + 1}/{ordered.length}{next.tries ? ` · ${t('try {n}', { n: next.tries + 1 })}` : ''}</p>
            <h2 id="next-h" className="mt-1 !text-2xl leading-tight">{next.contact || next.label}</h2>
            {next.contact && next.contact !== next.label && <p className="text-base text-text-muted">{next.label}</p>}
            <p className="mt-2 text-lg leading-snug">{next.address || <span className="italic text-text-muted">{t('No address — call them')}</span>}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-base text-text-muted">{next.shipmentRef && <span className="font-mono">{next.shipmentRef}</span>}{next.etaFrom && <span><Clock size={14} className="inline" aria-hidden="true" /> {next.etaFrom}{next.etaTo ? `–${next.etaTo}` : ''}</span>}{next.onWayAt && <span className="text-teal">{t('Told them you’re coming')}</span>}</p>
            {next.note && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-base">“{next.note}”</p>}
            {next.collectUsd ? <p className={`mt-3 rounded-xl px-3 py-2 text-base font-bold ${next.collectRule === 'block' ? 'bg-danger/15 text-danger' : 'bg-gold/15 text-gold-deep'}`} data-testid="next-collect">{t('Collect {amount}', { amount: money(next.collectUsd) })}{next.collectRule === 'block' ? ` · ${t('before handing over')}` : ''}</p> : null}
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(next.lat != null || next.address) && <a href={stopLink(next)} target="_blank" rel="noreferrer" className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-base font-semibold text-on-accent focus-ring" data-testid="nav-next"><Navigation size={20} aria-hidden="true" /> {t('Navigate')}</a>}
              {next.phone && <a href={telLink(next.phone)} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring"><Phone size={20} aria-hidden="true" /> {t('Call')}</a>}
              {next.phone && <a href={waLink(next.phone)} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring"><MessageCircle size={20} aria-hidden="true" /> WhatsApp</a>}
              {run.status === 'in_progress' && <button onClick={() => setSheet({ kind: 'onway', stop: next })} disabled={offline} className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring disabled:opacity-50" data-testid="onway"><Send size={20} aria-hidden="true" /> {t('On my way')}</button>}
            </div>
            {run.status === 'in_progress' && <div className="mt-3 grid gap-2">
              <Big tone="gold" onClick={() => setSheet({ kind: 'proof', stop: next })} testid="stop-done"><CheckCircle2 size={22} aria-hidden="true" /> {run.kind === 'pickup' ? t('Mark collected') : t('Mark delivered')}</Big>
              <Big onClick={() => setSheet({ kind: 'skip', stop: next })} testid="stop-skip"><SkipForward size={20} aria-hidden="true" /> {t('Can’t do it')}</Big>
            </div>}
          </section>
        )}

        {/* ---- after the next one ---- */}
        {pending.length > 1 && (
          <section className="mt-6" aria-labelledby="later-h">
            <div className="flex items-center justify-between"><h2 id="later-h" className="!text-lg">{t('Then')} <span className="font-normal text-text-muted">· {pending.length - 1}</span></h2>{all && <a href={all} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-base font-semibold text-gold-deep focus-ring" data-testid="route-all"><Route size={18} aria-hidden="true" /> {t('Whole route in Maps')}</a>}</div>
            <ol className="mt-2 space-y-2">
              {pending.filter((s) => s.id !== next?.id).map((s) => (
                <li key={s.id}><button onClick={() => { setPick(s.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left focus-ring" data-testid="later-stop">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-base font-bold">{ordered.indexOf(s) + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-base font-semibold">{s.contact || s.label}</span><span className="block truncate text-sm text-text-muted">{s.address || s.label}{s.tries ? ` · ${t('try again')}` : ''}</span></span>
                  {s.collectUsd ? <span className="rounded-full bg-gold/15 px-2 py-0.5 text-sm font-semibold text-gold-deep">{money(s.collectUsd)}</span> : null}
                  <span className="text-sm text-text-muted">{t('Do next')}</span>
                </button></li>
              ))}
            </ol>
          </section>
        )}

        {/* ---- done ---- */}
        {finished.length > 0 && (
          <section className="mt-6">
            <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="flex min-h-12 w-full items-center justify-between rounded-2xl px-1 text-left text-lg font-semibold focus-ring" data-testid="done-toggle"><span>{t('Finished')} <span className="font-normal text-text-muted">· {finished.length}</span></span><ChevronDown size={20} className={`transition-transform ${showDone ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
            {showDone && <ul className="mt-1 divide-y divide-border rounded-2xl border border-border bg-surface">{finished.map((s) => <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-base">{s.status === 'done' ? <Check size={18} className="shrink-0 text-teal" aria-label={t('Done')} /> : <SkipForward size={18} className="shrink-0 text-text-muted" aria-label={t('Skipped')} />}<span className="min-w-0 flex-1"><span className="block truncate">{s.contact || s.label}</span><span className="block truncate text-sm text-text-muted">{s.status === 'done' ? [s.pod?.receivedBy && t('to {name}', { name: s.pod.receivedBy }), s.pod?.pieces != null && t('{n} pieces', { n: s.pod.pieces }), s.pod?.hasPhoto && t('photo'), s.collected && `${money(s.collected.amountUsd)} ${s.collected.method === 'cash' ? t('cash') : 'MoMo'}`].filter(Boolean).join(' · ') : s.note}</span></span>{s.doneAt && <span className="shrink-0 text-sm text-text-muted">{fmtDateTime(s.doneAt).split(', ').pop()}</span>}</li>)}</ul>}
          </section>
        )}

        {/* ---- end of the day ---- */}
        {run.stops.length > 0 && pending.length === 0 && (
          <section className="mt-6 rounded-3xl border-2 border-teal/50 bg-surface p-5" aria-labelledby="sum-h" data-testid="day-summary">
            <h2 id="sum-h" className="!text-xl">{t('Run finished — nice work')}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-base">
              <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Done')}</dt><dd className="text-2xl font-bold tabular-nums">{sum.done}</dd></div>
              <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Skipped')}</dt><dd className="text-2xl font-bold tabular-nums">{sum.skipped}</dd></div>
              <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Pieces')}</dt><dd className="text-2xl font-bold tabular-nums">{sum.pieces || '—'}</dd></div>
              <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Money taken')}</dt><dd className="text-lg font-bold tabular-nums">{sum.cash || sum.momo ? <>{sum.cash ? `${money(sum.cash)} ${t('cash')}` : ''}{sum.cash && sum.momo ? <br /> : null}{sum.momo ? `${money(sum.momo)} MoMo` : ''}</> : '—'}</dd></div>
            </dl>
            {sum.cash > 0 && <p className="mt-3 text-base font-semibold">{t('Hand {amount} in cash to the office.', { amount: money(sum.cash) })}</p>}
            {run.summarySentAt ? <p className="mt-4 rounded-2xl bg-teal/10 p-3 text-base text-teal" data-testid="summary-sent">{t('Sent to dispatch')} · {fmtDateTime(run.summarySentAt)}</p> : <>
              <label htmlFor="sum-note" className="label-dark mt-4">{t('Anything to add?')} <span className="font-normal text-text-muted">({t('optional')})</span></label>
              <input id="sum-note" className="input-dark !min-h-12" value={sumNote} onChange={(e) => setSumNote(e.target.value)} placeholder={t('e.g. van needs fuel')} />
              <div className="mt-3"><Big tone="gold" disabled={busy || offline} onClick={async () => { setBusy(true); setErr(''); try { await opsApi.summary(run.id, sumNote); if (run.status === 'in_progress') await opsApi.updateRun(run.id, { status: 'done' }); await reload(); setInfo(t('Summary sent to dispatch.')) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not send.')) } finally { setBusy(false) } }} testid="send-summary"><Send size={20} aria-hidden="true" /> {t('Send to dispatch & finish')}</Big></div>
            </>}
          </section>
        )}

        {/* ---- tools ---- */}
        <section className="mt-8 grid gap-2">
          {run.status === 'in_progress' && (late
            ? <div className="rounded-2xl border border-border bg-surface p-4" data-testid="late-form"><p className="text-base font-semibold">{t('About how late?')}</p><div className="mt-2 grid grid-cols-4 gap-2">{[15, 30, 60, 120].map((m) => <button key={m} disabled={busy} onClick={async () => { setBusy(true); try { const r = await opsApi.late(run.id, m); setLate(false); setInfo(r.told ? t('Told {n} customers.', { n: r.told }) : t('Noted on the run.')) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not send.')) } finally { setBusy(false) } }} className="min-h-12 rounded-xl border-2 border-border text-base font-semibold focus-ring">{m >= 60 ? `${m / 60} h` : `${m}′`}</button>)}</div><button onClick={() => setLate(false)} className="mt-2 min-h-11 text-base text-text-muted">{t('Cancel')}</button></div>
            : <Big onClick={() => setLate(true)} disabled={offline} testid="running-late"><Clock size={20} aria-hidden="true" /> {t('Running late')}</Big>)}
          {dispatchPhone && <a href={telLink(dispatchPhone)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring"><Phone size={20} aria-hidden="true" /> {t('Call dispatch')}{dispatchWho ? ` · ${dispatchWho}` : ''}</a>}
          <Big onClick={() => setShowMap((v) => !v)} testid="map-toggle"><MapIcon size={20} aria-hidden="true" /> {showMap ? t('Hide map') : t('Show map')}</Big>
          {showMap && <RunMap start={run.start} stops={ordered.map((s) => ({ id: s.id, seq: s.seq, label: s.label, lat: s.lat, lon: s.lon, status: s.status }))} draggable={false} onMove={() => {}} onClickMap={() => {}} focusId={next?.id ?? null} className="h-[380px]" />}
          <button onClick={() => void setDisplay({ road: !disp.road })} aria-pressed={!!disp.road} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold focus-ring ${disp.road ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`} data-testid="road-mode"><Sun size={20} aria-hidden="true" /> {disp.road ? t('Road mode is on') : t('Road mode: bigger text, dark at night')}</button>
          {run.status === 'in_progress' && pending.length > 0 && <button onClick={() => { if (confirm(t('Finish the run with {n} stops not done?', { n: pending.length }))) void act(() => opsApi.updateRun(run.id, { status: 'done' })) }} className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 text-base text-text-muted"><Flag size={18} aria-hidden="true" /> {t('Finish run early')}</button>}
        </section>
        {queued > 0 && <p className="mt-3 text-center text-sm text-text-muted"><Package size={14} className="inline" aria-hidden="true" /> {t('{n} updates waiting', { n: queued })}</p>}
      </div>

      {sheet?.kind === 'proof' && <ProofSheet run={run} stop={sheet.stop} onClose={() => setSheet(null)} onSubmit={(p) => closeStop(sheet.stop, p)} />}
      {sheet?.kind === 'skip' && <SkipSheet stop={sheet.stop} onClose={() => setSheet(null)} onSubmit={(p) => closeStop(sheet.stop, p)} />}
      {sheet?.kind === 'onway' && <OnWaySheet stop={sheet.stop} onClose={() => setSheet(null)} onSend={async (m) => { const r = await opsApi.onWay(run.id, sheet.stop.id, m); void reload(); return r.texted || r.told ? t('Sent: “{text}”', { text: r.text }) : t('Noted on their tracking page. Texts go out once the text-message service is connected.') }} />}
    </div>
  )
}
