/**
 * thickness.js — local thickness at a point on a boundary. Pure geometry, no Affinity API.
 *
 * "Local thickness" is how far it is ACROSS the material, and it is what separates a pillow from an
 * offset: an offset moves every boundary point by a constant, so a thin arm grows as much as a fat
 * body. Scaling the displacement by thickness instead is the whole effect.
 */
(function (GR) {
  'use strict';

  // Relative: a handle counts as collapsed when it sits within this fraction of the chord length of
  // its anchor. flatten.js's LINE_EPS is module-local and ABSOLUTE; the SDK reference says a
  // straight segment stores `c1 ~= start`, not `c1 == start`, so an absolute threshold would be a
  // guess against unverified data. UNVERIFIED against real curves until Task 9 probes it.
  var LINE_EPS = 1e-6;

  // The flatten tolerance, as a fraction of the face's bounding-box diagonal. RELATIVE, not the
  // absolute 0.1 of flatten.js: tau is built from this and tau bounds the accuracy of t, so an
  // absolute tolerance makes the error scale-dependent. Measured on a slab at 0.005x, an absolute
  // tolerance gives -600%; this gives the same 1.0% at every scale.
  var TOL_FRAC = 5e-4;

  var ZERO_AREA_REL = 1e-9;

  function collapsed(cx, cy, ax, ay, chordLen) {
    var dx = cx - ax, dy = cy - ay;
    return Math.sqrt(dx * dx + dy * dy) <= LINE_EPS * chordLen;
  }

  /** B(0.5) = (A + 3c1 + 3c2 + B) / 8 — the CURVE midpoint, never the chord midpoint. */
  function midPoint(s) {
    return { x: (s.start.x + 3 * s.c1.x + 3 * s.c2.x + s.end.x) / 8,
             y: (s.start.y + 3 * s.c1.y + 3 * s.c2.y + s.end.y) / 8 };
  }

  /** B'(0.5) = (3/4)(B + c2 - c1 - A). The 3/4 is dropped: only the direction is used. */
  function midTangent(s) {
    return { x: s.end.x + s.c2.x - s.c1.x - s.start.x,
             y: s.end.y + s.c2.y - s.c1.y - s.start.y };
  }

  /**
   * (ey, -ex)/|e|, times the ring sign.
   *
   * That formula points OUT of the enclosed region of a positively-wound ring and INTO it for a
   * negatively-wound one. So with outer rings signed +1 and counters -1, one formula points away
   * from the MATERIAL everywhere: outward on an outer ring, into the void on a hole.
   */
  function normalOf(dx, dy, sign) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return null;
    return { x: sign * dy / len, y: -sign * dx / len };
  }

  function faceBBoxDiagonal(face) {
    var rings = [face.outer].concat(face.holes || []);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0; i < ring.length; i += 2) {
        if (ring[i] < x0) x0 = ring[i];
        if (ring[i] > x1) x1 = ring[i];
        if (ring[i + 1] < y0) y0 = ring[i + 1];
        if (ring[i + 1] > y1) y1 = ring[i + 1];
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The control-point hull bounds the curve, so this needs no flattening and is exact enough. */
  function hullDiagonal(curves) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var c = 0; c < curves.length; c++) {
      var segs = curves[c].segments || [];
      for (var i = 0; i < segs.length; i++) {
        var pts = [segs[i].start, segs[i].c1, segs[i].c2, segs[i].end];
        for (var p = 0; p < 4; p++) {
          if (pts[p].x < x0) x0 = pts[p].x;
          if (pts[p].x > x1) x1 = pts[p].x;
          if (pts[p].y < y0) y0 = pts[p].y;
          if (pts[p].y > y1) y1 = pts[p].y;
        }
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The flatten tolerance for a set of curves. One pass: the hull needs no flattening to find. */
  function tolFor(curves) {
    var d = hullDiagonal(curves);
    return d > 0 ? TOL_FRAC * d : GR.FLATTEN_TOL;
  }

  /**
   * Flattens every closed curve, groups the rings into faces, and gives each curve its face and its
   * ring sign.
   *
   * The original curves are NOT rewound. Reversing them would reorder the output nodes, and node
   * order is what this feature exists to preserve, so the sign is carried alongside instead — one
   * shoelace per ring, not a test per anchor.
   *
   * buildFaces pushes the CALLER'S array references, so a face's ring is mapped back to the curve
   * that produced it BY IDENTITY. That is why enforceWinding is not used: it returns new arrays and
   * would break exactly this mapping, and it would buy nothing anyway because buildFaces classifies
   * by nesting-depth parity and never reads winding.
   */
  function classify(curves, flattenTol) {
    var tol = flattenTol === undefined ? tolFor(curves) : flattenTol;
    var recs = [], i;
    for (i = 0; i < curves.length; i++) {
      var c = curves[i];
      recs.push({ curve: c, index: i, face: null, sign: 0,
                  ring: c.isClosed ? GR.flattenSegments(c.segments, { flattenTol: tol }) : null,
                  skip: c.isClosed ? null : 'open' });
    }

    var rings = [];
    for (i = 0; i < recs.length; i++) if (recs[i].ring) rings.push(recs[i].ring);
    var faces = GR.buildFaces(rings);

    function tag(ring, face, outerSign) {
      for (var k = 0; k < recs.length; k++) {
        if (recs[k].ring === ring) {                       // identity, not value
          recs[k].face = face;
          // signedArea is taken in the SAME space the normals are computed in. Under a mirroring
          // transform base and spread windings differ, and the rule is reflection-invariant only
          // when both come from one space.
          recs[k].sign = outerSign * (GR.signedArea(ring) >= 0 ? 1 : -1);
          return;
        }
      }
    }
    for (var f = 0; f < faces.length; f++) {
      tag(faces[f].outer, faces[f], 1);
      var holes = faces[f].holes || [];
      for (var hI = 0; hI < holes.length; hI++) tag(holes[hI], faces[f], -1);
    }

    // A ring buildFaces dropped (fewer than three points), and a ring of no enclosed area, have no
    // sign and no interior to grow into. Exact zero is unlikely in floating point, so the test is
    // relative to the face's own box.
    for (i = 0; i < recs.length; i++) {
      if (recs[i].skip) continue;
      if (!recs[i].face) { recs[i].skip = 'degenerate ring'; continue; }
      var diag = faceBBoxDiagonal(recs[i].face);
      if (Math.abs(GR.signedArea(recs[i].ring)) < ZERO_AREA_REL * diag * diag) recs[i].skip = 'zero area';
    }
    return { recs: recs, faces: faces, tol: tol };
  }

  /**
   * tau is NOT slack. With tau = 0 every curved probe returns ~0: the flattened ring's chords cut
   * INSIDE the true arc, so a probe disc that is tangent to the curve still clips the polygon. The
   * deficit cannot be measured at the probe point — flatten.js subdivides at t = 0.5, so B(0.5) is
   * itself a flattening vertex and its own distance to the ring is exactly zero. 2x the tolerance
   * is the sagitta bound plus a factor of two.
   */
  function probeCtx(face, flattenTol) {
    var diag = faceBBoxDiagonal(face);
    var tol = flattenTol === undefined ? TOL_FRAC * diag : flattenTol;
    return { face: face, tau: 2 * tol + 1e-9 * diag, maxR: diag / 2, diag: diag };
  }

  /**
   * The largest r whose probe disc, centred r INSIDE the boundary at (px, py), still clears the
   * geometry by r. Because the probe point is ON the boundary, dist can never EXCEED r, so the
   * predicate is really an equality: this finds the largest disc TANGENT to the boundary here.
   *
   * The bisection is well posed with no second root: dist is 1-Lipschitz in r and |dC/dr| = 1, so
   * dist(C(r)) - r is non-increasing and the satisfying set is exactly [0, r*]. That holds on
   * concave shapes too, which is what makes bisection legitimate rather than merely convenient.
   *
   * Returns -1 when the probe escaped the material. distanceToRings is UNSIGNED, so a probe that
   * has left the shape satisfies the predicate as readily as one inside it and a flipped normal
   * would yield a plausible t in silence; pointInFace is what catches that.
   */
  function probeRadius(px, py, nx, ny, face, maxR, tau) {
    var lo = 0, hi = maxR;
    for (var it = 0; it < 60; it++) {
      var mid = (lo + hi) / 2;
      if (GR.distanceToRings(px - mid * nx, py - mid * ny, face) >= mid - tau) lo = mid; else hi = mid;
    }
    if (lo > 0 && !GR.pointInFace(px - lo * nx, py - lo * ny, face)) return -1;
    return lo;
  }

  /** t = 2r at the segment's CURVE midpoint, probed along the inward normal THERE. */
  function segmentThickness(seg, sign, ctx) {
    var M = midPoint(seg), T = midTangent(seg);
    var n = normalOf(T.x, T.y, sign);
    if (!n) n = normalOf(seg.end.x - seg.start.x, seg.end.y - seg.start.y, sign);
    if (!n) return { t: 0, r: 0, M: M, n: null };
    var r = probeRadius(M.x, M.y, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r, M: M, n: n };
  }

  function anchorThickness(px, py, n, ctx) {
    if (!n) return { t: -1, r: -1 };
    var r = probeRadius(px, py, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r };
  }

  GR.INFL_LINE_EPS = LINE_EPS;
  GR.INFL_TOL_FRAC = TOL_FRAC;
  GR.inflCollapsed = collapsed;
  GR.inflMidPoint = midPoint;
  GR.inflMidTangent = midTangent;
  GR.inflNormalOf = normalOf;
  GR.inflFaceBBoxDiagonal = faceBBoxDiagonal;
  GR.inflHullDiagonal = hullDiagonal;
  GR.inflTolFor = tolFor;
  GR.inflClassify = classify;
  GR.inflProbeCtx = probeCtx;
  GR.inflProbeRadius = probeRadius;
  GR.inflSegmentThickness = segmentThickness;
  GR.inflAnchorThickness = anchorThickness;

})(GR);
