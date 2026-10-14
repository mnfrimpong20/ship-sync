import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { countryByCode, statusLabels } from '../lib/data'
import { shipmentOpsApi, type Manifest } from '../lib/shipmentOps'
import { fmtDate } from '../components/ui'

/** Printable cargo manifest for one container — every shipment, its pieces, sender and recipient. */
export function ManifestTable({ m, showMoney = false }: { m: Manifest; showMoney?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm print:min-w-0 print:text-[11px]">
        <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="px-2 py-2">#</th><th className="px-2 py-2">Ref</th><th className="px-2 py-2">Goods</th><th className="px-2 py-2 text-right">Pcs</th><th className="px-2 py-2 text-right">Kg</th><th className="px-2 py-2">Sender</th><th className="px-2 py-2">Recipient</th><th className="px-2 py-2">Handover</th><th className="px-2 py-2">Status</th>{showMoney && <th className="px-2 py-2 text-right">Owed</th>}</tr></thead>
        <tbody>
          {m.shipments.map((s, i) => (
            <tr key={s.id} className="border-b border-border/60 align-top">
              <td className="px-2 py-2 tabular-nums text-text-muted">{i + 1}</td>
              <td className="px-2 py-2 font-mono text-xs">{s.ref}</td>
              <td className="max-w-[220px] px-2 py-2">{s.description}{s.declaredValueUsd ? <span className="block text-[11px] text-text-muted">Declared ${s.declaredValueUsd.toLocaleString()}</span> : null}</td>
              <td className="px-2 py-2 text-right tabular-nums">{s.pieces ?? '—'}</td>
              <td className="px-2 py-2 text-right tabular-nums">{s.weightKg ?? '—'}</td>
              <td className="px-2 py-2">{s.sender}{s.senderPhone && <span className="block text-[11px] text-text-muted">{s.senderPhone}</span>}</td>
              <td className="px-2 py-2">{s.recipient ? <>{s.recipient.name}<span className="block text-[11px] text-text-muted">{[s.recipient.phone, s.recipient.city].filter(Boolean).join(' · ')}</span></> : <span className="text-danger">Missing</span>}</td>
              <td className="px-2 py-2 text-xs">{s.handover === 'collection' ? 'Collects' : 'Door delivery'}</td>
              <td className="px-2 py-2 text-xs">{statusLabels[s.status]}</td>
              {showMoney && <td className="px-2 py-2 text-right tabular-nums">{s.owedUsd ? `$${s.owedUsd.toLocaleString()}` : '—'}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="text-sm font-semibold"><td colSpan={3} className="px-2 py-2">{m.totals.shipments} shipments</td><td className="px-2 py-2 text-right tabular-nums">{m.totals.pieces || '—'}</td><td className="px-2 py-2 text-right tabular-nums">{m.totals.weightKg ?? '—'}</td><td colSpan={showMoney ? 5 : 4} /></tr></tfoot>
      </table>
    </div>
  )
}

export default function ManifestPage() {
  const { id = '' } = useParams()
  const [m, setM] = useState<Manifest | null>(null); const [err, setErr] = useState('')
  useEffect(() => { shipmentOpsApi.manifest(id).then(setM).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the manifest.')) }, [id])
  if (err) return <div className="container-x py-24 text-center text-danger">{err}</div>
  if (!m) return <div className="container-x py-24 text-center text-text-muted">Loading manifest…</div>
  const c = m.container
  return (
    <div className="bg-bg text-text print:bg-white print:text-black">
      <div className="container-x py-8 print:py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link to={`/dashboard/containers/${c.id}`} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-gold"><ArrowLeft size={14} aria-hidden="true" /> {c.ref}</Link>
          <button onClick={() => window.print()} className="btn-gold !min-h-10 !px-4 text-sm"><Printer size={15} aria-hidden="true" /> Print</button>
        </div>
        <header className="mt-4">
          <p className="eyebrow">{m.shipper || 'Cargo manifest'}</p>
          <h1 className="!text-[clamp(1.5rem,3vw,2.2rem)]" data-testid="manifest-title">Manifest — {c.ref}{c.number ? ` · ${c.number}` : ''}</h1>
          <p className="mt-1 text-sm text-text-muted">{[c.size, c.line, c.vesselName && `${c.vesselName}${c.voyage ? ` ${c.voyage}` : ''}`, c.seal && `Seal ${c.seal}`].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-text-muted">{c.originPort || 'Origin'} → {c.destinationPort || countryByCode(c.destination)?.name}{c.etd ? ` · ETD ${fmtDate(c.etd + 'T12:00:00Z')}` : ''}{c.eta ? ` · ETA ${fmtDate(c.eta + 'T12:00:00Z')}` : ''}</p>
        </header>
        <div className="card-dark mt-6 p-2 print:border-0 print:p-0"><ManifestTable m={m} showMoney /></div>
      </div>
    </div>
  )
}
