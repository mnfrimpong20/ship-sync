import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarDays, CheckCircle2, ChevronRight, FolderOpen, Wallet, MapPinned, Navigation, Phone, ScanLine, WifiOff } from 'lucide-react'
import { useStore } from '../lib/store'
import { BrandLoader } from '../components/BrandLoader'
import { fadeUp, stagger } from '../lib/motion'
import { RunRow } from './Routes'
import { daySummary, stopLink, useMyRuns, useOnline, useQueued } from '../lib/driver'
import { openDispatch } from '../components/driver/DispatchSheet'
import { useDisplay } from '../lib/prefs'
import { useT } from '../lib/i18n'
import { niceDay } from '../lib/dates'
import { roleLabels, type StaffRole } from '../lib/ops'
import { CashCard, OnboardingNudge, PayDayCard, ShiftCard, WeekCard } from '../components/driver/HomeCards'

/** The driver's home: today's run first, then what needs doing (papers, shift), then pay and the week. */
export default function MyRuns() {
  const { ready, user } = useStore(); const t = useT(); const disp = useDisplay()
  const { runs, offline: stale, error } = useMyRuns(); const online = useOnline(); const offline = stale || !online; const queued = useQueued()
  if (!ready) return <BrandLoader partner />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/runs" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (!runs && !offline) return <BrandLoader partner label={t('Loading your runs…')} />
  const today = new Date().toISOString().slice(0, 10)
  const pickupOnly = user.staffRole === 'pickup_driver'
  const list = runs ?? []
  const active = list.filter((r) => r.status === 'in_progress')
  const planned = list.filter((r) => r.status === 'planned').sort((a, b) => a.date.localeCompare(b.date))
  const cur = active[0]
  const todayRun = !cur ? planned.find((r) => r.date <= today) : undefined
  const top = cur ?? todayRun
  const upcoming = planned.filter((r) => r.id !== todayRun?.id)
  const finishedToday = list.filter((r) => r.status === 'done' && r.date >= today)
  const next = top ? [...top.stops].sort((a, b) => a.seq - b.seq).find((s) => s.status === 'pending') : undefined
  const doneN = top ? top.stops.filter((s) => s.status !== 'pending').length : 0
  const sum = daySummary(finishedToday)
  const tile = 'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring'
  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-2xl py-6 pb-28 md:py-10">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1" data-testid="driver-role">{t(roleLabels[(user.staffRole ?? 'driver') as StaffRole])}</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[2rem]">{t('Hi {name}', { name: user.name.split(' ')[0] })}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-lg text-text-muted">{cur ? t('You have a run in progress.') : todayRun ? t('You have a run planned for today.') : t('Nothing on the road right now.')}</motion.p>
          {(offline || queued > 0) && <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl border border-gold/50 bg-gold/10 px-4 py-3 text-base"><WifiOff size={18} aria-hidden="true" /> {offline ? t('Offline — showing your saved runs') : ''}{queued ? `${offline ? ' · ' : ''}${t('{n} updates waiting', { n: queued })}` : ''}</p>}
          {error && <p role="alert" className="mt-3 text-base text-danger">{error}</p>}

          {top && (
            <motion.section variants={fadeUp} className="mt-5 rounded-3xl border-2 border-gold bg-surface p-5" aria-labelledby="cur-h" data-testid="continue-run">
              <p className="text-sm font-bold uppercase tracking-wider text-gold-deep">{cur ? t('In progress') : t('Today’s run')} · {doneN}/{top.stops.length}</p>
              <h2 id="cur-h" className="mt-1 !text-xl">{top.name}</h2>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true"><div className="h-full rounded-full bg-gold" style={{ width: `${top.stops.length ? (doneN / top.stops.length) * 100 : 0}%` }} /></div>
              {next ? <p className="mt-3 text-lg">{cur ? t('Next') : t('First stop')}: <b>{next.contact || next.label}</b><span className="block text-base text-text-muted">{next.address}</span></p> : <p className="mt-3 text-lg">{t('All stops done — send your summary.')}</p>}
              <div className="mt-4 grid gap-2">
                <Link to={`/dashboard/routes/${top.id}`} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-base font-semibold text-on-accent focus-ring" data-testid="open-run">{cur ? t('Open run') : t('Open run & start')} <ChevronRight size={20} aria-hidden="true" /></Link>
                {cur && next && (next.lat != null || next.address) && <a href={stopLink(next)} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border text-base font-semibold focus-ring"><Navigation size={20} aria-hidden="true" /> {t('Navigate to next stop')}</a>}
              </div>
            </motion.section>
          )}

          <motion.div variants={fadeUp}><OnboardingNudge /><ShiftCard onRun={!!cur} /></motion.div>

          <motion.div variants={fadeUp} className={`mt-5 grid gap-2 ${pickupOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!pickupOnly && <Link to={`/dashboard/scan?kind=delivery${cur ? `&run=${cur.id}` : ''}`} className={tile}><ScanLine size={22} aria-hidden="true" /> {t('Scan a delivery')}</Link>}
            <Link to="/dashboard/scan?kind=check" className={tile}><ScanLine size={22} aria-hidden="true" /> {t('Check a piece')}</Link>
          </motion.div>

          {upcoming.length > 0 && <motion.section variants={fadeUp} className="mt-7" aria-labelledby="up-h"><h2 id="up-h" className="mb-2 !text-lg">{t('Coming up')}</h2><ul className="space-y-2">{upcoming.map((r) => <li key={r.id}><RunRow r={r} to={`/dashboard/routes/${r.id}`} /></li>)}</ul></motion.section>}
          {!top && upcoming.length === 0 && <p className="mt-7 flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-4 text-base text-text-muted" data-testid="no-runs"><MapPinned size={18} aria-hidden="true" /> {t('No runs assigned. Dispatch will add them here.')}</p>}

          {finishedToday.length > 0 && (
            <motion.section variants={fadeUp} className="mt-7 rounded-3xl border border-teal/40 bg-surface p-5" aria-labelledby="today-h" data-testid="today-summary">
              <h2 id="today-h" className="flex items-center gap-2 !text-lg"><CheckCircle2 size={20} className="text-teal" aria-hidden="true" /> {t('Today so far')}</h2>
              <p className="mt-1 text-base">{t('{done} done · {skipped} skipped', { done: sum.done, skipped: sum.skipped })}{sum.pieces ? ` · ${t('{n} pieces', { n: sum.pieces })}` : ''}{sum.cash ? ` · $${sum.cash.toLocaleString()} ${t('cash')}` : ''}{sum.momo ? ` · $${sum.momo.toLocaleString()} MoMo` : ''}</p>
              <ul className="mt-2 space-y-1">{finishedToday.map((r) => <li key={r.id}><Link to={`/dashboard/routes/${r.id}`} className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-gold-deep focus-ring">{r.name} · {niceDay(r.date, { lang: disp.lang })}{r.summarySentAt ? ` · ${t('sent')}` : ` · ${t('summary not sent')}`} <ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul>
            </motion.section>
          )}

          <motion.div variants={fadeUp}><PayDayCard /><CashCard /><WeekCard /></motion.div>

          <motion.nav variants={fadeUp} aria-label={t('My work')} className="mt-5 grid grid-cols-3 gap-2" data-testid="hr-links">
            {([['/dashboard/runs/pay', Wallet, 'My pay'], ['/dashboard/runs/time', CalendarDays, 'Time off'], ['/dashboard/runs/me', FolderOpen, 'My file']] as const).map(([to, I, l]) => <Link key={to} to={to} className={tile}><I size={22} aria-hidden="true" /> {t(l)}</Link>)}
          </motion.nav>
          <button onClick={() => openDispatch()} className="mt-2 hidden min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring lg:flex" data-testid="dispatch-desktop"><Phone size={20} aria-hidden="true" /> {t('Contact dispatch')}</button>
        </motion.div>
      </div>
    </div>
  )
}
