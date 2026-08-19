'use strict';
var F = require('./fixtures');

module.exports = function (GR, h) {
  h.group('thickness — classification and sign');

  // tau inflates the probe RADIUS by tau/(1 - cos th), where th is the angle between the binding
  // wall and the probe path. t = 2r, so the error in t is DOUBLE that - the two numbers below are
  // easy to conflate and the factor of two is real, not a fudge.
  //
  // Head-on, the radius error is tau/2 and the t error is tau: measured exactly on the slab and the
  // annulus wall, and 0.858*tau on the disc, where the flattening deficit partly cancels it. So a
  // head-on tolerance of tau is an upper bound.
  //
  // Across a convex corner it is not head-on. On this rounded rectangle the probe centre passes the
  // corner arc's own centre and the binding walls become the top and right edges, symmetric at 45
  // degrees to the probe path: tau/(1 - cos 45) = 3.41*tau of radius error, measured 3.38, so
  // 6.8*tau on t, measured 6.76. That is a property of the geometry, not slack to be tightened.
  //
  // Head-on being an EXACT upper bound is what makes "within tau" an assertion of equality at the
  // boundary, which fails on floating-point dust - measured 6.7e-15 over, on the annulus. Every
  // head-on tolerance below therefore carries a 1% margin: slack against arithmetic, not geometry.
  var MARGIN = 1.01;

  function one(curves, tol) {
    var c = GR.inflClassify(curves, tol), r = c.recs[0];
    return { rec: r, ctx: GR.inflProbeCtx(r.face, tol) };
  }

  var TOL = 0.1;   // absolute here ONLY so these unit numbers stay hand-checkable

  // Every tolerance below is a multiple of ctx.tau, so widening tau would loosen the whole suite in
  // lockstep and stay green while accuracy degraded. The tau = 0 test at the bottom pins the floor;
  // this pins the ceiling. tau = 2*tol + float dust, and TOL is 0.1 here.
  h.assertClose('tau is twice the flatten tolerance',
    GR.inflProbeCtx(GR.inflClassify([F.rect(0, 0, 40, 400)], TOL).recs[0].face, TOL).tau, 0.2, 1e-6);

  var slab = one([F.rect(0, 0, 40, 400)], TOL);
  h.assertClose('slab of width 40 measures 40',
    GR.inflSegmentThickness(F.rect(0, 0, 40, 400).segments[1], slab.rec.sign, slab.ctx).t,
    40, slab.ctx.tau * MARGIN);

  var disc = one([F.circle(0, 0, 100)], TOL);
  h.assertClose('disc of radius 100 measures 200',
    GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, disc.ctx).t,
    200, disc.ctx.tau * MARGIN);

  var rr = F.roundRect(0, 0, 300, 100, 20), rrc = one([rr], TOL);
  h.assertClose('rounded rect flat side measures the full 100',
    GR.inflSegmentThickness(rr.segments[0], rrc.rec.sign, rrc.ctx).t, 100, rrc.ctx.tau * MARGIN);
  h.assertClose('rounded rect corner arc measures the arc, not the body',
    GR.inflSegmentThickness(rr.segments[1], rrc.rec.sign, rrc.ctx).t, 40, 6.8 * rrc.ctx.tau);

  // An annulus is the case that proves distanceToRings is evaluated against the segment's OWN face,
  // holes included: measured across the wall it is 30, not the 200 of the outer disc.
  var ann = GR.inflClassify([F.circle(0, 0, 100), F.circle(0, 0, 70, false)], TOL);
  var actx = GR.inflProbeCtx(ann.recs[0].face, TOL);
  h.assertClose('annulus wall of 30 measures 30',
    GR.inflSegmentThickness(ann.recs[0].curve.segments[0], ann.recs[0].sign, actx).t, 30, actx.tau * MARGIN);
  h.assertEqual('annulus is one face with one hole', ann.faces.length + '/' + ann.faces[0].holes.length, '1/1');

  // The sign is what makes ONE normal formula point away from the MATERIAL on every ring: outward
  // on an outer ring, into the void on a counter.
  //
  // A counter's sign is NOT simply -1. It is the product of its role and its OWN winding, because
  // (ey, -ex) already points into the void of a negatively-wound hole and needs no flip there. So
  // the assertion is that the sign TRACKS the winding, and — the thing that actually matters — that
  // the counter closes either way. Measured: a hole at either winding closes from 70 to 62.447,
  // identically. Asserting `sign === -1` instead fails on a correct implementation.
  var holeNeg = GR.inflClassify([F.circle(0,0,100), F.circle(0,0,70,false)], TOL);
  var holePos = GR.inflClassify([F.circle(0,0,100), F.circle(0,0,70)], TOL);
  h.assertEqual('outer ring sign is +1', holeNeg.recs[0].sign, 1);
  h.assertEqual('a negatively-wound counter signs +1', holeNeg.recs[1].sign, 1);
  h.assertEqual('a positively-wound counter signs -1', holePos.recs[1].sign, -1);

  // Reflection invariance: the same disc wound the other way must classify the same, because the
  // signed area is taken in the SAME space the normals are.
  var revd = GR.inflClassify([F.circle(0, 0, 100, false)], TOL);
  h.assertClose('mirrored winding measures the same thickness',
    GR.inflSegmentThickness(revd.recs[0].curve.segments[0], revd.recs[0].sign,
                            GR.inflProbeCtx(revd.recs[0].face, TOL)).t, 200, disc.ctx.tau * MARGIN);

  h.group('thickness — the tolerance classify chose is the one the probe must use');
  // Every other assertion here hands classify an explicit TOL, which leaves TOL_FRAC, hullDiagonal
  // and tolFor untested — and hides the coupling that matters: classify picks ONE tolerance for the
  // whole selection from the hull of every curve, so a face's own box is not what its rings were
  // flattened at. A letter "i" is the smallest shape where those diverge. classify's hull is 408
  // across and picks tol 0.2040, while the dot's own box is 70.7 and would pick 0.0354 — a tau five
  // times too small to cover chords flattened at the stem's scale. Measured, the dot then reads
  // 31.00 against a true 50: not a zero that fails loudly, a plausible number that ships as "the
  // dots on the i's look under-inflated". probeCtx now REQUIRES the tolerance for that reason, and
  // this measures the small face at the tolerance classify actually used.
  var stem = F.rect(0, 0, 40, 300), dot = F.circle(20, -80, 25);
  var iCls = GR.inflClassify([stem, dot]);            // no explicit tol: tolFor picks it
  var dotCtx = GR.inflProbeCtx(iCls.recs[1].face, iCls.tol);
  h.assertEqual('an "i" is two faces', iCls.faces.length, 2);
  h.assertClose('the small face measures at the SELECTION tolerance, not its own',
    GR.inflSegmentThickness(dot.segments[0], iCls.recs[1].sign, dotCtx).t, 50, dotCtx.tau * MARGIN);

  h.group('thickness — pass-through cases');
  var pt = GR.inflClassify([F.openPath(), F.degenerateRing()], TOL);
  h.assertEqual('an open path is marked for pass-through', pt.recs[0].skip, 'open');
  h.assert('a zero-area ring is marked for pass-through', !!pt.recs[1].skip, 'got ' + pt.recs[1].skip);

  h.group('thickness — tau is load-bearing');
  // With no tau the probe finds nothing on any curved boundary. B(0.5) is itself a flattening
  // vertex, so its own distance to the ring is 0; the deficit lives in the NEIGHBOURING chords,
  // which cut inside the true arc. This asserts the failure, so nobody "simplifies" tau away.
  var noTau = { face: disc.rec.face, tau: 0, maxR: disc.ctx.maxR };
  h.assert('tau = 0 collapses a curved probe to nothing',
    GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, noTau).t < 0.01,
    'got ' + GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, noTau).t);

  h.group('thickness — the anchor measure across corner angles');

  // A bisector probe at a corner of interior angle th is capped at tau/(1 - sin(th/2)) by the
  // corner's own walls and by NOTHING to do with the material. At 90 degrees that is 3.41*tau, so a
  // square slips under a fixed 4*tau floor and a square-only test passes; at 108 degrees it is
  // 5.2*tau and a pentagon does not. Every one of these must come back as the across-flats width.
  [3, 4, 5, 6, 8, 12, 24, 48].forEach(function (n) {
    var g = F.ngon(0, 0, 100, n);
    var cl = GR.inflClassify([g]), rec = cl.recs[0], ctx = GR.inflProbeCtx(rec.face, cl.tol);
    var m = GR.inflAnchorMeasure(g.segments, 0, rec.sign, ctx);
    h.assertClose(n + '-gon anchor measures its across-flats width',
      m.t, 2 * 100 * Math.cos(Math.PI / n), 8 * ctx.tau);
  });

  // The other half of the same rule: at a SMOOTH anchor the anchor's own probe is the more accurate
  // measure and must be kept. On a 300x100 rounded rectangle with corner radius 20, the anchor
  // joining arc to side measures 40 by its own probe against 100 for the adjacent long side, so
  // "take the larger adjacent segment" over-reports by 2.5x at exactly the anchors where nothing
  // was wrong.
  var rr2 = F.roundRect(0, 0, 300, 100, 20);
  var rcl = GR.inflClassify([rr2]), rrec = rcl.recs[0], rctx = GR.inflProbeCtx(rrec.face, rcl.tol);
  var sm = GR.inflAnchorMeasure(rr2.segments, 1, rrec.sign, rctx);
  h.assert('smooth anchor uses its OWN probe', sm.wellPosed === true, 'wellPosed ' + sm.wellPosed);
  h.assertClose('smooth anchor measures the arc (40), not the side (100)', sm.t, 40, 8 * rctx.tau);

  // A reflex junction: at the notch of a star the LARGER adjacent segment is the right answer, and
  // the smaller would crease the notch away from the body it belongs to.
  var st = F.star(0, 0, 100, 40, 5);
  var scl = GR.inflClassify([st]), srec = scl.recs[0], sctx = GR.inflProbeCtx(srec.face, scl.tol);
  var tip = GR.inflAnchorMeasure(st.segments, 0, srec.sign, sctx);
  h.assert('a spike measures its LOCAL width, not the star diameter', tip.t < 60,
    'got ' + tip.t.toFixed(2) + ' against a diameter of 200');
};
