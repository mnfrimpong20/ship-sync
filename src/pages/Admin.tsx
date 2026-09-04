import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, ShieldCheck, ShieldOff } from 'lucide-react'
import { countryByCode, type Shipper } from '../lib/data'
import { useStore, type AdminShipper } from '../lib/store'
import { Avatar, Pill, Rating, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

/** Ship Sync staff: review shipper listings and grant / revoke the verified badge. */
export default function Admin() {
  const { ready, user, adminShippers, adminVerify } = useStore()
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

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">Admin</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Shipper verification</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-text-muted">Verified shippers get the badge, rank higher in matching and reassure customers. Check licence, insurance and a real office before granting it.</motion.p>
          {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

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
        </motion.div>
      </div>
    </div>
  )
}
