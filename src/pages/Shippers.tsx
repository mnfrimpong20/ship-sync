import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowLeft, BadgeCheck, Building2, CalendarDays, Check, Clock, Filter, MapPin, Search, Star, X } from 'lucide-react'
import { cargoLabel, cargoTypes, countries, countryByCode, type Mode } from '../lib/data'
import { useStore } from '../lib/store'
import { fadeUp, stagger } from '../lib/motion'
import { Avatar, Empty, ModeBadge, Rating, ShipperCard } from '../components/ui'

export function ShipperDirectory() {
  const { shippers } = useStore()
  const [q, setQ] = useState('')
  const [dest, setDest] = useState('')
  const [mode, setMode] = useState<Mode | ''>('')
  const [cargo, setCargo] = useState('')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [sort, setSort] = useState<'rating' | 'reviews' | 'response'>('rating')
  const [showFilters, setShowFilters] = useState(false)

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return shippers
      .filter((s) => !ql || s.name.toLowerCase().includes(ql) || s.hq.toLowerCase().includes(ql) || s.tagline.toLowerCase().includes(ql))
      .filter((s) => !dest || s.destinations.includes(dest))
      .filter((s) => !mode || s.modes.includes(mode))
      .filter((s) => !cargo || s.cargo.includes(cargo as never))
      .filter((s) => !verifiedOnly || s.verified)
      .sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'reviews' ? b.reviews - a.reviews : a.responseHours - b.responseHours)
  }, [shippers, q, dest, mode, cargo, verifiedOnly, sort])
  const active = [dest, mode, cargo, verifiedOnly ? 'v' : ''].filter(Boolean).length
  const clear = () => { setDest(''); setMode(''); setCargo(''); setVerifiedOnly(false); setQ('') }

  const filters = (
    <div className="grid gap-4">
      <div><label htmlFor="f-dest" className="label-dark">Destination</label><select id="f-dest" className="input-dark" value={dest} onChange={(e) => setDest(e.target.value)}><option value="">All countries</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
      <div><label htmlFor="f-mode" className="label-dark">Mode</label><select id="f-mode" className="input-dark" value={mode} onChange={(e) => setMode(e.target.value as Mode | '')}><option value="">Air or ocean</option><option value="ocean">Ocean</option><option value="air">Air</option></select></div>
      <div><label htmlFor="f-cargo" className="label-dark">Cargo type</label><select id="f-cargo" className="input-dark" value={cargo} onChange={(e) => setCargo(e.target.value)}><option value="">Any cargo</option>{cargoTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text"><input type="checkbox" className="h-5 w-5 accent-gold" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified shippers only</label>
      {active > 0 && <button onClick={clear} className="btn-ghost !min-h-10 text-sm"><X size={16} aria-hidden="true" /> Clear filters</button>}
    </div>
  )

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="max-w-2xl">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Directory</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">Air & ocean shippers to West Africa</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Every company here has a public profile, real customer ratings, and a response-time record. Verified shippers have had their licence and insurance checked.</motion.p>
        </motion.div>

        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          <aside className="lg:col-span-3">
            <div className="lg:sticky lg:top-24">
              <div className="relative">
                <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <input aria-label="Search shippers" className="input-dark !pl-10" placeholder="Search by name or city" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button onClick={() => setShowFilters((s) => !s)} className="btn-ghost mt-3 w-full lg:hidden" aria-expanded={showFilters}><Filter size={16} aria-hidden="true" /> Filters {active > 0 && <span className="rounded-full bg-gold px-2 text-xs text-ink">{active}</span>}</button>
              <div className={`card-dark mt-3 p-5 ${showFilters ? '' : 'hidden lg:block'}`}>{filters}</div>
            </div>
          </aside>
          <div className="lg:col-span-9">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text-muted" aria-live="polite">{list.length} shipper{list.length === 1 ? '' : 's'}{dest ? ` to ${countryByCode(dest)?.name}` : ''}</p>
              <label className="flex items-center gap-2 text-sm text-text-muted">Sort by<select className="input-dark !w-auto !min-h-10" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="rating">Highest rated</option><option value="reviews">Most reviews</option><option value="response">Fastest response</option></select></label>
            </div>
            {list.length === 0 ? (
              <Empty title="No shippers match those filters" body="Try widening the destination or cargo type — or post a quote request and we’ll route it to the closest operators." action={<button onClick={clear} className="btn-gold">Clear filters</button>} />
            ) : (
              <motion.div key={list.map((s) => s.id).join()} initial="hidden" animate="show" variants={stagger} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {list.map((s) => <ShipperCard key={s.id} s={s} />)}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ShipperProfile() {
  const { id } = useParams()
  const { ready, shipperById } = useStore()
  const s = shipperById(id ?? '')
  if (!s && !ready) return <div className="container-x py-20 text-center text-text-muted">Loading profile…</div>
  if (!s) return (
    <div className="container-x py-20 text-text"><Empty title="Shipper not found" body="This profile may have been removed or the link is wrong." action={<Link to="/shippers" className="btn-gold">Back to directory</Link>} /></div>
  )
  const reviews = [
    { n: 'Efua M.', d: 'Aug 2026', r: 5, t: 'Barrels arrived in Kumasi exactly when they said. Communication on WhatsApp throughout.' },
    { n: 'Daniel O.', d: 'Jul 2026', r: 5, t: 'Shipped my Camry. They handled the title, inspection and duty estimate up front — no surprises at the port.' },
    { n: 'Rita A.', d: 'Jun 2026', r: 4, t: 'Good price and reliable. Pickup was a day late but they called ahead and made up the time.' },
  ]
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <Link to="/shippers" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-text-muted hover:text-gold focus-ring rounded"><ArrowLeft size={16} aria-hidden="true" /> All shippers</Link>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <motion.div variants={fadeUp} className="card-dark p-6 md:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <Avatar initials={s.initials} hue={s.hue} size={72} />
                <div className="flex-1">
                  <h1 className="flex flex-wrap items-center gap-2 !text-3xl">{s.name}{s.verified && <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold"><BadgeCheck size={14} aria-hidden="true" /> Verified</span>}</h1>
                  <p className="mt-1 text-text-muted">{s.tagline}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">{s.modes.map((m) => <ModeBadge key={m} mode={m} />)}<Rating value={s.rating} count={s.reviews} /></div>
                  <ul className="mt-4 grid gap-2 text-sm text-text-muted sm:grid-cols-2">
                    <li className="flex items-center gap-2"><Building2 size={15} aria-hidden="true" /> HQ {s.hq}</li>
                    <li className="flex items-center gap-2"><CalendarDays size={15} aria-hidden="true" /> Operating since {s.founded}</li>
                    <li className="flex items-center gap-2"><Clock size={15} aria-hidden="true" /> Replies in ~{s.responseHours}h</li>
                    <li className="flex items-center gap-2"><Star size={15} aria-hidden="true" /> {s.onTime}% on-time deliveries</li>
                  </ul>
                </div>
              </div>
              <p className="mt-6 border-t border-border pt-6 text-text">{s.about}</p>
            </motion.div>

            <motion.div variants={fadeUp} className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="card-dark p-6">
                <h2 className="!text-lg">Lanes</h2>
                <p className="mt-1 text-xs text-text-muted">Pickup areas → destinations</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div><p className="font-semibold text-text-muted">From</p><ul className="mt-1 flex flex-wrap gap-1.5">{s.origins.map((o) => <li key={o} className="rounded-full bg-surface-2 px-2.5 py-1 text-text">{o}</li>)}</ul></div>
                  <div><p className="font-semibold text-text-muted">To</p><ul className="mt-1 flex flex-wrap gap-1.5">{s.destinations.map((d) => { const c = countryByCode(d)!; return <li key={d} className="rounded-full bg-surface-2 px-2.5 py-1 text-text">{c.flag} {c.name} · {c.ports[0]}</li> })}</ul></div>
                </div>
              </div>
              <div className="card-dark p-6">
                <h2 className="!text-lg">Cargo & services</h2>
                <ul className="mt-4 space-y-2 text-sm">
                  {s.cargo.map((c) => <li key={c} className="flex items-center gap-2 text-text"><Check size={15} className="text-gold" aria-hidden="true" />{cargoLabel(c)}</li>)}
                </ul>
                <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-4">{s.services.map((x) => <li key={x} className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">{x}</li>)}</ul>
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="card-dark mt-6 p-6">
              <h2 className="!text-lg">Recent reviews</h2>
              <p className="mt-1 text-xs text-text-muted">Only customers who booked through Ship Sync can review.</p>
              <ul className="mt-4 divide-y divide-border">
                {reviews.map((r) => (
                  <li key={r.n} className="py-4">
                    <div className="flex items-center justify-between"><p className="font-semibold text-text">{r.n}</p><span className="text-xs text-text-muted">{r.d}</span></div>
                    <div className="mt-1 flex gap-0.5" aria-label={`${r.r} stars`}>{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} className={i < r.r ? 'fill-gold text-gold' : 'text-border'} aria-hidden="true" />)}</div>
                    <p className="mt-2 text-sm text-text-muted">{r.t}</p>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          <aside className="lg:col-span-4">
            <motion.div variants={fadeUp} className="card-dark sticky top-24 p-6">
              <h2 className="!text-lg">Get a quote from {s.name.split(' ')[0]}</h2>
              <p className="mt-1 text-sm text-text-muted">Post your shipment — this shipper is notified first, and you’ll still see competing quotes.</p>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}><Link to={`/quote?shipper=${s.id}&destination=${s.destinations[0]}&origin=${encodeURIComponent(s.origins[0])}`} className="btn-gold mt-5 w-full">Request a quote</Link></motion.div>
              <dl className="mt-5 space-y-2 border-t border-border pt-5 text-sm">
                <div className="flex justify-between"><dt className="text-text-muted">Price level</dt><dd className="font-semibold text-text">{['Budget', 'Mid-range', 'Premium'][s.priceIndex - 1]}</dd></div>
                <div className="flex justify-between"><dt className="text-text-muted">Plan</dt><dd className="font-semibold capitalize text-text">{s.plan}</dd></div>
                <div className="flex justify-between"><dt className="text-text-muted">Insurance</dt><dd className="font-semibold text-text">{s.services.some((x) => /insur/i.test(x)) ? 'Offered' : 'On request'}</dd></div>
              </dl>
              <p className="mt-5 flex items-start gap-2 text-xs text-text-muted"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> Warehouse address is shared after booking confirmation.</p>
            </motion.div>
          </aside>
        </motion.div>
      </div>
    </div>
  )
}
