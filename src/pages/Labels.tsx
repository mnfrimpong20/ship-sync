import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Minus, Plus, Printer, Tag, ZoomIn, ZoomOut } from 'lucide-react'
import { useStore } from '../lib/store'
import { cargoLabel, countryByCode, type CargoType } from '../lib/data'
import { code128Svg, labelsApi, trackUrl, type LabelData, type LabelsResponse, type Piece } from '../lib/labels'
import { fmtDate } from '../components/ui'

type Size = '4x6' | 'a6' | 'sheet'
const SIZES: { id: Size; title: string; sub: string; w: string; h: string; page: string }[] = [
  { id: '4x6', title: '4 × 6 in thermal', sub: '100 × 150 mm roll or fanfold · one per label', w: '4in', h: '6in', page: '@page{size:4in 6in;margin:0}' },
  { id: 'a6', title: 'A6 thermal', sub: '105 × 148 mm · common in Ghana, Nigeria and the UK', w: '105mm', h: '148mm', page: '@page{size:105mm 148mm;margin:0}' },
  { id: 'sheet', title: 'Letter or A4 paper', sub: 'Two labels per page, landscape — cut and laminate', w: '4in', h: '6in', page: '@page{size:landscape;margin:.3in}' },
]
interface Opts { contents: boolean; senderPhone: boolean; receiverPhone: boolean }

/** The Ntemtem mark in one colour, so it prints crisply on thermal printers. */
const InkMark = () => <svg viewBox="0 0 96 96" className="mark" aria-hidden="true"><rect width="96" height="96" rx="22" fill="currentColor" /><path d="M17,28 L35,48 L17,68 M39,28 L57,48 L39,68" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" /><rect x="64" y="38" width="20" height="20" rx="5" fill="#fff" /></svg>

/** One sticker. Black on white only, so it prints the same on any thermal or laser printer. */
function Sticker({ d, piece, qr, shipper, opts, site }: { d: LabelData; piece: Piece; qr: string; shipper: LabelsResponse['shipper']; opts: Opts; site: string }) {
  const s = d.shipment; const dest = countryByCode(s.destination); const air = s.mode === 'air'
  const port = d.container?.destinationPort || (air ? dest?.airports?.[0] : dest?.ports?.[0]) || ''
  const r = d.receiver
  return (
    <div className="sticker">
      <div className="hd">
        <div className="brand"><InkMark /><div><b>ntemtem</b><span>{shipper.name}{shipper.hq ? ` · ${shipper.hq}` : ''}</span></div></div>
        <div className="piece"><small>PIECE</small><b>{piece.seq}<i>/</i>{d.pieces.length}</b></div>
      </div>
      <div className="dest">
        <div className="cc">{s.destination.toUpperCase()}</div>
        <div className="dt"><b>{(dest?.name ?? s.destination).toUpperCase()}</b><span>{port ? `${air ? 'Airport' : 'Port'}: ${port.replace(/\s*\(.*\)/, '')}` : air ? 'Air freight' : 'Ocean freight'}{r?.city ? ` · Deliver to ${r.city}` : ''}</span></div>
        <div className="md">{air ? 'AIR' : 'SEA'}</div>
      </div>
      <div className="ref">
        {qr ? <img className="qr" src={qr} alt={`QR code to track ${s.ref}`} /> : <div className="qr" />}
        <div className="rv">
          <div className="k">TRACKING REF</div>
          <div className="code">{s.ref}</div>
          <div className="meta"><span><em>Received</em>{s.createdAt ? fmtDate(s.createdAt) : '—'}</span>{s.weightKg ? <span><em>Weight</em>{s.weightKg} kg</span> : null}<span><em>Pieces</em>{d.pieces.length}</span></div>
        </div>
      </div>
      <div className="to">
        <div className="k">TO · RECEIVER</div>
        {r ? <><div className="nm">{r.name}</div><div className="ad">{[r.address, r.city, countryByCode(r.country)?.name ?? r.country].filter(Boolean).join(', ')}</div>{opts.receiverPhone && r.phone && <div className="ph">{r.phone}</div>}</>
          : <div className="write"><span>Name</span><span>Phone / city</span></div>}
      </div>
      <div className="row3">
        <div><div className="k">FROM</div><div className="v">{d.sender.name}</div><div className="s">{[d.sender.city || s.origin, opts.senderPhone ? d.sender.phone : ''].filter(Boolean).join(' · ')}</div></div>
        <div><div className="k">CONTENTS</div><div className="v">{cargoLabel(s.cargo as CargoType)}</div>{opts.contents && s.description && <div className="s">{s.description.slice(0, 40)}</div>}</div>
      </div>
      <div className={`cn ${d.container ? '' : 'blank'}`}>
        <div><div className="k">CONTAINER</div><div className="v">{d.container?.number || ''}</div></div>
        <div><div className="k">SEAL</div><div className="v">{d.container?.seal || ''}</div></div>
        <div><div className="k">{d.container?.vesselName ? 'VESSEL' : 'LOAD REF'}</div><div className="v">{d.container?.vesselName || d.container?.ref || ''}</div></div>
      </div>
      <div className="bc" dangerouslySetInnerHTML={{ __html: code128Svg(piece.labelCode) }} />
      <div className="ft"><b>{piece.labelCode}</b><span>Scan the QR or track at <b>{site}/track</b></span></div>
    </div>
  )
}

const css = `
.labels-sheet{--ink:#000;color:#14213D}
.sticker{width:var(--lw);height:var(--lh);background:#fff;color:var(--ink);box-sizing:border-box;padding:.16in .18in .14in;display:flex;flex-direction:column;overflow:hidden;font-family:Figtree,ui-sans-serif,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sticker .k{font-size:7.5px;letter-spacing:1.4px;font-weight:700;color:#3a3a3a}
.sticker .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
.sticker .brand{display:flex;align-items:center;gap:7px;min-width:0}
.sticker .mark{width:30px;height:30px;flex:none}
.sticker .brand b{display:block;font-size:17px;font-weight:800;letter-spacing:-.3px;line-height:1}
.sticker .brand span{display:block;font-size:9.5px;color:#3a3a3a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:2.5in}
.sticker .piece{border:2px solid var(--ink);border-radius:5px;padding:2px 9px 3px;text-align:center;line-height:1;flex:none}
.sticker .piece small{display:block;font-size:6.5px;letter-spacing:1.4px;font-weight:700}
.sticker .piece b{font-size:22px;font-weight:800}.sticker .piece i{font-style:normal;font-weight:500;margin:0 1px}
.sticker .dest{display:flex;align-items:center;gap:9px;background:var(--ink);color:#fff;border-radius:5px;padding:8px 10px;margin-top:9px}
.sticker .cc{font-size:46px;font-weight:900;letter-spacing:-1px;line-height:.9}
.sticker .dt{flex:1;min-width:0;border-left:1.5px solid rgba(255,255,255,.55);padding-left:9px}
.sticker .dt b{display:block;font-size:20px;font-weight:800;letter-spacing:.3px;line-height:1.05}
.sticker .dt span{display:block;font-size:10px;margin-top:2px;line-height:1.25}
.sticker .md{border:1.5px solid #fff;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:1.5px;padding:3px 5px}
.sticker .ref{display:flex;align-items:center;gap:12px;margin-top:10px}
.sticker .qr{width:1.32in;height:1.32in;flex:none}
.sticker .rv{flex:1;min-width:0}
.sticker .code{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:27px;letter-spacing:.3px;line-height:1.05;margin:2px 0 7px;white-space:nowrap}
.sticker .meta{display:flex;flex-wrap:wrap;gap:5px 14px;font-size:11.5px;font-weight:700}
.sticker .meta em{display:block;font-style:normal;font-size:6.5px;letter-spacing:1.3px;font-weight:700;color:#3a3a3a;text-transform:uppercase}
.sticker .to{margin-top:10px;border:2px solid var(--ink);border-radius:5px;padding:7px 10px 8px}
.sticker .to .nm{font-size:19px;font-weight:800;line-height:1.15;margin-top:1px}
.sticker .to .ad{font-size:11.5px;line-height:1.3;margin-top:1px}
.sticker .to .ph{font-size:13px;font-weight:700;margin-top:1px}
.sticker .write{display:grid;gap:16px;margin-top:12px}.sticker .write span{display:block;border-bottom:1px solid #555;font-size:7px;color:#555;padding-bottom:1px}
.sticker .row3{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:10px}
.sticker .row3 .v{font-size:13px;font-weight:700;line-height:1.2;margin-top:1px}
.sticker .row3 .s{font-size:10px;line-height:1.25;color:#222}
.sticker .cn{margin-top:auto;display:grid;grid-template-columns:1fr .8fr 1fr;gap:8px;border-top:1.5px solid var(--ink);padding-top:6px}
.sticker .cn .v{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;font-size:12px;min-height:18px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticker .cn.blank .v{border-bottom:1px solid #999}
.sticker .bc{height:.42in;margin-top:8px}.sticker .bc svg{width:100%;height:100%}
.sticker .ft{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px;font-size:8px}
.sticker .ft>b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;letter-spacing:1px;white-space:nowrap;flex:none}.sticker .ft span b{font-weight:700;color:#000}
.sticker .ft span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#3a3a3a}
.preview-grid{display:grid;gap:28px;grid-template-columns:repeat(auto-fill,minmax(calc(var(--lw) * var(--z)),1fr));justify-items:center}
.preview-item .frame{width:calc(var(--lw) * var(--z));height:calc(var(--lh) * var(--z));overflow:hidden;border-radius:6px;box-shadow:0 1px 2px rgba(20,33,61,.12),0 12px 30px -16px rgba(20,33,61,.35);background:#fff}
.preview-item .frame>.sticker{transform:scale(var(--z));transform-origin:top left}
.preview-item.off .frame{opacity:.35}
.print-only{display:none}
@media print{
  html,body{background:#fff!important}
  .labels-sheet{background:#fff!important;min-height:0!important}
  .no-print{display:none!important}
  .print-only{display:block}
  .print-only .sticker{break-after:page;page-break-after:always}
  .print-only .sticker:last-child{break-after:auto;page-break-after:auto}
  .sheet-page{display:flex;justify-content:center;gap:.5in;break-after:page;page-break-after:always}
  .sheet-page:last-child{break-after:auto;page-break-after:auto}
  .sheet-page .sticker{break-after:auto!important;page-break-after:auto!important;border:1px dashed #aaa}
}
`

export default function Labels() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const ids = useMemo(() => (sp.get('shipments') ?? '').split(',').filter(Boolean), [sp])
  const size = (SIZES.some((x) => x.id === sp.get('size')) ? sp.get('size') : '4x6') as Size
  const [data, setData] = useState<LabelsResponse | null>(null)
  const [qr, setQr] = useState<Record<string, string>>({})
  const [error, setError] = useState(''); const [busy, setBusy] = useState('')
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [only, setOnly] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.7); const [toast, setToast] = useState('')
  const [opts, setOpts] = useState<Opts>(() => { try { return { contents: true, senderPhone: false, receiverPhone: true, ...JSON.parse(localStorage.getItem('ntm.labelOpts') ?? '{}') } } catch { return { contents: true, senderPhone: false, receiverPhone: true } } })
  useEffect(() => { try { localStorage.setItem('ntm.labelOpts', JSON.stringify(opts)) } catch { /* private mode */ } }, [opts])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { const off = () => setOnly(null); window.addEventListener('afterprint', off); return () => window.removeEventListener('afterprint', off) }, [])

  useEffect(() => {
    if (!ready || user?.role !== 'shipper' || !ids.length) return
    let live = true
    labelsApi.forShipments(ids).then((r) => live && setData(r)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load labels.'))
    return () => { live = false }
  }, [ready, user, ids])
  useEffect(() => {
    if (!data) return
    let live = true
    const all = data.labels.flatMap((l) => l.pieces.map((p) => ({ key: p.id, url: trackUrl(l.shipment.ref, p.seq, data.publicUrl) })))
    Promise.all(all.map(async ({ key, url }) => [key, await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 0, width: 400, color: { dark: '#000000', light: '#FFFFFF' } })] as const)).then((pairs) => live && setQr(Object.fromEntries(pairs)))
    return () => { live = false }
  }, [data])

  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to={`/login?role=shipper&next=${encodeURIComponent(`/dashboard/labels?${sp.toString()}`)}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const S = SIZES.find((x) => x.id === size)!
  const site = (data?.publicUrl ?? location.origin).replace(/^https?:\/\/(www\.)?/, '')
  const setSize = (v: Size) => { const n = new URLSearchParams(sp); n.set('size', v); setSp(n, { replace: true }) }
  const labels = data?.labels ?? []
  const allPieces = labels.flatMap((l) => l.pieces.map((p) => ({ l, p })))
  const chosen = allPieces.filter(({ p }) => (only ? p.id === only : !skip.has(p.id)))
  const unprinted = allPieces.filter(({ p }) => !p.printedAt)
  const missingReceiver = labels.filter((l) => !l.receiver)
  const pages = size === 'sheet' ? Math.ceil(chosen.length / 2) : chosen.length

  const setCount = async (l: LabelData, count: number) => {
    if (!Number.isFinite(count) || count < 1 || count > 200 || count === l.pieces.length) return
    setBusy(l.shipment.id); setError('')
    try { const pieces = await labelsApi.setPieceCount(l.shipment.id, count); setData((d) => d && { ...d, labels: d.labels.map((x) => (x.shipment.id === l.shipment.id ? { ...x, pieces } : x)) }) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update pieces.') } finally { setBusy('') }
  }
  const togglePiece = (id: string) => setSkip((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pick = (mode: 'all' | 'unprinted' | 'none') => setSkip(new Set(mode === 'all' ? [] : allPieces.filter(({ p }) => mode === 'none' || p.printedAt).map(({ p }) => p.id)))
  const doPrint = (justOne?: string) => {
    const list = justOne ? allPieces.filter(({ p }) => p.id === justOne) : chosen
    if (!list.length) return
    const now = new Date().toISOString()
    labelsApi.markPrinted(list.map(({ p }) => p.id)).then(() => setData((d) => d && { ...d, labels: d.labels.map((l) => ({ ...l, pieces: l.pieces.map((p) => (list.some((x) => x.p.id === p.id) ? { ...p, printedAt: now } : p)) })) })).catch(() => {})
    setToast(`Sent ${list.length} label${list.length === 1 ? '' : 's'} to the printer.`)
    if (justOne) { setOnly(justOne); setTimeout(() => window.print(), 50) } else window.print()
  }
  const opt = (k: keyof Opts, label: string, hint: string) => <label className="flex cursor-pointer items-start gap-3 py-1.5"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /><span className="text-sm"><span className="font-medium">{label}</span><span className="block text-xs text-text-muted">{hint}</span></span></label>
  const stickerFor = ({ l, p }: { l: LabelData; p: Piece }) => <Sticker d={l} piece={p} qr={qr[p.id] ?? ''} shipper={data!.shipper} opts={opts} site={site} />

  return (
    <div className={`labels-sheet min-h-screen bg-bg text-text size-${size}`} style={{ ['--lw' as string]: S.w, ['--lh' as string]: S.h, ['--z' as string]: zoom }}>
      <style>{css + S.page}</style>

      {/* top bar */}
      <header className="no-print sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/dashboard/shipments" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-text-muted hover:bg-surface-2 hover:text-text focus-ring"><ArrowLeft size={15} aria-hidden="true" /> Shipments</Link>
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <div className="min-w-0"><h1 className="flex items-center gap-2 !text-lg !leading-tight"><Tag size={17} className="text-gold-deep" aria-hidden="true" /> Print labels</h1><p className="text-xs text-text-muted">{labels.length} shipment{labels.length === 1 ? '' : 's'} · {allPieces.length} label{allPieces.length === 1 ? '' : 's'}{unprinted.length ? ` · ${unprinted.length} never printed` : allPieces.length ? ' · all printed before' : ''}</p></div>
          <div className="ml-auto flex items-center gap-3">
            {toast && <p role="status" className="hidden items-center gap-1.5 text-sm text-teal sm:inline-flex"><Check size={15} aria-hidden="true" /> {toast}</p>}
            <button onClick={() => doPrint()} disabled={!chosen.length} className="btn-gold !min-h-11 !px-5 disabled:opacity-50" data-testid="print-labels"><Printer size={17} aria-hidden="true" /> Print {chosen.length} label{chosen.length === 1 ? '' : 's'}</button>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto grid max-w-[1500px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* setup panel */}
        <aside className="grid content-start gap-4 lg:pr-2 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto lg:pb-4" aria-label="Print setup">
          {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          {missingReceiver.length > 0 && <div className="rounded-xl border border-gold/60 bg-gold/10 p-3 text-sm" role="note"><p className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} className="text-gold-deep" aria-hidden="true" /> {missingReceiver.length === 1 ? '1 shipment has' : `${missingReceiver.length} shipments have`} no receiver</p><p className="mt-1 text-xs text-text-muted">The label prints blank lines to write on. Add a receiver to the client, then reload this page.</p></div>}

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="!font-sans !text-sm !font-semibold !leading-snug !tracking-normal">1 · Label size</h2>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Label size">
              {SIZES.map((x) => <label key={x.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-gold ${size === x.id ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/60'}`}><input type="radio" name="lbl-size" className="mt-1 h-4 w-4 accent-[var(--color-gold)]" checked={size === x.id} onChange={() => setSize(x.id)} /><span><span className="block text-sm font-semibold">{x.title}</span><span className="block text-xs text-text-muted">{x.sub}</span></span></label>)}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="!font-sans !text-sm !font-semibold !leading-snug !tracking-normal">2 · Shipments & pieces</h2><div className="flex gap-1 text-xs"><button onClick={() => pick('all')} className="rounded-md px-2 py-1 text-gold-deep hover:bg-surface-2">All</button><button onClick={() => pick('unprinted')} className="rounded-md px-2 py-1 text-gold-deep hover:bg-surface-2">Not printed</button><button onClick={() => pick('none')} className="rounded-md px-2 py-1 text-text-muted hover:bg-surface-2">None</button></div></div>
            <ul className="mt-3 grid gap-3" data-testid="label-shipments">
              {labels.map((l) => { const printed = l.pieces.filter((p) => p.printedAt).length; return (
                <li key={l.shipment.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-mono text-sm font-bold">{l.shipment.ref}</p><p className="truncate text-xs text-text-muted">{l.sender.name} → {l.receiver ? `${l.receiver.name}, ${l.receiver.city || countryByCode(l.shipment.destination)?.name}` : countryByCode(l.shipment.destination)?.name}</p></div>
                    <div className="flex shrink-0 items-center rounded-lg border border-border" role="group" aria-label={`Pieces for ${l.shipment.ref}`}>
                      <button onClick={() => setCount(l, l.pieces.length - 1)} disabled={!!busy || l.pieces.length <= 1} className="grid h-9 w-9 place-items-center rounded-l-lg hover:bg-surface-2 disabled:opacity-40" aria-label="One piece fewer"><Minus size={14} /></button>
                      <input key={l.pieces.length} type="number" min={1} max={200} aria-label={`Number of pieces for ${l.shipment.ref}`} className="h-9 w-11 border-x border-border bg-transparent text-center text-sm font-semibold tabular-nums outline-none focus:bg-surface-2" defaultValue={l.pieces.length} disabled={!!busy} onBlur={(e) => void setCount(l, Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                      <button onClick={() => setCount(l, l.pieces.length + 1)} disabled={!!busy || l.pieces.length >= 200} className="grid h-9 w-9 place-items-center rounded-r-lg hover:bg-surface-2 disabled:opacity-40" aria-label="One piece more"><Plus size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Pieces to print">
                    {l.pieces.map((p) => { const on = !skip.has(p.id); return <button key={p.id} onClick={() => togglePiece(p.id)} aria-pressed={on} title={p.printedAt ? `Printed ${fmtDate(p.printedAt)}` : 'Never printed'} className={`relative h-8 min-w-8 rounded-md border px-2 text-xs font-semibold tabular-nums ${on ? 'border-gold bg-gold/15' : 'border-border text-text-muted line-through'}`}>{p.seq}{p.printedAt && <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-teal text-white" aria-hidden="true"><Check size={9} strokeWidth={3} /></span>}</button> })}
                  </div>
                  <p className="mt-2 text-xs text-text-muted">{printed === 0 ? 'Never printed' : printed === l.pieces.length ? `All printed · last ${fmtDate(l.pieces.map((p) => p.printedAt!).sort().at(-1)!)}` : `${printed} of ${l.pieces.length} printed`}{!l.receiver && <> · <span className="font-semibold text-gold-deep">no receiver</span>{l.shipment.clientId && <> — <Link to={`/dashboard/clients/${l.shipment.clientId}`} className="underline">add one</Link></>}</>}</p>
                </li>) })}
            </ul>
            {busy && <p className="mt-2 text-xs text-text-muted" role="status">Updating pieces…</p>}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="!font-sans !text-sm !font-semibold !leading-snug !tracking-normal">3 · What shows on the label</h2>
            <div className="mt-2">
              {opt('contents', 'Item description', 'Turn off for valuables — the label then shows only the cargo type.')}
              {opt('receiverPhone', 'Receiver’s phone', 'Helps the delivery driver at the other end.')}
              {opt('senderPhone', 'Sender’s phone', 'Off by default to protect your customer’s number.')}
            </div>
          </section>

          <details className="group rounded-xl border border-border bg-surface p-4 text-sm">
            <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between font-semibold">Printer tips <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-text-muted">
              <li>In the print window, choose your label printer, set the paper to <b className="text-text">{S.title.replace(' thermal', '')}</b> and scale to <b className="text-text">100%</b> (not “fit”).</li>
              <li>Turn off headers and footers.</li>
              <li>Thermal or laminated stock survives a month in a container; plain paper won’t — tape over it if that’s all you have.</li>
              <li>Stick one label on every piece, on a flat side, plus a second on the top of barrels.</li>
            </ul>
          </details>
        </aside>

        {/* preview */}
        <main aria-label="Label preview">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted"><b className="text-text">{chosen.length}</b> of {allPieces.length} label{allPieces.length === 1 ? '' : 's'} selected · {pages} page{pages === 1 ? '' : 's'} · {S.title}</p>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Preview zoom">
              <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2" aria-label="Zoom out"><ZoomOut size={15} /></button>
              <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(1.2, +(z + 0.1).toFixed(1)))} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2" aria-label="Zoom in"><ZoomIn size={15} /></button>
            </div>
          </div>
          {!ids.length && <p className="rounded-xl border border-dashed border-border p-10 text-center text-text-muted">No shipments selected. On the Shipments board, tick shipments and choose “Print labels”.</p>}
          {ids.length > 0 && !data && !error && <BrandLoader />}
          {data && labels.length === 0 && <p className="rounded-xl border border-dashed border-border p-10 text-center text-text-muted">None of those shipments belong to your company.</p>}
          <div className="preview-grid" data-testid="label-preview">
            {allPieces.map((x) => { const on = !skip.has(x.p.id); return (
              <figure key={x.p.id} className={`preview-item ${on ? '' : 'off'}`}>
                <div className="frame">{stickerFor(x)}</div>
                <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs" style={{ width: `calc(${S.w} * ${zoom})` }}>
                  <span className="min-w-0 truncate text-text-muted"><b className="font-mono text-text">{x.l.shipment.ref}</b> · {x.p.seq}/{x.l.pieces.length} · {x.p.printedAt ? `printed ${fmtDate(x.p.printedAt)}` : 'not printed'}</span>
                  <span className="flex shrink-0 gap-1"><button onClick={() => togglePiece(x.p.id)} className="rounded-md px-2 py-1 hover:bg-surface-2">{on ? 'Skip' : 'Include'}</button><button onClick={() => doPrint(x.p.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-gold-deep hover:bg-surface-2"><Printer size={12} aria-hidden="true" /> Print</button></span>
                </figcaption>
              </figure>) })}
          </div>
        </main>
      </div>

      {/* what actually goes to the printer */}
      <div className="print-only">{size === 'sheet'
        ? Array.from({ length: Math.ceil(chosen.length / 2) }, (_, k) => <div key={k} className="sheet-page">{chosen.slice(k * 2, k * 2 + 2).map((x) => <Sticker key={x.p.id} d={x.l} piece={x.p} qr={qr[x.p.id] ?? ''} shipper={data!.shipper} opts={opts} site={site} />)}</div>)
        : chosen.map((x) => <Sticker key={x.p.id} d={x.l} piece={x.p} qr={qr[x.p.id] ?? ''} shipper={data!.shipper} opts={opts} site={site} />)}</div>
    </div>
  )
}
