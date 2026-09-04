# Ship Sync — Design Brief

Ship Sync is a marketplace that connects air and ocean shippers (freight forwarders, consolidators, carriers) with customers shipping to West Africa — Ghana, Nigeria, Liberia, Togo, Côte d'Ivoire, Sierra Leone, Senegal. Audience: diaspora individuals shipping barrels/boxes/vehicles home, SME importers, and the shippers who serve them. Goal: quote requests from customers and sign-ups from shippers.

## 1. Style direction — "Premium Logistics Editorial"

Dark navy foundation with warm gold accents, generous whitespace, large editorial headlines, bento-style feature cards, and glass-tinted surfaces over deep navy for the hero and dashboards. Why: freight is a trust business — people are handing over vehicles and containers worth thousands. Navy reads as reliable and institutional; gold adds warmth and echoes West-African kente/adinkra tones without cliché. The editorial type scale makes it feel like an established brand, not a startup template.

## 2. Color palette

| Token | Hex | Use |
|---|---|---|
| `--color-bg` | `#0B1220` | Page background (dark sections, app shell) |
| `--color-surface` | `#111B2E` | Cards, nav, panels on dark |
| `--color-surface-2` | `#182540` | Elevated cards, inputs on dark |
| `--color-light` | `#F7F5F0` | Light section background (warm off-white) |
| `--color-light-surface` | `#FFFFFF` | Cards on light sections |
| `--color-text` | `#F4F6FA` | Primary text on dark |
| `--color-text-muted` | `#A3AEC2` | Muted text on dark (contrast 7.6:1 on bg) |
| `--color-ink` | `#0B1220` | Primary text on light |
| `--color-ink-muted` | `#4B5563` | Muted text on light (7.4:1 on light) |
| `--color-gold` | `#E3B54A` | Primary accent (CTAs, highlights) — 9.9:1 on bg |
| `--color-gold-deep` | `#B8891F` | Gold hover / on-light accent (4.6:1 on light) |
| `--color-teal` | `#2DD4BF` | Secondary accent (ocean / status success) |
| `--color-sky` | `#7DD3FC` | Air freight accent |
| `--color-border` | `#24324D` | Borders on dark |
| `--color-border-light` | `#E5E1D8` | Borders on light |
| `--color-danger` | `#F87171` | Errors |

Contrast checks: `#F4F6FA` on `#0B1220` = 17:1; `#A3AEC2` on `#0B1220` = 7.6:1; `#0B1220` on `#E3B54A` (button text) = 10.5:1; `#4B5563` on `#F7F5F0` = 7.4:1. All ≥ 4.5:1.

## 3. Typography

- Heading: **Fraunces** (variable, optical sizing, 600–700) — editorial warmth.
- Body/UI: **Inter** (400–600).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

Scale: h1 `clamp(2.6rem, 5.5vw, 4.75rem)` lh 1.05; h2 `clamp(2rem, 3.5vw, 3rem)` lh 1.1; h3 `1.375rem` lh 1.25; body 17px lh 1.6; small 14px lh 1.5; eyebrow 12px uppercase tracking 0.14em.

## 4. Spacing & layout

8px scale (4px half-step). Max content width 1240px (`max-w-[1240px] px-5 md:px-8`). Section padding `py-20 md:py-28`. Grids: 12-col on desktop, features as 3-col bento (`md:grid-cols-6` spans), directory 3-col cards, dashboards 2-col with sidebar 260px. Radius tokens: `--radius-sm` 8px, `--radius` 14px, `--radius-lg` 24px, pills 999px. Shadow: `0 20px 60px -20px rgb(0 0 0 / .5)` on dark cards; `0 10px 30px -12px rgb(11 18 32 / .15)` on light.

## 5. Section plan (marketing home)

1. **Nav** — logo, links (Ship, Shippers, Track, Pricing, How it works), Sign in, gold CTA "Get a quote". Sticky, blurs on scroll, mobile sheet menu.
2. **Hero** — eyebrow "Air & ocean freight to West Africa", h1 "Ship home with carriers you can trust.", subhead, dual CTA (Get a quote / List your company), inline quick-quote card (origin, destination, mode), trust stats strip (shippers, lanes, on-time %).
3. **Destinations** — horizontally scrolling country cards (Ghana, Nigeria, Liberia, Togo, Côte d'Ivoire, Sierra Leone, Senegal) with ports/airports and typical transit days. CTA: choose destination → quote.
4. **How it works** — 3 steps: Post shipment → Compare quotes → Book & track.
5. **Features bento** — Verified shippers, transparent quotes, door-to-door, vehicle & container shipping, real-time tracking, customs guidance.
6. **For shippers** — split section: benefits of listing, lead volume, badges. CTA: List your company.
7. **Featured shippers** — 3 cards from the directory with ratings, modes, lanes. CTA: Browse directory.
8. **Testimonials** — 3 quotes (customers + one shipper).
9. **Pricing** — Free for customers; shipper plans Starter / Pro / Enterprise.
10. **FAQ** — 6 accordion items (customs, barrels, vehicle docs, transit, payment, insurance).
11. **Final CTA** — gold gradient band.
12. **Footer** — columns, destinations, legal.

App routes (same design system): `/quote` (4-step wizard → matches), `/shippers` (directory w/ filters), `/shippers/:id` (profile), `/track` (tracking timeline), `/login`, `/signup` (customer or shipper), `/dashboard` (customer: shipments, quotes), `/dashboard/shipper` (leads, quotes sent, performance).

## 6. Motion rules

UI transitions 150–300ms; scroll reveals 500–600ms; hero entrance 600–800ms. Entrances `ease: [0.22,1,0.36,1]`; moves ease-in-out. Animate `transform` and `opacity` only. Stagger children 80ms. `MotionConfig reducedMotion="user"`. Scroll progress bar on marketing pages. Route transitions via `AnimatePresence mode="wait"` fade/slide 200ms. Nothing animates twice (`viewport once`).

## 7. UX rules checklist

- Icons: lucide-react only; no emoji as icons (flags are text glyphs, fine as decoration only).
- Focus rings visible (`focus-visible:ring-2 ring-gold ring-offset-2 ring-offset-bg`).
- Touch targets ≥ 44px. Hover states on every interactive element.
- Loading, empty, error states in wizard results, directory filters, tracking lookup, dashboards.
- Mobile-first; breakpoints 375 / 768 / 1280.
- Semantic landmarks, one h1 per page, alt text, aria-labels on icon buttons.
- Forms validate inline with clear messages.
