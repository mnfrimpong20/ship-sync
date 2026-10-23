/**
 * Every upload travels as a base64 data URL inside JSON. This checks all of them in one place, before any route runs:
 * a value that starts with "data:" must be a complete, well-formed data URL of an allowed type — never HTML, script
 * or anything with extra text tacked on after the prefix (which is how a "licence photo" could smuggle in markup).
 */
import type { NextFunction, Request, Response } from 'express'

export const UPLOAD_TYPES = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif|heic|heif|avif|bmp|svg\+xml)|audio\/[a-z0-9.+-]+|video\/(mp4|webm|quicktime)|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel|application\/octet-stream|)$/i
const SHAPE = /^data:([a-z0-9.+/-]*)((?:;[a-z0-9=.+-]+)*);base64,([A-Za-z0-9+/=\r\n]*)$/i

/** Is this a safe, complete data URL? */
export function validDataUrl(v: string): boolean {
  const m = SHAPE.exec(v); return !!m && UPLOAD_TYPES.test(m[1])
}

function bad(v: unknown, depth = 0): boolean {
  if (depth > 8 || v == null) return false
  if (typeof v === 'string') return /^\s*data:/i.test(v) && !validDataUrl(v.trim())
  if (Array.isArray(v)) return v.some((x) => bad(x, depth + 1))
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some((x) => bad(x, depth + 1))
  return false
}

export function uploadGuard(req: Request, res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object' && bad(req.body)) return res.status(400).json({ error: 'That file isn’t a supported type (PDF, photo, Word or Excel), or it didn’t upload completely. Please try again.' })
  next()
}
