import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, BadgeCheck, Plane, Ship, ShieldCheck, Clock } from 'lucide-react'
import { fadeUp, stagger } from '../lib/motion'
import { countries, origins, type Mode } from '../lib/data'
import HeroVideo from './HeroVideo'

export default function Hero() {
  const nav = useNavigate()
  const [origin, setOrigin] = useState('New York, NY')
  const [dest, setDest] = useState('GH')
  const [mode, setMode] = useState<Mode | 'either'>('either')

  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* backdrop: cycling video, then brand glows, grid and route arcs on top */}
      <HeroVideo />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-[720px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(227,181,74,0.14),transparent)]" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.05]" aria-hidden="true"><defs><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" strokeWidth="1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
        <RouteMap />
      </div>

      <div className="container-x relative grid gap-12 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-12 lg:items-center">
        <motion.div className="lg:col-span-7" initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-5 flex items-center gap-2"><span className="h-px w-8 bg-gold" aria-hidden="true" />Air & ocean freight to West Africa</motion.p>
          <motion.h1 variants={fadeUp} className="max-w-3xl">
            Ship home with carriers you can <em className="not-italic text-gold">trust.</em>
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-6 max-w-xl text-lg text-text-muted md:text-xl">
            Post your shipment once. Verified air and ocean shippers to Ghana, Nigeria, Liberia, Togo and beyond compete for it with real quotes — you pick, book, and track.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/quote" className="btn-gold w-full sm:w-auto">Get free quotes <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/signup?role=shipper" className="btn-ghost w-full sm:w-auto">List your shipping company</Link></motion.div>
          </motion.div>
          <motion.ul variants={fadeUp} className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-text-muted">
            <li className="flex items-center gap-2"><BadgeCheck size={16} className="text-gold" aria-hidden="true" /> 120+ verified shippers</li>
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-gold" aria-hidden="true" /> Licence & insurance checked</li>
            <li className="flex items-center gap-2"><Clock size={16} className="text-gold" aria-hidden="true" /> Quotes within 24 hours</li>
          </motion.ul>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          onSubmit={(e) => { e.preventDefault(); nav(`/quote?origin=${encodeURIComponent(origin)}&destination=${dest}&mode=${mode}`) }}
          className="card-dark relative p-6 md:p-7 lg:col-span-5"
          aria-label="Quick quote"
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="!text-xl text-text">Quick quote</h2>
            <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold">Free for customers</span>
          </div>
          <div className="grid gap-4">
            <div>
              <label htmlFor="q-origin" className="label-dark">Shipping from</label>
              <select id="q-origin" className="input-dark" value={origin} onChange={(e) => setOrigin(e.target.value)}>
                {origins.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="q-dest" className="label-dark">Shipping to</label>
              <select id="q-dest" className="input-dark" value={dest} onChange={(e) => setDest(e.target.value)}>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="label-dark">Mode</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {([['either', 'Either', null], ['ocean', 'Ocean', Ship], ['air', 'Air', Plane]] as const).map(([v, label, Icon]) => (
                  <button type="button" key={v} role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-sm font-medium transition-colors focus-ring ${mode === v ? 'border-gold bg-gold/15 text-gold' : 'border-border bg-surface-2 text-text-muted hover:text-text'}`}>
                    {Icon && <Icon size={15} aria-hidden="true" />}{label}
                  </button>
                ))}
              </div>
            </fieldset>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" className="btn-gold mt-1 w-full">Compare shipper quotes <ArrowRight size={18} aria-hidden="true" /></motion.button>
          </div>
          <p className="mt-4 text-center text-xs text-text-muted">No account needed to request quotes. Shippers reply by email and in your dashboard.</p>
        </motion.form>
      </div>

      <div className="container-x relative">
        <motion.dl initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="grid grid-cols-2 gap-6 border-t border-border py-10 md:grid-cols-4">
          {[['120+', 'Verified shippers'], ['7', 'West African countries'], ['48k', 'Shipments quoted'], ['94%', 'Average on-time rate']].map(([v, l]) => (
            <motion.div key={l} variants={fadeUp}>
              <dt className="text-sm text-text-muted">{l}</dt>
              <dd className="font-heading text-3xl font-bold text-text md:text-4xl">{v}</dd>
            </motion.div>
          ))}
        </motion.dl>
      </div>
    </section>
  )
}

function RouteMap() {
  // Stylised arcs from North America / Europe / Asia to the Gulf of Guinea
  return (
    <svg className="absolute inset-x-0 top-0 hidden h-full w-full lg:block" viewBox="0 0 1440 800" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="arc" x1="0" x2="1"><stop offset="0" stopColor="#E3B54A" stopOpacity="0" /><stop offset="0.5" stopColor="#E3B54A" stopOpacity="0.55" /><stop offset="1" stopColor="#2DD4BF" stopOpacity="0" /></linearGradient>
      </defs>
      {['M120 260 Q 620 60 1010 520', 'M420 140 Q 760 120 1030 540', 'M1380 200 Q 1200 380 1040 545', 'M60 420 Q 560 380 1010 530'].map((d, i) => (
        <motion.path key={d} d={d} stroke="url(#arc)" strokeWidth="1.5" strokeDasharray="6 10" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 2.2, delay: 0.6 + i * 0.25, ease: 'easeOut' }} />
      ))}
      <motion.circle cx="1025" cy="535" r="6" fill="#E3B54A" initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ delay: 2.2, duration: 0.6 }} />
      <motion.circle cx="1025" cy="535" r="18" stroke="#E3B54A" strokeWidth="1" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.6, 0], scale: [0.6, 1.6, 2] }} transition={{ delay: 2.4, duration: 2.4, repeat: Infinity, repeatDelay: 1 }} />
    </svg>
  )
}
