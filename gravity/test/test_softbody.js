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

  // The reference the pressure term defends. Recorded at build, in SIM units, because that is the
  // space softmesh works in and the ratio must not depend on where the artwork sat on the page.
  h.assert('a rig records its rest ring areas', !!soft.restRings);
  h.assertEqual('a hole-less face has one rest ring', soft.restRings.length, 1);
  h.assert('a rest ring has area', Math.abs(soft.restRings[0].area) > 0);
  h.assert('a rest ring has perimeter', soft.restRings[0].perimeter > 0);

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
  // same rig: 0.831 at 30Hz, 0.801 at 28, 0.756 at 26, 0.495 at 24, 0.227 at 22, 0.120 at 8.
  //
  // The floor is 28, not 26, because buckling is a BIFURCATION and the cliff does not reproduce.
  // Perturbing only the flattening resolution of one identical ring, 26Hz gives 0.218 / 0.758 /
  // 0.756 / 0.763 at n = 96 / 112 / 128 / 160 — a spread of 0.545, so at 26 the same "O" either
  // squashes or collapses depending on how finely its curves flattened. At 28 the spread is 0.015.
  // A floor inside the cliff is not a floor. It is a floor rather than a remapping because a
  // SOLID shape is fine all the way down and must keep the range it has.
  var boldO = [{ outer: disc(150, 150, 150, 128), holes: [disc(150, 150, 90, 128)] }];
  var Wsh = GR.makeWorld({ scale: 100 });
  var shell = GR.addSoftBody(Wsh, boldO, { name: 'O', softness: 1 });
  h.assert('a bold ring meshes at all', !shell.fallback);
  h.assert('a shape with holes is floored above the cliff even at softness 1', shell.frequency >= 28);
  h.assertClose('the floored frequency is exactly the floor', shell.frequency, GR.SOFT_SHELL_MIN_FREQ, 1e-9);
  h.assertEqual('the floor sits above the unreproducible cliff', GR.SOFT_SHELL_MIN_FREQ, 28);
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
  // this the rigid-lattice measurement below would silently become a 28Hz spring.
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
  // Checked on the WORLD collider specifically, not on whichever fixture happens to be first:
  // planck PREPENDS on createFixture, so a boundary node's self-contact circle is the head of the
  // list and reads group 0 by design. Identify it by radius instead of by position.
  var sameGroup = true, selfGroupsZero = true, sawSelf = false;
  for (var g = 0; g < a.nodes.length; g++) {
    for (var gf = a.nodes[g].body.getFixtureList(); gf; gf = gf.getNext()) {
      if (gf.getShape().m_radius >= GR.SOFT_RADIUS_FRAC * a.cell) {
        if (gf.getFilterGroupIndex() !== a.groupIndex) sameGroup = false;
      } else {
        sawSelf = true;
        if (gf.getFilterGroupIndex() !== 0) selfGroupsZero = false;
      }
    }
  }
  h.assert('every node of one softbody shares its group', sameGroup);
  h.assert('the softbody has self-contact fixtures at all', sawSelf);
  h.assert('every self-contact fixture is in no group', selfGroupsZero);

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

  // ------------------------------------------------------------------ self-collision
  //
  // THE frame-0 assertion for self-collision. Every boundary pair with no spring between it must
  // start OUTSIDE the self-contact distance, or the shape is pushed apart on step one.
  //
  // Four of the ten real scene shapes violate this without braces - yellowgreen at 0.401 cell,
  // pink 0.420, cyan 0.429, green 0.493, against a 0.500 cell contact distance - and three of
  // those four do not even fold, so the naive fix would have broken shapes that work today.
  //
  // The teardrops are here because the scene alone never exercises a ring separation above 2, and
  // the whole rule turns on separations of 3, 4 and 6 occurring on ordinary shapes.
  h.group('softbody: no pair starts in self-contact');

  var scene = require('./fixtures_softscene');

  function noPairInContact(label, ring) {
    var Wc = GR.makeWorld({ scale: 100 });
    var rig = GR.addSoftBody(Wc, [{ outer: ring, holes: [] }], { name: label, softness: 0.25 });
    h.assert(label + ' meshes', !rig.fallback, rig.fallback || '');
    if (rig.fallback) return null;

    var mesh = rig.mesh, contact = 2 * GR.SOFT_SELF_RADIUS_FRAC * mesh.cell;
    var jointed = {};
    for (var s = 0; s < mesh.springs.length; s++) {
      var ja = mesh.springs[s][0], jb2 = mesh.springs[s][1];
      jointed[(ja < jb2 ? ja : jb2) + '-' + (ja < jb2 ? jb2 : ja)] = 1;
    }
    var worst = Infinity;
    for (var p = 0; p < mesh.boundaryCount; p++) {
      for (var q = p + 1; q < mesh.boundaryCount; q++) {
        if (jointed[p + '-' + q]) continue;
        var dx = mesh.nodes[p * 2] - mesh.nodes[q * 2];
        var dy = mesh.nodes[p * 2 + 1] - mesh.nodes[q * 2 + 1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < worst) worst = d;
      }
    }
    h.assert('no unjointed pair of ' + label + ' starts in contact', worst >= contact,
      'closest ' + (worst / mesh.cell).toFixed(3) + 'c against contact ' +
      (contact / mesh.cell).toFixed(3) + 'c');
    return rig;
  }

  for (var si = 0; si < scene.SCENE.length; si++) {
    noPairInContact(scene.SCENE[si].name, scene.SCENE[si].ring);
  }
  var TIPS = [60, 47, 39, 33, 29];
  for (var ti = 0; ti < TIPS.length; ti++) {
    noPairInContact('teardrop' + TIPS[ti], scene.teardrop(TIPS[ti], 100, 96));
  }

  // The stiffness fixtures must brace NOTHING, which is what pins the self-contact radius at
  // 0.25 cell: the square blob's closest unjointed pair is 0.566 cell, so at a 0.3 radius the
  // contact distance would be 0.6 cell, all four corners would brace, and the measured stiffness
  // table would move.
  var sqRig = noPairInContact('square300', scene.squareRing(300, 12));
  if (sqRig) h.assertEqual('the stiffness fixture needs no brace', sqRig.braceCount, 0);

  // A brace only ever spans MATERIAL, never a gap - the invariant that makes an unbounded index
  // rule safe. The shape that would disprove it is a "C" whose mouth has nearly closed: weld that
  // shut and a C becomes an O, which is worse than the bug being fixed. Measured clean at every
  // aperture from 0.6 rad down to 0.015.
  h.group('softbody: the self-contact fixture');

  var Wsc = GR.makeWorld({ scale: 100 });
  var scFaces = [{ outer: square(0, 0, 300, 300), holes: [] }];
  var scRig = GR.addSoftBody(Wsc, scFaces, { name: 'blob', softness: 0.25, density: 1 });

  // Boundary nodes carry two fixtures, interior nodes one. Only the boundary can fold visibly, and
  // restricting it keeps the added broadphase pairs proportional to the perimeter, not the area.
  function fixtureCount(body) {
    var n = 0;
    for (var f = body.getFixtureList(); f; f = f.getNext()) n++;
    return n;
  }
  h.assertEqual('a boundary node has two fixtures', fixtureCount(scRig.nodes[0].body), 2);
  h.assertEqual('the record reports two fixtures', scRig.nodes[0].fixtures, 2);
  h.assertEqual('an interior node has one fixture',
    fixtureCount(scRig.nodes[scRig.mesh.boundaryCount].body), 1);
  h.assertEqual('an interior node reports one fixture',
    scRig.nodes[scRig.mesh.boundaryCount].fixtures, 1);

  var selfFix = null;
  for (var sf2 = scRig.nodes[0].body.getFixtureList(); sf2; sf2 = sf2.getNext()) {
    if (sf2.getShape().m_radius < GR.SOFT_RADIUS_FRAC * scRig.cell) selfFix = sf2;
  }
  h.assert('the self-contact fixture exists', !!selfFix);
  if (selfFix) {
    // Group index MUST be 0. In planck a matching non-zero group short-circuits category and mask
    // entirely, so inheriting the body's negative group would leave the feature inert while
    // looking perfectly implemented.
    h.assertEqual('the self-contact fixture is in no filter group', selfFix.getFilterGroupIndex(), 0);
    h.assertEqual('it masks only its own category',
      selfFix.getFilterMaskBits(), selfFix.getFilterCategoryBits());
    h.assertEqual('its category is the self-contact one',
      selfFix.getFilterCategoryBits(), GR.SOFT_SELF_CATEGORY);
    h.assertClose('its radius is SELF_RADIUS_FRAC of a cell',
      selfFix.getShape().m_radius, GR.SOFT_SELF_RADIUS_FRAC * scRig.cell, 1e-12);
  }

  // Mass must not move. Node density is solved backwards from a target, so a second fixture
  // carrying density would add roughly 25% per node and invalidate every measured stiffness
  // number - which is why it is created with density 0.
  var scMass = 0;
  for (var mi2 = 0; mi2 < scRig.nodes.length; mi2++) scMass += scRig.nodes[mi2].body.getMass();
  h.assertClose('the second fixture adds no mass', scMass, scRig.totalMass, scRig.totalMass * 1e-9);

  h.group('softbody: self-contact is enforced after settling');

  // The load-bearing assertion of the feature. Everything above proves the rig was BUILT right;
  // this proves the contact actually holds once the shape has fallen and piled on itself.
  //
  // Settled closest unjointed pair, in cells, against a 0.500c contact distance:
  //
  //     shape     self-contact ON   OFF (negative control)
  //     orange              0.465                    0.052
  //     amber               0.466                     -
  //     purple              0.937                     -
  //     green               0.663                     -
  //
  // Orange and amber sit about 0.035c inside the contact distance, which is 0.0047 sim units -
  // essentially exactly one linearSlop, the penetration Box2D allows on any resting contact. That
  // is why the allowance below is 2 * slop rather than zero, and why it is not generosity.
  //
  // The OFF column is the negative control, measured by masking the self-contact fixture to 0:
  // orange's arms interpenetrate to 0.052c, a ninefold loss of separation, and this assertion
  // fails loudly. An assertion that cannot fail is worse than none, and the units are how that
  // happens here - see the comment on reading positions below.
  //
  // WHAT THIS DOES NOT FIX, measured with `selfContact: false` against true, each shape settled
  // alone at scale 100, crossings from outlineFolds on the drawn outline:
  //
  //     teal 1 -> 0    amber 0 -> 2    orange 1 -> 1    every other shape 0 -> 0
  //     total 2 -> 3
  //
  // Self-collision does NOT reduce outline crossings and here it raises the count by one. That is
  // the INSET_FRAC == RADIUS_FRAC identity again: the drawn outline sits 0.6c OUTSIDE the node
  // ring, so two arms resting at the 0.5c contact distance have drawn surfaces overlapping by
  // 0.7c and the outline crosses. Without self-contact an arm passes clean through and can settle
  // separated on the far side, which sometimes scores FEWER crossings than a physically correct
  // resting contact.
  //
  // So crossing count is not a monotone measure of correctness and must not be asserted on. What
  // this feature fixes is the interpenetration itself, which is the assertion below. Removing the
  // gouging needs the area-preservation term, so arms compress less and meet less often, or a
  // repair pass on the written-back curve.
  var folders = [];
  for (var fs2 = 0; fs2 < scene.SCENE.length; fs2++) {
    if (scene.SCENE[fs2].folds) folders.push(scene.SCENE[fs2]);
  }
  for (var fi2 = 0; fi2 < folders.length; fi2++) {
    (function (shape) {
      var Wf = GR.makeWorld({ scale: 100 });
      GR.addBounds(Wf, { x: -600, y: -600, width: 1200, height: 1200 });
      var rig = GR.addSoftBody(Wf, [{ outer: shape.ring, holes: [] }],
        { name: shape.name, softness: 0.25 });
      if (rig.fallback) { h.assert(shape.name + ' meshes', false, rig.fallback); return; }

      GR.run(Wf, { seed: 1, maxFrames: 900 });

      var mesh = rig.mesh, contact = 2 * GR.SOFT_SELF_RADIUS_FRAC * mesh.cell;
      var jointed = {};
      for (var s = 0; s < mesh.springs.length; s++) {
        var ja = mesh.springs[s][0], jb3 = mesh.springs[s][1];
        jointed[(ja < jb3 ? ja : jb3) + '-' + (ja < jb3 ? jb3 : ja)] = 1;
      }
      // SIM units, read straight off the bodies. NOT GR.poseAt: that reads GR.bodyState, which
      // returns GR.toSrc(...) - POINTS. Comparing points against mesh.cell compares about 46
      // against 0.5 at scale 100, so the assertion can never fail and would pass even with the
      // self-contact fixture entirely misfiltered, which is the exact bug it exists to catch.
      var worst = Infinity;
      for (var p = 0; p < mesh.boundaryCount; p++) {
        var pp = rig.nodes[p].body.getPosition();
        for (var q = p + 1; q < mesh.boundaryCount; q++) {
          if (jointed[p + '-' + q]) continue;
          var qq = rig.nodes[q].body.getPosition();
          var dx = pp.x - qq.x, dy = pp.y - qq.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < worst) worst = d;
        }
      }
      // planck lets a resting contact settle to within linearSlop, so allow exactly that.
      var slop = Wf.planck.Settings.linearSlop;
      h.assert('settled ' + shape.name + ' keeps its arms apart', worst >= contact - 2 * slop,
        'closest settled pair ' + (worst / mesh.cell).toFixed(3) + 'c against contact ' +
        (contact / mesh.cell).toFixed(3) + 'c');
    })(folders[fi2]);
  }

  h.group('softbody: a brace never spans a gap');

  var APERTURES = [0.6, 0.3, 0.12, 0.05, 0.015];
  for (var ai = 0; ai < APERTURES.length; ai++) {
    var cRig = GR.addSoftBody(GR.makeWorld({ scale: 100 }),
      [{ outer: scene.cShape(120, 60, APERTURES[ai], 64), holes: [] }],
      { name: 'C', softness: 0.25 });
    h.assert('a C at ' + APERTURES[ai] + ' rad meshes', !cRig.fallback, cRig.fallback || '');
    if (cRig.fallback) continue;
    h.assertEqual('no brace welds the C shut at ' + APERTURES[ai] + ' rad', cRig.braceAcrossGap, 0);
  }

  h.group('softbody: area pressure');

  // A helper, because every test here needs a rig sitting at some known compression.
  //
  // `bend` displaces x by bend * (squashed y - cy)^2, which breaks the pose's central symmetry
  // without touching its area: x' = x + f(y) has determinant 1, and the ring area came back
  // -5.115302 either way. Both halves of that matter - see the net force assertion below.
  function squashed(frac, bend) {
    var Wp = GR.makeWorld({ scale: 100 });
    var rig = GR.addSoftBody(Wp, [{ outer: square(0, 0, 300, 300), holes: [] }],
      { name: 'p', softness: 0.25, density: 1 });
    // Move every node toward the rig's centroid vertically. Nothing is stepped, so this is a pose,
    // not a simulation - the pass must be a pure function of where the nodes ARE.
    var cy = 0;
    for (var i = 0; i < rig.nodes.length; i++) cy += rig.nodes[i].body.getPosition().y;
    cy /= rig.nodes.length;
    for (i = 0; i < rig.nodes.length; i++) {
      var p = rig.nodes[i].body.getPosition();
      var ny = cy + (p.y - cy) * frac;
      rig.nodes[i].body.setTransform(
        new GR.planck.Vec2(p.x + (bend || 0) * (ny - cy) * (ny - cy), ny), 0);
    }
    return rig;
  }

  // GAIN 0 IS OFF. Every measurement already in this file was taken without this term, and they
  // stay valid only if zero really means zero.
  var pOff = squashed(0.5);
  var offRes = GR.softPressurePass(pOff, 0, 10);
  h.assertEqual('gain 0 pushes no ring', offRes.ringsPushed, 0);

  // THE DEADBAND. A jelly settling under its own weight alone loses up to 1.0% of its area on the
  // crush bench's LOAD = 0 row - green is that 1.0%, purple 0.9% - and if the term fires on that no
  // jelly scene ever reaches `sleep`, the run ending on the quiescence backstop instead. 0.97 is 3%
  // compression: outside anything the bench measures unloaded, and inside the 6% deadband.
  //
  // Not the 4.0% an earlier chain of measurements reported for a resting purple. That figure is
  // what sized the band, and this bench does not reproduce it; the band is right anyway, for the
  // reason in softbody.js - it sets the asymptote a loaded jelly settles to.
  var pRest = squashed(0.97);
  h.assertEqual('a barely-squashed ring is left alone',
    GR.softPressurePass(pRest, 1, 10).ringsPushed, 0);

  // And it does fire once past the band.
  var pHard = squashed(0.5);
  h.assertEqual('a crushed ring is pushed', GR.softPressurePass(pHard, 1, 10).ringsPushed, 1);

  // ZERO NET FORCE. Sum(outward normal x edge length) = 0 around any closed loop, so pressure
  // cannot thrust an object sideways however lopsided the compression.
  //
  // BENT on purpose. A plain squash leaves the node ring centrally symmetric, and under central
  // symmetry every edge pairs with a reversed one, so ANY per-edge force linear in the edge vector
  // cancels - the wrong ones included. Measured by mutating the source: dropping the edge-length
  // factor, so each edge pushes a unit normal instead, leaves this assertion PASSING on the
  // unbent pose and fails it at net 0.803470 on the bent one. The bend is the whole reason this
  // assertion can fail at all.
  //
  // Asserted on the UNCLAMPED field: once the cap binds on some nodes and not others the applied
  // forces genuinely do have a net component, and that is deliberate - see the clamped case below.
  // 0.7 rather than 0.5 is a leftover from AREA_FORCE_CAP = 8, where 0.5 with this same bend and
  // gain put 20 nodes on the 4.260355 cap and the net came back 6.678e-2. At the cap of 64 the
  // feature now ships with, neither pose binds - 0.5 reaches 5.7765 against a cap of 34.0828 - so
  // 0.7 is no longer load-bearing and the assertion below is what keeps it honest rather than the
  // choice of pose. Kept at 0.7 because moving it would change a measurement for no reason: there
  // the worst node force is 2.2183, nothing binds, and the loop identity is what is measured.
  var pNet = squashed(0.7, 1);
  var netRes = GR.softPressurePass(pNet, 1, 10);
  h.assertEqual('a bent ring is still pushed', netRes.ringsPushed, 1);
  h.assertEqual('no node was clamped in this pose', netRes.nodesClamped, 0);
  var netMag = Math.abs(netRes.netX) + Math.abs(netRes.netY);
  h.assert('pressure has no net force', netMag < 1e-9, 'net ' + netMag);

  // A ring whose signed area has FLIPPED is folded. The ratio is meaningless and the outward
  // direction reference is exactly what the flip is evidence of having broken, so the ring is
  // skipped rather than driven at maximum force - which would push the fold deeper.
  var pFlip = squashed(-0.5);
  h.assertEqual('a flipped ring is skipped', GR.softPressurePass(pFlip, 1, 10).ringsPushed, 0);

  // A HOLE, at both windings. Every other fixture here is a solid square, so without this the
  // `sign` branch - the entire reason the signed area is called load-bearing - has no test at all.
  // A SAME-wound hole is not hypothetical: nothing on the soft path normalises winding
  // (sanitizeFace is reached only by the RIGID path via decompose), so it is what real artwork can
  // hand us, and it must behave identically to a counter-wound one.
  //
  // Direction cannot be read off the return value - it reports aggregates, not per-node vectors -
  // so it is measured as motion, against a gain-0 control run on an identical rig. The control is
  // what subtracts the springs out: they pull on these same nodes during the step and would
  // otherwise swamp the term being tested.
  function holeRadial(holeRing, gain) {
    var Wh = GR.makeWorld({ scale: 100 });
    // Gravity off in the WORLD, but still passed to the pass, so the only thing moving these nodes
    // is the term under test plus the springs the control subtracts.
    Wh.world.setGravity(new GR.planck.Vec2(0, 0));
    var rig = GR.addSoftBody(Wh, [{ outer: square(0, 0, 300, 300), holes: [holeRing] }],
      { name: 'h', softness: 0.25, density: 1 });

    // Squash uniformly toward the rig centroid. This shrinks the hole's node loop too, which is
    // what puts its ratio above the deadband.
    var cx = 0, cy = 0, i;
    for (i = 0; i < rig.nodes.length; i++) {
      var q = rig.nodes[i].body.getPosition();
      cx += q.x; cy += q.y;
    }
    cx /= rig.nodes.length; cy /= rig.nodes.length;
    for (i = 0; i < rig.nodes.length; i++) {
      var b = rig.nodes[i].body, q2 = b.getPosition();
      b.setTransform(new GR.planck.Vec2(cx + (q2.x - cx) * 0.7, cy + (q2.y - cy) * 0.7), 0);
      b.setLinearVelocity(new GR.planck.Vec2(0, 0));
    }

    // Ring 1 is the hole - ringSpans is outer first, then that face's holes.
    var span = rig.mesh.ringSpans[1];
    var hx = 0, hy = 0;
    for (i = 0; i < span.count; i++) {
      var hp = rig.nodes[span.start + i].body.getPosition();
      hx += hp.x; hy += hp.y;
    }
    hx /= span.count; hy /= span.count;

    GR.softPressurePass(rig, gain, 10);
    Wh.world.step(1 / 60, 8, 3);

    // Mean outward-from-the-hole-centre velocity. Positive means the counter is being defended.
    var radial = 0;
    for (i = 0; i < span.count; i++) {
      var rec = rig.nodes[span.start + i], rp = rec.body.getPosition(), rv = rec.body.getLinearVelocity();
      var dx = rp.x - hx, dy = rp.y - hy, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) radial += (rv.x * dx + rv.y * dy) / d;
    }
    return radial / span.count;
  }

  // Written CCW in SOURCE units, so after convertRing's y flip this is the ring whose rest area is
  // -1.11098 - the SAME sign as the outer ring's -7.30757. It is the same-wound case, and it is
  // also the one that catches a missing `sign`: drop the flip and only this fixture reverses.
  var holeCCW = square(110, 110, 80, 80);
  var holeCW = [];
  for (var hw = holeCCW.length - 2; hw >= 0; hw -= 2) holeCW.push(holeCCW[hw], holeCCW[hw + 1]);

  // Guard first. An 80pt hole in a 300pt square is not far off the cell floor, and `holeRadial`
  // reads ringSpans[1] on faith: if the hole failed to mesh, every assertion below would be
  // reporting a TypeError's cause instead of a physical one. Measured: 2 rings, 48 outer nodes and
  // 13 hole nodes. The count is a floor rather than a pin: the exact 13 is a mesher detail this
  // test has no stake in, but a future change that all but collapses the hole should surface here
  // rather than as a quietly weaker measurement below.
  var holeProbe = GR.addSoftBody(GR.makeWorld({ scale: 100 }),
    [{ outer: square(0, 0, 300, 300), holes: [holeCCW] }],
    { name: 'hp', softness: 0.25, density: 1 });
  h.assert('the hole fixture meshes', !holeProbe.fallback, holeProbe.fallback || '');
  h.assertEqual('the hole is a ring of its own', holeProbe.mesh.ringSpans.length, 2);
  h.assert('and a ring, not a stub', holeProbe.mesh.ringSpans[1].count >= 8,
    'hole nodes ' + holeProbe.mesh.ringSpans[1].count);

  var ccwPush = holeRadial(holeCCW, 1) - holeRadial(holeCCW, 0);
  var cwPush = holeRadial(holeCW, 1) - holeRadial(holeCW, 0);
  h.assert('a squashed hole is pushed away from its own centre', ccwPush > 0,
    'radial ' + ccwPush.toFixed(5));
  h.assert('and identically when the hole winds the other way', cwPush > 0,
    'radial ' + cwPush.toFixed(5));

  // Measured 0.353061 against 0.354131 - 0.303% apart, not equal, and they cannot be. Reversing the
  // hole's vertex list makes buildSoftMesh walk that ring from the other end, and the 13 hole nodes
  // come out MIRRORED about the hole's own horizontal axis (matched to 4.4e-16) rather than in the
  // same places. Everything else is untouched: the other 148 nodes are position-identical, and the
  // 589 springs have the same rest-length multiset. So the two rigs are the same rig with the hole
  // ring's nodes relabelled onto mirrored sites, the springs joining them to the lattice differ,
  // and 0.303% is the size of that. 1% is that number with room, not a fitted tolerance.
  h.assert('winding changes nothing but the sign it is read from',
    Math.abs(ccwPush - cwPush) < 0.01 * Math.abs(ccwPush),
    ccwPush.toFixed(6) + ' vs ' + cwPush.toFixed(6));

  // THE REST PERIMETER, pinned in closed form. P0 divides by the ring's REST perimeter and not by
  // its current one, and nothing above can tell those apart - the docblock argues the choice, this
  // measures it, without a golden number anywhere.
  //
  // A pose scaled UNIFORMLY by s is SIMILAR to the rest pose, and similarity is what makes this
  // exact: the area carries s^2 so ratio = 1/s^2, every edge carries one s, and every node's force
  // is P * s * L0 * k with the same k, so `worstForce` is attained at the same node whatever s is.
  //
  //     worstForce(s) = gain * (M*g / restPerimeter) * (s^-4 - T) * s * L0 * k
  //
  // Take the ratio of two scales and M, g, L0, k and the rest perimeter all cancel, leaving a
  // number the deadband alone predicts. Dividing by the CURRENT perimeter instead inserts a 1/s
  // and the prediction loses exactly its s1/s2 factor: that mutant measures 0.19989630, which is
  // 3/4 of this and 25% away, against the 2.1e-15 the real thing lands at.
  function scaledPose(s) {
    var Ws = GR.makeWorld({ scale: 100 });
    var rig = GR.addSoftBody(Ws, [{ outer: square(0, 0, 300, 300), holes: [] }],
      { name: 's', softness: 0.25, density: 1 });
    var cx = 0, cy = 0, i;
    for (i = 0; i < rig.nodes.length; i++) {
      var q = rig.nodes[i].body.getPosition();
      cx += q.x; cy += q.y;
    }
    cx /= rig.nodes.length; cy /= rig.nodes.length;
    for (i = 0; i < rig.nodes.length; i++) {
      var b = rig.nodes[i].body, q2 = b.getPosition();
      b.setTransform(new GR.planck.Vec2(cx + (q2.x - cx) * s, cy + (q2.y - cy) * s), 0);
    }
    return rig;
  }

  // Gain 0.02 because the identity is about the UNCLAMPED field: the cap is not
  // similarity-covariant, so a single clamped node would break the argument rather than the code.
  var S1 = 0.8, S2 = 0.6;
  var wide = GR.softPressurePass(scaledPose(S1), 0.02, 10);
  var tight = GR.softPressurePass(scaledPose(S2), 0.02, 10);
  h.assertEqual('both scaled poses are pushed', wide.ringsPushed + tight.ringsPushed, 2);
  h.assertEqual('and neither clamps', wide.nodesClamped + tight.nodesClamped, 0);
  var T = (1 + GR.SOFT_AREA_DEADBAND) * (1 + GR.SOFT_AREA_DEADBAND);
  var predicted = ((Math.pow(S1, -4) - T) / (Math.pow(S2, -4) - T)) * (S1 / S2);
  h.assertClose('P0 divides by the ring\'s REST perimeter',
    wide.worstForce / tight.worstForce, predicted, 1e-9);

  // The cap is per NODE on the accumulated vector. A per-edge clamp would let a node reach twice
  // it and would depend on the order edges are visited - not in theory: clamping each edge
  // contribution instead and dropping the node clamp brings this fixture back at worstForce
  // 68.165680, which is 2 x the 34.082840 cap to the digit.
  //
  // Re-measured when AREA_FORCE_CAP went 8 -> 64: this fixture still binds, and hard. All 48 of
  // pCap's boundary nodes clamp, worstForce lands exactly on the cap, and it stays that way from
  // gain 400 up to 40000 - so the 8x raise did not quietly turn 'a huge gain clamps some nodes'
  // into an assertion about nothing. The count is reported rather than pinned: 48 is a mesher
  // detail, but a fixture that stopped clamping altogether must not pass silently.
  var pCap = squashed(0.2);
  var capRes = GR.softPressurePass(pCap, 400, 10);
  h.assert('a huge gain clamps some nodes', capRes.nodesClamped > 0,
    'clamped ' + capRes.nodesClamped + ' of ' + pCap.mesh.ringSpans[0].count);
  // One density and one radius for every node in a rig, so nodes[0]'s mass is every node's mass
  // and one cap covers the lot.
  var capNode = pCap.nodes[0];
  var capLimit = GR.SOFT_AREA_FORCE_CAP * capNode.body.getMass() * 10 * (1 + 1e-9);

  // Read the APPLIED force off the bodies, not the returned tally. The tally cannot fail this:
  // `worstForce` is assigned `cap` inside the clamp branch and is below it outside, so checking it
  // against the cap re-encodes the code. Proved by mutation - delete the two scaling lines and keep
  // `mag = cap`, so the clamp is counted but never applied. Re-run at the cap of 64: these two are
  // still the ONLY assertions that go red, the applied force coming back 19179.68 against a cap of
  // 34.08, and the crush criterion below does not notice. Precedent for reaching into planck here
  // is the m_radius read further up this file.
  //
  // The tolerance is not slack: the worst applied force comes back 34.082840236686394 against a cap
  // of 34.08284023668639, one ulp over, because the clamp scales by cap/mag rather than assigning.
  var worstApplied = 0;
  for (var cn = 0; cn < pCap.nodes.length; cn++) {
    var cf = pCap.nodes[cn].body.m_force;
    worstApplied = Math.max(worstApplied, Math.sqrt(cf.x * cf.x + cf.y * cf.y));
  }
  h.assert('no applied force exceeds the cap', worstApplied <= capLimit, 'worst ' + worstApplied);
  h.assert('and the tally agrees with what landed',
    Math.abs(worstApplied - capRes.worstForce) <= 1e-9 * capLimit,
    worstApplied + ' vs ' + capRes.worstForce);

  // WAKE FALSE, on a fresh rig because applyForceToCenter accumulates and the pass above has
  // already loaded pCap's bodies. The whole deadband argument rests on this flag: a crushed shape
  // that has reached the equilibrium this term defines must be allowed to stay asleep, or no jelly
  // scene ever ends on `sleep`. Flipping it to true leaves the suite green without this.
  //
  // And planck does not bank the force for later either - it adds to m_force only when the body is
  // already awake - so the term is fully inert on a sleeper, measured as exactly (0,0).
  var sleepRig = squashed(0.2);
  var sleeper = sleepRig.nodes[0].body;
  sleeper.setAwake(false);
  GR.softPressurePass(sleepRig, 400, 10);
  h.assert('the pass does not wake a sleeping node', !sleeper.isAwake());
  h.assertClose('and planck drops its force outright',
    Math.abs(sleeper.m_force.x) + Math.abs(sleeper.m_force.y), 0, 0);

  h.group('softbody: the crush criterion');

  // What the whole feature is for, measured end to end rather than as a force field. These are the
  // three shapes that collapse worst with the term off - at LOAD 4 and gain 0 the crush bench reads
  // teal -55.0%, purple -52.2%, green -24.2% - and with it at the shipped gain they hold -5.8%,
  // -3.9% and -4.8%.
  //
  // Three shapes, not the bench's ten. These four runs already cost 0.6s of a 3.0s suite; the
  // bench's ten-shape load is about 1.3s, per load, and the sweep that pinned the constants was 30
  // of them. The other seven were never the ones in danger either - yellowgreen loses 1.2% with the
  // term switched off entirely. test/bench_crush.js keeps the sweep and asserts nothing.
  //
  // The bars are the design spec's, not the measured values, and the gap is deliberate. 0.90
  // against a measured 0.942 is room for solver noise and none for a regression: the term's
  // asymptote is -5.66%, so anything that leaves a shape past -10% has lost most of the effect.
  var CRUSH = ['teal', 'purple', 'green'];

  for (var cs = 0; cs < CRUSH.length; cs++) {
    var shape = null;
    for (var sc = 0; sc < scene.SCENE.length; sc++) {
      if (scene.SCENE[sc].name === CRUSH[cs]) shape = scene.SCENE[sc];
    }
    var held = scene.crushOne(GR, shape, 4, GR.SOFT_AREA_DEFAULT_GAIN);
    h.assert(CRUSH[cs] + ' keeps its area under a 4x load', held && held.area >= 0.90,
      held ? CRUSH[cs] + ' at ' + (100 * held.area - 100).toFixed(1) + '%' : 'did not mesh');
    // One-sided, so it cannot drive a shape past rest in steady state - but momentum can carry it
    // there, and a jelly that rings out past its own outline is a worse artefact than one that
    // stays squashed, because it is visible in motion. Measured 0.0% on all three.
    h.assert(CRUSH[cs] + ' does not ring past its rest area', held && held.peak <= 1.05,
      held ? 'peak ' + (100 * held.peak - 100).toFixed(1) + '%' : 'did not mesh');
    // `sleep`, not `quiescence`: a term that never stopped pushing would end every jelly run on
    // the backstop instead. Stated as a watchdog, not as a proof - it is worth being honest that
    // no mutation tried so far turns it red. `wake false -> true` does not (the run still ends on
    // sleep; the two pose assertions further up are what kill that one), and neither does
    // `DEADBAND 0.06 -> 0.12` or `-> 0`. It is here because the failure it names is real, cheap to
    // watch for, and would otherwise be invisible until someone ran a scene.
    h.assert(CRUSH[cs] + ' still sleeps', held && held.settledBy === 'sleep',
      held ? held.settledBy : 'did not mesh');
  }

  // The control the deadband is sized against: under its own weight alone a jelly loses about 1%,
  // and the term has to be silent on that. Silent is measurable here - the bench's entire LOAD = 0
  // table is byte-identical at gains 0, 1, 4 and 64 - and this is the cheap corner of it.
  // scene.SCENE[0] is teal, which reads -0.9% unloaded.
  var free = scene.crushOne(GR, scene.SCENE[0], 0, GR.SOFT_AREA_DEFAULT_GAIN);
  h.assert('an unloaded jelly is left alone', free && free.area >= 0.95 && free.peak <= 1.001,
    free ? 'area ' + free.area.toFixed(4) + ' peak ' + free.peak.toFixed(4) : 'did not mesh');
};
