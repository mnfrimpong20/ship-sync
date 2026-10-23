import { roleHome } from '../lib/ops'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, Building2, Check, KeyRound, Loader2, MailCheck, MessageSquare, User } from 'lucide-react'
import { devicePin, saveDevicePin } from '../lib/driver'
import type { User as ApiUserLite } from '../lib/store'
import { api, useStore, type Role } from '../lib/store'
import { fadeUp, stagger } from '../lib/motion'
import { useSiteConfig } from '../lib/site'
import { PasswordInput } from '../components/PasswordInput'

function Shell({ title, sub, children, aside }: { title: string; sub: string; children: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="bg-bg text-text">
      <div className="container-x grid min-h-[70vh] items-center gap-10 py-12 lg:grid-cols-12">
        <motion.div initial="hidden" animate="show" variants={stagger} className="lg:col-span-6 lg:col-start-2">
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,2.75rem)]">{title}</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">{sub}</motion.p>
          <motion.div variants={fadeUp} className="card-dark mt-8 p-6 md:p-8">{children}</motion.div>
        </motion.div>
        <motion.aside initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }} className="hidden lg:col-span-4 lg:block">{aside}</motion.aside>
      </div>
    </div>
  )
}

function RoleToggle({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
      {([['customer', 'I’m shipping cargo', User], ['shipper', 'I’m a shipping company', Building2]] as const).map(([v, l, Icon]) => (
        <button type="button" key={v} role="radio" aria-checked={role === v} onClick={() => setRole(v)} className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] border text-sm font-medium transition-colors focus-ring ${role === v ? 'border-gold bg-gold/15 text-gold-deep' : 'border-border bg-surface-2 text-text-muted hover:text-text'}`}><Icon size={16} aria-hidden="true" />{l}</button>
      ))}
    </div>
  )
}

const DemoNote = ({ role }: { role: Role }) => {
  const cfg = useSiteConfig()
  if (cfg?.demoHidden) return null
  return (
  <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">
    Try a demo account — {role === 'shipper' ? <><span className="font-mono text-text">ops@atlanticbridge.demo</span> (Atlantic Bridge Logistics)</> : <span className="font-mono text-text">demo@shipsync.demo</span>}, password <span className="font-mono text-text">shipsync</span>.
  </p>
  )
}

const homeFor = (u: ApiUserLite) => (u.role === 'shipper' ? (u.staffRole ? roleHome[u.staffRole] : '/dashboard/shipper') : '/dashboard')

/** This phone has a PIN: sign in with it (no password). */
function PinLogin({ onPassword }: { onPassword: () => void }) {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { refresh } = useStore()
  const d = devicePin()!
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api<{ user: ApiUserLite }>('/auth/pin/login', { json: { id: d.id, secret: d.secret, pin } }); await refresh(); nav(sp.get('next') || homeFor(r.user)) }
    catch (er) { const m = er instanceof Error ? er.message : 'Sign in failed.'; setErr(m); setPin(''); if (/removed/i.test(m)) saveDevicePin(null) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={go} className="grid gap-4" data-testid="pin-login">
      <p className="flex items-center gap-2 text-lg"><KeyRound size={20} className="text-gold-deep" aria-hidden="true" /> Hi {d.name} — enter your PIN</p>
      <label htmlFor="pin" className="sr-only">PIN</label>
      <input id="pin" type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="input-dark !min-h-16 text-center text-3xl tracking-[0.5em]" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="pin-input" />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button className="btn-gold !min-h-14 w-full text-base" disabled={busy || pin.length < 4}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Signing in</> : 'Sign in'}</button>
      <button type="button" onClick={onPassword} className="min-h-11 text-sm text-text-muted underline">Use email and password instead</button>
      <button type="button" onClick={() => { saveDevicePin(null); onPassword() }} className="min-h-11 text-sm text-text-muted underline">Not {d.name}? Remove the PIN from this phone</button>
    </form>
  )
}

/** Sign-in link by text or email — for team members who don't want to type a password. */
function LinkLogin({ onBack }: { onBack: () => void }) {
  const [who, setWho] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await api('/auth/link', { json: { who } }); setSent(true) } catch (er) { setErr(er instanceof Error ? er.message : 'Could not send.') } finally { setBusy(false) } }
  if (sent) return <div className="grid gap-3 text-center" data-testid="link-sent"><MailCheck size={36} className="mx-auto text-teal" aria-hidden="true" /><p className="text-lg font-semibold">Check your {who.includes('@') ? 'email' : 'texts'}</p><p className="text-sm text-text-muted">If {who} belongs to an account, a sign-in link is on its way. It works once, for 15 minutes.</p><button onClick={onBack} className="btn-ghost !min-h-12">Back to sign in</button></div>
  return (
    <form onSubmit={go} className="grid gap-4" data-testid="link-login">
      <p className="text-base">We’ll send you a link — tap it and you’re in.</p>
      <div><label htmlFor="who" className="label-dark">Your phone number or email</label><input id="who" className="input-dark !min-h-12" autoComplete="tel email" value={who} onChange={(e) => setWho(e.target.value)} placeholder="+1 713 555 0142 or you@company.com" /></div>
      <p className="text-xs text-text-muted">Texts work for team members whose phone number is saved by their company.</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button className="btn-gold !min-h-12 w-full" disabled={busy || who.trim().length < 5}>{busy ? 'Sending…' : 'Send me a link'}</button>
      <button type="button" onClick={onBack} className="min-h-11 text-sm text-text-muted underline">Use my password instead</button>
    </form>
  )
}

/** Where the sign-in link lands. */
export function SignInLink() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { refresh } = useStore()
  const [err, setErr] = useState('')
  const token = sp.get('token') ?? ''
  useEffect(() => { document.title = 'Signing in · Ntemtem' }, [])
  useEffect(() => { if (!token) { setErr('This link is missing its code.'); return } api<{ user: ApiUserLite }>('/auth/link/use', { json: { token } }).then(async (r) => { await refresh(); nav(homeFor(r.user), { replace: true }) }).catch((e) => setErr(/too many/i.test(String(e?.message)) ? String(e.message) : 'This sign-in link has expired or was already used. Ask for a new one, or sign in with your password.')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <Shell title={err ? "That link didn’t work" : "Signing you in"} sub={err ? "Sign-in links work once, for a short time." : "One moment…"} aside={<Aside />}>{err ? <div className="grid gap-3"><p role="alert" className="text-danger">{err}</p><Link to="/login" className="btn-gold !min-h-12">Go to sign in</Link></div> : <p className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Checking your link…</p>}</Shell>
}

export function Login() {
  const [sp] = useSearchParams()
  if (sp.get('next')?.startsWith('/admin')) return <AdminLogin next={sp.get('next')!} />
  return <MemberLogin />
}

/** Staff sign-in for the Ntemtem admin area — no customer/company choice, no sign-up, no demo hints. */
function AdminLogin({ next }: { next: string }) {
  const nav = useNavigate(); const { login, logout } = useStore()
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    if (pw.length < 1) return setErr('Enter your password.')
    setErr(''); setBusy(true)
    try {
      const u = await login(email, pw)
      if (!u.admin) { await logout().catch(() => {}); setBusy(false); return setErr('That account isn’t an Ntemtem admin. Customers and shipping companies sign in on the regular sign-in page.') }
      nav(next)
    } catch (x) { setErr(x instanceof Error ? x.message : 'Sign in failed.'); setBusy(false) }
  }
  return (
    <Shell title="Ntemtem admin" sub="Staff sign-in. Only Ntemtem admin accounts can open the admin area." aside={<div className="card-dark p-6 text-sm text-text-muted" data-testid="admin-login-aside"><p className="eyebrow mb-2">Admin area</p><p>Approvals, payments, disputes, support and the business numbers. Every action is written to the audit log.</p><p className="mt-3">Not Ntemtem staff? <Link to="/login" className="font-semibold text-gold-deep underline">Go to the regular sign-in</Link>.</p></div>}>
      <form onSubmit={submit} className="grid gap-4" noValidate data-testid="admin-login">
        <div><label htmlFor="email" className="label-dark">Admin email</label><input id="email" type="email" className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></div>
        <div><div className="flex items-baseline justify-between"><label htmlFor="pw" className="label-dark">Password</label><Link to="/forgot" className="text-xs text-gold-deep hover:underline">Forgot password?</Link></div><PasswordInput id="pw" className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Signing in</> : 'Sign in to admin'}</motion.button>
      </form>
    </Shell>
  )
}

function MemberLogin() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { login } = useStore()
  const [mode, setMode] = useState<'password' | 'pin' | 'link'>(() => (devicePin() ? 'pin' : 'password'))
  const [role, setRole] = useState<Role>((sp.get('role') as Role) || 'customer')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    if (pw.length < 1) return setErr('Enter your password.')
    setErr(''); setBusy(true)
    try {
      const u = await login(email, pw)
      nav(sp.get('next') || (u.role === 'shipper' ? (u.staffRole ? roleHome[u.staffRole] : '/dashboard/shipper') : '/dashboard'))
    } catch (err) { setErr(err instanceof Error ? err.message : 'Sign in failed.'); setBusy(false) }
  }
  return (
    <Shell title="Welcome back" sub="Sign in to see your quotes, bookings and tracking." aside={<Aside />}>
      {mode === 'pin' ? <PinLogin onPassword={() => setMode('password')} /> : mode === 'link' ? <LinkLogin onBack={() => setMode('password')} /> :
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <RoleToggle role={role} setRole={setRole} />
        <div><label htmlFor="email" className="label-dark">Email</label><input id="email" type="email" className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={role === 'shipper' ? 'ops@yourcompany.com' : 'you@example.com'} /></div>
        <div><div className="flex items-baseline justify-between"><label htmlFor="pw" className="label-dark">Password</label><Link to="/forgot" className="text-xs text-gold-deep hover:underline">Forgot password?</Link></div><PasswordInput id="pw" className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Signing in</> : 'Sign in'}</motion.button>
        <p className="text-center text-sm text-text-muted">New here? <Link to={`/signup?role=${role}${sp.get('next') ? `&next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="text-gold-deep hover:underline">Create an account</Link></p>
        {role === 'shipper' && <button type="button" onClick={() => setMode('link')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold hover:border-gold focus-ring" data-testid="use-link"><MessageSquare size={16} aria-hidden="true" /> Text me a sign-in link instead</button>}
        {role === 'shipper' && devicePin() && <button type="button" onClick={() => setMode('pin')} className="min-h-11 text-sm text-text-muted underline">Use my PIN</button>}
        <DemoNote role={role} />
      </form>}
      <Link to="/broker-portal/login" className="mt-6 flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm hover:border-gold focus-ring" data-testid="broker-signin-link"><span><b>Customs broker?</b> <span className="text-text-muted">Sign in to your broker dashboard</span></span><ArrowRight size={16} className="shrink-0 text-gold-deep" aria-hidden="true" /></Link>
    </Shell>
  )
}

export function Signup() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { signup } = useStore()
  const [role, setRole] = useState<Role>((sp.get('role') as Role) || 'customer')
  const [f, setF] = useState({ name: '', email: '', company: '', pw: '', agree: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (f.name.trim().length < 2) return setErr('Enter your name.')
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Enter a valid email address.')
    if (role === 'shipper' && f.company.trim().length < 2) return setErr('Enter your company name.')
    if (f.pw.length < 8) return setErr('Password must be at least 8 characters.')
    if (!f.agree) return setErr('Please accept the terms to continue.')
    setErr(''); setBusy(true)
    try {
      await signup({ name: f.name, email: f.email, password: f.pw, role, company: role === 'shipper' ? f.company : undefined, ref: role === 'customer' ? (sp.get('ref') ?? undefined) : undefined })
      nav(sp.get('next') || (role === 'shipper' ? '/dashboard/shipper' : '/dashboard'))
    } catch (err) { setErr(err instanceof Error ? err.message : 'Sign up failed.'); setBusy(false) }
  }
  return (
    <Shell title={role === 'shipper' ? 'List your shipping company' : 'Create your account'} sub={role === 'shipper' ? 'Start receiving matched shipment requests. Free Starter plan, upgrade any time.' : 'Save quotes, book shippers and track every shipment in one place.'} aside={<Aside shipper={role === 'shipper'} />}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <RoleToggle role={role} setRole={setRole} />
        <div><label htmlFor="name" className="label-dark">Full name</label><input id="name" className="input-dark" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></div>
        {role === 'shipper' && <div><label htmlFor="company" className="label-dark">Company name</label><input id="company" className="input-dark" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} autoComplete="organization" /></div>}
        <div><label htmlFor="semail" className="label-dark">Email</label><input id="semail" type="email" className="input-dark" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></div>
        <div><label htmlFor="spw" className="label-dark">Password</label><PasswordInput id="spw" className="input-dark" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} autoComplete="new-password" /><p className="mt-1 text-xs text-text-muted">At least 8 characters.</p></div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text-muted"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-gold" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> I agree to the Terms of Service{role === 'shipper' ? ' and Shipper Agreement' : ''} and Privacy Policy.</label>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Creating account</> : role === 'shipper' ? 'Create shipper account' : 'Create account'}</motion.button>
        <p className="text-center text-sm text-text-muted">Already have an account? <Link to={`/login?role=${role}`} className="text-gold-deep hover:underline">Sign in</Link></p>
      </form>
    </Shell>
  )
}

function Aside({ shipper = false }: { shipper?: boolean }) {
  const live = !!useSiteConfig()?.paymentsLive // only promise escrow once online payment is switched on
  const items = shipper
    ? ['Matched leads for your lanes, not spam', 'Verification badge after document review', 'No commission — flat monthly plans', 'Branded tracking page for your customers']
    : ['Quotes from verified shippers within 24h', 'Compare price, transit and inclusions side by side', 'One reference to track pickup → delivery', 'Free forever for customers']
  return (
    <div className="card-dark p-7">
      <p className="eyebrow">{shipper ? 'Why list on Ntemtem' : 'What you get'}</p>
      <ul className="mt-4 space-y-3">{items.map((i) => <li key={i} className="flex gap-3 text-text"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-deep"><Check size={14} aria-hidden="true" /></span>{i}</li>)}</ul>
      <p className="mt-6 border-t border-border pt-5 text-sm text-text-muted">{shipper ? (live ? 'Free to list on Starter. Customers pay through Ntemtem, the money is held until the goods move, and your clients stay yours.' : 'Free to list on Starter, and your clients stay yours.') : (live ? 'Free for senders. Compare itemised quotes, then pay only through Ntemtem — the money is held until your goods are on their way.' : 'Free for senders. Compare itemised quotes and book the one that suits you.')}</p>
    </div>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    setErr(''); setBusy(true)
    try { await api('/auth/forgot', { json: { email } }); setSent(true) } catch (err) { setErr(err instanceof Error ? err.message : 'Could not send the email.') } finally { setBusy(false) }
  }
  return (
    <Shell title="Reset your password" sub="Enter the email you signed up with and we’ll send a link that works for one hour." aside={<Aside />}>
      {sent ? (
        <div className="grid gap-3 text-center" data-testid="forgot-sent">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-gold-deep"><MailCheck size={22} aria-hidden="true" /></span>
          <p className="font-semibold">Check your inbox</p>
          <p className="text-sm text-text-muted">If an account exists for <span className="font-mono text-text">{email}</span>, a reset link is on its way. It expires in an hour — check spam if it hasn’t arrived in a few minutes.</p>
          <p className="text-sm text-text-muted"><Link to="/login" className="text-gold-deep hover:underline">Back to sign in</Link></p>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div><label htmlFor="femail" className="label-dark">Email</label><input id="femail" type="email" className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Sending</> : 'Email me a reset link'}</motion.button>
          <p className="text-center text-sm text-text-muted">Remembered it? <Link to="/login" className="text-gold-deep hover:underline">Sign in</Link></p>
        </form>
      )}
    </Shell>
  )
}

export function ResetPassword() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { resetPassword } = useStore()
  const token = sp.get('token') || ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setErr('Password must be at least 8 characters.')
    if (pw !== pw2) return setErr('The two passwords don’t match.')
    setErr(''); setBusy(true)
    try { const u = await resetPassword(token, pw); nav(u.role === 'shipper' ? '/dashboard/shipper' : '/dashboard') } catch (err) { setErr(err instanceof Error ? err.message : 'Could not reset the password.'); setBusy(false) }
  }
  return (
    <Shell title={sp.get('welcome') ? 'Set your password' : 'Choose a new password'} sub={sp.get('welcome') ? 'So you can sign back in to compare and book your quotes from any device.' : 'You’ll be signed in here and signed out everywhere else.'} aside={<Aside />}>
      {!token ? (
        <p className="text-sm text-text-muted">This link is missing its token. <Link to="/forgot" className="text-gold-deep hover:underline">Request a new reset link</Link>.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div><label htmlFor="rpw" className="label-dark">New password</label><PasswordInput id="rpw" className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><p className="mt-1 text-xs text-text-muted">At least 8 characters.</p></div>
          <div><label htmlFor="rpw2" className="label-dark">Repeat password</label><PasswordInput id="rpw2" className="input-dark" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
          {err && <p role="alert" className="text-sm text-danger">{err} {/expired|used/i.test(err) && <Link to="/forgot" className="text-gold-deep hover:underline">Request a new link</Link>}</p>}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Saving</> : 'Save new password'}</motion.button>
        </form>
      )}
    </Shell>
  )
}
