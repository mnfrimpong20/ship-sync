import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Anchor, ArrowLeft, BadgeCheck, Calculator, Check, ClipboardCheck, Clock, FileText, Filter, Landmark, PackageCheck, Phone, Search, ShieldCheck, X } from 'lucide-react'
import { brokersApi, jobStepLabels, JOB_STEPS, type Broker, type BrokerInput, type JobStep, type StepInput } from '../lib/brokers'
import { countries, countryByCode, cargoLabel, cargoTypes, type CargoType } from '../lib/data'
import { useStore } from '../lib/store'
import { Avatar, Empty, Logo, Pill, Rating, fmtDateTime, money, Flag } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { StatCard } from '../components/board'

/* ================= public directory ================= */
export function BrokerCard({ b, cargo }: { b: Broker; cargo?: CargoType }) {
  return (
    <div className="card-dark flex h-full min-w-0 flex-col p-5" data-testid="broker-card">
      <div className="flex items-start gap-3"><Avatar initials={b.initials} hue={b.hue} size={44} /><div className="min-w-0 flex-1"><p className="font-semibold">{b.name}{b.verified && <BadgeCheck size={14} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="truncate text-xs text-text-muted">{b.company || 'Independent agent'} · {b.ports.join(', ')}</p><div className="mt-1 flex items-center gap-2 text-xs"><Rating value={b.rating} /><span className="text-text-muted">{b.reviews} reviews · ~{b.responseHours}h reply</span></div></div></div>
      <p className="mt-3 line-clamp-3 text-sm text-text-muted">{b.about}</p>
      {b.specialties.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{b.specialties.map((s) => <li key={s}><Pill tone="muted">{s}</Pill></li>)}</ul>}
      <div className="flex-1" />
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">{(cargo ? [cargo] : (['barrels', 'vehicle', 'container20'] as CargoType[])).map((c) => <div key={c}><dt className="text-text-muted">{cargoTypes.find((x) => x.id === c)?.label}</dt><dd className="font-semibold tabular-nums">{b.fees[c] != null ? money(b.fees[c]!) : '—'}</dd></div>)}</dl>
      <p className="mt-2 text-[11px] text-text-muted">{b.licenceAuthority}{b.licenceNo ? ` · ${b.licenceNo}` : ''}{b.dutyAdvance ? ' · can advance duty' : ''}</p>
    </div>
  )
}

/* ---------- directory card (matches the shipper directory) ---------- */
const FEE_COLS: CargoType[] = ['barrels', 'vehicle', 'container20']
export function BrokerDirectoryCard({ b, cargo }: { b: Broker; cargo?: CargoType | '' }) {
  const cols = cargo ? [cargo, ...FEE_COLS.filter((c) => c !== cargo)].slice(0, 3) : FEE_COLS
  return (
    <motion.article variants={fadeUp} whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className={`group relative flex h-full flex-col rounded-2xl border bg-surface p-5 transition-colors ${b.verified ? 'border-border hover:border-gold/30' : 'border-border/70 hover:border-gold/30'}`} data-testid="broker-card">
      <div className="flex items-start gap-3.5">
        <Avatar initials={b.initials} hue={b.hue} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">{b.verified && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal"><BadgeCheck size={13} aria-hidden="true" /> Licence checked</span>}{b.dutyAdvance && <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 px-2 py-0.5 text-[11px] font-semibold text-gold-deep">Advances duty</span>}</div>
          <h3 className="mt-1 truncate !text-[17px] leading-tight"><Link to={`/brokers/${b.id}`} className="focus-ring hover:text-gold-deep" data-testid="broker-name">{b.name}</Link></h3>
          <p className="truncate text-sm leading-5 text-text-muted">{b.company || 'Independent clearing agent'}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Rating value={b.rating} count={b.reviews} />
        <span className="ml-auto text-xs text-text-muted"><Flag code={b.country} /> {b.countryName}</span>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-sm text-text-muted"><Anchor size={13} aria-hidden="true" /> {b.ports.join(' · ')}</p>
      <p className="mt-2 line-clamp-2 text-sm text-text-muted">{b.about}</p>
      {b.specialties.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{b.specialties.slice(0, 3).map((x) => <li key={x} className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">{x}</li>)}</ul>}
      <div className="flex-1" />
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-xs">{cols.map((c) => <div key={c}><dt className="truncate text-text-muted">{cargoLabel(c)}</dt><dd className={`font-semibold tabular-nums ${cargo === c ? 'text-gold-deep' : ''}`}>{b.fees[c] != null ? money(b.fees[c]!) : '—'}</dd></div>)}</dl>
      <p className="mt-2 text-center text-[11px] text-text-muted">Replies ~{b.responseHours}h · {b.jobs} job{b.jobs === 1 ? '' : 's'} on Ntemtem</p>
      <div className="mt-4 flex gap-2">
        <Link to={`/brokers/${b.id}`} className="btn-ghost flex-1 !min-h-10 !px-3 text-sm">Profile</Link>
        <Link to={`/brokers/${b.id}#book`} className="btn-gold flex-1 !min-h-10 !px-3 text-sm" data-testid="broker-book">Book</Link>
      </div>
    </motion.article>
  )
}
function BrokerSkeleton() { return <div className="h-[360px] animate-pulse rounded-2xl border border-border bg-surface/60" aria-hidden="true" /> }

type BrokerSort = 'recommended' | 'rating' | 'fee' | 'reply'
const brokerSortLabels: Record<BrokerSort, string> = { recommended: 'Recommended', rating: 'Highest rated', fee: 'Lowest fee', reply: 'Fastest reply' }
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs focus-ring ${on ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`

export default function BrokersPage() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''; const dest = sp.get('destination') ?? ''; const port = sp.get('port') ?? ''; const cargo = (sp.get('cargo') ?? '') as CargoType | ''
  const verified = sp.get('verified') === '1'; const advance = sp.get('advance') === '1'; const sort = (sp.get('sort') as BrokerSort | null) ?? 'recommended'
  const set = (patch: Record<string, string | undefined>) => { const next = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) } setSp(next, { replace: true }) }
  const [typed, setTyped] = useState(q)
  useEffect(() => { setTyped(q) }, [q])
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) set({ q: typed || undefined }) }, 300); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [all, setAll] = useState<Broker[] | null>(null); const [error, setError] = useState(''); const [showFilters, setShowFilters] = useState(false)
  useEffect(() => { brokersApi.list().then(setAll).catch((e) => { setError(e instanceof Error ? e.message : 'Could not load brokers.'); setAll([]) }) }, [])
  const inCountry = (all ?? []).filter((b) => !dest || b.country === dest)
  const ports = useMemo(() => [...new Set(inCountry.flatMap((b) => b.ports))].sort(), [all, dest]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = inCountry.filter((b) => (!port || b.ports.includes(port)) && (!verified || b.verified) && (!advance || b.dutyAdvance) && (!cargo || b.fees[cargo] != null)
      && (!t || `${b.name} ${b.company} ${b.ports.join(' ')} ${b.countryName} ${b.specialties.join(' ')} ${b.about}`.toLowerCase().includes(t)))
    const fee = (b: Broker) => b.fees[cargo || 'barrels'] ?? Infinity
    return [...list].sort((a, b) => sort === 'rating' ? b.rating - a.rating || b.reviews - a.reviews : sort === 'fee' ? fee(a) - fee(b) : sort === 'reply' ? a.responseHours - b.responseHours : Number(b.verified) - Number(a.verified) || b.rating * Math.log10(10 + b.reviews) - a.rating * Math.log10(10 + a.reviews))
  }, [all, q, dest, port, cargo, verified, advance, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const active = [dest, port, cargo, verified ? 'v' : '', advance ? 'a' : ''].filter(Boolean).length
  const clear = () => { setTyped(''); setSp(new URLSearchParams(), { replace: true }) }
  const count = (code: string) => (all ?? []).filter((b) => b.country === code).length
  const withBrokers = countries.filter((c) => count(c.code) > 0)
  const lowest = (c: CargoType) => { const v = rows.map((b) => b.fees[c]).filter((x): x is number => x != null); return v.length ? Math.min(...v) : null }

  const filters = (
    <div className="grid gap-5">
      <fieldset><legend className="label-dark">Country</legend>
        <div className="grid gap-1">
          <button onClick={() => set({ destination: undefined, port: undefined })} aria-pressed={!dest} className={`flex min-h-9 items-center justify-between rounded-lg px-2.5 text-sm focus-ring ${!dest ? 'bg-gold/15 font-semibold text-gold-deep' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`}><span>All countries</span><span className="text-xs opacity-70">{all?.length ?? ''}</span></button>
          {countries.map((c) => <button key={c.code} onClick={() => set({ destination: c.code, port: undefined })} aria-pressed={dest === c.code} disabled={!count(c.code)} className={`flex min-h-9 items-center justify-between rounded-lg px-2.5 text-sm focus-ring disabled:opacity-40 ${dest === c.code ? 'bg-gold/15 font-semibold text-gold-deep' : 'text-text-muted hover:bg-surface-2 hover:text-text'}`} data-testid={`bf-country-${c.code}`}><span><Flag code={c.code} /> {c.name}</span><span className="text-xs opacity-70">{count(c.code) || ''}</span></button>)}
        </div>
      </fieldset>
      <div><label htmlFor="bf-port" className="label-dark">Port</label><select id="bf-port" className="input-dark !min-h-10 text-sm" value={port} onChange={(e) => set({ port: e.target.value || undefined })} data-testid="bf-port"><option value="">Any port</option>{ports.map((p) => <option key={p}>{p}</option>)}</select></div>
      <div><label htmlFor="bf-cargo" className="label-dark">What you're clearing</label><select id="bf-cargo" className="input-dark !min-h-10 text-sm" value={cargo} onChange={(e) => set({ cargo: e.target.value || undefined })} data-testid="bf-cargo"><option value="">Anything</option>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select><p className="mt-1 text-[11px] text-text-muted">Shows each broker's fee for it.</p></div>
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-gold" checked={verified} onChange={(e) => set({ verified: e.target.checked ? '1' : undefined })} data-testid="bf-verified" /> Licence checked only</label>
      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-gold" checked={advance} onChange={(e) => set({ advance: e.target.checked ? '1' : undefined })} data-testid="bf-advance" /> Can pay the duty for you</label>
      {(active > 0 || q) && <button onClick={clear} className="btn-ghost !min-h-9 text-sm"><X size={15} aria-hidden="true" /> Clear all</button>}
    </div>
  )

  return (
    <div className="bg-bg text-text" data-testid="brokers-page">
      <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(227,181,74,.14),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(45,212,191,.10),transparent_50%)]">
        <div className="container-fluid py-12 md:py-16">
          <motion.div initial="hidden" animate="show" variants={stagger} className="max-w-3xl">
            <motion.p variants={fadeUp} className="eyebrow mb-2">Customs brokers</motion.p>
            <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4.2vw,3.25rem)]">{all ? all.length : '…'} licensed clearing agents. <span className="text-gold-deep">One at your port.</span></motion.h1>
            <motion.p variants={fadeUp} className="mt-3 max-w-2xl text-text-muted md:text-lg">They lodge the declaration, tell you the assessed duty, pay it and get your goods out of the port — every step shows on your tracking page. Fees are fixed per shipment and shown up front.</motion.p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-8 grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <input aria-label="Search brokers" className="input-dark !min-h-14 !pl-12 !pr-20 text-base shadow-[0_20px_60px_-30px_rgba(0,0,0,.8)]" placeholder="Search by name, port or speciality — e.g. “Tema vehicles” or “Apapa”" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="broker-search" />
              {typed && <button onClick={() => { setTyped(''); set({ q: undefined }) }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-text-muted hover:text-text focus-ring">Clear</button>}
            </div>
            <Link to="/duty" className="btn-gold !min-h-14 !px-6 text-base"><Calculator size={18} aria-hidden="true" /> Estimate my duty</Link>
          </motion.div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">Popular:</span>
            {withBrokers.map((c) => <button key={c.code} onClick={() => set({ destination: dest === c.code ? undefined : c.code, port: undefined })} aria-pressed={dest === c.code} className={chip(dest === c.code)}>{c.name}</button>)}
            {['Tema', 'Lagos (Apapa)'].filter((p) => (all ?? []).some((b) => b.ports.includes(p))).map((p) => <button key={p} onClick={() => set({ port: port === p ? undefined : p, destination: undefined })} aria-pressed={port === p} className={chip(port === p)}>{p}</button>)}
            <button onClick={() => set({ cargo: cargo === 'vehicle' ? undefined : 'vehicle' })} aria-pressed={cargo === 'vehicle'} className={chip(cargo === 'vehicle')}>Vehicles</button>
            <button onClick={() => set({ advance: advance ? undefined : '1' })} aria-pressed={advance} className={chip(advance)}>Pays duty for you</button>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-surface/40" aria-label="How it works">
        <div className="container-fluid grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {([[FileText, 'Book from your shipment', 'Pick a broker on the shipment page once it’s booked — or let your shipper pick one.'], [ClipboardCheck, 'Documents lodged', 'The broker files the declaration with ICUMS (Ghana) or NICIS (Nigeria).'], [Landmark, 'Duty assessed', 'You see the official figure on your tracking page — no surprises at the gate.'], [PackageCheck, 'Released & handed over', 'Duty paid, goods released from the port and handed to your shipper or recipient.']] as const).map(([I, t, d], i) => (
            <div key={t} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep"><I size={16} aria-hidden="true" /></span><div><p className="text-sm font-semibold">{i + 1}. {t}</p><p className="mt-0.5 text-xs text-text-muted">{d}</p></div></div>
          ))}
        </div>
      </section>

      <div className="container-fluid py-10">
        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside>
            <div className="lg:sticky lg:top-24">
              <button onClick={() => setShowFilters((x) => !x)} className="btn-ghost w-full lg:hidden" aria-expanded={showFilters}><Filter size={16} aria-hidden="true" /> Filters {active > 0 && <span className="rounded-full bg-gold px-2 text-xs font-bold text-on-accent">{active}</span>}</button>
              <div className={`card-dark mt-3 p-5 lg:mt-0 ${showFilters ? '' : 'hidden lg:block'}`}>{filters}</div>
              <div className="mt-4 hidden rounded-2xl border border-dashed border-border p-4 text-xs text-text-muted lg:block">
                <p className="font-semibold text-text">Are you a licensed clearing agent?</p>
                <p className="mt-1">Get jobs from shippers and customers on Ntemtem. Listing is free — we check your licence first.</p>
                <a href="mailto:hello@ntemtem.com?subject=Broker listing" className="btn-ghost mt-3 !min-h-9 w-full text-xs">Get listed</a>
              </div>
            </div>
          </aside>
          <div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text-muted" aria-live="polite" data-testid="broker-count">
                {all === null ? 'Loading…' : <>{rows.length} broker{rows.length === 1 ? '' : 's'}{dest ? <> in <strong className="text-text">{countryByCode(dest)?.name}</strong></> : ''}{port ? <> at <strong className="text-text">{port}</strong></> : ''}{q ? <> matching “<strong className="text-text">{q}</strong>”</> : ''}{cargo && lowest(cargo) != null ? <> · {cargoLabel(cargo).toLowerCase()} from <strong className="text-text">{money(lowest(cargo)!)}</strong></> : ''}</>}
              </p>
              <label className="flex items-center gap-2 text-sm text-text-muted">Sort<select className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => set({ sort: e.target.value === 'recommended' ? undefined : e.target.value })} data-testid="broker-sort">{(Object.keys(brokerSortLabels) as BrokerSort[]).map((k) => <option key={k} value={k}>{brokerSortLabels[k]}</option>)}</select></label>
            </div>
            {(active > 0 || q) && (
              <div className="mb-4 flex flex-wrap gap-2 text-xs">
                {q && <button onClick={() => { setTyped(''); set({ q: undefined }) }} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">“{q}” <X size={12} /></button>}
                {dest && <button onClick={() => set({ destination: undefined, port: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">{countryByCode(dest)?.name} <X size={12} /></button>}
                {port && <button onClick={() => set({ port: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">{port} <X size={12} /></button>}
                {cargo && <button onClick={() => set({ cargo: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">{cargoLabel(cargo)} <X size={12} /></button>}
                {verified && <button onClick={() => set({ verified: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">Licence checked <X size={12} /></button>}
                {advance && <button onClick={() => set({ advance: undefined })} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-gold-deep focus-ring">Pays duty <X size={12} /></button>}
              </div>
            )}
            {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
            {all === null ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <BrokerSkeleton key={i} />)}</div>
            ) : rows.length === 0 ? (
              <Empty title={all.length ? 'No brokers match' : 'No brokers listed yet'} body={all.length ? 'Try another port or clear a filter. Shippers can also clear through their own agents.' : 'We’re onboarding licensed agents port by port. Shippers can still clear through their own agents.'} action={all.length ? <button onClick={clear} className="btn-ghost !min-h-10 !px-4 text-sm">Clear filters</button> : undefined} />
            ) : (
              <motion.div key={rows.map((b) => b.id).join()} initial="hidden" animate="show" variants={stagger} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((b) => <BrokerDirectoryCard key={b.id} b={b} cargo={cargo} />)}
              </motion.div>
            )}
            <p className="mt-8 text-center text-xs text-text-muted">Fees are the broker’s service charge per shipment. Customs duty and port charges are separate and set by customs — <Link to="/duty" className="text-gold-deep hover:underline">estimate your duty</Link>.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================= broker profile ================= */
export function BrokerProfile() {
  const { id = '' } = useParams(); const { user } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof brokersApi.profile>> | null>(null); const [error, setError] = useState('')
  useEffect(() => { setD(null); brokersApi.profile(id).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.')) }, [id])
  useEffect(() => { if (d && window.location.hash.endsWith('#book')) document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [d])
  if (error) return <div className="container-x py-20 text-text"><Empty title="Broker not found" body="This listing may have been removed or the link is wrong." action={<Link to="/brokers" className="btn-gold">All brokers</Link>} /></div>
  if (!d) return <div className="container-x py-20 text-center text-text-muted">Loading profile…</div>
  const { broker: b, stats, others } = d; const c = countryByCode(b.country)
  const bookLink = !user ? `/login?next=${encodeURIComponent('/dashboard?tab=shipments')}` : user.role === 'shipper' ? '/dashboard/shipments' : '/dashboard?tab=shipments'
  return (
    <div className="relative bg-bg text-text" data-testid="broker-profile">
      <div className="border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(227,181,74,.12),transparent_55%)]">
        <div className="container-x py-8 md:py-12">
          <Link to="/brokers" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-text-muted hover:text-gold-deep focus-ring rounded"><ArrowLeft size={16} aria-hidden="true" /> All brokers</Link>
          <motion.div initial="hidden" animate="show" variants={stagger} className="mt-4 grid gap-8 lg:grid-cols-12">
            <motion.div variants={fadeUp} className="card-dark p-6 md:p-8 lg:col-span-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <Avatar initials={b.initials} hue={b.hue} size={72} />
                <div className="flex-1">
                  <h1 className="flex flex-wrap items-center gap-2 !text-3xl">{b.name}{b.verified && <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-1 text-xs font-semibold text-teal"><BadgeCheck size={14} aria-hidden="true" /> Licence checked</span>}</h1>
                  <p className="mt-1 text-text-muted">{b.company || 'Independent clearing agent'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2"><Rating value={b.rating} count={b.reviews} />{b.dutyAdvance && <Pill tone="gold">Can pay the duty for you</Pill>}</div>
                  <ul className="mt-4 grid gap-2 text-sm text-text-muted sm:grid-cols-2">
                    <li className="flex items-center gap-2"><Anchor size={15} aria-hidden="true" /> {b.ports.join(', ')}, <Flag code={c?.code} /> {b.countryName}</li>
                    <li className="flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" /> {b.licenceAuthority}{b.licenceNo ? ` · ${b.licenceNo}` : ''}</li>
                    <li className="flex items-center gap-2"><Clock size={15} aria-hidden="true" /> Replies in ~{b.responseHours}h</li>
                    <li className="flex items-center gap-2"><FileText size={15} aria-hidden="true" /> {stats.jobs} job{stats.jobs === 1 ? '' : 's'} on Ntemtem{stats.avgClearDays != null ? ` · clears in ~${stats.avgClearDays} days` : ''}</li>
                  </ul>
                </div>
              </div>
              <p className="mt-6 border-t border-border pt-6">{b.about}</p>
              {b.specialties.length > 0 && <ul className="mt-4 flex flex-wrap gap-1.5">{b.specialties.map((x) => <li key={x}><Pill tone="muted">{x}</Pill></li>)}</ul>}
            </motion.div>
            <motion.aside variants={fadeUp} className="lg:col-span-4">
              <div className="card-dark p-6 lg:sticky lg:top-24" id="book" data-testid="broker-book-card">
                <p className="eyebrow mb-1">Book {b.name.split(' ')[0]}</p>
                <p className="text-sm text-text-muted">Brokers are booked on a shipment so they get the documents, the container and the consignee in one go.</p>
                <ol className="mt-4 space-y-2 text-sm">{['Open your shipment', `Under Customs clearance, choose ${b.name}`, 'They accept, lodge the papers and post every step to your tracking page'].map((t, i) => <li key={t} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold/15 text-[11px] font-bold text-gold-deep">{i + 1}</span>{t}</li>)}</ol>
                <Link to={bookLink} className="btn-gold mt-5 w-full" data-testid="broker-book-cta">{user ? 'Go to my shipments' : 'Sign in to book'}</Link>
                <Link to="/duty" className="btn-ghost mt-2 w-full !min-h-10 text-sm"><Calculator size={15} aria-hidden="true" /> Estimate the duty first</Link>
              </div>
            </motion.aside>
          </motion.div>
        </div>
      </div>
      <div className="container-x grid gap-6 py-10 lg:grid-cols-12">
        <section className="card-dark p-6 lg:col-span-7" data-testid="broker-fees">
          <h2 className="!text-lg">Fees</h2><p className="mt-1 text-xs text-text-muted">Service charge per shipment, in US dollars. Customs duty, VAT and port charges are paid on top — at cost.</p>
          <table className="mt-4 w-full text-sm"><tbody>{cargoTypes.map((ct) => <tr key={ct.id} className="border-t border-border/60"><td className="py-2.5">{ct.label}<span className="block text-xs text-text-muted">{ct.hint}</span></td><td className="py-2.5 text-right font-semibold tabular-nums">{b.fees[ct.id] != null ? money(b.fees[ct.id]!) : <span className="font-normal text-text-muted">Not offered</span>}</td></tr>)}</tbody></table>
        </section>
        <section className="card-dark p-6 lg:col-span-5">
          <h2 className="!text-lg">What {b.name.split(' ')[0]} handles</h2>
          <ul className="mt-4 space-y-2.5 text-sm">{['Declaration lodged with customs', 'Duty assessment shared with you before payment', b.dutyAdvance ? 'Pays the duty upfront — you settle with them' : 'You pay the assessed duty; they handle the rest', 'Release from the port and handover to your shipper or recipient'].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />{t}</li>)}</ul>
          {stats.byCargo.length > 0 && <><p className="mt-5 text-xs font-semibold uppercase tracking-wider text-text-muted">Recent jobs</p><ul className="mt-2 flex flex-wrap gap-1.5">{stats.byCargo.map((x) => <li key={x.cargo}><Pill tone="muted">{cargoLabel(x.cargo as CargoType)} · {x.n}</Pill></li>)}</ul></>}
        </section>
        {others.length > 0 && <section className="lg:col-span-12">
          <h2 className="!text-lg">Other brokers in {b.countryName}</h2>
          <motion.div initial="hidden" animate="show" variants={stagger} className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{others.map((o) => <BrokerDirectoryCard key={o.id} b={o} />)}</motion.div>
        </section>}
      </div>
    </div>
  )
}

/* ================= broker portal (no login) ================= */
export function BrokerPortal() {
  const { token = '' } = useParams()
  const [d, setD] = useState<Awaited<ReturnType<typeof brokersApi.portal>> | null>(null)
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [f, setF] = useState<StepInput | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => brokersApi.portal(token).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.'))
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  if (error && !d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-danger">{error}</div></div>
  if (!d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  const { job: j, shipment: s } = d
  const idx = JOB_STEPS.indexOf(j.status as JobStep); const next: JobStep | null = idx >= 0 && idx < JOB_STEPS.length - 1 ? JOB_STEPS[idx + 1] : null
  const closed = ['done', 'cancelled', 'declined'].includes(j.status)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!f) return; setBusy(true); setError(''); try { await brokersApi.portalStep(token, f); await load(); setF(null); setToast('Updated — the customer and the shipper have been told.') } catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy(false) } }
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="container-x max-w-2xl py-8 md:py-12">
        <div className="flex items-center justify-between gap-3"><Logo /><span className="text-xs text-text-muted">Broker portal</span></div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6">
          <motion.div variants={fadeUp} className="card-dark p-5" data-testid="portal-job">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow mb-1">Clearance job</p><h1 className="!text-2xl">{s.ref} · {s.cargoLabel}</h1><p className="mt-1 text-sm text-text-muted">For {s.customer} · shipped by {j.shipperName} · {s.pieces ? `${s.pieces} piece${s.pieces === 1 ? '' : 's'} · ` : ''}shipment status: {s.status.replace('_', ' ')}</p></div><Pill tone={j.status === 'done' ? 'green' : closed ? 'danger' : 'gold'}>{jobStepLabels[j.status]}</Pill></div>
            {toast && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-text-muted">Your fee on file</dt><dd className="font-semibold tabular-nums">{money(j.feeUsd)}</dd></div>
              {s.consignee && <div><dt className="text-xs text-text-muted">Consignee</dt><dd>{s.consignee.name} · <a href={`tel:${s.consignee.phone}`} className="text-gold-deep hover:underline"><Phone size={11} className="inline" aria-hidden="true" /> {s.consignee.phone}</a><span className="block text-xs text-text-muted">{s.consignee.address}{s.consignee.city ? `, ${s.consignee.city}` : ''}</span></dd></div>}
              {s.vehicle && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">Vehicle</dt><dd>{s.vehicle.label}{s.vehicle.body ? ` · ${s.vehicle.body}` : ''}{s.vehicle.engineL ? ` · ${s.vehicle.engineL} L` : ''}{s.vehicle.valueUsd ? ` · declared ${money(s.vehicle.valueUsd)}` : ''}<span className="block font-mono text-xs">{s.vehicle.vin}</span></dd></div>}
              {s.container && <div><dt className="text-xs text-text-muted">Container</dt><dd className="font-mono text-xs">{s.container.number} · {s.container.vessel}{s.container.eta ? ` · ETA ${s.container.eta}` : ''}</dd></div>}
              {j.notes && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">Notes</dt><dd>{j.notes}</dd></div>}
            </dl>
            {d.documents.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Documents</p><ul className="mt-1 flex flex-wrap gap-2">{d.documents.map((x) => x.link ? <li key={x.id}><Link to={x.link} target="_blank" className="btn-ghost !min-h-8 !px-2.5 text-xs"><FileText size={12} aria-hidden="true" /> {x.title}</Link></li> : <li key={x.id} className="text-xs text-text-muted">{x.title} (ask the shipper for a share link)</li>)}</ul></div>}
            <ol className="mt-5 space-y-1.5" aria-label="Steps">{JOB_STEPS.map((st, i) => <li key={st} className={`flex items-center gap-2 text-sm ${i <= idx ? 'text-text' : 'text-text-muted'}`}><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${i < idx ? 'bg-teal text-on-accent' : i === idx ? 'bg-gold text-on-accent' : 'bg-surface-2'}`}>{i < idx ? '✓' : i + 1}</span>{jobStepLabels[st]}</li>)}</ol>
            {!closed && !f && (
              <div className="mt-5 flex flex-wrap gap-2">
                {next && <button onClick={() => setF({ status: next, note: '', dutyCurrency: j.dutyCurrency ?? (s.destination === 'NG' ? 'NGN' : 'GHS') })} className="btn-gold" data-testid="portal-next">{j.status === 'requested' ? 'Accept the job' : `Mark: ${jobStepLabels[next]}`}</button>}
                {j.status === 'requested' && <button onClick={() => setF({ status: 'declined', note: '' })} className="btn-ghost text-danger">Decline</button>}
              </div>
            )}
            {f && (
              <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-border bg-surface-2/40 p-4" aria-label="Update job">
                <p className="font-semibold">{jobStepLabels[f.status]}</p>
                {f.status === 'assessed' && <div className="grid grid-cols-[1fr_auto] gap-2"><input type="number" min={0} required aria-label="Duty assessed" className="input-dark !min-h-10 text-sm tabular-nums" placeholder="Total duty & taxes assessed" value={f.dutyLocal ?? ''} onChange={(e) => setF({ ...f, dutyLocal: e.target.value ? Number(e.target.value) : undefined })} /><select aria-label="Currency" className="input-dark !min-h-10 text-sm" value={f.dutyCurrency} onChange={(e) => setF({ ...f, dutyCurrency: e.target.value })}><option>GHS</option><option>NGN</option><option>USD</option></select><input aria-label="Customs reference" className="input-dark !min-h-10 text-sm col-span-2" placeholder="ICUMS / NCS declaration reference" value={f.reference ?? ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>}
                <input aria-label="Note" className="input-dark !min-h-10 text-sm" placeholder={f.status === 'declined' ? 'Why? (shown to the customer)' : 'Note for the customer and shipper (optional)'} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setF(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Back</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button></div>
              </form>
            )}
            <ul className="mt-5 space-y-1 border-t border-border pt-4 text-xs text-text-muted">{j.timeline.slice().reverse().map((t, k) => <li key={k}><span className="text-text">{jobStepLabels[t.status as JobStep] ?? t.status}</span> · {fmtDateTime(t.at)} · {t.by}{t.note ? ` — ${t.note}` : ''}</li>)}</ul>
          </motion.div>
          <motion.p variants={fadeUp} className="mt-4 text-center text-xs text-text-muted">This link is private to you and this job. Questions: the shipper's office or hello@ntemtem.com.</motion.p>
        </motion.div>
      </div>
    </div>
  )
}

/* ================= admin ================= */
const blank = (): BrokerInput => ({ name: '', company: '', country: 'GH', ports: ['Tema'], licenceNo: '', licenceAuthority: 'GRA Customs Division', phone: '', whatsapp: '', email: '', about: '', specialties: [], fees: { barrels: 60, boxes: 60, pallets: 110, vehicle: 220, container20: 380, container40: 520, commercial: 300 }, dutyAdvance: false, responseHours: 24, verified: false, active: true })
export function AdminBrokers() {
  const [list, setList] = useState<Broker[] | null>(null)
  const [form, setForm] = useState<(BrokerInput & { id?: string }) | null>(null)
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('')
  const load = () => brokersApi.admin().then(setList).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  const act = async (fn: () => Promise<unknown>, m: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setMsg(m) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') } }
  const fee = (k: CargoType, v: string) => form && setForm({ ...form, fees: { ...form.fees, [k]: v ? Number(v) : undefined } })
  return (
    <section className="mt-14" data-testid="admin-brokers">
      <p className="eyebrow mb-1">Customs brokers</p>
      <h2 className="!text-[clamp(1.5rem,3vw,2rem)]">Clearing agents on the marketplace</h2>
      <p className="mt-1 text-text-muted">Licensed agents customers and shippers can book per shipment. Verify a listing once you've seen the licence.</p>
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><StatCard label="Listed" value={list?.length ?? 0} hint="All ports" icon={Landmark} /><StatCard label="Verified" value={list?.filter((b) => b.verified).length ?? 0} hint="Licence checked" icon={BadgeCheck} /><StatCard label="Jobs" value={list?.reduce((n, b) => n + b.jobs, 0) ?? 0} hint="Booked through the platform" icon={FileText} /></div>
      <div className="mt-4 flex justify-end">{!form && <button onClick={() => setForm(blank())} className="btn-gold !min-h-9 !px-4 text-sm" data-testid="new-broker">Add a broker</button>}</div>
      {form && (
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { if (form.id) await brokersApi.update(form.id, form); else await brokersApi.create(form); setForm(null) }, form.id ? 'Broker updated.' : 'Broker listed.', 'save') }} className="card-dark mt-4 grid gap-3 p-5 sm:grid-cols-2" aria-label="Broker form" data-testid="broker-form">
          <label className="text-xs text-text-muted">Name<input required className="input-dark mt-1 !min-h-9 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Company<input className="input-dark mt-1 !min-h-9 text-sm" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Country<select className="input-dark mt-1 !min-h-9 text-sm" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value, licenceAuthority: e.target.value === 'NG' ? 'Nigeria Customs Service' : e.target.value === 'GH' ? 'GRA Customs Division' : form.licenceAuthority })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <label className="text-xs text-text-muted">Ports (comma-separated)<input required className="input-dark mt-1 !min-h-9 text-sm" value={form.ports.join(', ')} onChange={(e) => setForm({ ...form, ports: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
          <label className="text-xs text-text-muted">Licence no.<input className="input-dark mt-1 !min-h-9 text-sm" value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Licensing authority<input className="input-dark mt-1 !min-h-9 text-sm" value={form.licenceAuthority} onChange={(e) => setForm({ ...form, licenceAuthority: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Phone<input className="input-dark mt-1 !min-h-9 text-sm" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="text-xs text-text-muted">WhatsApp<input className="input-dark mt-1 !min-h-9 text-sm" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">Email (receives job links)<input type="email" className="input-dark mt-1 !min-h-9 text-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">About<textarea rows={2} className="input-dark mt-1 py-2 text-sm" value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">Specialties (comma-separated)<input className="input-dark mt-1 !min-h-9 text-sm" value={form.specialties.join(', ')} onChange={(e) => setForm({ ...form, specialties: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8) })} /></label>
          <div className="grid grid-cols-4 gap-2 sm:col-span-2">{cargoTypes.map((c) => <label key={c.id} className="text-[11px] text-text-muted">{c.label}<input type="number" min={0} className="input-dark mt-1 !min-h-8 text-xs tabular-nums" value={form.fees[c.id] ?? ''} onChange={(e) => fee(c.id, e.target.value)} /></label>)}</div>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.dutyAdvance} onChange={(e) => setForm({ ...form, dutyAdvance: e.target.checked })} /> Advances duty</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Listed</label><label className="inline-flex items-center gap-2">Replies in <input type="number" min={1} className="input-dark !min-h-8 !w-16 text-xs tabular-nums" value={form.responseHours} onChange={(e) => setForm({ ...form, responseHours: Number(e.target.value) || 24 })} /> h</label></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setForm(null)} className="btn-ghost !min-h-9 !px-4 text-sm">Cancel</button><button disabled={busy === 'save'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy === 'save' ? 'Saving…' : form.id ? 'Save' : 'List broker'}</button></div>
        </form>
      )}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {list?.map((b) => (
          <li key={b.id} className={`card-dark p-4 ${b.active ? '' : 'opacity-60'}`} data-testid="admin-broker-row">
            <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Avatar initials={b.initials} hue={b.hue} size={32} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{b.name}{b.verified && <BadgeCheck size={13} className="ml-1 inline text-teal" />}</p><p className="truncate text-xs text-text-muted">{b.company || 'Independent'} · {b.countryName} · {b.ports.join(', ')} · {b.jobs} job{b.jobs === 1 ? '' : 's'}</p></div></div><div className="flex gap-1.5"><button onClick={() => act(() => brokersApi.update(b.id, { verified: !b.verified }), b.verified ? 'Verification removed.' : 'Broker verified.', b.id)} disabled={busy === b.id} className="btn-ghost !min-h-8 !px-2.5 text-xs">{b.verified ? 'Unverify' : 'Verify'}</button><button onClick={() => setForm({ id: b.id, name: b.name, company: b.company, country: b.country, ports: b.ports, licenceNo: b.licenceNo, licenceAuthority: b.licenceAuthority, phone: b.phone, whatsapp: b.whatsapp, email: b.email, about: b.about, specialties: b.specialties, fees: b.fees, dutyAdvance: b.dutyAdvance, responseHours: b.responseHours, verified: b.verified, active: b.active })} className="btn-ghost !min-h-8 !px-2.5 text-xs">Edit</button></div></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
