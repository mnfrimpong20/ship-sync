import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { BadgeCheck, Check, FileText, Landmark, Phone } from 'lucide-react'
import { brokersApi, jobStepLabels, JOB_STEPS, type Broker, type BrokerInput, type JobStep, type StepInput } from '../lib/brokers'
import { countries, cargoTypes, type CargoType } from '../lib/data'
import { Avatar, Empty, Logo, Pill, Rating, fmtDateTime, money } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { StatCard } from '../components/board'

/* ================= public directory ================= */
export function BrokerCard({ b, cargo }: { b: Broker; cargo?: CargoType }) {
  return (
    <div className="card-dark flex h-full min-w-0 flex-col p-5" data-testid="broker-card">
      <div className="flex items-start gap-3"><Avatar initials={b.initials} hue={b.hue} size={44} /><div className="min-w-0 flex-1"><p className="font-semibold">{b.name}{b.verified && <BadgeCheck size={14} className="ml-1 inline text-teal" aria-label="Verified" />}</p><p className="truncate text-xs text-text-muted">{b.company || 'Independent agent'} · {b.ports.join(', ')}</p><div className="mt-1 flex items-center gap-2 text-xs"><Rating value={b.rating} /><span className="text-text-muted">{b.reviews} reviews · ~{b.responseHours}h reply</span></div></div></div>
      <p className="mt-3 line-clamp-3 text-sm text-text-muted">{b.about}</p>
      {b.specialties.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{b.specialties.map((s) => <li key={s}><Pill tone="muted">{s}</Pill></li>)}</ul>}
      <div className="flex-1" />
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">{(cargo ? [cargo] : (['barrels', 'vehicle', 'container20'] as CargoType[])).map((c) => <div key={c}><dt className="text-text-muted">{cargoTypes.find((x) => x.id === c)?.label}</dt><dd className="font-semibold tabular-nums">{b.fees[c] != null ? money(b.fees[c]!) : '—'}</dd></div>)}</dl>
      <p className="mt-2 text-[11px] text-text-muted">{b.licenceAuthority}{b.licenceNo ? ` · ${b.licenceNo}` : ''}{b.dutyAdvance ? ' · can advance duty' : ''}</p>
    </div>
  )
}

export default function BrokersPage() {
  const [sp] = useSearchParams()
  const [dest, setDest] = useState(sp.get('destination') || 'GH')
  const [list, setList] = useState<Broker[] | null>(null)
  useEffect(() => { brokersApi.list(dest).then(setList).catch(() => setList([])) }, [dest])
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Customs brokers</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">Licensed clearing agents at the port</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">Book one on any shipment from your dashboard. They lodge the declaration, tell you the assessed duty, pay it and release your goods — with every step on your tracking page.</motion.p>
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 max-w-5xl">
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2"><select aria-label="Destination" className="input-dark !min-h-10 !w-auto text-sm" value={dest} onChange={(e) => setDest(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select><span className="text-xs text-text-muted">{list?.length ?? 0} listed</span></motion.div>
          <motion.div variants={fadeUp} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list === null && <p className="text-sm text-text-muted">Loading…</p>}
            {list && list.length === 0 && <div className="md:col-span-3"><Empty title="No brokers listed here yet" body="We're onboarding licensed agents port by port. Shippers can still clear through their own agents." /></div>}
            {list?.map((b) => <BrokerCard key={b.id} b={b} />)}
          </motion.div>
          <motion.p variants={fadeUp} className="mt-8 text-center text-sm text-text-muted">Are you a licensed clearing agent? <a href="mailto:hello@shipsync.africa?subject=Broker listing" className="text-gold hover:underline">Get listed</a>.</motion.p>
        </motion.div>
      </div>
    </div>
  )
}

/* ================= broker portal (no login) ================= */
export function BrokerPortal() {
  const { token = '' } = useParams()
  const [d, setD] = useState<Awaited<ReturnType<typeof brokersApi.portal>> | null>(null)
  const [error, setError] = useState(''); const [toast, setToast] = useState('')
  const [f, setF] = useState<StepInput | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => brokersApi.portal(token).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Not found.'))
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  if (error && !d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-danger">{error}</div></div>
  if (!d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  const { job: j, shipment: s } = d
  const idx = JOB_STEPS.indexOf(j.status as JobStep); const next: JobStep | null = idx >= 0 && idx < JOB_STEPS.length - 1 ? JOB_STEPS[idx + 1] : null
  const closed = ['done', 'cancelled', 'declined'].includes(j.status)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!f) return; setBusy(true); setError(''); try { await brokersApi.portalStep(token, f); await load(); setF(null); setToast('Updated — the customer and the shipper have been told.') } catch (err) { setError(err instanceof Error ? err.message : 'Could not update.') } finally { setBusy(false) } }
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="container-x max-w-2xl py-8 md:py-12">
        <div className="flex items-center justify-between gap-3"><Logo /><span className="text-xs text-text-muted">Broker portal</span></div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6">
          <motion.div variants={fadeUp} className="card-dark p-5" data-testid="portal-job">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow mb-1">Clearance job</p><h1 className="!text-2xl">{s.ref} · {s.cargoLabel}</h1><p className="mt-1 text-sm text-text-muted">For {s.customer} · shipped by {j.shipperName} · {s.pieces ? `${s.pieces} piece${s.pieces === 1 ? '' : 's'} · ` : ''}shipment status: {s.status.replace('_', ' ')}</p></div><Pill tone={j.status === 'done' ? 'green' : closed ? 'danger' : 'gold'}>{jobStepLabels[j.status]}</Pill></div>
            {toast && <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-text-muted">Your fee on file</dt><dd className="font-semibold tabular-nums">{money(j.feeUsd)}</dd></div>
              {s.consignee && <div><dt className="text-xs text-text-muted">Consignee</dt><dd>{s.consignee.name} · <a href={`tel:${s.consignee.phone}`} className="text-gold hover:underline"><Phone size={11} className="inline" aria-hidden="true" /> {s.consignee.phone}</a><span className="block text-xs text-text-muted">{s.consignee.address}{s.consignee.city ? `, ${s.consignee.city}` : ''}</span></dd></div>}
              {s.vehicle && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">Vehicle</dt><dd>{s.vehicle.label}{s.vehicle.body ? ` · ${s.vehicle.body}` : ''}{s.vehicle.engineL ? ` · ${s.vehicle.engineL} L` : ''}{s.vehicle.valueUsd ? ` · declared ${money(s.vehicle.valueUsd)}` : ''}<span className="block font-mono text-xs">{s.vehicle.vin}</span></dd></div>}
              {s.container && <div><dt className="text-xs text-text-muted">Container</dt><dd className="font-mono text-xs">{s.container.number} · {s.container.vessel}{s.container.eta ? ` · ETA ${s.container.eta}` : ''}</dd></div>}
              {j.notes && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">Notes</dt><dd>{j.notes}</dd></div>}
            </dl>
            {d.documents.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Documents</p><ul className="mt-1 flex flex-wrap gap-2">{d.documents.map((x) => x.link ? <li key={x.id}><Link to={x.link} target="_blank" className="btn-ghost !min-h-8 !px-2.5 text-xs"><FileText size={12} aria-hidden="true" /> {x.title}</Link></li> : <li key={x.id} className="text-xs text-text-muted">{x.title} (ask the shipper for a share link)</li>)}</ul></div>}
            <ol className="mt-5 space-y-1.5" aria-label="Steps">{JOB_STEPS.map((st, i) => <li key={st} className={`flex items-center gap-2 text-sm ${i <= idx ? 'text-text' : 'text-text-muted'}`}><span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${i < idx ? 'bg-teal text-on-accent' : i === idx ? 'bg-gold text-on-accent' : 'bg-surface-2'}`}>{i < idx ? '✓' : i + 1}</span>{jobStepLabels[st]}</li>)}</ol>
            {!closed && !f && (
              <div className="mt-5 flex flex-wrap gap-2">
                {next && <button onClick={() => setF({ status: next, note: '', dutyCurrency: j.dutyCurrency ?? (s.destination === 'NG' ? 'NGN' : 'GHS') })} className="btn-gold" data-testid="portal-next">{j.status === 'requested' ? 'Accept the job' : `Mark: ${jobStepLabels[next]}`}</button>}
                {j.status === 'requested' && <button onClick={() => setF({ status: 'declined', note: '' })} className="btn-ghost text-danger">Decline</button>}
              </div>
            )}
            {f && (
              <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-border bg-surface-2/40 p-4" aria-label="Update job">
                <p className="font-semibold">{jobStepLabels[f.status]}</p>
                {f.status === 'assessed' && <div className="grid grid-cols-[1fr_auto] gap-2"><input type="number" min={0} required aria-label="Duty assessed" className="input-dark !min-h-10 text-sm tabular-nums" placeholder="Total duty & taxes assessed" value={f.dutyLocal ?? ''} onChange={(e) => setF({ ...f, dutyLocal: e.target.value ? Number(e.target.value) : undefined })} /><select aria-label="Currency" className="input-dark !min-h-10 text-sm" value={f.dutyCurrency} onChange={(e) => setF({ ...f, dutyCurrency: e.target.value })}><option>GHS</option><option>NGN</option><option>USD</option></select><input aria-label="Customs reference" className="input-dark !min-h-10 text-sm col-span-2" placeholder="ICUMS / NCS declaration reference" value={f.reference ?? ''} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>}
                <input aria-label="Note" className="input-dark !min-h-10 text-sm" placeholder={f.status === 'declined' ? 'Why? (shown to the customer)' : 'Note for the customer and shipper (optional)'} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setF(null)} className="btn-ghost !min-h-10 !px-4 text-sm">Back</button><button disabled={busy} className="btn-gold !min-h-10 !px-4 text-sm disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button></div>
              </form>
            )}
            <ul className="mt-5 space-y-1 border-t border-border pt-4 text-xs text-text-muted">{j.timeline.slice().reverse().map((t, k) => <li key={k}><span className="text-text">{jobStepLabels[t.status as JobStep] ?? t.status}</span> · {fmtDateTime(t.at)} · {t.by}{t.note ? ` — ${t.note}` : ''}</li>)}</ul>
          </motion.div>
          <motion.p variants={fadeUp} className="mt-4 text-center text-xs text-text-muted">This link is private to you and this job. Questions: the shipper's office or hello@shipsync.africa.</motion.p>
        </motion.div>
      </div>
    </div>
  )
}

/* ================= admin ================= */
const blank = (): BrokerInput => ({ name: '', company: '', country: 'GH', ports: ['Tema'], licenceNo: '', licenceAuthority: 'GRA Customs Division', phone: '', whatsapp: '', email: '', about: '', specialties: [], fees: { barrels: 60, boxes: 60, pallets: 110, vehicle: 220, container20: 380, container40: 520, commercial: 300 }, dutyAdvance: false, responseHours: 24, verified: false, active: true })
export function AdminBrokers() {
  const [list, setList] = useState<Broker[] | null>(null)
  const [form, setForm] = useState<(BrokerInput & { id?: string }) | null>(null)
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('')
  const load = () => brokersApi.admin().then(setList).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(t) }, [msg])
  const act = async (fn: () => Promise<unknown>, m: string, key: string) => { setBusy(key); setError(''); try { await fn(); await load(); setMsg(m) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') } }
  const fee = (k: CargoType, v: string) => form && setForm({ ...form, fees: { ...form.fees, [k]: v ? Number(v) : undefined } })
  return (
    <section className="mt-14" data-testid="admin-brokers">
      <p className="eyebrow mb-1">Customs brokers</p>
      <h2 className="!text-[clamp(1.5rem,3vw,2rem)]">Clearing agents on the marketplace</h2>
      <p className="mt-1 text-text-muted">Licensed agents customers and shippers can book per shipment. Verify a listing once you've seen the licence.</p>
      {msg && <p role="status" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-4 py-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {msg}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><StatCard label="Listed" value={list?.length ?? 0} hint="All ports" icon={Landmark} /><StatCard label="Verified" value={list?.filter((b) => b.verified).length ?? 0} hint="Licence checked" icon={BadgeCheck} /><StatCard label="Jobs" value={list?.reduce((n, b) => n + b.jobs, 0) ?? 0} hint="Booked through the platform" icon={FileText} /></div>
      <div className="mt-4 flex justify-end">{!form && <button onClick={() => setForm(blank())} className="btn-gold !min-h-9 !px-4 text-sm" data-testid="new-broker">Add a broker</button>}</div>
      {form && (
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { if (form.id) await brokersApi.update(form.id, form); else await brokersApi.create(form); setForm(null) }, form.id ? 'Broker updated.' : 'Broker listed.', 'save') }} className="card-dark mt-4 grid gap-3 p-5 sm:grid-cols-2" aria-label="Broker form" data-testid="broker-form">
          <label className="text-xs text-text-muted">Name<input required className="input-dark mt-1 !min-h-9 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Company<input className="input-dark mt-1 !min-h-9 text-sm" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Country<select className="input-dark mt-1 !min-h-9 text-sm" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value, licenceAuthority: e.target.value === 'NG' ? 'Nigeria Customs Service' : e.target.value === 'GH' ? 'GRA Customs Division' : form.licenceAuthority })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></label>
          <label className="text-xs text-text-muted">Ports (comma-separated)<input required className="input-dark mt-1 !min-h-9 text-sm" value={form.ports.join(', ')} onChange={(e) => setForm({ ...form, ports: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
          <label className="text-xs text-text-muted">Licence no.<input className="input-dark mt-1 !min-h-9 text-sm" value={form.licenceNo} onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Licensing authority<input className="input-dark mt-1 !min-h-9 text-sm" value={form.licenceAuthority} onChange={(e) => setForm({ ...form, licenceAuthority: e.target.value })} /></label>
          <label className="text-xs text-text-muted">Phone<input className="input-dark mt-1 !min-h-9 text-sm" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="text-xs text-text-muted">WhatsApp<input className="input-dark mt-1 !min-h-9 text-sm" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">Email (receives job links)<input type="email" className="input-dark mt-1 !min-h-9 text-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">About<textarea rows={2} className="input-dark mt-1 py-2 text-sm" value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} /></label>
          <label className="text-xs text-text-muted sm:col-span-2">Specialties (comma-separated)<input className="input-dark mt-1 !min-h-9 text-sm" value={form.specialties.join(', ')} onChange={(e) => setForm({ ...form, specialties: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8) })} /></label>
          <div className="grid grid-cols-4 gap-2 sm:col-span-2">{cargoTypes.map((c) => <label key={c.id} className="text-[11px] text-text-muted">{c.label}<input type="number" min={0} className="input-dark mt-1 !min-h-8 text-xs tabular-nums" value={form.fees[c.id] ?? ''} onChange={(e) => fee(c.id, e.target.value)} /></label>)}</div>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.dutyAdvance} onChange={(e) => setForm({ ...form, dutyAdvance: e.target.checked })} /> Advances duty</label><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[var(--color-gold)]" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Listed</label><label className="inline-flex items-center gap-2">Replies in <input type="number" min={1} className="input-dark !min-h-8 !w-16 text-xs tabular-nums" value={form.responseHours} onChange={(e) => setForm({ ...form, responseHours: Number(e.target.value) || 24 })} /> h</label></div>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setForm(null)} className="btn-ghost !min-h-9 !px-4 text-sm">Cancel</button><button disabled={busy === 'save'} className="btn-gold !min-h-9 !px-4 text-sm disabled:opacity-60">{busy === 'save' ? 'Saving…' : form.id ? 'Save' : 'List broker'}</button></div>
        </form>
      )}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {list?.map((b) => (
          <li key={b.id} className={`card-dark p-4 ${b.active ? '' : 'opacity-60'}`} data-testid="admin-broker-row">
            <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Avatar initials={b.initials} hue={b.hue} size={32} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{b.name}{b.verified && <BadgeCheck size={13} className="ml-1 inline text-teal" />}</p><p className="truncate text-xs text-text-muted">{b.company || 'Independent'} · {b.countryName} · {b.ports.join(', ')} · {b.jobs} job{b.jobs === 1 ? '' : 's'}</p></div></div><div className="flex gap-1.5"><button onClick={() => act(() => brokersApi.update(b.id, { verified: !b.verified }), b.verified ? 'Verification removed.' : 'Broker verified.', b.id)} disabled={busy === b.id} className="btn-ghost !min-h-8 !px-2.5 text-xs">{b.verified ? 'Unverify' : 'Verify'}</button><button onClick={() => setForm({ id: b.id, name: b.name, company: b.company, country: b.country, ports: b.ports, licenceNo: b.licenceNo, licenceAuthority: b.licenceAuthority, phone: b.phone, whatsapp: b.whatsapp, email: b.email, about: b.about, specialties: b.specialties, fees: b.fees, dutyAdvance: b.dutyAdvance, responseHours: b.responseHours, verified: b.verified, active: b.active })} className="btn-ghost !min-h-8 !px-2.5 text-xs">Edit</button></div></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
