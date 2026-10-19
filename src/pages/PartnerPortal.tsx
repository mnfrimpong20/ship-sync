import { BrandLoader } from '../components/BrandLoader'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, KeyRound, MessageSquare, Phone, Ship } from 'lucide-react'
import { countryByCode, statusLabels } from '../lib/data'
import { shipmentOpsApi, type ManifestRow, type PartnerView } from '../lib/shipmentOps'
import { Logo, Pill, fmtDate } from '../components/ui'
import { stageLabels } from '../lib/containers'

/** `/p/:token` — the destination agent's page for one container. No login; the shipper can switch the link off. */
export default function PartnerPortal() {
  const { token = '' } = useParams()
  const [d, setD] = useState<PartnerView | null>(null)
  const [err, setErr] = useState(''); const [toast, setToast] = useState(''); const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<{ id: string; kind: 'handover' | 'note' } | null>(null)
  const [f, setF] = useState({ code: '', name: '', note: '' })
  const load = () => shipmentOpsApi.partnerView(token).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Not found.'))
  useEffect(() => { void load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t) } }, [toast])
  if (err && !d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-danger">{err}</div></div>
  if (!d) return <div className="min-h-dvh bg-bg text-text"><BrandLoader /></div>
  const c = d.container
  const order = ['sailed', 'arrived', 'customs', 'devanned']
  const nextStage = (['arrived', 'customs', 'devanned'] as const).find((st) => order.indexOf(st) > order.indexOf(c.status))
  const stageLabel = { arrived: 'Mark arrived at port', customs: 'Mark in customs', devanned: 'Mark unloaded at warehouse' } as const
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); setErr(''); try { await fn(); setToast(ok); setOpen(null); setF({ code: '', name: '', note: '' }); await load() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.') } finally { setBusy('') } }
  const canHand = (s: ManifestRow) => s.status !== 'delivered' && (s.handover === 'collection' ? s.status === 'ready_for_collection' : ['arrived', 'customs', 'out_for_delivery'].includes(s.status) && c.status === 'devanned')
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="container-x max-w-4xl py-6">
        <div className="flex items-center justify-between gap-3"><Logo /><span className="text-xs text-text-muted">For {d.partner.name}</span></div>
        <header className="mt-6">
          <p className="eyebrow">{d.shipper.name} · destination agent</p>
          <h1 className="!text-[clamp(1.5rem,4vw,2.2rem)]" data-testid="partner-title">{c.ref}{c.number ? ` · ${c.number}` : ''}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted"><Ship size={14} aria-hidden="true" />{c.vesselName || 'Vessel tbc'}{c.voyage ? ` ${c.voyage}` : ''} → {c.destinationPort || countryByCode(c.destination)?.name}{c.eta ? ` · ETA ${fmtDate(c.eta + 'T12:00:00Z')}` : ''}<Pill tone="teal">{stageLabels[c.status as keyof typeof stageLabels] ?? c.status}</Pill></p>
          <p className="mt-1 text-sm text-text-muted">{d.totals.shipments} shipments · {d.totals.pieces || '—'} pieces{d.totals.weightKg ? ` · ${d.totals.weightKg} kg` : ''}</p>
        </header>
        {toast && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm text-teal"><Check size={15} aria-hidden="true" />{toast}</p>}
        {err && <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" data-testid="partner-error">{err}</p>}
        {nextStage && <div className="card-dark mt-5 flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-sm">Container update</p><button disabled={!!busy} onClick={() => act('stage', () => shipmentOpsApi.partnerStage(token, nextStage), `${c.ref}: ${stageLabel[nextStage].replace('Mark ', '')}.`)} className="btn-gold !min-h-10 !px-4 text-sm" data-testid="partner-stage">{stageLabel[nextStage]}</button></div>}
        {c.status === 'devanned' && <p className="mt-3 text-xs text-text-muted">Unloaded: recipients who collect have had their code by text. Ask for it at handover.</p>}
        <ul className="mt-5 space-y-2">
          {d.shipments.map((s) => (
            <li key={s.id} className="card-dark p-4" data-testid="partner-shipment">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-gold-deep">{s.ref}</span><Pill tone={s.status === 'delivered' ? 'green' : s.status === 'ready_for_collection' ? 'gold' : 'teal'}>{statusLabels[s.status]}</Pill><span className="text-xs text-text-muted">{s.handover === 'collection' ? 'Collects' : 'Door delivery'}</span>{s.paymentDue && <Pill tone="danger">Payment due — call {d.shipper.name}</Pill>}</p>
                  <p className="mt-1 text-sm">{s.description} · {s.pieces ?? '—'} pcs{s.weightKg ? ` · ${s.weightKg} kg` : ''}</p>
                  <p className="text-xs text-text-muted">From {s.sender}</p>
                  {s.recipient ? <p className="mt-1 text-sm"><strong>{s.recipient.name}</strong>{s.recipient.city ? ` · ${s.recipient.city}` : ''}{s.recipient.address ? ` · ${s.recipient.address}` : ''}{s.recipient.phone && <a href={`tel:${s.recipient.phone}`} className="ml-2 inline-flex items-center gap-1 text-gold-deep"><Phone size={12} aria-hidden="true" />{s.recipient.phone}</a>}</p> : <p className="mt-1 text-sm text-danger">No recipient on file</p>}
                </div>
                <div className="flex gap-1.5">
                  {canHand(s) && <button onClick={() => setOpen({ id: s.id, kind: 'handover' })} className="btn-gold !min-h-9 !px-3 text-xs" data-testid="partner-handover"><KeyRound size={13} aria-hidden="true" /> Hand over</button>}
                  {s.status !== 'delivered' && <button onClick={() => setOpen({ id: s.id, kind: 'note' })} className="btn-ghost !min-h-9 !px-3 text-xs"><MessageSquare size={13} aria-hidden="true" /> Note</button>}
                </div>
              </div>
              {open?.id === s.id && (
                <form onSubmit={(e) => { e.preventDefault(); void (open.kind === 'handover' ? act(s.id, () => shipmentOpsApi.partnerHandover(token, s.id, { code: s.handover === 'collection' ? f.code : undefined, receivedBy: f.name }), `${s.ref} handed over to ${f.name}.`) : act(s.id, () => shipmentOpsApi.partnerNote(token, s.id, f.note), 'Note sent to the shipper.')) }} className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
                  {open.kind === 'handover' ? <>
                    {s.handover === 'collection' && <input autoFocus required inputMode="numeric" maxLength={6} className="input-dark !min-h-10 font-mono tracking-[0.3em]" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} aria-label="Collection code" data-testid="partner-code" />}
                    <input required minLength={2} className="input-dark !min-h-10 text-sm sm:col-span-1" placeholder="Name on their ID" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Received by" data-testid="partner-received-by" />
                  </> : <input autoFocus required minLength={2} className="input-dark !min-h-10 text-sm sm:col-span-2" placeholder="e.g. One barrel damaged, customs asked for invoice" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />}
                  <div className="flex gap-1.5"><button type="button" onClick={() => setOpen(null)} className="btn-ghost !min-h-10 !px-3 text-xs">Cancel</button><button disabled={!!busy} className="btn-gold !min-h-10 !px-3 text-xs" data-testid="partner-confirm">{open.kind === 'handover' ? 'Confirm handover' : 'Send'}</button></div>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
