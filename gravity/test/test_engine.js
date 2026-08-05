/**
 * Engine-layer tests: world.js, bodies.js, sim.js.
 *
 * These need planck but still no Affinity API, so they run headlessly like the geometry tests.
 * What they are really guarding is the boundary — scale, the y-axis flip and the winding reversal
 * that comes with it — because a mistake there produces a simulation that runs perfectly and is
 * wrong in a way no assertion inside planck would ever catch.
 */

'use strict';

function box(x0, y0, x1, y1) {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

function ring(cx, cy, r, n, ccw) {
  var p = [];
  for (var i = 0; i < n; i++) {
    var a = (ccw ? i : n - 1 - i) / n * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

module.exports = function (GR, h) {

  // ------------------------------------------------------------------ centroid
  h.group('bodies: centroid');

  var sq = box(0, 0, 100, 100);
  var c = GR.ringCentroid(sq);
  h.assertClose('a square centroid is its middle (x)', c.x, 50, 1e-9);
  h.assertClose('a square centroid is its middle (y)', c.y, 50, 1e-9);
  h.assertClose('a square area is w*h', Math.abs(c.area), 10000, 1e-9);

  // Two equal squares side by side: the combined centroid sits between them.
  var pair = GR.partsCentroid([box(0, 0, 10, 10), box(90, 0, 100, 10)]);
  h.assertClose('two equal parts centroid is midway', pair.x, 50, 1e-9);

  // Area weighting must actually weight: a big part pulls the centroid towards itself.
  var uneven = GR.partsCentroid([box(0, 0, 90, 90), box(90, 0, 100, 10)]);
  h.assert('a larger part dominates the centroid', uneven.x < 50,
    'centroid x was ' + uneven.x.toFixed(3));

  h.assertClose('bounding radius of a centred square', GR.boundingRadius([sq], 50, 50),
    Math.sqrt(50 * 50 + 50 * 50), 1e-9);

  // ------------------------------------------------------------------- world
  h.group('world: scale and axes');

  var W = GR.makeWorld({ scale: 100, gravityY: -10 });
  h.assertEqual('world starts with no dynamics', W.dynamics.length, 0);
  h.assert('sleeping is on by default', W.world.getAllowSleeping() === true);

  var v = GR.toSim(W, 500, 300);
  h.assertClose('toSim divides by scale', v.x, 5, 1e-12);
  h.assertClose('toSim flips y', v.y, -3, 1e-12);

  var back = GR.toSrc(W, 5, -3);
  h.assertClose('toSrc round-trips x', back.x, 500, 1e-9);
  h.assertClose('toSrc round-trips y', back.y, 300, 1e-9);

  // -------------------------------------------------------------- gravity dial
  h.group('ui: gravity vector');

  // Angle 0 is down the page. Affinity's y points down and planck's points up, so "down" must come
  // out NEGATIVE in sim units — the same flip the geometry gets, applied to acceleration.
  var down = GR.gravityVector(1000, 0, 100);
  h.assertClose('angle 0 has no sideways component', down.x, 0, 1e-12);
  h.assertClose('angle 0 pulls down the page', down.y, -10, 1e-12);

  var right = GR.gravityVector(1000, 90, 100);
  h.assertClose('angle 90 pulls right', right.x, 10, 1e-12);
  h.assertClose('and not vertically', right.y, 0, 1e-12);

  var up = GR.gravityVector(1000, 180, 100);
  h.assertClose('angle 180 pulls up the page', up.y, 10, 1e-12);

  var left = GR.gravityVector(1000, 270, 100);
  h.assertClose('angle 270 pulls left', left.x, -10, 1e-12);

  // The magnitude is in document units, so the world scale has to divide it exactly once.
  h.assertClose('gravity divides by the world scale', GR.gravityVector(3000, 0, 100).y, -30, 1e-12);
  h.assertClose('a different scale changes it', GR.gravityVector(1000, 0, 50).y, -20, 1e-12);

  // ------------------------------------------------------------------ fixtures
  h.group('bodies: fixtures');

  var W2 = GR.makeWorld({ scale: 100 });
  var letterO = GR.decompose({ outer: ring(0, 0, 250, 120, true), holes: [ring(0, 0, 150, 120, false)] });
  h.assert('the O decomposes into parts', letterO.length > 1, 'got ' + letterO.length);

  var recO = GR.addBody(W2, letterO, { density: 1 });
  h.assert('every part became a fixture', recO.fixtures === letterO.length,
    recO.fixtures + ' of ' + letterO.length + ', rejected ' + JSON.stringify(recO.rejected));
  h.assertEqual('no part was rejected', recO.rejected.length, 0);

  // The winding reversal is the point: planck rebuilds hulls, so a fixture count alone would not
  // prove the vertices arrived in the right order. Vertex counts surviving intact does.
  var totalIn = 0;
  for (var i = 0; i < letterO.length; i++) totalIn += letterO[i].length / 2;
  var totalOut = 0, f = recO.body.getFixtureList();
  while (f) { totalOut += f.getShape().m_vertices.length; f = f.getNext(); }
  h.assertEqual('no vertices were dropped rebuilding hulls', totalOut, totalIn);

  // A hollow O must weigh less than the disc that contains it. This is the payoff for real holes,
  // and it is the one thing physicsdrop could not express.
  var W3 = GR.makeWorld({ scale: 100 });
  var disc = GR.decompose({ outer: ring(0, 0, 250, 120, true), holes: [] });
  var recDisc = GR.addBody(W3, disc, { density: 1 });
  h.assert('a hollow O weighs less than a solid disc',
    recO.body.getMass() < recDisc.body.getMass() * 0.75,
    'O ' + recO.body.getMass().toFixed(4) + ' vs disc ' + recDisc.body.getMass().toFixed(4));

  // Body origin is the centroid, so position maps straight back with no bookkeeping.
  var st = GR.bodyState(W2, recO);
  h.assertClose('body position starts at the centroid (x)', st.x, recO.ox, 1e-6);
  h.assertClose('body position starts at the centroid (y)', st.y, recO.oy, 1e-6);

  // ------------------------------------------------------------- equalise mass
  h.group('bodies: equalise mass');

  function discOfRadius(W2, r) {
    return GR.addBody(W2, GR.decompose({ outer: ring(0, 0, r, 48, true), holes: [] }),
      { equaliseMass: arguments[2], targetMass: 1 });
  }

  var Wm = GR.makeWorld({ scale: 100 });
  var small = discOfRadius(Wm, 40, false);
  var big = discOfRadius(Wm, 400, false);
  var ratio = big.body.getMass() / small.body.getMass();
  // Mass is area x density, so a 10x radius is a 100x mass. This is the problem being solved:
  // a placed photo simply bulldozes a letter.
  h.assert('by default a 10x larger object is ~100x heavier', ratio > 50 && ratio < 200,
    'ratio was ' + ratio.toFixed(1));

  var We = GR.makeWorld({ scale: 100 });
  var smallEq = discOfRadius(We, 40, true);
  var bigEq = discOfRadius(We, 400, true);
  h.assertClose('equalised, the small one hits the target mass', smallEq.body.getMass(), 1, 0.02);
  h.assertClose('equalised, the large one hits it too', bigEq.body.getMass(), 1, 0.02);

  // Rotational inertia must still grow with size, or a huge object would spin like a small one.
  h.assert('but a larger body still resists rotation more',
    bigEq.body.getInertia() > smallEq.body.getInertia() * 10,
    'inertia ' + bigEq.body.getInertia().toFixed(4) + ' vs ' + smallEq.body.getInertia().toFixed(4));

  // The reason the old Density control was dropped: one global density leaves every mass RATIO
  // unchanged, and contact response depends only on ratios, so nothing about the run can differ.
  function pileWithDensity(density) {
    var Wd = GR.makeWorld({ scale: 100, gravityY: -10 });
    GR.addBounds(Wd, { x: -700, y: -700, width: 1400, height: 1400 });
    for (var q = 0; q < 4; q++) {
      var pts = GR.decompose({ outer: box(-90 + q * 40, -500 + q * 200, 90 + q * 40, -420 + q * 200), holes: [] });
      GR.addBody(Wd, pts, { density: density, friction: 0.4, restitution: 0.15 });
    }
    return GR.run(Wd, { maxFrames: 600, seed: 7 });
  }
  var dA = pileWithDensity(1), dB = pileWithDensity(25);
  h.assertEqual('a global density change does not alter the frame count', dA.frameCount, dB.frameCount);
  var maxDiff = 0;
  for (var bi2 = 0; bi2 < dA.bodyCount; bi2++) {
    var pa = GR.poseAt(dA, dA.frameCount - 1, bi2);
    var pb = GR.poseAt(dB, dB.frameCount - 1, bi2);
    maxDiff = Math.max(maxDiff, Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
  }
  h.assert('nor the final poses — which is why it is not a control', maxDiff < 1e-6,
    'worst difference ' + maxDiff.toFixed(9) + ' pt');

  // --------------------------------------------------------------- auto scale
  h.group('world: scale chosen from the artwork');

  // A fixed scale cannot serve both a 500pt letter and a 12pt one, because linearSlop is a
  // constant in SIM units: at scale 100 a 12pt glyph stem is barely three times the tolerance the
  // contact solver works to, and it skitters instead of settling.
  h.assertClose('a 300pt scene lands near 3 sim units', 300 / GR.suggestScale([300, 280, 320]), 3, 0.2);
  h.assertClose('a 12pt scene does too', 12 / GR.suggestScale([12, 11, 13]), 3, 0.2);

  // The median, not the mean, so one huge background object cannot drag the scene out of band.
  var withOutlier = GR.suggestScale([20, 22, 24, 26, 5000]);
  h.assert('one huge object does not dominate', withOutlier < 20,
    'scale was ' + withOutlier.toFixed(2));

  h.assertEqual('no sizes falls back to the default', GR.suggestScale([]), GR.WORLD_SCALE);
  h.assertEqual('zero sizes fall back too', GR.suggestScale([0, 0]), GR.WORLD_SCALE);
  h.assert('the result is clamped', GR.suggestScale([1e12]) <= 10000);

  // ---------------------------------------------------------------- scale check
  h.group('world: scale check');

  h.assert('a 500pt letter at scale 100 is in band', GR.checkScale(W2).ok === true,
    GR.checkScale(W2).note);

  var Wbad = GR.makeWorld({ scale: 1 });
  GR.addBody(Wbad, disc, {});
  var bad = GR.checkScale(Wbad);
  h.assert('scale 1 is flagged as out of band', bad.ok === false, bad.note);
  h.assert('the warning is recorded on the world', Wbad.warnings.length === 1);

  // -------------------------------------------------------------------- sim
  h.group('sim: gravity and settling');

  var W4 = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addBounds(W4, { x: -600, y: -600, width: 1200, height: 1200 });
  var falling = GR.addBody(W4, GR.decompose({ outer: box(-50, -400, 50, -300), holes: [] }), {});
  var startY = GR.bodyState(W4, falling).y;

  var rec = GR.run(W4, { maxFrames: 600 });
  h.assert('the sim settles rather than hitting the cap', rec.settled === true,
    'ran ' + rec.frameCount + ' frames, hitFrameCap=' + rec.hitFrameCap);
  h.assertEqual('one body was recorded', rec.bodyCount, 1);
  h.assertEqual('the recording is 3 floats per body per frame',
    rec.frames.length, rec.frameCount * rec.bodyCount * 3);

  // Gravity is negative in sim units and y is flipped, so in SRC units the body must move DOWN,
  // meaning y increases. Getting this backwards is the classic axis bug and looks like antigravity.
  var endY = GR.poseAt(rec, rec.frameCount - 1, 0).y;
  h.assert('the body fell downwards in src coordinates', endY > startY,
    'started at y=' + startY.toFixed(2) + ' ended at y=' + endY.toFixed(2));

  h.assert('the body came to rest inside the bounds', endY < 600,
    'ended at y=' + endY.toFixed(2));

  // ---------------------------------------------------------------- determinism
  h.group('sim: determinism');

  function runSeeded(seed) {
    var Wx = GR.makeWorld({ scale: 100, gravityY: -10 });
    GR.addBounds(Wx, { x: -600, y: -600, width: 1200, height: 1200 });
    for (var k = 0; k < 4; k++) {
      GR.addBody(Wx, GR.decompose({ outer: box(-40, -400 + k * 90, 40, -330 + k * 90), holes: [] }), {});
    }
    return GR.run(Wx, { maxFrames: 600, seed: seed });
  }

  var a = runSeeded(1234);
  var b = runSeeded(1234);
  var d = runSeeded(9999);

  h.assertEqual('the same seed gives the same frame count', a.frameCount, b.frameCount);
  var identical = a.frames.length === b.frames.length;
  for (var q = 0; identical && q < a.frames.length; q++) {
    if (a.frames[q] !== b.frames[q]) identical = false;
  }
  h.assert('the same seed reproduces the drop exactly', identical);

  var differs = a.frameCount !== d.frameCount;
  if (!differs) {
    for (var z = 0; z < a.frames.length; z++) {
      if (Math.abs(a.frames[z] - d.frames[z]) > 1e-9) { differs = true; break; }
    }
  }
  h.assert('a different seed gives a different drop', differs);

  // ------------------------------------------------------- embedded in a wall
  h.group('sim: a body that starts inside a wall');

  // planck lets an island sleep only when the position solver has ALSO converged
  // (minSleepTime >= timeToSleep && positionSolved). A COMPOUND body deeply embedded in static
  // geometry never converges: its many fixtures penetrate the same wall and impose position
  // corrections that cannot all be satisfied at once, while the wall cannot move aside and
  // per-step correction is capped. The body then sits at exactly zero velocity, awake,
  // indefinitely. A single-fixture body does NOT reproduce this — it simply pushes itself out.
  // Ordinary artwork dropped overlapping its container hits exactly this, so the run has to end.
  function sunkO(W) {
    var parts = GR.decompose({ outer: ring(0, 0, 120, 100, true), holes: [ring(0, 0, 70, 100, false)] });
    // Floor at src y=800, so a centre at 776 embeds most of the lower rim.
    var moved = parts.map(function (p) {
      var q = p.slice();
      for (var t = 1; t < q.length; t += 2) q[t] += 776;
      return q;
    });
    return GR.addBody(W, moved, {});
  }

  var Wstuck = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addBounds(Wstuck, { x: -800, y: -800, width: 1600, height: 1600 });
  var sunk = sunkO(Wstuck);
  h.assert('the sunk body was created', sunk !== null);
  h.assert('it really is compound', sunk.fixtures > 10, 'only ' + sunk.fixtures + ' fixtures');

  var stuckRec = GR.run(Wstuck, { maxFrames: 400 });
  h.assert('an embedded body is reported as overlapping static geometry',
    stuckRec.staticOverlaps.length > 0,
    'found ' + stuckRec.staticOverlaps.length);
  h.assert('the run still ends', stuckRec.settled === true,
    'settledBy=' + stuckRec.settledBy + ' frames=' + stuckRec.frameCount);
  h.assertEqual('it ends by quiescence, not by sleeping', stuckRec.settledBy, 'quiescence');
  h.assert('and it ends well before the frame cap', stuckRec.frameCount < 400,
    'took ' + stuckRec.frameCount);

  // With the backstop disabled the same scene must run to the cap. Without this the test above
  // would still pass if quiescence never fired and sleeping quietly worked after all.
  var Wstuck2 = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addBounds(Wstuck2, { x: -800, y: -800, width: 1600, height: 1600 });
  sunkO(Wstuck2);
  var noBackstop = GR.run(Wstuck2, { maxFrames: 200, quietFrames: 0 });
  h.assert('without the backstop it never settles', noBackstop.settled === false,
    'settledBy=' + noBackstop.settledBy);
  h.assert('and it is awake at zero velocity, which is the whole point',
    Math.hypot(Wstuck2.dynamics[0].body.getLinearVelocity().x,
               Wstuck2.dynamics[0].body.getLinearVelocity().y) < 1e-6 &&
    Wstuck2.dynamics[0].body.isAwake() === true);

  // A capped run reports what was still moving, because "it hit the cap" on its own cannot
  // distinguish a scene that is genuinely creeping from one that is motionless but unsleepable.
  // This is the second case: awake, and not moving at all.
  h.assert('a capped run reports bodies still awake', noBackstop.restless.awake > 0,
    'awake=' + noBackstop.restless.awake);
  h.assertEqual('but none of them are over the sleep tolerance',
    noBackstop.restless.overTolerance, 0);
  h.assert('so the reported top speed is essentially zero',
    noBackstop.restless.maxLinear < noBackstop.restless.linearTolerance,
    'maxLinear=' + noBackstop.restless.maxLinear);

  // And the first case: capped while genuinely in motion. Five frames is nowhere near enough to
  // land, so the bodies are still falling and must be reported as such.
  var Wfalling = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addBounds(Wfalling, { x: -800, y: -800, width: 1600, height: 1600 });
  GR.addBody(Wfalling, GR.decompose({ outer: ring(0, 400, 120, 60, true), holes: [] }), {});
  var fallingRec = GR.run(Wfalling, { maxFrames: 5 });
  h.assertEqual('a run capped mid-fall ends on the cap', fallingRec.settledBy, 'cap');
  h.assert('and reports a speed well over the tolerance',
    fallingRec.restless.maxLinear > fallingRec.restless.linearTolerance * 10,
    'maxLinear=' + fallingRec.restless.maxLinear);
  h.assert('with every body counted as over tolerance',
    fallingRec.restless.overTolerance === fallingRec.restless.total,
    fallingRec.restless.overTolerance + '/' + fallingRec.restless.total);

  // A clean scene must still settle by SLEEPING, or the backstop is masking a real regression.
  var Wclean = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addBounds(Wclean, { x: -800, y: -800, width: 1600, height: 1600 });
  for (var g = 0; g < 4; g++) {
    var o4 = GR.decompose({ outer: ring(0, 0, 120, 60, true), holes: [ring(0, 0, 70, 60, false)] });
    var shifted = o4.map(function (p) {
      var q = p.slice();
      for (var t = 0; t < q.length; t += 2) { q[t] += (g - 1.5) * 260; q[t + 1] -= 400; }
      return q;
    });
    GR.addBody(Wclean, shifted, {});
  }
  var cleanRec = GR.run(Wclean, { maxFrames: 1200 });
  h.assertEqual('a clean scene settles by sleeping', cleanRec.settledBy, 'sleep');
  h.assertEqual('a clean scene reports no static overlaps', cleanRec.staticOverlaps.length, 0);
  h.assertEqual('and nothing is left awake when it sleeps', cleanRec.restless.awake, 0);

  // ------------------------------------------------------------------- bullets
  h.group('bodies: continuous collision');

  var W5 = GR.makeWorld({ scale: 100 });
  var small = GR.addBody(W5, GR.decompose({ outer: box(0, 0, 8, 8), holes: [] }), {});
  var large = GR.addBody(W5, GR.decompose({ outer: box(0, 0, 400, 400), holes: [] }), {});
  h.assert('a small body gets continuous collision', small.bullet === true,
    'simRadius ' + small.simRadius.toFixed(4));
  h.assert('a large body does not', large.bullet === false,
    'simRadius ' + large.simRadius.toFixed(4));

  // A fast small body must not pass through a wall. physicsdrop had no CCD and substepped instead.
  var W6 = GR.makeWorld({ scale: 100, gravityY: 0 });
  GR.addStaticChain(W6, box(-500, 200, 500, 210), { closed: true });
  var bullet = GR.addBody(W6, GR.decompose({ outer: box(-5, -5, 5, 5), holes: [] }), {});
  bullet.body.setLinearVelocity(new GR.planck.Vec2(0, -60)); // downwards in src terms
  GR.run(W6, { maxFrames: 120 });
  var finalY = GR.bodyState(W6, bullet).y;
  h.assert('a fast small body does not tunnel through a wall', finalY < 260,
    'ended at y=' + finalY.toFixed(2) + ' (wall at 200)');
};
