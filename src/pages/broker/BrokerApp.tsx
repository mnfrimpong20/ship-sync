import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, Bell, Briefcase, ChevronDown, FileSpreadsheet, LayoutDashboard, LogOut, Mail, Menu, MessageSquare, Settings, Users, Wallet, X } from 'lucide-react'
import { bpApi, ago, type BpMe } from '../../lib/brokerPortal'
import { BrandLoader } from '../../components/BrandLoader'
import { Mark } from '../../components/ui'
import { PasswordInput } from '../../components/PasswordInput'

/** Mark + wordmark + "Broker" (no link of its own — callers wrap it). */
const Logo = ({ dark = false }: { dark?: boolean }) => <span className="inline-flex items-center gap-2.5"><Mark size={32} /><span className="flex flex-col leading-none"><span className={`font-heading text-[1.35rem] font-extrabold tracking-[-0.02em] ${dark ? 'text-white' : 'text-text'}`}>ntemtem</span><span className={`mt-1 text-[9.5px] font-bold uppercase tracking-[0.16em] ${dark ? 'text-gold' : 'text-gold-deep'}`}>Broker</span></span></span>

const Overview = lazy(() => import('./BrokerJobs').then((m) => ({ default: m.Overview })))
const Jobs = lazy(() => import('./BrokerJobs').then((m) => ({ default: m.Jobs })))
const JobPage = lazy(() => import('./BrokerJobs').then((m) => ({ default: m.JobPage })))
const Finance = lazy(() => import('./BrokerMoney').then((m) => ({ default: m.Finance })))
const InvoicePage = lazy(() => import('./BrokerMoney').then((m) => ({ default: m.InvoicePage })))
const Analytics = lazy(() => import('./BrokerInsights').then((m) => ({ default: m.Analytics })))
const Reports = lazy(() => import('./BrokerInsights').then((m) => ({ default: m.Reports })))
const Messages = lazy(() => import('./BrokerSettings').then((m) => ({ default: m.Messages })))
const Profile = lazy(() => import('./BrokerSettings').then((m) => ({ default: m.Profile })))
const Team = lazy(() => import('./BrokerSettings').then((m) => ({ default: m.Team })))

/* ---------------- who is signed in ---------------- */
interface Ctx { me: BpMe; reload: () => Promise<void> }
const BpCtx = createContext<Ctx | null>(null)
export const useBp = () => { const c = useContext(BpCtx); if (!c) throw new Error('outside broker app'); return c }

/* ---------------- small shared bits ---------------- */
export const Page = ({ title, eyebrow, actions, children, sub }: { title: string; eyebrow?: ReactNode; actions?: ReactNode; children: ReactNode; sub?: ReactNode }) => (
  <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div className="min-w-0">{eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}<h1 className="!text-[clamp(1.6rem,3vw,2.25rem)] leading-tight">{title}</h1>{sub && <div className="mt-1 text-text-muted">{sub}</div>}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>
    {children}
  </div>
)
export const Card = ({ title, sub, actions, children, className = '', id }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) => (
  <section className={`card-dark min-w-0 p-5 ${className}`} aria-labelledby={id}>
    {(title || actions) && <div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">{title && <h2 id={id} className="!text-base">{title}</h2>}{sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}</div>{actions}</div>}
    {children}
  </section>
)
export const Kpi = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'good' }) => (
  <div className={`card-dark min-w-0 p-4 ${tone === 'warn' ? 'border-l-4 border-l-danger' : tone === 'good' ? 'border-l-4 border-l-teal' : ''}`} data-testid="kpi"><p className="text-xs text-text-muted">{label}</p><p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>{hint && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}</div>
)
export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{children}</p>
export const Err = ({ e }: { e: string }) => (e ? <p role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{e}</p> : null)
export const Toast = ({ msg }: { msg: string }) => (msg ? <p role="status" className="mb-4 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-sm text-teal">{msg}</p> : null)
export const errMsg = (e: unknown, f = 'Something went wrong.') => (e instanceof Error ? e.message : f)
export function useToast() { const [t, setT] = useState(''); useEffect(() => { if (!t) return; const x = setTimeout(() => setT(''), 4000); return () => clearTimeout(x) }, [t]); return [t, setT] as const }

/* ---------------- sign-in screens ---------------- */
/** Line-art port scene: gantry cranes, container stacks and a ship on the water. Decorative only. */
function PortScene({ className = '' }: { className?: string }) {
  const stack = (x: number, rows: number, cols: number, hue: string) => Array.from({ length: rows * cols }, (_, k) => { const c = k % cols, r = Math.floor(k / cols); const X = x + c * 46, Y = 236 - (r + 1) * 20; return <g key={`${x}-${k}`}><rect x={X} y={Y} width={44} height={18} rx={1.5} fill={hue} fillOpacity={0.14} stroke={hue} strokeOpacity={0.55} />{[10, 18, 26, 34].map((d) => <line key={d} x1={X + d} y1={Y + 3} x2={X + d} y2={Y + 15} stroke={hue} strokeOpacity={0.35} />)}</g> })
  const crane = (x: number) => <g stroke="#F5B82E" strokeOpacity={0.7} fill="none" strokeWidth={1.5}><path d={`M${x} 236 V96 M${x + 52} 236 V96 M${x} 120 H${x + 52} M${x} 160 L${x + 52} 120 M${x + 52} 160 L${x} 120`} /><path d={`M${x - 70} 96 H${x + 120} M${x - 70} 96 L${x + 26} 64 L${x + 120} 96 M${x + 26} 64 V96`} /><path d={`M${x - 40} 96 V128`} strokeDasharray="3 3" /><rect x={x - 54} y={128} width={30} height={14} rx={1.5} fill="#F5B82E" fillOpacity={0.25} /></g>
  return (
    <svg viewBox="0 0 600 300" className={className} aria-hidden="true" focusable="false">
      <defs><linearGradient id="bp-water" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1B5E78" stopOpacity="0.5" /><stop offset="1" stopColor="#1B5E78" stopOpacity="0" /></linearGradient></defs>
      {crane(70)}{crane(250)}
      {stack(150, 4, 2, '#6CC3DD')}{stack(330, 3, 3, '#F5B82E')}{stack(480, 5, 2, '#34D399')}
      <line x1="0" y1="236" x2="600" y2="236" stroke="#F5EEE0" strokeOpacity={0.35} />
      <rect x="0" y="237" width="600" height="63" fill="url(#bp-water)" />
      <g fill="none" stroke="#F5EEE0" strokeOpacity={0.4}><path d="M398 262 h170 l-16 18 h-140 z" /><path d="M430 262 v-12 h40 v12 M480 262 v-8 h30 v8" /></g>
      {[252, 268, 284].map((y, k) => <path key={y} d={`M${20 + k * 30} ${y} q 20 -5 40 0 t 40 0 t 40 0`} fill="none" stroke="#6CC3DD" strokeOpacity={0.25 - k * 0.06} />)}
    </svg>
  )
}
const BRAND_POINTS: [typeof Briefcase, string, string][] = [
  [Briefcase, 'Every job, every step', 'Requests, papers, duty and release in one board.'],
  [Wallet, 'Bill on time', 'Fees and disbursements become invoices in two clicks.'],
  [MessageSquare, 'One thread per shipment', 'The shipping office and the customer, in one place.'],
]
function AuthFrame({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  const grid = { backgroundImage: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)', backgroundSize: '44px 44px' }
  return (
    <div className="ss-app min-h-screen bg-bg text-text lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* brand panel — full height on desktop, a short band on phones */}
      <aside className="relative isolate overflow-hidden bg-[#0D1424] text-white" aria-label="About the broker dashboard">
        <div className="absolute inset-0 -z-10" style={grid} />
        <div className="absolute -left-32 -top-32 -z-10 h-96 w-96 rounded-full bg-[#F5B82E]/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 -z-10 h-[28rem] w-[28rem] rounded-full bg-[#1B5E78]/40 blur-3xl" />
        <div className="flex h-full flex-col px-6 pb-16 pt-6 sm:px-10 lg:px-14 lg:pb-0 lg:pt-12">
          <Link to="/" className="inline-flex w-fit rounded focus-ring" aria-label="Ntemtem home"><Logo dark /></Link>
          <div className="mt-8 max-w-lg lg:mt-[clamp(2.5rem,9vh,7rem)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5B82E]">Ntemtem broker network</p>
            <p className="mt-3 font-heading text-[clamp(1.6rem,3.2vw,2.6rem)] font-bold leading-[1.1]">Clear faster. Bill on time. <span className="text-[#F5B82E]">Every job in one place.</span></p>
            <ul className="mt-8 hidden gap-5 lg:grid">
              {BRAND_POINTS.map(([I, t, d]) => <li key={t} className="flex gap-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-[#F5B82E]"><I size={18} aria-hidden="true" /></span><span><b className="block text-[0.95rem]">{t}</b><span className="text-sm text-white/65">{d}</span></span></li>)}
            </ul>
            <ul className="mt-8 hidden flex-wrap gap-2 lg:flex" aria-label="Ports on the network">{['Tema', 'Takoradi', 'Lagos · Apapa', 'Tin Can', 'Onne'].map((p) => <li key={p} className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/75">{p}</li>)}</ul>
          </div>
          <div className="relative -mx-14 mt-auto hidden lg:block">
            <PortScene className="block w-full translate-y-px" />
            {/* example of what a job looks like inside — decorative */}
            <div aria-hidden="true" className="absolute right-6 top-0 hidden w-60 -translate-y-1/4 rounded-2xl border border-white/10 bg-white/[0.07] p-4 shadow-2xl backdrop-blur-md xl:block">
              <div className="flex items-center justify-between text-xs"><span className="font-mono font-semibold">SS-R0021</span><span className="rounded-full bg-[#6CC3DD]/20 px-2 py-0.5 text-[#9ADCF0]">Documents lodged</span></div>
              <p className="mt-1 text-xs text-white/60">Barrels · Tema · for Gold Coast Freight</p>
              <div className="mt-3 flex gap-1">{[1, 1, 1, 0, 0, 0, 0].map((on, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${on ? 'bg-[#F5B82E]' : 'bg-white/15'}`} />)}</div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs"><span className="text-white/60">Invoice BRK-0005</span><span className="font-semibold text-[#34D399]">Paid $628.18</span></div>
            </div>
          </div>
        </div>
      </aside>

      {/* form side */}
      <main className="relative flex min-h-[70vh] flex-col items-center px-4 pb-8 lg:min-h-screen lg:justify-center lg:px-10 lg:py-12" style={{ backgroundImage: 'radial-gradient(color-mix(in oklab, var(--color-text) 9%, transparent) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
        <div className="-mt-10 w-full max-w-md lg:mt-0">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-[0_30px_80px_-40px_rgba(13,20,36,.45)] sm:p-8">
            <h1 className="!text-[1.7rem] leading-tight">{title}</h1>{sub && <p className="mt-1.5 text-text-muted">{sub}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-text-muted"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg> Secure sign-in · <Link to="/help" className="underline">Help</Link> · <Link to="/" className="underline">ntemtem.com</Link></p>
        </div>
      </main>
    </div>
  )
}
function Login({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sent, setSent] = useState(false); const [mode, setMode] = useState<'pw' | 'link'>('pw')
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { if (mode === 'pw') { await bpApi.login(email, pw); onIn() } else { await bpApi.link(email); setSent(true) } } catch (er) { setErr(errMsg(er)) } finally { setBusy(false) } }
  return (
    <AuthFrame title="Broker sign in" sub="Your clearance jobs, papers, billing and messages in one place.">
      {sent ? <p role="status" className="rounded-lg border border-teal/40 bg-teal/10 p-3 text-sm">If <b>{email}</b> has a broker account, a sign-in link is on its way. It works once, for 20 minutes.</p> : (
        <form onSubmit={go} className="grid gap-4" data-testid="bp-login">
          <Err e={err} />
          <div><label htmlFor="bp-email" className="label-dark">Email</label><input id="bp-email" type="email" autoComplete="username" required className="input-dark" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {mode === 'pw' && <div><label htmlFor="bp-pw" className="label-dark">Password</label><PasswordInput id="bp-pw" autoComplete="current-password" required className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} /></div>}
          <button disabled={busy} className="btn-gold w-full" data-testid="bp-login-go">{busy ? 'One moment…' : mode === 'pw' ? 'Sign in' : 'Email me a sign-in link'}</button>
          <button type="button" onClick={() => setMode(mode === 'pw' ? 'link' : 'pw')} className="text-sm font-semibold text-gold-deep underline">{mode === 'pw' ? 'Forgot your password? Email me a link' : 'Use my password instead'}</button>
        </form>)}
      <p className="mt-6 border-t border-border pt-4 text-center text-sm text-text-muted">Not on Ntemtem yet? <Link to="/brokers/join" className="font-semibold text-gold-deep underline">Apply to join the broker network</Link></p>
      <p className="mt-2 text-center text-xs text-text-muted">Shipping company or customer? <Link to="/login" className="underline">Sign in here</Link></p>
    </AuthFrame>
  )
}
function SignInLink({ onIn }: { onIn: () => void }) {
  const [sp] = useSearchParams(); const [err, setErr] = useState('')
  useEffect(() => { bpApi.useLink(sp.get('token') ?? '').then(onIn).catch((e) => setErr(errMsg(e))) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <AuthFrame title="Signing you in…">{err ? <><Err e={err} /><Link to="/broker-portal/login" className="btn-gold w-full">Back to sign in</Link></> : <BrandLoader full={false} />}</AuthFrame>
}
function Join({ onIn }: { onIn: () => void }) {
  const { token = '' } = useParams(); const [info, setInfo] = useState<{ name: string; email: string; company: string } | null>(null); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { bpApi.joinInfo(token).then(setInfo).catch((e) => setErr(errMsg(e))) }, [token])
  return (
    <AuthFrame title={info ? `Join ${info.company}` : 'Join your team'} sub={info ? `Hi ${info.name.split(' ')[0]} — set a password for ${info.email}.` : undefined}>
      <Err e={err} />
      {info && <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await bpApi.join(token, pw); onIn() } catch (er) { setErr(errMsg(er)) } finally { setBusy(false) } }} className="grid gap-4"><div><label htmlFor="bp-new" className="label-dark">New password (8+ characters)</label><PasswordInput id="bp-new" autoComplete="new-password" minLength={8} required className="input-dark" value={pw} onChange={(e) => setPw(e.target.value)} /></div><button disabled={busy} className="btn-gold w-full">Set password &amp; open the dashboard</button></form>}
    </AuthFrame>
  )
}

/* ---------------- shell ---------------- */
function Bellbox({ count, onSeen }: { count: number; onSeen: () => void }) {
  const [open, setOpen] = useState(false); const [list, setList] = useState<Awaited<ReturnType<typeof bpApi.notifications>> | null>(null)
  const btn = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null); const [pos, setPos] = useState({ top: 0, left: 0, width: 360 })
  const nav = useNavigate()
  const place = useCallback(() => { const b = btn.current?.getBoundingClientRect(); if (!b) return; const vw = document.documentElement.clientWidth; const width = Math.min(380, vw - 16); setPos({ top: b.bottom + 8, left: Math.max(8, Math.min(b.right - width, vw - width - 8)), width }) }, [])
  useEffect(() => { if (!open) return; place(); bpApi.notifications().then(setList).catch(() => setList([])); const out = (e: MouseEvent) => { const n = e.target as Node; if (!btn.current?.contains(n) && !panel.current?.contains(n)) setOpen(false) }; const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }; document.addEventListener('mousedown', out); document.addEventListener('keydown', key); window.addEventListener('resize', place); return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key); window.removeEventListener('resize', place) } }, [open, place])
  return (
    <>
      <button ref={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" aria-label={count ? `${count} new notifications` : 'Notifications'} className="relative grid h-11 w-11 place-items-center rounded-lg text-text-muted hover:text-text focus-ring" data-testid="bp-bell"><Bell size={19} />{count > 0 && <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[11px] font-bold text-on-accent">{count}</span>}</button>
      {open && createPortal(<div ref={panel} role="dialog" aria-label="Notifications" className="ss-app card-dark fixed z-[80] overflow-hidden p-0 shadow-xl" style={pos}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="text-sm font-semibold">Notifications</p>{count > 0 && <button onClick={async () => { await bpApi.readAll(); onSeen(); setList((l) => l?.map((x) => ({ ...x, read: true })) ?? null) }} className="min-h-10 rounded-md px-2 text-xs font-semibold text-text-muted hover:text-text">Mark all read</button>}</div>
        <ul className="max-h-[min(70vh,calc(100dvh-10rem))] overflow-y-auto">{!list ? <li className="p-4 text-sm text-text-muted">Loading…</li> : !list.length ? <li className="p-4 text-sm text-text-muted">Nothing yet.</li> : list.map((n) => <li key={n.id}><button onClick={() => { setOpen(false); if (n.link) nav(n.link) }} className={`block w-full border-b border-border/60 px-4 py-3 text-left hover:bg-surface-2 ${n.read ? '' : 'bg-gold/5'}`}><p className="text-sm font-semibold">{n.title}</p>{n.body && <p className="text-xs text-text-muted">{n.body}</p>}<p className="mt-0.5 text-xs text-text-muted">{ago(n.at)}</p></button></li>)}</ul>
      </div>, document.body)}
    </>
  )
}
const NAV = [
  ['/broker-portal', 'Overview', LayoutDashboard, true], ['/broker-portal/jobs', 'Jobs', Briefcase, false], ['/broker-portal/messages', 'Messages', MessageSquare, false],
  ['/broker-portal/finance', 'Finance', Wallet, false], ['/broker-portal/analytics', 'Analytics', BarChart3, false], ['/broker-portal/reports', 'Reports', FileSpreadsheet, false],
  ['/broker-portal/team', 'Team', Users, false], ['/broker-portal/profile', 'Profile & settings', Settings, false],
] as const
function Shell({ me, reload, children }: { me: BpMe; reload: () => Promise<void>; children: ReactNode }) {
  const [menu, setMenu] = useState(false); const [acct, setAcct] = useState(false); const loc = useLocation(); const nav = useNavigate()
  useEffect(() => { setMenu(false); setAcct(false) }, [loc.pathname])
  useEffect(() => { const x = setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 60000); return () => clearInterval(x) }, [reload])
  const badge = (to: string) => (to.endsWith('/jobs') ? me.counts.requests : to.endsWith('/messages') ? me.counts.unread : 0)
  const logout = async () => { await bpApi.logout(); nav('/broker-portal/login') }
  const links = (compact = false) => <ul className="space-y-1">{NAV.map(([to, label, I, end]) => <li key={to}><NavLink to={to} end={end} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium focus-ring ${isActive ? 'bg-gold/15 text-gold-deep lg:bg-white/10 lg:text-white' : 'text-text-muted hover:bg-surface-2 hover:text-text lg:text-white/70 lg:hover:bg-white/5 lg:hover:text-white'}`}><I size={18} aria-hidden="true" /><span className="flex-1">{label}</span>{badge(to) > 0 && <span className="rounded-full bg-gold px-1.5 text-xs font-bold text-on-accent">{badge(to)}</span>}{compact ? null : null}</NavLink></li>)}</ul>
  const b = me.broker
  return (
    <div className="ss-app min-h-screen bg-bg text-text lg:flex">
      <a href="#bp-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-on-accent">Skip to content</a>
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0D1424] text-white lg:flex" aria-label="Broker navigation">
        <div className="px-5 pb-4 pt-6"><Link to="/broker-portal" className="inline-flex items-center gap-2" aria-label="Broker dashboard home"><Logo dark /></Link><p className="mt-3 text-xs font-bold uppercase tracking-wider text-gold">Broker</p><p className="truncate text-sm font-semibold">{b.company || b.name}</p><p className="truncate text-xs text-white/60">{b.ports.join(' · ')} · {b.licenceNo}</p></div>
        <nav className="flex-1 px-3" aria-label="Main">{links()}</nav>
        <div className="border-t border-white/10 p-4 text-xs text-white/60"><p className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${b.accepting ? 'bg-[#3FB950]/20 text-[#7EE2A0]' : 'bg-white/10'}`}><span className={`h-2 w-2 rounded-full ${b.accepting ? 'bg-[#3FB950]' : 'bg-white/40'}`} aria-hidden="true" />{b.accepting ? 'Taking new jobs' : 'Not taking new jobs'}</p><p>Questions? <a href="mailto:hello@ntemtem.com" className="underline">hello@ntemtem.com</a></p></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-bg/95 px-3 backdrop-blur-xl sm:px-6">
          <button onClick={() => setMenu(true)} className="grid h-11 w-11 place-items-center rounded-lg lg:hidden focus-ring" aria-label="Open menu" aria-expanded={menu}><Menu size={20} /></button>
          <Link to="/broker-portal" className="lg:hidden" aria-label="Broker dashboard home"><Logo /></Link>
          <span className="flex-1" />
          <Bellbox count={me.counts.notifications} onSeen={() => void reload()} />
          <div className="relative">
            <button onClick={() => setAcct((v) => !v)} aria-expanded={acct} className="flex min-h-11 items-center gap-2 rounded-full border border-border px-1.5 pr-3 text-sm focus-ring" data-testid="bp-account"><span className="grid h-8 w-8 place-items-center rounded-full bg-gold text-xs font-bold text-on-accent">{me.member.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span><span className="hidden sm:inline">{me.member.name.split(' ')[0]}</span><ChevronDown size={14} aria-hidden="true" /></button>
            {acct && <div className="card-dark absolute right-0 z-50 mt-2 w-60 p-2 shadow-xl"><p className="px-3 py-2 text-sm"><b>{me.member.name}</b><span className="block text-xs text-text-muted">{me.member.email} · {me.member.role === 'owner' ? 'Owner' : 'Agent'}</span></p><Link to="/broker-portal/profile" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2"><Settings size={15} aria-hidden="true" /> Profile &amp; settings</Link><Link to={`/brokers/${b.id}`} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2"><Mail size={15} aria-hidden="true" /> My public listing</Link><button onClick={logout} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2" data-testid="bp-logout"><LogOut size={15} aria-hidden="true" /> Sign out</button></div>}
          </div>
        </header>
        <main id="bp-main" tabIndex={-1} className="outline-none pb-20 lg:pb-0">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-bg/95 backdrop-blur-xl lg:hidden" aria-label="Quick links">
          {NAV.slice(0, 4).map(([to, label, I, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-gold-deep' : 'text-text-muted'}`}><I size={20} aria-hidden="true" />{label}{badge(to) > 0 && <span className="absolute right-[28%] top-2 h-2.5 w-2.5 rounded-full bg-gold" aria-label={`${badge(to)} new`} />}</NavLink>)}
        </nav>
      </div>
      {menu && createPortal(<div className="ss-app fixed inset-0 z-[85] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu"><button className="absolute inset-0 bg-black/50" aria-label="Close menu" onClick={() => setMenu(false)} /><div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-bg p-4 shadow-2xl"><div className="mb-4 flex items-center justify-between"><Logo /><button onClick={() => setMenu(false)} className="grid h-11 w-11 place-items-center rounded-lg" aria-label="Close menu"><X size={20} /></button></div><p className="mb-3 px-3 text-sm font-semibold">{b.company || b.name}</p>{links(true)}</div></div>, document.body)}
    </div>
  )
}

/** /broker-portal/* — the broker network's own dashboard. */
export default function BrokerApp() {
  const [me, setMe] = useState<BpMe | null | 'out'>(null); const loc = useLocation(); const nav = useNavigate()
  const reload = useCallback(async () => { try { setMe(await bpApi.me()) } catch { setMe('out') } }, [])
  useEffect(() => { void reload() }, [reload])
  const signedIn = async () => { await reload(); nav('/broker-portal', { replace: true }) }
  const open = ['/broker-portal/login', '/broker-portal/signin'].includes(loc.pathname) || loc.pathname.startsWith('/broker-portal/join/')
  if (open) return <Routes><Route path="login" element={me && me !== 'out' ? <Navigate to="/broker-portal" replace /> : <Login onIn={signedIn} />} /><Route path="signin" element={<SignInLink onIn={signedIn} />} /><Route path="join/:token" element={<Join onIn={signedIn} />} /></Routes>
  if (me === null) return <BrandLoader label="Opening your broker dashboard…" />
  if (me === 'out') return <Navigate to={`/broker-portal/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return (
    <BpCtx.Provider value={{ me, reload }}>
      <Shell me={me} reload={reload}>
        <Suspense fallback={<BrandLoader full={false} />}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobPage />} />
            <Route path="messages" element={<Messages />} />
            <Route path="finance" element={<Finance />} />
            <Route path="invoices/:id" element={<InvoicePage />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="reports" element={<Reports />} />
            <Route path="team" element={<Team />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/broker-portal" replace />} />
          </Routes>
        </Suspense>
      </Shell>
    </BpCtx.Provider>
  )
}
