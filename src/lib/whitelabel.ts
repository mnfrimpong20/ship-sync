import { api } from './store'

export interface WlBrand { slug: string; enabled: boolean; logo: string; accent: string; headline: string; tagline: string; intro: string; phone: string; whatsapp: string; email: string; website: string; domain: string; showRates: boolean; poweredBy: boolean; origins: string[] }
export interface BrandShipper { id: string; name: string; hq: string; tagline: string; about: string; initials: string; hue: string; rating: number; reviews: number; verified: boolean; modes: string[]; destinations: string[]; origins: string[]; cargo: string[]; services: string[]; founded: number }
export interface BrandRate { origin: string; destination: string; mode: string; cargo: string; basis: string; price: number; minCharge: number; transitDays: number }
export const whitelabelApi = {
  mine: () => api<{ brand: WlBrand; shipper: { id: string; name: string; hq: string; initials: string; hue: string; destinations: string[]; origins: string[] }; rateCards: number; leads: number; appUrl: string }>('/brand'),
  save: (b: Partial<WlBrand>) => api<{ brand: WlBrand }>('/brand', { method: 'PUT', json: b }).then((r) => r.brand),
  page: (slug: string) => api<{ brand: WlBrand; shipper: BrandShipper; rates: BrandRate[]; reviews: { rating: number; body: string; author: string; at: string }[] }>(`/t/${slug}`),
}
/** Readable text colour for a given accent. */
export const onAccent = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b1620' : '#ffffff' }
