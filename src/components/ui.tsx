import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Plane, Ship, ShieldCheck, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { fadeUp, stagger, viewport } from '../lib/motion'
import { countryByCode, type Mode, type Shipper } from '../lib/data'

/** Tagline under the wordmark. One place to change it. */
export const TAGLINE = 'Home, quickly'

/** The Ntemtem mark: two rounded chevrons (green trailing, navy leading) sending a box forward, on a gold tile.
 *  `partner` draws the shipper-side version on a charcoal tile. Colours are fixed brand values, not theme tokens. */
export function Mark({ size = 34, partner = false }: { size?: number; partner?: boolean }) {
  const tile = partner ? '#24211C' : '#F2A900', trail = partner ? '#37B07A' : '#0E7A4E', lead = partner ? '#F2A900' : '#14213D'
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill={tile} />
      <path d="M17,28 L35,48 L17,68" fill="none" stroke={trail} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M39,28 L57,48 L39,68" fill="none" stroke={lead} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="64" y="38" width="20" height="20" rx="5" fill={lead} />
    </svg>
  )
}

export function Logo({ light = true, className = '', tagline = true, partner = false }: { light?: boolean; className?: string; tagline?: boolean; partner?: boolean }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 focus-ring rounded-md ${className}`} aria-label={partner ? 'Ntemtem Partner home' : 'Ntemtem home'}>
      <Mark size={34} partner={partner} />
      <span className="flex flex-col leading-none">
        <span className={`font-heading text-[1.45rem] font-extrabold tracking-[-0.02em] ${light ? 'text-text' : 'text-ink'}`}>ntemtem</span>
        {partner
          ? <span className="mt-1 whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.16em] text-gold-deep">Partner</span>
          : tagline && <span className={`mt-1 whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-[0.16em] ${light ? 'text-text-muted' : 'text-ink/70'}`}>{TAGLINE}</span>}
      </span>
    </Link>
  )
}

/** "Ntemtem Verified" — only for shippers who passed vetting. Green: verified is good news. */
export function VerifiedBadge({ large = false }: { large?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-teal/30 bg-teal/10 font-semibold text-teal ${large ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'}`} title="Passed Ntemtem vetting: business registration, insurance, warehouse and track record">
      <BadgeCheck size={large ? 14 : 12} aria-hidden="true" /> Ntemtem Verified
    </span>
  )
}

/** The payment-protection line — same words at every booking and payment step. */
export const PROTECTED_LINE = 'You don’t pay the shipper until they confirm your shipment. If something goes wrong, we hold the money.'
export function ProtectedNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg border border-teal/25 bg-teal/5 px-3 py-2 text-xs leading-relaxed text-text ${className}`} data-testid="payment-protected">
      <ShieldCheck size={15} className="mt-px shrink-0 text-teal" aria-hidden="true" />
      <span><strong className="font-semibold">Payment protected.</strong> {PROTECTED_LINE}</span>
    </p>
  )
}

export function Section({ id, children, className = '', light = false }: { id?: string; children: ReactNode; className?: string; light?: boolean }) {
  return (
    <section id={id} className={`section-y ${light ? 'bg-light text-ink' : 'bg-bg text-text'} ${className}`}>
      <motion.div className="container-x" initial="hidden" whileInView="show" viewport={viewport} variants={stagger}>
        {children}
      </motion.div>
    </section>
  )
}

export function SectionHeader({ eyebrow, title, body, light = false, align = 'center' }: { eyebrow: string; title: string; body?: string; light?: boolean; align?: 'center' | 'left' }) {
  return (
    <div className={`mb-12 max-w-2xl md:mb-16 ${align === 'center' ? 'mx-auto text-center' : ''}`}>
      <motion.p variants={fadeUp} className={`eyebrow mb-3 ${light ? 'text-gold-deep' : ''}`}>{eyebrow}</motion.p>
      <motion.h2 variants={fadeUp} className={light ? 'text-ink' : 'text-text'}>{title}</motion.h2>
      {body && <motion.p variants={fadeUp} className={`mt-4 text-lg ${light ? 'text-ink-muted' : 'text-text-muted'}`}>{body}</motion.p>}
    </div>
  )
}

export function ModeBadge({ mode, light = false }: { mode: Mode; light?: boolean }) {
  const air = mode === 'air'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${air ? 'border-sky/40 text-sky' : 'border-sea/40 text-sea'} ${light ? 'bg-bg/90' : 'bg-surface-2'}`}>
      {air ? <Plane size={13} aria-hidden="true" /> : <Ship size={13} aria-hidden="true" />}{air ? 'Air' : 'Ocean'}
    </span>
  )
}

export function Rating({ value, count, light = false }: { value: number; count?: number; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${light ? 'text-ink' : 'text-text'}`} aria-label={`Rated ${value} out of 5${count ? ` from ${count} reviews` : ''}`}>
      <Star size={15} className="fill-gold text-gold-deep" aria-hidden="true" />
      <span className="font-semibold">{value.toFixed(1)}</span>
      {count !== undefined && <span className={light ? 'text-ink-muted' : 'text-text-muted'}>({count})</span>}
    </span>
  )
}

export function Avatar({ initials, hue, size = 48 }: { initials: string; hue: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-2xl font-heading font-bold text-ink" style={{ width: size, height: size, background: `linear-gradient(135deg, ${hue}, ${hue}99)`, fontSize: size * 0.36 }} aria-hidden="true">
      {initials}
    </span>
  )
}

export function ShipperCard({ s, light = false }: { s: Shipper; light?: boolean }) {
  return (
    <motion.article variants={fadeUp} whileHover={{ y: -4 }} transition={{ duration: 0.2 }} className={`${light ? 'card-light' : 'card-dark'} flex h-full flex-col p-6`}>
      <div className="flex items-start gap-4">
        <Avatar initials={s.initials} hue={s.hue} />
        <div className="min-w-0 flex-1">
          <h3 className={`flex items-center gap-1.5 text-lg ${light ? 'text-ink' : 'text-text'}`}>
            <span className="truncate">{s.name}</span>
            {s.verified && <BadgeCheck size={18} className="shrink-0 text-gold-deep" aria-label="Verified shipper" />}
          </h3>
          <p className={`line-clamp-2 min-h-10 text-sm ${light ? 'text-ink-muted' : 'text-text-muted'}`}>{s.tagline}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {s.modes.map((m) => <ModeBadge key={m} mode={m} light={light} />)}
        <Rating value={s.rating} count={s.reviews} light={light} />
      </div>
      <p className={`mt-4 line-clamp-2 text-sm ${light ? 'text-ink-muted' : 'text-text-muted'}`}>
        Ships to {s.destinations.map((d) => countryByCode(d)?.name).filter(Boolean).join(', ')} · HQ {s.hq}
      </p>
      <div className="flex-1" />
      <dl className={`mt-4 grid grid-cols-3 gap-2 border-t pt-4 text-center text-xs ${light ? 'border-border-light' : 'border-border'}`}>
        <div><dt className={light ? 'text-ink-muted' : 'text-text-muted'}>On-time</dt><dd className={`font-semibold ${light ? 'text-ink' : 'text-text'}`}>{s.onTime}%</dd></div>
        <div><dt className={light ? 'text-ink-muted' : 'text-text-muted'}>Responds</dt><dd className={`font-semibold ${light ? 'text-ink' : 'text-text'}`}>~{s.responseHours}h</dd></div>
        <div><dt className={light ? 'text-ink-muted' : 'text-text-muted'}>Since</dt><dd className={`font-semibold ${light ? 'text-ink' : 'text-text'}`}>{s.founded}</dd></div>
      </dl>
      <div className="mt-5 flex gap-2">
        <Link to={`/shippers/${s.id}`} className={`${light ? 'btn-light' : 'btn-ghost'} flex-1 !min-h-10 !px-4 text-sm`}>View profile</Link>
        <Link to={`/quote?shipper=${s.id}&destination=${s.destinations[0]}`} className="btn-gold flex-1 !min-h-10 !px-4 text-sm">Get quote</Link>
      </div>
    </motion.article>
  )
}

export function Pill({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'teal' | 'sea' | 'sky' | 'muted' | 'danger' | 'green' }) {
  const tones = {
    gold: 'bg-gold/15 text-gold-deep border-gold/40', teal: 'bg-teal/15 text-teal border-teal/30', sea: 'bg-sea/15 text-sea border-sea/30', sky: 'bg-sky/15 text-sky border-sky/30',
    muted: 'bg-surface-2 text-text-muted border-border', danger: 'bg-danger/15 text-danger border-danger/30', green: 'bg-teal/15 text-teal border-teal/30',
  }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card-dark flex flex-col items-center px-6 py-14 text-center">
      <svg className="mb-4 h-16 w-20 text-text-muted" viewBox="0 0 80 64" fill="none" aria-hidden="true"><path d="M6 44h68l-8 12H14z" fill="var(--color-gold)" opacity=".9" /><path d="M20 44V22h14l8 8h14v14" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity=".6" /><path d="M8 40c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".35" /><circle cx="62" cy="14" r="5" stroke="var(--color-gold)" strokeWidth="2" /></svg>
      <h3 className="text-text">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
