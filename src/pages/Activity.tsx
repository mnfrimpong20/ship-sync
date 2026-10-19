import { BrandLoader } from '../components/BrandLoader'
import { Navigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { AuditTable } from '../components/AuditTable'
import { Panel } from '../components/Charts'

/** The company's activity log: every change your team made, newest first. */
export default function ActivityPage() {
  const { ready, user } = useStore()
  if (!ready) return <BrandLoader />
  if (!user) return <Navigate to="/login?next=/dashboard/activity" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Company</p><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Activity log</h1>
      <p className="mt-1 max-w-2xl text-text-muted">Who changed what and when — status changes, invoices, payments, team access, settings. Click a row for the details.</p>
      <Panel title="All changes" className="mt-6"><AuditTable admin={false} /></Panel>
    </div></div>
  )
}
