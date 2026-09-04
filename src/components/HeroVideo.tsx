import { useEffect, useRef, useState } from 'react'

/**
 * Cycling video backdrop for the hero: port → cargo plane → last-mile delivery.
 * Each clip is a muted 10s loop; we crossfade to the next one ~1.2s before it ends.
 * Falls back to a still poster when the user prefers reduced motion or has data saver on.
 */
const clips = [
  { id: 'port', poster: '/video/port.jpg', label: 'Container ship being guided into port by tugboats' },
  { id: 'air', poster: '/video/air.jpg', label: 'Cargo freighter aircraft climbing after takeoff' },
  { id: 'delivery', poster: '/video/delivery.jpg', label: 'Delivery crew unloading boxes from a van' },
]
const FADE_MS = 1200

export default function HeroVideo() {
  const [active, setActive] = useState(0)
  const [staticOnly, setStaticOnly] = useState(false)
  const [loaded, setLoaded] = useState<boolean[]>(() => clips.map(() => false))
  const refs = useRef<(HTMLVideoElement | null)[]>([])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
    if (reduce || saveData) setStaticOnly(true)
  }, [])

  // Play the active clip, pause the others, and advance shortly before it ends.
  useEffect(() => {
    if (staticOnly) return
    const v = refs.current[active]
    if (!v) return
    refs.current.forEach((o, i) => { if (o && i !== active) { o.pause() } })
    v.currentTime = 0
    v.play().catch(() => setStaticOnly(true))
    let advanced = false
    const onTime = () => {
      if (advanced || !v.duration) return
      if (v.currentTime >= v.duration - FADE_MS / 1000) {
        advanced = true
        const next = (active + 1) % clips.length
        const nv = refs.current[next]
        if (nv) { nv.currentTime = 0; nv.play().catch(() => {}) }
        setActive(next)
      }
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [active, staticOnly])

  // Pause everything when the hero is off-screen (saves battery/CPU on long pages).
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (staticOnly || !wrap.current) return
    const io = new IntersectionObserver(([e]) => {
      const v = refs.current[active]
      if (!v) return
      if (e.isIntersecting) v.play().catch(() => {}); else v.pause()
    }, { threshold: 0.05 })
    io.observe(wrap.current)
    return () => io.disconnect()
  }, [active, staticOnly])

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Poster paints immediately so the hero is never black. */}
      <img src={clips[0].poster} alt="" width={1600} height={900} className="absolute inset-0 h-full w-full object-cover" decoding="async" fetchPriority="high" />
      {!staticOnly && clips.map((c, i) => (
        <video
          key={c.id}
          ref={(el) => { refs.current[i] = el }}
          poster={c.poster}
          muted
          playsInline
          preload={i === 0 ? 'auto' : 'metadata'}
          disablePictureInPicture
          onCanPlay={() => setLoaded((l) => (l[i] ? l : l.map((x, j) => (j === i ? true : x))))}
          className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
          style={{ opacity: i === active && loaded[i] ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
          title={c.label}
        >
          <source src={`/video/${c.id}.mp4`} type="video/mp4" />
          <source src={`/video/${c.id}.webm`} type="video/webm" />
        </video>
      ))}
      {/* Brand overlay: keep navy + gold identity and guarantee text contrast on the left. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,18,32,0.82)_0%,rgba(11,18,32,0.55)_45%,rgba(11,18,32,0.25)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,18,32,0.45)_0%,rgba(11,18,32,0.05)_35%,rgba(11,18,32,0.35)_70%,rgba(11,18,32,0.95)_100%)]" />
      <div className="absolute inset-0 bg-bg/40 lg:hidden" />
    </div>
  )
}
