import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Link2Off, MessageCircle, Search } from 'lucide-react'
import { Logo } from './ui'
import { setPageTitle } from '../lib/site'

/**
 * What every private link (pay, document, recipient, partner, broker, supplier…) shows when it no longer works:
 * what happened, who can send a new one, and a way forward — never a bare "not valid".
 */
export function LinkProblem({ title = 'This link doesn’t work any more', body, who = 'the company that sent it', track = true, chrome = false }: { title?: string; body?: string; who?: string; track?: boolean; chrome?: boolean }) {
  useEffect(() => { setPageTitle('Link not valid') }, [])
  return (
    <div className="bg-bg text-text" data-testid="link-problem">
      {chrome && <div className="container-x pt-6"><Link to="/" aria-label="Ntemtem home"><Logo /></Link></div>}
      <div className="container-x grid min-h-[55vh] place-items-center py-16">
        <div className="card-dark w-full max-w-md p-7 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-text-muted"><Link2Off size={22} aria-hidden="true" /></span>
          <h1 className="mt-4 !text-2xl">{title}</h1>
          <p className="mt-2 text-sm text-text-muted">{body ?? `It may have expired, been switched off, or been copied incompletely. Ask ${who} to send you a fresh link.`}</p>
          <div className="mt-6 grid gap-2">
            {track && <Link to="/track" className="btn-gold"><Search size={16} aria-hidden="true" /> Track with your reference</Link>}
            <Link to="/contact" className="btn-ghost"><MessageCircle size={16} aria-hidden="true" /> Contact Ntemtem</Link>
            <Link to="/" className="mt-1 text-sm text-text-muted underline">Ntemtem home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
