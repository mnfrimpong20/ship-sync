import { useEffect, useState } from 'react'
import { AlertTriangle, Boxes, Check, PackagePlus, Pencil, Plus, RotateCcw, ShoppingCart, Truck, Wallet } from 'lucide-react'
import { categoryLabels, orderStatusLabels, planLabel, rentalStatusLabels, suppliesApi, type AdminView, type Category, type Order, type PlanKey, type Product, type ProductInput } from '../lib/supplies'
import { usd } from '../lib/payments'
import { fmtDate } from './ui'
import { StatCard, Th, thead, trow } from './board'

const tone: Record<Order['status'], string> = { awaiting_payment: 'bg-gold/15 text-gold-deep', paid: 'bg-sky/15 text-sea', packed: 'bg-sky/15 text-sea', shipped: 'bg-sky/15 text-sea', delivered: 'bg-teal/15 text-teal', cancelled: 'bg-surface-2 text-text-muted' }
const toInput = (p?: Product): ProductInput => p ? { audience: p.audience ?? 'shipper', packingKind: p.packingKind ?? null, name: p.name, sku: p.sku, category: p.category, blurb: p.blurb, specs: p.specs, priceUsd: p.priceUsd, rentUsd: p.rentUsd, reorderLevel: p.reorderLevel, labelsPerUnit: p.labelsPerUnit, kit: p.kit.map(({ productId, qty }) => ({ productId, qty })), includedWith: p.includedWith, active: p.active, sort: p.sort }
  : { audience: 'shipper', packingKind: null, name: '', sku: '', category: 'accessory', blurb: '', specs: [], priceUsd: 0, rentUsd: null, reorderLevel: 5, labelsPerUnit: 0, kit: [], includedWith: [], active: true, sort: 50 }

/** Admin: Ntemtem's equipment stock, orders to pack and ship, and rentals out with shipping companies. */
export function AdminSupplies() {
  const [d, setD] = useState<AdminView | null>(null)
  const [error, setError] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('')
  const [receive, setReceive] = useState<Record<string, string>>({})
  const [ship, setShip] = useState<{ id: string; ref: string; carrier: string; tracking: string } | null>(null)
  const [edit, setEdit] = useState<{ id?: string; f: ProductInput; specs: string } | null>(null)
  const load = () => suppliesApi.admin().then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => { setBusy(key); setError(''); try { await fn(); await load(); setMsg(done) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') } }
  if (!d) return <section className="mt-12"><h2 className="!text-xl">Supplies</h2><p className="mt-2 text-sm text-text-muted">{error || 'Loading…'}</p></section>
  const parts = d.products.filter((p) => !p.kit.length)
  const open = d.orders.filter((o) => o.status !== 'cancelled')
  const saveProduct = async (e: React.FormEvent) => { e.preventDefault(); if (!edit) return; const f = { ...edit.f, specs: edit.specs.split('\n').map((s) => s.trim()).filter(Boolean) }; await act('prod', () => (edit.id ? suppliesApi.updateProduct(edit.id, f) : suppliesApi.createProduct(f)), 'Product saved.'); setEdit(null) }

  return (
    <section className="mt-14" data-testid="admin-supplies">
      <p className="eyebrow mb-1">Supplies</p>
      <h2 className="!text-[clamp(1.5rem,3vw,2rem)]">Equipment stock, orders and rentals</h2>
      <p className="mt-1 text-text-muted">Printers, scanners and labels Ntemtem sells and rents to shipping companies, and the packing supplies Ntemtem sends to customers whose shipper doesn’t stock them (marked “Customer”). Stock is held back when an order is placed and goes back on the shelf if it’s cancelled or a rental comes home. Kits use the stock of the parts inside them.</p>
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Sales this month" value={usd(d.stats.salesMonthUsd)} icon={Wallet} />
        <StatCard label="Rental income" value={`${usd(d.stats.rentalMrrUsd)}/mo`} icon={RotateCcw} />
        <StatCard label="Orders to fulfil" value={d.stats.openOrders} icon={ShoppingCart} warn={d.stats.openOrders > 0} />
        <StatCard label="Low stock" value={d.stats.lowStock} hint="At or below reorder level" icon={AlertTriangle} warn={d.stats.lowStock > 0} />
        <StatCard label="Returns due" value={d.stats.returnsDue} icon={Truck} warn={d.stats.returnsDue > 0} />
      </div>

      <div className="mt-8 card-dark overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4"><h3 className="!text-base">Orders</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className={thead}><Th>Order</Th><Th>Company</Th><Th>Items</Th><Th className="text-right">Total</Th><Th>Status</Th><Th className="text-right">Next step</Th></tr></thead>
            <tbody>
              {!open.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-text-muted">No orders yet.</td></tr>}
              {open.map((o) => (
                <tr key={o.id} className={trow(false, o.status === 'delivered')} data-testid="admin-order">
                  <td className="px-3 py-3"><span className="font-mono text-xs font-semibold">{o.ref}</span><p className="text-[11px] text-text-muted">{o.createdAt ? fmtDate(o.createdAt) : ''}</p></td>
                  <td className="px-3 py-3 text-xs">{o.kind === 'customer' ? <><span className="mr-1 rounded-full bg-gold/20 px-1.5 py-0.5 text-[10px] font-semibold text-gold-deep">Customer</span>{o.customerName}<p className="text-text-muted">for {o.shipmentRef} · {o.shipperName}</p></> : o.shipperName}<p className="text-text-muted">{[o.shipTo.city, o.shipTo.state, o.shipTo.country].filter(Boolean).join(', ')}</p></td>
                  <td className="px-3 py-3 text-xs">{o.items.map((i) => <p key={i.productId + i.mode}>{i.qty} × {i.name}{i.mode !== 'buy' ? <span className="text-text-muted"> ({i.mode === 'rent' ? 'rent' : 'with plan'})</span> : null}</p>)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{o.totalUsd ? usd(o.totalUsd) : 'Free'}{o.monthlyUsd ? <p className="text-[11px] text-text-muted">+ {usd(o.monthlyUsd)}/mo</p> : null}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[o.status]}`}>{orderStatusLabels[o.status]}</span>{o.tracking && <p className="mt-1 font-mono text-[11px] text-text-muted">{o.carrier} {o.tracking}</p>}</td>
                  <td className="px-3 py-3 text-right"><div className="flex justify-end gap-1">
                    {o.status === 'awaiting_payment' && <button disabled={!!busy} onClick={() => act(o.id, () => suppliesApi.orderAction(o.id, 'paid'), `${o.ref} marked paid.`)} className="btn-gold !min-h-8 !px-2.5 text-xs">Mark paid</button>}
                    {o.status === 'paid' && <button disabled={!!busy} onClick={() => act(o.id, () => suppliesApi.orderAction(o.id, 'packed'), `${o.ref} packed.`)} className="btn-ghost !min-h-8 !px-2.5 text-xs">Packed</button>}
                    {(o.status === 'paid' || o.status === 'packed') && <button disabled={!!busy} onClick={() => setShip({ id: o.id, ref: o.ref, carrier: 'UPS', tracking: '' })} className="btn-gold !min-h-8 !px-2.5 text-xs" data-testid="admin-ship">Ship</button>}
                    {o.status === 'shipped' && <button disabled={!!busy} onClick={() => act(o.id, () => suppliesApi.orderAction(o.id, 'delivered'), `${o.ref} delivered.`)} className="btn-ghost !min-h-8 !px-2.5 text-xs">Delivered</button>}
                    {['awaiting_payment', 'paid', 'packed'].includes(o.status) && <button disabled={!!busy} onClick={() => confirm(`Cancel ${o.ref}? Stock goes back on the shelf. Refund any card payment in Stripe.`) && act(o.id, () => suppliesApi.orderAction(o.id, 'cancel'), `${o.ref} cancelled.`)} className="btn-ghost !min-h-8 !px-2.5 text-xs text-danger">Cancel</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 card-dark overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4"><h3 className="!text-base">Stock</h3><button type="button" onClick={() => setEdit({ f: toInput(), specs: '' })} className="btn-gold !min-h-9 !px-3 text-sm" data-testid="admin-new-product"><Plus size={14} aria-hidden="true" /> New product</button></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className={thead}><Th>Product</Th><Th className="text-right">Available</Th><Th className="text-right">Reorder at</Th><Th className="text-right">Buy</Th><Th className="text-right">Rent / mo</Th><Th>Free with</Th><Th className="text-right">Receive stock</Th></tr></thead>
            <tbody>
              {d.products.map((p) => (
                <tr key={p.id} className={trow(false, !p.active)} data-testid="admin-product">
                  <td className="px-3 py-3"><button type="button" onClick={() => setEdit({ id: p.id, f: toInput(p), specs: p.specs.join('\n') })} className="inline-flex items-center gap-1.5 text-left font-semibold hover:text-gold-deep focus-ring rounded">{p.name} <Pencil size={12} aria-hidden="true" /></button><p className="text-[11px] text-text-muted">{categoryLabels[p.category]}{p.sku ? ` · ${p.sku}` : ''}{p.kit.length ? ` · ${p.kit.map((k) => `${k.qty}× ${k.name}`).join(', ')}` : ''}{!p.active ? ' · hidden' : ''}</p></td>
                  <td className={`px-3 py-3 text-right tabular-nums font-semibold ${p.available <= p.reorderLevel && !p.kit.length ? 'text-danger' : ''}`}>{p.available}{p.available <= p.reorderLevel && !p.kit.length ? <AlertTriangle size={12} className="ml-1 inline" aria-label="Low stock" /> : null}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-text-muted">{p.kit.length ? '—' : p.reorderLevel}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{usd(p.priceUsd)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{p.rentUsd != null ? usd(p.rentUsd) : '—'}</td>
                  <td className="px-3 py-3 text-xs">{p.includedWith.length ? p.includedWith.map(planLabel).join(', ') : '—'}</td>
                  <td className="px-3 py-3 text-right">{p.kit.length ? <span className="text-xs text-text-muted">from parts</span> : (
                    <form className="flex justify-end gap-1" onSubmit={(e) => { e.preventDefault(); const n = Number(receive[p.id]); if (!n) return; void act(p.id, () => suppliesApi.stock(p.id, n, n > 0 ? 'Received' : 'Adjusted'), `${n > 0 ? '+' : ''}${n} ${p.name}`).then(() => setReceive({ ...receive, [p.id]: '' })) }}>
                      <input type="number" aria-label={`Units of ${p.name} received`} placeholder="+0" className="input-dark !min-h-8 w-20 text-right text-sm tabular-nums" value={receive[p.id] ?? ''} onChange={(e) => setReceive({ ...receive, [p.id]: e.target.value })} />
                      <button disabled={busy === p.id} className="btn-ghost !min-h-8 !px-2.5 text-xs"><PackagePlus size={13} aria-hidden="true" /> Add</button>
                    </form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="card-dark overflow-hidden">
          <h3 className="border-b border-border p-4 !text-base">Equipment out with companies</h3>
          {!d.rentals.length ? <p className="p-4 text-sm text-text-muted">Nothing out on rental.</p> : (
            <ul className="divide-y divide-border text-sm">{d.rentals.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="admin-rental">
                <span className="min-w-0 flex-1"><b>{r.qty > 1 ? `${r.qty} × ` : ''}{r.productName}</b><span className="block text-xs text-text-muted">{r.shipperName} · {r.mode === 'included' ? 'free with plan' : `${usd(r.monthlyUsd)}/mo`}{r.startedAt ? ` · since ${fmtDate(r.startedAt)}` : ''}</span></span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === 'return_requested' ? 'bg-gold/15 text-gold-deep' : r.status === 'active' ? 'bg-teal/15 text-teal' : 'bg-surface-2 text-text-muted'}`}>{rentalStatusLabels[r.status]}</span>
                {(r.status === 'active' || r.status === 'return_requested') && <button disabled={!!busy} onClick={() => act(r.id, () => suppliesApi.rentalAction(r.id, 'returned'), `${r.productName} checked back in.`)} className="btn-ghost !min-h-8 !px-2.5 text-xs">Received back</button>}
                {r.status === 'return_requested' && <button disabled={!!busy} onClick={() => act(r.id, () => suppliesApi.rentalAction(r.id, 'keep'), 'Return cancelled.')} className="text-xs text-text-muted hover:underline">Keep out</button>}
              </li>
            ))}</ul>
          )}
        </div>
        <div className="card-dark overflow-hidden">
          <h3 className="flex items-center gap-2 border-b border-border p-4 !text-base"><Boxes size={16} aria-hidden="true" /> Stock movements</h3>
          <ul className="max-h-[360px] divide-y divide-border overflow-y-auto text-xs">{d.moves.map((m, i) => <li key={i} className="flex items-center gap-2 px-4 py-2"><span className={`w-12 text-right font-semibold tabular-nums ${m.delta > 0 ? 'text-teal' : 'text-text'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</span><span className="min-w-0 flex-1 truncate">{m.productName}<span className="text-text-muted"> · {m.reason}{m.ref ? ` ${m.ref}` : ''}</span></span><span className="shrink-0 text-text-muted">{fmtDate(m.at)}</span></li>)}</ul>
        </div>
      </div>

      {ship && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShip(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); await act(ship.id, () => suppliesApi.orderAction(ship.id, 'shipped', { carrier: ship.carrier, tracking: ship.tracking }), `${ship.ref} shipped — the company has been told.`); setShip(null) }} role="dialog" aria-modal="true" aria-labelledby="ship-h" className="card-dark grid w-full max-w-sm gap-3 p-6">
            <h2 id="ship-h" className="!text-lg">Ship {ship.ref}</h2>
            <label className="text-xs text-text-muted">Carrier<input className="input-dark mt-1 !min-h-10 text-sm" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} /></label>
            <label className="text-xs text-text-muted">Tracking number<input required autoFocus className="input-dark mt-1 !min-h-10 font-mono text-sm" value={ship.tracking} onChange={(e) => setShip({ ...ship, tracking: e.target.value })} /></label>
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setShip(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Back</button><button className="btn-gold !min-h-10 !px-4 text-sm">Mark shipped</button></div>
          </form>
        </div>
      )}
      {edit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEdit(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveProduct} role="dialog" aria-modal="true" aria-labelledby="prod-h" className="card-dark my-8 grid w-full max-w-xl gap-3 p-6" data-testid="product-form">
            <h2 id="prod-h" className="!text-lg">{edit.id ? 'Edit product' : 'New product'}</h2>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="text-xs text-text-muted">Name<input required minLength={2} className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} /></label>
              <label className="text-xs text-text-muted">SKU<input className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.sku} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, sku: e.target.value } })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-muted">Sold to<select className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.audience} onChange={(e) => { const a = e.target.value as 'shipper' | 'customer'; setEdit({ ...edit, f: { ...edit.f, audience: a, category: a === 'customer' ? 'packing' : edit.f.category === 'packing' ? 'accessory' : edit.f.category, packingKind: a === 'customer' ? edit.f.packingKind ?? 'barrel' : null } }) }} data-testid="product-audience"><option value="shipper">Shipping companies (equipment)</option><option value="customer">Customers (packing supplies)</option></select></label>
              {edit.f.audience === 'customer' && <label className="text-xs text-text-muted">Covers requests for<select className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.packingKind ?? 'barrel'} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, packingKind: e.target.value as ProductInput['packingKind'] } })}>{[['barrel', 'Barrels'], ['box', 'Boxes'], ['lock', 'Locks & seals'], ['tape', 'Tape'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            </div>
            <label className="text-xs text-text-muted">Short description<input className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.blurb} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, blurb: e.target.value } })} /></label>
            <label className="text-xs text-text-muted">Key points (one per line)<textarea rows={3} className="input-dark mt-1 py-2 text-sm" value={edit.specs} onChange={(e) => setEdit({ ...edit, specs: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="text-xs text-text-muted">Type<select className="input-dark mt-1 !min-h-10 text-sm" value={edit.f.category} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, category: e.target.value as Category } })}>{Object.entries(categoryLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs text-text-muted">Buy price ($)<input type="number" min={0} step="0.01" className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.f.priceUsd} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, priceUsd: Number(e.target.value) || 0 } })} /></label>
              <label className="text-xs text-text-muted">Rent / month ($)<input type="number" min={0} step="0.01" placeholder="Not for rent" className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.f.rentUsd ?? ''} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, rentUsd: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
              <label className="text-xs text-text-muted">Reorder at<input type="number" min={0} className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.f.reorderLevel} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, reorderLevel: Number(e.target.value) || 0 } })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-muted">Labels per unit (for reorder reminders)<input type="number" min={0} className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.f.labelsPerUnit} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, labelsPerUnit: Number(e.target.value) || 0 } })} /></label>
              <label className="text-xs text-text-muted">Order on the page<input type="number" min={0} max={1000} className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.f.sort} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, sort: Number(e.target.value) || 0 } })} /></label>
            </div>
            <fieldset className="text-xs text-text-muted"><legend>Free with plan (one per company, on loan while they stay on the plan)</legend>
              <div className="mt-1 flex gap-4">{(['pro', 'enterprise'] as PlanKey[]).map((pl) => <label key={pl} className="flex items-center gap-1.5 text-sm text-text"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={edit.f.includedWith.includes(pl)} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, includedWith: e.target.checked ? [...edit.f.includedWith, pl] : edit.f.includedWith.filter((x) => x !== pl) } })} /> {planLabel(pl)}</label>)}</div>
            </fieldset>
            {edit.f.category === 'kit' && (
              <fieldset className="text-xs text-text-muted"><legend>What’s in the kit</legend>
                <div className="mt-1 grid gap-1.5">{parts.filter((p) => p.id !== edit.id).map((p) => { const k = edit.f.kit.find((x) => x.productId === p.id); return (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-text"><input type="number" min={0} max={100} aria-label={`${p.name} in kit`} className="input-dark !min-h-8 w-16 text-right text-sm tabular-nums" value={k?.qty ?? 0} onChange={(e) => { const n = Number(e.target.value) || 0; const rest = edit.f.kit.filter((x) => x.productId !== p.id); setEdit({ ...edit, f: { ...edit.f, kit: n > 0 ? [...rest, { productId: p.id, qty: n }] : rest } }) }} /> {p.name}</label>
                ) })}</div>
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={edit.f.active} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, active: e.target.checked } })} /> Show in the store</label>
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy === 'prod'} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy === 'prod' ? 'Saving…' : 'Save product'}</button></div>
          </form>
        </div>
      )}
    </section>
  )
}
