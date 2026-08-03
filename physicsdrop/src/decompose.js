/**
 * decompose.js — pure geometry. Face with holes -> convex parts planck can use as fixtures.
 *
 * Neither planck nor Box2D supports a hole in a fixture, so holes are resolved here, before the
 * engine sees anything: earcut triangulates outer + holes natively, then Hertel-Mehlhorn merges
 * the triangles back into as few convex parts as the vertex cap allows.
 */

(function (PD) {
  'use strict';

  // planck's Settings.maxPolygonVertices, which defaults to 12 in planck 1.x (Box2D 2.3 used 8).
  // A polygon with more vertices than this is silently TRUNCATED by planck, not rejected, so the
  // cap has to be enforced here or fixtures quietly lose geometry.
  var MAX_VERTS = 12;

  // Triangles below this are earcut slivers on degenerate input: no mass, but they poison the
  // convexity tests downstream.
  var MIN_TRI_AREA = 1e-12;

  function triArea(coords, a, b, c) {
    return ((coords[b * 2] - coords[a * 2]) * (coords[c * 2 + 1] - coords[a * 2 + 1]) -
            (coords[b * 2 + 1] - coords[a * 2 + 1]) * (coords[c * 2] - coords[a * 2])) / 2;
  }

  // Convexity over a vertex-index polygon. The tolerance is relative to the polygon's own
  // turning magnitudes, so it holds up for a 5pt glyph and a 5000pt one alike. Exactly collinear
  // junctions are allowed through — planck welds them, and refusing them blocks useful merges.
  function isConvex(poly, coords) {
    var n = poly.length;
    var crosses = new Array(n);
    var maxAbs = 0;
    for (var i = 0; i < n; i++) {
      var p = poly[(i + n - 1) % n], q = poly[i], r = poly[(i + 1) % n];
      var ax = coords[q * 2] - coords[p * 2], ay = coords[q * 2 + 1] - coords[p * 2 + 1];
      var bx = coords[r * 2] - coords[q * 2], by = coords[r * 2 + 1] - coords[q * 2 + 1];
      crosses[i] = ax * by - ay * bx;
      if (Math.abs(crosses[i]) > maxAbs) maxAbs = Math.abs(crosses[i]);
    }
    var eps = 1e-9 * maxAbs;
    for (var j = 0; j < n; j++) if (crosses[j] < -eps) return false;
    return true;
  }

  function hasRepeat(poly) {
    for (var i = 0; i < poly.length; i++) {
      for (var j = i + 1; j < poly.length; j++) if (poly[i] === poly[j]) return true;
    }
    return false;
  }

  /**
   * Hertel-Mehlhorn's core step: delete the diagonal a->b shared by two parts and keep the union
   * only if it is still convex and still fits the vertex cap.
   *
   * P runs ... a, b ... and Q runs ... b, a ..., so rotating P to start at b and Q to start at a
   * makes the union a plain concatenation with Q's endpoints (which P already carries) dropped.
   */
  function tryMerge(P, Q, a, b, coords, maxVerts) {
    var i = -1, j = -1, k;
    for (k = 0; k < P.length; k++) if (P[k] === a && P[(k + 1) % P.length] === b) { i = k; break; }
    for (k = 0; k < Q.length; k++) if (Q[k] === b && Q[(k + 1) % Q.length] === a) { j = k; break; }
    if (i === -1 || j === -1) return null;

    var rotP = P.slice(i + 1).concat(P.slice(0, i + 1)); // b ... a
    var rotQ = Q.slice(j + 1).concat(Q.slice(0, j + 1)); // a ... b
    var merged = rotP.concat(rotQ.slice(1, rotQ.length - 1));

    if (merged.length > maxVerts) return null;
    if (hasRepeat(merged)) return null;      // the two parts share more than one edge
    if (!isConvex(merged, coords)) return null;
    return merged;
  }

  /**
   * Face with holes -> convex parts.
   *
   * The face is sanitised on the way in, so this is safe to call on raw contours and idempotent
   * when the pipeline already sanitised them.
   *
   * @param  {{outer: number[], holes?: number[][]}} face
   * @param  {{maxVerts?: number}} [opts]  plus anything sanitizeFace accepts
   * @return {number[][]}  convex, positively wound rings; empty when the face carries no area
   */
  function decompose(face, opts) {
    var o = opts || {};
    var maxVerts = o.maxVerts || MAX_VERTS;
    if (typeof PD.earcut !== 'function') throw new Error('decompose: earcut is not loaded');

    var clean = PD.sanitizeFace(face, o);
    if (!clean) return [];

    // earcut's own input shape: one flat coordinate run, holes marked by starting vertex index.
    var coords = clean.outer.slice();
    var holeStarts = [];
    for (var hi = 0; hi < clean.holes.length; hi++) {
      holeStarts.push(coords.length >> 1);
      coords = coords.concat(clean.holes[hi]);
    }

    var tris = PD.earcut(coords, holeStarts.length ? holeStarts : null, 2);

    var polys = [];
    for (var t = 0; t < tris.length; t += 3) {
      var a = tris[t], b = tris[t + 1], c = tris[t + 2];
      var area = triArea(coords, a, b, c);
      if (Math.abs(area) <= MIN_TRI_AREA) continue;
      polys.push(area > 0 ? [a, b, c] : [a, c, b]);
    }
    if (!polys.length) return [];

    // Directed-edge index: an interior diagonal appears as (a,b) in one part and (b,a) in the
    // other, so the neighbour across an edge is one lookup. Kept incrementally in step with the
    // merges rather than rebuilt, which is what keeps this near-linear on raster-sized input.
    var stride = coords.length >> 1;
    var edge = new Map();
    var alive = [];
    var pi;

    function addEdges(index) {
      var p = polys[index];
      for (var e = 0; e < p.length; e++) edge.set(p[e] * stride + p[(e + 1) % p.length], index);
    }

    function removeEdges(index) {
      var p = polys[index];
      for (var e = 0; e < p.length; e++) edge.delete(p[e] * stride + p[(e + 1) % p.length]);
    }

    for (pi = 0; pi < polys.length; pi++) { alive.push(true); addEdges(pi); }

    var progressed = true;
    while (progressed) {
      progressed = false;
      for (pi = 0; pi < polys.length; pi++) {
        if (!alive[pi]) continue;
        var again = true;
        while (again) {
          again = false;
          var p = polys[pi];
          for (var e = 0; e < p.length; e++) {
            var va = p[e], vb = p[(e + 1) % p.length];
            var qi = edge.get(vb * stride + va);
            if (qi === undefined || qi === pi || !alive[qi]) continue;
            var m = tryMerge(polys[pi], polys[qi], va, vb, coords, maxVerts);
            if (!m) continue;
            removeEdges(pi);
            removeEdges(qi);
            alive[qi] = false;
            polys[pi] = m;
            addEdges(pi);
            progressed = true;
            again = true;
            break;
          }
        }
      }
    }

    var out = [];
    for (pi = 0; pi < polys.length; pi++) {
      if (!alive[pi]) continue;
      var poly = polys[pi];
      var ring = [];
      for (var v = 0; v < poly.length; v++) ring.push(coords[poly[v] * 2], coords[poly[v] * 2 + 1]);
      // Merging leaves collinear vertices at healed junctions; they cost fixture budget and
      // planck would weld them anyway.
      var cleaned = PD.sanitizeRing(ring, o);
      if (cleaned) out.push(cleaned);
    }
    return out;
  }

  PD.decompose = decompose;
  // Single source of truth for the cap, so tests and the engine layer cannot drift from it.
  PD.MAX_VERTS = MAX_VERTS;

})(PD);
