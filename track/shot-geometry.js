/* Shot-location geometry, shared between the tracker and the test suite.
 *
 * Coordinates are the tracker's normalised system: x 0..1 across the court
 * width, y 0 at the baseline and 1 at the halfway line. The three-point line
 * here matches the arc AS DRAWN on the tracker's court (viewBox 150×140:
 * corner lines at x = 8 and x = 142 down to y = 30, then a radius-67
 * semicircle centred on (75, 30)) — validation must agree with what the
 * person tapping the court can see, not with a survey of the real court.
 *
 * UMD-ish wrapper: plain <script> in the tracker, require()-able in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Is a tapped location beyond the three-point line? */
  function isThreePointLocation(x, y) {
    const sx = x * 150;
    const sy = y * 140;
    if (sy <= 30) return sx <= 8 || sx >= 142; // corner threes
    return Math.hypot(sx - 75, sy - 30) >= 67; // beyond the arc
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
