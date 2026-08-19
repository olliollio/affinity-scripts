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
  // guess against unverified data. This threshold has NOT been validated against real Affinity
  // curve data; the first real run is what sets it from measurement rather than from a guess.
  var LINE_EPS = 1e-6;

  // The flatten tolerance, as a fraction of the face's bounding-box diagonal. RELATIVE, not the
  // absolute 0.1 of flatten.js: tau is built from this and tau bounds the accuracy of t, so an
  // absolute tolerance makes the error scale-dependent. Measured on a slab at 0.005x, an absolute
  // tolerance gives -600%; this gives the same 1.0% at every scale.
  var TOL_FRAC = 5e-4;

  // Area goes as length squared, so a ring's area is judged against diag*diag rather than against
  // diag. 1e-9 sits far below anything a real shape produces and far above float dust. The diagonal
  // is the FACE's box, not the ring's own, so a small counter is judged at the scale it will be
  // inflated at rather than at its own - a tiny hole in a huge glyph is not thereby "degenerate".
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
   * negatively-wound one. Multiplying by the ring sign makes ONE formula point away from the
   * MATERIAL everywhere: outward on an outer ring, into the void on a counter.
   *
   * The sign is NOT simply +1 outer / -1 counter. It is the ring's ROLE times its OWN WINDING,
   * because (ey, -ex) already points into the void of a negatively-wound hole and needs no flip
   * there - so such a hole signs +1. classify computes that product; do not "correct" it to a
   * constant.
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
   * order is what this feature exists to preserve, so the sign is carried alongside instead — a
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

    // The linear scan is deliberate and should stay. buildFaces is already O(n^2) over these same
    // rings, so an index here would not change the shape of the cost; and the two ways to build one
    // are both worse - an ES6 Map is against house style, and stamping an id onto the ring arrays
    // would mutate the caller's data, which the paragraph above promises not to do.
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
    // flattenTol is REQUIRED, and must be the tolerance this face's rings were actually flattened
    // at - classify returns it as `.tol` for exactly this reason. It cannot be defaulted here:
    // classify picks one tolerance for the whole SELECTION, from the hull of every curve, while a
    // face knows only its own box. On a letter "i" those differ by 5x, and a tau computed from the
    // dot's own box is too small to cover chords flattened at the stem's scale - the dot then
    // measures 31.0 against a true 50. That is the tau-collapse this module's own test guards,
    // reached through a default. It degrades into a PLAUSIBLE number rather than a zero, so it
    // would ship as "the dots on the i's look under-inflated" rather than as a failure.
    if (typeof flattenTol !== 'number' || !isFinite(flattenTol)) {
      throw new Error('inflProbeCtx: flattenTol is required - pass the tol classify() returned');
    }
    var diag = faceBBoxDiagonal(face);
    // The 1e-9*diag term is float dust, scaled so it stays meaningful on large artwork; 2*tol is
    // the part that does the work, and the paragraph above is about that.
    return { face: face, tau: 2 * flattenTol + 1e-9 * diag, maxR: diag / 2, diag: diag };
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
    // 60 halvings drive the bracket below the last representable bit of maxR, far past any accuracy
    // tau permits claiming. Deliberate slack, not a tuned count: 52 is already bit-identical.
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
    // -1, matching anchorThickness. A 0 here would be indistinguishable from a legitimate
    // zero-radius tangency, and a caller scaling a displacement by t would silently use it.
    if (!n) return { t: -1, r: -1, M: M, n: null };
    var r = probeRadius(M.x, M.y, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r, M: M, n: n };
  }

  function anchorThickness(px, py, n, ctx) {
    if (!n) return { t: -1, r: -1 };
    var r = probeRadius(px, py, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r };
  }

  // Where the two adjacent normals cancel — a doubled-back node, a zero-width spike — the bisector
  // DIRECTION is numerically arbitrary while the displacement magnitude is not, so the anchor would
  // shoot sideways. The threshold is on UNIT vectors, so L lies in [0, 2] whatever the artwork's
  // scale and the number is scale-free.
  //
  // 1e-4 is deliberately conservative, not derived: it is antiparallel to within 0.006 degrees,
  // some orders above where float noise actually makes the direction arbitrary. There is no cliff
  // at it either way — an anchor just ABOVE the threshold has a near-zero probe and falls to the
  // larger neighbour, which is the same displacement magnitude a cusp would want anyway.
  var CUSP_EPS = 1e-4;

  /**
   * The two tangents at anchor `i`, both IN THE DIRECTION OF TRAVEL.
   *
   * Affinity stores the incoming handle as c2, and `c2 - A` points BACKWARD. Using it directly makes
   * every smooth node look like a cusp, and the failure surfaces as a bow artefact rather than as a
   * sign error, which is a much harder thing to read.
   *
   * Affinity also stores a straight segment as a cubic with its handles ON the anchors, so deriving
   * a tangent from `c1 - A` returns a zero vector on every straight segment — the COMMON case, not
   * a rare one. There the chord stands in.
   *
   * DIRECTIONS ONLY. The two returned vectors are not comparable in magnitude: a handle-derived
   * tangent is about a handle long and a chord fallback about a segment long, some 3x apart on a
   * quarter-arc, and one of each is the normal case at a line/arc junction. Normalize before doing
   * anything with them; never sum or compare them raw.
   *
   * PRECONDITION: a CLOSED ring. `(i - 1 + n) % n` wraps, so anchor 0 takes its incoming tangent
   * from the last segment, which is the previous segment only when the ring closes. classify marks
   * open curves for pass-through and they never reach here.
   */
  function tangentsAt(segs, i) {
    var n = segs.length, cur = segs[i], prv = segs[(i - 1 + n) % n];
    var chordOut = { x: cur.end.x - cur.start.x, y: cur.end.y - cur.start.y };
    var chordIn = { x: prv.end.x - prv.start.x, y: prv.end.y - prv.start.y };
    var lOut = Math.sqrt(chordOut.x * chordOut.x + chordOut.y * chordOut.y);
    var lIn = Math.sqrt(chordIn.x * chordIn.x + chordIn.y * chordIn.y);
    return {
      tOut: collapsed(cur.c1.x, cur.c1.y, cur.start.x, cur.start.y, lOut)
        ? chordOut : { x: cur.c1.x - cur.start.x, y: cur.c1.y - cur.start.y },
      tIn: collapsed(prv.c2.x, prv.c2.y, prv.end.x, prv.end.y, lIn)
        ? chordIn : { x: prv.end.x - prv.c2.x, y: prv.end.y - prv.c2.y }
    };
  }

  /**
   * The bisector normal and the thickness at one anchor.
   *
   * n = normalize(n_in + n_out) is the bisector at a corner and reduces to the perpendicular at a
   * smooth node, with no corner/smooth threshold to pick and so no divergence between
   * implementations.
   *
   * THE DEGENERACY TEST. Because the probe point lies on the boundary, the largest tangent disc at
   * a CONVEX CORNER has radius zero — the nearest boundary point to a nearby interior point is not
   * the corner itself. So probing at anchors returns near zero at every corner of a polygon and a
   * square, whose only anchors are corners, would come back unchanged. But the probe is not
   * worthless everywhere: at a SMOOTH anchor it is perfectly well behaved and is the MORE accurate
   * measure, and on a rounded rectangle taking the larger adjacent segment instead over-reports by
   * 2.5x at exactly the anchors where nothing was wrong.
   *
   * A fixed floor cannot separate those two cases. A CONVEX corner of interior angle th caps its
   * own probe at r = tau/(1 - sin(th/2)) — 3.41*tau at 90 degrees, 5.24*tau at 108, 7.46*tau at
   * 120 — so any fixed multiple of tau is right for one angle and wrong for the rest. Measured
   * against a fixed 4*tau floor: a pentagon inflated at 100% grew by 1.05 units instead of 80.
   *
   * Rearranged, a purely corner-limited probe satisfies 2*r*(1 - sin(th/2)) == 2*tau EXACTLY, at
   * every angle, while a probe stopped by real geometry across the material comes in under that. So
   * the test discriminates by a factor of two and needs no angle threshold at all. |n_in + n_out|/2
   * IS sin(th/2), and the bisector already computed it, so this costs nothing. At a smooth anchor
   * th = 180, the left side is 0, and every probe is well posed — which is what is wanted there.
   *
   * TWO RULES SHARE ONE EXPRESSION, and the second is not the corner argument above. sin is not
   * injective over (0, 360), so a REFLEX angle th and its convex complement 360 - th give the same
   * sinHalf: a star's 249.6 degree notch and a 110.4 degree corner both give 0.8208. At a reflex
   * vertex — any L, T, cross or notch, not just a star — the own probe is a perfectly good material
   * measurement (measured 28.92 on a 270 degree L) and is rejected anyway. That is WANTED, for the
   * separate reason given at the Math.max below: the larger neighbour is the value that belongs to
   * the anchor. So this flag names a DECISION, not a defect in the probe, which is why it is called
   * useOwnProbe rather than wellPosed.
   *
   * @param {Array} segs   the ring's segments, in node order.
   * @param {number} i     the anchor's index; the anchor is `segs[i].start`.
   * @param {number} sign  the ring sign from classify — see normalOf.
   * @param {Object} ctx   the probe context from probeCtx, for THIS anchor's face.
   * @param {Array<number>} segT  REQUIRED, one entry per segment: segT[k] is the thickness of the
   *   segment STARTING at anchor k, measured with the same `sign` and the same `ctx`. It is not
   *   recomputed here, because every segment is a neighbour twice and doing so probes the whole
   *   ring twice; and because an array from another sign or another ctx degrades into a plausible
   *   number rather than a throw, which is the failure class probeCtx now throws to prevent.
   * @returns {Object}
   *   n     {x,y} unit bisector pointing away from the material, or null at a cusp.
   *   t     the thickness to displace by, or -1 where no measure exists.
   *   cusp  true when the two normals cancelled and no direction can be had.
   *   useOwnProbe  true when `t` came from this anchor's own probe rather than from a neighbour.
   *   own   this anchor's own probe thickness, whether or not it was used; -1 at a cusp.
   *   sinHalf  sin(th/2) for interior angle th, or null when only one tangent existed.
   */
  function anchorMeasure(segs, i, sign, ctx, segT) {
    var n = segs.length;
    if (!segT || segT.length !== n) {
      throw new Error('inflAnchorMeasure: segT is required and must be one entry per segment');
    }
    var tg = tangentsAt(segs, i);
    var nIn = normalOf(tg.tIn.x, tg.tIn.y, sign);
    var nOut = normalOf(tg.tOut.x, tg.tOut.y, sign);
    var sum = (nIn && nOut) ? { x: nIn.x + nOut.x, y: nIn.y + nOut.y } : (nIn || nOut);
    if (!sum) return { n: null, t: -1, cusp: true, useOwnProbe: false, own: -1, sinHalf: null };
    var L = Math.sqrt(sum.x * sum.x + sum.y * sum.y);
    if (L < CUSP_EPS) return { n: null, t: -1, cusp: true, useOwnProbe: false, own: -1, sinHalf: null };

    var nrm = { x: sum.x / L, y: sum.y / L };
    var ap = anchorThickness(segs[i].start.x, segs[i].start.y, nrm, ctx);
    // L/2 is sin(th/2) ONLY when both tangents existed. With one, sum is a single unit vector and
    // L is 1, which would report a 60 degree corner at what may be a straight-through point — a
    // duplicated anchor does exactly that, and it is common in traced and imported paths. Report
    // null rather than a fabricated angle, since this value ships in the returned object.
    var sinHalf = (nIn && nOut) ? L / 2 : null;
    var useOwnProbe = ap.r >= 0 && sinHalf !== null && 2 * ap.r * (1 - sinHalf) < ctx.tau;

    // THE LARGER NEIGHBOUR. At a reflex junction — a disc meeting a narrow stem, the inside corner
    // of an L — the anchor belongs to the thick body it is part of, and taking the stem's smaller
    // value instead would crease the notch away from that body.
    var t = useOwnProbe ? ap.t : Math.max(segT[(i - 1 + n) % n], segT[i]);
    return { n: nrm, t: t, cusp: false, useOwnProbe: useOwnProbe, own: ap.t, sinHalf: sinHalf };
  }

  GR.INFL_LINE_EPS = LINE_EPS;
  GR.INFL_TOL_FRAC = TOL_FRAC;
  GR.INFL_CUSP_EPS = CUSP_EPS;
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
  GR.inflTangentsAt = tangentsAt;
  GR.inflAnchorMeasure = anchorMeasure;

})(GR);
