import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isThreePointLocation, shotTypeForLocation } = require("../../track/shot-geometry.js");

/* Coordinates are normalised: x 0..1 across the width, y 0 baseline .. 1 halfway.
 * FIBA court at 10 units per metre in a 150×140 viewBox, baseline y = 1:
 * basket centre (75, 16.75), arc radius 67.5, corner lines x = 9 / x = 141
 * meeting the arc at y = 30.9. Top of the arc sits at y = 84.25. */
const at = (sx, sy) => [sx / 150, sy / 140];

test("under the basket is a two", () => {
  assert.equal(isThreePointLocation(...at(75, 17)), false);
});

test("free-throw line area is a two", () => {
  assert.equal(isThreePointLocation(...at(75, 59)), false);
});

test("just inside the top of the arc is a two", () => {
  // (75, 82): 65.25 from the basket — 2.25 units inside the 67.5 arc
  assert.equal(isThreePointLocation(...at(75, 82)), false);
});

test("just outside the top of the arc is a three", () => {
  // (75, 87): 70.25 from the basket
  assert.equal(isThreePointLocation(...at(75, 87)), true);
});

test("corner three: outside the 0.9 m line", () => {
  assert.equal(isThreePointLocation(...at(8, 15)), true);
  assert.equal(isThreePointLocation(...at(142, 15)), true);
});

test("just inside the corner line is a two", () => {
  assert.equal(isThreePointLocation(...at(10, 15)), false);
  assert.equal(isThreePointLocation(...at(140, 15)), false);
});

test("corner rule hands over to the arc rule continuously at y = 30.9", () => {
  assert.equal(isThreePointLocation(...at(8, 30)), true);   // corner rule
  assert.equal(isThreePointLocation(...at(7, 32)), true);   // arc rule, 68.2 out
  assert.equal(isThreePointLocation(...at(12, 32)), false); // arc rule, 63.3 out
});

/* The tap-vs-type contract, just inside and just outside the arc,
 * for both made and missed variants of both shot types. */

test("3PT tapped just inside the arc suggests the matching 2PT", () => {
  assert.equal(shotTypeForLocation("p3m", ...at(75, 82)), "p2m");
  assert.equal(shotTypeForLocation("p3x", ...at(75, 82)), "p2x");
});

test("3PT tapped just outside the arc is accepted", () => {
  assert.equal(shotTypeForLocation("p3m", ...at(75, 87)), null);
  assert.equal(shotTypeForLocation("p3x", ...at(75, 87)), null);
});

test("2PT tapped just outside the arc suggests the matching 3PT", () => {
  assert.equal(shotTypeForLocation("p2m", ...at(75, 87)), "p3m");
  assert.equal(shotTypeForLocation("p2x", ...at(8, 15)), "p3x"); // corner
});

test("2PT tapped just inside the arc is accepted", () => {
  assert.equal(shotTypeForLocation("p2m", ...at(75, 82)), null);
  assert.equal(shotTypeForLocation("p2x", ...at(10, 15)), null);
});
