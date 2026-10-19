import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Calculator, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { platformApi, type Cost } from '../lib/platform'
import { analyticsApi, type Analytics } from '../lib/analytics'
import { money, fmtDate } from '../components/ui'
import { DataTable, HBars, NoData, Panel, Stat, Trend, C } from '../components/Charts'

type Data = Awaited<ReturnType<typeof platformApi.costs>>
const today = () => new Date().toISOString().slice(0, 10)

/** Costs & profit: record what each move really cost and see margin by lane, client and container. */
export default function CostsPage() {
  const { ready, user } = useStore()
  const [days, setDays] = useState(90)
  const [d, setD] = useState<Data | null>(null); const [a, setA] = useState<Analytics | null>(null)
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ scope: 'container', category: 'freight', amount: '', description: '', vendor: '', incurredOn: today(), containerId: '', shipmentId: '' })
  const load = () => { platformApi.costs(days).then(setD).catch((e) => setErr(e.message)); analyticsApi.get({ days }).then(setA).catch(() => {}) }
  useEffect(() => { if (user?.role === 'shipper') load() }, [user, days]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?next=/dashboard/costs" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const p = a?.profit
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try {
      await platformApi.addCost({ category: f.category, amountUsd: Number(f.amount), description: f.description, vendor: f.vendor, incurredOn: f.incurredOn, containerId: f.scope === 'container' ? f.containerId || null : null, shipmentId: f.scope === 'shipment' ? f.shipmentId || null : null })
      setOk('Cost saved.'); setF({ ...f, amount: '', description: '' }); load()
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not save.') } finally { setBusy(false) }
  }
  const cls = 'input-dark !min-h-10 text-sm'
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow mb-1">Money</p><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Costs & profit</h1><p className="mt-1 max-w-2xl text-text-muted">Record what the shipping line, trucking, port and agents charged. Container costs are split across the shipments in it by weight; company costs count as overhead.</p></div>
        <div role="radiogroup" aria-label="Period" className="flex rounded-xl border border-border bg-surface p-1">{[30, 90, 180, 365].map((n) => <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)} className={`rounded-lg px-3 py-1.5 text-sm focus-ring ${days === n ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted hover:text-text'}`}>{n === 365 ? '12 mo' : `${n} d`}</button>)}</div>
      </div>
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="profit-stats">
        <Stat label="Shipment revenue" value={p ? money(p.shipmentRevenue) : '—'} icon={Calculator} />
        <Stat label="Direct costs" value={p ? money(p.directCost) : '—'} hint={p ? `${p.coveragePct ?? 0}% of shipments have costs` : undefined} />
        <Stat label="Gross profit" value={p ? money(p.grossProfit) : '—'} hint={p?.grossMarginPct != null ? `${p.grossMarginPct}% margin` : undefined} tone={(p?.grossMarginPct ?? 100) < 10 ? 'bad' : undefined} />
        <Stat label="Net after overhead" value={p ? money(p.netProfit) : '—'} hint={p ? `overhead ${money(p.overhead)} · ${p.netMarginPct ?? '—'}%` : undefined} tone={(p?.netProfit ?? 0) < 0 ? 'bad' : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel title="Add a cost" testid="cost-form">
          <form onSubmit={save} className="space-y-3">
            <div role="radiogroup" aria-label="What is it for" className="flex flex-wrap gap-1.5">{[['container', 'A container'], ['shipment', 'One shipment'], ['overhead', 'The company']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.scope === k} onClick={() => setF({ ...f, scope: k })} className={`rounded-full border px-3 py-1 text-sm focus-ring ${f.scope === k ? 'border-gold bg-gold/15 font-semibold' : 'border-border text-text-muted'}`} data-testid={`scope-${k}`}>{l}</button>)}</div>
            {f.scope === 'container' && <label className="block text-sm"><span className="label-dark">Container</span><select required className={cls} value={f.containerId} onChange={(e) => setF({ ...f, containerId: e.target.value })} data-testid="cost-container"><option value="">Choose…</option>{d?.containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            {f.scope === 'shipment' && <label className="block text-sm"><span className="label-dark">Shipment</span><select required className={cls} value={f.shipmentId} onChange={(e) => setF({ ...f, shipmentId: e.target.value })} data-testid="cost-shipment"><option value="">Choose…</option>{d?.shipments.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm"><span className="label-dark">Type</span><select className={cls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="cost-category">{d?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
              <label className="block text-sm"><span className="label-dark">Amount (USD)</span><input required type="number" min="0.01" step="0.01" className={cls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="cost-amount" /></label>
              <label className="block text-sm"><span className="label-dark">Paid to</span><input className={cls} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="e.g. MSC" /></label>
              <label className="block text-sm"><span className="label-dark">Date</span><input type="date" className={cls} value={f.incurredOn} onChange={(e) => setF({ ...f, incurredOn: e.target.value })} /></label>
            </div>
            <label className="block text-sm"><span className="label-dark">Note</span><input className={cls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. 40ft freight Houston → Tema" /></label>
            {ok && <p role="status" className="text-sm text-teal">{ok}</p>}
            <button disabled={busy} className="btn-gold !min-h-10" data-testid="cost-save"><Plus size={15} aria-hidden="true" /> Save cost</button>
          </form>
        </Panel>
        <Panel title="Revenue and cost" sub={a ? `Per ${a.period.bucket}` : undefined}>{p ? <Trend data={p.series} bucket={a!.period.bucket} label="Revenue and cost" format={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} series={[{ key: 'revenue', label: 'Revenue', color: C.context }, { key: 'cost', label: 'Cost', color: C.bad }, { key: 'profit', label: 'Profit', color: C.focus }]} /> : <NoData>Profit needs finance access and the full analytics plan.</NoData>}</Panel>
      </div>
      {p && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="Margin by lane" testid="margin-lanes"><DataTable rows={p.byLane} csvName="margin-by-lane.csv" initialSort="revenue" cols={[{ key: 'label', label: 'Lane' }, { key: 'n', label: 'Shipments', align: 'right' }, { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(v as number) }, { key: 'cost', label: 'Cost', align: 'right', format: (v) => money(v as number) }, { key: 'profit', label: 'Profit', align: 'right', format: (v) => <span className={(v as number) < 0 ? 'text-danger' : ''}>{money(v as number)}</span> }, { key: 'marginPct', label: 'Margin', align: 'right', format: (v) => (v == null ? '—' : <span className={(v as number) < 15 ? 'text-danger' : ''}>{v as number}%</span>) }]} /></Panel>
          <Panel title="Where the money goes" sub="Direct costs on shipments invoiced in this period">{p.byCategory.length ? <HBars label="Costs by type" rows={p.byCategory.map((c: { label: string; amount: number }) => ({ label: c.label, value: c.amount, display: money(c.amount), tone: 'context' as const }))} /> : <NoData>No costs recorded against these shipments yet.</NoData>}</Panel>
          <Panel title="Profit by client"><DataTable rows={p.byClient} csvName="profit-by-client.csv" initialSort="profit" cols={[{ key: 'label', label: 'Client', format: (v, r) => <Link to={`/dashboard/clients/${(r as unknown as Record<string, string>).id}`} className="hover:underline">{String(v)}</Link> }, { key: 'n', label: 'Shipments', align: 'right' }, { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(v as number) }, { key: 'profit', label: 'Profit', align: 'right', format: (v) => <span className={(v as number) < 0 ? 'text-danger' : ''}>{money(v as number)}</span> }, { key: 'marginPct', label: 'Margin', align: 'right', format: (v) => (v == null ? '—' : `${v}%`) }]} /></Panel>
          <Panel title="Profit by container">{p.byContainer.length ? <DataTable rows={p.byContainer} csvName="profit-by-container.csv" initialSort="revenue" cols={[{ key: 'label', label: 'Container', format: (v, r) => <Link to={`/dashboard/containers/${(r as unknown as Record<string, string>).id}`} className="hover:underline">{String(v)}</Link> }, { key: 'n', label: 'Shipments', align: 'right' }, { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(v as number) }, { key: 'cost', label: 'Cost', align: 'right', format: (v) => money(v as number) }, { key: 'marginPct', label: 'Margin', align: 'right', format: (v) => (v == null ? '—' : `${v}%`) }]} /> : <NoData>No invoiced shipments in containers in this period.</NoData>}</Panel>
        </div>
      )}
      <Panel title="Recorded costs" sub={d ? `${money(d.total)} in this period` : undefined} className="mt-6" testid="cost-list">
        {d && <DataTable<Cost & Record<string, unknown>> rows={d.costs as (Cost & Record<string, unknown>)[]} csvName="costs.csv" limit={15} cols={[
          { key: 'incurredOn', label: 'Date', format: (v) => fmtDate(String(v) + 'T12:00:00Z') },
          { key: 'category', label: 'Type', format: (v) => d.categories.find((c) => c.key === v)?.label ?? String(v) },
          { key: 'scope', label: 'For', format: (_v, r) => (r.shipmentRef ? `${r.shipmentRef}` : r.containerRef ? `${r.containerRef} (split)` : 'Overhead') },
          { key: 'vendor', label: 'Paid to' }, { key: 'description', label: 'Note' },
          { key: 'amountUsd', label: 'Amount', align: 'right', format: (v) => money(v as number) },
          { key: 'id', label: '', format: (v) => <button type="button" aria-label="Delete cost" onClick={async () => { if (confirm('Delete this cost?')) { await platformApi.deleteCost(String(v)); load() } }} className="rounded p-1 text-text-muted hover:text-danger focus-ring"><Trash2 size={14} aria-hidden="true" /></button> },
        ]} />}
      </Panel>
    </div></div>
  )
}
