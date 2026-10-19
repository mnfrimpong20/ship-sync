import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

/** Finger / stylus signature on a canvas; returns a small PNG data URL (or '' when cleared). */
export function SignaturePad({ value, onChange, height = 140 }: { value: string; onChange: (dataUrl: string) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false); const last = useRef<{ x: number; y: number } | null>(null)
  const [dirty, setDirty] = useState(!!value)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = c.clientWidth
    c.width = Math.round(w * dpr); c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, height); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1620'
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, w, height); img.src = value }
  }, [height]) // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const down = (e: React.PointerEvent) => { drawing.current = true; last.current = pos(e); ref.current!.setPointerCapture(e.pointerId) }
  const move = (e: React.PointerEvent) => { if (!drawing.current || !last.current) return; const p = pos(e); const ctx = ref.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last.current = p; if (!dirty) setDirty(true) }
  const up = () => { if (!drawing.current) return; drawing.current = false; last.current = null; onChange(ref.current!.toDataURL('image/png')) }
  const clear = () => { const c = ref.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore(); setDirty(false); onChange('') }
  return (
    <div data-testid="signature-pad">
      <div className="relative overflow-hidden rounded-lg border border-border bg-white"><canvas ref={ref} style={{ height, touchAction: 'none' }} className="block w-full cursor-crosshair" aria-label="Signature" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />{!dirty && <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">Sign here with a finger</p>}</div>
      <div className="mt-1 flex justify-end"><button type="button" onClick={clear} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-danger"><Eraser size={11} aria-hidden="true" /> Clear</button></div>
    </div>
  )
}
