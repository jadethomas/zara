import { test } from "node:test";
import assert from "node:assert/strict";
import { derive } from "../src/db.js";

const box = (over = {}) => ({
  p2m: 0, p2x: 0, p3m: 0, p3x: 0, ftm: 0, ftx: 0,
  orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
  ...over,
});

test("eFG% counts a made three as one and a half field goals", () => {
  // 2/8 from two plus 2/2 from three: FG 4/10 = 40%, eFG (4 + 1)/10 = 50%
  const d = derive(box({ p2m: 2, p2x: 6, p3m: 2 }));
  assert.equal(d.fg_pct, 40);
  assert.equal(d.efg_pct, 50);
});

test("eFG% equals FG% when no threes are attempted", () => {
  const d = derive(box({ p2m: 3, p2x: 3 }));
  assert.equal(d.fg_pct, 50);
  assert.equal(d.efg_pct, 50);
});

test("eFG% can exceed 100 on a threes-heavy line", () => {
  const d = derive(box({ p3m: 4 })); // 4/4 from three: (4 + 2)/4 = 150%
  assert.equal(d.efg_pct, 150);
});

test("eFG% is null with no field-goal attempts", () => {
  const d = derive(box({ ftm: 2, ftx: 1 }));
  assert.equal(d.efg_pct, null);
  assert.equal(d.pts, 2);
});

test("points identity holds", () => {
  const d = derive(box({ p2m: 5, p3m: 2, ftm: 3 }));
  assert.equal(d.pts, 2 * 5 + 3 * 2 + 3);
});
