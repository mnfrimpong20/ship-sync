import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowLeft, BadgeCheck, Building2, CalendarDays, Check, Clock, MapPin, Star } from 'lucide-react'
import { cargoLabel, countryByCode } from '../lib/data'
import { useStore } from '../lib/store'
import { fadeUp, stagger } from '../lib/motion'
import { Avatar, Empty, ModeBadge, Rating } from '../components/ui'

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
