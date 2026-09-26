# zara-thomas.com

Recruiting site and game-stat tracker for Zara Thomas (basketball, Wellington,
NZ). Three pieces share one repository:

| Piece | Path | Audience |
|---|---|---|
| Player profile | `index.html` | Anyone — the public site |
| Season stats report | `stats/` | Recruiters and coaches — public |
| Stat tracker (PWA) | `track/` | Family and invited trackers — behind Cloudflare Access |
| API | `worker/` | Serves both, on `zara-thomas.com/api/*` |

`CLAUDE.md` carries the full operational detail (infrastructure, deploys,
Access setup, gotchas). This file is the shorter human tour.

## How the stats work

Every tap in the tracker is stored as an individual event (shot, rebound,
assist…) in D1, and every number on the report is **recomputed from those
events** — there is no stored box score to drift out of sync. Games sync from
the phone with client-generated IDs, so retrying a sync can never duplicate a
game. Deleting is soft (restorable from "Recently deleted") until "Delete
forever", which purges the game from the database.

Past games can also be added as plain totals — photograph the box score (or
upload a PDF, or paste its text) and `/api/track/import` extracts Zara's row
with the Claude API for review; nothing saves until a person has checked every
number. A totals form is the fallback when there is nothing to photograph.
These games are marked `manual`: their totals are expanded into synthetic
events so the report needs no special cases, and the shot chart skips them
because they carry no shot locations.

### Definitions

- **FG%** = FGM ÷ FGA; **3P%** = 3PM ÷ 3PA; **FT%** = FTM ÷ FTA
- **eFG%** = (FGM + 0.5 × 3PM) ÷ FGA — a made three counts as one and a half
  field goals, so eFG% can legitimately exceed 100
- Season percentages are totals-based (makes ÷ attempts across all games),
  never an average of per-game percentages
- **MIN** is entered by hand at the end of a game — nothing on court tracks it

### Shot locations

Shots can optionally be logged with a court location (a tap on a half-court
diagram). The tap is validated against the shot type: a three logged inside
the arc — or a two beyond it — is not saved until the location is re-tapped
or the shot type is switched to match. The geometry lives in
`track/shot-geometry.js` and matches the arc as drawn on the tracker's court.

## Development

No build step anywhere. Full local stack (static site + API + local D1):

```sh
cd worker
npm install
cp .dev.vars.example .dev.vars        # bypasses Access locally
npm run db:local                       # schema
npx wrangler d1 execute zara-stats --local --file=migrations/0002-minutes-manual.sql
mkdir -p /tmp/zara-dist && cp -R ../index.html ../404.html ../styles.css ../_headers ../assets ../track ../stats /tmp/zara-dist/
npx wrangler dev --assets /tmp/zara-dist --port 8788
```

To exercise the box-score import without spending API credits, run the stub
and point the Worker at it (`node scripts/anthropic-stub.mjs`, then add
`ANTHROPIC_API_KEY=stub` and `ANTHROPIC_BASE_URL=http://127.0.0.1:8912` to
`.dev.vars`).

Tests (eFG% derivation, shot-location geometry, and box-score import
validation against a mocked extraction):

```sh
cd worker && npm test
```

## Deploying

Pushing to `main` publishes the static site via GitHub Actions. The Worker
deploys manually: `cd worker && npm run deploy`. Schema changes need the
migration run against the remote database explicitly — see
`worker/migrations/`.
