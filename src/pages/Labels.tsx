import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { ArrowLeft, Printer, Tag } from 'lucide-react'
import { useStore } from '../lib/store'
import { cargoLabel, countryByCode, type CargoType } from '../lib/data'
import { code128Svg, labelsApi, trackUrl, type LabelData, type LabelsResponse, type Piece } from '../lib/labels'
import { fmtDate } from '../components/ui'

type Size = '4x6' | 'letter'

/** One sticker. Pure black-on-white so it prints on any thermal or laser printer; the gold edge is the only colour. */
function Sticker({ d, piece, qr, shipper }: { d: LabelData; piece: Piece; qr: string; shipper: LabelsResponse['shipper'] }) {
  const dest = countryByCode(d.shipment.destination)
  const port = d.container?.destinationPort || dest?.name || d.shipment.destination
  return (
    <div className="sticker">
      <div className="edge" />
      <div className="top">
        <div><div className="brand">Ship<span>Sync</span></div><div className="shipper">{shipper.name}{shipper.hq ? ` · ${shipper.hq}` : ''}</div></div>
        <div className="piece">{piece.seq} <span>of</span> {d.pieces.length}<small>PIECE</small></div>
      </div>
      <div className="ref">
        {qr ? <img className="qr" src={qr} alt={`QR code for ${piece.labelCode}`} /> : <div className="qr" />}
        <div className="num"><div className="lbl">TRACKING REF</div><div className="code">{d.shipment.ref}</div><div className="dest">{port.toUpperCase()}<small>{(dest?.name ?? d.shipment.destination).toUpperCase()} · {d.shipment.mode === 'air' ? 'AIRPORT OF ARRIVAL' : 'PORT OF DISCHARGE'}</small></div></div>
      </div>
      <div className="grid">
        <div className="f wide"><div className="k">RECEIVER · CONSIGNEE</div>{d.receiver ? <><div className="v">{d.receiver.name}</div><div className="s">{[d.receiver.address, d.receiver.city, countryByCode(d.receiver.country)?.name ?? d.receiver.country].filter(Boolean).join(', ')}{d.receiver.phone ? ` · ${d.receiver.phone}` : ''}</div></> : <><div className="v blank">Consignee not set</div><div className="s">Add a consignee on the client record, then reprint.</div></>}</div>
        <div className="f wide"><div className="k">SENDER</div><div className="v">{d.sender.name}{d.sender.company ? ` · ${d.sender.company}` : ''}</div><div className="s">{[d.sender.city || d.shipment.origin, d.sender.phone].filter(Boolean).join(' · ')}</div></div>
        <div className="f"><div className="k">CONTENTS</div><div className="v">{cargoLabel(d.shipment.cargo as CargoType)}</div><div className="s">{d.shipment.description.slice(0, 60)}</div></div>
        <div className="f"><div className="k">ORIGIN</div><div className="v">{d.shipment.origin}</div><div className="s">{d.shipment.mode === 'air' ? 'Air freight' : 'Ocean freight'}</div></div>
      </div>
      <div className={`box ${d.container ? '' : 'empty'}`}>
        <div><div className="k">CONTAINER</div><div className="v">{d.container?.number || (d.container ? '—' : '')}</div></div>
        <div><div className="k">SEAL</div><div className="v">{d.container?.seal || (d.container ? '—' : '')}</div></div>
        <div><div className="k">CN REF</div><div className="v">{d.container?.ref ?? ''}</div></div>
      </div>
      <div className="barcode" dangerouslySetInnerHTML={{ __html: code128Svg(piece.labelCode) }} />
      <div className="foot"><span>{piece.labelCode} · received <b>{d.shipment.createdAt ? fmtDate(d.shipment.createdAt) : '—'}</b></span><span>Scan to track · <b>{location.host}</b></span></div>
    </div>
  )
}

const css = `
.labels-sheet{--ink:#0B1B33;--gold:#C99C33;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.sticker{width:4in;height:6in;background:#fff;color:var(--ink);box-sizing:border-box;padding:.2in .2in .18in .27in;display:flex;flex-direction:column;position:relative;overflow:hidden;border:1px solid #d8d3c8;border-radius:4px;page-break-inside:avoid;break-inside:avoid}
.sticker .edge{position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--gold)}
.sticker .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--ink);padding-bottom:6px}
.sticker .brand{font-weight:800;font-size:15px}.sticker .brand span{color:var(--gold)}
.sticker .shipper{font-size:9.5px;color:#4b5563;margin-top:2px;line-height:1.3;max-width:2.4in}
.sticker .piece{border:2.5px solid var(--ink);border-radius:6px;padding:3px 9px;text-align:center;font-weight:800;font-size:13px;line-height:1.1;white-space:nowrap}
.sticker .piece span{font-weight:600;font-size:11px}.sticker .piece small{display:block;font-size:8px;font-weight:600;letter-spacing:1px;color:#4b5563}
.sticker .ref{display:flex;align-items:center;gap:12px;margin-top:9px}
.sticker .qr{width:1.3in;height:1.3in;flex:none;background:#fff}
.sticker .num{flex:1;min-width:0}
.sticker .lbl{font-size:8px;letter-spacing:1.6px;color:#4b5563;font-weight:600}
.sticker .code{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:27px;letter-spacing:.5px;line-height:1.05;margin:2px 0 5px}
.sticker .dest{font-size:22px;font-weight:800;line-height:1;letter-spacing:-.3px;word-break:break-word}
.sticker .dest small{display:block;font-size:9.5px;font-weight:600;color:#4b5563;letter-spacing:.5px;margin-top:3px}
.sticker .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin-top:9px;border-top:1.5px solid #cfcac0;padding-top:8px}
.sticker .f .k{font-size:7.5px;letter-spacing:1.3px;color:#4b5563;font-weight:600}
.sticker .f .v{font-size:12px;font-weight:700;line-height:1.25;margin-top:1px}.sticker .f .v.blank{color:#9ca3af;font-weight:600}
.sticker .f .s{font-size:9.5px;color:#374151;line-height:1.3}
.sticker .wide{grid-column:1/-1}
.sticker .box{margin-top:auto;border:1.5px solid var(--ink);border-radius:6px;padding:6px 9px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;min-height:.42in}
.sticker .box.empty{border-style:dashed;color:#9ca3af}
.sticker .box .k{font-size:7px;letter-spacing:1.3px;color:#4b5563;font-weight:600}.sticker .box .v{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;font-size:11.5px;margin-top:1px;min-height:14px}
.sticker .barcode{height:.3in;margin-top:7px}.sticker .barcode svg{width:100%;height:100%}
.sticker .foot{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:8px;color:#4b5563;gap:8px}.sticker .foot b{color:var(--ink)}
.labels-grid{display:grid;gap:.25in;grid-template-columns:repeat(auto-fill,4in);justify-content:center}
@media print{
  body{background:#fff!important}
  .no-print{display:none!important}
  .labels-sheet{padding:0!important;margin:0!important}
  .sticker{border:none;border-radius:0}
  .size-4x6 .labels-grid{display:block}
  .size-4x6 .sticker{page-break-after:always;break-after:page;margin:0}
  .size-letter .labels-grid{display:grid;grid-template-columns:4in 4in;gap:.25in .3in;justify-content:center}
  .size-letter .sticker:nth-child(4n){page-break-after:always;break-after:page}
}
@page{margin:0}
.size-4x6-page{}
`

export default function Labels() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const ids = useMemo(() => (sp.get('shipments') ?? '').split(',').filter(Boolean), [sp])
  const size = (sp.get('size') as Size | null) ?? '4x6'
  const [data, setData] = useState<LabelsResponse | null>(null)
  const [qr, setQr] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!ready || user?.role !== 'shipper' || !ids.length) return
    let live = true
    labelsApi.forShipments(ids).then((r) => live && setData(r)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load labels.'))
    return () => { live = false }
  }, [ready, user, ids])
  useEffect(() => {
    if (!data) return
    let live = true
    const all = data.labels.flatMap((l) => l.pieces.map((p) => ({ key: p.id, url: trackUrl(l.shipment.ref, p.seq) })))
    Promise.all(all.map(async ({ key, url }) => [key, await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 0, width: 400, color: { dark: '#0B1B33', light: '#FFFFFF' } })] as const)).then((pairs) => live && setQr(Object.fromEntries(pairs)))
    return () => { live = false }
  }, [data])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?role=shipper&next=${encodeURIComponent(`/dashboard/labels?${sp.toString()}`)}`} replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const setCount = async (l: LabelData, count: number) => {
    if (!count || count < 1 || count > 200) return
    setBusy(true)
    try { const pieces = await labelsApi.setPieceCount(l.shipment.id, count); setData((d) => d && { ...d, labels: d.labels.map((x) => (x.shipment.id === l.shipment.id ? { ...x, pieces } : x)) }) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update pieces.') } finally { setBusy(false) }
  }
  const print = async () => {
    const pieceIds = (data?.labels ?? []).flatMap((l) => l.pieces.map((p) => p.id))
    labelsApi.markPrinted(pieceIds).catch(() => {})
    window.print()
  }
  const total = (data?.labels ?? []).reduce((n, l) => n + l.pieces.length, 0)

  return (
    <div className={`labels-sheet bg-bg text-text size-${size}`}>
      <style>{css}</style>
      <div className="no-print border-b border-border bg-surface">
        <div className="container-x flex flex-wrap items-center gap-3 py-4">
          <Link to="/dashboard/shipments" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text focus-ring"><ArrowLeft size={14} aria-hidden="true" /> Shipments</Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <p className="flex items-center gap-2 font-semibold"><Tag size={16} className="text-gold" aria-hidden="true" /> {total} label{total === 1 ? '' : 's'} · {data?.labels.length ?? 0} shipment{data?.labels.length === 1 ? '' : 's'}</p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-xs text-text-muted" htmlFor="lbl-size">Paper</label>
            <select id="lbl-size" className="input-dark !min-h-9 !w-auto text-sm" value={size} onChange={(e) => { const n = new URLSearchParams(sp); n.set('size', e.target.value); setSp(n, { replace: true }) }}><option value="4x6">4 × 6 in thermal (one per label)</option><option value="letter">Letter / A4 sheet (4 per page)</option></select>
            <button onClick={print} disabled={!data || !total} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60"><Printer size={15} aria-hidden="true" /> Print</button>
          </div>
        </div>
        {data && (
          <div className="container-x flex flex-wrap items-center gap-x-6 gap-y-2 pb-4 text-xs text-text-muted">
            <span>Pieces per shipment:</span>
            {data.labels.map((l) => (
              <label key={l.shipment.id} className="inline-flex items-center gap-2"><span className="font-mono text-text">{l.shipment.ref}</span><input type="number" min={1} max={200} aria-label={`Pieces for ${l.shipment.ref}`} className="input-dark !min-h-8 w-16 text-sm tabular-nums" defaultValue={l.pieces.length} disabled={busy} onBlur={(e) => { const n = Number(e.target.value); if (n !== l.pieces.length) setCount(l, n) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
            ))}
            <span className="ml-auto">Set the printer to the label size with no scaling. Thermal or laminated stock survives a month in a container; plain paper won’t.</span>
          </div>
        )}
        {error && <div className="container-x pb-4"><p role="alert" className="text-sm text-danger">{error}</p></div>}
      </div>

      <div className="container-x py-8 print:p-0">
        {!ids.length && <p className="text-center text-text-muted">No shipments selected. Open a shipment on the Shipments board and choose “Print labels”.</p>}
        {data && data.labels.length === 0 && <p className="text-center text-text-muted">None of those shipments belong to your company.</p>}
        <div className="labels-grid">
          {(data?.labels ?? []).flatMap((l) => l.pieces.map((p) => <Sticker key={p.id} d={l} piece={p} qr={qr[p.id] ?? ''} shipper={data!.shipper} />))}
        </div>
      </div>
    </div>
  )
}
