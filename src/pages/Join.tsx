import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { useStore } from '../lib/store'
import { opsApi, roleBlurb, roleLabels, type JoinInvite } from '../lib/ops'
import { fadeUp, stagger } from '../lib/motion'

/** Public page a teammate lands on from an invitation link: set a password, join the company, straight into the workspace. */
export default function Join() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const nav = useNavigate()
  const { refresh } = useStore()
  const [invite, setInvite] = useState<JoinInvite | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setState('invalid'); return }
    let live = true
    opsApi.joinInfo(token).then((i) => { if (!live) return; setInvite(i); setName(i.name); setState('ready') }).catch(() => live && setState('invalid'))
    return () => { live = false }
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await opsApi.join(token, { name, password }); await refresh(); nav(invite?.role === 'driver' ? '/dashboard/runs' : '/dashboard/shipper', { replace: true }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not join.') } finally { setBusy(false) }
  }

  return (
    <div className="bg-bg text-text">
      <div className="container-x grid min-h-[70vh] items-center py-12">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto w-full max-w-lg">
          {state === 'loading' && <p className="text-center text-text-muted"><Loader2 size={18} className="inline animate-spin" aria-hidden="true" /> Checking your invitation…</p>}
          {state === 'invalid' && (
            <div className="card-dark p-8 text-center">
              <h1 className="!text-2xl">This invitation isn’t valid</h1>
              <p className="mt-2 text-text-muted">It may have been used already, or a new link was created. Ask the person who invited you for a fresh one.</p>
              <Link to="/login" className="btn-ghost mt-6 !min-h-10 !px-4 text-sm">Sign in instead</Link>
            </div>
          )}
          {state === 'ready' && invite && (
            <>
              <motion.p variants={fadeUp} className="eyebrow mb-2">You’re invited</motion.p>
              <motion.h1 variants={fadeUp} className="!text-[clamp(1.75rem,4vw,2.5rem)]">Join {invite.company} on Ship Sync</motion.h1>
              <motion.p variants={fadeUp} className="mt-2 text-text-muted">You’ll join as <strong className="text-text">{roleLabels[invite.role]}</strong> — {roleBlurb[invite.role].charAt(0).toLowerCase() + roleBlurb[invite.role].slice(1)}</motion.p>
              <motion.form variants={fadeUp} onSubmit={submit} className="card-dark mt-8 space-y-4 p-6 md:p-8" aria-label="Join your team">
                {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
                <div><label htmlFor="j-email" className="label-dark">Email</label><input id="j-email" className="input-dark opacity-70" value={invite.email} readOnly /></div>
                <div><label htmlFor="j-name" className="label-dark">Your name</label><input id="j-name" className="input-dark" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><label htmlFor="j-pass" className="label-dark">Choose a password</label><input id="j-pass" type="password" className="input-dark" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><p className="mt-1 text-xs text-text-muted">At least 8 characters. If you already have a Ship Sync account with this email, enter that password to link it.</p></div>
                <button disabled={busy} className="btn-gold w-full disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Join {invite.company}</button>
                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-text-muted"><ShieldCheck size={12} aria-hidden="true" /> This link works once and stops working after you join.</p>
              </motion.form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}
