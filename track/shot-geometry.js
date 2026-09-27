/* Shot-location geometry, shared between the tracker and the test suite.
 *
 * Coordinates are the tracker's normalised system: x 0..1 across the court
 * width, y 0 at the baseline and 1 at the halfway line. The three-point line
 * is FIBA (viewBox 150×140 at 10 units per metre, baseline at y = 1):
 * basket centre 1.575 m from the baseline -> (75, 16.75), arc radius
 * 6.75 m -> 67.5 units, straight corner sections 0.9 m in from each
 * sideline -> x = 9 and x = 141, meeting the arc at y = 30.9. The courts
 * drawn in the tracker and on the stats page use exactly these numbers —
 * the hit test and the picture must never disagree.
 *
 * UMD-ish wrapper: plain <script> in the tracker, require()-able in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Is a tapped location beyond the three-point line? (FIBA dimensions) */
  function isThreePointLocation(x, y) {
    const sx = x * 150;
    const sy = y * 140;
    if (sy <= 30.9) return sx <= 9 || sx >= 141; // corner threes
    return Math.hypot(sx - 75, sy - 16.75) >= 67.5; // beyond the arc, from the basket
  }

  /**
   * Does a tapped location agree with the logged shot type?
   * Returns null when they agree, otherwise the type the tap implies
   * (make/miss preserved) so the UI can offer to switch to it.
   */
  function shotTypeForLocation(type, x, y) {
    const three = isThreePointLocation(x, y);
    const isThreeType = type === "p3m" || type === "p3x";
    if (three === isThreeType) return null;
    const made = type.endsWith("m");
    return (three ? "p3" : "p2") + (made ? "m" : "x");
  }

  return { isThreePointLocation, shotTypeForLocation };
});
