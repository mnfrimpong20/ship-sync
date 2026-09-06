/** Brand themes: four colour systems that share every component via CSS tokens (see src/index.css). */
export type Brand = 'ink' | 'forest' | 'slate' | 'cobalt'
export interface BrandMeta { id: Brand; name: string; blurb: string; swatches: [string, string, string] }
export const brands: BrandMeta[] = [
  { id: 'ink', name: 'Harbour Ink & Brass', blurb: 'Navy on linen, brass accent', swatches: ['#F7F5F0', '#0B1B33', '#C99C33'] },
  { id: 'forest', name: 'Forest & Gold', blurb: 'Deep green, muted gold', swatches: ['#F8F6EF', '#14392E', '#C9A227'] },
  { id: 'slate', name: 'Slate & Emerald', blurb: 'Cool grey, emerald actions', swatches: ['#F4F6F8', '#1F2933', '#0F8A6B'] },
  { id: 'cobalt', name: 'Cobalt & Cream', blurb: 'Logistics blue on cream', swatches: ['#FBF8F1', '#0B1B33', '#1F4FB8'] },
]
const KEY = 'ss-brand'
const isBrand = (v: unknown): v is Brand => brands.some((b) => b.id === v)

export function currentBrand(): Brand {
  const v = document.documentElement.dataset.brand
  return isBrand(v) ? v : 'ink'
}
export function applyBrand(b: Brand) {
  if (b === 'ink') delete document.documentElement.dataset.brand
  else document.documentElement.dataset.brand = b
  try { localStorage.setItem(KEY, b) } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('ss-brand', { detail: b }))
}
/** Runs before the first render so there is no flash of the default palette. */
export function applySavedBrand() {
  try { const v = localStorage.getItem(KEY); if (isBrand(v) && v !== 'ink') document.documentElement.dataset.brand = v } catch { /* ignore */ }
}
