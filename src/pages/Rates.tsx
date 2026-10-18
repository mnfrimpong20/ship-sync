import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Calculator, Check, Copy, Ellipsis, Pencil, Plus, Tag, Trash2, Zap } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps } from '../lib/ops'
import { blankRate, ratesApi, unitLabel, type PreviewInput, type RateCard, type RateInput, type RatePreview } from '../lib/rates'
import { cargoLabel, cargoTypes, countries, countryByCode, type CargoType, type Mode } from '../lib/data'
import { Empty, ModeBadge, Pill, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Expander, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

const PAGE = 12
type Filter = 'all' | 'auto' | 'manual' | 'paused'

function RateForm({ initial, origins, onSave, onCancel, busy, error }: { initial: RateInput; origins: string[]; onSave: (v: RateInput) => void; onCancel: () => void; busy: boolean; error: string }) {
  const [f, setF] = useState<RateInput>(initial)
  const num = (k: keyof RateInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value === '' ? 0 : Number(e.target.value) })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f) }} className="grid gap-3 md:grid-cols-3" aria-label="Rate card">
      {error && <p role="alert" className="md:col-span-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div><label htmlFor="r-origin" className="label-dark">Origin</label><input id="r-origin" list="r-origins" className="input-dark" placeholder="Any origin" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /><datalist id="r-origins">{origins.map((o) => <option key={o} value={o} />)}</datalist><p className="mt-1 text-[11px] text-text-muted">Leave blank to cover every pickup area you serve.</p></div>
      <div><label htmlFor="r-dest" className="label-dark">Destination</label><select id="r-dest" className="input-dark" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
      <div><label htmlFor="r-mode" className="label-dark">Mode</label><select id="r-mode" className="input-dark" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as Mode })}><option value="ocean">Ocean</option><option value="air">Air</option></select></div>
      <div><label htmlFor="r-cargo" className="label-dark">Cargo type</label><select id="r-cargo" className="input-dark" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value as CargoType })}>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      <div><label htmlFor="r-price" className="label-dark">Price (USD, {unitLabel(f.cargo, f.unit)})</label><input id="r-price" type="number" min={1} required className="input-dark tabular-nums" value={f.price || ''} onChange={num('price')} /></div>
      <div><label htmlFor="r-unit" className="label-dark">Priced by</label><select id="r-unit" className="input-dark" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as 'unit' | 'kg' })}><option value="unit">Each piece / unit</option><option value="kg">Weight (per kg)</option></select></div>
      <div><label htmlFor="r-min" className="label-dark">Minimum charge</label><input id="r-min" type="number" min={0} className="input-dark tabular-nums" value={f.minCharge || ''} placeholder="0" onChange={num('minCharge')} /></div>
      <div><label htmlFor="r-transit" className="label-dark">Transit (days)</label><input id="r-transit" type="number" min={1} required className="input-dark tabular-nums" value={f.transitDays || ''} onChange={num('transitDays')} /></div>
      <div><label htmlFor="r-valid" className="label-dark">Quote valid for (days)</label><input id="r-valid" type="number" min={1} max={90} className="input-dark tabular-nums" value={f.validDays || ''} onChange={num('validDays')} /></div>
      <div><label htmlFor="r-pickup" className="label-dark">Pickup fee</label><input id="r-pickup" type="number" min={0} className="input-dark tabular-nums" value={f.pickupFee || ''} placeholder="0" onChange={num('pickupFee')} /></div>
      <div><label htmlFor="r-delivery" className="label-dark">Door delivery fee</label><input id="r-delivery" type="number" min={0} className="input-dark tabular-nums" value={f.deliveryFee || ''} placeholder="0" onChange={num('deliveryFee')} /></div>
      <div><label htmlFor="r-ins" className="label-dark">Insurance fee</label><input id="r-ins" type="number" min={0} className="input-dark tabular-nums" value={f.insuranceFee || ''} placeholder="0" onChange={num('insuranceFee')} /></div>
      <div className="md:col-span-3"><label htmlFor="r-notes" className="label-dark">Notes shown on the quote</label><textarea id="r-notes" rows={2} className="input-dark py-2" placeholder="Sailing schedule, what’s included, duty handling…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div className="md:col-span-3 grid gap-2 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/40 p-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" checked={f.autoSend} onChange={(e) => setF({ ...f, autoSend: e.target.checked })} /><span><span className="block font-medium">Send instantly</span><span className="block text-xs text-text-muted">A matching request gets this quote the moment it’s posted. Otherwise it’s suggested to you on the lead.</span></span></label>
        <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-2/40 p-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span><span className="block font-medium">Active</span><span className="block text-xs text-text-muted">Paused cards are kept but never used.</span></span></label>
      </div>
      <div className="md:col-span-3 flex justify-end gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={15} aria-hidden="true" /> {busy ? 'Saving…' : 'Save rate card'}</button></div>
    </form>
  )
}

function Preview({ origins }: { origins: string[] }) {
  const [f, setF] = useState<PreviewInput>({ origin: origins[0] ?? 'Houston, TX', destination: 'GH', mode: 'either', cargo: 'barrels', quantity: 3, pickup: true, delivery: true, insurance: false })
  const [res, setRes] = useState<{ quote: RatePreview | null; card: RateCard | null } | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let live = true; setLoading(true)
    const t = setTimeout(() => ratesApi.preview(f).then((r) => live && setRes(r)).catch(() => live && setRes(null)).finally(() => live && setLoading(false)), 200)
    return () => { live = false; clearTimeout(t) }
  }, [f])
  const q = res?.quote
  return (
    <div className="card-dark p-5" data-testid="rate-preview">
      <h2 className="flex items-center gap-2 !text-base"><Calculator size={16} className="text-gold-deep" aria-hidden="true" /> Try a quote</h2>
      <p className="mt-1 text-xs text-text-muted">What a customer would get from your cards right now.</p>
      <div className="mt-3 grid gap-2">
        <input list="pv-origins" aria-label="Origin" className="input-dark !min-h-9 text-sm" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /><datalist id="pv-origins">{origins.map((o) => <option key={o} value={o} />)}</datalist>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Destination" className="input-dark !min-h-9 text-sm" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
          <select aria-label="Mode" className="input-dark !min-h-9 text-sm" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PreviewInput['mode'] })}><option value="either">Either mode</option><option value="ocean">Ocean</option><option value="air">Air</option></select>
          <select aria-label="Cargo" className="input-dark !min-h-9 text-sm" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value as CargoType })}>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <input type="number" min={1} aria-label="Quantity" className="input-dark !min-h-9 text-sm tabular-nums" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {(['pickup', 'delivery', 'insurance'] as const).map((k) => <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" className="h-3.5 w-3.5 accent-[var(--color-gold)]" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {k === 'pickup' ? 'Pickup' : k === 'delivery' ? 'Door delivery' : 'Insurance'}</label>)}
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface-2/40 p-3">
        {loading && !res ? <p className="text-sm text-text-muted">Calculating…</p> : q ? (
          <>
            <div className="flex items-baseline justify-between"><p className="font-heading text-2xl font-bold tabular-nums">{money(q.price)}</p><Pill tone={q.autoSend ? 'gold' : 'teal'}>{q.autoSend ? 'Sent instantly' : 'Suggested to you'}</Pill></div>
            <p className="mt-1 text-xs text-text-muted">{q.transitDays} days · {q.mode === 'air' ? 'air' : 'ocean'}{res?.card ? ` · card: ${res.card.origin || 'Any origin'} → ${countryByCode(res.card.destination)?.name}` : ''}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className="text-text-muted">Freight{q.breakdown.minApplied ? ' (minimum)' : ''}</dt><dd className="text-right">{money(q.breakdown.base)}</dd>
              {q.breakdown.pickup > 0 && <><dt className="text-text-muted">Pickup</dt><dd className="text-right">{money(q.breakdown.pickup)}</dd></>}
              {q.breakdown.delivery > 0 && <><dt className="text-text-muted">Door delivery</dt><dd className="text-right">{money(q.breakdown.delivery)}</dd></>}
              {q.breakdown.insurance > 0 && <><dt className="text-text-muted">Insurance</dt><dd className="text-right">{money(q.breakdown.insurance)}</dd></>}
            </dl>
          </>
        ) : <p className="text-sm text-text-muted">No card covers this lane yet — the request would reach you as a normal lead.</p>}
      </div>
    </div>
  )
}

export default function Rates() {
  const { ready, user, shipperById } = useStore()
  const [rates, setRates] = useState<RateCard[] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [dest, setDest] = useState('')
  const [cargo, setCargo] = useState<CargoType | ''>('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<RateInput>(blankRate)
  const [menu, setMenu] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RateCard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  useEffect(() => { const h = () => setMenu(null); document.addEventListener('click', h); return () => document.removeEventListener('click', h) }, [])
  useEffect(() => {
    if (!ready || !user || user.role !== 'shipper') return
    let live = true
    ratesApi.list().then((r) => { if (live) { setRates(r.rates); setCanEdit(r.canEdit) } }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load rate cards.'))
    return () => { live = false }
  }, [ready, user])

  const all = rates ?? []
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return all.filter((r) => (filter === 'all' ? r.active : filter === 'paused' ? !r.active : r.active && (filter === 'auto' ? r.autoSend : !r.autoSend)) && (!dest || r.destination === dest) && (!cargo || r.cargo === cargo) && (!ql || [r.origin || 'any origin', countryByCode(r.destination)?.name ?? '', r.mode, cargoLabel(r.cargo), r.notes].join(' ').toLowerCase().includes(ql)))
  }, [all, filter, dest, cargo, q])
  const p = usePaged(list, PAGE, `${filter}|${dest}|${cargo}|${q}`)

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/rates" replace />
  if (user.role !== 'shipper' || user.staffRole === 'driver') return <Navigate to="/dashboard" replace />

  const me = user.shipperId ? shipperById(user.shipperId) : undefined
  const origins = me?.origins ?? []
  const manage = canEdit && canManageOps(user.staffRole)
  const active = all.filter((r) => r.active)
  const save = async (v: RateInput) => {
    setBusy(true); setError('')
    try {
      if (editing === 'new') { const c = await ratesApi.add(v); setRates((x) => [...(x ?? []), c]); setToast('Rate card added.') }
      else if (editing) { const c = await ratesApi.update(editing, v); setRates((x) => (x ?? []).map((y) => (y.id === editing ? c : y))); setToast('Rate card saved.') }
      setEditing(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const patch = async (r: RateCard, body: Partial<RateInput>, msg: string) => {
    setBusy(true); setError('')
    try { const c = await ratesApi.update(r.id, body); setRates((x) => (x ?? []).map((y) => (y.id === r.id ? c : y))); setToast(msg) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy(false) }
  }
  const remove = async (r: RateCard) => {
    setBusy(true); setError('')
    try { await ratesApi.remove(r.id); setRates((x) => (x ?? []).filter((y) => y.id !== r.id)); setToast('Rate card deleted.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.') } finally { setBusy(false); setDeleting(null) }
  }
  const toInput = (r: RateCard): RateInput => ({ origin: r.origin, destination: r.destination, mode: r.mode, cargo: r.cargo, price: r.price, unit: r.unit, minCharge: r.minCharge, pickupFee: r.pickupFee, deliveryFee: r.deliveryFee, insuranceFee: r.insuranceFee, transitDays: r.transitDays, validDays: r.validDays, notes: r.notes, autoSend: r.autoSend, active: r.active })
  const startNew = (from?: RateCard) => { setDraft(from ? { ...toInput(from), origin: from.origin ? '' : origins[0] ?? '' } : { ...blankRate, origin: '' }); setEditing('new'); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const extras = (r: RateCard) => [r.pickupFee ? `pickup ${money(r.pickupFee)}` : '', r.deliveryFee ? `door ${money(r.deliveryFee)}` : '', r.insuranceFee ? `insurance ${money(r.insuranceFee)}` : ''].filter(Boolean).join(' · ')

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Rate cards</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{active.length} published lane{active.length === 1 ? '' : 's'}</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Publish your prices per lane and cargo type. Cards set to send instantly quote a matching request the moment it’s posted — before anyone else replies; the rest give you a one-click suggested price on each lead.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><button onClick={() => startNew()} className="btn-gold"><Plus size={16} aria-hidden="true" /> Add rate card</button></motion.div>}
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}</AnimatePresence>

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Instant quotes" value={active.filter((r) => r.autoSend).length} hint="Sent the moment a request lands" icon={Zap} active={filter === 'auto'} onClick={() => setFilter(filter === 'auto' ? 'all' : 'auto')} />
            <StatCard label="Suggested only" value={active.filter((r) => !r.autoSend).length} hint="You confirm before it goes out" icon={Tag} active={filter === 'manual'} onClick={() => setFilter(filter === 'manual' ? 'all' : 'manual')} />
            <StatCard label="Destinations" value={new Set(active.map((r) => r.destination)).size} hint={Array.from(new Set(active.map((r) => countryByCode(r.destination)?.name ?? r.destination))).join(', ') || 'None yet'} icon={Tag} />
            <StatCard label="Paused" value={all.filter((r) => !r.active).length} hint="Kept but not used" icon={Tag} warn={all.some((r) => !r.active)} active={filter === 'paused'} onClick={() => setFilter(filter === 'paused' ? 'all' : 'paused')} />
          </motion.div>

          <AnimatePresence>
            {editing === 'new' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-6">
                <h2 className="mb-4 !text-lg">New rate card</h2>
                <RateForm initial={draft} origins={origins} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} />
              </motion.div>
            )}
          </AnimatePresence>
          {!editing && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
                <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={active.length}>Active</Chip>
                <Chip active={filter === 'paused'} onClick={() => setFilter('paused')} count={all.length - active.length}>Paused</Chip>
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
                <SearchBox value={q} onChange={setQ} label="Search rate cards" placeholder="Search lane, cargo, notes…" />
                <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => setDest(e.target.value)}><option value="">All destinations</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                <select aria-label="Cargo" className="input-dark !min-h-10 !w-auto text-sm" value={cargo} onChange={(e) => setCargo(e.target.value as CargoType | '')}><option value="">All cargo</option>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              </motion.div>

              <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead><tr className={thead}><Th className="w-8" /><Th>Lane</Th><Th>Cargo</Th><Th className="text-right">Price</Th><Th>Extras</Th><Th className="text-right">Transit</Th><Th>Quoting</Th>{manage && <Th className="text-right">Actions</Th>}</tr></thead>
                    <tbody>
                      {rates === null && !error && <tr><td colSpan={8} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>}
                      {rates && p.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10"><Empty title={all.length ? 'No rate cards match' : 'No rate cards yet'} body={all.length ? 'Try another filter.' : 'Publish a price per lane and cargo type and the platform quotes for you.'} action={manage && !all.length ? <button onClick={() => startNew()} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Add rate card</button> : undefined} /></td></tr>}
                      {p.rows.map((r) => {
                        const isOpen = open === r.id || editing === r.id
                        const c = countryByCode(r.destination)
                        return (
                          <Fragment key={r.id}>
                            <tr className={trow(isOpen, !r.active)} data-testid="rate-row">
                              <td className="px-3 py-3"><Expander open={isOpen} onClick={() => { setOpen(isOpen ? null : r.id); if (editing === r.id) setEditing(null) }} label={`details for ${r.origin || 'any origin'} to ${c?.name}`} /></td>
                              <td className="px-3 py-3"><p className="font-semibold">{r.origin || <span className="text-text-muted">Any origin</span>} → {c?.flag} {c?.name ?? r.destination}</p><div className="mt-1"><ModeBadge mode={r.mode} /></div></td>
                              <td className="px-3 py-3">{cargoLabel(r.cargo)}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums"><p className="font-semibold">{money(r.price)}</p><p className="text-[11px] text-text-muted">{unitLabel(r.cargo, r.unit)}{r.minCharge > r.price ? ` · min ${money(r.minCharge)}` : ''}</p></td>
                              <td className="px-3 py-3 text-xs text-text-muted">{extras(r) || '—'}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{r.transitDays} d</td>
                              <td className="whitespace-nowrap px-3 py-3">{!r.active ? <Pill tone="muted">Paused</Pill> : r.autoSend ? <Pill tone="gold">Instant</Pill> : <Pill tone="teal">Suggested</Pill>}</td>
                              {manage && (
                                <td className="px-3 py-3 text-right">
                                  <div className="relative inline-flex items-center gap-1.5">
                                    <button onClick={() => { setEditing(editing === r.id ? null : r.id); setOpen(r.id); setError('') }} className="btn-ghost !min-h-8 !px-2.5 text-xs"><Pencil size={12} aria-hidden="true" /> Edit</button>
                                    <button onClick={(e) => { e.stopPropagation(); setMenu(menu === r.id ? null : r.id) }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-haspopup="menu" aria-expanded={menu === r.id} aria-label="More actions"><Ellipsis size={14} /></button>
                                    {menu === r.id && (
                                      <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-9 z-20 w-60 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left text-sm shadow-xl">
                                        {r.active && <button role="menuitem" onClick={() => { setMenu(null); patch(r, { autoSend: !r.autoSend }, r.autoSend ? 'Now suggested on leads instead of sent instantly.' : 'Now sent instantly to matching requests.') }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Zap size={14} aria-hidden="true" /> {r.autoSend ? 'Switch to suggested only' : 'Send instantly'}</button>}
                                        <button role="menuitem" onClick={() => { setMenu(null); patch(r, { active: !r.active }, r.active ? 'Rate card paused.' : 'Rate card active again.') }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Check size={14} aria-hidden="true" /> {r.active ? 'Pause' : 'Reactivate'}</button>
                                        <button role="menuitem" onClick={() => { setMenu(null); startNew(r) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><Copy size={14} aria-hidden="true" /> Duplicate for another origin</button>
                                        <div className="my-1 border-t border-border" />
                                        <button role="menuitem" onClick={() => { setMenu(null); setDeleting(r) }} className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10"><Trash2 size={14} aria-hidden="true" /> Delete…</button>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                            {isOpen && (
                              <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={7} className="px-3 pb-5 pt-2">
                                {editing === r.id ? (
                                  <div className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 !text-base">Edit rate card</h2><RateForm initial={toInput(r)} origins={origins} onSave={save} onCancel={() => setEditing(null)} busy={busy} error={error} /></div>
                                ) : (
                                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                                    <div className="rounded-xl border border-border bg-surface p-4 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Notes on the quote</p><p className="text-text-muted">{r.notes || 'No notes — sailing schedule, inclusions and duty handling go here.'}</p></div>
                                    <div className="rounded-xl border border-border bg-surface p-4 text-xs"><p className="mb-2 font-semibold uppercase tracking-wider text-text-muted">How it prices</p><dl className="grid grid-cols-2 gap-2 tabular-nums"><div><dt className="text-text-muted">Freight</dt><dd>{money(r.price)} {unitLabel(r.cargo, r.unit)}</dd></div><div><dt className="text-text-muted">Minimum</dt><dd>{r.minCharge ? money(r.minCharge) : '—'}</dd></div><div><dt className="text-text-muted">Pickup</dt><dd>{r.pickupFee ? money(r.pickupFee) : 'Not offered / free'}</dd></div><div><dt className="text-text-muted">Door delivery</dt><dd>{r.deliveryFee ? money(r.deliveryFee) : 'Not offered / free'}</dd></div><div><dt className="text-text-muted">Insurance</dt><dd>{r.insuranceFee ? money(r.insuranceFee) : '—'}</dd></div><div><dt className="text-text-muted">Quote valid</dt><dd>{r.validDays} days</dd></div></dl></div>
                                  </div>
                                )}
                              </td></tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager p={p} noun="rate card" />
              </motion.div>
            </div>
            <motion.aside variants={fadeUp}><Preview origins={origins} /></motion.aside>
          </div>
        </motion.div>
      </div>
      {deleting && <Confirm title="Delete this rate card?" body={<p>{deleting.origin || 'Any origin'} → {countryByCode(deleting.destination)?.name} · {cargoLabel(deleting.cargo)}. Quotes already sent from it are unaffected. If you might use it again, pause it instead.</p>} confirmLabel="Delete rate card" busy={busy} onClose={() => setDeleting(null)} onConfirm={() => remove(deleting)} />}
    </div>
  )
}
