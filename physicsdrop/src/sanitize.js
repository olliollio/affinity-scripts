/**
 * sanitize.js — pure geometry. Cleans flattened outlines so earcut and planck can trust them.
 *
 * Rings in, rings out; a ring is a flat, implicitly-closed [x0, y0, x1, y1, ...] array.
 * Nothing here mutates its input.
 */

(function (PD) {
  'use strict';

  // Defaults are in source units (Affinity points), applied before the world scale divide.
  // MERGE_EPS is far below anything a curve flattener emits deliberately; FLAT_EPS is the
  // perpendicular distance under which a vertex counts as sitting on the line through its
  // neighbours — it has to stay well below the sagitta of a real flattened arc (~0.1pt for a
  // 50pt radius at a typical tolerance) or curves get straightened into chords.
  var MERGE_EPS = 1e-6;
  var FLAT_EPS = 1e-4;

  // Perpendicular distance from b to the line a->c. A spike (a and c coincident) reads as 0,
  // which is what we want: the vertex doubles back and carries no area.
  function flatness(ax, ay, bx, by, cx, cy) {
    var ex = cx - ax, ey = cy - ay;
    var len = Math.sqrt(ex * ex + ey * ey);
    if (len === 0) return 0;
    return Math.abs((bx - ax) * ey - (by - ay) * ex) / len;
  }

  /**
   * Drops duplicate, near-duplicate and collinear vertices.
   *
   * @param  {number[]} ring  flat, implicitly-closed coordinate array
   * @param  {{eps?: number, collinearEps?: number}} [opts]
   * @return {number[]|null}  a new ring, or null if nothing with area survived
   */
  function sanitizeRing(ring, opts) {
    var o = opts || {};
    var eps = o.eps === undefined ? MERGE_EPS : o.eps;
    var flatEps = o.collinearEps === undefined ? FLAT_EPS : o.collinearEps;
    if (!ring) return null;

    var n = ring.length >> 1;
    var out = [];
    var i, x, y, dx, dy;

    for (i = 0; i < n; i++) {
      x = ring[i * 2]; y = ring[i * 2 + 1];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (out.length) {
        dx = x - out[out.length - 2]; dy = y - out[out.length - 1];
        if (dx * dx + dy * dy <= eps * eps) continue;
      }
      out.push(x, y);
    }

    // The ring is implicitly closed, so an explicit closing point is a duplicate too.
    while (out.length >= 4) {
      dx = out[0] - out[out.length - 2]; dy = out[1] - out[out.length - 1];
      if (dx * dx + dy * dy <= eps * eps) out.length -= 2; else break;
    }

    // Walk the ring dropping flat vertices. Stepping back one on a removal lets a run of
    // collinear points collapse in a single sweep instead of needing repeated passes.
    i = 0;
    while ((out.length >> 1) >= 3 && i < (out.length >> 1)) {
      var m = out.length >> 1;
      var p = (i + m - 1) % m, q = (i + 1) % m;
      var d = flatness(out[p * 2], out[p * 2 + 1], out[i * 2], out[i * 2 + 1], out[q * 2], out[q * 2 + 1]);
      if (d <= flatEps) {
        out.splice(i * 2, 2);
        if (i > 0) i--;
      } else {
        i++;
      }
    }

    return (out.length >> 1) >= 3 ? out : null;
  }

  /**
   * Returns a copy of `ring` wound the way the caller asked for: positive signed area when
   * `positive` is true. earcut normalises winding internally, but planck requires convex
   * polygons in positive orientation, and the area invariants in the tests assume it too.
   */
  function enforceWinding(ring, positive) {
    var want = positive !== false;
    var isPositive = PD.signedArea(ring) >= 0;
    if (isPositive === want) return ring.slice();

    var out = [];
    for (var i = (ring.length >> 1) - 1; i >= 0; i--) out.push(ring[i * 2], ring[i * 2 + 1]);
    return out;
  }

  // Simplification tolerance: a fraction of the ring's own bounding-box diagonal, never below an
  // absolute floor. Scale-free means the same artwork decomposes into the same parts at 20pt and
  // at 2000pt; the floor stops small art from being simplified into its own rounding noise.
  // Measured on a 250pt-radius "O": 137 convex parts unsimplified, ~38 at this tolerance, for
  // 0.06% area error — invisible on screen, and four times cheaper for the solver.
  var SIMPLIFY_FRAC = 0.0015;
  var SIMPLIFY_MIN = 0.25;

  function bboxDiagonal(ring) {
    var n = ring.length >> 1;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
      var x = ring[i * 2], y = ring[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }

  // Douglas-Peucker over one open chain pts[first..last], marking survivors in `keep`.
  // Iterative on an explicit stack: a pathological chain would otherwise recurse once per vertex,
  // and a raster contour can carry thousands.
  function dpChain(pts, first, last, tol, keep) {
    var stack = [first, last];
    while (stack.length) {
      var e = stack.pop(), s = stack.pop();
      if (e - s < 2) continue;
      var ax = pts[s * 2], ay = pts[s * 2 + 1];
      var cx = pts[e * 2], cy = pts[e * 2 + 1];
      var worst = -1, idx = -1;
      for (var i = s + 1; i < e; i++) {
        var d = flatness(ax, ay, pts[i * 2], pts[i * 2 + 1], cx, cy);
        if (d > worst) { worst = d; idx = i; }
      }
      if (worst > tol && idx !== -1) {
        keep[idx] = true;
        stack.push(s, idx, idx, e);
      }
    }
  }

  // How much area a ring may lose to simplification before the tolerance is considered too
  // coarse for that shape. A chord tolerance is blind to feature thickness: 1.5pt of allowed
  // deviation will eat a 0.2pt hairline whole, or flatten the notch out of a thin stem and turn
  // it into a solid slab. Area is the metric that actually notices, so it is the one that binds.
  var SIMPLIFY_MAX_AREA_FRAC = 0.01;
  var SIMPLIFY_RETRIES = 12;

  // Simplifies as hard as the area budget allows: start at the requested tolerance and halve
  // until the result both survives and stays within budget. Ordinary artwork is accepted on the
  // first try, so this costs nothing in the common case.
  function simplifyWithinBudget(ring, tol, maxFrac) {
    var before = Math.abs(PD.signedArea(ring));
    var t = tol;
    for (var i = 0; i < SIMPLIFY_RETRIES; i++) {
      var candidate = simplifyRing(ring, { simplifyTol: t });
      if (candidate) {
        var after = Math.abs(PD.signedArea(candidate));
        if (before === 0 || Math.abs(after - before) <= maxFrac * before) return candidate;
      }
      t /= 2;
    }
    return ring.slice();
  }

  // The tolerance a whole face should be simplified at, derived from its outer ring.
  function simplifyTolFor(ring, opts) {
    var o = opts || {};
    if (o.simplifyTol !== undefined) return o.simplifyTol;
    var frac = o.simplifyFrac === undefined ? SIMPLIFY_FRAC : o.simplifyFrac;
    var floor = o.simplifyMin === undefined ? SIMPLIFY_MIN : o.simplifyMin;
    return Math.max(floor, frac * bboxDiagonal(ring));
  }

  /**
   * Douglas-Peucker for a closed ring.
   *
   * The ring is cut into two chains at the point farthest from vertex 0, so the result does not
   * depend on where the contour happened to start. Deviation is bounded by the tolerance, so at
   * these magnitudes self-intersection is not a practical concern on font outlines.
   *
   * @param  {number[]} ring
   * @param  {{simplifyTol?: number, simplifyFrac?: number, simplifyMin?: number}} [opts]
   * @return {number[]|null}  a new ring, or null if fewer than 3 points survive
   */
  function simplifyRing(ring, opts) {
    var o = opts || {};
    if (!ring) return null;
    var n = ring.length >> 1;
    if (n <= 3) return n >= 3 ? ring.slice() : null;

    var tol = o.simplifyTol;
    if (tol === undefined) {
      var frac = o.simplifyFrac === undefined ? SIMPLIFY_FRAC : o.simplifyFrac;
      var floor = o.simplifyMin === undefined ? SIMPLIFY_MIN : o.simplifyMin;
      tol = Math.max(floor, frac * bboxDiagonal(ring));
    }
    if (tol <= 0) return ring.slice();

    // Work on an explicitly closed copy so both chains are ordinary open runs.
    var pts = ring.slice();
    pts.push(ring[0], ring[1]);

    var far = -1, anchor = 1;
    for (var i = 1; i < n; i++) {
      var dx = ring[i * 2] - ring[0], dy = ring[i * 2 + 1] - ring[1];
      var d2 = dx * dx + dy * dy;
      if (d2 > far) { far = d2; anchor = i; }
    }

    var keep = new Array(n + 1);
    keep[0] = true; keep[anchor] = true; keep[n] = true;
    dpChain(pts, 0, anchor, tol, keep);
    dpChain(pts, anchor, n, tol, keep);

    var out = [];
    for (var k = 0; k < n; k++) if (keep[k]) out.push(ring[k * 2], ring[k * 2 + 1]);
    return (out.length >> 1) >= 3 ? out : null;
  }

  // Cull thresholds. MIN_AREA is an absolute floor in pt^2 — anything smaller carries no useful
  // mass and only gives the solver something to jitter against. MIN_AREA_FRAC is the same idea
  // expressed scale-free, so a 5pt^2 counter is kept on a 100pt glyph and dropped on a 1000pt
  // one. A hole must clear *both* to survive; the outer ring has no parent, so only the
  // absolute rule can apply to it.
  var MIN_AREA = 0.01;
  var MIN_AREA_FRAC = 1e-4;

  /**
   * Cleans a face for earcut: outer wound positive, holes wound negative, degenerates culled.
   *
   * @param  {{outer: number[], holes?: number[][]}} face
   * @param  {{eps?: number, collinearEps?: number, minArea?: number, minAreaFrac?: number}} [opts]
   * @return {{outer: number[], holes: number[][]}|null}  null when the face is not worth a body
   */
  function sanitizeFace(face, opts) {
    var o = opts || {};
    var minArea = o.minArea === undefined ? MIN_AREA : o.minArea;
    var minFrac = o.minAreaFrac === undefined ? MIN_AREA_FRAC : o.minAreaFrac;
    if (!face || !face.outer) return null;

    var outer = sanitizeRing(face.outer, o);
    if (!outer) return null;

    // One tolerance for the whole face, taken from the outer ring. A counter measured against
    // its own (smaller) diagonal would stay needlessly dense: a 1pt positional error is 1pt
    // wherever it lands, and every vertex kept costs fixture budget downstream.
    var tol = o.simplify === false ? 0 : simplifyTolFor(outer, o);
    var budget = o.simplifyMaxAreaFrac === undefined ? SIMPLIFY_MAX_AREA_FRAC : o.simplifyMaxAreaFrac;
    if (tol > 0) {
      outer = simplifyWithinBudget(outer, tol, budget);
      if (!outer) return null;
    }

    var outerArea = Math.abs(PD.signedArea(outer));
    if (outerArea < minArea) return null;

    var holes = [];
    var src = face.holes || [];
    for (var i = 0; i < src.length; i++) {
      var hole = sanitizeRing(src[i], o);
      if (hole && tol > 0) hole = simplifyWithinBudget(hole, tol, budget);
      if (!hole) continue;
      var area = Math.abs(PD.signedArea(hole));
      if (area < minArea || area < minFrac * outerArea) continue;
      holes.push(enforceWinding(hole, false));
    }

    return { outer: enforceWinding(outer, true), holes: holes };
  }

  PD.sanitizeRing = sanitizeRing;
  PD.simplifyRing = simplifyRing;
  PD.simplifyWithinBudget = simplifyWithinBudget;
  PD.enforceWinding = enforceWinding;
  PD.sanitizeFace = sanitizeFace;

})(PD);
