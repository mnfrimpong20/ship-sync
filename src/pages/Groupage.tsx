import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Boxes, Check, Container, Package, Ship, Users } from 'lucide-react'
import { groupageApi, unitsLabel, type Groupage, type GroupageKindInfo, type Spot } from '../lib/groupage'
import { useStore } from '../lib/store'
import { countries } from '../lib/data'
import { Avatar, Empty, Pill, fmtDate, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

const kindIcon = { barrel: Package, container20: Container, container40: Container } as const
const day = (d: string | null) => (d ? fmtDate(d + 'T12:00:00Z') : '—')

/** Fill bar shared by the public cards and the shipper board. */
export function FillBar({ g, compact = false }: { g: Pick<Groupage, 'fillPct' | 'reserved' | 'capacity' | 'unitPlural' | 'left' | 'unit' | 'status'>; compact?: boolean }) {
  const full = g.fillPct >= 100
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={g.fillPct} aria-valuemin={0} aria-valuemax={100} aria-label="Filled"><div className={`h-full rounded-full ${full ? 'bg-teal' : 'bg-gold'}`} style={{ width: `${g.fillPct}%` }} /></div>
      {!compact && <p className="mt-1 flex justify-between text-[11px] text-text-muted"><span>{g.reserved}/{g.capacity} {g.unitPlural} filled</span><span>{full ? 'Full' : `${unitsLabel(g, g.left)} left`}</span></p>}
    </div>
  )
}

export function GroupageCard({ g, onJoin }: { g: Groupage; onJoin?: (g: Groupage) => void }) {
  const I = kindIcon[g.kind]
  return (
    <div className="card-dark flex h-full min-w-0 flex-col p-5" data-testid="groupage-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {g.shipperInitials && <Avatar initials={g.shipperInitials} hue={g.shipperHue ?? '#E3B54A'} size={40} />}
          <div className="min-w-0"><p className="truncate font-semibold">{g.title}</p><p className="truncate text-xs text-text-muted">{g.shipperName}{g.shipperVerified ? ' · verified' : ''}</p></div>
        </div>
        <Pill tone={g.status === 'full' ? 'teal' : 'gold'}>{g.status === 'full' ? 'Full' : 'Open'}</Pill>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-sm"><I size={14} className="mt-1 shrink-0 text-gold" aria-hidden="true" /><span className="line-clamp-2">{g.kindLabel} · {g.origin} → {g.destinationCity || g.destinationName}</span></p>
      <div className="mt-3"><FillBar g={g} /></div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-text-muted">Per {g.unit}</dt><dd className="font-semibold tabular-nums">{money(g.pricePerUnitUsd)}</dd></div>
        <div><dt className="text-text-muted">Closes</dt><dd className="font-semibold">{day(g.closesAt)}</dd></div>
        <div><dt className="text-text-muted">Sails</dt><dd className="font-semibold">{day(g.departsAt)}</dd></div>
      </dl>
      {g.includes.length > 0 && <p className="mt-2 line-clamp-2 text-xs text-text-muted">Includes {g.includes.join(', ')}.</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Users size={12} aria-hidden="true" /> {g.participants} {g.participants === 1 ? 'person' : 'people'} in</span>
        {onJoin && <button onClick={() => onJoin(g)} disabled={g.status !== 'open'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60" data-testid="join">{g.status === 'open' ? 'Reserve space' : 'Full'}</button>}
      </div>
    </div>
  )
}

function JoinDialog({ g, onClose, onDone }: { g: Groupage; onClose: () => void; onDone: (s: Spot, g: Groupage) => void }) {
  const { user } = useStore(); const nav = useNavigate()
  const [f, setF] = useState({ units: g.minUnits, description: '', phone: '', pickup: false })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const total = Math.round(f.units * g.pricePerUnitUsd * 100) / 100
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { const r = await groupageApi.join(g.id, f); onDone(r.spot, r.groupage) } catch (err) { setError(err instanceof Error ? err.message : 'Could not reserve.') } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="join-h" className="card-dark w-full max-w-md p-6" data-testid="join-dialog">
        <h2 id="join-h" className="!text-lg">Reserve space in {g.title}</h2>
        <p className="mt-1 text-sm text-text-muted">{money(g.pricePerUnitUsd)} per {g.unit} · {unitsLabel(g, g.left)} left · min {g.minUnits}{g.maxUnits ? `, max ${g.maxUnits}` : ''} per person.</p>
        {!user ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-2/40 p-4 text-sm"><p>Sign in or create a free account so your space gets a tracking reference and a payment link when the slot closes.</p><div className="mt-3 flex gap-2"><button onClick={() => nav(`/login?next=/groupage?join=${g.id}`)} className="btn-gold !min-h-9 !px-4 text-sm">Sign in</button><button onClick={() => nav(`/signup?next=/groupage?join=${g.id}`)} className="btn-ghost !min-h-9 !px-4 text-sm">Create account</button></div></div>
        ) : user.role !== 'customer' ? <p className="mt-4 text-sm text-danger">Shipper accounts can't reserve space — sign in as a customer.</p> : (
          <form onSubmit={submit} className="mt-4 grid gap-3">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <label className="text-xs text-text-muted">How many {g.unitPlural}?<input type="number" min={g.minUnits} max={g.maxUnits ?? g.left} required aria-label="Units" className="input-dark mt-1 !min-h-10 text-sm tabular-nums" value={f.units} onChange={(e) => setF({ ...f, units: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="text-xs text-text-muted">What are you sending?<textarea required minLength={2} rows={2} aria-label="What are you sending" className="input-dark mt-1 py-2 text-sm" placeholder="e.g. 2 boxes of clothes and shoes for family in Kumasi" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="text-xs text-text-muted">Phone / WhatsApp<input required minLength={7} aria-label="Phone" className="input-dark mt-1 !min-h-10 text-sm" placeholder="+1 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.checked })} /> I’d like a pickup rather than dropping off</label>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm"><span className="text-text-muted">Total when booked</span><strong className="tabular-nums" data-testid="join-total">{money(total)}</strong></div>
            <p className="text-[11px] text-text-muted">Nothing is charged now. When {g.shipperName} closes the slot (by {day(g.closesAt)}) you get a shipment reference and pay from your dashboard — held in escrow until it sails.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost !min-h-10 !px-4 text-sm">Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy ? 'Reserving…' : `Reserve ${unitsLabel(g, f.units)}`}</button></div>
          </form>
        )}
      </div>
    </div>
  )
}

/** `/groupage` — public "fill a barrel" marketplace. */
export default function GroupagePage() {
  const [sp, setSp] = useSearchParams()
  const [data, setData] = useState<{ groupages: Groupage[]; kinds: GroupageKindInfo[] } | null>(null)
  const [error, setError] = useState('')
  const [dest, setDest] = useState(sp.get('destination') ?? '')
  const [kind, setKind] = useState(sp.get('kind') ?? '')
  const [joining, setJoining] = useState<Groupage | null>(null)
  const [toast, setToast] = useState('')
  const load = () => groupageApi.list({ destination: dest, kind }).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [dest, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const j = sp.get('join'); if (j && data) { const g = data.groupages.find((x) => x.id === j); if (g) setJoining(g); const n = new URLSearchParams(sp); n.delete('join'); setSp(n, { replace: true }) } }, [sp, data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t) }, [toast])
  const list = data?.groupages ?? []
  const dests = useMemo(() => countries.filter((c) => list.some((g) => g.destination === c.code) || c.code === dest), [list, dest])
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Fill a barrel</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">Sending less than a barrel? Share one.</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Shippers open shared barrels and containers on their regular sailings. Reserve the space you need, pay only for it, and track your pieces like any other shipment.</motion.p>
        </motion.div>
        {toast && <p role="status" className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 max-w-5xl">
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
            <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => setDest(e.target.value)}><option value="">Any destination</option>{(dests.length ? dests : countries).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select>
            <select aria-label="Kind" className="input-dark !min-h-10 !w-auto text-sm" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Barrels & containers</option>{data?.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
            <span className="text-xs text-text-muted">{list.length} open {list.length === 1 ? 'slot' : 'slots'}</span>
          </motion.div>
          {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
          <motion.div variants={fadeUp} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
            {data && list.length === 0 && <div className="md:col-span-2 xl:col-span-3"><Empty title="No open slots on this lane right now" body="Try another destination, or request a quote and shippers will come to you." action={<Link to="/quote" className="btn-gold">Get a quote</Link>} /></div>}
            {list.map((g) => <GroupageCard key={g.id} g={g} onJoin={setJoining} />)}
          </motion.div>
          <motion.div variants={fadeUp} className="mt-10 grid gap-4 text-sm text-text-muted md:grid-cols-3">
            <div className="card-dark p-5"><Boxes size={18} className="text-gold" aria-hidden="true" /><p className="mt-2 font-semibold text-text">1. Reserve</p><p className="mt-1">Pick a slot on your lane and say how many bags, boxes or barrels. Nothing is charged yet.</p></div>
            <div className="card-dark p-5"><Ship size={18} className="text-gold" aria-hidden="true" /><p className="mt-2 font-semibold text-text">2. Drop off or get picked up</p><p className="mt-1">When the slot closes you get a shipment reference, a payment link (held in escrow) and a pickup booking.</p></div>
            <div className="card-dark p-5"><Check size={18} className="text-gold" aria-hidden="true" /><p className="mt-2 font-semibold text-text">3. Track to the door</p><p className="mt-1">Your pieces get stickers and scans like any shipment; the receiver gets texted when it lands.</p></div>
          </motion.div>
        </motion.div>
      </div>
      {joining && <JoinDialog g={joining} onClose={() => setJoining(null)} onDone={(s, g) => { setJoining(null); setToast(`Reserved ${unitsLabel(g, s.units)} in ${g.title}. We'll tell you when it's booked.`); void load() }} />}
    </div>
  )
}
