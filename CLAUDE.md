# zara

Static one-page recruiting site for Zara Thomas (basketball player profile).

## Infrastructure

- **Domain:** `zara-thomas.com`
- **DNS / registrar:** managed on Cloudflare

## Deployment

Cloudflare Pages project **`zara-thomas`** (direct upload, not Git-connected — a
push to GitHub does NOT deploy on its own).

```bash
npx wrangler@latest pages deploy . --project-name=zara-thomas --branch=main
```

- Preview URL: `zara-thomas.pages.dev`
- `zara-thomas.com` — apex, CNAME to `zara-thomas.pages.dev`, proxied
- `www.zara-thomas.com` — AAAA `100::` proxied, 301'd to the apex by the zone's
  "Redirect www to apex" rule (`http_request_dynamic_redirect` phase)
- Zone `a64247cf7a340e315f89bc58dbc1baeb`, account `8d06ce22491730cc465d147a156c9da8`

## Layout

- `index.html` — the whole page (hero, stats, highlight reel, career, notes, contact)
- `styles.css` — all styling; design tokens live in `:root`
- `assets/zara.jpg` — hero portrait, 480×480

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
