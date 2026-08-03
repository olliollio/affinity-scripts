/**
 * The three invariants that catch nearly every real decomposition bug.
 *
 *   1. Area conservation  — sum(area of parts) ~= area(outer) - sum(area of holes).
 *                           Catches dropped triangles, double-counted regions, hole leakage.
 *   2. Convexity          — every part convex, positively wound, within the vertex cap.
 *                           Catches bad Hertel-Mehlhorn merges here rather than in a planck assert.
 *   3. Hole exclusion     — points strictly inside a hole land inside no part.
 *                           Catches "holes silently ignored", which is exactly the v1.1 bug.
 *
 * Test-side only: these deliberately re-derive everything from raw coordinates instead of
 * reusing src/ helpers beyond signedArea/pointInRing, so a bug in the module under test cannot
 * hide behind the same bug in its checker.
 */

'use strict';

function ringArea(PD, ring) { return Math.abs(PD.signedArea(ring)); }

// Net solid area a face should have once decomposed.
function faceArea(PD, face) {
  var a = ringArea(PD, face.outer);
  var holes = face.holes || [];
  for (var i = 0; i < holes.length; i++) a -= ringArea(PD, holes[i]);
  return a;
}

function partsArea(PD, parts) {
  var a = 0;
  for (var i = 0; i < parts.length; i++) a += ringArea(PD, parts[i]);
  return a;
}

/**
 * @return {{ok: boolean, reason: string}} why a part is unacceptable to planck, if it is.
 */
function checkConvexPart(PD, part, maxVerts) {
  var n = part.length >> 1;
  if (n < 3) return { ok: false, reason: 'only ' + n + ' vertices' };
  if (n > maxVerts) return { ok: false, reason: n + ' vertices exceeds the cap of ' + maxVerts };
  if (PD.signedArea(part) <= 0) return { ok: false, reason: 'winding is not positive' };

  var crosses = [];
  var maxAbs = 0;
  for (var i = 0; i < n; i++) {
    var p = (i + n - 1) % n, q = (i + 1) % n;
    var ax = part[i * 2] - part[p * 2], ay = part[i * 2 + 1] - part[p * 2 + 1];
    var bx = part[q * 2] - part[i * 2], by = part[q * 2 + 1] - part[i * 2 + 1];
    var cross = ax * by - ay * bx;
    crosses.push(cross);
    if (Math.abs(cross) > maxAbs) maxAbs = Math.abs(cross);
  }
  // Collinear vertices are harmless (planck welds them); a genuine reflex corner is not, and is
  // orders of magnitude larger than the rounding noise this tolerance absorbs.
  var eps = 1e-9 * maxAbs;
  for (var j = 0; j < crosses.length; j++) {
    if (crosses[j] < -eps) return { ok: false, reason: 'vertex ' + j + ' is reflex (' + crosses[j] + ')' };
  }
  return { ok: true, reason: '' };
}

function distToSegment(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var len2 = dx * dx + dy * dy;
  var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  var qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function distToRing(ring, px, py) {
  var n = ring.length >> 1;
  var best = Infinity;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var d = distToSegment(px, py, ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Grid-samples points that are strictly inside `hole` — at least `margin` away from its boundary,
 * so a sample sitting on a shared edge cannot be mistaken for leakage.
 */
function sampleInside(PD, hole, steps, margin) {
  var n = hole.length >> 1;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < n; i++) {
    var x = hole[i * 2], y = hole[i * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  var out = [];
  for (var gx = 1; gx < steps; gx++) {
    for (var gy = 1; gy < steps; gy++) {
      var px = minX + (maxX - minX) * gx / steps;
      var py = minY + (maxY - minY) * gy / steps;
      if (!PD.pointInRing(hole, px, py)) continue;
      if (distToRing(hole, px, py) < margin) continue;
      out.push([px, py]);
    }
  }
  return out;
}

/**
 * @return {{ok: boolean, reason: string, samples: number}} whether any part covers hole interior.
 */
function checkHoleExclusion(PD, face, parts, opts) {
  var o = opts || {};
  var steps = o.steps || 7;
  var holes = face.holes || [];
  var checked = 0;
  for (var i = 0; i < holes.length; i++) {
    var margin = o.margin !== undefined ? o.margin : Math.sqrt(Math.abs(PD.signedArea(holes[i]))) * 0.02;
    var pts = sampleInside(PD, holes[i], steps, margin);
    for (var s = 0; s < pts.length; s++) {
      checked++;
      for (var p = 0; p < parts.length; p++) {
        if (PD.pointInRing(parts[p], pts[s][0], pts[s][1])) {
          return {
            ok: false,
            samples: checked,
            reason: 'part ' + p + ' covers (' + pts[s][0].toFixed(3) + ', ' + pts[s][1].toFixed(3) + ') inside hole ' + i
          };
        }
      }
    }
  }
  return { ok: true, reason: '', samples: checked };
}

/**
 * Runs all three invariants over one decomposition and reports them as named assertions.
 */
function assertInvariants(PD, h, label, face, parts, opts) {
  var o = opts || {};
  var maxVerts = o.maxVerts || PD.MAX_VERTS;
  var tol = o.areaTol || 1e-3; // 0.1% relative

  var want = faceArea(PD, face);
  var got = partsArea(PD, parts);
  h.assert(label + ': area is conserved', Math.abs(got - want) <= tol * Math.max(want, 1e-9),
    'expected ' + want.toFixed(4) + ' got ' + got.toFixed(4));

  var bad = null;
  for (var i = 0; i < parts.length && !bad; i++) {
    var res = checkConvexPart(PD, parts[i], maxVerts);
    if (!res.ok) bad = 'part ' + i + ': ' + res.reason;
  }
  h.assert(label + ': every part is convex, positive and within the cap', bad === null, bad || '');

  var holes = (face.holes || []).length;
  if (holes) {
    var ex = checkHoleExclusion(PD, face, parts, o);
    h.assert(label + ': no part leaks into a hole', ex.ok, ex.reason);
  }
}

module.exports = {
  faceArea: faceArea,
  partsArea: partsArea,
  checkConvexPart: checkConvexPart,
  checkHoleExclusion: checkHoleExclusion,
  sampleInside: sampleInside,
  assertInvariants: assertInvariants
};
