/* Zara Stats tracker.
 *
 * Local-first: every tap lands in IndexedDB before anything touches the
 * network, so the tool works courtside with no signal. A background sync
 * pushes dirty rows to /api/track/sync (idempotent upserts keyed on client
 * UUIDs) whenever it can, and pulls games recorded by other trackers.
 */
"use strict";

/* ============================ IndexedDB ============================ */

const DB_NAME = "zara-tracker";
let _db;
function idb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("games", { keyPath: "id" });
      d.createObjectStore("events", { keyPath: "id" }).createIndex("game", "game_id");
      d.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}
const put = (store, val) => tx(store, "readwrite", (s) => s.put(val));
const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key));
const getOne = (store, key) => tx(store, "readonly", (s) => s.get(key));
const getAll = (store) => tx(store, "readonly", (s) => s.getAll());
const eventsFor = (gameId) =>
  tx("events", "readonly", (s) => s.index("game").getAll(gameId));
const metaGet = async (k, fallback) => (await getOne("meta", k))?.v ?? fallback;
const metaSet = (k, v) => put("meta", { k, v });

/* ============================ helpers ============================ */

const $ = (sel) => document.querySelector(sel);
const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();
const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

const LABELS = {
  p2m: "2PT make", p2x: "2PT miss", p3m: "3PT make", p3x: "3PT miss",
  ftm: "FT make", ftx: "FT miss", orb: "Off. rebound", drb: "Def. rebound",
  ast: "Assist", stl: "Steal", blk: "Block", tov: "Turnover", pf: "Foul",
};

function boxScore(events) {
  const c = {};
  for (const k of Object.keys(LABELS)) c[k] = 0;
  for (const e of events) if (!e.deleted) c[e.type]++;
  const fga = c.p2m + c.p2x + c.p3m + c.p3x;
  const fgm = c.p2m + c.p3m;
  return {
    ...c,
    pts: 2 * c.p2m + 3 * c.p3m + c.ftm,
    reb: c.orb + c.drb,
    fgm, fga,
    fg_pct: fga ? Math.round((fgm / fga) * 1000) / 10 : null,
  };
}

/* ============================ sync ============================ */

const chip = $("#sync-chip");
const authBanner = $("#auth-banner");
let syncTimer = null;

function setChip(state, n) {
  chip.className = "chip " + state;
  chip.textContent = { ok: "synced", pending: `${n} to sync`, offline: "offline", auth: "sign in" }[state];
  authBanner.hidden = state !== "auth";
}

async function pendingCount() {
  const [gs, es] = await Promise.all([getAll("games"), getAll("events")]);
  return gs.filter((g) => g.dirty).length + es.filter((e) => e.dirty).length;
}

function scheduleSync(delay = 2500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}

async function sync() {
  const [gs, es] = await Promise.all([getAll("games"), getAll("events")]);
  const games = gs.filter((g) => g.dirty).map(({ dirty, box, ...g }) => g);
  const events = es.filter((e) => e.dirty).map(({ dirty, ...e }) => e);
  const n = games.length + events.length;
  if (!navigator.onLine) return setChip("offline");
  if (n === 0) { setChip("ok"); return pull(); }
  setChip("pending", n);
  try {
    const res = await fetch("/api/track/sync", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ games, events }),
    });
    if (res.type === "opaqueredirect" || res.status === 302) return setChip("auth");
    if (!res.ok) throw new Error(`sync ${res.status}`);
    // Clear dirty flags only on what was sent — taps that landed mid-flight
    // keep their flag and go next round.
    for (const g of games) {
      const cur = await getOne("games", g.id);
      if (cur && cur.updated_at === g.updated_at) await put("games", { ...cur, dirty: 0 });
    }
    for (const e of events) {
      const cur = await getOne("events", e.id);
      if (cur && !!cur.deleted === !!e.deleted) await put("events", { ...cur, dirty: 0 });
    }
    const left = await pendingCount();
    setChip(left ? "pending" : "ok", left);
    if (left) scheduleSync();
  } catch {
    setChip("offline");
  }
}

/* Pull games other trackers recorded (and deletions from anywhere). Local
 * dirty rows always win; the server copy lands only over clean rows. */
async function pull() {
  try {
    const res = await fetch("/api/track/games", { redirect: "manual" });
    if (res.type === "opaqueredirect" || !res.ok) return;
    const server = await res.json();
    for (const sg of server) {
      const local = await getOne("games", sg.id);
      if (local?.dirty) continue;
      if (sg.deleted) {
        if (local) await del("games", sg.id);
        continue;
      }
      const { p2m, p2x, p3m, p3x, ftm, ftx, orb, drb, ast, stl, blk, tov, pf, pts, reb, fg_pct } = sg;
      await put("games", {
        id: sg.id, date: sg.date, opponent: sg.opponent, competition: sg.competition,
        home_away: sg.home_away, final_us: sg.final_us, final_them: sg.final_them,
        season: sg.season, updated_at: sg.updated_at, deleted: 0, dirty: 0,
        box: { p2m, p2x, p3m, p3x, ftm, ftx, orb, drb, ast, stl, blk, tov, pf, pts, reb, fg_pct },
      });
    }
    if (view === "list") renderList();
  } catch { /* offline — fine */ }
}

$("#relogin").addEventListener("click", () => location.reload());
chip.addEventListener("click", () => sync());
addEventListener("online", () => sync());
addEventListener("offline", () => setChip("offline"));
setInterval(sync, 60_000);

/* ============================ views ============================ */

let view = "list";
let curGame = null;      // game record being tracked
let quarter = "Q1";
let editingId = null;    // game id in the form, null = new

function show(name) {
  view = name;
  for (const v of ["list", "form", "game"]) $(`#view-${v}`).hidden = v !== name;
  $("#back").hidden = name === "list";
}

function setTitle(main, sub = "") {
  $("#bar-main").textContent = main;
  $("#bar-sub").textContent = sub;
}

$("#back").addEventListener("click", () => openList());

/* ---------- list ---------- */

async function openList() {
  show("list");
  setTitle("Zara Stats", "");
  await renderList();
}

async function renderList() {
  const games = (await getAll("games"))
    .filter((g) => !g.deleted)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const ul = $("#game-list");
  ul.textContent = "";
  for (const g of games) {
    const events = await eventsFor(g.id);
    const box = events.length ? boxScore(events) : (g.box ?? boxScore([]));
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "game-row";
    const score = g.final_us != null && g.final_them != null
      ? `${g.final_us}–${g.final_them}` : `${box.pts} pts`;
    btn.innerHTML = `
      <span class="opp"></span>
      <span class="meta"></span>
      <span class="line">${score}<small>${box.pts} pts · ${box.reb} reb · ${box.ast} ast</small></span>`;
    btn.querySelector(".opp").textContent = (g.home_away === "away" ? "at " : "vs ") + g.opponent;
    btn.querySelector(".meta").textContent =
      `${g.date}${g.competition ? " · " + g.competition : ""}${g.dirty ? " · not synced" : ""}`;
    btn.addEventListener("click", () => openGame(g.id));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

$("#new-game").addEventListener("click", () => openForm(null));

/* ---------- form (new / edit) ---------- */

async function openForm(gameId) {
  editingId = gameId;
  const f = $("#game-form");
  f.reset();
  show("form");
  const g = gameId ? await getOne("games", gameId) : null;
  $("#form-title").textContent = g ? "Game details" : "New game";
  setTitle(g ? "Game details" : "New game");
  $("#form-save").textContent = g ? "Save" : "Start tracking";
  $("#form-delete").hidden = !g;
  f.date.value = g?.date ?? todayLocal();
  f.opponent.value = g?.opponent ?? "";
  f.competition.value = g?.competition ?? "";
  f.home_away.value = g?.home_away ?? "home";
  f.final_us.value = g?.final_us ?? "";
  f.final_them.value = g?.final_them ?? "";

  // competition suggestions from history
  const comps = [...new Set((await getAll("games")).map((x) => x.competition).filter(Boolean))];
  $("#comp-list").innerHTML = comps.map((c) => `<option>${c.replace(/</g, "&lt;")}</option>`).join("");

  // event log for an existing game
  const wrap = $("#event-log-wrap");
  wrap.hidden = !g;
  if (g) renderEventLog(g.id);
}

async function renderEventLog(gameId) {
  const events = (await eventsFor(gameId)).filter((e) => !e.deleted)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const ul = $("#event-log");
  ul.textContent = "";
  for (const e of events) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="q"></span><span class="what"></span><button class="x" aria-label="Delete event">✕</button>`;
    li.querySelector(".q").textContent = e.quarter;
    li.querySelector(".what").textContent = LABELS[e.type] + (e.x != null ? " ·📍" : "");
    li.querySelector(".x").addEventListener("click", async () => {
      await put("events", { ...e, deleted: 1, dirty: 1 });
      renderEventLog(gameId);
      scheduleSync();
    });
    ul.appendChild(li);
  }
  if (!events.length) ul.innerHTML = '<li><span class="what">No events logged.</span></li>';
}

$("#game-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const existing = editingId ? await getOne("games", editingId) : null;
  const g = {
    id: existing?.id ?? uuid(),
    date: f.date.value,
    opponent: f.opponent.value.trim(),
    competition: f.competition.value.trim(),
    home_away: f.home_away.value,
    final_us: f.final_us.value === "" ? null : Number(f.final_us.value),
    final_them: f.final_them.value === "" ? null : Number(f.final_them.value),
    season: f.date.value.slice(0, 4),
    updated_at: nowISO(),
    deleted: 0,
    dirty: 1,
    box: existing?.box,
  };
  await put("games", g);
  scheduleSync();
  openGame(g.id);
});

$("#form-delete").addEventListener("click", async () => {
  const g = await getOne("games", editingId);
  if (!g) return;
  if (!confirm(`Delete the ${g.date} game vs ${g.opponent}? This removes it from the public stats too.`)) return;
  await put("games", { ...g, deleted: 1, updated_at: nowISO(), dirty: 1 });
  scheduleSync();
  openList();
});

/* ---------- tracking ---------- */

async function openGame(gameId) {
  curGame = await getOne("games", gameId);
  if (!curGame) return openList();
  quarter = await metaGet("q:" + gameId, "Q1");
  show("game");
  setTitle(
    (curGame.home_away === "away" ? "at " : "vs ") + curGame.opponent,
    `${curGame.date}${curGame.competition ? " · " + curGame.competition : ""}`,
  );
  await metaSet("view", { name: "game", id: gameId });
  renderQuarter();
  await renderGame();
}

function renderQuarter() {
  for (const b of document.querySelectorAll(".quarters button"))
    b.classList.toggle("on", b.dataset.q === quarter);
}
for (const b of document.querySelectorAll(".quarters button")) {
  b.addEventListener("click", async () => {
    quarter = b.dataset.q;
    await metaSet("q:" + curGame.id, quarter);
    renderQuarter();
  });
}

async function renderGame() {
  const events = await eventsFor(curGame.id);
  const box = boxScore(events);
  $("#scoreline").innerHTML = `
    <div class="cell"><b>${box.pts}</b><span>pts</span></div>
    <div class="cell"><b>${box.reb}</b><span>reb</span></div>
    <div class="cell"><b>${box.ast}</b><span>ast</span></div>
    <div class="cell"><b>${box.fg_pct ?? "–"}</b><span>fg%</span></div>`;
  const live = events.filter((e) => !e.deleted).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const last = live[live.length - 1];
  const u = $("#undo");
  u.disabled = !last;
  u.textContent = last ? `Undo ${LABELS[last.type]} · ${last.quarter}` : "Nothing to undo";
  u.dataset.id = last?.id ?? "";
}

async function logEvent(type, x = null, y = null) {
  await put("events", {
    id: uuid(), game_id: curGame.id, type, quarter,
    ts: nowISO(), x, y, deleted: 0, dirty: 1,
  });
  if (navigator.vibrate) navigator.vibrate(15);
  await renderGame();
  scheduleSync();
}

let pendingShot = null;
for (const b of document.querySelectorAll(".pad-btn[data-type]")) {
  b.addEventListener("click", async () => {
    const type = b.dataset.type;
    const wantsSpot = await metaGet("locate", false);
    if (wantsSpot && ["p2m", "p2x", "p3m", "p3x"].includes(type)) {
      pendingShot = type;
      $("#court-title").textContent = `${LABELS[type]} — where from?`;
      $("#court-overlay").hidden = false;
    } else {
      logEvent(type);
    }
  });
}

$("#court").addEventListener("click", (ev) => {
  const svg = ev.currentTarget;
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const x = Math.min(1, Math.max(0, pt.x / 150));
  const y = Math.min(1, Math.max(0, pt.y / 140));
  const type = pendingShot;
  pendingShot = null;
  $("#court-overlay").hidden = true;
  if (type) logEvent(type, Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
});
$("#court-skip").addEventListener("click", () => {
  const type = pendingShot;
  pendingShot = null;
  $("#court-overlay").hidden = true;
  if (type) logEvent(type);
});

$("#undo").addEventListener("click", async (ev) => {
  const id = ev.currentTarget.dataset.id;
  if (!id) return;
  const e = await getOne("events", id);
  if (!e) return;
  if (e.dirty && !e.deleted) {
    // Never synced — it can simply vanish.
    await del("events", id);
  } else {
    await put("events", { ...e, deleted: 1, dirty: 1 });
  }
  await renderGame();
  scheduleSync();
});

$("#edit-game").addEventListener("click", () => openForm(curGame.id));

/* ---------- settings ---------- */

(async () => {
  const cb = $("#opt-locate");
  cb.checked = await metaGet("locate", false);
  cb.addEventListener("change", () => metaSet("locate", cb.checked));
})();

/* ============================ boot ============================ */

(async () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/track/sw.js").catch(() => {});
  }
  const saved = await metaGet("view", null);
  if (saved?.name === "game" && (await getOne("games", saved.id))) {
    await openGame(saved.id);
  } else {
    await openList();
  }
  sync();
})();

// Leaving the tracking screen clears the restore point.
const _openList = openList;
openList = async function () {
  await metaSet("view", { name: "list" });
  return _openList();
};
