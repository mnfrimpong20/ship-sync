import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Plane, Ship, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { fadeUp, stagger, viewport } from '../lib/motion'
import { countryByCode, type Mode, type Shipper } from '../lib/data'

export function Logo({ light = true, className = '' }: { light?: boolean; className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 focus-ring rounded-md ${className}`} aria-label="Ship Sync home">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={light ? '#E3B54A' : '#0B1220'} />
        <path d="M7 20h18l-2 4H9z" fill={light ? '#0B1220' : '#E3B54A'} />
        <path d="M11 18V9h4l6 6v3" fill="none" stroke={light ? '#0B1220' : '#E3B54A'} strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <span className={`font-heading text-[1.35rem] font-bold tracking-tight ${light ? 'text-text' : 'text-ink'}`}>Ship<span className={light ? 'text-gold' : 'text-gold-deep'}>Sync</span></span>
    </Link>
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
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${air ? 'border-sky/40 text-sky' : 'border-teal/40 text-teal'} ${light ? 'bg-bg/90' : 'bg-surface-2'}`}>
      {air ? <Plane size={13} aria-hidden="true" /> : <Ship size={13} aria-hidden="true" />}{air ? 'Air' : 'Ocean'}
    </span>
  )
}

export function Rating({ value, count, light = false }: { value: number; count?: number; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${light ? 'text-ink' : 'text-text'}`} aria-label={`Rated ${value} out of 5${count ? ` from ${count} reviews` : ''}`}>
      <Star size={15} className="fill-gold text-gold" aria-hidden="true" />
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
            {s.verified && <BadgeCheck size={18} className="shrink-0 text-gold" aria-label="Verified shipper" />}
          </h3>
          <p className={`text-sm ${light ? 'text-ink-muted' : 'text-text-muted'}`}>{s.tagline}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {s.modes.map((m) => <ModeBadge key={m} mode={m} light={light} />)}
        <Rating value={s.rating} count={s.reviews} light={light} />
      </div>
      <p className={`mt-4 text-sm ${light ? 'text-ink-muted' : 'text-text-muted'}`}>
        Ships to {s.destinations.map((d) => countryByCode(d)?.name).filter(Boolean).join(', ')} · HQ {s.hq}
      </p>
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

export function Pill({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'teal' | 'sky' | 'muted' | 'danger' | 'green' }) {
  const tones = {
    gold: 'bg-gold/15 text-gold border-gold/30', teal: 'bg-teal/15 text-teal border-teal/30', sky: 'bg-sky/15 text-sky border-sky/30',
    muted: 'bg-surface-2 text-text-muted border-border', danger: 'bg-danger/15 text-danger border-danger/30', green: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card-dark flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 h-12 w-12 rounded-2xl border border-dashed border-border" aria-hidden="true" />
      <h3 className="text-text">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
