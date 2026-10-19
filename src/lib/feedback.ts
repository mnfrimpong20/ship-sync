/** Scan feedback you can hear and feel: a short high beep for OK, two low beeps for a problem, plus a buzz. */
let ctx: AudioContext | null = null
const tone = (freq: number, at: number, len: number) => {
  if (!ctx) return
  const o = ctx.createOscillator(); const g = ctx.createGain()
  o.type = 'sine'; o.frequency.value = freq
  g.gain.setValueAtTime(0.0001, ctx.currentTime + at); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + len)
  o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + len + 0.02)
}
export function scanFeedback(kind: 'ok' | 'warn' | 'bad', sound = true) {
  try {
    if (sound) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) { ctx ??= new AC(); if (ctx.state === 'suspended') void ctx.resume() }
      if (kind === 'ok') tone(1320, 0, 0.12)
      else if (kind === 'warn') { tone(880, 0, 0.1); tone(880, 0.16, 0.1) }
      else { tone(330, 0, 0.18); tone(260, 0.24, 0.24) }
    }
    navigator.vibrate?.(kind === 'ok' ? 40 : kind === 'warn' ? [60, 60, 60] : [120, 60, 120])
  } catch { /* audio blocked */ }
}
