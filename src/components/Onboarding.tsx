import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChevronDown, Circle, Sparkles, X } from 'lucide-react'
import { onboardingApi, type Onboarding } from '../lib/onboarding'

/**
 * The guided first run for a new shipping company. Shows at the top of the overview until every core step is
 * done (or the owner hides it). Every step links straight to where it gets done; the done state is computed
 * server-side from the real data, so finishing a step elsewhere ticks it here.
 */
export function OnboardingChecklist({ canDismiss }: { canDismiss: boolean }) {
  const [o, setO] = useState<Onboarding | null>(null)
  const [open, setOpen] = useState(true)
  const [hidden, setHidden] = useState(false)
  useEffect(() => { onboardingApi.get().then(setO).catch(() => {}) }, [])
  if (!o || hidden || o.dismissed) return null
  if (o.complete && !o.steps.some((s) => s.optional && !s.done)) return null
  const next = o.steps.find((s) => !s.done && !s.optional) ?? o.steps.find((s) => !s.done)
  const dismiss = async () => { setHidden(true); try { await onboardingApi.dismiss() } catch { /* ignore */ } }
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-dark relative overflow-hidden p-5 md:p-6" aria-labelledby="onb-h" data-testid="onboarding">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gold/10 blur-2xl" aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1 flex items-center gap-2"><Sparkles size={14} aria-hidden="true" /> {o.complete ? 'All set' : 'Getting started'}</p>
          <h2 id="onb-h" className="!text-xl">{o.complete ? `${o.companyName} is ready to win work` : `Set up ${o.companyName} on Ship Sync`}</h2>
          <p className="mt-1 text-sm text-text-muted">{o.complete ? 'The core steps are done. Two optional ones remain below.' : next ? <>Next: <b className="text-text">{next.title}</b> — {o.doneCore} of {o.totalCore} done.</> : null}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen((v) => !v)} className="btn-ghost !min-h-9 !px-3 text-xs" aria-expanded={open}><ChevronDown size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" /> {open ? 'Collapse' : 'Expand'}</button>
          {canDismiss && <button onClick={dismiss} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text focus-ring" aria-label="Hide this checklist"><X size={16} /></button>}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${o.progress}%` }} /></div>
        <span className="text-xs tabular-nums text-text-muted">{o.progress}%</span>
      </div>
      {open && (
        <ol className="mt-4 grid gap-2 md:grid-cols-2" aria-label="Setup steps">
          {o.steps.map((s, i) => (
            <li key={s.id} className={`flex gap-3 rounded-xl border p-3 ${s.done ? 'border-border/60 opacity-75' : s === next ? 'border-gold/60 bg-gold/5' : 'border-border'}`}>
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.done ? 'bg-teal/15 text-teal' : 'bg-surface-2 text-text-muted'}`} aria-hidden="true">{s.done ? <Check size={13} /> : s.optional ? <Circle size={10} /> : i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className={s.done ? 'line-through decoration-text-muted/50' : ''}>{s.title}</span>{s.optional && !s.done && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">optional</span>}</p>
                <p className="mt-0.5 text-xs text-text-muted">{s.detail}</p>
                {!s.done && <Link to={s.to} className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold focus-ring rounded ${s === next ? 'text-gold' : 'text-text hover:text-gold'}`} data-testid={`onb-${s.id}`}>{s.cta} <ArrowRight size={12} aria-hidden="true" /></Link>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  )
}
