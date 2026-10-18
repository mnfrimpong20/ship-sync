import { api } from './store'

export type Category = 'printer' | 'scanner' | 'labels' | 'kit' | 'accessory' | 'packing'
export type Mode = 'buy' | 'rent' | 'included'
export type PlanKey = 'starter' | 'pro' | 'enterprise'
export interface Product {
  id: string; sku: string; name: string; category: Category; blurb: string; specs: string[]
  priceUsd: number; rentUsd: number | null; stock: number; available: number; reorderLevel: number; low: boolean; labelsPerUnit: number
  kit: { productId: string; qty: number; name: string }[]; includedWith: PlanKey[]; active: boolean; sort: number
  includedNow?: boolean; includedClaimed?: boolean
  audience?: 'shipper' | 'customer'; packingKind?: PackingKind | null
}
export type OrderStatus = 'awaiting_payment' | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled'
export interface Address { name: string; company: string; line1: string; line2: string; city: string; state: string; zip: string; country: string; phone: string }
export interface Order {
  id: string; ref: string; shipperId: string; shipperName?: string; placedBy: string; status: OrderStatus; provider: 'stripe' | 'manual' | 'included'
  subtotalUsd: number; shippingUsd: number; totalUsd: number; monthlyUsd: number; shipTo: Partial<Address>; carrier: string; tracking: string; note: string
  createdAt: string | null; paidAt: string | null; shippedAt: string | null; deliveredAt: string | null; cancelledAt: string | null
  items: { productId: string; name: string; qty: number; mode: Mode; unitUsd: number }[]
  kind?: 'shipper' | 'customer'; shipmentId?: string | null; shipmentRef?: string | null; customerName?: string
}
export interface Rental {
  id: string; shipperId: string; shipperName?: string; productId: string; productName: string; orderId: string | null; orderRef: string | null
  qty: number; mode: 'rent' | 'included'; monthlyUsd: number; status: 'pending' | 'active' | 'return_requested' | 'returned' | 'cancelled'; note: string
  startedAt: string | null; returnRequestedAt: string | null; returnedAt: string | null
}
export interface LabelOutlook { printed30: number; perWeek: number; remaining: number | null; weeksLeft: number | null; reorder: boolean }
export interface StoreView {
  products: Product[]; plan: { plan: PlanKey; trial: boolean }; online: boolean; mode: 'off' | 'test' | 'live'; canOrder: boolean
  shipping: { flatUsd: number; freeOverUsd: number }; orders: Order[]; rentals: Rental[]; labels: LabelOutlook
}
export interface AdminView {
  products: Product[]; orders: Order[]; rentals: Rental[]
  moves: { productName: string; delta: number; reason: string; ref: string; by: string; at: string }[]
  stats: { salesMonthUsd: number; rentalMrrUsd: number; openOrders: number; lowStock: number; returnsDue: number }
}
export interface ProductInput { audience: 'shipper' | 'customer'; packingKind: PackingKind | null; name: string; sku: string; category: Category; blurb: string; specs: string[]; priceUsd: number; rentUsd: number | null; reorderLevel: number; labelsPerUnit: number; kit: { productId: string; qty: number }[]; includedWith: PlanKey[]; active: boolean; sort: number }

export type { PackingKind } from './store'
import type { PackingKind, SupplyAddress } from './store'
export interface PackingItem { id: string; name: string; kind: PackingKind; note: string; priceUsd: number; active: boolean }
export interface PackingInput { name: string; kind: PackingKind; note: string; priceUsd: number; active: boolean }
export interface ShipmentSupplyLine { id: string; supplyId: string | null; productId: string | null; source: 'shipper' | 'ntemtem'; name: string; qty: number; unitUsd: number; status: 'due' | 'paid'; addedBy: string }
export interface NtemtemPackingItem { id: string; name: string; kind: PackingKind; blurb: string; priceUsd: number; available: number }
export interface ShipmentSupplies { catalog: PackingItem[]; ntemtem: NtemtemPackingItem[]; lines: ShipmentSupplyLine[]; address: SupplyAddress | null; orders: { ref: string; status: OrderStatus; carrier: string; tracking: string }[]; editable: boolean; isOffice: boolean }

export const categoryLabels: Record<Category, string> = { kit: 'Kits', printer: 'Printers', scanner: 'Scanners', labels: 'Labels', accessory: 'Accessories', packing: 'Packing (for customers)' }
export const orderStatusLabels: Record<OrderStatus, string> = { awaiting_payment: 'Awaiting payment', paid: 'Paid — preparing', packed: 'Packed', shipped: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' }
export const rentalStatusLabels: Record<Rental['status'], string> = { pending: 'Starts when paid', active: 'With you', return_requested: 'Return requested', returned: 'Returned', cancelled: 'Cancelled' }
export const packingKindLabels: Record<PackingKind, string> = { barrel: 'Barrel', box: 'Box', lock: 'Lock & seal', tape: 'Tape', other: 'Other' }
export const planLabel = (p: PlanKey) => ({ starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' })[p]
/** Fired when packing supplies on a shipment change, so the payment card reloads its total. */
export const PAYMENT_REFRESH = 'ss:payment-refresh'

export const suppliesApi = {
  catalog: () => api<{ products: Pick<Product, 'id' | 'name' | 'category' | 'blurb' | 'specs' | 'priceUsd' | 'rentUsd' | 'includedWith'>[] }>('/supplies/catalog').then((r) => r.products),
  store: () => api<StoreView>('/supplies'),
  checkout: (b: { items: { productId: string; qty: number; mode: Mode }[]; shipTo: Address; note: string }) => api<{ orderId: string; ref: string; url: string | null; status: OrderStatus }>('/supplies/checkout', { json: b }),
  verify: (id: string) => api<{ order: Order }>(`/supplies/orders/${id}/verify`, { json: {} }),
  cancel: (id: string) => api<{ ok: true }>(`/supplies/orders/${id}/cancel`, { json: {} }),
  returnRental: (id: string) => api<{ ok: true }>(`/supplies/rentals/${id}/return`, { json: {} }),
  admin: () => api<AdminView>('/admin/supplies'),
  createProduct: (b: ProductInput) => api<{ id: string }>('/admin/supplies/products', { json: b }),
  updateProduct: (id: string, b: ProductInput) => api<{ ok: true }>(`/admin/supplies/products/${id}`, { method: 'PATCH', json: b }),
  stock: (id: string, delta: number, note: string) => api<{ ok: true }>(`/admin/supplies/products/${id}/stock`, { json: { delta, note } }),
  orderAction: (id: string, action: 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancel', extra?: { carrier?: string; tracking?: string }) => api<{ ok: true }>(`/admin/supplies/orders/${id}`, { method: 'PATCH', json: { action, ...extra } }),
  rentalAction: (id: string, action: 'returned' | 'keep') => api<{ ok: true }>(`/admin/supplies/rentals/${id}`, { method: 'PATCH', json: { action } }),
  packingOptions: (shipperId?: string) => api<{ ntemtem: { id: string; name: string; kind: PackingKind; blurb: string; priceUsd: number; available: number }[]; shipper: PackingItem[] }>(`/supplies/packing${shipperId ? `?shipper=${encodeURIComponent(shipperId)}` : ''}`),
  publicPacking: (shipperId: string) => api<{ supplies: PackingItem[] }>(`/shippers/${shipperId}/supplies`).then((r) => r.supplies),
  myPacking: () => api<{ supplies: PackingItem[]; canEdit: boolean; sold90: { valueUsd: number; units: number }; toDeliver: { id: string; shipmentId: string; ref: string; customer: string; name: string; qty: number; status: 'due' | 'paid' }[] }>('/shipper/packing-supplies'),
  addPacking: (b: PackingInput) => api<{ id: string }>('/shipper/packing-supplies', { json: b }),
  savePacking: (id: string, b: PackingInput) => api<{ ok: true }>(`/shipper/packing-supplies/${id}`, { method: 'PATCH', json: b }),
  deletePacking: (id: string) => api<{ ok: true }>(`/shipper/packing-supplies/${id}`, { method: 'DELETE' }),
  forShipment: (id: string) => api<ShipmentSupplies>(`/shipments/${id}/supplies`),
  addToShipment: (id: string, item: { supplyId?: string; productId?: string }, qty: number) => api<ShipmentSupplies>(`/shipments/${id}/supplies`, { json: { ...item, qty } }),
  setSuppliesAddress: (id: string, a: SupplyAddress) => api<ShipmentSupplies>(`/shipments/${id}/supplies/address`, { method: 'PUT', json: a }),
  setLine: (id: string, line: string, qty: number) => api<ShipmentSupplies>(`/shipments/${id}/supplies/${line}`, { method: 'PATCH', json: { qty } }),
}
