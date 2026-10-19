import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hrApi, type PaySummary, type Person } from '../../lib/driverHrApi'
import { useDisplay } from '../../lib/prefs'
import { niceDay } from '../../lib/dates'
import { Banknote, Coffee, LogIn, LogOut, Play, TrendingUp } from 'lucide-react'
import { driverApi, type DriverStat, type ShiftView } from '../../lib/driverApi'
import { useT } from '../../lib/i18n'
import { fmtDateTime } from '../ui'

const money = (n: number, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n}` } }
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Clock in / break / clock out. Hours go on the office timesheet. */
export function ShiftCard() {
  const t = useT(); const [v, setV] = useState<ShiftView | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { driverApi.shift().then(setV).catch(() => {}) }, [])
  if (!v) return null
  const go = async (a: 'in' | 'break' | 'resume' | 'out') => { setBusy(true); setErr(''); try { setV(await driverApi.clock(a)) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not save.')) } finally { setBusy(false) } }
  const c = v.current
  const b = 'flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold focus-ring disabled:opacity-50'
  return (
    <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby="shift-h" data-testid="shift-card">
      <div className="flex items-baseline justify-between gap-2"><h2 id="shift-h" className="!text-lg">{t('My shift')}</h2><span className="text-sm text-text-muted">{t('{h} h this week', { h: v.week })}</span></div>
      <p className="mt-1 text-base" data-testid="shift-state">{!c ? t('You’re not clocked in.') : c.onBreak ? t('On a break since {time}', { time: clock(c.breaks[c.breaks.length - 1].start) }) : t('Clocked in at {time} · {h} h so far', { time: clock(c.start), h: c.hours })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {!c && <button onClick={() => go('in')} disabled={busy} className={`${b} col-span-2 bg-gold text-on-accent`} data-testid="clock-in"><LogIn size={20} aria-hidden="true" /> {t('Clock in')}</button>}
        {c && !c.onBreak && <button onClick={() => go('break')} disabled={busy} className={`${b} border-2 border-border`} data-testid="clock-break"><Coffee size={20} aria-hidden="true" /> {t('Break')}</button>}
        {c?.onBreak && <button onClick={() => go('resume')} disabled={busy} className={`${b} bg-gold text-on-accent`} data-testid="clock-resume"><Play size={20} aria-hidden="true" /> {t('Back to work')}</button>}
        {c && <button onClick={() => go('out')} disabled={busy} className={`${b} border-2 border-border`} data-testid="clock-out"><LogOut size={20} aria-hidden="true" /> {t('Clock out')}</button>}
      </div>
      {err && <p role="alert" className="mt-2 text-base text-danger">{err}</p>}
    </section>
  )
}

/** Cash still to hand in, and the last handovers the office confirmed. */
export function CashCard() {
  const t = useT(); const [v, setV] = useState<Awaited<ReturnType<typeof driverApi.myCash>> | null>(null)
  useEffect(() => { driverApi.myCash().then(setV).catch(() => {}) }, [])
  if (!v || (!v.due && !v.handovers.length)) return null
  const last = v.handovers[0]
  return (
    <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby="cash-h" data-testid="cash-card">
      <h2 id="cash-h" className="flex items-center gap-2 !text-lg"><Banknote size={20} className="text-gold-deep" aria-hidden="true" /> {t('Cash')}</h2>
      {v.due > 0 ? <p className="mt-1 text-base">{t('Hand {amount} to the office', { amount: money(v.due) })} <span className="text-text-muted">· {t('{n} stops', { n: v.stops.length })}</span></p> : <p className="mt-1 text-base text-text-muted">{t('Nothing to hand in.')}</p>}
      {last && <p className={`mt-2 text-sm ${last.received === last.expected ? 'text-teal' : 'text-danger'}`} data-testid="cash-last">{last.received === last.expected ? t('Last handover confirmed: {amount}', { amount: money(last.received) }) : t('Last handover: {got} received, {want} expected', { got: money(last.received), want: money(last.expected) })} · {fmtDateTime(last.at)}</p>}
    </section>
  )
}

/** This week's work and pay, by the rates the office set. */
export function WeekCard() {
  const t = useT(); const [s, setS] = useState<DriverStat | null>(null)
  useEffect(() => { driverApi.stats(7).then((r) => setS(r.drivers[0] ?? null)).catch(() => {}) }, [])
  if (!s) return null
  const cur = s.pay.currency ?? 'USD'; const hasPay = !!(s.pay.perStop || s.pay.perRun || s.pay.perHour)
  return (
    <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby="week-h" data-testid="week-card">
      <h2 id="week-h" className="flex items-center gap-2 !text-lg"><TrendingUp size={20} className="text-gold-deep" aria-hidden="true" /> {t('My week')}</h2>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Stops')}</dt><dd className="text-2xl font-bold tabular-nums">{s.done}</dd></div>
        <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('On time')}</dt><dd className="text-2xl font-bold tabular-nums">{s.onTimePct == null ? '—' : `${s.onTimePct}%`}</dd></div>
        <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Hours')}</dt><dd className="text-2xl font-bold tabular-nums">{s.hours}</dd></div>
      </dl>
      {hasPay && <p className="mt-3 text-base" data-testid="week-pay">{t('Earned so far')}: <b>{money(s.earned, cur)}</b> <span className="text-sm text-text-muted">({[s.pay.perStop ? t('{amount}/stop', { amount: money(s.pay.perStop, cur) }) : '', s.pay.perRun ? t('{amount}/run', { amount: money(s.pay.perRun, cur) }) : '', s.pay.perHour ? t('{amount}/hour', { amount: money(s.pay.perHour, cur) }) : ''].filter(Boolean).join(' · ')})</span></p>}
      {s.skipped > 0 && <p className="mt-2 text-sm text-text-muted">{t('{n} skipped', { n: s.skipped })}</p>}
    </section>
  )
}

/** "3 things to finish" or "your licence expires" — shown on the driver home until done. */
export function OnboardingNudge() {
  const t = useT(); const [p, setP] = useState<Person | null>(null)
  useEffect(() => { hrApi.me().then((r) => setP(r.person)).catch(() => {}) }, [])
  if (!p) return null
  const left = p.checklist.filter((c) => !c.done).length; const exp = p.expiringSoon
  if (!left && !exp.length) return null
  return (
    <Link to="/dashboard/runs/me" className={`mt-5 block rounded-3xl border-2 p-5 focus-ring ${exp.some((e) => e.expired) ? 'border-danger bg-danger/10' : 'border-gold bg-gold/10'}`} data-testid="onboarding-nudge">
      <p className="text-lg font-bold">{exp.some((e) => e.expired) ? t('Papers expired — you can’t be put on runs') : left ? t('{n} things to finish in My file', { n: left }) : t('Papers expiring soon')}</p>
      <p className="mt-1 text-base">{exp.length ? exp.map((e) => `${t(e.label)}: ${e.date}`).join(' · ') : p.checklist.filter((c) => !c.done).map((c) => t(c.label)).join(' · ')}</p>
    </Link>
  )
}

/** Earned today and when the money lands — the two questions drivers ask most. */
export function PayDayCard() {
  const t = useT(); const disp = useDisplay(); const [s, setS] = useState<PaySummary | null>(null)
  useEffect(() => { hrApi.paySummary().then(setS).catch(() => {}) }, [])
  if (!s) return null
  return (
    <Link to="/dashboard/runs/pay" className="mt-5 grid grid-cols-2 gap-3 rounded-3xl border border-border bg-surface p-5 focus-ring" data-testid="payday-card">
      <span><span className="block text-sm text-text-muted">{t('Earned today')}</span><span className="block text-2xl font-bold tabular-nums">{money(s.today.earned, s.currency)}</span><span className="block text-sm">{(s.today.stops === 1 ? t('1 stop') : t('{n} stops', { n: s.today.stops }))}</span></span>
      <span><span className="block text-sm text-text-muted">{t('Pay day')}</span><span className="block text-lg font-bold">{niceDay(s.payDay, { lang: disp.lang })}</span><span className="block text-sm">{s.closesIn === 0 ? t('Period closes today') : t('Period closes in {n} days', { n: s.closesIn })}</span></span>
    </Link>
  )
}
