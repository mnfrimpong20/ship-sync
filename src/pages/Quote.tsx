import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Loader2, Plane, Ship, Zap } from 'lucide-react'
import { cargoTypes, countries, countryByCode, origins, type CargoType, type Mode } from '../lib/data'
import { useStore, type Match, type NewRequest, type RequestConsignee } from '../lib/store'
import { customerApi, type Consignee } from '../lib/customer'
import { ConsigneeForm } from '../components/CustomerHome'
import { Avatar, ModeBadge, Rating, money } from '../components/ui'
import { ease } from '../lib/motion'
import { RequestVehicleFields } from '../components/VehicleCard'
import { congestionLabel, useCongestion } from '../lib/useCongestion'

type Form = NewRequest
const stepsMeta = ['Route', 'Cargo', 'Services', 'Contact']

/** Public shape of the shipper behind an order link (from GET /api/order/:code). */
export interface OrderShipper { id: string; name: string; tagline: string; hq: string; verified: boolean; rating: number; reviews: number; modes: Mode[]; destinations: string[]; origins: string[]; cargo: string[]; initials: string; hue: string; responseHours: number; onTime: number }

export default function Quote({ locked }: { locked?: { shipper: OrderShipper; instantQuotes: boolean } } = {}) {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { user, createRequest, matchShippers, shipperById } = useStore()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [matching, setMatching] = useState(true)
  const [form, setForm] = useState<Form>({
    origin: sp.get('origin') || 'New York, NY', destination: sp.get('destination') || 'GH', mode: (sp.get('mode') as Mode | 'either') || 'either',
    cargo: 'barrels', quantity: 2, weightKg: undefined, description: '', pickup: true, delivery: true, insurance: false,
    readyDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    contact: { name: user?.name ?? '', email: user?.email ?? '', phone: '' },
    password: '',
  })
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const { requests } = useStore()
  const [saved, setSaved] = useState<Consignee[]>([])
  const [recipientMode, setRecipientMode] = useState<'none' | 'pick' | 'new'>('none')
  const [prefilled, setPrefilled] = useState<string | null>(null)
  // "Ship again": copy everything from a previous request except the dates.
  useEffect(() => {
    const again = sp.get('again'); if (!again || prefilled === again) return
    const prev = requests.find((r) => r.id === again); if (!prev) return
    setForm((f) => ({ ...f, origin: prev.origin, destination: prev.destination, mode: prev.mode, cargo: prev.cargo, quantity: prev.quantity, weightKg: prev.weightKg, description: prev.description, pickup: prev.pickup, delivery: prev.delivery, insurance: prev.insurance, vehicle: prev.vehicle, consignee: prev.consignee, contact: { ...f.contact, phone: prev.contact.phone || f.contact.phone } }))
    if (prev.consignee) setRecipientMode('new')
    setPrefilled(again)
  }, [sp, requests, prefilled])
  useEffect(() => {
    if (!user || user.role !== 'customer') return
    customerApi.consignees().then((list) => {
      setSaved(list)
      const pick = sp.get('consignee'); const chosen = pick ? list.find((c) => c.id === pick) : undefined
      if (chosen) { setForm((f) => ({ ...f, destination: chosen.country as Form['destination'], delivery: true, consignee: { name: chosen.name, phone: chosen.phone, address: chosen.address, city: chosen.city, country: chosen.country, relationship: chosen.relationship } })); setRecipientMode('pick') }
      else if (list.length && !sp.get('again')) setRecipientMode('pick')
    }).catch(() => {})
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickSaved = (c: Consignee) => { setForm((f) => ({ ...f, consignee: { name: c.name, phone: c.phone, address: c.address, city: c.city, country: c.country, relationship: c.relationship } })); setRecipientMode('pick') }
  useEffect(() => {
    let live = true
    setMatching(true)
    const t = setTimeout(() => {
      matchShippers(form).then((m) => { if (live) { setMatches(m); setMatching(false) } }).catch(() => { if (live) setMatching(false) })
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [form.origin, form.destination, form.mode, form.cargo, form.quantity, form.weightKg, form.pickup, form.delivery, form.insurance, matchShippers])
  useEffect(() => { if (user) setForm((f) => ({ ...f, contact: { ...f.contact, name: f.contact.name || user.name, email: f.contact.email || user.email } })) }, [user])
  const preferred = sp.get('shipper') ? shipperById(sp.get('shipper')!) : undefined
  // Who receives the request: every matching shipper, or one the customer chose (from a profile, the picker here, or an order link).
  const [only, setOnly] = useState<string | null>(locked?.shipper.id ?? sp.get('shipper') ?? null)
  useEffect(() => { const sid = sp.get('shipper'); if (sid && !locked) setOnly(sid) }, [sp, locked])
  useEffect(() => { if (locked) setForm((f) => ({ ...f, destination: (locked.shipper.destinations[0] as Form['destination']) ?? f.destination, origin: locked.shipper.origins[0] ?? f.origin, mode: locked.shipper.modes.length === 1 ? locked.shipper.modes[0] : 'either' })) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onlyShipper: { id: string; name: string; initials: string; hue: string; verified: boolean; rating: number; modes: Mode[] } | undefined = locked ? locked.shipper : only ? (matches.find((m) => m.shipper.id === only)?.shipper ?? shipperById(only)) : undefined
  const cg = useCongestion()
  const portNow = cg?.enabled && form.mode !== 'air' ? congestionLabel(cg.congestion[form.destination]) : null
  useEffect(() => { window.scrollTo({ top: 0 }) }, [step])

  const validate = () => {
    const e: Record<string, string> = {}
    if (step === 1 && form.quantity < 1) e.quantity = 'Enter at least 1.'
    if (step === 3) {
      if (form.contact.name.trim().length < 2) e.name = 'Please enter your name.'
      if (!/^\S+@\S+\.\S+$/.test(form.contact.email)) e.email = 'Enter a valid email.'
      if (form.contact.phone.replace(/\D/g, '').length < 7) e.phone = 'Enter a phone number shippers can reach.'
      if (!user && (form.password ?? '').length < 8) e.password = 'Choose a password of at least 8 characters.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }
  const next = () => { if (!validate()) return; if (step < 3) setStep(step + 1); else submit() }
  const submit = async () => {
    setSubmitting(true); setSubmitError('')
    try {
      const { password, consignee, ...rest0 } = form
      const rest = { ...rest0, consignee: consignee && consignee.name.trim().length >= 2 ? consignee : undefined, preferredShipperId: only ?? undefined, source: locked ? ('link' as const) : only ? ('picked' as const) : undefined }
      const r = await createRequest(user ? rest : { ...rest, password })
      nav(`/dashboard?request=${r.id}`)
    } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Could not send your request.'); setSubmitting(false) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x grid gap-10 py-10 md:py-16 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow mb-2">{locked ? `Order from ${locked.shipper.name}` : 'Request quotes'}</p>
          <h1 className="!text-[clamp(2rem,4vw,3rem)]">{locked ? 'Tell us what you’re sending' : 'Tell shippers what you’re sending'}</h1>
          <p className="mt-2 text-text-muted">{locked ? (locked.instantQuotes ? `${locked.shipper.name} will price this instantly from their published rates.` : `${locked.shipper.name} will reply with an itemised quote — usually within 24 hours.`) : 'Free. Matching shippers reply with itemised quotes — usually within 24 hours.'}</p>

          <ol className="mt-8 flex gap-2" aria-label="Progress">
            {stepsMeta.map((s, i) => (
              <li key={s} className="flex-1">
                <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-gold' : 'bg-surface-2'}`} />
                <p className={`mt-2 text-xs font-medium ${i === step ? 'text-gold' : 'text-text-muted'}`} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</p>
              </li>
            ))}
          </ol>

          <div className="card-dark mt-6 p-6 md:p-8">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22, ease }}>
                {step === 0 && (
                  <div className="grid gap-5">
                    <h2 className="!text-xl">Where is it going?</h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><label htmlFor="origin" className="label-dark">Shipping from</label><select id="origin" className="input-dark" value={form.origin} onChange={(e) => set('origin', e.target.value)}>{origins.map((o) => <option key={o}>{o}</option>)}</select></div>
                      <div><label htmlFor="dest" className="label-dark">Shipping to</label><select id="dest" className="input-dark" value={form.destination} onChange={(e) => set('destination', e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
                    </div>
                    <fieldset>
                      <legend className="label-dark">Mode</legend>
                      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                        {([['either', 'Either — show me both', null], ['ocean', 'Ocean freight', Ship], ['air', 'Air freight', Plane]] as const).map(([v, l, Icon]) => (
                          <button type="button" key={v} role="radio" aria-checked={form.mode === v} onClick={() => set('mode', v)} className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] border text-sm font-medium transition-colors focus-ring ${form.mode === v ? 'border-gold bg-gold/15 text-gold' : 'border-border bg-surface-2 text-text-muted hover:text-text'}`}>{Icon && <Icon size={16} aria-hidden="true" />}{l}</button>
                        ))}
                      </div>
                    </fieldset>
                    <div><label htmlFor="ready" className="label-dark">Cargo ready on or after</label><input id="ready" type="date" className="input-dark" value={form.readyDate} onChange={(e) => set('readyDate', e.target.value)} /></div>
                  </div>
                )}
                {step === 1 && (
                  <div className="grid gap-5">
                    <h2 className="!text-xl">What are you shipping?</h2>
                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cargo type">
                      {cargoTypes.map((c) => (
                        <button type="button" key={c.id} role="radio" aria-checked={form.cargo === c.id} onClick={() => set('cargo', c.id as CargoType)} className={`flex min-h-14 flex-col items-start justify-center rounded-[var(--radius-sm)] border px-4 py-2 text-left transition-colors focus-ring ${form.cargo === c.id ? 'border-gold bg-gold/15' : 'border-border bg-surface-2 hover:border-text-muted'}`}>
                          <span className={`text-sm font-semibold ${form.cargo === c.id ? 'text-gold' : 'text-text'}`}>{c.label}</span><span className="text-xs text-text-muted">{c.hint}</span>
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><label htmlFor="qty" className="label-dark">Quantity</label><input id="qty" type="number" min={1} className="input-dark" value={form.quantity} onChange={(e) => set('quantity', Number(e.target.value))} aria-invalid={!!errors.quantity} />{errors.quantity && <p className="mt-1 text-xs text-danger">{errors.quantity}</p>}</div>
                      <div><label htmlFor="wt" className="label-dark">Approx. total weight (kg, optional)</label><input id="wt" type="number" min={0} className="input-dark" value={form.weightKg ?? ''} onChange={(e) => set('weightKg', e.target.value ? Number(e.target.value) : undefined)} placeholder="e.g. 380" /></div>
                    </div>
                    {form.cargo === 'vehicle' && <RequestVehicleFields value={form.vehicle ?? { vin: '', year: null, make: '', model: '', running: true, method: 'roro', titleStatus: 'clean' }} onChange={(v) => set('vehicle', v)} />}
                    <div><label htmlFor="desc" className="label-dark">Describe the shipment</label><textarea id="desc" rows={3} className="input-dark py-2.5" placeholder="e.g. 4 sealed barrels — clothing, provisions, small appliances. Deliver to Kumasi." value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
                  </div>
                )}
                {step === 2 && (
                  <div className="grid gap-5">
                    <h2 className="!text-xl">Which services do you need?</h2>
                    {([['pickup', 'Pickup from my address', 'Shipper collects from your home or business at origin.'], ['delivery', 'Door delivery at destination', 'Delivered to the consignee’s address instead of port/airport collection.'], ['insurance', 'All-risk cargo insurance', 'Covers loss or damage in transit for the declared value.']] as const).map(([k, l, h]) => (
                      <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-4 transition-colors ${form[k] ? 'border-gold bg-gold/10' : 'border-border bg-surface-2'}`}>
                        <input type="checkbox" className="mt-1 h-5 w-5 accent-gold" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
                        <span><span className="block font-semibold text-text">{l}</span><span className="text-sm text-text-muted">{h}</span></span>
                      </label>
                    ))}
                    <div className="rounded-[var(--radius-sm)] border border-border bg-surface-2 p-4" data-testid="recipient-section">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-text">Who receives it in {countryByCode(form.destination)?.name ?? 'the destination'}?</p><p className="text-xs text-text-muted">Optional now, but it lets the shipper text them when it lands and the driver find them.</p></div>{form.consignee && <button type="button" onClick={() => { set('consignee', undefined); setRecipientMode(saved.length ? 'pick' : 'none') }} className="text-xs text-text-muted underline">Clear</button>}</div>
                      {saved.length > 0 && <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Saved recipients">{saved.map((c) => <button type="button" key={c.id} role="radio" aria-checked={form.consignee?.name === c.name && form.consignee?.phone === c.phone} onClick={() => pickSaved(c)} className={`rounded-full border px-3 py-1.5 text-sm focus-ring ${form.consignee?.name === c.name && form.consignee?.phone === c.phone ? 'border-gold bg-gold/15 text-gold' : 'border-border text-text-muted hover:text-text'}`} data-testid="saved-recipient">{c.name}{c.city ? ` · ${c.city}` : ''}</button>)}<button type="button" onClick={() => { set('consignee', { name: '', country: form.destination }); setRecipientMode('new') }} className="rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-text-muted hover:text-text focus-ring">+ Someone else</button></div>}
                      {saved.length === 0 && recipientMode === 'none' && <button type="button" onClick={() => { set('consignee', { name: '', country: form.destination }); setRecipientMode('new') }} className="btn-ghost mt-3 !min-h-9 text-xs" data-testid="add-recipient-inline">Add a recipient</button>}
                      {recipientMode === 'new' && <div className="mt-3"><ConsigneeForm key={form.consignee?.name ?? 'new'} initial={{ ...(form.consignee ?? { name: '' }), country: form.consignee?.country || form.destination }} onSave={(c) => { set('consignee', c as RequestConsignee); setRecipientMode('pick') }} onCancel={() => { set('consignee', undefined); setRecipientMode(saved.length ? 'pick' : 'none') }} /></div>}
                      {recipientMode === 'pick' && form.consignee?.name && <p className="mt-3 text-sm text-text"><Check size={14} className="inline text-teal" aria-hidden="true" /> {form.consignee.name}{form.consignee.city ? `, ${form.consignee.city}` : ''}{form.consignee.phone ? ` · ${form.consignee.phone}` : ''} <button type="button" onClick={() => setRecipientMode('new')} className="ml-1 text-xs text-text-muted underline">edit</button></p>}
                    </div>
                  </div>
                )}
                {step === 3 && (
                  <div className="grid gap-5">
                    <h2 className="!text-xl">Where should quotes go?</h2>
                    <div><label htmlFor="cname" className="label-dark">Full name</label><input id="cname" className="input-dark" value={form.contact.name} onChange={(e) => set('contact', { ...form.contact, name: e.target.value })} aria-invalid={!!errors.name} autoComplete="name" />{errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}</div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div><label htmlFor="cemail" className="label-dark">Email</label><input id="cemail" type="email" className="input-dark" value={form.contact.email} onChange={(e) => set('contact', { ...form.contact, email: e.target.value })} aria-invalid={!!errors.email} autoComplete="email" />{errors.email && <p className="mt-1 text-xs text-danger">{errors.email}</p>}</div>
                      <div><label htmlFor="cphone" className="label-dark">Phone / WhatsApp</label><input id="cphone" type="tel" className="input-dark" value={form.contact.phone} onChange={(e) => set('contact', { ...form.contact, phone: e.target.value })} aria-invalid={!!errors.phone} autoComplete="tel" placeholder="+1 …" />{errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone}</p>}</div>
                    </div>
                    {!user && (
                      <div>
                        <label htmlFor="cpw" className="label-dark">Create a password</label>
                        <input id="cpw" type="password" className="input-dark" value={form.password ?? ''} onChange={(e) => set('password', e.target.value)} aria-invalid={!!errors.password} autoComplete="new-password" />
                        {errors.password ? <p className="mt-1 text-xs text-danger">{errors.password}</p> : <p className="mt-1 text-xs text-text-muted">We’ll create your free Ship Sync account so you can compare quotes and book. Already have one? <Link to="/login?next=/quote" className="text-gold hover:underline">Sign in</Link>.</p>}
                      </div>
                    )}
                    {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
                    <p className="text-xs text-text-muted">By submitting you agree to receive quotes from matching shippers. Ship Sync never shares your details beyond the shippers you’re matched with.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-6">
              <button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || submitting} className="btn-ghost disabled:opacity-40"><ArrowLeft size={18} aria-hidden="true" /> Back</button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} type="button" onClick={next} disabled={submitting} className="btn-gold disabled:opacity-70">
                {submitting ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Sending to shippers…</> : step === 3 ? <>Send request <Check size={18} aria-hidden="true" /></> : <>Continue <ArrowRight size={18} aria-hidden="true" /></>}
              </motion.button>
            </div>
          </div>
        </div>

        <aside className="lg:col-span-5" aria-label="Matching shippers">
          <div className="sticky top-24">
            <div className="card-dark p-6">
              {locked ? (
                <div data-testid="locked-shipper">
                  <p className="eyebrow mb-2">You’re ordering from</p>
                  <div className="flex items-start gap-3"><Avatar initials={locked.shipper.initials} hue={locked.shipper.hue} size={48} /><div className="min-w-0"><p className="flex items-center gap-1 text-base font-semibold">{locked.shipper.name}{locked.shipper.verified && <BadgeCheck size={16} className="text-gold" aria-label="Verified" />}</p><p className="text-sm text-text-muted">{locked.shipper.tagline || locked.shipper.hq}</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{locked.shipper.modes.map((md) => <ModeBadge key={md} mode={md} />)}<Rating value={locked.shipper.rating} count={locked.shipper.reviews} /></div></div></div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-text-muted">Ships to</dt><dd>{locked.shipper.destinations.map((c) => countryByCode(c)?.name ?? c).join(', ')}</dd></div><div><dt className="text-xs text-text-muted">Collects from</dt><dd>{locked.shipper.origins.slice(0, 3).join(', ') || '—'}</dd></div>{locked.shipper.onTime > 0 && <div><dt className="text-xs text-text-muted">On time</dt><dd>{locked.shipper.onTime}%</dd></div>}<div><dt className="text-xs text-text-muted">Replies in</dt><dd>~{locked.shipper.responseHours} h</dd></div></dl>
                  <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">This request goes only to {locked.shipper.name}. You’ll get a Ship Sync account to track it, and payment is held in escrow until the goods are on their way.</p>
                </div>
              ) : (
              <>
              <div className="flex items-center justify-between"><h2 className="!text-lg">Who gets this?</h2><span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold">{matches.length} match{matches.length === 1 ? '' : 'es'}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-full border border-border bg-surface-2 p-1 text-sm" role="radiogroup" aria-label="Send to">
                <button type="button" role="radio" aria-checked={!only} onClick={() => setOnly(null)} className={`min-h-9 rounded-full px-3 focus-ring ${!only ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid="send-all">All matching</button>
                <button type="button" role="radio" aria-checked={!!only} onClick={() => setOnly(only ?? matches[0]?.shipper.id ?? preferred?.id ?? null)} className={`min-h-9 rounded-full px-3 focus-ring ${only ? 'bg-gold font-semibold text-on-accent' : 'text-text-muted hover:text-text'}`} data-testid="send-one">One shipper</button>
              </div>
              <p className="mt-2 text-sm text-text-muted">{only ? (onlyShipper ? <>Only <strong className="text-text">{onlyShipper.name}</strong> will see this request{preferred && preferred.id === only ? ' — you started from their profile' : ''}.</> : 'Pick a shipper from the list.') : 'Every matching shipper gets your request and competes on price and transit time.'}</p>
              {only && onlyShipper && !matches.some((m) => m.shipper.id === only) && <p className="mt-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs">{onlyShipper.name} doesn’t list this lane, but they’ll still receive your request and can quote it.</p>}
              <ul className="mt-4 space-y-3">
                <AnimatePresence initial={false}>
                  {matches.length === 0 && !matching && (
                    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg border border-dashed border-border p-4 text-sm text-text-muted">No shipper currently serves this exact lane and cargo. Try “Either” mode, or we’ll forward your request to nearby operators manually.</motion.li>
                  )}
                  {matches.length === 0 && matching && (
                    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Finding shippers on this lane…</motion.li>
                  )}
                  {!locked && [...matches].sort((a, b) => (only ? (b.shipper.id === only ? 1 : 0) - (a.shipper.id === only ? 1 : 0) : 0)).slice(0, only ? 8 : 5).map((m) => (
                    <motion.li key={m.shipper.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} onClick={only ? () => setOnly(m.shipper.id) : undefined} role={only ? 'radio' : undefined} aria-checked={only ? only === m.shipper.id : undefined} tabIndex={only ? 0 : undefined} onKeyDown={only ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOnly(m.shipper.id) } } : undefined} data-testid="match-row" className={`${only ? 'cursor-pointer transition-all ' : ''}${only === m.shipper.id ? 'border-gold bg-gold/10 ring-1 ring-gold/50 ' : only ? 'opacity-45 grayscale hover:opacity-80 hover:grayscale-0 ' : ''}relative flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3`}>
                      {only === m.shipper.id && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-accent" data-testid="selected-tag"><Check size={10} aria-hidden="true" /> Selected</span>}
                      <Avatar initials={m.shipper.initials} hue={m.shipper.hue} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 truncate text-sm font-semibold text-text">{m.shipper.name}{m.shipper.verified && <BadgeCheck size={14} className="text-gold" aria-label="Verified" />}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">{m.shipper.modes.map((md) => <ModeBadge key={md} mode={md} />)}<Rating value={m.shipper.rating} /></div>
                        <p className="mt-1 text-xs text-text-muted">{m.reasons.slice(0, 2).join(' · ')}</p>
                        {m.estimate && <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold" data-testid="match-estimate">{m.estimate.instant ? <Zap size={11} aria-hidden="true" /> : null}{money(m.estimate.price)} · {m.estimate.transitDays} days{m.estimate.instant ? ' · instant quote' : ' · published rate'}</p>}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              </>
              )}
              {portNow && (
                <p className={`mt-4 rounded-lg border p-3 text-xs ${portNow.level === 'heavy' ? 'border-danger/40 bg-danger/10 text-danger' : portNow.level === 'busy' ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border bg-surface-2 text-text-muted'}`}>
                  {countryByCode(form.destination)?.ports[0]} right now: {portNow.text}.{portNow.level !== 'clear' ? ' Shippers may quote longer transit.' : ''}
                </p>
              )}
              {matches.length > 0 && !locked && (
                <p className="mt-4 border-t border-border pt-4 text-xs text-text-muted">{matches.some((m) => m.estimate?.instant) ? `${matches.filter((m) => m.estimate?.instant).length} of these will quote instantly when you submit. ` : ''}Estimated range {money(estimate(form).lo)}–{money(estimate(form).hi)} based on recent quotes on this lane. Final prices come from shippers.</p>
              )}
            </div>
            {form.mode !== 'air' && (form.cargo === 'boxes' || form.cargo === 'barrels') && <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-center text-sm">Sending less than a barrel? <Link to={`/groupage?destination=${form.destination}`} className="font-semibold text-gold hover:underline">Reserve space in a shared barrel or container →</Link></p>}
            <p className="mt-4 text-center text-sm text-text-muted">Prefer to browse first? <Link to="/shippers" className="text-gold hover:underline">See the directory</Link></p>
            {(form.destination === 'GH' || form.destination === 'NG') && <p className="mt-2 text-center text-sm text-text-muted">Wondering about customs? <Link to={`/duty?destination=${form.destination}&goods=${form.cargo === 'vehicle' ? 'vehicle' : 'personal_effects'}`} className="text-gold hover:underline">Estimate duty at {form.destination === 'GH' ? 'Tema' : 'Lagos'}</Link></p>}
          </div>
        </aside>
      </div>
    </div>
  )
}

function estimate(f: Form) {
  const base: Record<CargoType, number> = { barrels: 160, boxes: 95, pallets: 420, vehicle: 1650, container20: 3900, container40: 5600, commercial: 900 }
  const m = f.mode === 'air' ? 3.2 : 1
  const v = base[f.cargo] * Math.max(1, f.quantity) * m + (f.pickup ? 60 : 0) + (f.delivery ? 90 : 0) + (f.insurance ? 45 : 0)
  return { lo: Math.round(v * 0.85), hi: Math.round(v * 1.2) }
}
