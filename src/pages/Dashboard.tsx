import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Clock, FileText, Pencil, PlusCircle, Search, Send, X } from 'lucide-react'
import { cargoName, countryByCode, type CargoType, type Shipper } from '../lib/data'
import { useStore, type QuoteRequest } from '../lib/store'
import { useT, fmtDay, relDay } from '../lib/i18n'
import { useLang } from '../lib/prefs'
import { Empty, ModeBadge, Pill, fmtDate, money, VerifiedMark, Flag } from '../components/ui'
import { ShipmentDetail } from './Track'
import { DocumentsPanel } from '../components/DocumentsPanel'
import { PickupCard } from '../components/PickupCard'
import { RecipientPanel } from '../components/RecipientPanel'
import { DutyCard } from '../components/Duty'
import { SourcingTab } from './Sourcing'
import { InsuranceCard } from '../components/InsuranceCard'
import { Recipients } from '../components/CustomerHome'
import { PaymentCard } from '../components/PaymentCard'
import { PackingSuppliesCard } from '../components/PackingSupplies'
import { ExportCard } from '../components/Compliance'
import { ReceiverChargesCard } from '../components/ReceiverCharges'
import { PriceAdjustmentCard } from '../components/PriceAdjustment'
import { QuoteList, RequestManage } from '../components/RequestPanel'
import { CollectionNotice, OffersCard } from '../components/FlowCards'
import { VehicleCard } from '../components/VehicleCard'
import { CustomsCard } from '../components/CustomsCard'
import { DisputeCard, ReviewCard } from '../components/ReviewCards'
import { groupageApi, unitsLabel, type Spot } from '../lib/groupage'
import { collectionsApi, type InvoiceFull } from '../lib/collections'
import ProfileEditor from '../components/ProfileEditor'
import { fadeUp, stagger } from '../lib/motion'
import ShipperOverview from '../components/ShipperOverview'
import { CustomerOverview, ShipmentQuickActions, useSummary } from '../components/CustomerOverview'
import { AccountTab, DocumentsTab, InboxTab, IssuesTab, MoneyTab, SavedTab, WeekTab } from '../components/CustomerTabs'
import { DutyEarly, FamilyShare, NextStep, PackingList, ShipmentChat } from '../components/ShipmentExtras'

function Layout({ title, sub, children, cta, eyebrow = 'Workspace' }: { title: string; sub: string; children: React.ReactNode; cta?: React.ReactNode; eyebrow?: string }) {
  const t = useT()
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">{t(eyebrow)}</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{t(title)}</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">{sub}</motion.p></div>
            {cta && <motion.div variants={fadeUp}>{cta}</motion.div>}
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  )
}

/* ================= CUSTOMER ================= */
const TABS = ['requests', 'shipments', 'money', 'week', 'inbox', 'documents', 'plans', 'groupage', 'sourcing', 'invoices', 'recipients', 'issues', 'account'] as const
type Tab = typeof TABS[number] | 'overview'
const SECTIONS: Record<typeof TABS[number], { title: string; sub: string; group: string; cta?: boolean }> = {
  requests: { title: 'Quote requests', sub: 'Compare quotes, ask shippers questions and book.', group: 'Shipping', cta: true },
  shipments: { title: 'Shipments', sub: 'Track, pay, share and manage everything you’ve booked.', group: 'Shipping', cta: true },
  groupage: { title: 'Shared barrels', sub: 'Space you reserved in shared barrels and containers.', group: 'Shipping' },
  sourcing: { title: 'Sourcing', sub: 'Goods we’re buying for you in China, the UK and the USA.', group: 'Shipping' },
  money: { title: 'Money', sub: 'What you owe, what you’ve spent, and your statements.', group: 'Money' },
  invoices: { title: 'Invoices', sub: 'Every invoice from your shippers, with pay links.', group: 'Money' },
  week: { title: 'This week', sub: 'Pickups, cutoffs, arrivals, payments and collection days.', group: 'Organise' },
  inbox: { title: 'Messages', sub: 'Every conversation with your shippers, before and after booking.', group: 'Organise' },
  documents: { title: 'Documents', sub: 'Invoices, receipts, packing lists and customs papers in one place.', group: 'Organise' },
  plans: { title: 'Saved & repeat', sub: 'Favourite shippers, repeat shipments and price alerts.', group: 'Organise' },
  recipients: { title: 'Recipients', sub: 'The people who receive your goods — saved once, picked in a tap.', group: 'Organise' },
  issues: { title: 'Problems', sub: 'Something went wrong? Report it and follow every reply here.', group: 'Help' },
  account: { title: 'Account', sub: 'Your profile, security, alerts, family and business details.', group: 'Account' },
}
export function CustomerDashboard() {
  const { ready, user, requests, shipments, acceptQuote, shipperById } = useStore()
  const [sp, setSp] = useSearchParams()
  const t = useT(); const lang = useLang()
  // Each section is its own page (the sidebar is the menu); with no tab you get the overview.
  // Old links that open a request (?request= / ?open=) land on Quote requests.
  const asTab = (q: URLSearchParams): Tab => { const t = q.get('tab'); if (t && (TABS as readonly string[]).includes(t)) return t as Tab; return q.get('request') || q.get('open') ? 'requests' : 'overview' }
  const [tab, setTabState] = useState<Tab>(asTab(sp))
  const setTab = (t: Tab) => { setTabState(t); setSp(t === 'overview' ? {} : { tab: t }, { replace: true }) }
  useEffect(() => { setTabState(asTab(sp)) }, [sp])
  const [openReq, setOpenReq] = useState<string | null>(sp.get('request') ?? (sp.get('tab') ? null : sp.get('open')))
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busyQuote, setBusyQuote] = useState<string | null>(null)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])
  if (!ready) return <div className="bg-bg text-text"><BrandLoader label="Loading your dashboard…" /></div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/dashboard${sp.toString() ? `?${sp}` : ''}`)}`} replace />
  if (user.role === 'shipper') return <Navigate to="/dashboard/shipper" replace />

  const meta = SECTIONS[tab as Exclude<Tab, 'overview'>]
  void shipments
  const accept = async (r: QuoteRequest, qid: string) => {
    setBusyQuote(qid); setError('')
    try {
      const sh = await acceptQuote(r.id, qid)
      setToast(`Booked with ${shipperById(sh.shipperId)?.name ?? 'your shipper'}. Reference ${sh.ref}.`)
      setOpenReq(null); setTab('shipments'); setSp({})
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not accept this quote.') }
    finally { setBusyQuote(null) }
  }

  return (
    <Layout eyebrow={tab === 'overview' ? t('Your account') : t(meta.group)} title={tab === 'overview' ? `${lang === 'fr' ? 'Bonjour' : 'Akwaaba'}, ${user.name.split(' ')[0]}` : t(meta.title)} sub={tab === 'overview' ? t('What needs you, what’s on the way, and what you owe.') : t(meta.sub)} cta={tab === 'overview' || meta.cta ? <Link to="/quote" className="btn-gold"><PlusCircle size={18} aria-hidden="true" /> {t('New shipment request')}</Link> : undefined}>
      <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" />{toast}</motion.p>}</AnimatePresence>
      {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {tab === 'overview' && <CustomerOverview />}

      {tab === 'requests' && (
        <div className="mt-6 space-y-4">
          {requests.length === 0 && <Empty title="No quote requests yet" body="Post your first shipment and matching shippers will reply with itemised quotes." action={<Link to="/quote" className="btn-gold">Request quotes</Link>} />}
          {requests.map((r) => {
            const dest = countryByCode(r.destination)!
            const isOpen = openReq === r.id
            const accepted = r.quotes.find((q) => q.status === 'accepted')
            return (
              <motion.div key={r.id} layout className="card-dark overflow-hidden">
                <button onClick={() => setOpenReq(isOpen ? null : r.id)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-surface-2/50 focus-ring">
                  <div className="flex items-center gap-4">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/15 text-gold-deep"><FileText size={20} aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold text-text">{r.origin} → <Flag code={dest.code} /> {dest.name} <span className="font-normal text-text-muted">· {r.quantity} × {cargoName(r.cargo, r.cargoItems)}</span></p>
                      <p className="text-xs text-text-muted">{r.ref} · posted {fmtDate(r.createdAt)} · {r.mode === 'either' ? 'air or ocean' : r.mode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.status === 'cancelled' ? <Pill tone="muted">Cancelled</Pill> : r.status === 'expired' ? <Pill tone="muted">Expired</Pill> : r.status === 'booked' ? <Pill tone="green">Booked · {shipperById(accepted?.shipperId ?? '')?.name}</Pill> : <Pill tone={r.quotes.length ? 'gold' : 'muted'}>{r.quotes.length ? `${r.quotes.length} quote${r.quotes.length > 1 ? 's' : ''}` : 'Awaiting quotes'}</Pill>}
                    <ChevronRight size={18} className={`text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                      <div className="border-t border-border p-5">
                        <div className="mb-3 flex flex-wrap items-center gap-2">{r.consignee && <span className="text-xs text-text-muted">Recipient: <b className="text-text">{r.consignee.name}</b>{r.consignee.city ? `, ${r.consignee.city}` : ''}</span>}<Link to={`/quote?again=${r.id}`} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="ship-again"><Send size={13} aria-hidden="true" /> Ship again</Link></div>
                        <p className="text-sm text-text-muted">{r.description || 'No description provided.'} {r.pickup && '· Pickup'} {r.delivery && '· Door delivery'} {r.insurance && '· Insurance'}</p>
                        {r.quotes.length === 0 ? (
                          <p className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 p-4 text-sm text-text-muted"><Clock size={16} aria-hidden="true" /> {r.status === 'open' ? `Shippers usually reply within 24 hours. We’ll email you at ${r.contact.email}.` : 'No quotes came in.'}</p>
                        ) : <QuoteList r={r} accept={accept} busyQuote={busyQuote} threadFor={sp.get('open') === r.id ? sp.get('thread') : null} />}
                        <RequestManage r={r} wantMarket={sp.get('open') === r.id && sp.get('market') === '1'} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}

      {tab === 'shipments' && <ShipmentsTab />}
      {tab === 'groupage' && <GroupageTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'sourcing' && <SourcingTab />}
      {tab === 'recipients' && <Recipients />}
      {tab === 'money' && <MoneyTab />}
      {tab === 'week' && <WeekTab />}
      {tab === 'inbox' && <InboxTab />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'plans' && <SavedTab />}
      {tab === 'issues' && <IssuesTab />}
      {tab === 'account' && <AccountTab />}
    </Layout>
  )
}

/** Invoices raised on the customer by their shippers, with pay links. */
function InvoicesTab() {
  const [d, setD] = useState<Awaited<ReturnType<typeof collectionsApi.mine>> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { collectionsApi.mine().then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.')) }, [])
  const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)
  return (
    <div className="mt-6" data-testid="invoices-tab">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {d && d.totals.outstanding > 0 && <p className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${d.totals.overdue > 0 ? 'border-danger/40 bg-danger/10' : 'border-gold/40 bg-gold/10'}`}><strong>{usd(d.totals.outstanding)}</strong> outstanding{d.totals.overdue > 0 ? ` · ${usd(d.totals.overdue)} overdue` : ''}. Pay by card in a minute — the money is protected by Ntemtem.</p>}
      {d === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {d && d.invoices.length === 0 && <Empty title="No invoices" body="When a shipper invoices you it shows up here with a secure pay link." />}
      <ul className="grid gap-3 md:grid-cols-2">
        {d?.invoices.map((inv: InvoiceFull) => (
          <li key={inv.id} className={`card-dark min-w-0 p-5 ${inv.status === 'paid' ? 'bg-surface-2/40' : ''}`} data-testid="my-invoice">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-xs text-text-muted">{inv.number}</p><p className="truncate font-semibold">{inv.shipper.name}</p>{inv.shipmentRef && <p className="text-xs text-text-muted">Shipment {inv.shipmentRef}</p>}</div><Pill tone={inv.status === 'paid' ? 'green' : inv.overdue ? 'danger' : 'gold'}>{inv.status === 'paid' ? 'Paid' : inv.overdue ? 'Overdue' : 'Due'}</Pill></div>
            <p className="mt-3 text-2xl font-bold tabular-nums">{usd(inv.status === 'paid' ? inv.total : inv.balance)}</p>
            <p className="text-xs text-text-muted">{inv.status === 'paid' ? 'Paid in full' : inv.dueAt ? `Due ${fmtDate(inv.dueAt)}` : 'No due date'}{inv.paid > 0 && inv.status !== 'paid' ? ` · ${usd(inv.paid)} already paid` : ''}</p>
            <div className="mt-3 flex gap-2">{inv.payToken && <Link to={`/pay/${inv.payToken}`} className={inv.status === 'paid' ? 'btn-ghost !min-h-9 !px-3 text-sm' : 'btn-gold !min-h-9 !px-4 text-sm'}>{inv.status === 'paid' ? 'View invoice' : 'View & pay'}</Link>}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The customer's reservations in shared barrels / containers, and the shipments they became. */
function GroupageTab() {
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = () => groupageApi.mine().then(setSpots).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  const cancel = async (s: Spot) => { setBusy(s.id); try { await groupageApi.cancelSpot(s.id); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel.') } finally { setBusy('') } }
  const g = (s: Spot) => s.groupage!
  return (
    <div className="mt-6" data-testid="groupage-tab">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">Space you reserved in shared barrels and containers. Reservations become shipments when the shipper closes the slot.</p><Link to="/groupage" className="btn-gold !min-h-9 !px-4 text-sm">Find a slot</Link></div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {spots === null && !error && <p className="mt-6 text-sm text-text-muted">Loading…</p>}
      {spots && spots.length === 0 && <div className="mt-6"><Empty title="No shared-slot reservations" body="Sending less than a barrel? Reserve the space you need in a shipper's shared barrel or container and pay only for that." action={<Link to="/groupage" className="btn-gold">Browse open slots</Link>} /></div>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {spots?.map((s) => (
          <li key={s.id} className={`card-dark min-w-0 p-5 ${s.status === 'cancelled' ? 'dimmed' : ''}`} data-testid="my-spot">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{g(s).title}</p><p className="text-xs text-text-muted">{g(s).shipperName} · {g(s).origin} → {g(s).destination}</p></div><Pill tone={s.status === 'booked' ? 'green' : s.status === 'cancelled' ? 'muted' : 'gold'}>{s.status === 'booked' ? 'Booked' : s.status === 'cancelled' ? 'Cancelled' : 'Reserved'}</Pill></div>
            <p className="mt-2 text-sm">{unitsLabel({ unit: g(s).kind === 'barrel' ? 'bag or box' : 'barrel', unitPlural: g(s).kind === 'barrel' ? 'bags / boxes' : 'barrels' }, s.units)} · <strong className="tabular-nums">{money(s.amountUsd)}</strong></p>
            <p className="mt-1 truncate text-xs text-text-muted">{s.description}</p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${g(s).fillPct}%` }} /></div>
            <p className="mt-1 text-xs text-text-muted">{g(s).fillPct}% filled · closes {g(s).closesAt ? fmtDate(g(s).closesAt + 'T12:00:00Z') : '—'} · sails {g(s).departsAt ? fmtDate(g(s).departsAt + 'T12:00:00Z') : '—'}</p>
            <div className="mt-3 flex gap-2">
              {s.shipmentId && <Link to={`/dashboard?tab=shipments&s=${s.shipmentId}`} className="btn-gold !min-h-8 !px-3 text-xs">Open shipment {s.shipmentRef}</Link>}
              {s.status === 'reserved' && <button onClick={() => cancel(s)} disabled={busy === s.id} className="btn-ghost !min-h-8 !px-3 text-xs text-danger disabled:opacity-60">Cancel reservation</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SHIP_VIEWS = [
  { id: 'tracking', label: 'Tracking' }, { id: 'inside', label: 'What’s inside' }, { id: 'pay', label: 'Pay' }, { id: 'customs', label: 'Customs & duty' },
  { id: 'people', label: 'Recipient & pickup' }, { id: 'chat', label: 'Messages' }, { id: 'docs', label: 'Documents' }, { id: 'help', label: 'Help' },
] as const
type ShipView = (typeof SHIP_VIEWS)[number]['id']
type ShipFilter = 'active' | 'pay' | 'delivered' | 'all'
const STAGES: [string, (st: string) => boolean][] = [['Booked', () => true], ['On the way', (st) => !['booked'].includes(st)], ['Arrived', (st) => ['arrived', 'customs', 'ready_for_collection', 'out_for_delivery', 'delivered'].includes(st)], ['Delivered', (st) => st === 'delivered']]
/** Four-step progress line so a shipment's state reads at a glance. */
export function ShipProgress({ status, eta }: { status: string; eta?: string | null }) {
  const t = useT(); const lang = useLang()
  const done = STAGES.filter(([, f]) => f(status)).length
  return (
    <div className="mt-2" data-testid="ship-progress">
      <div className="grid grid-cols-4 gap-1" role="img" aria-label={`${t('Shipments')}: ${done}/4 — ${t(STAGES[done - 1][0])}`}>{STAGES.map(([l], i) => <span key={l} className={`h-1.5 rounded-full ${i < done ? (done === 4 ? 'bg-teal' : 'bg-gold') : 'bg-border'}`} />)}</div>
      <p className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs"><span className="font-semibold">{t(STAGES[done - 1][0])}</span>{status !== 'delivered' && eta ? <span className="text-text-muted">{t('Expected {d}', { d: `${fmtDay(eta, lang)} · ${relDay(eta, lang)}` })}</span> : null}</p>
    </div>
  )
}

function ShipmentsTab() {
  const { shipments, shipperById } = useStore()
  const [sp, setSp] = useSearchParams()
  const sum = useSummary()
  const t = useT()
  const asked = sp.get('s') ?? sp.get('open') ?? sp.get('recipient') ?? sp.get('review')
  // Old deep links: ?recipient= opens the recipient view, ?review= opens Help.
  const initial = asked ?? shipments.find((x) => x.status !== 'delivered')?.id ?? shipments[0]?.id ?? null
  const [sel, setSel] = useState<string | null>(initial)
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<ShipFilter>('active'); const [limit, setLimit] = useState(10)
  const [sheet, setSheet] = useState(() => !!asked && typeof window !== 'undefined' && window.innerWidth < 1024)
  const backBtn = useRef<HTMLButtonElement>(null); const lastCard = useRef<HTMLElement | null>(null)
  const viewParam = sp.get('view') ?? (sp.get('recipient') ? 'people' : sp.get('review') ? 'help' : 'tracking')
  const view: ShipView = (SHIP_VIEWS.some((v) => v.id === viewParam) ? viewParam : 'tracking') as ShipView
  useEffect(() => { const id = sp.get('s') ?? sp.get('open') ?? sp.get('recipient') ?? sp.get('review'); if (id) setSel(id) }, [sp])
  // Phone: the shipment opens as a full-screen panel (scroll locked behind it, Escape closes, focus returns to the card).
  useEffect(() => {
    if (!sheet) return
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; setTimeout(() => backBtn.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet() }
    window.addEventListener('keydown', onKey); return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [sheet]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeSheet = () => { setSheet(false); setTimeout(() => lastCard.current?.focus(), 30) }
  const pick = (id: string, v: ShipView = 'tracking', fromCard = false) => { setSel(id); setSp({ tab: 'shipments', s: id, ...(v !== 'tracking' ? { view: v } : {}) }, { replace: true }); if (fromCard && window.innerWidth < 1024) { lastCard.current = document.activeElement as HTMLElement; setSheet(true) } }
  const s = shipments.find((x) => x.id === sel)
  if (shipments.length === 0) return <div className="mt-6"><Empty title="No shipments yet" body="Accept a quote on one of your requests and it will appear here with live tracking." action={<Link to="/quote" className="btn-gold">Get quotes</Link>} /></div>
  const owing = (id: string) => (sum?.dueByShipment[id] ?? 0) > 0
  const counts: Record<ShipFilter, number> = { active: shipments.filter((x) => x.status !== 'delivered').length, pay: shipments.filter((x) => owing(x.id)).length, delivered: shipments.filter((x) => x.status === 'delivered').length, all: shipments.length }
  const ql = q.trim().toLowerCase()
  const list = shipments
    .filter((x) => filter === 'all' || (filter === 'active' ? x.status !== 'delivered' : filter === 'delivered' ? x.status === 'delivered' : owing(x.id)))
    .filter((x) => !ql || [x.ref, x.origin, countryByCode(x.destination)?.name, x.description].join(' ').toLowerCase().includes(ql))
  const due = s ? sum?.dueByShipment[s.id] : undefined
  const views = s && <>

          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1 lg:flex-wrap" role="tablist" aria-label="Shipment sections" data-testid="ship-views">
            {SHIP_VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => pick(s.id, v.id)} className={`relative min-h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium focus-ring ${view === v.id ? 'bg-gold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid={`sv-${v.id}`}>{t(v.label)}{v.id === 'pay' && due ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] font-bold ${view === v.id ? 'bg-on-accent/20' : 'bg-gold/20 text-gold-deep'}`}>{money(due)}</span> : null}</button>)}
          </div>
          <div className="space-y-4" data-testid={`ship-view-${view}`}>
            {view === 'tracking' && <><ShipmentDetail s={s} compact /><Link to={`/track?ref=${s.ref}`} className="inline-flex items-center gap-1 text-sm text-gold-deep hover:underline focus-ring rounded">Open public tracking page <ArrowRight size={14} aria-hidden="true" /></Link><NextStep shipmentId={s.id} /><CollectionNotice s={s} /><OffersCard s={s} /></>}
            {view === 'inside' && <><PackingList shipmentId={s.id} destination={s.destination} /><DutyEarly shipmentId={s.id} />{s.cargo === 'vehicle' && <VehicleCard shipmentId={s.id} destination={s.destination} />}</>}
            {view === 'pay' && <><PriceAdjustmentCard shipmentId={s.id} /><ExportCard shipmentId={s.id} /><ReceiverChargesCard shipmentId={s.id} /><PackingSuppliesCard shipmentId={s.id} /><PaymentCard shipmentId={s.id} /><InsuranceCard shipmentId={s.id} cargo={s.cargo} /><p className="text-sm text-text-muted">Paying several shipments? <Link to="/dashboard?tab=money" className="text-gold-deep hover:underline">Pay everything you owe in one checkout</Link>.</p></>}
            {view === 'customs' && <><CustomsCard shipmentId={s.id} destination={s.destination} /><DutyCard shipmentId={s.id} destination={s.destination} cargo={s.cargo} /></>}
            {view === 'people' && <><RecipientPanel shipmentId={s.id} shipmentRef={s.ref} status={s.status} /><FamilyShare shipmentId={s.id} /><PickupCard shipmentId={s.id} shipmentRef={s.ref} origin={s.origin} status={s.status} /></>}
            {view === 'chat' && <ShipmentChat shipmentId={s.id} />}
            {view === 'docs' && <DocumentsPanel shipmentId={s.id} shipmentRef={s.ref} />}
            {view === 'help' && <><ReviewCard shipmentId={s.id} shipperName={shipperById(s.shipperId)?.name} /><DisputeCard shipmentId={s.id} /><p className="text-sm text-text-muted">See every problem you’ve reported under <Link to="/dashboard?tab=issues" className="text-gold-deep hover:underline">Problems</Link>.</p></>}
          </div>

  </>
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-4">
        <div className="space-y-3" data-testid="ship-toolbar">
          <label className="relative block"><span className="sr-only">{t('Search by reference, place or what’s inside')}</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(10) }} placeholder={t('Search by reference, place or what’s inside')} className="input-dark !pl-9" data-testid="ship-search" /></label>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label={t('Shipments')}>{([['active', 'Active'], ['pay', 'To pay'], ['delivered', 'Delivered'], ['all', 'All']] as [ShipFilter, string][]).map(([k, l]) => <button key={k} role="radio" aria-checked={filter === k} onClick={() => { setFilter(k); setLimit(10) }} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm ${filter === k ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted hover:text-text'}`}>{t(l)}<span className="rounded-full bg-surface-2 px-1.5 text-xs tabular-nums">{counts[k]}</span></button>)}</div>
        </div>
        <ul className="mt-3 space-y-2" aria-label={t('Your shipments')}>
          {list.length === 0 && <li className="rounded-[var(--radius-md)] border border-border p-6 text-center text-sm text-text-muted">{t('No shipments match.')}</li>}
          {list.slice(0, limit).map((x) => {
            const d = countryByCode(x.destination)!
            return (
              <li key={x.id} className={`rounded-[var(--radius-md)] border transition-colors ${sel === x.id ? 'border-gold bg-surface' : 'border-border bg-surface/50 hover:bg-surface'}`} data-testid="ship-row">
                <button onClick={() => pick(x.id, 'tracking', true)} aria-current={sel === x.id} className="w-full rounded-[var(--radius-md)] p-4 pb-2 text-left focus-ring">
                  <div className="flex items-center justify-between"><p className="font-mono text-xs text-gold-deep">{x.ref}</p><ModeBadge mode={x.mode} /></div>
                  <p className="mt-1.5 text-sm font-semibold text-text">{x.origin} → <Flag code={d.code} /> {d.name}</p>
                  <p className="truncate text-xs text-text-muted">{x.description}</p>
                  <ShipProgress status={x.status} eta={x.eta} />
                </button>
                <div className="px-4 pb-3"><ShipmentQuickActions s={x} due={sum?.dueByShipment[x.id]} /></div>
              </li>
            )
          })}
        </ul>
        {list.length > limit && <button onClick={() => setLimit((n) => n + 10)} className="btn-ghost mt-3 w-full !min-h-11 text-sm" data-testid="ship-more">{t('Show {n} more', { n: Math.min(10, list.length - limit) })}</button>}
      </div>
      <div className="hidden min-w-0 scroll-mt-20 lg:col-span-8 lg:block" id="ship-detail">{views}</div>
      {sheet && s && (
        <div role="dialog" aria-modal="true" aria-labelledby="sheet-h" className="fixed inset-0 z-50 overflow-y-auto bg-bg lg:hidden" data-testid="ship-sheet">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur-xl">
            <button ref={backBtn} onClick={closeSheet} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold focus-ring" data-testid="sheet-back"><ArrowLeft size={18} aria-hidden="true" /> {t('Back to shipments')}</button>
          </div>
          <div className="px-4 pb-24 pt-4"><h2 id="sheet-h" className="!text-lg"><span className="font-mono text-gold-deep">{s.ref}</span> · {s.origin} → {countryByCode(s.destination)?.name}</h2><ShipProgress status={s.status} eta={s.eta} /><div className="mt-4">{views}</div></div>
        </div>
      )}
    </div>
  )
}

/* ================= SHIPPER ================= */
export function ShipperDashboard() {
  const { ready, user, requests, sendQuote, shipperById } = useStore()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const view = (sp.get('view') as 'leads' | 'shipments' | 'profile' | null) ?? 'overview'
  const [quoting, setQuoting] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setEditing(view === 'profile') }, [view])
  const [form, setForm] = useState({ price: '', transit: '', notes: '' })
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])
  if (!ready) return <div className="bg-bg text-text"><BrandLoader label="Loading your dashboard…" /></div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/shipper" replace />
  if (user.role !== 'shipper' || !user.shipperId) return <Navigate to="/dashboard" replace />
  const me = user.shipperId
  const leads = requests.filter((r) => r.status === 'open')
  const full = shipperById(me)
  const shipper: Pick<Shipper, 'id' | 'name' | 'hq' | 'plan' | 'onTime' | 'tagline' | 'verified'> = full ?? { id: me, name: user.company ?? 'Your company', hq: '', plan: 'starter', onTime: 0, tagline: '', verified: false }

  const submitQuote = async (r: QuoteRequest) => {
    const price = Number(form.price), transit = Number(form.transit)
    if (!price || !transit) return
    setBusy(true); setError('')
    try {
      await sendQuote(r.id, { price, transitDays: transit, notes: form.notes || (shipper.tagline ? `${shipper.tagline}.` : ''), includes: [r.pickup ? 'Pickup' : 'Drop-off at warehouse', r.mode === 'air' ? 'Air freight' : 'Ocean freight', r.delivery ? 'Door delivery' : 'Port handling', ...(r.insurance ? ['All-risk insurance'] : [])] })
      setQuoting(null); setForm({ price: '', transit: '', notes: '' }); setToast(`Quote sent to ${r.contact.name}.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send the quote.') }
    finally { setBusy(false) }
  }

  return (
    <Layout title={view === 'leads' ? 'Requests' : view === 'shipments' ? 'Client shipments' : view === 'profile' ? 'Company profile' : shipper.name} sub={view === 'overview' ? [user.name, shipper.hq, `${shipper.plan.charAt(0).toUpperCase() + shipper.plan.slice(1)} plan`].filter(Boolean).join(' · ') : shipper.name} cta={view === 'overview' || view === 'profile' ? <div className="flex flex-wrap gap-2">{view !== 'profile' && <button onClick={() => setEditing((e) => !e)} className="btn-ghost" aria-expanded={editing}><Pencil size={16} aria-hidden="true" /> Edit profile</button>}<Link to={`/shippers/${me}`} className="btn-ghost">View public profile</Link></div> : undefined}>
      <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" />{toast}</motion.p>}</AnimatePresence>
      {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {!shipper.verified && !editing && view !== 'overview' && (
        <p className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-text"><VerifiedMark size={18} aria-hidden="true" /> Not yet verified. Upload your registration and insurance under <Link to="/dashboard/verification" className="font-semibold text-gold-deep hover:underline">Verification</Link> — the badge lifts you in matching and reassures customers.</p>
      )}
      {editing && full && <ProfileEditor shipper={full} onDone={(msg) => { setEditing(false); if (msg) setToast(msg); if (view === 'profile') nav('/dashboard/shipper') }} />}
      {view === 'overview' && !editing && <ShipperOverview firstName={user.name.split(' ')[0]} />}

      <div className="mt-10 grid gap-8 lg:grid-cols-12">
        {view === 'leads' && <section className="lg:col-span-12" aria-labelledby="leads-h">
          <h2 id="leads-h" className="!text-xl">Shipment requests for your lanes</h2>
          <p className="mt-1 text-sm text-text-muted">Reply fast — customers see response time on your profile.</p>
          <div className="mt-4 space-y-3">
            {leads.length === 0 && <Empty title="No open requests right now" body="New requests matching your origins, destinations and cargo types will appear here and by email." />}
            {leads.map((r) => {
              const d = countryByCode(r.destination)!
              const mine = r.quotes.find((q) => q.shipperId === me)
              const competing = r.competingQuotes ?? r.quotes.filter((q) => q.shipperId !== me).length
              return (
                <motion.div key={r.id} layout className="card-dark p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-text">{r.quantity} × {cargoName(r.cargo as CargoType, r.cargoItems)} · {r.origin} → <Flag code={d.code} /> {d.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{r.ref} · {r.mode === 'either' ? 'air or ocean' : r.mode} · ready {fmtDate(r.readyDate)} {r.weightKg ? `· ~${r.weightKg} kg` : ''}</p>
                      <p className="mt-2 text-sm text-text-muted">{r.description || 'No description.'}</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">{r.pickup && <li><Pill tone="muted">Pickup</Pill></li>}{r.delivery && <li><Pill tone="muted">Door delivery</Pill></li>}{r.insurance && <li><Pill tone="muted">Insurance</Pill></li>}</ul>
                    </div>
                    <div className="text-right text-xs text-text-muted"><p>{competing} competing quote{competing === 1 ? '' : 's'}</p>{mine ? <Pill tone="teal">Quoted {money(mine.price)}</Pill> : <button onClick={() => setQuoting(quoting === r.id ? null : r.id)} className="btn-gold mt-2 !min-h-10 !px-4 text-sm" aria-expanded={quoting === r.id}>Send quote</button>}</div>
                  </div>
                  <AnimatePresence initial={false}>
                    {quoting === r.id && (
                      <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} onSubmit={(e) => { e.preventDefault(); submitQuote(r) }} className="overflow-hidden">
                        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                          <div><label htmlFor={`p-${r.id}`} className="label-dark">Total price (USD)</label><input id={`p-${r.id}`} type="number" min={1} required className="input-dark" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                          <div><label htmlFor={`t-${r.id}`} className="label-dark">Transit (days)</label><input id={`t-${r.id}`} type="number" min={1} required className="input-dark" value={form.transit} onChange={(e) => setForm({ ...form, transit: e.target.value })} /></div>
                          <div className="sm:col-span-2"><label htmlFor={`n-${r.id}`} className="label-dark">Notes to customer</label><textarea id={`n-${r.id}`} rows={2} className="input-dark py-2" placeholder="Sailing date, what’s included, duty handling…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setQuoting(null)} className="btn-ghost !min-h-10 !px-4 text-sm"><X size={15} aria-hidden="true" /> Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Send size={15} aria-hidden="true" /> {busy ? 'Sending…' : 'Send quote'}</button></div>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </section>}

        {view === 'shipments' && <Navigate to="/dashboard/shipments" replace />}
        {view === 'leads' && <Navigate to="/dashboard/leads" replace />}
      </div>
    </Layout>
  )
}
