import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Ellipsis, Link2, Mail, Phone, Plus, RefreshCw, ShieldCheck, Truck, UserCheck, UserX, Users } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, joinLink, opsApi, roleBlurb, roleLabels, type InviteInput, type Staff, type StaffRole } from '../lib/ops'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Expander, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

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

type Filter = 'all' | 'active' | 'invited' | 'inactive'
const PAGE = 10

export default function Team() {
  const { ready, user } = useStore()
  const [team, setTeam] = useState<Staff[] | null>(null)
  const [inviting, setInviting] = useState(false)
  const [f, setF] = useState<InviteInput>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [justInvited, setJustInvited] = useState<Staff | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [role, setRole] = useState<StaffRole | ''>('')
  const [base, setBase] = useState<'' | 'origin' | 'destination'>('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState<Staff | null>(null)
  const [showRoles, setShowRoles] = useState(false)
  const manage = canManageOps(user?.staffRole)
  const isOwner = user?.staffRole === 'owner'
  useEffect(() => { if (!menu) return; const k = () => setMenu(null); window.addEventListener('click', k); return () => window.removeEventListener('click', k) }, [menu])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    opsApi.team().then((t) => live && setTeam(t)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your team.'))
    return () => { live = false }
  }, [ready, user])

  const all = team ?? []
  const counts = { active: all.filter((s) => s.status === 'active').length, invited: all.filter((s) => s.status === 'invited').length, inactive: all.filter((s) => s.status === 'inactive').length, drivers: all.filter((s) => s.status === 'active' && s.role === 'driver').length }
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const order: Record<StaffRole, number> = { owner: 0, dispatcher: 1, agent: 2, driver: 3 }
    return all.filter((s) => (filter === 'all' ? s.status !== 'inactive' : s.status === filter) && (!role || s.role === role) && (!base || s.base === base) && (!ql || [s.name, s.email, s.phone, s.city, roleLabels[s.role]].join(' ').toLowerCase().includes(ql)))
      .sort((a, b) => (a.status === 'invited' ? 1 : 0) - (b.status === 'invited' ? 1 : 0) || order[a.role] - order[b.role] || a.name.localeCompare(b.name))
  }, [all, filter, role, base, q])
  const p = usePaged(list, PAGE, `${filter}|${role}|${base}|${q}`)

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/team" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const s = await opsApi.invite(f); setTeam((t) => [...(t ?? []), s]); setJustInvited(s); setInviting(false); setF(blank); setFilter('all') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send the invitation.') } finally { setBusy(false) }
  }
  const patch = async (s: Staff, p: Parameters<typeof opsApi.updateStaff>[1], msg: string) => {
    setBusy(true); setError('')
    try { const u = await opsApi.updateStaff(s.id, p); setTeam((t) => (t ?? []).map((x) => (x.id === s.id ? u : x))); setToast(msg) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy(false); setDeactivating(null) }
  }
  const reinvite = async (s: Staff) => {
    setBusy(true); setError('')
    try { const u = await opsApi.reinvite(s.id); setTeam((t) => (t ?? []).map((x) => (x.id === s.id ? u : x))); setJustInvited(u); setOpen(u.id); setToast(`New invite link ready for ${u.name}.`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh the invitation.') } finally { setBusy(false) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Team</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{counts.active} {counts.active === 1 ? 'person' : 'people'} on the team</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Give staff their own logins. Roles decide what each person can see and do, and the server enforces them.</motion.p></div>
            {manage && <motion.div variants={fadeUp} className="flex gap-2"><button onClick={() => setShowRoles((r) => !r)} className="btn-ghost !min-h-10 !px-4 text-sm" aria-expanded={showRoles}><ShieldCheck size={15} aria-hidden="true" /> Roles</button><button onClick={() => { setInviting(true); setJustInvited(null) }} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Invite teammate</button></motion.div>}
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}</AnimatePresence>

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active members" value={counts.active} hint="Can sign in right now" icon={Users} active={filter === 'active'} onClick={() => setFilter(filter === 'active' ? 'all' : 'active')} />
            <StatCard label="Drivers" value={counts.drivers} hint="See only their own runs" icon={Truck} active={role === 'driver'} onClick={() => setRole(role === 'driver' ? '' : 'driver')} />
            <StatCard label="Invitations pending" value={counts.invited} hint={counts.invited ? 'Haven’t opened their link yet' : 'Everyone invited has joined'} icon={Mail} warn={counts.invited > 0} active={filter === 'invited'} onClick={() => setFilter(filter === 'invited' ? 'all' : 'invited')} />
            <StatCard label="Deactivated" value={counts.inactive} hint="Access switched off" icon={UserX} active={filter === 'inactive'} onClick={() => setFilter(filter === 'inactive' ? 'all' : 'inactive')} />
          </motion.div>

          <AnimatePresence>
            {showRoles && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 card-dark p-5">
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><ShieldCheck size={14} className="text-gold" aria-hidden="true" /> What each role can do</p>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(roleLabels) as StaffRole[]).map((r) => <div key={r}><dt className="flex items-center gap-2 text-sm font-semibold"><Pill tone={roleTone[r]}>{roleLabels[r]}</Pill></dt><dd className="mt-1 text-sm text-text-muted">{roleBlurb[r]}</dd></div>)}</dl>
                <p className="mt-3 text-xs text-text-muted">Permissions are enforced by the server, not just hidden in the menu. Deactivating someone signs them out immediately.</p>
              </motion.div>
            )}
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

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={counts.active + counts.invited}>Team</Chip>
            <Chip active={filter === 'invited'} onClick={() => setFilter('invited')} count={counts.invited}>Invited</Chip>
            <Chip active={filter === 'inactive'} onClick={() => setFilter('inactive')} count={counts.inactive}>Deactivated</Chip>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <SearchBox value={q} onChange={setQ} label="Search team" placeholder="Search name, email, phone, city…" />
            <select aria-label="Role" className="input-dark !min-h-10 !w-auto text-sm" value={role} onChange={(e) => setRole(e.target.value as StaffRole | '')}><option value="">All roles</option>{(Object.keys(roleLabels) as StaffRole[]).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select>
            <select aria-label="Base" className="input-dark !min-h-10 !w-auto text-sm" value={base} onChange={(e) => setBase(e.target.value as typeof base)}><option value="">Both sides</option><option value="origin">Origin side</option><option value="destination">Destination side</option></select>
          </motion.div>

          <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className={thead}><Th className="w-8" /><Th>Member</Th><Th>Role</Th><Th>Contact</Th><Th>Works at</Th><Th>Runs</Th><Th>Status</Th>{manage && <Th className="text-right">Actions</Th>}</tr></thead>
                <tbody>
                  {team === null && !error && <tr><td colSpan={8} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>}
                  {team && p.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-10"><Empty title={all.length ? 'No one matches' : 'Just you so far'} body={all.length ? 'Try another filter or search.' : 'Invite dispatchers, agents and drivers so everyone works from the same shipments.'} action={manage && !all.length ? <button onClick={() => setInviting(true)} className="btn-gold !min-h-10 !px-4 text-sm"><Plus size={15} aria-hidden="true" /> Invite teammate</button> : undefined} /></td></tr>}
                  {p.rows.map((s) => {
                    const isMe = s.userId === user.id; const canEdit = manage && !(s.role === 'owner' && !isOwner); const isOpen = open === s.id
                    return (
                      <Fragment key={s.id}>
                        <tr className={trow(isOpen, s.status === 'inactive')}>
                          <td className="px-3 py-3"><Expander open={isOpen} onClick={() => setOpen(isOpen ? null : s.id)} label={`details for ${s.name}`} /></td>
                          <td className="px-3 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 font-heading text-xs font-bold text-gold" aria-hidden="true">{initialsOf(s.name)}</span><div><p className="font-semibold">{s.name}{isMe && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}</p><p className="text-[11px] text-text-muted">Joined {fmtDate(s.createdAt)}</p></div></div></td>
                          <td className="whitespace-nowrap px-3 py-3">{canEdit && s.status !== 'inactive' ? <><label className="sr-only" htmlFor={`role-${s.id}`}>Role for {s.name}</label><select id={`role-${s.id}`} className="input-dark !min-h-8 !w-auto !py-0 text-xs" value={s.role} onChange={(e) => patch(s, { role: e.target.value as StaffRole }, `${s.name} is now ${roleLabels[e.target.value as StaffRole].toLowerCase()}.`)}>{(Object.keys(roleLabels) as StaffRole[]).filter((r) => r !== 'owner' || isOwner).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select></> : <Pill tone={roleTone[s.role]}>{roleLabels[s.role]}</Pill>}</td>
                          <td className="px-3 py-3 text-xs"><p className="inline-flex items-center gap-1"><Mail size={11} aria-hidden="true" /> <a href={`mailto:${s.email}`} className="hover:text-gold-deep">{s.email}</a></p>{s.phone && <p className="inline-flex items-center gap-1 text-text-muted"><Phone size={11} aria-hidden="true" /> <a href={`tel:${s.phone}`} className="hover:text-gold-deep">{s.phone}</a></p>}</td>
                          <td className="px-3 py-3"><p>{s.city || (s.base === 'origin' ? 'Origin side' : 'Destination side')}</p><p className="text-[11px] text-text-muted">{s.base === 'origin' ? 'US / Europe' : 'West Africa'}</p></td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums">{s.role === 'driver' ? (s.runCount ?? 0) : <span className="text-text-muted">—</span>}</td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={s.status === 'active' ? 'green' : s.status === 'invited' ? 'gold' : 'danger'}>{s.status === 'active' ? 'Active' : s.status === 'invited' ? 'Invited' : 'Deactivated'}</Pill></td>
                          {manage && (
                            <td className="px-3 py-3 text-right">
                              <div className="relative inline-flex items-center gap-1.5">
                                {s.status === 'invited' && s.inviteToken && <button onClick={() => setOpen(isOpen ? null : s.id)} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs"><Link2 size={12} aria-hidden="true" /> Invite link</button>}
                                {canEdit && !isMe && (
                                  <>
                                    <button onClick={(e) => { e.stopPropagation(); setMenu(menu === s.id ? null : s.id) }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-haspopup="menu" aria-expanded={menu === s.id} aria-label={`More actions for ${s.name}`}><Ellipsis size={14} /></button>
                                    {menu === s.id && (
                                      <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left text-sm shadow-xl">
                                        {s.status === 'invited' && <button role="menuitem" onClick={() => { setMenu(null); reinvite(s) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><RefreshCw size={14} aria-hidden="true" /> New invite link</button>}
                                        {s.role === 'driver' && <Link role="menuitem" to={`/dashboard/routes?driver=${s.id}&b=all`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"><Truck size={14} aria-hidden="true" /> See their runs</Link>}
                                        <a role="menuitem" href={`mailto:${s.email}`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"><Mail size={14} aria-hidden="true" /> Email</a>
                                        <div className="my-1 border-t border-border" />
                                        {s.status === 'inactive'
                                          ? <button role="menuitem" onClick={() => { setMenu(null); patch(s, { status: 'active' }, `${s.name} reactivated.`) }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><UserCheck size={14} aria-hidden="true" /> Reactivate</button>
                                          : <button role="menuitem" onClick={() => { setMenu(null); setDeactivating(s) }} className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10"><UserX size={14} aria-hidden="true" /> Deactivate…</button>}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={7} className="px-3 pb-5 pt-2">
                            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                              <p className="text-text-muted">{roleBlurb[s.role]}</p>
                              {s.status === 'invited' && s.inviteToken && manage && <><p className="mt-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Invitation</p><p className="mt-1 text-xs text-text-muted">Send {s.name.split(' ')[0]} this link on WhatsApp or email. It works once and expires when they join.</p><CopyLink token={s.inviteToken} /></>}
                              {s.status === 'inactive' && <p className="mt-3 text-xs text-danger">Signed out and blocked from signing in. Reactivate from the ⋯ menu to restore access.</p>}
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager p={p} noun="member" note={filter === 'all' ? 'deactivated people are under their own tab' : undefined} />
          </motion.div>
        </motion.div>
      </div>
      {deactivating && <Confirm title={`Deactivate ${deactivating.name}?`} body={<p>They are signed out immediately and can’t sign in until reactivated. Runs and records they worked on are kept.</p>} confirmLabel="Deactivate" busy={busy} onClose={() => setDeactivating(null)} onConfirm={() => patch(deactivating, { status: 'inactive' }, `${deactivating.name} deactivated.`)} />}
    </div>
  )
}
