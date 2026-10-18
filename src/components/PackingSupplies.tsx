import { useEffect, useState } from 'react'
import { Minus, Package, Plus, X } from 'lucide-react'
import { PAYMENT_REFRESH, suppliesApi, type PackingItem, type ShipmentSupplies } from '../lib/supplies'
import { usd } from '../lib/payments'

/** On a booked shipment: barrels, boxes and locks from this shipper, brought before pickup and paid with the freight. */
export function PackingSuppliesCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<ShipmentSupplies | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  useEffect(() => { suppliesApi.forShipment(shipmentId).then(setD).catch(() => setD(null)) }, [shipmentId])
  if (!d || (!d.catalog.length && !d.lines.length)) return null
  const run = async (key: string, fn: () => Promise<ShipmentSupplies>) => { setBusy(key); setError(''); try { setD(await fn()); window.dispatchEvent(new Event(PAYMENT_REFRESH)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy('') } }
  const total = d.lines.reduce((a, l) => a + l.qty * l.unitUsd, 0)
  const q = (p: PackingItem) => qty[p.id] ?? 1
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="packing-card">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Package size={14} className="text-gold-deep" aria-hidden="true" /> Packing supplies</p>
      <p className="mt-1 text-sm text-text-muted">{d.editable ? (d.isOffice ? 'Add what the customer asked for. It’s added to what they pay for this shipment.' : 'Need barrels or boxes? Your shipper brings them before pickup, and they’re added to this shipment’s payment.') : 'Brought before pickup and paid with the shipment.'}</p>
      {d.lines.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-sm" data-testid="packing-lines">
          {d.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1"><b>{l.qty} × {l.name}</b><span className="block text-xs text-text-muted">{usd(l.unitUsd)} each{l.status === 'paid' ? ' · paid' : ''}</span></span>
              <span className="tabular-nums">{usd(l.qty * l.unitUsd)}</span>
              {d.editable && l.status === 'due' && <button type="button" aria-label={`Remove ${l.name}`} disabled={!!busy} onClick={() => run(l.id, () => suppliesApi.setLine(shipmentId, l.id, 0))} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><X size={13} aria-hidden="true" /></button>}
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 font-semibold"><span>Supplies total</span><span className="tabular-nums">{usd(total)}</span></li>
        </ul>
      )}
      {d.editable && d.catalog.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {d.catalog.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="packing-option">
              <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="text-sm">{p.name}</b>{p.note && <span className="block text-xs text-text-muted">{p.note}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{usd(p.priceUsd)}</span></div>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label={`Fewer ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: Math.max(1, q(p) - 1) })} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Minus size={13} aria-hidden="true" /></button>
                <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{q(p)}</span>
                <button type="button" aria-label={`More ${p.name}`} onClick={() => setQty({ ...qty, [p.id]: Math.min(50, q(p) + 1) })} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Plus size={13} aria-hidden="true" /></button>
                <button type="button" disabled={!!busy} onClick={() => run(p.id, () => suppliesApi.addToShipment(shipmentId, p.id, q(p)))} className="btn-gold ml-auto !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="packing-add-to-shipment">{busy === p.id ? 'Adding…' : `Add ${usd(p.priceUsd * q(p))}`}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

/** Public shipper profile: what this shipper sells to pack with. */
export function ShipperPackingList({ shipperId, name }: { shipperId: string; name: string }) {
  const [items, setItems] = useState<PackingItem[]>([])
  useEffect(() => { suppliesApi.publicPacking(shipperId).then(setItems).catch(() => setItems([])) }, [shipperId])
  if (!items.length) return null
  return (
    <div className="card-dark mt-6 p-6" data-testid="profile-packing">
      <h2 className="!text-lg">Packing supplies</h2>
      <p className="mt-1 text-xs text-text-muted">{name} brings these before your pickup. Add them after you book — they’re paid with your shipment.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">{items.map((p) => <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg bg-surface-2/60 px-3 py-2.5 text-sm"><span className="min-w-0"><b>{p.name}</b>{p.note && <span className="block text-xs text-text-muted">{p.note}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{usd(p.priceUsd)}</span></li>)}</ul>
    </div>
  )
}
