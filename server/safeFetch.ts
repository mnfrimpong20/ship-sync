/**
 * Fetch a URL that came from a user (product links, webhook endpoints) without letting it reach our own network:
 * the hostname is resolved first and refused if any address is private, loopback, link-local (cloud metadata),
 * carrier-grade NAT or otherwise internal — and every redirect hop is checked the same way.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xe0000000, 4], [0xf0000000, 4],
]
function privateV4(ip: string) {
  const n = ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)))
}
function privateV6(ip: string) {
  const x = ip.toLowerCase()
  if (x === '::' || x === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); if (mapped) return privateV4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x)
}
export const isPrivateIp = (ip: string) => (isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : true)

/** Throws if the URL is not public http(s) on a normal port. */
export async function assertPublicUrl(raw: string, opts: { httpsOnly?: boolean } = {}) {
  let u: URL; try { u = new URL(raw) } catch { throw new Error('Not a valid web address.') }
  if (!(u.protocol === 'https:' || (!opts.httpsOnly && u.protocol === 'http:'))) throw new Error(opts.httpsOnly ? 'Use an https:// address.' : 'Use an http(s):// address.')
  if (u.username || u.password) throw new Error('Addresses with a username or password aren’t allowed.')
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('That port isn’t allowed.')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error('That address isn’t public.')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Error('That address couldn’t be found.') })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address isn’t public.')
  return u
}

/** fetch() for user-supplied URLs: public addresses only, redirects followed by hand (max 4) and each one re-checked. */
export async function safeFetch(raw: string, init: RequestInit & { httpsOnly?: boolean } = {}): Promise<Response> {
  let url = raw
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url, { httpsOnly: init.httpsOnly })
    const r = await fetch(url, { ...init, redirect: 'manual' })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location')!, url).href; continue }
    return r
  }
  throw new Error('Too many redirects.')
}
