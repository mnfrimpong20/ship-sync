import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { CalendarClock, Check, Clock, FileCheck2, UserPlus, UsersRound, Wallet } from 'lucide-react'
import { useStore } from '../lib/store'
import { isDriverRole } from '../lib/roles'
import { hrApi, type Leave, type Person } from '../lib/driverHrApi'
import { driverApi } from '../lib/driverApi'
import { fadeUp, stagger } from '../lib/motion'
import { BrandLoader } from '../components/BrandLoader'
import { StatCard } from '../components/board'
import { HoursTab, PayrollTab, PeopleTab, RotaTab } from '../components/driver/OfficeHr'

type Tab = 'people' | 'hours' | 'rota' | 'payroll'
const TABS: [Tab, string][] = [['people', 'People'], ['hours', 'Hours'], ['rota', 'Rota & time off'], ['payroll', 'Payroll']]
const OFFICE = ['owner', 'dispatcher', 'finance']

/** Team & HR: one place for everyone's HR file, hours, rota and time off, and payroll — drivers and office staff alike. */
export default function TeamHr() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams(); const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'people') as Tab
  const [people, setPeople] = useState<Person[] | null>(null); const [leave, setLeave] = useState<Leave[]>([]); const [hours, setHours] = useState(0); const [toast, setToast] = useState('')
  const role = user?.staffRole ?? (user?.shipperId ? 'owner' : undefined)
  const office = !!role && OFFICE.includes(role)
  const load = () => {
    hrApi.people().then(setPeople).catch(() => setPeople([]))
    hrApi.leave().then(setLeave).catch(() => {})
    driverApi.shifts().then((r) => setHours(Math.round(r.shifts.filter((s) => Date.now() - new Date(s.start).getTime() < 7 * 86400000).reduce((n, s) => n + s.hours, 0) * 10) / 10)).catch(() => {})
  }
  useEffect(() => { if (ready && user?.role === 'shipper' && office) load() }, [ready, user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(''), 4000); return () => clearTimeout(x) }, [toast])
  if (!ready) return <BrandLoader />
  if (!user || user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (isDriverRole(role)) return <Navigate to="/dashboard/runs/pay" replace />
  if (!office) return <Navigate to="/dashboard/me/pay" replace />
  const active = (people ?? []).filter((p) => p.status !== 'offboarded')
  const toCheck = (people ?? []).reduce((n, p) => n + p.checklist.filter((c) => !c.done).length, 0)
  const expiring = (people ?? []).filter((p) => p.expiringSoon.length).length
  const waiting = leave.filter((l) => l.status === 'pending').length
  const drivers = active.filter((p) => p.isDriver).length

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">Team &amp; HR</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{people ? `${active.length} ${active.length === 1 ? 'person' : 'people'} on staff` : 'Your staff'}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">HR files and papers, hours, rota and time off, and payroll for your staff — {drivers} driver{drivers === 1 ? '' : 's'} and {active.length - drivers} in the office and warehouse. The owner isn’t counted here. Invite people and set what they can see on <Link to="/dashboard/team" className="underline">Team</Link>.</motion.p>
          {toast && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {role === 'dispatcher' && <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-muted">As a dispatcher you see drivers’ pay. Office salaries are visible to the owner and finance only.</p>}

          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="People" value={active.length} hint={`${drivers} driver${drivers === 1 ? '' : 's'} · ${active.length - drivers} office & warehouse`} icon={UsersRound} active={tab === 'people'} onClick={() => setSp({ tab: 'people' })} />
            <StatCard label="Papers & onboarding" value={toCheck + expiring} hint={expiring ? `${expiring} with papers expiring` : toCheck ? `${toCheck} steps not done` : 'All up to date'} icon={FileCheck2} warn={expiring > 0} onClick={() => setSp({ tab: 'people' })} />
            <StatCard label="Time-off requests" value={waiting} hint={waiting ? 'Waiting for you' : 'Nothing waiting'} icon={CalendarClock} active={tab === 'rota'} warn={waiting > 0} onClick={() => setSp({ tab: 'rota' })} />
            <StatCard label="Hours this week" value={hours} hint="From clock-ins" icon={Clock} active={tab === 'hours'} onClick={() => setSp({ tab: 'hours' })} />
          </motion.div>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-end justify-between gap-2 border-b border-border">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Team & HR views">
              {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })} className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-gold text-text' : 'border-transparent text-text-muted hover:text-text'}`} data-testid={`hrtab-${k}`}>{k === 'payroll' && <Wallet size={14} aria-hidden="true" />}{l}{k === 'rota' && waiting > 0 && <span className="rounded-full bg-gold px-1.5 text-xs text-on-accent">{waiting}</span>}</button>)}
            </div>
            <Link to="/dashboard/team" className="mb-1.5 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-text-muted hover:bg-surface-2 hover:text-text"><UserPlus size={15} aria-hidden="true" /> Invite someone</Link>
          </motion.div>

          <div className="mt-6" role="tabpanel">
            {tab === 'people' && <PeopleTab open={sp.get('p')} onOpen={(id) => setSp(id ? { tab: 'people', p: id } : { tab: 'people' })} toast={(m) => { setToast(m); load() }} isOwner={role === 'owner'} canPay={['owner', 'finance'].includes(role!)} />}
            {tab === 'hours' && <HoursTab toast={setToast} />}
            {tab === 'rota' && <RotaTab toast={(m) => { setToast(m); load() }} />}
            {tab === 'payroll' && <PayrollTab toast={setToast} />}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
