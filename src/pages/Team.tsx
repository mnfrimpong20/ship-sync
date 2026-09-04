import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Link2, Mail, Phone, Plus, RefreshCw, ShieldCheck, Truck, UserCheck, UserX, Users, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, joinLink, opsApi, roleBlurb, roleLabels, type InviteInput, type Staff, type StaffRole } from '../lib/ops'
import { Empty, Pill } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const roleTone: Record<StaffRole, 'gold' | 'teal' | 'sky' | 'muted'> = { owner: 'gold', dispatcher: 'teal', agent: 'sky', driver: 'muted' }

function CopyLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const link = joinLink(token)
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ } }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs">
      <Link2 size={13} className="text-gold" aria-hidden="true" />
      <span className="text-text-muted">Invite link:</span>
      <input readOnly aria-label="Invitation link" value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text outline-none" />
      <button type="button" onClick={copy} className="btn-ghost !min-h-8 !px-2.5 text-xs">{copied ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy</>}</button>
    </div>
  )
}

const blank: InviteInput = { name: '', email: '', phone: '', role: 'agent', base: 'origin', city: '' }

export default function Team() {
  const { ready, user } = useStore()
  const [team, setTeam] = useState<Staff[] | null>(null)
  const [inviting, setInviting] = useState(false)
  const [f, setF] = useState<InviteInput>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justInvited, setJustInvited] = useState<Staff | null>(null)
  const manage = canManageOps(user?.staffRole)
  const isOwner = user?.staffRole === 'owner'

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    opsApi.team().then((t) => live && setTeam(t)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your team.'))
    return () => { live = false }
  }, [ready, user])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/team" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const s = await opsApi.invite(f); setTeam((t) => [...(t ?? []), s]); setJustInvited(s); setInviting(false); setF(blank) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send the invitation.') } finally { setBusy(false) }
  }
  const patch = async (id: string, p: Parameters<typeof opsApi.updateStaff>[1]) => {
    setError('')
    try { const s = await opsApi.updateStaff(id, p); setTeam((t) => (t ?? []).map((x) => (x.id === id ? s : x))) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') }
  }
  const reinvite = async (id: string) => {
    try { const s = await opsApi.reinvite(id); setTeam((t) => (t ?? []).map((x) => (x.id === id ? s : x))); setJustInvited(s) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh the invitation.') }
  }

  const active = (team ?? []).filter((s) => s.status === 'active')
  const drivers = active.filter((s) => s.role === 'driver')
  const pending = (team ?? []).filter((s) => s.status === 'invited')

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Team</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{user.company ?? 'Your'} team</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Give staff their own logins. Roles decide what each person can see and do.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><button onClick={() => { setInviting(true); setJustInvited(null) }} className="btn-gold"><Plus size={16} aria-hidden="true" /> Invite teammate</button></motion.div>}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Active members</p><Users size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{active.length}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Drivers</p><Truck size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{drivers.length}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Invitations pending</p><Mail size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{pending.length}</p></motion.div>
          </div>

          <AnimatePresence>
            {inviting && (
              <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={invite} className="mt-6 card-dark grid gap-3 p-6 md:grid-cols-2" aria-label="Invite a teammate">
                <div className="md:col-span-2"><h2 className="!text-lg">Invite a teammate</h2><p className="mt-1 text-sm text-text-muted">You’ll get a one-time link to send them on WhatsApp or email. They set their own password when they open it.</p></div>
                {error && <p role="alert" className="md:col-span-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
                <div><label htmlFor="t-name" className="label-dark">Full name</label><input id="t-name" className="input-dark" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
                <div><label htmlFor="t-email" className="label-dark">Email</label><input id="t-email" type="email" className="input-dark" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
                <div><label htmlFor="t-phone" className="label-dark">Phone / WhatsApp</label><input id="t-phone" className="input-dark" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
                <div><label htmlFor="t-city" className="label-dark">Based in</label><input id="t-city" className="input-dark" placeholder="Houston, TX or Accra" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
                <div><label htmlFor="t-role" className="label-dark">Role</label>
                  <select id="t-role" className="input-dark" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}>
                    {(Object.keys(roleLabels) as StaffRole[]).filter((r) => r !== 'owner' || isOwner).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-text-muted">{roleBlurb[f.role]}</p>
                </div>
                <div><label htmlFor="t-base" className="label-dark">Works at</label>
                  <select id="t-base" className="input-dark" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value as InviteInput['base'] })}><option value="origin">Origin side (US / Europe)</option><option value="destination">Destination side (West Africa)</option></select>
                </div>
                <div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={() => { setInviting(false); setError('') }} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Check size={15} aria-hidden="true" /> {busy ? 'Creating…' : 'Create invitation'}</button></div>
              </motion.form>
            )}
          </AnimatePresence>
          {justInvited?.inviteToken && !inviting && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 card-dark border-gold/40 p-5">
              <p className="flex items-center gap-2 font-semibold"><UserCheck size={16} className="text-gold" aria-hidden="true" /> Invitation ready for {justInvited.name}</p>
              <p className="mt-1 text-sm text-text-muted">Send them this link. It works once and expires when they join.</p>
              <CopyLink token={justInvited.inviteToken} />
            </motion.div>
          )}
          {!inviting && error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.ul variants={fadeUp} className="mt-8 space-y-2" aria-label="Team members">
            {team && team.length === 0 && <li><Empty title="Just you so far" body="Invite dispatchers, agents and drivers so everyone works from the same shipments." /></li>}
            {(team ?? []).map((s) => {
              const isMe = s.userId === user.id
              const canEdit = manage && !(s.role === 'owner' && !isOwner)
              return (
                <li key={s.id} className={`card-dark p-4 ${s.status === 'inactive' ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 font-heading text-sm font-bold text-gold" aria-hidden="true">{initialsOf(s.name)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">{s.name}{isMe && <span className="text-xs font-normal text-text-muted">(you)</span>}<Pill tone={roleTone[s.role]}>{roleLabels[s.role]}</Pill>{s.status === 'invited' && <Pill tone="muted">Invited</Pill>}{s.status === 'inactive' && <Pill tone="danger">Inactive</Pill>}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted"><span className="inline-flex items-center gap-1"><Mail size={12} aria-hidden="true" /> {s.email}</span>{s.phone && <span className="inline-flex items-center gap-1"><Phone size={12} aria-hidden="true" /> {s.phone}</span>}<span>{s.base === 'origin' ? 'Origin side' : 'Destination side'}{s.city ? ` · ${s.city}` : ''}</span>{s.role === 'driver' && s.runCount ? <span>{s.runCount} run{s.runCount === 1 ? '' : 's'}</span> : null}</p>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`role-${s.id}`}>Role for {s.name}</label>
                        <select id={`role-${s.id}`} className="input-dark !min-h-9 !w-auto text-sm" value={s.role} onChange={(e) => patch(s.id, { role: e.target.value as StaffRole })} disabled={s.status === 'inactive'}>
                          {(Object.keys(roleLabels) as StaffRole[]).filter((r) => r !== 'owner' || isOwner).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                        </select>
                        {s.status === 'invited' && <button onClick={() => reinvite(s.id)} className="btn-ghost !min-h-9 !px-3 text-sm" title="Create a fresh invite link"><RefreshCw size={14} aria-hidden="true" /> New link</button>}
                        {s.status === 'inactive'
                          ? <button onClick={() => patch(s.id, { status: 'active' })} className="btn-ghost !min-h-9 !px-3 text-sm"><UserCheck size={14} aria-hidden="true" /> Reactivate</button>
                          : !isMe && <button onClick={() => patch(s.id, { status: 'inactive' })} className="btn-ghost !min-h-9 !px-3 text-sm text-danger" title="Switch off their access"><UserX size={14} aria-hidden="true" /> Deactivate</button>}
                      </div>
                    )}
                  </div>
                  {manage && s.status === 'invited' && s.inviteToken && <CopyLink token={s.inviteToken} />}
                </li>
              )
            })}
          </motion.ul>

          <motion.div variants={fadeUp} className="mt-8 card-dark p-5">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><ShieldCheck size={14} className="text-gold" aria-hidden="true" /> What each role can do</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(roleLabels) as StaffRole[]).map((r) => <div key={r}><dt className="text-sm font-semibold">{roleLabels[r]}</dt><dd className="text-sm text-text-muted">{roleBlurb[r]}</dd></div>)}
            </dl>
            <p className="mt-3 text-xs text-text-muted">Permissions are enforced by the server, not just hidden in the menu. <X size={11} className="inline" aria-hidden="true" /> Deactivating someone signs them out immediately.</p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
