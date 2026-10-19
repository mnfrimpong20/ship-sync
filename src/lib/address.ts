/**
 * Destination addresses: Ghana Post GPS digital addresses, map pins, receiver language and local currency.
 * Shared by the app and the server.
 */

/** Ghana Post GPS digital address, e.g. "GA-183-8164" (region+district letters, area, unique code). */
const GPS_RE = /^([A-Z]{2})[-\s]?(\d{3,4})[-\s]?(\d{4})$/
export function normaliseGps(v: string | null | undefined): string {
  const m = GPS_RE.exec(String(v ?? '').trim().toUpperCase())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}
export const isGps = (v: string | null | undefined) => !!normaliseGps(v)
/** First two letters are the region: G = Greater Accra, A = Ashanti, … */
const GPS_REGIONS: Record<string, string> = { G: 'Greater Accra', A: 'Ashanti', C: 'Central', E: 'Eastern', V: 'Volta', W: 'Western', B: 'Bono', N: 'Northern', U: 'Upper East', X: 'Upper West', O: 'Oti', S: 'Savannah', H: 'Ahafo', K: 'Bono East', M: 'North East', Y: 'Western North' }
export const gpsRegion = (gps: string) => GPS_REGIONS[normaliseGps(gps).charAt(0)] ?? ''

/** A map link: the pinned point when we have one, else a search for the address text. */
export function mapLink(a: { lat?: number | null; lng?: number | null; gps?: string; address?: string; city?: string; country?: string }) {
  if (a.lat != null && a.lng != null && Number.isFinite(a.lat) && Number.isFinite(a.lng)) return `https://www.google.com/maps/search/?api=1&query=${a.lat.toFixed(6)},${a.lng.toFixed(6)}`
  const q = [a.address, a.city, a.country].filter(Boolean).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : ''
}

/** French-speaking destinations get the receiver page and texts in French. */
const FRENCH = new Set(['TG', 'CI', 'SN', 'BJ', 'BF', 'ML', 'NE', 'GN', 'CM', 'CD', 'CG', 'GA', 'TD', 'CF', 'MG', 'HT'])
export type Lang = 'en' | 'fr'
export const receiverLang = (country: string): Lang => (FRENCH.has(String(country).toUpperCase()) ? 'fr' : 'en')

/** Local currency for charges collected from the receiver, and whether mobile money is available through Paystack. */
export const LOCAL_CURRENCY: Record<string, { code: string; momo: boolean; label: string }> = {
  GH: { code: 'GHS', momo: true, label: 'MTN MoMo, Telecel Cash, AirtelTigo Money' },
  KE: { code: 'KES', momo: true, label: 'M-Pesa' },
  CI: { code: 'XOF', momo: true, label: 'Orange Money, MTN, Wave' },
  NG: { code: 'NGN', momo: false, label: 'Bank transfer or USSD' },
  ZA: { code: 'ZAR', momo: false, label: 'Card or instant EFT' },
}
export const localCurrency = (country: string) => LOCAL_CURRENCY[String(country).toUpperCase()]?.code ?? 'USD'
export const fmtMoney = (amount: number, currency: string, lang: Lang = 'en') => {
  try { return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { style: 'currency', currency, maximumFractionDigits: currency === 'XOF' ? 0 : 2 }).format(amount) } catch { return `${currency} ${amount.toFixed(2)}` }
}
