/**
 * Carrier "track & trace" — pulls container numbers, seals, vessel/voyage and milestone events from the shipping line
 * for a booking, so a container in Ship Sync fills itself in and moves forward without anyone typing.
 *
 * Provider-neutral: every adapter returns the same CarrierSnapshot. Pick one with CARRIER_TRACKING_PROVIDER:
 *   off   — feature hidden.
 *   mock  — built-in simulator (default). Assigns a number + seal at once, then gate-in, departure, arrival and discharge
 *           on a schedule from the moment tracking is connected (MOCK_CARRIER_STEP_MINUTES per step, default 30).
 *   dcsa  — a line's DCSA Track & Trace v2 endpoint (Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE… publish this shape).
 *           CARRIER_API_URL = base URL of the T&T API (e.g. https://api.cma-cgm.com/tracking/v2),
 *           CARRIER_API_KEY + CARRIER_API_KEY_HEADER (default "apikey"; CMA CGM uses "KeyId", Maersk "Consumer-Key").
 *           Aggregators (Vizion, Terminal49, Shipsgo…) each need a small adapter of their own — same interface.
 */

export type MilestoneCode = 'BOOKED' | 'GATE_IN' | 'LOADED' | 'DEPARTED' | 'TRANSSHIP' | 'ARRIVED' | 'DISCHARGED' | 'GATE_OUT' | 'EMPTY_RETURN'
export interface CarrierEvent { code: MilestoneCode; at: string; place: string; vesselName?: string; voyage?: string; note?: string }
export interface CarrierSnapshot {
  containers: { number: string; seal?: string }[]
  vesselName?: string; imo?: string; mmsi?: string; voyage?: string
  etd?: string; eta?: string
  events: CarrierEvent[]
}
export interface CarrierQuery { bookingRef: string; line: string; containerNumber?: string; subscribedAt: Date }
export interface CarrierAdapter { id: string; label: string; lookup(q: CarrierQuery): Promise<CarrierSnapshot | null> }

export const milestoneLabels: Record<MilestoneCode, string> = {
  BOOKED: 'Booking confirmed', GATE_IN: 'Gate in at origin terminal', LOADED: 'Loaded on vessel', DEPARTED: 'Vessel departed', TRANSSHIP: 'Transhipment',
  ARRIVED: 'Vessel arrived', DISCHARGED: 'Discharged at destination terminal', GATE_OUT: 'Gate out at destination', EMPTY_RETURN: 'Empty container returned',
}

/* ---------------------------------------------------------------- mock */
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
/** A few real ro-ro / container ships that sail the West Africa lanes, with their MMSI so live tracking lights up. */
const FLEET = [
  { name: 'Grande Africa', imo: '9165865', mmsi: '247189000', voyage: 'GA2236' },
  { name: 'Grande Nigeria', imo: '9246566', mmsi: '247327500', voyage: 'GN2241' },
  { name: 'Grande Togo', imo: '9291874', mmsi: '247236700', voyage: 'GT2238' },
  { name: 'Maersk Cabo Verde', imo: '9404054', mmsi: '219018271', voyage: '236W' },
  { name: 'MSC Chiara', imo: '9720213', mmsi: '636092845', voyage: 'NW636A' },
]
const prefixFor = (line: string) => { const l = line.toLowerCase(); return l.includes('maersk') ? 'MSKU' : l.includes('msc') ? 'MSCU' : l.includes('cma') ? 'CMAU' : l.includes('hapag') ? 'HLXU' : l.includes('one') ? 'ONEU' : l.includes('grimaldi') ? 'GRIU' : 'TGHU' }

const mock: CarrierAdapter = {
  id: 'mock', label: 'Carrier simulator',
  async lookup(q) {
    if (!q.bookingRef && !q.containerNumber) return null
    const h = hash(q.bookingRef || q.containerNumber || '')
    const step = Number(process.env.MOCK_CARRIER_STEP_MINUTES || 30) * 60_000
    const t0 = q.subscribedAt.getTime(); const now = Date.now()
    const ship = FLEET[h % FLEET.length]
    const number = q.containerNumber || `${prefixFor(q.line)}${String(1000000 + (h % 8999999)).slice(0, 6)}${h % 10}`
    const seal = `${prefixFor(q.line).slice(0, 2)}-${String(100000 + (h >> 8) % 899999)}`
    const at = (k: number) => new Date(t0 + k * step)
    const schedule: [MilestoneCode, number, string][] = [['BOOKED', 0, 'Origin'], ['GATE_IN', 1, 'Origin terminal'], ['LOADED', 2, 'Origin terminal'], ['DEPARTED', 2, 'Origin port'], ['ARRIVED', 5, 'Destination port'], ['DISCHARGED', 6, 'Destination terminal']]
    const events: CarrierEvent[] = schedule.filter(([, k]) => t0 + k * step <= now).map(([code, k, place]) => ({ code, at: at(k).toISOString(), place, vesselName: code === 'DEPARTED' || code === 'ARRIVED' || code === 'LOADED' || code === 'DISCHARGED' ? ship.name : undefined, voyage: ship.voyage }))
    return { containers: [{ number, seal }], vesselName: ship.name, imo: ship.imo, mmsi: ship.mmsi, voyage: ship.voyage, etd: at(2).toISOString().slice(0, 10), eta: at(5).toISOString().slice(0, 10), events }
  },
}

/* ---------------------------------------------------------------- DCSA Track & Trace v2 */
type Any = Record<string, any>
const dcsa: CarrierAdapter = {
  id: 'dcsa', label: process.env.CARRIER_LABEL || 'Shipping line API',
  async lookup(q) {
    const base = (process.env.CARRIER_API_URL || '').replace(/\/$/, '')
    if (!base) throw new Error('CARRIER_API_URL is not set.')
    const key = process.env.CARRIER_API_KEY || ''
    const headers: Record<string, string> = { accept: 'application/json' }
    if (key) headers[process.env.CARRIER_API_KEY_HEADER || 'apikey'] = key
    const param = q.containerNumber ? `equipmentReference=${encodeURIComponent(q.containerNumber)}` : `carrierBookingReference=${encodeURIComponent(q.bookingRef)}`
    const res = await fetch(`${base}/events?${param}&limit=200`, { headers })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Carrier API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const list = (await res.json()) as Any[] | Any
    const events: Any[] = Array.isArray(list) ? list : Array.isArray(list?.events) ? list.events : []
    return parseDcsa(events)
  },
}
/** DCSA event → our milestone. Transport events carry the vessel; equipment events carry the box and seals. */
export function parseDcsa(events: Any[]): CarrierSnapshot {
  const out: CarrierSnapshot = { containers: [], events: [] }
  const boxes = new Map<string, { number: string; seal?: string }>()
  const place = (e: Any) => { const tc = e.transportCall ?? {}; const loc = e.eventLocation ?? tc.location ?? {}; return loc.locationName || loc.UNLocationCode || tc.UNLocationCode || '' }
  const vessel = (e: Any) => e.transportCall?.vessel ?? {}
  for (const e of events) {
    if (e.eventClassifierCode && e.eventClassifierCode !== 'ACT') continue // planned/estimated events are not milestones
    const at = e.eventDateTime || e.eventCreatedDateTime
    const v = vessel(e); const voyage = e.transportCall?.exportVoyageNumber || e.transportCall?.carrierVoyageNumber || e.transportCall?.importVoyageNumber
    if (v.vesselName) { out.vesselName = v.vesselName; if (v.vesselIMONumber) out.imo = String(v.vesselIMONumber); if (voyage) out.voyage = voyage }
    let code: MilestoneCode | null = null
    if (e.eventType === 'EQUIPMENT') {
      const n = e.equipmentReference; if (n) { const b: { number: string; seal?: string } = boxes.get(n) ?? { number: n }; const seal = e.seals?.[0]?.sealNumber; if (seal) b.seal = seal; boxes.set(n, b) }
      code = ({ GTIN: 'GATE_IN', LOAD: 'LOADED', DISC: 'DISCHARGED', GTOT: 'GATE_OUT', RETN: 'EMPTY_RETURN' } as Record<string, MilestoneCode>)[e.equipmentEventTypeCode] ?? null
      // A discharge at an intermediate call is a transhipment, not arrival.
      if (code === 'DISCHARGED' && e.transportCall?.transportCallSequenceNumber && e.isTranshipmentMove) code = 'TRANSSHIP'
    } else if (e.eventType === 'TRANSPORT') {
      if ((e.transportCall?.modeOfTransport ?? 'VESSEL') === 'VESSEL') code = e.transportEventTypeCode === 'DEPA' ? 'DEPARTED' : e.transportEventTypeCode === 'ARRI' ? 'ARRIVED' : null
    } else if (e.eventType === 'SHIPMENT' && e.shipmentEventTypeCode === 'CONF') code = 'BOOKED'
    if (code && at) out.events.push({ code, at, place: place(e), vesselName: v.vesselName, voyage, note: e.remark })
  }
  out.containers = [...boxes.values()]
  out.events.sort((a, b) => a.at.localeCompare(b.at))
  return out
}

/* ---------------------------------------------------------------- registry */
const adapters: Record<string, CarrierAdapter> = { mock, dcsa }
export function carrierAdapter(): CarrierAdapter | null {
  const id = (process.env.CARRIER_TRACKING_PROVIDER || 'mock').toLowerCase()
  if (id === 'off' || id === 'none' || id === 'false') return null
  const a = adapters[id]; if (!a) { console.warn(`[carriers] unknown CARRIER_TRACKING_PROVIDER "${id}" — tracking off`); return null }
  return a
}
