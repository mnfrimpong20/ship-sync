import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CalendarDays, Check, ChevronRight, Ellipsis, MapPinned, Play, Plus, Route as RouteIcon, Truck, User, UserX, X, XCircle } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, opsApi, runStatusLabels, type Run, type RunKind, type RunStatus, type Staff } from '../lib/ops'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { Chip, Confirm, Expander, Pager, SearchBox, StatCard, Th, thead, trow, usePaged } from '../components/board'

export const runTone: Record<RunStatus, 'sky' | 'gold' | 'green' | 'muted'> = { planned: 'sky', in_progress: 'gold', done: 'green', cancelled: 'muted' }
const today = () => new Date().toISOString().slice(0, 10)
const dayWord = (d: string) => { const n = Math.round((new Date(d + 'T12:00:00Z').getTime() - new Date(today() + 'T12:00:00Z').getTime()) / 86400000); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n < 0 ? `${-n}d ago` : `in ${n}d` }

/** Compact run card used by the driver's "My runs" page. */
export function RunRow({ r, to }: { r: Run; to: string }) {
  const done = r.stops.filter((s) => s.status !== 'pending').length
  return (
    <Link to={to} className="card-dark flex items-center gap-4 p-4 transition-colors hover:border-gold/40 focus-ring">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${r.kind === 'pickup' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold'}`} aria-hidden="true"><MapPinned size={20} /></span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">{r.name}<Pill tone={runTone[r.status]}>{runStatusLabels[r.status]}</Pill><span className="text-xs font-normal text-text-muted">{r.kind === 'pickup' ? 'Pickups' : 'Deliveries'}</span></p>
        <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1"><CalendarDays size={12} aria-hidden="true" /> {r.date ? fmtDate(r.date + 'T12:00:00Z') : '—'}</span>
          <span className="inline-flex items-center gap-1"><User size={12} aria-hidden="true" /> {r.driverName ?? 'No driver'}</span>
          <span className="inline-flex items-center gap-1"><Truck size={12} aria-hidden="true" /> {r.vehicleName ?? 'No vehicle'}</span>
          <span>{r.stops.length} stop{r.stops.length === 1 ? '' : 's'}{r.status !== 'planned' ? ` · ${done} done` : ''}{r.distanceKm ? ` · ${r.distanceKm} km` : ''}</span>
        </p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
    </Link>
  )
}

type Bucket = 'open' | 'today' | 'active' | 'unassigned' | 'done' | 'all'
type Sort = 'date' | 'newest' | 'progress' | 'name'
const PAGE = 10
const inBucket = (r: Run, b: Bucket) => b === 'all' ? true : b === 'open' ? r.status === 'planned' || r.status === 'in_progress' : b === 'today' ? r.date === today() && r.status !== 'cancelled' : b === 'active' ? r.status === 'in_progress' : b === 'unassigned' ? r.status === 'planned' && !r.driverId : r.status === 'done' || r.status === 'cancelled'

export default function Routes() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [team, setTeam] = useState<Staff[]>([])
  const bucket = (sp.get('b') as Bucket | null) ?? 'open'
  const q = sp.get('q') ?? ''; const kind = (sp.get('kind') as RunKind | null) ?? ''; const driver = sp.get('driver') ?? ''; const sort = (sp.get('sort') as Sort | null) ?? 'date'
  const set = (patch: Record<string, string | undefined>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) } setSp(n, { replace: true }) }
  const [typed, setTyped] = useState(q)
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) set({ q: typed }) }, 300); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ run: Run; status: RunStatus } | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const manage = canManageOps(user?.staffRole)
  useEffect(() => { if (!menu) return; const k = () => setMenu(null); window.addEventListener('click', k); return () => window.removeEventListener('click', k) }, [menu])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    Promise.all([opsApi.runs(), opsApi.team().catch(() => [] as Staff[])]).then(([r, t]) => { if (live) { setRuns(r); setTeam(t) } }).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load runs.'))
    return () => { live = false }
  }, [ready, user])

  const all = runs ?? []
  const counts = useMemo(() => ({ open: all.filter((r) => inBucket(r, 'open')).length, today: all.filter((r) => inBucket(r, 'today')).length, active: all.filter((r) => inBucket(r, 'active')).length, unassigned: all.filter((r) => inBucket(r, 'unassigned')).length, done: all.filter((r) => inBucket(r, 'done')).length, stops: all.filter((r) => r.status !== 'done' && r.status !== 'cancelled').reduce((n, r) => n + r.stops.filter((s) => s.status === 'pending').length, 0), overdue: all.filter((r) => r.status === 'planned' && r.date < today()).length }), [all])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const rows = all.filter((r) => inBucket(r, bucket) && (!kind || r.kind === kind) && (!driver || r.driverId === driver) && (!ql || [r.name, r.driverName ?? '', r.vehicleName ?? '', ...r.stops.map((s) => `${s.label} ${s.address} ${s.shipmentRef ?? ''}`)].join(' ').toLowerCase().includes(ql)))
    const prog = (r: Run) => (r.stops.length ? r.stops.filter((s) => s.status !== 'pending').length / r.stops.length : 0)
    rows.sort((a, b) => sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : sort === 'progress' ? prog(b) - prog(a) : sort === 'name' ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    return rows
  }, [all, bucket, kind, driver, q, sort])
  const p = usePaged(list, PAGE, `${bucket}|${kind}|${driver}|${q}|${sort}`)
  const drivers = team.filter((s) => s.role === 'driver')

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/routes" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (user.staffRole === 'driver') return <Navigate to="/dashboard/runs" replace />

  const setStatus = async (r: Run, status: RunStatus) => {
    setBusy(true); setError('')
    try { const u = await opsApi.updateRun(r.id, { status }); setRuns((x) => (x ?? []).map((y) => (y.id === r.id ? u : y))); setToast(`${r.name} ${status === 'in_progress' ? 'started' : status === 'done' ? 'marked done' : status === 'cancelled' ? 'cancelled' : 'updated'}.`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the run.') } finally { setBusy(false); setConfirm(null) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Route planning</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{counts.open === 0 ? 'No runs on the board' : `${counts.open} run${counts.open === 1 ? '' : 's'} on the board`}</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Group shipments into a day’s run, put the stops in the best order, and hand it to a driver. Drivers tick stops off from their phone.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><Link to="/dashboard/routes/new" className="btn-gold"><Plus size={16} aria-hidden="true" /> Plan a run</Link></motion.div>}
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}</AnimatePresence>
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Runs today" value={counts.today} hint={counts.today ? 'Scheduled for today' : 'Nothing scheduled today'} icon={CalendarDays} active={bucket === 'today'} onClick={() => set({ b: 'today' })} />
            <StatCard label="On the road now" value={counts.active} hint="Started, not yet finished" icon={Truck} active={bucket === 'active'} onClick={() => set({ b: 'active' })} />
            <StatCard label="Needs a driver" value={counts.unassigned} hint={counts.overdue ? `${counts.overdue} planned run${counts.overdue === 1 ? '' : 's'} past its date` : 'Planned runs without a driver'} icon={UserX} warn={counts.overdue > 0 || counts.unassigned > 0} active={bucket === 'unassigned'} onClick={() => set({ b: 'unassigned' })} />
            <StatCard label="Stops still to do" value={counts.stops} hint="Across all open runs" icon={RouteIcon} />
          </motion.div>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            <Chip active={bucket === 'open'} onClick={() => set({ b: undefined })} count={counts.open}>Planned & active</Chip>
            <Chip active={bucket === 'done'} onClick={() => set({ b: 'done' })} count={counts.done}>Completed</Chip>
            <Chip active={bucket === 'all'} onClick={() => set({ b: 'all' })} count={all.length}>All</Chip>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <SearchBox value={typed} onChange={setTyped} label="Search runs" placeholder="Search run, driver, vehicle, stop, shipment…" />
            <select aria-label="Kind" className="input-dark !min-h-10 !w-auto text-sm" value={kind} onChange={(e) => set({ kind: e.target.value })}><option value="">Pickups & deliveries</option><option value="pickup">Pickups</option><option value="delivery">Deliveries</option></select>
            {drivers.length > 0 && <select aria-label="Driver" className="input-dark !min-h-10 !w-auto text-sm" value={driver} onChange={(e) => set({ driver: e.target.value })}><option value="">All drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            <select aria-label="Sort" className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => set({ sort: e.target.value === 'date' ? undefined : e.target.value })}><option value="date">By date</option><option value="newest">Newest first</option><option value="progress">Most complete</option><option value="name">Name</option></select>
            {(q || kind || driver || bucket !== 'open') && <button onClick={() => { setTyped(''); setSp(new URLSearchParams(), { replace: true }) }} className="btn-ghost !min-h-10 !px-3 text-sm"><X size={14} aria-hidden="true" /> Reset</button>}
          </motion.div>

          <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead><tr className={thead}><Th className="w-8" /><Th>Run</Th><Th>Date</Th><Th>Driver</Th><Th>Vehicle</Th><Th>Stops</Th><Th>Distance</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {runs === null && !error && <tr><td colSpan={9} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>}
                  {runs && p.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10"><Empty title={all.length ? 'No runs match' : 'No runs planned yet'} body={all.length ? 'Try another filter or search.' : 'Plan your first run: pick the shipments that need collecting or delivering, and we’ll order the stops for you.'} action={manage && !all.length ? <Link to="/dashboard/routes/new" className="btn-gold !min-h-10 !px-4 text-sm">Plan a run</Link> : undefined} /></td></tr>}
                  {p.rows.map((r) => {
                    const done = r.stops.filter((s) => s.status !== 'pending').length; const isOpen = open === r.id; const late = r.status === 'planned' && r.date < today(); const closed = r.status === 'done' || r.status === 'cancelled'
                    return (
                      <Fragment key={r.id}>
                        <tr className={trow(isOpen, r.status === 'cancelled')}>
                          <td className="px-3 py-3"><Expander open={isOpen} onClick={() => setOpen(isOpen ? null : r.id)} label={`stops for ${r.name}`} /></td>
                          <td className="px-3 py-3"><Link to={`/dashboard/routes/${r.id}`} className="font-semibold hover:text-gold-deep focus-ring">{r.name}</Link><p className="mt-1"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.kind === 'pickup' ? 'bg-teal/15 text-teal' : 'bg-gold/15 text-gold-deep'}`}><MapPinned size={10} aria-hidden="true" /> {r.kind === 'pickup' ? 'Pickups' : 'Deliveries'}</span></p></td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums"><p>{r.date ? fmtDate(r.date + 'T12:00:00Z') : '—'}</p>{r.date && !closed && <p className={`text-[11px] ${late ? 'font-semibold text-danger' : 'text-text-muted'}`}>{late ? `${dayWord(r.date)} — not started` : dayWord(r.date)}</p>}</td>
                          <td className="px-3 py-3">{r.driverName ?? <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle size={12} aria-hidden="true" /> Unassigned</span>}</td>
                          <td className="px-3 py-3">{r.vehicleName ?? <span className="text-text-muted">—</span>}</td>
                          <td className="px-3 py-3"><div className="flex items-center gap-2"><span className="tabular-nums">{r.status === 'planned' ? r.stops.length : `${done}/${r.stops.length}`}</span><span className="h-1.5 w-20 overflow-hidden rounded-full bg-border" aria-hidden="true"><span className={`block h-full ${r.status === 'done' ? 'bg-teal' : 'bg-gold'}`} style={{ width: `${r.stops.length ? (done / r.stops.length) * 100 : 0}%` }} /></span></div></td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-text-muted">{r.distanceKm ? `${r.distanceKm} km` : '—'}</td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={runTone[r.status]}>{runStatusLabels[r.status]}</Pill></td>
                          <td className="px-3 py-3 text-right">
                            <div className="relative inline-flex items-center gap-1.5">
                              {manage && r.status === 'planned' && <button onClick={() => setStatus(r, 'in_progress')} disabled={busy} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs disabled:opacity-60"><Play size={12} aria-hidden="true" /> Start</button>}
                              {manage && r.status === 'in_progress' && <button onClick={() => (done < r.stops.length ? setConfirm({ run: r, status: 'done' }) : setStatus(r, 'done'))} disabled={busy} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs disabled:opacity-60"><Check size={12} aria-hidden="true" /> Mark done</button>}
                              <Link to={`/dashboard/routes/${r.id}`} className="btn-ghost !min-h-8 whitespace-nowrap !px-2.5 text-xs">Open <ChevronRight size={12} aria-hidden="true" /></Link>
                              {manage && !closed && (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); setMenu(menu === r.id ? null : r.id) }} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-haspopup="menu" aria-expanded={menu === r.id} aria-label={`More actions for ${r.name}`}><Ellipsis size={14} /></button>
                                  {menu === r.id && (
                                    <div role="menu" onClick={(e) => e.stopPropagation()} className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 text-left text-sm shadow-xl">
                                      <Link role="menuitem" to={`/dashboard/routes/${r.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2"><RouteIcon size={14} aria-hidden="true" /> Edit stops & driver</Link>
                                      {r.status === 'in_progress' && <button role="menuitem" onClick={() => { setMenu(null); setStatus(r, 'planned') }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"><CalendarDays size={14} aria-hidden="true" /> Back to planned</button>}
                                      <div className="my-1 border-t border-border" />
                                      <button role="menuitem" onClick={() => { setMenu(null); setConfirm({ run: r, status: 'cancelled' }) }} className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10"><XCircle size={14} aria-hidden="true" /> Cancel run…</button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={8} className="px-3 pb-5 pt-2">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Stops in order{r.start ? ` · from ${r.start.label}` : ''}</p>
                                {r.stops.length === 0 ? <p className="text-sm text-text-muted">No stops yet — open the run to add shipments.</p> : (
                                  <ol className="space-y-1.5 text-sm">{r.stops.map((s, i) => (
                                    <li key={s.id} className="flex items-start gap-2">
                                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${s.status === 'done' ? 'bg-teal text-white' : s.status === 'skipped' ? 'bg-border text-text-muted line-through' : 'bg-surface-2 text-text-muted'}`} aria-label={s.status}>{s.status === 'done' ? <Check size={11} /> : i + 1}</span>
                                      <span className="min-w-0"><span className={s.status === 'skipped' ? 'line-through text-text-muted' : ''}>{s.label}</span>{s.shipmentRef && <Link to={`/dashboard/shipments?q=${s.shipmentRef}&b=all`} className="ml-2 font-mono text-xs text-gold-deep hover:underline">{s.shipmentRef}</Link>}<span className="block text-xs text-text-muted">{s.address}{s.contact ? ` · ${s.contact}` : ''}{s.phone ? ` · ${s.phone}` : ''}{s.note ? ` — ${s.note}` : ''}</span></span>
                                    </li>
                                  ))}</ol>
                                )}
                              </div>
                              <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Run</p>
                                <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-text-muted">Driver</dt><dd>{r.driverName ?? '—'}</dd></div><div><dt className="text-text-muted">Vehicle</dt><dd>{r.vehicleName ?? '—'}</dd></div><div><dt className="text-text-muted">Distance</dt><dd>{r.distanceKm ? `${r.distanceKm} km` : '—'}</dd></div><div><dt className="text-text-muted">Progress</dt><dd>{done} of {r.stops.length} stops</dd></div></dl>
                                {r.notes && <p className="mt-3 border-t border-border pt-3 text-xs text-text-muted">{r.notes}</p>}
                                <Link to={`/dashboard/routes/${r.id}`} className="btn-ghost mt-3 !min-h-9 w-full text-xs">Open route map & stops</Link>
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager p={p} noun="run" />
          </motion.div>
        </motion.div>
      </div>
      {confirm && (
        <Confirm title={confirm.status === 'cancelled' ? `Cancel ${confirm.run.name}?` : `Finish ${confirm.run.name} early?`}
          body={confirm.status === 'cancelled' ? <p>The run is kept for the record as <strong>Cancelled</strong>. Shipments on it are not changed — plan them into another run.</p> : <p>{confirm.run.stops.filter((s) => s.status === 'pending').length} stop{confirm.run.stops.filter((s) => s.status === 'pending').length === 1 ? ' is' : 's are'} still pending. Marking the run done leaves those shipments where they are.</p>}
          confirmLabel={confirm.status === 'cancelled' ? 'Cancel run' : 'Mark done anyway'} danger={confirm.status === 'cancelled'} busy={busy} onClose={() => setConfirm(null)} onConfirm={() => setStatus(confirm.run, confirm.status)} />
      )}
    </div>
  )
}
