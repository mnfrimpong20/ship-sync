/**
 * What search engines and link previews see before any script runs:
 *   - every page's HTML carries its own <title>, description, Open Graph tags and canonical address
 *     (shipper profiles use the company's name and tagline)
 *   - private pages are marked noindex
 *   - /robots.txt and /sitemap.xml (public pages + every public shipper profile)
 */
import type { Express, Request } from 'express'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { publicShipperSql, type Db } from './db'
import { NOINDEX, SITEMAP_PATHS, pageMeta } from '../src/lib/pageMeta'

type Row = Record<string, any>
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const baseUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

/** robots.txt + sitemap.xml — mounted in both dev and production (before Vite's dev middleware). */
export function mountSeoFiles(app: Express, getDb: () => Promise<Db>) {
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
    res.send(['User-agent: *', 'Allow: /', ...['/dashboard', '/admin', '/api/', '/pay/', '/doc/', '/r/', '/p/', '/s/', '/broker/', '/reset', '/join', '/embed/', '/add-recipient/', '/order/', '/scan'].map((p) => `Disallow: ${p}`), '', `Sitemap: ${baseUrl(req)}/sitemap.xml`, ''].join('\n'))
  })

  app.get('/sitemap.xml', async (req, res) => {
    const base = baseUrl(req)
    let shippers: Row[] = []
    try { shippers = (await (await getDb()).query<Row>(`select id from shippers where ${publicShipperSql()} order by verified desc, name`)).rows } catch { /* sitemap still lists the main pages */ }
    const urls = [...SITEMAP_PATHS.map((p) => ({ loc: base + p, pri: p === '/' ? '1.0' : p === '/for-shippers' || p === '/shippers' ? '0.9' : '0.6' })), ...shippers.map((s) => ({ loc: `${base}/shippers/${encodeURIComponent(s.id)}`, pri: '0.7' }))]
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><priority>${u.pri}</priority></url>`).join('\n')}\n</urlset>\n`)
  })
}

/** Production: every page's HTML carries its own title, description, Open Graph tags and canonical address. */
export function mountSeo(app: Express, getDb: () => Promise<Db>, dist: string) {
  // Re-read the page shell when a new build replaces it (asset file names change on every build).
  let shell: { at: number; html: string } | null = null
  const html = () => { const f = path.join(dist, 'index.html'); const at = statSync(f).mtimeMs; if (!shell || shell.at !== at) shell = { at, html: readFileSync(f, 'utf8') }; return shell.html }

  app.get('*path', async (req, res) => {
    const p = req.path
    let { title, description } = pageMeta(p)
    const m = /^\/shippers\/([^/]+)$/.exec(p)
    if (m) {
      try {
        const { rows } = await (await getDb()).query<Row>(`select name, tagline, about from shippers where id = $1 and ${publicShipperSql()}`, [decodeURIComponent(m[1])])
        if (rows[0]) { title = `${rows[0].name} — shipping to West Africa · Ntemtem`; description = String(rows[0].tagline || rows[0].about || description).slice(0, 200) }
      } catch { /* fall back to the generic profile title */ }
    }
    const url = `${baseUrl(req)}${p}`
    let out = html()
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    out = /<meta property="og:url"/.test(out) ? out.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(url)}$2`) : out.replace('</head>', `  <meta property="og:url" content="${esc(url)}" />\n  </head>`)
    out = out.replace('</head>', `  <link rel="canonical" href="${esc(url)}" />\n${NOINDEX.test(p) ? '    <meta name="robots" content="noindex" />\n' : ''}  </head>`)
    if (NOINDEX.test(p)) res.set('X-Robots-Tag', 'noindex')
    res.set('Cache-Control', 'no-cache').type('html').send(out)
  })
}
