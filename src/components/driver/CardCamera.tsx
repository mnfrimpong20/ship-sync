import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ImageUp, RotateCcw } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { Big, Sheet } from './DriverUi'

/** How sharp and how bright a photo is: variance of a Laplacian on a small grey copy, and mean brightness. */
export function photoQuality(img: HTMLCanvasElement | HTMLImageElement) {
  const w = 320; const h = Math.round((w / (img.width || 1)) * (img.height || 1)) || 200
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h).data; const g = new Float32Array(w * h); let sum = 0
  for (let i = 0; i < w * h; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; g[i] = v; sum += v }
  let n = 0, m = 0, m2 = 0
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; n++; const dl = l - m; m += dl / n; m2 += dl * (l - m) }
  const sharp = n ? m2 / n : 0; const bright = sum / (w * h)
  return { sharp: Math.round(sharp), bright: Math.round(bright), blurry: sharp < 60, dark: bright < 60, glare: bright > 225 }
}

const shrink = (c: HTMLCanvasElement, max = 1400) => { if (c.width <= max) return c.toDataURL('image/jpeg', 0.85); const k = max / c.width; const o = document.createElement('canvas'); o.width = max; o.height = Math.round(c.height * k); o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', 0.85) }

/** Full-screen camera with a card-shaped guide. Checks for blur, darkness and glare before the photo is used. */
export function CardCamera({ title, hint, shape = 'card', onClose, onPhoto, testid }: { title: string; hint: string; shape?: 'card' | 'page' | 'face'; onClose: () => void; onPhoto: (dataUrl: string) => void; testid?: string }) {
  const t = useT(); const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null)
  const [err, setErr] = useState(''); const [shot, setShot] = useState<{ url: string; q: ReturnType<typeof photoQuality> } | null>(null); const [ready, setReady] = useState(false)
  const ratio = shape === 'card' ? 85.6 / 54 : shape === 'page' ? 0.77 : 0.8
  useEffect(() => {
    let live = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: shape === 'face' ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => { if (!live) { s.getTracks().forEach((x) => x.stop()); return } stream.current = s; if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}) } setReady(true) })
      .catch(() => setErr(t('No camera here — choose a photo instead.')))
    return () => { live = false; stream.current?.getTracks().forEach((x) => x.stop()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const take = () => {
    const v = video.current; if (!v || !v.videoWidth) return
    // Crop to the guide: 86% of the shorter side, centred, at the guide's ratio.
    const vw = v.videoWidth, vh = v.videoHeight; let gw = vw * 0.86, gh = gw / ratio; if (gh > vh * 0.86) { gh = vh * 0.86; gw = gh * ratio }
    const c = document.createElement('canvas'); c.width = Math.round(gw); c.height = Math.round(gh); c.getContext('2d')!.drawImage(v, (vw - gw) / 2, (vh - gh) / 2, gw, gh, 0, 0, c.width, c.height)
    setShot({ url: shrink(c), q: photoQuality(c) }); if (navigator.vibrate) navigator.vibrate(30)
  }
  const fromFile = async (f: File) => {
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
    if (f.type === 'application/pdf') { onPhoto(url); return }
    const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0); setShot({ url: shrink(c), q: photoQuality(img) }) }; img.src = url
  }
  const warn = shot ? [shot.q.blurry && t('It looks blurry — hold still and tap again.'), shot.q.dark && t('Too dark — move to the light.'), shot.q.glare && t('Too bright — tilt it away from the light to stop the glare.')].filter(Boolean) as string[] : []
  return (
    <Sheet title={title} onClose={onClose} testid={testid ?? 'card-camera'}>
      <p className="text-base text-text-muted">{hint}</p>
      {!shot ? <>
        {!err && <div className="relative mt-3 overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '3 / 4' }}>
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center"><div className={`border-[3px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,.45)] ${shape === 'face' ? 'rounded-full' : 'rounded-2xl'}`} style={{ width: shape === 'card' ? '86%' : '70%', aspectRatio: String(ratio) }} /></div>
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">{shape === 'card' ? t('Fit the card inside the frame') : shape === 'face' ? t('Face in the circle, plain background') : t('Fit the page inside the frame')}</p>
        </div>}
        {err && <p role="status" className="mt-3 rounded-xl bg-surface-2 p-3 text-base">{err}</p>}
        <div className="mt-4 grid gap-2">
          {!err && <Big tone="gold" onClick={take} disabled={!ready} testid="cam-take"><Camera size={22} aria-hidden="true" /> {t('Take photo')}</Big>}
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-border bg-surface text-base font-semibold focus-within:ring-2 focus-within:ring-gold"><ImageUp size={20} aria-hidden="true" /> {t('Choose a photo or PDF')}<input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f) }} data-testid="cam-file" /></label>
        </div>
      </> : <>
        <img src={shot.url} alt={t('Your photo')} className="mt-3 w-full rounded-2xl border border-border" />
        {warn.length ? <ul role="alert" className="mt-3 space-y-1 rounded-2xl border-2 border-gold bg-gold/10 p-3 text-base" data-testid="cam-warn">{warn.map((w) => <li key={w}>{w}</li>)}</ul> : <p role="status" className="mt-3 flex items-center gap-2 text-base font-semibold text-teal" data-testid="cam-ok"><Check size={18} aria-hidden="true" /> {t('Clear and readable.')}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Big onClick={() => setShot(null)} testid="cam-retake"><RotateCcw size={20} aria-hidden="true" /> {t('Retake')}</Big>
          <Big tone={warn.length ? 'ghost' : 'gold'} onClick={() => onPhoto(shot.url)} testid="cam-use"><Check size={20} aria-hidden="true" /> {warn.length ? t('Use anyway') : t('Use photo')}</Big>
        </div>
      </>}
    </Sheet>
  )
}
