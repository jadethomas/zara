/**
 * D1 queries. Totals are always recomputed from stat_events — there is no
 * stored box score to drift out of sync with the events.
 */

export const EVENT_TYPES = new Set([
  "p2m", "p2x", "p3m", "p3x", "ftm", "ftx",
  "orb", "drb", "ast", "stl", "blk", "tov", "pf",
]);
export const QUARTERS = new Set(["Q1", "Q2", "Q3", "Q4", "OT"]);

// One aggregate expression per event type, filtered to live events.
const BOX_COLUMNS = [...EVENT_TYPES]
  .map((t) => `SUM(CASE WHEN e.type = '${t}' AND e.deleted = 0 THEN 1 ELSE 0 END) AS ${t}`)
  .join(", ");

/** Derived numbers every caller wants. Percentages are null when unattempted. */
export function derive(box) {
  const fga = box.p2m + box.p2x + box.p3m + box.p3x;
  const fgm = box.p2m + box.p3m;
  const p3a = box.p3m + box.p3x;
  const fta = box.ftm + box.ftx;
  const pct = (m, a) => (a > 0 ? Math.round((m / a) * 1000) / 10 : null);
  return {
    pts: 2 * box.p2m + 3 * box.p3m + box.ftm,
    reb: box.orb + box.drb,
    fgm, fga, fg_pct: pct(fgm, fga),
    p3m: box.p3m, p3a, p3_pct: pct(box.p3m, p3a),
    ftm: box.ftm, fta, ft_pct: pct(box.ftm, fta),
  };
}

function filters(season, competition, { includeDeleted = false } = {}) {
  const where = includeDeleted ? ["1 = 1"] : ["g.deleted = 0"];
  const args = [];
  if (season) { where.push("g.season = ?"); args.push(season); }
  if (competition) { where.push("g.competition = ?"); args.push(competition); }
  return { where: where.join(" AND "), args };
}

/** Game log with a computed box score per game, newest first. */
export async function gamesWithBox(db, { season, competition, includePrivate = false } = {}) {
  // The private listing must include soft-deleted games: the tracker's pull
  // distinguishes "deleted (restorable)" from "purged (gone)" by whether the
  // game still appears here at all.
  const f = filters(season, competition, { includeDeleted: includePrivate });
  const cols = includePrivate ? "g.*" : `g.id, g.date, g.opponent, g.competition,
       g.home_away, g.final_us, g.final_them, g.season`;
  const rows = await db.prepare(
    `SELECT ${cols}, ${BOX_COLUMNS}
       FROM games g
       LEFT JOIN stat_events e ON e.game_id = g.id
      WHERE ${f.where}
      GROUP BY g.id
      ORDER BY g.date DESC, g.id`
  ).bind(...f.args).all();
  return rows.results.map((r) => ({ ...r, ...derive(r) }));
}

/** Season/competition values that exist, for the report's filter controls. */
export async function filterValues(db) {
  const rows = await db.prepare(
    `SELECT DISTINCT season, competition FROM games WHERE deleted = 0`
  ).all();
  const seasons = [...new Set(rows.results.map((r) => r.season))].sort().reverse();
  const competitions = [...new Set(rows.results.map((r) => r.competition).filter(Boolean))].sort();
  return { seasons, competitions };
}

/** Shot events carrying a location, joined to their (live) game. */
export async function shots(db, { season, competition } = {}) {
  const f = filters(season, competition);
  const rows = await db.prepare(
    `SELECT e.x, e.y, e.type, g.date, g.opponent
       FROM stat_events e
       JOIN games g ON g.id = e.game_id
      WHERE ${f.where} AND e.deleted = 0 AND e.x IS NOT NULL AND e.y IS NOT NULL
        AND e.type IN ('p2m','p2x','p3m','p3x')
      ORDER BY g.date, e.ts`
  ).bind(...f.args).all();
  return rows.results.map((r) => ({
    x: r.x, y: r.y, date: r.date, opponent: r.opponent,
    made: r.type.endsWith("m"),
    three: r.type.startsWith("p3"),
  }));
}

/** Live events for one game, oldest first — the tracker's edit view. */
export async function eventsForGame(db, gameId) {
  const rows = await db.prepare(
    `SELECT id, type, quarter, ts, x, y, recorded_by
       FROM stat_events WHERE game_id = ? AND deleted = 0 ORDER BY ts, id`
  ).bind(gameId).all();
  return rows.results;
}

/** Hard delete: the game and every event under it, atomically. Soft delete
 * (deleted = 1 via sync) is the normal path; this is for purging test games. */
export async function purgeGame(db, id) {
  await db.batch([
    db.prepare("DELETE FROM stat_events WHERE game_id = ?").bind(id),
    db.prepare("DELETE FROM games WHERE id = ?").bind(id),
  ]);
}

/**
 * Upsert a sync batch. Every statement is an upsert on the client-generated
 * id, so replaying the same batch is a no-op — retries cannot duplicate.
 * Game metadata is last-writer-wins on updated_at; events overwrite whole.
 * recorded_by is stamped on first insert and never reassigned.
 *
 * Events whose game no longer exists (purged) are SKIPPED and reported back,
 * not inserted: the batch is atomic, so one orphaned event would otherwise
 * fail the FK check and poison every retry of that client's queue.
 */
export async function applySync(db, { games = [], events = [] }, email) {
  const batchGameIds = new Set(games.map((g) => g.id));
  const candidates = [...new Set(events.map((e) => e.game_id))].filter((id) => !batchGameIds.has(id));
  const known = new Set();
  for (let i = 0; i < candidates.length; i += 50) { // D1 bound-parameter limit
    const chunk = candidates.slice(i, i + 50);
    const rows = await db.prepare(
      `SELECT id FROM games WHERE id IN (${chunk.map(() => "?").join(",")})`
    ).bind(...chunk).all();
    for (const r of rows.results) known.add(r.id);
  }
  const ok = (e) => batchGameIds.has(e.game_id) || known.has(e.game_id);
  const skipped = events.filter((e) => !ok(e)).map((e) => e.id);
  events = events.filter(ok);

  const stmts = [];
  const gameStmt = db.prepare(
    `INSERT INTO games (id, date, opponent, competition, home_away,
                        final_us, final_them, season, recorded_by, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date, opponent = excluded.opponent,
       competition = excluded.competition, home_away = excluded.home_away,
       final_us = excluded.final_us, final_them = excluded.final_them,
       season = excluded.season, updated_at = excluded.updated_at,
       deleted = excluded.deleted
     WHERE excluded.updated_at >= games.updated_at`
  );
  for (const g of games) {
    stmts.push(gameStmt.bind(
      g.id, g.date, g.opponent, g.competition ?? "", g.home_away ?? "home",
      g.final_us ?? null, g.final_them ?? null, g.season, email,
      g.updated_at, g.deleted ? 1 : 0,
    ));
  }
  const eventStmt = db.prepare(
    `INSERT INTO stat_events (id, game_id, type, quarter, ts, x, y, recorded_by, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type, quarter = excluded.quarter, ts = excluded.ts,
       x = excluded.x, y = excluded.y, deleted = excluded.deleted`
  );
  for (const e of events) {
    stmts.push(eventStmt.bind(
      e.id, e.game_id, e.type, e.quarter, e.ts,
      e.x ?? null, e.y ?? null, email, e.deleted ? 1 : 0,
    ));
  }
  if (stmts.length) await db.batch(stmts); // atomic: all rows land or none do
  return { games: games.length, events: events.length, skipped_events: skipped };
}
