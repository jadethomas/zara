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
 *     POST /api/track/purge                             hard-delete one game + events
 *     POST /api/track/invite                            owner only: grant Access + email instructions
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
    return json({ email: who.email, can_invite: who.email === env.INVITE_OWNER });
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
  if (url.pathname === "/api/track/purge" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return err("body must be JSON", 400);
    }
    if (!ID_RE.test(body?.id ?? "")) return err("id must be a UUID", 400);
    await db.purgeGame(env.DB, body.id);
    console.log(JSON.stringify({ msg: "game purged", id: body.id, by: who.email }));
    return json({ ok: true });
  }
  if (url.pathname === "/api/track/invite" && request.method === "POST") {
    // Inviting grants access to the tracker — owner only, regardless of who
    // else is in the Access group.
    if (who.email !== env.INVITE_OWNER) return err("only the owner can invite", 403);
    let body;
    try {
      body = await request.json();
    } catch {
      return err("body must be JSON", 400);
    }
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return err("that does not look like an email address", 400);
    }
    if (!env.CF_API_TOKEN || !env.RESEND_API_KEY) return err("invite not configured", 503);
    const result = await invite(env, email, who.email);
    return json(result);
  }
  return err("not found", 404);
}

/**
 * Add an email to the "Zara stat trackers" Access group (idempotent), then
 * send them instructions. Group membership is the real grant — the email is
 * a courtesy, so a send failure is reported, not fatal.
 */
async function invite(env, email, invitedBy) {
  const groupUrl = "https://api.cloudflare.com/client/v4/accounts/"
    + `${env.CF_ACCOUNT_ID}/access/groups/${env.ACCESS_GROUP_ID}`;
  const auth = { authorization: `Bearer ${env.CF_API_TOKEN}` };

  const cur = await (await fetch(groupUrl, { headers: auth })).json();
  if (!cur.success) throw new Error(`Access group read failed: ${JSON.stringify(cur.errors)}`);
  const include = cur.result.include ?? [];
  const already = include.some((r) => r.email?.email?.toLowerCase() === email);
  if (!already) {
    const upd = await (await fetch(groupUrl, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: cur.result.name, include: [...include, { email: { email } }] }),
    })).json();
    if (!upd.success) throw new Error(`Access group update failed: ${JSON.stringify(upd.errors)}`);
  }

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      reply_to: invitedBy,
      subject: "You can now track Zara's game stats",
      text: [
        `${invitedBy} has added you to Zara Thomas's basketball stat tracker.`,
        "",
        "Getting set up (2 minutes, on your phone):",
        "",
        "1. Open https://zara-thomas.com/track",
        `2. Sign in as ${email} — use Google, or have a one-time code emailed to you. No password to create.`,
        "3. In Safari, tap Share → \u201cAdd to Home Screen\u201d. It opens like an app from then on.",
        "",
        "Using it:",
        "- Tap \u201c+ New game\u201d before tip-off, then log each play with the big buttons.",
        "- The undo bar at the bottom reverses the last tap.",
        "- It works with no signal at the stadium — everything saves on your phone and syncs later.",
        "- One person tracks a given game. If someone else is already on it, sit this one out.",
        "",
        "Everything logged appears on the public report at https://zara-thomas.com/stats",
        "",
        `Questions — just reply, this goes to ${invitedBy}.`,
      ].join("\n"),
    }),
  });
  if (!sent.ok) {
    console.error(JSON.stringify({ msg: "invite email failed", status: sent.status, to: email }));
  }
  console.log(JSON.stringify({ msg: "invite", to: email, by: invitedBy, added: !already, emailed: sent.ok }));
  return {
    ok: true,
    added: !already,
    emailed: sent.ok,
    message: already
      ? (sent.ok ? "Already had access — instructions re-sent." : "Already had access; the email failed, but they can sign in.")
      : (sent.ok ? `Invited — ${email} has access and instructions are on the way.`
                 : `Access granted, but the email failed to send — tell ${email} to open zara-thomas.com/track and sign in.`),
  };
}
