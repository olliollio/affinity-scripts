/**
 * Engine tests for softbody.js. Needs planck; touches no Affinity API.
 *
 * The mass assertion is the one with teeth: overlapping circles double-count area badly, and a
 * jelly heavier than the rigid letter beside it bulldozes it.
 *
 * Every fixture is in SOURCE units (points), because addSoftBody is the boundary that converts.
 * A fixture written in sim units by mistake falls under the cell floor and comes back as
 * `fallback: 'thin'`, which is the first thing to check if these ever go red.
 */

'use strict';

function square(x0, y0, w, hgt) {
  return [x0, y0, x0 + w, y0, x0 + w, y0 + hgt, x0, y0 + hgt];
}

/** A closed ring approximating a circle, in SOURCE units. */
function disc(cx, cy, r, n) {
  var p = [];
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

module.exports = function (GR, h) {

  h.group('softbody: rig');

  var W = GR.makeWorld({ scale: 100 });
  var faces = [{ outer: square(0, 0, 300, 300), holes: [] }];
  var soft = GR.addSoftBody(W, faces, { name: 'blob', softness: 5, density: 1 });

  h.assert('a softbody is created', !!soft);
  h.assert('a softbody meshes', !soft.fallback);
  h.assert('a softbody has nodes', soft.nodes.length > 0);
  h.assert('every node is registered as a dynamic', W.dynamics.length === soft.nodes.length);
  h.assert('nodes are flagged so playback does not select them', soft.nodes[0].isSoftNode === true);

  // Self-collision must be filtered off, or overlapping circles inflate the shape apart.
  h.assert('a softbody has a negative filter group', soft.groupIndex < 0);

  // Playback drives every dynamic through the same record shape, so a soft node has to carry the
  // same fields a rope link does or it silently fails to draw.
  var rec = soft.nodes[0];
  h.assert('a node records its rest position in src units', typeof rec.ox === 'number' && typeof rec.oy === 'number');
  h.assert('a node records a sim radius', rec.simRadius > 0);
  h.assert('a node is named', typeof rec.name === 'string' && rec.name.indexOf('blob') === 0);

  // Springs are what make the nodes one object rather than a heap of circles.
  h.assert('a softbody has springs', soft.springCount > 0);

  h.group('softbody: softness');

  // Log-spaced, so the midpoint is the geometric mean rather than the arithmetic one.
  //
  // The soft end is 8Hz, not 2. Measured settled height as a fraction of rest height, 30s at 24/8:
  // a solid blob is at 0.755 at 8Hz, 0.452 at 6 and 0.131 at 4. Below 8 nothing holds its shape, so
  // the old 30..2 range spent half the slider on settings that were never usable.
  h.assertClose('softness 0 is the stiffest frequency', GR.softnessToFrequency(0), 30, 1e-9);
  h.assertClose('softness 1 is the softest frequency', GR.softnessToFrequency(1), 8, 1e-9);
  h.assert('softness 0.5 lies between the two',
    GR.softnessToFrequency(0.5) > 8 && GR.softnessToFrequency(0.5) < 30);
  // Log-spaced means the midpoint is the GEOMETRIC mean, sqrt(30*8) = 15.49, not the arithmetic 19.
  h.assertClose('softness 0.5 is the geometric mean', GR.softnessToFrequency(0.5),
    Math.sqrt(30 * 8), 1e-9);
  // `softness: 5` above is out of range and must clamp rather than produce a nonsense frequency.
  h.assertClose('softness clamps to the 0..1 range', soft.frequency, 8, 1e-9);

  h.group('softbody: the shell frequency floor');

  // A shape with a hole BUCKLES where a solid one squashes: a mass-spring lattice has no area
  // preservation, so nothing resists the hole ovalising. Measured settled height for a bold "O",
  // same rig: 0.831 at 30Hz, 0.756 at 26, 0.495 at 24, 0.227 at 22, 0.120 at 8. The cliff is
  // between 26 and 22, so 26 is the floor — and it is a floor rather than a remapping because a
  // SOLID shape is fine all the way down and must keep the range it has.
  var boldO = [{ outer: disc(150, 150, 150, 128), holes: [disc(150, 150, 90, 128)] }];
  var Wsh = GR.makeWorld({ scale: 100 });
  var shell = GR.addSoftBody(Wsh, boldO, { name: 'O', softness: 1 });
  h.assert('a bold ring meshes at all', !shell.fallback);
  h.assert('a shape with holes is floored at 26Hz even at softness 1', shell.frequency >= 26);
  h.assertClose('the floored frequency is exactly the floor', shell.frequency, 26, 1e-9);
  h.assertClose('and it records what was asked for', shell.frequencyRequested, 8, 1e-9);
  h.assertEqual('and says why it did not get it', shell.frequencyFloored, 'shell');

  // A SOLID shape keeps the whole range. This is the assertion that stops the floor being applied
  // to everything, which would make the slider almost inert.
  var Wsol = GR.makeWorld({ scale: 100 });
  var solid = GR.addSoftBody(Wsol, faces, { name: 'blob', softness: 1 });
  h.assertClose('a shape without holes reaches 8Hz at softness 1', solid.frequency, 8, 1e-9);
  h.assertEqual('and is not marked as floored', String(solid.frequencyFloored), 'null');

  // A shell asked for something stiffer than the floor keeps what it asked for — the floor lifts,
  // it never lowers.
  var Wst = GR.makeWorld({ scale: 100 });
  var stiffShell = GR.addSoftBody(Wst, boldO, { name: 'O', softness: 0 });
  h.assertClose('a shell at softness 0 keeps its 30Hz', stiffShell.frequency, 30, 1e-9);
  h.assertEqual('and is not marked as floored', String(stiffShell.frequencyFloored), 'null');

  // An explicit frequencyHz is a caller taking control of the solver and is NOT floored. Without
  // this the rigid-lattice measurement below would silently become a 26Hz spring.
  var Wex = GR.makeWorld({ scale: 100 });
  var explicit = GR.addSoftBody(Wex, boldO, { name: 'O', frequencyHz: 0 });
  h.assertClose('an explicit frequency is never floored', explicit.frequency, 0, 1e-9);

  h.group('softbody: mass');

  // Total mass must match what addBody would have given the same face, or jelly out-weighs
  // everything beside it. 300x300 points at scale 100 is 3x3 = 9 sim units of area, density 1.
  var total = 0;
  for (var i = 0; i < soft.nodes.length; i++) total += soft.nodes[i].body.getMass();
  h.assertClose('total mass equals area x density', total, 9, 0.05);

  // Equalise mass targets 1 for the whole OBJECT, exactly as bodies.js does.
  var W2 = GR.makeWorld({ scale: 100 });
  var eq = GR.addSoftBody(W2, faces, { name: 'blob', softness: 0.5, equaliseMass: true });
  var eqTotal = 0;
  for (var j = 0; j < eq.nodes.length; j++) eqTotal += eq.nodes[j].body.getMass();
  h.assertClose('equalised mass targets 1 for the object', eqTotal, 1, 0.01);

  // A two-face object is ONE softbody weighing 1, not two weighing 1 each — an "i" must not
  // outweigh an "l".
  var W3 = GR.makeWorld({ scale: 100 });
  var twoFace = [{ outer: square(0, 0, 300, 300), holes: [] }, { outer: square(0, 400, 200, 200), holes: [] }];
  var two = GR.addSoftBody(W3, twoFace, { name: 'i', softness: 0.5, equaliseMass: true });
  h.assert('a two-face object meshes', !two.fallback);
  var twoTotal = 0;
  for (var k = 0; k < two.nodes.length; k++) twoTotal += two.nodes[k].body.getMass();
  h.assertClose('a two-face object still weighs 1 in total', twoTotal, 1, 0.01);

  h.group('softbody: filter groups');

  // One group index for the whole object, so a lattice does not inflate itself apart on its own
  // overlapping node circles, and a DIFFERENT one per object, so two jellies still collide normally.
  var W4 = GR.makeWorld({ scale: 100 });
  var a = GR.addSoftBody(W4, faces, { name: 'a', softness: 0.5 });
  var b = GR.addSoftBody(W4, faces, { name: 'b', softness: 0.5 });
  h.assert('both softbodies filter self-collision', a.groupIndex < 0 && b.groupIndex < 0);
  h.assert('two softbodies get different filter groups', a.groupIndex !== b.groupIndex);
  var sameGroup = true;
  for (var g = 0; g < a.nodes.length; g++) {
    if (a.nodes[g].body.getFixtureList().getFilterGroupIndex() !== a.groupIndex) sameGroup = false;
  }
  h.assert('every node of one softbody shares its group', sameGroup);

  h.group('softbody: multi-face objects');

  /**
   * Drops the two faces of an "i" on a floor and returns their centroid separation, in sim units.
   *
   * The shared filter group means the two faces CANNOT collide with each other. That is deliberate
   * — they are one object, exactly as the rigid path puts every face's parts on one body — but it
   * means nothing except the cross-face springs stops the dot from ending up inside the stem. This
   * is the measurement that says whether they exist and work.
   */
  function discGap(opts) {
    var Wd = GR.makeWorld({ scale: 100, gravity: 10 });
    var cfg = { name: 'i', density: 1 };
    for (var key in opts) cfg[key] = opts[key];
    // Two 120pt discs, 300pt overall: 54 nodes at 12 cells, centroids 1.800 sim units apart.
    var pair = [
      { outer: disc(60, 60, 60, 64), holes: [] },
      { outer: disc(60, 240, 60, 64), holes: [] }
    ];
    var sb = GR.addSoftBody(Wd, pair, cfg);
    if (sb.fallback) return null;
    var floor = Wd.world.createBody();
    floor.createFixture(new GR.planck.Edge(new GR.planck.Vec2(-50, -6), new GR.planck.Vec2(50, -6)),
      { friction: 0.4 });
    for (var s = 0; s < 900; s++) Wd.world.step(1 / 60, 24, 8);
    var c0 = { n: 0, x: 0, y: 0 }, c1 = { n: 0, x: 0, y: 0 };
    for (var i = 0; i < sb.nodes.length; i++) {
      var p = sb.nodes[i].body.getPosition();
      var t = sb.mesh.faceOf[i] === 0 ? c0 : c1;
      t.n++; t.x += p.x; t.y += p.y;
    }
    var dx = c0.x / c0.n - c1.x / c1.n, dy = c0.y / c0.n - c1.y / c1.n;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // THE assertion this group exists for. Before the cross-face springs, this fixture settled at
  // 0.018 sim units from a rest separation of 1.800 — the two faces were coincident, having passed
  // straight through each other for 15 seconds. At softness 0 the springs are stiff enough that the
  // separation is essentially held: measured 1.791, against 1.797 with the springs made perfectly
  // rigid. This number cannot be recovered by any spring tuning if the springs are not there.
  var stiffGap = discGap({ softness: 0 });
  h.assert('two faces of one softbody stay apart', stiffGap !== null && stiffGap > 1.7);

  // At the DEFAULT softness the faces do sink into each other — the springs are soft, ground
  // friction resists the restoring pull, and there is no collision to stop it. Measured 0.954 at
  // the OLD 30..2 mapping, where softness 0.5 was 7.7Hz, and 1.787 at the 30..8 mapping that
  // replaced it — the second number is another way of reading why 2Hz was never a usable setting.
  // The claim here is only that they are not coincident, which is the failure being fixed; the
  // sharp number above is what guards the join itself.
  var softGap = discGap({ softness: 0.5 });
  h.assert('two faces stay apart at the default softness too', softGap !== null && softGap > 0.5);

  h.group('softbody: fallback');

  // A hairline cannot be jelly, and says so rather than building a degenerate rig.
  var Wt = GR.makeWorld({ scale: 100 });
  var hair = GR.addSoftBody(Wt, [{ outer: square(0, 0, 600, 2), holes: [] }], { name: 'hair' });
  h.assertEqual('a hairline falls back rather than meshing', hair.fallback, 'thin');
  h.assertEqual('a fallback adds no dynamics', Wt.dynamics.length, 0);

  h.group('softbody: solver sag and softness');

  /**
   * Drops a clamped beam and returns the tip's sag in SIM units.
   *
   * `opts` is passed straight through, so the rigid case can ask for `frequencyHz: 0` rather than
   * going through the softness mapping — softness 0 is 30Hz, which is a stiff SPRING and sags about
   * 2 sim units on this rig. Measuring solver convergence through a spring measures the spring.
   */
  function beamSag(opts, vIters, pIters) {
    var Wb = GR.makeWorld({ scale: 100 });
    var beam = [{ outer: square(0, 0, 240, 60), holes: [] }];
    var cfg = { name: 'beam', density: 1 };
    for (var key in opts) cfg[key] = opts[key];
    var sb = GR.addSoftBody(Wb, beam, cfg);
    if (sb.fallback) return null;

    // Clamp the left edge by pinning those nodes to a static body with a weld. A revolute pin lets
    // even a perfectly rigid beam swing down about it, and then every configuration reads the same
    // sag — that rig error has cost three wrong answers before.
    var anchor = Wb.world.createBody();
    var minX = Infinity;
    for (var i = 0; i < sb.nodes.length; i++) minX = Math.min(minX, sb.nodes[i].body.getPosition().x);
    var tip = null, tipX = -Infinity;
    for (var j = 0; j < sb.nodes.length; j++) {
      var p = sb.nodes[j].body.getPosition();
      if (p.x < minX + sb.cell * 0.75) {
        Wb.world.createJoint(new GR.planck.WeldJoint({ collideConnected: false }, anchor, sb.nodes[j].body, p));
      }
      if (p.x > tipX) { tipX = p.x; tip = sb.nodes[j].body; }
    }
    var y0 = tip.getPosition().y;
    for (var s = 0; s < 480; s++) Wb.world.step(1 / 60, vIters, pIters);
    return y0 - tip.getPosition().y;
  }

  // A RIGID lattice, with the iterations a soft scene uses. If this sags a lot, the softness
  // setting is measuring solver error rather than springs and no softer number means anything.
  //
  // The threshold is 0.30, NOT the spec's 0.105. Those two numbers come from different structures
  // and must not be swapped: the spec measured a plain 3-row grid cantilever with its whole left
  // column static, while a softbody is a boundary ring plus interior rows with only the few nodes
  // near the clamp pinned — structurally weaker. Measured on THIS rig: 0.112. The threshold takes
  // generous margin above that, because the number that matters is the one it EXCLUDES: the same
  // rigid beam at gravity's default 8/3 iterations sags 0.575, well over the threshold. This test
  // is what fails if the 24/8 raise for soft scenes is ever dropped. If it fails, the cause is the mesh spanning more than MAX_CELLS or a clamp
  // that is not rigid — do not relax it to make it pass.
  var stiff = beamSag({ frequencyHz: 0 }, 24, 8);
  h.assert('a rigid lattice holds at the cap', stiff !== null && Math.abs(stiff) < 0.30);

  // Monotonic, or the slider is not a control. Measured on THIS rig: 1.07 / 1.62 / 2.42 sim units
  // at softness 0 / 0.25 / 0.75, against 0.11 rigid. Only the ordering is asserted, because the
  // absolute values belong to this fixture and would drift with any change to it.
  //
  // Note that softness 0 sags TEN TIMES the rigid case: 0 maps to 30Hz, which is a stiff spring
  // and not a rigid constraint. Measuring solver convergence through it would measure the spring.
  var soft0 = beamSag({ softness: 0 }, 24, 8);
  var soft25 = beamSag({ softness: 0.25 }, 24, 8);
  var soft75 = beamSag({ softness: 0.75 }, 24, 8);
  h.assert('every softness sags more than rigid', soft0 > stiff);
  h.assert('softer sags more (0 -> 0.25)', soft25 > soft0);
  h.assert('softer sags more (0.25 -> 0.75)', soft75 > soft25);

  h.group('softbody: seed jitter');

  var Wj = GR.makeWorld({ scale: 100 });
  var jb = GR.addSoftBody(Wj, [{ outer: square(0, 0, 300, 300), holes: [] }], { name: 'blob', softness: 0.8 });
  h.assert('the jitter fixture meshed', !jb.fallback);
  GR.seedJitter(Wj, 7, 0.01);

  // Every node of one softbody must receive the SAME nudge, or the jitter deforms the shape at
  // frame 0 instead of breaking a symmetry. A 2Hz structure holds injected energy for a long time,
  // so this does not wash out on its own.
  var v0 = jb.nodes[0].body.getLinearVelocity();
  var same = true;
  for (var vi = 1; vi < jb.nodes.length; vi++) {
    var v = jb.nodes[vi].body.getLinearVelocity();
    if (Math.abs(v.x - v0.x) > 1e-12 || Math.abs(v.y - v0.y) > 1e-12) same = false;
  }
  h.assert('one softbody is jittered as a whole', same);

  // Two softbodies must still get DIFFERENT nudges, or the jitter stops breaking symmetry between
  // objects — which is the entire reason it exists.
  var jb2 = GR.addSoftBody(Wj, [{ outer: square(500, 0, 300, 300), holes: [] }], { name: 'blob2', softness: 0.8 });
  GR.seedJitter(Wj, 7, 0.01);
  var a = jb.nodes[0].body.getLinearVelocity();
  var b = jb2.nodes[0].body.getLinearVelocity();
  h.assert('two softbodies get different nudges', Math.abs(a.x - b.x) > 1e-12);
};
