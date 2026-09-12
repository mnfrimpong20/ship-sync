import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import jsQR from 'jsqr'
import { AlertTriangle, Camera, Check, CheckCircle2, Container as ContainerIcon, Keyboard, MapPin, Package, QrCode, RefreshCw, ScanLine, Truck, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { countryByCode, statusLabels } from '../lib/data'
import { containersApi, isOpen, type Container } from '../lib/containers'
import { opsApi, type Run } from '../lib/ops'
import { scanApi, scanKindLabels, scanKindShort, shrinkPhoto, type Lookup, type RecentScan, type ScanKind, type ScanResult } from '../lib/scan'
import { pieceStatusLabels } from '../lib/labels'
import { Pill, fmtDateTime } from '../components/ui'

const KINDS: ScanKind[] = ['loading', 'devanning', 'delivery', 'check']
const kindIcon: Record<ScanKind, typeof ContainerIcon> = { loading: ContainerIcon, devanning: Package, delivery: Truck, check: ScanLine }

/** Camera viewfinder that decodes QR codes. Uses the browser's BarcodeDetector when it exists (Android Chrome), else jsQR on canvas frames. */
function Viewfinder({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null); const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const pausedRef = useRef(paused); pausedRef.current = paused
  const onCodeRef = useRef(onCode); onCodeRef.current = onCode
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let live = true
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
    const detector = Detector ? new Detector({ formats: ['qr_code', 'code_128'] }) : null
    const tick = async () => {
      if (!live) return
      const v = video.current
      if (v && v.readyState >= 2 && !pausedRef.current) {
        let code = ''
        try {
          if (detector) { const r = await detector.detect(v); code = r[0]?.rawValue ?? '' }
          else if (canvas.current) {
            const c = canvas.current; const w = Math.min(640, v.videoWidth); const h = Math.round((w / v.videoWidth) * v.videoHeight)
            c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h)
            code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? ''
          }
        } catch { /* frame not ready */ }
        if (code && (code !== last.current.code || Date.now() - last.current.at > 4000)) { last.current = { code, at: Date.now() }; onCodeRef.current(code) }
      }
      raf = window.setTimeout(tick, detector ? 250 : 180) as unknown as number
    }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then((s) => { if (!live) { s.getTracks().forEach((t) => t.stop()); return } stream = s; if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}) } setReady(true); tick() })
      .catch((e) => setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site, or type the code below.' : 'No camera available here — type the code below.'))
    return () => { live = false; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '4 / 3' }}>
      <video ref={video} className="h-full w-full object-cover" playsInline muted />
      <canvas ref={canvas} className="hidden" />
      {ready && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className={`h-[62%] w-[62%] rounded-2xl border-2 ${paused ? 'border-teal' : 'border-white/70'} shadow-[0_0_0_9999px_rgba(0,0,0,.35)]`} /><div className="absolute bottom-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{paused ? 'Scan recorded — point at the next sticker' : 'Point at the QR code'}</div></div>}
      {!ready && !error && <div className="absolute inset-0 grid place-items-center text-sm text-white/80"><span className="inline-flex items-center gap-2"><Camera size={16} /> Starting camera…</span></div>}
      {error && <div className="absolute inset-0 grid place-items-center bg-surface p-6 text-center text-sm text-text-muted"><span><Camera size={22} className="mx-auto mb-2 text-text-muted" aria-hidden="true" />{error}</span></div>}
    </div>
  )
}

export default function Scan() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const [kind, setKind] = useState<ScanKind>((sp.get('kind') as ScanKind | null) ?? 'loading')
  const [containerId, setContainerId] = useState(sp.get('container') ?? '')
  const runId = sp.get('run') ?? ''
  const [containers, setContainers] = useState<Container[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [code, setCode] = useState('')
  const [typed, setTyped] = useState('')
  const [look, setLook] = useState<Lookup | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [recent, setRecent] = useState<RecentScan[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState(true)
  const [note, setNote] = useState(''); const [receivedBy, setReceivedBy] = useState(''); const [photo, setPhoto] = useState('')
  const [manual, setManual] = useState(false)
  const [paused, setPaused] = useState(false)
  const pos = useRef<{ lat: number; lon: number } | null>(null)
  const isDriver = user?.staffRole === 'driver'

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    if (!isDriver) containersApi.list().then((c) => setContainers(c.filter((x) => isOpen(x.status) && ['booked', 'loading', 'gated_in'].includes(x.status)))).catch(() => {})
    if (runId) (isDriver ? opsApi.myRuns() : opsApi.runs()).then((rs) => setRun(rs.find((r) => r.id === runId) ?? null)).catch(() => {})
    scanApi.recent().then(setRecent).catch(() => {})
    navigator.geolocation?.getCurrentPosition((p) => { pos.current = { lat: p.coords.latitude, lon: p.coords.longitude } }, () => {}, { maximumAge: 60000, timeout: 5000 })
  }, [ready, user, isDriver, runId])
  useEffect(() => { if (isDriver && kind === 'loading' && !sp.get('kind')) setKind('delivery') }, [isDriver]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(async (c: string, k: ScanKind, extra?: { note?: string; receivedBy?: string; photo?: string }) => {
    setBusy(true); setError('')
    try {
      const r = await scanApi.scan({ code: c, kind: k, containerId: k === 'loading' ? containerId || undefined : undefined, runId: runId || undefined, note: extra?.note, receivedBy: extra?.receivedBy, photo: extra?.photo, lat: pos.current?.lat, lon: pos.current?.lon })
      setResult(r); setLook(null); setNote(''); setReceivedBy(''); setPhoto(''); setCode('')
      scanApi.recent().then(setRecent).catch(() => {})
      if (navigator.vibrate) navigator.vibrate(r.warnings.length ? [60, 60, 60] : 40)
      setPaused(true); setTimeout(() => setPaused(false), 1800)
    } catch (e) { setError(e instanceof Error ? e.message : 'Scan failed.'); if (navigator.vibrate) navigator.vibrate([80, 40, 80]) } finally { setBusy(false) }
  }, [containerId, runId])

  const onCode = useCallback(async (c: string) => {
    if (busy) return
    setCode(c); setError(''); setResult(null)
    // Delivery needs the receiver's name (and ideally a photo), so it always stops to confirm. Loading/devanning/check commit at once when auto is on.
    if (auto && kind !== 'delivery' && (kind !== 'loading' || containerId)) { await commit(c, kind); return }
    setBusy(true)
    try { setLook(await scanApi.lookup(c)) } catch (e) { setError(e instanceof Error ? e.message : 'Unknown label.') } finally { setBusy(false) }
  }, [auto, kind, containerId, commit, busy])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?role=shipper&next=${encodeURIComponent('/dashboard/scan')}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const container = containers.find((c) => c.id === containerId)
  const Icon = kindIcon[kind]
  const needsContainer = kind === 'loading' && !containerId
  const counts = result?.counts ?? look?.counts

  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-3xl py-6 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="eyebrow mb-1">Scanner</p><h1 className="!text-[clamp(1.5rem,3vw,2.1rem)]">Scan a sticker</h1><p className="mt-1 text-sm text-text-muted">Point the camera at the QR code on the piece. Each scan is recorded with who, where and when, and the customer sees it on their tracking page.</p></div>
          <div className="flex gap-2">{run && <Link to="/dashboard/runs" className="btn-ghost !min-h-9 !px-3 text-xs"><Truck size={13} aria-hidden="true" /> {run.name}</Link>}{container && <Link to={`/dashboard/containers/${container.id}`} className="btn-ghost !min-h-9 !px-3 text-xs"><ContainerIcon size={13} aria-hidden="true" /> {container.ref}</Link>}</div>
        </div>

        {/* what this scan means */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Scan type">
          {KINDS.filter((k) => !(isDriver && k === 'loading')).map((k) => { const I = kindIcon[k]; return <button key={k} role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setLook(null); setResult(null); setError(''); const n = new URLSearchParams(sp); n.set('kind', k); setSp(n, { replace: true }) }} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm focus-ring ${kind === k ? 'border-gold bg-gold/10 font-semibold' : 'border-border text-text-muted hover:text-text'}`}><I size={16} className={kind === k ? 'text-gold-deep' : ''} aria-hidden="true" /> {scanKindShort[k]}</button> })}
        </div>
        {kind === 'loading' && !isDriver && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="scan-container" className="text-sm text-text-muted">Into container</label>
            <select id="scan-container" className="input-dark !min-h-10 !w-auto flex-1 text-sm" value={containerId} onChange={(e) => { setContainerId(e.target.value); const n = new URLSearchParams(sp); if (e.target.value) n.set('container', e.target.value); else n.delete('container'); setSp(n, { replace: true }) }}>
              <option value="">— choose the open container —</option>{containers.map((c) => <option key={c.id} value={c.id}>{c.ref}{c.number ? ` · ${c.number}` : ''} · {c.line} → {c.destinationPort || countryByCode(c.destination)?.name}</option>)}
            </select>
            {needsContainer && <p className="w-full text-xs text-danger">Pick the container first — every loading scan puts the piece into it.</p>}
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted"><Icon size={12} className="inline text-gold-deep" aria-hidden="true" /> {scanKindLabels[kind]}: {kind === 'loading' ? 'the piece is marked loaded and its order joins the container (first scan moves the order to Picked up).' : kind === 'devanning' ? 'the piece is marked received at your destination warehouse (the order moves to Customs cleared).' : kind === 'delivery' ? 'the piece is marked delivered; when the last piece is scanned the order is Delivered and the stop on the run is ticked off.' : 'nothing changes — the piece is just recorded as seen here.'}</p>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            {!manual ? <Viewfinder onCode={onCode} paused={paused || busy} /> : (
              <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onCode(typed.trim()) }} className="rounded-2xl border border-border bg-surface p-4">
                <label htmlFor="scan-code" className="label-dark">Label code</label>
                <div className="flex gap-2"><input id="scan-code" autoFocus className="input-dark !min-h-11 font-mono uppercase" placeholder="SS-9KD4LM-P2" value={typed} onChange={(e) => setTyped(e.target.value)} /><button disabled={busy || !typed.trim()} className="btn-gold !min-h-11 !px-4 text-sm disabled:opacity-60">Go</button></div>
                <p className="mt-2 text-xs text-text-muted">The code is printed under the barcode. A USB or Bluetooth barcode scanner types it here too — just keep this box focused.</p>
              </form>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <button onClick={() => setManual((m) => !m)} className="inline-flex items-center gap-1 text-text-muted hover:text-text focus-ring rounded">{manual ? <><Camera size={13} aria-hidden="true" /> Use the camera</> : <><Keyboard size={13} aria-hidden="true" /> Type the code instead</>}</button>
              {kind !== 'delivery' && <label className="inline-flex items-center gap-1.5 text-text-muted"><input type="checkbox" className="accent-[var(--color-gold)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Record each scan straight away</label>}
            </div>

            <AnimatePresence mode="wait">
              {error && <motion.p key="err" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}</motion.p>}
              {look && !result && (
                <motion.div key="look" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-2xl border border-gold/50 bg-surface p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-gold-deep">{look.piece.labelCode}</p><p className="font-semibold">Piece {look.piece.seq} of {look.counts.total} · {look.shipment.description || look.shipment.cargo}</p><p className="text-xs text-text-muted">{look.shipment.origin} → {countryByCode(look.shipment.destination)?.name ?? look.shipment.destination} · {look.shipment.customer}{look.consignee ? ` → ${look.consignee.name}` : ''}</p></div><Pill tone={look.piece.status === 'delivered' ? 'green' : look.piece.status === 'labelled' ? 'muted' : 'teal'}>{pieceStatusLabels[look.piece.status]}</Pill></div>
                  {look.suggested !== kind && !(isDriver && look.suggested === 'loading') && <p className="mt-2 text-xs text-text-muted">Last time this piece was {look.piece.status === 'labelled' ? 'labelled' : look.piece.status}{look.piece.lastScanPlace ? ` at ${look.piece.lastScanPlace}` : ''}. The usual next scan would be <button onClick={() => setKind(look.suggested)} className="font-semibold text-gold-deep hover:underline">{scanKindShort[look.suggested]}</button>.</p>}
                  {kind === 'delivery' && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div><label htmlFor="rcv" className="label-dark">Received by</label><input id="rcv" className="input-dark !min-h-10 text-sm" placeholder={look.consignee?.name ?? 'Name of the person'} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} /></div>
                      <div><label htmlFor="pod" className="label-dark">Proof of delivery photo</label><div className="flex items-center gap-2"><label className="btn-ghost !min-h-10 cursor-pointer !px-3 text-sm"><Camera size={14} aria-hidden="true" /> {photo ? 'Retake' : 'Take photo'}<input id="pod" type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f)) }} /></label>{photo && <img src={photo} alt="Proof of delivery" className="h-10 w-10 rounded-lg object-cover" />}</div></div>
                      <div className="sm:col-span-2"><label htmlFor="scan-note" className="label-dark">Note</label><input id="scan-note" className="input-dark !min-h-10 text-sm" placeholder="Left with security, gate 3…" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                    </div>
                  )}
                  {kind !== 'delivery' && <div className="mt-3"><label htmlFor="scan-note" className="label-dark">Note (optional)</label><input id="scan-note" className="input-dark !min-h-10 text-sm" placeholder="Damaged corner, resealed…" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
                  <div className="mt-3 flex justify-end gap-2"><button onClick={() => { setLook(null); setCode('') }} className="btn-ghost !min-h-10 !px-3 text-sm"><X size={14} aria-hidden="true" /> Cancel</button><button onClick={() => commit(code, kind, { note, receivedBy: receivedBy || look.consignee?.name, photo: photo || undefined })} disabled={busy || needsContainer} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={14} aria-hidden="true" /> {busy ? 'Recording…' : kind === 'delivery' ? 'Record delivery' : kind === 'loading' ? 'Record loading' : kind === 'devanning' ? 'Record devanning' : 'Record check'}</button></div>
                </motion.div>
              )}
              {result && (
                <motion.div key="res" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-3 rounded-2xl border p-4 ${result.warnings.length ? 'border-gold bg-gold/5' : 'border-teal/50 bg-teal/5'}`} role="status">
                  <div className="flex items-start gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${result.warnings.length ? 'bg-gold/20 text-gold-deep' : 'bg-teal/20 text-teal'}`}><CheckCircle2 size={22} aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Piece {result.piece.seq} of {result.counts.total} — {result.shipment.ref} · {scanKindLabels[kind]}</p>
                      <p className="text-sm text-text-muted">{result.shipment.description || result.shipment.cargo} · {result.shipment.customer}{result.consignee ? ` → ${result.consignee.name}` : ''}</p>
                      <p className="mt-1 text-xs text-text-muted"><MapPin size={11} className="inline" aria-hidden="true" /> {result.place} · {fmtDateTime(result.at)}{result.moved ? ` · order now ${statusLabels[result.moved]}` : ''}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full bg-teal" style={{ width: `${(kind === 'delivery' ? result.counts.delivered : kind === 'devanning' ? result.counts.devanned : result.counts.loaded) / Math.max(1, result.counts.total) * 100}%` }} /></span><span className="tabular-nums text-text-muted">{kind === 'delivery' ? result.counts.delivered : kind === 'devanning' ? result.counts.devanned : result.counts.loaded} of {result.counts.total} {kind === 'delivery' ? 'delivered' : kind === 'devanning' ? 'received' : 'loaded'}</span></div>
                      {result.warnings.map((w, i) => <p key={i} className="mt-2 flex items-start gap-1.5 text-xs text-gold-deep"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}</p>)}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className="space-y-3">
            {counts && (
              <div className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">This order</p>
                <p className="mt-1 font-mono text-sm text-gold-deep">{(result ?? look)!.shipment.ref}</p>
                <ul className="mt-2 grid grid-cols-4 gap-1" aria-label="Pieces">{(result ?? look)!.pieces.map((p) => <li key={p.id} title={`Piece ${p.seq}: ${pieceStatusLabels[p.status]}`} className={`grid h-9 place-items-center rounded-lg text-xs font-semibold ${p.status === 'delivered' ? 'bg-teal text-white' : p.status === 'devanned' ? 'bg-sky/30 text-text' : p.status === 'loaded' ? 'bg-gold/30 text-text' : 'bg-surface-2 text-text-muted'}`}>{p.seq}</li>)}</ul>
                <p className="mt-2 text-[11px] text-text-muted">{counts.loaded}/{counts.total} loaded · {counts.devanned}/{counts.total} received · {counts.delivered}/{counts.total} delivered</p>
                {(result ?? look)!.container && <p className="mt-2 text-xs text-text-muted"><ContainerIcon size={11} className="inline" aria-hidden="true" /> {(result ?? look)!.container!.ref}{(result ?? look)!.container!.number ? ` · ${(result ?? look)!.container!.number}` : ''}</p>}
              </div>
            )}
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Recent scans</p><button onClick={() => scanApi.recent().then(setRecent).catch(() => {})} className="text-text-muted hover:text-text focus-ring rounded" aria-label="Refresh"><RefreshCw size={12} /></button></div>
              {recent.length === 0 ? <p className="mt-2 text-xs text-text-muted">Nothing scanned yet today.</p> : (
                <ul className="mt-2 space-y-1.5 text-xs">{recent.slice(0, 12).map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate"><span className="font-mono text-gold-deep">{r.ref}</span> · piece {r.seq}/{r.total} · {scanKindShort[r.kind]}</span><span className="shrink-0 text-text-muted">{fmtDateTime(r.at)}</span></li>)}</ul>
              )}
            </div>
            <p className="px-1 text-[11px] text-text-muted"><QrCode size={11} className="inline" aria-hidden="true" /> On iPhone, use Safari and allow the camera. Any phone camera app also opens the customer tracking page from the same sticker — that never changes anything.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
