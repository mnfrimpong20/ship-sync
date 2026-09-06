import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, BadgeCheck, Check, ChevronRight, Clock, FileText, Inbox, Package, Pencil, Plane, PlusCircle, Send, Ship, X } from 'lucide-react'
import { cargoLabel, countryByCode, statusLabels, type CargoType, type Shipper } from '../lib/data'
import { useStore, type QuoteRequest } from '../lib/store'
import { Avatar, Empty, ModeBadge, Pill, Rating, fmtDate, money } from '../components/ui'
import { ShipmentDetail } from './Track'
import ProfileEditor from '../components/ProfileEditor'
import { fadeUp, stagger } from '../lib/motion'
import ShipperOverview from '../components/ShipperOverview'

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Inbox; label: string; value: string | number; hint?: string }) {
  return (
    <motion.div variants={fadeUp} className="card-dark p-5">
      <div className="flex items-center justify-between"><p className="text-sm text-text-muted">{label}</p><Icon size={18} className="text-gold" aria-hidden="true" /></div>
      <p className="mt-2 font-heading text-3xl font-bold text-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </motion.div>
  )
}

function Layout({ title, sub, children, cta }: { title: string; sub: string; children: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">Workspace</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">{title}</motion.h1><motion.p variants={fadeUp} className="mt-1 text-text-muted">{sub}</motion.p></div>
            {cta && <motion.div variants={fadeUp}>{cta}</motion.div>}
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  )
}

/* ================= CUSTOMER ================= */
export function CustomerDashboard() {
  const { ready, user, requests, shipments, acceptQuote, shipperById } = useStore()
  const [sp, setSp] = useSearchParams()
  const [tab, setTabState] = useState<'requests' | 'shipments'>(sp.get('tab') === 'shipments' ? 'shipments' : 'requests')
  const setTab = (t: 'requests' | 'shipments') => { setTabState(t); setSp(t === 'requests' ? {} : { tab: t }, { replace: true }) }
  useEffect(() => { const t = sp.get('tab'); setTabState(t === 'shipments' ? 'shipments' : 'requests') }, [sp])
  const [openReq, setOpenReq] = useState<string | null>(sp.get('request'))
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busyQuote, setBusyQuote] = useState<string | null>(null)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])
  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading your dashboard…</div></div>
  if (!user) return <Navigate to="/login?next=/dashboard" replace />
  if (user.role === 'shipper') return <Navigate to="/dashboard/shipper" replace />

  const open = requests.filter((r) => r.status === 'open')
  const quotesCount = requests.reduce((n, r) => n + r.quotes.length, 0)
  const active = shipments.filter((s) => s.status !== 'delivered')

  const accept = async (r: QuoteRequest, qid: string) => {
    setBusyQuote(qid); setError('')
    try {
      const sh = await acceptQuote(r.id, qid)
      setToast(`Booked with ${shipperById(sh.shipperId)?.name ?? 'your shipper'}. Reference ${sh.ref}.`)
      setOpenReq(null); setTab('shipments'); setSp({})
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not accept this quote.') }
    finally { setBusyQuote(null) }
  }

  return (
    <Layout title={`Hello, ${user.name.split(' ')[0]}`} sub="Your quote requests, bookings and live shipments." cta={<Link to="/quote" className="btn-gold"><PlusCircle size={18} aria-hidden="true" /> New shipment request</Link>}>
      <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" />{toast}</motion.p>}</AnimatePresence>
      {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat icon={Inbox} label="Open requests" value={open.length} hint={`${quotesCount} quotes received`} />
        <Stat icon={Ship} label="Active shipments" value={active.length} hint="In transit or clearing" />
        <Stat icon={Package} label="Delivered" value={shipments.filter((s) => s.status === 'delivered').length} hint="All time" />
      </div>

      <div className="mt-8 flex gap-1 border-b border-border" role="tablist">
        {(['requests', 'shipments'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative min-h-11 px-4 text-sm font-medium capitalize focus-ring rounded-t ${tab === t ? 'text-gold' : 'text-text-muted hover:text-text'}`}>{t === 'requests' ? 'Quote requests' : 'Shipments'}{tab === t && <motion.span layoutId="tab" className="absolute inset-x-0 -bottom-px h-0.5 bg-gold" />}</button>
        ))}
      </div>

      {tab === 'requests' && (
        <div className="mt-6 space-y-4">
          {requests.length === 0 && <Empty title="No quote requests yet" body="Post your first shipment and matching shippers will reply with itemised quotes." action={<Link to="/quote" className="btn-gold">Request quotes</Link>} />}
          {requests.map((r) => {
            const dest = countryByCode(r.destination)!
            const isOpen = openReq === r.id
            const accepted = r.quotes.find((q) => q.status === 'accepted')
            return (
              <motion.div key={r.id} layout className="card-dark overflow-hidden">
                <button onClick={() => setOpenReq(isOpen ? null : r.id)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-surface-2/50 focus-ring">
                  <div className="flex items-center gap-4">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/15 text-gold"><FileText size={20} aria-hidden="true" /></span>
                    <div>
                      <p className="font-semibold text-text">{r.origin} → {dest.flag} {dest.name} <span className="font-normal text-text-muted">· {r.quantity} × {cargoLabel(r.cargo)}</span></p>
                      <p className="text-xs text-text-muted">{r.ref} · posted {fmtDate(r.createdAt)} · {r.mode === 'either' ? 'air or ocean' : r.mode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.status === 'booked' ? <Pill tone="green">Booked · {shipperById(accepted?.shipperId ?? '')?.name}</Pill> : <Pill tone={r.quotes.length ? 'gold' : 'muted'}>{r.quotes.length ? `${r.quotes.length} quote${r.quotes.length > 1 ? 's' : ''}` : 'Awaiting quotes'}</Pill>}
                    <ChevronRight size={18} className={`text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                      <div className="border-t border-border p-5">
                        <p className="text-sm text-text-muted">{r.description || 'No description provided.'} {r.pickup && '· Pickup'} {r.delivery && '· Door delivery'} {r.insurance && '· Insurance'}</p>
                        {r.quotes.length === 0 ? (
                          <p className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 p-4 text-sm text-text-muted"><Clock size={16} aria-hidden="true" /> Shippers usually reply within 24 hours. We’ll email you at {r.contact.email}.</p>
                        ) : (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {[...r.quotes].sort((a, b) => a.price - b.price).map((q, i) => {
                              const s = shipperById(q.shipperId) ?? { id: q.shipperId, name: 'Shipper', initials: 'SS', hue: '#E3B54A', rating: 0, reviews: 0, verified: false }
                              const best = i === 0 && r.status === 'open'
                              return (
                                <div key={q.id} className={`relative rounded-[var(--radius-md)] border p-4 ${q.status === 'accepted' ? 'border-teal bg-teal/5' : q.status === 'declined' ? 'border-border opacity-50' : best ? 'border-gold' : 'border-border bg-surface-2'}`}>
                                  {best && <span className="absolute -top-2.5 left-4 rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-on-accent">Lowest price</span>}
                                  <div className="flex items-start gap-3">
                                    <Avatar initials={s.initials} hue={s.hue} size={40} />
                                    <div className="min-w-0 flex-1">
                                      <p className="flex items-center gap-1 truncate text-sm font-semibold text-text">{s.name}{s.verified && <BadgeCheck size={14} className="text-gold" aria-label="Verified" />}</p>
                                      <div className="mt-1 flex flex-wrap gap-1.5"><Rating value={s.rating} count={s.reviews} /></div>
                                    </div>
                                    <div className="text-right"><p className="font-heading text-2xl font-bold text-text">{money(q.price)}</p><p className="text-xs text-text-muted">~{q.transitDays} days</p></div>
                                  </div>
                                  <ul className="mt-3 flex flex-wrap gap-1.5">{q.includes.map((x) => <li key={x} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">{x}</li>)}</ul>
                                  <p className="mt-3 text-xs text-text-muted">{q.notes}</p>
                                  <div className="mt-4 flex items-center justify-between gap-2">
                                    <p className="text-xs text-text-muted">Valid until {fmtDate(q.validUntil)}</p>
                                    {q.status === 'accepted' ? <Pill tone="green">Accepted</Pill> : q.status === 'declined' ? <Pill tone="muted">Declined</Pill> : (
                                      <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => accept(r, q.id)} disabled={busyQuote !== null} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busyQuote === q.id ? 'Booking…' : 'Accept & book'}</motion.button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}

      {tab === 'shipments' && <ShipmentsTab />}
    </Layout>
  )
}

function ShipmentsTab() {
  const { shipments } = useStore()
  const [sel, setSel] = useState<string | null>(shipments[0]?.id ?? null)
  const s = shipments.find((x) => x.id === sel)
  if (shipments.length === 0) return <div className="mt-6"><Empty title="No shipments yet" body="Accept a quote on one of your requests and it will appear here with live tracking." /></div>
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12">
      <ul className="space-y-2 lg:col-span-4" aria-label="Your shipments">
        {shipments.map((x) => {
          const d = countryByCode(x.destination)!
          return (
            <li key={x.id}>
              <button onClick={() => setSel(x.id)} aria-current={sel === x.id} className={`w-full rounded-[var(--radius-md)] border p-4 text-left transition-colors focus-ring ${sel === x.id ? 'border-gold bg-surface' : 'border-border bg-surface/50 hover:bg-surface'}`}>
                <div className="flex items-center justify-between"><p className="font-mono text-xs text-gold">{x.ref}</p><ModeBadge mode={x.mode} /></div>
                <p className="mt-1.5 text-sm font-semibold text-text">{x.origin} → {d.flag} {d.name}</p>
                <p className="text-xs text-text-muted">{x.description}</p>
                <p className="mt-2 text-xs"><Pill tone={x.status === 'delivered' ? 'green' : 'teal'}>{statusLabels[x.status]}</Pill></p>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="lg:col-span-8">{s && <ShipmentDetail s={s} compact />}{s && <Link to={`/track?ref=${s.ref}`} className="mt-4 inline-flex items-center gap-1 text-sm text-gold hover:underline focus-ring rounded">Open public tracking page <ArrowRight size={14} aria-hidden="true" /></Link>}</div>
    </div>
  )
}

/* ================= SHIPPER ================= */
export function ShipperDashboard() {
  const { ready, user, requests, shipments, sendQuote, advanceShipment, shipperById, setTransit } = useStore()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const view = (sp.get('view') as 'leads' | 'shipments' | 'profile' | null) ?? 'overview'
  const [quoting, setQuoting] = useState<string | null>(null)
  const [transitFor, setTransitFor] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => { setEditing(view === 'profile') }, [view])
  const [tf, setTf] = useState({ vesselName: '', mmsi: '', flight: '' })
  const [form, setForm] = useState({ price: '', transit: '', notes: '' })
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])
  if (!ready) return <div className="bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading your dashboard…</div></div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/shipper" replace />
  if (user.role !== 'shipper' || !user.shipperId) return <Navigate to="/dashboard" replace />
  const me = user.shipperId
  const leads = requests.filter((r) => r.status === 'open')
  const full = shipperById(me)
  const shipper: Pick<Shipper, 'id' | 'name' | 'hq' | 'plan' | 'onTime' | 'tagline' | 'verified'> = full ?? { id: me, name: user.company ?? 'Your company', hq: '', plan: 'starter', onTime: 0, tagline: '', verified: false }
  const myShipments = shipments.filter((s) => s.shipperId === me)

  const submitQuote = async (r: QuoteRequest) => {
    const price = Number(form.price), transit = Number(form.transit)
    if (!price || !transit) return
    setBusy(true); setError('')
    try {
      await sendQuote(r.id, { price, transitDays: transit, notes: form.notes || (shipper.tagline ? `${shipper.tagline}.` : ''), includes: [r.pickup ? 'Pickup' : 'Drop-off at warehouse', r.mode === 'air' ? 'Air freight' : 'Ocean freight', r.delivery ? 'Door delivery' : 'Port handling', ...(r.insurance ? ['All-risk insurance'] : [])] })
      setQuoting(null); setForm({ price: '', transit: '', notes: '' }); setToast(`Quote sent to ${r.contact.name}.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send the quote.') }
    finally { setBusy(false) }
  }
  const saveTransit = async (id: string, mode: 'air' | 'ocean') => {
    setBusy(true); setError('')
    try {
      await setTransit(id, mode === 'air' ? { flight: tf.flight } : { vesselName: tf.vesselName, mmsi: tf.mmsi })
      setTransitFor(null); setTf({ vesselName: '', mmsi: '', flight: '' }); setToast('Tracking details saved — customers now see the live position.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save tracking details.') }
    finally { setBusy(false) }
  }
  const advance = async (id: string, ref: string) => {
    setBusy(true); setError('')
    try { await advanceShipment(id); setToast(`${ref} updated.`) } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the shipment.') } finally { setBusy(false) }
  }

  return (
    <Layout title={view === 'leads' ? 'Leads & quotes' : view === 'shipments' ? 'Shipments' : view === 'profile' ? 'Company profile' : shipper.name} sub={view === 'overview' ? `${user.name} · ${shipper.hq} · ${shipper.plan.charAt(0).toUpperCase() + shipper.plan.slice(1)} plan` : shipper.name} cta={<div className="flex flex-wrap gap-2">{view !== 'profile' && <button onClick={() => setEditing((e) => !e)} className="btn-ghost" aria-expanded={editing}><Pencil size={16} aria-hidden="true" /> Edit profile</button>}<Link to={`/shippers/${me}`} className="btn-ghost">View public profile</Link></div>}>
      <AnimatePresence>{toast && <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-6 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" />{toast}</motion.p>}</AnimatePresence>
      {error && <p role="alert" className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {!shipper.verified && !editing && (
        <p className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-text"><BadgeCheck size={16} className="text-gold" aria-hidden="true" /> Not yet verified. Complete your profile — Ship Sync reviews licence and insurance before granting the badge, which lifts you in matching and reassures customers.</p>
      )}
      {editing && full && <ProfileEditor shipper={full} onDone={(msg) => { setEditing(false); if (msg) setToast(msg); if (view === 'profile') nav('/dashboard/shipper') }} />}
      {view === 'overview' && !editing && <ShipperOverview firstName={user.name.split(' ')[0]} />}

      <div className="mt-10 grid gap-8 lg:grid-cols-12">
        {view === 'leads' && <section className="lg:col-span-12" aria-labelledby="leads-h">
          <h2 id="leads-h" className="!text-xl">Shipment requests for your lanes</h2>
          <p className="mt-1 text-sm text-text-muted">Reply fast — customers see response time on your profile.</p>
          <div className="mt-4 space-y-3">
            {leads.length === 0 && <Empty title="No open leads right now" body="New requests matching your origins, destinations and cargo types will appear here and by email." />}
            {leads.map((r) => {
              const d = countryByCode(r.destination)!
              const mine = r.quotes.find((q) => q.shipperId === me)
              const competing = r.competingQuotes ?? r.quotes.filter((q) => q.shipperId !== me).length
              return (
                <motion.div key={r.id} layout className="card-dark p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-text">{r.quantity} × {cargoLabel(r.cargo as CargoType)} · {r.origin} → {d.flag} {d.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{r.ref} · {r.mode === 'either' ? 'air or ocean' : r.mode} · ready {fmtDate(r.readyDate)} {r.weightKg ? `· ~${r.weightKg} kg` : ''}</p>
                      <p className="mt-2 text-sm text-text-muted">{r.description || 'No description.'}</p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">{r.pickup && <li><Pill tone="muted">Pickup</Pill></li>}{r.delivery && <li><Pill tone="muted">Door delivery</Pill></li>}{r.insurance && <li><Pill tone="muted">Insurance</Pill></li>}</ul>
                    </div>
                    <div className="text-right text-xs text-text-muted"><p>{competing} competing quote{competing === 1 ? '' : 's'}</p>{mine ? <Pill tone="teal">Quoted {money(mine.price)}</Pill> : <button onClick={() => setQuoting(quoting === r.id ? null : r.id)} className="btn-gold mt-2 !min-h-10 !px-4 text-sm" aria-expanded={quoting === r.id}>Send quote</button>}</div>
                  </div>
                  <AnimatePresence initial={false}>
                    {quoting === r.id && (
                      <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} onSubmit={(e) => { e.preventDefault(); submitQuote(r) }} className="overflow-hidden">
                        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                          <div><label htmlFor={`p-${r.id}`} className="label-dark">Total price (USD)</label><input id={`p-${r.id}`} type="number" min={1} required className="input-dark" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                          <div><label htmlFor={`t-${r.id}`} className="label-dark">Transit (days)</label><input id={`t-${r.id}`} type="number" min={1} required className="input-dark" value={form.transit} onChange={(e) => setForm({ ...form, transit: e.target.value })} /></div>
                          <div className="sm:col-span-2"><label htmlFor={`n-${r.id}`} className="label-dark">Notes to customer</label><textarea id={`n-${r.id}`} rows={2} className="input-dark py-2" placeholder="Sailing date, what’s included, duty handling…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setQuoting(null)} className="btn-ghost !min-h-10 !px-4 text-sm"><X size={15} aria-hidden="true" /> Cancel</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60"><Send size={15} aria-hidden="true" /> {busy ? 'Sending…' : 'Send quote'}</button></div>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </section>}

        {view === 'shipments' && <section className="lg:col-span-12" aria-labelledby="ship-h">
          <h2 id="ship-h" className="!text-xl">Your shipments</h2>
          <p className="mt-1 text-sm text-text-muted">Update status to keep customers’ tracking pages current.</p>
          <ul className="mt-4 space-y-3">
            {myShipments.length === 0 && <li><Empty title="No shipments yet" body="Accepted quotes become shipments you can update here." /></li>}
            {myShipments.map((s) => {
              const d = countryByCode(s.destination)!
              return (
                <li key={s.id} className="card-dark p-4">
                  <div className="flex items-center justify-between"><p className="font-mono text-xs text-gold">{s.ref}</p><ModeBadge mode={s.mode} /></div>
                  <p className="mt-1 text-sm font-semibold text-text">{s.origin} → {d.flag} {d.name}</p>
                  <p className="text-xs text-text-muted">{s.description} · {s.clientId ? <Link to={`/dashboard/clients/${s.clientId}`} className="text-gold hover:underline focus-ring rounded">{s.customer}</Link> : s.customer}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Pill tone={s.status === 'delivered' ? 'green' : 'teal'}>{statusLabels[s.status]}</Pill>
                    {s.status !== 'delivered' && <button onClick={() => advance(s.id, s.ref)} disabled={busy} className="btn-ghost !min-h-9 !px-3 text-xs disabled:opacity-60">Mark next step <ChevronRight size={14} aria-hidden="true" /></button>}
                  </div>
                  {s.status !== 'delivered' && (
                    <div className="mt-3 border-t border-border pt-3">
                      {transitFor === s.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); saveTransit(s.id, s.mode) }} className="grid gap-2">
                          {s.mode === 'air' ? (
                            <div><label htmlFor={`fl-${s.id}`} className="label-dark">Flight callsign (ICAO)</label><input id={`fl-${s.id}`} className="input-dark !min-h-10 uppercase" placeholder="e.g. CLX775" value={tf.flight} onChange={(e) => setTf({ ...tf, flight: e.target.value })} required /></div>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div><label htmlFor={`vn-${s.id}`} className="label-dark">Vessel name</label><input id={`vn-${s.id}`} className="input-dark !min-h-10" placeholder="e.g. MSC Alessia" value={tf.vesselName} onChange={(e) => setTf({ ...tf, vesselName: e.target.value })} /></div>
                              <div><label htmlFor={`mm-${s.id}`} className="label-dark">MMSI (9 digits)</label><input id={`mm-${s.id}`} className="input-dark !min-h-10 font-mono" placeholder="e.g. 636019825" inputMode="numeric" value={tf.mmsi} onChange={(e) => setTf({ ...tf, mmsi: e.target.value.replace(/\D/g, '').slice(0, 9) })} /></div>
                            </div>
                          )}
                          <p className="text-[11px] text-text-muted">{s.mode === 'air' ? 'Find the ICAO callsign on the airway bill or flightradar24 (e.g. British Airways 75 = BAW75).' : 'The MMSI is on the bill of lading or any vessel-tracking site. It enables live AIS position on the customer’s tracking page.'}</p>
                          <div className="flex justify-end gap-2"><button type="button" onClick={() => setTransitFor(null)} className="btn-ghost !min-h-9 !px-3 text-xs">Cancel</button><button disabled={busy} className="btn-gold !min-h-9 !px-3 text-xs disabled:opacity-60">Save</button></div>
                        </form>
                      ) : (
                        <button onClick={() => { setTransitFor(s.id); setTf({ vesselName: s.vesselName ?? '', mmsi: s.mmsi ?? '', flight: s.flight ?? '' }) }} className="flex min-h-9 w-full items-center gap-2 text-left text-xs text-text-muted hover:text-gold focus-ring rounded">
                          {s.mode === 'air' ? <Plane size={14} aria-hidden="true" /> : <Ship size={14} aria-hidden="true" />}
                          {s.flight || s.vesselName ? <>{s.flight ?? s.vesselName}{s.mmsi ? ` · MMSI ${s.mmsi}` : ''} <span className="text-gold">Edit</span></> : <span>Add {s.mode === 'air' ? 'flight number' : 'vessel & MMSI'} for live tracking</span>}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>}
      </div>
    </Layout>
  )
}
