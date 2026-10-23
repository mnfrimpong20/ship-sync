import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { LifeBuoy, Mail, MessageCircle, X } from 'lucide-react'
import { useSiteConfig } from '../lib/site'

/** "https://wa.me/233…" with a first message already typed. */
export const waWithText = (url: string, text: string) => `${url}?text=${encodeURIComponent(text)}`

/** Footer band: help centre, WhatsApp, contact — the three ways to get unstuck. */
export function NeedHelpBar() {
  const cfg = useSiteConfig()
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/40 p-5 md:flex-row md:items-center md:justify-between" data-testid="footer-help">
      <div><p className="font-semibold">Need help?</p><p className="text-sm text-text-muted">Most answers are in the help centre. A person replies within one business day.</p></div>
      <div className="flex flex-wrap gap-2">
        <Link to="/help" className="btn-ghost !min-h-10 !px-4 text-sm"><LifeBuoy size={15} aria-hidden="true" /> Help centre</Link>
        {cfg?.whatsappUrl && <a href={waWithText(cfg.whatsappUrl, 'Hi Ntemtem, ')} target="_blank" rel="noreferrer" className="btn-ghost !min-h-10 !px-4 text-sm"><MessageCircle size={15} aria-hidden="true" /> WhatsApp us</a>}
        <Link to="/contact" className="btn-gold !min-h-10 !px-4 text-sm"><Mail size={15} aria-hidden="true" /> Contact us</Link>
      </div>
    </div>
  )
}

/** One quiet line under a form or result: "Questions? Help centre · WhatsApp · Contact us". */
export function HelpLine({ text = 'Questions?', topic, waText, className = '' }: { text?: string; topic?: string; waText?: string; className?: string }) {
  const cfg = useSiteConfig()
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted ${className}`} data-testid="help-line">
      <span>{text}</span>
      {cfg?.whatsappUrl && <><a href={waWithText(cfg.whatsappUrl, waText ?? 'Hi Ntemtem, ')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-gold-deep underline underline-offset-2 hover:decoration-2"><MessageCircle size={14} aria-hidden="true" /> Chat on WhatsApp</a><span aria-hidden="true">·</span></>}
      <Link to="/help" className="font-semibold text-gold-deep underline underline-offset-2 hover:decoration-2">Help centre</Link><span aria-hidden="true">·</span>
      <Link to={topic ? `/contact?topic=${topic}` : '/contact'} className="font-semibold text-gold-deep underline underline-offset-2 hover:decoration-2">Contact us</Link>
    </p>
  )
}

/** Floating "Chat with us" on public pages, when Ntemtem's WhatsApp number is set. Dismissable for the session. */
const HIDE_ON = ['/dashboard', '/admin', '/r/', '/p/', '/s/', '/pay', '/doc', '/order', '/add-recipient', '/broker', '/embed', '/login', '/signup', '/join', '/forgot', '/reset', '/signin', '/support', '/scan', '/quote']
export function WhatsAppBubble() {
  const cfg = useSiteConfig(); const loc = useLocation()
  const [closed, setClosed] = useState(() => { try { return sessionStorage.getItem('ss-wa-closed') === '1' } catch { return false } })
  const [ready, setReady] = useState(false); const [clear, setClear] = useState(true)
  useEffect(() => { const t = setTimeout(() => setReady(true), 2500); return () => clearTimeout(t) }, [])
  // Stay out of the way: not over the home hero's numbers (wait until people scroll), and not over the footer, which has its own WhatsApp link.
  useEffect(() => {
    const home = loc.pathname === '/'
    const check = () => { const all = document.querySelectorAll('footer'); const f = all[all.length - 1]; const footerIn = !!f && f.getBoundingClientRect().top < window.innerHeight - 40; setClear(!footerIn && (!home || window.scrollY > window.innerHeight * 0.6)) }
    check(); window.addEventListener('scroll', check, { passive: true }); window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [loc.pathname])
  if (!cfg?.whatsappUrl || closed || HIDE_ON.some((p) => loc.pathname.startsWith(p))) return null
  const text = loc.pathname.startsWith('/track') ? 'Hi Ntemtem, where is my shipment? My reference is ' : loc.pathname.startsWith('/for-shippers') ? 'Hi Ntemtem, I run a shipping company and want to list it.' : 'Hi Ntemtem, '
  const close = () => { setClosed(true); try { sessionStorage.setItem('ss-wa-closed', '1') } catch { /* private mode */ } }
  return (
    <AnimatePresence>{ready && clear && (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} className="no-print group fixed bottom-24 right-4 z-40 flex items-center gap-2 md:bottom-6 md:right-6" data-testid="wa-bubble" role="complementary" aria-label="WhatsApp chat">
        <a href={waWithText(cfg.whatsappUrl, text)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-[#1f7a4d] px-4 text-sm font-semibold text-white shadow-lg hover:bg-[#186640] focus-ring" aria-label="Chat with Ntemtem on WhatsApp"><MessageCircle size={18} aria-hidden="true" /><span className="hidden sm:inline">Chat with us</span></a>
        <button onClick={close} className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface text-text-muted shadow hover:text-text" aria-label="Hide the chat button"><X size={13} /></button>
      </motion.div>)}</AnimatePresence>
  )
}
