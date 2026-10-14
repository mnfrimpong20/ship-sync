import { api } from './store'

export interface Kpi { value: number | null; prev: number | null; delta: number | null; unit: 'pct' | 'pts' }
export interface RateRow { key: string; label: string; quoted: number; won: number; winRate: number | null }
export interface SegRow { key: string; label: string; requests: number; quoted: number; won: number; winRate: number | null; avgQuote: number | null; priceGapPct: number | null; value: number }
export interface Insight { id: string; tone: 'good' | 'warning' | 'critical' | 'info'; area: 'sales' | 'operations' | 'finance' | 'customers'; title: string; body: string; action?: { label: string; to: string } }

export interface Sales {
  kpis: { requests: Kpi; quoted: Kpi; quoteRate: Kpi; won: Kpi; winRate: Kpi; bookedValue: Kpi; avgDeal: Kpi; responseMedianH: Kpi; responseP90H: number | null; within2hPct: Kpi }
  funnel: { key: string; label: string; n: number }[]
  missed: number; missedValue: number | null
  series: { start: string; requests: number; quoted: number; won: number; value: number; winRate: number | null }[]
  byLane: SegRow[]; byCargo: SegRow[]; bySource: SegRow[]
  bySpeed: RateRow[]; byPrice: RateRow[]; byKind: RateRow[]
  weekday: { day: string; requests: number; medianH: number | null }[]
  lossReasons: { reason: string; n: number }[]
}
export interface Operations {
  kpis: { booked: Kpi; delivered: Kpi; onTimePct: Kpi; avgLateDays: number | null; doorToDoorDays: Kpi; doorToDoorP90: number | null; active: number; late: number; quiet: number; cancelled: number }
  series: { start: string; booked: number; delivered: number; onTime: number; onTimePct: number | null }[]
  stages: { key: string; label: string; n: number; medianDays: number | null; p90Days: number | null; platformMedianDays: number | null }[]
  byLane: { label: string; delivered: number; onTimePct: number | null; medianDays: number }[]
  board: { status: string; label: string; n: number; avgAgeDays: number | null }[]
  runs: { runs: number; stops: number; done: number; skipped: number; completionPct: number | null; stopsPerRun: number | null; kmPerStop: number | null; km: number }
  drivers: { name: string; runs: number; stops: number; done: number; skipped: number; km: number; completionPct: number | null }[]
  skipReasons: { reason: string; n: number }[]
  pickups: { requested: number; confirmed: number; cancelled: number; onRunPct: number | null }
  containers: { count: number; shipped: number; avgShipments: number | null }
  warehouse: { received: number; inYard: number; avgDwellDays: number | null }
  exceptions: { disputes: number; disputesPrev: number; disputeRatePct: number | null; cancelled: number; skippedStops: number; lateDeliveries: number }
}
export interface Finance {
  kpis: { invoiced: Kpi; collected: Kpi; collectionRatePct: Kpi; outstanding: number; overdue: number; overdueCount: number; dsoDays: Kpi; avgInvoice: number | null; revenuePerKg: number | null }
  series: { start: string; invoiced: number; collected: number }[]
  aging: { key: string; label: string; n: number; amount: number }[]
  byService: { label: string; amount: number; sharePct: number | null }[]
  byLane: { label: string; revenue: number; shipments: number; perShipment: number | null; perKg: number | null }[]
  topClients: { id: string; name: string; revenue: number; outstanding: number; invoices: number; lastAt: string | null }[]
  owing: { id: string; name: string; outstanding: number }[]
  concentrationPct: number | null
  methods: { method: string; amount: number }[]
  escrow: { held: number; released: number }
  insurance: { policies: number; commission: number }
}
export interface Customers {
  kpis: { active: Kpi; new: number; returning: number; repeatRatePct: number | null; shipmentsPerClient: number | null; rating: Kpi; reviews: number; lifetimeClients: number }
  ratingDist: { star: number; n: number }[]
  tags: { tag: string; n: number }[]
  ratingSeries: { start: string; reviews: number; avg: number | null }[]
  dormant: { id: string; name: string; shipments: number; lastAt: string; revenue12m: number; isClient: boolean }[]
  wonBySource: { source: string; n: number }[]
}
export interface Analytics {
  period: { days: number; from: string; to: string; prevFrom: string; bucket: 'week' | 'month' }
  filters: { origin: string | null; cargo: string | null; origins: string[]; cargos: string[] }
  access: { sales: boolean; operations: boolean; finance: boolean; customers: boolean }
  sales: Sales | null; operations: Operations | null; finance: Finance | null; customers: Customers | null
  insights: Insight[]
  locked?: boolean
  targets: { month: string; dayOfMonth: number; daysInMonth: number; canEdit: boolean; rows: { key: string; label: string; target: number | null; actual: number | null; projected: number | null; unit: '' | '$' | '%'; status: 'unset' | 'achieved' | 'on_track' | 'close' | 'behind'; pct: number | null }[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profit: Record<string, any> | null
  forecast: { history: { start: string; requests: number; forecast: number }[]; next: { start: string; requests: number; forecast: number }[]; last8: number; next8: number; changePct: number | null; expectedBookings: number; lanes: { label: string; last8: number; next8: number; changePct: number | null }[]; seasonal: boolean } | null
  team: { id: string; name: string; role: string; quotes: number; won: number; winRate: number | null; replyMedianH: number | null; scans: number; stopsDone: number; stopsMissed: number; completionPct: number | null; lastActive: string | null; you: boolean }[]
  teamIsManager: boolean
  standing: { score: number | null; tier: string; standing: string; note: string; metrics: Record<string, number | null>; computedAt: string; rank: number | null; of: number | null } | null
}

export const analyticsApi = {
  get: (q: { days: number; origin?: string; cargo?: string }) => {
    const p = new URLSearchParams({ days: String(q.days) }); if (q.origin) p.set('origin', q.origin); if (q.cargo) p.set('cargo', q.cargo)
    return api<Analytics>(`/shipper/analytics?${p}`)
  },
}

/** Rows → CSV text (RFC 4180 quoting). */
export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]); const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n')
}
export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
