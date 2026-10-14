import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, Clock, DollarSign, Gauge, Inbox, Lightbulb, Package, Printer, RefreshCw, Ship, Star, Timer, Trophy, Truck, Users, Wallet } from 'lucide-react'
import { useStore } from '../lib/store'
import { roleAllows } from '../lib/ops'
import { analyticsApi, type Analytics, type Insight, type RateRow, type SegRow } from '../lib/analytics'
import { cargoLabel, type CargoType } from '../lib/data'
import { money, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { C, DataTable, Funnel, HBars, NoData, Panel, Stages, Stat, Trend } from '../components/Charts'

type Tab = 'overview' | 'sales' | 'operations' | 'finance' | 'customers'
const RANGES = [{ d: 30, label: '30 days' }, { d: 90, label: '90 days' }, { d: 180, label: '6 months' }, { d: 365, label: '12 months' }]
const TABS: { key: Tab; label: string }[] = [{ key: 'overview', label: 'Overview' }, { key: 'sales', label: 'Sales' }, { key: 'operations', label: 'Operations' }, { key: 'finance', label: 'Finance' }, { key: 'customers', label: 'Customers' }]
const SOURCES: Record<string, string> = { marketplace: 'Marketplace', picked: 'Picked you directly', link: 'Your order link', branded: 'Your branded page' }
const $ = (v: number | null | undefined) => (v == null ? '—' : money(v))
const pc = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const hrs = (v: number | null | undefined) => (v == null ? '—' : v < 1 ? `${Math.round(v * 60)} min` : `${v} h`)
const dd = (v: number | null | undefined) => (v == null ? '—' : `${v} d`)
const cargoName = (k: string) => cargoLabel(k as CargoType)
const compact = (v: number) => (v >= 10000 ? `$${Math.round(v / 1000)}k` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)

/* ------------------------------ insights ------------------------------ */
const TONE = { critical: { Icon: AlertTriangle, cls: 'border-l-danger', label: 'Act now', text: 'text-danger' }, warning: { Icon: Bell, cls: 'border-l-gold', label: 'Worth fixing', text: 'text-gold-deep' }, info: { Icon: Lightbulb, cls: 'border-l-sky', label: 'Opportunity', text: 'text-sky' }, good: { Icon: CheckCircle2, cls: 'border-l-teal', label: 'Going well', text: 'text-teal' } } as const
const AREA_LABEL = { sales: 'Sales', operations: 'Operations', finance: 'Finance', customers: 'Customers' } as const
function Insights({ items, area }: { items: Insight[]; area?: Insight['area'] }) {
  const [all, setAll] = useState(false)
  const list = area ? items.filter((i) => i.area === area) : items
  if (!list.length) return <NoData>Nothing stands out in this period — the numbers look steady.</NoData>
  const shown = all ? list : list.slice(0, area ? 4 : 6)
  return (
    <div data-testid="insights">
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((i) => { const t = TONE[i.tone]; return (
          <li key={i.id} className={`rounded-xl border border-border border-l-4 ${t.cls} bg-surface p-4`} data-testid="insight" data-tone={i.tone}>
            <p className={`mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${t.text}`}><t.Icon size={13} aria-hidden="true" />{t.label}<span className="font-normal normal-case tracking-normal text-text-muted">· {AREA_LABEL[i.area]}</span></p>
            <p className="font-semibold leading-snug">{i.title}</p>
            <p className="mt-1 text-sm text-text-muted">{i.body}</p>
            {i.action && <Link to={i.action.to} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-gold-deep hover:underline">{i.action.label} <ArrowRight size={13} aria-hidden="true" /></Link>}
          </li>
        ) })}
      </ul>
      {list.length > shown.length || all ? <button type="button" onClick={() => setAll(!all)} className="mt-3 text-sm text-text-muted hover:text-text focus-ring">{all ? 'Show fewer' : `Show all ${list.length} insights`}</button> : null}
    </div>
  )
}

const rateRows = (rows: RateRow[]) => rows.filter((r) => r.quoted > 0).map((r) => ({ label: r.label, value: r.winRate ?? 0, display: pc(r.winRate), note: `${r.won}/${r.quoted}` }))
const segCols = (name: string, fmt?: (k: string) => string) => [
  { key: 'label' as const, label: name, format: (v: unknown) => (fmt ? fmt(String(v)) : String(v)) },
  { key: 'requests' as const, label: 'Requests', align: 'right' as const },
  { key: 'quoted' as const, label: 'Quoted', align: 'right' as const },
  { key: 'won' as const, label: 'Won', align: 'right' as const },
  { key: 'winRate' as const, label: 'Win rate', align: 'right' as const, format: (v: unknown) => pc(v as number | null) },
  { key: 'avgQuote' as const, label: 'Avg quote', align: 'right' as const, format: (v: unknown) => $(v as number | null) },
  { key: 'priceGapPct' as const, label: 'vs competitors', align: 'right' as const, format: (v: unknown) => (v == null ? '—' : <span className={(v as number) > 5 ? 'text-danger' : (v as number) < -3 ? 'text-teal' : ''}>{(v as number) > 0 ? '+' : ''}{v as number}%</span>) },
  { key: 'value' as const, label: 'Booked', align: 'right' as const, format: (v: unknown) => $(v as number) },
]

/* ------------------------------ tabs ------------------------------ */
function OverviewTab({ a }: { a: Analytics }) {
  const s = a.sales, o = a.operations, f = a.finance, c = a.customers
  return (
    <div className="space-y-6">
      <Panel title="What the numbers say" sub="Ranked by impact. Each one links to where you can act on it." testid="insights-panel"><Insights items={a.insights} /></Panel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="headline">
        {s && <Stat label="Booked value" value={$(s.kpis.bookedValue.value)} kpi={s.kpis.bookedValue} icon={Trophy} hint={`${s.kpis.won.value ?? 0} wins`} />}
        {s && <Stat label="Win rate" value={pc(s.kpis.winRate.value)} kpi={s.kpis.winRate} icon={Gauge} />}
        {s && <Stat label="Median reply time" value={hrs(s.kpis.responseMedianH.value)} kpi={s.kpis.responseMedianH} better="down" icon={Timer} />}
        {o && <Stat label="On-time delivery" value={pc(o.kpis.onTimePct.value)} kpi={o.kpis.onTimePct} icon={Clock} tone={(o.kpis.onTimePct.value ?? 100) < 85 ? 'bad' : undefined} />}
        {o && <Stat label="Door to door" value={dd(o.kpis.doorToDoorDays.value)} kpi={o.kpis.doorToDoorDays} better="down" icon={Ship} hint="median" />}
        {f && <Stat label="Invoiced" value={$(f.kpis.invoiced.value)} kpi={f.kpis.invoiced} icon={DollarSign} />}
        {f && <Stat label="Collected" value={$(f.kpis.collected.value)} kpi={f.kpis.collected} icon={Wallet} hint={f.kpis.overdue ? `${money(f.kpis.overdue)} overdue` : undefined} />}
        {c && <Stat label="Average rating" value={c.kpis.rating.value != null ? `${c.kpis.rating.value}★` : '—'} kpi={c.kpis.rating} icon={Star} hint={`${c.kpis.reviews} reviews`} />}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {s && <Panel title="Quotes and wins" sub={`Per ${a.period.bucket}`}><Trend data={s.series} bucket={a.period.bucket} label="Quotes sent and won" series={[{ key: 'quoted', label: 'Quoted', color: C.context }, { key: 'won', label: 'Won', color: C.focus }]} extra={(d) => <p className="mt-0.5 text-text-muted">Win rate {pc(d.winRate)} · {$(d.value)}</p>} /></Panel>}
        {f && <Panel title="Invoiced and collected" sub={`Per ${a.period.bucket}`}><Trend data={f.series} bucket={a.period.bucket} label="Invoiced and collected" format={compact} series={[{ key: 'invoiced', label: 'Invoiced', color: C.context }, { key: 'collected', label: 'Collected', color: C.focus }]} /></Panel>}
      </div>
    </div>
  )
}

function SalesTab({ a }: { a: Analytics }) {
  const s = a.sales!; const k = s.kpis
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Matching requests" value={k.requests.value} kpi={k.requests} icon={Inbox} hint={`${s.missed} not quoted`} tone={s.missed > 5 ? 'bad' : undefined} />
        <Stat label="Quote rate" value={pc(k.quoteRate.value)} kpi={k.quoteRate} icon={Gauge} />
        <Stat label="Win rate" value={pc(k.winRate.value)} kpi={k.winRate} icon={Trophy} hint={`${k.won.value} won`} />
        <Stat label="Booked value" value={$(k.bookedValue.value)} kpi={k.bookedValue} icon={DollarSign} hint={`avg ${$(k.avgDeal.value)}`} />
        <Stat label="Median reply time" value={hrs(k.responseMedianH.value)} kpi={k.responseMedianH} better="down" icon={Timer} hint={`slowest 10%: ${hrs(k.responseP90H)}`} />
        <Stat label="Replied within 2 h" value={pc(k.within2hPct.value)} kpi={k.within2hPct} icon={Clock} />
        <Stat label="Average deal" value={$(k.avgDeal.value)} kpi={k.avgDeal} icon={Package} />
        <Stat label="Left on the table" value={$(s.missedValue)} icon={AlertTriangle} hint={`${s.missed} unanswered requests`} tone={s.missed > 5 ? 'bad' : undefined} />
      </div>
      <Insights items={a.insights} area="sales" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel title="Funnel" sub="Requests that matched your lanes, cargo and modes"><Funnel steps={s.funnel} /></Panel>
        <Panel title="Quotes and wins" sub={`Per ${a.period.bucket}`}><Trend data={s.series} bucket={a.period.bucket} label="Requests, quotes and wins" series={[{ key: 'requests', label: 'Requests', color: 'color-mix(in oklab, var(--color-text-muted) 22%, transparent)' }, { key: 'quoted', label: 'Quoted', color: C.context }, { key: 'won', label: 'Won', color: C.focus }]} extra={(d) => <p className="mt-0.5 text-text-muted">Win rate {pc(d.winRate)} · {$(d.value)}</p>} /></Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Win rate by reply speed" sub="Hours from request to your quote" testid="by-speed">{rateRows(s.bySpeed).length ? <HBars label="Win rate by reply speed" max={100} rows={rateRows(s.bySpeed)} /> : <NoData />}</Panel>
        <Panel title="Win rate by price position" sub="Your price against the cheapest competing quote" testid="by-price">{rateRows(s.byPrice).length ? <HBars label="Win rate by price position" max={100} rows={rateRows(s.byPrice)} /> : <NoData />}</Panel>
        <Panel title="Why quotes were lost" sub="Decided requests you didn’t win" testid="loss">{s.lossReasons.length ? <HBars label="Reasons quotes were lost" rows={s.lossReasons.map((l) => ({ label: l.reason, value: l.n, tone: 'context' as const }))} /> : <NoData>No lost quotes in this period.</NoData>}</Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Reply time by weekday" sub="Median hours, by the day the request arrived" testid="weekday"><HBars label="Median reply time by weekday" rows={s.weekday.map((w) => ({ label: w.day, value: w.medianH ?? 0, display: hrs(w.medianH), note: `${w.requests} req`, tone: (w.medianH ?? 0) > 12 ? 'bad' as const : 'focus' as const }))} /></Panel>
        <Panel title="Firm quotes vs estimates" testid="by-kind">{rateRows(s.byKind).length ? <HBars label="Win rate by quote type" max={100} rows={rateRows(s.byKind)} /> : <NoData />}<p className="mt-3 text-xs text-text-muted">Estimates are prices that may change once the cargo is weighed.</p></Panel>
      </div>
      <Panel title="Lanes" sub="Price gap = your quote against the median competing quote on the same request" testid="sales-lanes"><DataTable<SegRow> rows={s.byLane} cols={segCols('Lane')} csvName="sales-by-lane.csv" initialSort="requests" /></Panel>
      <div className="grid gap-6 2xl:grid-cols-2">
        <Panel title="Cargo types"><DataTable<SegRow> rows={s.byCargo} cols={segCols('Cargo', cargoName).filter((c) => c.key !== 'avgQuote')} csvName="sales-by-cargo.csv" initialSort="requests" /></Panel>
        <Panel title="Where requests come from"><DataTable<SegRow> rows={s.bySource} cols={segCols('Source', (k) => SOURCES[k] ?? k).filter((c) => !['avgQuote', 'priceGapPct'].includes(c.key))} csvName="sales-by-source.csv" initialSort="requests" /></Panel>
      </div>
    </div>
  )
}

function OperationsTab({ a }: { a: Analytics }) {
  const o = a.operations!; const k = o.kpis
  const series = o.series.map((x) => ({ ...x, late: Math.max(0, x.delivered - x.onTime) }))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Shipments booked" value={k.booked.value} kpi={k.booked} icon={Package} />
        <Stat label="Delivered" value={k.delivered.value} kpi={k.delivered} icon={CheckCircle2} />
        <Stat label="On time" value={pc(k.onTimePct.value)} kpi={k.onTimePct} icon={Clock} hint={k.avgLateDays != null ? `late ones +${k.avgLateDays} d` : undefined} tone={(k.onTimePct.value ?? 100) < 85 ? 'bad' : undefined} />
        <Stat label="Door to door" value={dd(k.doorToDoorDays.value)} kpi={k.doorToDoorDays} better="down" icon={Ship} hint={`slowest 10%: ${dd(k.doorToDoorP90)}`} />
        <Stat label="Active now" value={k.active} icon={Truck} hint={`${k.quiet} quiet 7+ days`} />
        <Stat label="Past ETA now" value={k.late} icon={AlertTriangle} tone={k.late ? 'bad' : undefined} />
        <Stat label="Stop completion" value={pc(o.runs.completionPct)} icon={Gauge} hint={`${o.runs.done} of ${o.runs.done + o.runs.skipped} stops`} />
        <Stat label="Disputes" value={o.exceptions.disputes} icon={Bell} hint={o.exceptions.disputeRatePct != null ? `${o.exceptions.disputeRatePct}% of deliveries` : undefined} />
      </div>
      <Insights items={a.insights} area="operations" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Deliveries — on time and late" sub={`Per ${a.period.bucket}, against the ETA promised at booking`} testid="ontime-trend"><Trend data={series} bucket={a.period.bucket} stacked label="Deliveries on time and late" series={[{ key: 'onTime', label: 'On time', color: C.focus }, { key: 'late', label: 'Late', color: C.bad }]} extra={(d) => <p className="mt-0.5 text-text-muted">{pc(d.onTimePct)} on time · {d.booked} booked</p>} /></Panel>
        <Panel title="Where shipments are now" sub="Active shipments by status · average days since the last update" testid="board">{o.board.length ? <HBars label="Active shipments by status" rows={o.board.map((b) => ({ label: b.label, value: b.n, note: b.avgAgeDays != null ? `${b.avgAgeDays} d` : undefined, tone: (b.avgAgeDays ?? 0) > 7 ? 'bad' as const : 'focus' as const }))} /> : <NoData>No active shipments.</NoData>}</Panel>
      </div>
      <Panel title="Time in each stage" sub="Median days for shipments delivered in this period, with the slowest 10% and the platform median for comparison"><Stages rows={o.stages} /></Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="On time by lane"><DataTable rows={o.byLane} csvName="ops-by-lane.csv" initialSort="delivered" cols={[{ key: 'label', label: 'Lane' }, { key: 'delivered', label: 'Delivered', align: 'right' }, { key: 'onTimePct', label: 'On time', align: 'right', format: (v) => <span className={(v as number) < 85 ? 'text-danger' : ''}>{pc(v as number)}</span> }, { key: 'medianDays', label: 'Door to door', align: 'right', format: (v) => dd(v as number) }]} /></Panel>
        <Panel title="Drivers" sub={`${o.runs.runs} runs · ${o.runs.stops} stops · ${o.runs.stopsPerRun ?? '—'} stops a run · ${o.runs.kmPerStop ?? '—'} km a stop`} testid="drivers"><DataTable rows={o.drivers} csvName="drivers.csv" initialSort="stops" cols={[{ key: 'name', label: 'Driver' }, { key: 'runs', label: 'Runs', align: 'right' }, { key: 'stops', label: 'Stops', align: 'right' }, { key: 'skipped', label: 'Missed', align: 'right' }, { key: 'completionPct', label: 'Completed', align: 'right', format: (v) => <span className={(v as number) < 90 ? 'text-danger' : ''}>{pc(v as number)}</span> }, { key: 'km', label: 'km', align: 'right' }]} />
          {o.skipReasons.length > 0 && <div className="mt-4 border-t border-border pt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Why stops were missed</p><HBars label="Reasons stops were missed" rows={o.skipReasons.map((r) => ({ label: r.reason, value: r.n, tone: 'context' as const }))} /></div>}
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pickups requested" value={o.pickups.requested} icon={Truck} hint={`${pc(o.pickups.onRunPct)} placed on a run · ${o.pickups.cancelled} cancelled`} />
        <Stat label="Containers" value={o.containers.count} icon={Ship} hint={`${o.containers.shipped} shipped · ${o.containers.avgShipments ?? '—'} shipments each`} />
        <Stat label="Pieces received" value={o.warehouse.received} icon={Package} hint={`${o.warehouse.inYard} in the yard now · dwell ${dd(o.warehouse.avgDwellDays)}`} />
        <Stat label="Cancelled shipments" value={o.exceptions.cancelled} icon={AlertTriangle} hint={`${o.exceptions.lateDeliveries} late deliveries`} />
      </div>
    </div>
  )
}

function FinanceTab({ a }: { a: Analytics }) {
  const f = a.finance!; const k = f.kpis
  const lateKeys = ['d30', 'd60', 'd90', 'd90p']
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invoiced" value={$(k.invoiced.value)} kpi={k.invoiced} icon={DollarSign} hint={`avg ${$(k.avgInvoice)}`} />
        <Stat label="Collected" value={$(k.collected.value)} kpi={k.collected} icon={Wallet} />
        <Stat label="Collection rate" value={pc(k.collectionRatePct.value)} kpi={k.collectionRatePct} icon={Gauge} hint="collected ÷ invoiced" />
        <Stat label="Days to get paid" value={k.dsoDays.value != null ? `${k.dsoDays.value} d` : '—'} kpi={k.dsoDays} better="down" icon={Timer} hint="average, invoices paid in full" />
        <Stat label="Outstanding" value={$(k.outstanding)} icon={Wallet} />
        <Stat label="Overdue" value={$(k.overdue)} icon={AlertTriangle} hint={`${k.overdueCount} invoice${k.overdueCount === 1 ? '' : 's'}`} tone={k.overdue > 0 ? 'bad' : undefined} />
        <Stat label="Revenue per kg" value={k.revenuePerKg != null ? `$${k.revenuePerKg}` : '—'} icon={Package} />
        <Stat label="Top 5 clients" value={pc(f.concentrationPct)} icon={Users} hint="share of revenue" />
      </div>
      <Insights items={a.insights} area="finance" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Invoiced and collected" sub={`Per ${a.period.bucket}`}><Trend data={f.series} bucket={a.period.bucket} format={compact} label="Invoiced and collected" series={[{ key: 'invoiced', label: 'Invoiced', color: C.context }, { key: 'collected', label: 'Collected', color: C.focus }]} /></Panel>
        <Panel title="Who owes what, by age" sub="Open balances by days past due" testid="aging"><HBars label="Outstanding by age" rows={f.aging.map((b) => ({ label: b.label, value: b.amount, display: money(b.amount), note: `${b.n} inv`, tone: lateKeys.includes(b.key) ? 'bad' as const : 'focus' as const }))} /><Link to="/dashboard/collections" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-deep hover:underline">Collections <ArrowRight size={13} aria-hidden="true" /></Link></Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Revenue by service" testid="by-service">{f.byService.length ? <HBars label="Revenue by service" rows={f.byService.map((x) => ({ label: x.label, value: x.amount, display: money(x.amount), note: pc(x.sharePct) }))} /> : <NoData />}</Panel>
        <Panel title="How clients pay">{f.methods.length ? <HBars label="Payments by method" rows={f.methods.map((m) => ({ label: m.method[0].toUpperCase() + m.method.slice(1), value: m.amount, display: money(m.amount), tone: 'context' as const }))} /> : <NoData />}</Panel>
        <Panel title="Largest balances">{f.owing.length ? <ul className="divide-y divide-border text-sm">{f.owing.map((o) => <li key={o.id} className="flex items-center justify-between py-2"><Link to={`/dashboard/clients/${o.id}?tab=invoices`} className="hover:underline">{o.name}</Link><b className="tabular-nums text-danger">{money(o.outstanding)}</b></li>)}</ul> : <NoData>Nobody owes you anything.</NoData>}
          <p className="mt-3 text-xs text-text-muted">Held in escrow {money(f.escrow.held)} · released {money(f.escrow.released)} · insurance commission {money(f.insurance.commission)} ({f.insurance.policies} policies)</p>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Revenue by lane"><DataTable rows={f.byLane} csvName="revenue-by-lane.csv" initialSort="revenue" cols={[{ key: 'label', label: 'Lane' }, { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(v as number) }, { key: 'shipments', label: 'Invoices', align: 'right' }, { key: 'perShipment', label: 'Per shipment', align: 'right', format: (v) => $(v as number) }, { key: 'perKg', label: 'Per kg', align: 'right', format: (v) => (v == null ? '—' : `$${v}`) }]} /></Panel>
        <Panel title="Top clients" testid="top-clients"><DataTable rows={f.topClients} csvName="top-clients.csv" initialSort="revenue" cols={[{ key: 'name', label: 'Client', format: (v, r) => <Link to={`/dashboard/clients/${r.id}`} className="hover:underline">{String(v)}</Link> }, { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(v as number) }, { key: 'invoices', label: 'Invoices', align: 'right' }, { key: 'outstanding', label: 'Owing', align: 'right', format: (v) => ((v as number) > 0 ? <span className="text-danger">{money(v as number)}</span> : '—') }]} /></Panel>
      </div>
    </div>
  )
}

const BAD_TAGS = ['Late', 'Damaged items', 'Hard to reach', 'Hidden charges']
function CustomersTab({ a }: { a: Analytics }) {
  const c = a.customers!; const k = c.kpis
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clients who shipped" value={k.active.value} kpi={k.active} icon={Users} hint={`${k.new} new · ${k.returning} returning`} />
        <Stat label="Repeat clients" value={pc(k.repeatRatePct)} icon={RefreshCw} hint="of all clients ever, shipped 2+ times" />
        <Stat label="Average rating" value={k.rating.value != null ? `${k.rating.value}★` : '—'} kpi={k.rating} icon={Star} hint={`${k.reviews} reviews`} />
        <Stat label="Shipments per client" value={k.shipmentsPerClient ?? '—'} icon={Package} hint={`${k.lifetimeClients} clients in total`} />
      </div>
      <Insights items={a.insights} area="customers" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Ratings" testid="ratings">{k.reviews ? <HBars label="Reviews by star rating" rows={c.ratingDist.map((r) => ({ label: `${r.star}★`, value: r.n, tone: r.star <= 2 ? 'bad' as const : 'focus' as const }))} /> : <NoData>No reviews in this period.</NoData>}</Panel>
        <Panel title="What clients mention" sub="Tags on reviews">{c.tags.length ? <ul className="flex flex-wrap gap-2">{c.tags.map((t) => <li key={t.tag} className={`rounded-full border px-3 py-1 text-sm ${BAD_TAGS.includes(t.tag) ? 'border-danger/40 bg-danger/10 text-danger' : 'border-teal/40 bg-teal/10 text-teal'}`}>{t.tag} <b className="tabular-nums">{t.n}</b></li>)}</ul> : <NoData />}</Panel>
        <Panel title="Bookings by source">{c.wonBySource.length ? <HBars label="Won bookings by source" rows={c.wonBySource.map((s) => ({ label: SOURCES[s.source] ?? s.source, value: s.n }))} /> : <NoData />}</Panel>
      </div>
      <Panel title="Reviews over time" sub={`Per ${a.period.bucket}`}><Trend data={c.ratingSeries} bucket={a.period.bucket} label="Reviews received" series={[{ key: 'reviews', label: 'Reviews', color: C.focus }]} extra={(d) => <p className="mt-0.5 text-text-muted">Average {d.avg != null ? `${d.avg}★` : '—'}</p>} /></Panel>
      <Panel title="Clients to win back" sub="Shipped with you twice or more, nothing in the last 90 days" testid="dormant"><DataTable rows={c.dormant} csvName="win-back.csv" initialSort="revenue12m" cols={[{ key: 'name', label: 'Client', format: (v, r) => (r.isClient ? <Link to={`/dashboard/clients/${r.id}?tab=activity`} className="hover:underline">{String(v)}</Link> : String(v)) }, { key: 'shipments', label: 'Shipments', align: 'right' }, { key: 'lastAt', label: 'Last shipment', align: 'right', format: (v) => fmtDate(String(v)) }, { key: 'revenue12m', label: 'Spent (12 mo)', align: 'right', format: (v) => money(v as number) }]} /></Panel>
    </div>
  )
}

/* ------------------------------ page ------------------------------ */
export default function AnalyticsPage() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const days = Number(sp.get('days')) || 90; const origin = sp.get('origin') ?? ''; const cargo = sp.get('cargo') ?? ''
  const tab0 = (sp.get('tab') as Tab | null) ?? 'overview'
  const [a, setA] = useState<Analytics | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (p: Record<string, string | undefined>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) { if (v) n.set(k, v); else n.delete(k) } setSp(n, { replace: true }) }
  useEffect(() => {
    if (!user || user.role !== 'shipper') return
    let live = true; setBusy(true); setErr('')
    analyticsApi.get({ days, origin, cargo }).then((r) => { if (live) setA(r) }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not load analytics.') }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [user, days, origin, cargo])
  const tabs = useMemo(() => TABS.filter((t) => t.key === 'overview' || (a ? a.access[t.key as keyof Analytics['access']] : true)), [a])
  const tab = tabs.some((t) => t.key === tab0) ? tab0 : 'overview'

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/analytics" replace />
  if (user.role !== 'shipper' || !roleAllows(user.staffRole as never, '/dashboard/analytics', user.perms as never)) return <Navigate to="/dashboard/shipper" replace />
  const period = a ? `${fmtDate(a.period.from)} – ${fmtDate(a.period.to)}` : ''
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Analytics</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">How the business is doing</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Sales, operations, money and clients in one place{period ? ` · ${period}, compared with the ${days} days before` : ''}.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2 print:hidden"><button type="button" onClick={() => window.print()} className="btn-ghost"><Printer size={15} aria-hidden="true" /> Print</button></motion.div>
          </div>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2 print:hidden" data-testid="filters">
            <div role="radiogroup" aria-label="Period" className="flex rounded-xl border border-border bg-surface p-1">
              {RANGES.map((r) => <button key={r.d} type="button" role="radio" aria-checked={days === r.d} onClick={() => set({ days: r.d === 90 ? undefined : String(r.d) })} className={`rounded-lg px-3 py-1.5 text-sm focus-ring ${days === r.d ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid={`range-${r.d}`}>{r.label}</button>)}
            </div>
            <label className="sr-only" htmlFor="an-origin">Origin</label>
            <select id="an-origin" value={origin} onChange={(e) => set({ origin: e.target.value || undefined })} className="input-dark !min-h-10 !w-auto text-sm" data-testid="f-origin"><option value="">All origins</option>{a?.filters.origins.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            <label className="sr-only" htmlFor="an-cargo">Cargo</label>
            <select id="an-cargo" value={cargo} onChange={(e) => set({ cargo: e.target.value || undefined })} className="input-dark !min-h-10 !w-auto text-sm" data-testid="f-cargo"><option value="">All cargo</option>{a?.filters.cargos.map((c) => <option key={c} value={c}>{cargoName(c)}</option>)}</select>
            {(origin || cargo) && <button type="button" onClick={() => set({ origin: undefined, cargo: undefined })} className="text-sm text-text-muted hover:text-text focus-ring">Clear filters</button>}
            {busy && <span className="text-xs text-text-muted" role="status">Updating…</span>}
          </motion.div>

          <motion.div variants={fadeUp} role="tablist" aria-label="Analytics sections" className="mt-5 flex gap-1 overflow-x-auto border-b border-border print:hidden">
            {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => set({ tab: t.key === 'overview' ? undefined : t.key })} className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm focus-ring ${tab === t.key ? 'border-gold font-semibold text-text' : 'border-transparent text-text-muted hover:text-text'}`} data-testid={`tab-${t.key}`}>{t.label}</button>)}
          </motion.div>

          {err && <p role="alert" className="mt-6 text-sm text-danger">{err}</p>}
          {!a && !err && <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card-dark h-24 animate-pulse" />)}</div>}
          {a && (
            <div className={`mt-6 transition-opacity ${busy ? 'opacity-60' : ''}`} role="tabpanel" data-testid={`panel-${tab}`}>
              {tab === 'overview' && <OverviewTab a={a} />}
              {tab === 'sales' && a.sales && <SalesTab a={a} />}
              {tab === 'operations' && a.operations && <OperationsTab a={a} />}
              {tab === 'finance' && a.finance && <FinanceTab a={a} />}
              {tab === 'customers' && a.customers && <CustomersTab a={a} />}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
