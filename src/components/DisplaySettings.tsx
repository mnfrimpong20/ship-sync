import { Check, Languages, Moon, Sun, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import { setDisplay, useDisplay, type Display } from '../lib/prefs'
import { useT } from '../lib/i18n'

/** Text size, light/dark and language — saved to the account so they follow the person to every device. */
export function DisplaySettings({ signedIn = true }: { signedIn?: boolean }) {
  const d = useDisplay(); const t = useT()
  const Row = <K extends keyof Display>({ k, label, icon, options }: { k: K; label: string; icon: ReactNode; options: [Display[K], string, ReactNode?][] }) => (
    <fieldset className="mt-4 first:mt-0">
      <legend className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">{icon}{t(label)}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t(label)}>
        {options.map(([v, l, extra]) => { const on = d[k] === v; return (
          <button key={String(v)} type="button" role="radio" aria-checked={on} onClick={() => void setDisplay({ [k]: v } as Partial<Display>, signedIn)} data-testid={`display-${String(k)}-${String(v)}`}
            className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-center text-sm transition-colors focus-ring ${on ? 'border-gold bg-gold/10 font-semibold' : 'border-border hover:border-gold/50'}`}>
            {extra}<span>{l}</span>{on && <Check size={13} className="absolute right-1.5 top-1.5 text-gold-deep" aria-hidden="true" />}
          </button>) })}
      </div>
    </fieldset>
  )
  return (
    <section className="card-dark p-5" aria-labelledby="display-h" data-testid="display-card">
      <h3 id="display-h" className="!text-base">{t('Display & language')}</h3>
      <p className="mb-4 mt-1 text-xs text-text-muted">{t('Saved to your account, so it follows you to every device.')}</p>
      {Row({ k: 'textSize', label: 'Text size', icon: <Type size={15} className="text-gold-deep" aria-hidden="true" />, options: [['normal', t('Normal'), <span key="a" className="text-sm font-bold" aria-hidden="true">Aa</span>], ['large', t('Large'), <span key="b" className="text-base font-bold" aria-hidden="true">Aa</span>], ['larger', t('Larger'), <span key="c" className="text-lg font-bold leading-6" aria-hidden="true">Aa</span>]] })}
      {Row({ k: 'theme', label: 'Theme', icon: <Moon size={15} className="text-gold-deep" aria-hidden="true" />, options: [['light', t('Light'), <Sun key="l" size={16} aria-hidden="true" />], ['dark', t('Dark'), <Moon key="d" size={16} aria-hidden="true" />], ['system', t('Match my device')]] })}
      {Row({ k: 'lang', label: 'Language', icon: <Languages size={15} className="text-gold-deep" aria-hidden="true" />, options: [['en', 'English'], ['fr', 'Français']] })}
    </section>
  )
}
