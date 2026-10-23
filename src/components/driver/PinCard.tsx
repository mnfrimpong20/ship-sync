import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { api } from '../../lib/store'
import { devicePin, saveDevicePin } from '../../lib/driver'
import { useT } from '../../lib/i18n'

/** A PIN for this phone, so the driver doesn't type a password every morning. */
export function PinCard({ always = false }: { always?: boolean }) {
  const t = useT()
  const [hidden, setHidden] = useState(() => { if (always) return false; try { return !!devicePin() || localStorage.getItem('ss-pin-later') === '1' } catch { return true } }); const [has, setHas] = useState(() => !!devicePin())
  const [open, setOpen] = useState(false); const [pin, setPin] = useState(''); const [again, setAgain] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false)
  if (hidden && !ok) return null
  if (always && has && !ok) return <section className="mt-4 rounded-3xl border border-border bg-surface p-5" data-testid="pin-card"><div className="flex flex-wrap items-center gap-3"><KeyRound size={22} className="shrink-0 text-gold-deep" aria-hidden="true" /><p className="min-w-0 flex-1 text-base">{t('This phone signs in with your PIN.')}</p><button onClick={() => { saveDevicePin(null); setHas(false) }} className="inline-flex min-h-12 items-center rounded-xl border-2 border-border px-4 text-base font-semibold focus-ring" data-testid="pin-remove">{t('Remove PIN')}</button></div></section>
  if (ok) return <p role="status" className="mt-6 rounded-2xl border border-teal/40 bg-teal/10 p-4 text-base" data-testid="pin-ok">{t('PIN saved. Next time, just open Ntemtem on this phone and type it.')}</p>
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (pin !== again) { setErr(t('The two PINs don’t match.')); return }
    setBusy(true); setErr('')
    try { const r = await api<{ device: { id: string; secret: string; name: string; email: string } }>('/auth/pin', { json: { pin } }); saveDevicePin(r.device); setOk(true) } catch (er) { setErr(er instanceof Error ? er.message : t('Could not save.')) } finally { setBusy(false) }
  }
  return (
    <section className={`${always ? 'mt-4' : 'mt-6'} rounded-3xl border border-border bg-surface p-5`} data-testid="pin-card">
      <div className="flex items-start gap-3"><KeyRound size={22} className="mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" /><div className="flex-1"><h2 className="!text-lg">{t('Sign in faster on this phone')}</h2><p className="mt-1 text-base text-text-muted">{t('Set a 4–6 digit PIN instead of typing your password each morning.')}</p></div>{!always && <button onClick={() => { setHidden(true); try { localStorage.setItem('ss-pin-later', '1') } catch { /* ignore */ } }} className="grid h-11 w-11 place-items-center rounded-lg text-text-muted" aria-label={t('Not now')}><X size={18} /></button>}</div>
      {!open ? <button onClick={() => setOpen(true)} className="btn-gold mt-3 !min-h-12 w-full text-base" data-testid="pin-start">{t('Set a PIN')}</button> : (
        <form onSubmit={save} className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-sm">{t('PIN')}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="input-dark mt-1 !min-h-12 text-center text-xl tracking-[0.4em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="pin-1" /></label>
          <label className="text-sm">{t('Again')}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="input-dark mt-1 !min-h-12 text-center text-xl tracking-[0.4em]" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} data-testid="pin-2" /></label>
          {err && <p role="alert" className="col-span-2 text-sm text-danger">{err}</p>}
          <button disabled={busy || pin.length < 4} className="btn-gold col-span-2 !min-h-12 text-base disabled:opacity-50" data-testid="pin-save">{busy ? t('Saving…') : t('Save PIN')}</button>
          <p className="col-span-2 text-sm text-text-muted">{t('Only works on this phone. Five wrong tries removes it.')}</p>
        </form>
      )}
    </section>
  )
}

