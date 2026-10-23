import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, FileText, KeyRound, Mail, X } from 'lucide-react'
import { networkApi, type BrokerAccess, type BrokerApplication } from '../lib/brokers'
import { cargoLabel, countryByCode, type CargoType } from '../lib/data'
import { fmtDateTime, money } from './ui'
import { openDataUrl } from '../lib/openFile'

const errOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
const full = (link: string) => `${window.location.origin}${link}`

/** A join link the admin can copy and send on WhatsApp (we also email it). */
export function JoinLink({ link, who }: { link: string; who: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-3 rounded-lg border border-teal/40 bg-teal/10 p-3 text-sm" data-testid="join-link">
      <p className="font-semibold">Login invite for {who}</p>
      <p className="text-xs text-text-muted">We emailed it. You can also send it on WhatsApp — it lets them set a password, then they sign in at /broker-portal.</p>
      <div className="mt-2 flex gap-2"><input readOnly aria-label="Join link" className="input-dark !min-h-9 flex-1 font-mono text-xs" value={full(link)} onFocus={(e) => e.currentTarget.select()} /><button type="button" onClick={() => { void navigator.clipboard?.writeText(full(link)); setCopied(true) }} className="btn-ghost !min-h-9 !px-3 text-xs">{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}</button></div>
    </div>
  )
}

/* ---------------- applications from /brokers/join ---------------- */
export function BrokerApplications({ onApproved }: { onApproved: () => void }) {
  const [list, setList] = useState<BrokerApplication[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null); const [rejecting, setRejecting] = useState<string | null>(null); const [reason, setReason] = useState('')
  const [verify, setVerify] = useState(true); const [links, setLinks] = useState<Record<string, string>>({}); const [showAll, setShowAll] = useState(false)
  const load = () => networkApi.applications().then(setList).catch((e) => setErr(errOf(e)))
  useEffect(() => { void load() }, [])
  if (!list) return null
  const pending = list.filter((a) => a.status === 'pending'); const shown = showAll ? list : list.filter((a) => a.status === 'pending' || links[a.id])
  const viewLicence = async (id: string) => { try { const url = await networkApi.licence(id); openDataUrl(url, 'licence') } catch (e) { setErr(errOf(e)) } }
  return (
    <div className="mt-6" data-testid="broker-applications">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Applications {pending.length > 0 && <span className="ml-1 rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-on-accent">{pending.length} waiting</span>}</h3>{list.length > pending.length && <button onClick={() => setShowAll((x) => !x)} className="text-sm text-gold-deep underline">{showAll ? 'Only waiting' : `Show decided (${list.length - pending.length})`}</button>}</div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      {!shown.length ? <p className="mt-2 rounded-lg bg-surface-2/60 p-4 text-sm text-text-muted">No applications waiting. Brokers apply at <a href="/brokers/join" target="_blank" rel="noreferrer" className="underline">/brokers/join</a>.</p> : (
        <ul className="mt-3 grid gap-3">{shown.map((a) => (
          <li key={a.id} className="card-dark p-4" data-testid="broker-application">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-semibold">{a.company} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${a.status === 'pending' ? 'bg-gold/20 text-gold-deep' : a.status === 'approved' ? 'bg-teal/15 text-teal' : 'bg-danger/10 text-danger'}`}>{a.status === 'pending' ? 'Waiting' : a.status === 'approved' ? 'Approved' : 'Rejected'}</span></p>
                <p className="text-sm text-text-muted">{a.name} · {a.email} · {a.phone}</p>
                <p className="text-sm text-text-muted">{countryByCode(a.country)?.name ?? a.country} · {a.ports.join(', ')} · licence <span className="font-mono">{a.licenceNo}</span> ({a.licenceAuthority}){a.licenceExpires ? ` · expires ${a.licenceExpires}` : ''}</p>
                <p className="text-xs text-text-muted">Applied {fmtDateTime(a.createdAt)}{a.decidedBy ? ` · ${a.status} by ${a.decidedBy}` : ''}{a.reason ? ` — “${a.reason}”` : ''}</p></div>
              <div className="flex flex-wrap gap-1.5">
                {a.hasLicenceFile && <button onClick={() => viewLicence(a.id)} className="btn-ghost !min-h-9 !px-3 text-xs"><FileText size={14} aria-hidden="true" /> Licence</button>}
                <button onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="btn-ghost !min-h-9 !px-3 text-xs">{open === a.id ? 'Less' : 'Details'}</button>
              </div>
            </div>
            {open === a.id && <div className="mt-3 grid gap-2 rounded-lg bg-surface-2/50 p-3 text-sm">
              {a.about && <p>{a.about}</p>}
              {a.specialties.length > 0 && <p><b>Specialties:</b> {a.specialties.join(', ')}</p>}
              <p><b>Fees:</b> {Object.entries(a.fees).length ? Object.entries(a.fees).map(([k, v]) => `${cargoLabel(k as CargoType)} ${money(v)}`).join(' · ') : 'not given'}{a.dutyAdvance ? ' · advances duty' : ''}</p>
              {a.whatsapp && <p><b>WhatsApp:</b> {a.whatsapp}</p>}
            </div>}
            {a.status === 'pending' && (rejecting === a.id ? (
              <form onSubmit={async (e) => { e.preventDefault(); setBusy(a.id); setErr(''); try { await networkApi.reject(a.id, reason); setRejecting(null); setReason(''); await load() } catch (er) { setErr(errOf(er)) } finally { setBusy('') } }} className="mt-3 grid gap-2">
                <label htmlFor={`rj-${a.id}`} className="text-xs font-semibold">Reason (emailed to the applicant)</label><textarea id={`rj-${a.id}`} required minLength={3} rows={2} className="input-dark py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The licence number doesn’t match GRA’s register — please send a clearer copy." />
                <div className="flex gap-2"><button disabled={busy === a.id} className="btn-ghost !min-h-9 !px-3 text-xs text-danger">Reject application</button><button type="button" onClick={() => setRejecting(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button></div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button disabled={!!busy} onClick={async () => { setBusy(a.id); setErr(''); try { const r = await networkApi.approve(a.id, verify); setLinks((l) => ({ ...l, [a.id]: r.link })); await load(); onApproved() } catch (e) { setErr(errOf(e)) } finally { setBusy('') } }} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="approve-application"><Check size={14} aria-hidden="true" /> {busy === a.id ? 'Approving…' : 'Approve & send login'}</button>
                <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> Mark licence checked</label>
                <button onClick={() => { setRejecting(a.id); setReason('') }} className="btn-ghost !min-h-9 !px-3 text-xs"><X size={14} aria-hidden="true" /> Reject</button>
              </div>
            ))}
            {links[a.id] && <JoinLink link={links[a.id]} who={a.name} />}
          </li>
        ))}</ul>
      )}
    </div>
  )
}

/* ---------------- dashboard access on each listing ---------------- */
export function useBrokerAccess() {
  const [access, setAccess] = useState<Record<string, BrokerAccess[]>>({})
  const reload = () => networkApi.access().then(setAccess).catch(() => {})
  useEffect(() => { void reload() }, [])
  return { access, reload }
}
export function DashboardAccess({ brokerId, defaultEmail, defaultName, members, onChange }: { brokerId: string; defaultEmail: string; defaultName: string; members: BrokerAccess[]; onChange: () => void }) {
  const [form, setForm] = useState<{ name: string; email: string } | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [link, setLink] = useState('')
  const active = members.filter((m) => m.status === 'active'); const invited = members.filter((m) => m.status === 'invited')
  return (
    <div className="mt-3 border-t border-border pt-3 text-xs" data-testid="dashboard-access">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-text-muted"><KeyRound size={13} aria-hidden="true" />{active.length ? <span className="text-teal">Dashboard: {active.length} login{active.length === 1 ? '' : 's'}{active[0]?.lastSeenAt ? ` · last in ${fmtDateTime(active[0].lastSeenAt)}` : ''}</span> : invited.length ? <span className="text-gold-deep">Invited — not signed in yet ({invited[0].email})</span> : <span>No dashboard login yet</span>}</p>
        {!form && <button onClick={() => setForm({ name: invited[0]?.name ?? defaultName, email: invited[0]?.email ?? defaultEmail })} className="btn-ghost !min-h-8 !px-2.5 text-xs" data-testid="invite-dashboard"><Mail size={12} aria-hidden="true" /> {invited.length ? 'Resend invite' : active.length ? 'Invite another owner' : 'Invite to dashboard'}</button>}
      </div>
      {form && <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await networkApi.invite(brokerId, form); setLink(r.link); setForm(null); onChange() } catch (er) { setErr(errOf(er)) } finally { setBusy(false) } }} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="text-text-muted">Name<input required minLength={2} className="input-dark mt-1 !min-h-9 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-text-muted">Email<input required type="email" className="input-dark mt-1 !min-h-9 text-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <div className="flex items-end gap-1.5"><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs">{busy ? 'Sending…' : 'Send invite'}</button><button type="button" onClick={() => setForm(null)} className="btn-ghost !min-h-9 !px-2.5 text-xs" aria-label="Cancel"><X size={14} /></button></div>
      </form>}
      {err && <p role="alert" className="mt-1 text-danger">{err}</p>}
      {link && <JoinLink link={link} who={defaultName} />}
      {active.length > 0 && <a href="/broker-portal/login" target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-text-muted underline">Their sign-in page <ExternalLink size={11} aria-hidden="true" /></a>}
    </div>
  )
}
