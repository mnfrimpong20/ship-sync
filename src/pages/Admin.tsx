import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, ShieldCheck, ShieldOff } from 'lucide-react'
import { AdminAttention, AdminBusiness, adminApi } from '../components/AdminBusiness'
import { countryByCode, type Shipper } from '../lib/data'
import { useStore, type AdminShipper } from '../lib/store'
import { Avatar, Pill, Rating, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { AdminInsurance } from '../components/AdminInsurance'
import { AdminPayments } from '../components/AdminPayments'
import { AdminBrokers } from './Brokers'
import { AdminDisputes } from './Reviews'
import { AdminSourcing } from './Sourcing'
import { AdminSystem } from '../components/AdminSystem'

const VIEWS = [['overview', 'Business'], ['attention', 'Attention'], ['shippers', 'Shippers'], ['disputes', 'Disputes'], ['payments', 'Payments'], ['brokers', 'Brokers'], ['sourcing', 'Sourcing'], ['insurance', 'Insurance'], ['system', 'System']] as const
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

  useEffect(() => {
    if (!ready || !user?.admin) return
    let live = true
    adminShippers().then((s) => live && setRows(s)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load shippers.'))
    return () => { live = false }
  }, [ready, user, adminShippers])

  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  if (!user) return <Navigate to="/login?next=/admin" replace />
  if (!user.admin) return <Navigate to="/dashboard" replace />

  const act = async (s: AdminShipper, patch: { verified?: boolean; plan?: Shipper['plan'] }) => {
    setBusy(s.id); setError('')
    try {
      const updated = await adminVerify(s.id, { verified: patch.verified ?? s.verified, plan: patch.plan })
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
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-text"><Link to={`/shippers/${s.id}`} className="hover:text-gold focus-ring rounded">{s.name}</Link>{s.verified && <BadgeCheck size={16} className="text-gold" aria-label="Verified" />}{s.demo && <Pill tone="muted">Demo</Pill>}</p>
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
                {s.verified
                  ? <button onClick={() => act(s, { verified: false })} disabled={busy === s.id} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldOff size={14} aria-hidden="true" /> Revoke</button>
                  : <button onClick={() => act(s, { verified: true })} disabled={busy === s.id} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><ShieldCheck size={14} aria-hidden="true" /> {busy === s.id ? 'Saving…' : 'Verify'}</button>}
              </div>
            </div>
            {s.verifiedAt && <p className="mt-3 text-[11px] text-text-muted">Verified {fmtDate(s.verifiedAt)}</p>}
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
    sourcing: ['Sourcing settings', 'Pricing, agents and commissions for the China desk.'], insurance: ['Insurance', 'Cargo cover sold on the platform.'], system: ['Health, errors & backups', 'What is wired up, what broke, and a copy of the database you can download.'],
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
          {view === 'system' && <AdminSystem />}
        </motion.div>
      </div>
    </div>
  )
}
