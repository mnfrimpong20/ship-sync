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
 *   terminal49 — the Terminal49 aggregator (api.terminal49.com/v2): set TERMINAL49_API_KEY. One key covers every
 *           major line; we open a tracking request per booking, then read the shipment, its container and transport
 *           events. Vessel positions come with an MMSI, so live tracking lights up without any lookup.
 *   Other aggregators (Vizion, Shipsgo…) would be one more adapter behind the same interface.
 * When CARRIER_TRACKING_PROVIDER is unset the server picks terminal49 if TERMINAL49_API_KEY is present, else mock.
 */

export type MilestoneCode = 'BOOKED' | 'GATE_IN' | 'LOADED' | 'DEPARTED' | 'TRANSSHIP' | 'ARRIVED' | 'DISCHARGED' | 'GATE_OUT' | 'EMPTY_RETURN'
export interface CarrierEvent { code: MilestoneCode; at: string; place: string; vesselName?: string; voyage?: string; note?: string }
/** `state` is whatever the adapter asked us to remember for this container last time (ids at the provider, etc.). */
export interface CarrierQuery { bookingRef: string; line: string; containerNumber?: string; subscribedAt: Date; ref: string; state: Record<string, any> }
/** Return null while the provider has nothing yet; set `state` to persist provider-side ids between polls. */
export interface CarrierSnapshot { containers: { number: string; seal?: string }[]; vesselName?: string; imo?: string; mmsi?: string; voyage?: string; etd?: string; eta?: string; events: CarrierEvent[]; state?: Record<string, any> }
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


/* ---------------------------------------------------------------- Terminal49 (aggregator) */
const T49 = 'https://api.terminal49.com/v2'
/** Standard Carrier Alpha Codes for the lines shippers type in. Unknown names fall back to Terminal49's auto-detect. */
const SCAC: [RegExp, string][] = [[/maersk/i, 'MAEU'], [/\bmsc\b|mediterranean/i, 'MSCU'], [/cma|cgm/i, 'CMDU'], [/hapag|lloyd/i, 'HLCU'], [/\bone\b|ocean network/i, 'ONEY'], [/evergreen/i, 'EGLV'], [/cosco/i, 'COSU'], [/oocl/i, 'OOLU'], [/yang ?ming/i, 'YMLU'], [/zim/i, 'ZIMU'], [/hmm|hyundai/i, 'HDMU'], [/grimaldi/i, 'GRIU'], [/pil|pacific international/i, 'PCIU'], [/arkas/i, 'ARKU'], [/safmarine/i, 'SAFM'], [/sealand/i, 'SEJJ'], [/hamburg s/i, 'SUDU']]
export const scacFor = (line: string) => SCAC.find(([re]) => re.test(line))?.[1] ?? null
const t49Events: Record<string, MilestoneCode> = {
  'container.transport.full_in': 'GATE_IN', 'container.transport.vessel_loaded': 'LOADED', 'container.transport.vessel_departed': 'DEPARTED',
  'container.transport.transshipment_arrived': 'TRANSSHIP', 'container.transport.transshipment_discharged': 'TRANSSHIP', 'container.transport.transshipment_loaded': 'TRANSSHIP', 'container.transport.transshipment_departed': 'TRANSSHIP',
  'container.transport.feeder_arrived': 'TRANSSHIP', 'container.transport.feeder_discharged': 'TRANSSHIP', 'container.transport.feeder_loaded': 'TRANSSHIP', 'container.transport.feeder_departed': 'TRANSSHIP',
  'container.transport.vessel_arrived': 'ARRIVED', 'container.transport.vessel_berthed': 'ARRIVED', 'container.transport.vessel_discharged': 'DISCHARGED', 'container.transport.full_out': 'GATE_OUT', 'container.transport.empty_in': 'EMPTY_RETURN',
}
const terminal49: CarrierAdapter = {
  id: 'terminal49', label: 'Terminal49',
  async lookup(q) {
    const key = process.env.TERMINAL49_API_KEY || ''
    if (!key) throw new Error('TERMINAL49_API_KEY is not set.')
    const base = (process.env.TERMINAL49_API_URL || T49).replace(/\/$/, '')
    const call = async (path: string, init?: RequestInit) => {
      const res = await fetch(base + path, { ...init, headers: { authorization: `Token ${key}`, accept: 'application/json', 'content-type': 'application/vnd.api+json', ...(init?.headers ?? {}) } })
      const body = (await res.json().catch(() => ({}))) as Any
      if (res.status === 429) throw new Error('Terminal49 rate limit hit — will retry on the next poll.')
      if (!res.ok && res.status !== 422) throw new Error(`Terminal49 ${res.status}: ${body?.errors?.[0]?.detail || body?.errors?.[0]?.title || res.statusText}`)
      return { status: res.status, body }
    }
    const state: Record<string, any> = { ...q.state }
    // 1. Open a tracking request once (by container number if we have it — that's the most reliable — else by booking number).
    if (!state.trackingRequestId && !state.shipmentId) {
      const scac = scacFor(q.line)
      const attributes: Any = { request_type: q.containerNumber ? 'container' : 'booking_number', request_number: q.containerNumber || q.bookingRef, ref_numbers: [q.ref], ...(scac ? { scac } : { auto_detect_vocc_scac: true }) }
      const { status, body } = await call('/tracking_requests', { method: 'POST', body: JSON.stringify({ data: { type: 'tracking_request', attributes } }) })
      if (status === 422) {
        // Usually "already being tracked" — find the existing shipment instead.
        const found = q.containerNumber ? await call(`/containers?filter[number]=${encodeURIComponent(q.containerNumber)}&include=shipment`) : await call(`/shipments?number=${encodeURIComponent(q.bookingRef)}`)
        const row = found.body?.data?.[0]
        if (!row) throw new Error(`Terminal49: ${body?.errors?.[0]?.detail || 'could not open a tracking request'}`)
        if (row.type === 'container') { state.containerId = row.id; state.shipmentId = row.relationships?.shipment?.data?.id } else state.shipmentId = row.id
      } else {
        state.trackingRequestId = body.data.id
        const tracked = body.data.relationships?.tracked_object?.data; if (tracked?.type === 'shipment') state.shipmentId = tracked.id
      }
    }
    // 2. Wait for the line's manifest to land at Terminal49.
    if (!state.shipmentId) {
      const { body } = await call(`/tracking_requests/${state.trackingRequestId}`)
      const a = body.data?.attributes ?? {}; const tracked = body.data?.relationships?.tracked_object?.data
      if (a.status === 'failed' || a.status === 'tracking_stopped') throw new Error(`Terminal49 could not track this booking (${a.failed_reason || a.status}). Check the booking reference and shipping line.`)
      if (tracked?.type === 'shipment') state.shipmentId = tracked.id
      else return { containers: [], events: [], state }
    }
    // 3. Shipment + containers.
    const { body: sh } = await call(`/shipments/${state.shipmentId}?include=containers`)
    const a = sh.data?.attributes ?? {}
    const boxes: Any[] = (sh.included ?? []).filter((x: Any) => x.type === 'container')
    const mine = boxes.find((b) => q.containerNumber && b.attributes?.number === q.containerNumber) ?? boxes.find((b) => b.id === state.containerId) ?? boxes[0]
    if (mine) state.containerId = mine.id
    const out: CarrierSnapshot = {
      containers: boxes.map((b) => ({ number: b.attributes?.number, seal: b.attributes?.seal_number || undefined })).sort((x) => (mine && x.number === mine.attributes?.number ? -1 : 1)),
      vesselName: a.pod_vessel_name || undefined, imo: a.pod_vessel_imo ? String(a.pod_vessel_imo) : undefined, voyage: a.pod_voyage_number || undefined,
      etd: (a.pol_atd_at || a.pol_etd_at || '').slice(0, 10) || undefined, eta: (a.pod_ata_at || a.pod_eta_at || '').slice(0, 10) || undefined,
      events: [], state,
    }
    // 4. Milestones for our box, with the vessel (name, IMO, MMSI) alongside.
    if (mine) {
      const { body: ev } = await call(`/containers/${mine.id}/transport_events?include=vessel&page[size]=100`)
      const vessels = new Map<string, Any>((ev.included ?? []).filter((x: Any) => x.type === 'vessel').map((v: Any) => [v.id, v.attributes ?? {}]))
      for (const e of ev.data ?? []) {
        const at = e.attributes?.timestamp; const code = t49Events[e.attributes?.event]; if (!code || !at) continue
        const v = vessels.get(e.relationships?.vessel?.data?.id)
        if (v && (code === 'DEPARTED' || code === 'LOADED')) { out.vesselName = v.name || out.vesselName; if (v.imo) out.imo = String(v.imo); if (v.mmsi) out.mmsi = String(v.mmsi) }
        out.events.push({ code, at, place: e.attributes?.location_locode || '', vesselName: v?.name, voyage: e.attributes?.voyage_number || undefined, note: e.attributes?.data_source ? `source: ${e.attributes.data_source}` : undefined })
      }
      out.events.sort((x, y) => x.at.localeCompare(y.at))
      if (!out.mmsi) { const v = [...vessels.values()].find((x) => x.name === out.vesselName || (out.imo && String(x.imo) === out.imo)); if (v?.mmsi) out.mmsi = String(v.mmsi) }
    }
    return out
  },
}

/* ---------------------------------------------------------------- registry */
const adapters: Record<string, CarrierAdapter> = { mock, dcsa, terminal49 }
export function carrierAdapter(): CarrierAdapter | null {
  const id = (process.env.CARRIER_TRACKING_PROVIDER || (process.env.TERMINAL49_API_KEY ? 'terminal49' : 'mock')).toLowerCase()
  if (id === 'off' || id === 'none' || id === 'false') return null
  const a = adapters[id]; if (!a) { console.warn(`[carriers] unknown CARRIER_TRACKING_PROVIDER "${id}" — tracking off`); return null }
  return a
}
