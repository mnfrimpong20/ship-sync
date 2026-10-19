import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, BarChart3, Check, FileText, LogIn, MessageSquare, Receipt, Upload, X } from 'lucide-react'
import { networkApi, type BrokerApplicationInput } from '../lib/brokers'
import { cargoTypes, countries } from '../lib/data'

const AUTHORITY: Record<string, string> = { GH: 'GRA Customs Division', NG: 'Nigeria Customs Service' }
const SPECIALTIES = ['Personal effects & barrels', 'Vehicles', 'Commercial goods', 'Containers (FCL)', 'Food & FDA permits', 'Machinery', 'Pharmaceuticals', 'Returning residents']

/** Photos are shrunk on the phone before upload; PDFs go as they are (max 5 MB). */
async function readLicence(f: File): Promise<string> {
  if (f.type === 'application/pdf') {
    if (f.size > 5 * 1024 * 1024) throw new Error('That PDF is over 5 MB — try a photo of the licence instead.')
    return await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f) })
  }
  if (!/^image\/(png|jpe?g|webp|heic)/.test(f.type)) throw new Error('Upload a PDF or a photo (JPG or PNG).')
  const bmp = await createImageBitmap(f).catch(() => { throw new Error('Could not open that photo — try a JPG.') })
  const s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85)
}

export default function BrokerJoin() {
  const [f, setF] = useState<BrokerApplicationInput>({ company: '', name: '', email: '', phone: '', whatsapp: '', country: 'GH', ports: [], licenceNo: '', licenceAuthority: AUTHORITY.GH, licenceExpires: null, specialties: [], about: '', fees: {}, dutyAdvance: false, licenceFile: null, website: '' })
  const [fees, setFees] = useState<Record<string, string>>({}); const [otherPort, setOtherPort] = useState(''); const [fileName, setFileName] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false)
  const country = useMemo(() => countries.find((c) => c.code === f.country), [f.country])
  const set = <K extends keyof BrokerApplicationInput>(k: K, v: BrokerApplicationInput[K]) => setF((x) => ({ ...x, [k]: v }))
  const toggle = (k: 'ports' | 'specialties', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const ports = [...f.ports, ...otherPort.split(',').map((x) => x.trim()).filter((x) => x.length > 1)]
    const missing: [string, string, string][] = [[f.company, 'ap-company', 'Enter your firm’s name.'], [f.name, 'ap-name', 'Enter your name.'], [/^\S+@\S+\.\S+$/.test(f.email) ? 'ok' : '', 'ap-email', 'Enter a valid email — it becomes your sign-in.'], [f.phone, 'ap-phone', 'Enter a phone number.'], [f.licenceNo, 'ap-lic', 'Enter your customs licence number.']]
    const gap = missing.find(([v]) => !v.trim()); if (gap) { setErr(gap[2]); document.getElementById(gap[1])?.focus(); return }
    if (!ports.length) return setErr('Pick at least one port you clear at.')
    if (!f.licenceFile) return setErr('Upload a PDF or photo of your customs licence — we check it before you go live.')
    const fz: Record<string, number> = {}; for (const [k, v] of Object.entries(fees)) if (v.trim() !== '') fz[k] = Number(v)
    setBusy(true)
    try { await networkApi.apply({ ...f, ports, fees: fz }); setDone(true); window.scrollTo({ top: 0 }) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send your application.') } finally { setBusy(false) }
  }
  const lbl = 'label-dark'
  if (done) return (
    <div className="container-x max-w-2xl py-16 text-center" data-testid="broker-applied">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-teal/15 text-teal"><Check size={28} aria-hidden="true" /></span>
      <h1 className="mt-4 !text-3xl">Application received</h1>
      <p className="mt-3 text-text-muted">Thanks, {f.name.split(' ')[0]}. We check every customs licence before a firm goes live — usually within 2 working days. When you’re approved, we’ll email <b className="text-text">{f.email}</b> a link to set your password.</p>
      <p className="mt-6 text-sm text-text-muted">After that, you sign in any time at <Link to="/broker-portal" className="font-semibold text-gold-deep underline">ntemtem.com/broker-portal</Link> — or from <b className="text-text">Broker sign in</b> at the bottom of every page.</p>
      <Link to="/brokers" className="btn-ghost mt-8">Back to the broker directory</Link>
    </div>
  )
  return (
    <div className="container-x py-10 md:py-14">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <p className="eyebrow mb-2">For licensed customs brokers</p>
          <h1 className="!text-[clamp(1.9rem,4vw,2.8rem)]">Join the Ntemtem broker network</h1>
          <p className="mt-3 max-w-2xl text-text-muted md:text-lg">Get clearance jobs from shipping companies and customers shipping to West Africa. Listing is free. We check your licence, then send you a login to your own broker dashboard.</p>
          <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm">Already approved? <Link to="/broker-portal/login" className="font-semibold text-gold-deep underline">Sign in to your broker dashboard</Link></p>

          <form onSubmit={submit} className="mt-8 grid gap-8" noValidate data-testid="broker-apply">
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)} />
            <fieldset className="card-dark grid gap-4 p-5 sm:grid-cols-2"><legend className="px-1 text-lg font-semibold">Your firm</legend>
              <div className="sm:col-span-2"><label htmlFor="ap-company" className={lbl}>Firm name</label><input id="ap-company" required className="input-dark" value={f.company} onChange={(e) => set('company', e.target.value)} autoComplete="organization" /></div>
              <div><label htmlFor="ap-name" className={lbl}>Your name</label><input id="ap-name" required className="input-dark" value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" /></div>
              <div><label htmlFor="ap-email" className={lbl}>Email</label><input id="ap-email" type="email" required className="input-dark" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /><p className="mt-1 text-xs text-text-muted">This becomes your sign-in.</p></div>
              <div><label htmlFor="ap-phone" className={lbl}>Phone</label><input id="ap-phone" type="tel" required className="input-dark" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" placeholder="+233 24 …" /></div>
              <div><label htmlFor="ap-wa" className={lbl}>WhatsApp (if different)</label><input id="ap-wa" type="tel" className="input-dark" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
            </fieldset>

            <fieldset className="card-dark grid gap-4 p-5 sm:grid-cols-2"><legend className="px-1 text-lg font-semibold">Licence & ports</legend>
              <div><label htmlFor="ap-country" className={lbl}>Country</label><select id="ap-country" className="input-dark" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value, ports: [], licenceAuthority: AUTHORITY[e.target.value] ?? '' })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
              <div><label htmlFor="ap-auth" className={lbl}>Licensing authority</label><input id="ap-auth" className="input-dark" value={f.licenceAuthority} onChange={(e) => set('licenceAuthority', e.target.value)} /></div>
              <div><label htmlFor="ap-lic" className={lbl}>Customs licence number</label><input id="ap-lic" required className="input-dark font-mono" value={f.licenceNo} onChange={(e) => set('licenceNo', e.target.value)} /></div>
              <div><label htmlFor="ap-exp" className={lbl}>Licence expires</label><input id="ap-exp" type="date" className="input-dark" value={f.licenceExpires ?? ''} onChange={(e) => set('licenceExpires', e.target.value || null)} /></div>
              <div className="sm:col-span-2"><span className={lbl} id="ap-ports-l">Ports you clear at</span>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="ap-ports-l">{(country?.ports ?? []).map((p) => <label key={p} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 focus-within:ring-2 focus-within:ring-gold text-sm ${f.ports.includes(p) ? 'border-gold bg-gold/15 font-semibold' : 'border-border'}`}><input type="checkbox" className="sr-only" checked={f.ports.includes(p)} onChange={() => toggle('ports', p)} />{f.ports.includes(p) && <Check size={14} aria-hidden="true" />}{p}</label>)}</div>
                <label htmlFor="ap-other" className="mt-3 block text-xs text-text-muted">Other ports or border posts (comma-separated)</label><input id="ap-other" className="input-dark mt-1" value={otherPort} onChange={(e) => setOtherPort(e.target.value)} placeholder="e.g. Kotoka Airport, Aflao" /></div>
              <div className="sm:col-span-2"><span className={lbl}>Copy of your licence</span>
                <input id="ap-file" type="file" accept="application/pdf,image/*" className="peer sr-only" data-testid="ap-file" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setErr(''); try { set('licenceFile', await readLicence(file)); setFileName(file.name) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not read the file.') } }} />
                <label htmlFor="ap-file" className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-dashed peer-focus-visible:ring-2 peer-focus-visible:ring-gold border-border px-4 py-3 text-sm hover:border-gold">{f.licenceFile ? <FileText size={18} className="text-teal" aria-hidden="true" /> : <Upload size={18} className="text-gold-deep" aria-hidden="true" />}<span className="min-w-0 flex-1 truncate">{fileName || 'Upload a PDF or take a photo'}</span>{f.licenceFile && <button type="button" onClick={(e) => { e.preventDefault(); set('licenceFile', null); setFileName('') }} className="rounded p-1 text-text-muted hover:text-danger" aria-label="Remove file"><X size={16} /></button>}</label>
                
                <p className="mt-1 text-xs text-text-muted">Only Ntemtem staff see this. It’s used to verify your listing.</p></div>
            </fieldset>

            <fieldset className="card-dark grid gap-4 p-5"><legend className="px-1 text-lg font-semibold">What you handle</legend>
              <div><span className={lbl} id="ap-spec-l">Specialties</span><div className="flex flex-wrap gap-2" role="group" aria-labelledby="ap-spec-l">{SPECIALTIES.map((s) => <label key={s} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 focus-within:ring-2 focus-within:ring-gold text-sm ${f.specialties.includes(s) ? 'border-gold bg-gold/15 font-semibold' : 'border-border'}`}><input type="checkbox" className="sr-only" checked={f.specialties.includes(s)} onChange={() => toggle('specialties', s)} />{f.specialties.includes(s) && <Check size={13} aria-hidden="true" />}{s}</label>)}</div></div>
              <div><p className={lbl}>Your clearing fee per shipment (USD)</p><p className="-mt-1 mb-2 text-xs text-text-muted">Excluding duty and port charges. Leave blank if you don’t handle that cargo — you can change these later.</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cargoTypes.map((c) => <div key={c.id}><label htmlFor={`ap-fee-${c.id}`} className="mb-1 block text-xs text-text-muted">{c.label}</label><input id={`ap-fee-${c.id}`} type="number" min={0} inputMode="decimal" className="input-dark tabular-nums" value={fees[c.id] ?? ''} onChange={(e) => setFees({ ...fees, [c.id]: e.target.value })} /></div>)}</div></div>
              <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[var(--color-gold)]" checked={f.dutyAdvance} onChange={(e) => set('dutyAdvance', e.target.checked)} /><span>I can pay duty for the client and bill it back</span></label>
              <div><label htmlFor="ap-about" className={lbl}>About your firm (shown on your listing)</label><textarea id="ap-about" rows={3} maxLength={600} className="input-dark py-2" value={f.about} onChange={(e) => set('about', e.target.value)} placeholder="Years in business, what you’re known for, languages…" /></div>
            </fieldset>

            {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
            <div className="flex flex-wrap items-center gap-4"><button disabled={busy} className="btn-gold !min-h-12 !px-8" data-testid="ap-submit">{busy ? 'Sending…' : 'Send application'}</button><p className="text-xs text-text-muted">By applying you agree to our <Link to="/terms" className="underline">terms</Link>.</p></div>
          </form>
        </div>

        <aside className="lg:pt-16">
          <div className="card-dark p-5 lg:sticky lg:top-24">
            <p className="font-semibold">What you get</p>
            <ul className="mt-3 grid gap-3 text-sm">
              {([[BadgeCheck, 'A verified listing', 'Shown to shipping companies and customers booking clearance at your port.'], [FileText, 'Jobs with the papers attached', 'Bill of lading, invoice and packing list arrive with every job.'], [MessageSquare, 'One thread per shipment', 'Talk to the shipping office and the customer in one place.'], [Receipt, 'Invoices in two clicks', 'Bill your fee and disbursements; track who has paid.'], [BarChart3, 'Analytics & reports', 'Days per step, fees by month, CSV exports for your accountant.']] as const).map(([I, t, d]) => <li key={t} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep"><I size={15} aria-hidden="true" /></span><span><b>{t}</b><span className="block text-text-muted">{d}</span></span></li>)}
            </ul>
            <div className="mt-5 border-t border-border pt-4 text-sm"><p className="text-text-muted">Already on Ntemtem?</p><Link to="/broker-portal/login" className="btn-ghost mt-2 w-full"><LogIn size={16} aria-hidden="true" /> Broker sign in</Link></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
