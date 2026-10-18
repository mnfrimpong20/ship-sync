import { useEffect, useState } from 'react'
import { siteApi, type SiteStats } from '../lib/site'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Plane, Ship, ShieldCheck, Clock, Pause, Play } from 'lucide-react'
import { VerifiedMark } from './ui'
import { fadeUp, stagger } from '../lib/motion'
import { countries, origins, type Mode } from '../lib/data'
import HeroVideo, { scenes } from './HeroVideo'

/** What the hero says during each backdrop scene (same order as `scenes`). */
const sceneCopy: Record<string, { tab: string; eyebrow: string; text: string; short: string }> = {
  barrels: { tab: 'Barrels', eyebrow: 'Barrels & boxes home', text: 'Pack a barrel in Houston, unpack it in Kumasi. Post it once and verified shippers send you real quotes — pick one, pay safely, and track it all the way home.', short: 'Barrels and boxes home — compare real quotes.' },
  port: { tab: 'Containers', eyebrow: 'Full containers', text: 'Moving home or restocking a shop? Get door-to-door prices for a 20ft or 40ft container to Tema, Lagos, Lomé and more.', short: 'Full 20ft and 40ft containers, door to door.' },
  car: { tab: 'Cars', eyebrow: 'Cars & vehicles', text: 'Ship your car by RoRo or in a container. Shippers check the title and estimate the duty before you commit.', short: 'Ship a car — title and duty sorted up front.' },
  air: { tab: 'Air', eyebrow: 'Urgent by air', text: 'Documents, medicine and gifts by air in 3 to 7 days, with the same protected payment.', short: 'Urgent items by air in 3 to 7 days.' },
  family: { tab: 'Door to door', eyebrow: 'To the family’s door', text: 'Delivered to the door in Accra, Kumasi, Lagos or Monrovia — and the family gets WhatsApp updates at every step.', short: 'To the family’s door, with WhatsApp updates.' },
}

export default function Hero() {
  const [stats, setStats] = useState<SiteStats | null>(null)
  useEffect(() => { siteApi.stats().then(setStats).catch(() => {}) }, [])
  const nav = useNavigate()
  const [origin, setOrigin] = useState('New York, NY')
  const [dest, setDest] = useState('GH')
  const [mode, setMode] = useState<Mode | 'either'>('either')
  const [scene, setScene] = useState(0)
  const [paused, setPaused] = useState(false)
  const [staticOnly, setStaticOnly] = useState(false)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
    if (reduce || saveData) setStaticOnly(true)
    if (reduce) setPaused(true)
  }, [])
  const copy = sceneCopy[scenes[scene].id]

  return (
    <section className="theme-dark relative overflow-hidden bg-bg text-text">
      {/* backdrop: cycling video, then brand glows, grid and route arcs on top */}
      <HeroVideo active={scene} paused={paused} staticOnly={staticOnly} onNext={() => setScene((i) => (i + 1) % scenes.length)} />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-[720px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(227,181,74,0.14),transparent)]" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.05]" aria-hidden="true"><defs><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" strokeWidth="1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
        <RouteMap />
      </div>

      <div className="container-fluid relative grid gap-8 pb-16 pt-10 md:gap-12 md:pb-28 md:pt-24 lg:grid-cols-12 lg:items-center">
        <motion.div className="lg:col-span-7" initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-5 flex items-center gap-2"><span className="h-px w-8 bg-gold" aria-hidden="true" />
            <AnimatePresence mode="wait" initial={false}><motion.span key={copy.eyebrow} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }} data-testid="hero-eyebrow">{copy.eyebrow}</motion.span></AnimatePresence>
          </motion.p>
          <motion.h1 variants={fadeUp} className="max-w-3xl">
            Send it. <em className="not-italic text-gold-deep">Ntemtem.</em>
          </motion.h1>
          <motion.div variants={fadeUp} className="relative mt-4 min-h-[3.5rem] max-w-xl sm:mt-6 sm:min-h-[5.25rem] md:min-h-[6rem]" aria-live="off">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={scenes[scene].id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }} className="text-lg text-text-muted md:text-xl" data-testid="hero-scene-text">
                <span className="sm:hidden">{copy.short}</span><span className="hidden sm:inline">{copy.text}</span>
              </motion.p>
            </AnimatePresence>
          </motion.div>
          <motion.div variants={fadeUp} className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Hero scenes" data-testid="hero-scenes">
            {scenes.map((sc, i) => (
              <button key={sc.id} type="button" onClick={() => { setScene(i); setPaused(true) }} aria-pressed={i === scene} aria-label={`Show ${sceneCopy[sc.id].tab}`}
                className={`group relative min-h-8 rounded-full px-1.5 text-xs font-semibold focus-ring sm:px-3 ${i === scene ? 'text-white' : 'text-white/60 hover:text-white'}`}>
                <span className={`block h-1 w-6 rounded-full sm:hidden ${i === scene ? 'bg-gold' : 'bg-white/35'}`} aria-hidden="true" />
                <span className="hidden sm:inline">{sceneCopy[sc.id].tab}</span>
                <span className={`absolute inset-x-3 -bottom-0.5 hidden h-0.5 rounded-full sm:block ${i === scene ? 'bg-gold' : 'bg-transparent'}`} aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the scenes' : 'Pause the scenes'} className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-white/30 text-white/80 hover:text-white focus-ring" data-testid="hero-pause">{paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}</button>
          </motion.div>
          <motion.div variants={fadeUp} className="mt-8 hidden gap-3 sm:flex sm:flex-row">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/quote" className="btn-gold w-full sm:w-auto">Get free quotes <ArrowRight size={18} aria-hidden="true" /></Link></motion.div>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}><Link to="/signup?role=shipper" className="btn-ghost w-full !border-white/50 !text-white hover:!border-white hover:!bg-white/10 sm:w-auto">List your shipping company</Link></motion.div>
          </motion.div>
          <motion.ul variants={fadeUp} className="mt-10 hidden flex-wrap gap-x-8 sm:flex gap-y-3 text-sm text-text-muted">
            <li className="flex items-center gap-2"><VerifiedMark size={16} aria-hidden="true" /> {stats ? `${stats.verifiedShippers} verified shippers` : 'Verified shippers, clearly marked'}</li>
            <li className="flex items-center gap-2"><ShieldCheck size={16} className="text-teal" aria-hidden="true" /> Payment protected until the shipper confirms</li>
            <li className="flex items-center gap-2"><Clock size={16} className="text-gold-deep" aria-hidden="true" /> Quotes within 24 hours</li>
          </motion.ul>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          onSubmit={(e) => { e.preventDefault(); nav(`/quote?origin=${encodeURIComponent(origin)}&destination=${dest}&mode=${mode}`) }}
          className="card-dark relative w-full p-6 md:p-7 lg:col-span-5 lg:max-w-[540px] lg:justify-self-end"
          aria-label="Quick quote"
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="!text-xl text-text">Quick quote</h2>
            <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold-deep">Free for senders</span>
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
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="label-dark">Mode</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup">
                {([['either', 'Either', null], ['ocean', 'Ocean', Ship], ['air', 'Air', Plane]] as const).map(([v, label, Icon]) => (
                  <button type="button" key={v} role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-sm font-medium transition-colors focus-ring ${mode === v ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border bg-surface-2 text-text-muted hover:text-text'}`}>
                    {Icon && <Icon size={15} aria-hidden="true" />}{label}
                  </button>
                ))}
              </div>
            </fieldset>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit" className="btn-gold mt-1 w-full">Compare shipper quotes <ArrowRight size={18} aria-hidden="true" /></motion.button>
          </div>
          <p className="mt-4 text-center text-xs text-text-muted">No account needed to request quotes. Shippers reply by email and in your dashboard. <Link to="/shippers?match=1" className="text-gold-deep underline-offset-2 hover:underline focus-ring">Not sure who to pick? Get matched →</Link></p>
        </motion.form>
      </div>

      <div className="container-fluid relative">
        <motion.dl initial="hidden" whileInView="show" viewport={{ once: true }} variants={stagger} className="grid grid-cols-2 gap-6 border-t border-border py-10 md:grid-cols-4">
          {[[stats ? String(stats.verifiedShippers) : '—', 'Verified shippers'], [stats ? String(stats.destinations) : '7', 'West African countries'], [stats ? stats.quotes.toLocaleString() : '—', 'Quotes issued'], [stats ? `${stats.onTimePct}%` : '—', 'Average on-time rate']].map(([v, l]) => (
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
        <linearGradient id="arc" x1="0" x2="1"><stop offset="0" stopColor="var(--color-gold)" stopOpacity="0" /><stop offset="0.5" stopColor="var(--color-gold)" stopOpacity="0.55" /><stop offset="1" stopColor="#6CC3DD" stopOpacity="0" /></linearGradient>
      </defs>
      {['M120 260 Q 620 60 1010 520', 'M420 140 Q 760 120 1030 540', 'M1380 200 Q 1200 380 1040 545', 'M60 420 Q 560 380 1010 530'].map((d, i) => (
        <motion.path key={d} d={d} stroke="url(#arc)" strokeWidth="1.5" strokeDasharray="6 10" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 2.2, delay: 0.6 + i * 0.25, ease: 'easeOut' }} />
      ))}
      <motion.circle cx="1025" cy="535" r="6" fill="var(--color-gold)" initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ delay: 2.2, duration: 0.6 }} />
      <motion.circle cx="1025" cy="535" r="18" stroke="var(--color-gold)" strokeWidth="1" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.6, 0], scale: [0.6, 1.6, 2] }} transition={{ delay: 2.4, duration: 2.4, repeat: Infinity, repeatDelay: 1 }} />
    </svg>
  )
}
