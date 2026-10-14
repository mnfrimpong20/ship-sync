import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, Check, ChevronDown, Clock, FileText, ShieldCheck, ShieldOff, XCircle } from 'lucide-react'
import { onboardingApi, type CompanyDoc } from '../lib/onboarding'
import { AdminAttention, AdminBusiness, adminApi } from '../components/AdminBusiness'
import { countryByCode, type Shipper } from '../lib/data'
import { useStore, type AdminShipper } from '../lib/store'
import { Avatar, Pill, Rating, fmtDate, fmtDateTime } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { AdminInsurance } from '../components/AdminInsurance'
import { AdminPayments } from '../components/AdminPayments'
import { AdminBrokers } from './Brokers'
import { AdminDisputes } from './Reviews'
import { AdminSourcing } from './Sourcing'
import { AdminSystem } from '../components/AdminSystem'
import { AdminDestinations } from '../components/AdminDestinations'

const VIEWS = [['overview', 'Business'], ['attention', 'Attention'], ['shippers', 'Shippers'], ['disputes', 'Disputes'], ['payments', 'Payments'], ['brokers', 'Brokers'], ['sourcing', 'Sourcing'], ['insurance', 'Insurance'], ['destinations', 'Destinations'], ['system', 'System']] as const
type View = (typeof VIEWS)[number][0]

/** Ship Sync staff: the business overview, the attention board, and every admin work queue in tabs. */
export default function Admin() {
  const { ready, user, adminShippers, adminVerify } = useStore()
  const [sp, setSp] = useSearchParams()
  const view = (VIEWS.some(([v]) => v === sp.get('view')) ? sp.get('view') : 'overview') as View
  const [urgent, setUrgent] = useState<number | null>(null)
  useEffect(() => { if (ready && user?.admin) adminApi.exceptions().then((d) => setUrgent(d.counts.high)).catch(() => {}) }, [ready, user])
  const [rows, setRows] = useState<AdminShipper[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !user?.admin) return
    let live = true
    adminShippers().then((s) => live && setRows(s)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load shippers.'))
    return () => { live = false }
  }, [ready, user, adminShippers])

  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!user.admin) return <Navigate to="/dashboard" replace />

  const act = async (s: AdminShipper, patch: { verified?: boolean; plan?: Shipper['plan']; note?: string }) => {
    setBusy(s.id); setError('')
    try {
      const updated = await adminVerify(s.id, { verified: patch.verified ?? s.verified, plan: patch.plan, note: patch.note })
      setRows((prev) => prev?.map((x) => (x.id === s.id ? { ...x, ...updated } : x)) ?? prev)
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.') } finally { setBusy(null) }
  }

  const list = (rows ?? []).filter((s) => filter === 'all' || (filter === 'verified' ? s.verified : !s.verified))
  const pending = (rows ?? []).filter((s) => !s.verified).length

  const shippersView = (
    <>
      <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-2">
        {(['all', 'pending', 'verified'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full border px-4 py-1.5 text-sm capitalize focus-ring ${filter === f ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{f}{f === 'pending' && pending > 0 ? ` (${pending})` : ''}</button>
        ))}
        <span className="ml-auto text-xs text-text-muted">{rows ? `${rows.length} shippers` : 'Loading…'}</span>
      </motion.div>
      <motion.ul variants={fadeUp} className="mt-4 space-y-3" aria-label="Shippers">
        {list.map((s) => (
          <li key={s.id} className="card-dark p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar initials={s.initials} hue={s.hue} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-text"><Link to={`/shippers/${s.id}`} className="hover:text-gold focus-ring rounded">{s.name}</Link>{s.verified && <BadgeCheck size={16} className="text-gold" aria-label="Verified" />}{s.demo && <Pill tone="muted">Demo</Pill>}{!s.verified && s.verificationRequestedAt && <Pill tone="gold">Review requested</Pill>}{s.docsPending > 0 && <Pill tone="sky">{s.docsPending} doc{s.docsPending === 1 ? '' : 's'} to check</Pill>}</p>
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
                  <select className="input-dark ml-2 !inline-block !min-h-9 !w-auto text-xs" value={s.plan} disabled={busy === s.id} onChange={(e) => act(s, { plan: e.target.value as Shipper['plan'] })}><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select>
                </label>
                <button onClick={() => setOpenId(openId === s.id ? null : s.id)} aria-expanded={openId === s.id} className="btn-ghost !min-h-9 !px-3 text-xs"><FileText size={14} aria-hidden="true" /> Documents{s.docCount ? ` (${s.docCount})` : ''} <ChevronDown size={12} className={`transition-transform ${openId === s.id ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
                {s.verified
                  ? <button onClick={() => act(s, { verified: false })} disabled={busy === s.id} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldOff size={14} aria-hidden="true" /> Revoke</button>
                  : <button onClick={() => act(s, { verified: true })} disabled={busy === s.id} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldCheck size={14} aria-hidden="true" /> {busy === s.id ? 'Saving…' : 'Verify'}</button>}
              </div>
            </div>
            {s.verifiedAt && <p className="mt-3 text-[11px] text-text-muted">Verified {fmtDate(s.verifiedAt)}</p>}
            {openId === s.id && <ShipperDocs shipper={s} onDecline={(note) => act(s, { verified: false, note })} busy={busy === s.id} />}
          </li>
        ))}
        {rows && list.length === 0 && <li className="card-dark p-8 text-center text-sm text-text-muted">Nothing here.</li>}
      </motion.ul>
    </>
  )
  const titles: Record<View, [string, string]> = {
    overview: ['How the business is doing', 'Revenue by stream, the money held in escrow, growth, conversion and where demand is — live from the database.'],
    attention: ['What needs a person today', 'Everything stuck or waiting across the platform, most urgent first. Each card opens where you fix it.'],
    shippers: ['Shipper verification', 'Verified shippers get the badge, rank higher in matching and reassure customers. Check licence, insurance and a real office before granting it.'],
    disputes: ['Disputes', 'Customer and shipper disputes on escrow payments.'], payments: ['Money through the platform', 'Escrow, releases, holds and payouts.'], brokers: ['Customs brokers', 'Broker listings and assignments.'],
    sourcing: ['Sourcing settings', 'Pricing, agents and commissions for the China desk.'], insurance: ['Insurance', 'Cargo cover sold on the platform.'], destinations: ['Destinations', 'The countries customers can ship to — ports, airports, transit days and dial codes.'], system: ['Health, errors & backups', 'What is wired up, what broke, and a copy of the database you can download.'],
  }
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">Admin</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{titles[view][0]}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-text-muted">{titles[view][1]}</motion.p>
          <motion.nav variants={fadeUp} className="mt-6 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Admin sections">
            <ul className="flex w-max gap-1 rounded-full border border-border bg-surface p-1 md:w-auto md:flex-wrap">
              {VIEWS.map(([v, label]) => (
                <li key={v}><button onClick={() => setSp(v === 'overview' ? {} : { view: v })} aria-current={view === v ? 'page' : undefined} className={`min-h-9 whitespace-nowrap rounded-full px-3.5 text-sm transition-colors focus-ring ${view === v ? 'bg-gold text-on-accent font-semibold' : 'text-text-muted hover:text-text'}`}>{label}{v === 'attention' && urgent ? <span className="ml-1.5 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{urgent}</span> : null}{v === 'shippers' && pending > 0 ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[10px] font-bold text-text">{pending}</span> : null}</button></li>
              ))}
            </ul>
          </motion.nav>
          {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
          {view === 'overview' && <AdminBusiness />}
          {view === 'attention' && <AdminAttention />}
          {view === 'shippers' && shippersView}
          {view === 'disputes' && <AdminDisputes />}
          {view === 'payments' && <AdminPayments />}
          {view === 'brokers' && <AdminBrokers />}
          {view === 'sourcing' && <AdminSourcing />}
          {view === 'insurance' && <AdminInsurance />}
          {view === 'destinations' && <AdminDestinations />}
          {view === 'system' && <AdminSystem />}
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
                <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-semibold"><a href={x.url} target="_blank" rel="noreferrer" className="hover:text-gold focus-ring rounded">{x.title}</a><Pill tone={tone[x.status]}>{x.status}</Pill></p><p className="text-xs text-text-muted">{x.label} · {x.uploadedBy}, {fmtDateTime(x.createdAt)}{x.note ? ` · “${x.note}”` : ''}{x.reviewedBy ? ` · reviewed by ${x.reviewedBy}` : ''}{x.reviewNote ? ` — ${x.reviewNote}` : ''}</p></div>
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
        <ul className="mt-2 space-y-1 text-xs">{d?.onboarding?.steps.map((st) => <li key={st.id} className={`flex items-center gap-2 ${st.done ? '' : 'text-text-muted'}`}>{st.done ? <Check size={12} className="text-teal" aria-hidden="true" /> : <span className="inline-block h-3 w-3 rounded-full border border-border" aria-hidden="true" />}{st.title}{st.optional ? <span className="text-[10px] uppercase tracking-wider text-text-muted/70">opt</span> : null}</li>)}</ul>
      </div>
    </div>
  )
}
