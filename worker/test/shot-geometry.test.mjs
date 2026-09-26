import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isThreePointLocation, shotTypeForLocation } = require("../../track/shot-geometry.js");

// Coordinates are normalised: x 0..1 across the width, y 0 baseline .. 1 halfway.
// Drawn court: hoop (75,16), corner lines x=8/142 to y=30, arc r=67 about (75,30).

test("under the basket is a two", () => {
  assert.equal(isThreePointLocation(0.5, 16 / 140), false);
});

test("free-throw line area is a two", () => {
  assert.equal(isThreePointLocation(0.5, 59 / 140), false);
});

test("beyond the top of the arc is a three", () => {
  // (75, 100): 70 svg units from the arc centre — outside r=67
  assert.equal(isThreePointLocation(0.5, 100 / 140), true);
});

test("corner three: outside the corner line, shallow angle", () => {
  assert.equal(isThreePointLocation(4 / 150, 20 / 140), true);
});

test("just inside the corner line is a two", () => {
  assert.equal(isThreePointLocation(12 / 150, 20 / 140), false);
});

test("agreeing tap returns null (no correction needed)", () => {
  assert.equal(shotTypeForLocation("p2m", 0.5, 16 / 140), null);
  assert.equal(shotTypeForLocation("p3x", 0.5, 100 / 140), null);
});

test("a 3PT logged inside the arc suggests the matching 2PT", () => {
  assert.equal(shotTypeForLocation("p3m", 0.5, 16 / 140), "p2m");
  assert.equal(shotTypeForLocation("p3x", 0.5, 16 / 140), "p2x");
});

test("a 2PT logged beyond the arc suggests the matching 3PT", () => {
  assert.equal(shotTypeForLocation("p2m", 0.5, 100 / 140), "p3m");
  assert.equal(shotTypeForLocation("p2x", 4 / 150, 20 / 140), "p3x");
});
