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

**Live tracking.** Ocean shipments with an MMSI are tracked via [AISStream](https://aisstream.io) (set `AISSTREAM_API_KEY`); air shipments with an ICAO callsign via [adsb.lol](https://api.adsb.lol) (no key). Shippers enter these from their dashboard. Without a signal the tracking page shows an estimated position along the great-circle route from departure and ETA. `GET /api/track/:ref/position` and `GET /api/live/region` (vessels + flights near the West African coast, and per-port congestion counts) are public and clearly labelled as delayed, approximate and not for navigation. Coverage note: AISStream relies on community shore receivers, which are dense on the Atlantic approach (Canaries, Morocco, Portugal) but currently absent on the Gulf of Guinea coast — so the regional feed subscribes to the coast box plus the Atlantic approach, Europe and the US coasts (origin regions), port congestion counts read 0 until a coastal receiver comes online, and watched vessels are seen while within any coverage (last fix persisted).

**Demo accounts** (seeded on first run, password `shipsync`): customer `demo@shipsync.demo`, shippers `ops@atlanticbridge.demo` and `ops@goldcoast.demo`. The eight seeded shippers are fictional; with `DEMO_AUTO_QUOTES=true` (default) they auto-reply to new requests so the flow can be tried end to end. Set it to `false` once real shippers are on board.

**API** (all JSON, under `/api`): `auth/signup`, `auth/login`, `auth/logout`, `auth/me` · `shippers`, `shippers/:id`, `match` · `requests` (GET own / POST new; guests pass a `password` to create an account) · `requests/:id/quotes` (shipper) · `quotes/:id/accept` (customer) · `shipments`, `shipments/:id/advance` (shipper) · `track/:ref` (public).

See `DESIGN.md` for the design brief (palette, type, sections, motion rules).

**Hero footage** — three clips from Pexels (free for commercial use, no attribution required), trimmed to 10s and re-encoded in `public/video/`: [Cargo Container Ships In Port](https://www.pexels.com/video/cargo-container-ships-in-port-3840442/) by Tom Fisk, [Cargo Jet Taking Off from Busy Airport](https://www.pexels.com/video/cargo-jet-taking-off-from-busy-airport-37723633/) by Tuan Vy Spotter, [Workers Unloading a Delivery Truck](https://www.pexels.com/video/workers-unloading-a-delivery-truck-6169116/) by Tima Miroshnichenko.
