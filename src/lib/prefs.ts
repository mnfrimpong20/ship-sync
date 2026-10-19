import { useEffect, useState } from 'react'
import { api } from './store'

/** Display preferences: text size, theme and language. Saved on the account (follows the person) and on this device. */
export type Lang = 'en' | 'fr'
export interface Display { lang: Lang; textSize: 'normal' | 'large' | 'larger'; theme: 'light' | 'dark' | 'system'; /** Road mode for drivers: bigger, stronger text and dark after dark. */ road?: boolean }
const DEFAULT: Display = { lang: 'en', textSize: 'normal', theme: 'light' }
const KEY = 'ss-display'
let state: Display = (() => { try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Display>) } } catch { return DEFAULT } })()
const subs = new Set<(d: Display) => void>()

const SIZE: Record<Display['textSize'], string> = { normal: '100%', large: '112.5%', larger: '125%' }
let mq: MediaQueryList | null = null
function apply(d: Display) {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  html.lang = d.lang
  html.style.fontSize = d.road && d.textSize === 'normal' ? SIZE.large : SIZE[d.textSize]
  html.classList.toggle('road', !!d.road)
  const hour = new Date().getHours(); const night = hour >= 19 || hour < 6
  const dark = d.theme === 'dark' || (d.theme === 'system' && (mq ??= window.matchMedia('(prefers-color-scheme: dark)')).matches) || (!!d.road && night)
  html.classList.toggle('theme-dark', dark)
  html.style.colorScheme = dark ? 'dark' : 'light'
}
apply(state)
if (typeof window !== 'undefined') { setInterval(() => state.road && apply(state), 10 * 60_000); mq = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null; mq?.addEventListener?.('change', () => state.theme === 'system' && apply(state)) }

function set(next: Display) { state = next; try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ } apply(next); subs.forEach((f) => f(next)) }
/** Called once the account loads: the account's saved choices win over this device's. */
export function adoptAccountDisplay(d: Partial<Display> | undefined | null) { if (d && Object.keys(d).length) set({ ...state, ...d }) }
/** Change one or more settings; signed-in people have them saved to their account too. */
export async function setDisplay(patch: Partial<Display>, signedIn = true) { set({ ...state, ...patch }); if (signedIn) await api('/me/display', { method: 'PUT', json: patch }).catch(() => {}) }
export function useDisplay() { const [d, setD] = useState(state); useEffect(() => { subs.add(setD); return () => { subs.delete(setD) } }, []); return d }
export const useLang = () => useDisplay().lang
/** For plain helpers outside React (date formatters). */
export const currentLang = (): Lang => state.lang
