import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarDays, ChevronRight, MapPinned, Plus, Route as RouteIcon, Truck, User } from 'lucide-react'
import { useStore } from '../lib/store'
import { canManageOps, opsApi, runStatusLabels, type Run, type RunStatus } from '../lib/ops'
import { Empty, Pill, fmtDate } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

export const runTone: Record<RunStatus, 'sky' | 'gold' | 'green' | 'muted'> = { planned: 'sky', in_progress: 'gold', done: 'green', cancelled: 'muted' }

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

export default function Routes() {
  const { ready, user } = useStore()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open')
  const [error, setError] = useState('')
  const manage = canManageOps(user?.staffRole)

  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    opsApi.runs().then((r) => live && setRuns(r)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load runs.'))
    return () => { live = false }
  }, [ready, user])

  const list = useMemo(() => (runs ?? []).filter((r) => filter === 'all' ? true : filter === 'open' ? r.status === 'planned' || r.status === 'in_progress' : r.status === 'done' || r.status === 'cancelled'), [runs, filter])

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/routes" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (user.staffRole === 'driver') return <Navigate to="/dashboard/runs" replace />

  const today = new Date().toISOString().slice(0, 10)
  const todayRuns = (runs ?? []).filter((r) => r.date === today && r.status !== 'cancelled')
  const inProgress = (runs ?? []).filter((r) => r.status === 'in_progress')
  const pendingStops = (runs ?? []).filter((r) => r.status !== 'done' && r.status !== 'cancelled').reduce((n, r) => n + r.stops.filter((s) => s.status === 'pending').length, 0)

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Route planning</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Pickup & delivery runs</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Group shipments into a day’s run, put the stops in the best order, and hand it to a driver.</motion.p></div>
            {manage && <motion.div variants={fadeUp}><Link to="/dashboard/routes/new" className="btn-gold"><Plus size={16} aria-hidden="true" /> Plan a run</Link></motion.div>}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Runs today</p><CalendarDays size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{todayRuns.length}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">On the road now</p><Truck size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{inProgress.length}</p></motion.div>
            <motion.div variants={fadeUp} className="card-dark p-5"><div className="flex items-center justify-between"><p className="text-sm text-text-muted">Stops still to do</p><RouteIcon size={18} className="text-gold" aria-hidden="true" /></div><p className="mt-2 font-heading text-3xl font-bold">{pendingStops}</p></motion.div>
          </div>

          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-2">
            {([['open', 'Planned & active'], ['done', 'Completed'], ['all', 'All']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${filter === k ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`}>{label}</button>
            ))}
          </motion.div>

          <motion.ul variants={fadeUp} className="mt-4 space-y-2" aria-label="Runs">
            {runs && list.length === 0 && <li><Empty title={runs.length ? 'Nothing here' : 'No runs planned yet'} body={runs.length ? 'Try another filter.' : 'Plan your first run: pick the shipments that need collecting or delivering, and we’ll order the stops for you.'} action={manage && !runs.length ? <Link to="/dashboard/routes/new" className="btn-gold !min-h-10 !px-4 text-sm">Plan a run</Link> : undefined} /></li>}
            {list.map((r) => <li key={r.id}><RunRow r={r} to={`/dashboard/routes/${r.id}`} /></li>)}
          </motion.ul>
        </motion.div>
      </div>
    </div>
  )
}
