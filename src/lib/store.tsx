import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { shippers as seedShippers, type CargoType, type Mode, type Shipment, type Shipper } from './data'
import type { PositionPayload } from '../components/LiveMap'

export type Role = 'customer' | 'shipper'
export interface User { id: string; name: string; email: string; role: Role; company?: string; shipperId?: string; admin?: boolean; staffRole?: 'owner' | 'dispatcher' | 'agent' | 'driver' }
export type ShipperProfileInput = Pick<Shipper, 'name' | 'tagline' | 'hq' | 'founded' | 'modes' | 'destinations' | 'origins' | 'cargo' | 'services' | 'about' | 'priceIndex' | 'responseHours'>
export type AdminShipper = Shipper & { owner: { email: string; name: string } | null; quoteCount: number; shipmentCount: number }

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
  /** Shipper view only: number of quotes from other companies (prices hidden). */
  competingQuotes?: number
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

export type Match = { shipper: Shipper; score: number; reasons: string[] }
export type NewRequest = Omit<QuoteRequest, 'id' | 'ref' | 'createdAt' | 'status' | 'quotes' | 'competingQuotes'> & { password?: string }

interface Store {
  ready: boolean
  user: User | null
  shippers: Shipper[]
  requests: QuoteRequest[]
  shipments: Shipment[]
  shipperById: (id: string) => Shipper | undefined
  login: (email: string, password: string) => Promise<User>
  signup: (u: { name: string; email: string; password: string; role: Role; company?: string }) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  createRequest: (r: NewRequest) => Promise<QuoteRequest>
  acceptQuote: (requestId: string, quoteId: string) => Promise<Shipment>
  sendQuote: (requestId: string, q: { price: number; transitDays: number; notes: string; includes: string[] }) => Promise<void>
  advanceShipment: (id: string, note?: string) => Promise<void>
  matchShippers: (r: Pick<QuoteRequest, 'origin' | 'destination' | 'mode' | 'cargo'>) => Promise<Match[]>
  track: (ref: string) => Promise<Shipment | null>
  position: (ref: string) => Promise<PositionPayload | null>
  setTransit: (id: string, t: { vesselName?: string; mmsi?: string; flight?: string }) => Promise<void>
  updateShipper: (p: ShipperProfileInput) => Promise<Shipper>
  adminShippers: () => Promise<AdminShipper[]>
  adminVerify: (id: string, v: { verified: boolean; plan?: Shipper['plan'] }) => Promise<Shipper>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers: { ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status}).`)
  return data as T
}

const StoreCtx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [shippers, setShippers] = useState<Shipper[]>(seedShippers)
  const [requests, setRequests] = useState<QuoteRequest[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])

  const loadPrivate = useCallback(async (u: User | null) => {
    if (!u) { setRequests([]); setShipments([]); return }
    const [r, s] = await Promise.all([api<{ requests: QuoteRequest[] }>('/requests'), api<{ shipments: Shipment[] }>('/shipments')])
    setRequests(r.requests); setShipments(s.shipments)
  }, [])

  const refresh = useCallback(async () => {
    const [{ user: u }, { shippers: sh }] = await Promise.all([api<{ user: User | null }>('/auth/me'), api<{ shippers: Shipper[] }>('/shippers')])
    setUser(u); setShippers(sh)
    await loadPrivate(u)
  }, [loadPrivate])

  useEffect(() => { refresh().catch(() => {}).finally(() => setReady(true)) }, [refresh])

  const shipperById = useCallback((id: string) => shippers.find((s) => s.id === id), [shippers])

  const login = useCallback<Store['login']>(async (email, password) => {
    const { user: u } = await api<{ user: User }>('/auth/login', { json: { email, password } })
    setUser(u); await loadPrivate(u); return u
  }, [loadPrivate])

  const signup = useCallback<Store['signup']>(async (input) => {
    const { user: u } = await api<{ user: User }>('/auth/signup', { json: input })
    setUser(u)
    const { shippers: sh } = await api<{ shippers: Shipper[] }>('/shippers'); setShippers(sh)
    await loadPrivate(u); return u
  }, [loadPrivate])

  const logout = useCallback(async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setRequests([]); setShipments([]) }, [])

  const matchShippers = useCallback<Store['matchShippers']>(async (r) => (await api<{ matches: Match[] }>('/match', { json: { origin: r.origin, destination: r.destination, mode: r.mode, cargo: r.cargo } })).matches, [])

  const createRequest = useCallback<Store['createRequest']>(async (r) => {
    const { request, user: u } = await api<{ request: QuoteRequest; user: User }>('/requests', { json: r })
    if (!user) { setUser(u); await loadPrivate(u) } else setRequests((prev) => [request, ...prev])
    return request
  }, [user, loadPrivate])

  const acceptQuote = useCallback<Store['acceptQuote']>(async (_requestId, quoteId) => {
    const { shipment, request } = await api<{ shipment: Shipment; request: QuoteRequest }>(`/quotes/${quoteId}/accept`, { method: 'POST' })
    setRequests((prev) => prev.map((x) => (x.id === request.id ? request : x)))
    setShipments((prev) => [shipment, ...prev])
    return shipment
  }, [])

  const sendQuote = useCallback<Store['sendQuote']>(async (requestId, q) => {
    await api(`/requests/${requestId}/quotes`, { json: q })
    const r = await api<{ requests: QuoteRequest[] }>('/requests'); setRequests(r.requests)
  }, [])

  const advanceShipment = useCallback<Store['advanceShipment']>(async (id, note) => {
    const { shipment } = await api<{ shipment: Shipment }>(`/shipments/${id}/advance`, { json: { note } })
    setShipments((prev) => prev.map((s) => (s.id === id ? shipment : s)))
  }, [])

  const track = useCallback<Store['track']>(async (ref) => {
    try { return (await api<{ shipment: Shipment }>(`/track/${encodeURIComponent(ref.trim())}`)).shipment } catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
  }, [])

  const position = useCallback<Store['position']>(async (ref) => {
    try { return (await api<{ position: PositionPayload }>(`/track/${encodeURIComponent(ref.trim())}/position`)).position } catch { return null }
  }, [])

  const setTransit = useCallback<Store['setTransit']>(async (id, t) => {
    const { shipment } = await api<{ shipment: Shipment }>(`/shipments/${id}/transit`, { json: t })
    setShipments((prev) => prev.map((s) => (s.id === id ? shipment : s)))
  }, [])

  const updateShipper = useCallback<Store['updateShipper']>(async (p) => {
    const { shipper, user: u } = await api<{ shipper: Shipper; user: User }>('/shippers/me', { method: 'PATCH', json: p })
    setShippers((prev) => prev.map((s) => (s.id === shipper.id ? shipper : s)))
    setUser(u)
    return shipper
  }, [])
  const adminShippers = useCallback<Store['adminShippers']>(async () => (await api<{ shippers: AdminShipper[] }>('/admin/shippers')).shippers, [])
  const adminVerify = useCallback<Store['adminVerify']>(async (id, v) => {
    const { shipper } = await api<{ shipper: Shipper }>(`/admin/shippers/${id}/verify`, { json: v })
    setShippers((prev) => prev.map((s) => (s.id === shipper.id ? shipper : s)))
    return shipper
  }, [])

  const value = useMemo<Store>(() => ({ ready, user, shippers, requests, shipments, shipperById, login, signup, logout, refresh, createRequest, acceptQuote, sendQuote, advanceShipment, matchShippers, track, position, setTransit, updateShipper, adminShippers, adminVerify }),
    [ready, user, shippers, requests, shipments, shipperById, login, signup, logout, refresh, createRequest, acceptQuote, sendQuote, advanceShipment, matchShippers, track, position, setTransit, updateShipper, adminShippers, adminVerify])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}
