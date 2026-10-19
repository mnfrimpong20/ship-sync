import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Barcode, Check, CreditCard, Gift, Minus, Package, PackageCheck, Pencil, Plus, Printer, RotateCcw, ShoppingCart, Tag, Trash2, Truck, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api, useStore } from '../lib/store'
import { categoryLabels, orderStatusLabels, packingKindLabels, planLabel, rentalStatusLabels, suppliesApi, type Address, type Category, type Mode, type Order, type PackingInput, type PackingItem, type PackingKind, type Product, type StoreView } from '../lib/supplies'
import { usd } from '../lib/payments'
import { fmtDate } from '../components/ui'
import { Confirm, StatCard } from '../components/board'

export const categoryIcon: Record<Category, LucideIcon> = { kit: Package, printer: Printer, scanner: Barcode, labels: Tag, accessory: Package, packing: Package }
const statusTone: Record<Order['status'], string> = { awaiting_payment: 'bg-gold/15 text-gold-deep', paid: 'bg-sky/15 text-sea', packed: 'bg-sky/15 text-sea', shipped: 'bg-sky/15 text-sea', delivered: 'bg-teal/15 text-teal', cancelled: 'bg-surface-2 text-text-muted' }
const STEPS: Order['status'][] = ['paid', 'packed', 'shipped', 'delivered']
type Line = { productId: string; qty: number; mode: Mode }
const blankAddress = (name = '', company = ''): Address => ({ name, company, line1: '', line2: '', city: '', state: '', zip: '', country: 'US', phone: '' })

/** Shipping company: buy, rent or claim equipment from Ntemtem; manage the packing supplies it sells to senders. */
export default function SuppliesPage() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'packing' ? 'packing' : 'equipment'
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?next=/dashboard/supplies" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Operate</p>
      <h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Equipment & supplies</h1>
      <div role="tablist" aria-label="Supplies" className="mt-5 inline-flex rounded-full border border-border bg-surface p-1">
        {([['equipment', 'Equipment from Ntemtem', 'Equipment'], ['packing', 'Packing supplies you sell', 'Packing supplies']] as const).map(([k, l, short]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp(k === 'equipment' ? {} : { tab: k })} className={`min-h-10 rounded-full px-4 text-sm font-semibold focus-ring ${tab === k ? 'bg-gold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid={`supplies-tab-${k}`}><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{l}</span></button>
        ))}
      </div>
      {tab === 'equipment' ? <Equipment userName={user.name} company={user.company ?? ''} /> : <Packing />}
    </div></div>
  )
}

/* ------------------------------------------------------------------ equipment */
function Equipment({ userName, company }: { userName: string; company: string }) {
  const [sp, setSp] = useSearchParams()
  const [d, setD] = useState<StoreView | null>(null)
  const [cart, setCart] = useState<Line[]>([])
  const [addr, setAddr] = useState<Address>(() => blankAddress(userName, company))
  const [note, setNote] = useState('')
  const [tax, setTax] = useState<{ rate: number; shipping: boolean; rentals: boolean }>({ rate: 0, shipping: true, rentals: true })
  useEffect(() => { const st = addr.state.trim(); if (st.length !== 2) { setTax((t) => ({ ...t, rate: 0 })); return } api<{ rate: number; tax: { taxShipping: boolean; taxRentals: boolean } }>(`/supplies/tax-rate?state=${encodeURIComponent(st)}&country=${encodeURIComponent(addr.country)}`).then((r) => setTax({ rate: r.rate, shipping: r.tax.taxShipping, rentals: r.tax.taxRentals })).catch(() => {}) }, [addr.state, addr.country])
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [returning, setReturning] = useState<string | null>(null)
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const load = () => suppliesApi.store().then((r) => { setD(r); const last = r.orders.find((o) => o.status !== 'cancelled'); if (last?.shipTo?.line1) setAddr((a) => (a.line1 ? a : { ...blankAddress(), ...last.shipTo } as Address)) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  // Back from Stripe Checkout.
  useEffect(() => {
    const order = sp.get('order'), paid = sp.get('paid'); if (!order || !paid) return
    setSp({}, { replace: true })
    if (paid === 'cancel') { setToast('Checkout cancelled — nothing was charged. Your order is saved as awaiting payment.'); return }
    suppliesApi.verify(order).then((r) => { setToast(r.order.status === 'awaiting_payment' ? 'We’re confirming your payment — this updates shortly.' : `Thanks — order ${r.order.ref} is confirmed.`); return load() }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((d?.products ?? []).map((p) => [p.id, p])), [d])
  if (!d) return <p className="mt-8 text-sm text-text-muted">{error || 'Loading…'}</p>
  const add = (p: Product, mode: Mode) => setCart((c) => { const i = c.findIndex((x) => x.productId === p.id && x.mode === mode); if (mode === 'included') return i >= 0 ? c : [...c, { productId: p.id, qty: 1, mode }]; if (i >= 0) return c.map((x, k) => (k === i ? { ...x, qty: Math.min(50, x.qty + 1) } : x)); return [...c, { productId: p.id, qty: 1, mode }] })
  const setQty = (i: number, q: number) => setCart((c) => (q <= 0 ? c.filter((_, k) => k !== i) : c.map((x, k) => (k === i ? { ...x, qty: Math.min(50, q) } : x))))
  const sub = cart.filter((l) => l.mode === 'buy').reduce((a, l) => a + (byId.get(l.productId)?.priceUsd ?? 0) * l.qty, 0)
  const monthly = cart.filter((l) => l.mode === 'rent').reduce((a, l) => a + (byId.get(l.productId)?.rentUsd ?? 0) * l.qty, 0)
  const shipping = sub > 0 && sub < d.shipping.freeOverUsd ? d.shipping.flatUsd : 0
  const taxToday = Math.round((sub + (tax.shipping ? shipping : 0)) * tax.rate * 100) / 100
  const taxMonthly = tax.rentals ? Math.round(monthly * tax.rate * 100) / 100 : 0
  const today = sub + shipping + taxToday
  const included = d.products.filter((p) => p.includedNow)
  const shown = d.products.filter((p) => filter === 'all' || p.category === filter)
  const cats = [...new Set(d.products.map((p) => p.category))]
  const labelsCase = d.products.find((p) => p.category === 'labels' && p.labelsPerUnit >= 3000) ?? d.products.find((p) => p.category === 'labels')

  const checkout = async (e: React.FormEvent) => {
    e.preventDefault(); if (!cart.length) return
    setBusy('pay'); setError('')
    try {
      const r = await suppliesApi.checkout({ items: cart, shipTo: addr, note })
      if (r.url) { window.location.assign(r.url); return }
      setCart([]); setNote(''); await load()
      setToast(r.status === 'paid' ? `Order ${r.ref} confirmed — we’ll pack it and send tracking.` : `Order ${r.ref} placed. Ntemtem will email you an invoice, then ship it.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not place the order.') } finally { setBusy('') }
  }
  const activeRentals = d.rentals.filter((r) => ['pending', 'active', 'return_requested'].includes(r.status))

  return (
    <div className="mt-6" data-testid="equipment">
      <p className="max-w-3xl text-text-muted">Printers, scanners and labels that work with Ntemtem straight out of the box — they print our piece stickers and scan them at the warehouse, the container and the doorstep. Buy, rent by the month, or get a kit free with your plan.</p>
      {toast && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal" data-testid="supplies-toast"><Check size={14} aria-hidden="true" /> {toast}</p>}

      {d.labels.reorder && labelsCase && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/50 bg-gold-soft/60 p-4 text-ink" data-testid="labels-reminder">
          <p className="flex items-start gap-2 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />
            {d.labels.weeksLeft != null ? <span>You print about <b>{d.labels.perWeek} stickers a week</b> — roughly <b>{d.labels.weeksLeft} weeks</b> of labels left.</span> : <span>You printed <b>{d.labels.printed30} stickers</b> in the last 30 days. Order labels so you don’t run out on a loading day.</span>}
          </p>
          <button type="button" className="btn-gold !min-h-9 !px-4 text-sm" onClick={() => add(labelsCase, 'buy')}>Add {labelsCase.name.split('—')[1]?.trim() ?? 'labels'}</button>
        </div>
      )}

      {included.length > 0 && (
        <div className="mt-5 grid gap-3" data-testid="included-offer">
          {included.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-teal/40 bg-teal/10 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal text-white"><Gift size={20} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><p className="font-semibold">Included with your {planLabel(d.plan.plan)} plan: {p.name}</p><p className="text-sm text-text-muted">{p.specs.join(' · ')}. Free for as long as you stay on {planLabel(d.plan.plan)} — worth {usd(p.priceUsd)}.</p></div>
              <button type="button" disabled={!p.available || cart.some((l) => l.productId === p.id && l.mode === 'included')} onClick={() => add(p, 'included')} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60" data-testid="claim-included">{cart.some((l) => l.productId === p.id && l.mode === 'included') ? 'In your order' : 'Add — free'}</button>
            </div>
          ))}
        </div>
      )}
      {d.plan.trial && <p className="mt-3 text-xs text-text-muted">Kits are included on paid Pro and Enterprise plans — they unlock when your trial becomes a paid plan.</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            {(['all', ...cats] as const).map((c) => <button key={c} type="button" onClick={() => setFilter(c)} aria-pressed={filter === c} className={`min-h-9 rounded-full border px-3.5 text-sm focus-ring ${filter === c ? 'border-ink bg-ink text-bg' : 'border-border text-text-muted hover:text-text'}`}>{c === 'all' ? 'Everything' : categoryLabels[c]}</button>)}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="products">
            {shown.map((p) => { const Icon = categoryIcon[p.category]; const out = p.available <= 0; return (
              <article key={p.id} className="card-dark flex flex-col p-5" data-testid={`product-${p.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-gold-soft text-ink"><Icon size={22} aria-hidden="true" /></span>
                  {p.includedWith.length > 0 && <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">{p.includedClaimed ? 'On loan to you' : `Free with ${p.includedWith.map(planLabel).join(' / ')}`}</span>}
                </div>
                <h3 className="mt-3 !text-base">{p.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{p.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">{p.specs.map((s) => <li key={s} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />{s}</li>)}</ul>
                <p className={`mt-3 text-xs font-semibold ${out ? 'text-danger' : p.available <= 5 ? 'text-gold-deep' : 'text-teal'}`}>{out ? 'Out of stock' : p.available <= 5 ? `Only ${p.available} left` : 'In stock — ships in 1–2 days'}</p>
                <div className="mt-3 grid gap-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2"><span><b className="font-heading text-lg">{usd(p.priceUsd)}</b> <span className="text-xs text-text-muted">to buy</span></span><button type="button" disabled={out || !d.canOrder} onClick={() => add(p, 'buy')} className="btn-gold !min-h-9 !px-3.5 text-sm disabled:opacity-50" data-testid={`buy-${p.id}`}><ShoppingCart size={14} aria-hidden="true" /> Buy</button></div>
                  {p.rentUsd != null && <div className="flex items-center justify-between gap-2"><span><b className="font-heading text-lg">{usd(p.rentUsd)}</b><span className="text-xs text-text-muted"> / month to rent</span></span><button type="button" disabled={out || !d.canOrder} onClick={() => add(p, 'rent')} className="btn-ghost !min-h-9 !px-3.5 text-sm disabled:opacity-50" data-testid={`rent-${p.id}`}>Rent</button></div>}
                </div>
              </article>
            ) })}
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <form id="supplies-cart" onSubmit={checkout} className="card-dark scroll-mt-24 p-5" aria-label="Your order" data-testid="cart">
            <h2 className="flex items-center gap-2 !text-lg"><ShoppingCart size={18} aria-hidden="true" /> Your order</h2>
            {!cart.length ? <p className="mt-3 text-sm text-text-muted">Nothing yet. Choose Buy or Rent on an item.</p> : (
              <>
                <ul className="mt-3 divide-y divide-border text-sm">
                  {cart.map((l, i) => { const p = byId.get(l.productId); if (!p) return null; const unit = l.mode === 'buy' ? p.priceUsd : l.mode === 'rent' ? p.rentUsd ?? 0 : 0; return (
                    <li key={`${l.productId}-${l.mode}`} className="flex items-center gap-2 py-2.5" data-testid="cart-line">
                      <div className="min-w-0 flex-1"><p className="truncate font-semibold">{p.name}</p><p className="text-xs text-text-muted">{l.mode === 'buy' ? `Buy · ${usd(unit)} each` : l.mode === 'rent' ? `Rent · ${usd(unit)}/month each` : `Free with ${planLabel(d.plan.plan)}`}</p></div>
                      {l.mode !== 'included' ? (
                        <div className="flex items-center gap-1"><button type="button" aria-label={`One fewer ${p.name}`} onClick={() => setQty(i, l.qty - 1)} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Minus size={13} aria-hidden="true" /></button><span className="w-6 text-center tabular-nums">{l.qty}</span><button type="button" aria-label={`One more ${p.name}`} onClick={() => setQty(i, l.qty + 1)} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><Plus size={13} aria-hidden="true" /></button></div>
                      ) : <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setQty(i, 0)} className="grid h-8 w-8 place-items-center rounded-full border border-border focus-ring"><X size={13} aria-hidden="true" /></button>}
                    </li>
                  ) })}
                </ul>
                <dl className="mt-2 space-y-1 border-t border-border pt-3 text-sm">
                  {sub > 0 && <div className="flex justify-between"><dt className="text-text-muted">Equipment</dt><dd className="tabular-nums">{usd(sub)}</dd></div>}
                  {sub > 0 && <div className="flex justify-between"><dt className="text-text-muted">Shipping</dt><dd className="tabular-nums">{shipping ? usd(shipping) : 'Free'}</dd></div>}
                  {taxToday > 0 && <div className="flex justify-between"><dt className="text-text-muted">Sales tax ({addr.state.toUpperCase()} {Math.round(tax.rate * 10000) / 100}%)</dt><dd className="tabular-nums" data-testid="cart-tax">{usd(taxToday)}</dd></div>}
                  <div className="flex justify-between font-semibold"><dt>Due today</dt><dd className="tabular-nums" data-testid="cart-today">{usd(today)}</dd></div>
                  {monthly > 0 && <div className="flex justify-between font-semibold"><dt>Then every month</dt><dd className="tabular-nums" data-testid="cart-monthly">{usd(monthly + taxMonthly)}</dd></div>}
                </dl>
                {sub > 0 && shipping > 0 && <p className="mt-1 text-xs text-text-muted">Free shipping on equipment over {usd(d.shipping.freeOverUsd)}.</p>}
                {monthly > 0 && <p className="mt-1 text-xs text-text-muted">Rentals are billed monthly until you send them back. Repairs and swaps are on us.</p>}
                <fieldset className="mt-4 grid grid-cols-2 gap-2">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">Ship to</legend>
                  <input required aria-label="Name" placeholder="Name" className="input-dark col-span-2 !min-h-9 text-sm" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} />
                  <input required aria-label="Street address" placeholder="Street address" className="input-dark col-span-2 !min-h-9 text-sm" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
                  <input required aria-label="City" placeholder="City" className="input-dark !min-h-9 text-sm" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
                  <input aria-label="State" placeholder="State" className="input-dark !min-h-9 text-sm" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} />
                  <input aria-label="ZIP or postcode" placeholder="ZIP / postcode" className="input-dark !min-h-9 text-sm" value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
                  <select aria-label="Country" className="input-dark !min-h-9 text-sm" value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })}>{[['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['GH', 'Ghana'], ['NG', 'Nigeria'], ['DE', 'Germany'], ['NL', 'Netherlands'], ['IT', 'Italy']].map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
                  <input aria-label="Note" placeholder="Note (optional)" className="input-dark col-span-2 !min-h-9 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
                </fieldset>
                {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
                <button disabled={busy === 'pay' || !d.canOrder} className="btn-gold mt-4 w-full !min-h-11 disabled:opacity-60" data-testid="place-order"><CreditCard size={16} aria-hidden="true" /> {busy === 'pay' ? 'One moment…' : today === 0 && monthly === 0 ? 'Place order — free' : d.online ? `Pay ${usd(today)}${monthly ? ` + ${usd(monthly + taxMonthly)}/mo` : ''} securely` : 'Place order — we’ll invoice you'}</button>
                {d.mode === 'test' && (today > 0 || monthly > 0) && <p className="mt-2 text-center text-[11px] text-text-muted">Test mode — use card 4242 4242 4242 4242.</p>}
              </>
            )}
            {!d.canOrder && <p className="mt-3 text-xs text-text-muted">Only the account owner or finance can place equipment orders.</p>}
          </form>
        </aside>
      </div>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 p-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => document.getElementById('supplies-cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="btn-gold w-full !min-h-11"><ShoppingCart size={16} aria-hidden="true" /> View order · {cart.reduce((a, l) => a + l.qty, 0)} item{cart.reduce((a, l) => a + l.qty, 0) === 1 ? '' : 's'} · {usd(today)}{monthly ? ` + ${usd(monthly)}/mo` : ''}</button>
        </div>
      )}

      {activeRentals.length > 0 && (
        <section className="mt-12" data-testid="my-equipment">
          <h2 className="!text-xl">Your equipment on loan</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {activeRentals.map((r) => (
              <div key={r.id} className="card-dark flex flex-wrap items-center gap-3 p-4" data-testid="rental">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2"><PackageCheck size={18} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><p className="font-semibold">{r.qty > 1 ? `${r.qty} × ` : ''}{r.productName}</p><p className="text-xs text-text-muted">{r.mode === 'included' ? `Free with your plan` : `${usd(r.monthlyUsd)}/month`}{r.startedAt ? ` · since ${fmtDate(r.startedAt)}` : ''} · {rentalStatusLabels[r.status]}</p>{r.note && r.status === 'return_requested' && <p className="mt-1 text-xs text-gold-deep">{r.note}</p>}</div>
                {r.status === 'active' && d.canOrder && <button type="button" onClick={() => setReturning(r.id)} className="btn-ghost !min-h-9 !px-3 text-xs"><RotateCcw size={13} aria-hidden="true" /> Send back</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12" data-testid="orders">
        <h2 className="!text-xl">Your orders</h2>
        {!d.orders.length ? <p className="mt-2 text-sm text-text-muted">No equipment orders yet.</p> : (
          <ul className="mt-4 grid gap-3">
            {d.orders.map((o) => (
              <li key={o.id} className="card-dark p-4" data-testid="order">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-mono text-sm font-semibold">{o.ref}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone[o.status]}`}>{orderStatusLabels[o.status]}</span>
                  <span className="text-xs text-text-muted">{o.createdAt ? fmtDate(o.createdAt) : ''} · by {o.placedBy}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">{o.totalUsd ? usd(o.totalUsd) : 'Free'}{o.monthlyUsd ? <span className="font-normal text-text-muted"> + {usd(o.monthlyUsd)}/mo</span> : null}</span>
                </div>
                <p className="mt-1 text-sm text-text-muted">{o.items.map((i) => `${i.qty} × ${i.name}${i.mode === 'rent' ? ' (rent)' : i.mode === 'included' ? ' (with plan)' : ''}`).join(' · ')}</p>
                {o.status !== 'cancelled' && o.status !== 'awaiting_payment' && (
                  <ol className="mt-3 grid grid-cols-4 gap-1 text-[11px]" aria-label="Progress">{STEPS.map((s, k) => { const done = STEPS.indexOf(o.status) >= k; return <li key={s} className={`border-t-2 pt-1 ${done ? 'border-teal text-text' : 'border-border text-text-muted'}`}>{orderStatusLabels[s].split(' —')[0]}</li> })}</ol>
                )}
                {o.tracking && <p className="mt-2 inline-flex items-center gap-1.5 text-xs"><Truck size={13} aria-hidden="true" /> {o.carrier || 'Tracking'} <span className="font-mono">{o.tracking}</span></p>}
                {o.status === 'awaiting_payment' && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">{o.provider === 'manual' ? 'Ntemtem will email an invoice; we ship once it’s paid.' : 'Payment not finished.'}{d.canOrder && <button type="button" className="font-semibold text-danger hover:underline" onClick={async () => { await suppliesApi.cancel(o.id).catch((e) => setError(e.message)); await load() }}>Cancel order</button>}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {returning && <Confirm title="Send this equipment back?" body="We’ll email you a prepaid return label. Monthly rental billing stops when it arrives back with us." confirmLabel="Request return" busy={busy === 'ret'} onClose={() => setReturning(null)} onConfirm={async () => { setBusy('ret'); try { await suppliesApi.returnRental(returning); setToast('Return requested — look out for the label in your email.'); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not request the return.') } finally { setBusy(''); setReturning(null) } }} />}
    </div>
  )
}

/* ------------------------------------------------------------------ packing supplies */
const blankPacking = (): PackingInput => ({ name: '', kind: 'barrel', note: '', priceUsd: 0, active: true })
function Packing() {
  const [d, setD] = useState<Awaited<ReturnType<typeof suppliesApi.myPacking>> | null>(null)
  const [edit, setEdit] = useState<(PackingInput & { id?: string }) | null>(null)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [del, setDel] = useState<PackingItem | null>(null)
  const load = () => suppliesApi.myPacking().then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  if (!d) return <p className="mt-8 text-sm text-text-muted">{error || 'Loading…'}</p>
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (!edit) return; setBusy(true); setError(''); try { const { id, ...b } = edit; if (id) await suppliesApi.savePacking(id, b); else await suppliesApi.addPacking(b); setEdit(null); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') } finally { setBusy(false) } }
  return (
    <div className="mt-6" data-testid="packing">
      <p className="max-w-3xl text-text-muted">Barrels, boxes, locks and tape you sell to your own customers. They show on your profile, and senders add them to a booked shipment. You bring them before the pickup, and they’re paid together with the freight — protected by Ntemtem, like the rest of the shipment.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Items on your list" value={d.supplies.filter((s) => s.active).length} icon={Package} />
        <StatCard label="Sold, last 90 days" value={usd(d.sold90.valueUsd)} hint={`${d.sold90.units} units`} icon={ShoppingCart} />
        <StatCard label="To bring before pickup" value={d.toDeliver.length} icon={Truck} warn={d.toDeliver.some((x) => x.status === 'paid')} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card-dark min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4"><h2 className="!text-base">Your price list</h2>{d.canEdit && <button type="button" onClick={() => setEdit(blankPacking())} className="btn-gold !min-h-9 !px-3 text-sm" data-testid="packing-add"><Plus size={14} aria-hidden="true" /> Add item</button>}</div>
          {!d.supplies.length ? <p className="p-6 text-sm text-text-muted">No items yet. Add the barrels and boxes you sell, with your price.</p> : (
            <ul className="divide-y divide-border">
              {d.supplies.map((s) => (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 p-4 ${s.active ? '' : 'opacity-60'}`} data-testid="packing-row">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{s.name}{!s.active && <span className="ml-2 text-xs font-normal text-text-muted">hidden</span>}</p><p className="text-xs text-text-muted">{packingKindLabels[s.kind]}{s.note ? ` · ${s.note}` : ''}</p></div>
                  <span className="font-heading text-lg tabular-nums">{usd(s.priceUsd)}</span>
                  {d.canEdit && <span className="flex gap-1"><button type="button" aria-label={`Edit ${s.name}`} onClick={() => setEdit({ ...s })} className="grid h-9 w-9 place-items-center rounded-full border border-border focus-ring"><Pencil size={14} aria-hidden="true" /></button><button type="button" aria-label={`Delete ${s.name}`} onClick={() => setDel(s)} className="grid h-9 w-9 place-items-center rounded-full border border-border text-danger focus-ring"><Trash2 size={14} aria-hidden="true" /></button></span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card-dark p-4" data-testid="to-deliver">
          <h2 className="!text-base">To bring before pickup</h2>
          {!d.toDeliver.length ? <p className="mt-2 text-sm text-text-muted">Nothing ordered on upcoming pickups.</p> : (
            <ul className="mt-2 divide-y divide-border text-sm">{d.toDeliver.map((x) => <li key={x.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><b>{x.qty} × {x.name}</b><span className="block text-xs text-text-muted">{x.ref} · {x.customer}</span></span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${x.status === 'paid' ? 'bg-teal/15 text-teal' : 'bg-surface-2 text-text-muted'}`}>{x.status === 'paid' ? 'Paid' : 'Not paid yet'}</span></li>)}</ul>
          )}
        </div>
      </div>
      {edit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEdit(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pk-h" className="card-dark grid w-full max-w-md gap-3 p-6" data-testid="packing-form">
            <h2 id="pk-h" className="!text-lg">{edit.id ? 'Edit item' : 'Add an item'}</h2>
            <label className="text-xs text-text-muted">Name<input required minLength={2} className="input-dark mt-1 !min-h-10 text-sm" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Blue drum barrel (55 gal)" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-muted">Type<select className="input-dark mt-1 !min-h-10 text-sm" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as PackingKind })}>{Object.entries(packingKindLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="text-xs text-text-muted">Price (USD)<input required type="number" min={0.5} step="0.5" className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={edit.priceUsd || ''} onChange={(e) => setEdit({ ...edit, priceUsd: Number(e.target.value) || 0 })} /></label>
            </div>
            <label className="text-xs text-text-muted">Short note<input className="input-dark mt-1 !min-h-10 text-sm" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Food-safe, with lid" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Show to senders</label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEdit(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        </div>
      )}
      {del && <Confirm title={`Delete ${del.name}?`} body="Senders won’t see it any more. Orders already placed keep their price." confirmLabel="Delete" busy={busy} onClose={() => setDel(null)} onConfirm={async () => { setBusy(true); await suppliesApi.deletePacking(del.id).catch(() => {}); setBusy(false); setDel(null); await load() }} />}
    </div>
  )
}
