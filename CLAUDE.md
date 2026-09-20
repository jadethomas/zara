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
- `styles.css` — all styling; design tokens live in `:root`
- `assets/zara-profile.jpg` — hero portrait, 939×1536 (the hero frame is 3:4,
  `object-fit: cover` with `object-position: top center` so her head is never
  cropped — the crop comes off the bottom)
- `assets/zara-team.jpg` — team photo in the `#team` section, 1200×1050
- `assets/favicon.svg` — "ZT" mark, dark letters on `--accent` orange; the
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
