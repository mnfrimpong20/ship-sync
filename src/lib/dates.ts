/**
 * Dates people can read, shared by the app and the server.
 * "2026-10-02" → "Fri 2 Oct" (year added when it isn't this year), optionally "(17 days ago)".
 */
const ISO_DAY = /\b(20\d\d-\d\d-\d\d)(?:T[\d:.]+Z?)?\b/g
const asUtcNoon = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z')

export function niceDay(iso: string | null | undefined, opts: { lang?: 'en' | 'fr'; rel?: boolean; now?: Date } = {}) {
  if (!iso) return ''
  const d = asUtcNoon(String(iso)); if (isNaN(d.getTime())) return String(iso)
  const now = opts.now ?? new Date(); const today = asUtcNoon(now.toISOString())
  const fr = opts.lang === 'fr'
  const day = d.toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC', ...(d.getUTCFullYear() !== today.getUTCFullYear() ? { year: 'numeric' } : {}) })
  if (!opts.rel) return day
  const n = Math.round((d.getTime() - today.getTime()) / 86400000)
  const rel = fr
    ? (n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : n === -1 ? 'hier' : n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`)
    : (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`)
  return `${day} (${rel})`
}

/** Replace every ISO date inside a sentence with a readable one. */
export const humanizeDates = (text: string | null | undefined, opts: { lang?: 'en' | 'fr'; rel?: boolean } = {}) =>
  text ? text.replace(ISO_DAY, (m) => niceDay(m, opts)) : (text ?? '')
