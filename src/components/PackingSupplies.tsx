import { useEffect, useState } from 'react'
import { Minus, Package, Plus, Truck, X } from 'lucide-react'
import { PAYMENT_REFRESH, suppliesApi, type PackingItem, type ShipmentSupplies } from '../lib/supplies'
import type { PackingKind, SupplyAddress, SupplyNeed } from '../lib/store'
import { usd } from '../lib/payments'

/** On a booked shipment: packing supplies from this shipper, and from Ntemtem for anything the shipper doesn't stock.
 *  Shipper items are brought before pickup; Ntemtem items are sent to the supplies address. All paid with the freight. */
export function PackingSuppliesCard({ shipmentId }: { shipmentId: string }) {
  const [d, setD] = useState<ShipmentSupplies | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  const [addr, setAddr] = useState<Partial<SupplyAddress> | null>(null)
  useEffect(() => { suppliesApi.forShipment(shipmentId).then(setD).catch(() => setD(null)) }, [shipmentId])
  if (!d || (!d.catalog.length && !d.ntemtem.length && !d.lines.length)) return null
  const run = async (key: string, fn: () => Promise<ShipmentSupplies>) => { setBusy(key); setError(''); try { setD(await fn()); window.dispatchEvent(new Event(PAYMENT_REFRESH)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy('') } }
  const total = d.lines.reduce((a, l) => a + l.qty * l.unitUsd, 0)
  const q = (id: string) => qty[id] ?? 1
  const stepper = (id: string, name: string) => (
    <>
      <button type="button" aria-label={`Fewer ${name}`} onClick={() => setQty({ ...qty, [id]: Math.max(1, q(id) - 1) })} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Minus size={13} aria-hidden="true" /></button>
      <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{q(id)}</span>
      <button type="button" aria-label={`More ${name}`} onClick={() => setQty({ ...qty, [id]: Math.min(50, q(id) + 1) })} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Plus size={13} aria-hidden="true" /></button>
    </>
  )
  const a = addr ?? d.address ?? {}
  const editingAddr = addr !== null || (!d.address && d.editable && d.ntemtem.length > 0)
  const saveAddr = () => run('addr', async () => { const r = await suppliesApi.setSuppliesAddress(shipmentId, { name: a.name ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', state: a.state ?? '', zip: a.zip ?? '', country: a.country || 'US', phone: a.phone ?? '' }); setAddr(null); return r })
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="packing-card">
      <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Package size={14} className="text-gold-deep" aria-hidden="true" /> Packing supplies</p>
      <p className="mt-1 text-sm text-text-muted">{d.editable ? (d.isOffice ? 'Add what the customer asked for. It’s added to what they pay for this shipment.' : 'Need barrels or boxes? Your shipper brings their own before pickup; anything they don’t stock, Ntemtem sends to you. Paid with this shipment.') : 'Paid with the shipment.'}</p>
      {d.lines.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-sm" data-testid="packing-lines">
          {d.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1"><b>{l.qty} × {l.name}</b><span className="block text-xs text-text-muted">{usd(l.unitUsd)} each · {l.source === 'ntemtem' ? 'sent by Ntemtem' : 'brought by your shipper'}{l.status === 'paid' ? ' · paid' : ''}</span></span>
              <span className="tabular-nums">{usd(l.qty * l.unitUsd)}</span>
              {d.editable && l.status === 'due' && <button type="button" aria-label={`Remove ${l.name}`} disabled={!!busy} onClick={() => run(l.id, () => suppliesApi.setLine(shipmentId, l.id, 0))} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><X size={13} aria-hidden="true" /></button>}
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 font-semibold"><span>Supplies total</span><span className="tabular-nums">{usd(total)}</span></li>
        </ul>
      )}
      {d.orders.length > 0 && <ul className="mt-2 space-y-1 text-xs" data-testid="ntemtem-supply-orders">{d.orders.map((o) => <li key={o.ref} className="flex flex-wrap items-center gap-1.5 text-text-muted"><Truck size={13} aria-hidden="true" /> Ntemtem order {o.ref}: {o.status === 'shipped' ? `on its way${o.tracking ? ` · ${o.carrier} ${o.tracking}` : ''}` : o.status === 'delivered' ? 'delivered' : 'being packed'}</li>)}</ul>}
      {d.editable && d.catalog.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">From your shipper</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {d.catalog.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="packing-option">
                <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="text-sm">{p.name}</b>{p.note && <span className="block text-xs text-text-muted">{p.note}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{usd(p.priceUsd)}</span></div>
                <div className="flex items-center gap-1.5">{stepper(p.id, p.name)}<button type="button" disabled={!!busy} onClick={() => run(p.id, () => suppliesApi.addToShipment(shipmentId, { supplyId: p.id }, q(p.id)))} className="btn-gold ml-auto !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="packing-add-to-shipment">{busy === p.id ? 'Adding…' : `Add ${usd(p.priceUsd * q(p.id))}`}</button></div>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.editable && d.ntemtem.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-muted">Sent to you by Ntemtem</p>
          {editingAddr ? (
            <div className="mt-2 grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6" data-testid="packing-address-form">
              <p className="text-xs text-text-muted sm:col-span-6">Where should Ntemtem send them? Usually where the shipper collects from.</p>
              <input aria-label="Name" placeholder="Name" className="input-dark !min-h-9 text-sm sm:col-span-3" value={a.name ?? ''} onChange={(e) => setAddr({ ...a, name: e.target.value })} />
              <input aria-label="Phone" placeholder="Phone (optional)" className="input-dark !min-h-9 text-sm sm:col-span-3" value={a.phone ?? ''} onChange={(e) => setAddr({ ...a, phone: e.target.value })} />
              <input aria-label="Street address" placeholder="Street address" className="input-dark !min-h-9 text-sm sm:col-span-6" value={a.line1 ?? ''} onChange={(e) => setAddr({ ...a, line1: e.target.value })} />
              <input aria-label="City" placeholder="City" className="input-dark !min-h-9 text-sm sm:col-span-3" value={a.city ?? ''} onChange={(e) => setAddr({ ...a, city: e.target.value })} />
              <input aria-label="State" placeholder="State" className="input-dark !min-h-9 text-sm sm:col-span-1" value={a.state ?? ''} onChange={(e) => setAddr({ ...a, state: e.target.value })} />
              <input aria-label="ZIP or postcode" placeholder="ZIP" className="input-dark !min-h-9 text-sm sm:col-span-2" value={a.zip ?? ''} onChange={(e) => setAddr({ ...a, zip: e.target.value })} />
              <div className="flex justify-end gap-2 sm:col-span-6">{d.address && <button type="button" onClick={() => setAddr(null)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button>}<button type="button" disabled={!!busy} onClick={saveAddr} className="btn-gold !min-h-8 !px-3 text-xs" data-testid="packing-address-save">{busy === 'addr' ? 'Saving…' : 'Save address'}</button></div>
            </div>
          ) : (
            <>
              {d.address && <p className="mt-1 text-xs text-text-muted">To {d.address.name}, {d.address.line1}, {d.address.city}{d.address.state ? `, ${d.address.state}` : ''} <button type="button" onClick={() => setAddr({ ...d.address! })} className="underline">change</button></p>}
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {d.ntemtem.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="ntemtem-option">
                    <div className="flex items-start justify-between gap-2"><span className="min-w-0"><b className="text-sm">{p.name}</b><span className="block text-xs text-text-muted">{p.blurb}</span></span><span className="shrink-0 font-semibold tabular-nums">{usd(p.priceUsd)}</span></div>
                    <div className="flex items-center gap-1.5">{stepper(p.id, p.name)}<button type="button" disabled={!!busy || p.available < q(p.id)} onClick={() => run(p.id, () => suppliesApi.addToShipment(shipmentId, { productId: p.id }, q(p.id)))} className="btn-gold ml-auto !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="ntemtem-add">{busy === p.id ? 'Adding…' : `Add ${usd(p.priceUsd * q(p.id))}`}</button></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
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

/* ------------------------------------------------------------------ request form: "Need packing supplies?" */
const NEED_KINDS: { kind: PackingKind; label: string; hint: string }[] = [
  { kind: 'barrel', label: 'Barrels', hint: '55-gallon drums with lids' },
  { kind: 'box', label: 'Boxes', hint: 'Large moving boxes' },
  { kind: 'lock', label: 'Barrel locks & seals', hint: 'Ring + numbered seal' },
  { kind: 'tape', label: 'Packing tape', hint: '3 rolls' },
]
export function PackingNeeds({ needs, onNeeds, address, onAddress, shipperId, shipperName, errors }: {
  needs: SupplyNeed[]; onNeeds: (n: SupplyNeed[]) => void; address: Partial<SupplyAddress> | undefined; onAddress: (a: Partial<SupplyAddress>) => void
  shipperId?: string | null; shipperName?: string; errors: Record<string, string>
}) {
  const [cat, setCat] = useState<{ ntemtem: { id: string; kind: PackingKind; priceUsd: number; available: number }[]; shipper: PackingItem[] } | null>(null)
  const [open, setOpen] = useState(needs.length > 0)
  useEffect(() => { suppliesApi.packingOptions(shipperId ?? undefined).then(setCat).catch(() => setCat({ ntemtem: [], shipper: [] })) }, [shipperId])
  const qty = (k: PackingKind) => needs.find((n) => n.kind === k)?.qty ?? 0
  const setQ = (k: PackingKind, q: number) => onNeeds([...needs.filter((n) => n.kind !== k), ...(q > 0 ? [{ kind: k, qty: Math.min(50, q) }] : [])])
  const price = (k: PackingKind) => {
    const own = cat?.shipper.filter((x) => x.kind === k && x.active).sort((a, b) => a.priceUsd - b.priceUsd)[0]
    if (own) return { usd: own.priceUsd, who: shipperName ?? 'your shipper' }
    const n = cat?.ntemtem.find((x) => x.kind === k && x.available > 0)
    return n ? { usd: n.priceUsd, who: shipperId ? 'sent by Ntemtem' : null } : null
  }
  const kinds = NEED_KINDS.filter((k) => price(k.kind) || !cat)
  const a = address ?? {}
  const setA = (k: keyof SupplyAddress, v: string) => onAddress({ ...a, [k]: v })
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface-2 p-4" data-testid="packing-needs">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={open} onChange={(e) => { setOpen(e.target.checked); if (!e.target.checked) onNeeds([]) }} data-testid="packing-needs-toggle" />
        <span><span className="block font-semibold text-text">I need packing supplies before pickup</span><span className="text-sm text-text-muted">Barrels, boxes, locks or tape. {shipperId ? `${shipperName ?? 'Your shipper'} adds them to the quote` : 'Shippers add them to their quotes'} — and if they don’t stock something, Ntemtem sends it to you. Paid with your shipment.</span></span>
      </label>
      {open && (
        <div className="mt-4 grid gap-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {kinds.map((k) => { const p = price(k.kind); const q = qty(k.kind); return (
              <li key={k.kind} className={`flex items-center gap-3 rounded-lg border p-3 ${q ? 'border-gold bg-gold/10' : 'border-border bg-surface'}`} data-testid={`need-${k.kind}`}>
                <span className="min-w-0 flex-1"><b className="block text-sm text-text">{k.label}</b><span className="text-xs text-text-muted">{p ? (p.who ? `${usd(p.usd)} each · ${p.who}` : `about ${usd(p.usd)} each · ${k.hint}`) : k.hint}</span></span>
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={`Fewer ${k.label}`} disabled={!q} onClick={() => setQ(k.kind, q - 1)} className="grid h-8 w-8 place-items-center rounded-full border border-border disabled:opacity-40 focus-ring"><Minus size={13} aria-hidden="true" /></button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">{q}</span>
                  <button type="button" aria-label={`More ${k.label}`} onClick={() => setQ(k.kind, q + 1)} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Plus size={13} aria-hidden="true" /></button>
                </span>
              </li>
            ) })}
          </ul>
          {needs.length > 0 && (
            <fieldset className="grid gap-2 sm:grid-cols-6" data-testid="packing-address">
              <legend className="mb-1 text-sm font-semibold text-text">Where should the supplies go?</legend>
              <input aria-label="Name for the delivery" placeholder="Name" className={`input-dark sm:col-span-3 ${errors.supName ? '!border-danger' : ''}`} value={a.name ?? ''} onChange={(e) => setA('name', e.target.value)} />
              <input aria-label="Phone for the delivery" placeholder="Phone (optional)" className="input-dark sm:col-span-3" value={a.phone ?? ''} onChange={(e) => setA('phone', e.target.value)} />
              <input aria-label="Street address" placeholder="Street address" className={`input-dark sm:col-span-6 ${errors.supLine1 ? '!border-danger' : ''}`} value={a.line1 ?? ''} onChange={(e) => setA('line1', e.target.value)} />
              <input aria-label="City" placeholder="City" className={`input-dark sm:col-span-3 ${errors.supCity ? '!border-danger' : ''}`} value={a.city ?? ''} onChange={(e) => setA('city', e.target.value)} />
              <input aria-label="State" placeholder="State" className="input-dark sm:col-span-1" value={a.state ?? ''} onChange={(e) => setA('state', e.target.value)} />
              <input aria-label="ZIP or postcode" placeholder="ZIP / postcode" className="input-dark sm:col-span-2" value={a.zip ?? ''} onChange={(e) => setA('zip', e.target.value)} />
              {(errors.supName || errors.supLine1 || errors.supCity) && <p role="alert" className="text-xs text-danger sm:col-span-6">{errors.supName || errors.supLine1 || errors.supCity}</p>}
              <p className="text-xs text-text-muted sm:col-span-6">Usually where the shipper collects from. Only the shipper you book sees the full address.</p>
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}
