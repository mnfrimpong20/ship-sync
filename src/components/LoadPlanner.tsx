import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, PackagePlus } from 'lucide-react'
import { platformApi, type Planner } from '../lib/platform'
import { containersApi } from '../lib/containers'
import { NoData, Panel } from './Charts'

const Bar = ({ pct, warn }: { pct: number; warn?: boolean }) => <div className="h-2.5 rounded-full bg-surface-2" aria-hidden="true"><div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`, background: warn ? 'var(--color-danger)' : 'var(--color-gold)' }} /></div>

/** Load planner: what's waiting, how full each open container is, what would fill it, and what size the rest needs. */
export function LoadPlanner() {
  const [p, setP] = useState<Planner | null>(null); const [err, setErr] = useState(''); const [sel, setSel] = useState<Set<string>>(new Set()); const [msg, setMsg] = useState('')
  const load = () => platformApi.planner().then((x) => { setP(x); setSel(new Set()) }).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [])
  const pick = useMemo(() => { if (!p) return null; const xs = p.waiting.filter((w) => sel.has(w.id)); const cbm = xs.reduce((a, x) => a + x.cbm, 0); const kg = xs.reduce((a, x) => a + x.kg, 0); const fit = (['20ft', '40ft', '40hc'] as const).map((k) => ({ k, label: p.capacity[k].label, pct: Math.round(Math.max(cbm / p.capacity[k].cbm, kg / p.capacity[k].kg) * 100) })); return { n: xs.length, cbm: Math.round(cbm * 10) / 10, kg, fit, best: fit.find((f) => f.pct <= 95) ?? null } }, [p, sel])
  if (err) return <p role="alert" className="text-sm text-danger">{err}</p>
  if (!p) return <NoData>Loading the planner…</NoData>
  const loadInto = async (id: string, ids: string[]) => { setMsg(''); try { await containersApi.load(id, ids); setMsg(`Loaded ${ids.length} shipment${ids.length === 1 ? '' : 's'}.`); load() } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not load.') } }
  return (
    <div className="space-y-6" data-testid="planner">
      {msg && <p role="status" className="text-sm text-teal">{msg}</p>}
      <Panel title="Open containers" sub="Fill by volume or weight, whichever is higher. Suggestions take the earliest-ready waiting shipments that fit." testid="planner-containers">
        {p.containers.length ? <ul className="grid gap-4 md:grid-cols-2">{p.containers.map((c) => (
          <li key={c.id} className={`rounded-xl border p-4 ${c.warning ? 'border-danger/50' : 'border-border'}`} data-testid="planner-container">
            <p className="flex items-center justify-between gap-2"><Link to={`/dashboard/containers/${c.id}`} className="font-semibold hover:underline">{c.ref}{c.number ? ` · ${c.number}` : ''}</Link><span className="text-xs text-text-muted">{c.sizeLabel} · {c.shipments} shipments</span></p>
            <div className="mt-2"><Bar pct={c.fillPct} warn={c.warning} /></div>
            <p className="mt-1 text-xs text-text-muted"><b className="text-text">{c.fillPct}% full</b> · {c.cbm} of {c.capacityCbm} m³ · {c.kg.toLocaleString()} of {c.capacityKg.toLocaleString()} kg{c.cutoff ? ` · cutoff ${c.daysToCutoff != null && c.daysToCutoff >= 0 ? `in ${c.daysToCutoff} d` : c.cutoff}` : ''}</p>
            {c.warning && <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-danger"><AlertTriangle size={12} aria-hidden="true" /> Under 60% full with cutoff close — fill it or offer shared space.</p>}
            {c.suggest.length > 0 && <button type="button" onClick={() => loadInto(c.id, c.suggest)} className="btn-ghost mt-3 !min-h-9 text-sm" data-testid="planner-fill"><PackagePlus size={14} aria-hidden="true" /> Load {c.suggest.length} waiting → {c.suggestFillPct}%</button>}
          </li>
        ))}</ul> : <NoData>No containers are taking shipments. Book one under Containers, or use the sizing below.</NoData>}
      </Panel>
      <Panel title="Waiting for a container" sub={`${p.waiting.length} ocean shipments not loaded yet. Estimates use typical sizes where weight or dimensions are missing.`} testid="planner-waiting">
        {p.waiting.length ? <>
          <div className="-mx-5 overflow-x-auto px-5"><table className="w-full min-w-[34rem] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wider text-text-muted"><th className="px-2 py-2"><span className="sr-only">Select</span></th><th className="px-2 py-2">Shipment</th><th className="px-2 py-2">Cargo</th><th className="px-2 py-2">Ready</th><th className="px-2 py-2 text-right">m³</th><th className="px-2 py-2 text-right">kg</th></tr></thead>
            <tbody>{p.waiting.map((w) => <tr key={w.id} className="border-b border-border/60"><td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${w.ref}`} checked={sel.has(w.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(w.id); else n.delete(w.id); setSel(n) }} data-testid="planner-pick" /></td><td className="px-2 py-2"><b>{w.ref}</b><span className="block text-xs text-text-muted">{w.customer}</span></td><td className="px-2 py-2">{w.qty} × {w.cargo}</td><td className="px-2 py-2 text-text-muted">{w.readyDate ?? '—'}</td><td className="px-2 py-2 text-right tabular-nums">{w.cbm}{w.estimated ? <span className="text-text-muted">*</span> : ''}</td><td className="px-2 py-2 text-right tabular-nums">{w.kg.toLocaleString()}</td></tr>)}</tbody></table></div>
          {pick && pick.n > 0 ? (
            <div className="mt-4 rounded-lg bg-surface-2/60 p-3 text-sm" data-testid="planner-selection">
              <p><b>{pick.n} selected</b> · {pick.cbm} m³ · {pick.kg.toLocaleString()} kg · {pick.best ? <>fits a <b>{pick.best.label}</b> at {pick.best.pct}%</> : <span className="text-danger">more than one 40ft high cube</span>}</p>
              <ul className="mt-2 space-y-1.5">{pick.fit.map((f) => <li key={f.k} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-xs"><span>{f.label}</span><Bar pct={f.pct} warn={f.pct > 95} /><span className="text-right tabular-nums">{f.pct}%</span></li>)}</ul>
              {p.containers.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{p.containers.map((c) => <button key={c.id} type="button" onClick={() => loadInto(c.id, [...sel])} className="btn-ghost !min-h-8 !px-3 text-xs">Load into {c.ref}</button>)}</div>}
            </div>
          ) : p.leftover.recommend && <p className="mt-4 text-sm text-text-muted" data-testid="planner-recommend">After the suggestions above, {p.leftover.shipments} shipment{p.leftover.shipments === 1 ? '' : 's'} ({p.leftover.cbm} m³) are left — {p.leftover.recommend.containers > 1 ? `${p.leftover.recommend.containers} × ` : 'a '}{p.leftover.recommend.label} at {p.leftover.recommend.fillPct}%. Tick shipments to size your own selection.</p>}
        </> : <NoData>Nothing waiting — every booked ocean shipment is in a container.</NoData>}
      </Panel>
    </div>
  )
}
