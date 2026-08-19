'use strict';
var F = require('./fixtures');

module.exports = function (GR, h) {
  h.group('thickness — classification and sign');

  // tau over-reports by tau/(1 - cos th) where th is the angle the binding wall makes with the
  // probe path. Head-on (a slab, a disc, an annulus wall, a flat side) that is exactly tau. Across
  // a convex corner it is not: on this rounded rectangle the binding wall is the top edge at 45
  // degrees, giving 6.8*tau. That is a property of the geometry, not a slack to be tightened.
  //
  // The head-on over-report is EXACTLY tau by construction, so asserting "within tau" is asserting
  // equality at the boundary and fails on floating-point dust — measured at 6.7e-15 over, on the
  // annulus. Every head-on tolerance below therefore carries a 1% margin, which is slack against
  // arithmetic and not against the geometry.
  var MARGIN = 1.01;

  function one(curves, tol) {
    var c = GR.inflClassify(curves, tol), r = c.recs[0];
    return { rec: r, ctx: GR.inflProbeCtx(r.face, tol) };
  }

  var TOL = 0.1;   // absolute here ONLY so these unit numbers stay hand-checkable

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
};
