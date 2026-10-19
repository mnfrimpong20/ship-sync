import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

/**
 * Branded loading screen: the Ntemtem mark with its chevrons moving forward and the parcel settling,
 * a gold progress line, and a calm message. Reduced motion → still mark. After a while on a slow connection
 * it says so instead of looking stuck.
 */
export function BrandLoader({ label, full = true, partner = false }: { label?: string; full?: boolean; partner?: boolean }) {
  const t = useT()
  const [slow, setSlow] = useState(false)
  useEffect(() => { const id = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(id) }, [])
  const tile = partner ? '#24211C' : '#F2A900', trail = partner ? '#37B07A' : '#0A6842', lead = partner ? '#F2A900' : '#14213D'
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={`grid place-items-center text-text ${full ? 'min-h-[70vh] bg-bg' : 'py-10'}`} data-testid="brand-loader">
      <div className="flex flex-col items-center">
        <svg width={full ? 72 : 52} height={full ? 72 : 52} viewBox="0 0 96 96" aria-hidden="true" className="ntm-loader drop-shadow-sm">
          <rect width="96" height="96" rx="22" fill={tile} />
          <path className="ntm-chev ntm-chev-1" d="M17,28 L35,48 L17,68" fill="none" stroke={trail} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          <path className="ntm-chev ntm-chev-2" d="M39,28 L57,48 L39,68" fill="none" stroke={lead} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
          <rect className="ntm-box" x="64" y="38" width="20" height="20" rx="5" fill={lead} />
        </svg>
        <p className="mt-4 font-heading text-xl font-extrabold tracking-[-0.02em]">ntemtem</p>
        <div className="mt-3 h-1 w-40 overflow-hidden rounded-full bg-border/70" aria-hidden="true"><div className="ntm-bar h-full w-1/3 rounded-full bg-gold" /></div>
        <p className="mt-3 text-sm text-text-muted">{label ?? t('Loading…')}</p>
        {slow && <p className="mt-1 max-w-xs text-center text-xs text-text-muted">This is taking longer than usual — your connection may be slow. It will appear as soon as it arrives.</p>}
      </div>
    </div>
  )
}
