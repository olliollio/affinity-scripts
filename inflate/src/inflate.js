/**
 * inflate.js — the displacement rules. Anchors and handles in, anchors and handles out.
 *
 * Pure geometry, no Affinity API, no flattening of the OUTPUT. Flattened rings exist only to
 * measure; what leaves here is the original Béziers with moved anchors and recomputed handles.
 * gravity's softbodies are the cautionary case: they flatten every curve so the physics can step
 * it, write the result back with lineToXY, and a smooth input returns faceted no matter how fine
 * the mesh is — because the curve stopped existing before the mesh was built.
 */
(function (GR) {
  'use strict';

  // Two input tangents this close to parallel count as a smooth anchor for the continuity pass.
  var PARALLEL_EPS = 1e-6;

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function unit(a) { var l = len(a); return l > 0 ? { x: a.x / l, y: a.y / l } : null; }

  /**
   * Inflates ONE closed curve. Same segment count out as in, always.
   *
   * P'   = P + n * amount * t/2
   * s    = |B' - A'| / |B - A|
   * h1   = collapsed(c1, A) ? amount*(B - A)/3 : (c1 - A)
   * h2   = collapsed(c2, B) ? amount*(A - B)/3 : (c2 - B)
   * b    = dot(M' - M_naive, n_M) / 0.75
   * c1'  = A' + h1*s + n_M*b        c2' = B' + h2*s + n_M*b
   */
  function inflateCurve(curve, sign, ctx, amount) {
    var segs = curve.segments, n = segs.length, i;
    var notes = [];

    // --- one probe per segment ---------------------------------------------------
    var segT = [], segN = [], segM = [];
    for (i = 0; i < n; i++) {
      var st = GR.inflSegmentThickness(segs[i], sign, ctx);
      if (st.t < 0) {
        // distanceToRings is UNSIGNED, so a flipped normal would have yielded a plausible t in
        // silence. Naming the segment is the only way this is ever noticed.
        notes.push('segment ' + i + ': probe left the material, treated as zero thickness');
        st.t = 0;
      }
      segT.push(st.t); segN.push(st.n); segM.push(st.M);
    }

    // --- anchors ------------------------------------------------------------------
    var Ap = [];
    for (i = 0; i < n; i++) {
      var m = GR.inflAnchorMeasure(segs, i, sign, ctx, segT);
      if (m.cusp) {
        // The bisector direction is arbitrary here while the magnitude is not, so the anchor would
        // shoot sideways. Leave it exactly where it is, and say so.
        notes.push('anchor ' + i + ': cusp, left in place');
        Ap.push({ x: segs[i].start.x, y: segs[i].start.y });
        continue;
      }
      Ap.push(add(segs[i].start, mul(m.n, amount * m.t / 2)));
    }

    // --- handles ------------------------------------------------------------------
    var out = [];
    for (i = 0; i < n; i++) {
      var s = segs[i], j = (i + 1) % n, A = s.start, B = s.end;
      var chord = sub(B, A), clen = len(chord);
      // Scaling by s preserves whatever curvature the user drew as the shape grows. Handles keep
      // their ORIGINAL direction rather than rotating with the chord; where the two ends have
      // different t the chord rotates and the handles deliberately do not follow it.
      var sc = clen < 1e-12 ? 1 : len(sub(Ap[j], Ap[i])) / clen;

      // Substituting chord/3 for a collapsed handle gives the curve somewhere to leave from, and
      // gating that substitution by `amount` is what keeps amount = 0 the identity.
      var h1 = GR.inflCollapsed(s.c1.x, s.c1.y, A.x, A.y, clen)
        ? mul(chord, amount / 3) : sub(s.c1, A);
      var h2 = GR.inflCollapsed(s.c2.x, s.c2.y, B.x, B.y, clen)
        ? mul(chord, -amount / 3) : sub(s.c2, B);

      var c1n = add(Ap[i], mul(h1, sc)), c2n = add(Ap[j], mul(h2, sc));

      // The bow is DERIVED, not tuned: it is exactly the residual between where the pillow surface
      // puts the midpoint and where the translated, scaled handles already put it, over 0.75 —
      // the midpoint's sensitivity to a symmetric handle offset, since B(0.5) = (A+3c1+3c2+B)/8.
      // There is no gain constant to calibrate.
      var b = 0, nM = segN[i];
      if (nM && clen > 0) {
        var Mt = add(segM[i], mul(nM, amount * segT[i] / 2));
        var Mn = { x: (Ap[i].x + 3 * c1n.x + 3 * c2n.x + Ap[j].x) / 8,
                   y: (Ap[i].y + 3 * c1n.y + 3 * c2n.y + Ap[j].y) / 8 };
        b = dot(sub(Mt, Mn), nM) / 0.75;
      }
      var bow = nM ? mul(nM, b) : { x: 0, y: 0 };
      // COPIES of the anchors, not the Ap entries themselves. Ap[j] is also Ap[i] of the next
      // segment, so pushing the object would make out[i].end and out[i+1].start the SAME point -
      // and a consumer that maps points in place would then transform every shared anchor twice.
      // The shape shears while node count and closedness stay perfectly correct, which is the kind
      // of wrong that survives every structural assertion.
      out.push({ start: { x: Ap[i].x, y: Ap[i].y }, c1: add(c1n, bow),
                 c2: add(c2n, bow), end: { x: Ap[j].x, y: Ap[j].y } });
    }

    // --- restore tangent continuity where the INPUT was smooth --------------------
    // Runs only where the input was smooth, and trades a small midpoint error for continuity.
    for (i = 0; i < n; i++) {
      var p = (i - 1 + n) % n;
      var tg = GR.inflTangentsAt(segs, i);
      var a1 = unit(tg.tIn), a2 = unit(tg.tOut);
      if (!a1 || !a2) continue;
      if (Math.abs(a1.x * a2.y - a1.y * a2.x) > PARALLEL_EPS || dot(a1, a2) <= 0) continue;
      // BOTH directions are taken in travel order. The incoming handle is stored as c2 and points
      // backward, so summing `c2 - A` with `c1 - A` would very nearly CANCEL instead of averaging.
      var dOut = unit(sub(out[i].c1, out[i].start));
      var dIn = unit(sub(out[p].end, out[p].c2));
      if (!dOut || !dIn) continue;
      var d = unit(add(dOut, dIn));
      if (!d) continue;
      var lOut = len(sub(out[i].c1, out[i].start)), lIn = len(sub(out[p].end, out[p].c2));
      out[i].c1 = add(out[i].start, mul(d, lOut));       // lengths unchanged, directions replaced
      out[p].c2 = sub(out[p].end, mul(d, lIn));
    }

    return { segments: out, isClosed: curve.isClosed, notes: notes };
  }

  /** Inflates every curve of one node. Open, degenerate and zero-area curves pass through. */
  function inflateCurves(curves, amount, flattenTol) {
    var cl = GR.inflClassify(curves, flattenTol);
    var out = [];
    for (var i = 0; i < cl.recs.length; i++) {
      var r = cl.recs[i];
      if (r.skip) {
        // Copied, not shared: returning the caller's own segment array would let a consumer that
        // maps points in place mutate the input curve it was handed.
        var copy = [];
        for (var k = 0; k < r.curve.segments.length; k++) {
          var sg = r.curve.segments[k];
          copy.push({ start: { x: sg.start.x, y: sg.start.y }, c1: { x: sg.c1.x, y: sg.c1.y },
                      c2: { x: sg.c2.x, y: sg.c2.y }, end: { x: sg.end.x, y: sg.end.y } });
        }
        out.push({ segments: copy, isClosed: r.curve.isClosed,
                   notes: ['copied through unchanged: ' + r.skip] });
        continue;
      }
      out.push(inflateCurve(r.curve, r.sign, GR.inflProbeCtx(r.face, cl.tol), amount));
    }
    return out;
  }

  GR.inflateCurve = inflateCurve;
  GR.inflateCurves = inflateCurves;
  GR.INFL_PARALLEL_EPS = PARALLEL_EPS;

})(GR);
