import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sampleShipments, shippers, type CargoType, type Mode, type Shipment, type Shipper } from './data'

export type Role = 'customer' | 'shipper'
export interface User { id: string; name: string; email: string; role: Role; company?: string; shipperId?: string }

export interface QuoteRequest {
  id: string
  ref: string
  createdAt: string
  origin: string
  destination: string
  mode: Mode | 'either'
  cargo: CargoType
  quantity: number
  weightKg?: number
  description: string
  pickup: boolean
  delivery: boolean
  insurance: boolean
  readyDate: string
  contact: { name: string; email: string; phone: string }
  status: 'open' | 'booked' | 'closed'
  quotes: Quote[]
}

export interface Quote {
  id: string
  shipperId: string
  price: number
  currency: 'USD'
  transitDays: number
  validUntil: string
  notes: string
  includes: string[]
  status: 'sent' | 'accepted' | 'declined'
  sentAt: string
}

interface State { user: User | null; requests: QuoteRequest[]; shipments: Shipment[] }

interface Store extends State {
  login: (email: string, role: Role) => User
  signup: (u: Omit<User, 'id'>) => User
  logout: () => void
  createRequest: (r: Omit<QuoteRequest, 'id' | 'ref' | 'createdAt' | 'status' | 'quotes'>) => QuoteRequest
  acceptQuote: (requestId: string, quoteId: string) => Shipment
  sendQuote: (requestId: string, q: Omit<Quote, 'id' | 'status' | 'sentAt'>) => void
  advanceShipment: (id: string) => void
  matchShippers: (r: Pick<QuoteRequest, 'origin' | 'destination' | 'mode' | 'cargo'>) => { shipper: Shipper; score: number; reasons: string[] }[]
}

const KEY = 'shipsync:v2'
const StoreCtx = createContext<Store | null>(null)

const uid = () => Math.random().toString(36).slice(2, 10)
const ref = () => 'SS-' + Math.random().toString(36).slice(2, 8).toUpperCase()
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

function seedRequests(): QuoteRequest[] {
  const now = new Date()
  return [
    {
      id: 'r1', ref: 'SS-QT7A2M', createdAt: addDays(now, -3).toISOString(), origin: 'New York, NY', destination: 'GH', mode: 'ocean', cargo: 'barrels', quantity: 4, weightKg: 380,
      description: '4 sealed barrels — clothing, provisions, small appliances. Deliver to Kumasi.', pickup: true, delivery: true, insurance: true, readyDate: addDays(now, 7).toISOString().slice(0, 10),
      contact: { name: 'Demo Customer', email: 'customer@shipsync.demo', phone: '+1 917 555 0142' }, status: 'open',
      quotes: [
        { id: 'q1', shipperId: 'atlantic-bridge', price: 640, currency: 'USD', transitDays: 34, validUntil: addDays(now, 10).toISOString().slice(0, 10), notes: 'Sails Friday. Door delivery to Kumasi included; duty paid by consignee.', includes: ['Pickup', 'Ocean freight', 'Door delivery Kumasi', 'Insurance'], status: 'sent', sentAt: addDays(now, -2).toISOString() },
        { id: 'q2', shipperId: 'gold-coast-freight', price: 590, currency: 'USD', transitDays: 36, validUntil: addDays(now, 14).toISOString().slice(0, 10), notes: 'Pickup from NYC via partner truck. Kumasi delivery by our own van.', includes: ['Pickup', 'Ocean freight', 'Door delivery Kumasi'], status: 'sent', sentAt: addDays(now, -1).toISOString() },
      ],
    },
    {
      id: 'r2', ref: 'SS-QX2P9L', createdAt: addDays(now, -1).toISOString(), origin: 'Newark, NJ', destination: 'TG', mode: 'ocean', cargo: 'boxes', quantity: 9, weightKg: 210,
      description: '9 boxes of clothing and school supplies for a church in Lomé. Flexible on sailing date.', pickup: true, delivery: false, insurance: false, readyDate: addDays(now, 10).toISOString().slice(0, 10),
      contact: { name: 'Ama Lawson', email: 'ama.l@example.com', phone: '+1 973 555 0177' }, status: 'open', quotes: [],
    },
    {
      id: 'r3', ref: 'SS-MV4H7C', createdAt: addDays(now, -0.3).toISOString(), origin: 'Philadelphia, PA', destination: 'NG', mode: 'either', cargo: 'pallets', quantity: 2, weightKg: 640,
      description: '2 pallets of restaurant equipment (fryer, prep tables). Needs delivery to Lekki, Lagos.', pickup: true, delivery: true, insurance: true, readyDate: addDays(now, 5).toISOString().slice(0, 10),
      contact: { name: 'Chidi Okafor', email: 'chidi.o@example.com', phone: '+1 215 555 0133' }, status: 'open',
      quotes: [
        { id: 'q3', shipperId: 'naija-direct', price: 1180, currency: 'USD', transitDays: 31, validUntil: addDays(now, 12).toISOString().slice(0, 10), notes: 'Monthly ocean sailing; Lekki delivery by our Lagos team. Air option available on request.', includes: ['Pickup', 'Ocean freight', 'Door delivery', 'All-risk insurance'], status: 'sent', sentAt: addDays(now, -0.1).toISOString() },
      ],
    },
  ]
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch { /* ignore */ }
  return { user: null, requests: seedRequests(), shipments: sampleShipments }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ } }, [state])

  const login = useCallback((email: string, role: Role) => {
    const isShipper = role === 'shipper'
    const user: User = isShipper
      ? { id: uid(), name: 'Kwame Asante', email, role, company: 'Atlantic Bridge Logistics', shipperId: 'atlantic-bridge' }
      : { id: uid(), name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Customer', email, role }
    setState((s) => ({ ...s, user }))
    return user
  }, [])

  const signup = useCallback((u: Omit<User, 'id'>) => {
    const user: User = { ...u, id: uid(), shipperId: u.role === 'shipper' ? 'atlantic-bridge' : undefined }
    setState((s) => ({ ...s, user }))
    return user
  }, [])

  const logout = useCallback(() => setState((s) => ({ ...s, user: null })), [])

  const matchShippers = useCallback<Store['matchShippers']>((r) => {
    return shippers
      .map((shipper) => {
        const reasons: string[] = []
        let score = 0
        if (!shipper.destinations.includes(r.destination)) return { shipper, score: -1, reasons }
        score += 40; reasons.push('Serves this destination')
        if (r.mode !== 'either') { if (shipper.modes.includes(r.mode)) { score += 20; reasons.push(`Offers ${r.mode} freight`) } else return { shipper, score: -1, reasons } }
        else { score += 10 }
        if (shipper.cargo.includes(r.cargo)) { score += 20; reasons.push('Handles this cargo type') } else { score -= 30 }
        if (shipper.origins.includes(r.origin)) { score += 15; reasons.push('Regular pickups from your area') }
        else if (shipper.origins.some((o) => o.split(', ')[1] === r.origin.split(', ')[1])) { score += 6; reasons.push('Operates in your country') }
        if (shipper.verified) { score += 5; reasons.push('Verified') }
        score += shipper.rating * 2
        return { shipper, score, reasons }
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
  }, [])

  const createRequest = useCallback<Store['createRequest']>((r) => {
    const req: QuoteRequest = { ...r, id: uid(), ref: ref(), createdAt: new Date().toISOString(), status: 'open', quotes: [] }
    // Simulate shippers responding with quotes
    const matches = matchShippers(r).slice(0, 4)
    const base: Record<CargoType, number> = { barrels: 160, boxes: 95, pallets: 420, vehicle: 1650, container20: 3900, container40: 5600, commercial: 900 }
    const airMult = r.mode === 'air' ? 3.2 : 1
    req.quotes = matches.map((m, i) => {
      const priceIdx = [0.88, 1, 1.18][m.shipper.priceIndex - 1] ?? 1
      const qty = r.cargo.startsWith('container') || r.cargo === 'vehicle' ? Math.max(1, r.quantity) : Math.max(1, r.quantity)
      const price = Math.round(base[r.cargo] * qty * priceIdx * airMult + (r.pickup ? 60 : 0) + (r.delivery ? 90 : 0) + (r.insurance ? 45 : 0))
      const isAir = m.shipper.modes.includes('air') && r.mode !== 'ocean' && (r.mode === 'air' || !m.shipper.modes.includes('ocean'))
      const transitDays = isAir ? 4 + i : 30 + i * 2 + (m.shipper.priceIndex === 1 ? 3 : 0)
      return {
        id: uid(), shipperId: m.shipper.id, price, currency: 'USD', transitDays,
        validUntil: addDays(new Date(), 10).toISOString().slice(0, 10),
        notes: `${m.shipper.tagline}. ${r.delivery ? 'Door delivery included.' : 'Consignee collects at port/airport.'} Duty and destination taxes payable by consignee.`,
        includes: [r.pickup ? 'Pickup' : 'Drop-off at warehouse', isAir ? 'Air freight' : 'Ocean freight', r.delivery ? 'Door delivery' : 'Port handling', ...(r.insurance ? ['All-risk insurance'] : [])],
        status: 'sent', sentAt: new Date(Date.now() + (i + 1) * 3600000 * 2).toISOString(),
      }
    })
    setState((s) => ({ ...s, requests: [req, ...s.requests] }))
    return req
  }, [matchShippers])

  const acceptQuote = useCallback<Store['acceptQuote']>((requestId, quoteId) => {
    let created!: Shipment
    setState((s) => {
      const requests = s.requests.map((r) => {
        if (r.id !== requestId) return r
        return { ...r, status: 'booked' as const, quotes: r.quotes.map((q) => ({ ...q, status: q.id === quoteId ? 'accepted' as const : 'declined' as const })) }
      })
      const r = s.requests.find((x) => x.id === requestId)!
      const q = r.quotes.find((x) => x.id === quoteId)!
      const shipper = shippers.find((x) => x.id === q.shipperId)!
      const mode: Mode = q.includes.includes('Air freight') ? 'air' : 'ocean'
      created = {
        id: uid(), ref: r.ref.replace('SS-', 'SS-'), shipperId: shipper.id, mode, origin: r.origin, destination: r.destination, cargo: r.cargo,
        description: r.description || `${r.quantity} × ${r.cargo}`, status: 'booked', eta: addDays(new Date(), q.transitDays + 4).toISOString().slice(0, 10),
        customer: r.contact.name,
        events: [{ status: 'booked', at: new Date().toISOString(), place: r.origin, note: `Booking confirmed with ${shipper.name}. Quote ${q.id.toUpperCase()} accepted.` }],
      }
      return { ...s, requests, shipments: [created, ...s.shipments] }
    })
    return created
  }, [])

  const sendQuote = useCallback<Store['sendQuote']>((requestId, q) => {
    setState((s) => ({
      ...s,
      requests: s.requests.map((r) => r.id === requestId ? { ...r, quotes: [...r.quotes, { ...q, id: uid(), status: 'sent', sentAt: new Date().toISOString() }] } : r),
    }))
  }, [])

  const advanceShipment = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      shipments: s.shipments.map((sh) => {
        if (sh.id !== id) return sh
        const order = ['booked', 'picked_up', 'at_origin_port', 'in_transit', 'arrived', 'customs', 'out_for_delivery', 'delivered'] as const
        const idx = order.indexOf(sh.status)
        if (idx >= order.length - 1) return sh
        const next = order[idx + 1]
        return { ...sh, status: next, events: [...sh.events, { status: next, at: new Date().toISOString(), place: idx < 3 ? sh.origin : sh.destination }] }
      }),
    }))
  }, [])

  const value = useMemo<Store>(() => ({ ...state, login, signup, logout, createRequest, acceptQuote, sendQuote, advanceShipment, matchShippers }), [state, login, signup, logout, createRequest, acceptQuote, sendQuote, advanceShipment, matchShippers])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
