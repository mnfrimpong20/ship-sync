import { api } from './store'
import type { Mode, ShipmentStatus } from './data'

export type PieceStatus = 'labelled' | 'loaded' | 'devanned' | 'delivered'
export interface Piece { id: string; shipmentId: string; seq: number; labelCode: string; status: PieceStatus; printedAt: string | null; lastScanAt: string | null; lastScanKind: string; lastScanPlace: string; lastScanBy: string }
export interface LabelData {
  shipment: { id: string; ref: string; mode: Mode; origin: string; destination: string; cargo: string; description: string; status: ShipmentStatus; customer: string; createdAt: string | null }
  sender: { name: string; company: string; phone: string; city: string }
  receiver: { name: string; phone: string; address: string; city: string; country: string } | null
  container: { ref: string; number: string; seal: string; vesselName: string; destinationPort: string } | null
  pieces: Piece[]
}
export interface LabelsResponse { shipper: { name: string; hq: string }; labels: LabelData[] }

export const pieceStatusLabels: Record<PieceStatus, string> = { labelled: 'Labelled', loaded: 'Loaded', devanned: 'Devanned', delivered: 'Delivered' }

export const labelsApi = {
  forShipments: (ids: string[]) => api<LabelsResponse>(`/labels?shipments=${encodeURIComponent(ids.join(','))}`),
  pieces: (shipmentId: string) => api<{ pieces: Piece[] }>(`/shipments/${shipmentId}/pieces`).then((r) => r.pieces),
  setPieceCount: (shipmentId: string, count: number) => api<{ pieces: Piece[] }>(`/shipments/${shipmentId}/pieces`, { json: { count } }).then((r) => r.pieces),
  markPrinted: (pieceIds: string[]) => api<{ ok: true }>('/pieces/printed', { json: { pieceIds } }),
}

/** The URL a phone camera lands on when it scans the sticker. */
export const trackUrl = (ref: string, seq: number) => `${location.origin}${location.pathname}#/track?ref=${encodeURIComponent(ref)}&p=${seq}`

/* ------------------------------------------------------------- Code 128 (subset B) as an SVG, for cheap 1D scanners */
const C128 = ['11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001001100', '10011001000', '10011000100', '10001100100', '11001001000', '11001000100', '11000100100', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '11101100100', '11100110100', '11100110010', '11011011000', '11011000110', '11000110110', '10100011000', '10001011000', '10001000110', '10110001000', '10001101000', '10001100010', '11010001000', '11000101000', '11000100010', '10110111000', '10110001110', '10001101110', '10111011000', '10111000110', '10001110110', '11101110110', '11010001110', '11000101110', '11011101000', '11011100010', '11011101110', '11101011000', '11101000110', '11100010110', '11101101000', '11101100010', '11100011010', '11101111010', '11001000010', '11110001010', '10100110000', '10100001100', '10010110000', '10010000110', '10000101100', '10000100110', '10110010000', '10110000100', '10011010000', '10011000010', '10000110100', '10000110010', '11000010010', '11001010000', '11110111010', '11000010100', '10001111010', '10100111100', '10010111100', '10010011110', '10111100100', '10011110100', '10011110010', '11110100100', '11110010100', '11110010010', '11011011110', '11011110110', '11110110110', '10101111000', '10100011110', '10001011110', '10111101000', '10111100010', '11110101000', '11110100010', '10111011110', '10111101110', '11101011110', '11110101110', '11010000100', '11010010000', '11010011100', '1100011101011']
export function code128Svg(text: string, height = 40): string {
  const vals = [104, ...[...text].map((ch) => { const c = ch.charCodeAt(0) - 32; return c >= 0 && c < 95 ? c : 0 })]
  const check = vals.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103
  const bits = [...vals, check].map((v) => C128[v]).join('') + C128[106]
  let x = 0; const rects: string[] = []
  for (let i = 0; i < bits.length; i++) { let w = 1; while (bits[i + 1] === bits[i]) { w++; i++ } if (bits[i] === '1') rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`); x += w }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" fill="currentColor">${rects.join('')}</svg>`
}
