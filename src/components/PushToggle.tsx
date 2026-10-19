import { useEffect, useState } from 'react'
import { BellRing, Smartphone } from 'lucide-react'
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push'

/** "Notifications on this phone/computer" — per device, alongside email. */
export function PushToggle({ className = '' }: { className?: string }) {
  const [st, setSt] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  useEffect(() => { pushState().then(setSt).catch(() => setSt('unsupported')) }, [])
  if (!st) return null
  const toggle = async () => { setBusy(true); setMsg(''); try { const next = st === 'on' ? await disablePush() : await enablePush(); setSt(next); if (next === 'on') { await testPush().catch(() => {}); setMsg('On — we sent a test notification.') } else if (next === 'denied') setMsg('Notifications are blocked for this site in your browser settings.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not change it.') } finally { setBusy(false) } }
  const note: Record<PushState, string> = {
    on: 'Quotes, payments and shipment updates pop up on this device.',
    off: 'Get quotes, payments and shipment updates as notifications on this device.',
    denied: 'Blocked in this browser — allow notifications for this site in its settings, then try again.',
    unsupported: 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.',
    'ios-home-screen': 'On iPhone: tap Share → Add to Home Screen, open Ntemtem from there, then turn this on.',
  }
  return (
    <div className={`card-dark flex flex-wrap items-center justify-between gap-3 p-4 ${className}`} data-testid="push-toggle">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep">{st === 'ios-home-screen' ? <Smartphone size={18} aria-hidden="true" /> : <BellRing size={18} aria-hidden="true" />}</span>
        <div className="min-w-0"><p className="font-semibold">Notifications on this device</p><p className="text-sm text-text-muted">{msg || note[st]}</p></div>
      </div>
      {(st === 'on' || st === 'off') && <button role="switch" aria-checked={st === 'on'} aria-label="Notifications on this device" onClick={toggle} disabled={busy} className={`relative h-7 w-12 shrink-0 rounded-full transition ${st === 'on' ? 'bg-teal' : 'bg-border'} disabled:opacity-60`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${st === 'on' ? 'left-6' : 'left-1'}`} /></button>}
    </div>
  )
}
