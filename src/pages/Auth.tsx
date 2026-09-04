import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Building2, Check, Loader2, User } from 'lucide-react'
import { useStore, type Role } from '../lib/store'
import { fadeUp, stagger } from '../lib/motion'

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
        <button type="button" key={v} role="radio" aria-checked={role === v} onClick={() => setRole(v)} className={`flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] border text-sm font-medium transition-colors focus-ring ${role === v ? 'border-gold bg-gold/15 text-gold' : 'border-border bg-surface-2 text-text-muted hover:text-text'}`}><Icon size={16} aria-hidden="true" />{l}</button>
      ))}
    </div>
  )
}

const DemoNote = ({ role }: { role: Role }) => (
  <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">
    Try a demo account — {role === 'shipper' ? <><span className="font-mono text-text">ops@atlanticbridge.demo</span> (Atlantic Bridge Logistics)</> : <span className="font-mono text-text">demo@shipsync.demo</span>}, password <span className="font-mono text-text">shipsync</span>.
  </p>
)

export function Login() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { login } = useStore()
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
      nav(sp.get('next') || (u.role === 'shipper' ? '/dashboard/shipper' : '/dashboard'))
    } catch (err) { setErr(err instanceof Error ? err.message : 'Sign in failed.'); setBusy(false) }
  }
  return (
    <Shell title="Welcome back" sub="Sign in to see your quotes, bookings and tracking." aside={<Aside />}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <RoleToggle role={role} setRole={setRole} />
        <div><label htmlFor="email" className="label-dark">Email</label><input id="email" type="email" className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder={role === 'shipper' ? 'ops@yourcompany.com' : 'you@example.com'} /></div>
        <div><label htmlFor="pw" className="label-dark">Password</label><input id="pw" type="password" className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Signing in</> : 'Sign in'}</motion.button>
        <p className="text-center text-sm text-text-muted">New here? <Link to={`/signup?role=${role}`} className="text-gold hover:underline">Create an account</Link></p>
        <DemoNote role={role} />
      </form>
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
      await signup({ name: f.name, email: f.email, password: f.pw, role, company: role === 'shipper' ? f.company : undefined })
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
        <div><label htmlFor="spw" className="label-dark">Password</label><input id="spw" type="password" className="input-dark" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} autoComplete="new-password" /><p className="mt-1 text-xs text-text-muted">At least 8 characters.</p></div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text-muted"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-gold" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /> I agree to the Terms of Service{role === 'shipper' ? ' and Shipper Agreement' : ''} and Privacy Policy.</label>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="btn-gold w-full" disabled={busy}>{busy ? <><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Creating account</> : role === 'shipper' ? 'Create shipper account' : 'Create account'}</motion.button>
        <p className="text-center text-sm text-text-muted">Already have an account? <Link to={`/login?role=${role}`} className="text-gold hover:underline">Sign in</Link></p>
      </form>
    </Shell>
  )
}

function Aside({ shipper = false }: { shipper?: boolean }) {
  const items = shipper
    ? ['Matched leads for your lanes, not spam', 'Verification badge after document review', 'No commission — flat monthly plans', 'Branded tracking page for your customers']
    : ['Quotes from verified shippers within 24h', 'Compare price, transit and inclusions side by side', 'One reference to track pickup → delivery', 'Free forever for customers']
  return (
    <div className="card-dark p-7">
      <p className="eyebrow">{shipper ? 'Why list on Ship Sync' : 'What you get'}</p>
      <ul className="mt-4 space-y-3">{items.map((i) => <li key={i} className="flex gap-3 text-text"><span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"><Check size={14} aria-hidden="true" /></span>{i}</li>)}</ul>
      <blockquote className="mt-6 border-t border-border pt-5 text-sm text-text-muted">“{shipper ? 'Listing on Ship Sync replaced our Facebook-group lead hunting.' : 'Four quotes in a day, picked one, cleared Tema in nine days.'}”<footer className="mt-2 text-xs">— {shipper ? 'Kwame Asante, Atlantic Bridge Logistics' : 'Abena Owusu, Houston → Accra'}</footer></blockquote>
    </div>
  )
}
