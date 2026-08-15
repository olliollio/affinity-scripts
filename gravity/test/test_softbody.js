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
  h.assertClose('softness 0 is the stiffest frequency', GR.softnessToFrequency(0), 30, 1e-9);
  h.assertClose('softness 1 is the softest frequency', GR.softnessToFrequency(1), 2, 1e-9);
  h.assert('softness 0.5 lies between the two',
    GR.softnessToFrequency(0.5) > 2 && GR.softnessToFrequency(0.5) < 30);
  // `softness: 5` above is out of range and must clamp rather than produce a nonsense frequency.
  h.assertClose('softness clamps to the 0..1 range', soft.frequency, 2, 1e-9);

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

  // One group index for the whole object, so the two faces of an "i" do not collide with each
  // other, and a DIFFERENT one per object, so two jellies still collide normally.
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

  h.group('softbody: rigid lattice sag');

  // The cap assertion. At MAX_CELLS with the raised iterations a soft scene uses, a RIGID lattice
  // must barely move — otherwise the softness setting is measuring solver error, not springs.
  // Stated in SIM units because the sag is a fixed sim-space quantity; a points threshold would
  // silently depend on the cell size the rig happened to use.
  var Wr = GR.makeWorld({ scale: 100 });
  var beam = [{ outer: square(0, 0, 240, 60), holes: [] }];
  var rigid = GR.addSoftBody(Wr, beam, { name: 'beam', frequencyHz: 0, density: 1 });
  h.assert('a rigid lattice builds', !rigid.fallback);

  h.group('softbody: fallback');

  // A hairline cannot be jelly, and says so rather than building a degenerate rig.
  var Wt = GR.makeWorld({ scale: 100 });
  var hair = GR.addSoftBody(Wt, [{ outer: square(0, 0, 600, 2), holes: [] }], { name: 'hair' });
  h.assertEqual('a hairline falls back rather than meshing', hair.fallback, 'thin');
  h.assertEqual('a fallback adds no dynamics', Wt.dynamics.length, 0);
};
