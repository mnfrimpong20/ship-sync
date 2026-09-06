import { api } from './store'
import type { CargoType, Shipper } from './data'

export type DirectorySort = 'recommended' | 'rating' | 'reviews' | 'response' | 'ontime' | 'newest' | 'name'
export type Priority = 'price' | 'speed' | 'reliability' | 'door'
export type Urgency = 'asap' | 'weeks' | 'flexible'
export interface SearchParams { q?: string; destination?: string; origin?: string; mode?: 'air' | 'ocean' | 'either'; cargo?: string; verified?: boolean; price?: '' | '1' | '2' | '3'; sort?: DirectorySort; page?: number; size?: number }
export interface SearchResult { shippers: Shipper[]; total: number; page: number; pages: number; size: number; facets: { destinations: { code: string; n: number }[]; cargo: { id: CargoType; n: number }[]; modes: { id: string; n: number }[] } }
export interface Needs { origin: string; destination: string; mode: 'air' | 'ocean' | 'either'; cargo: CargoType | ''; priority: Priority; urgency: Urgency; verifiedOnly: boolean }
export interface Match { shipper: Shipper; fit: number; reasons: string[]; cautions: string[] }
export interface Recommendation { matches: Match[]; total: number; lane: { country: string; oceanDays: string; airDays: string; ports: string[]; airports: string[] } | null }

export const sortLabels: Record<DirectorySort, string> = { recommended: 'Recommended', rating: 'Highest rated', reviews: 'Most reviewed', response: 'Fastest to reply', ontime: 'Best on-time record', newest: 'Newest listings', name: 'Name A–Z' }
export const priorityOptions: { id: Priority; label: string; blurb: string }[] = [
  { id: 'price', label: 'Lowest price', blurb: 'I’m flexible on timing; keep it affordable.' },
  { id: 'speed', label: 'Speed', blurb: 'Fast replies and the quickest transit available.' },
  { id: 'reliability', label: 'Reliability', blurb: 'Proven on-time record and years of experience.' },
  { id: 'door', label: 'Door-to-door', blurb: 'Pick up from my address and deliver to theirs.' },
]
export const urgencyOptions: { id: Urgency; label: string; blurb: string }[] = [
  { id: 'asap', label: 'As soon as possible', blurb: 'Days, not weeks — air freight if needed.' },
  { id: 'weeks', label: 'Within a few weeks', blurb: 'Normal ocean or air timing is fine.' },
  { id: 'flexible', label: 'Flexible', blurb: 'Happy to wait for the next cheap sailing.' },
]
export const isFeatured = (s: Shipper) => s.plan === 'enterprise'

export const directoryApi = {
  search: (p: SearchParams) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== false) qs.set(k, v === true ? '1' : String(v))
    return api<SearchResult>(`/shippers/search?${qs}`)
  },
  featured: (destination?: string) => api<{ shippers: Shipper[] }>(`/shippers/featured${destination ? `?destination=${destination}` : ''}`).then((r) => r.shippers),
  recommend: (n: Needs) => api<Recommendation>('/shippers/recommend', { json: n }),
}
