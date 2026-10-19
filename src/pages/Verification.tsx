import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, Clock, FileText, Loader2, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react'
import { useStore } from '../lib/store'
import { onboardingApi, type CompanyDocKind, type DocsPayload } from '../lib/onboarding'
import { Pill, fmtDate, fmtDateTime, VerifiedMark } from '../components/ui'
import { fadeUp, stagger } from '../lib/motion'
import { canManageOps } from '../lib/ops'

const kb = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const statusTone = { submitted: 'gold', accepted: 'green', rejected: 'danger' } as const
const statusLabel = { submitted: 'Under review', accepted: 'Accepted', rejected: 'Needs another copy' } as const

/** Shipper → Verification: upload the company's documents and ask for the badge. */
export default function Verification() {
  const { ready, user } = useStore()
  const [d, setD] = useState<DocsPayload | null>(null)
  const [kind, setKind] = useState<CompanyDocKind>('business_registration')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(''); const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => onboardingApi.docs().then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'))
  useEffect(() => { if (ready && user?.role === 'shipper') load() }, [ready, user])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) }, [toast])
  if (!ready) return <BrandLoader partner />
  if (!user) return <Navigate to="/login?next=/dashboard/verification" replace />
  if (user.role !== 'shipper') return <Navigate to="/dashboard" replace />
  const canEdit = canManageOps(user.staffRole)
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 4_000_000) { setErr('Keep documents under 4 MB.'); e.target.value = ''; return }
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) { setErr('PDF, JPG, PNG or WebP only.'); e.target.value = ''; return }
    setBusy(true); setErr('')
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(file) })
      await onboardingApi.upload({ kind, title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Document', mime: file.type, data, note }); setNote(''); await load(); setToast('Uploaded — we’ll review it.')
    } catch (er) { setErr(er instanceof Error ? er.message : 'Upload failed.') } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const remove = async (id: string) => { setBusy(true); setErr(''); try { await onboardingApi.remove(id); await load() } catch (er) { setErr(er instanceof Error ? er.message : 'Could not remove.') } finally { setBusy(false) } }
  const request = async () => { setBusy(true); setErr(''); try { await onboardingApi.requestVerification(); await load(); setToast('Request sent — usually reviewed within one business day.') } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  const have = (k: CompanyDocKind) => d?.documents.some((x) => x.kind === k && x.status !== 'rejected')
  const requiredDone = d ? d.kinds.filter((k) => k.required).every((k) => have(k.id)) : false
  return (
    <div className="container-x py-8 md:py-10">
      <motion.div initial="hidden" animate="show" variants={stagger}>
        <motion.p variants={fadeUp} className="eyebrow mb-1">Company</motion.p>
        <motion.h1 variants={fadeUp} className="!text-[clamp(1.6rem,3vw,2.2rem)]">Verification</motion.h1>
        <motion.p variants={fadeUp} className="mt-1 max-w-2xl text-text-muted">Verified shippers carry the badge on their listing, rank higher in matching and win more quotes. We check that the company is real, licensed where required, and insured. Your documents are seen only by Ntemtem staff.</motion.p>
        {toast && <p role="status" className="mt-4 inline-flex items-center gap-2 text-sm text-teal"><Check size={14} aria-hidden="true" /> {toast}</p>}
        {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}

        <motion.div variants={fadeUp} className="mt-6 grid gap-5 lg:grid-cols-3">
          <div className="card-dark p-5 lg:col-span-1" data-testid="verify-status">
            <h2 className="flex items-center gap-2 !text-base"><ShieldCheck size={16} className="text-gold-deep" aria-hidden="true" /> Status</h2>
            {d?.verified ? (
              <div className="mt-3 flex items-center gap-3"><VerifiedMark size={40} aria-hidden="true" /><div><p className="font-semibold">Verified</p><p className="text-xs text-text-muted">Your listing carries the badge.</p></div></div>
            ) : d?.requestedAt ? (
              <div className="mt-3 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-gold/15 text-gold-deep"><Clock size={20} aria-hidden="true" /></span><div><p className="font-semibold">Under review</p><p className="text-xs text-text-muted">Requested {fmtDateTime(d.requestedAt)}. Usually one business day.</p></div></div>
            ) : (
              <div className="mt-3"><p className="text-sm text-text-muted">Not yet requested.</p></div>
            )}
            {d?.note && !d.verified && <p className="mt-3 rounded-lg bg-danger/10 p-3 text-xs text-danger">{d.note}</p>}
            {d && (
              <ul className="mt-4 space-y-1.5 text-sm" aria-label="Required documents">
                {d.kinds.filter((k) => k.id !== 'other').map((k) => <li key={k.id} className="flex items-center gap-2">{have(k.id) ? <Check size={14} className="text-teal" aria-hidden="true" /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-border" aria-hidden="true" />}<span className={have(k.id) ? '' : 'text-text-muted'}>{k.label}</span>{k.required && !have(k.id) && <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-gold-deep">required</span>}</li>)}
              </ul>
            )}
            {canEdit && d && !d.verified && !d.requestedAt && <button onClick={request} disabled={busy || !requiredDone} className="btn-gold mt-4 w-full !min-h-10 text-sm disabled:opacity-60" data-testid="request-verification"><ShieldCheck size={16} aria-hidden="true" /> Request verification</button>}
            {!requiredDone && !d?.verified && <p className="mt-2 text-xs text-text-muted">Upload the required documents to request review.</p>}
            <p className="mt-4 text-xs text-text-muted">Part of your <Link to="/dashboard/shipper" className="underline hover:text-gold-deep">setup checklist</Link>.</p>
          </div>

          <div className="lg:col-span-2 space-y-5">
            {canEdit && (
              <div className="card-dark p-5" data-testid="verify-upload">
                <h2 className="flex items-center gap-2 !text-base"><Upload size={16} className="text-gold-deep" aria-hidden="true" /> Upload a document</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label className="grid gap-1 text-xs"><span className="text-text-muted">Document type</span><select className="input-dark !min-h-10" value={kind} onChange={(e) => setKind(e.target.value as CompanyDocKind)} data-testid="doc-kind">{d?.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}{k.required ? ' (required)' : ''}</option>)}</select></label>
                  <div className="flex items-end"><button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-gold !min-h-10 w-full text-sm disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />} Choose file</button></div>
                </div>
                <label className="mt-3 grid gap-1 text-xs"><span className="text-text-muted">Note for the reviewer (optional)</span><input className="input-dark !min-h-10" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Licence is held by our parent company, Atlantic Bridge Holdings" /></label>
                <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={pick} data-testid="doc-file" />
                <p className="mt-2 text-xs text-text-muted">PDF, JPG, PNG or WebP · under 4 MB · a clear photo of the paper certificate is fine.</p>
              </div>
            )}
            <div className="card-dark p-5">
              <h2 className="flex items-center gap-2 !text-base"><FileText size={16} className="text-gold-deep" aria-hidden="true" /> On file {d && <span className="text-xs font-normal text-text-muted">{d.documents.length}</span>}</h2>
              <ul className="mt-3 divide-y divide-border" aria-label="Documents">
                {d?.documents.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm" data-testid="company-doc">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold"><a href={x.url} target="_blank" rel="noreferrer" className="hover:text-gold-deep focus-ring rounded">{x.title}</a><Pill tone={statusTone[x.status]}>{statusLabel[x.status]}</Pill></p>
                      <p className="text-xs text-text-muted">{x.label} · {kb(x.size)} · {x.uploadedBy}, {fmtDate(x.createdAt)}{x.note ? ` · “${x.note}”` : ''}</p>
                      {x.status === 'rejected' && x.reviewNote && <p className="mt-1 flex items-start gap-1.5 text-xs text-danger"><XCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {x.reviewNote}</p>}
                      {x.status === 'accepted' && <p className="mt-1 text-xs text-teal">Accepted {x.reviewedAt ? fmtDate(x.reviewedAt) : ''}</p>}
                    </div>
                    {canEdit && x.status !== 'accepted' && <button onClick={() => remove(x.id)} disabled={busy} className="btn-ghost !min-h-8 !px-2.5 text-xs" aria-label={`Remove ${x.title}`}><Trash2 size={13} aria-hidden="true" /> Remove</button>}
                  </li>
                ))}
                {d && d.documents.length === 0 && <li className="py-3 text-sm text-text-muted">Nothing uploaded yet.</li>}
              </ul>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
