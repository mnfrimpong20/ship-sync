import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Loader2, Plane, Ship } from 'lucide-react'
import { cargoTypes, countries, origins, type CargoType, type Mode } from '../lib/data'
import { useStore, type Match, type NewRequest } from '../lib/store'
import { Avatar, ModeBadge, Rating, money } from '../components/ui'
import { ease } from '../lib/motion'

type Form = NewRequest
const stepsMeta = ['Route', 'Cargo', 'Services', 'Contact']

export default function Quote() {
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
  useEffect(() => {
    let live = true
    setMatching(true)
    const t = setTimeout(() => {
      matchShippers(form).then((m) => { if (live) { setMatches(m); setMatching(false) } }).catch(() => { if (live) setMatching(false) })
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [form.origin, form.destination, form.mode, form.cargo, matchShippers])
  useEffect(() => { if (user) setForm((f) => ({ ...f, contact: { ...f.contact, name: f.contact.name || user.name, email: f.contact.email || user.email } })) }, [user])
  const preferred = sp.get('shipper') ? shipperById(sp.get('shipper')!) : undefined
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
      const { password, ...rest } = form
      const r = await createRequest(user ? rest : { ...rest, password })
      nav(`/dashboard?request=${r.id}`)
    } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Could not send your request.'); setSubmitting(false) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x grid gap-10 py-10 md:py-16 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="eyebrow mb-2">Request quotes</p>
          <h1 className="!text-[clamp(2rem,4vw,3rem)]">Tell shippers what you’re sending</h1>
          <p className="mt-2 text-text-muted">Free. Matching shippers reply with itemised quotes — usually within 24 hours.</p>

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
              <div className="flex items-center justify-between"><h2 className="!text-lg">Matching shippers</h2><span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold">{matches.length} match{matches.length === 1 ? '' : 'es'}</span></div>
              <p className="mt-1 text-sm text-text-muted">Updates as you fill in the form. These companies will receive your request.</p>
              {preferred && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-text">You started from <strong>{preferred.name}</strong>’s profile — they’ll be notified first.</p>}
              <ul className="mt-4 space-y-3">
                <AnimatePresence initial={false}>
                  {matches.length === 0 && !matching && (
                    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg border border-dashed border-border p-4 text-sm text-text-muted">No shipper currently serves this exact lane and cargo. Try “Either” mode, or we’ll forward your request to nearby operators manually.</motion.li>
                  )}
                  {matches.length === 0 && matching && (
                    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Finding shippers on this lane…</motion.li>
                  )}
                  {matches.slice(0, 5).map((m) => (
                    <motion.li key={m.shipper.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
                      <Avatar initials={m.shipper.initials} hue={m.shipper.hue} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 truncate text-sm font-semibold text-text">{m.shipper.name}{m.shipper.verified && <BadgeCheck size={14} className="text-gold" aria-label="Verified" />}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">{m.shipper.modes.map((md) => <ModeBadge key={md} mode={md} />)}<Rating value={m.shipper.rating} /></div>
                        <p className="mt-1 text-xs text-text-muted">{m.reasons.slice(0, 2).join(' · ')}</p>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {matches.length > 0 && (
                <p className="mt-4 border-t border-border pt-4 text-xs text-text-muted">Estimated range for {money(estimate(form).lo)}–{money(estimate(form).hi)} based on recent quotes on this lane. Final prices come from shippers.</p>
              )}
            </div>
            <p className="mt-4 text-center text-sm text-text-muted">Prefer to browse first? <Link to="/shippers" className="text-gold hover:underline">See the directory</Link></p>
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
