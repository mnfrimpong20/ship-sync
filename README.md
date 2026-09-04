# Ship Sync

Marketplace connecting air and ocean shippers with customers shipping to West Africa (Ghana, Nigeria, Liberia, Togo, Côte d'Ivoire, Sierra Leone, Senegal).

**Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4 + Motion on the front end; Express + Postgres (`pg`) on the back end with session auth (httpOnly cookie, bcrypt passwords). Without a `DATABASE_URL` the server falls back to an embedded Postgres (PGlite) in `./data/pglite`, so it runs anywhere with zero setup.

```bash
npm install
npm run dev      # API + Vite dev server on http://localhost:5000
npm run build    # front end → dist/
npm start        # production: Express serves dist/ + /api
```

Copy `.env.example` to `.env` (or set Replit secrets). On Replit, add a PostgreSQL database and `DATABASE_URL` is injected automatically.

**Demo accounts** (seeded on first run, password `shipsync`): customer `demo@shipsync.demo`, shippers `ops@atlanticbridge.demo` and `ops@goldcoast.demo`. The eight seeded shippers are fictional; with `DEMO_AUTO_QUOTES=true` (default) they auto-reply to new requests so the flow can be tried end to end. Set it to `false` once real shippers are on board.

**API** (all JSON, under `/api`): `auth/signup`, `auth/login`, `auth/logout`, `auth/me` · `shippers`, `shippers/:id`, `match` · `requests` (GET own / POST new; guests pass a `password` to create an account) · `requests/:id/quotes` (shipper) · `quotes/:id/accept` (customer) · `shipments`, `shipments/:id/advance` (shipper) · `track/:ref` (public).

See `DESIGN.md` for the design brief (palette, type, sections, motion rules).

**Hero footage** — three clips from Pexels (free for commercial use, no attribution required), trimmed to 10s and re-encoded in `public/video/`: [Cargo Container Ships In Port](https://www.pexels.com/video/cargo-container-ships-in-port-3840442/) by Tom Fisk, [Cargo Jet Taking Off from Busy Airport](https://www.pexels.com/video/cargo-jet-taking-off-from-busy-airport-37723633/) by Tuan Vy Spotter, [Workers Unloading a Delivery Truck](https://www.pexels.com/video/workers-unloading-a-delivery-truck-6169116/) by Tima Miroshnichenko.
