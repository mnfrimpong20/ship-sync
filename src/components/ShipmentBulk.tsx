import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { BellRing, Container as ContainerIcon, MoveRight, Tag, X } from 'lucide-react'
import { api, useStore } from '../lib/store'
import { flowFor, flowIndex, statusLabels, type Shipment, type ShipmentStatus } from '../lib/data'
import { containersApi, isOpen, type Container } from '../lib/containers'
import { useT } from '../lib/i18n'

// Statuses an office moves shipments to in bulk. Delivered / ready-for-collection need the receiver, so they stay one at a time.
const TARGETS: ShipmentStatus[] = ['picked_up', 'at_origin_port', 'in_transit', 'arrived', 'customs', 'out_for_delivery']

/**
 * The bar that appears when shipments are ticked: move them all forward, print their labels,
 * remind the clients who owe, or load them into a container — one action instead of twelve.
 */
export function BulkBar({ ids, shipments, containers, onClear, onDone }: { ids: string[]; shipments: Shipment[]; containers: Container[]; onClear: () => void; onDone: (msg: string) => void }) {
  const { refresh } = useStore(); const t = useT(); const tr = t
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [panel, setPanel] = useState<'' | 'move' | 'container'>('')
  const chosen = shipments.filter((s) => ids.includes(s.id))
  const open = containers.filter((c) => isOpen(c.status))
  if (!ids.length) return null

  const move = async (target: ShipmentStatus) => {
    setBusy('move'); setErr('')
    let moved = 0; const skipped: string[] = []
    for (const s of chosen) {
      if (s.status === 'delivered') { skipped.push(`${s.ref} (delivered)`); continue }
      if (s.autoBy) { skipped.push(`${s.ref} (follows ${s.autoBy})`); continue }
      const flow = flowFor(s.handover)
      const goal = flow.indexOf(target)
      if (goal < 0) { skipped.push(`${s.ref} (${statusLabels[target]} isn’t a step for this shipment)`); continue }
      let cur: ShipmentStatus = s.status; let steps = 0
      try {
        while (flowIndex(cur, s.handover) < goal && steps < 8) { const r = await api<{ shipment: Shipment }>(`/shipments/${s.id}/advance`, { json: {} }); cur = r.shipment.status; steps++ }
        if (steps) moved++; else skipped.push(`${s.ref} (already past ${statusLabels[target]})`)
      } catch (e) { skipped.push(`${s.ref} (${e instanceof Error ? e.message.replace(/\.$/, '') : 'failed'})`); if (steps) moved++ }
    }
    await refresh(); setBusy(''); setPanel('')
    onDone(`${moved} shipment${moved === 1 ? '' : 's'} moved to “${statusLabels[target]}”.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`)
    if (moved) onClear()
  }
  const remind = async () => {
    setBusy('remind'); setErr('')
    try {
      const r = await api<{ sent: number; skipped: string[]; invoices: number }>('/collections/remind-shipments', { json: { shipmentIds: ids } })
      onDone(r.invoices === 0 ? 'None of these shipments has an unpaid invoice.' : `${r.sent} payment reminder${r.sent === 1 ? '' : 's'} sent.${r.skipped.length ? ` Not sent: ${r.skipped.join('; ')}.` : ''}`)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send reminders.') } finally { setBusy('') }
  }
  const load = async (c: Container) => {
    setBusy('container'); setErr('')
    try { await containersApi.load(c.id, ids); await refresh(); onDone(`${ids.length} shipment${ids.length === 1 ? '' : 's'} loaded into ${c.ref}.`); setPanel(''); onClear() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load into the container.') } finally { setBusy('') }
  }
  const btn = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-white/10 focus-ring disabled:opacity-60'
  return createPortal(
    <AnimatePresence>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} role="region" aria-label="Actions for selected shipments" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-4xl rounded-2xl bg-ink text-white shadow-2xl ring-1 ring-white/15 lg:bottom-5" data-testid="bulk-bar">
        {panel === 'move' && <div className="border-b border-white/15 p-3"><p className="mb-2 text-xs text-white/80">Move each selected shipment forward to:</p><div className="flex flex-wrap gap-2">{TARGETS.map((t) => <button key={t} onClick={() => move(t)} disabled={!!busy} className="min-h-11 rounded-lg border border-white/25 px-3 text-sm hover:bg-white/10 focus-ring" data-testid={`bulk-to-${t}`}>{tr(statusLabels[t])}</button>)}</div><p className="mt-2 text-xs text-white/70">Customers get the usual update for each step. Delivered and collection hand-overs stay one at a time.</p></div>}
        {panel === 'container' && <div className="border-b border-white/15 p-3"><p className="mb-2 text-xs text-white/80">Load into an open container:</p>{open.length ? <div className="flex flex-wrap gap-2">{open.map((c) => <button key={c.id} onClick={() => load(c)} disabled={!!busy} className="min-h-11 rounded-lg border border-white/25 px-3 text-left text-sm hover:bg-white/10 focus-ring"><span className="font-semibold">{c.ref}</span> <span className="text-white/75">· {c.destinationPort || c.destination} · {c.loaded ?? 0} loaded</span></button>)}</div> : <p className="text-sm">No open containers. <Link to="/dashboard/containers" className="underline">Open one</Link> first.</p>}</div>}
        {err && <p role="alert" className="border-b border-white/15 px-4 py-2 text-sm text-[#ffb4ab]">{err}</p>}
        <div className="flex flex-wrap items-center gap-1 p-2">
          <span className="px-2 text-sm font-semibold" aria-live="polite" data-testid="bulk-count">{t('{n} selected', { n: ids.length })}</span>
          <button onClick={() => setPanel(panel === 'move' ? '' : 'move')} aria-expanded={panel === 'move'} className={btn} disabled={!!busy} data-testid="bulk-move"><MoveRight size={16} aria-hidden="true" />{busy === 'move' ? 'Moving…' : t('Move to…')}</button>
          <Link to={`/dashboard/labels?shipments=${ids.join(',')}`} className={btn}><Tag size={16} aria-hidden="true" /> {t('Labels')}</Link>
          <button onClick={remind} disabled={!!busy} className={btn} data-testid="bulk-remind"><BellRing size={16} aria-hidden="true" />{busy === 'remind' ? 'Sending…' : t('Payment reminders')}</button>
          <button onClick={() => setPanel(panel === 'container' ? '' : 'container')} aria-expanded={panel === 'container'} disabled={!!busy} className={btn} data-testid="bulk-container"><ContainerIcon size={16} aria-hidden="true" /> {t('Container')}</button>
          <button onClick={onClear} className="ml-auto grid h-11 w-11 place-items-center rounded-lg hover:bg-white/10 focus-ring" aria-label={t('Clear selection')}><X size={18} /></button>
        </div>
      </motion.div>
    </AnimatePresence>, document.body)
}
