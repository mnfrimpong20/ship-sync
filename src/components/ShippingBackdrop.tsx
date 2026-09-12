/**
 * Quiet nautical-chart backdrop for public pages: a faint graticule, a great-circle lane from the Americas/Europe to the
 * Gulf of Guinea with port marks and a small vessel, a compass rose and a few swell lines. Drawn with currentColor at
 * low opacity so it follows every theme (light, dark, and each brand) and never competes with the cards in front of it.
 */
export function ShippingBackdrop({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {/* soft chart-paper tint at the top, fading into the page */}
      <div className="absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-surface-2/70 via-surface-2/25 to-transparent" />
      <svg className="absolute inset-x-0 top-0 h-[720px] w-full text-text" viewBox="0 0 1440 720" preserveAspectRatio="xMidYMin slice" fill="none">
        <defs>
          <linearGradient id="sb-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset="0.75" stopColor="#fff" stopOpacity="0.55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id="sb-mask"><rect width="1440" height="720" fill="url(#sb-fade)" /></mask>
          <pattern id="sb-grid" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M120 0H0V120" stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" /></pattern>
          <pattern id="sb-grid-fine" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" stroke="currentColor" strokeOpacity="0.025" strokeWidth="1" /></pattern>
        </defs>
        <g mask="url(#sb-mask)">
          {/* graticule */}
          <rect width="1440" height="720" fill="url(#sb-grid-fine)" />
          <rect width="1440" height="720" fill="url(#sb-grid)" />
          {/* curved parallels, chart-style */}
          <path d="M-40 140 Q720 90 1480 140" stroke="currentColor" strokeOpacity="0.09" />
          <path d="M-40 380 Q720 330 1480 380" stroke="currentColor" strokeOpacity="0.09" />
          <path d="M-40 620 Q720 570 1480 620" stroke="currentColor" strokeOpacity="0.07" />
          {/* rhumb-line ticks along the top edge */}
          {Array.from({ length: 24 }, (_, i) => <path key={i} d={`M${60 + i * 60} 0v${i % 4 === 0 ? 14 : 7}`} stroke="currentColor" strokeOpacity="0.16" />)}
          {/* stylised coastlines: a hint of the American seaboard (left) and the Gulf of Guinea (right) */}
          <path d="M-20 240 C40 290 60 360 90 420 C120 480 80 560 120 620 C150 660 130 700 160 740" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
          <path d="M1340 250 C1300 320 1330 380 1300 440 C1270 500 1320 560 1290 620 C1270 660 1300 700 1280 740" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
          {/* the lane: great-circle from the US Gulf to Tema, plus a Europe → Lagos feeder */}
          <path d="M110 172 C400 40 1040 40 1330 172" className="text-gold" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="7 7" />
          <path d="M1010 20 C1090 80 1200 100 1330 172" className="text-gold" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="4 8" />
          {/* ports */}
          {[[110, 172], [1330, 172], [1010, 20]].map(([x, y], i) => (
            <g key={i} className="text-gold">
              <circle cx={x} cy={y} r="11" stroke="currentColor" strokeOpacity="0.3" />
              <circle cx={x} cy={y} r="3.5" fill="currentColor" fillOpacity="0.8" />
            </g>
          ))}
          {/* port labels */}
          {[[110, 172, 'Houston · Newark'], [1330, 172, 'Tema · Apapa'], [1010, 20, 'Rotterdam']].map(([x, y, l], i) => <text key={i} className="hidden md:block" x={x} y={Number(y) + 30} textAnchor="middle" fontSize="10.5" letterSpacing="1.2" fontFamily="ui-sans-serif, system-ui" fill="currentColor" fillOpacity="0.45">{String(l).toUpperCase()}</text>)}
          {/* vessel on the lane */}
          <g transform="translate(720 78)" className="text-gold">
            <path d="M-26 6 L26 6 L18 16 L-18 16 Z" fill="currentColor" fillOpacity="0.85" />
            <path d="M-14 -2h26v8h-26z M-8 -9h10v7h-10z M2 -5h8v3h-8z" fill="currentColor" fillOpacity="0.6" />
            <path d="M-46 22 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
          </g>
          {/* compass rose */}
          <g transform="translate(1375 430)" stroke="currentColor">
            <circle r="46" strokeOpacity="0.14" />
            <circle r="34" strokeOpacity="0.1" />
            <circle r="3" fill="currentColor" fillOpacity="0.5" strokeOpacity="0" />
            <path d="M0 -52V-38 M0 38V52 M-52 0H-38 M38 0H52" strokeOpacity="0.35" strokeWidth="1.5" />
            <path d="M0 -30 L6 0 L0 30 L-6 0 Z" fill="currentColor" fillOpacity="0.16" strokeOpacity="0.3" />
            <path d="M-30 0 L0 6 L30 0 L0 -6 Z" fill="currentColor" fillOpacity="0.1" strokeOpacity="0.25" />
            <path d="M0 -30 L6 0 L0 0 Z" className="text-gold" fill="currentColor" fillOpacity="0.8" strokeOpacity="0" />
            <text y="-58" textAnchor="middle" fontSize="11" fontFamily="ui-sans-serif, system-ui" fill="currentColor" fillOpacity="0.55" stroke="none">N</text>
          </g>
          {/* swell lines, low and quiet */}
          {[0, 1, 2].map((i) => <path key={i} d={`M-20 ${560 + i * 34} q40 -10 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0`} stroke="currentColor" strokeOpacity={0.09 - i * 0.025} strokeWidth="1.2" />)}
        </g>
      </svg>
    </div>
  )
}
