import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Filter, Inbox, Mail, Phone, Search, Send, Trophy, Users, X, XCircle } from 'lucide-react'
import { useStore, type Quote, type QuoteRequest } from '../lib/store'
import { cargoLabel, countries, countryByCode, type CargoType, type Mode } from '../lib/data'
import { Empty, ModeBadge, Pill, fmtDate, fmtDateTime, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'

type Bucket = 'all' | 'new' | 'quoted' | 'won' | 'lost' | 'open'
type Sort = 'newest' | 'ready' | 'oldest' | 'ref'
const PAGE = 10
const today = () => new Date().toISOString().slice(0, 10)

/** Where a lead stands for *this* shipper. */
type Stage = 'new' | 'quoted' | 'won' | 'lost'
const stageOf = (r: QuoteRequest, me: string): Stage => {
  const mine = r.quotes.find((q) => q.shipperId === me)
  if (mine?.status === 'accepted') return 'won'
  if (mine?.status === 'declined' || (r.status !== 'open' && !mine)) return 'lost'
  if (mine) return r.status === 'open' ? 'quoted' : 'lost'
  return 'new'
}
const stageLabel: Record<Stage, string> = { new: 'Needs reply', quoted: 'Quoted', won: 'Won', lost: 'Lost' }
const stageTone: Record<Stage, 'gold' | 'teal' | 'green' | 'muted'> = { new: 'gold', quoted: 'teal', won: 'green', lost: 'muted' }
const inBucket = (st: Stage, b: Bucket) => b === 'all' ? true : b === 'open' ? st === 'new' || st === 'quoted' : st === b
const age = (iso: string) => { const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000); return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago` }
const daysUntil = (d: string) => Math.ceil((new Date(d + 'T12:00:00Z').getTime() - Date.now()) / 86400000)

function QuoteForm({ r, onDone, onCancel }: { r: QuoteRequest; onDone: (msg: string) => void; onCancel: () => void }) {
  const { sendQuote, user, shipperById } = useStore()
  const tagline = user?.shipperId ? shipperById(user.shipperId)?.tagline ?? '' : ''
  const [form, setForm] = useState({ price: '', transit: r.mode === 'air' ? '7' : '30', notes: '', valid: '14' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const includes = [r.pickup ? 'Pickup' : 'Drop-off at warehouse', r.mode === 'air' ? 'Air freight' : 'Ocean freight', r.delivery ? 'Door delivery' : 'Port handling', ...(r.insurance ? ['All-risk insurance'] : [])]
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const price = Number(form.price), transit = Number(form.transit); if (!price || !transit) return
    setBusy(true); setError('')
    try { await sendQuote(r.id, { price, transitDays: transit, notes: form.notes || (tagline ? `${tagline}.` : ''), includes }); onDone(`Quote of ${money(price)} sent to ${r.contact.name}.`) } catch (err) { setError(err instanceof Error ? err.message : 'Could not send the quote.') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="grid gap-3" aria-label={`Quote for ${r.ref}`}>
      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`p-${r.id}`} className="label-dark">Total price (USD)</label><input id={`p-${r.id}`} type="number" min={1} required autoFocus className="input-dark !min-h-10 tabular-nums" placeholder="590" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        <div><label htmlFor={`t-${r.id}`} className="label-dark">Transit (days)</label><input id={`t-${r.id}`} type="number" min={1} required className="input-dark !min-h-10 tabular-nums" value={form.transit} onChange={(e) => setForm({ ...form, transit: e.target.value })} /></div>
      </div>
      <div><label htmlFor={`n-${r.id}`} className="label-dark">Notes to customer</label><textarea id={`n-${r.id}`} rows={2} className="input-dark py-2 text-sm" placeholder="Sailing date, what’s included, duty handling…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-text-muted"><span className="mr-1 font-semibold uppercase tracking-wider">Includes</span>{includes.map((i) => <Pill key={i} tone="muted">{i}</Pill>)}</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="btn-ghost !min-h-9 !px-3 text-xs"><X size={13} aria-hidden="true" /> Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60"><Send size={13} aria-hidden="true" /> {busy ? 'Sending…' : 'Send quote'}</button></div>
    </form>
  )
}

function MyQuote({ q }: { q: Quote }) {
  return (
    <div>
      <div className="flex items-baseline justify-between"><p className="font-heading text-2xl font-bold tabular-nums">{money(q.price)}</p><Pill tone={q.status === 'accepted' ? 'green' : q.status === 'declined' ? 'muted' : 'teal'}>{q.status === 'accepted' ? 'Accepted' : q.status === 'declined' ? 'Not chosen' : 'Awaiting customer'}</Pill></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-text-muted">Transit</dt><dd>{q.transitDays} days</dd></div><div><dt className="text-text-muted">Valid until</dt><dd>{q.validUntil ? fmtDate(q.validUntil + 'T12:00:00Z') : '—'}</dd></div><div className="col-span-2"><dt className="text-text-muted">Sent</dt><dd>{fmtDateTime(q.sentAt)}</dd></div></dl>
      {q.includes.length > 0 && <ul className="mt-3 flex flex-wrap gap-1.5">{q.includes.map((i) => <li key={i}><Pill tone="muted">{i}</Pill></li>)}</ul>}
      {q.notes && <p className="mt-3 text-xs text-text-muted">“{q.notes}”</p>}
    </div>
  )
}

export default function Leads() {
  const { ready, user, requests, shipments } = useStore()
  const [sp, setSp] = useSearchParams()
  const bucket = (sp.get('b') as Bucket | null) ?? 'open'
  const q = sp.get('q') ?? ''; const mode = (sp.get('mode') as Mode | 'either' | null) ?? ''; const dest = sp.get('destination') ?? ''; const sort = (sp.get('sort') as Sort | null) ?? 'newest'; const page = Math.max(1, Number(sp.get('page') ?? 1))
  const set = (patch: Record<string, string | undefined>, keepPage = false) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k) } if (!keepPage) n.delete('page'); setSp(n, { replace: true }) }
  const [typed, setTyped] = useState(q)
  useEffect(() => { const t = setTimeout(() => { if (typed !== q) set({ q: typed }) }, 300); return () => clearTimeout(t) }, [typed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(sp.get('open'))
  const [quoting, setQuoting] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) } }, [toast])

  const me = user?.shipperId ?? ''
  const rows0 = useMemo(() => requests.map((r) => ({ r, st: stageOf(r, me), mine: r.quotes.find((x) => x.shipperId === me) })), [requests, me])
  const counts = useMemo(() => {
    const n = (s: Stage) => rows0.filter((x) => x.st === s).length
    const won = n('won'), lost = n('lost'); const decided = won + lost
    const wonValue = rows0.filter((x) => x.st === 'won').reduce((a, x) => a + (x.mine?.price ?? 0), 0)
    return { new: n('new'), quoted: n('quoted'), won, lost, open: n('new') + n('quoted'), winRate: decided ? Math.round((won / decided) * 100) : null, wonValue, stale: rows0.filter((x) => x.st === 'new' && Date.now() - new Date(x.r.createdAt).getTime() > 24 * 3600000).length }
  }, [rows0])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const rows = rows0.filter(({ r, st }) => inBucket(st, bucket) && (!mode || r.mode === mode) && (!dest || r.destination === dest) && (!ql || [r.ref, r.contact.name, r.contact.email, r.description, r.origin, cargoLabel(r.cargo as CargoType), countryByCode(r.destination)?.name ?? ''].join(' ').toLowerCase().includes(ql)))
    rows.sort((a, b) => sort === 'ready' ? a.r.readyDate.localeCompare(b.r.readyDate) : sort === 'oldest' ? a.r.createdAt.localeCompare(b.r.createdAt) : sort === 'ref' ? a.r.ref.localeCompare(b.r.ref) : b.r.createdAt.localeCompare(a.r.createdAt))
    return rows
  }, [rows0, bucket, mode, dest, q, sort])
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); const cur = Math.min(page, pages)
  const rows = list.slice((cur - 1) * PAGE, cur * PAGE)

  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/leads" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />

  const shipmentFor = (r: QuoteRequest) => shipments.find((s) => s.requestId === r.id)
  const exportCsv = () => {
    const head = ['Ref', 'Status', 'Received', 'Mode', 'Origin', 'Destination', 'Cargo', 'Qty', 'Weight kg', 'Ready', 'Customer', 'Email', 'Phone', 'My quote', 'Transit days', 'Competing quotes']
    const lines = list.map(({ r, st, mine }) => [r.ref, stageLabel[st], r.createdAt.slice(0, 10), r.mode, r.origin, countryByCode(r.destination)?.name ?? r.destination, cargoLabel(r.cargo as CargoType), r.quantity, r.weightKg ?? '', r.readyDate, r.contact.name, r.contact.email, r.contact.phone, mine?.price ?? '', mine?.transitDays ?? '', r.competingQuotes ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `leads-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  const chip = (b: Bucket, label: string, n: number) => <button key={b} onClick={() => set({ b: b === 'open' ? undefined : b })} aria-pressed={bucket === b} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${bucket === b ? 'border-gold bg-gold/15 text-gold-deep font-semibold' : 'border-border text-text-muted hover:text-text'}`}>{label} <span className="tabular-nums opacity-70">{n}</span></button>
  const cards = [
    { b: 'new' as Bucket, l: 'Needs a reply', n: counts.new, h: counts.stale ? `${counts.stale} waiting over a day` : 'Customers see your response time', I: Inbox, warn: counts.stale > 0 },
    { b: 'quoted' as Bucket, l: 'Quoted, awaiting customer', n: counts.quoted, h: 'They compare and accept in their dashboard', I: Clock },
    { b: 'won' as Bucket, l: 'Won', n: counts.won, h: counts.wonValue ? `${money(counts.wonValue)} booked through quotes` : 'Accepted quotes become shipments', I: Trophy },
    { b: 'lost' as Bucket, l: 'Lost', n: counts.lost, h: 'Customer chose another shipper', I: XCircle },
    { b: 'all' as Bucket, l: 'Win rate', n: counts.winRate == null ? '—' : `${counts.winRate}%`, h: counts.winRate == null ? 'No decided quotes yet' : `${counts.won} won of ${counts.won + counts.lost} decided`, I: Users },
  ]

  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Leads & quotes</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{counts.new === 0 ? 'Inbox clear' : `${counts.new} lead${counts.new === 1 ? '' : 's'} waiting for a quote`}</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">Requests matching your lanes, the quotes you’ve sent and how they went. Reply fast — customers see your response time on your profile.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2"><button onClick={exportCsv} className="btn-ghost !min-h-10 !px-4 text-sm"><Download size={15} aria-hidden="true" /> Export CSV</button><Link to="/dashboard/shipper?view=profile" className="btn-ghost !min-h-10 !px-4 text-sm">Lanes & cargo</Link></motion.div>
          </div>

          <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</motion.p>}</AnimatePresence>

          <motion.div variants={fadeUp} className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {cards.map(({ b, l, n, h, I, warn }) => (
              <button key={b} onClick={() => set({ b: b === 'open' ? undefined : b })} aria-pressed={bucket === b} className={`card-dark p-4 text-left transition-colors hover:border-gold/40 focus-ring ${bucket === b ? '!border-gold' : ''} ${warn ? 'border-l-4 border-l-danger' : ''}`}>
                <div className="flex items-center justify-between"><p className="text-xs text-text-muted">{l}</p><I size={15} className={warn ? 'text-danger' : 'text-gold-deep'} aria-hidden="true" /></div>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{n}</p><p className="text-[11px] text-text-muted">{h}</p>
              </button>
            ))}
          </motion.div>

          <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
            {chip('open', 'Open', counts.open)}{chip('won', 'Won', counts.won)}{chip('lost', 'Lost', counts.lost)}{chip('all', 'All', rows0.length)}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <div className="relative min-w-[220px] flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" /><input aria-label="Search leads" className="input-dark !min-h-10 !pl-9 text-sm" placeholder="Search ref, customer, cargo, city…" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
            <select aria-label="Mode" className="input-dark !min-h-10 !w-auto text-sm" value={mode} onChange={(e) => set({ mode: e.target.value })}><option value="">Air & ocean</option><option value="ocean">Ocean</option><option value="air">Air</option><option value="either">Either</option></select>
            <select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => set({ destination: e.target.value })}><option value="">All destinations</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            <select aria-label="Sort" className="input-dark !min-h-10 !w-auto text-sm" value={sort} onChange={(e) => set({ sort: e.target.value === 'newest' ? undefined : e.target.value }, true)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="ready">Ready date</option><option value="ref">Reference</option></select>
            {(q || mode || dest || bucket !== 'open') && <button onClick={() => { setTyped(''); setSp(new URLSearchParams(), { replace: true }) }} className="btn-ghost !min-h-10 !px-3 text-sm"><Filter size={14} aria-hidden="true" /> Reset</button>}
          </motion.div>

          <motion.div variants={fadeUp} className="card-dark mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted"><th className="w-8 px-3 py-3" /><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Route</th><th className="px-3 py-3">Cargo</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Ready</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Competition</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-10"><Empty title={rows0.length ? 'No leads match' : 'No leads yet'} body={rows0.length ? 'Try another filter or search.' : 'Requests matching your origins, destinations and cargo types land here and by email. Widen your lanes on the company profile to see more.'} /></td></tr>}
                  {rows.map(({ r, st, mine }) => {
                    const d = countryByCode(r.destination); const isOpen = open === r.id; const days = daysUntil(r.readyDate); const sh = shipmentFor(r); const competing = r.competingQuotes ?? 0
                    return (
                      <Fragment key={r.id}>
                        <tr className={`border-b border-border/70 align-top transition-colors hover:bg-surface-2/60 ${isOpen ? 'bg-surface-2/40' : ''} ${st === 'lost' ? 'opacity-70' : ''}`}>
                          <td className="px-3 py-3"><button onClick={() => setOpen(isOpen ? null : r.id)} className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${r.ref}`}><ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button></td>
                          <td className="px-3 py-3"><span className="font-mono text-xs text-gold-deep">{r.ref}</span><div className="mt-1 flex items-center gap-1.5">{r.mode === 'either' ? <Pill tone="muted">Air or ocean</Pill> : <ModeBadge mode={r.mode} />}</div><p className="mt-1 text-[11px] text-text-muted">{age(r.createdAt)}</p></td>
                          <td className="whitespace-nowrap px-3 py-3"><p className="font-semibold">{r.origin}</p><p className="text-xs text-text-muted">→ {d?.name ?? r.destination}</p></td>
                          <td className="max-w-[280px] px-3 py-3"><p className="font-medium">{r.quantity} × {cargoLabel(r.cargo as CargoType)}{r.weightKg ? <span className="font-normal text-text-muted"> · ~{r.weightKg} kg</span> : null}</p><p className="truncate text-xs text-text-muted" title={r.description}>{r.description || '—'}</p></td>
                          <td className="px-3 py-3"><p>{r.contact.name}</p><p className="truncate text-xs text-text-muted" title={r.contact.email}>{r.contact.email}</p></td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums"><p>{fmtDate(r.readyDate + 'T12:00:00Z')}</p><p className={`text-[11px] ${days < 0 ? 'text-danger' : 'text-text-muted'}`}>{days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`}</p></td>
                          <td className="whitespace-nowrap px-3 py-3"><Pill tone={stageTone[st]}>{stageLabel[st]}</Pill>{mine && <p className="mt-1.5 text-xs tabular-nums text-text-muted">{money(mine.price)} · {mine.transitDays}d</p>}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs">{competing === 0 ? <span className="text-teal">No other quotes yet</span> : <span className="text-text-muted">{competing} competing quote{competing === 1 ? '' : 's'}</span>}</td>
                          <td className="px-3 py-3 text-right"><div className="inline-flex gap-1.5">
                            {st === 'new' && <button onClick={() => { setOpen(r.id); setQuoting(r.id) }} className="btn-gold !min-h-8 whitespace-nowrap !px-2.5 text-xs"><Send size={12} aria-hidden="true" /> Send quote</button>}
                            {st === 'won' && sh && <Link to={`/dashboard/shipments?q=${sh.ref}&b=all`} className="btn-ghost !min-h-8 whitespace-nowrap !px-2.5 text-xs">Shipment {sh.ref} <ChevronRight size={12} aria-hidden="true" /></Link>}
                            {(st === 'quoted' || st === 'lost' || (st === 'won' && !sh)) && <button onClick={() => setOpen(isOpen ? null : r.id)} className="btn-ghost !min-h-8 whitespace-nowrap !px-2.5 text-xs">{isOpen ? 'Hide' : 'Details'}</button>}
                            <a href={`mailto:${r.contact.email}?subject=${encodeURIComponent(`Your shipment request ${r.ref}`)}`} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-muted hover:text-text focus-ring" aria-label={`Email ${r.contact.name}`} title="Email customer"><Mail size={13} /></a>
                          </div></td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/70 bg-surface-2/30"><td /><td colSpan={8} className="px-3 pb-5 pt-2">
                            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div><p className="font-semibold">{r.quantity} × {cargoLabel(r.cargo as CargoType)} · {r.origin} → {d?.name ?? r.destination}</p><p className="mt-0.5 text-xs text-text-muted">Received {fmtDateTime(r.createdAt)} · ready {fmtDate(r.readyDate + 'T12:00:00Z')}{r.weightKg ? ` · ~${r.weightKg} kg` : ''}</p></div>
                                  <ul className="flex flex-wrap gap-1.5">{r.pickup && <li><Pill tone="muted">Pickup requested</Pill></li>}{r.delivery && <li><Pill tone="muted">Door delivery</Pill></li>}{r.insurance && <li><Pill tone="muted">Insurance</Pill></li>}</ul>
                                </div>
                                <p className="mt-3 text-sm">{r.description || <span className="text-text-muted">No description given.</span>}</p>
                                <div className="mt-4 grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-3">
                                  <div><p className="font-semibold uppercase tracking-wider text-text-muted">Contact</p><p className="mt-1">{r.contact.name}</p><p className="inline-flex items-center gap-1 text-text-muted"><Mail size={11} aria-hidden="true" /> <a href={`mailto:${r.contact.email}`} className="hover:text-gold-deep">{r.contact.email}</a></p>{r.contact.phone && <p className="inline-flex items-center gap-1 text-text-muted"><Phone size={11} aria-hidden="true" /> <a href={`tel:${r.contact.phone}`} className="hover:text-gold-deep">{r.contact.phone}</a></p>}</div>
                                  <div><p className="font-semibold uppercase tracking-wider text-text-muted">Competition</p><p className="mt-1">{competing === 0 ? 'You would be the first to quote.' : `${competing} other shipper${competing === 1 ? ' has' : 's have'} quoted. Prices are hidden from competitors.`}</p></div>
                                  <div><p className="font-semibold uppercase tracking-wider text-text-muted">Outcome</p><p className="mt-1">{st === 'won' ? (sh ? <>Booked as <Link to={`/dashboard/shipments?q=${sh.ref}&b=all`} className="text-gold-deep hover:underline">{sh.ref}</Link>.</> : 'Quote accepted — shipment being created.') : st === 'lost' ? 'The customer went with another quote or closed the request.' : st === 'quoted' ? 'Waiting for the customer to compare and accept.' : 'Open — send a quote to be considered.'}</p></div>
                                </div>
                              </div>
                              <div className="rounded-xl border border-border bg-surface p-4">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{mine ? 'Your quote' : 'Send a quote'}</p>
                                {mine ? <MyQuote q={mine} /> : st === 'new' && (quoting === r.id ? <QuoteForm r={r} onDone={(m) => { setQuoting(null); setToast(m) }} onCancel={() => setQuoting(null)} /> : <button onClick={() => setQuoting(r.id)} className="btn-gold !min-h-10 w-full text-sm"><Send size={14} aria-hidden="true" /> Quote this lead</button>)}
                                {!mine && st !== 'new' && <p className="text-sm text-text-muted">This request closed before you quoted.</p>}
                                {sh && <div className="mt-4 border-t border-border pt-3 text-xs"><Link to={`/track?ref=${sh.ref}`} className="inline-flex items-center gap-1 text-gold-deep hover:underline">Customer tracking page <ExternalLink size={11} aria-hidden="true" /></Link></div>}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-text-muted">
              <span>{list.length === 0 ? 'No results' : `Showing ${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, list.length)} of ${list.length}`}</span>
              {pages > 1 && <nav className="flex items-center gap-1" aria-label="Pagination"><button onClick={() => set({ page: String(cur - 1) }, true)} disabled={cur <= 1} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Previous page"><ChevronLeft size={14} /></button>{Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1).map((n, i, arr) => <span key={n} className="contents">{i > 0 && arr[i - 1] !== n - 1 && <span className="px-1">…</span>}<button onClick={() => set({ page: String(n) }, true)} aria-current={n === cur ? 'page' : undefined} className={`h-8 min-w-8 rounded-md border px-2 focus-ring ${n === cur ? 'border-gold bg-gold/15 font-semibold text-gold-deep' : 'border-border'}`}>{n}</button></span>)}<button onClick={() => set({ page: String(cur + 1) }, true)} disabled={cur >= pages} className="grid h-8 w-8 place-items-center rounded-md border border-border disabled:opacity-40 focus-ring" aria-label="Next page"><ChevronRight size={14} /></button></nav>}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
