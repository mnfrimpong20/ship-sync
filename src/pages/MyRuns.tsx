import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { MapPinned } from 'lucide-react'
import { useStore } from '../lib/store'
import { opsApi, type Run } from '../lib/ops'
import { Empty } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { RunRow } from './Routes'

/** The driver's view: only their own planned and in-progress runs, biggest tap targets first. */
export default function MyRuns() {
  const { ready, user } = useStore()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!ready || user?.role !== 'shipper') return
    let live = true
    opsApi.myRuns().then((r) => live && setRuns(r)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your runs.'))
    return () => { live = false }
  }, [ready, user])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/runs" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const today = new Date().toISOString().slice(0, 10)
  const active = (runs ?? []).filter((r) => r.status === 'in_progress')
  const upcoming = (runs ?? []).filter((r) => r.status === 'planned')
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">My runs</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Hi {user.name.split(' ')[0]}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 text-text-muted">{active.length ? `You have a run in progress.` : upcoming.some((r) => r.date === today) ? 'You have a run planned for today.' : 'Nothing on the road right now.'}</motion.p>
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          {active.length > 0 && <motion.section variants={fadeUp} className="mt-8" aria-label="In progress"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">In progress</p><ul className="space-y-2">{active.map((r) => <li key={r.id}><RunRow r={r} to={`/dashboard/routes/${r.id}`} /></li>)}</ul></motion.section>}
          <motion.section variants={fadeUp} className="mt-8" aria-label="Upcoming">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Upcoming</p>
            {runs && upcoming.length === 0 && <Empty title="No runs assigned" body="Your dispatcher will assign pickups and deliveries to you here." action={<span className="text-text-muted"><MapPinned size={16} className="inline" aria-hidden="true" /></span>} />}
            <ul className="space-y-2">{upcoming.map((r) => <li key={r.id}><RunRow r={r} to={`/dashboard/routes/${r.id}`} /></li>)}</ul>
          </motion.section>
        </motion.div>
      </div>
    </div>
  )
}
