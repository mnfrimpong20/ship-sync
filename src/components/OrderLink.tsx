import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { Check, Copy, Link2, MessageCircle, QrCode } from 'lucide-react'
import { api } from '../lib/store'

interface OrderLink { url: string; slug: string; shipperName: string; viaLink: number; viaLink30: number; brandedEnabled: boolean; brandedUrl: string | null }

/** "Your order link" — the one URL a shipper gives customers so orders come straight to them. */
export function OrderLinkCard({ compact = false }: { compact?: boolean }) {
  const [d, setD] = useState<OrderLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => { api<OrderLink>('/shipper/order-link').then(setD).catch(() => {}) }, [])
  useEffect(() => { if (d && !compact) QRCode.toDataURL(d.url, { margin: 1, width: 180, color: { dark: '#1a1a1a', light: '#ffffff' } }).then(setQr).catch(() => {}) }, [d, compact])
  if (!d) return null
  const copy = async () => { try { await navigator.clipboard.writeText(d.url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt('Copy this link', d.url) } }
  const text = `Order your shipment with ${d.shipperName} here: ${d.url}`
  return (
    <div className="card-dark p-5" data-testid="order-link-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="flex items-center gap-2 !text-base"><Link2 size={16} className="text-gold" aria-hidden="true" /> Your order link</h2><p className="mt-1 text-sm text-text-muted">Give this to your customers — orders through it come only to you{d.viaLink ? ` · ${d.viaLink30} in the last 30 days, ${d.viaLink} all time` : ''}.</p></div>
      </div>
      <div className="mt-3 flex items-center gap-2"><input readOnly className="input-dark !min-h-10 flex-1 font-mono text-xs" value={d.url} onFocus={(e) => e.currentTarget.select()} data-testid="order-link-url" /><button onClick={copy} className="btn-gold !min-h-10 text-sm" data-testid="order-link-copy">{copied ? <><Check size={15} aria-hidden="true" /> Copied</> : <><Copy size={15} aria-hidden="true" /> Copy</>}</button></div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="btn-ghost !min-h-9 text-xs"><MessageCircle size={14} aria-hidden="true" /> Share on WhatsApp</a>
        <a href={d.url} target="_blank" rel="noreferrer" className="btn-ghost !min-h-9 text-xs">Preview</a>
        {!compact && qr && <a href={qr} download={`${d.slug}-order-qr.png`} className="btn-ghost !min-h-9 text-xs"><QrCode size={14} aria-hidden="true" /> Download QR</a>}
      </div>
      {!compact && qr && <div className="mt-3 flex items-center gap-4"><img src={qr} alt="QR code for your order link" className="h-24 w-24 rounded-lg border border-border bg-white p-1" /><p className="text-xs text-text-muted">Print it on flyers, barrels and your office window. Customers scan, fill in the form, and the order lands in your Leads with their recipient details.{d.brandedEnabled ? <> Your full branded page is at <a href={d.brandedUrl!} target="_blank" rel="noreferrer" className="text-gold hover:underline">{d.brandedUrl}</a>.</> : <> Want your own logo and colours on it? <Link to="/dashboard/brand" className="text-gold hover:underline">Set up a branded page</Link>.</>}</p></div>}
    </div>
  )
}
