/**
 * contours.js — ring orientation, containment, and nesting -> faces.
 *
 * Rings are flat coordinate arrays: [x0, y0, x1, y1, ...], implicitly closed.
 */

'use strict';

// Coordinates are treated as a plain maths plane: positive signed area == counter-clockwise.
// Whether y points up on screen is the caller's business, not this layer's.
var SQUARE_CCW = [0, 0, 10, 0, 10, 10, 0, 10];
var SQUARE_CW = [0, 0, 0, 10, 10, 10, 10, 0];

module.exports = function (GR, h) {

  h.group('contours.signedArea');

  h.assertClose('CCW square is +area', GR.signedArea(SQUARE_CCW), 100);
  h.assertClose('CW square is -area', GR.signedArea(SQUARE_CW), -100);
  h.assertClose('triangle is half the box', GR.signedArea([0, 0, 4, 0, 0, 3]), 6);
  h.assertClose('degenerate line has no area', GR.signedArea([0, 0, 5, 0, 10, 0]), 0);
  h.assertClose('fewer than 3 points has no area', GR.signedArea([0, 0, 5, 5]), 0);
  h.assertClose('translation does not change area',
    GR.signedArea([100, 50, 110, 50, 110, 60, 100, 60]), 100);

  h.group('contours.pointInRing');

  // A "C": open on the +x side, so (8,5) sits in the notch — outside, but inside the bbox.
  var C_SHAPE = [0, 0, 10, 0, 10, 3, 4, 3, 4, 7, 10, 7, 10, 10, 0, 10];

  h.assert('centre of a square is inside', GR.pointInRing(SQUARE_CCW, 5, 5) === true);
  h.assert('outside the bbox is outside', GR.pointInRing(SQUARE_CCW, 20, 5) === false);
  h.assert('inside the bbox but past an edge is outside', GR.pointInRing(SQUARE_CCW, -1, 5) === false);
  h.assert('winding does not affect containment', GR.pointInRing(SQUARE_CW, 5, 5) === true);
  h.assert('concave notch is outside', GR.pointInRing(C_SHAPE, 8, 5) === false);
  h.assert('concave arm is inside', GR.pointInRing(C_SHAPE, 8, 1.5) === true);
  h.assert('spine of the C is inside', GR.pointInRing(C_SHAPE, 2, 5) === true);
  h.assert('a ray grazing a vertex still resolves',
    GR.pointInRing([0, 0, 10, 0, 5, 10], 5, 5) === true);

  h.group('contours.buildFaces');

  function box(x0, y0, x1, y1) { return [x0, y0, x1, y0, x1, y1, x0, y1]; }
  function reversed(ring) {
    var out = [];
    for (var i = (ring.length >> 1) - 1; i >= 0; i--) out.push(ring[i * 2], ring[i * 2 + 1]);
    return out;
  }
  function faceBox(face) { return GR.signedArea(face.outer); }

  var one = GR.buildFaces([box(0, 0, 100, 100)]);
  h.assertEqual('a lone ring is one face', one.length, 1);
  h.assertEqual('a lone ring has no holes', one[0].holes.length, 0);

  // "O" — outer ring plus its counter.
  var ring = GR.buildFaces([box(0, 0, 100, 100), box(20, 20, 80, 80)]);
  h.assertEqual('outer + counter is one face', ring.length, 1);
  h.assertEqual('the counter becomes a hole', ring[0].holes.length, 1);
  h.assertClose('the bigger ring is the outer', Math.abs(faceBox(ring[0])), 10000);

  // Hole order in the input must not matter.
  var ringSwapped = GR.buildFaces([box(20, 20, 80, 80), box(0, 0, 100, 100)]);
  h.assertEqual('hole listed first still yields one face', ringSwapped.length, 1);
  h.assertEqual('hole listed first still yields one hole', ringSwapped[0].holes.length, 1);

  // "B" / "8" — one outer, two counters.
  var b = GR.buildFaces([box(0, 0, 100, 100), box(20, 10, 80, 40), box(20, 60, 80, 90)]);
  h.assertEqual('two counters stay on one face', b.length, 1);
  h.assertEqual('both counters become holes', b[0].holes.length, 2);

  // "i" — two disjoint outlines.
  var i2 = GR.buildFaces([box(0, 0, 10, 60), box(0, 70, 10, 80)]);
  h.assertEqual('disjoint rings are separate faces', i2.length, 2);
  h.assertEqual('neither disjoint face has holes', i2[0].holes.length + i2[1].holes.length, 0);

  // Depth 2 — an island inside a counter is solid again.
  var island = GR.buildFaces([box(0, 0, 100, 100), box(20, 20, 80, 80), box(40, 40, 60, 60)]);
  h.assertEqual('an island in a counter is its own face', island.length, 2);
  h.assertEqual('the outer keeps exactly its counter', island[0].holes.length, 1);
  h.assertEqual('the island has no holes', island[1].holes.length, 0);
  h.assertClose('the island face is the small ring', Math.abs(faceBox(island[1])), 400);

  // Depth 3 — the island has a counter of its own; it must not attach to the outermost ring.
  var deep = GR.buildFaces([
    box(0, 0, 100, 100), box(10, 10, 90, 90), box(20, 20, 80, 80), box(30, 30, 70, 70)
  ]);
  h.assertEqual('4-deep nesting is two faces', deep.length, 2);
  h.assertEqual('outermost face holds one hole', deep[0].holes.length, 1);
  h.assertClose('outermost hole is the depth-1 ring', Math.abs(GR.signedArea(deep[0].holes[0])), 6400);
  h.assertEqual('the island holds its own hole', deep[1].holes.length, 1);
  h.assertClose('island hole is the depth-3 ring', Math.abs(GR.signedArea(deep[1].holes[0])), 1600);

  // Input winding is whatever the source produced; classification must not depend on it.
  var mixed = GR.buildFaces([reversed(box(0, 0, 100, 100)), box(20, 20, 80, 80)]);
  h.assertEqual('reversed outer still yields one face', mixed.length, 1);
  h.assertEqual('reversed outer still yields one hole', mixed[0].holes.length, 1);

  h.assertEqual('no rings, no faces', GR.buildFaces([]).length, 0);
  h.assertEqual('rings under 3 points are ignored', GR.buildFaces([[0, 0, 5, 5]]).length, 0);
};
