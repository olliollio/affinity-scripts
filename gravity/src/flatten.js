/**
 * flatten.js — cubic beziers to polygon rings. Pure geometry.
 *
 * Affinity hands geometry over as cubic beziers; planck needs straight-edged rings. This module
 * does that conversion on plain numbers, which keeps it on the testable side of the split — the
 * Affinity layer only has to hand over four points per segment.
 *
 * Subdivision is adaptive on FLATNESS rather than uniform in the parameter t. Cubics are not
 * constant-speed, so uniform t bunches points towards the ends of every segment: a long gentle
 * curve gets the same point count as a short sharp one, and both get them in the wrong places.
 * Flatness-based recursion spends points where the curve actually bends.
 */

(function (GR) {
  'use strict';

  // Chord deviation, in source units, under which a segment is emitted as a straight line. This is
  // deliberately finer than the Douglas-Peucker tolerance that runs afterwards: flattening should
  // not decide what is worth keeping, it should only stop being wrong. sanitize.js then removes
  // what the shape does not need.
  var FLATTEN_TOL = 0.1;

  // Recursion guard. 16 subdivisions is 65536 segments for one bezier, far past anything a real
  // outline needs; hitting it means degenerate control points rather than genuine detail.
  var MAX_DEPTH = 16;

  // Control handles this close to their anchor mean the segment is stored as a cubic but is
  // actually a straight line. Affinity stores every straight edge that way, so this is the common
  // case, not an optimisation for rare input.
  var LINE_EPS = 1e-9;

  function isLine(x0, y0, c1x, c1y, c2x, c2y, x3, y3) {
    var dx = x3 - x0, dy = y3 - y0;
    var len2 = dx * dx + dy * dy;
    if (len2 <= LINE_EPS) {
      // Degenerate chord: only a line if the handles sit on the anchor too.
      return Math.abs(c1x - x0) <= LINE_EPS && Math.abs(c1y - y0) <= LINE_EPS &&
             Math.abs(c2x - x3) <= LINE_EPS && Math.abs(c2y - y3) <= LINE_EPS;
    }
    return Math.abs(c1x - x0) <= LINE_EPS && Math.abs(c1y - y0) <= LINE_EPS &&
           Math.abs(c2x - x3) <= LINE_EPS && Math.abs(c2y - y3) <= LINE_EPS;
  }

  /**
   * Is this cubic within `tol` of its own chord?
   *
   * Uses the standard control-point bound: the curve lies inside the convex hull of its control
   * points, so the larger of the two handles' distances from the chord bounds the true deviation.
   * Cheap, conservative, and needs no square roots until the very end.
   */
  function flatEnough(x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol) {
    var dx = x3 - x0, dy = y3 - y0;
    var len2 = dx * dx + dy * dy;

    if (len2 <= LINE_EPS) {
      // A closed loop of zero chord length: fall back to raw handle distance from the anchor.
      var a1 = (c1x - x0) * (c1x - x0) + (c1y - y0) * (c1y - y0);
      var a2 = (c2x - x0) * (c2x - x0) + (c2y - y0) * (c2y - y0);
      return Math.max(a1, a2) <= tol * tol;
    }

    // Perpendicular distance of each handle from the chord, kept squared.
    var d1 = (c1x - x0) * dy - (c1y - y0) * dx;
    var d2 = (c2x - x0) * dy - (c2y - y0) * dx;
    var worst = Math.max(d1 * d1, d2 * d2);
    return worst <= tol * tol * len2;
  }

  /** De Casteljau split at t = 0.5, which is where an adaptive subdivision always splits. */
  function subdivide(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol, depth) {
    if (depth >= MAX_DEPTH || flatEnough(x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol)) {
      out.push(x3, y3);
      return;
    }
    var ax = (x0 + c1x) / 2, ay = (y0 + c1y) / 2;
    var bx = (c1x + c2x) / 2, by = (c1y + c2y) / 2;
    var cx = (c2x + x3) / 2, cy = (c2y + y3) / 2;
    var dx = (ax + bx) / 2, dy = (ay + by) / 2;
    var ex = (bx + cx) / 2, ey = (by + cy) / 2;
    var mx = (dx + ex) / 2, my = (dy + ey) / 2;

    subdivide(out, x0, y0, ax, ay, dx, dy, mx, my, tol, depth + 1);
    subdivide(out, mx, my, ex, ey, cx, cy, x3, y3, tol, depth + 1);
  }

  /**
   * One cubic to points, appending everything AFTER the start point.
   *
   * The start is the caller's job because consecutive segments share an anchor; emitting it here
   * would duplicate every joint and sanitize.js would only have to strip them again.
   */
  function flattenCubic(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, tol) {
    var t = tol === undefined ? FLATTEN_TOL : tol;
    if (isLine(x0, y0, c1x, c1y, c2x, c2y, x3, y3)) {
      out.push(x3, y3);
      return out;
    }
    subdivide(out, x0, y0, c1x, c1y, c2x, c2y, x3, y3, t, 0);
    return out;
  }

  /**
   * A list of segments to one flat ring.
   *
   * `segments` is an array of `{start:{x,y}, c1:{x,y}, c2:{x,y}, end:{x,y}}` — the shape Affinity's
   * `curve.beziers` yields, reduced to plain numbers by the caller. The ring is implicitly closed,
   * matching the convention the rest of the pipeline uses, so the final point is dropped when it
   * coincides with the first.
   */
  function flattenSegments(segments, opts) {
    var o = opts || {};
    var tol = o.flattenTol === undefined ? FLATTEN_TOL : o.flattenTol;
    if (!segments || !segments.length) return [];

    var out = [];
    var first = segments[0];
    out.push(first.start.x, first.start.y);

    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      flattenCubic(out, s.start.x, s.start.y, s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.end.x, s.end.y, tol);
    }

    // Implicitly closed: drop a trailing point that repeats the first.
    if (out.length >= 4) {
      var n = out.length;
      if (Math.abs(out[n - 2] - out[0]) <= LINE_EPS && Math.abs(out[n - 1] - out[1]) <= LINE_EPS) {
        out.length = n - 2;
      }
    }
    return out;
  }

  /**
   * Applies a row-major 2x3 transform `[a, b, tx, c, d, ty]` to a ring, in place.
   *
   * This is how base-space curve coordinates become spread-space ones. The matrix comes from
   * `node.baseToSpreadTransform`, which is the only one of the three with the ancestors composed
   * into it. `node.transform` is the node's LOCAL matrix and `node.localToSpreadTransform` is the
   * parent chain without the node — either one alone lands the geometry in the wrong place as soon
   * as an ancestor carries a scale.
   */
  function transformRing(ring, m) {
    if (!m) return ring;
    var a = m[0], b = m[1], tx = m[2], c = m[3], d = m[4], ty = m[5];
    for (var i = 0; i < ring.length; i += 2) {
      var x = ring[i], y = ring[i + 1];
      ring[i] = a * x + b * y + tx;
      ring[i + 1] = c * x + d * y + ty;
    }
    return ring;
  }

  /**
   * The axis-aligned box a RECTANGLE occupies after a transform, as `{x0, y0, x1, y1}`.
   *
   * This is not the same thing as transforming a shape and boxing the result, and the difference is
   * the whole reason this exists. Affinity's `node.spreadBaseBox` is computed exactly this way —
   * the four corners of `node.baseBox` pushed through the matrix, then boxed — so it INFLATES under
   * rotation even when the artwork does not. A circle is the clearest case: rotate it and its true
   * box is unchanged, while its bounding square's box grows by `|cos t| + |sin t|`, up to 41% at
   * 45 degrees.
   *
   * Verified against six nodes from a real run, matching `spreadBaseBox` to within 0.18pt — which
   * is itself just the rounding in the 3-decimal matrix those numbers were read from.
   *
   * `box` is `{x, y, width, height}`, the shape Affinity's box objects have.
   */
  function boxUnderMatrix(box, m) {
    if (!box) return null;
    var x = box.x, y = box.y, w = box.width, h = box.height;
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;
    // A null matrix means base and spread already agree, so the box passes through unchanged.
    var corners = [x, y, x + w, y, x, y + h, x + w, y + h];
    if (m) transformRing(corners, m);
    var x0 = corners[0], y0 = corners[1], x1 = corners[0], y1 = corners[1];
    for (var i = 2; i < corners.length; i += 2) {
      if (corners[i] < x0) x0 = corners[i];
      if (corners[i] > x1) x1 = corners[i];
      if (corners[i + 1] < y0) y0 = corners[i + 1];
      if (corners[i + 1] > y1) y1 = corners[i + 1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /**
   * Inverts a row-major 2x3 transform, so spread-space coordinates can be written back as base.
   *
   * Extraction only ever goes one way — base to spread — because a rigid body is moved with
   * `createTransform`, which already works in spread space and never needs the return trip. A ROPE
   * does need it: a rope deforms, so playback rewrites its geometry with `createSetCurves`, and
   * that writes into the node's own BASE space. Handing it spread coordinates displaces the rope by
   * exactly the node's own transform — invisibly correct on a node that has never been moved, and
   * wrong on every other, which is precisely how this surfaced.
   *
   * Returns null for a null or singular matrix. Singular means the node has been scaled to nothing
   * on some axis, and there is no sensible inverse to invent; callers fall back to writing the
   * points unchanged, which is what they did before this existed.
   */
  function invertMatrix(m) {
    if (!m) return null;
    var a = m[0], b = m[1], tx = m[2], c = m[3], d = m[4], ty = m[5];
    var det = a * d - b * c;
    if (!det || !isFinite(det)) return null;
    return [
      d / det, -b / det, (b * ty - d * tx) / det,
      -c / det, a / det, (c * tx - a * ty) / det
    ];
  }

  GR.flattenCubic = flattenCubic;
  GR.flattenSegments = flattenSegments;
  GR.transformRing = transformRing;
  GR.boxUnderMatrix = boxUnderMatrix;
  GR.invertMatrix = invertMatrix;
  GR.FLATTEN_TOL = FLATTEN_TOL;

})(GR);
