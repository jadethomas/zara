# zara

Static one-page recruiting site for Zara Thomas (basketball player profile).

## Infrastructure

- **Domain:** `zara-thomas.com`
- **DNS / registrar:** managed on Cloudflare

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
