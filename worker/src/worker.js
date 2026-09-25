/**
 * zara-stats-api — game stats for zara-thomas.com.
 *
 * Routes (this Worker owns zara-thomas.com/api/*; the static site is Pages):
 *   Public, read-only:
 *     GET  /api/stats/summary   ?season=&competition=   averages + filter values
 *     GET  /api/stats/games     ?season=&competition=   game log with box scores
 *     GET  /api/stats/shots     ?season=&competition=   shot locations
 *   Private — Cloudflare Access at the edge AND JWT-verified here:
 *     GET  /api/track/whoami
 *     GET  /api/track/games                             includes soft-deleted state
 *     GET  /api/track/games/:id/events
 *     POST /api/track/sync                              idempotent upsert batch
 */

import { requireAccess } from "./access.js";
import * as db from "./db.js";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH = 2000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
// Stats move only when a game is synced; a minute of staleness is fine and
// keeps a coach reloading the report from hammering D1.
const CACHE_PUBLIC = { "cache-control": "public, max-age=60" };
const err = (msg, status) => json({ error: msg }, status);

function validateSync(body) {
  if (typeof body !== "object" || body === null) return "body must be an object";
  const games = body.games ?? [];
  const events = body.events ?? [];
  if (!Array.isArray(games) || !Array.isArray(events)) return "games and events must be arrays";
  if (games.length + events.length > MAX_BATCH) return `batch too large (max ${MAX_BATCH})`;
  for (const g of games) {
    if (!ID_RE.test(g.id ?? "")) return "game id must be a UUID";
    if (!DATE_RE.test(g.date ?? "")) return "game date must be YYYY-MM-DD";
    if (typeof g.opponent !== "string" || !g.opponent.trim()) return "game opponent required";
    if (g.opponent.length > 120 || (g.competition ?? "").length > 120) return "text field too long";
    if (!["home", "away", "neutral"].includes(g.home_away ?? "home")) return "bad home_away";
    if (!/^\d{4}$/.test(g.season ?? "")) return "season must be a year";
    if (typeof g.updated_at !== "string") return "game updated_at required";
    for (const k of ["final_us", "final_them"]) {
      const v = g[k];
      if (v != null && (!Number.isInteger(v) || v < 0 || v > 300)) return `bad ${k}`;
    }
  }
  for (const e of events) {
    if (!ID_RE.test(e.id ?? "")) return "event id must be a UUID";
    if (!ID_RE.test(e.game_id ?? "")) return "event game_id must be a UUID";
    if (!db.EVENT_TYPES.has(e.type)) return `unknown event type ${e.type}`;
    if (!db.QUARTERS.has(e.quarter)) return "bad quarter";
    if (typeof e.ts !== "string") return "event ts required";
    for (const k of ["x", "y"]) {
      const v = e[k];
      if (v != null && (typeof v !== "number" || v < 0 || v > 1)) return `bad ${k}`;
    }
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/stats/")) return await publicRoutes(request, env, url);
      if (path.startsWith("/api/track/")) return await privateRoutes(request, env, url);
      return err("not found", 404);
    } catch (e) {
      console.error(JSON.stringify({ msg: "unhandled", path, error: String(e?.stack || e) }));
      return err("internal error", 500);
    }
  },
};

async function publicRoutes(request, env, url) {
  if (request.method !== "GET") return err("method not allowed", 405);
  const opts = {
    season: url.searchParams.get("season") || undefined,
    competition: url.searchParams.get("competition") || undefined,
  };

  switch (url.pathname) {
    case "/api/stats/summary": {
      const [games, values] = await Promise.all([
        db.gamesWithBox(env.DB, opts),
        db.filterValues(env.DB),
      ]);
      const n = games.length;
      const sum = (k) => games.reduce((a, g) => a + g[k], 0);
      const avg = (k) => (n ? Math.round((sum(k) / n) * 10) / 10 : null);
      const pct = (m, a) => (sum(a) > 0 ? Math.round((sum(m) / sum(a)) * 1000) / 10 : null);
      return json({
        filters: values,
        applied: { season: opts.season ?? null, competition: opts.competition ?? null },
        games: n,
        averages: n === 0 ? null : {
          ppg: avg("pts"), rpg: avg("reb"), apg: avg("ast"),
          spg: avg("stl"), bpg: avg("blk"), topg: avg("tov"), fpg: avg("pf"),
          // Season percentages from summed makes/attempts, not averaged per-game
          // percentages — a 2-attempt game must not weigh like a 20-attempt one.
          fg_pct: pct("fgm", "fga"), p3_pct: pct("p3m", "p3a"), ft_pct: pct("ftm", "fta"),
        },
      }, 200, CACHE_PUBLIC);
    }
    case "/api/stats/games":
      return json(await db.gamesWithBox(env.DB, opts), 200, CACHE_PUBLIC);
    case "/api/stats/shots":
      return json(await db.shots(env.DB, opts), 200, CACHE_PUBLIC);
    default:
      return err("not found", 404);
  }
}

async function privateRoutes(request, env, url) {
  // Access gates these paths at the edge; verify its JWT here regardless.
  let who;
  try {
    who = await requireAccess(request, env);
  } catch (e) {
    console.error(JSON.stringify({ msg: "access denied", path: url.pathname, error: String(e) }));
    return err("forbidden", 403);
  }

  if (url.pathname === "/api/track/whoami" && request.method === "GET") {
    return json({ email: who.email });
  }
  if (url.pathname === "/api/track/games" && request.method === "GET") {
    return json(await db.gamesWithBox(env.DB, { includePrivate: true }));
  }
  const m = url.pathname.match(/^\/api\/track\/games\/([0-9a-f-]{36})\/events$/);
  if (m && request.method === "GET") {
    return json(await db.eventsForGame(env.DB, m[1]));
  }
  if (url.pathname === "/api/track/sync" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return err("body must be JSON", 400);
    }
    const problem = validateSync(body);
    if (problem) return err(problem, 400);
    const applied = await db.applySync(env.DB, body, who.email);
    return json({ ok: true, applied });
  }
  return err("not found", 404);
}
