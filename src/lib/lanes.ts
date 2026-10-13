import { api } from './store'

export interface Benchmark {
  sample: { quotes: number; shippers: number; requests: number; delivered: number }
  price: { p25: number | null; median: number | null; p75: number | null; min: number | null; max: number | null }
  transit: { quotedMedian: number | null; quotedP25: number | null; quotedP75: number | null; actualMedian: number | null }
  demand: { weeks: string[]; series: number[]; recent4: number; prior4: number; trendPct: number }
  winRate: { overall: number | null; decided: number; belowMedian: { n: number; winRate: number | null }; aboveMedian: { n: number; winRate: number | null }; aboveP75: { n: number; winRate: number | null } }
}
export interface TopLane { origin: string; destination: string; destinationName: string; cargo: string; cargoLabel: string; requests: number; shippers: number; median: number | null; quotes: number }
export interface MyLane { origin: string; destination: string; destinationName: string; cargo: string; cargoLabel: string; quotes: number; won: number; decided: number; myWinRate: number | null; myMedian: number | null; myAvgTransit: number | null; responseHours: number | null; market: Benchmark; vsMarketPct: number | null; tip: string }
export const lanesApi = {
  benchmark: (q: { origin?: string; destination?: string; cargo?: string; mode?: string }) => { const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]); return api<{ benchmark: Benchmark }>(`/lanes/benchmark?${p}`).then((r) => r.benchmark) },
  top: () => api<{ lanes: TopLane[] }>('/lanes/top').then((r) => r.lanes),
  mine: () => api<{ lanes: MyLane[]; opportunities: TopLane[]; top: TopLane[]; served: { origins: string[]; destinations: string[]; cargo: string[] } }>('/shipper/lanes'),
}
