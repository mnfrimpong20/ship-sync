import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CircleStop, Fuel, Keyboard, Mic, Send, ShieldCheck } from 'lucide-react'
import type { Run } from '../../lib/ops'
import { driverApi, type RunMessage, type RunPieces } from '../../lib/driverApi'
import { scanFeedback } from '../../lib/feedback'
import { useT } from '../../lib/i18n'
import { fmtDateTime } from '../ui'
import { Viewfinder } from '../../pages/Scan'
import { Big, Choice, Msg, PhotoField, Sheet, errText } from './DriverUi'

/* ============ vehicle check before the run ============ */
const CHECK_ITEMS = [['tyres', 'Tyres'], ['lights', 'Lights & indicators'], ['brakes', 'Brakes'], ['fuel', 'Fuel'], ['mirrors', 'Mirrors & windscreen'], ['load', 'Straps, dolly & blankets']] as const
export function VehicleCheckSheet({ run, onClose, onDone }: { run: Run; onClose: () => void; onDone: (issues: string[], safe: boolean) => void }) {
  const t = useT()
  const [items, setItems] = useState<Record<string, 'ok' | 'issue'>>({})
  const [odo, setOdo] = useState(''); const [photo, setPhoto] = useState(''); const [notes, setNotes] = useState(''); const [safe, setSafe] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const issues = Object.entries(items).filter(([, v]) => v === 'issue').map(([k]) => k)
  const submit = async () => {
    if (CHECK_ITEMS.some(([k]) => !items[k])) { setErr(t('Tick every item — OK or a problem.')); return }
    if (safe === null) { setErr(t('Say whether it’s safe to drive.')); return }
    setBusy(true); setErr('')
    try { const r = await driverApi.vehicleCheck(run.id, { items, notes: notes.trim(), odometer: odo ? Number(odo) : undefined, photo: photo || undefined, safe }); onDone(r.issues, safe) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy(false) }
  }
  return (
    <Sheet title={t('Vehicle check')} onClose={onClose} testid="vcheck-sheet" footer={<Big tone="gold" onClick={submit} disabled={busy} testid="vcheck-save"><ShieldCheck size={22} aria-hidden="true" /> {busy ? t('Saving…') : t('Save check')}</Big>}>
      <p className="text-base text-text-muted">{run.vehicleName ? `${run.vehicleName} · ` : ''}{t('Two minutes before you set off. Problems go straight to the office.')}</p>
      <ul className="mt-4 space-y-2">
        {CHECK_ITEMS.map(([k, l]) => (
          <li key={k} className="rounded-2xl border border-border bg-surface p-3" data-testid={`vc-${k}`}>
            <p className="text-base font-semibold" id={`vc-${k}-l`}>{t(l)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={`vc-${k}-l`}>
              <button type="button" role="radio" aria-checked={items[k] === 'ok'} onClick={() => setItems((x) => ({ ...x, [k]: 'ok' }))} className={`min-h-12 rounded-xl border-2 text-base font-semibold focus-ring ${items[k] === 'ok' ? 'border-teal bg-teal/15' : 'border-border'}`}>{t('OK')}</button>
              <button type="button" role="radio" aria-checked={items[k] === 'issue'} onClick={() => setItems((x) => ({ ...x, [k]: 'issue' }))} className={`min-h-12 rounded-xl border-2 text-base font-semibold focus-ring ${items[k] === 'issue' ? 'border-danger bg-danger/10 text-danger' : 'border-border'}`}>{t('Problem')}</button>
            </div>
          </li>
        ))}
      </ul>
      <label htmlFor="vc-odo" className="label-dark mt-4">{t('Odometer')} <span className="font-normal text-text-muted">({t('optional')})</span></label>
      <input id="vc-odo" inputMode="numeric" className="input-dark !min-h-12 text-lg tabular-nums" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, '').slice(0, 7))} />
      <div className="mt-3"><PhotoField value={photo} onChange={setPhoto} label={t('Photo of the dashboard')} /></div>
      {issues.length > 0 && <><label htmlFor="vc-notes" className="label-dark mt-4">{t('What’s wrong?')}</label><input id="vc-notes" className="input-dark !min-h-12" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('e.g. front left tyre low')} /></>}
      <p className="label-dark mt-4" id="vc-safe">{t('Safe to drive?')}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="vc-safe">
        <Choice on={safe === true} onClick={() => setSafe(true)} testid="vc-safe-yes">{t('Yes')}</Choice>
        <Choice on={safe === false} onClick={() => setSafe(false)} testid="vc-safe-no">{t('No')}</Choice>
      </div>
      {safe === false && <p className="mt-3 text-base font-semibold text-danger">{t('Don’t drive it. The office is told and the vehicle is marked for maintenance.')}</p>}
      <Msg err={err} />
    </Sheet>
  )
}

/* ============ load the truck / drop at the warehouse, by scanning ============ */
export function PieceScanSheet({ run, kind, onClose }: { run: Run; kind: 'load' | 'drop'; onClose: () => void }) {
  const t = useT()
  const [data, setData] = useState<RunPieces | null>(null); const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null)
  const [typed, setTyped] = useState(''); const [manual, setManual] = useState(false); const [paused, setPaused] = useState(false)
  useEffect(() => { driverApi.runPieces(run.id).then(setData).catch((e) => setLast({ ok: false, text: errText(e, t('Could not load.')) })) }, [run.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const flag = kind === 'load' ? 'loaded' : 'dropped'
  const scan = async (code: string) => {
    setPaused(true)
    try { const r = await driverApi.scanPiece(run.id, code, kind); setData(r); scanFeedback(r.already ? 'warn' : 'ok', true); setLast({ ok: true, text: r.already ? t('{code} already scanned.', { code: r.piece.labelCode }) : t('{code} — {stop}', { code: r.piece.labelCode, stop: r.stop }) }) }
    catch (e) { scanFeedback('bad', true); setLast({ ok: false, text: errText(e, t('Not recognised.')) }) }
    finally { setTimeout(() => setPaused(false), 1200) }
  }
  const all = data?.stops.flatMap((s) => s.pieces) ?? []; const got = all.filter((p) => p[flag]).length
  const relevant = (data?.stops ?? []).filter((s) => kind === 'load' ? s.status === 'pending' : s.status === 'done')
  return (
    <Sheet title={kind === 'load' ? t('Load the truck') : t('Drop at the warehouse')} onClose={onClose} testid="piece-scan-sheet">
      <p className="text-base text-text-muted">{kind === 'load' ? t('Scan every piece as it goes on. Anything missing is shown under its stop.') : t('Scan every piece as it comes off. Missing pieces are flagged.')}</p>
      <div className="mt-3">{manual ? null : <Viewfinder onCode={scan} paused={paused} />}</div>
      <button type="button" onClick={() => setManual((v) => !v)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-base text-text-muted focus-ring"><Keyboard size={18} aria-hidden="true" /> {manual ? t('Use the camera') : t('Type a code')}</button>
      {manual && <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void scan(typed.trim()); setTyped('') } }} className="mt-2 flex gap-2"><label htmlFor="ps-code" className="sr-only">{t('Label code')}</label><input id="ps-code" className="input-dark !min-h-12 flex-1 font-mono uppercase" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="SS-9KD4LM-P2" data-testid="ps-code" /><button className="btn-gold !min-h-12">{t('Scan')}</button></form>}
      {last && <p role={last.ok ? 'status' : 'alert'} className={`mt-3 rounded-2xl px-4 py-3 text-base font-semibold ${last.ok ? 'bg-teal/15 text-teal' : 'bg-danger/10 text-danger'}`} data-testid="ps-last">{last.text}</p>}
      <p className="mt-4 text-lg font-bold tabular-nums" data-testid="ps-count">{t('{n} of {total} pieces', { n: got, total: all.length })}</p>
      <ul className="mt-2 space-y-2">
        {relevant.map((s) => { const miss = s.pieces.filter((p) => !p[flag]); return (
          <li key={s.stopId} className={`rounded-2xl border p-3 ${miss.length ? 'border-gold/60 bg-surface' : 'border-teal/50 bg-teal/5'}`}>
            <p className="flex items-center justify-between gap-2 text-base font-semibold"><span className="min-w-0 truncate">{s.seq + 1}. {s.label}</span><span className="shrink-0 tabular-nums">{s.pieces.length - miss.length}/{s.pieces.length}{!miss.length && s.pieces.length > 0 && <Check size={16} className="ml-1 inline text-teal" aria-label={t('All scanned')} />}</span></p>
            <p className="text-sm text-text-muted">{s.ref}</p>
            {miss.length > 0 && <p className="mt-1 text-sm text-gold-deep">{t('Missing')}: {miss.map((p) => `P${p.seq}`).join(', ')}</p>}
            {!s.pieces.length && <p className="mt-1 text-sm text-text-muted">{t('No labels printed yet')}</p>}
          </li>) })}
      </ul>
      {kind === 'load' && all.length > 0 && got < all.length && <p className="mt-3 flex items-center gap-2 text-base font-semibold text-gold-deep"><AlertTriangle size={18} aria-hidden="true" /> {t('{n} pieces not on the truck yet.', { n: all.length - got })}</p>}
    </Sheet>
  )
}

/* ============ incident / damage report ============ */
const INC_KINDS = [['damage', 'Damaged goods'], ['accident', 'Accident'], ['theft', 'Theft or loss'], ['injury', 'Someone hurt'], ['other', 'Something else']] as const
export function IncidentSheet({ run, stopId, onClose, onDone }: { run: Run; stopId?: string; onClose: () => void; onDone: (claim: boolean) => void }) {
  const t = useT()
  const [kind, setKind] = useState(''); const [desc, setDesc] = useState(''); const [photos, setPhotos] = useState<string[]>(['', '', ''])
  const [where, setWhere] = useState(stopId ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async () => {
    if (!kind) { setErr(t('Pick what happened.')); return }
    if (desc.trim().length < 5) { setErr(t('Say what happened.')); return }
    setBusy(true); setErr('')
    try { const r = await driverApi.incident(run.id, { stopId: where || undefined, kind, description: desc.trim(), photos: photos.filter(Boolean) }); onDone(r.claim) } catch (e) { setErr(errText(e, t('Could not send.'))); setBusy(false) }
  }
  return (
    <Sheet title={t('Report a problem')} onClose={onClose} testid="incident-sheet" footer={<Big tone="gold" onClick={submit} disabled={busy} testid="inc-send"><Send size={20} aria-hidden="true" /> {busy ? t('Sending…') : t('Send to the office')}</Big>}>
      <div className="grid gap-2" role="radiogroup" aria-label={t('What happened?')}>{INC_KINDS.map(([k, l]) => <Choice key={k} on={kind === k} onClick={() => setKind(k)} testid={`inc-${k}`}>{t(l)}</Choice>)}</div>
      {kind === 'injury' && <p className="mt-3 rounded-2xl bg-danger/10 p-3 text-base font-semibold text-danger">{t('If anyone is badly hurt, call emergency services first.')}</p>}
      <label htmlFor="inc-where" className="label-dark mt-4">{t('Which stop?')}</label>
      <select id="inc-where" className="input-dark !min-h-12" value={where} onChange={(e) => setWhere(e.target.value)}><option value="">{t('Not at a stop / on the road')}</option>{run.stops.map((s) => <option key={s.id} value={s.id}>{s.seq + 1}. {s.contact || s.label}{s.shipmentRef ? ` · ${s.shipmentRef}` : ''}</option>)}</select>
      <label htmlFor="inc-desc" className="label-dark mt-4">{t('What happened?')}</label>
      <textarea id="inc-desc" rows={4} className="input-dark text-base" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('e.g. barrel dented when unloading, lid still sealed')} data-testid="inc-desc" />
      <p className="label-dark mt-4">{t('Photos')} <span className="font-normal text-text-muted">({t('up to 3')})</span></p>
      <div className="grid grid-cols-3 gap-2">{photos.map((p, i) => <PhotoField key={i} compact value={p} onChange={(v) => setPhotos((x) => x.map((y, j) => (j === i ? v : y)))} label={t('Photo {n}', { n: i + 1 })} />)}</div>
      <p className="mt-3 text-sm text-text-muted">{t('If the shipment is insured, a claim is opened automatically.')}</p>
      <Msg err={err} />
    </Sheet>
  )
}

/* ============ messages with dispatch (text or voice note) ============ */
export function MessagesSheet({ run, stopId, onClose }: { run: Run; stopId?: string; onClose: () => void }) {
  const t = useT()
  const [list, setList] = useState<RunMessage[] | null>(null); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [rec, setRec] = useState<null | { r: MediaRecorder; started: number }>(null); const chunks = useRef<Blob[]>([]); const [secs, setSecs] = useState(0)
  const end = useRef<HTMLLIElement>(null)
  const load = () => driverApi.messages(run.id).then((r) => setList(r.messages)).catch((e) => setErr(errText(e, t('Could not load.'))))
  useEffect(() => { void load(); const x = setInterval(load, 15000); return () => clearInterval(x) }, [run.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list?.length])
  useEffect(() => { if (!rec) return; const x = setInterval(() => setSecs(Math.round((Date.now() - rec.started) / 1000)), 500); return () => clearInterval(x) }, [rec])
  const send = async (p: { body?: string; audio?: string }) => { setBusy(true); setErr(''); try { await driverApi.send(run.id, { stopId, ...p }); setBody(''); await load() } catch (e) { setErr(errText(e, t('Could not send.'))) } finally { setBusy(false) } }
  const record = async () => {
    if (rec) { rec.r.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream); chunks.current = []
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      r.onstop = () => { stream.getTracks().forEach((x) => x.stop()); setRec(null); const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }); if (blob.size > 1_000_000) { setErr(t('That voice note is too long — keep it under a minute.')); return } const fr = new FileReader(); fr.onload = () => void send({ audio: String(fr.result) }); fr.readAsDataURL(blob) }
      r.start(); setSecs(0); setRec({ r, started: Date.now() })
      setTimeout(() => { if (r.state === 'recording') r.stop() }, 60000)
    } catch { setErr(t('The microphone is blocked. Allow it for this site, or type instead.')) }
  }
  const stop = run.stops.find((s) => s.id === stopId)
  return (
    <Sheet title={t('Message dispatch')} onClose={onClose} testid="messages-sheet" footer={
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) void send({ body: body.trim() }) }} className="flex items-center gap-2">
        <label htmlFor="msg-body" className="sr-only">{t('Message')}</label>
        <input id="msg-body" className="input-dark !min-h-14 flex-1 text-base" value={body} onChange={(e) => setBody(e.target.value)} placeholder={rec ? t('Recording… {n}s', { n: secs }) : t('Type a message')} disabled={!!rec} data-testid="msg-body" />
        <button type="button" onClick={record} aria-pressed={!!rec} aria-label={rec ? t('Stop and send voice note') : t('Record a voice note')} className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-2 focus-ring ${rec ? 'border-danger bg-danger text-white' : 'border-border bg-surface'}`} data-testid="msg-voice">{rec ? <CircleStop size={22} /> : <Mic size={22} />}</button>
        <button type="submit" disabled={busy || !body.trim()} aria-label={t('Send')} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gold text-on-accent focus-ring disabled:opacity-50" data-testid="msg-send"><Send size={22} /></button>
      </form>}>
      {stop && <p className="text-base text-text-muted">{t('About')}: <b className="text-text">{stop.contact || stop.label}</b></p>}
      {!list ? <p className="mt-4 text-text-muted">{t('Loading…')}</p> : !list.length ? <p className="mt-4 text-base text-text-muted">{t('No messages yet. Dispatch gets a notification as soon as you send one.')}</p> : (
        <ul className="mt-3 space-y-2" aria-live="polite">{list.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base ${m.side === 'driver' ? 'ml-auto bg-gold/15' : 'bg-surface-2'}`} data-testid="msg">
            <p className="text-xs text-text-muted">{m.from} · {fmtDateTime(m.at)}</p>
            {m.body && <p className="whitespace-pre-line">{m.body}</p>}
            {m.audio && <audio controls src={m.audio} className="mt-1 w-full max-w-xs" aria-label={t('Voice note from {name}', { name: m.from })} />}
          </li>))}<li ref={end} aria-hidden="true" /></ul>
      )}
      <Msg err={err} />
    </Sheet>
  )
}

/* ============ fuel & expenses ============ */
const EXP_KINDS = [['fuel', 'Fuel'], ['toll', 'Toll'], ['parking', 'Parking'], ['repair', 'Repair'], ['meal', 'Meal'], ['other', 'Other']] as const
export function ExpenseSheet({ run, onClose, onDone, defaultCurrency = 'USD' }: { run?: Run; onClose: () => void; onDone: (usd: number) => void; defaultCurrency?: string }) {
  const t = useT()
  const [kind, setKind] = useState('fuel'); const [paidBy, setPaidBy] = useState<'driver' | 'company'>('driver'); const [amount, setAmount] = useState(''); const [cur, setCur] = useState(defaultCurrency); const [photo, setPhoto] = useState(''); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const submit = async () => {
    const n = Number(amount); if (!n) { setErr(t('Enter the amount.')); return }
    if (!photo) { setErr(t('Take a photo of the receipt.')); return }
    setBusy(true); setErr('')
    try { const r = await driverApi.expense({ paidBy, runId: run?.id, kind, amount: n, currency: cur, photo, note: note.trim() }); onDone(r.amountUsd) } catch (e) { setErr(errText(e, t('Could not save.'))); setBusy(false) }
  }
  return (
    <Sheet title={t('Fuel & expenses')} onClose={onClose} testid="expense-sheet" footer={<Big tone="gold" onClick={submit} disabled={busy} testid="exp-save"><Fuel size={20} aria-hidden="true" /> {busy ? t('Saving…') : t('Save expense')}</Big>}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('What for?')}>{EXP_KINDS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`min-h-12 rounded-xl border-2 text-base font-semibold focus-ring ${kind === k ? 'border-gold bg-gold/15' : 'border-border'}`}>{t(l)}</button>)}</div>
      <div className="mt-4 grid grid-cols-[1fr_7rem] gap-2">
        <div><label htmlFor="exp-amt" className="label-dark">{t('Amount')}</label><input id="exp-amt" inputMode="decimal" className="input-dark !min-h-14 text-2xl font-bold tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} data-testid="exp-amount" /></div>
        <div><label htmlFor="exp-cur" className="label-dark">{t('Currency')}</label><select id="exp-cur" className="input-dark !min-h-14 text-base" value={cur} onChange={(e) => setCur(e.target.value)}>{['USD', 'GHS', 'NGN', 'XOF', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
      </div>
      <p className="label-dark mt-4" id="exp-paid">{t('Who paid?')}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="exp-paid"><Choice on={paidBy === 'driver'} onClick={() => setPaidBy('driver')} testid="exp-me">{t('I paid — pay me back')}</Choice><Choice on={paidBy === 'company'} onClick={() => setPaidBy('company')} testid="exp-company">{t('Company / fuel card')}</Choice></div>
      <div className="mt-4"><PhotoField value={photo} onChange={setPhoto} label={t('Photo of the receipt')} testid="exp-photo" /></div>
      <label htmlFor="exp-note" className="label-dark mt-4">{t('Note')} <span className="font-normal text-text-muted">({t('optional')})</span></label>
      <input id="exp-note" className="input-dark !min-h-12" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Shell, Spintex Road')} />
      <p className="mt-3 text-sm text-text-muted">{paidBy === 'driver' ? t('Once the office approves it, it’s on your next payslip.') : t('It goes into Costs & profit for the office.')}</p>
      <Msg err={err} />
    </Sheet>
  )
}

/* ============ live location while the run is open ============ */
/** Sends the phone's position at most every ~30 s (or after ~150 m) while a run is in progress and the app is open.
 *  The server texts "arriving soon" when the driver comes within ~2 km of a stop. */
export function useLiveLocation(run: Run | null, onNear: (labels: string[]) => void) {
  const [state, setState] = useState<'off' | 'on' | 'denied'>('off')
  const nearRef = useRef(onNear); nearRef.current = onNear
  const active = run?.status === 'in_progress'
  useEffect(() => {
    if (!active || !run || !navigator.geolocation) { setState('off'); return }
    let last = { at: 0, lat: 0, lon: 0 }
    const id = navigator.geolocation.watchPosition((p) => {
      setState('on')
      const { latitude: lat, longitude: lon, accuracy } = p.coords
      const moved = Math.hypot((lat - last.lat) * 111000, (lon - last.lon) * 111000 * Math.cos((lat * Math.PI) / 180))
      if (Date.now() - last.at < 30000 && moved < 150) return
      last = { at: Date.now(), lat, lon }
      driverApi.position(run.id, lat, lon, accuracy).then((r) => { if (r.near?.length) nearRef.current(r.near) }).catch(() => {})
    }, (e) => setState(e.code === e.PERMISSION_DENIED ? 'denied' : 'off'), { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [active, run?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

/** While a run is open, check for office changes every minute; says when new stops appear. */
export function useRunWatch(run: Run | null, reload: () => Promise<void>, onNew: (n: number) => void) {
  const count = useRef<number | null>(null)
  const live = run && (run.status === 'in_progress' || run.status === 'planned')
  useEffect(() => { if (!run) return; if (count.current != null && run.stops.length > count.current) onNew(run.stops.length - count.current); count.current = run.stops.length }, [run?.stops.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!live) return; const x = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 60000); return () => clearInterval(x) }, [live]) // eslint-disable-line react-hooks/exhaustive-deps
}

