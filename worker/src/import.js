/**
 * Past-game import: extract Zara's row from a box score (photo, PDF or pasted
 * text) with the Claude API, validate it, and hand back an editable draft.
 * Nothing here writes to the database — the tracker shows the result as a
 * review form and the person confirms (or corrects) before anything saves.
 *
 * The API key lives in the ANTHROPIC_API_KEY Wrangler secret and never
 * reaches the browser. ANTHROPIC_BASE_URL is a test seam only.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const count = () => z.number().int().min(0).max(200).nullable();

export const GameExtraction = z.object({
  player_found: z.boolean(),
  date: z.string().nullable(),
  opponent: z.string().nullable(),
  competition: z.string().nullable(),
  home_away: z.enum(["home", "away", "neutral"]).nullable(),
  final_us: count(),
  final_them: count(),
  minutes: count(),
  pts: count(),
  fgm: count(), fga: count(),
  p3m: count(), p3a: count(),
  ftm: count(), fta: count(),
  orb: count(), drb: count(), reb: count(),
  ast: count(), stl: count(), blk: count(), tov: count(), pf: count(),
  notes: z.string().nullable(),
});

/**
 * Consistency checks on extracted (or hand-entered) totals. Pure — the test
 * suite exercises this directly against mocked extraction responses.
 * Returns a list of human-readable problems; empty means consistent.
 */
export function validateTotals(t) {
  const problems = [];
  const has = (...ks) => ks.every((k) => t[k] != null);
  if (has("fgm", "fga") && t.fgm > t.fga) problems.push("FGM is greater than FGA");
  if (has("p3m", "p3a") && t.p3m > t.p3a) problems.push("3PM is greater than 3PA");
  if (has("ftm", "fta") && t.ftm > t.fta) problems.push("FTM is greater than FTA");
  if (has("p3m", "fgm") && t.p3m > t.fgm) problems.push("3PM is greater than FGM (threes are part of field goals)");
  if (has("p3a", "fga") && t.p3a > t.fga) problems.push("3PA is greater than FGA");
  if (has("pts", "fgm", "p3m", "ftm")) {
    const expected = 2 * (t.fgm - t.p3m) + 3 * t.p3m + t.ftm;
    if (t.pts !== expected) {
      problems.push(`PTS is ${t.pts} but the shooting numbers add to ${expected}`);
    }
  }
  if (has("orb", "drb", "reb") && t.orb + t.drb !== t.reb) {
    problems.push(`OREB + DREB is ${t.orb + t.drb} but total REB reads ${t.reb}`);
  }
  return problems;
}

const KINDS = new Set(["image", "pdf", "text"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Shape-check the request body before it costs an API call. */
export function validateImportRequest(body) {
  if (typeof body !== "object" || body === null) return "body must be an object";
  if (!KINDS.has(body.kind)) return "kind must be image, pdf or text";
  if (body.kind === "text") {
    if (typeof body.text !== "string" || !body.text.trim()) return "no text supplied";
    if (body.text.length > 100_000) return "text too long";
  } else {
    if (typeof body.data !== "string" || !body.data) return "no file data supplied";
    if (!/^[A-Za-z0-9+/=]+$/.test(body.data)) return "file data must be base64";
    const cap = body.kind === "pdf" ? 16_000_000 : 8_000_000;
    if (body.data.length > cap) return "file too large";
    if (body.kind === "image" && !IMAGE_TYPES.has(body.media_type)) {
      return "image must be JPEG, PNG, WebP or GIF";
    }
  }
  return null;
}

function contentFor(body, jersey) {
  const instruction = {
    type: "text",
    text:
      `This is a basketball box score. Extract the statistics row for the player ` +
      `Zara Thomas (jersey number ${jersey}). Match on the name if it appears, ` +
      `otherwise on the jersey number. If she is not in this box score, set ` +
      `player_found to false and every other field to null.\n\n` +
      `Also extract, when present on the sheet: the game date (as YYYY-MM-DD), ` +
      `the opposing team, the competition or tournament name, whether Zara's team ` +
      `was home or away, and the final score (final_us is Zara's team's score).\n\n` +
      `Rules:\n` +
      `- Copy numbers exactly as printed; never derive a value the sheet does not show.\n` +
      `- Set any statistic the sheet does not show to null. If it shows only total ` +
      `rebounds, fill reb and leave orb and drb null.\n` +
      `- fgm/fga include threes, as is standard.\n` +
      `- Use notes for anything ambiguous (unclear digits, two candidate rows, etc.), otherwise null.`,
  };
  if (body.kind === "text") {
    return [instruction, { type: "text", text: body.text }];
  }
  if (body.kind === "pdf") {
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.data } },
      instruction,
    ];
  }
  return [
    { type: "image", source: { type: "base64", media_type: body.media_type, data: body.data } },
    instruction,
  ];
}

/** Call Claude, return { game, problems } or throw. */
export async function extractGame(env, body) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
  });
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: contentFor(body, env.ZARA_JERSEY || "13") }],
    output_config: { format: zodOutputFormat(GameExtraction, "game_extraction") },
  });
  if (response.stop_reason === "refusal") {
    throw new Error("the model declined to process this file");
  }
  const game = response.parsed_output;
  if (!game) throw new Error("extraction returned no parseable result");
  return { game, problems: game.player_found ? validateTotals(game) : [] };
}
