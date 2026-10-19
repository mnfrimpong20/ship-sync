import { useEffect, useRef, useState } from 'react'
import { Bluetooth, Check, Plug, Ruler, Scale } from 'lucide-react'
import { api } from '../lib/store'
import { CM_PER_IN, kgToLb, lbToKg, parseScaleLine, type Totals } from '../lib/weights'

interface MPiece { id: string; seq: number; labelCode: string; weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; measuredAt: string | null; measuredBy: string }
interface MView { mode: 'air' | 'ocean'; pieces: MPiece[]; totals: Totals; declared: { weightKg: number | null; dims: string; quantity: number | null; chargeableKg: number | null; cbm: number | null }; diffPct: number | null; canEdit: boolean }

/* Minimal Web Serial typing (Chrome/Edge on desktop and Android). */
interface SerialPortLike { open: (o: { baudRate: number }) => Promise<void>; close: () => Promise<void>; readable: ReadableStream<Uint8Array> | null }
const serial = () => (navigator as unknown as { serial?: { requestPort: () => Promise<SerialPortLike> } }).serial

/** Keeps one scale connection for the page; resolves with the next stable reading. */
let port: SerialPortLike | null = null
async function readScale(timeoutMs = 6000): Promise<number> {
  const s = serial(); if (!s) throw new Error('This browser can’t talk to a USB scale — use Chrome or Edge, or a scale that types into the box.')
  if (!port) { port = await s.requestPort(); await port.open({ baudRate: Number(localStorage.getItem('ss-scale-baud') ?? 9600) || 9600 }) }
  const reader = port.readable!.getReader(); const dec = new TextDecoder(); let buf = ''; const until = Date.now() + timeoutMs
  try {
    while (Date.now() < until) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value?: undefined; done: true }>((r) => setTimeout(() => r({ done: true }), until - Date.now()))])
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split(/\r?\n|\r/); buf = lines.pop() ?? ''
      for (const l of lines.reverse()) { const p = parseScaleLine(l); if (p && p.stable && p.kg > 0) return p.kg }
    }
    throw new Error('No steady reading from the scale — put the piece on and try again.')
  } finally { reader.releaseLock() }
}

/* Bluetooth scales (standard Weight Scale service). Web Bluetooth: Chrome on Android, desktop Chrome/Edge — not iPhone. */
type BleChar = { startNotifications: () => Promise<unknown>; addEventListener: (t: string, f: (e: Event) => void) => void; removeEventListener: (t: string, f: (e: Event) => void) => void }
const ble = () => (navigator as unknown as { bluetooth?: { requestDevice: (o: unknown) => Promise<{ gatt?: { connected: boolean; connect: () => Promise<{ getPrimaryService: (s: string) => Promise<{ getCharacteristic: (c: string) => Promise<BleChar> }> }> } }> } }).bluetooth
let bleChar: BleChar | null = null
export const hasBluetooth = () => !!ble()
export async function readBleScale(timeoutMs = 15000): Promise<number> {
  const b = ble(); if (!b) throw new Error('Bluetooth scales work in Chrome on Android. On iPhone, type the weight in.')
  if (!bleChar) {
    const dev = await b.requestDevice({ filters: [{ services: ['weight_scale'] }] })
    const srv = await (await dev.gatt!.connect()).getPrimaryService('weight_scale')
    bleChar = await srv.getCharacteristic('weight_measurement'); await bleChar.startNotifications()
  }
  const ch = bleChar
  return new Promise<number>((resolve, reject) => {
    const done = (fn: () => void) => { clearTimeout(timer); ch.removeEventListener('characteristicvaluechanged', on); fn() }
    const on = (e: Event) => {
      const dv = (e.target as unknown as { value: DataView }).value; const flags = dv.getUint8(0); const raw = dv.getUint16(1, true)
      const kg = flags & 1 ? raw * 0.01 * 0.45359237 : raw * 0.005
      if (kg > 0) done(() => resolve(Math.round(kg * 100) / 100))
    }
    const timer = setTimeout(() => done(() => reject(new Error('No reading from the scale — step it on and try again.'))), timeoutMs)
    ch.addEventListener('characteristicvaluechanged', on)
  })
}

const n = (v: string) => (v.trim() === '' ? null : Number(v))
const show = (v: number | null, k = 1) => (v == null ? '' : String(Math.round(v * k * 10) / 10))

/** Per-piece weight and size → actual, volume and chargeable weight, against what was declared. */
export function MeasureCard({ shipmentId, big = false, onSaved }: { shipmentId: string; big?: boolean; onSaved?: () => void }) {
  const [d, setD] = useState<MView | null>(null)
  const [imperial, setImperial] = useState(() => { try { return localStorage.getItem('ss-units') === 'imperial' } catch { return false } })
  const [rows, setRows] = useState<Record<string, { w: string; l: string; wd: string; h: string }>>({})
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [saved, setSaved] = useState('')
  const dk = imperial ? 1 / CM_PER_IN : 1
  const fill = (v: MView) => setRows(Object.fromEntries(v.pieces.map((p) => [p.id, { w: show(p.weightKg, imperial ? kgToLb(1) : 1), l: show(p.lengthCm, dk), wd: show(p.widthCm, dk), h: show(p.heightCm, dk) }])))
  const load = () => api<MView>(`/shipments/${shipmentId}/measure`).then((v) => { setD(v); fill(v) }).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [shipmentId]) // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } if (d) fill(d); try { localStorage.setItem('ss-units', imperial ? 'imperial' : 'metric') } catch { /* private mode */ } }, [imperial]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return err ? <div className="rounded-xl border border-border bg-surface p-4 text-xs text-danger">{err}</div> : null
  const save = async (p: MPiece, source: 'manual' | 'scale' = 'manual', override?: { w?: string }) => {
    const r = { ...rows[p.id], ...(override ?? {}) }
    const toKg = (v: number | null) => (v == null ? null : imperial ? lbToKg(v) : v); const toCm = (v: number | null) => (v == null ? null : imperial ? Math.round(v * CM_PER_IN * 10) / 10 : v)
    setBusy(p.id); setErr('')
    try { const v = await api<MView>(`/shipments/${shipmentId}/pieces/${p.id}/measure`, { method: 'PUT', json: { weightKg: toKg(n(r.w)), lengthCm: toCm(n(r.l)), widthCm: toCm(n(r.wd)), heightCm: toCm(n(r.h)), source } }); setD(v); setSaved(p.id); setTimeout(() => setSaved(''), 1500); onSaved?.() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy('') }
  }
  const fromScale = async (p: MPiece, how: 'usb' | 'ble' = 'usb') => {
    setBusy((how === 'ble' ? 'ble' : 'scale') + p.id); setErr('')
    try { const kg = how === 'ble' ? await readBleScale() : await readScale(); const w = show(kg, imperial ? kgToLb(1) : 1); setRows((x) => ({ ...x, [p.id]: { ...x[p.id], w } })); await save(p, 'scale', { w }) } catch (e) { if ((e as Error)?.name !== 'NotFoundError') setErr(e instanceof Error ? e.message : 'Scale error.') } finally { setBusy('') }
  }
  const t = d.totals; const W = imperial ? 'lb' : 'kg'; const L = imperial ? 'in' : 'cm'
  const wt = (kg: number) => (imperial ? `${kgToLb(kg).toLocaleString()} lb` : `${kg.toLocaleString()} kg`)
  const set = (id: string, k: 'w' | 'l' | 'wd' | 'h', v: string) => setRows((x) => ({ ...x, [id]: { ...x[id], [k]: v.replace(/[^\d.]/g, '') } }))
  const hasSerial = !!serial(); const hasBle = hasBluetooth()
  const inp = big ? '!min-h-12 text-base' : '!min-h-8 text-xs'; const btn = big ? 'h-12 text-sm' : 'h-8 text-xs'
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="measure-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Scale size={14} className="text-gold-deep" aria-hidden="true" /> Weigh &amp; measure</p>
        <div className="inline-flex rounded-full border border-border p-0.5 text-xs" role="radiogroup" aria-label="Units">{[[false, 'kg / cm'], [true, 'lb / in']].map(([v, l]) => <button key={String(v)} role="radio" aria-checked={imperial === v} onClick={() => setImperial(v as boolean)} className={`rounded-full px-2.5 py-1 ${imperial === v ? 'bg-gold text-[#14213D]' : 'text-text-muted'}`}>{l as string}</button>)}</div>
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-center" data-testid="measure-totals">
        <div className="rounded-lg bg-surface-2/60 p-2"><p className="text-[11px] uppercase tracking-wider text-text-muted">Actual</p><p className="font-semibold tabular-nums">{wt(t.actualKg)}</p></div>
        <div className="rounded-lg bg-surface-2/60 p-2"><p className="text-[11px] uppercase tracking-wider text-text-muted">Volume</p><p className="font-semibold tabular-nums">{t.cbm.toLocaleString()} m³</p></div>
        <div className="rounded-lg bg-surface-2/60 p-2"><p className="text-[11px] uppercase tracking-wider text-text-muted">{d.mode === 'air' ? 'Volumetric' : 'W/M tons'}</p><p className="font-semibold tabular-nums">{d.mode === 'air' ? wt(t.volumetricKg) : t.freightTons.toLocaleString()}</p></div>
        <div className="rounded-lg bg-gold/15 p-2"><p className="text-[11px] uppercase tracking-wider text-text-muted">Chargeable</p><p className="font-semibold tabular-nums">{wt(t.chargeableKg)}</p></div>
      </div>
      <p className="mt-2 text-xs text-text-muted">{t.measured}/{t.pieces} pieces measured · {d.mode === 'air' ? `air volumetric = L×W×H ÷ 6000 (cm); charged on the ${t.basis === 'volume' ? 'volume' : 'actual weight'}` : 'ocean: 1 m³ counts as 1,000 kg (weight or measure)'}{d.declared.chargeableKg ? ` · declared ${wt(d.declared.chargeableKg)}${d.declared.dims ? ` (${d.declared.dims})` : ''}` : ''}</p>
      {d.diffPct != null && Math.abs(d.diffPct) >= 10 && <p className={`mt-1 text-xs font-semibold ${d.diffPct > 0 ? 'text-danger' : 'text-teal'}`} data-testid="measure-diff">{d.diffPct > 0 ? `${d.diffPct}% over` : `${-d.diffPct}% under`} what the customer declared{d.diffPct > 0 ? ' — update the price before it ships if your quote was by weight.' : '.'}</p>}
      {d.canEdit && (
        <div className="mt-3">
          <p className="grid grid-cols-[34px_1fr] gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted"><span>Piece</span><span>Weight ({W}) · L × W × H ({L})</span></p>
          <ul className="mt-1 divide-y divide-border/60">{d.pieces.map((p) => { const r = rows[p.id] ?? { w: '', l: '', wd: '', h: '' }; return (
            <li key={p.id} className="grid grid-cols-[34px_1fr] items-start gap-2 py-2" data-testid="measure-row">
              <span className="pt-2 font-mono text-xs">P{p.seq}{p.measuredAt && <Check size={11} className="ml-0.5 inline text-teal" aria-label="Measured" />}</span>
              <span className="grid gap-1.5">
                <span className="flex items-center gap-1.5"><input aria-label={`Piece ${p.seq} weight`} inputMode="decimal" placeholder={W} className={`input-dark ${inp} min-w-0 flex-1 !px-2 tabular-nums`} value={r.w} onChange={(e) => set(p.id, 'w', e.target.value)} onBlur={() => save(p)} />
                  {hasBle && <button type="button" onClick={() => fromScale(p, 'ble')} disabled={!!busy} className={`inline-flex ${btn} shrink-0 items-center gap-1 rounded-md border border-border px-2 text-text-muted hover:text-gold-deep disabled:opacity-50`} aria-label={`Read piece ${p.seq} from Bluetooth scale`} data-testid="ble-scale">{busy === 'ble' + p.id ? '…' : <><Bluetooth size={12} aria-hidden="true" /> BT</>}</button>}
                  {(hasSerial || !big) && <button type="button" onClick={() => fromScale(p)} disabled={!!busy} className={`inline-flex ${btn} shrink-0 items-center gap-1 rounded-md border border-border px-2 text-text-muted hover:text-gold-deep disabled:opacity-50`} title={hasSerial ? 'Read from USB scale' : 'USB scales need Chrome or Edge'} aria-label={`Read piece ${p.seq} from scale`}>{busy === 'scale' + p.id ? '…' : <><Plug size={12} aria-hidden="true" /> Scale</>}</button>}
                  <span className="w-4 shrink-0 text-teal">{saved === p.id ? <Check size={13} aria-label="Saved" /> : busy === p.id ? '…' : ''}</span></span>
                <span className="grid grid-cols-3 gap-1.5">{(['l', 'wd', 'h'] as const).map((k, i) => <input key={k} aria-label={`Piece ${p.seq} ${['length', 'width', 'height'][i]}`} placeholder={['L', 'W', 'H'][i]} inputMode="decimal" className={`input-dark ${inp} min-w-0 !px-2 tabular-nums`} value={r[k]} onChange={(e) => set(p.id, k, e.target.value)} onBlur={() => save(p)} />)}</span>
              </span>
            </li>) })}</ul>
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-muted"><Ruler size={12} aria-hidden="true" /> Saves as you leave each box. {hasBle ? 'BT reads a Bluetooth scale (pick it the first time). ' : ''}{hasSerial ? 'The plug button reads a USB scale (first time, pick it from the list).' : 'Scales that type into the box work in any browser.'}</p>
        </div>
      )}
    </div>
  )
}
