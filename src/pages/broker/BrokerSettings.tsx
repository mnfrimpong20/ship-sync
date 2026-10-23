import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, ExternalLink, MessageSquare, Trash2, UserPlus } from 'lucide-react'
import { bpApi, ago, shortDate, statusTone, type BpDetail, type BpMember, type BpThread } from '../../lib/brokerPortal'
import { jobStepLabels } from '../../lib/brokers'
import { cargoTypes } from '../../lib/data'
import { Card, Empty, Err, Page, Toast, errMsg, useBp, useToast } from './BrokerApp'
import { Thread } from './BrokerJobs'
import { PasswordInput } from '../../components/PasswordInput'

/* ---------------- messages: every job thread in one place ---------------- */
export function Messages() {
  const [threads, setThreads] = useState<BpThread[] | null>(null); const [err, setErr] = useState('')
  const [sp, setSp] = useSearchParams(); const sel = sp.get('job'); const [d, setD] = useState<BpDetail | null>(null); const { reload } = useBp()
  const loadThreads = () => bpApi.inbox().then(setThreads).catch((e) => setErr(errMsg(e)))
  const loadJob = (id: string) => bpApi.job(id).then((x) => { setD(x); void loadThreads(); void reload() }).catch((e) => setErr(errMsg(e)))
  useEffect(() => { void loadThreads() }, [])
  useEffect(() => { setD(null); if (sel) void loadJob(sel) }, [sel])
  const list = (
    <Card title="Conversations" id="th-h" className={sel ? 'hidden lg:block' : ''}>
      {!threads ? <p className="text-text-muted">Loading…</p> : threads.length ? <ul className="-mx-2 divide-y divide-border/70" data-testid="bp-threads">{threads.map((t) => <li key={t.jobId}><button onClick={() => setSp({ job: t.jobId })} aria-current={sel === t.jobId ? 'true' : undefined} className={`flex w-full gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2 ${sel === t.jobId ? 'bg-surface-2' : ''}`}>
        <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="font-mono text-sm">{t.ref}</b><span className="shrink-0 text-xs text-text-muted">{ago(t.lastAt)}</span></span><span className="block truncate text-xs text-text-muted">{t.shipper} · {t.customer}</span><span className={`mt-0.5 block truncate text-sm ${t.unread ? 'font-semibold' : 'text-text-muted'}`}>{t.lastFrom}: {t.last}</span></span>
        {t.unread > 0 && <span className="mt-1 h-5 min-w-5 shrink-0 rounded-full bg-gold px-1.5 text-center text-xs font-bold leading-5 text-on-accent" aria-label={`${t.unread} unread`}>{t.unread}</span>}
      </button></li>)}</ul> : <Empty>No conversations yet. Messages on a job show up here.</Empty>}
    </Card>
  )
  return (
    <Page eyebrow="Messages" title="Conversations with shipping companies">
      <Err e={err} />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {list}
        <div className={sel ? '' : 'hidden lg:block'}>
          {!sel ? <Card><div className="flex flex-col items-center gap-2 py-10 text-center text-text-muted"><MessageSquare size={28} aria-hidden="true" /><p>Pick a conversation.</p></div></Card> : !d ? <p className="text-text-muted">Loading…</p> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><button onClick={() => setSp({})} className="inline-flex min-h-10 items-center gap-1 text-sm text-text-muted lg:hidden"><ArrowLeft size={15} aria-hidden="true" /> All conversations</button><p className="text-sm"><b className="font-mono">{d.shipment.ref}</b> · {d.job.shipperName} · <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(d.job.status)}`}>{jobStepLabels[d.job.status]}</span></p><Link to={`/broker-portal/jobs/${d.job.id}`} className="text-sm font-semibold text-gold-deep underline">Open job</Link></div>
            <Thread jobId={d.job.id} messages={d.messages} onSent={() => void loadJob(d.job.id)} title={`${d.shipment.customer} — ${d.shipment.cargoLabel}`} />
          </>}
        </div>
      </div>
    </Page>
  )
}

/* ---------------- profile & settings ---------------- */
const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className="mb-1 block text-sm font-semibold">{label}</label>{children}{hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}</div>
}
export function Profile() {
  const { me, reload } = useBp(); const b = me.broker; const owner = me.member.role === 'owner'
  const [f, setF] = useState({ about: b.about, phone: b.phone, whatsapp: b.whatsapp, email: b.email, specialties: b.specialties.join(', '), ports: b.ports.join(', '), fees: Object.fromEntries(cargoTypes.map((c) => [c.id, String(b.fees[c.id] ?? '')])) as Record<string, string>, responseHours: String(b.responseHours), dutyAdvance: b.dutyAdvance, accepting: b.accepting, licenceExpires: b.licenceExpires ?? '', termsDays: String(b.settings.termsDays ?? 14), bank: b.settings.bank ?? '', invoiceNote: b.settings.invoiceNote ?? '' })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const [err, setErr] = useState(''); const [toast, setToast] = useToast(); const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [pwErr, setPwErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const fees: Record<string, number> = {}; for (const [k, v] of Object.entries(f.fees)) if (v.trim() !== '') fees[k] = Number(v)
      await bpApi.profile({ about: f.about, phone: f.phone, whatsapp: f.whatsapp, email: f.email, specialties: lines(f.specialties), ports: lines(f.ports), fees, responseHours: Number(f.responseHours), dutyAdvance: f.dutyAdvance, accepting: f.accepting, licenceExpires: f.licenceExpires || null, settings: { termsDays: Number(f.termsDays), bank: f.bank, invoiceNote: f.invoiceNote } })
      await reload(); setToast('Saved. Shipping companies see the changes on your listing straight away.')
    } catch (er) { setErr(errMsg(er)) } finally { setBusy(false) }
  }
  // Links from the Overview's setup list land on the right card.
  useEffect(() => { const h = window.location.hash.slice(1); if (h) setTimeout(() => document.getElementById(h)?.closest('section')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50) }, [])
  const licDays = b.licenceExpires ? Math.round((new Date(b.licenceExpires + 'T12:00:00Z').getTime() - Date.now()) / 86400000) : null
  return (
    <Page eyebrow="Profile & settings" title={b.company || b.name} sub={<>Licence {b.licenceNo} · {b.licenceAuthority} · <Link to={`/brokers/${b.id}`} className="inline-flex items-center gap-1 underline">See your public listing <ExternalLink size={13} aria-hidden="true" /></Link></>}>
      <Toast msg={toast} /><Err e={err} />
      {licDays != null && licDays < 60 && <p role="alert" className="mb-4 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm">{licDays < 0 ? 'Your customs licence has expired — shipping companies can’t book you until you renew.' : `Your customs licence expires in ${licDays} days (${shortDate(b.licenceExpires)}). Renew it and update the date below.`}</p>}
      {!owner && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-muted">Only the owner of the firm can change these settings.</p>}
      <form onSubmit={save} className="grid gap-6 xl:grid-cols-2">
        <fieldset disabled={!owner || busy} className="contents">
          <Card title="Taking new jobs" id="pf-avail">
            <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.accepting} onChange={(e) => set('accepting', e.target.checked)} data-testid="bp-accepting" /><span><b>Show me as available</b><span className="block text-sm text-text-muted">Turn off when you’re full — you stay listed but can’t be booked.</span></span></label>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.dutyAdvance} onChange={(e) => set('dutyAdvance', e.target.checked)} /><span><b>I can advance duty</b><span className="block text-sm text-text-muted">Pay duty for the client and bill it back.</span></span></label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field id="pf-rh" label="Usual reply time (hours)"><input id="pf-rh" type="number" min={1} max={168} className="input-dark" value={f.responseHours} onChange={(e) => set('responseHours', e.target.value)} /></Field><Field id="pf-lic" label="Licence expires"><input id="pf-lic" type="date" className="input-dark" value={f.licenceExpires} onChange={(e) => set('licenceExpires', e.target.value)} /></Field></div>
          </Card>
          <Card title="Fees per cargo (USD)" sub="Your clearing fee, excluding duty and disbursements. Leave blank if you don’t handle that cargo." id="pf-fees">
            <div className="grid grid-cols-2 gap-3">{cargoTypes.map((c) => <Field key={c.id} id={`pf-fee-${c.id}`} label={c.label}><input id={`pf-fee-${c.id}`} type="number" min={0} step="1" inputMode="decimal" className="input-dark" value={f.fees[c.id]} onChange={(e) => set('fees', { ...f.fees, [c.id]: e.target.value })} /></Field>)}</div>
          </Card>
          <Card title="Listing" id="pf-list">
            <div className="grid gap-4">
              <Field id="pf-about" label="About your firm"><textarea id="pf-about" rows={3} maxLength={600} className="input-dark py-2" value={f.about} onChange={(e) => set('about', e.target.value)} /></Field>
              <Field id="pf-ports" label="Ports you clear at" hint="Separate with commas."><input id="pf-ports" className="input-dark" value={f.ports} onChange={(e) => set('ports', e.target.value)} /></Field>
              <Field id="pf-spec" label="Specialties" hint="E.g. vehicles, personal effects, commercial goods."><input id="pf-spec" className="input-dark" value={f.specialties} onChange={(e) => set('specialties', e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-3"><Field id="pf-phone" label="Phone"><input id="pf-phone" className="input-dark" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field><Field id="pf-wa" label="WhatsApp"><input id="pf-wa" className="input-dark" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field><Field id="pf-email" label="Email"><input id="pf-email" type="email" className="input-dark" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field></div>
            </div>
          </Card>
          <Card title="Invoices" id="pf-inv">
            <div className="grid gap-4">
              <Field id="pf-terms" label="Payment terms (days)" hint="Due date = invoice date + this many days."><input id="pf-terms" type="number" min={0} max={120} className="input-dark" value={f.termsDays} onChange={(e) => set('termsDays', e.target.value)} /></Field>
              <Field id="pf-bank" label="How to pay you" hint="Bank account, mobile money — printed on every invoice."><textarea id="pf-bank" rows={2} className="input-dark py-2" value={f.bank} onChange={(e) => set('bank', e.target.value)} /></Field>
              <Field id="pf-note" label="Invoice note"><textarea id="pf-note" rows={2} className="input-dark py-2" value={f.invoiceNote} onChange={(e) => set('invoiceNote', e.target.value)} /></Field>
            </div>
          </Card>
          {owner && <div className="xl:col-span-2"><button className="btn-gold" data-testid="bp-save-profile">{busy ? 'Saving…' : 'Save changes'}</button></div>}
        </fieldset>
      </form>
      <Card className="mt-6 max-w-xl" title="Your password" sub={`Signed in as ${me.member.email}`} id="pf-pw">
        <form onSubmit={async (e) => { e.preventDefault(); setPwErr(''); if (pw.length < 8) return setPwErr('Use at least 8 characters.'); if (pw !== pw2) return setPwErr('The two passwords don’t match.'); try { await bpApi.password(pw); setPw(''); setPw2(''); setToast('Password changed.') } catch (er) { setPwErr(errMsg(er)) } }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field id="pw1" label="New password"><PasswordInput id="pw1" autoComplete="new-password" className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field id="pw2" label="Repeat it"><PasswordInput id="pw2" autoComplete="new-password" className="input-dark" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <button className="btn-ghost">Change</button>
        </form>
        <Err e={pwErr} />
      </Card>
    </Page>
  )
}

/* ---------------- team ---------------- */
export function Team() {
  const { me } = useBp(); const owner = me.member.role === 'owner'
  const [list, setList] = useState<BpMember[] | null>(null); const [err, setErr] = useState(''); const [toast, setToast] = useToast()
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'agent' as 'owner' | 'agent' }); const [link, setLink] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => bpApi.team().then(setList).catch((e) => setErr(errMsg(e)))
  useEffect(() => { void load() }, [])
  const full = link ? `${window.location.origin}${link}` : ''
  return (
    <Page eyebrow="Team" title="Your clearing team" sub="Agents see every job, can work and message on them, and can be assigned jobs. Only owners change settings and the team.">
      <Toast msg={toast} /><Err e={err} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="People" id="tm-h">
          {!list ? <p className="text-text-muted">Loading…</p> : <ul className="divide-y divide-border" data-testid="bp-team">{list.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold" aria-hidden="true">{m.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <span className="min-w-0 flex-1"><b>{m.name}</b>{m.id === me.member.id && <span className="text-text-muted"> (you)</span>} <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold capitalize">{m.role}</span>{m.status === 'invited' && <span className="ml-1 rounded-full bg-gold/20 px-2 py-0.5 text-xs font-semibold text-gold-deep">Invited</span>}<span className="block truncate text-sm text-text-muted">{m.email}{m.lastSeenAt ? ` · seen ${ago(m.lastSeenAt)}` : ''}</span></span>
            <span className="text-right text-sm tabular-nums"><b>{m.openJobs}</b> open<span className="block text-xs text-text-muted">{m.doneJobs} cleared</span></span>
            {owner && m.id !== me.member.id && <button onClick={async () => { if (!window.confirm(`Remove ${m.name}? Their jobs become unassigned.`)) return; try { await bpApi.remove(m.id); setToast(`${m.name} removed.`); await load() } catch (e) { setErr(errMsg(e)) } }} className="btn-ghost !min-h-10 !px-2.5" aria-label={`Remove ${m.name}`}><Trash2 size={15} aria-hidden="true" /></button>}
          </li>)}</ul>}
        </Card>
        {owner && <Card title="Invite someone" id="tm-inv">
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await bpApi.invite(f); setLink(r.link); setToast(`Invite created for ${f.name}.`); setF({ name: '', email: '', phone: '', role: 'agent' }); await load() } catch (er) { setErr(errMsg(er)) } finally { setBusy(false) } }} className="grid gap-3">
            <Field id="tm-name" label="Name"><input id="tm-name" required minLength={2} className="input-dark" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field id="tm-email" label="Email"><input id="tm-email" required type="email" className="input-dark" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field id="tm-phone" label="Phone (optional)"><input id="tm-phone" className="input-dark" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field id="tm-role" label="Role"><select id="tm-role" className="input-dark" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'owner' | 'agent' })}><option value="agent">Agent</option><option value="owner">Owner</option></select></Field>
            <button disabled={busy} className="btn-gold" data-testid="bp-invite"><UserPlus size={16} aria-hidden="true" /> Send invite</button>
          </form>
          {full && <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm" data-testid="bp-invite-link"><p className="mb-1 font-semibold">Share this join link</p><p className="mb-2 text-text-muted">We emailed it too. It lets them set a password.</p><div className="flex gap-2"><input readOnly aria-label="Join link" className="input-dark flex-1 font-mono text-xs" value={full} /><button type="button" onClick={() => { void navigator.clipboard?.writeText(full); setToast('Link copied.') }} className="btn-ghost !px-3" aria-label="Copy link"><Copy size={15} aria-hidden="true" /></button></div></div>}
        </Card>}
      </div>
    </Page>
  )
}
