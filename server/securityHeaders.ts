/**
 * Security headers on every response.
 *
 * The content security policy only lets the browser run our own scripts and talk to the few outside services the app
 * really uses (CARTO map styles/tiles, Photon address search). Pages can't be framed by other sites (clickjacking) —
 * except the tracking widget under /embed, which shipping companies put on their own websites.
 * Set CSP_REPORT_ONLY=1 to watch for violations without blocking anything.
 */
import type { NextFunction, Request, Response } from 'express'

const policy = (frameAncestors: string) => [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://*.cartocdn.com",
  "connect-src 'self' https://photon.komoot.io https://*.cartocdn.com https://basemaps.cartocdn.com",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors ${frameAncestors}`,
].join('; ')

const PAGE = policy("'self'")
const EMBED = policy('*')

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const embed = req.path.startsWith('/embed/') || req.path.startsWith('/widget')
  // The CSP is for the built site only: the Vite dev server (the Replit workspace) needs an inline preamble script
  // and a live-reload WebSocket, so it would render blank there.
  if (process.env.NODE_ENV === 'production') res.setHeader(process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', embed ? EMBED : PAGE)
  if (!embed) res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self), payment=(self)')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}
