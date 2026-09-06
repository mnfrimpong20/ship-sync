import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Palette } from 'lucide-react'
import { applyBrand, brands, currentBrand, type Brand } from '../lib/brand'

/** Small palette button that opens a popover of the four brand themes. Choice persists per browser. */
export default function ThemeSwitcher({ compact = false, align = 'right' }: { compact?: boolean; align?: 'right' | 'left' }) {
  const [open, setOpen] = useState(false)
  const [brand, setBrand] = useState<Brand>(() => currentBrand())
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onBrand = (e: Event) => setBrand((e as CustomEvent<Brand>).detail)
    document.addEventListener('mousedown', onDoc); window.addEventListener('keydown', onKey); window.addEventListener('ss-brand', onBrand)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); window.removeEventListener('ss-brand', onBrand) }
  }, [])
  const cur = brands.find((b) => b.id === brand) ?? brands[0]
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`${compact ? 'grid h-10 w-10 place-items-center rounded-lg' : 'btn-ghost !min-h-10 !px-3 text-sm'} text-text-muted hover:text-text focus-ring`} aria-haspopup="listbox" aria-expanded={open} aria-label={`Colour theme: ${cur.name}`} title="Colour theme">
        <Palette size={17} aria-hidden="true" />
        {!compact && <span className="hidden xl:inline">Theme</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} role="listbox" aria-label="Colour theme" className={`card-dark absolute ${align === 'right' ? 'right-0' : 'left-0'} z-50 mt-2 w-64 overflow-hidden p-1.5`}>
            <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Colour theme</li>
            {brands.map((b) => (
              <li key={b.id} role="option" aria-selected={b.id === brand}>
                <button onClick={() => { applyBrand(b.id); setBrand(b.id); setOpen(false) }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm focus-ring ${b.id === brand ? 'bg-gold/10' : 'hover:bg-surface-2'}`}>
                  <span className="flex shrink-0 overflow-hidden rounded-md border border-border" aria-hidden="true">{b.swatches.map((c) => <i key={c} className="block h-5 w-3" style={{ background: c }} />)}</span>
                  <span className="min-w-0 flex-1"><span className="block font-medium leading-tight">{b.name}</span><span className="block text-xs text-text-muted">{b.blurb}</span></span>
                  {b.id === brand && <Check size={15} className="shrink-0 text-gold-deep" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
