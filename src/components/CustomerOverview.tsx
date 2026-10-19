/** Customer home: what needs you, money and messages at a glance, recent shipments with quick actions, and a getting-started checklist. */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { OpsOverview } from './OpsOverview'
import { OverviewTabs } from './ShipperOverview'
import { motion } from 'motion/react'
import { ArrowRight, CalendarDays, Check, CheckCircle2, CreditCard, FileText, MessageSquare, Package, Share2, Ship, Truck, Wallet, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { useSummary, type Summary } from '../lib/account'
export { useSummary }
import { hubApi, type CalEvent } from '../lib/customerHub'
import { customerApi, type AttentionItem, type NextArrival } from '../lib/customer'
import { countryByCode, statusLabels, type Shipment } from '../lib/data'
import { Empty, ModeBadge, Pill, money, Flag } from './ui'
import { NeedsYou, NextArrivalCard } from './CustomerHome'
import { fadeUp, stagger } from '../lib/motion'
import { useT } from '../lib/i18n'

/** Pay · Message · Share · Pickup, straight from a shipment card. */
export function ShipmentQuickActions({ s, due }: { s: Shipment; due?: number }) {
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}/track?ref=${s.ref}`
  const share = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const text = `Follow our shipment ${s.ref} here: ${link}`
    try { if (navigator.share) { await navigator.share({ title: `Shipment ${s.ref}`, text, url: link }); return } } catch { return }
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank') }
  }
  const go = (view: string) => `/dashboard?tab=shipments&s=${s.id}&view=${view}`
  const cls = 'inline-flex min-h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-text-muted hover:border-gold/50 hover:text-text focus-ring'
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="quick-actions" onClick={(e) => e.stopPropagation()}>
      {due ? <Link to={go('pay')} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-gold px-2.5 text-xs font-semibold text-on-accent focus-ring" data-testid="qa-pay"><CreditCard size={13} aria-hidden="true" /> Pay {money(due)}</Link> : null}
      <Link to={go('chat')} className={cls} data-testid="qa-message"><MessageSquare size={13} aria-hidden="true" /> Message</Link>
      <button type="button" onClick={share} className={cls} data-testid="qa-share">{copied ? <><Check size={13} aria-hidden="true" /> Link copied</> : <><Share2 size={13} aria-hidden="true" /> Share</>}</button>
      {s.status === 'booked' && <Link to={go('people')} className={cls} data-testid="qa-pickup"><Truck size={13} aria-hidden="true" /> Pickup</Link>}
    </div>
  )
}

const CHECK_KEY = 'ss-getting-started-hidden'
function GettingStarted({ s }: { s: Summary }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(CHECK_KEY) === '1' } catch { return false } })
  if (hidden || s.checklistDone >= s.checklist.length) return null
  const pct = Math.round((s.checklistDone / s.checklist.length) * 100)
  return (
    <motion.section variants={fadeUp} className="card-dark mt-6 p-5" data-testid="getting-started">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold">Get set up</p><p className="text-sm text-text-muted">{s.checklistDone} of {s.checklist.length} done — a few minutes makes every shipment smoother.</p></div>
        <button onClick={() => { setHidden(true); try { localStorage.setItem(CHECK_KEY, '1') } catch { /* private mode */ } }} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 focus-ring" aria-label="Hide the checklist"><X size={16} /></button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} /></div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {s.checklist.map((c) => (
          <li key={c.id}>
            <Link to={c.link} className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm focus-ring ${c.done ? 'border-border text-text-muted' : 'border-gold/40 hover:bg-gold/5'}`} data-testid={`gs-${c.id}`} data-done={c.done}>
              {c.done ? <CheckCircle2 size={17} className="shrink-0 text-teal" aria-hidden="true" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-gold" aria-hidden="true" />}
              <span className={c.done ? 'line-through' : ''}>{c.label}</span>{!c.done && <ArrowRight size={14} className="ml-auto text-gold-deep" aria-hidden="true" />}
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  )
}

function Tile({ to, icon: Icon, label, value, hint, tone, testid }: { to: string; icon: typeof Wallet; label: string; value: string | number; hint: string; tone?: 'bad' | 'gold'; testid?: string }) {
  return (
    <motion.div variants={fadeUp}><Link to={to} className={`card-dark block h-full p-5 transition-colors hover:border-gold/50 focus-ring ${tone === 'bad' ? '!border-danger/40' : tone === 'gold' ? '!border-gold/50' : ''}`} data-testid={testid}>
      <div className="flex items-center justify-between"><p className="text-sm text-text-muted">{label}</p><Icon size={18} className={tone === 'bad' ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /></div>
      <p className="mt-2 font-heading text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-text-muted">{hint}</p>
    </Link></motion.div>
  )
}

export function CustomerOverview() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('ov') === 'activity' ? 'activity' : 'glance'
  const pick = (k: string) => { const n = new URLSearchParams(sp); if (k === 'glance') n.delete('ov'); else n.set('ov', k); setSp(n, { replace: true }) }
  const t = useT()
  return <><OverviewTabs tabs={[['glance', t('At a glance')], ['activity', t('Activity & spending')]]} active={tab} onPick={pick} />{tab === 'activity' ? <OpsOverview scope="customer" /> : <GlanceOverview />}</>
}

function GlanceOverview() {
  const t = useT()
  const { user, shipments, requests } = useStore()
  const sum = useSummary()
  const [home, setHome] = useState<{ items: AttentionItem[]; nextArrival: NextArrival | null } | null>(null)
  const [week, setWeek] = useState<CalEvent[] | null>(null)
  useEffect(() => { customerApi.attention().then(setHome).catch(() => {}); hubApi.calendar(14).then((r) => setWeek(r.events)).catch(() => setWeek([])) }, [shipments, requests])
  const recent = [...shipments].sort((a, b) => Number(a.status === 'delivered') - Number(b.status === 'delivered')).slice(0, 4)
  const brandNew = !!sum && requests.length === 0 && shipments.length === 0
  return (
    <motion.div initial="hidden" animate="show" variants={stagger} data-testid="customer-overview">
      {sum && <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile to="/dashboard?tab=money" icon={Wallet} label={t('You owe')} value={money(sum.owe)} hint={sum.overdue > 0 ? `${money(sum.overdue)} overdue` : sum.owe > 0 ? t('Pay all in one checkout') : sum.credit > 0 ? `${money(sum.credit)} credit to use` : t('All paid up')} tone={sum.overdue > 0 ? 'bad' : undefined} testid="ov-owe" />
        <Tile to="/dashboard?tab=inbox" icon={MessageSquare} label={t('Messages')} value={sum.unread} hint={sum.unread ? t('unread from shippers') : t('Nothing unread')} tone={sum.unread ? 'gold' : undefined} testid="ov-unread" />
        <Tile to="/dashboard?tab=shipments" icon={Ship} label={t('On the way')} value={sum.activeShipments} hint={t('{n} delivered so far', { n: sum.delivered })} testid="ov-active" />
        <Tile to="/dashboard?tab=requests" icon={FileText} label={t('Quotes to review')} value={sum.quotesWaiting} hint={`${sum.openRequests} open request${sum.openRequests === 1 ? '' : 's'}`} tone={sum.quotesWaiting ? 'gold' : undefined} testid="ov-quotes" />
      </div>}
      {sum && user?.role === 'customer' && <GettingStarted s={sum} />}
      {home && <NeedsYou items={home.items} />}
      {home?.nextArrival && <NextArrivalCard s={home.nextArrival} />}
      {brandNew && <div className="mt-8"><Empty title="Ship your first barrel, box or car" body="Tell us what you’re sending and where. Verified shippers on that lane reply with itemised quotes — usually within a day." action={<div className="flex flex-wrap justify-center gap-2"><Link to="/quote" className="btn-gold">Get quotes</Link><Link to="/groupage" className="btn-ghost">Share a barrel instead</Link></div>} /></div>}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {recent.length > 0 && <section aria-labelledby="ov-ship-h" className="min-w-0" data-testid="ov-recent">
          <div className="mb-3 flex items-center justify-between"><h2 id="ov-ship-h" className="!text-lg">Your shipments</h2><Link to="/dashboard?tab=shipments" className="text-sm text-gold-deep hover:underline">All shipments</Link></div>
          <ul className="space-y-3">{recent.map((s) => { const d = countryByCode(s.destination); return (
            <li key={s.id} className="card-dark p-4" data-testid="ov-shipment">
              <Link to={`/dashboard?tab=shipments&s=${s.id}`} className="flex items-start justify-between gap-3 focus-ring rounded"><div className="min-w-0"><p className="font-mono text-xs text-gold-deep">{s.ref}</p><p className="truncate font-semibold">{s.origin} → <Flag code={d?.code} /> {d?.name ?? s.destination}</p><p className="truncate text-xs text-text-muted">{s.description}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><Pill tone={s.status === 'delivered' ? 'green' : 'teal'}>{statusLabels[s.status]}</Pill><ModeBadge mode={s.mode} /></div></Link>
              <div className="mt-3"><ShipmentQuickActions s={s} due={sum?.dueByShipment[s.id]} /></div>
            </li>) })}</ul>
        </section>}
        {(week === null || week.length > 0 || recent.length > 0) && <section aria-labelledby="ov-week-h" className="min-w-0" data-testid="ov-week">
          <div className="mb-3 flex items-center justify-between"><h2 id="ov-week-h" className="!text-lg">Coming up</h2><Link to="/dashboard?tab=week" className="text-sm text-gold-deep hover:underline">Next 2 weeks</Link></div>
          <div className="card-dark p-4">{week === null ? <p className="text-sm text-text-muted">Loading…</p> : week.length === 0 ? <p className="text-sm text-text-muted">Nothing scheduled in the next two weeks.</p> : <ul className="space-y-3">{week.slice(0, 5).map((e, i) => <li key={i}><Link to={e.link} className="flex items-start gap-3 rounded focus-ring"><span className="grid w-12 shrink-0 place-items-center rounded-lg bg-surface-2 py-1 text-center text-xs leading-tight"><b className="block text-base">{new Date(e.date + 'T12:00:00Z').getUTCDate()}</b>{new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span><span className="min-w-0 text-sm"><b className="block truncate">{e.title}</b><span className="text-xs text-text-muted">{e.body}</span></span></Link></li>)}</ul>}</div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <Link to="/quote" className="btn-ghost !min-h-10 text-sm"><Package size={15} aria-hidden="true" /> New request</Link>
            <Link to="/dashboard?tab=money" className="btn-ghost !min-h-10 text-sm"><Wallet size={15} aria-hidden="true" /> Pay & statements</Link>
            <Link to="/dashboard?tab=documents" className="btn-ghost !min-h-10 text-sm"><FileText size={15} aria-hidden="true" /> Documents</Link>
            <Link to="/dashboard?tab=week" className="btn-ghost !min-h-10 text-sm"><CalendarDays size={15} aria-hidden="true" /> Calendar</Link>
          </div>
        </section>}
      </div>
      {sum && sum.delivered > 0 && <p className="mt-6 text-sm"><Link to="/dashboard?tab=plans" className="text-gold-deep hover:underline">Ship again with a shipper you liked →</Link></p>}
    </motion.div>
  )
}
