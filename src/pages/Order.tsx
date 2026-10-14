import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/store'
import Quote, { type OrderShipper } from './Quote'

interface OrderPayload { shipper: OrderShipper; instantQuotes: boolean; brand: { logo: string; accent: string; phone: string; whatsapp: string; email: string; slug: string }; poweredBy: boolean }

/** A shipper's order link: the standard request form, locked to that one company. No setup needed on their side. */
export default function OrderPage() {
  const { code = '' } = useParams()
  const [d, setD] = useState<OrderPayload | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<OrderPayload>(`/order/${encodeURIComponent(code)}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'Not found.')) }, [code])
  if (err) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center"><p className="text-danger">{err}</p><p className="mt-3 text-sm text-text-muted"><Link to="/quote" className="text-gold hover:underline">Request quotes from all shippers instead</Link></p></div></div>
  if (!d) return <div className="min-h-dvh bg-bg text-text"><div className="container-x py-24 text-center text-text-muted">Loading…</div></div>
  return (
    <div className="min-h-dvh bg-bg text-text" data-testid="order-page">
      <header className="border-b border-border bg-surface/60">
        <div className="container-x flex min-h-14 flex-wrap items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-3">{d.brand.logo ? <img src={d.brand.logo} alt={d.shipper.name} className="h-8 w-auto" /> : <span className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-on-accent" style={{ background: d.shipper.hue }}>{d.shipper.initials}</span>}<span className="font-semibold">{d.shipper.name}</span><span className="text-xs text-text-muted">· order form</span></div>
          <div className="flex items-center gap-3 text-xs text-text-muted">{d.brand.whatsapp && <a href={`https://wa.me/${d.brand.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="hover:text-gold">WhatsApp</a>}{d.brand.phone && <a href={`tel:${d.brand.phone}`} className="hover:text-gold">{d.brand.phone}</a>}<a href="/#/" className="inline-flex items-center gap-1 hover:text-gold">Powered by <span className="font-heading font-bold text-text">Ship<span className="text-gold">Sync</span></span></a></div>
        </div>
      </header>
      <Quote locked={{ shipper: d.shipper, instantQuotes: d.instantQuotes }} />
    </div>
  )
}
