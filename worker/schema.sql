-- zara-stats schema. Idempotent: safe to re-run, but note that
-- CREATE TABLE IF NOT EXISTS will not add columns to an existing table —
-- schema changes need explicit ALTER TABLE against the remote database.

-- One row per game. IDs are client-generated UUIDs so the tracker can create
-- games offline and sync is a retry-safe upsert. Rows are soft-deleted
-- (deleted = 1) so a delete syncs the same way as everything else.
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,              -- YYYY-MM-DD, NZ local date of tip-off
  opponent    TEXT NOT NULL,
  competition TEXT NOT NULL DEFAULT '',
  home_away   TEXT NOT NULL DEFAULT 'home'
              CHECK (home_away IN ('home', 'away', 'neutral')),
  final_us    INTEGER,                    -- entered after the game; NULL until then
  final_them  INTEGER,
  season      TEXT NOT NULL,              -- '2026' — calendar year of date
  recorded_by TEXT NOT NULL DEFAULT '',   -- Access email, stamped by the Worker
  updated_at  TEXT NOT NULL,              -- ISO; last-writer-wins for metadata edits
  deleted     INTEGER NOT NULL DEFAULT 0
);

-- Every individual stat event, so totals can always be recalculated.
-- Events are append-only apart from the deleted flag (undo) and shot x/y.
CREATE TABLE IF NOT EXISTS stat_events (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES games(id),
  type        TEXT NOT NULL
              CHECK (type IN ('p2m','p2x','p3m','p3x','ftm','ftx',
                              'orb','drb','ast','stl','blk','tov','pf')),
  quarter     TEXT NOT NULL
              CHECK (quarter IN ('Q1','Q2','Q3','Q4','OT')),
  ts          TEXT NOT NULL,              -- ISO timestamp from the client clock
  x           REAL,                       -- shot location, 0..1 across the court width
  y           REAL,                       -- 0 = baseline, 1 = halfway line
  recorded_by TEXT NOT NULL DEFAULT '',
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_game ON stat_events (game_id);
