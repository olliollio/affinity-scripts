'use strict';
var F = require('./fixtures');

module.exports = function (GR, h) {
  function ring(curve, tol) { return GR.flattenSegments(curve.segments, { flattenTol: tol || 0.001 }); }
  function bboxOf(r) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
      if (r[i+1] < y0) y0 = r[i+1]; if (r[i+1] > y1) y1 = r[i+1];
    }
    return { w: x1 - x0, h: y1 - y0 };
  }
  function radii(curve, cx, cy) {
    var r = ring(curve), out = [];
    for (var i = 0; i < r.length; i += 2) out.push(Math.hypot(r[i] - cx, r[i+1] - cy));
    return out;
  }
  function mid(s) {
    return { x: (s.start.x + 3*s.c1.x + 3*s.c2.x + s.end.x) / 8,
             y: (s.start.y + 3*s.c1.y + 3*s.c2.y + s.end.y) / 8 };
  }

  h.group('inflate — amount = 0 is the identity');
  // Every term carries an `amount` factor, s = 1, and M_naive = M so b = 0. Equality is to within
  // floating-point REASSOCIATION, not bit-exact, since A + (c1 - A) need not reproduce c1.
  //
  // This is a headless test and so CANNOT catch a missing inverse transform, which is exactly what
  // would make amount = 0 move a shape in the real application. The real-artwork run catches that.
  [['square', F.rect(0,0,100,100)], ['disc', F.circle(0,0,100)],
   ['rrect', F.roundRect(0,0,300,100,20)], ['star', F.star(0,0,100,40,5)]].forEach(function (c) {
    var o = GR.inflateCurves([c[1]], 0)[0], d = 0;
    for (var i = 0; i < c[1].segments.length; i++) {
      var a = c[1].segments[i], b = o.segments[i];
      ['start','c1','c2','end'].forEach(function (k) {
        d = Math.max(d, Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y));
      });
    }
    h.assert('amount = 0 identity: ' + c[0], d <= 1e-12 * 400, 'max drift ' + d.toExponential(2));
  });

  h.group('inflate — node count and closedness are preserved');
  [['square', F.rect(0,0,100,100)], ['disc', F.circle(0,0,100)],
   ['rrect', F.roundRect(0,0,300,100,20)], ['star', F.star(0,0,100,40,5)]].forEach(function (c) {
    var o = GR.inflateCurves([c[1]], 0.5)[0];
    h.assertEqual('node count: ' + c[0], o.segments.length, c[1].segments.length);
    h.assertEqual('closedness: ' + c[0], o.isClosed, true);
  });

  h.group('inflate — the amount definition');
  // A slab of width w has t = w and BOTH facing boundary points move out by amount*t/2, so at 100%
  // it is 2w across. The tolerance is the bisection's precision plus the flattening slack and
  // cannot be tightened past them.
  var slab = GR.inflateCurves([F.rect(0,0,40,400)], 1)[0];
  var stau = 2 * GR.inflTolFor([F.rect(0,0,40,400)]);
  h.assertClose('slab of 40 doubles to 80 at 100%', bboxOf(ring(slab)).w, 80, 1e-5 * 40 + stau);

  var disc = GR.inflateCurves([F.circle(0,0,100)], 1)[0];
  var dr = radii(disc, 0, 0);
  h.assertClose('disc of R=100 doubles to R=200 at 100%', Math.max.apply(null, dr), 200, 0.5);

  h.group('inflate — a circle stays a circle');
  // Its handles scale by s = 1 + amount, which is EXACTLY the handle length a circle of radius
  // R(1+amount) needs, since k*R*(1+amount) = k*R'. So the midpoint is already on target and b = 0.
  // Under a translate-only rule the handles fall short by k*amount*R and the result is a rounded
  // square.
  //
  // The assertion is RELATIVE and against the INPUT, because a four-cubic circle is itself 2.7e-4
  // off a true circle: at R = 200 its radii already spread by 0.0546 before anything is inflated.
  // An absolute tolerance here would be a number tuned to whatever the code happens to emit.
  var dr0 = radii(F.circle(0,0,100), 0, 0);
  var relIn = (Math.max.apply(null,dr0) - Math.min.apply(null,dr0)) / Math.max.apply(null,dr0);
  var relOut = (Math.max.apply(null,dr) - Math.min.apply(null,dr)) / Math.max.apply(null,dr);
  h.assert('output is no less round than its input', relOut <= relIn * 1.05,
    'input ' + relIn.toExponential(3) + ' output ' + relOut.toExponential(3));

  h.group('inflate — the bow');
  // A square's extent is set by its BULGED EDGES, not by its corners: the corners move along their
  // bisectors and pick up only cos(45) of that perpendicular to each edge, so they sit INSIDE the
  // offset their edges imply. That miter shortfall is the pinched-corner look, not an error.
  var sq = GR.inflateCurves([F.rect(0,0,100,100)], 1)[0];
  h.assertClose('square extent is set by the bulged edges', bboxOf(ring(sq)).w, 200, 0.5);
  h.assertClose('square edge midpoint bows out by w/2', mid(sq.segments[0]).y, -50, 0.3);
  h.assertClose('square corner sits inside by the miter shortfall',
    50 - Math.abs(sq.segments[0].start.x), 50 * (1 - Math.cos(Math.PI/4)), 0.15);

  // A rounded rectangle's flat sides bulge: their ANCHORS move by the corner arcs' thickness (40)
  // while the side's own midpoint target is the full half-width (100), so b is large and positive.
  // This is the case an anchor-smoothness gate gets wrong — a straight side between two smooth
  // anchors is precisely where a bulge is needed — and getting it wrong turns the whole operation
  // into an offset.
  var rr = GR.inflateCurves([F.roundRect(0,0,300,100,20)], 0.5)[0];
  var side = rr.segments[0];
  h.assert('a rounded rect\'s flat side is not straight in the output',
    Math.abs((side.c1.y + side.c2.y)/2 - (side.start.y + side.end.y)/2) > 1.0);

  h.group('inflate — tangent continuity');
  // A straight segment's handles sit ON its anchors, so a translate-only rule leaves the outgoing
  // tangent equal to the bow — normal to the edge. Every anchor would become a 90 degree kink and a
  // square would inflate into four bulges meeting at spikes.
  var sq2 = GR.inflateCurves([F.rect(0,0,100,100)], 0.5)[0];
  var tOut = { x: sq2.segments[0].c1.x - sq2.segments[0].start.x,
               y: sq2.segments[0].c1.y - sq2.segments[0].start.y };
  h.assert('output tangent is not perpendicular to the input edge',
    Math.abs(tOut.x / Math.hypot(tOut.x, tOut.y)) > 0.5);

  // A bow points along its OWN segment's normal, so at an anchor shared by two bowed segments the
  // two handles pick up different directions and a curve that was smooth acquires a visible break.
  var rr2 = GR.inflateCurves([F.roundRect(0,0,300,100,20)], 0.5)[0];
  var worst = 0;
  for (var i = 0; i < rr2.segments.length; i++) {
    var p = (i - 1 + rr2.segments.length) % rr2.segments.length;
    var dO = { x: rr2.segments[i].c1.x - rr2.segments[i].start.x,
               y: rr2.segments[i].c1.y - rr2.segments[i].start.y };
    var dI = { x: rr2.segments[p].end.x - rr2.segments[p].c2.x,
               y: rr2.segments[p].end.y - rr2.segments[p].c2.y };
    if (Math.hypot(dO.x,dO.y) < 1e-9 || Math.hypot(dI.x,dI.y) < 1e-9) continue;
    var ang = Math.abs(Math.atan2(dO.x*dI.y - dO.y*dI.x, dO.x*dI.x + dO.y*dI.y)) * 180 / Math.PI;
    if (ang > worst) worst = ang;
  }
  h.assert('smooth input anchors stay smooth in the output', worst < 0.5,
    'worst break ' + worst.toFixed(4) + ' deg');

  // WHAT THAT CONTINUITY COSTS. The bow puts each segment's midpoint exactly on the pillow surface,
  // and then the post-pass rotates the handles at every smooth anchor, which moves it off again.
  // The square never shows this - its corners are not smooth, so the pass skips them and the
  // midpoint assertion above holds exactly. On a rounded rectangle every anchor IS smooth, so the
  // pass runs everywhere and nothing else here pins the result.
  //
  // Measured at amount 0.5 against an intended displacement of 25: the flat side's midpoint lands
  // 7.65 off target and the corner arc's 4.26. This assertion is a REGRESSION GUARD on a trade the
  // design accepts, not a claim that the trade is right - whether 7.65 reads as a defect on real
  // artwork is a question only real artwork answers.
  var pcl = GR.inflClassify([F.roundRect(0,0,300,100,20)]), prec = pcl.recs[0];
  var pctx = GR.inflProbeCtx(prec.face, pcl.tol), worstMid = 0;
  for (var q = 0; q < rr2.segments.length; q++) {
    var srcSeg = F.roundRect(0,0,300,100,20).segments[q];
    var pst = GR.inflSegmentThickness(srcSeg, prec.sign, pctx);
    if (!pst.n) continue;
    var got = mid(rr2.segments[q]);
    var target = { x: pst.M.x + pst.n.x * 0.5 * pst.t / 2,
                   y: pst.M.y + pst.n.y * 0.5 * pst.t / 2 };
    var off = Math.hypot(got.x - target.x, got.y - target.y);
    if (off > worstMid) worstMid = off;
  }
  h.assert('the continuity pass costs no more midpoint accuracy than measured',
    worstMid < 9.0, 'worst midpoint error ' + worstMid.toFixed(4) + ' (measured 7.65)');

  h.group('inflate — faces and pass-through');
  // createSetCurves replaces a node's geometry outright, so a shape with counters must rebuild ALL
  // its rings in one call. This is that case, computed in one call.
  // Run at BOTH hole windings: the ring sign is what makes a counter close rather than grow, and a
  // sign taken from a ring's accidental winding would pass at one and fail at the other.
  [['negatively-wound', F.circle(0,0,70,false)], ['positively-wound', F.circle(0,0,70)]]
    .forEach(function (c) {
      var ann = GR.inflateCurves([F.circle(0,0,100), c[1]], 0.5);
      h.assert('outer ring grows, ' + c[0] + ' counter',
        Math.max.apply(null, radii(ann[0],0,0)) > 100.5);
      // 70 - 0.5 * 30/2 = 62.5: the counter's wall is 30, so at amount 0.5 it closes by 7.5.
      h.assertClose('counter closes, ' + c[0], Math.max.apply(null, radii(ann[1],0,0)), 62.5, 0.25);
    });

  // Output points must not be shared between adjacent segments. out[i].end and out[i+1].start are
  // the same ANCHOR but must be different OBJECTS: a consumer that maps points in place - which is
  // exactly what writing back through an inverse transform looks like - would otherwise transform
  // every shared anchor twice, shearing the shape while node count and closedness stay correct.
  var al = GR.inflateCurves([F.rect(0, 0, 100, 100)], 0.5)[0];
  h.assert('adjacent segments do not share point objects',
    al.segments[0].end !== al.segments[1].start);
  var srcCurve = F.openPath(), thruOut = GR.inflateCurves([srcCurve], 1)[0];
  h.assert('a passed-through curve does not share the input array',
    thruOut.segments !== srcCurve.segments);

  var thru = GR.inflateCurves([F.openPath(), F.degenerateRing()], 1);
  h.assertEqual('an open path is copied through', thru[0].segments[1].end.x, 100);
  h.assertEqual('an open path keeps isClosed false', thru[0].isClosed, false);
  h.assert('a zero-area ring is copied through', !!thru[1].notes.length);

  h.group('inflate \u2014 the cusp guard');
  // The cusp guard: at a zero-width slit the two adjacent normals cancel, so the bisector
  // DIRECTION is arbitrary while the magnitude is not - an unguarded anchor shoots sideways. No
  // other fixture reaches this branch, so without this assertion the guard could be deleted and
  // every other test would stay green.
  var sp = F.spike(), spOut = GR.inflateCurves([sp], 0.5)[0];
  var tipIn = sp.segments[4].start, tipOut = spOut.segments[4].start;
  h.assertClose('a cusp anchor is left exactly where it was',
    Math.hypot(tipOut.x - tipIn.x, tipOut.y - tipIn.y), 0, 1e-12);
  h.assert('and the cusp is named in the notes',
    spOut.notes.join(' ').indexOf('cusp') >= 0, 'notes: ' + spOut.notes.join('; '));

  h.group('inflate — no feature may collapse');

  // Displacement is scaled by the MATERIAL thickness, and nothing else bounds it by the size of the
  // FEATURE the anchor sits on. Those diverge wherever a small step adjoins thick material, which
  // is most of what a letterform is. Measured on a real capital R: the notch under the bowl is 22.4
  // long while the stem beside it measures 89.6, so at 30% both of that notch's anchors moved 13.4
  // toward each other and the segment closed to 5.8 — a visible kink. And on a real star with a
  // round hole at 100%, the handles came out 0.86 of their chord, which draws as a loop, not a
  // bulge: the hole "looked triangulated".
  //
  // Two assertions, because the two failures are different. A chord that collapses is the anchors
  // converging; a handle longer than its chord is the BOW compensating for anchors that were capped
  // — which is why the cap has to scale the segment's midpoint target too, not just its anchors.
  var hard = [['star with a round hole', [F.star(0,0,100,40,5), F.circle(0,0,25,false)]],
              ['stepped bar', [F.poly([0,0, 100,0, 100,60, 78,60, 78,200, 0,200])]],
              ['spike', [F.spike()]]];
  hard.forEach(function (c) {
    var res = GR.inflateCurves(c[1], 1.0);
    var worstChord = 1, worstHandle = 0;
    res.forEach(function (o, ci) {
      o.segments.forEach(function (t, i) {
        var src = c[1][ci].segments[i];
        var lb = Math.hypot(src.end.x - src.start.x, src.end.y - src.start.y);
        var la = Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);
        if (lb > 1e-9 && la / lb < worstChord) worstChord = la / lb;
        if (la < 1e-9) return;
        worstHandle = Math.max(worstHandle,
          Math.hypot(t.c1.x - t.start.x, t.c1.y - t.start.y) / la,
          Math.hypot(t.c2.x - t.end.x, t.c2.y - t.end.y) / la);
      });
    });
    h.assert('no chord collapses: ' + c[0], worstChord >= 0.45,
      'worst chord is ' + (worstChord * 100).toFixed(0) + '% of its original');
    h.assert('no handle outruns its chord: ' + c[0], worstHandle < 1.0,
      'worst handle/chord ' + worstHandle.toFixed(2) + ' — above 1 draws as a loop');
  });

  h.group('inflate — invariants');

  // WINDING INDEPENDENCE. The original curves are deliberately NOT rewound, so the two outputs
  // differ in vertex ORDER and in nothing else — the comparison is up to reversal, via a quantity
  // that does not depend on order. This is the assertion that catches a sign taken from a ring's
  // accidental winding.
  function absArea(c) { return Math.abs(GR.signedArea(ring(c))); }
  var fwd = GR.inflateCurves([F.star(0,0,100,40,5)], 0.4)[0];
  var rev = GR.inflateCurves([F.reverseCurve(F.star(0,0,100,40,5))], 0.4)[0];
  h.assertClose('same area at either winding', absArea(fwd), absArea(rev), absArea(fwd) * 1e-6);
  h.assertEqual('same node count at either winding', fwd.segments.length, rev.segments.length);

  // SCALE INVARIANCE. The same percentage on a 2x shape must give 2x displacement. This is what
  // fails for an ABSOLUTE flatten tolerance: measured across x0.005/x1/x20 the scaled displacement
  // spread 198% with an absolute tolerance and 0.00% with a relative one.
  var disp = [0.005, 1, 20].map(function (S) {
    var o = GR.inflateCurves([F.roundRect(0, 0, 300*S, 100*S, 20*S)], 0.5)[0];
    return Math.abs(o.segments[0].start.y) / S;
  });
  h.assertClose('displacement scales with the shape (x0.005 vs x1)', disp[0], disp[1], disp[1] * 1e-3);
  h.assertClose('displacement scales with the shape (x20 vs x1)', disp[2], disp[1], disp[1] * 1e-3);

  // An offset passes this too, so it is not coverage of the PILLOW behaviour. It is not redundant
  // either, and the reason is worth stating: every other invariant here compares magnitudes or
  // ratios, which are sign-symmetric, so a displacement that ran INWARD would leave winding
  // independence, scale invariance and the fat-versus-thin ratio all intact. Measured with a
  // negative amount: those three pass unchanged while the area falls 11755 -> 3693. This is the
  // only assertion in the suite that knows which way "out" is.
  var prev = -1, mono = true;
  [0, 0.1, 0.25, 0.5, 0.75, 1].forEach(function (a) {
    var ar = absArea(GR.inflateCurves([F.star(0,0,100,40,5)], a)[0]);
    if (ar <= prev) mono = false;
    prev = ar;
  });
  h.assert('enclosed area increases monotonically in amount', mono);

  // THE PILLOW PROPERTY ITSELF, which the monotonic test above does NOT cover: a fat body must grow
  // more than a thin arm. Under an offset both grow the same.
  //
  // MEASURE THE ANCHOR, NOT THE MIDPOINT. This is the trap: mid() reads the BOW-CORRECTED bezier
  // midpoint, and the bow independently re-derives from segT[i] and solves for whatever residual
  // lands the midpoint on the pillow surface — regardless of where the anchor was put. So a mutant
  // that replaces the anchor rule with a CONSTANT, turning the whole feature into the offset this
  // assertion exists to rule out, still reports 9.82:1 through mid() and passes. Measured. The raw
  // anchors tie at 1.00 under that same mutant, which is what an offset actually looks like.
  //
  // Both are asserted: the anchor ratio is what pins the rule, and the midpoint ratio is what pins
  // the bow agreeing with it.
  var fat = GR.inflateCurves([F.rect(0, 0, 200, 200)], 0.5)[0];
  var thin = GR.inflateCurves([F.rect(0, 0, 20, 200)], 0.5)[0];
  var fatAnchor = Math.abs(fat.segments[0].start.y);
  var thinAnchor = Math.abs(thin.segments[0].start.y);
  h.assert('a fat body\'s ANCHOR moves further than a thin arm\'s', fatAnchor > thinAnchor * 5,
    'fat ' + fatAnchor.toFixed(2) + ' vs thin ' + thinAnchor.toFixed(2) + ' — an offset would tie');
  var fatGrow = Math.abs(mid(fat.segments[0]).y);
  var thinGrow = Math.abs(mid(thin.segments[0]).y);
  h.assert('and so does its surface', fatGrow > thinGrow * 5,
    'fat ' + fatGrow.toFixed(2) + ' vs thin ' + thinGrow.toFixed(2) + ' — an offset would tie');
};
