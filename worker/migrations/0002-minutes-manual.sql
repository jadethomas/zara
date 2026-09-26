-- Adds minutes played (manual entry at the end of a game) and the manual flag
-- (game entered as totals, not event-by-event — the shot chart skips these).
-- CREATE TABLE IF NOT EXISTS cannot add columns, so this must be run
-- explicitly against both local and REMOTE databases:
--   npx wrangler d1 execute zara-stats --local  --file=migrations/0002-minutes-manual.sql
--   npx wrangler d1 execute zara-stats --remote --file=migrations/0002-minutes-manual.sql
ALTER TABLE games ADD COLUMN minutes INTEGER;
ALTER TABLE games ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
