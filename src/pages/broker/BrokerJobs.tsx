import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Car, Check, CheckCircle2, ChevronRight, Clock, Container, ExternalLink, FileText, Inbox, MessageSquare, Phone, Plus, Search, Send, Trash2, Upload, X } from 'lucide-react'
import { JOB_STEPS, jobStepLabels, type JobStep } from '../../lib/brokers'
import { bpApi, ago, local, shortDate, statusTone, usd, type BpDetail, type BpJob, type BpOverview } from '../../lib/brokerPortal'
import { Card, Empty, Err, Kpi, Page, Toast, errMsg, useBp, useToast } from './BrokerApp'
import { openDataUrl } from '../../lib/openFile'

const STEP_SHORT: Record<string, string> = { requested: 'Request', accepted: 'Accepted', documents: 'Docs lodged', assessed: 'Assessed', duty_paid: 'Duty paid', released: 'Released', done: 'Cleared' }
const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f) })

/** Seven-dot progress strip. */
export function Steps({ status, compact = false }: { status: string; compact?: boolean }) {
  const idx = JOB_STEPS.indexOf(status as JobStep); const off = status === 'declined' || status === 'cancelled'
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`Step ${idx + 1} of ${JOB_STEPS.length}: ${jobStepLabels[status as JobStep] ?? status}`}>
      {JOB_STEPS.map((s, i) => <span key={s} className={`h-1.5 rounded-full ${compact ? 'w-3' : 'flex-1'} ${off ? 'bg-danger/30' : i <= idx ? (status === 'done' ? 'bg-teal' : 'bg-gold') : 'bg-surface-2'}`} />)}
    </div>
  )
}
const Status = ({ s }: { s: string }) => <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(s)}`}>{jobStepLabels[s as JobStep] ?? s}</span>

/* ============================== Overview ============================== */
export function Overview() {
  const { me } = useBp(); const [d, setD] = useState<BpOverview | null>(null); const [err, setErr] = useState('')
  useEffect(() => { bpApi.overview().then(setD).catch((e) => setErr(errMsg(e))) }, [])
  const hour = new Date().getHours(); const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (!d) return <Page title={`${hi}, ${me.member.name.split(' ')[0]}`}><Err e={err} />{!err && <p className="text-text-muted">Loading…</p>}</Page>
  const k = d.kpis; const maxPipe = Math.max(1, ...d.pipeline.map((p) => p.n)); const owner = me.member.role === 'owner'
  return (
    <Page eyebrow={me.broker.company || me.broker.name} title={`${hi}, ${me.member.name.split(' ')[0]}`} sub={k.requests ? <>{k.requests} new request{k.requests === 1 ? '' : 's'} waiting for you · {k.open} jobs open</> : <>{k.open} jobs open</>}
      actions={<Link to={k.requests ? '/broker-portal/jobs?tab=requests' : '/broker-portal/jobs'} className="btn-gold">{k.requests ? `Review ${k.requests} new request${k.requests === 1 ? '' : 's'}` : 'Open jobs board'}</Link>}>
      {owner && <SetupCard />}
      <div className={`grid grid-cols-2 gap-3 lg:grid-cols-3 ${owner ? 'xl:grid-cols-6' : 'xl:grid-cols-4'}`} data-testid="bp-kpis">
        <Kpi label="Open jobs" value={k.open} hint={`${k.requests} new request${k.requests === 1 ? '' : 's'}`} tone={k.requests ? 'warn' : undefined} />
        <Kpi label="Cleared this month" value={k.doneMonth} hint={k.feesMonth != null ? `${usd(k.feesMonth)} in fees` : undefined} tone="good" />
        <Kpi label="Avg days to clear" value={k.avgClearDays ?? '—'} hint="request → handed over" />
        {k.outstanding != null && <Kpi label="Outstanding invoices" value={usd(k.outstanding)} hint="sent, not paid" tone={k.outstanding ? 'warn' : undefined} />}
        {k.unbilled != null && <Kpi label="Ready to bill" value={usd(k.unbilled)} hint="released or cleared, not invoiced" />}
        <Kpi label="Duty assessed this month" value={k.dutyMonth.length ? k.dutyMonth.map((x) => local(x.amount, x.currency)).join(' · ') : '—'} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Needs you" sub="New requests, jobs that haven’t moved for 3+ days, overdue invoices and unread messages." id="att-h">
          {d.attention.length ? <ul className="divide-y divide-border">{d.attention.map((a, i) => <li key={i}><Link to={a.jobId ? `/broker-portal/jobs/${a.jobId}` : a.link ?? '/broker-portal'} className="flex items-center gap-3 py-3 hover:bg-surface-2/50 focus-ring" data-testid="bp-attention">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${a.kind === 'request' ? 'bg-gold/20 text-gold-deep' : a.kind === 'message' ? 'bg-sky/10 text-sky' : 'bg-danger/10 text-danger'}`} aria-hidden="true">{a.kind === 'request' ? <Inbox size={16} /> : a.kind === 'message' ? <MessageSquare size={16} /> : a.kind === 'overdue' ? <AlertTriangle size={16} /> : <Clock size={16} />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.title}</span><span className="block truncate text-xs text-text-muted">{a.detail}</span></span>
            {a.age != null && <span className="shrink-0 text-xs text-text-muted">{a.age < 24 ? `${a.age} h` : `${Math.round(a.age / 24)} d`}</span>}<ChevronRight size={16} className="shrink-0 text-text-muted" aria-hidden="true" /></Link></li>)}</ul> : <Empty>All clear — nothing waiting on you.</Empty>}
        </Card>
        <Card title="Pipeline" sub="Open jobs by step" id="pipe-h">
          <ul className="space-y-3" data-testid="bp-pipeline">{d.pipeline.map((p) => <li key={p.step}><Link to={`/broker-portal/jobs?tab=all&step=${p.step}`} className="block focus-ring"><div className="mb-1 flex justify-between text-sm"><span className="text-text-muted">{p.label}</span><b className="tabular-nums">{p.n}</b></div><div className="h-2.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-gold" style={{ width: `${(p.n / maxPipe) * 100}%` }} /></div></Link></li>)}</ul>
        </Card>
      </div>
      <Card className="mt-6" title="Latest activity" actions={<Link to="/broker-portal/jobs" className="text-sm font-semibold text-gold-deep underline">All jobs</Link>} id="rec-h"><JobTable jobs={d.recent} /></Card>
    </Page>
  )
}

/** First weeks: the few things that make a new firm bookable and payable. Disappears once they're done. */
function SetupCard() {
  const { me } = useBp(); const b = me.broker
  const items: [boolean, string, string, string][] = [
    [Object.values(b.fees ?? {}).some((v) => v != null && Number(v) > 0), 'Set your fee per cargo', 'Shipping companies see it before they book you.', '/broker-portal/profile#pf-fees'],
    [!!b.settings.bank?.trim(), 'Add how you get paid', 'Bank or mobile money — printed on every invoice.', '/broker-portal/profile#pf-inv'],
    [!!b.about?.trim(), 'Write a line about your firm', 'Shown on your public listing.', '/broker-portal/profile#pf-list'],
    [!!b.licenceExpires, 'Add your licence expiry date', 'We remind you before it lapses.', '/broker-portal/profile#pf-avail'],
    [(me.counts.team ?? 1) > 1, 'Invite your team', 'Agents can work and message on jobs.', '/broker-portal/team'],
  ]
  const left = items.filter(([ok]) => !ok).length; if (!left) return null
  return (
    <Card className="mb-6" title="Get set up" sub={`${items.length - left} of ${items.length} done — jobs arrive when shipping companies book you from your listing.`} id="setup-h">
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="bp-setup">{items.map(([ok, t, d, to]) => <li key={t}><Link to={to} className={`flex h-full gap-2.5 rounded-xl border p-3 text-sm focus-ring ${ok ? 'border-border text-text-muted' : 'border-gold/50 bg-gold/5 hover:bg-gold/10'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${ok ? 'bg-teal text-white' : 'border-2 border-gold'}`} aria-hidden="true">{ok && <Check size={12} />}</span><span><b className={ok ? 'line-through' : ''}>{t}</b><span className="sr-only">{ok ? ' (done)' : ''}</span><span className="block text-xs text-text-muted">{d}</span></span></Link></li>)}</ul>
    </Card>
  )
}

/* ============================== Jobs board ============================== */
function JobTable({ jobs }: { jobs: BpJob[] }) {
  const nav = useNavigate()
  if (!jobs.length) return <Empty>No jobs here.</Empty>
  return (
    <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[820px] text-sm" data-testid="bp-job-table"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="px-3 py-3">Shipment</th><th className="px-3 py-3">Shipping company · customer</th><th className="px-3 py-3">Cargo</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3">At this step</th><th className="px-3 py-3">Assigned</th><th className="px-3 py-3 text-right">Fee</th></tr></thead>
        <tbody>{jobs.map((j) => <tr key={j.id} onClick={() => nav(`/broker-portal/jobs/${j.id}`)} className="cursor-pointer border-b border-border/70 hover:bg-surface-2/60" data-testid="bp-job-row">
          <td className="px-3 py-3"><Link to={`/broker-portal/jobs/${j.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-semibold text-gold-deep underline-offset-2 hover:underline">{j.shipmentRef}</Link>{(j.unread ?? 0) > 0 && <span className="ml-2 rounded-full bg-sky/15 px-1.5 text-xs font-semibold text-sky" aria-label={`${j.unread} unread messages`}><MessageSquare size={11} className="mr-0.5 inline" aria-hidden="true" />{j.unread}</span>}</td>
          <td className="px-3 py-3"><span className="font-medium">{j.shipperName}</span><span className="block text-xs text-text-muted">{j.customer}</span></td>
          <td className="px-3 py-3 capitalize">{j.cargo?.replace(/(\d+)/, ' $1ft')}</td>
          <td className="px-3 py-3"><Status s={j.status} /><div className="mt-1.5 w-36"><Steps status={j.status} /></div></td>
          <td className={`px-3 py-3 tabular-nums ${j.daysAtStep >= 3 && !['done', 'declined', 'cancelled'].includes(j.status) ? 'font-semibold text-danger' : ''}`}>{['done', 'declined', 'cancelled'].includes(j.status) ? '—' : j.daysAtStep < 1 ? `${Math.round(j.daysAtStep * 24)} h` : `${j.daysAtStep} d`}</td>
          <td className="px-3 py-3 text-text-muted">{j.assignedName ?? '—'}</td>
          <td className="px-3 py-3 text-right tabular-nums">{usd(j.feeUsd)}</td></tr>)}</tbody></table></div>
      <ul className="space-y-2 md:hidden">{jobs.map((j) => <li key={j.id}><Link to={`/broker-portal/jobs/${j.id}`} className="block rounded-xl border border-border bg-surface p-3 focus-ring" data-testid="bp-job-card"><div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold">{j.shipmentRef}</span><Status s={j.status} /></div><p className="mt-1 truncate text-sm">{j.shipperName} · {j.customer}</p><div className="mt-2"><Steps status={j.status} /></div><p className="mt-1.5 flex justify-between text-xs text-text-muted"><span>{j.assignedName ?? 'Unassigned'}{(j.unread ?? 0) > 0 ? ` · ${j.unread} new message${j.unread === 1 ? '' : 's'}` : ''}</span><span>{usd(j.feeUsd)}</span></p></Link></li>)}</ul>
    </>
  )
}
export function Jobs() {
  const [jobs, setJobs] = useState<BpJob[] | null>(null); const [err, setErr] = useState(''); const [sp, setSp] = useSearchParams()
  const step = sp.get('step') ?? ''; const [q, setQ] = useState('')
  const waiting = (jobs ?? []).some((j) => j.status === 'requested')
  // New requests come first when there are any; a step filter (from the pipeline) looks across every job.
  const tab = step ? 'all' : sp.get('tab') ?? (waiting ? 'requests' : 'active')
  useEffect(() => { bpApi.jobs().then(setJobs).catch((e) => setErr(errMsg(e))) }, [])
  const list = useMemo(() => (jobs ?? []).filter((j) => (tab === 'requests' ? j.status === 'requested' : tab === 'active' ? !['done', 'declined', 'cancelled', 'requested'].includes(j.status) : tab === 'cleared' ? j.status === 'done' : true) && (!step || j.status === step) && (!q.trim() || [j.shipmentRef, j.shipperName, j.customer, j.reference].join(' ').toLowerCase().includes(q.trim().toLowerCase()))), [jobs, tab, step, q])
  const count = (t: string) => (jobs ?? []).filter((j) => (t === 'requests' ? j.status === 'requested' : t === 'active' ? !['done', 'declined', 'cancelled', 'requested'].includes(j.status) : t === 'cleared' ? j.status === 'done' : true)).length
  return (
    <Page eyebrow="Jobs" title="Clearance jobs" sub="Every shipment you’ve been booked on, from request to hand-over.">
      <Err e={err} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border p-1" role="tablist" aria-label="Job filter">{[['requests', 'New requests'], ['active', 'In progress'], ['cleared', 'Cleared'], ['all', 'All']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${tab === k ? 'bg-gold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid={`bp-tab-${k}`}>{l} <span className="tabular-nums">{count(k)}</span></button>)}</div>
        {step && <button onClick={() => setSp({ tab: 'active' })} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-gold px-3 text-sm">{jobStepLabels[step as JobStep]} <X size={14} aria-label="Clear step filter" /></button>}
        <label className="relative ml-auto w-full sm:w-72"><span className="sr-only">Search jobs</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input className="input-dark !pl-9" placeholder="Search ref, company, customer, ICUMS no." value={q} onChange={(e) => setQ(e.target.value)} data-testid="bp-job-search" /></label>
      </div>
      <Card>{jobs ? <JobTable jobs={list} /> : <p className="text-text-muted">Loading…</p>}</Card>
    </Page>
  )
}

/* ============================== Job workspace ============================== */
const CURRENCIES = ['GHS', 'NGN', 'USD', 'XOF', 'EUR']
export function JobPage() {
  const { id = '' } = useParams(); const { me, reload: reloadMe } = useBp()
  const [d, setD] = useState<BpDetail | null>(null); const [err, setErr] = useState(''); const [toast, setToast] = useToast(); const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ note: '', reference: '', duty: '', currency: 'GHS' }); const [declining, setDeclining] = useState(false)
  const load = () => bpApi.job(id).then((x) => { setD(x); setForm((f) => ({ ...f, reference: x.job.reference, currency: x.job.dutyCurrency ?? (x.shipment.destination === 'NG' ? 'NGN' : 'GHS') })) }).catch((e) => setErr(errMsg(e)))
  useEffect(() => { void load(); void reloadMe() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Page title="Job"><Err e={err} />{!err && <p className="text-text-muted">Loading…</p>}</Page>
  const j = d.job; const s = d.shipment; const idx = JOB_STEPS.indexOf(j.status as JobStep); const next = idx >= 0 && idx < JOB_STEPS.length - 1 ? JOB_STEPS[idx + 1] : null
  const closed = ['done', 'declined', 'cancelled'].includes(j.status)
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); setErr(''); try { await fn(); setToast(ok); await load(); void reloadMe() } catch (e) { setErr(errMsg(e)) } finally { setBusy('') } }
  const move = (status: JobStep | 'declined') => act('step', () => bpApi.step(j.id, { status, note: form.note.trim() || undefined, reference: form.reference.trim() || undefined, dutyLocal: status === 'assessed' ? Number(form.duty) : undefined, dutyCurrency: status === 'assessed' ? form.currency : undefined }), status === 'declined' ? 'Declined — the shipping company was told.' : `Moved to “${jobStepLabels[status]}”. The shipping company and customer were told.`).then(() => { setForm((f) => ({ ...f, note: '', duty: '' })); setDeclining(false) })
  const checked = Object.values(j.checklist).filter(Boolean).length
  return (
    <Page eyebrow={<Link to="/broker-portal/jobs" className="inline-flex items-center gap-1 text-text-muted no-underline hover:text-text"><ArrowLeft size={14} aria-hidden="true" /> All jobs</Link>}
      title={`${s.ref} · ${s.cargoLabel}`} sub={<span className="flex flex-wrap items-center gap-2"><Status s={j.status} /> {j.shipperName} · for {s.customer} · {j.port || (s.destination === 'NG' ? 'Lagos' : 'Tema')}</span>}
      actions={<span className="text-right text-sm"><span className="block text-text-muted">Your fee</span><b className="text-xl tabular-nums">{usd(j.feeUsd)}</b></span>}>
      <Toast msg={toast} /><Err e={err} />
      {/* ---- stepper + next action ---- */}
      <Card className="mb-6" id="step-h">
        <ol className="grid grid-cols-7 gap-1" aria-label="Clearance steps">{JOB_STEPS.map((st, i) => { const at = j.timeline.find((t) => t.status === st)?.at; return <li key={st} className="min-w-0 text-center" aria-current={i === idx ? 'step' : undefined}><span className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${i < idx || j.status === 'done' ? 'bg-teal text-white' : i === idx ? 'bg-gold text-on-accent' : 'bg-surface-2 text-text-muted'}`}>{i < idx || j.status === 'done' ? <Check size={14} aria-hidden="true" /> : i + 1}</span><span className="mt-1 hidden truncate text-xs font-medium sm:block">{STEP_SHORT[st]}</span><span className="hidden text-[0.65rem] text-text-muted sm:block">{at ? shortDate(at) : ''}</span><span className="sr-only sm:hidden">{STEP_SHORT[st]}</span></li> })}</ol>
        <p className="mt-3 text-center text-sm sm:hidden" aria-hidden="true">{idx >= 0 ? <>Step {idx + 1} of {JOB_STEPS.length} · <b>{jobStepLabels[j.status as JobStep]}</b></> : <b>{j.status === 'declined' ? 'Declined' : 'Cancelled'}</b>}</p>
        {!closed && <div className="mt-5 rounded-xl border border-gold/50 bg-gold/5 p-4" data-testid="bp-next">
          {j.status === 'requested' ? <>
            <p className="font-semibold">New request from {j.shipperName}</p><p className="text-sm text-text-muted">Booked by {j.bookedBy}{j.notes ? ` — “${j.notes}”` : ''}. Accept to start, or decline so they can book someone else.</p>
            {!me.broker.accepting && <p className="mt-2 text-sm text-danger">You’ve set yourself to “not taking new jobs” — you can still accept this one.</p>}
            {declining ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><label className="sr-only" htmlFor="bp-decline">Reason</label><input id="bp-decline" className="input-dark" placeholder="Why? (they see this)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /><div className="flex gap-2"><button onClick={() => move('declined')} disabled={!!busy} className="btn-ghost !border-danger text-danger">Decline job</button><button onClick={() => setDeclining(false)} className="btn-ghost">Cancel</button></div></div>
              : <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => move('accepted')} disabled={!!busy} className="btn-gold" data-testid="bp-accept"><CheckCircle2 size={16} aria-hidden="true" /> Accept the job</button><button onClick={() => setDeclining(true)} className="btn-ghost">Decline…</button></div>}
          </> : next && <>
            <p className="font-semibold">Next: {jobStepLabels[next]}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {(next === 'documents' || next === 'assessed') && <div><label htmlFor="bp-ref" className="label-dark">Declaration / ICUMS ref</label><input id="bp-ref" className="input-dark font-mono" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. 40123-2026" data-testid="bp-ref" /></div>}
              {next === 'assessed' && <div><label htmlFor="bp-duty" className="label-dark">Duty assessed</label><div className="flex gap-2"><select aria-label="Currency" className="input-dark !w-24" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><input id="bp-duty" inputMode="decimal" className="input-dark tabular-nums" value={form.duty} onChange={(e) => setForm({ ...form, duty: e.target.value.replace(/[^\d.]/g, '') })} data-testid="bp-duty" /></div></div>}
              <div className={next === 'assessed' || next === 'documents' ? '' : 'md:col-span-2'}><label htmlFor="bp-note" className="label-dark">Note (optional — the shipper and customer see it)</label><input id="bp-note" className="input-dark" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => move(next)} disabled={!!busy || (next === 'assessed' && !Number(form.duty)) || (next === 'documents' && !form.reference.trim())} className="btn-gold" data-testid="bp-advance"><Check size={16} aria-hidden="true" /> Mark “{jobStepLabels[next]}”</button>{next === 'documents' && !form.reference.trim() && <span className="self-center text-sm text-text-muted" data-testid="bp-ref-needed">Add the declaration reference first — the shipper and customer see it.</span>}{j.dutyLocal != null && <span className="self-center text-sm text-text-muted">Duty assessed: <b>{local(j.dutyLocal, j.dutyCurrency ?? 'GHS')}</b></span>}</div>
          </>}
        </div>}
        {j.status === 'done' && <p className="mt-4 rounded-xl bg-teal/10 p-3 text-sm text-teal">Cleared and handed over {shortDate(j.timeline.find((t) => t.status === 'done')?.at ?? null)}. {d.invoices.length ? <>Billed on <Link to={`/broker-portal/invoices/${d.invoices[0].id}`} className="font-semibold underline">{d.invoices[0].number}</Link> ({d.invoices[0].status}).</> : me.member.role === 'owner' ? <Link to="/broker-portal/finance" className="font-semibold underline">Bill it from Finance</Link> : 'Not billed yet.'}</p>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card title="Shipment" id="sh-h">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-text-muted">Route</dt><dd>{s.origin} → {s.destination === 'NG' ? 'Nigeria' : 'Ghana'} · {s.mode}</dd></div>
              <div><dt className="text-text-muted">ETA</dt><dd>{s.eta ? shortDate(s.eta) : '—'} · {s.status.replace(/_/g, ' ')}</dd></div>
              <div className="sm:col-span-2"><dt className="text-text-muted">Goods</dt><dd>{s.description || '—'}</dd></div>
              <div><dt className="text-text-muted">Pieces</dt><dd>{s.pieces || '—'}{s.weightKg ? ` · ${s.weightKg} kg` : ''}</dd></div>
              <div><dt className="text-text-muted">Declared value</dt><dd>{s.declaredValueUsd ? usd(Number(s.declaredValueUsd)) : '—'}</dd></div>
              {d.vehicle && <div className="sm:col-span-2"><dt className="text-text-muted"><Car size={13} className="mr-1 inline" aria-hidden="true" />Vehicle</dt><dd>{d.vehicle.label}{d.vehicle.engineL ? ` · ${d.vehicle.engineL} L` : ''} · <span className="font-mono">{d.vehicle.vin}</span>{d.vehicle.valueUsd ? ` · ${usd(d.vehicle.valueUsd)}` : ''}</dd></div>}
              {d.container && <div className="sm:col-span-2"><dt className="text-text-muted"><Container size={13} className="mr-1 inline" aria-hidden="true" />Container</dt><dd className="font-mono">{d.container.number || '—'}{d.container.seal ? ` · seal ${d.container.seal}` : ''}<span className="font-sans"> · {d.container.vessel}{d.container.eta ? ` · ETA ${shortDate(d.container.eta)}` : ''}</span></dd></div>}
              {d.consignee && <div className="sm:col-span-2 rounded-lg bg-surface-2/60 p-3"><dt className="text-text-muted">Consignee</dt><dd><b>{d.consignee.name}</b>{d.consignee.phone && <a href={`tel:${d.consignee.phone.replace(/[^\d+]/g, '')}`} className="ml-2 inline-flex items-center gap-1 text-gold-deep underline"><Phone size={12} aria-hidden="true" />{d.consignee.phone}</a>}<span className="block text-text-muted">{[d.consignee.address, d.consignee.city].filter(Boolean).join(', ')}{d.consignee.gps ? ` · GPS ${d.consignee.gps}` : ''}</span></dd></div>}
            </dl>
          </Card>
          <Docs d={d} onDone={(m) => { setToast(m); void load() }} onErr={setErr} />
          <Charges d={d} onDone={(m) => { setToast(m); void load() }} onErr={setErr} />
          <Card title="Timeline" id="tl-h"><ol className="space-y-3 border-l-2 border-border pl-4">{[...j.timeline].reverse().map((t, i) => <li key={i} className="relative text-sm"><span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full bg-gold" aria-hidden="true" /><b>{jobStepLabels[t.status as JobStep] ?? t.status}</b> <span className="text-text-muted">· {new Date(t.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {t.by}</span>{t.note && <p className="text-text-muted">“{t.note}”</p>}</li>)}</ol></Card>
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Card title="Work" id="work-h">
            <label htmlFor="bp-assign" className="label-dark">Assigned to</label>
            <select id="bp-assign" className="input-dark" value={j.assignedTo ?? ''} onChange={(e) => act('assign', () => bpApi.patch(j.id, { assignedTo: e.target.value || null }), 'Assigned.')} data-testid="bp-assign"><option value="">— Nobody —</option>{d.team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.role === 'owner' ? ' (owner)' : ''}</option>)}</select>
            <p className="label-dark mt-4">Checklist <span className="font-normal text-text-muted">· {checked}/{d.checklistItems.length}</span></p>
            <ul className="space-y-1" data-testid="bp-checklist">{d.checklistItems.map((c) => <li key={c.key}><label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={!!j.checklist[c.key]} onChange={(e) => act('ck', () => bpApi.patch(j.id, { checklist: { ...j.checklist, [c.key]: e.target.checked } }), 'Checklist saved.')} className="h-4 w-4 accent-[var(--color-gold)]" />{c.label}</label></li>)}</ul>
          </Card>
          <Thread jobId={j.id} messages={d.messages} onSent={() => void load()} />
        </div>
      </div>
    </Page>
  )
}

function Docs({ d, onDone, onErr }: { d: BpDetail; onDone: (m: string) => void; onErr: (e: string) => void }) {
  const [title, setTitle] = useState('Assessment notice'); const [busy, setBusy] = useState(false)
  const open = async (id: string) => { try { const r = await bpApi.doc(id); if (!r.dataUrl) { onErr('This document is generated — open it from the shipment.'); return } openDataUrl(r.dataUrl, 'document') } catch (e) { onErr(errMsg(e)) } }
  return (
    <Card title="Documents" sub="Papers shared by the shipping company, and the ones you add (they go onto the shipment for the office and customer)." id="docs-h">
      {d.documents.length ? <ul className="divide-y divide-border text-sm">{d.documents.map((x) => <li key={x.id} className="flex items-center gap-3 py-2.5" data-testid="bp-doc"><FileText size={16} className="shrink-0 text-text-muted" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.title}</span><span className="block text-xs text-text-muted">{x.byBroker ? 'Added by you' : 'From the shipping company'} · {shortDate(x.at)}</span></span>{x.hasFile ? <button onClick={() => open(x.id)} className="btn-ghost !min-h-9 !px-3 text-xs"><ExternalLink size={13} aria-hidden="true" /> Open</button> : <span className="text-xs text-text-muted">generated</span>}</li>)}</ul> : <Empty>No documents yet.</Empty>}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1"><label htmlFor="bp-doc-title" className="label-dark">Add a paper</label><select id="bp-doc-title" className="input-dark" value={title} onChange={(e) => setTitle(e.target.value)}>{['Assessment notice', 'Customs declaration', 'Duty receipt', 'Release order', 'Examination report', 'Gate pass / waybill', 'Permit', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></div>
        <label className={`btn-gold cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-deep has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-bg ${busy ? 'opacity-60' : ''}`}><Upload size={15} aria-hidden="true" /> {busy ? 'Uploading…' : 'Upload PDF or photo'}<input type="file" accept="application/pdf,image/*" className="sr-only" disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 4_000_000) { onErr('Keep files under 4 MB.'); return } setBusy(true); try { await bpApi.addDoc(d.job.id, { title, kind: title === 'Duty receipt' ? 'receipt' : 'customs', dataUrl: await fileToDataUrl(f), filename: f.name }); onDone(`${title} added to the shipment.`) } catch (er) { onErr(errMsg(er)) } finally { setBusy(false); e.target.value = '' } }} data-testid="bp-doc-file" /></label>
      </div>
    </Card>
  )
}

function Charges({ d, onDone, onErr }: { d: BpDetail; onDone: (m: string) => void; onErr: (e: string) => void }) {
  const [f, setF] = useState({ kind: 'port', description: '', amount: '', currency: d.shipment.destination === 'NG' ? 'NGN' : 'GHS', rebill: true }); const [open, setOpen] = useState(false)
  const total = d.charges.reduce((n, c) => n + c.amountUsd, 0); const [sure, setSure] = useState<string | null>(null)
  return (
    <Card title="Disbursements & charges" sub="Money you paid out on this job (port, storage, haulage…). Rebillable ones go on your invoice at cost." id="ch-h" actions={!open ? <button onClick={() => setOpen(true)} className="btn-ghost !min-h-10 text-sm" data-testid="bp-add-charge"><Plus size={14} aria-hidden="true" /> Add</button> : null}>
      {d.charges.length ? <ul className="divide-y divide-border text-sm">{d.charges.map((c) => <li key={c.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1"><span className="block font-medium">{c.label}{c.description ? ` — ${c.description}` : ''}</span><span className="block text-xs text-text-muted">{c.by} · {shortDate(c.at)}{c.rebill ? '' : ' · not rebilled'}{c.invoiceId ? ' · invoiced' : ''}</span></span><span className="text-right tabular-nums">{local(c.amount, c.currency)}{c.currency !== 'USD' && <span className="block text-xs text-text-muted">≈ {usd(c.amountUsd)}</span>}</span>{!c.invoiceId && (sure === c.id
          ? <span className="flex gap-1"><button onClick={async () => { try { await bpApi.delCharge(c.id); setSure(null); onDone(`Removed ${c.label.toLowerCase()} — ${local(c.amount, c.currency)}.`) } catch (e) { onErr(errMsg(e)) } }} className="btn-ghost !min-h-9 !border-danger !px-2.5 text-xs text-danger" data-testid="bp-charge-remove-yes">Remove</button><button onClick={() => setSure(null)} className="btn-ghost !min-h-9 !px-2.5 text-xs">Keep</button></span>
          : <button onClick={() => setSure(c.id)} className="grid h-9 w-9 place-items-center rounded-md text-text-muted hover:text-danger" aria-label={`Remove ${c.label}`}><Trash2 size={14} /></button>)}</li>)}<li className="flex justify-between py-2 font-semibold"><span>Total</span><span className="tabular-nums">≈ {usd(total)}</span></li></ul> : !open && <Empty>Nothing recorded.</Empty>}
      {open && <form onSubmit={async (e) => { e.preventDefault(); try { await bpApi.addCharge(d.job.id, { kind: f.kind, description: f.description, amount: Number(f.amount), currency: f.currency, rebill: f.rebill }); setOpen(false); setF({ ...f, description: '', amount: '' }); onDone('Charge recorded.') } catch (er) { onErr(errMsg(er)) } }} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="bp-charge-form">
        <div><label htmlFor="ch-kind" className="label-dark">Type</label><select id="ch-kind" className="input-dark" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(d.chargeKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="ch-desc" className="label-dark">Description</label><input id="ch-desc" className="input-dark" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. MPS terminal handling" /></div>
        <div><label htmlFor="ch-amt" className="label-dark">Amount</label><div className="flex gap-2"><select aria-label="Currency" className="input-dark !w-24" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><input id="ch-amt" required inputMode="decimal" className="input-dark tabular-nums" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} data-testid="ch-amount" /></div></div>
        <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" checked={f.rebill} onChange={(e) => setF({ ...f, rebill: e.target.checked })} className="h-4 w-4" /> Bill this to the shipping company</label>
        <div className="flex gap-2 sm:col-span-2"><button className="btn-gold" data-testid="ch-save">Save charge</button><button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button></div>
      </form>}
    </Card>
  )
}

export function Thread({ jobId, messages, onSent, title = 'Messages with the shipping company' }: { jobId: string; messages: BpDetail['messages']; onSent: () => void; title?: string }) {
  const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const box = useRef<HTMLDivElement>(null)
  // Show the newest message by scrolling the thread box itself — never the page (it used to drag the job page down to the chat).
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [messages.length])
  return (
    <Card title={title} sub="The office gets a notification; customers can read and write here too." id="msg-h">
      <div ref={box} className="max-h-[420px] space-y-2 overflow-y-auto pr-1" aria-live="polite" data-testid="bp-thread" tabIndex={0} role="region" aria-label="Message history">
        {messages.length ? messages.map((m) => <div key={m.id} className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.side === 'broker' ? 'ml-auto bg-gold/15' : m.side === 'customer' ? 'bg-sky/10' : 'bg-surface-2'}`}><p className="text-xs text-text-muted">{m.from}{m.side === 'customer' ? ' (customer)' : ''} · {ago(m.at)}</p><p className="whitespace-pre-line">{m.body}</p></div>) : <Empty>No messages yet.</Empty>}
      </div>
      <Err e={err} />
      <form onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; setBusy(true); setErr(''); try { await bpApi.send(jobId, body.trim()); setBody(''); onSent() } catch (er) { setErr(errMsg(er)) } finally { setBusy(false) } }} className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`bp-msg-${jobId}`}>Message</label><textarea id={`bp-msg-${jobId}`} rows={2} className="input-dark flex-1 py-2" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ask for a document, give an update…" data-testid="bp-msg-body" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit() }} /><button disabled={busy || !body.trim()} className="btn-gold self-end" aria-label="Send message" data-testid="bp-msg-send"><Send size={16} aria-hidden="true" /></button></form>
    </Card>
  )
}

