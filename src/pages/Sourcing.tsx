import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, Camera, Check, CreditCard, Factory, FileText, Globe2, Handshake, MessageSquare, PackageCheck, Paperclip, Search, Ship, ShieldCheck, Trash2, UserCheck } from 'lucide-react'
import { sourcingApi, stepLabels, tierLabels, STEPS, FIND_STEPS, SOURCING_SHIPPER, cny, usd2, type Detail, type Job, type Quote, type QuoteInput, type RequestInput, type SFile, type Supplier, type SupplierInput, type StepInput, type Tier, type Settings } from '../lib/sourcing'
import { countries } from '../lib/data'
import { useStore } from '../lib/store'
import { Empty, Pill, fmtDate, fmtDateTime, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, SearchBox, StatCard } from '../components/board'
import { NOTIFY_EVENT } from '../lib/notifications'

const err = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)
const stageLabel: Record<'fee' | 'deposit' | 'balance', string> = { fee: 'Sourcing fee', deposit: 'Deposit', balance: 'Balance' }
const tone = (s: Job['status']) => (s === 'closed' || s === 'delivered' ? 'green' : s === 'cancelled' ? 'danger' : ['quoted', 'inspected'].includes(s) ? 'gold' : 'sky') as 'green' | 'danger' | 'gold' | 'sky'
const stepsFor = (tier: Tier) => (tier === 'find' ? FIND_STEPS : STEPS)
export const isSourcingTeam = (u: { admin?: boolean; role: string; shipperId?: string; staffRole?: string } | null) => !!u && (!!u.admin || (u.role === 'shipper' && u.shipperId === SOURCING_SHIPPER && u.staffRole !== 'driver'))

/* ================= public landing ================= */
export default function SourcingPage() {
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof sourcingApi.config>> | null>(null)
  useEffect(() => { sourcingApi.config().then(setCfg).catch(() => {}) }, [])
  const icons: Record<Tier, typeof Search> = { find: Search, order: PackageCheck, door: Handshake }
  const p = cfg?.pricing
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-3xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Ship Sync Sourcing · China</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.5vw,3.4rem)]">Source it in China. We buy it, check it, and ship it to you.</motion.h1>
          <motion.p variants={fadeUp} className="mt-3 text-text-muted">Tell us what you want — a product description, a photo or a 1688 / Alibaba link. Our own team in Guangzhou, Shenzhen and Yiwu finds vetted factories, negotiates, places the order in Ship Sync's name, inspects every batch, and hands it to the ocean or air leg. One timeline, one price, your money in escrow.</motion.p>
          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/sourcing/new" className="btn-gold" data-testid="sourcing-cta">Start a sourcing request</Link><a href="#how" className="btn-ghost">How it works</a></motion.div>
          {cfg && <motion.p variants={fadeUp} className="mt-4 text-xs text-text-muted">{cfg.stats.agents} agent{cfg.stats.agents === 1 ? '' : 's'} on the ground · {cfg.stats.verifiedSuppliers} verified factories · {cfg.stats.completed} orders shipped</motion.p>}
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3" data-testid="tiers">
          {cfg?.tiers.map((t) => { const I = icons[t.id]; return (
            <motion.div key={t.id} variants={fadeUp} className="card-dark flex flex-col p-5"><I size={22} className="text-gold" aria-hidden="true" /><h3 className="mt-3 !text-lg">{t.label}</h3><p className="mt-1 flex-1 text-sm text-text-muted">{t.blurb}</p>
              <p className="mt-3 text-sm font-semibold tabular-nums">{t.id === 'find' ? `Flat ${money(p!.findFeeUsd)}` : `${Math.round(p!.servicePct * 100)}% of the factory price (min ${money(p!.minFeeUsd)})`}</p>
              <Link to={`/sourcing/new?tier=${t.id}`} className="btn-ghost mt-3 !min-h-9 text-sm">Choose</Link></motion.div>) })}
        </motion.div>
        <section id="how" className="mx-auto mt-16 max-w-5xl">
          <p className="eyebrow mb-2 text-center">How it works</p>
          <ol className="grid gap-4 md:grid-cols-4">
            {[[Search, 'Tell us what you need', 'Describe the product, quantity, target price and where it’s going. Paste supplier links if you have them.'], [Factory, 'We find & price it', 'Your agent shortlists factories and returns a landed-cost quote: factory price, our fee, inspection, freight, insurance and duty.'], [ShieldCheck, 'Pay in stages, in escrow', `Accept a quote and pay the deposit (fee + inspection + ${p ? Math.round(p.depositPct * 100) : 30}% of the goods). The balance is only due after you approve the inspection photos.`], [Ship, 'We ship it', 'Goods are received at our China warehouse, exported and tracked like any Ship Sync shipment — all the way to your door if you choose.']].map(([I, t, b], i) => { const Icon = I as typeof Search; return <li key={i} className="card-dark p-5"><span className="grid h-8 w-8 place-items-center rounded-full bg-gold/15 text-gold"><Icon size={16} aria-hidden="true" /></span><p className="mt-3 font-semibold">{i + 1}. {t as string}</p><p className="mt-1 text-sm text-text-muted">{b as string}</p></li> })}
          </ol>
        </section>
        {p && <section className="mx-auto mt-12 max-w-3xl card-dark p-6 text-sm" data-testid="pricing"><p className="eyebrow mb-2">Transparent pricing</p>
          <ul className="grid gap-2 sm:grid-cols-2"><li><span className="text-text-muted">Sourcing & buying fee</span><br /><strong>{Math.round(p.servicePct * 100)}% of factory price</strong>, min {money(p.minFeeUsd)}</li><li><span className="text-text-muted">Supplier search only</span><br /><strong>{money(p.findFeeUsd)}</strong> flat per request</li><li><span className="text-text-muted">Quality inspection</span><br /><strong>{money(p.inspectionUsd)}</strong> per order, photos included</li><li><span className="text-text-muted">China warehouse & export</span><br /><strong>{money(p.handlingUsd)}</strong> per order</li></ul>
          <p className="mt-4 text-xs text-text-muted">Freight, insurance and duty are quoted per order at the same rates as the rest of Ship Sync. Factory prices are converted at ¥{p.cnyPerUsd} per US dollar. {p.note}</p></section>}
      </div>
    </div>
  )
}

/* ================= new request ================= */
export function SourcingNew() {
  const { user, ready } = useStore(); const [sp] = useSearchParams(); const nav = useNavigate()
  const [f, setF] = useState<RequestInput>({ tier: (['find', 'order', 'door'].includes(sp.get('tier') ?? '') ? sp.get('tier') : 'order') as Tier, title: '', description: '', links: [], quantity: 100, unit: 'pcs', targetPriceUsd: null, destination: 'GH', destinationCity: '', mode: 'either', deadline: null, contactName: '', contactEmail: '', contactPhone: '', company: '' })
  const [link, setLink] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (user) setF((x) => ({ ...x, contactName: x.contactName || user.name, contactEmail: x.contactEmail || user.email })) }, [user])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/sourcing/new${sp.toString() ? `?${sp}` : ''}`)}`} replace />
  if (user.role !== 'customer') return <div className="container-x py-24 text-center text-text-muted">Sourcing requests are filed from a customer account.</div>
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const d = await sourcingApi.create({ ...f, links: link.trim() ? [...f.links, link.trim()] : f.links }); nav(`/sourcing/${d.job.id}`) } catch (er) { setError(err(er, 'Could not send the request.')) } finally { setBusy(false) } }
  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF({ ...f, [k]: v })
  return (
    <div className="bg-bg text-text"><div className="container-x max-w-3xl py-10 md:py-14">
      <p className="eyebrow mb-2">Ship Sync Sourcing</p><h1 className="!text-3xl">What should we source for you?</h1>
      <form onSubmit={submit} className="mt-6 grid gap-5" data-testid="sourcing-form">
        <fieldset className="grid gap-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-semibold">Service</legend>{(['find', 'order', 'door'] as Tier[]).map((t) => <label key={t} className={`cursor-pointer rounded-xl border p-3 text-sm ${f.tier === t ? 'border-gold bg-gold/10' : 'border-border'}`}><input type="radio" name="tier" className="mr-2" checked={f.tier === t} onChange={() => set('tier', t)} />{tierLabels[t]}</label>)}</fieldset>
        <label className="grid gap-1 text-sm"><span className="font-semibold">Product</span><input required minLength={3} className="input-dark" placeholder="e.g. Solar lanterns with USB charging" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="src-title" /></label>
        <label className="grid gap-1 text-sm"><span className="font-semibold">Details</span><textarea required minLength={10} rows={4} className="input-dark" placeholder="Specs, materials, colours, packaging, certifications, branding… anything the factory needs to quote accurately." value={f.description} onChange={(e) => set('description', e.target.value)} data-testid="src-desc" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Quantity</span><input type="number" min={1} required className="input-dark" value={f.quantity} onChange={(e) => set('quantity', Number(e.target.value))} /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Unit</span><input className="input-dark" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs, sets, cartons" /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Target price (USD / unit)</span><input type="number" min={0} step="0.01" className="input-dark" value={f.targetPriceUsd ?? ''} onChange={(e) => set('targetPriceUsd', e.target.value ? Number(e.target.value) : null)} placeholder="optional" /></label>
        </div>
        <div className="grid gap-2 text-sm"><span className="font-semibold">Reference links (1688, Alibaba, Taobao, a brand's site)</span>
          {f.links.map((l, i) => <div key={i} className="flex items-center gap-2 text-xs"><Paperclip size={12} aria-hidden="true" /><a href={l} target="_blank" rel="noreferrer" className="truncate text-gold hover:underline">{l}</a><button type="button" className="text-text-muted hover:text-danger" aria-label="Remove link" onClick={() => set('links', f.links.filter((_, k) => k !== i))}><Trash2 size={12} /></button></div>)}
          <div className="flex gap-2"><input type="url" className="input-dark flex-1" placeholder="https://detail.1688.com/…" value={link} onChange={(e) => setLink(e.target.value)} /><button type="button" className="btn-ghost !min-h-10 text-sm" onClick={() => { if (link.trim()) { set('links', [...f.links, link.trim()]); setLink('') } }}>Add</button></div></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Ship to</span><select className="input-dark" value={f.destination} onChange={(e) => set('destination', e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">City</span><input className="input-dark" value={f.destinationCity} onChange={(e) => set('destinationCity', e.target.value)} placeholder="Accra, Kumasi, Lagos…" /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Mode</span><select className="input-dark" value={f.mode} onChange={(e) => set('mode', e.target.value as RequestInput['mode'])}><option value="either">Cheapest (either)</option><option value="ocean">Ocean</option><option value="air">Air</option></select></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Needed by</span><input type="date" className="input-dark" value={f.deadline ?? ''} onChange={(e) => set('deadline', e.target.value || null)} /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Company (optional)</span><input className="input-dark" value={f.company} onChange={(e) => set('company', e.target.value)} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Your name</span><input required className="input-dark" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Email</span><input required type="email" className="input-dark" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Phone / WhatsApp</span><input className="input-dark" value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-text-muted">No charge to ask. You only pay once you accept a quote.</p><button disabled={busy} className="btn-gold disabled:opacity-60" data-testid="src-submit">{busy ? 'Sending…' : 'Send to our China team'}</button></div>
      </form>
    </div></div>
  )
}

/* ================= job detail (customer + team) ================= */
export function SourcingJob() {
  const { id = '' } = useParams(); const { user } = useStore(); const [sp, setSp] = useSearchParams()
  const [d, setD] = useState<Detail | null>(null); const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [busy, setBusy] = useState('')
  const team = isSourcingTeam(user)
  const load = () => sourcingApi.get(id).then(setD).catch((e) => setError(err(e, 'Not found.')))
  useEffect(() => { void load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  useEffect(() => {
    const paid = sp.get('paid'); if (!paid) return
    sp.delete('paid'); setSp(sp, { replace: true })
    if (paid === 'cancel') { setToast('Checkout cancelled — nothing was charged.'); return }
    setBusy('verify'); sourcingApi.verify(id, paid).then((p) => { setToast(p.status === 'held' || p.status === 'released' ? 'Payment received — it is held safely by Ship Sync.' : 'We are confirming your payment; this page will update shortly.'); window.dispatchEvent(new Event(NOTIFY_EVENT)); return load() }).catch((e) => setError(err(e, 'Could not confirm the payment.'))).finally(() => setBusy(''))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<Detail | unknown>, msg: string, key: string) => { setBusy(key); setError(''); try { const r = await fn(); if (r && typeof r === 'object' && 'job' in (r as Detail)) setD(r as Detail); else await load(); if (msg) setToast(msg) } catch (e) { setError(err(e, 'Something went wrong.')) } finally { setBusy('') } }
  if (error && !d) return <div className="container-x py-16 text-center text-danger">{error}</div>
  if (!d) return <div className="container-x py-16 text-center text-text-muted">Loading…</div>
  const j = d.job; const steps = stepsFor(j.tier); const idx = steps.indexOf(j.status as typeof steps[number]); const closed = ['closed', 'cancelled'].includes(j.status)
  const back = team ? '/dashboard/sourcing' : '/dashboard?tab=sourcing'
  return (
    <div className="container-x max-w-5xl py-6 md:py-8" data-testid="sourcing-job">
      <Link to={back} className="text-xs text-text-muted hover:text-text">← {team ? 'Sourcing board' : 'My sourcing requests'}</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div><p className="eyebrow mb-1">{j.ref} · {j.tierLabel}</p><h1 className="!text-2xl md:!text-3xl">{j.title}</h1><p className="mt-1 text-sm text-text-muted">{j.quantity.toLocaleString()} {j.unit} → {j.destinationName}{j.destinationCity ? `, ${j.destinationCity}` : ''}{j.targetPriceUsd ? ` · target ${usd2(j.targetPriceUsd)}/unit` : ''}{j.deadline ? ` · needed by ${j.deadline}` : ''}{team && j.customer ? ` · for ${j.customer.name}${j.customer.company ? ` (${j.customer.company})` : ''}` : ''}</p></div>
        <Pill tone={tone(j.status)}>{stepLabels[j.status]}</Pill>
      </div>
      {toast && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {/* stepper */}
      <ol className="mt-5 flex gap-1 overflow-x-auto pb-1" aria-label="Progress" data-testid="stepper">{steps.map((s, i) => <li key={s} className={`flex min-w-[7.5rem] shrink-0 flex-col gap-1 text-[11px] ${i <= idx ? 'text-text' : 'text-text-muted'}`}><span className={`h-1 rounded-full ${i < idx ? 'bg-teal' : i === idx ? 'bg-gold' : 'bg-surface-2'}`} />{stepLabels[s]}</li>)}</ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {j.agent && <div className="card-dark flex items-center gap-3 p-4" data-testid="agent-card"><UserCheck size={18} className="text-teal" aria-hidden="true" /><div className="text-sm"><p className="font-semibold">{j.agent.name} <span className="text-text-muted">· your sourcing agent{j.agent.city ? ` in ${j.agent.city}` : ''}</span></p><p className="text-xs text-text-muted">Message them below — replies usually within a few hours, China time.</p></div></div>}
          {team && !j.agent && !closed && <div className="card-dark flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm">No agent yet.</p><button className="btn-gold !min-h-9 text-sm" disabled={!!busy} onClick={() => act(() => sourcingApi.assign(j.id, null), 'You took this request.', 'claim')} data-testid="claim">Take this request</button></div>}
          <section className="card-dark p-5"><p className="eyebrow mb-2">Request</p><p className="whitespace-pre-wrap text-sm">{j.description}</p>{j.links.length > 0 && <ul className="mt-2 space-y-1 text-xs">{j.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className="text-gold hover:underline">{l}</a></li>)}</ul>}</section>

          {/* quotes */}
          <section data-testid="quotes"><div className="flex items-center justify-between"><h2 className="!text-lg">Supplier options</h2>{team && !closed && ['assigned', 'sourcing', 'quoted'].includes(j.status) && <QuoteForm job={j} pricing={d.settings} onAdd={(q) => act(() => sourcingApi.addQuote(j.id, q), 'Option sent to the customer.', 'quote')} />}</div>
            {d.quotes.length === 0 && <p className="mt-2 text-sm text-text-muted">{team ? 'Add the first option once you have factory prices.' : 'Your agent is contacting factories. Options usually appear within 2–4 days.'}</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">{d.quotes.map((q) => <QuoteCard key={q.id} q={q} job={j} team={team} busy={busy} onAccept={() => act(() => sourcingApi.accept(j.id, q.id), 'Option accepted — pay the deposit to start the order.', 'accept')} onRemove={() => act(() => sourcingApi.removeQuote(j.id, q.id), 'Option removed.', 'rm')} />)}</div></section>

          {j.po && <section className="card-dark p-5 text-sm" data-testid="po"><p className="eyebrow mb-2">Factory order</p><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-text-muted">PO</dt><dd className="font-semibold">{j.po.number}</dd></div><div><dt className="text-xs text-text-muted">Supplier</dt><dd>{j.supplierRevealed ? j.po.supplier : 'Vetted factory'}</dd></div><div><dt className="text-xs text-text-muted">Ready by</dt><dd>{j.po.readyBy} · {j.po.incoterm}</dd></div></dl></section>}
          {j.qc && <section className="card-dark p-5 text-sm" data-testid="qc"><p className="eyebrow mb-2">Quality inspection</p><p><Pill tone={j.qc.result === 'pass' ? 'green' : j.qc.result === 'rework' ? 'gold' : 'danger'}>{j.qc.result}</Pill> <span className="ml-2 text-text-muted">{j.qc.checked ? `${j.qc.checked.toLocaleString()} checked · ${j.qc.defects} defects · ` : ''}{j.qc.by}, {fmtDate(j.qc.at)}</span></p>{j.qc.notes && <p className="mt-2">{j.qc.notes}</p>}</section>}
          {j.shipmentId && <section className="card-dark flex flex-wrap items-center justify-between gap-3 p-5 text-sm" data-testid="handoff"><div><p className="eyebrow mb-1">Shipment</p><p className="font-semibold">{j.shipmentRef} <span className="text-text-muted">· {String(j.shipmentStatus).replace(/_/g, ' ')}</span></p></div><Link to={team ? `/dashboard/shipments?q=${j.shipmentRef}&b=all` : `/dashboard?tab=shipments&s=${j.shipmentId}`} className="btn-ghost !min-h-9 text-sm">Open shipment</Link></section>}

          {/* files */}
          <Files d={d} canUpload={!closed} onUploaded={() => load()} />
          {/* messages */}
          <Messages d={d} disabled={closed} onSent={() => load()} />
        </div>

        <aside className="space-y-4">
          <PayCard d={d} team={team} busy={busy} onPay={() => act(async () => { const r = await sourcingApi.checkout(j.id); window.location.assign(r.url) }, '', 'pay')} onRecord={(m, n) => act(() => sourcingApi.record(j.id, m, n), 'Payment recorded.', 'record')} />
          {team && !closed && <TeamActions d={d} busy={busy} onStep={(b) => act(() => sourcingApi.step(j.id, b), 'Updated — the customer has been told.', 'step')} onAssign={(a) => act(() => sourcingApi.assign(j.id, a), 'Reassigned.', 'assign')} />}
          {!team && !closed && ['requested', 'assigned', 'sourcing', 'quoted'].includes(j.status) && <button className="btn-ghost w-full text-danger" disabled={!!busy} onClick={() => { const r = prompt('Why are you cancelling? (optional)') ?? ''; void act(() => sourcingApi.cancel(j.id, r), 'Request cancelled.', 'cancel') }}>Cancel request</button>}
          {!closed && ['delivered', 'shipped'].includes(j.status) && <button className="btn-gold w-full" disabled={!!busy} onClick={() => act(() => sourcingApi.close(j.id), 'Closed — thank you!', 'close')} data-testid="close-job">Mark as complete</button>}
          <section className="card-dark p-4"><p className="eyebrow mb-2">Timeline</p><ul className="space-y-1.5 text-xs text-text-muted" data-testid="timeline">{j.timeline.slice().reverse().map((t, k) => <li key={k}><span className="text-text">{stepLabels[t.status as Job['status']] ?? t.status}</span> · {fmtDateTime(t.at)} · {t.by}{t.note ? ` — ${t.note}` : ''}</li>)}</ul></section>
        </aside>
      </div>
    </div>
  )
}

function QuoteCard({ q, job, team, busy, onAccept, onRemove }: { q: Quote; job: Job; team: boolean; busy: string; onAccept: () => void; onRemove: () => void }) {
  const canAccept = !team && job.status === 'quoted' && !job.acceptedQuoteId
  return (
    <div className={`card-dark p-4 ${q.status === 'rejected' ? 'opacity-60' : ''} ${q.status === 'accepted' ? 'ring-1 ring-gold' : ''}`} data-testid="quote-card">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{q.title}</p><p className="text-xs text-text-muted">{q.supplier ? <>{q.supplier.name}{q.supplier.verified && <BadgeCheck size={12} className="ml-1 inline text-teal" aria-label="Verified" />} · {q.supplier.city}{q.supplier.province ? `, ${q.supplier.province}` : ''}</> : 'Supplier'} · {q.leadDays} days{q.moq ? ` · MOQ ${q.moq.toLocaleString()}` : ''}{q.sampleAvailable ? ' · sample available' : ''}</p></div>{q.status !== 'proposed' && <Pill tone={q.status === 'accepted' ? 'green' : 'muted'}>{q.status}</Pill>}</div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><dt className="text-text-muted">Factory price</dt><dd className="text-right tabular-nums">{cny(q.unitPriceCny)} × {q.qty.toLocaleString()} = {usd2(q.factoryUsd)}</dd><dt className="text-text-muted">Ship Sync fee</dt><dd className="text-right tabular-nums">{usd2(q.serviceFeeUsd)}</dd>
        {job.tier !== 'find' && <><dt className="text-text-muted">Inspection + China handling</dt><dd className="text-right tabular-nums">{usd2(q.inspectionUsd + q.handlingUsd)}</dd><dt className="text-text-muted">Freight{q.insuranceUsd ? ' + insurance' : ''}</dt><dd className="text-right tabular-nums">{usd2(q.freightUsd + q.insuranceUsd)}</dd>{q.dutyEstUsd > 0 && <><dt className="text-text-muted">Duty & clearance (est.)</dt><dd className="text-right tabular-nums">{usd2(q.dutyEstUsd)}</dd></>}</>}
        <dt className="border-t border-border pt-1 font-semibold">{job.tier === 'find' ? 'Sourcing fee' : 'Landed total'}</dt><dd className="border-t border-border pt-1 text-right font-semibold tabular-nums">{usd2(q.totalUsd)}</dd>
        {job.tier !== 'find' && <><dt className="text-text-muted">Deposit now / balance after QC</dt><dd className="text-right tabular-nums">{usd2(q.depositUsd)} / {usd2(q.balanceUsd)}</dd></>}</dl>
      {q.notes && <p className="mt-2 text-xs text-text-muted">{q.notes}</p>}
      {q.supplier && job.supplierRevealed && q.status === 'accepted' && (q.supplier.contact || q.supplier.wechat) && <p className="mt-2 text-xs" data-testid="supplier-contact"><strong>Contact:</strong> {q.supplier.contact}{q.supplier.wechat ? ` · WeChat ${q.supplier.wechat}` : ''}{q.supplier.phone ? ` · ${q.supplier.phone}` : ''}{q.supplier.storefront ? <> · <a className="text-gold hover:underline" href={q.supplier.storefront} target="_blank" rel="noreferrer">storefront</a></> : ''}</p>}
      <div className="mt-3 flex justify-end gap-2">{team && q.status === 'proposed' && <button className="btn-ghost !min-h-8 text-xs text-danger" disabled={!!busy} onClick={onRemove}>Remove</button>}{canAccept && <button className="btn-gold !min-h-9 text-sm" disabled={!!busy} onClick={onAccept} data-testid="accept-quote">Accept this option</button>}</div>
    </div>
  )
}

function QuoteForm({ job, pricing, onAdd }: { job: Job; pricing: Detail['settings']; onAdd: (q: QuoteInput) => void }) {
  const [open, setOpen] = useState(false); const [sups, setSups] = useState<Supplier[]>([]); const [q, setQ] = useState<QuoteInput>({ supplierId: '', title: '', unitPriceCny: 0, qty: job.quantity, moq: 0, leadDays: 25, freightUsd: 0, insuranceUsd: 0, dutyEstUsd: 0, notes: '', sampleAvailable: false })
  useEffect(() => { if (open) sourcingApi.suppliers().then(setSups).catch(() => {}) }, [open])
  const factory = q.unitPriceCny * q.qty / pricing.cnyPerUsd; const fee = job.tier === 'find' ? pricing.findFeeUsd : Math.max(pricing.minFeeUsd, factory * pricing.servicePct)
  const total = job.tier === 'find' ? fee : factory + fee + pricing.inspectionUsd + pricing.handlingUsd + (q.freightUsd ?? 0) + (q.insuranceUsd ?? 0) + (job.tier === 'door' ? q.dutyEstUsd ?? 0 : 0)
  if (!open) return <button className="btn-gold !min-h-9 text-sm" onClick={() => setOpen(true)} data-testid="add-quote">Add an option</button>
  return (
    <form className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onSubmit={(e) => { e.preventDefault(); onAdd(q); setOpen(false) }} aria-label="Add supplier option">
      <div className="card-dark max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 text-sm">
        <h3 className="!text-lg">Supplier option</h3>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1"><span className="text-xs text-text-muted">Supplier</span><select required className="input-dark !min-h-10" value={q.supplierId} onChange={(e) => setQ({ ...q, supplierId: e.target.value })} data-testid="q-supplier"><option value="">Choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}</select><Link to="/dashboard/suppliers" className="text-xs text-gold hover:underline">Add a new supplier</Link></label>
          <label className="grid gap-1"><span className="text-xs text-text-muted">Option title</span><input required className="input-dark !min-h-10" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} placeholder="e.g. 5 W panel, 2000 mAh, boxed" data-testid="q-title" /></label>
          <div className="grid grid-cols-3 gap-2"><label className="grid gap-1"><span className="text-xs text-text-muted">Unit price (¥)</span><input type="number" min={0.01} step="0.01" required className="input-dark !min-h-10" value={q.unitPriceCny || ''} onChange={(e) => setQ({ ...q, unitPriceCny: Number(e.target.value) })} data-testid="q-price" /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Qty</span><input type="number" min={1} required className="input-dark !min-h-10" value={q.qty} onChange={(e) => setQ({ ...q, qty: Number(e.target.value) })} /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Lead days</span><input type="number" min={0} required className="input-dark !min-h-10" value={q.leadDays} onChange={(e) => setQ({ ...q, leadDays: Number(e.target.value) })} /></label></div>
          {job.tier !== 'find' && <div className="grid grid-cols-3 gap-2"><label className="grid gap-1"><span className="text-xs text-text-muted">Freight ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={q.freightUsd ?? 0} onChange={(e) => setQ({ ...q, freightUsd: Number(e.target.value) })} data-testid="q-freight" /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Insurance ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={q.insuranceUsd ?? 0} onChange={(e) => setQ({ ...q, insuranceUsd: Number(e.target.value) })} /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Duty est. ($){job.tier !== 'door' ? ' — door only' : ''}</span><input type="number" min={0} disabled={job.tier !== 'door'} className="input-dark !min-h-10" value={q.dutyEstUsd ?? 0} onChange={(e) => setQ({ ...q, dutyEstUsd: Number(e.target.value) })} /></label></div>}
          <label className="grid gap-1"><span className="text-xs text-text-muted">MOQ</span><input type="number" min={0} className="input-dark !min-h-10" value={q.moq ?? 0} onChange={(e) => setQ({ ...q, moq: Number(e.target.value) })} /></label>
          <label className="grid gap-1"><span className="text-xs text-text-muted">Notes for the customer</span><textarea rows={2} className="input-dark" value={q.notes} onChange={(e) => setQ({ ...q, notes: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!q.sampleAvailable} onChange={(e) => setQ({ ...q, sampleAvailable: e.target.checked })} /> Sample available</label>
          <p className="rounded-lg bg-surface-2/60 p-3 text-xs tabular-nums">Factory {usd2(factory)} · fee {usd2(fee)}{job.tier !== 'find' ? ` · inspection ${usd2(pricing.inspectionUsd)} · handling ${usd2(pricing.handlingUsd)}` : ''} → <strong>landed {usd2(total)}</strong>{job.tier !== 'find' ? ` · deposit ${usd2(fee + pricing.inspectionUsd + factory * pricing.depositPct)}` : ''}</p>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-10 text-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn-gold !min-h-10 text-sm" data-testid="q-save">Send option</button></div>
      </div>
    </form>
  )
}

function PayCard({ d, team, busy, onPay, onRecord }: { d: Detail; team: boolean; busy: string; onPay: () => void; onRecord: (method: string, note: string) => void }) {
  const [m, setM] = useState('bank'); const [n, setN] = useState('')
  const paid = d.payments.filter((p) => ['held', 'released', 'paid_out', 'direct'].includes(p.status))
  return (
    <section className="card-dark p-4" data-testid="pay-card">
      <p className="eyebrow mb-2">Payments</p>
      {paid.length === 0 && !d.due && <p className="text-sm text-text-muted">Nothing to pay yet. You pay a deposit only after accepting a quote.</p>}
      <ul className="space-y-1 text-sm">{paid.map((p) => <li key={p.id} className="flex justify-between"><span>{stageLabel[p.stage]}</span><span className="tabular-nums">{usd2(p.amountUsd)} <span className="text-xs text-text-muted">· {p.status === 'direct' ? p.method : p.status}</span></span></li>)}</ul>
      {d.due && (
        <div className="mt-3 rounded-lg border border-gold/40 bg-gold/5 p-3 text-sm" data-testid="due">
          <p className="font-semibold">{stageLabel[d.due.stage]} due · {usd2(d.due.amountUsd)}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-text-muted">{d.due.items.map((i, k) => <li key={k} className="flex justify-between gap-2"><span>{i.description}</span><span className="tabular-nums">{usd2(i.amountUsd)}</span></li>)}</ul>
          {!team && d.canPay && <button className="btn-gold mt-3 w-full !min-h-10 text-sm" disabled={!!busy} onClick={onPay} data-testid="pay-now"><CreditCard size={14} aria-hidden="true" /> {busy === 'pay' ? 'Opening secure checkout…' : busy === 'verify' ? 'Confirming…' : `Pay ${usd2(d.due.amountUsd)} securely`}</button>}
          {!team && !d.canPay && <p className="mt-2 text-xs text-text-muted">Online payment is not available right now — your agent will send bank details.</p>}
          {team && <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); onRecord(m, n) }}><select className="input-dark !min-h-9 text-xs" value={m} onChange={(e) => setM(e.target.value)} aria-label="Method"><option value="bank">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="other">Other</option></select><input className="input-dark !min-h-9 text-xs" placeholder="Reference (optional)" value={n} onChange={(e) => setN(e.target.value)} /><button className="btn-ghost !min-h-9 text-xs" disabled={!!busy} data-testid="record-payment">Record payment received</button></form>}
          <p className="mt-2 text-[11px] text-text-muted">{d.settings.note}</p>
        </div>
      )}
    </section>
  )
}

function TeamActions({ d, busy, onStep, onAssign }: { d: Detail; busy: string; onStep: (b: StepInput) => void; onAssign: (agent: string | null) => void }) {
  const j = d.job; const [f, setF] = useState<StepInput | null>(null); const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { sourcingApi.board().then((b) => setAgents(b.agents)).catch(() => {}) }, [])
  const next: { status: StepInput['status']; label: string }[] = []
  if (['assigned'].includes(j.status)) next.push({ status: 'sourcing', label: 'Start sourcing' })
  if (j.status === 'deposit_paid') next.push({ status: 'ordered', label: 'Record factory order' })
  if (j.status === 'ordered') next.push({ status: 'in_production', label: 'In production' })
  if (['ordered', 'in_production'].includes(j.status)) next.push({ status: 'inspected', label: 'Record inspection' })
  if (j.status === 'balance_paid') next.push({ status: 'received_cn', label: 'Received at warehouse' })
  if (['balance_paid', 'received_cn'].includes(j.status)) next.push({ status: 'shipped', label: 'Ship it' })
  if (j.status === 'shipped') next.push({ status: 'delivered', label: 'Mark delivered' })
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (f) { onStep(f); setF(null) } }
  return (
    <section className="card-dark p-4 text-sm" data-testid="team-actions">
      <p className="eyebrow mb-2">Team actions</p>
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Agent</span><select className="input-dark !min-h-9 text-xs" value={j.agent?.id ?? ''} onChange={(e) => onAssign(e.target.value || null)} disabled={!!busy} data-testid="assign-select"><option value="">— unassigned —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {!f && <div className="mt-3 flex flex-wrap gap-2">{next.map((n) => <button key={n.status} className="btn-gold !min-h-9 text-xs" disabled={!!busy} onClick={() => setF({ status: n.status, note: '', po: n.status === 'ordered' ? { number: '', incoterm: 'FOB', leadDays: 25 } : undefined, qc: n.status === 'inspected' ? { result: 'pass', checked: 0, defects: 0, notes: '' } : undefined, ship: n.status === 'shipped' ? { mode: j.mode === 'air' ? 'air' : 'ocean', originCity: 'Guangzhou', cargo: 'commercial', eta: new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10) } : undefined })} data-testid={`step-${n.status}`}>{n.label}</button>)}<button className="btn-ghost !min-h-9 text-xs text-danger" disabled={!!busy} onClick={() => setF({ status: 'cancelled', note: '' })}>Cancel request</button></div>}
      {f && (
        <form onSubmit={submit} className="mt-3 grid gap-2 rounded-lg border border-border p-3" aria-label="Update step">
          <p className="font-semibold">{stepLabels[f.status]}</p>
          {f.po && <div className="grid grid-cols-2 gap-2"><input className="input-dark !min-h-9 text-xs" placeholder="PO number" value={f.po.number ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, number: e.target.value } })} data-testid="po-number" /><select className="input-dark !min-h-9 text-xs" value={f.po.incoterm} onChange={(e) => setF({ ...f, po: { ...f.po, incoterm: e.target.value as 'FOB' } })}><option>EXW</option><option>FOB</option><option>CIF</option><option>DDP</option></select><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Lead days" value={f.po.leadDays ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, leadDays: Number(e.target.value) } })} /><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Paid to factory (¥)" value={f.po.factoryPaidCny ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, factoryPaidCny: e.target.value ? Number(e.target.value) : undefined } })} /></div>}
          {f.qc && <div className="grid grid-cols-3 gap-2"><select className="input-dark !min-h-9 text-xs" value={f.qc.result} onChange={(e) => setF({ ...f, qc: { ...f.qc!, result: e.target.value as 'pass' } })} data-testid="qc-result"><option value="pass">Pass</option><option value="rework">Rework needed</option><option value="fail">Fail</option></select><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Checked" value={f.qc.checked ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, checked: Number(e.target.value) } })} /><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Defects" value={f.qc.defects ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, defects: Number(e.target.value) } })} /><textarea rows={2} className="input-dark col-span-3 text-xs" placeholder="Findings (shown to the customer)" value={f.qc.notes ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, notes: e.target.value } })} /></div>}
          {f.ship && <div className="grid grid-cols-2 gap-2"><select className="input-dark !min-h-9 text-xs" value={f.ship.mode} onChange={(e) => setF({ ...f, ship: { ...f.ship!, mode: e.target.value as 'ocean' } })}><option value="ocean">Ocean</option><option value="air">Air</option></select><input type="date" required className="input-dark !min-h-9 text-xs" value={f.ship.eta} onChange={(e) => setF({ ...f, ship: { ...f.ship!, eta: e.target.value } })} data-testid="ship-eta" /><input className="input-dark !min-h-9 text-xs" placeholder="Origin city" value={f.ship.originCity ?? ''} onChange={(e) => setF({ ...f, ship: { ...f.ship!, originCity: e.target.value } })} /><select className="input-dark !min-h-9 text-xs" value={f.ship.cargo} onChange={(e) => setF({ ...f, ship: { ...f.ship!, cargo: e.target.value } })}><option value="commercial">Commercial cargo</option><option value="boxes">Boxes</option><option value="pallets">Pallets</option><option value="container20">20 ft container</option><option value="container40">40 ft container</option></select><input className="input-dark !min-h-9 text-xs col-span-2" placeholder={f.ship.mode === 'air' ? 'Flight number (optional)' : 'Vessel name (optional)'} value={(f.ship.mode === 'air' ? f.ship.flight : f.ship.vesselName) ?? ''} onChange={(e) => setF({ ...f, ship: { ...f.ship!, ...(f.ship!.mode === 'air' ? { flight: e.target.value } : { vesselName: e.target.value }) } })} /></div>}
          {f.status === 'cancelled' && d.payments.some((p) => ['held', 'released'].includes(p.status)) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f.refund} onChange={(e) => setF({ ...f, refund: e.target.checked })} /> Refund collected payments (admin)</label>}
          <input className="input-dark !min-h-9 text-xs" placeholder="Note for the customer (optional)" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="step-note" />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-9 text-xs" onClick={() => setF(null)}>Back</button><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} data-testid="step-save">Save</button></div>
        </form>
      )}
    </section>
  )
}

function Files({ d, canUpload, onUploaded }: { d: Detail; canUpload: boolean; onUploaded: () => void }) {
  const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 3_000_000) { setError('Keep files under 3 MB.'); return }
    setBusy(true); setError('')
    try { const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(file) }); await sourcingApi.upload(d.job.id, { kind: file.type === 'application/pdf' ? 'document' : 'photo', title: file.name.replace(/\.[^.]+$/, '').slice(0, 120), mime: file.type, data }); onUploaded() } catch (er) { setError(err(er, 'Upload failed.')) } finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  return (
    <section data-testid="files"><div className="flex items-center justify-between"><h2 className="!text-lg">Photos & documents</h2>{canUpload && <><input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={pick} data-testid="file-input" /><button className="btn-ghost !min-h-9 text-sm" disabled={busy} onClick={() => ref.current?.click()}><Camera size={14} aria-hidden="true" /> {busy ? 'Uploading…' : 'Add'}</button></>}</div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {d.files.length === 0 ? <p className="mt-2 text-sm text-text-muted">Factory photos, samples, inspection shots and documents land here.</p> : <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{d.files.map((f: SFile) => <li key={f.id} className="card-dark overflow-hidden text-xs"><a href={f.url} target="_blank" rel="noreferrer">{f.mime.startsWith('image/') ? <img src={f.url} alt={f.title} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="grid aspect-square place-items-center bg-surface-2"><FileText size={24} aria-hidden="true" /></div>}</a><div className="p-2"><p className="truncate font-semibold">{f.title}</p><p className="text-text-muted">{f.kind === 'qc' ? 'Inspection · ' : ''}{f.by} · {fmtDate(f.at)}</p></div></li>)}</ul>}
    </section>
  )
}

function Messages({ d, disabled, onSent }: { d: Detail; disabled: boolean; onSent: () => void }) {
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); setError(''); try { await sourcingApi.message(d.job.id, body.trim()); setBody(''); onSent() } catch (er) { setError(err(er, 'Could not send.')) } finally { setBusy(false) } }
  return (
    <section data-testid="messages"><h2 className="!text-lg"><MessageSquare size={16} className="mr-1 inline text-gold" aria-hidden="true" /> Messages</h2>
      <ul className="mt-3 space-y-2">{d.messages.length === 0 && <li className="text-sm text-text-muted">Ask about samples, packaging, branding, timing — your agent replies here.</li>}{d.messages.map((m) => <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.mine ? 'ml-auto bg-gold/15' : 'bg-surface-2'}`} data-testid="message"><p className="text-[11px] text-text-muted">{m.author}{m.role !== 'customer' ? ' · Ship Sync Sourcing' : ''} · {fmtDateTime(m.at)}</p><p className="whitespace-pre-wrap">{m.body}</p></li>)}</ul>
      {!disabled && <form onSubmit={send} className="mt-3 flex gap-2"><input className="input-dark flex-1 !min-h-10 text-sm" placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} data-testid="message-input" /><button className="btn-gold !min-h-10 !px-4 text-sm" disabled={busy || !body.trim()} data-testid="message-send">Send</button></form>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  )
}

/* ================= customer dashboard tab ================= */
export function SourcingTab() {
  const [list, setList] = useState<Job[] | null>(null); const [error, setError] = useState('')
  useEffect(() => { sourcingApi.mine().then(setList).catch((e) => setError(err(e, 'Could not load.'))) }, [])
  return (
    <div className="mt-6" data-testid="sourcing-tab">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">Products our China team is sourcing, buying and shipping for you.</p><Link to="/sourcing/new" className="btn-gold !min-h-9 !px-4 text-sm">New sourcing request</Link></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {list === null && !error && <p className="mt-6 text-sm text-text-muted">Loading…</p>}
      {list && list.length === 0 && <div className="mt-6"><Empty title="Nothing being sourced yet" body="Need stock from China? Describe it and our team in Guangzhou finds the factory, buys it in Ship Sync's name, inspects it and ships it to you." action={<Link to="/sourcing" className="btn-gold">See how it works</Link>} /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">{list?.map((j) => <li key={j.id}><Link to={`/sourcing/${j.id}`} className="card-dark block p-4 hover:border-gold/50" data-testid="sourcing-row"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{j.title}</p><p className="text-xs text-text-muted">{j.ref} · {j.tierLabel} · {j.quantity.toLocaleString()} {j.unit} → {j.destinationName}</p></div><Pill tone={tone(j.status)}>{stepLabels[j.status]}</Pill></div>{j.agent && <p className="mt-2 text-xs text-text-muted">Agent: {j.agent.name}</p>}</Link></li>)}</ul>
    </div>
  )
}

/* ================= team board ================= */
export function SourcingBoard() {
  const { user } = useStore(); const [d, setD] = useState<Awaited<ReturnType<typeof sourcingApi.board>> | null>(null); const [error, setError] = useState('')
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<'open' | 'mine' | 'unassigned' | 'action' | 'done'>('open')
  useEffect(() => { sourcingApi.board().then(setD).catch((e) => setError(err(e, 'Could not load.'))) }, [])
  if (!isSourcingTeam(user)) return <Navigate to="/dashboard" replace />
  const all = d?.requests ?? []
  const open = all.filter((j) => !['closed', 'cancelled'].includes(j.status))
  const action = open.filter((j) => ['requested', 'assigned', 'deposit_paid', 'balance_paid', 'received_cn'].includes(j.status) || (j.status === 'in_production' && j.qc?.result === 'rework'))
  const rows = (filter === 'open' ? open : filter === 'mine' ? open.filter((j) => j.agent?.id === d?.me) : filter === 'unassigned' ? open.filter((j) => !j.agent) : filter === 'action' ? action : all.filter((j) => ['closed', 'cancelled'].includes(j.status))).filter((j) => !q || `${j.ref} ${j.title} ${j.customer?.name ?? ''} ${j.destinationName}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="container-x py-6 md:py-8" data-testid="sourcing-board">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ship Sync Sourcing</p><h1 className="!text-2xl md:!text-3xl">Sourcing board</h1></div><Link to="/dashboard/suppliers" className="btn-ghost !min-h-9 text-sm"><Factory size={14} aria-hidden="true" /> Suppliers</Link></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Open requests" value={open.length} icon={Globe2} /><StatCard label="Needs action" value={action.length} icon={PackageCheck} warn={action.length > 0} active={filter === 'action'} onClick={() => setFilter('action')} /><StatCard label="Unassigned" value={open.filter((j) => !j.agent).length} icon={UserCheck} active={filter === 'unassigned'} onClick={() => setFilter('unassigned')} /><StatCard label="Team" value={d?.agents.length ?? 0} hint={d?.agents.map((a) => `${a.name} (${a.open})`).join(' · ')} icon={Handshake} /></div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><Chip active={filter === 'open'} onClick={() => setFilter('open')}>All open</Chip><Chip active={filter === 'mine'} onClick={() => setFilter('mine')}>Mine</Chip><Chip active={filter === 'unassigned'} onClick={() => setFilter('unassigned')}>Unassigned</Chip><Chip active={filter === 'action'} onClick={() => setFilter('action')}>Needs action</Chip><Chip active={filter === 'done'} onClick={() => setFilter('done')}>Closed</Chip><div className="ml-auto w-64"><SearchBox value={q} onChange={setQ} placeholder="Ref, product, customer…" label="Search requests" /></div></div>
      {d && rows.length === 0 && <div className="mt-6"><Empty title="Nothing here" body="New customer requests appear on this board the moment they are filed." /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((j) => <li key={j.id}><Link to={`/dashboard/sourcing/${j.id}`} className="card-dark block h-full p-4 hover:border-gold/50" data-testid="board-row"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{j.title}</p><p className="text-xs text-text-muted">{j.ref} · {j.tierLabel} · {j.quantity.toLocaleString()} {j.unit} → {j.destinationName}</p></div><Pill tone={tone(j.status)}>{stepLabels[j.status]}</Pill></div><p className="mt-2 text-xs text-text-muted">{j.customer?.name}{j.customer?.company ? ` · ${j.customer.company}` : ''} · {j.agent ? j.agent.name : <span className="text-gold">unassigned</span>} · updated {j.updatedAt ? fmtDate(j.updatedAt) : ''}</p></Link></li>)}</ul>
    </div>
  )
}

/* ================= suppliers directory (team) ================= */
const blankSupplier = (): SupplierInput => ({ name: '', city: '', province: 'Guangdong', products: [], verified: false, rating: 0, notes: '', contact: '', wechat: '', phone: '', website: '', storefront: '', active: true })
export function SuppliersPage() {
  const { user } = useStore(); const [list, setList] = useState<Supplier[] | null>(null); const [q, setQ] = useState(''); const [form, setForm] = useState<(SupplierInput & { id?: string }) | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => sourcingApi.suppliers().then(setList).catch((e) => setError(err(e, 'Could not load.')))
  useEffect(() => { void load() }, [])
  const rows = useMemo(() => (list ?? []).filter((s) => !q || `${s.name} ${s.city} ${s.products.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [list, q])
  if (!isSourcingTeam(user)) return <Navigate to="/dashboard" replace />
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (!form) return; setBusy(true); setError(''); try { const { id, ...b } = form; if (id) await sourcingApi.updateSupplier(id, b); else await sourcingApi.addSupplier(b); setForm(null); await load() } catch (er) { setError(err(er, 'Could not save.')) } finally { setBusy(false) } }
  return (
    <div className="container-x py-6 md:py-8" data-testid="suppliers">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ship Sync Sourcing</p><h1 className="!text-2xl md:!text-3xl">Suppliers</h1><p className="mt-1 text-sm text-text-muted">Every factory we have worked with, with contacts the customer never sees until they pay.</p></div><div className="flex gap-2"><Link to="/dashboard/sourcing" className="btn-ghost !min-h-9 text-sm">Board</Link><button className="btn-gold !min-h-9 text-sm" onClick={() => setForm(blankSupplier())} data-testid="add-supplier">Add supplier</button></div></div>
      <div className="mt-4 w-72"><SearchBox value={q} onChange={setQ} placeholder="Name, city, product…" label="Search suppliers" /></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((s) => <li key={s.id} className="card-dark p-4 text-sm" data-testid="supplier-card"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{s.name}{s.verified && <BadgeCheck size={13} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="text-xs text-text-muted">{s.city}{s.province ? `, ${s.province}` : ''} · {s.rating ? `★ ${s.rating}` : 'unrated'} · {s.jobs} order{s.jobs === 1 ? '' : 's'}</p></div><button className="btn-ghost !min-h-8 text-xs" onClick={() => setForm({ ...s })}>Edit</button></div>{s.products.length > 0 && <ul className="mt-2 flex flex-wrap gap-1">{s.products.map((p) => <li key={p}><Pill tone="muted">{p}</Pill></li>)}</ul>}<p className="mt-2 text-xs">{s.contact}{s.wechat ? ` · WeChat ${s.wechat}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>{s.notes && <p className="mt-1 text-xs text-text-muted">{s.notes}</p>}</li>)}</ul>
      {form && (
        <form onSubmit={save} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" aria-label="Supplier"><div className="card-dark max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 text-sm"><h3 className="!text-lg">{form.id ? 'Edit supplier' : 'New supplier'}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input required className="input-dark !min-h-10 sm:col-span-2" placeholder="Factory name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="sup-name" />
            <input className="input-dark !min-h-10" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /><input className="input-dark !min-h-10" placeholder="Province" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            <input className="input-dark !min-h-10 sm:col-span-2" placeholder="Products (comma separated)" value={form.products.join(', ')} onChange={(e) => setForm({ ...form, products: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <input className="input-dark !min-h-10" placeholder="Contact person" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /><input className="input-dark !min-h-10" placeholder="WeChat" value={form.wechat} onChange={(e) => setForm({ ...form, wechat: e.target.value })} />
            <input className="input-dark !min-h-10" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><input className="input-dark !min-h-10" placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <input className="input-dark !min-h-10 sm:col-span-2" placeholder="1688 / Alibaba storefront URL" value={form.storefront} onChange={(e) => setForm({ ...form, storefront: e.target.value })} />
            <textarea rows={2} className="input-dark sm:col-span-2" placeholder="Internal notes (audit results, payment terms, who visited)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label className="flex items-center gap-2 text-xs"><input type="number" min={0} max={5} step="0.1" className="input-dark !min-h-9 w-20 text-xs" value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} /> rating / 5</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified (audited by our team)</label>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-10 text-sm" onClick={() => setForm(null)}>Cancel</button><button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="sup-save">{busy ? 'Saving…' : 'Save'}</button></div></div></form>
      )}
    </div>
  )
}

/* ================= admin settings ================= */
export function AdminSourcing() {
  const [s, setS] = useState<Settings | null>(null); const [msg, setMsg] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { sourcingApi.settings().then(setS).catch((e) => setError(err(e, 'Could not load.'))) }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  if (!s) return null
  const save = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { setS(await sourcingApi.saveSettings(s)); setMsg('Saved.') } catch (er) { setError(err(er, 'Could not save.')) } finally { setBusy(false) } }
  const num = (k: keyof Settings, v: string, scale = 1) => setS({ ...s, [k]: Number(v) / scale })
  return (
    <section className="mt-14" data-testid="admin-sourcing">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ship Sync Sourcing</p><h2 className="!text-2xl">Sourcing pricing</h2><p className="mt-1 text-sm text-text-muted">Agents are staff of the <code>ship-sync-sourcing</code> shipper (sign in as the team owner to invite them from Team). These rates feed every new quote.</p></div><Link to="/dashboard/sourcing" className="btn-ghost !min-h-9 text-sm">Open the board</Link></div>
      <form onSubmit={save} className="card-dark mt-4 grid gap-3 p-5 text-sm sm:grid-cols-3">
        <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Accepting new sourcing requests</label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Service fee (% of factory price)</span><input type="number" min={0} max={50} step="0.5" className="input-dark !min-h-10" value={Math.round(s.servicePct * 1000) / 10} onChange={(e) => num('servicePct', e.target.value, 100)} data-testid="adm-pct" /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Minimum fee ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.minFeeUsd} onChange={(e) => num('minFeeUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Supplier-search flat fee ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.findFeeUsd} onChange={(e) => num('findFeeUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Deposit (% of factory price)</span><input type="number" min={5} max={100} className="input-dark !min-h-10" value={Math.round(s.depositPct * 100)} onChange={(e) => num('depositPct', e.target.value, 100)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Inspection ($ per order)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.inspectionUsd} onChange={(e) => num('inspectionUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">China handling & export ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.handlingUsd} onChange={(e) => num('handlingUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">¥ per US$ (overridden by CNY_PER_USD)</span><input type="number" min={1} max={20} step="0.01" className="input-dark !min-h-10" value={s.cnyPerUsd} onChange={(e) => num('cnyPerUsd', e.target.value)} /></label>
        <label className="grid gap-1 sm:col-span-2"><span className="text-xs text-text-muted">Escrow note shown to customers</span><input className="input-dark !min-h-10" value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} /></label>
        <div className="flex items-center justify-end gap-3 sm:col-span-3">{msg && <span role="status" className="text-xs text-teal">{msg}</span>}{error && <span role="alert" className="text-xs text-danger">{error}</span>}<button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="adm-save">{busy ? 'Saving…' : 'Save pricing'}</button></div>
      </form>
    </section>
  )
}
