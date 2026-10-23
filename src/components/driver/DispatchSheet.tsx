import { useEffect, useState } from 'react'
import { MessageCircle, MessageSquare, Phone } from 'lucide-react'
import { telLink, useDispatch, useMyRuns, waLink } from '../../lib/driver'
import { useT } from '../../lib/i18n'
import { Big, Sheet } from './DriverUi'
import { MessagesSheet } from './DriverTools'

/** One way to reach dispatch from anywhere in the driver app: call, WhatsApp, or a message on the run. */
const EVT = 'ntm:dispatch'
let ctxStop: string | undefined
/** The run page says which stop is open, so "Dispatch" from the bottom bar is about that stop. */
export const setDispatchContext = (stopId?: string) => { ctxStop = stopId }
export const openDispatch = (stopId?: string) => window.dispatchEvent(new CustomEvent(EVT, { detail: { stopId: stopId ?? ctxStop } }))

export function DispatchHost() {
  const [open, setOpen] = useState<null | { stopId?: string }>(null)
  useEffect(() => { const on = (e: Event) => setOpen({ stopId: (e as CustomEvent<{ stopId?: string }>).detail?.stopId }); window.addEventListener(EVT, on); return () => window.removeEventListener(EVT, on) }, [])
  return open ? <DispatchSheet stopId={open.stopId} onClose={() => setOpen(null)} /> : null
}

function DispatchSheet({ stopId, onClose }: { stopId?: string; onClose: () => void }) {
  const t = useT(); const { dispatch } = useDispatch(); const { runs } = useMyRuns(); const [chat, setChat] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const run = (stopId ? (runs ?? []).find((r) => r.stops.some((s) => s.id === stopId)) : undefined) ?? (runs ?? []).find((r) => r.status === 'in_progress') ?? (runs ?? []).find((r) => r.status === 'planned' && r.date <= today)
  const stop = run && (stopId ? run.stops.find((s) => s.id === stopId) : undefined)
  if (chat && run) return <MessagesSheet run={run} stopId={stop?.id} onClose={() => setChat(false)} />
  const people = (dispatch?.people ?? []).filter((p) => p.phone)
  const office = !people.length && dispatch?.office.phone ? dispatch.office : null
  const btn = 'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-2 border-border px-4 text-base font-semibold focus-ring'
  return (
    <Sheet title={t('Dispatch')} onClose={onClose} testid="dispatch-sheet">
      {run && <>
        <Big tone="gold" onClick={() => setChat(true)} testid="dispatch-chat"><MessageSquare size={20} aria-hidden="true" /> {stop ? t('Message about {name}', { name: stop.contact || stop.label }) : t('Message dispatch')}</Big>
        <p className="mt-2 text-sm text-text-muted">{t('Goes on “{run}” so the office sees which run{stop} it’s about.', { run: run.name, stop: stop ? t(' and stop') : '' })}</p>
      </>}
      <h3 className={`${run ? 'mt-6' : ''} !text-lg`}>{t('Call or WhatsApp')}</h3>
      {people.length ? <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">{people.slice(0, 4).map((p) => (
        <li key={p.name} className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid="dispatch-person">
          <span className="min-w-0 flex-1 text-base"><b>{p.name}</b> <span className="text-text-muted">· {t(p.role === 'dispatcher' ? 'Dispatcher' : 'Owner')}</span></span>
          <a href={telLink(p.phone!)} className={btn}><Phone size={18} aria-hidden="true" /> {t('Call')}</a>
          <a href={waLink(p.phone!)} target="_blank" rel="noreferrer" className={btn} aria-label={`WhatsApp ${p.name}`}><MessageCircle size={18} aria-hidden="true" /></a>
        </li>))}</ul>
        : office ? <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3"><span className="min-w-0 flex-1 text-base"><b>{office.name}</b> <span className="text-text-muted">· {t('Office')}</span></span><a href={telLink(office.phone)} className={btn}><Phone size={18} aria-hidden="true" /> {t('Call')}</a><a href={waLink(office.phone)} target="_blank" rel="noreferrer" className={btn} aria-label={`WhatsApp ${office.name}`}><MessageCircle size={18} aria-hidden="true" /></a></div>
        : <p className="mt-2 rounded-2xl border border-dashed border-border px-4 py-3 text-base text-text-muted" data-testid="dispatch-nophone">{run ? t('No dispatch phone number yet — send a message instead, and ask the office to add one.') : t('No dispatch phone number yet. Ask the office to add one under Team.')}</p>}
    </Sheet>
  )
}
