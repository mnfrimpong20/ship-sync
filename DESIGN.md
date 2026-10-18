# Ntemtem — Design Brief

Ntemtem is a marketplace that connects air and ocean shippers (freight forwarders, consolidators, carriers) with customers shipping to West Africa — Ghana, Nigeria, Liberia, Togo, Côte d'Ivoire, Sierra Leone, Senegal. Audience: diaspora individuals shipping barrels/boxes/vehicles home, SME importers, and the shippers who serve them. Goal: quote requests from customers and sign-ups from shippers.

## 1. Brand — Ntemtem

The full brand book (logo, colour, type, weave pattern, trust marks, voice, WhatsApp templates) lives in the **Ntemtem design system**: https://claude.ai/artifact/XtAYSnaBvBqPoZxtDC5q8t. This file is the code-side summary.

*Ntɛmtɛm* (say **n-tem-TEM**) is Twi for "quickly-quickly". Tagline: **Send it. Ntemtem.** Write `Ntemtem` in sentences, `ntemtem` in the logo, URLs and handles.

**Logo** — `Mark` / `Logo` in `src/components/ui.tsx`: a gold tile with two rounded chevrons (green trailing, navy leading) sending a box forward. `partner` draws the shipper-side version on a charcoal tile with a PARTNER label. Favicon `public/favicon.svg`, app icon `public/app-icon.svg` / `icon-512.png` / `apple-touch-icon.png`, social image `public/og.png`.

**One brand, two sides.** Customers get navy; when a shipper is signed in, `AppShell` adds `ss-partner` and the sidebar (`.ss-sidebar`) turns partner charcoal with the partner logo. Destination agents (the no-login container link) are **agents**, never "partners".

**Trust marks** — `VerifiedBadge` ("Ntemtem Verified", shipper passed vetting) and `ProtectedNote` (payment protection line, same words everywhere) in `ui.tsx`. Show them where people decide: quote cards, shipper profile, directory, payment.

## 2. Color palette

Tokens are CSS variables in `src/index.css`. The root scope is light; `.theme-dark` re-points the same tokens to the navy set (hero, footer, live map). There is one brand — no theme switcher.

| Token | Light (root) | Dark island | Use |
|---|---|---|---|
| `--color-bg` | `#FBF6EC` cream | `#0D1424` | Page background |
| `--color-surface` | `#FFFFFF` | `#18213A` | Cards, panels, nav |
| `--color-surface-2` | `#F2E9D8` | `#202B48` | Inputs, raised chips |
| `--color-text` / `--color-ink` | `#14213D` navy | `#F5EEE0` | Text |
| `--color-text-muted` | `#586079` | `#A8AFC3` | Secondary text |
| `--color-gold` | `#F2A900` kente gold | `#F5B82E` | Fills only: primary buttons, logo, highlights. Text on gold is navy |
| `--color-gold-deep` | `#8A5A00` | `#F5B82E` | Gold as **text or icon** (eyebrows, links). Never use `text-gold` on light grounds |
| `--color-teal` | `#0E7A4E` green | `#37B07A` | **Good news only** — delivered, verified, protected, success |
| `--color-sea` | `#1B5E78` | `#6CC3DD` | Ocean freight |
| `--color-sky` | `#2B6CB0` | `#7DD3FC` | Air freight |
| `--color-partner` | `#24211C` | — | Shipper side only |
| `--color-danger` | `#C2382C` clay | `#F06A5C` | Errors and delays |
| `--color-border` | `#E3D8C3` | `#2A3554` | Hairlines |

Contrast (light): navy on cream 14.8:1; muted on cream 5.8:1; gold-deep on cream 5.5:1; navy on gold 7.9:1; green on cream 5.0:1. Green and clay never carry meaning by colour alone — always a word or icon too.

## 3. Typography

- Heading: **Bricolage Grotesque** (variable, 600–800) — warm, characterful.
- Body/UI: **Figtree** (variable, 400–700) — friendly and readable on small phones.
- Both self-hosted via `@fontsource-variable/*` imported in `src/main.tsx`.

Headlines short and in sentence case. Prices, days and tracking refs never in caption size.

**Voice:** a reliable cousin who works in shipping — warm, direct, a little playful. Plain English first, one touch of Twi per screen at most ("Akwaaba" on the dashboard and on texts to Ghana). Bad news always comes with a next step. Receiver texts: greeting, news, next step, link — no emoji (it doubles SMS cost).

## 4. Spacing & layout

8px scale (4px half-step). Max content width 1240px (`max-w-[1240px] px-5 md:px-8`). Section padding `py-20 md:py-28`. Grids: 12-col on desktop, features as 3-col bento (`md:grid-cols-6` spans), directory 3-col cards, dashboards 2-col with sidebar 260px. Radius tokens: `--radius-sm` 6px, `--radius-md` 12px, `--radius-lg` 22px (the logo tile), pills 999px. Shadow: `0 20px 60px -20px rgb(0 0 0 / .5)` on dark cards; `0 10px 30px -12px rgb(11 18 32 / .15)` on light.

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
