import { useEffect, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { bpApi, usdShort, usd, local, type BpAnalytics, type BpGroup } from '../../lib/brokerPortal'
import { Trend, HBars, C } from '../../components/Charts'
import { cargoLabel, type CargoType } from '../../lib/data'
import { Card, Empty, Err, Kpi, Page, errMsg } from './BrokerApp'

const days = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)} d`)

function GroupTable({ rows, label, fmt = (k) => k }: { rows: BpGroup[]; label: string; fmt?: (k: string) => string }) {
  if (!rows.length) return <Empty>No jobs in this period.</Empty>
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${label} table`}><table className="w-full min-w-[420px] text-sm"><caption className="sr-only">{label}</caption>
      <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="py-2 pr-3">{label}</th><th className="py-2 pr-3 text-right">Jobs</th><th className="py-2 pr-3 text-right">Cleared</th><th className="py-2 pr-3 text-right">Avg days</th><th className="py-2 text-right">Fees</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key} className="border-b border-border/60"><td className="py-2 pr-3 font-medium">{fmt(r.key)}</td><td className="py-2 pr-3 text-right tabular-nums">{r.jobs}</td><td className="py-2 pr-3 text-right tabular-nums">{r.cleared}</td><td className="py-2 pr-3 text-right tabular-nums">{days(r.avgDays)}</td><td className="py-2 text-right tabular-nums">{usd(r.fees)}</td></tr>)}</tbody></table></div>
  )
}

export function Analytics() {
  const [months, setMonths] = useState(6); const [d, setD] = useState<BpAnalytics | null>(null); const [err, setErr] = useState('')
  useEffect(() => { setD(null); bpApi.analytics(months).then(setD).catch((e) => setErr(errMsg(e))) }, [months])
  const pick = <div className="flex gap-1 rounded-lg border border-border p-0.5 text-sm" role="group" aria-label="Period">{[3, 6, 12].map((m) => <button key={m} aria-pressed={months === m} onClick={() => setMonths(m)} className={`min-h-9 rounded-md px-3 ${months === m ? 'bg-gold text-on-accent' : 'text-text-muted'}`}>{m} months</button>)}</div>
  return (
    <Page eyebrow="Analytics" title="How your clearing business is doing" actions={pick}>
      <Err e={err} />
      {!d ? <p className="text-text-muted">Loading…</p> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="bp-analytics-kpis">
          <Kpi label="Jobs received" value={d.kpis.received} />
          <Kpi label="Cleared" value={d.kpis.cleared} tone="good" />
          <Kpi label="Avg days to clear" value={days(d.kpis.avgClearDays)} />
          <Kpi label="Acceptance rate" value={d.kpis.acceptRate == null ? '—' : `${Math.round(d.kpis.acceptRate * 100)}%`} />
          <Kpi label="Avg reply time" value={d.kpis.avgResponseHours == null ? '—' : `${d.kpis.avgResponseHours.toFixed(1)} h`} hint="request → accept/decline" />
          <Kpi label="Fees earned" value={usd(d.kpis.fees)} />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card title="Jobs received and cleared" id="an-jobs">{d.monthly.some((m) => m.received || m.cleared) ? <Trend data={d.monthly} series={[{ key: 'received', label: 'Received', color: C.context }, { key: 'cleared', label: 'Cleared', color: C.focus }]} bucket="month" label="Jobs received and cleared per month" /> : <Empty>No jobs in this period.</Empty>}</Card>
          <Card title="Fees earned" id="an-fees">{d.monthly.some((m) => m.fees) ? <Trend data={d.monthly} series={[{ key: 'fees', label: 'Fees', color: C.alt }]} bucket="month" format={usdShort} label="Fees earned per month" /> : <Empty>No cleared jobs in this period.</Empty>}</Card>
          <Card title="Where the days go" sub="Average days each step takes — the longest bar is where to push." id="an-steps">{d.steps.length ? <HBars label="Average days per step" testid="bp-step-days" rows={d.steps.map((s) => ({ label: s.label, value: s.avgDays, display: days(s.avgDays), note: `${s.n} job${s.n === 1 ? '' : 's'}`, tone: s.avgDays === Math.max(...d.steps.map((x) => x.avgDays)) ? 'bad' : 'focus' }))} /> : <Empty>Not enough finished steps yet.</Empty>}</Card>
          <Card title="Duty assessed" sub="Duty your clients paid through you, by currency." id="an-duty">{d.duty.length ? <ul className="divide-y divide-border text-sm">{d.duty.map((x) => <li key={x.currency} className="flex justify-between py-2.5"><span>{x.jobs} job{x.jobs === 1 ? '' : 's'}</span><b className="tabular-nums">{local(x.amount, x.currency)}</b></li>)}</ul> : <Empty>No duty assessed in this period.</Empty>}</Card>
          <Card title="By cargo" id="an-cargo"><GroupTable rows={d.byCargo} label="Cargo" fmt={(k) => cargoLabel(k as CargoType)} /></Card>
          <Card title="By shipping company" id="an-ship"><GroupTable rows={d.byShipper} label="Shipping company" /></Card>
          <Card title="By port" id="an-port" className="xl:col-span-2"><GroupTable rows={d.byPort} label="Port" /></Card>
        </div>
      </>}
    </Page>
  )
}

const REPORTS = [
  { kind: 'jobs', title: 'Jobs register', sub: 'Every job received in the range, with step dates, days to clear, fee, duty and declaration reference.' },
  { kind: 'finance', title: 'Invoices', sub: 'Invoices created in the range with status, due date, payment date and reference — for your accountant.' },
  { kind: 'duty', title: 'Duty assessed', sub: 'Duty assessed per shipment, in the local currency, with declaration references.' },
  { kind: 'disbursements', title: 'Disbursements', sub: 'Port, handling and other charges you paid out, whether rebilled, and the invoice they went on.' },
]
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export function Reports() {
  const now = new Date(); const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1))); const [to, setTo] = useState(isoDay(now))
  const [d, setD] = useState<BpAnalytics | null>(null)
  useEffect(() => { bpApi.analytics(12).then(setD).catch(() => {}) }, [])
  const presets: [string, () => void][] = [
    ['This month', () => { setFrom(isoDay(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(isoDay(now)) }],
    ['Last month', () => { setFrom(isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(isoDay(new Date(now.getFullYear(), now.getMonth(), 0))) }],
    ['This year', () => { setFrom(`${now.getFullYear()}-01-01`); setTo(isoDay(now)) }],
  ]
  const inRange = d?.monthly.filter((m) => m.start.slice(0, 7) >= from.slice(0, 7) && m.start.slice(0, 7) <= to.slice(0, 7)) ?? []
  return (
    <Page eyebrow="Reports" title="Download your records" sub="CSV files open in Excel, Google Sheets or Numbers.">
      <Card title="Date range" id="rp-range">
        <div className="flex flex-wrap items-end gap-3">
          <div><label htmlFor="rp-from" className="mb-1 block text-xs font-semibold text-text-muted">From</label><input id="rp-from" type="date" className="input-dark" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="rp-to" className="mb-1 block text-xs font-semibold text-text-muted">To</label><input id="rp-to" type="date" className="input-dark" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="flex flex-wrap gap-1">{presets.map(([l, f]) => <button key={l} onClick={f} className="btn-ghost !min-h-10 !px-3 text-sm">{l}</button>)}</div>
        </div>
      </Card>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => <Card key={r.kind} title={r.title} id={`rp-${r.kind}`}><p className="mb-4 text-sm text-text-muted">{r.sub}</p><a href={`/api/bp/reports/${r.kind}.csv?from=${from}&to=${to}`} download className="btn-gold" data-testid={`bp-report-${r.kind}`}><Download size={15} aria-hidden="true" /> Download CSV</a></Card>)}
      </div>
      <Card className="mt-6" title="Monthly summary" id="rp-summary" actions={<button onClick={() => window.print()} className="btn-ghost !min-h-10 !px-3 text-sm print:hidden"><Printer size={15} aria-hidden="true" /> Print</button>}>
        {inRange.length ? <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Monthly summary table"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="py-2 pr-3">Month</th><th className="py-2 pr-3 text-right">Received</th><th className="py-2 pr-3 text-right">Cleared</th><th className="py-2 pr-3 text-right">Avg days</th><th className="py-2 text-right">Fees</th></tr></thead>
          <tbody>{inRange.map((m) => <tr key={m.start} className="border-b border-border/60"><td className="py-2 pr-3">{new Date(m.start + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</td><td className="py-2 pr-3 text-right tabular-nums">{m.received}</td><td className="py-2 pr-3 text-right tabular-nums">{m.cleared}</td><td className="py-2 pr-3 text-right tabular-nums">{m.avgDays ? m.avgDays.toFixed(1) : '—'}</td><td className="py-2 text-right tabular-nums">{usd(m.fees)}</td></tr>)}
            <tr className="font-semibold"><td className="py-2 pr-3">Total</td><td className="py-2 pr-3 text-right">{inRange.reduce((n, m) => n + m.received, 0)}</td><td className="py-2 pr-3 text-right">{inRange.reduce((n, m) => n + m.cleared, 0)}</td><td /><td className="py-2 text-right">{usd(inRange.reduce((n, m) => n + m.fees, 0))}</td></tr></tbody></table></div> : <Empty>No activity in this range.</Empty>}
      </Card>
    </Page>
  )
}
