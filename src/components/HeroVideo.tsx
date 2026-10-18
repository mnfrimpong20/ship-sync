import { useEffect, useRef, useState } from 'react'

/**
 * Hero backdrop: five scenes — barrels, the port, a car going onto a ship, a cargo plane, delivery at the family's door.
 * Photos hold for SCENE_MS with a slow zoom; clips play until ~1.2s before they end. The hero text follows the
 * active scene (see Hero.tsx). Photos live in public/hero/ (generated in the Replit app); if one is missing, the
 * scene uses its fallback still so the hero is never blank. Reduced motion / data saver → stills, no autoplay.
 */
export type Scene = { id: string; kind: 'photo' | 'video'; src: string; fallback: string; label: string }
export const scenes: Scene[] = [
  { id: 'barrels', kind: 'photo', src: '/hero/barrels.jpg', fallback: '/video/delivery.jpg', label: 'Blue shipping barrels being packed in a warehouse' },
  { id: 'port', kind: 'video', src: 'port', fallback: '/video/port.jpg', label: 'Container ship being guided into port by tugboats' },
  { id: 'car', kind: 'photo', src: '/hero/car.jpg', fallback: '/video/port.jpg', label: 'A car driving up the ramp of a car-carrier ship' },
  { id: 'air', kind: 'video', src: 'air', fallback: '/video/air.jpg', label: 'Cargo freighter aircraft climbing after takeoff' },
  { id: 'family', kind: 'photo', src: '/hero/family.jpg', fallback: '/video/delivery.jpg', label: 'A delivery being handed over at a family home in Ghana' },
]
export const SCENE_MS = 7000
const FADE_MS = 1200

export default function HeroVideo({ active, onNext, paused, staticOnly }: { active: number; onNext: () => void; paused: boolean; staticOnly: boolean }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [ready, setReady] = useState<Record<string, boolean>>({})
  const refs = useRef<Record<string, HTMLVideoElement | null>>({})
  const [onScreen, setOnScreen] = useState(true)
  const wrap = useRef<HTMLDivElement>(null)
  const s = scenes[active]

  // Pause when the hero is scrolled away (saves battery on long pages).
  useEffect(() => {
    if (!wrap.current) return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.05 })
    io.observe(wrap.current); return () => io.disconnect()
  }, [])

  // Advance: photos on a timer, clips shortly before they end (or on a timer if the clip can't play).
  useEffect(() => {
    if (paused || !onScreen) { Object.values(refs.current).forEach((v) => v?.pause()); return }
    if (s.kind === 'photo' || staticOnly) { const t = setTimeout(onNext, SCENE_MS); return () => clearTimeout(t) }
    const v = refs.current[s.id]
    Object.entries(refs.current).forEach(([id, o]) => { if (o && id !== s.id) o.pause() })
    if (!v) { const t = setTimeout(onNext, SCENE_MS); return () => clearTimeout(t) }
    v.currentTime = 0
    let fallback: ReturnType<typeof setTimeout> | null = null
    v.play().catch(() => { fallback = setTimeout(onNext, SCENE_MS) })
    let done = false
    const onTime = () => { if (!done && v.duration && v.currentTime >= v.duration - FADE_MS / 1000) { done = true; onNext() } }
    v.addEventListener('timeupdate', onTime)
    return () => { v.removeEventListener('timeupdate', onTime); if (fallback) clearTimeout(fallback) }
  }, [active, paused, onScreen, staticOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const still = (sc: Scene) => (sc.kind === 'photo' && !broken[sc.id] ? sc.src : sc.fallback)
  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* First still paints immediately so the hero is never black. */}
      <img src={still(scenes[0])} alt="" width={1920} height={1080} className="absolute inset-0 h-full w-full object-cover" decoding="async" fetchPriority="high" onError={() => setBroken((b) => ({ ...b, [scenes[0].id]: true }))} />
      {scenes.map((sc, i) => {
        const on = i === active
        const style = { opacity: on && (sc.kind === 'photo' || staticOnly || ready[sc.id]) ? 1 : 0, transitionDuration: `${FADE_MS}ms` }
        if (sc.kind === 'photo' || staticOnly) return (
          <img key={sc.id} src={still(sc)} alt="" width={1920} height={1080} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" onError={() => setBroken((b) => ({ ...b, [sc.id]: true }))}
            className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] ease-out ${on && !staticOnly && !paused ? 'scale-[1.06]' : 'scale-100'}`}
            style={{ ...style, transitionDuration: `${FADE_MS}ms, ${SCENE_MS + FADE_MS}ms` }} />
        )
        return (
          <video key={sc.id} ref={(el) => { refs.current[sc.id] = el }} poster={sc.fallback} muted playsInline preload={on ? 'auto' : 'metadata'} disablePictureInPicture
            onCanPlay={() => setReady((r) => (r[sc.id] ? r : { ...r, [sc.id]: true }))} className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out" style={style} title={sc.label}>
            <source src={`/video/${sc.src}.mp4`} type="video/mp4" />
            <source src={`/video/${sc.src}.webm`} type="video/webm" />
          </video>
        )
      })}
      {/* Brand overlay: keep navy + gold identity and guarantee text contrast on the left. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,18,32,0.82)_0%,rgba(11,18,32,0.55)_45%,rgba(11,18,32,0.25)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,18,32,0.45)_0%,rgba(11,18,32,0.05)_35%,rgba(11,18,32,0.35)_70%,rgba(11,18,32,0.95)_100%)]" />
      <div className="absolute inset-0 bg-bg/40 lg:hidden" />
    </div>
  )
}
