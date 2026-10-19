/**
 * Weight, volume and chargeable weight. Shared by the app and the server.
 *
 *   Air: volumetric kg = L×W×H (cm) ÷ 6000 (IATA); chargeable = the higher of actual and volumetric.
 *   Ocean (LCL): priced per cubic metre, "weight or measure" — 1 m³ = 1,000 kg; freight tons = max(m³, t).
 */
export const AIR_DIVISOR = 6000
export const LB_PER_KG = 2.20462
export const CM_PER_IN = 2.54
const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface PieceDims { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null }
export const cbmOf = (p: PieceDims) => (p.lengthCm && p.widthCm && p.heightCm ? (p.lengthCm * p.widthCm * p.heightCm) / 1_000_000 : 0)
export const volKgOf = (p: PieceDims) => (p.lengthCm && p.widthCm && p.heightCm ? (p.lengthCm * p.widthCm * p.heightCm) / AIR_DIVISOR : 0)

export interface Totals { pieces: number; measured: number; actualKg: number; cbm: number; volumetricKg: number; chargeableKg: number; freightTons: number; basis: 'actual' | 'volume' }
export function totals(pieces: PieceDims[], mode: 'air' | 'ocean'): Totals {
  const measured = pieces.filter((p) => p.weightKg != null || cbmOf(p) > 0)
  const actualKg = measured.reduce((s, p) => s + (p.weightKg ?? 0), 0)
  const cbm = measured.reduce((s, p) => s + cbmOf(p), 0)
  const volumetricKg = mode === 'air' ? measured.reduce((s, p) => s + volKgOf(p), 0) : cbm * 1000
  const chargeableKg = Math.max(actualKg, volumetricKg)
  return { pieces: pieces.length, measured: measured.length, actualKg: r2(actualKg), cbm: r3(cbm), volumetricKg: r2(volumetricKg), chargeableKg: r2(chargeableKg), freightTons: r3(Math.max(cbm, actualKg / 1000)), basis: volumetricKg > actualKg ? 'volume' : 'actual' }
}

/** "24x18x18 in", "60 x 40 x 40cm", "2 @ 50×40×30" → cm per piece (best effort; null when unreadable). */
export function parseDims(s: string): { lengthCm: number; widthCm: number; heightCm: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(cm|in|inch|inches|"|m)?/i.exec(String(s ?? ''))
  if (!m) return null
  const unit = (m[4] ?? 'cm').toLowerCase(); const k = unit === 'm' ? 100 : unit.startsWith('in') || unit === '"' ? CM_PER_IN : 1
  return { lengthCm: r2(Number(m[1]) * k), widthCm: r2(Number(m[2]) * k), heightCm: r2(Number(m[3]) * k) }
}

/**
 * One line from a serial scale → kg. Handles the common formats:
 *   "ST,GS,+  012.34kg", "  12.34 kg", "W: 27.2 lb", "US,NT,-  0.00 kg" (unstable → null), "+0001.250" (kg assumed).
 */
export function parseScaleLine(line: string): { kg: number; stable: boolean } | null {
  const t = String(line ?? '').trim(); if (!t) return null
  const m = /([+-]?\s*\d+(?:\.\d+)?)\s*(kg|lb|lbs|g|oz)?/i.exec(t.replace(/^[A-Z]{2},[A-Z]{2},/, ''))
  if (!m) return null
  const n = Number(m[1].replace(/\s/g, '')); if (!Number.isFinite(n)) return null
  const u = (m[2] ?? 'kg').toLowerCase()
  const kg = u === 'g' ? n / 1000 : u.startsWith('lb') ? n / LB_PER_KG : u === 'oz' ? n / 35.274 : n
  return { kg: r2(kg), stable: !/^US\b|unstable|\?/i.test(t) }
}
export const kgToLb = (kg: number) => r2(kg * LB_PER_KG)
export const lbToKg = (lb: number) => r2(lb / LB_PER_KG)
