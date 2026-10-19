import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { CheckCircle2, ChevronRight, KeyRound, MapPinned, MessageCircle, Navigation, Phone, ScanLine, Sun, WifiOff, X } from 'lucide-react'
import { useStore, api } from '../lib/store'
import { BrandLoader } from '../components/BrandLoader'
import { fadeUp, stagger } from '../lib/motion'
import { RunRow } from './Routes'
import { daySummary, devicePin, saveDevicePin, stopLink, telLink, useDispatch, useMyRuns, useOnline, useQueued, waLink } from '../lib/driver'
import { setDisplay, useDisplay } from '../lib/prefs'
import { useT } from '../lib/i18n'
import { niceDay } from '../lib/dates'
import { roleLabels, type StaffRole } from '../lib/ops'
import { CashCard, ShiftCard, WeekCard } from '../components/driver/HomeCards'

/** A PIN for this phone, so the driver doesn't type a password every morning. */
function PinCard() {
  const t = useT()
  const [hidden, setHidden] = useState(() => { try { return !!devicePin() || localStorage.getItem('ss-pin-later') === '1' } catch { return true } })
  const [open, setOpen] = useState(false); const [pin, setPin] = useState(''); const [again, setAgain] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false)
  if (hidden && !ok) return null
  if (ok) return <p role="status" className="mt-6 rounded-2xl border border-teal/40 bg-teal/10 p-4 text-base" data-testid="pin-ok">{t('PIN saved. Next time, just open Ntemtem on this phone and type it.')}</p>
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (pin !== again) { setErr(t('The two PINs don’t match.')); return }
    setBusy(true); setErr('')
    try { const r = await api<{ device: { id: string; secret: string; name: string; email: string } }>('/auth/pin', { json: { pin } }); saveDevicePin(r.device); setOk(true) } catch (er) { setErr(er instanceof Error ? er.message : t('Could not save.')) } finally { setBusy(false) }
  }
  return (
    <section className="mt-6 rounded-3xl border border-border bg-surface p-5" data-testid="pin-card">
      <div className="flex items-start gap-3"><KeyRound size={22} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><div className="flex-1"><h2 className="!text-lg">{t('Sign in faster on this phone')}</h2><p className="mt-1 text-base text-text-muted">{t('Set a 4–6 digit PIN instead of typing your password each morning.')}</p></div><button onClick={() => { setHidden(true); try { localStorage.setItem('ss-pin-later', '1') } catch { /* ignore */ } }} className="grid h-11 w-11 place-items-center rounded-lg text-text-muted" aria-label={t('Not now')}><X size={18} /></button></div>
      {!open ? <button onClick={() => setOpen(true)} className="btn-gold mt-3 !min-h-12 w-full text-base" data-testid="pin-start">{t('Set a PIN')}</button> : (
        <form onSubmit={save} className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-sm">{t('PIN')}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="input-dark mt-1 !min-h-12 text-center text-xl tracking-[0.4em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="pin-1" /></label>
          <label className="text-sm">{t('Again')}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="input-dark mt-1 !min-h-12 text-center text-xl tracking-[0.4em]" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} data-testid="pin-2" /></label>
          {err && <p role="alert" className="col-span-2 text-sm text-danger">{err}</p>}
          <button disabled={busy || pin.length < 4} className="btn-gold col-span-2 !min-h-12 text-base disabled:opacity-50" data-testid="pin-save">{busy ? t('Saving…') : t('Save PIN')}</button>
          <p className="col-span-2 text-sm text-text-muted">{t('Only works on this phone. Five wrong tries removes it.')}</p>
        </form>
      )}
    </section>
  )
}

/** The driver's home: carry on with today's run, scan, call dispatch. */
export default function MyRuns() {
  const { ready, user } = useStore(); const t = useT(); const disp = useDisplay()
  const { runs, offline: stale, error } = useMyRuns(); const online = useOnline(); const offline = stale || !online; const queued = useQueued(); const { dispatch, phone: dPhone, who } = useDispatch()
  if (!ready) return <BrandLoader partner />
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/runs" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (!runs && !offline) return <BrandLoader partner label={t('Loading your runs…')} />
  const today = new Date().toISOString().slice(0, 10)
  const pickupOnly = user.staffRole === 'pickup_driver'
  const list = runs ?? []
  const active = list.filter((r) => r.status === 'in_progress')
  const upcoming = list.filter((r) => r.status === 'planned').sort((a, b) => a.date.localeCompare(b.date))
  const finishedToday = list.filter((r) => r.status === 'done' && r.date >= today)
  const cur = active[0]
  const next = cur ? [...cur.stops].sort((a, b) => a.seq - b.seq).find((s) => s.status === 'pending') : undefined
  const sum = daySummary(finishedToday)
  return (
    <div className="bg-bg text-text">
      <div className="container-x max-w-2xl py-6 pb-28 md:py-10">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1" data-testid="driver-role">{t(roleLabels[(user.staffRole ?? 'driver') as StaffRole])}</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[2rem]">{t('Hi {name}', { name: user.name.split(' ')[0] })}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-lg text-text-muted">{cur ? t('You have a run in progress.') : upcoming.some((r) => r.date === today) ? t('You have a run planned for today.') : t('Nothing on the road right now.')}</motion.p>
          {(offline || queued > 0) && <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl border border-gold/50 bg-gold/10 px-4 py-3 text-base"><WifiOff size={18} aria-hidden="true" /> {offline ? t('Offline — showing your saved runs') : ''}{queued ? `${offline ? ' · ' : ''}${t('{n} updates waiting', { n: queued })}` : ''}</p>}
          {error && <p role="alert" className="mt-3 text-base text-danger">{error}</p>}

          <motion.div variants={fadeUp}><ShiftCard /></motion.div>
          {cur && (
            <motion.section variants={fadeUp} className="mt-5 rounded-3xl border-2 border-gold bg-surface p-5" aria-labelledby="cur-h" data-testid="continue-run">
              <p className="text-sm font-bold uppercase tracking-wider text-gold-deep">{t('In progress')} · {cur.stops.filter((s) => s.status !== 'pending').length}/{cur.stops.length}</p>
              <h2 id="cur-h" className="mt-1 !text-xl">{cur.name}</h2>
              {next ? <p className="mt-2 text-lg">{t('Next')}: <b>{next.contact || next.label}</b><span className="block text-base text-text-muted">{next.address}</span></p> : <p className="mt-2 text-lg">{t('All stops done — send your summary.')}</p>}
              <div className="mt-4 grid gap-2">
                <Link to={`/dashboard/routes/${cur.id}`} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-base font-semibold text-on-accent focus-ring" data-testid="open-run">{t('Open run')} <ChevronRight size={20} aria-hidden="true" /></Link>
                {next && (next.lat != null || next.address) && <a href={stopLink(next)} target="_blank" rel="noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border text-base font-semibold focus-ring"><Navigation size={20} aria-hidden="true" /> {t('Navigate to next stop')}</a>}
              </div>
            </motion.section>
          )}

          <motion.div variants={fadeUp} className={`mt-5 grid gap-2 ${pickupOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!pickupOnly && <Link to={`/dashboard/scan?kind=delivery${cur ? `&run=${cur.id}` : ''}`} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring"><ScanLine size={22} aria-hidden="true" /> {t('Scan a delivery')}</Link>}
            <Link to="/dashboard/scan?kind=check" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-ring"><ScanLine size={22} aria-hidden="true" /> {t('Check a piece')}</Link>
          </motion.div>

          {upcoming.length > 0 && <motion.section variants={fadeUp} className="mt-7" aria-labelledby="up-h"><h2 id="up-h" className="mb-2 !text-lg">{t('Coming up')}</h2><ul className="space-y-2">{upcoming.map((r) => <li key={r.id}><RunRow r={r} to={`/dashboard/routes/${r.id}`} /></li>)}</ul></motion.section>}
          {!cur && upcoming.length === 0 && <p className="mt-7 flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-4 text-base text-text-muted" data-testid="no-runs"><MapPinned size={18} aria-hidden="true" /> {t('No runs assigned. Dispatch will add them here.')}</p>}

          {finishedToday.length > 0 && (
            <motion.section variants={fadeUp} className="mt-7 rounded-3xl border border-teal/40 bg-surface p-5" aria-labelledby="today-h" data-testid="today-summary">
              <h2 id="today-h" className="flex items-center gap-2 !text-lg"><CheckCircle2 size={20} className="text-teal" aria-hidden="true" /> {t('Today so far')}</h2>
              <p className="mt-1 text-base">{t('{done} done · {skipped} skipped', { done: sum.done, skipped: sum.skipped })}{sum.pieces ? ` · ${t('{n} pieces', { n: sum.pieces })}` : ''}{sum.cash ? ` · $${sum.cash.toLocaleString()} ${t('cash')}` : ''}{sum.momo ? ` · $${sum.momo.toLocaleString()} MoMo` : ''}</p>
              <ul className="mt-2 space-y-1">{finishedToday.map((r) => <li key={r.id}><Link to={`/dashboard/routes/${r.id}`} className="inline-flex min-h-11 items-center gap-1 text-base font-semibold text-gold-deep focus-ring">{r.name} · {niceDay(r.date, { lang: disp.lang })}{r.summarySentAt ? ` · ${t('sent')}` : ` · ${t('summary not sent')}`} <ChevronRight size={16} aria-hidden="true" /></Link></li>)}</ul>
            </motion.section>
          )}

          <motion.div variants={fadeUp}><CashCard /><WeekCard /></motion.div>

          <motion.section variants={fadeUp} className="mt-7 rounded-3xl border border-border bg-surface p-5" aria-labelledby="disp-h" data-testid="dispatch-card">
            <h2 id="disp-h" className="!text-lg">{t('My dispatcher')}</h2>
            {dispatch?.people.length ? <ul className="mt-2 space-y-3">{dispatch.people.slice(0, 3).map((p) => (
              <li key={p.name} className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 text-base"><b>{p.name}</b> <span className="text-text-muted">· {t(p.role === 'dispatcher' ? 'Dispatcher' : 'Owner')}</span></span>
                {p.phone ? <><a href={telLink(p.phone)} className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-border px-4 text-base font-semibold focus-ring"><Phone size={18} aria-hidden="true" /> {t('Call')}</a><a href={waLink(p.phone)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-border px-4 text-base font-semibold focus-ring" aria-label={`WhatsApp ${p.name}`}><MessageCircle size={18} aria-hidden="true" /></a></> : <span className="text-sm text-text-muted">{t('No phone saved')}</span>}
              </li>))}</ul> : <p className="mt-2 text-base text-text-muted">{t('Ask your office to add a dispatcher with a phone number.')}</p>}
            {!dPhone && dispatch?.office.phone && <a href={telLink(dispatch.office.phone)} className="mt-3 inline-flex min-h-12 items-center gap-2 text-base font-semibold text-gold-deep"><Phone size={18} aria-hidden="true" /> {dispatch.office.name} · {dispatch.office.phone}</a>}
            {dPhone && !dispatch?.people.length && <p className="mt-2 text-base">{who}</p>}
          </motion.section>

          <PinCard />

          <button onClick={() => void setDisplay({ road: !disp.road })} aria-pressed={!!disp.road} className={`mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 text-base font-semibold focus-ring ${disp.road ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`} data-testid="road-mode-home"><Sun size={20} aria-hidden="true" /> {disp.road ? t('Road mode is on') : t('Road mode: bigger text, dark at night')}</button>
        </motion.div>
      </div>
    </div>
  )
}
