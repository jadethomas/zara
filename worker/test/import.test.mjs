import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTotals, validateImportRequest, GameExtraction } from "../src/import.js";

/* A mocked Claude API extraction — the exact object shape the structured-
 * output schema produces. Validation logic runs on this, never the network. */
const mockExtraction = (over = {}) => GameExtraction.parse({
  player_found: true,
  date: "2026-06-14", opponent: "Hutt Valley", competition: "U20 Nationals",
  home_away: "neutral", final_us: 71, final_them: 64,
  minutes: 28, pts: 17,
  fgm: 6, fga: 13, p3m: 1, p3a: 4, ftm: 4, fta: 5,
  orb: 3, drb: 7, reb: 10,
  ast: 2, stl: 1, blk: 2, tov: 3, pf: 4,
  notes: null,
  ...over,
});

test("a consistent extraction has no problems", () => {
  assert.deepEqual(validateTotals(mockExtraction()), []);
});

test("FGM greater than FGA is flagged", () => {
  const p = validateTotals(mockExtraction({ fgm: 14 }));
  assert.ok(p.some((m) => m.includes("FGM is greater than FGA")));
});

test("3PM greater than 3PA is flagged", () => {
  const p = validateTotals(mockExtraction({ p3m: 5, pts: 25 }));
  assert.ok(p.some((m) => m.includes("3PM is greater than 3PA")));
});

test("FTM greater than FTA is flagged", () => {
  const p = validateTotals(mockExtraction({ ftm: 6, pts: 19 }));
  assert.ok(p.some((m) => m.includes("FTM is greater than FTA")));
});

test("points identity: PTS must equal 2×(FGM−3PM) + 3×3PM + FTM", () => {
  const p = validateTotals(mockExtraction({ pts: 20 }));
  assert.ok(p.some((m) => m.includes("PTS is 20 but the shooting numbers add to 17")));
});

test("rebound split must add to the printed total", () => {
  const p = validateTotals(mockExtraction({ orb: 2 }));
  assert.ok(p.some((m) => m.includes("OREB + DREB is 9 but total REB reads 10")));
});

test("null fields skip their checks (sheet showed only total rebounds)", () => {
  assert.deepEqual(validateTotals(mockExtraction({ orb: null, drb: null })), []);
});

test("request validation rejects bad kinds and oversized payloads", () => {
  assert.equal(validateImportRequest({ kind: "docx", data: "aGk=" }), "kind must be image, pdf or text");
  assert.equal(validateImportRequest({ kind: "text", text: "  " }), "no text supplied");
  assert.equal(validateImportRequest({ kind: "image", media_type: "image/tiff", data: "aGk=" }), "image must be JPEG, PNG, WebP or GIF");
  assert.equal(validateImportRequest({ kind: "text", text: "WEGC 71 - 64 HVH ... Thomas 13 ..." }), null);
});
