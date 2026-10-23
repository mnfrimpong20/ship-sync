/**
 * Open an uploaded file (a base64 data URL) in a new tab — safely.
 *
 * The file becomes a Blob of a known-safe type and the tab gets a blob: URL, so nothing from the upload is ever
 * written into one of our pages as HTML. Anything that isn't a PDF or a plain image is offered as a download.
 */
const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/

export function openDataUrl(dataUrl: string, name = 'file') {
  const m = /^data:([a-z0-9.+/-]+)(?:;[a-z0-9=.+-]+)*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!m) throw new Error('This file can’t be opened.')
  const type = VIEWABLE.test(m[1].toLowerCase()) ? m[1].toLowerCase() : 'application/octet-stream'
  const bin = atob(m[2].replace(/\s+/g, '')); const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  if (type === 'application/octet-stream') { const a = document.createElement('a'); a.href = url; a.download = name; a.click() }
  else window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
