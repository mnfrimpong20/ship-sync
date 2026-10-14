/** Admin consoles: platform analytics, marketplace health, scorecards, risk, messaging, billing, announcements, audit, support (view as), feature switches. */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, DollarSign, Eye, Gauge, Inbox, Mail, Megaphone, RefreshCw, Search, ShieldAlert, Ship, Users } from 'lucide-react'
import { adminConsoleApi } from '../lib/platform'
import type { Kpi } from '../lib/analytics'
import { money, fmtDate, fmtDateTime } from './ui'
import { C, DataTable, HBars, NoData, Panel, Stat, Trend } from './Charts'
import { AuditTable } from './AuditTable'

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>
const pc = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const compact = (v: number) => (v >= 10000 ? `$${Math.round(v / 1000)}k` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
function Range({ days, set }: { days: number; set: (n: number) => void }) {
  return <div role="radiogroup" aria-label="Period" className="flex rounded-xl border border-border bg-surface p-1">{[30, 90, 180, 365].map((n) => <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => set(n)} className={`rounded-lg px-3 py-1.5 text-sm focus-ring ${days === n ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted hover:text-text'}`}>{n === 365 ? '12 mo' : `${n} d`}</button>)}</div>
}
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [d, setD] = useState<T | null>(null); const [err, setErr] = useState('')
  const reload = () => fn().then(setD).catch((e) => setErr(e.message))
  useEffect(() => { void reload() }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return { d, err, reload }
}
const Err = ({ e }: { e: string }) => (e ? <p role="alert" className="text-sm text-danger">{e}</p> : null)
const cls = 'input-dark !min-h-10 text-sm'

/* ---------------- platform analytics ---------------- */
export function AdminPlatform() {
  const [days, setDays] = useState(90); const { d, err } = useLoad(() => adminConsoleApi.platform(days), [days])
  const k = (d?.kpis ?? {}) as Record<string, any>
  return (
    <div className="space-y-6" data-testid="admin-platform">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">The whole marketplace. Compared with the {days} days before.</p><Range days={days} set={setDays} /></div>
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Value booked (GMV)" value={money(k.gmv.value)} kpi={k.gmv as Kpi} icon={DollarSign} />
          <Stat label="Ship Sync revenue" value={money(k.fees.value)} kpi={k.fees as Kpi} icon={DollarSign} hint={`MRR ${money(k.mrr)}`} />
          <Stat label="Requests" value={k.requests.value} kpi={k.requests as Kpi} icon={Inbox} hint={`${k.quotesPerRequest ?? '—'} quotes each · first in ${k.hoursToFirstQuote ?? '—'} h`} />
          <Stat label="Request → booking" value={pc(k.conversionPct.value)} kpi={k.conversionPct as Kpi} icon={Gauge} hint={`${k.bookings.value} bookings`} />
          <Stat label="New customers" value={k.newCustomers.value} kpi={k.newCustomers as Kpi} icon={Users} />
          <Stat label="Returning customers" value={pc(k.returningPct)} icon={RefreshCw} hint={`of ${k.activeCustomers} who booked`} />
          <Stat label="New shippers" value={k.newShippers.value} kpi={k.newShippers as Kpi} icon={Ship} />
          <Stat label="Bookings" value={k.bookings.value} kpi={k.bookings as Kpi} icon={CheckCircle2} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Requests and bookings" sub={`Per ${d.period.bucket}`}><Trend data={d.series} bucket={d.period.bucket} label="Requests and bookings" series={[{ key: 'requests', label: 'Requests', color: C.context }, { key: 'bookings', label: 'Bookings', color: C.focus }]} /></Panel>
          <Panel title="Value booked" sub={`Per ${d.period.bucket}`}><Trend data={d.series} bucket={d.period.bucket} label="GMV" format={compact} series={[{ key: 'gmv', label: 'GMV', color: C.focus }]} /></Panel>
          <Panel title="Sign-ups" sub={`Per ${d.period.bucket}`}><Trend data={d.series} bucket={d.period.bucket} label="New customers and shippers" series={[{ key: 'customers', label: 'Customers', color: C.focus }, { key: 'shippers', label: 'Shippers', color: C.alt }]} /></Panel>
          <Panel title="Where Ship Sync’s revenue comes from"><HBars label="Revenue by stream" rows={d.feesBreakdown.map((f: R) => ({ label: f.label, value: f.amount, display: money(f.amount) }))} /></Panel>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Conversion by destination" testid="conv-dest"><DataTable rows={d.byDestination} csvName="conversion-by-destination.csv" initialSort="requests" cols={[{ key: 'label', label: 'Destination' }, { key: 'requests', label: 'Requests', align: 'right' }, { key: 'quotedPct', label: 'Got a quote', align: 'right', format: (v) => pc(v as number) }, { key: 'bookedPct', label: 'Booked', align: 'right', format: (v) => pc(v as number) }]} /></Panel>
          <Panel title="Conversion by source"><DataTable rows={d.bySource} csvName="conversion-by-source.csv" initialSort="requests" cols={[{ key: 'label', label: 'Source' }, { key: 'requests', label: 'Requests', align: 'right' }, { key: 'quotedPct', label: 'Got a quote', align: 'right', format: (v) => pc(v as number) }, { key: 'bookedPct', label: 'Booked', align: 'right', format: (v) => pc(v as number) }]} /></Panel>
        </div>
      </>}
    </div>
  )
}

/* ---------------- marketplace health ---------------- */
const FLAG = { recruit: ['Recruit shippers', 'text-danger bg-danger/10'], unanswered: ['Requests go unanswered', 'text-danger bg-danger/10'], thin: ['Few quotes', 'text-gold-deep bg-gold/15'] } as const
export function AdminMarketplace() {
  const [days, setDays] = useState(90); const { d, err } = useLoad(() => adminConsoleApi.marketplace(days), [days])
  return (
    <div className="space-y-6" data-testid="admin-marketplace">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">Demand vs supply by lane. Gaps are where to recruit shippers.</p><Range days={days} set={setDays} /></div>
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Requests" value={d.kpis.requests} icon={Inbox} /><Stat label="Got no quote" value={pc(d.kpis.unansweredPct)} icon={AlertTriangle} tone={(d.kpis.unansweredPct ?? 0) > 15 ? 'bad' : undefined} />
          <Stat label="Quotes per request" value={d.kpis.quotesPerRequest ?? '—'} icon={Gauge} /><Stat label="Lanes with a gap" value={d.kpis.gaps} hint={`of ${d.kpis.lanes} lanes · ${d.kpis.activeShippers} shippers`} icon={Ship} tone={d.kpis.gaps ? 'bad' : undefined} />
        </div>
        {d.gaps.length > 0 && <Panel title="Gaps to fix" testid="gaps"><ul className="grid gap-3 md:grid-cols-2">{d.gaps.map((g: R) => <li key={g.key} className="rounded-xl border border-border p-4"><p className="flex items-center justify-between gap-2"><b>{g.label}</b><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${FLAG[g.flag as keyof typeof FLAG][1]}`}>{FLAG[g.flag as keyof typeof FLAG][0]}</span></p><p className="mt-1 text-sm text-text-muted">{g.requests} requests · {g.shippers} shippers serve it ({g.localShippers} pick up in {g.origin}) · {pc(g.unansweredPct)} unanswered · {g.quotesPerRequest} quotes each</p></li>)}</ul></Panel>}
        <Panel title="Lanes" testid="lanes"><DataTable rows={d.lanes} csvName="marketplace-lanes.csv" initialSort="requests" cols={[{ key: 'label', label: 'Lane' }, { key: 'requests', label: 'Requests', align: 'right' }, { key: 'shippers', label: 'Shippers', align: 'right' }, { key: 'localShippers', label: 'Local', align: 'right' }, { key: 'demandPerShipper', label: 'Req / shipper', align: 'right' }, { key: 'quotesPerRequest', label: 'Quotes / req', align: 'right' }, { key: 'unansweredPct', label: 'Unanswered', align: 'right', format: (v) => <span className={(v as number) >= 30 ? 'text-danger' : ''}>{pc(v as number)}</span> }, { key: 'hoursToFirstQuote', label: 'First quote', align: 'right', format: (v) => (v == null ? '—' : `${v} h`) }, { key: 'bookedPct', label: 'Booked', align: 'right', format: (v) => pc(v as number) }]} /></Panel>
        <Panel title="Destinations"><HBars label="Requests by destination" rows={d.destinations.map((x: R) => ({ label: x.label, value: x.requests, note: `${x.shippers} shippers · ${pc(x.unansweredPct)} unanswered` }))} /></Panel>
      </>}
    </div>
  )
}

/* ---------------- shipper scorecards ---------------- */
const TIER = { top: 'text-teal', good: '', watch: 'text-gold-deep', at_risk: 'text-danger', new: 'text-text-muted' } as const
export function AdminScorecards() {
  const { d, err, reload } = useLoad(() => adminConsoleApi.scorecards(), [])
  const [q, setQ] = useState(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('q') ?? ''); const [edit, setEdit] = useState<R | null>(null); const [rules, setRules] = useState<R | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { if (d) setRules(d.rules) }, [d])
  const rows = (d?.cards ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())).map((c): R => ({ ...c, onTime: c.metrics.onTimePct, reply: c.metrics.replyMedianH, rating: c.metrics.rating, disputes: c.metrics.disputePct, cancels: c.metrics.cancelPct, withdraws: c.metrics.withdrawPct, win: c.metrics.winRatePct }))
  return (
    <div className="space-y-6" data-testid="admin-scorecards">
      <p className="text-sm text-text-muted">90-day quality score (0–100): reply speed 20, on time 25, rating 20, disputes 10, cancellations 10, withdrawn quotes 5, win rate 10. It feeds directory ranking. Below the warning line the shipper is warned, below probation they get a probation badge and rank lower; pausing is always a human decision.</p>
      <Err e={err} />
      {rules && <Panel title="Standing rules"><div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={rules.auto} onChange={(e) => setRules({ ...rules, auto: e.target.checked })} /> Apply warning / probation automatically</label>
        {(['warn', 'probation', 'pause'] as const).map((k) => <label key={k}><span className="label-dark">{k === 'warn' ? 'Warn below' : k === 'probation' ? 'Probation below' : 'Suggest pause below'}</span><input type="number" min={0} max={100} className={`${cls} !w-24`} value={rules[k]} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} /></label>)}
        <button type="button" className="btn-ghost !min-h-10" onClick={async () => { await adminConsoleApi.setRules(rules); reload() }}>Save rules</button>
        <button type="button" disabled={busy} className="btn-ghost !min-h-10" onClick={async () => { setBusy(true); await adminConsoleApi.recompute(); await reload(); setBusy(false) }} data-testid="recompute"><RefreshCw size={14} aria-hidden="true" /> Recompute now</button>
      </div></Panel>}
      <Panel title="Shippers" actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a shipper" className={`${cls} !w-48`} />} testid="score-table">
        {d ? <DataTable rows={rows} limit={25} csvName="shipper-scorecards.csv" initialSort="score" cols={[
          { key: 'name', label: 'Shipper', format: (v, r) => <span>{String(v)}{r.demo ? <span className="ml-1 text-[10px] text-text-muted">demo</span> : null}</span> },
          { key: 'score', label: 'Score', align: 'right', format: (v, r) => (v == null ? <span className="text-text-muted">new</span> : <b className={TIER[r.tier as keyof typeof TIER]}>{String(v)}</b>) },
          { key: 'rank', label: 'Rank', align: 'right', format: (v, r) => (v ? `${v}/${r.of}` : '—') },
          { key: 'reply', label: 'Reply', align: 'right', format: (v) => (v == null ? '—' : `${v} h`) }, { key: 'onTime', label: 'On time', align: 'right', format: (v) => pc(v as number) },
          { key: 'rating', label: 'Rating', align: 'right' }, { key: 'disputes', label: 'Disputes', align: 'right', format: (v) => pc(v as number) }, { key: 'cancels', label: 'Cancels', align: 'right', format: (v) => pc(v as number) }, { key: 'withdraws', label: 'Withdrawn', align: 'right', format: (v) => pc(v as number) },
          { key: 'standing', label: 'Standing', format: (v, r) => <button type="button" onClick={() => setEdit({ id: r.id, name: r.name, standing: v, note: r.note, lock: r.locked })} className={`rounded px-2 py-0.5 text-xs font-semibold focus-ring ${v === 'good' ? 'bg-teal/10 text-teal' : v === 'warning' ? 'bg-gold/15 text-gold-deep' : 'bg-danger/10 text-danger'}`} data-testid="standing-btn">{String(v)}{r.locked ? ' 🔒' : ''}</button> },
        ]} /> : <NoData>Loading…</NoData>}
      </Panel>
      {edit && <Panel title={`Standing — ${edit.name}`} testid="standing-edit"><div className="space-y-3 text-sm">
        <div role="radiogroup" className="flex flex-wrap gap-1.5">{['good', 'warning', 'probation', 'paused'].map((s) => <button key={s} type="button" role="radio" aria-checked={edit.standing === s} onClick={() => setEdit({ ...edit, standing: s })} className={`rounded-full border px-3 py-1 focus-ring ${edit.standing === s ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`st-${s}`}>{s}</button>)}</div>
        <textarea rows={2} className="input-dark text-sm" placeholder="Note to the shipper (they see this)" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={edit.lock} onChange={(e) => setEdit({ ...edit, lock: e.target.checked })} /> Lock — don’t let the automatic rules change it</label>
        {edit.standing === 'paused' && <p className="text-danger">Paused shippers disappear from the directory and stop receiving requests. Existing shipments carry on.</p>}
        <div className="flex gap-2"><button type="button" className="btn-gold !min-h-10" onClick={async () => { await adminConsoleApi.setStanding(edit.id, { standing: edit.standing, note: edit.note, lock: edit.lock }); setEdit(null); reload() }} data-testid="standing-save">Save</button><button type="button" className="btn-ghost !min-h-10" onClick={() => setEdit(null)}>Close</button></div>
      </div></Panel>}
    </div>
  )
}

/* ---------------- risk ---------------- */
export function AdminRisk() {
  const { d, err, reload } = useLoad(() => adminConsoleApi.risk(), [])
  const sev = { high: 'border-l-danger', medium: 'border-l-gold', low: 'border-l-sky' } as const
  return (
    <div className="space-y-6" data-testid="admin-risk">
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-3 gap-3"><Stat label="High" value={d.counts.high} icon={ShieldAlert} tone={d.counts.high ? 'bad' : undefined} /><Stat label="Medium" value={d.counts.medium} icon={AlertTriangle} /><Stat label="Low" value={d.counts.low} icon={Eye} /></div>
        {d.flags.length ? <ul className="grid gap-3 md:grid-cols-2">{d.flags.map((f) => (
          <li key={f.key} className={`rounded-xl border border-border border-l-4 ${sev[f.severity as keyof typeof sev]} bg-surface p-4`} data-testid="risk-flag">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{f.severity} · {f.kind}</p>
            <p className="mt-1 font-semibold">{f.title}</p><p className="mt-1 text-sm text-text-muted">{f.detail}</p>
            <div className="mt-2 flex gap-3 text-sm"><a href={`#${f.link}`} className="font-semibold text-gold-deep hover:underline">Look into it</a><button type="button" className="text-text-muted hover:text-text" onClick={async () => { const note = prompt('Why is this OK? (kept in the log)') ?? ''; await adminConsoleApi.dismissRisk(f.key, note); reload() }} data-testid="risk-dismiss">Dismiss</button></div>
          </li>
        ))}</ul> : <NoData>No risk signals right now.</NoData>}
      </>}
    </div>
  )
}

/* ---------------- messaging ---------------- */
export function AdminMessaging() {
  const [days, setDays] = useState(30); const { d, err, reload } = useLoad(() => adminConsoleApi.messaging(days), [days]); const [c, setC] = useState<R | null>(null)
  useEffect(() => { if (d) setC(d.costs) }, [d])
  return (
    <div className="space-y-6" data-testid="admin-messaging">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">{d ? `Email: ${d.providers.email} · SMS: ${d.providers.sms} · WhatsApp: ${d.providers.whatsapp}` : ''}</p><Range days={days} set={setDays} /></div>
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{d.channels.map((ch: R) => <Stat key={ch.channel} label={ch.channel === 'sms' ? 'SMS' : ch.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} value={ch.sent} icon={Mail} hint={`${ch.failed} failed (${pc(ch.failRatePct)}) · ${ch.pending} waiting · $${ch.cost}`} tone={(ch.failRatePct ?? 0) > 10 ? 'bad' : undefined} />)}<Stat label="Estimated cost" value={`$${d.totalCost}`} icon={DollarSign} /></div>
        <Panel title="Sent and failed per week"><Trend data={d.series} bucket="week" stacked label="Messages sent and failed" series={[{ key: 'sent', label: 'Sent', color: C.focus }, { key: 'failed', label: 'Failed', color: C.bad }]} /></Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="By message type"><DataTable rows={d.byKind} csvName="messages-by-type.csv" initialSort="total" cols={[{ key: 'channel', label: 'Channel' }, { key: 'kind', label: 'Type', format: (v) => String(v).replace(/_/g, ' ').replace('recipient:', 'recipient · ') }, { key: 'total', label: 'Total', align: 'right' }, { key: 'failed', label: 'Failed', align: 'right' }, { key: 'failRatePct', label: 'Fail rate', align: 'right', format: (v) => <span className={(v as number) > 10 ? 'text-danger' : ''}>{pc(v as number)}</span> }]} /></Panel>
          <Panel title="Bouncing addresses and numbers" testid="bounced">{d.bounced.length ? <DataTable rows={d.bounced} csvName="bounced.csv" cols={[{ key: 'to', label: 'To' }, { key: 'channel', label: 'Channel' }, { key: 'failures', label: 'Fails', align: 'right' }, { key: 'lastError', label: 'Last error', format: (v) => <span className="text-xs text-text-muted">{String(v || '—').slice(0, 80)}</span> }, { key: 'lastAt', label: 'Last', format: (v) => fmtDate(String(v)) }]} /> : <NoData>No failures in this period.</NoData>}</Panel>
        </div>
        {c && <Panel title="Cost per message (USD)"><div className="flex flex-wrap items-end gap-3 text-sm">{[['email', 'Email'], ['sms', 'SMS (US/CA)'], ['smsIntl', 'SMS (international)'], ['whatsapp', 'WhatsApp']].map(([k, l]) => <label key={k}><span className="label-dark">{l}</span><input type="number" step="0.0001" min={0} className={`${cls} !w-28`} value={c[k]} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })} /></label>)}<button type="button" className="btn-ghost !min-h-10" onClick={async () => { await adminConsoleApi.setMessagingCosts(c); reload() }}>Save</button></div></Panel>}
      </>}
    </div>
  )
}

/* ---------------- billing ---------------- */
export function AdminBilling() {
  const { d, err, reload } = useLoad(() => adminConsoleApi.billing(), []); const [prices, setPrices] = useState<R | null>(null); const [edit, setEdit] = useState<R | null>(null); const [q, setQ] = useState('')
  useEffect(() => { if (d) setPrices(d.prices) }, [d])
  return (
    <div className="space-y-6" data-testid="admin-billing">
      <Err e={err} />
      {d && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="MRR" value={money(d.mrr)} icon={DollarSign} hint={`ARR ${money(d.arr)}`} /><Stat label="Paying shippers" value={d.paying} icon={Users} /><Stat label="On a trial" value={d.trials} icon={Gauge} hint={`${d.trialsEndingSoon} end within 7 days`} /><Stat label="Cancellations (30 d)" value={d.churn30} icon={AlertTriangle} hint={`${d.upgrades30} plan changes`} tone={d.churn30 ? 'bad' : undefined} /></div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="By plan"><HBars label="MRR by plan" rows={d.byPlan.map((p: R) => ({ label: `${p.label} · ${p.shippers}`, value: p.mrr, display: money(p.mrr) }))} /></Panel>
          {prices && <Panel title="Prices (per month)" sub={d.online ? 'Card billing through Stripe is on.' : 'Stripe isn’t configured — set plans by hand below.'}><div className="flex flex-wrap items-end gap-3 text-sm">{['pro', 'enterprise'].map((k) => <label key={k}><span className="label-dark">{k === 'pro' ? 'Pro' : 'Enterprise'}</span><input type="number" min={0} className={`${cls} !w-28`} value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: Number(e.target.value) })} /></label>)}<button type="button" className="btn-ghost !min-h-10" onClick={async () => { await adminConsoleApi.setPrices({ pro: prices.pro, enterprise: prices.enterprise }); reload() }}>Save prices</button></div></Panel>}
        </div>
        <Panel title="Shippers" actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a shipper" className={`${cls} !w-48`} />} testid="billing-list"><DataTable<R> rows={d.list.filter((x: R) => !q || x.name.toLowerCase().includes(q.toLowerCase()))} limit={20} csvName="billing.csv" initialSort="mrr" cols={[
          { key: 'name', label: 'Shipper' }, { key: 'plan', label: 'Plan', format: (v, r) => <span>{String(v)}{r.trial ? <span className="ml-1 text-xs text-gold-deep">trial{r.trialEndsAt ? ` → ${fmtDate(r.trialEndsAt)}` : ''}</span> : null}</span> },
          { key: 'status', label: 'Status', format: (v, r) => <span>{String(v)}{r.cancelAtPeriodEnd ? ' · cancels' : ''}</span> }, { key: 'provider', label: 'Billing' }, { key: 'team', label: 'Team', align: 'right' }, { key: 'mrr', label: 'MRR', align: 'right', format: (v) => money(v as number) },
          { key: 'id', label: '', format: (_v, r) => <button type="button" onClick={() => setEdit({ id: r.id, name: r.name, plan: r.plan, trialDays: '', note: '' })} className="text-xs font-semibold text-gold-deep hover:underline" data-testid="billing-edit">Change</button> },
        ]} /></Panel>
        {edit && <Panel title={`Plan — ${edit.name}`} testid="billing-edit-form"><div className="flex flex-wrap items-end gap-3 text-sm">
          <label><span className="label-dark">Plan</span><select className={`${cls} !w-40`} value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value })}><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label>
          <label><span className="label-dark">Trial days (optional)</span><input type="number" min={0} className={`${cls} !w-28`} value={edit.trialDays} onChange={(e) => setEdit({ ...edit, trialDays: e.target.value })} /></label>
          <label className="flex-1"><span className="label-dark">Note</span><input className={cls} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="e.g. comped for launch partners" /></label>
          <button type="button" className="btn-gold !min-h-10" onClick={async () => { await adminConsoleApi.setPlan(edit.id, { plan: edit.plan, note: edit.note, ...(edit.trialDays !== '' ? { trialDays: Number(edit.trialDays) } : {}) }); setEdit(null); reload() }} data-testid="billing-save">Save</button>
        </div></Panel>}
      </>}
    </div>
  )
}

/* ---------------- announcements ---------------- */
export function AdminAnnouncements() {
  const { d, err, reload } = useLoad(() => adminConsoleApi.announcements(), [])
  const [f, setF] = useState({ title: '', body: '', audience: 'all', destination: '', level: 'info', link: '', endsAt: '', notify: false }); const [msg, setMsg] = useState('')
  const save = async (e: React.FormEvent) => { e.preventDefault(); setMsg(''); try { const r = await adminConsoleApi.addAnnouncement({ ...f, destination: f.destination || null, endsAt: f.endsAt ? new Date(f.endsAt + 'T23:59:00').toISOString() : null }); setMsg(`Posted${r.notified ? ` · ${r.notified} people notified` : ''}.`); setF({ ...f, title: '', body: '' }); reload() } catch (x) { setMsg(x instanceof Error ? x.message : 'Failed') } }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-testid="admin-announcements">
      <Panel title="New announcement"><form onSubmit={save} className="space-y-3 text-sm">
        <input required className={cls} placeholder="Title, e.g. Port strike in Tema" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="ann-title" />
        <textarea rows={3} className="input-dark text-sm" placeholder="What people need to know" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="ann-body" />
        <div className="grid grid-cols-2 gap-3">
          <label><span className="label-dark">Who</span><select className={cls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} data-testid="ann-audience"><option value="all">Everyone</option><option value="shippers">Shippers</option><option value="customers">Customers</option></select></label>
          <label><span className="label-dark">Only for destination</span><select className={cls} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}><option value="">Any</option>{['GH', 'NG', 'LR', 'SL', 'TG', 'CI', 'SN'].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label><span className="label-dark">Level</span><select className={cls} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} data-testid="ann-level"><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
          <label><span className="label-dark">Ends</span><input type="date" className={cls} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>
        </div>
        <input className={cls} placeholder="Link (optional) — /dashboard/… or https://…" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Also send it as a notification (and email, per people’s settings)</label>
        {msg && <p role="status" className="text-teal" data-testid="ann-msg">{msg}</p>}
        <button className="btn-gold !min-h-10" data-testid="ann-post"><Megaphone size={15} aria-hidden="true" /> Post</button>
      </form></Panel>
      <Panel title="Announcements"><Err e={err} />{d?.length ? <ul className="divide-y divide-border text-sm">{d.map((a) => <li key={a.id} className="py-3" data-testid="ann-row"><p className="flex items-center justify-between gap-2"><b>{a.title}</b><span className={`rounded px-2 py-0.5 text-[11px] ${a.active ? 'bg-teal/10 text-teal' : 'bg-surface-2 text-text-muted'}`}>{a.active ? 'Live' : 'Off'}</span></p><p className="text-text-muted">{a.body}</p><p className="mt-1 text-xs text-text-muted">{a.audience}{a.destination ? ` · ${a.destination}` : ''} · {a.level} · {a.createdAt ? fmtDateTime(a.createdAt) : ''}{a.endsAt ? ` → ${fmtDate(a.endsAt)}` : ''} · dismissed by {a.dismissals ?? 0}</p><div className="mt-1 flex gap-3 text-xs"><button type="button" className="hover:underline" onClick={async () => { await adminConsoleApi.updateAnnouncement(a.id, { active: !a.active }); reload() }}>{a.active ? 'Take down' : 'Put back up'}</button><button type="button" className="text-danger hover:underline" onClick={async () => { await adminConsoleApi.deleteAnnouncement(a.id); reload() }}>Delete</button></div></li>)}</ul> : <NoData>No announcements yet.</NoData>}</Panel>
    </div>
  )
}

/* ---------------- audit & support ---------------- */
export function AdminAudit() { return <Panel title="Audit log" sub="Every change by every person, including actions taken while an admin was viewing as someone."><AuditTable admin /></Panel> }
export function AdminSupport() {
  const [q, setQ] = useState(''); const [users, setUsers] = useState<R[]>([]); const [err, setErr] = useState('')
  useEffect(() => { const t = setTimeout(() => { if (q.trim().length >= 2) adminConsoleApi.users(q).then(setUsers).catch((e) => setErr(e.message)); else setUsers([]) }, 250); return () => clearTimeout(t) }, [q])
  const go = async (id: string) => { setErr(''); try { await adminConsoleApi.viewAs(id); window.location.hash = '#/dashboard'; window.location.reload() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }
  return (
    <Panel title="View as a user" sub="See the app exactly as they do, read-only, for 2 hours. Every view-as session is written to the audit log." testid="admin-support">
      <label className="relative block max-w-md"><span className="sr-only">Find a user</span><Search size={14} className="absolute left-3 top-3 text-text-muted" aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, name or company" className={`${cls} !pl-8`} data-testid="support-search" /></label>
      <Err e={err} />
      <ul className="mt-3 divide-y divide-border text-sm">{users.map((u) => <li key={u.id} className="flex items-center justify-between gap-3 py-2" data-testid="support-user"><span><b>{u.name}</b> <span className="text-text-muted">{u.email} · {u.role === 'shipper' ? `${u.company ?? 'shipper'} (${u.staffRole})` : 'customer'}{u.admin ? ' · admin' : ''}</span></span><button type="button" onClick={() => go(u.id)} className="btn-ghost !min-h-8 !px-3 text-xs" data-testid="support-view"><Eye size={13} aria-hidden="true" /> View as</button></li>)}</ul>
    </Panel>
  )
}

/* ---------------- feature switches ---------------- */
export function AdminFeatures() {
  const { d, err, reload } = useLoad(() => adminConsoleApi.features(), []); const [sid, setSid] = useState(''); const [shippers, setShippers] = useState<R[]>([])
  useEffect(() => { adminConsoleApi.billing().then((b) => setShippers(b.list)).catch(() => {}) }, [])
  const over = d?.overrides.find((o) => o.shipperId === sid)?.flags ?? {}
  return (
    <div className="space-y-6" data-testid="admin-features">
      <Err e={err} />
      <Panel title="Everyone" sub="Switch a feature off for the whole platform — no deploy needed. Changes apply within 20 seconds.">
        <ul className="divide-y divide-border text-sm">{d?.features.map((f) => <li key={f.key} className="flex items-center justify-between gap-3 py-2.5"><span><b>{f.label}</b><span className="block text-xs text-text-muted">{f.body}</span></span><button type="button" role="switch" aria-checked={f.on} aria-label={f.label} onClick={async () => { await adminConsoleApi.setFeature(f.key, !f.on); reload() }} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-ring ${f.on ? 'bg-teal' : 'bg-surface-2 border border-border'}`} data-testid={`feat-${f.key}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${f.on ? 'left-[22px]' : 'left-0.5'}`} /></button></li>)}</ul>
      </Panel>
      <Panel title="One shipper" sub="Override a switch for a single shipper (on or off), or leave it following everyone.">
        <select value={sid} onChange={(e) => setSid(e.target.value)} className={`${cls} max-w-sm`} data-testid="feat-shipper"><option value="">Choose a shipper…</option>{shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {sid && <ul className="mt-3 divide-y divide-border text-sm">{d?.features.map((f) => { const v = over[f.key]; return <li key={f.key} className="flex items-center justify-between gap-3 py-2"><span>{f.label}</span><div role="radiogroup" aria-label={f.label} className="flex gap-1">{[['follow', 'Follow everyone', null], ['on', 'On', true], ['off', 'Off', false]].map(([k, l, val]) => <button key={String(k)} type="button" role="radio" aria-checked={(v ?? null) === val} onClick={async () => { await adminConsoleApi.setShipperFeature(sid, f.key, val as boolean | null); reload() }} className={`rounded-full border px-2.5 py-0.5 text-xs focus-ring ${(v ?? null) === val ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`ov-${f.key}-${k}`}>{String(l)}</button>)}</div></li> })}</ul>}
        {d?.overrides.length ? <p className="mt-3 text-xs text-text-muted">Overrides in place: {d.overrides.map((o) => `${o.name} (${Object.entries(o.flags).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')})`).join(' · ')}</p> : null}
      </Panel>
    </div>
  )
}
