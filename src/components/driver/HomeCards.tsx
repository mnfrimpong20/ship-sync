import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { hrApi, type PaySummary, type Person } from '../../lib/driverHrApi'
import { useDisplay } from '../../lib/prefs'
import { niceDay } from '../../lib/dates'
import { Banknote, CalendarClock, Check, Clock, Coffee, LogIn, LogOut, Play, ShieldAlert, TrendingUp, Upload } from 'lucide-react'
import { driverApi, type DriverStat, type Shift, type ShiftView } from '../../lib/driverApi'
import { useT } from '../../lib/i18n'
import { fmtDateTime } from '../ui'

const money = (n: number, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n}` } }
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** A shift that closed itself because they forgot to clock out: "That's right" or fix the time. */
export function ShiftReview({ sh, onSaved }: { sh: Shift; onSaved: (v: ShiftView) => void }) {
  const t = useT(); const disp = useDisplay(); const [fix, setFix] = useState(false); const [time, setTime] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const start = new Date(sh.start)
  const go = async (end?: string) => { setBusy(true); setErr(''); try { onSaved(await driverApi.confirmShift(sh.id, end)) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not save.')) } finally { setBusy(false) } }
  const save = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time); if (!m) { setErr(t('Pick the time you finished.')); return }
    const d = new Date(start); d.setHours(Number(m[1]), Number(m[2]), 0, 0); if (d <= start) d.setDate(d.getDate() + 1)
    void go(d.toISOString())
  }
  return (
    <section className="mt-5 rounded-3xl border-2 border-gold bg-gold/10 p-5" aria-labelledby="rev-h" data-testid="shift-review">
      <h2 id="rev-h" className="flex items-center gap-2 !text-lg"><Clock size={20} className="text-gold-deep" aria-hidden="true" /> {t('You didn’t clock out')}</h2>
      <p className="mt-1 text-base">{t('Your {day} shift (in at {in}) was closed for you at {out} — {h} h. Is that right?', { day: niceDay(sh.start.slice(0, 10), { lang: disp.lang }), in: clock(sh.start), out: sh.end ? clock(sh.end) : '', h: sh.hours })}</p>
      {!fix ? <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => void go()} disabled={busy} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-base font-semibold text-on-accent focus-ring disabled:opacity-50" data-testid="review-ok"><Check size={20} aria-hidden="true" /> {t('That’s right')}</button>
        <button onClick={() => { setFix(true); setTime(sh.end ? new Date(sh.end).toTimeString().slice(0, 5) : '') }} disabled={busy} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring" data-testid="review-fix">{t('Fix the time')}</button>
      </div> : <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-base font-semibold">{t('I finished at')}<input type="time" className="input-dark mt-1 !min-h-14 w-40 text-lg" value={time} onChange={(e) => setTime(e.target.value)} data-testid="review-time" /></label>
        <button onClick={save} disabled={busy} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-gold px-4 text-base font-semibold text-on-accent focus-ring disabled:opacity-50" data-testid="review-save">{busy ? t('Saving…') : t('Save')}</button>
      </div>}
      {err && <p role="alert" className="mt-2 text-base text-danger">{err}</p>}
      <p className="mt-2 text-sm text-text-muted">{t('The office sees any change on the timesheet.')}</p>
    </section>
  )
}

/** Clock in / break / clock out. Hours go on the office timesheet. */
export function ShiftCard({ onRun = false }: { onRun?: boolean }) {
  const t = useT(); const [v, setV] = useState<ShiftView | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  useEffect(() => { driverApi.shift().then(setV).catch(() => {}) }, [])
  if (!v) return null
  const go = async (a: 'in' | 'break' | 'resume' | 'out') => { setBusy(true); setErr(''); try { setV(await driverApi.clock(a)) } catch (e) { setErr(e instanceof Error ? e.message : t('Could not save.')) } finally { setBusy(false) } }
  const c = v.current
  const b = 'flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold focus-ring disabled:opacity-50'
  return (
    <>
      {v.review && <ShiftReview sh={v.review} onSaved={(x) => { setV(x); setOk(t('Thanks — your hours are updated.')) }} />}
      {ok && <p role="status" className="mt-3 rounded-2xl border border-teal/40 bg-teal/10 px-4 py-3 text-base" data-testid="review-done">{ok}</p>}
      <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby="shift-h" data-testid="shift-card">
        <div className="flex items-baseline justify-between gap-2"><h2 id="shift-h" className="!text-lg">{t('My shift')}</h2><span className="text-sm text-text-muted">{t('{h} h this week', { h: v.week })}</span></div>
        <p className="mt-1 text-base" data-testid="shift-state">{!c ? (onRun ? t('Your run has started but you’re not clocked in — your hours won’t count.') : t('You’re not clocked in.')) : c.onBreak ? t('On a break since {time}', { time: clock(c.breaks[c.breaks.length - 1].start) }) : t('Clocked in at {time} · {h} h so far', { time: clock(c.start), h: c.hours })}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {!c && <button onClick={() => go('in')} disabled={busy} className={`${b} col-span-2 bg-gold text-on-accent`} data-testid="clock-in"><LogIn size={20} aria-hidden="true" /> {t('Clock in')}</button>}
          {c && !c.onBreak && <button onClick={() => go('break')} disabled={busy} className={`${b} border-2 border-border`} data-testid="clock-break"><Coffee size={20} aria-hidden="true" /> {t('Break')}</button>}
          {c?.onBreak && <button onClick={() => go('resume')} disabled={busy} className={`${b} bg-gold text-on-accent`} data-testid="clock-resume"><Play size={20} aria-hidden="true" /> {t('Back to work')}</button>}
          {c && <button onClick={() => go('out')} disabled={busy} className={`${b} border-2 border-border`} data-testid="clock-out"><LogOut size={20} aria-hidden="true" /> {t('Clock out')}</button>}
        </div>
        {err && <p role="alert" className="mt-2 text-base text-danger">{err}</p>}
      </section>
    </>
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
  if (!s || (!s.done && !s.hours && !s.skipped)) return null
  const cur = s.pay.currency ?? 'USD'; const hasPay = !!(s.pay.perStop || s.pay.perRun || s.pay.perHour)
  return (
    <section className="mt-5 rounded-3xl border border-border bg-surface p-5" aria-labelledby="week-h" data-testid="week-card">
      <h2 id="week-h" className="flex items-center gap-2 !text-lg"><TrendingUp size={20} className="text-gold-deep" aria-hidden="true" /> {t('My week')}</h2>
      <dl className={`mt-3 grid gap-2 text-center ${s.onTimePct == null ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Stops')}</dt><dd className="text-2xl font-bold tabular-nums">{s.done}</dd></div>
        {s.onTimePct != null && <div className="rounded-2xl bg-surface-2 p-3" data-testid="week-ontime"><dt className="text-sm text-text-muted">{t('On time')}</dt><dd className="text-2xl font-bold tabular-nums">{s.onTimePct}%</dd></div>}
        <div className="rounded-2xl bg-surface-2 p-3"><dt className="text-sm text-text-muted">{t('Hours')}</dt><dd className="text-2xl font-bold tabular-nums">{s.hours}</dd></div>
      </dl>
      {hasPay && <p className="mt-3 text-base" data-testid="week-pay">{t('Earned so far')}: <b>{money(s.earned, cur)}</b> <span className="text-sm text-text-muted">({[s.pay.perStop ? t('{amount}/stop', { amount: money(s.pay.perStop, cur) }) : '', s.pay.perRun ? t('{amount}/run', { amount: money(s.pay.perRun, cur) }) : '', s.pay.perHour ? t('{amount}/hour', { amount: money(s.pay.perHour, cur) }) : ''].filter(Boolean).join(' · ')})</span></p>}
      {s.skipped > 0 && <p className="mt-2 text-sm text-text-muted">{t('{n} skipped', { n: s.skipped })}</p>}
    </section>
  )
}

/** "Licence expires in 18 days (Mon 9 Nov)" / "expired 3 days ago" — never a bare ISO date. */
export function expiryText(t: ReturnType<typeof useT>, e: { label: string; date: string }, lang?: 'en' | 'fr') {
  const d = Math.round((Date.parse(e.date + 'T00:00:00') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00')) / 86400000)
  const doc = t(e.label); const day = niceDay(e.date, { lang })
  if (d < 0) return d === -1 ? t('{doc} expired yesterday', { doc }) : t('{doc} expired {n} days ago', { doc, n: -d })
  if (d === 0) return t('{doc} expires today', { doc })
  if (d === 1) return t('{doc} expires tomorrow', { doc })
  return t('{doc} expires in {n} days ({day})', { doc, n: d, day })
}

/** Papers expiring (with an Upload button) or onboarding steps left — shown on the driver home until done. */
export function OnboardingNudge() {
  const t = useT(); const disp = useDisplay(); const [p, setP] = useState<Person | null>(null)
  useEffect(() => { hrApi.me().then((r) => setP(r.person)).catch(() => {}) }, [])
  if (!p) return null
  const left = p.checklist.filter((c) => !c.done); const exp = p.expiringSoon
  if (!left.length && !exp.length) return null
  const expired = exp.some((e) => e.expired)
  if (exp.length) return (
    <section className={`mt-5 rounded-3xl border-2 p-5 ${expired ? 'border-danger bg-danger/10' : 'border-gold bg-gold/10'}`} data-testid="onboarding-nudge" aria-labelledby="nudge-h">
      <h2 id="nudge-h" className="flex items-center gap-2 !text-lg">{expired ? <ShieldAlert size={20} className="text-danger" aria-hidden="true" /> : <CalendarClock size={20} className="text-gold-deep" aria-hidden="true" />}{expired ? t('Papers expired — you can’t be put on runs') : t('Papers expiring soon')}</h2>
      <ul className="mt-3 space-y-2">{exp.map((e) => (
        <li key={e.kind} className="flex flex-wrap items-center gap-2">
          <span className={`min-w-0 flex-1 text-base ${e.expired ? 'font-semibold text-danger' : ''}`} data-testid="expiry-line">{expiryText(t, e, disp.lang)}</span>
          <Link to={`/dashboard/runs/me?renew=${e.kind}`} className="inline-flex min-h-12 items-center gap-1.5 rounded-xl bg-gold px-4 text-base font-semibold text-on-accent focus-ring" data-testid="expiry-upload"><Upload size={18} aria-hidden="true" /> {t('Upload new')}</Link>
        </li>))}</ul>
      {left.length > 0 && <Link to="/dashboard/runs/me" className="mt-3 inline-flex min-h-11 items-center text-base font-semibold underline focus-ring">{t('{n} things to finish in My file', { n: left.length })}</Link>}
    </section>
  )
  return (
    <Link to="/dashboard/runs/me" className="mt-5 block rounded-3xl border-2 border-gold bg-gold/10 p-5 focus-ring" data-testid="onboarding-nudge">
      <p className="text-lg font-bold">{t('{n} things to finish in My file', { n: left.length })}</p>
      <p className="mt-1 text-base">{left.map((c) => t(c.label)).join(' · ')}</p>
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
