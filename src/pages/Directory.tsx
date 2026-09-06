import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronLeft, ChevronRight, Clock, Compass, Crown, Filter, Plane, Search, Ship, ShieldCheck, Sparkles, Star, TrendingUp, X, Zap } from 'lucide-react'
import { cargoLabel, cargoTypes, countries, countryByCode, origins, type CargoType, type Shipper } from '../lib/data'
import { directoryApi, isFeatured, priorityOptions, sortLabels, urgencyOptions, type DirectorySort, type Match, type Needs, type Recommendation, type SearchResult } from '../lib/directory'
import { Avatar, Empty, ModeBadge, Rating } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

const PAGE = 9
const priceLabel = (i: number) => (i === 1 ? '$' : i === 2 ? '$$' : '$$$')
const flags = (codes: string[]) => codes.map((c) => countryByCode(c)?.flag ?? c).join(' ')

/* ---------- card ---------- */
function PlanBadge({ s }: { s: Shipper }) {
  if (s.plan === 'enterprise') return <span className="inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-ink"><Crown size={11} aria-hidden="true" /> Featured</span>
  if (s.plan === 'pro') return <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 px-2 py-0.5 text-[11px] font-semibold text-gold">Pro</span>
  return null
}

export function DirectoryCard({ s, quote }: { s: Shipper; quote?: string }) {
  const doorish = s.services.filter((x) => /door|pickup|deliver/i.test(x)).slice(0, 2)
  return (
    <motion.article variants={fadeUp} whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className={`group relative flex h-full flex-col rounded-2xl border bg-surface p-5 transition-colors ${isFeatured(s) ? 'border-gold/40 shadow-[0_0_0_1px_rgba(227,181,74,.15),0_20px_50px_-30px_rgba(227,181,74,.35)]' : 'border-border hover:border-gold/30'}`}>
      <div className="flex items-start gap-3.5">
        <Avatar initials={s.initials} hue={s.hue} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><PlanBadge s={s} />{s.verified && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal"><BadgeCheck size={13} aria-hidden="true" /> Verified</span>}</div>
          <h3 className="mt-1 truncate !text-[17px] leading-tight"><Link to={`/shippers/${s.id}`} className="focus-ring hover:text-gold">{s.name}</Link></h3>
          <p className="truncate text-sm text-text-muted">{s.tagline}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {s.modes.map((m) => <ModeBadge key={m} mode={m} />)}
        <Rating value={s.rating} count={s.reviews} />
        <span className="ml-auto text-xs font-semibold text-text-muted" title="Price level">{priceLabel(s.priceIndex)}</span>
      </div>
      <p className="mt-3 text-sm text-text-muted"><span className="mr-1.5" aria-hidden="true">{flags(s.destinations)}</span>{s.destinations.map((d) => countryByCode(d)?.name).filter(Boolean).join(', ')}<span className="text-text-muted/60"> · from {s.hq}</span></p>
      {doorish.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{doorish.map((x) => <li key={x} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">{x}</li>)}</ul>}
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-xs">
        <div><dt className="text-text-muted">On-time</dt><dd className="font-semibold">{s.onTime}%</dd></div>
        <div><dt className="text-text-muted">Replies</dt><dd className="font-semibold">~{s.responseHours}h</dd></div>
        <div><dt className="text-text-muted">Since</dt><dd className="font-semibold">{s.founded}</dd></div>
      </dl>
      <div className="mt-4 flex gap-2">
        <Link to={`/shippers/${s.id}`} className="btn-ghost flex-1 !min-h-10 !px-3 text-sm">Profile</Link>
        <Link to={quote ?? `/quote?shipper=${s.id}&destination=${s.destinations[0]}`} className="btn-gold flex-1 !min-h-10 !px-3 text-sm">Get quote</Link>
      </div>
    </motion.article>
  )
}

function Skeleton() {
  return <div className="h-[330px] animate-pulse rounded-2xl border border-border bg-surface/60" aria-hidden="true" />
}

/* ---------- wizard ---------- */
const blankNeeds: Needs = { origin: '', destination: '', mode: 'either', cargo: '', priority: 'reliability', urgency: 'weeks', verifiedOnly: true }
function FitRing({ fit }: { fit: number }) {
  const r = 22; const c = 2 * Math.PI * r
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label={`${fit}% match`} className="shrink-0">
      <circle cx="30" cy="30" r={r} fill="none" stroke="#24324D" strokeWidth="5" />
      <circle cx="30" cy="30" r={r} fill="none" stroke={fit >= 75 ? '#2DD4BF' : fit >= 50 ? '#E3B54A' : '#A3AEC2'} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * fit) / 100} ${c}`} transform="rotate(-90 30 30)" />
      <text x="30" y="34" textAnchor="middle" fontSize="13" fontWeight="700" fill="#F4F6FA">{fit}</text>
    </svg>
  )
}

function Wizard({ initial, onClose, onApply }: { initial: Partial<Needs>; onClose: () => void; onApply: (n: Needs) => void }) {
  const [step, setStep] = useState(0)
  const [n, setN] = useState<Needs>({ ...blankNeeds, ...initial })
  const [result, setResult] = useState<Recommendation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const steps = ['Destination', 'Ship from', 'Cargo', 'Priority', 'Timing']
  const can = [!!n.destination, true, true, true, true][step]
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const finish = async () => {
    setBusy(true); setError('')
    try { setResult(await directoryApi.recommend(n)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not find matches.') } finally { setBusy(false) }
  }
  const quoteLink = (s: Shipper) => `/quote?shipper=${s.id}&destination=${n.destination}${n.origin ? `&origin=${encodeURIComponent(n.origin)}` : ''}&mode=${n.mode}${n.cargo ? `&cargo=${n.cargo}` : ''}`
  const Tile = ({ active, onClick, title, body, icon }: { active: boolean; onClick: () => void; title: string; body?: string; icon?: React.ReactNode }) => (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} className={`flex min-h-16 items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-ring ${active ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/40'}`}>
      {icon && <span className={`mt-0.5 ${active ? 'text-gold' : 'text-text-muted'}`}>{icon}</span>}
      <span><span className={`block text-sm font-semibold ${active ? 'text-gold' : ''}`}>{title}</span>{body && <span className="block text-xs text-text-muted">{body}</span>}</span>
    </button>
  )
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Find my shipper" className="card-dark max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl p-6 sm:rounded-2xl md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow mb-1">Shipper match</p><h2 className="!text-2xl">{result ? 'Your best matches' : 'Tell us what you’re shipping'}</h2></div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Close"><X size={18} /></button>
        </div>
        {!result ? (
          <>
            <ol className="mt-5 flex gap-1.5" aria-label="Progress">{steps.map((s, i) => <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gold' : 'bg-surface-2'}`} aria-current={i === step ? 'step' : undefined}><span className="sr-only">{s}</span></li>)}</ol>
            <p className="mt-2 text-xs text-text-muted">Step {step + 1} of {steps.length} · {steps[step]}</p>
            <div className="mt-5 min-h-[260px]">
              {step === 0 && <div role="radiogroup" aria-label="Destination" className="grid gap-2 sm:grid-cols-2">{countries.map((c) => <Tile key={c.code} active={n.destination === c.code} onClick={() => setN({ ...n, destination: c.code })} title={`${c.flag} ${c.name}`} body={`Ocean ${c.oceanDays} days · Air ${c.airDays} days`} />)}</div>}
              {step === 1 && (
                <div>
                  <label htmlFor="w-origin" className="label-dark">Where is the cargo now?</label>
                  <select id="w-origin" className="input-dark" value={n.origin} onChange={(e) => setN({ ...n, origin: e.target.value })}><option value="">Not sure / somewhere else</option>{origins.map((o) => <option key={o}>{o}</option>)}</select>
                  <p className="mt-2 text-xs text-text-muted">We’ll favour shippers with regular pickups in your city, then your country.</p>
                  <div className="mt-5" role="radiogroup" aria-label="Mode"><p className="label-dark">How should it travel?</p><div className="grid gap-2 sm:grid-cols-3">
                    <Tile active={n.mode === 'either'} onClick={() => setN({ ...n, mode: 'either' })} title="Either" body="Show me both" icon={<Compass size={16} />} />
                    <Tile active={n.mode === 'ocean'} onClick={() => setN({ ...n, mode: 'ocean' })} title="Ocean" body="Cheaper, 4–6 weeks" icon={<Ship size={16} />} />
                    <Tile active={n.mode === 'air'} onClick={() => setN({ ...n, mode: 'air' })} title="Air" body="Days, costs more" icon={<Plane size={16} />} />
                  </div></div>
                </div>
              )}
              {step === 2 && <div role="radiogroup" aria-label="Cargo type" className="grid gap-2 sm:grid-cols-2">{cargoTypes.map((c) => <Tile key={c.id} active={n.cargo === c.id} onClick={() => setN({ ...n, cargo: c.id })} title={c.label} body={c.hint} />)}<Tile active={n.cargo === ''} onClick={() => setN({ ...n, cargo: '' })} title="Mixed / not sure" body="Skip this filter" /></div>}
              {step === 3 && <div role="radiogroup" aria-label="What matters most" className="grid gap-2 sm:grid-cols-2">{priorityOptions.map((p) => <Tile key={p.id} active={n.priority === p.id} onClick={() => setN({ ...n, priority: p.id })} title={p.label} body={p.blurb} icon={p.id === 'price' ? <TrendingUp size={16} /> : p.id === 'speed' ? <Zap size={16} /> : p.id === 'reliability' ? <ShieldCheck size={16} /> : <Compass size={16} />} />)}</div>}
              {step === 4 && (
                <div>
                  <div role="radiogroup" aria-label="Timing" className="grid gap-2 sm:grid-cols-3">{urgencyOptions.map((u) => <Tile key={u.id} active={n.urgency === u.id} onClick={() => setN({ ...n, urgency: u.id })} title={u.label} body={u.blurb} icon={<Clock size={16} />} />)}</div>
                  <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-gold" checked={n.verifiedOnly} onChange={(e) => setN({ ...n, verifiedOnly: e.target.checked })} /> Only show verified shippers (licence & insurance checked)</label>
                </div>
              )}
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="btn-ghost !min-h-10 !px-4 text-sm disabled:opacity-40"><ArrowLeft size={15} aria-hidden="true" /> Back</button>
              {step < steps.length - 1
                ? <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!can} className="btn-gold !min-h-10 !px-5 text-sm disabled:opacity-50">Next <ArrowRight size={15} aria-hidden="true" /></button>
                : <button type="button" onClick={finish} disabled={busy} className="btn-gold !min-h-10 !px-5 text-sm disabled:opacity-60"><Sparkles size={15} aria-hidden="true" /> {busy ? 'Matching…' : 'Show my matches'}</button>}
            </div>
          </>
        ) : (
          <>
            {result.lane && <p className="mt-2 text-sm text-text-muted">{result.total} shipper{result.total === 1 ? '' : 's'} serve {result.lane.country}{n.origin ? ` from ${n.origin.split(', ')[0]}` : ''}. Typical transit: ocean {result.lane.oceanDays} days, air {result.lane.airDays} days.</p>}
            {result.matches.length === 0 && <div className="mt-6"><Empty title="No shipper fits yet" body="Try a different mode or turn off ‘verified only’ — or post a quote request and we’ll route it to the closest operators." action={<Link to={`/quote?destination=${n.destination}`} className="btn-gold !min-h-10 !px-4 text-sm">Post a request</Link>} /></div>}
            <ol className="mt-5 space-y-3" aria-label="Recommended shippers">
              {result.matches.map((m: Match, i) => (
                <li key={m.shipper.id} className={`rounded-2xl border p-4 ${i === 0 ? 'border-gold/50 bg-gold/5' : 'border-border'}`}>
                  <div className="flex items-start gap-4">
                    <FitRing fit={m.fit} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">{i === 0 && <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-ink">Best match</span>}<PlanBadge s={m.shipper} /><h3 className="!text-base"><Link to={`/shippers/${m.shipper.id}`} className="hover:text-gold focus-ring">{m.shipper.name}</Link></h3>{m.shipper.verified && <BadgeCheck size={15} className="text-teal" aria-label="Verified" />}</div>
                      <p className="text-xs text-text-muted">{m.shipper.tagline} · <Star size={11} className="inline text-gold" aria-hidden="true" /> {m.shipper.rating} ({m.shipper.reviews}) · replies ~{m.shipper.responseHours}h · {priceLabel(m.shipper.priceIndex)}</p>
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {m.reasons.map((r) => <li key={r} className="inline-flex items-center gap-1 text-teal"><Check size={12} aria-hidden="true" /> {r}</li>)}
                        {m.cautions.map((r) => <li key={r} className="inline-flex items-center gap-1 text-gold"><Clock size={12} aria-hidden="true" /> {r}</li>)}
                      </ul>
                    </div>
                    <Link to={quoteLink(m.shipper)} className="btn-gold hidden !min-h-10 !px-4 text-sm sm:inline-flex">Get quote</Link>
                  </div>
                  <Link to={quoteLink(m.shipper)} className="btn-gold mt-3 w-full !min-h-10 text-sm sm:hidden">Get quote</Link>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => { setResult(null); setStep(0) }} className="btn-ghost !min-h-10 !px-4 text-sm"><ArrowLeft size={15} aria-hidden="true" /> Change answers</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => onApply(n)} className="btn-ghost !min-h-10 !px-4 text-sm"><Filter size={15} aria-hidden="true" /> See all {result.total} in the directory</button>
                <Link to={`/quote?destination=${n.destination}${n.origin ? `&origin=${encodeURIComponent(n.origin)}` : ''}&mode=${n.mode}${n.cargo ? `&cargo=${n.cargo}` : ''}`} className="btn-gold !min-h-10 !px-4 text-sm">Get quotes from all</Link>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ---------- page ---------- */
export default function Directory() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''; const dest = sp.get('destination') ?? ''; const mode = (sp.get('mode') as 'air' | 'ocean' | 'either' | null) ?? 'either'; const cargo = sp.get('cargo') ?? ''
  const verified = sp.get('verified') === '1'; const price = (sp.get('price') as '' | '1' | '2' | '3' | null) ?? ''; const origin = sp.get('origin') ?? ''
  const sort = (sp.get('sort') as DirectorySort | null) ?? 'recommended'; const page = Math.max(1, Number(sp.get('page') ?? 1))
  const set = (patch: Record<string, string | undefined>, resetPage = true) => { const next = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) } if (resetPage) next.delete('page'); setSp(next, { replace: true }) }
  const [typed, setTyped] = useState(q)
  useEffect(() => { setTyped(q) }, [q])
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) set({ q: typed }) }, 350); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [res, setRes] = useState<SearchResult | null>(null)
  const [featured, setFeatured] = useState<Shipper[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [wizard, setWizard] = useState(false)
  const reqId = useRef(0)
  useEffect(() => {
    const id = ++reqId.current; setLoading(true); setError('')
    directoryApi.search({ q, destination: dest, mode, cargo, verified, price, origin, sort, page, size: PAGE }).then((r) => { if (id === reqId.current) { setRes(r); setLoading(false) } }).catch((e) => { if (id === reqId.current) { setError(e instanceof Error ? e.message : 'Could not load shippers.'); setLoading(false) } })
  }, [q, dest, mode, cargo, verified, price, origin, sort, page])
  useEffect(() => { directoryApi.featured(dest || undefined).then(setFeatured).catch(() => {}) }, [dest])
  useEffect(() => { if (sp.get('match') === '1') { setWizard(true); set({ match: undefined }, false) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const active = [dest, mode !== 'either' ? mode : '', cargo, verified ? 'v' : '', price, origin].filter(Boolean).length
  const clear = () => setSp(new URLSearchParams(), { replace: true })
  const facetCount = (code: string) => res?.facets.destinations.find((d) => d.code === code)?.n
  const pageNums = useMemo(() => { const p = res?.pages ?? 1; const cur = res?.page ?? 1; const s = new Set([1, p, cur - 1, cur, cur + 1].filter((x) => x >= 1 && x <= p)); return [...s].sort((a, b) => a - b) }, [res])

  const filters = (
    <div className="grid gap-5">
      <fieldset><legend className="label-dark">Destination</legend>
        <div className="grid gap-1">
          <button onClick={() => set({ destination: undefined })} aria-pressed={!dest} className={`flex min-h-9 items-center justify-between rounded-lg px-2.5 text-sm focus-ring ${!dest ? 'bg-gold/15 font-semibold text-gold' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}><span>All countries</span><span className="text-xs opacity-70">{res?.total != null && !dest && !q && active === 0 ? res.total : ''}</span></button>
          {countries.map((c) => <button key={c.code} onClick={() => set({ destination: c.code })} aria-pressed={dest === c.code} className={`flex min-h-9 items-center justify-between rounded-lg px-2.5 text-sm focus-ring ${dest === c.code ? 'bg-gold/15 font-semibold text-gold' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}><span><span aria-hidden="true">{c.flag}</span> {c.name}</span><span className="text-xs opacity-70">{facetCount(c.code) ?? ''}</span></button>)}
        </div>
      </fieldset>
      <div><label htmlFor="f-origin" className="label-dark">Shipping from</label><select id="f-origin" className="input-dark !min-h-10 text-sm" value={origin} onChange={(e) => set({ origin: e.target.value })}><option value="">Anywhere</option>{origins.map((o) => <option key={o}>{o}</option>)}</select></div>
      <fieldset><legend className="label-dark">Mode</legend><div className="grid grid-cols-3 gap-1.5" role="radiogroup">{(['either', 'ocean', 'air'] as const).map((m) => <button key={m} role="radio" aria-checked={mode === m} onClick={() => set({ mode: m === 'either' ? undefined : m })} className={`min-h-9 rounded-lg border text-xs font-medium focus-ring ${mode === m ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{m === 'either' ? 'Both' : m === 'ocean' ? 'Ocean' : 'Air'}</button>)}</div></fieldset>
      <div><label htmlFor="f-cargo" className="label-dark">Cargo type</label><select id="f-cargo" className="input-dark !min-h-10 text-sm" value={cargo} onChange={(e) => set({ cargo: e.target.value })}><option value="">Any cargo</option>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      <fieldset><legend className="label-dark">Price level</legend><div className="grid grid-cols-4 gap-1.5" role="radiogroup">{(['', '1', '2', '3'] as const).map((p) => <button key={p || 'any'} role="radio" aria-checked={price === p} onClick={() => set({ price: p || undefined })} className={`min-h-9 rounded-lg border text-xs font-medium focus-ring ${price === p ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{p ? priceLabel(Number(p)) : 'Any'}</button>)}</div></fieldset>
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-gold" checked={verified} onChange={(e) => set({ verified: e.target.checked ? '1' : undefined })} /> Verified shippers only</label>
      {(active > 0 || q) && <button onClick={clear} className="btn-ghost !min-h-9 text-sm"><X size={15} aria-hidden="true" /> Clear all</button>}
    </div>
  )

  return (
    <div className="bg-bg text-text">
      {/* hero */}
      <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(227,181,74,.14),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(45,212,191,.10),transparent_50%)]">
        <div className="container-fluid py-12 md:py-16">
          <motion.div initial="hidden" animate="show" variants={stagger} className="max-w-3xl">
            <motion.p variants={fadeUp} className="eyebrow mb-2">Shipper directory</motion.p>
            <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.2vw,3.25rem)]">{res ? `${res.total}` : '…'} vetted shippers. <span className="text-gold">One right for your lane.</span></motion.h1>
            <motion.p variants={fadeUp} className="mt-3 max-w-2xl text-text-muted md:text-lg">Every company has a public profile, real customer ratings and a response-time record. Verified shippers have had their licence and insurance checked by Ship Sync.</motion.p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-8 grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <input aria-label="Search shippers" className="input-dark !min-h-14 !pl-12 !pr-28 text-base shadow-[0_20px_60px_-30px_rgba(0,0,0,.8)]" placeholder="Search by company, city, service or country — e.g. “vehicle Houston” or “barrels Kumasi”" value={typed} onChange={(e) => setTyped(e.target.value)} />
              {typed && <button onClick={() => { setTyped(''); set({ q: undefined }) }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-text-muted hover:text-text focus-ring">Clear</button>}
            </div>
            <button onClick={() => setWizard(true)} className="btn-gold !min-h-14 !px-6 text-base"><Sparkles size={18} aria-hidden="true" /> Find my shipper</button>
          </motion.div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">Popular:</span>
            {countries.slice(0, 5).map((c) => <button key={c.code} onClick={() => set({ destination: dest === c.code ? undefined : c.code })} aria-pressed={dest === c.code} className={`rounded-full border px-3 py-1 text-xs focus-ring ${dest === c.code ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}><span aria-hidden="true">{c.flag}</span> {c.name}</button>)}
            <button onClick={() => set({ cargo: cargo === 'vehicle' ? undefined : 'vehicle' })} aria-pressed={cargo === 'vehicle'} className={`rounded-full border px-3 py-1 text-xs focus-ring ${cargo === 'vehicle' ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>🚗 Vehicles</button>
            <button onClick={() => set({ mode: mode === 'air' ? undefined : 'air' })} aria-pressed={mode === 'air'} className={`rounded-full border px-3 py-1 text-xs focus-ring ${mode === 'air' ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>✈️ Air freight</button>
          </div>
        </div>
      </section>

      {/* featured */}
      {featured.length > 0 && (
        <section className="border-b border-border bg-surface/40" aria-label="Featured shippers">
          <div className="container-fluid py-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold"><Crown size={14} aria-hidden="true" /> Featured shippers{dest ? ` · ${countryByCode(dest)?.name}` : ''}</p><p className="mt-1 text-sm text-text-muted">Enterprise partners with priority placement. Sponsored.</p></div>
              <Link to="/#pricing" className="text-sm text-text-muted underline-offset-4 hover:text-gold hover:underline focus-ring">Get your company featured →</Link>
            </div>
            <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:-mx-10 md:px-10 xl:-mx-16 xl:px-16 2xl:-mx-24 2xl:px-24">
              {featured.map((s) => (
                <Link key={s.id} to={`/shippers/${s.id}`} className="group relative w-[300px] shrink-0 snap-start overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-br from-surface to-bg p-5 transition-colors hover:border-gold/60 focus-ring">
                  <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ background: s.hue }} aria-hidden="true" />
                  <div className="flex items-center gap-3"><Avatar initials={s.initials} hue={s.hue} size={44} /><div className="min-w-0"><p className="truncate font-heading text-base font-bold">{s.name}</p><p className="truncate text-xs text-text-muted">{s.hq}</p></div></div>
                  <p className="mt-3 line-clamp-2 text-sm text-text-muted">{s.tagline}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs"><Rating value={s.rating} count={s.reviews} /><span className="ml-auto" aria-hidden="true">{flags(s.destinations)}</span></div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* directory */}
      <div className="container-fluid py-10">
        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside>
            <div className="lg:sticky lg:top-24">
              <button onClick={() => setShowFilters((s) => !s)} className="btn-ghost w-full lg:hidden" aria-expanded={showFilters}><Filter size={16} aria-hidden="true" /> Filters {active > 0 && <span className="rounded-full bg-gold px-2 text-xs font-bold text-ink">{active}</span>}</button>
              <div className={`card-dark mt-3 p-5 lg:mt-0 ${showFilters ? '' : 'hidden lg:block'}`}>{filters}</div>
              <div className="mt-4 hidden rounded-2xl border border-dashed border-border p-4 text-xs text-text-muted lg:block">
                <p className="font-semibold text-text">Are you a shipper?</p>
                <p className="mt-1">List your company free, or go Pro for priority placement in matches.</p>
                <Link to="/signup?role=shipper" className="btn-ghost mt-3 !min-h-9 w-full text-xs">List your company</Link>
              </div>
            </div>
          </aside>
          <div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text-muted" aria-live="polite">
                {loading && !res ? 'Loading…' : <>{res?.total ?? 0} shipper{res?.total === 1 ? '' : 's'}{dest ? <> to <strong className="text-text">{countryByCode(dest)?.name}</strong></> : ''}{q ? <> matching “<strong className="text-text">{q}</strong>”</> : ''}{res && res.pages > 1 ? <> · page {res.page} of {res.pages}</> : ''}</>}
              </p>
              <label className="flex items-center gap-2 text-sm text-text-muted">Sort<select className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => set({ sort: e.target.value === 'recommended' ? undefined : e.target.value })}>{(Object.keys(sortLabels) as DirectorySort[]).map((k) => <option key={k} value={k}>{sortLabels[k]}</option>)}</select></label>
            </div>
            {(active > 0 || q) && (
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                {q && <button onClick={() => { setTyped(''); set({ q: undefined }) }} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">“{q}” <X size={12} /></button>}
                {dest && <button onClick={() => set({ destination: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">{countryByCode(dest)?.name} <X size={12} /></button>}
                {origin && <button onClick={() => set({ origin: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">From {origin} <X size={12} /></button>}
                {mode !== 'either' && <button onClick={() => set({ mode: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">{mode === 'air' ? 'Air' : 'Ocean'} <X size={12} /></button>}
                {cargo && <button onClick={() => set({ cargo: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">{cargoLabel(cargo as CargoType)} <X size={12} /></button>}
                {price && <button onClick={() => set({ price: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">{priceLabel(Number(price))} <X size={12} /></button>}
                {verified && <button onClick={() => set({ verified: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold focus-ring">Verified <X size={12} /></button>}
              </div>
            )}
            {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
            {loading && !res ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}</div>
            ) : res && res.shippers.length === 0 ? (
              <Empty title="No shippers match" body="Try widening the destination or cargo type — or answer five questions and we’ll match you." action={<div className="flex gap-2"><button onClick={clear} className="btn-ghost !min-h-10 !px-4 text-sm">Clear filters</button><button onClick={() => setWizard(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Sparkles size={15} aria-hidden="true" /> Find my shipper</button></div>} />
            ) : (
              <motion.div key={`${res?.page}-${res?.shippers.map((s) => s.id).join()}`} initial="hidden" animate="show" variants={stagger} className={`grid gap-5 md:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                {res?.shippers.map((s) => <DirectoryCard key={s.id} s={s} quote={`/quote?shipper=${s.id}&destination=${dest || s.destinations[0]}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}${mode !== 'either' ? `&mode=${mode}` : ''}${cargo ? `&cargo=${cargo}` : ''}`} />)}
              </motion.div>
            )}
            {res && res.pages > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
                <button onClick={() => set({ page: String(res.page - 1) }, false)} disabled={res.page <= 1} className="grid h-10 w-10 place-items-center rounded-lg border border-border text-text-muted hover:text-text disabled:opacity-40 focus-ring" aria-label="Previous page"><ChevronLeft size={16} /></button>
                {pageNums.map((n, i) => <span key={n} className="contents">{i > 0 && pageNums[i - 1] !== n - 1 && <span className="px-1 text-text-muted">…</span>}<button onClick={() => set({ page: String(n) }, false)} aria-current={n === res.page ? 'page' : undefined} className={`h-10 min-w-10 rounded-lg border px-3 text-sm focus-ring ${n === res.page ? 'border-gold bg-gold/15 font-semibold text-gold' : 'border-border text-text-muted hover:text-text'}`}>{n}</button></span>)}
                <button onClick={() => set({ page: String(res.page + 1) }, false)} disabled={res.page >= res.pages} className="grid h-10 w-10 place-items-center rounded-lg border border-border text-text-muted hover:text-text disabled:opacity-40 focus-ring" aria-label="Next page"><ChevronRight size={16} /></button>
              </nav>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>{wizard && <Wizard initial={{ destination: dest, origin, mode, cargo: (cargo as CargoType) || '' }} onClose={() => setWizard(false)} onApply={(n) => { setWizard(false); set({ destination: n.destination, origin: n.origin || undefined, mode: n.mode === 'either' ? undefined : n.mode, cargo: n.cargo || undefined, verified: n.verifiedOnly ? '1' : undefined, q: undefined }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}</AnimatePresence>
    </div>
  )
}
