// Stand-in for api.anthropic.com: returns one fixed structured-output message.
import http from "node:http";
const extraction = {
  player_found: true,
  date: "2026-08-15", opponent: "Hutt Valley High", competition: "U20 Nationals",
  home_away: "neutral", final_us: 71, final_them: 64,
  minutes: 28, pts: 17,
  fgm: 6, fga: 13, p3m: 1, p3a: 4, ftm: 4, fta: 5,
  orb: null, drb: null, reb: 10,
  ast: 2, stl: 1, blk: 2, tov: 3, pf: 4,
  notes: "Digits for FTA slightly smudged; read as 5.",
};
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_stub", type: "message", role: "assistant", model: "claude-opus-5",
      content: [{ type: "text", text: JSON.stringify(extraction) }],
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
}).listen(8912, () => console.log("anthropic stub on 8912"));
