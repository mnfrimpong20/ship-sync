import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Circle, Search } from 'lucide-react'
import { platformApi } from '../lib/platform'

/** The embeddable tracking box shippers put on their own website (iframe / widget.js). Only finds that shipper's shipments. */
export default function EmbedTrack() {
  const { id = '' } = useParams()
  const [brand, setBrand] = useState<Awaited<ReturnType<typeof platformApi.widget>> | null>(null)
  const [ref, setRef] = useState(''); const [res, setRes] = useState<Record<string, any> | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false) // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => { platformApi.widget(id).then(setBrand).catch((e) => setErr(e.message)) }, [id])
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); setRes(null); try { setRes(await platformApi.widgetTrack(id, ref.trim())) } catch (x) { setErr(x instanceof Error ? x.message : 'Not found.') } finally { setBusy(false) } }
  const color = brand?.color ?? '#F2A900'
  return (
    <div className="min-h-screen bg-white p-4 font-sans text-[#14213D]" data-testid="embed-track">
      <div className="mx-auto max-w-md rounded-2xl border border-[#E3DED3] p-4">
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: color }}>{brand?.initials ?? '··'}</span><p className="font-semibold">{brand ? `Track your ${brand.name} shipment` : 'Track your shipment'}</p></div>
        <form onSubmit={go} className="mt-3 flex gap-2"><label className="sr-only" htmlFor="emb-ref">Tracking reference</label><input id="emb-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NT-AB12CD" className="min-h-11 flex-1 rounded-xl border border-[#E3DED3] px-3 uppercase outline-none focus:border-[#14213D]" required data-testid="embed-ref" /><button disabled={busy || !brand} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-4 font-semibold text-white" style={{ background: color }} data-testid="embed-go"><Search size={15} aria-hidden="true" /> Track</button></form>
        {err && <p role="alert" className="mt-3 text-sm text-[#C03A3A]">{err}</p>}
        {res && <div className="mt-4" data-testid="embed-result">
          <p className="text-lg font-bold">{res.statusLabel}</p><p className="text-sm text-[#5B6578]">{res.ref} · {String(res.origin).split(',')[0]} → {res.destination}{res.eta ? ` · ETA ${new Date(res.eta + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}{res.vessel ? ` · ${res.vessel}` : ''}</p>
          <ol className="mt-3 space-y-2">{(res.events as { status: string; label: string; at: string; place: string }[]).map((e, i, a) => <li key={i} className="flex gap-2 text-sm">{i === a.length - 1 ? <CheckCircle2 size={16} style={{ color }} aria-hidden="true" /> : <Circle size={16} className="text-[#C9C2B4]" aria-hidden="true" />}<span><b>{e.label}</b> <span className="text-[#5B6578]">{new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{e.place ? ` · ${e.place}` : ''}</span></span></li>)}</ol>
        </div>}
        <p className="mt-4 text-center text-[11px] text-[#5B6578]">Tracking by Ntemtem</p>
      </div>
    </div>
  )
}
