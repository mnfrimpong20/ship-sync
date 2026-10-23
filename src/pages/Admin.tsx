import { BrandLoader } from '../components/BrandLoader'
import { AdminPartners } from '../components/AdminPartners'
import { AdminTickets } from '../components/AdminTickets'
import { AdminReceiverPayments } from '../components/AdminReceiverPayments'
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Archive, Check, ChevronDown, Clock, FileText, ShieldCheck, ShieldOff, XCircle } from 'lucide-react'
import { onboardingApi, type CompanyDoc } from '../lib/onboarding'
import { AdminAttention, AdminBusiness } from '../components/AdminBusiness'
import { countryByCode, type Shipper } from '../lib/data'
import { api, useStore, type AdminShipper } from '../lib/store'
import { Avatar, Pill, Rating, fmtDate, fmtDateTime, VerifiedMark } from '../components/ui'
import { Confirm } from '../components/board'
import { fadeUp, stagger } from '../lib/motion'
import { AdminInsurance } from '../components/AdminInsurance'
import { AdminSupplies } from '../components/AdminSupplies'
import { AdminScreening } from '../components/Compliance'
import { AdminPayments } from '../components/AdminPayments'
import { AdminBrokers } from './Brokers'
import { AdminDisputes } from './Reviews'
import { AdminSourcing } from './Sourcing'
import { AdminSystem } from '../components/AdminSystem'
import { AdminDestinations } from '../components/AdminDestinations'
import { AdminShipment } from '../components/AdminShipment'
import { AdminAnnouncements, AdminAudit, AdminBilling, AdminFeatures, AdminMarketplace, AdminMessaging, AdminPlatform, AdminRisk, AdminScorecards, AdminSupport } from '../components/AdminConsole'

const VIEWS = [['overview', 'Business'], ['attention', 'Attention'], ['shippers', 'Shippers'], ['disputes', 'Disputes'], ['payments', 'Payments'], ['brokers', 'Brokers'], ['sourcing', 'Sourcing'], ['insurance', 'Insurance'], ['supplies', 'Supplies'], ['screening', 'Screening'], ['tickets', 'Support'], ['partners', 'Partners'], ['destinations', 'Destinations'], ['system', 'System'], ['analytics', 'Platform'], ['marketplace', 'Marketplace'], ['scorecards', 'Scorecards'], ['risk', 'Risk'], ['messaging', 'Messaging'], ['billing', 'Billing'], ['announcements', 'Announcements'], ['audit', 'Audit log'], ['support', 'View as'], ['features', 'Features'], ['shipment', 'Shipment']] as const
type View = (typeof VIEWS)[number][0]

/** Ntemtem staff: the business overview, the attention board, and every admin work queue in tabs. */
export default function Admin() {
  const { ready, user, adminShippers, adminVerify } = useStore()
  const [sp] = useSearchParams()
  const view = (VIEWS.some(([v]) => v === sp.get('view')) ? sp.get('view') : 'overview') as View
  const [rows, setRows] = useState<AdminShipper[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified' | 'archived'>('pending'); const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [done, setDone] = useState(''); useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(''), 4000); return () => clearTimeout(t) }, [done])
  // A search hit links here with ?q= (and ?f=) — prefill the search so the company is the first thing on screen.
  useEffect(() => { const sq = sp.get('q'); const sf = sp.get('f'); if (view === 'shippers' && sq) { setQ(sq); if (sf === 'all' || sf === 'archived' || sf === 'verified' || sf === 'pending') setFilter(sf); else setFilter('all') } }, [sp, view])
  // Verify, revoke and plan changes ask first — they change what customers see and what a company pays.
  const [ask, setAsk] = useState<{ kind: 'verify' | 'revoke' | 'plan' | 'archive'; s: AdminShipper; plan?: Shipper['plan'] } | null>(null); const [why, setWhy] = useState('')

  useEffect(() => {
    if (!ready || !user?.admin) return
    let live = true
    adminShippers().then((s) => live && setRows(s)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load shippers.'))
    return () => { live = false }
  }, [ready, user, adminShippers])

  if (!ready) return <div className="bg-bg text-text"><BrandLoader /></div>
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!user.admin) return <Navigate to="/dashboard" replace />

  const act = async (s: AdminShipper, patch: { verified?: boolean; plan?: Shipper['plan']; note?: string }) => {
    setBusy(s.id); setError('')
    try {
      const updated = await adminVerify(s.id, { verified: patch.verified ?? s.verified, plan: patch.plan, note: patch.note })
      setRows((prev) => prev?.map((x) => (x.id === s.id ? { ...x, ...updated } : x)) ?? prev)
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.') } finally { setBusy(null) }
  }

  const term = q.trim().toLowerCase()
  const live = (rows ?? []).filter((s) => !s.archivedAt)
  const list = (filter === 'archived' ? (rows ?? []).filter((s) => s.archivedAt) : live.filter((s) => filter === 'all' || (filter === 'verified' ? s.verified : !s.verified)))
    .filter((s) => !term || [s.name, s.hq, s.owner?.email, s.owner?.name, s.tagline].join(' ').toLowerCase().includes(term))
  const pending = live.filter((s) => !s.verified).length; const archived = (rows ?? []).length - live.length
  const archive = async (s: AdminShipper, on: boolean, reason = '') => { setBusy(s.id); setError(''); try { await api(`/admin/shippers/${s.id}/archive`, { json: { archived: on, reason } }); setRows((prev) => prev?.map((x) => (x.id === s.id ? { ...x, archivedAt: on ? new Date().toISOString() : null, verified: on ? false : x.verified } : x)) ?? prev); setDone(on ? `${s.name} archived — find it under Archived.` : `${s.name} restored — it’s back in the queue as unverified.`) } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy(null) } }

  const PLAN = { starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' } as const
  const dialog = ask && (ask.kind === 'verify'
    ? <Confirm danger={false} title={`Verify ${ask.s.name}?`} confirmLabel={ask.s.docCount ? 'Verify' : 'Verify without documents'} busy={busy === ask.s.id} onClose={() => setAsk(null)} onConfirm={() => { const x = ask.s; setAsk(null); void act(x, { verified: true }) }}
        body={<div className="space-y-2" data-testid="confirm-verify"><p>They get the Ntemtem Verified badge, rank higher in matching, and customers are told they’ve been checked.</p>{ask.s.docCount
          ? <p>{ask.s.docCount} document{ask.s.docCount === 1 ? '' : 's'} uploaded{ask.s.docsPending ? <> — <b className="text-text">{ask.s.docsPending} not checked yet</b>. Open Documents first.</> : ', all checked.'}</p>
          : <p className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-danger">They haven’t uploaded any documents — no licence, insurance or registration has been checked.</p>}</div>} />
    : ask.kind === 'revoke'
    ? <Confirm title={`Remove ${ask.s.name}’s verification?`} confirmLabel="Remove the badge" busy={busy === ask.s.id} onClose={() => setAsk(null)} onConfirm={() => { const x = ask.s; setAsk(null); void act(x, { verified: false }) }}
        body={<p data-testid="confirm-revoke">The badge comes off their profile and quotes straight away, and they drop in matching. The owner is told.</p>} />
    : ask.kind === 'archive'
    ? <Confirm title={`Archive ${ask.s.name}?`} confirmLabel="Archive" busy={busy === ask.s.id} onClose={() => setAsk(null)} onConfirm={() => { const x = ask.s; setAsk(null); void archive(x, true, why.trim()) }}
        body={<div className="space-y-2" data-testid="confirm-archive"><p>For test or junk sign-ups. They leave the public directory, matching and this queue{ask.s.verified ? ', and lose the badge' : ''}. Their login and data stay, and you can restore them from Archived.</p><label className="block text-sm font-semibold text-text" htmlFor="arch-why">Reason (optional, for the audit log)</label><input id="arch-why" className="input-dark text-sm" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Test account" /></div>} />
    : <Confirm danger={false} title={`Move ${ask.s.name} to ${PLAN[ask.plan!]}?`} confirmLabel={`Change to ${PLAN[ask.plan!]}`} busy={busy === ask.s.id} onClose={() => setAsk(null)} onConfirm={() => { const x = ask.s, pl = ask.plan!; setAsk(null); void act(x, { plan: pl }) }}
        body={<p data-testid="confirm-plan">From {PLAN[ask.s.plan]} to {PLAN[ask.plan!]}. Their features change at once. Card billing isn’t switched on, so set this to match what they actually pay you.</p>} />)

  const shippersView = (
    <>{dialog}
      <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-2">
        {(['pending', 'verified', 'all', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full border px-4 py-1.5 text-sm capitalize focus-ring ${filter === f ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border text-text-muted hover:text-text'}`}>{f}{f === 'pending' && pending > 0 ? ` (${pending})` : f === 'archived' && archived > 0 ? ` (${archived})` : ''}</button>
        ))}
        <label className="relative ml-auto w-full sm:w-72"><span className="sr-only">Search shippers</span><input type="search" className="input-dark !min-h-10 text-sm" placeholder="Search name, email or city" value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-shipper-search" /></label>
        <span className="w-full text-xs text-text-muted sm:w-auto">{rows ? `${list.length} of ${live.length} shippers${filter === 'pending' ? ' · review requested and documents to check come first' : ''}` : 'Loading…'}</span>
      </motion.div>
      <motion.ul variants={fadeUp} className="mt-4 space-y-3" aria-label="Shippers">
        {list.map((s) => (
          <li key={s.id} className="card-dark p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar initials={s.initials} hue={s.hue} logo={s.logo} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-text"><Link to={`/shippers/${s.id}`} className="hover:text-gold-deep focus-ring rounded">{s.name}</Link>{s.verified && <VerifiedMark size={16} role="img" aria-label="Ntemtem Verified" />}{s.demo && <Pill tone="muted">Demo</Pill>}{!s.verified && s.verificationRequestedAt && <Pill tone="gold">Review requested</Pill>}{s.docsPending > 0 && <Pill tone="sky">{s.docsPending} doc{s.docsPending === 1 ? '' : 's'} to check</Pill>}</p>
                  <p className="text-xs text-text-muted">{s.tagline || 'No tagline'} · {s.hq || 'No HQ set'} · founded {s.founded}</p>
                  <p className="mt-1 text-xs text-text-muted">{s.owner ? <>{s.owner.name} · {s.owner.email}</> : 'No account linked'}{s.createdAt ? ` · joined ${fmtDate(s.createdAt)}` : ''}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <Rating value={s.rating} count={s.reviews} />
                    <span>{s.modes.join(' + ')}</span>
                    <span>→ {s.destinations.map((c) => countryByCode(c)?.flag ?? c).join(' ')}</span>
                    <span>{s.quoteCount} quotes · {s.shipmentCount} shipments</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-text-muted">Plan
                  <select className="input-dark ml-2 !inline-block !min-h-9 !w-auto text-xs" value={s.plan} disabled={busy === s.id} onChange={(e) => setAsk({ kind: 'plan', s, plan: e.target.value as Shipper['plan'] })}><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select>
                </label>
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id} className="btn-ghost !min-h-9 !px-3 text-xs"><FileText size={14} aria-hidden="true" /> Documents{s.docCount ? ` (${s.docCount})` : ''} <ChevronDown size={12} className={`transition-transform ${openId === s.id ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
                {s.archivedAt
                  ? <button onClick={() => archive(s, false)} disabled={busy === s.id} className="btn-ghost !min-h-9 !px-3 text-xs">Restore</button>
                  : <button onClick={() => { setWhy(''); setAsk({ kind: 'archive', s }) }} disabled={busy === s.id} className="btn-ghost !min-h-9 !px-3 text-xs" aria-label={`Archive ${s.name}`}><Archive size={14} aria-hidden="true" /> Archive</button>}
                {s.archivedAt ? null : s.verified
                  ? <button onClick={() => setAsk({ kind: 'revoke', s })} disabled={busy === s.id} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldOff size={14} aria-hidden="true" /> Revoke</button>
                  : <button onClick={() => setAsk({ kind: 'verify', s })} disabled={busy === s.id} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldCheck size={14} aria-hidden="true" /> {busy === s.id ? 'Saving…' : 'Verify'}</button>}
              </div>
            </div>
            {s.verifiedAt && <p className="mt-3 text-xs text-text-muted">Verified {fmtDate(s.verifiedAt)}</p>}
            {s.archivedAt && <p className="mt-3 text-xs text-text-muted">Archived {fmtDate(s.archivedAt)}{s.archivedReason ? ` · ${s.archivedReason}` : ''}</p>}
            {openId === s.id && <ShipperDocs shipper={s} onDecline={(note) => act(s, { verified: false, note })} busy={busy === s.id} />}
          </li>
        ))}
        {rows && list.length === 0 && <li className="card-dark p-8 text-center text-sm text-text-muted">{term ? `No shippers match “${q}”.` : filter === 'pending' ? 'Nobody waiting for verification.' : 'Nothing here.'}</li>}
      </motion.ul>
    </>
  )
  const titles: Record<View, [string, string]> = {
    overview: ['How the business is doing', 'Revenue by stream, the money held in escrow, growth, conversion and where demand is — live from the database.'],
    attention: ['What needs a person today', 'Everything stuck or waiting across the platform, most urgent first. Each card opens where you fix it.'],
    shippers: ['Shipper verification', 'Verified shippers get the badge, rank higher in matching and reassure customers. Check licence, insurance and a real office before granting it.'],
    disputes: ["Disputes", "Open disputes hold the escrow payment. Read the thread, add a message, then resolve with a refund (full or partial, back to the customer's card), a release to the shipper, or no action."], payments: ["Payments & escrow", "Customers pay Ntemtem; funds are released to the shipper’s balance at the milestone below, less the take-rate. Payouts are sent by bank transfer and marked here."], brokers: ["Customs brokers", "Licensed agents customers and shippers can book per shipment. Verify a listing once you've seen the licence."],
    sourcing: ['Sourcing settings', 'Pricing, exchange rates, agents and commissions for the China, UK and USA desks.'], insurance: ["Cargo insurance", "Set the product once; customers add cover on booked shipments and shippers collect the premium with the freight. Plug in an underwriter by changing the provider and rates."], supplies: ["Equipment & supplies", "Printers, scanners and labels Ntemtem sells and rents to shipping companies, and the packing supplies Ntemtem sends to customers whose shipper doesn’t stock them (marked “Customer”). Stock is held back when an order is placed and goes back on the shelf if it’s cancelled or a rental comes home. Kits use the stock of the parts inside them."], screening: ["Sanctions screening", "Senders, receivers and shipping companies are checked against the US Treasury OFAC list. A possible match holds the booking (or verification) until someone here reviews it. Most matches are just a shared name — clear them with a short note."], destinations: ['Destinations', 'The countries customers can ship to — ports, airports, transit days and dial codes.'], system: ['Health, errors & backups', 'What is wired up, what broke, and a copy of the database you can download.'],
    analytics: ['Platform analytics', 'Value booked through Ntemtem, our own revenue, growth and conversion across the marketplace.'],
    marketplace: ['Marketplace health', 'Demand against supply on every lane — where requests go unanswered and which shippers to recruit.'],
    scorecards: ['Shipper scorecards', 'Quality scores that drive directory ranking, warnings, probation and pauses.'],
    risk: ['Risk & fraud', 'Patterns worth a look: withdrawn quotes, spikes, shared contact details, junk requests and off-platform attempts.'],
    messaging: ['Message delivery', 'Email, SMS and WhatsApp sent and failed, bouncing addresses and what it costs.'],
    billing: ['Plans & billing', 'Recurring revenue, trials, cancellations and every shipper’s plan.'],
    announcements: ['Announcements', 'Banners and notifications to shippers, customers or everyone — by destination if needed.'],
    audit: ['Audit log', 'Who changed what and when, searchable and exportable.'],
    support: ['Support — view as', 'See exactly what a shipper or customer sees, read-only and logged.'],
    partners: ['Destination partners', 'Vetted clearing agents, warehouses and delivery partners shippers can hand a container to — and the jobs to confirm with them.'],
    tickets: ['Support inbox', 'Tickets from customers, shippers and the contact form — oldest waiting first.'],
    shipment: ['Shipment', 'Who to call, what has happened, the money — and a message to the shipping company.'],
    features: ['Feature switches', 'Turn features on or off for everyone or for one shipper.']
  }
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">Admin</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{titles[view][0]}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-text-muted">{titles[view][1]}</motion.p>
          {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
          {done && <p role="status" className="mt-6 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal" data-testid="admin-done">{done}</p>}
          {view === 'overview' && <AdminBusiness />}
          {view === 'attention' && <AdminAttention />}
          {view === 'shippers' && shippersView}
          {view === 'disputes' && <AdminDisputes />}
          {view === 'payments' && <><AdminPayments /><AdminReceiverPayments /></>}
          {view === 'brokers' && <AdminBrokers />}
          {view === 'sourcing' && <AdminSourcing />}
          {view === 'insurance' && <AdminInsurance />}
          {view === 'supplies' && <AdminSupplies />}
          {view === 'screening' && <AdminScreening />}
          {view === 'tickets' && <AdminTickets />}
          {view === 'partners' && <AdminPartners />}
          {view === 'destinations' && <AdminDestinations />}
          {view === 'system' && <AdminSystem />}
          {view === 'analytics' && <AdminPlatform />}
          {view === 'marketplace' && <AdminMarketplace />}
          {view === 'scorecards' && <AdminScorecards />}
          {view === 'risk' && <AdminRisk />}
          {view === 'messaging' && <AdminMessaging />}
          {view === 'billing' && <AdminBilling />}
          {view === 'announcements' && <AdminAnnouncements />}
          {view === 'audit' && <AdminAudit />}
          {view === 'support' && <AdminSupport />}
          {view === 'features' && <AdminFeatures />}
          {view === 'shipment' && <AdminShipment />}
        </motion.div>
      </div>
    </div>
  )
}

/** Admin: a shipper's verification documents, checklist progress, and a "not yet" note back to them. */
function ShipperDocs({ shipper, onDecline, busy }: { shipper: AdminShipper; onDecline: (note: string) => void; busy: boolean }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof onboardingApi.adminDocs>> | null>(null)
  const [note, setNote] = useState('')
  const [rej, setRej] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = () => onboardingApi.adminDocs(shipper.id).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { load() }, [shipper.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const review = async (doc: CompanyDoc, status: 'accepted' | 'rejected') => { try { await onboardingApi.review(doc.id, status, status === 'rejected' ? note : ''); setRej(null); setNote(''); await load() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.') } }
  const tone = { submitted: 'gold', accepted: 'green', rejected: 'danger' } as const
  return (
    <div className="mt-4 grid gap-4 rounded-xl border border-border p-4 lg:grid-cols-[1fr_260px]" data-testid="admin-shipper-docs">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Documents</p>
        {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
        <ul className="mt-2 divide-y divide-border">
          {d?.documents.map((x) => (
            <li key={x.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-semibold"><a href={x.url} target="_blank" rel="noreferrer" className="hover:text-gold-deep focus-ring rounded">{x.title}</a><Pill tone={tone[x.status]}>{x.status}</Pill></p><p className="text-xs text-text-muted">{x.label} · {x.uploadedBy}, {fmtDateTime(x.createdAt)}{x.note ? ` · “${x.note}”` : ''}{x.reviewedBy ? ` · reviewed by ${x.reviewedBy}` : ''}{x.reviewNote ? ` — ${x.reviewNote}` : ''}</p></div>
                {x.status === 'submitted' && <div className="flex gap-1.5"><button onClick={() => review(x, 'accepted')} className="btn-gold !min-h-8 !px-2.5 text-xs"><Check size={13} aria-hidden="true" /> Accept</button><button onClick={() => setRej(rej === x.id ? null : x.id)} className="btn-ghost !min-h-8 !px-2.5 text-xs"><XCircle size={13} aria-hidden="true" /> Reject</button></div>}
              </div>
              {rej === x.id && <form onSubmit={(e) => { e.preventDefault(); review(x, 'rejected') }} className="mt-2 flex gap-2"><input className="input-dark !min-h-9 flex-1 text-xs" placeholder="Tell them what to fix (sent to the owner)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /><button className="btn-ghost !min-h-9 text-xs" disabled={note.trim().length < 3}>Send</button></form>}
            </li>
          ))}
          {d && d.documents.length === 0 && <li className="py-2 text-sm text-text-muted">No documents uploaded yet.</li>}
        </ul>
        {!shipper.verified && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className="input-dark !min-h-9 flex-1 text-xs" placeholder="Not yet? Tell them why (sent to the owner, optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="decline-note" />
            <button onClick={() => { onDecline(note); setNote('') }} disabled={busy || note.trim().length < 3} className="btn-ghost !min-h-9 text-xs disabled:opacity-60">Send note without verifying</button>
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Setup progress {d?.onboarding ? `· ${d.onboarding.progress}%` : ''}</p>
        {d?.onboarding?.requestedAt && <p className="mt-1 flex items-center gap-1 text-xs text-gold-deep"><Clock size={12} aria-hidden="true" /> Review requested {fmtDateTime(d.onboarding.requestedAt)}</p>}
        <ul className="mt-2 space-y-1 text-xs">{d?.onboarding?.steps.map((st) => <li key={st.id} className={`flex items-center gap-2 ${st.done ? '' : 'text-text-muted'}`}>{st.done ? <Check size={12} className="text-teal" aria-hidden="true" /> : <span className="inline-block h-3 w-3 rounded-full border border-border" aria-hidden="true" />}{st.title}{st.optional ? <span className="text-[11px] uppercase tracking-wider text-text-muted">opt</span> : null}</li>)}</ul>
      </div>
    </div>
  )
}
