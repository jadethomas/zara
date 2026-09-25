# zara

Static one-page recruiting site for Zara Thomas (basketball player profile).

## Infrastructure

- **Domain:** `zara-thomas.com`
- **DNS / registrar:** managed on Cloudflare

## Deployment

Cloudflare Pages project **`zara-thomas`** (direct upload, not Git-connected on
the Cloudflare side). Deploys are driven by `.github/workflows/deploy.yml`: a
push to `main` stages the site files into `dist/` and uploads them, so pushing
is publishing.

To deploy by hand (bypassing CI):

```bash
npx wrangler@latest pages deploy . --project-name=zara-thomas --branch=main
```

- Preview URL: `zara-thomas.pages.dev`
- `zara-thomas.com` — apex, CNAME to `zara-thomas.pages.dev`, proxied
- `www.zara-thomas.com` — AAAA `100::` proxied, 301'd to the apex by the zone's
  "Redirect www to apex" rule (`http_request_dynamic_redirect` phase)
- Zone `a64247cf7a340e315f89bc58dbc1baeb`, account `8d06ce22491730cc465d147a156c9da8`

## Stats tracker (/track, /stats, /api)

Game-stat tracking for recruiting. Three pieces:

- **`track/`** — PWA stat tracker, save-to-home-screen on iPhone. Local-first:
  every tap lands in IndexedDB, a background sync pushes to the API (idempotent
  upserts on client UUIDs — retries never duplicate). Works fully offline via
  `track/sw.js`; **bump `VERSION` in sw.js whenever any shell file changes** or
  installed phones keep the old app. Install fetches use `cache: "reload"` —
  keep that, or a version bump can precache the stale files it meant to replace.
- **`stats/`** — public report page (averages, game log, trend charts, shot
  chart). Reads the public API. Its CSS lives in `stats/stats.css` because the
  site CSP has **no `unsafe-inline` for styles** — an inline `<style>` block or
  `style=` attribute on any page is silently dropped. Chart series colors
  (#16a34a / #0284c7) are CVD-validated as a pair against the dark surface.
- **`worker/`** — Cloudflare Worker `zara-stats-api` on route
  `zara-thomas.com/api/*` (intercepts ahead of Pages), D1 `zara-stats`
  (id `98db5e1a-3df4-47c5-b39f-b47ed62687bb`). Deploy: `cd worker && npm run
  deploy` (manual, like jett-seo-tracker — CI ships only the static site).
  Schema in `worker/schema.sql`; `CREATE TABLE IF NOT EXISTS` will not add
  columns — remote schema changes need explicit `ALTER TABLE`.
  `workers_dev` stays false.

**Totals are always recomputed from `stat_events`** — there is no stored box
score to drift. Games and events are soft-deleted (`deleted = 1`), never
removed, so deletes sync like everything else.

### Auth

`GET /api/stats/*` is public and cached 60s. Everything under `/track` and
`/api/track` sits behind Cloudflare Access app **"Zara stats tracker"**
(`926fc92a-d764-4a82-b0fa-797190e0c423`, same Zero Trust org as seo.jett.io,
team domain `super-thunder-8607.cloudflareaccess.com`), attached to reusable
policy "Zara stat trackers — allow" → Access **group** `Zara stat trackers`
(`23ecdbd8-e9fb-4819-a7ec-a8be29ac348a`). **To add a tracker user: add their
email to that group** (Zero Trust → My Team → Groups) — nothing else. One
person tracks a given game; two people logging the same game double the stats.

The Worker also verifies the `Cf-Access-Jwt-Assertion` JWT (signature against
the team certs, issuer, AUD) on every `/api/track/*` request and stamps
`recorded_by` from its email claim — Access at the edge is the wall, the JWT
check is the lock behind it. Local dev bypass: `DEV_ALLOW_UNAUTHENTICATED=1`
in `worker/.dev.vars` only — never in wrangler.jsonc.

Local dev (full stack: static + API + local D1):

```bash
cd worker && cp .dev.vars.example .dev.vars
mkdir -p /tmp/zara-dist && cp -R ../index.html ../404.html ../styles.css ../_headers ../assets ../track ../stats /tmp/zara-dist/
npx wrangler dev --assets /tmp/zara-dist --port 8788
```

(`--assets` honors `_headers`, so CSP applies locally too — that parity is how
the inline-style bug was caught. Don't point `--assets` at the repo root:
`worker/node_modules` breaks the 25 MiB asset limit.)

## Analytics

Google Analytics 4, measurement ID `G-V5HT5WD4TB`. The gtag.js snippet is inline
in the `<head>` of **both** `index.html` and `404.html` — if you add another page,
copy the snippet into it or it won't be tracked. The same goes for the favicon
`<link>`s; note `404.html` references assets absolutely (`/assets/…`) because
Pages serves it from arbitrary URLs.

GA4 sets cookies, so a consent notice is likely required if the site starts
drawing EU traffic. There is none today.

## Layout

- `index.html` — the whole page (hero, stats, highlight reel, career, team photo, notes, contact)
- `404.html` — not-found page; Pages serves it automatically for unknown paths
- `styles.css` — all styling for the main pages; design tokens live in `:root`.
  New page-level classes must not collide with these (e.g. `.hero` is taken —
  the stats page's highlight tile is `.tile-hero` for exactly that reason)
- `track/`, `stats/`, `worker/` — the stats tracker; see its section above
- `_headers` — security headers served by Pages (CSP, HSTS, frame-ancestors,
  Permissions-Policy). The CSP allowlists gtag/GA and Google Fonts, and
  pre-allows YouTube / Vimeo / Hudl iframes for the future reel embed — a new
  third-party script or embed host must be added here or it will be blocked.
  deploy.yml stages files explicitly, so this file is named there too.
- `assets/zara-profile.jpg` — hero portrait, 939×1536 (the hero frame is 3:4,
  `object-fit: cover` with `object-position: top center` so her head is never
  cropped — the crop comes off the bottom)
- `assets/zara-team.jpg` — team photo in the `#team` section, 1200×1050
- `assets/favicon.svg` — "ZT" mark, dark letters on `--accent` green; the
  colour is hardcoded (it is a path fill, not a token), so if `--accent`
  changes in `styles.css` this file and `apple-touch-icon.png` must be
  regenerated by hand or they will drift out of sync; the
  letterforms are paths, not text, so it needs no font
- `assets/apple-touch-icon.png` — 180×180 square render of the same mark (iOS
  applies its own rounded mask, so this one has no corner radius)

No build step. Preview with `python3 -m http.server` from the repo root.

## Source of truth

The design is the Claude Design canvas project **"Zara Thomas basketball highlight site"**
(project `b0c3fdba-c5a8-41d1-a796-f984bde64709`), file `Zara Thomas v2.dc.html`.
That file is a `.dc.html` canvas document: `<helmet>` compiles into `<head>`, and
`<sc-if>` / `<sc-for>` / `{{ }}` are resolved by its `support.js` runtime at render
time. This repo is the resolved, plain-HTML implementation of it — edit the HTML/CSS
here, not the canvas, unless you are deliberately re-syncing from the design.

## Content placeholders still to fill

- `Class of 20XX` in the hero eyebrow
- The coach quote and attribution in "Coach's word"
- The highlight reel embed (see the comment in the `#reel` section)
