import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, Banknote, Check, Clock, Fuel, MessageSquare, ShieldAlert, Truck, UsersRound } from 'lucide-react'
import { useStore } from '../lib/store'
import { isDriverRole } from '../lib/roles'
import { driverApi, type DriverPos, type Expense, type Incident, type Shift } from '../lib/driverApi'
import { fadeUp, stagger } from '../lib/motion'
import { BrandLoader } from '../components/BrandLoader'
import { StatCard, Th, thead, trow } from '../components/board'
import { fmtDateTime } from '../components/ui'
import RunMap from '../components/RunMap'
import { AnalyticsTab } from '../components/driver/OfficeHr'

const money = (n: number, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n) } catch { return `${cur} ${n}` } }
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">{children}</p>
type Tab = 'road' | 'cash' | 'analytics'
const TABS: [Tab, string][] = [['road', 'On the road'], ['cash', 'Cash & expenses'], ['analytics', 'Analytics']]
/** Pay, hours, rota and HR files moved to Team & HR — old links still land in the right place. */
const MOVED: Record<string, string> = { payroll: 'payroll', time: 'hours', rota: 'rota', people: 'people' }

/** Office view of the drivers on the job: where they are, what they've said, cash to hand in, expenses and performance. HR lives in Team & HR. */
export default function Drivers() {
  const { ready, user } = useStore(); const nav = useNavigate()
  const [sp, setSp] = useSearchParams(); const moved = MOVED[sp.get('tab') ?? '']; const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'road') as Tab
  const [pos, setPos] = useState<DriverPos[] | null>(null); const [msgs, setMsgs] = useState<Awaited<ReturnType<typeof driverApi.allMessages>>['messages']>([]); const [inc, setInc] = useState<Incident[]>([])
  const [cash, setCash] = useState<Awaited<ReturnType<typeof driverApi.cash>> | null>(null); const [shifts, setShifts] = useState<(Shift & { name: string })[]>([]); const [exp, setExp] = useState<Expense[]>([])
  const [err, setErr] = useState(''); const [toast, setToast] = useState('')
  const load = () => {
    driverApi.positions().then((r) => setPos(r.drivers)).catch((e) => { setPos([]); setErr(e instanceof Error ? e.message : 'Could not load.') })
    driverApi.allMessages().then((r) => setMsgs(r.messages)).catch(() => {})
    driverApi.incidents().then((r) => setInc(r.incidents)).catch(() => {})
    driverApi.cash().then(setCash).catch(() => {})
    driverApi.shifts().then((r) => setShifts(r.shifts)).catch(() => {})
    driverApi.expenses().then((r) => setExp(r.expenses)).catch(() => {})
  }
  useEffect(() => { if (!ready || user?.role !== 'shipper') return; load(); const x = setInterval(() => { if (document.visibilityState === 'visible') driverApi.positions().then((r) => setPos(r.drivers)).catch(() => {}) }, 30000); return () => clearInterval(x) }, [ready, user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (toast) { const x = setTimeout(() => setToast(''), 4000); return () => clearTimeout(x) } }, [toast])
  if (moved) return <Navigate to={`/dashboard/hr?tab=${moved}${sp.get('p') ? `&p=${sp.get('p')}` : ''}`} replace />
  if (!ready) return <BrandLoader />
  if (!user || user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  if (isDriverRole(user.staffRole)) return <Navigate to="/dashboard/runs" replace />
  if (!pos) return <BrandLoader label="Loading drivers…" />
  const openInc = inc.filter((i) => i.status === 'open'); const unread = msgs.filter((m) => m.unread).length
  const cashDue = (cash?.drivers ?? []).reduce((n, d) => n + d.due, 0)
  const weekHours = Math.round(shifts.filter((s) => Date.now() - new Date(s.start).getTime() < 7 * 86400000).reduce((n, s) => n + s.hours, 0) * 10) / 10

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p variants={fadeUp} className="eyebrow mb-1">Drivers</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{pos.length ? `${pos.length} on the road now` : 'Nobody on the road right now'}</motion.h1>
          <motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Live positions while drivers have the app open, their messages and problem reports, cash to hand in, expenses and performance.</motion.p>
          <motion.p variants={fadeUp} className="mt-3"><Link to="/dashboard/hr" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-gold" data-testid="to-hr"><UsersRound size={14} className="text-gold-deep" aria-hidden="true" /> Pay, hours, rota and HR files are in <b>Team &amp; HR</b> <ArrowRight size={14} aria-hidden="true" /></Link></motion.p>
          {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
          {toast && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}

          <motion.div variants={fadeUp} className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="On the road" value={pos.length} hint={unread ? `${unread} unread message${unread === 1 ? '' : 's'}` : 'Live while the app is open'} icon={Truck} active={tab === 'road'} warn={unread > 0} onClick={() => setSp({ tab: 'road' })} />
            <StatCard label="Open problems" value={openInc.length} hint={openInc.length ? 'Reported by drivers' : 'Nothing reported'} icon={ShieldAlert} warn={openInc.length > 0} onClick={() => setSp({ tab: 'road' })} />
            <StatCard label="Cash to hand in" value={money(cashDue)} hint={`${cash?.drivers.length ?? 0} driver${cash?.drivers.length === 1 ? '' : 's'}`} icon={Banknote} active={tab === 'cash'} warn={cashDue > 0} onClick={() => setSp({ tab: 'cash' })} />
            <StatCard label="Hours this week" value={weekHours} hint="From clock-ins — open in Team & HR" icon={Clock} onClick={() => nav('/dashboard/hr?tab=hours')} />
          </motion.div>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Driver views">
            {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })} className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-gold text-text' : 'border-transparent text-text-muted hover:text-text'}`} data-testid={`dtab-${k}`}>{l}</button>)}
          </motion.div>

          <div className="mt-6" role="tabpanel">
            {tab === 'road' && <Road pos={pos} msgs={msgs} inc={inc} onInc={async (i) => { await driverApi.closeIncident(i.id, i.status === 'open' ? 'closed' : 'open'); setInc((x) => x.map((y) => (y.id === i.id ? { ...y, status: y.status === 'open' ? 'closed' : 'open' } : y))) }} />}
            {tab === 'cash' && <div className="grid gap-8">{cash && <Cash cash={cash} onDone={(m) => { setToast(m); driverApi.cash().then(setCash).catch(() => {}) }} />}<Expenses exp={exp} /></div>}
            {tab === 'analytics' && <AnalyticsTab />}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function Road({ pos, msgs, inc, onInc }: { pos: DriverPos[]; msgs: Awaited<ReturnType<typeof driverApi.allMessages>>['messages']; inc: Incident[]; onInc: (i: Incident) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section aria-labelledby="map-h">
        <h2 id="map-h" className="mb-2 !text-lg">Where they are</h2>
        {pos.length ? <RunMap start={null} stops={[]} trucks={pos.map((p) => ({ id: p.staffId, label: `${p.name} · ${p.runName} · ${p.pending} left · ${ago(p.at)}`, lat: p.lat, lon: p.lon }))} className="h-[360px]" /> : <Empty>No live positions. Drivers share their location while a run is in progress and the app is open.</Empty>}
        {pos.length > 0 && <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">{pos.map((p) => <li key={p.staffId} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm" data-testid="pos-row"><b>{p.name}</b><span className="text-text-muted">{p.kind === 'pickup' ? 'Pickups' : 'Deliveries'} · {p.pending} stops left · seen {ago(p.at)}</span><Link to={`/dashboard/routes/${p.runId}`} className="ml-auto font-semibold text-gold-deep hover:underline">{p.runName}</Link></li>)}</ul>}
      </section>
      <div className="grid content-start gap-6">
        <section aria-labelledby="msg-h">
          <h2 id="msg-h" className="mb-2 flex items-center gap-2 !text-lg"><MessageSquare size={18} aria-hidden="true" /> Messages</h2>
          {msgs.length ? <ul className="space-y-2">{msgs.slice(0, 12).map((m) => <li key={m.id} className={`rounded-xl border p-3 text-sm ${m.unread ? 'border-gold/60 bg-gold/5' : 'border-border bg-surface'}`} data-testid="office-msg"><p className="text-xs text-text-muted">{m.from} · {m.runName}{m.stopLabel ? ` · ${m.stopLabel}` : ''} · {fmtDateTime(m.at)}</p>{m.body && <p className="mt-1">{m.body}</p>}{m.audio && <audio controls src={m.audio} className="mt-1 h-9 w-full" aria-label={`Voice note from ${m.from}`} />}<Link to={`/dashboard/routes/${m.runId}`} className="mt-1 inline-block text-xs font-semibold text-gold-deep hover:underline">Reply on the run</Link></li>)}</ul> : <Empty>No messages in the last 3 days.</Empty>}
        </section>
        <section aria-labelledby="inc-h">
          <h2 id="inc-h" className="mb-2 flex items-center gap-2 !text-lg"><AlertTriangle size={18} aria-hidden="true" /> Problems reported</h2>
          {inc.length ? <ul className="space-y-2">{inc.slice(0, 20).map((i) => <li key={i.id} className={`rounded-xl border p-3 text-sm ${i.status === 'open' ? 'border-danger/40 bg-surface' : 'border-border bg-surface opacity-75'}`} data-testid="incident-row">
            <p className="flex flex-wrap items-center gap-2"><b className="capitalize">{i.kind}</b>{i.ref && <span className="font-mono text-xs">{i.ref}</span>}{i.claim && <span className="rounded-full bg-gold/15 px-2 text-xs font-semibold text-gold-deep">Claim opened</span>}<span className="ml-auto text-xs text-text-muted">{i.by} · {fmtDateTime(i.at)}</span></p>
            <p className="mt-1">{i.description}</p>
            {i.photos.length > 0 && <div className="mt-2 flex gap-2">{i.photos.map((p, n) => <a key={n} href={p} target="_blank" rel="noreferrer"><img src={p} alt={`Photo ${n + 1} of the ${i.kind} report`} className="h-16 w-16 rounded-lg object-cover" /></a>)}</div>}
            <button onClick={() => onInc(i)} className="btn-ghost mt-2 !min-h-8 !px-3 text-xs">{i.status === 'open' ? 'Mark handled' : 'Reopen'}</button>
          </li>)}</ul> : <Empty>Nothing reported.</Empty>}
        </section>
      </div>
    </div>
  )
}

function Cash({ cash, onDone }: { cash: Awaited<ReturnType<typeof driverApi.cash>>; onDone: (m: string) => void }) {
  const [got, setGot] = useState<Record<string, string>>({}); const [note, setNote] = useState<Record<string, string>>({}); const [deduct, setDeduct] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(''); const [err, setErr] = useState('')
  const confirm = async (staffId: string, due: number) => {
    const n = Number(got[staffId] ?? due); if (Number.isNaN(n)) return
    setBusy(staffId); setErr('')
    try { const r = await driverApi.handover(staffId, n, note[staffId] ?? '', !!deduct[staffId]); onDone(r.diff === 0 ? `Handover confirmed: ${money(r.received)}.` : `Recorded — ${r.diff < 0 ? `${money(-r.diff)} short` : `${money(r.diff)} over`}. The owner and finance were told.`) } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy('') }
  }
  return (
    <div className="grid gap-6">
      <section aria-labelledby="due-h">
        <h2 id="due-h" className="mb-2 !text-lg">Cash still with drivers</h2>
        {err && <p role="alert" className="mb-2 text-sm text-danger">{err}</p>}
        {cash.drivers.length ? <div className="grid gap-3 md:grid-cols-2">{cash.drivers.map((d) => (
          <div key={d.staffId} className="rounded-xl border border-border bg-surface p-4" data-testid="cash-driver">
            <p className="flex items-baseline justify-between"><b>{d.name}</b><span className="text-xl font-bold tabular-nums">{money(d.due)}</span></p>
            <ul className="mt-2 text-xs text-text-muted">{d.stops.map((s) => <li key={s.stopId}>{s.label} · {s.runName} · {money(s.amountUsd)}</li>)}</ul>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <div><label htmlFor={`got-${d.staffId}`} className="label-dark">Counted (USD)</label><input id={`got-${d.staffId}`} inputMode="decimal" className="input-dark tabular-nums" value={got[d.staffId] ?? String(d.due)} onChange={(e) => setGot((x) => ({ ...x, [d.staffId]: e.target.value.replace(/[^\d.]/g, '') }))} data-testid="cash-got" /></div>
              <button onClick={() => confirm(d.staffId, d.due)} disabled={busy === d.staffId} className="btn-gold self-end !min-h-11 text-sm" data-testid="cash-confirm"><Check size={15} aria-hidden="true" /> Confirm</button>
              <div className="col-span-2"><label htmlFor={`note-${d.staffId}`} className="label-dark">Note (if it doesn’t match)</label><input id={`note-${d.staffId}`} className="input-dark" value={note[d.staffId] ?? ''} onChange={(e) => setNote((x) => ({ ...x, [d.staffId]: e.target.value }))} /></div>
              {Number(got[d.staffId] ?? d.due) < d.due && <label className="col-span-2 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!deduct[d.staffId]} onChange={(e) => setDeduct((x) => ({ ...x, [d.staffId]: e.target.checked }))} data-testid="cash-deduct" /> Take the {money(d.due - Number(got[d.staffId] ?? d.due))} short from their next payslip</label>}
            </div>
          </div>))}</div> : <Empty>No cash waiting — every collection has been handed in.</Empty>}
      </section>
      <section aria-labelledby="hand-h">
        <h2 id="hand-h" className="mb-2 !text-lg">Handovers (last 35 days)</h2>
        {cash.handovers.length ? <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[560px] text-sm"><thead className={thead}><tr><Th>Driver</Th><Th>Expected</Th><Th>Received</Th><Th>Difference</Th><Th>Confirmed by</Th></tr></thead><tbody>{cash.handovers.map((h) => <tr key={h.id} className={trow()}><td className="px-3 py-3">{h.name}</td><td className="px-3 py-3 tabular-nums">{money(h.expected)}</td><td className="px-3 py-3 tabular-nums">{money(h.received)}</td><td className={`px-3 py-3 font-semibold tabular-nums ${h.diff ? 'text-danger' : 'text-teal'}`}>{h.diff ? `${h.diff > 0 ? '+' : '−'}${money(Math.abs(h.diff))}` : 'Matches'}{h.note ? <span className="block text-xs font-normal text-text-muted">{h.note}</span> : null}</td><td className="px-3 py-3 text-text-muted">{h.by} · {fmtDateTime(h.at)}</td></tr>)}</tbody></table></div> : <Empty>No handovers yet.</Empty>}
      </section>
    </div>
  )
}

function Expenses({ exp }: { exp: Expense[] }) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="ex-h">
        <h2 id="ex-h" className="mb-2 flex items-center gap-2 !text-lg"><Fuel size={18} aria-hidden="true" /> Expenses (last 35 days)</h2>
        {exp.length ? <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[560px] text-sm"><thead className={thead}><tr><Th>Driver</Th><Th>What</Th><Th>Amount</Th><Th>Receipt</Th><Th>When</Th></tr></thead><tbody>{exp.map((e) => <tr key={e.id} className={trow()} data-testid="exp-row"><td className="px-3 py-3">{e.name}</td><td className="px-3 py-3 capitalize">{e.kind}{e.note ? <span className="block text-xs normal-case text-text-muted">{e.note}</span> : null}</td><td className="px-3 py-3 tabular-nums">{money(e.amount, e.currency)}{e.currency !== 'USD' && <span className="block text-xs text-text-muted">≈ {money(e.amountUsd)}</span>}</td><td className="px-3 py-3">{e.photo ? <a href={e.photo} target="_blank" rel="noreferrer"><img src={e.photo} alt={`Receipt for ${e.kind}`} className="h-12 w-12 rounded object-cover" /></a> : '—'}</td><td className="px-3 py-3 text-text-muted">{fmtDateTime(e.at)}</td></tr>)}</tbody></table></div> : <Empty>No expenses logged. They also appear in Costs &amp; profit.</Empty>}
      </section>
    </div>
  )
}


