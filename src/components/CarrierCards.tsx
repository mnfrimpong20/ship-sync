import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Compass, Flag, Navigation, Plane, Ship, X } from 'lucide-react'
import type { LivePos } from './LiveMap'
import { Pill } from './ui'
import { compass, flagFromMmsi, formatEta, navStatusLabel, shipTypeLabel } from '../lib/ais'

export interface VesselDetail extends LivePos {
  id: string; callSign?: string; imo?: string; type?: number; destination?: string
  eta?: { month: number; day: number; hour: number; minute: number }
  length?: number; beam?: number; draught?: number; navStatus?: number
  firstSeen: { lat: number; lon: number; at: string } | null; watched: boolean
}
export interface Airport { icao: string; iata?: string; name: string; city?: string; country?: string; lat: number; lon: number }
export interface FlightDetail extends LivePos {
  id: string; callsign?: string; registration?: string; type?: string; description?: string; squawk?: string; category?: string
  cargo: boolean; onGround: boolean; vertRate?: number
  route: { origin: Airport; destination: Airport; via?: Airport[]; airline?: string; plausible: boolean } | null
}
export type CarrierDetail = ({ kind: 'vessel' } & VesselDetail) | ({ kind: 'flight' } & FlightDetail)

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return <div className="flex justify-between gap-3 py-1.5 text-sm"><dt className="shrink-0 text-text-muted">{label}</dt><dd className="text-right text-text">{value}</dd></div>
}

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 60 * 48 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`
}

/** Everything AIS tells us about one ship. AIS carries the *next* destination and ETA but never the port of origin, so
 *  "first seen" (where our feed first heard it) is the closest honest stand-in. */
export function VesselCard({ mmsi, v, err = '', onClose, footer, className = 'mb-4' }: { mmsi: string; v: VesselDetail | null; err?: string; onClose?: () => void; footer?: ReactNode; className?: string }) {
  const flag = flagFromMmsi(mmsi)
  const type = shipTypeLabel(v?.type)
  const status = navStatusLabel(v?.navStatus)
  const moving = (v?.speed ?? 0) >= 1
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`card-dark p-5 ${className}`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Vessel</p>
          <h2 className="!text-lg leading-tight">{v?.name || 'Unnamed vessel'}</h2>
          <p className="mt-1 text-xs text-text-muted">{[flag, type].filter(Boolean).join(' · ') || 'Awaiting static data'}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="focus-ring -mr-2 -mt-2 rounded-md p-2 text-text-muted hover:text-text" aria-label="Close vessel details"><X size={16} aria-hidden="true" /></button>}
      </div>
      {err && <p className="mt-3 text-xs text-danger">{err}</p>}
      {v && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone={moving ? 'teal' : 'muted'}><Navigation size={11} className="mr-1" aria-hidden="true" />{status ?? (moving ? 'Under way' : 'Stopped')}</Pill>
            {v.watched && <Pill tone="gold"><Ship size={11} className="mr-1" aria-hidden="true" />Carrying a Ship Sync shipment</Pill>}
          </div>
          <dl className="mt-3 divide-y divide-border">
            <Row label="Reported destination" value={v.destination} />
            <Row label="Reported ETA" value={formatEta(v.eta)} />
            <Row label="Speed" value={v.speed != null ? `${v.speed.toFixed(1)} kn` : undefined} />
            <Row label="Course" value={v.course != null ? `${Math.round(v.course)}° ${compass(v.course) ?? ''}` : undefined} />
            <Row label="Heading" value={v.heading != null ? `${Math.round(v.heading)}°` : undefined} />
            <Row label="Position" value={`${Math.abs(v.lat).toFixed(3)}° ${v.lat >= 0 ? 'N' : 'S'}, ${Math.abs(v.lon).toFixed(3)}° ${v.lon >= 0 ? 'E' : 'W'}`} />
            <Row label="Size" value={v.length ? `${v.length} m × ${v.beam ?? '?'} m` : undefined} />
            <Row label="Draught" value={v.draught ? `${v.draught} m` : undefined} />
            <Row label="MMSI" value={v.id} />
            <Row label="IMO" value={v.imo && v.imo !== '0' ? v.imo : undefined} />
            <Row label="Call sign" value={v.callSign} />
            <Row label="Last signal" value={ago(v.at)} />
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted"><Compass size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {v.firstSeen
              ? <span>Origin isn't broadcast by AIS — ships only report their next port. Our feed first heard this ship {ago(v.firstSeen.at)} at {Math.abs(v.firstSeen.lat).toFixed(2)}° {v.firstSeen.lat >= 0 ? 'N' : 'S'}, {Math.abs(v.firstSeen.lon).toFixed(2)}° {v.firstSeen.lon >= 0 ? 'E' : 'W'}.</span>
              : <span>Origin isn't broadcast by AIS — ships only report their next port.</span>}
          </p>
          {!v.destination && <p className="mt-2 flex items-start gap-2 text-xs text-text-muted"><Flag size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Destination, ETA and dimensions arrive with the ship's static broadcast (every 6 minutes) — check back shortly.</p>}
        </>
      )}
      {!v && !err && <p className="mt-3 text-xs text-text-muted">Loading…</p>}
      {footer}
    </motion.div>
  )
}

const airportLabel = (a: Airport) => `${a.city ?? a.name}${a.iata ? ` (${a.iata})` : ''}`

/** Everything public ADS-B tells us about one aircraft, plus adsbdb.com's route lookup (origin → destination). */
export function FlightCard({ f, err = '', onClose, footer, className = 'mb-4' }: { f: FlightDetail | null; err?: string; onClose?: () => void; footer?: ReactNode; className?: string }) {
  const climbing = (f?.vertRate ?? 0) > 300, descending = (f?.vertRate ?? 0) < -300
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`card-dark p-5 ${className}`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Aircraft</p>
          <h2 className="!text-lg leading-tight">{f?.callsign || f?.registration || 'Aircraft'}</h2>
          <p className="mt-1 text-xs text-text-muted">{[f?.route?.airline, f?.description ?? f?.type, f?.registration].filter(Boolean).join(' · ') || 'Awaiting identification'}</p>
        </div>
        {onClose && <button type="button" onClick={onClose} className="focus-ring -mr-2 -mt-2 rounded-md p-2 text-text-muted hover:text-text" aria-label="Close aircraft details"><X size={16} aria-hidden="true" /></button>}
      </div>
      {err && <p className="mt-3 text-xs text-danger">{err}</p>}
      {f && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone={f.cargo ? 'gold' : 'sky'}><Plane size={11} className="mr-1" aria-hidden="true" />{f.cargo ? 'Cargo flight' : 'Passenger / other'}</Pill>
            {f.onGround ? <Pill tone="muted">On the ground</Pill> : climbing ? <Pill tone="teal">Climbing</Pill> : descending ? <Pill tone="teal">Descending</Pill> : <Pill tone="teal">Cruising</Pill>}
          </div>
          {f.route ? (
            <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex items-center gap-2"><span className="text-text">{airportLabel(f.route.origin)}</span><ArrowRight size={14} className="shrink-0 text-gold" aria-hidden="true" /><span className="text-text">{airportLabel(f.route.destination)}</span></div>
              <p className="mt-1 text-xs text-text-muted">{f.route.origin.name} → {f.route.destination.name}{f.route.via?.length ? ` via ${f.route.via.map(airportLabel).join(', ')}` : ''}{f.route.plausible ? '' : ' · route unconfirmed'}</p>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-text-muted">{f.callsign ? 'No route on file for this callsign — the public route database covers scheduled flights best; charters and positioning flights are often missing.' : 'No callsign broadcast, so the route can\'t be looked up.'}</p>
          )}
          <dl className="mt-3 divide-y divide-border">
            <Row label="Altitude" value={f.onGround ? 'Ground' : f.altitude != null ? `${Math.round(f.altitude).toLocaleString()} ft` : undefined} />
            <Row label="Ground speed" value={f.speed != null ? `${Math.round(f.speed)} kt (${Math.round(f.speed * 1.852)} km/h)` : undefined} />
            <Row label="Track" value={f.course != null ? `${Math.round(f.course)}° ${compass(f.course) ?? ''}` : undefined} />
            <Row label="Vertical rate" value={f.vertRate != null && f.vertRate !== 0 ? `${f.vertRate > 0 ? '+' : ''}${f.vertRate} ft/min` : undefined} />
            <Row label="Position" value={`${Math.abs(f.lat).toFixed(3)}° ${f.lat >= 0 ? 'N' : 'S'}, ${Math.abs(f.lon).toFixed(3)}° ${f.lon >= 0 ? 'E' : 'W'}`} />
            <Row label="Aircraft type" value={f.type} />
            <Row label="Registration" value={f.registration} />
            <Row label="ICAO hex" value={f.id} />
            <Row label="Squawk" value={f.squawk} />
            <Row label="Last signal" value={ago(f.at)} />
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted"><Compass size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Position from public ADS-B receivers (adsb.fi, adsb.lol). Route from adsbdb.com, matched on callsign — a best effort, not the airline's record. Route data © David J Taylor &amp; Jim Mason.</p>
        </>
      )}
      {!f && !err && <p className="mt-3 text-xs text-text-muted">Loading…</p>}
      {footer}
    </motion.div>
  )
}

