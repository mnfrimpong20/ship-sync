import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Camera, Check, X } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { shrinkPhoto } from '../../lib/scan'

/** Full-screen sheet for one task (proof, skip, tools). Escape or Back closes it. Portalled: page wrappers are transformed. */
export function Sheet({ title, onClose, children, testid, footer }: { title: string; onClose: () => void; children: ReactNode; testid?: string; footer?: ReactNode }) {
  const back = useRef<HTMLButtonElement>(null); const t = useT()
  const close = useRef(onClose); close.current = onClose
  useEffect(() => { const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; setTimeout(() => back.current?.focus(), 30); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }; window.addEventListener('keydown', k); return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', k) } }, [])
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="ss-app fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-bg text-text" data-testid={testid}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur-xl">
        <button ref={back} onClick={onClose} className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-2 text-base font-semibold focus-ring"><ArrowLeft size={20} aria-hidden="true" /> {t('Back')}</button>
        <h2 id="sheet-title" className="ml-1 truncate !text-lg">{title}</h2>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 px-4 pb-32 pt-4">{children}</div>
      {footer && <div className="fixed inset-x-0 bottom-0 border-t border-border bg-bg/95 p-3 backdrop-blur-xl"><div className="mx-auto max-w-xl">{footer}</div></div>}
    </div>, document.body)
}

/** Big, full-width action button for gloves and sunlight. */
export const Big = ({ children, onClick, tone = 'ghost', disabled, testid, type = 'button', form }: { children: ReactNode; onClick?: () => void; tone?: 'gold' | 'ghost' | 'danger'; disabled?: boolean; testid?: string; type?: 'button' | 'submit'; form?: string }) => (
  <button type={type} form={form} onClick={onClick} disabled={disabled} data-testid={testid} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold focus-ring disabled:opacity-50 ${tone === 'gold' ? 'bg-gold text-on-accent hover:brightness-105' : tone === 'danger' ? 'border-2 border-danger text-danger' : 'border-2 border-border bg-surface hover:border-gold'}`}>{children}</button>
)

/** One choice in a big radio list. */
export const Choice = ({ on, onClick, children, testid }: { on: boolean; onClick: () => void; children: ReactNode; testid?: string }) => (
  <button type="button" role="radio" aria-checked={on} onClick={onClick} data-testid={testid} className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 text-left text-base font-semibold focus-ring ${on ? 'border-gold bg-gold/15' : 'border-border bg-surface'}`}>
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-gold bg-gold text-on-accent' : 'border-border'}`} aria-hidden="true">{on && <Check size={14} />}</span><span className="min-w-0">{children}</span>
  </button>
)

/** Take (or retake) one photo with the back camera, shrunk for upload. */
export function PhotoField({ value, onChange, label, testid, compact }: { value: string; onChange: (v: string) => void; label: string; testid?: string; compact?: boolean }) {
  const t = useT()
  if (value) return <div className="relative"><img src={value} alt={label} className={`w-full rounded-2xl object-cover ${compact ? 'h-28' : 'max-h-64'}`} /><button type="button" onClick={() => onChange('')} className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white" aria-label={t('Remove photo')}><X size={18} /></button>{compact && <span className="absolute bottom-1 left-2 rounded bg-black/60 px-1.5 text-xs text-white">{label}</span>}</div>
  return <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface text-base font-semibold focus-within:ring-2 focus-within:ring-gold ${compact ? 'h-28 flex-col text-sm' : 'min-h-14'}`}><Camera size={20} aria-hidden="true" /> {label}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await shrinkPhoto(f)) }} data-testid={testid} /></label>
}

export const Msg = ({ err, ok }: { err?: string; ok?: string }) => <>{err && <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-base text-danger">{err}</p>}{ok && <p role="status" className="mt-3 rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-base">{ok}</p>}</>
export const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)
