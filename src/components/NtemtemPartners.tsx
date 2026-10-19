import { useEffect, useState } from 'react'
import { BadgeCheck, Star } from 'lucide-react'
import { partnersApi, serviceLabels, type Assignment, type DestPartner, type PartnerService } from '../lib/partners'

/** Inside the destination-agent card: pick a vetted Ntemtem partner when you have nobody at the destination. */
export function NtemtemPartners({ containerId, destination, onAssigned }: { containerId: string; destination: string; onAssigned: () => void }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<DestPartner[] | null>(null)
  const [jobs, setJobs] = useState<Assignment[]>([])
  const [pick, setPick] = useState<{ p: DestPartner; services: PartnerService[]; note: string } | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [rate, setRate] = useState<Record<string, number>>({})
  const loadJobs = () => partnersApi.forContainer(containerId).then(setJobs).catch(() => {})
  useEffect(() => { void loadJobs() }, [containerId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !list) partnersApi.directory(destination).then(setList).catch(() => setList([])) }, [open, list, destination])
  const assign = async () => { if (!pick) return; setBusy(true); setErr(''); try { await partnersApi.assign(containerId, { partnerId: pick.p.id, services: pick.services, note: pick.note }); setPick(null); setOpen(false); await loadJobs(); onAssigned() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not assign.') } finally { setBusy(false) } }
  const sendRating = async (a: Assignment) => { const stars = rate[a.id]; if (!stars) return; await partnersApi.rate(a.id, stars, ''); await loadJobs() }
  const statusTone = (s: Assignment['status']) => (s === 'accepted' || s === 'done' ? 'bg-teal/15 text-teal' : s === 'declined' ? 'bg-danger/15 text-danger' : 'bg-gold/20 text-gold-deep')
  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="ntemtem-partners">
      {jobs.length > 0 && <ul className="mb-3 space-y-2 text-sm">{jobs.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2"><span><b>{a.partnerName}</b> <span className="text-xs text-text-muted">· {a.services.map((s) => serviceLabels[s]).join(', ')}</span></span><span className="flex items-center gap-2">{a.status === 'accepted' && a.stars == null && <span className="inline-flex items-center gap-0.5" aria-label="Rate this partner">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRate({ ...rate, [a.id]: n })} aria-label={`${n} stars`}><Star size={14} className={(rate[a.id] ?? 0) >= n ? 'fill-gold text-gold' : 'text-border'} /></button>)}{rate[a.id] && <button onClick={() => sendRating(a)} className="ml-1 text-xs text-gold-deep hover:underline">Rate</button>}</span>}{a.stars != null && <span className="text-xs text-text-muted">{'★'.repeat(a.stars)}</span>}<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(a.status)}`}>{a.status === 'requested' ? 'Waiting for partner' : a.status}</span></span></li>)}</ul>}
      {!open ? <button onClick={() => setOpen(true)} className="text-sm text-gold-deep hover:underline" data-testid="ntemtem-partner-open">No one at the destination? Use an Ntemtem partner →</button> : (
        <div>
          <p className="text-sm font-semibold">Ntemtem partners in {destination}</p>
          <p className="text-xs text-text-muted">Vetted by Ntemtem. They get the manifest link and the pre-alert; Ntemtem’s partner desk confirms the job with them. Agree prices directly.</p>
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          {list?.length === 0 && <p className="mt-3 text-sm text-text-muted">No partners there yet — tell us where you need one and we’ll find one.</p>}
          <ul className="mt-3 grid gap-2">{list?.map((p) => (
            <li key={p.id} className={`rounded-lg border p-3 ${pick?.p.id === p.id ? 'border-gold bg-gold/5' : 'border-border'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="flex items-center gap-1.5 font-semibold">{p.name}{p.verified && <BadgeCheck size={14} className="text-teal" aria-label="Verified by Ntemtem" />}</p><p className="text-xs text-text-muted">{p.cities.join(', ')} · {p.services.map((s) => serviceLabels[s]).join(', ')}{p.rating ? ` · ★ ${p.rating} (${p.ratingCount})` : ''}{p.jobs ? ` · ${p.jobs} job${p.jobs === 1 ? '' : 's'}` : ''}</p><p className="mt-1 text-xs">{p.about}</p></div>
                {jobs.some((j) => j.partnerId === p.id && (j.status === 'requested' || j.status === 'accepted')) ? <span className="text-xs text-text-muted">On this container</span> : pick?.p.id !== p.id && <button onClick={() => setPick({ p, services: p.services.filter((s) => s !== 'vehicles'), note: '' })} className="btn-ghost !min-h-8 !px-3 text-xs" data-testid="partner-pick">Choose</button>}
              </div>
              {pick?.p.id === p.id && (
                <div className="mt-3 grid gap-2">
                  <div className="flex flex-wrap gap-1.5">{p.services.map((s) => <label key={s} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${pick.services.includes(s) ? 'border-gold bg-gold/15' : 'border-border text-text-muted'}`}><input type="checkbox" className="sr-only" checked={pick.services.includes(s)} onChange={(e) => setPick({ ...pick, services: e.target.checked ? [...pick.services, s] : pick.services.filter((x) => x !== s) })} />{serviceLabels[s]}</label>)}</div>
                  <input className="input-dark !min-h-9 text-sm" placeholder="Anything they should know (optional)" value={pick.note} onChange={(e) => setPick({ ...pick, note: e.target.value })} />
                  <div className="flex gap-2"><button onClick={() => setPick(null)} className="btn-ghost !min-h-8 !px-3 text-xs">Cancel</button><button onClick={assign} disabled={busy || !pick.services.length} className="btn-gold !min-h-8 !px-3 text-xs disabled:opacity-60" data-testid="partner-assign">Ask {p.name.split(' (')[0]} to handle it</button></div>
                </div>
              )}
            </li>))}</ul>
          <button onClick={() => { setOpen(false); setPick(null) }} className="mt-2 text-xs text-text-muted hover:text-text">Close</button>
        </div>
      )}
    </div>
  )
}
