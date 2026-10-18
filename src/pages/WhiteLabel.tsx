import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, Check, Copy, ExternalLink, Globe, Mail, MessageCircle, Package, Phone, Save, Search, Star } from 'lucide-react'
import { useStore, type NewRequest } from '../lib/store'
import { onAccent, whitelabelApi, type WlBrand } from '../lib/whitelabel'
import { cargoLabel, cargoTypes, countries, countryByCode, type CargoType, type Mode, type Shipment } from '../lib/data'
import { Avatar, Logo, money } from '../components/ui'
import { ShipmentDetail } from './Track'
import { Stars } from '../components/ReviewCards'
import { fadeUp, stagger } from '../lib/motion'

/* ================= public branded page ================= */
export default function BrandedPage() {
  const { slug = '' } = useParams()
  const { user, track, createRequest } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof whitelabelApi.page>> | null>(null)
  const [error, setError] = useState('')
  const [ref, setRef] = useState(''); const [tracked, setTracked] = useState<Shipment | null | undefined>(undefined); const [tracking, setTracking] = useState(false)
  const [q, setQ] = useState({ origin: '', destination: '', cargo: 'barrels' as CargoType, quantity: 2, description: '', name: user?.name ?? '', email: user?.email ?? '', phone: '', password: '' })
  const [sent, setSent] = useState<{ ref: string; price?: number } | null>(null); const [sending, setSending] = useState(false); const [qError, setQError] = useState('')
  useEffect(() => { whitelabelApi.page(slug).then((r) => { setD(r); setQ((x) => ({ ...x, origin: r.brand.origins[0] ?? r.shipper.origins[0] ?? '', destination: r.shipper.destinations[0] ?? 'GH' })) }).catch((e) => setError(e instanceof Error ? e.message : 'Not found.')) }, [slug])
  useEffect(() => { if (user) setQ((x) => ({ ...x, name: x.name || user.name, email: x.email || user.email })) }, [user])
  if (error) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center"><p className="text-danger">{error}</p><Link to="/" className="btn-ghost mt-4">Ntemtem home</Link></div></div>
  if (!d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  const { brand: b, shipper: s } = d; const fg = onAccent(b.accent)
  const doTrack = async (e: React.FormEvent) => { e.preventDefault(); setTracking(true); try { setTracked(await track(ref.trim())) } finally { setTracking(false) } }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSending(true); setQError('')
    try {
      const body: NewRequest & { preferredShipperId: string; source: 'branded' } = { origin: q.origin, destination: q.destination, mode: s.modes.length === 1 ? (s.modes[0] as Mode) : 'either', cargo: q.cargo, quantity: q.quantity, description: q.description, pickup: true, delivery: true, insurance: false, readyDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), contact: { name: q.name, email: q.email, phone: q.phone }, password: user ? undefined : q.password, preferredShipperId: s.id, source: 'branded' }
      const r = await createRequest(body); const mine = r.quotes.find((x) => x.shipperId === s.id); setSent({ ref: r.ref, price: mine?.price })
    } catch (err) { setQError(err instanceof Error ? err.message : 'Could not send.') } finally { setSending(false) }
  }
  const rates = d.rates.filter((r) => r.destination === q.destination || !q.destination).slice(0, 8)
  return (
    <div className="min-h-dvh bg-bg text-text" style={{ ['--wl' as string]: b.accent, ['--wl-fg' as string]: fg }} data-testid="branded-page">
      <header className="border-b border-border bg-surface">
        <div className="container-x flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">{b.logo ? <img src={b.logo} alt={s.name} className="h-10 max-w-[160px] object-contain" /> : <Avatar initials={s.initials} hue={b.accent} size={40} />}<div><p className="font-heading text-lg font-bold leading-tight">{s.name}</p><p className="text-xs text-text-muted">{b.tagline || s.tagline}</p></div></div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">{b.phone && <a href={`tel:${b.phone}`} className="btn-ghost !min-h-9 !px-3 text-xs"><Phone size={13} aria-hidden="true" /> {b.phone}</a>}{b.whatsapp && <a href={`https://wa.me/${b.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-9 !px-3 text-xs"><MessageCircle size={13} aria-hidden="true" /> WhatsApp</a>}{b.email && <a href={`mailto:${b.email}`} className="btn-ghost !min-h-9 !px-3 text-xs"><Mail size={13} aria-hidden="true" /> Email</a>}<a href="#quote" className="inline-flex min-h-9 items-center rounded-full px-4 text-xs font-semibold" style={{ background: b.accent, color: fg }}>Get a quote</a></nav>
        </div>
      </header>
      <main className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-wider" style={{ color: b.accent }}>{s.verified ? 'Verified on Ntemtem' : 'On Ntemtem'}{s.reviews ? ` · ${s.rating.toFixed(1)} ★ (${s.reviews})` : ''}</motion.p>
            <motion.h1 variants={fadeUp} className="mt-2 !text-[clamp(2rem,4vw,3rem)]">{b.headline || `Ship to ${s.destinations.map((c) => countryByCode(c)?.name ?? c).slice(0, 2).join(' and ')} with ${s.name}`}</motion.h1>
            <motion.p variants={fadeUp} className="mt-3 max-w-2xl text-text-muted">{b.intro || s.about}</motion.p>
            <motion.ul variants={fadeUp} className="mt-4 flex flex-wrap gap-1.5">{s.cargo.map((c) => <li key={c} className="rounded-full border border-border px-2.5 py-1 text-xs">{cargoLabel(c as CargoType)}</li>)}{s.services.slice(0, 4).map((x) => <li key={x} className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">{x}</li>)}</motion.ul>
            <motion.form variants={fadeUp} onSubmit={doTrack} className="card-dark mt-8 p-5" data-testid="wl-track">
              <h2 className="flex items-center gap-2 !text-base"><Search size={16} style={{ color: b.accent }} aria-hidden="true" /> Track a shipment</h2>
              <div className="mt-3 flex gap-2"><input aria-label="Reference" className="input-dark !min-h-10 flex-1 font-mono text-sm uppercase" placeholder="NT-XXXXXX" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} /><button disabled={tracking || ref.length < 6} className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold disabled:opacity-60" style={{ background: b.accent, color: fg }}>{tracking ? 'Looking…' : 'Track'}</button></div>
              {tracked === null && <p className="mt-2 text-xs text-danger">No shipment with that reference.</p>}
              {tracked && <div className="mt-4"><ShipmentDetail s={tracked} compact /></div>}
            </motion.form>
            {rates.length > 0 && (
              <motion.div variants={fadeUp} className="card-dark mt-6 overflow-hidden" data-testid="wl-rates">
                <div className="px-5 pt-5"><h2 className="!text-base">Our rates</h2><p className="text-xs text-text-muted">Published prices — your quote is instant.</p></div>
                <table className="mt-3 w-full text-sm"><tbody>{rates.map((r, i) => <tr key={i} className="border-t border-border/70"><td className="px-5 py-2.5">{cargoLabel(r.cargo as CargoType)} <span className="text-xs text-text-muted">· {r.origin || 'any origin'} → {countryByCode(r.destination)?.name ?? r.destination} · {r.mode}</span></td><td className="px-5 py-2.5 text-right tabular-nums"><strong>{money(r.price)}</strong> <span className="text-xs text-text-muted">per {r.basis}{r.minCharge ? ` · min ${money(r.minCharge)}` : ''} · {r.transitDays}d</span></td></tr>)}</tbody></table>
              </motion.div>
            )}
            {d.reviews.length > 0 && <motion.div variants={fadeUp} className="card-dark mt-6 p-5"><h2 className="!text-base">What customers say</h2><ul className="mt-3 divide-y divide-border/70">{d.reviews.map((r, i) => <li key={i} className="py-3"><div className="flex items-center gap-2"><Stars n={r.rating} /><span className="text-xs text-text-muted">{r.author} · verified</span></div><p className="mt-1 text-sm text-text-muted">{r.body}</p></li>)}</ul></motion.div>}
          </div>
          <motion.aside variants={fadeUp} id="quote" className="card-dark h-fit p-5 lg:sticky lg:top-6" data-testid="wl-quote">
            <h2 className="flex items-center gap-2 !text-base"><Package size={16} style={{ color: b.accent }} aria-hidden="true" /> Get a quote from {s.name}</h2>
            {sent ? <div className="mt-4 rounded-lg border border-teal/40 bg-teal/10 p-4 text-sm" data-testid="wl-sent"><p className="inline-flex items-center gap-2 font-semibold"><Check size={15} aria-hidden="true" /> Request {sent.ref} sent</p><p className="mt-1 text-text-muted">{sent.price != null ? `${s.name} quoted ${money(sent.price)} instantly from their published rates. ` : `${s.name} will reply shortly. `}Track quotes and book from <Link to="/dashboard" className="text-gold-deep hover:underline">your dashboard</Link>.</p></div> : (
              <form onSubmit={submit} className="mt-3 grid gap-2">
                {qError && <p role="alert" className="text-xs text-danger">{qError}</p>}
                <label className="text-xs text-text-muted">From<input required list="wl-origins" aria-label="Origin" className="input-dark mt-1 !min-h-9 text-sm" value={q.origin} onChange={(e) => setQ({ ...q, origin: e.target.value })} /><datalist id="wl-origins">{(b.origins.length ? b.origins : s.origins).map((o) => <option key={o} value={o} />)}</datalist></label>
                <label className="text-xs text-text-muted">To<select aria-label="Destination" className="input-dark mt-1 !min-h-9 text-sm" value={q.destination} onChange={(e) => setQ({ ...q, destination: e.target.value })}>{countries.filter((c) => s.destinations.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></label>
                <div className="grid grid-cols-[1fr_72px] gap-2"><label className="text-xs text-text-muted">What<select aria-label="Cargo" className="input-dark mt-1 !min-h-9 text-sm" value={q.cargo} onChange={(e) => setQ({ ...q, cargo: e.target.value as CargoType })}>{cargoTypes.filter((c) => s.cargo.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label className="text-xs text-text-muted">Qty<input type="number" min={1} aria-label="Quantity" className="input-dark mt-1 !min-h-9 text-sm tabular-nums" value={q.quantity} onChange={(e) => setQ({ ...q, quantity: Math.max(1, Number(e.target.value) || 1) })} /></label></div>
                <textarea rows={2} aria-label="Description" className="input-dark py-2 text-sm" placeholder="What are you sending? Where should it go?" value={q.description} onChange={(e) => setQ({ ...q, description: e.target.value })} />
                <input required minLength={2} aria-label="Your name" className="input-dark !min-h-9 text-sm" placeholder="Your name" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} />
                <input required type="email" aria-label="Email" className="input-dark !min-h-9 text-sm" placeholder="Email" value={q.email} onChange={(e) => setQ({ ...q, email: e.target.value })} />
                <input required minLength={7} aria-label="Phone" className="input-dark !min-h-9 text-sm" placeholder="Phone / WhatsApp" value={q.phone} onChange={(e) => setQ({ ...q, phone: e.target.value })} />
                {!user && <><input required minLength={8} type="password" aria-label="Password" className="input-dark !min-h-9 text-sm" placeholder="Create a password (to track your quote)" value={q.password} onChange={(e) => setQ({ ...q, password: e.target.value })} /><p className="text-[11px] text-text-muted">Already have an account? <Link to={`/login?next=/t/${slug}`} className="text-gold-deep hover:underline">Sign in</Link>.</p></>}
                <button disabled={sending} className="mt-1 inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:opacity-60" style={{ background: b.accent, color: fg }} data-testid="wl-submit">{sending ? 'Sending…' : `Request a quote`}</button>
                <p className="text-[11px] text-text-muted">Goes only to {s.name}. Your booking, payment and tracking run on Ntemtem.</p>
              </form>
            )}
          </motion.aside>
        </motion.div>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-text-muted">{s.name} · {s.hq}{b.website ? <> · <a href={b.website.startsWith('http') ? b.website : `https://${b.website}`} className="hover:text-gold-deep" target="_blank" rel="noreferrer">{b.website}</a></> : null}{b.poweredBy && <p className="mt-2 flex items-center justify-center gap-1 opacity-80"><span>Powered by</span><Link to="/" className="inline-flex"><Logo tagline={false} className="scale-75" /></Link></p>}</footer>
    </div>
  )
}

/* ================= shipper editor ================= */
export function BrandEditor() {
  const { ready, user } = useStore()
  const [d, setD] = useState<Awaited<ReturnType<typeof whitelabelApi.mine>> | null>(null)
  const [b, setB] = useState<WlBrand | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState('')
  useEffect(() => { if (ready && user?.role === 'shipper') whitelabelApi.mine().then((r) => { setD(r); setB(r.brand) }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.')) }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/brand" replace />
  if (user.role !== 'shipper' || (user.staffRole !== 'owner' && user.staffRole !== 'dispatcher')) return <Navigate to="/dashboard" replace />
  const save = async () => { if (!b) return; setBusy(true); setError(''); try { setB(await whitelabelApi.save(b)); setToast('Saved.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) } }
  const url = d ? `${d.appUrl || window.location.origin}/#/t/${b?.slug}` : ''
  const onLogo = (f: File | null) => { if (!f || !b) return; if (f.size > 180_000) { setError('Logo must be under 180 KB — export a small PNG or SVG.'); return } const r = new FileReader(); r.onload = () => setB({ ...b, logo: String(r.result) }); r.readAsDataURL(f) }
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-14">
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><motion.p variants={fadeUp} className="eyebrow mb-1">White label</motion.p><motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">Your own branded page</motion.h1><motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">A page with your logo, colour and contact details where your customers track shipments and request quotes that come only to you — priced instantly from your rate cards. Share the link on WhatsApp, Facebook and flyers, or point your own domain at it.</motion.p></div>
            <motion.div variants={fadeUp} className="flex gap-2">{b?.enabled && <a href={url} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink size={16} aria-hidden="true" /> Open page</a>}<button onClick={save} disabled={busy || !b} className="btn-gold disabled:opacity-60" data-testid="save-brand"><Save size={16} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}</button></motion.div>
          </div>
          {toast && <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2.5 text-sm text-teal"><Check size={15} aria-hidden="true" /> {toast}</p>}
          {error && <p role="alert" className="mt-6 text-sm text-danger">{error}</p>}
          {b && d && (
            <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="card-dark grid gap-4 p-5 sm:grid-cols-2" data-testid="brand-form">
                <label className="flex items-center justify-between gap-3 text-sm sm:col-span-2"><span className="font-semibold">Page is live</span><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={b.enabled} onChange={(e) => setB({ ...b, enabled: e.target.checked })} /></label>
                <label className="text-xs text-text-muted sm:col-span-2">Page address<span className="mt-1 flex items-center gap-2"><span className="text-sm text-text-muted">{(d.appUrl || window.location.origin).replace(/^https?:\/\//, '')}/#/t/</span><input aria-label="Slug" className="input-dark !min-h-9 flex-1 font-mono text-sm" value={b.slug} onChange={(e) => setB({ ...b, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setToast('Link copied.') } catch { setToast(url) } }} className="btn-ghost !min-h-9 !px-3 text-xs"><Copy size={12} aria-hidden="true" /> Copy</button></span></label>
                <label className="text-xs text-text-muted">Accent colour<span className="mt-1 flex items-center gap-2"><input type="color" aria-label="Accent colour" className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} /><input aria-label="Accent hex" className="input-dark !min-h-9 w-28 font-mono text-sm" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} /></span></label>
                <label className="text-xs text-text-muted">Logo (PNG / SVG, under 180 KB)<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Logo" className="mt-1 block w-full text-xs" onChange={(e) => onLogo(e.target.files?.[0] ?? null)} />{b.logo && <span className="mt-1 flex items-center gap-2"><img src={b.logo} alt="" className="h-8 object-contain" /><button type="button" onClick={() => setB({ ...b, logo: '' })} className="text-[11px] text-danger">Remove</button></span>}</label>
                <label className="text-xs text-text-muted sm:col-span-2">Headline<input aria-label="Headline" className="input-dark mt-1 !min-h-9 text-sm" placeholder={`Ship to Ghana with ${d.shipper.name}`} value={b.headline} onChange={(e) => setB({ ...b, headline: e.target.value })} /></label>
                <label className="text-xs text-text-muted sm:col-span-2">Tagline (under your name)<input aria-label="Tagline" className="input-dark mt-1 !min-h-9 text-sm" value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} /></label>
                <label className="text-xs text-text-muted sm:col-span-2">Intro<textarea rows={3} aria-label="Intro" className="input-dark mt-1 py-2 text-sm" value={b.intro} onChange={(e) => setB({ ...b, intro: e.target.value })} /></label>
                <label className="text-xs text-text-muted">Phone<input aria-label="Phone" className="input-dark mt-1 !min-h-9 text-sm" value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} /></label>
                <label className="text-xs text-text-muted">WhatsApp<input aria-label="WhatsApp" className="input-dark mt-1 !min-h-9 text-sm" value={b.whatsapp} onChange={(e) => setB({ ...b, whatsapp: e.target.value })} /></label>
                <label className="text-xs text-text-muted">Email<input type="email" aria-label="Email" className="input-dark mt-1 !min-h-9 text-sm" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} /></label>
                <label className="text-xs text-text-muted">Website<input aria-label="Website" className="input-dark mt-1 !min-h-9 text-sm" placeholder="yourcompany.com" value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} /></label>
                <label className="text-xs text-text-muted sm:col-span-2">Pickup cities to offer (comma-separated; blank = your profile origins)<input aria-label="Origins" className="input-dark mt-1 !min-h-9 text-sm" value={b.origins.join(', ')} onChange={(e) => setB({ ...b, origins: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12) })} /></label>
                <div className="flex flex-wrap gap-4 text-sm sm:col-span-2"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={b.showRates} onChange={(e) => setB({ ...b, showRates: e.target.checked })} /> Show my rate cards ({d.rateCards})</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={b.poweredBy} onChange={(e) => setB({ ...b, poweredBy: e.target.checked })} /> “Powered by Ntemtem” in the footer</label></div>
                <label className="text-xs text-text-muted sm:col-span-2"><span className="inline-flex items-center gap-1"><Globe size={12} aria-hidden="true" /> Your own domain (optional)</span><input aria-label="Domain" className="input-dark mt-1 !min-h-9 font-mono text-sm" placeholder="ship.yourcompany.com" value={b.domain} onChange={(e) => setB({ ...b, domain: e.target.value })} /><span className="mt-1 block text-[11px]">Point a CNAME at Ntemtem's host and visitors to that domain land on this page. Ask hello@ntemtem.com to switch on HTTPS for it.</span></label>
              </div>
              <div className="space-y-4">
                <div className="card-dark p-5"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Preview</p><div className="mt-3 overflow-hidden rounded-xl border border-border"><div className="flex items-center gap-2 border-b border-border bg-surface p-3">{b.logo ? <img src={b.logo} alt="" className="h-7 object-contain" /> : <Avatar initials={d.shipper.initials} hue={b.accent} size={28} />}<span className="text-sm font-semibold">{d.shipper.name}</span><span className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: b.accent, color: onAccent(b.accent) }}>Get a quote</span></div><div className="p-3"><p className="text-sm font-semibold">{b.headline || `Ship to ${countryByCode(d.shipper.destinations[0])?.name ?? ''} with ${d.shipper.name}`}</p><p className="mt-1 line-clamp-2 text-xs text-text-muted">{b.intro || 'Your intro appears here.'}</p></div></div></div>
                <div className="card-dark p-5 text-sm"><p className="inline-flex items-center gap-2 font-semibold"><Star size={14} className="text-gold-deep" aria-hidden="true" /> Leads from your page</p><p className="mt-1 text-3xl font-bold">{d.leads}</p><p className="text-xs text-text-muted">Requests that came through your branded page go only to you, never to competitors.</p><Link to="/dashboard/rates" className="btn-ghost mt-3 !min-h-8 !px-3 text-xs">Publish rate cards for instant quotes</Link></div>
                <p className="text-[11px] text-text-muted"><BadgeCheck size={11} className="inline" aria-hidden="true" /> Your Ntemtem listing, reviews and verification badge carry over to the page.</p>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
