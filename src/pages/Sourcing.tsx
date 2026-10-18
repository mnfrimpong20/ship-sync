import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, Camera, Check, ClipboardCheck, CreditCard, Factory, FileText, FlaskConical, Globe2, Handshake, MessageSquare, PackageCheck, Paperclip, Printer, Repeat, Search, Ship, ShieldCheck, Smartphone, Sparkles, Trash2, UserCheck, Wallet } from 'lucide-react'
import { ORIGINS, ORIGIN_CODES, localPrice, type Origin } from '../lib/sourcingOrigins'
import { sourcingApi, stepLabels, tierLabels, STEPS, FIND_STEPS, SOURCING_SHIPPER, cny, usd2, type Detail, type Job, type Quote, type QuoteInput, type RequestInput, type SFile, type Supplier, type SupplierInput, type StepInput, type Tier, type Settings, type Stage, type QcItem, type OpenContainer, type Earning, type QcReport, type Audit, type Reference, type PriceBreak, type TodayItem, type Pricing, type SupplierLink, type SupplierUpdate, QC_ITEMS } from '../lib/sourcing'
import { countries } from '../lib/data'
import { useStore } from '../lib/store'
import { Empty, Pill, fmtDate, fmtDateTime, money, Flag } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, SearchBox, StatCard } from '../components/board'
import { NOTIFY_EVENT } from '../lib/notifications'

const err = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)
const stageLabel: Record<Stage, string> = { fee: 'Sourcing fee', deposit: 'Deposit', balance: 'Balance', sample: 'Sample' }
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
          <motion.p variants={fadeUp} className="eyebrow mb-2">Ntemtem Sourcing · China · UK · USA</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.5vw,3.4rem)]">Buy it in China, the UK or the USA. We check it and ship it to you.</motion.h1>
          <motion.p variants={fadeUp} className="mt-3 text-text-muted">Tell us what you want — a description, a photo or a link from 1688, Alibaba, Amazon, Argos or Walmart. Our own team finds vetted factories, wholesalers and stores, places the order in Ntemtem's name, inspects it at our warehouse, and hands it to the ocean or air leg. One timeline, one price, your money in escrow.</motion.p>
          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/sourcing/new" className="btn-gold" data-testid="sourcing-cta">Start a sourcing request</Link><button type="button" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className="btn-ghost">How it works</button></motion.div>
          {cfg && <motion.p variants={fadeUp} className="mt-4 text-xs text-text-muted">{cfg.stats.agents} agent{cfg.stats.agents === 1 ? '' : 's'} on the ground · {cfg.stats.verifiedSuppliers} verified suppliers in 3 countries · {cfg.stats.completed} orders shipped</motion.p>}
        </motion.div>
        <section className="mx-auto mt-12 max-w-5xl" data-testid="origins">
          <p className="eyebrow mb-2 text-center">Where we buy</p>
          <div className="grid gap-4 md:grid-cols-3">{ORIGIN_CODES.map((c) => { const o = ORIGINS[c]; const rate = cfg?.origins?.find((x) => x.code === c)?.perUsd; return (
            <div key={c} className="card-dark flex flex-col p-5" data-testid={`origin-${c}`}><Flag code={o.code} size={26} className="rounded-[4px]" /><h3 className="mt-2 !text-lg">{o.name}</h3><p className="mt-1 text-sm text-text-muted">{o.blurb}</p>
              <p className="mt-3 text-xs"><span className="font-semibold">Popular:</span> <span className="text-text-muted">{o.examples}</span></p>
              <p className="mt-1 text-xs"><span className="font-semibold">Paste links from:</span> <span className="text-text-muted">{o.platforms}</span></p>
              <p className="mt-1 text-xs text-text-muted">Ships from our {o.hub} warehouse{rate && o.currency !== 'USD' ? ` · prices in ${o.currency} (${o.symbol}${rate} = $1)` : ' · prices in US$'}</p>
              <div className="flex-1" /><Link to={`/sourcing/new?from=${c}`} className="btn-ghost mt-4 !min-h-9 text-sm" data-testid={`origin-start-${c}`}>Buy from {o.short}</Link></div>) })}</div>
        </section>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3" data-testid="tiers">
          {cfg?.tiers.map((t) => { const I = icons[t.id]; return (
            <motion.div key={t.id} variants={fadeUp} className="card-dark flex flex-col p-5"><I size={22} className="text-gold-deep" aria-hidden="true" /><h3 className="mt-3 !text-lg">{t.label}</h3><p className="mt-1 flex-1 text-sm text-text-muted">{t.blurb}</p>
              <p className="mt-3 text-sm font-semibold tabular-nums">{t.id === 'find' ? `Flat ${money(p!.findFeeUsd)}` : `${Math.round(p!.servicePct * 100)}% of the goods price (min ${money(p!.minFeeUsd)})`}</p>
              <Link to={`/sourcing/new?tier=${t.id}`} className="btn-ghost mt-3 !min-h-9 text-sm">Choose</Link></motion.div>) })}
        </motion.div>
        <section id="how" className="mx-auto mt-16 max-w-5xl">
          <p className="eyebrow mb-2 text-center">How it works</p>
          <ol className="grid gap-4 md:grid-cols-4">
            {[[Search, 'Tell us what you need', 'Describe the product, quantity, target price and where it’s going. Paste supplier links if you have them.'], [Factory, 'We find & price it', 'Your agent shortlists factories, wholesalers or stores and returns a landed-cost quote: goods price, our fee, inspection, freight, insurance and duty.'], [ShieldCheck, 'Pay in stages, in escrow', `Accept a quote and pay the deposit (fee + inspection + ${p ? Math.round(p.depositPct * 100) : 30}% of the goods). The balance is only due after you approve the inspection photos.`], [Ship, 'We ship it', 'Goods are received at our warehouse in Guangzhou, London or Houston, exported and tracked like any Ntemtem shipment — all the way to your door if you choose.']].map(([I, t, b], i) => { const Icon = I as typeof Search; return <li key={i} className="card-dark p-5"><span className="grid h-8 w-8 place-items-center rounded-full bg-gold/15 text-gold-deep"><Icon size={16} aria-hidden="true" /></span><p className="mt-3 font-semibold">{i + 1}. {t as string}</p><p className="mt-1 text-sm text-text-muted">{b as string}</p></li> })}
          </ol>
        </section>
        {p && <WorkedExamples p={p} />}
        {p && <section className="mx-auto mt-12 max-w-3xl card-dark p-6 text-sm" data-testid="pricing"><p className="eyebrow mb-2">Transparent pricing</p>
          <ul className="grid gap-2 sm:grid-cols-2"><li><span className="text-text-muted">Sourcing & buying fee</span><br /><strong>{Math.round(p.servicePct * 100)}% of the goods price</strong>, min {money(p.minFeeUsd)}</li><li><span className="text-text-muted">Supplier search only</span><br /><strong>{money(p.findFeeUsd)}</strong> flat per request</li><li><span className="text-text-muted">Quality inspection</span><br /><strong>{money(p.inspectionUsd)}</strong> per order, photos included</li><li><span className="text-text-muted">Warehouse & export</span><br /><strong>{money(p.handlingUsd)}</strong> per order</li></ul>
          <p className="mt-4 text-xs text-text-muted">Freight, insurance and duty are quoted per order at the same rates as the rest of Ntemtem. Prices are converted at ¥{p.cnyPerUsd} and £{p.gbpPerUsd} per US dollar; US purchases are in dollars already. {p.note}</p></section>}
      </div>
    </div>
  )
}

/** Three real-looking orders priced with the live formula, so the numbers always match what a quote would say. */
function WorkedExamples({ p }: { p: Pricing }) {
  const ex = [
    { title: '500 solar lanterns → Kumasi', origin: 'CN' as Origin, spec: 'From a Shenzhen factory · USB-charging, 5 W panel, boxed', unit: 28.5, qty: 500, freight: 420, insurance: 25, mode: 'ocean', days: '~45 days door to door' },
    { title: '300 school uniforms → Accra', origin: 'GB' as Origin, spec: 'From a Manchester wholesaler · shirts and skirts, sizes 6–14', unit: 6.5, qty: 300, freight: 310, insurance: 20, mode: 'ocean', days: '~25 days to port' },
    { title: '4 standby generators → Lagos', origin: 'US' as Origin, spec: 'From a Texas dealer · 9 kW dual-fuel, crated', unit: 899, qty: 4, freight: 640, insurance: 45, mode: 'ocean', days: '~30 days to port' },
  ]
  const rate = (o: Origin) => (o === 'CN' ? p.cnyPerUsd : o === 'GB' ? p.gbpPerUsd || 0.79 : 1)
  const rows = ex.map((e) => { const factory = (e.unit * e.qty) / rate(e.origin); const fee = Math.max(p.minFeeUsd, factory * p.servicePct); const total = factory + fee + p.inspectionUsd + p.handlingUsd + e.freight + e.insurance; return { ...e, factory, fee, total, deposit: fee + p.inspectionUsd + factory * p.depositPct } })
  return (
    <section className="mx-auto mt-14 max-w-5xl" data-testid="worked-examples">
      <p className="eyebrow mb-2 text-center">What it actually costs</p>
      <h2 className="text-center !text-2xl">One order from each country, priced the way we price yours</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{rows.map((r) => (
        <div key={r.title} className="card-dark flex flex-col p-5 text-sm"><p className="font-semibold">{r.title}</p><p className="text-xs text-text-muted">{r.spec} · {r.days}</p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xs"><dt className="text-text-muted"><Flag code={r.origin} /> Goods ({localPrice(r.unit, r.origin)} × {r.qty.toLocaleString()})</dt><dd className="tabular-nums">{usd2(r.factory)}</dd><dt className="text-text-muted">Ntemtem fee</dt><dd className="tabular-nums">{usd2(r.fee)}</dd><dt className="text-text-muted">Inspection + {ORIGINS[r.origin].hub} handling</dt><dd className="tabular-nums">{usd2(p.inspectionUsd + p.handlingUsd)}</dd><dt className="text-text-muted">{r.mode === 'air' ? 'Air' : 'Ocean'} freight + insurance</dt><dd className="tabular-nums">{usd2(r.freight + r.insurance)}</dd><dt className="mt-1 border-t border-border pt-1 font-semibold">Landed total</dt><dd className="mt-1 border-t border-border pt-1 font-semibold tabular-nums">{usd2(r.total)}</dd></dl>
          <p className="mt-2 text-xs text-text-muted">≈ {usd2(r.total / r.qty)} per unit landed · deposit {usd2(r.deposit)}, balance after inspection</p>
          <div className="flex-1" /><Link to={`/sourcing/new?tier=order&from=${r.origin}`} className="btn-ghost mt-4 !min-h-9 text-sm">Start one like this</Link></div>))}</div>
      <p className="mt-3 text-center text-xs text-text-muted">Illustrative orders priced with today's rates (¥{p.cnyPerUsd}/$, £{p.gbpPerUsd}/$, {Math.round(p.servicePct * 100)}% fee, min {money(p.minFeeUsd)}). Duty and delivery to the door are quoted separately.</p>
    </section>
  )
}

/* ================= new request ================= */
export function SourcingNew() {
  const { user, ready } = useStore(); const [sp] = useSearchParams(); const nav = useNavigate()
  const [f, setF] = useState<RequestInput>({ tier: (['find', 'order', 'door'].includes(sp.get('tier') ?? '') ? sp.get('tier') : 'order') as Tier, origin: (ORIGIN_CODES.includes((sp.get('from') ?? '').toUpperCase() as Origin) ? (sp.get('from') ?? '').toUpperCase() : 'CN') as Origin, title: '', description: '', links: [], quantity: 100, unit: 'pcs', targetPriceUsd: null, destination: 'GH', destinationCity: '', mode: 'either', deadline: null, contactName: '', contactEmail: '', contactPhone: '', company: '' })
  const [link, setLink] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [ref, setRef] = useState<Reference | null>(null); const [importing, setImporting] = useState(false); const [hint, setHint] = useState('')
  const importLink = async () => {
    const url = link.trim(); if (!url) return; setImporting(true); setHint(''); setError('')
    try { const r = await sourcingApi.importLink(url); setRef(r.reference); setHint(r.hint); setF((x) => ({ ...x, origin: r.origin ?? x.origin, title: x.title || r.reference.title, description: x.description || r.description, targetPriceUsd: x.targetPriceUsd ?? r.reference.priceUsd, quantity: r.reference.moq && x.quantity < r.reference.moq ? r.reference.moq : x.quantity, links: x.links.includes(url) ? x.links : [...x.links, url] })); setLink('') } catch (er) { setError(err(er, 'Could not read that link.')) } finally { setImporting(false) }
  }
  useEffect(() => { if (user) setF((x) => ({ ...x, contactName: x.contactName || user.name, contactEmail: x.contactEmail || user.email })) }, [user])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/sourcing/new${sp.toString() ? `?${sp}` : ''}`)}`} replace />
  if (user.role !== 'customer') return <div className="container-x py-24 text-center text-text-muted">Sourcing requests are filed from a customer account.</div>
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const d = await sourcingApi.create({ ...f, links: link.trim() ? [...f.links, link.trim()] : f.links, reference: ref }); nav(`/sourcing/${d.job.id}`) } catch (er) { setError(err(er, 'Could not send the request.')) } finally { setBusy(false) } }
  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF({ ...f, [k]: v })
  return (
    <div className="bg-bg text-text"><div className="container-x max-w-3xl py-10 md:py-14">
      <p className="eyebrow mb-2">Ntemtem Sourcing</p><h1 className="!text-3xl">What should we source for you?</h1>
      <form onSubmit={submit} className="mt-6 grid gap-5" data-testid="sourcing-form">
        <fieldset className="grid gap-2 sm:grid-cols-3" data-testid="origin-pick"><legend className="mb-1 text-sm font-semibold">Buy from</legend>{ORIGIN_CODES.map((c) => <label key={c} className={`cursor-pointer rounded-xl border p-3 text-sm ${f.origin === c ? 'border-gold bg-gold/10' : 'border-border'}`}><input type="radio" name="origin" className="mr-2" checked={f.origin === c} onChange={() => set('origin', c)} data-testid={`from-${c}`} /><span aria-hidden="true"><Flag code={c} /></span> {ORIGINS[c].name}<span className="mt-1 block text-xs text-text-muted">{ORIGINS[c].platforms}</span></label>)}</fieldset>
        <fieldset className="grid gap-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-semibold">Service</legend>{(['find', 'order', 'door'] as Tier[]).map((t) => <label key={t} className={`cursor-pointer rounded-xl border p-3 text-sm ${f.tier === t ? 'border-gold bg-gold/10' : 'border-border'}`}><input type="radio" name="tier" className="mr-2" checked={f.tier === t} onChange={() => set('tier', t)} />{tierLabels[t]}</label>)}</fieldset>
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm" data-testid="import-box"><p className="font-semibold"><Sparkles size={14} className="mr-1 inline text-gold-deep" aria-hidden="true" /> Have a link? Paste it and we'll fill in the details.</p><div className="mt-2 flex gap-2"><input type="url" className="input-dark flex-1 !min-h-10" placeholder={ORIGINS[f.origin].linkHint} value={link} onChange={(e) => setLink(e.target.value)} data-testid="import-url" /><button type="button" className="btn-gold !min-h-10 text-sm" disabled={importing || !link.trim()} onClick={importLink} data-testid="import-btn">{importing ? 'Reading…' : 'Import'}</button></div>
          {ref && <div className="mt-3 flex items-start gap-3" data-testid="import-result">{ref.image && <img src={ref.image} alt="" className="h-16 w-16 rounded-lg object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}<div className="text-xs"><p className="font-semibold">{ref.title || 'Listing saved'} <span className="font-normal text-text-muted">· {ref.platform}{ref.productId ? ` #${ref.productId}` : ''}</span></p><p className="text-text-muted">{ref.price != null && ref.currency && ref.currency !== 'USD' ? `Listed at ${ref.currency === 'GBP' ? '£' : '¥'}${ref.price.toLocaleString()} ≈ ${usd2(ref.priceUsd ?? 0)} per unit` : ref.priceUsd != null ? `Listed at ${usd2(ref.priceUsd)} per unit` : 'No price found'}{ref.origin ? ` · buying in ${ORIGINS[ref.origin].name}` : ''}{ref.moq ? ` · MOQ ${ref.moq.toLocaleString()}` : ''}</p>{hint && <p className="mt-1 text-text-muted">{hint}</p>}</div></div>}</div>
        <label className="grid gap-1 text-sm"><span className="font-semibold">Product</span><input required minLength={3} className="input-dark" placeholder="e.g. Solar lanterns with USB charging" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="src-title" /></label>
        <label className="grid gap-1 text-sm"><span className="font-semibold">Details</span><textarea required minLength={10} rows={4} className="input-dark" placeholder="Specs, materials, colours, packaging, certifications, branding… anything the supplier needs to quote accurately." value={f.description} onChange={(e) => set('description', e.target.value)} data-testid="src-desc" /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Quantity</span><input type="number" min={1} required className="input-dark" value={f.quantity} onChange={(e) => set('quantity', Number(e.target.value))} /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Unit</span><input className="input-dark" value={f.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs, sets, cartons" /></label>
          <label className="grid gap-1 text-sm"><span className="font-semibold">Target price (USD / unit)</span><input type="number" min={0} step="0.01" className="input-dark" value={f.targetPriceUsd ?? ''} onChange={(e) => set('targetPriceUsd', e.target.value ? Number(e.target.value) : null)} placeholder="optional" /></label>
        </div>
        <div className="grid gap-2 text-sm"><span className="font-semibold">More links (optional)</span>
          {f.links.map((l, i) => <div key={i} className="flex items-center gap-2 text-xs"><Paperclip size={12} aria-hidden="true" /><a href={l} target="_blank" rel="noreferrer" className="truncate text-gold-deep hover:underline">{l}</a><button type="button" className="text-text-muted hover:text-danger" aria-label="Remove link" onClick={() => set('links', f.links.filter((_, k) => k !== i))}><Trash2 size={12} /></button></div>)}
          <div className="flex gap-2"><input type="url" className="input-dark flex-1" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} /><button type="button" className="btn-ghost !min-h-10 text-sm" onClick={() => { if (link.trim()) { set('links', [...f.links, link.trim()]); setLink('') } }}>Add</button></div></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm"><span className="font-semibold">Ship to</span><select className="input-dark" value={f.destination} onChange={(e) => set('destination', e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
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
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-text-muted">No charge to ask. You only pay once you accept a quote.</p><button disabled={busy} className="btn-gold disabled:opacity-60" data-testid="src-submit">{busy ? 'Sending…' : `Send to our ${ORIGINS[f.origin].short} team`}</button></div>
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
    setBusy('verify'); sourcingApi.verify(id, paid).then((p) => { setToast(p.status === 'held' || p.status === 'released' ? 'Payment received — it is held safely by Ntemtem.' : 'We are confirming your payment; this page will update shortly.'); window.dispatchEvent(new Event(NOTIFY_EVENT)); return load() }).catch((e) => setError(err(e, 'Could not confirm the payment.'))).finally(() => setBusy(''))
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
        <div><p className="eyebrow mb-1">{j.ref} · {j.tierLabel} · <span data-testid="job-origin"><Flag code={j.origin ?? 'CN'} /> from {ORIGINS[j.origin ?? 'CN'].name}</span></p><h1 className="!text-2xl md:!text-3xl">{j.title}</h1><p className="mt-1 text-sm text-text-muted">{j.quantity.toLocaleString()} {j.unit} → {j.destinationName}{j.destinationCity ? `, ${j.destinationCity}` : ''}{j.targetPriceUsd ? ` · target ${usd2(j.targetPriceUsd)}/unit` : ''}{j.deadline ? ` · needed by ${j.deadline}` : ''}{team && j.customer ? ` · for ${j.customer.name}${j.customer.company ? ` (${j.customer.company})` : ''}` : ''}</p></div>
        <Pill tone={tone(j.status)}>{j.statusLabel ?? stepLabels[j.status]}</Pill>
      </div>
      {toast && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {/* stepper */}
      <ol className="mt-5 flex gap-1 overflow-x-auto pb-1" aria-label="Progress" data-testid="stepper">{steps.map((s, i) => <li key={s} className={`flex min-w-[7.5rem] shrink-0 flex-col gap-1 text-[11px] ${i <= idx ? 'text-text' : 'text-text-muted'}`}><span className={`h-1 rounded-full ${i < idx ? 'bg-teal' : i === idx ? 'bg-gold' : 'bg-surface-2'}`} />{stepLabels[s]}</li>)}</ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {j.agent && <div className="card-dark flex items-center gap-3 p-4" data-testid="agent-card"><UserCheck size={18} className="text-teal" aria-hidden="true" /><div className="text-sm"><p className="font-semibold">{j.agent.name} <span className="text-text-muted">· your sourcing agent{j.agent.city ? ` in ${j.agent.city}` : ''}</span></p><p className="text-xs text-text-muted">Message them below — replies usually within a few hours, {j.origin === 'GB' ? 'UK' : j.origin === 'US' ? 'US Central' : 'China'} time.</p></div></div>}
          {team && !j.agent && !closed && <div className="card-dark flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm">No agent yet.</p><button className="btn-gold !min-h-9 text-sm" disabled={!!busy} onClick={() => act(() => sourcingApi.assign(j.id, null), 'You took this request.', 'claim')} data-testid="claim">Take this request</button></div>}
          <section className="card-dark p-5"><p className="eyebrow mb-2">Request{j.parentRef ? <span className="ml-2 normal-case tracking-normal text-text-muted">· repeat of {j.parentRef}</span> : null}</p>
            {j.reference && <div className="mb-3 flex items-start gap-3 rounded-lg bg-surface-2/60 p-3 text-xs" data-testid="reference-card">{j.reference.image && <img src={j.reference.image} alt="" className="h-14 w-14 rounded-md object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}<div><p className="font-semibold">{j.reference.title || 'Reference listing'} <span className="font-normal text-text-muted">· {j.reference.platform}{j.reference.productId ? ` #${j.reference.productId}` : ''}</span></p><p className="text-text-muted">{j.reference.price != null && j.reference.currency && j.reference.currency !== 'CNY' ? `Listed ${j.reference.currency === 'GBP' ? '£' : '$'}${j.reference.price.toLocaleString()} ≈ ${usd2(j.reference.priceUsd ?? 0)}/unit` : j.reference.priceCny != null ? `Listed ${cny(j.reference.priceCny)} ≈ ${usd2(j.reference.priceUsd ?? 0)}/unit` : 'No listed price'}{j.reference.moq ? ` · MOQ ${j.reference.moq.toLocaleString()}` : ''} · <a className="text-gold-deep hover:underline" href={j.reference.url} target="_blank" rel="noreferrer">open listing</a></p></div></div>}
            <p className="whitespace-pre-wrap text-sm">{j.description}</p>{j.links.length > 0 && <ul className="mt-2 space-y-1 text-xs">{j.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className="text-gold-deep hover:underline">{l}</a></li>)}</ul>}</section>

          {(j.sample || (!team && ['assigned', 'sourcing', 'quoted'].includes(j.status))) && <SampleCard d={d} team={team} busy={busy} act={act} />}
          {/* quotes */}
          <section data-testid="quotes"><div className="flex items-center justify-between"><h2 className="!text-lg">Supplier options</h2>{team && !closed && ['assigned', 'sourcing', 'quoted'].includes(j.status) && <QuoteForm job={j} pricing={d.settings} onAdd={(q) => act(() => sourcingApi.addQuote(j.id, q), 'Option sent to the customer.', 'quote')} />}</div>
            {d.quotes.length === 0 && <p className="mt-2 text-sm text-text-muted">{team ? 'Add the first option once you have prices.' : 'Your agent is contacting factories. Options usually appear within 2–4 days.'}</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">{d.quotes.map((q) => <QuoteCard key={q.id} q={q} job={j} team={team} busy={busy} onAccept={(qty) => act(() => sourcingApi.accept(j.id, q.id, qty), 'Option accepted — pay the deposit to start the order.', 'accept')} onRemove={() => act(() => sourcingApi.removeQuote(j.id, q.id), 'Option removed.', 'rm')} />)}</div></section>

          {j.po && <section className="card-dark p-5 text-sm" data-testid="po"><p className="eyebrow mb-2">{j.origin === 'CN' ? 'Factory order' : 'Purchase order'}</p><dl className="grid gap-2 sm:grid-cols-3"><div><dt className="text-xs text-text-muted">PO</dt><dd className="font-semibold">{j.po.number}</dd></div><div><dt className="text-xs text-text-muted">Supplier</dt><dd>{j.supplierRevealed ? j.po.supplier : 'Vetted factory'}</dd></div><div><dt className="text-xs text-text-muted">Ready by</dt><dd>{j.po.readyBy} · {j.po.incoterm}</dd></div></dl></section>}
          {(j.qc?.result || (team && ['ordered', 'in_production'].includes(j.status))) && <section className="card-dark p-5 text-sm" data-testid="qc"><div className="flex flex-wrap items-center justify-between gap-2"><p className="eyebrow">Quality inspection</p>{j.qc?.result && <Link to={`${team ? '/dashboard' : ''}/sourcing/${j.id}/qc`} className="btn-ghost !min-h-8 text-xs" data-testid="qc-report-link"><Printer size={12} aria-hidden="true" /> Inspection report</Link>}</div>
            {j.qc?.result && <p className="mt-2"><Pill tone={j.qc.result === 'pass' ? 'green' : j.qc.result === 'rework' ? 'gold' : 'danger'}>{j.qc.result}</Pill> <span className="ml-2 text-text-muted">{j.qc.checked ? `${j.qc.checked.toLocaleString()} checked · ${j.qc.defects} defects · ` : ''}{j.qc.by}{j.qc.at ? `, ${fmtDate(j.qc.at)}` : ''}</span></p>}
            {j.qc?.notes && <p className="mt-2">{j.qc.notes}</p>}
            {j.qc?.aql && <p className="mt-2 text-xs text-text-muted">AQL (ISO 2859-1, level II): inspect {j.qc.aql.sampleSize} of {j.quantity.toLocaleString()} — accept up to {j.qc.aql.acceptMajor} major / {j.qc.aql.acceptMinor} minor defects.</p>}
            {team && ['ordered', 'in_production'].includes(j.status) && <Checklist job={j} onSave={(items) => act(() => sourcingApi.checklist(j.id, items), 'Checklist saved.', 'checklist')} />}
            {!team && j.qc?.items && j.qc.items.length > 0 && <ul className="mt-3 grid gap-1 sm:grid-cols-2">{j.qc.items.map((i) => <li key={i.id} className="flex items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full ${i.result === 'pass' ? 'bg-teal' : i.result === 'fail' ? 'bg-danger' : 'bg-surface-2'}`} />{QC_ITEMS.find((x) => x.id === i.id)?.label ?? i.id}{i.note ? <span className="text-text-muted">— {i.note}</span> : null}</li>)}</ul>}</section>}
          {j.receipt && <section className="card-dark p-5 text-sm" data-testid="receipt"><p className="eyebrow mb-2">{ORIGINS[j.origin ?? 'CN'].hub} warehouse receipt</p><p>{j.receipt.cartons} carton{j.receipt.cartons === 1 ? '' : 's'}{j.receipt.grossKg ? ` · ${j.receipt.grossKg} kg` : ''}{j.receipt.cbm ? ` · ${j.receipt.cbm} m³` : ''} · marks {j.receipt.marks}</p><p className="text-xs text-text-muted">{j.receipt.siteName} · {fmtDate(j.receipt.receivedAt)} · {j.receipt.by}</p></section>}
          {j.shipmentId && <section className="card-dark flex flex-wrap items-center justify-between gap-3 p-5 text-sm" data-testid="handoff"><div><p className="eyebrow mb-1">Shipment</p><p className="font-semibold">{j.shipmentRef} <span className="text-text-muted">· {String(j.shipmentStatus).replace(/_/g, ' ')}{j.containerRef ? ` · container ${j.containerRef}` : ''}</span></p></div><Link to={team ? `/dashboard/shipments?q=${j.shipmentRef}&b=all` : `/dashboard?tab=shipments&s=${j.shipmentId}`} className="btn-ghost !min-h-9 text-sm">Open shipment</Link></section>}

          {/* files */}
          <Files d={d} canUpload={!closed} onUploaded={() => load()} />
          {/* messages */}
          <Messages d={d} disabled={closed} onSent={() => load()} />
        </div>

        <aside className="space-y-4">
          <PayCard d={d} team={team} busy={busy} onPay={() => act(async () => { const r = await sourcingApi.checkout(j.id); window.location.assign(r.url) }, '', 'pay')} onRecord={(m, n) => act(() => sourcingApi.record(j.id, m, n), 'Payment recorded.', 'record')} />
          {team && !closed && <TeamActions d={d} busy={busy} onStep={(b) => act(() => sourcingApi.step(j.id, b), 'Updated — the customer has been told.', 'step')} onAssign={(a) => act(() => sourcingApi.assign(j.id, a), 'Reassigned.', 'assign')} />}
          {team && j.acceptedQuoteId && <SupplierLinkCard jobId={j.id} refKey={d.job.status} />}
          {!team && !closed && ['requested', 'assigned', 'sourcing', 'quoted'].includes(j.status) && <button className="btn-ghost w-full text-danger" disabled={!!busy} onClick={() => { const r = prompt('Why are you cancelling? (optional)') ?? ''; void act(() => sourcingApi.cancel(j.id, r), 'Request cancelled.', 'cancel') }}>Cancel request</button>}
          {!closed && ['delivered', 'shipped'].includes(j.status) && <button className="btn-gold w-full" disabled={!!busy} onClick={() => act(() => sourcingApi.close(j.id), 'Closed — thank you!', 'close')} data-testid="close-job">Mark as complete</button>}
          {!team && j.acceptedQuoteId && ['shipped', 'delivered', 'closed'].includes(j.status) && <RepeatCard d={d} busy={busy} act={act} />}
          <section className="card-dark p-4"><p className="eyebrow mb-2">Timeline</p><ul className="space-y-1.5 text-xs text-text-muted" data-testid="timeline">{j.timeline.slice().reverse().map((t, k) => <li key={k}><span className="text-text">{stepLabels[t.status as Job['status']] ?? t.status}</span> · {fmtDateTime(t.at)} · {t.by}{t.note ? ` — ${t.note}` : ''}</li>)}</ul></section>
        </aside>
      </div>
    </div>
  )
}

function QuoteCard({ q, job, team, busy, onAccept, onRemove }: { q: Quote; job: Job; team: boolean; busy: string; onAccept: (qty?: number) => void; onRemove: () => void }) {
  const canAccept = !team && job.status === 'quoted' && !job.acceptedQuoteId
  const [qty, setQty] = useState(q.qty)
  const unitFor = (n: number) => q.tiers.filter((t) => n >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0]?.unitPriceCny ?? (q.tiers.length ? Math.max(q.unitPriceCny, ...q.tiers.map((t) => t.unitPriceCny)) : q.unitPriceCny)
  return (
    <div className={`card-dark p-4 ${q.status === 'rejected' ? 'opacity-60' : ''} ${q.status === 'accepted' ? 'ring-1 ring-gold' : ''}`} data-testid="quote-card">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{q.title}</p><p className="text-xs text-text-muted">{q.supplier ? <>{q.supplier.name}{q.supplier.verified && <BadgeCheck size={12} className="ml-1 inline text-teal" aria-label="Verified" />} · {q.supplier.city}{q.supplier.province ? `, ${q.supplier.province}` : ''}</> : 'Supplier'} · {q.leadDays} days{q.moq ? ` · MOQ ${q.moq.toLocaleString()}` : ''}{q.sampleAvailable ? ' · sample available' : ''}</p></div>{q.status !== 'proposed' && <Pill tone={q.status === 'accepted' ? 'green' : 'muted'}>{q.status}</Pill>}</div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><dt className="text-text-muted">{job.origin === 'CN' ? 'Factory price' : 'Goods price'}</dt><dd className="text-right tabular-nums">{localPrice(q.unitPriceCny, job.origin)} × {q.qty.toLocaleString()} = {usd2(q.factoryUsd)}</dd><dt className="text-text-muted">Ntemtem fee</dt><dd className="text-right tabular-nums">{usd2(q.serviceFeeUsd)}</dd>
        {job.tier !== 'find' && <><dt className="text-text-muted">Inspection + {ORIGINS[job.origin ?? 'CN'].hub} handling</dt><dd className="text-right tabular-nums">{usd2(q.inspectionUsd + q.handlingUsd)}</dd><dt className="text-text-muted">Freight{q.insuranceUsd ? ' + insurance' : ''}</dt><dd className="text-right tabular-nums">{usd2(q.freightUsd + q.insuranceUsd)}</dd>{q.dutyEstUsd > 0 && <><dt className="text-text-muted">Duty & clearance (est.)</dt><dd className="text-right tabular-nums">{usd2(q.dutyEstUsd)}</dd></>}</>}
        <dt className="border-t border-border pt-1 font-semibold">{job.tier === 'find' ? 'Sourcing fee' : 'Landed total'}</dt><dd className="border-t border-border pt-1 text-right font-semibold tabular-nums">{usd2(q.totalUsd)}</dd>
        {job.tier !== 'find' && <><dt className="text-text-muted">Deposit now / balance after QC</dt><dd className="text-right tabular-nums">{usd2(q.depositUsd)} / {usd2(q.balanceUsd)}</dd></>}</dl>
      {q.tiers.length > 0 && <div className="mt-2 rounded-lg bg-surface-2/60 p-2 text-xs" data-testid="price-breaks"><p className="font-semibold">Price breaks</p><ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums"><li>{q.moq ? `${q.moq.toLocaleString()}+` : '1+'}: {localPrice(Math.max(q.unitPriceCny, ...q.tiers.map((t) => t.unitPriceCny)), job.origin)}</li>{q.tiers.map((t) => <li key={t.minQty}>{t.minQty.toLocaleString()}+: {localPrice(t.unitPriceCny, job.origin)}</li>)}</ul>
        {canAccept && <label className="mt-2 flex items-center gap-2"><span className="text-text-muted">Order quantity</span><input type="number" min={q.moq || 1} step={1} className="input-dark !min-h-8 w-28 text-xs" value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="accept-qty" /><span className="text-text-muted">→ {localPrice(unitFor(qty), job.origin)} each ≈ {usd2((unitFor(qty) * qty) / 7.2)} factory{qty !== q.qty ? ' (landed total updates on accept)' : ''}</span></label>}</div>}
      {q.notes && <p className="mt-2 text-xs text-text-muted">{q.notes}</p>}
      {q.supplier && job.supplierRevealed && q.status === 'accepted' && (q.supplier.contact || q.supplier.wechat) && <p className="mt-2 text-xs" data-testid="supplier-contact"><strong>Contact:</strong> {q.supplier.contact}{q.supplier.wechat ? ` · WeChat ${q.supplier.wechat}` : ''}{q.supplier.phone ? ` · ${q.supplier.phone}` : ''}{q.supplier.storefront ? <> · <a className="text-gold-deep hover:underline" href={q.supplier.storefront} target="_blank" rel="noreferrer">storefront</a></> : ''}</p>}
      <div className="mt-3 flex justify-end gap-2">{team && q.status === 'proposed' && <button className="btn-ghost !min-h-8 text-xs text-danger" disabled={!!busy} onClick={onRemove}>Remove</button>}{canAccept && <button className="btn-gold !min-h-9 text-sm" disabled={!!busy || qty < 1} onClick={() => onAccept(qty !== q.qty ? qty : undefined)} data-testid="accept-quote">Accept{qty !== q.qty ? ` ${qty.toLocaleString()} ${job.unit}` : ' this option'}</button>}</div>
    </div>
  )
}

function QuoteForm({ job, pricing, onAdd }: { job: Job; pricing: Detail['settings']; onAdd: (q: QuoteInput) => void }) {
  const [open, setOpen] = useState(false); const [sups, setSups] = useState<Supplier[]>([]); const [q, setQ] = useState<QuoteInput>({ supplierId: '', title: '', unitPriceCny: (job.origin === 'CN' ? job.reference?.priceCny : job.reference?.currency === ORIGINS[job.origin].currency ? job.reference?.price : job.origin === 'US' ? job.reference?.priceUsd : null) ?? 0, qty: job.quantity, moq: job.reference?.moq ?? 0, leadDays: 25, freightUsd: 0, insuranceUsd: 0, dutyEstUsd: 0, notes: '', sampleAvailable: false, tiers: [] })
  const tiers = q.tiers ?? []; const setTier = (i: number, patch: Partial<PriceBreak>) => setQ({ ...q, tiers: tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) })
  useEffect(() => { if (open) sourcingApi.suppliers(undefined, job.origin).then(setSups).catch(() => {}) }, [open, job.origin])
  const factory = q.unitPriceCny * q.qty / (job.origin === 'GB' ? pricing.gbpPerUsd || 0.79 : job.origin === 'US' ? 1 : pricing.cnyPerUsd); const fee = job.tier === 'find' ? pricing.findFeeUsd : Math.max(pricing.minFeeUsd, factory * pricing.servicePct)
  const total = job.tier === 'find' ? fee : factory + fee + pricing.inspectionUsd + pricing.handlingUsd + (q.freightUsd ?? 0) + (q.insuranceUsd ?? 0) + (job.tier === 'door' ? q.dutyEstUsd ?? 0 : 0)
  if (!open) return <button className="btn-gold !min-h-9 text-sm" onClick={() => setOpen(true)} data-testid="add-quote">Add an option</button>
  return (
    <form className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onSubmit={(e) => { e.preventDefault(); onAdd({ ...q, tiers: tiers.filter((t) => t.minQty > 1 && t.unitPriceCny > 0) }); setOpen(false) }} aria-label="Add supplier option">
      <div className="card-dark max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 text-sm">
        <h3 className="!text-lg">Supplier option</h3>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1"><span className="text-xs text-text-muted">Supplier</span><select required className="input-dark !min-h-10" value={q.supplierId} onChange={(e) => setQ({ ...q, supplierId: e.target.value })} data-testid="q-supplier"><option value="">Choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}</select><Link to="/dashboard/suppliers" className="text-xs text-gold-deep hover:underline">Add a new supplier</Link></label>
          <label className="grid gap-1"><span className="text-xs text-text-muted">Option title</span><input required className="input-dark !min-h-10" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} placeholder="e.g. 5 W panel, 2000 mAh, boxed" data-testid="q-title" /></label>
          <div className="grid grid-cols-3 gap-2"><label className="grid gap-1"><span className="text-xs text-text-muted">Unit price ({ORIGINS[job.origin ?? 'CN'].symbol})</span><input type="number" min={0.01} step="0.01" required className="input-dark !min-h-10" value={q.unitPriceCny || ''} onChange={(e) => setQ({ ...q, unitPriceCny: Number(e.target.value) })} data-testid="q-price" /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Qty</span><input type="number" min={1} required className="input-dark !min-h-10" value={q.qty} onChange={(e) => setQ({ ...q, qty: Number(e.target.value) })} /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Lead days</span><input type="number" min={0} required className="input-dark !min-h-10" value={q.leadDays} onChange={(e) => setQ({ ...q, leadDays: Number(e.target.value) })} /></label></div>
          {job.tier !== 'find' && <div className="grid grid-cols-3 gap-2"><label className="grid gap-1"><span className="text-xs text-text-muted">Freight ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={q.freightUsd ?? 0} onChange={(e) => setQ({ ...q, freightUsd: Number(e.target.value) })} data-testid="q-freight" /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Insurance ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={q.insuranceUsd ?? 0} onChange={(e) => setQ({ ...q, insuranceUsd: Number(e.target.value) })} /></label><label className="grid gap-1"><span className="text-xs text-text-muted">Duty est. ($){job.tier !== 'door' ? ' — door only' : ''}</span><input type="number" min={0} disabled={job.tier !== 'door'} className="input-dark !min-h-10" value={q.dutyEstUsd ?? 0} onChange={(e) => setQ({ ...q, dutyEstUsd: Number(e.target.value) })} /></label></div>}
          <label className="grid gap-1"><span className="text-xs text-text-muted">MOQ</span><input type="number" min={0} className="input-dark !min-h-10" value={q.moq ?? 0} onChange={(e) => setQ({ ...q, moq: Number(e.target.value) })} /></label>
          <label className="grid gap-1"><span className="text-xs text-text-muted">Notes for the customer</span><textarea rows={2} className="input-dark" value={q.notes} onChange={(e) => setQ({ ...q, notes: e.target.value })} /></label>
          <div className="grid gap-1 text-xs"><span className="text-text-muted">Price breaks for bigger orders (optional)</span>{tiers.map((t, i) => <div key={i} className="flex items-center gap-2"><input type="number" min={2} className="input-dark !min-h-8 w-28 text-xs" placeholder="from qty" value={t.minQty || ''} onChange={(e) => setTier(i, { minQty: Number(e.target.value) })} data-testid={`tier-qty-${i}`} /><span>→ ¥</span><input type="number" min={0.01} step="0.01" className="input-dark !min-h-8 w-24 text-xs" placeholder="unit" value={t.unitPriceCny || ''} onChange={(e) => setTier(i, { unitPriceCny: Number(e.target.value) })} data-testid={`tier-price-${i}`} /><button type="button" className="text-text-muted hover:text-danger" aria-label="Remove break" onClick={() => setQ({ ...q, tiers: tiers.filter((_, k) => k !== i) })}><Trash2 size={12} /></button></div>)}{tiers.length < 6 && <button type="button" className="btn-ghost !min-h-8 w-fit text-xs" onClick={() => setQ({ ...q, tiers: [...tiers, { minQty: 0, unitPriceCny: 0 }] })} data-testid="tier-add">Add a price break</button>}</div>
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
  const j = d.job; const [f, setF] = useState<StepInput | null>(null); const [agents, setAgents] = useState<{ id: string; name: string }[]>([]); const [containers, setContainers] = useState<OpenContainer[]>([])
  useEffect(() => { sourcingApi.board().then((b) => setAgents(b.agents)).catch(() => {}); sourcingApi.openContainers().then(setContainers).catch(() => {}) }, [])
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
      {!f && <div className="mt-3 flex flex-wrap gap-2">{next.map((n) => <button key={n.status} className="btn-gold !min-h-9 text-xs" disabled={!!busy} onClick={() => setF({ status: n.status, note: '', po: n.status === 'ordered' ? { number: '', incoterm: 'FOB', leadDays: 25 } : undefined, qc: n.status === 'inspected' ? { result: 'pass', checked: 0, defects: 0, notes: '' } : undefined, ship: n.status === 'shipped' ? { mode: j.mode === 'air' ? 'air' : 'ocean', originCity: ORIGINS[j.origin ?? 'CN'].hub, cargo: 'commercial', eta: new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10) } : undefined, receipt: n.status === 'received_cn' ? { cartons: 0, grossKg: 0, cbm: 0, marks: j.ref } : undefined })} data-testid={`step-${n.status}`}>{n.label}</button>)}<button className="btn-ghost !min-h-9 text-xs text-danger" disabled={!!busy} onClick={() => setF({ status: 'cancelled', note: '' })}>Cancel request</button></div>}
      {f && (
        <form onSubmit={submit} className="mt-3 grid gap-2 rounded-lg border border-border p-3" aria-label="Update step">
          <p className="font-semibold">{stepLabels[f.status]}</p>
          {f.po && <div className="grid grid-cols-2 gap-2"><input className="input-dark !min-h-9 text-xs" placeholder="PO number" value={f.po.number ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, number: e.target.value } })} data-testid="po-number" /><select className="input-dark !min-h-9 text-xs" value={f.po.incoterm} onChange={(e) => setF({ ...f, po: { ...f.po, incoterm: e.target.value as 'FOB' } })}><option>EXW</option><option>FOB</option><option>CIF</option><option>DDP</option></select><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Lead days" value={f.po.leadDays ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, leadDays: Number(e.target.value) } })} /><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder={`Paid to ${ORIGINS[j.origin ?? 'CN'].seller} (${ORIGINS[j.origin ?? 'CN'].symbol})`} value={f.po.factoryPaidCny ?? ''} onChange={(e) => setF({ ...f, po: { ...f.po, factoryPaidCny: e.target.value ? Number(e.target.value) : undefined } })} /></div>}
          {f.qc && <div className="grid grid-cols-3 gap-2"><select className="input-dark !min-h-9 text-xs" value={f.qc.result} onChange={(e) => setF({ ...f, qc: { ...f.qc!, result: e.target.value as 'pass' } })} data-testid="qc-result"><option value="pass">Pass</option><option value="rework">Rework needed</option><option value="fail">Fail</option></select><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Checked" value={f.qc.checked ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, checked: Number(e.target.value) } })} /><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Defects" value={f.qc.defects ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, defects: Number(e.target.value) } })} /><textarea rows={2} className="input-dark col-span-3 text-xs" placeholder="Findings (shown to the customer)" value={f.qc.notes ?? ''} onChange={(e) => setF({ ...f, qc: { ...f.qc!, notes: e.target.value } })} /></div>}
          {f.ship && <div className="grid grid-cols-2 gap-2"><select className="input-dark !min-h-9 text-xs" value={f.ship.mode} onChange={(e) => setF({ ...f, ship: { ...f.ship!, mode: e.target.value as 'ocean' } })}><option value="ocean">Ocean</option><option value="air">Air</option></select><input type="date" required className="input-dark !min-h-9 text-xs" value={f.ship.eta} onChange={(e) => setF({ ...f, ship: { ...f.ship!, eta: e.target.value } })} data-testid="ship-eta" /><input className="input-dark !min-h-9 text-xs" placeholder="Origin city" value={f.ship.originCity ?? ''} onChange={(e) => setF({ ...f, ship: { ...f.ship!, originCity: e.target.value } })} /><select className="input-dark !min-h-9 text-xs" value={f.ship.cargo} onChange={(e) => setF({ ...f, ship: { ...f.ship!, cargo: e.target.value } })}><option value="commercial">Commercial cargo</option><option value="boxes">Boxes</option><option value="pallets">Pallets</option><option value="container20">20 ft container</option><option value="container40">40 ft container</option></select><input className="input-dark !min-h-9 text-xs col-span-2" placeholder={f.ship.mode === 'air' ? 'Flight number (optional)' : 'Vessel name (optional)'} value={(f.ship.mode === 'air' ? f.ship.flight : f.ship.vesselName) ?? ''} onChange={(e) => setF({ ...f, ship: { ...f.ship!, ...(f.ship!.mode === 'air' ? { flight: e.target.value } : { vesselName: e.target.value }) } })} /></div>}
          {f.receipt && <div className="grid grid-cols-2 gap-2"><input type="number" min={0} className="input-dark !min-h-9 text-xs" placeholder="Cartons" value={f.receipt.cartons || ''} onChange={(e) => setF({ ...f, receipt: { ...f.receipt, cartons: Number(e.target.value) } })} data-testid="rc-cartons" /><input type="number" min={0} step="0.1" className="input-dark !min-h-9 text-xs" placeholder="Gross kg" value={f.receipt.grossKg || ''} onChange={(e) => setF({ ...f, receipt: { ...f.receipt, grossKg: Number(e.target.value) } })} /><input type="number" min={0} step="0.01" className="input-dark !min-h-9 text-xs" placeholder="Volume m³" value={f.receipt.cbm || ''} onChange={(e) => setF({ ...f, receipt: { ...f.receipt, cbm: Number(e.target.value) } })} /><input className="input-dark !min-h-9 text-xs" placeholder="Shipping marks" value={f.receipt.marks ?? ''} onChange={(e) => setF({ ...f, receipt: { ...f.receipt, marks: e.target.value } })} /></div>}
          {f.ship && f.ship.mode === 'ocean' && containers.length > 0 && <label className="grid gap-1 text-xs"><span className="text-text-muted">Consolidate into one of our containers (optional)</span><select className="input-dark !min-h-9 text-xs" value={f.containerId ?? ''} onChange={(e) => setF({ ...f, containerId: e.target.value || undefined })} data-testid="ship-container"><option value="">— ship on its own —</option>{containers.map((c) => <option key={c.id} value={c.id}>{c.ref}{c.number ? ` ${c.number}` : ''} · {c.size} → {c.destinationPort || c.destination} · {c.loaded} loaded{c.cutoffDate ? ` · cut-off ${c.cutoffDate}` : ''}</option>)}</select></label>}
          {f.status === 'cancelled' && d.payments.some((p) => ['held', 'released'].includes(p.status)) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f.refund} onChange={(e) => setF({ ...f, refund: e.target.checked })} /> Refund collected payments (admin)</label>}
          <input className="input-dark !min-h-9 text-xs" placeholder="Note for the customer (optional)" value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="step-note" />
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-9 text-xs" onClick={() => setF(null)}>Back</button><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} data-testid="step-save">Save</button></div>
        </form>
      )}
    </section>
  )
}

/** Agent: the factory's private link (send it on WeChat) and what the factory has posted through it. */
function SupplierLinkCard({ jobId, refKey }: { jobId: string; refKey: string }) {
  const [link, setLink] = useState<SupplierLink | null>(null); const [updates, setUpdates] = useState<SupplierUpdate[]>([]); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState(false); const [err, setErr] = useState('')
  const load = () => sourcingApi.supplierLink(jobId).then((r) => { setLink(r.link); setUpdates(r.updates) }).catch(() => {})
  useEffect(() => { load() }, [jobId, refKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => { setBusy(true); setErr(''); try { const r = await sourcingApi.createSupplierLink(jobId); setLink(r.link) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.') } finally { setBusy(false) } }
  const revoke = async () => { setBusy(true); try { await sourcingApi.revokeSupplierLink(jobId); setLink(null) } finally { setBusy(false) } }
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ } }
  const labels: Record<SupplierUpdate['kind'], string> = { confirm: 'Confirmed the order', progress: 'Progress', ready: 'Goods ready', delay: 'Delay', note: 'Note' }
  return (
    <section className="card-dark p-4 text-sm" data-testid="supplier-link-card">
      <p className="eyebrow mb-2">Factory link</p>
      {err && <p role="alert" className="mb-2 text-xs text-danger">{err}</p>}
      {link ? (
        <>
          <p className="text-xs text-text-muted">Send this on WeChat. The factory confirms the PO, posts progress and photos, and moves the ready date — all of it lands on the timeline and pings you.</p>
          <div className="mt-2 flex items-center gap-2"><input readOnly className="input-dark !min-h-9 flex-1 font-mono text-[11px]" value={link.url} data-testid="supplier-link-url" onFocus={(e) => e.currentTarget.select()} /><button className="btn-gold !min-h-9 text-xs" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
          <p className="mt-1 text-[11px] text-text-muted">Created {fmtDate(link.createdAt)}{link.lastSeenAt ? ` · factory last opened it ${fmtDateTime(link.lastSeenAt)}` : ' · not opened yet'} · <button className="underline hover:text-danger" onClick={revoke} disabled={busy}>revoke</button></p>
        </>
      ) : (
        <><p className="text-xs text-text-muted">Give the factory a private page for this PO: confirm, progress %, photos, ready date, delays.</p><button className="btn-gold mt-2 !min-h-9 text-xs" onClick={create} disabled={busy} data-testid="create-supplier-link"><Factory size={14} aria-hidden="true" /> Create factory link</button></>
      )}
      {updates.length > 0 && <ul className="mt-3 divide-y divide-border" aria-label="Factory updates">{updates.slice(0, 6).map((u) => <li key={u.id} className="py-1.5 text-xs"><span className={`font-semibold ${u.kind === 'delay' ? 'text-danger' : ''}`}>{labels[u.kind]}</span>{u.pct != null ? ` · ${u.pct}%` : ''}{u.readyBy ? ` · ready ${fmtDate(u.readyBy)}` : ''}{u.body ? ` — ${u.body}` : ''}<span className="text-text-muted"> · {u.by}, {fmtDateTime(u.at)}</span></li>)}</ul>}
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
    <section data-testid="messages"><h2 className="!text-lg"><MessageSquare size={16} className="mr-1 inline text-gold-deep" aria-hidden="true" /> Messages</h2>
      <ul className="mt-3 space-y-2">{d.messages.length === 0 && <li className="text-sm text-text-muted">Ask about samples, packaging, branding, timing — your agent replies here.</li>}{d.messages.map((m) => <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.mine ? 'ml-auto bg-gold/15' : 'bg-surface-2'}`} data-testid="message"><p className="text-[11px] text-text-muted">{m.author}{m.role !== 'customer' ? ' · Ntemtem Sourcing' : ''} · {fmtDateTime(m.at)}</p><p className="whitespace-pre-wrap">{m.body}</p></li>)}</ul>
      {!disabled && <form onSubmit={send} className="mt-3 flex gap-2"><input className="input-dark flex-1 !min-h-10 text-sm" placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} data-testid="message-input" /><button className="btn-gold !min-h-10 !px-4 text-sm" disabled={busy || !body.trim()} data-testid="message-send">Send</button></form>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  )
}

function SampleCard({ d, team, busy, act }: { d: Detail; team: boolean; busy: string; act: (fn: () => Promise<unknown>, msg: string, key: string) => Promise<void> }) {
  const j = d.job; const sm = j.sample; const [note, setNote] = useState(''); const [addr, setAddr] = useState(''); const [cost, setCost] = useState(''); const [courier, setCourier] = useState('DHL'); const [trk, setTrk] = useState(''); const [open, setOpen] = useState(false)
  const canRequest = !team && ['assigned', 'sourcing', 'quoted'].includes(j.status) && (!sm || ['approved', 'rejected'].includes(sm.status))
  return (
    <section className="card-dark p-5 text-sm" data-testid="sample-card">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="eyebrow"><FlaskConical size={12} className="mr-1 inline" aria-hidden="true" /> Sample</p>{sm && <Pill tone={sm.status === 'approved' ? 'green' : sm.status === 'rejected' ? 'danger' : sm.status === 'quoted' ? 'gold' : 'sky'}>{sm.status}</Pill>}</div>
      {!sm && !open && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-text-muted">Want to see one before you order 1,000? We'll courier a sample — you only pay the factory charge, courier and a small handling fee.</p>{canRequest && <button className="btn-ghost !min-h-9 text-xs" onClick={() => setOpen(true)} data-testid="sample-request">Request a sample</button>}</div>}
      {sm && <div className="mt-2 space-y-1">
        {sm.note && <p><span className="text-text-muted">Asked for:</span> {sm.note}</p>}
        {sm.costUsd != null && <p><span className="text-text-muted">Cost:</span> {usd2(sm.costUsd)} <span className="text-xs text-text-muted">(factory & courier {usd2(sm.factoryUsd ?? 0)} + handling {usd2(sm.handlingUsd ?? 0)})</span>{sm.quoteNote ? ` — ${sm.quoteNote}` : ''}</p>}
        {sm.courier && <p><span className="text-text-muted">Shipped:</span> {sm.courier}{sm.tracking ? ` · ${sm.tracking}` : ''}{sm.shipNote ? ` — ${sm.shipNote}` : ''}</p>}
        {sm.feedback && <p><span className="text-text-muted">Your verdict:</span> {sm.feedback}</p>}
        {sm.status === 'quoted' && !team && <p className="text-xs text-text-muted">Pay for the sample from the Payments card on the right.</p>}
      </div>}
      {open && canRequest && <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => sourcingApi.sampleRequest(j.id, note, addr), 'Sample requested — your agent will quote the cost.', 'sample'); setOpen(false) }}><input className="input-dark !min-h-9 text-xs" placeholder="Which variant / colour / size?" value={note} onChange={(e) => setNote(e.target.value)} data-testid="sample-note" /><input className="input-dark !min-h-9 text-xs" placeholder="Courier address" value={addr} onChange={(e) => setAddr(e.target.value)} /><div className="flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-9 text-xs" onClick={() => setOpen(false)}>Cancel</button><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} data-testid="sample-send">Send request</button></div></form>}
      {team && sm?.status === 'requested' && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => sourcingApi.sampleQuote(j.id, Number(cost), note), 'Sample quoted.', 'sample') }}><input type="number" min={0} step="0.01" required className="input-dark !min-h-9 w-32 text-xs" placeholder="Factory + courier $" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="sample-cost" /><input className="input-dark !min-h-9 flex-1 text-xs" placeholder="Note (courier, days)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} data-testid="sample-quote">Quote sample</button></form>}
      {team && sm?.status === 'paid' && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => sourcingApi.sampleShip(j.id, courier, trk, note), 'Sample marked shipped.', 'sample') }}><input required className="input-dark !min-h-9 w-28 text-xs" placeholder="Courier" value={courier} onChange={(e) => setCourier(e.target.value)} /><input className="input-dark !min-h-9 flex-1 text-xs" placeholder="Tracking number" value={trk} onChange={(e) => setTrk(e.target.value)} data-testid="sample-tracking" /><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} data-testid="sample-ship">Mark shipped</button></form>}
      {!team && sm?.status === 'shipped' && <div className="mt-3 flex flex-wrap gap-2"><input className="input-dark !min-h-9 flex-1 text-xs" placeholder="What did you think?" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn-gold !min-h-9 text-xs" disabled={!!busy} onClick={() => act(() => sourcingApi.sampleFeedback(j.id, 'approved', note), 'Sample approved.', 'sample')} data-testid="sample-approve">Approve</button><button className="btn-ghost !min-h-9 text-xs text-danger" disabled={!!busy} onClick={() => act(() => sourcingApi.sampleFeedback(j.id, 'rejected', note), 'Noted — your agent will look for alternatives.', 'sample')}>Reject</button></div>}
    </section>
  )
}

function Checklist({ job, onSave }: { job: Job; onSave: (items: QcItem[]) => void }) {
  const [items, setItems] = useState<QcItem[]>(() => QC_ITEMS.map((i) => job.qc?.items?.find((x) => x.id === i.id) ?? { id: i.id, result: 'na' as const, note: '' }))
  const set = (id: string, patch: Partial<QcItem>) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  return (
    <form className="mt-3 grid gap-1.5" onSubmit={(e) => { e.preventDefault(); onSave(items) }} data-testid="checklist">
      <p className="text-xs text-text-muted"><ClipboardCheck size={12} className="mr-1 inline" aria-hidden="true" /> Inspection checklist — fill it in at the factory, then record the result from Team actions.</p>
      {items.map((i) => <div key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs sm:grid-cols-[1fr_auto_12rem]"><span>{QC_ITEMS.find((x) => x.id === i.id)?.label}</span><div className="flex gap-1" role="radiogroup" aria-label={QC_ITEMS.find((x) => x.id === i.id)?.label}>{(['pass', 'fail', 'na'] as const).map((r) => <button type="button" key={r} role="radio" aria-checked={i.result === r} onClick={() => set(i.id, { result: r })} className={`rounded-md px-2 py-1 ${i.result === r ? (r === 'pass' ? 'bg-teal text-on-accent' : r === 'fail' ? 'bg-danger text-on-accent' : 'bg-surface-2 text-text') : 'bg-surface-2/50 text-text-muted'}`} data-testid={`ck-${i.id}-${r}`}>{r === 'na' ? 'n/a' : r}</button>)}</div><input className="input-dark !min-h-8 text-xs sm:col-span-1 col-span-2" placeholder="note" value={i.note ?? ''} onChange={(e) => set(i.id, { note: e.target.value })} /></div>)}
      <div className="flex justify-end"><button className="btn-ghost !min-h-8 text-xs" data-testid="ck-save">Save checklist</button></div>
    </form>
  )
}

/* ================= printable inspection report ================= */
export function QcReportPage() {
  const { id = '' } = useParams(); const nav = useNavigate(); const [r, setR] = useState<QcReport | null>(null); const [error, setError] = useState('')
  useEffect(() => { sourcingApi.qcReport(id).then(setR).catch((e) => setError(err(e, 'Not found.'))) }, [id])
  if (error) return <div className="container-x py-16 text-center text-danger">{error}</div>
  if (!r) return <div className="container-x py-16 text-center text-text-muted">Loading…</div>
  const j = r.job; const qc = r.qc
  return (
    <div className="container-x max-w-3xl py-6 print:max-w-none" data-testid="qc-report">
      <div className="flex items-center justify-between print:hidden"><button onClick={() => nav(-1)} className="text-xs text-text-muted hover:text-text">← Back</button><button className="btn-ghost !min-h-9 text-sm" onClick={() => window.print()}><Printer size={14} aria-hidden="true" /> Print / save PDF</button></div>
      <div className="card-dark mt-4 p-6 print:border-0 print:shadow-none">
        <p className="eyebrow">Ntemtem Sourcing · Quality inspection report</p>
        <h1 className="!text-2xl">{j.title}</h1>
        <p className="text-sm text-text-muted">{j.ref} · {j.quantity.toLocaleString()} {j.unit}{r.po ? ` · PO ${r.po.number}` : ''}{r.supplier ? ` · ${r.supplier.name}, ${r.supplier.city}` : ''}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-text-muted">Result</dt><dd>{qc?.result ? <Pill tone={qc.result === 'pass' ? 'green' : qc.result === 'rework' ? 'gold' : 'danger'}>{qc.result}</Pill> : '—'}</dd></div>
          <div><dt className="text-xs text-text-muted">Inspected</dt><dd className="tabular-nums">{qc?.checked?.toLocaleString() ?? '—'} units · {qc?.defects ?? 0} defects</dd></div>
          <div><dt className="text-xs text-text-muted">AQL plan (ISO 2859-1, II)</dt><dd className="tabular-nums">sample {r.aql.sampleSize} · accept ≤{r.aql.acceptMajor} major / ≤{r.aql.acceptMinor} minor</dd></div>
          <div><dt className="text-xs text-text-muted">Inspector</dt><dd>{qc?.by ?? '—'}{qc?.at ? `, ${fmtDate(qc.at)}` : ''}</dd></div>
        </dl>
        <table className="mt-5 w-full text-sm"><thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="py-2">Check</th><th className="py-2">Result</th><th className="py-2">Notes</th></tr></thead><tbody>{r.checklist.map((c) => <tr key={c.id} className="border-b border-border/60"><td className="py-2">{c.label}</td><td className="py-2">{c.result ? <Pill tone={c.result === 'pass' ? 'green' : c.result === 'fail' ? 'danger' : 'muted'}>{c.result === 'na' ? 'n/a' : c.result}</Pill> : <span className="text-text-muted">not checked</span>}</td><td className="py-2 text-text-muted">{c.note ?? ''}</td></tr>)}</tbody></table>
        {qc?.notes && <p className="mt-4 text-sm"><strong>Findings:</strong> {qc.notes}</p>}
        {r.photos.length > 0 && <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Photos</p><ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">{r.photos.map((p) => <li key={p.id}><img src={p.url} alt={p.title} className="aspect-square w-full rounded-lg object-cover" /><p className="mt-1 text-xs text-text-muted">{p.title} · {p.by}</p></li>)}</ul></div>}
        <p className="mt-6 text-[11px] text-text-muted">Inspection performed by Ntemtem Sourcing on behalf of the buyer at the factory before release. Sample plan per ISO 2859-1 general inspection level II, normal severity, AQL 2.5 major / 4.0 minor.</p>
      </div>
    </div>
  )
}

/* ================= earnings (team) ================= */
export function Earnings() {
  const [d, setD] = useState<Awaited<ReturnType<typeof sourcingApi.earnings>> | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState('')
  const load = () => sourcingApi.earnings().then(setD).catch((e) => setError(err(e, 'Could not load.')))
  useEffect(() => { void load() }, [])
  const pay = async (e: Earning) => { setBusy(e.id); try { await sourcingApi.markEarningPaid(e.id, prompt('Payment reference (optional)') ?? ''); await load() } catch (er) { setError(err(er, 'Could not update.')) } finally { setBusy('') } }
  return (
    <section className="mt-8" data-testid="earnings">
      <h2 className="!text-lg"><Wallet size={16} className="mr-1 inline text-gold-deep" aria-hidden="true" /> {d?.isAdmin ? 'Agent commissions' : 'My commissions'}</h2>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {d && <p className="mt-1 text-sm text-text-muted">Earned, awaiting payout: <strong className="text-text">{usd2(d.totals.earnedUsd)}</strong> · paid to date {usd2(d.totals.paidUsd)}. Commission is a share of the service fee, earned when the order ships.</p>}
      <ul className="mt-3 divide-y divide-border text-sm">{d?.earnings.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><p>{e.ref} · {e.title}{d.isAdmin ? ` · ${e.agentName}` : ''}</p><p className="text-xs text-text-muted">{e.note} · {e.earnedAt ? fmtDate(e.earnedAt) : ''}</p></div><div className="flex items-center gap-2"><span className="tabular-nums font-semibold">{usd2(e.amountUsd)}</span><Pill tone={e.status === 'paid' ? 'green' : 'gold'}>{e.status}</Pill>{d.isAdmin && e.status === 'earned' && <button className="btn-ghost !min-h-8 text-xs" disabled={!!busy} onClick={() => pay(e)} data-testid="earning-pay">Mark paid</button>}</div></li>)}{d && d.earnings.length === 0 && <li className="py-3 text-sm text-text-muted">No commissions yet — they appear when a job you handled ships.</li>}</ul>
    </section>
  )
}

function AuditForm({ s, onDone }: { s: Supplier; onDone: () => void }) {
  const [a, setA] = useState<Audit>({ date: new Date().toISOString().slice(0, 10), score: 80, result: 'pass', findings: '', categories: { quality: 8, capacity: 8, social: 8 } }); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [hist, setHist] = useState<Audit[] | null>(null)
  useEffect(() => { sourcingApi.audits(s.id).then(setHist).catch(() => setHist([])) }, [s.id])
  const save = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await sourcingApi.addAudit(s.id, a); onDone() } catch (er) { setError(err(er, 'Could not save.')) } finally { setBusy(false) } }
  return (
    <form onSubmit={save} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" aria-label="Factory audit"><div className="card-dark max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 text-sm"><h3 className="!text-lg">Factory audit — {s.name}</h3>
      {hist && hist.length > 0 && <ul className="mt-2 text-xs text-text-muted">{hist.map((h) => <li key={h.id}>{h.date} · {h.score}/100 · {h.result} · {h.auditor}</li>)}</ul>}
      <div className="mt-3 grid grid-cols-3 gap-2"><input type="date" required className="input-dark !min-h-10" value={a.date} onChange={(e) => setA({ ...a, date: e.target.value })} /><input type="number" min={0} max={100} required className="input-dark !min-h-10" value={a.score} onChange={(e) => setA({ ...a, score: Number(e.target.value) })} data-testid="audit-score" /><select className="input-dark !min-h-10" value={a.result} onChange={(e) => setA({ ...a, result: e.target.value as Audit['result'] })}><option value="pass">Pass</option><option value="conditional">Conditional</option><option value="fail">Fail</option></select></div>
      <div className="mt-2 grid grid-cols-3 gap-2">{['quality', 'capacity', 'social'].map((k) => <label key={k} className="grid gap-1 text-xs"><span className="capitalize text-text-muted">{k} /10</span><input type="number" min={0} max={10} className="input-dark !min-h-9" value={a.categories?.[k] ?? 0} onChange={(e) => setA({ ...a, categories: { ...a.categories, [k]: Number(e.target.value) } })} /></label>)}</div>
      <textarea rows={3} className="input-dark mt-2 w-full" placeholder="Findings: certificates seen, production lines, workforce, housekeeping, red flags" value={a.findings} onChange={(e) => setA({ ...a, findings: e.target.value })} />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost !min-h-10 text-sm" onClick={onDone}>Cancel</button><button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="audit-save">{busy ? 'Saving…' : 'Save audit'}</button></div></div></form>
  )
}

function RepeatCard({ d, busy, act }: { d: Detail; busy: string; act: (fn: () => Promise<unknown>, msg: string, key: string) => Promise<void> }) {
  const j = d.job; const nav = useNavigate(); const [qty, setQty] = useState(j.quantity); const [weeks, setWeeks] = useState(j.recurring?.everyWeeks ?? 4)
  const rec = j.recurring
  return (
    <section className="card-dark p-4 text-sm" data-testid="repeat-card">
      <p className="eyebrow mb-2"><Repeat size={12} className="mr-1 inline" aria-hidden="true" /> Order again</p>
      <p className="text-xs text-text-muted">Same factory, same spec, price carried over from your last order — no sourcing wait. Price breaks apply to bigger quantities.</p>
      <div className="mt-2 flex items-center gap-2"><input type="number" min={1} className="input-dark !min-h-9 w-28 text-xs" value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="reorder-qty" /><span className="text-xs text-text-muted">{j.unit}</span><button className="btn-gold !min-h-9 text-xs" disabled={!!busy || qty < 1} onClick={() => act(async () => { const r = await sourcingApi.reorder(j.id, qty); nav(`/sourcing/${r.job.id}`) }, '', 'reorder')} data-testid="reorder-btn">Reorder now</button></div>
      <div className="mt-3 border-t border-border pt-3">
        <p className="font-semibold">Standing order {rec?.active && <Pill tone="green">on</Pill>}</p>
        {rec?.active ? <p className="text-xs text-text-muted">{rec.quantity.toLocaleString()} {j.unit} every {rec.everyWeeks} weeks · next {rec.nextAt} · {rec.placed} placed so far. Each one arrives as a new request you confirm by paying the deposit.</p> : <p className="text-xs text-text-muted">Traders who restock regularly: we place a repeat order on a schedule; you just confirm the deposit each time.</p>}
        <div className="mt-2 flex items-center gap-2"><span className="text-xs text-text-muted">Every</span><select className="input-dark !min-h-9 w-24 text-xs" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} data-testid="recurring-weeks">{[2, 3, 4, 6, 8, 12, 26].map((w) => <option key={w} value={w}>{w} weeks</option>)}</select>{rec?.active ? <button className="btn-ghost !min-h-9 text-xs" disabled={!!busy} onClick={() => act(() => sourcingApi.recurring(j.id, { active: false, everyWeeks: weeks }), 'Standing order paused.', 'recurring')} data-testid="recurring-off">Pause</button> : <button className="btn-ghost !min-h-9 text-xs" disabled={!!busy} onClick={() => act(() => sourcingApi.recurring(j.id, { active: true, everyWeeks: weeks }), 'Standing order set — we will tell you before each one.', 'recurring')} data-testid="recurring-on">Start standing order</button>}</div>
      </div>
    </section>
  )
}

/* ================= photo-first mobile board for agents ================= */
export function AgentToday() {
  const { user } = useStore(); const [d, setD] = useState<Awaited<ReturnType<typeof sourcingApi.today>> | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [toast, setToast] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({}); const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const load = () => sourcingApi.today().then(setD).catch((e) => setError(err(e, 'Could not load.')))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) }, [toast])
  if (!isSourcingTeam(user)) return <Navigate to="/dashboard" replace />
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); setError(''); try { await fn(); await load(); setToast(msg) } catch (e) { setError(err(e, 'Something went wrong.')) } finally { setBusy('') } }
  const snap = async (it: TodayItem, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 3_000_000) { setError('Keep photos under 3 MB.'); return }
    await run(`photo:${it.id}`, async () => { const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the photo.')); r.readAsDataURL(file) }); await sourcingApi.upload(it.id, { kind: ['ordered', 'in_production'].includes(it.status) ? 'qc' : 'photo', title: `${it.ref} ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`, mime: file.type, data }) }, 'Photo sent to the customer.')
    e.target.value = ''
  }
  const quick = (it: TodayItem) => {
    const a = it.action
    if (a.kind === 'assign') return <button className="btn-gold !min-h-11 flex-1 text-sm" disabled={!!busy} onClick={() => run(`a:${it.id}`, () => sourcingApi.assign(it.id, null), 'Yours.')} data-testid="today-take">Take it</button>
    if (a.kind === 'step' && a.step && ['sourcing', 'in_production'].includes(a.step)) return <button className="btn-gold !min-h-11 flex-1 text-sm" disabled={!!busy} onClick={() => run(`s:${it.id}`, () => sourcingApi.step(it.id, { status: a.step! }), 'Updated.')} data-testid="today-step">{a.label}</button>
    return <Link to={`/dashboard/sourcing/${it.id}`} className="btn-gold !min-h-11 flex-1 text-sm">{a.label}</Link>
  }
  return (
    <div className="container-x max-w-xl py-4" data-testid="agent-today">
      <div className="flex items-center justify-between"><div><p className="eyebrow mb-0.5"><Smartphone size={12} className="mr-1 inline" aria-hidden="true" /> Today</p><h1 className="!text-xl">{d ? `${d.items.filter((i) => i.action.kind !== 'wait').length} to do · ${d.items.length} open` : 'Loading…'}</h1></div><Link to="/dashboard/sourcing" className="text-xs text-text-muted">Full board →</Link></div>
      {toast && <p role="status" className="mt-2 text-sm text-teal"><Check size={14} className="inline" aria-hidden="true" /> {toast}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-4 space-y-3">{d?.items.map((it) => (
        <li key={it.id} className={`card-dark p-4 ${it.action.kind === 'wait' ? 'opacity-80' : ''}`} data-testid="today-item">
          <div className="flex items-start gap-3">{it.reference?.image ? <img src={it.reference.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-xs text-text-muted">{it.photos ? `${it.photos} 📷` : '—'}</div>}
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{it.title}</p><p className="text-xs text-text-muted">{it.ref} · {it.quantity.toLocaleString()} {it.unit} → {it.destinationName} · {it.customer?.name}</p><p className={`mt-1 text-xs font-semibold ${it.action.kind === 'wait' ? 'text-text-muted' : 'text-gold-deep'}`}>{it.action.label}</p></div></div>
          {it.lastMessage && <p className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs"><span className="text-text-muted">{it.lastMessage.author}:</span> {it.lastMessage.body}</p>}
          <div className="mt-3 flex gap-2">
            <input ref={(el) => { fileRefs.current[it.id] = el }} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => snap(it, e)} data-testid="today-camera" />
            <button className="btn-ghost !min-h-11 !px-3" aria-label="Take a photo" disabled={!!busy} onClick={() => fileRefs.current[it.id]?.click()} data-testid="today-snap"><Camera size={18} aria-hidden="true" /></button>
            {quick(it)}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const body = (reply[it.id] ?? '').trim(); if (!body) return; void run(`m:${it.id}`, () => sourcingApi.message(it.id, body), 'Sent.'); setReply({ ...reply, [it.id]: '' }) }}><input className="input-dark !min-h-10 flex-1 text-sm" placeholder="Quick reply…" value={reply[it.id] ?? ''} onChange={(e) => setReply({ ...reply, [it.id]: e.target.value })} data-testid="today-reply" /><button className="btn-ghost !min-h-10 text-sm" disabled={!!busy || !(reply[it.id] ?? '').trim()}>Send</button></form>
        </li>))}</ul>
      {d && d.items.length === 0 && <div className="mt-6"><Empty title="Nothing open" body="New requests show up here the moment customers file them." /></div>}
    </div>
  )
}

/* ================= customer dashboard tab ================= */
export function SourcingTab() {
  const [list, setList] = useState<Job[] | null>(null); const [error, setError] = useState('')
  useEffect(() => { sourcingApi.mine().then(setList).catch((e) => setError(err(e, 'Could not load.'))) }, [])
  return (
    <div className="mt-6" data-testid="sourcing-tab">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">Products our team is sourcing in China, the UK and the USA, buying and shipping for you.</p><Link to="/sourcing/new" className="btn-gold !min-h-9 !px-4 text-sm">New sourcing request</Link></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {list === null && !error && <p className="mt-6 text-sm text-text-muted">Loading…</p>}
      {list && list.length === 0 && <div className="mt-6"><Empty title="Nothing being sourced yet" body="Need stock from China, the UK or the USA? Describe it and our team finds the factory, wholesaler or store, buys it in Ntemtem's name, inspects it and ships it to you." action={<Link to="/sourcing" className="btn-gold">See how it works</Link>} /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">{list?.map((j) => <li key={j.id} className="min-w-0"><Link to={`/sourcing/${j.id}`} className="card-dark block min-w-0 p-4 hover:border-gold/50" data-testid="sourcing-row"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{j.title}</p><p className="text-xs text-text-muted">{j.ref} · {j.tierLabel} · <span aria-label={`from ${ORIGINS[j.origin ?? 'CN'].name}`}><Flag code={j.origin ?? 'CN'} /></span> {j.quantity.toLocaleString()} {j.unit} → {j.destinationName}</p></div><Pill tone={tone(j.status)}>{j.statusLabel ?? stepLabels[j.status]}</Pill></div>{j.agent && <p className="mt-2 text-xs text-text-muted">Agent: {j.agent.name}</p>}</Link></li>)}</ul>
    </div>
  )
}

/* ================= team board ================= */
export function SourcingBoard() {
  const { user } = useStore(); const [d, setD] = useState<Awaited<ReturnType<typeof sourcingApi.board>> | null>(null); const [error, setError] = useState('')
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<'open' | 'mine' | 'unassigned' | 'action' | 'done'>('open'); const [sp] = useSearchParams(); const showEarnings = sp.get('view') === 'earnings'; const [from, setFrom] = useState<Origin | ''>('')
  useEffect(() => { sourcingApi.board().then(setD).catch((e) => setError(err(e, 'Could not load.'))) }, [])
  if (!isSourcingTeam(user)) return <Navigate to="/dashboard" replace />
  const all = d?.requests ?? []
  const open = all.filter((j) => !['closed', 'cancelled'].includes(j.status))
  const action = open.filter((j) => ['requested', 'assigned', 'deposit_paid', 'balance_paid', 'received_cn'].includes(j.status) || (j.status === 'in_production' && j.qc?.result === 'rework'))
  const rows = (filter === 'open' ? open : filter === 'mine' ? open.filter((j) => j.agent?.id === d?.me) : filter === 'unassigned' ? open.filter((j) => !j.agent) : filter === 'action' ? action : all.filter((j) => ['closed', 'cancelled'].includes(j.status))).filter((j) => !from || (j.origin ?? 'CN') === from).filter((j) => !q || `${j.ref} ${j.title} ${j.customer?.name ?? ''} ${j.destinationName}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="container-x py-6 md:py-8" data-testid="sourcing-board">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ntemtem Sourcing</p><h1 className="!text-2xl md:!text-3xl">Sourcing board</h1></div><div className="flex gap-2"><Link to="/dashboard/sourcing/today" className="btn-ghost !min-h-9 text-sm" data-testid="today-link"><Smartphone size={14} aria-hidden="true" /> Today</Link><Link to="/dashboard/sourcing?view=earnings" className={`btn-ghost !min-h-9 text-sm ${showEarnings ? '!border-gold' : ''}`} data-testid="earnings-link"><Wallet size={14} aria-hidden="true" /> Commissions</Link><Link to="/dashboard/suppliers" className="btn-ghost !min-h-9 text-sm"><Factory size={14} aria-hidden="true" /> Suppliers</Link></div></div>
      {showEarnings && <Earnings />}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Open requests" value={open.length} icon={Globe2} /><StatCard label="Needs action" value={action.length} icon={PackageCheck} warn={action.length > 0} active={filter === 'action'} onClick={() => setFilter('action')} /><StatCard label="Unassigned" value={open.filter((j) => !j.agent).length} icon={UserCheck} active={filter === 'unassigned'} onClick={() => setFilter('unassigned')} /><StatCard label="Team" value={d?.agents.length ?? 0} hint={d?.agents.map((a) => `${a.name} (${a.open})`).join(' · ')} icon={Handshake} /></div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><Chip active={filter === 'open'} onClick={() => setFilter('open')}>All open</Chip><Chip active={filter === 'mine'} onClick={() => setFilter('mine')}>Mine</Chip><Chip active={filter === 'unassigned'} onClick={() => setFilter('unassigned')}>Unassigned</Chip><Chip active={filter === 'action'} onClick={() => setFilter('action')}>Needs action</Chip><Chip active={filter === 'done'} onClick={() => setFilter('done')}>Closed</Chip><span className="mx-1 h-5 w-px bg-border" aria-hidden="true" /><Chip active={from === ''} onClick={() => setFrom('')}>All countries</Chip>{ORIGIN_CODES.map((c) => <Chip key={c} active={from === c} onClick={() => setFrom(c)}><span data-testid={`board-from-${c}`}><Flag code={c} /> {ORIGINS[c].short} ({open.filter((j) => (j.origin ?? 'CN') === c).length})</span></Chip>)}<div className="ml-auto w-64"><SearchBox value={q} onChange={setQ} placeholder="Ref, product, customer…" label="Search requests" /></div></div>
      {d && rows.length === 0 && <div className="mt-6"><Empty title="Nothing here" body="New customer requests appear on this board the moment they are filed." /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((j) => <li key={j.id}><Link to={`/dashboard/sourcing/${j.id}`} className="card-dark block h-full p-4 hover:border-gold/50" data-testid="board-row"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{j.title}</p><p className="text-xs text-text-muted">{j.ref} · {j.tierLabel} · <Flag code={j.origin ?? 'CN'} /> {j.quantity.toLocaleString()} {j.unit} → {j.destinationName}</p></div><Pill tone={tone(j.status)}>{j.statusLabel ?? stepLabels[j.status]}</Pill></div><p className="mt-2 text-xs text-text-muted">{j.customer?.name}{j.customer?.company ? ` · ${j.customer.company}` : ''} · {j.agent ? j.agent.name : <span className="text-gold-deep">unassigned</span>} · updated {j.updatedAt ? fmtDate(j.updatedAt) : ''}</p></Link></li>)}</ul>
    </div>
  )
}

/* ================= suppliers directory (team) ================= */
const blankSupplier = (country: Origin = 'CN'): SupplierInput => ({ name: '', country, city: '', province: country === 'CN' ? 'Guangdong' : '', products: [], verified: false, rating: 0, notes: '', contact: '', wechat: '', phone: '', website: '', storefront: '', active: true })
export function SuppliersPage() {
  const { user } = useStore(); const [list, setList] = useState<Supplier[] | null>(null); const [q, setQ] = useState(''); const [form, setForm] = useState<(SupplierInput & { id?: string }) | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [audit, setAudit] = useState<Supplier | null>(null); const [from, setFrom] = useState<Origin | ''>('')
  const load = () => sourcingApi.suppliers().then(setList).catch((e) => setError(err(e, 'Could not load.')))
  useEffect(() => { void load() }, [])
  const rows = useMemo(() => (list ?? []).filter((s) => !from || (s.country ?? 'CN') === from).filter((s) => !q || `${s.name} ${s.city} ${s.products.join(' ')}`.toLowerCase().includes(q.toLowerCase())), [list, q, from])
  if (!isSourcingTeam(user)) return <Navigate to="/dashboard" replace />
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (!form) return; setBusy(true); setError(''); try { const { id, ...b } = form; if (id) await sourcingApi.updateSupplier(id, b); else await sourcingApi.addSupplier(b); setForm(null); await load() } catch (er) { setError(err(er, 'Could not save.')) } finally { setBusy(false) } }
  return (
    <div className="container-x py-6 md:py-8" data-testid="suppliers">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ntemtem Sourcing</p><h1 className="!text-2xl md:!text-3xl">Suppliers</h1><p className="mt-1 text-sm text-text-muted">Every factory, wholesaler and store we buy from in China, the UK and the USA — contacts stay hidden from customers until they pay.</p></div><div className="flex gap-2"><Link to="/dashboard/sourcing" className="btn-ghost !min-h-9 text-sm">Board</Link><button className="btn-gold !min-h-9 text-sm" onClick={() => setForm(blankSupplier(from || 'CN'))} data-testid="add-supplier">Add supplier</button></div></div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><Chip active={from === ''} onClick={() => setFrom('')}>All</Chip>{ORIGIN_CODES.map((c) => <Chip key={c} active={from === c} onClick={() => setFrom(c)}><span data-testid={`sup-from-${c}`}><Flag code={c} /> {ORIGINS[c].short} ({(list ?? []).filter((s) => (s.country ?? 'CN') === c).length})</span></Chip>)}<div className="w-72"><SearchBox value={q} onChange={setQ} placeholder="Name, city, product…" label="Search suppliers" /></div></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((s) => <li key={s.id} className="card-dark p-4 text-sm" data-testid="supplier-card"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{s.name}{s.verified && <BadgeCheck size={13} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="text-xs text-text-muted"><Flag code={s.country ?? 'CN'} /> {s.city}{s.province ? `, ${s.province}` : ''} · {s.rating ? `★ ${s.rating}` : 'unrated'} · {s.jobs} order{s.jobs === 1 ? '' : 's'}{s.lastAudit ? ` · audited ${s.lastAudit.date} (${s.lastAudit.score}/100, ${s.lastAudit.result})` : ' · not audited'}</p></div><div className="flex gap-1"><button className="btn-ghost !min-h-8 text-xs" onClick={() => setAudit(s)} data-testid="audit-btn">Audit</button><button className="btn-ghost !min-h-8 text-xs" onClick={() => { const { lastAudit: _la, ...rest } = s; void _la; setForm({ ...rest }) }}>Edit</button></div></div>{s.products.length > 0 && <ul className="mt-2 flex flex-wrap gap-1">{s.products.map((p) => <li key={p}><Pill tone="muted">{p}</Pill></li>)}</ul>}<p className="mt-2 text-xs">{s.contact}{s.wechat ? ` · ${s.country === 'CN' || !s.country ? 'WeChat' : 'WhatsApp'} ${s.wechat}` : ''}{s.phone ? ` · ${s.phone}` : ''}</p>{s.notes && <p className="mt-1 text-xs text-text-muted">{s.notes}</p>}</li>)}</ul>
      {audit && <AuditForm s={audit} onDone={() => { setAudit(null); void load() }} />}
      {form && (
        <form onSubmit={save} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" aria-label="Supplier"><div className="card-dark max-h-[90dvh] w-full max-w-lg overflow-y-auto p-5 text-sm"><h3 className="!text-lg">{form.id ? 'Edit supplier' : 'New supplier'}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select className="input-dark !min-h-10 sm:col-span-2" value={form.country ?? 'CN'} onChange={(e) => setForm({ ...form, country: e.target.value as Origin })} aria-label="Country" data-testid="sup-country">{ORIGIN_CODES.map((c) => <option key={c} value={c}>{ORIGINS[c].name}</option>)}</select>
            <input required className="input-dark !min-h-10 sm:col-span-2" placeholder={(form.country ?? 'CN') === 'CN' ? 'Factory name' : 'Company or store name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="sup-name" />
            <input className="input-dark !min-h-10" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /><input className="input-dark !min-h-10" placeholder={(form.country ?? 'CN') === 'CN' ? 'Province' : form.country === 'GB' ? 'County' : 'State'} value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            <input className="input-dark !min-h-10 sm:col-span-2" placeholder="Products (comma separated)" value={form.products.join(', ')} onChange={(e) => setForm({ ...form, products: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <input className="input-dark !min-h-10" placeholder="Contact person" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /><input className="input-dark !min-h-10" placeholder={(form.country ?? 'CN') === 'CN' ? 'WeChat' : 'WhatsApp'} value={form.wechat} onChange={(e) => setForm({ ...form, wechat: e.target.value })} />
            <input className="input-dark !min-h-10" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><input className="input-dark !min-h-10" placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
            <input className="input-dark !min-h-10 sm:col-span-2" placeholder={(form.country ?? 'CN') === 'CN' ? '1688 / Alibaba storefront URL' : 'Online store / Amazon / eBay storefront URL'} value={form.storefront} onChange={(e) => setForm({ ...form, storefront: e.target.value })} />
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
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow mb-1">Ntemtem Sourcing</p><h2 className="!text-2xl">Sourcing pricing</h2><p className="mt-1 text-sm text-text-muted">Agents are staff of the <code>ship-sync-sourcing</code> shipper (sign in as the team owner to invite them from Team). These rates feed every new quote.</p></div><Link to="/dashboard/sourcing" className="btn-ghost !min-h-9 text-sm">Open the board</Link></div>
      <form onSubmit={save} className="card-dark mt-4 grid gap-3 p-5 text-sm sm:grid-cols-3">
        <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> Accepting new sourcing requests</label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Service fee (% of goods price)</span><input type="number" min={0} max={50} step="0.5" className="input-dark !min-h-10" value={Math.round(s.servicePct * 1000) / 10} onChange={(e) => num('servicePct', e.target.value, 100)} data-testid="adm-pct" /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Minimum fee ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.minFeeUsd} onChange={(e) => num('minFeeUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Supplier-search flat fee ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.findFeeUsd} onChange={(e) => num('findFeeUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Deposit (% of goods price)</span><input type="number" min={5} max={100} className="input-dark !min-h-10" value={Math.round(s.depositPct * 100)} onChange={(e) => num('depositPct', e.target.value, 100)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Inspection ($ per order)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.inspectionUsd} onChange={(e) => num('inspectionUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Warehouse handling & export ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.handlingUsd} onChange={(e) => num('handlingUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">¥ per US$ (overridden by CNY_PER_USD)</span><input type="number" min={1} max={20} step="0.01" className="input-dark !min-h-10" value={s.cnyPerUsd} onChange={(e) => num('cnyPerUsd', e.target.value)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">£ per US$ (overridden by GBP_PER_USD)</span><input type="number" min={0.3} max={2} step="0.01" className="input-dark !min-h-10" value={s.gbpPerUsd} onChange={(e) => num('gbpPerUsd', e.target.value)} data-testid="gbp-rate" /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Agent commission (% of service fee)</span><input type="number" min={0} max={100} className="input-dark !min-h-10" value={Math.round(s.agentCommissionPct * 100)} onChange={(e) => num('agentCommissionPct', e.target.value, 100)} /></label>
        <label className="grid gap-1"><span className="text-xs text-text-muted">Sample handling fee ($)</span><input type="number" min={0} className="input-dark !min-h-10" value={s.sampleHandlingUsd} onChange={(e) => num('sampleHandlingUsd', e.target.value)} /></label>
        <label className="grid gap-1 sm:col-span-2"><span className="text-xs text-text-muted">Escrow note shown to customers</span><input className="input-dark !min-h-10" value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} /></label>
        <div className="flex items-center justify-end gap-3 sm:col-span-3">{msg && <span role="status" className="text-xs text-teal">{msg}</span>}{error && <span role="alert" className="text-xs text-danger">{error}</span>}<button className="btn-gold !min-h-10 text-sm" disabled={busy} data-testid="adm-save">{busy ? 'Saving…' : 'Save pricing'}</button></div>
      </form>
    </section>
  )
}
