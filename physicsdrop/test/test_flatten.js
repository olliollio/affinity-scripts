/**
 * Tests for flatten.js.
 *
 * The interesting cases are the ones Affinity actually produces: straight edges stored as cubics
 * with collapsed handles, and circles built from the standard 4-arc kappa approximation. Both are
 * the common case rather than the exotic one.
 */

'use strict';

// Affinity stores a straight edge as a cubic whose handles sit on the anchors.
function line(x0, y0, x1, y1) {
  return { start: { x: x0, y: y0 }, c1: { x: x0, y: y0 }, c2: { x: x1, y: y1 }, end: { x: x1, y: y1 } };
}

function seg(x0, y0, c1x, c1y, c2x, c2y, x1, y1) {
  return {
    start: { x: x0, y: y0 }, c1: { x: c1x, y: c1y },
    c2: { x: c2x, y: c2y }, end: { x: x1, y: y1 }
  };
}

// A circle as four cubic arcs, which is how every drawing program stores one.
var K = 0.5522847498307936;
function circleSegments(cx, cy, r) {
  var k = K * r;
  return [
    seg(cx + r, cy, cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    seg(cx, cy + r, cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    seg(cx - r, cy, cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    seg(cx, cy - r, cx + k, cy - r, cx + r, cy - k, cx + r, cy)
  ];
}

module.exports = function (PD, h) {

  h.group('flatten: straight segments');

  // A straight edge must survive as exactly two endpoints. Subdividing it would multiply every
  // rectangle's vertex count for nothing, and every glyph is mostly straight edges.
  var sq = PD.flattenSegments([
    line(0, 0, 100, 0), line(100, 0, 100, 100), line(100, 100, 0, 100), line(0, 100, 0, 0)
  ]);
  h.assertEqual('a square flattens to 4 points', sq.length / 2, 4);
  h.assertClose('and keeps its first corner', sq[0], 0, 1e-12);
  h.assertClose('and its second corner', sq[2], 100, 1e-12);

  h.assert('the closing point is not duplicated',
    !(Math.abs(sq[sq.length - 2] - sq[0]) < 1e-12 && Math.abs(sq[sq.length - 1] - sq[1]) < 1e-12) ||
    sq.length / 2 === 4);

  var single = PD.flattenSegments([line(0, 0, 10, 0)]);
  h.assertEqual('one open line gives 2 points', single.length / 2, 2);

  h.assertEqual('no segments gives an empty ring', PD.flattenSegments([]).length, 0);
  h.assertEqual('null gives an empty ring', PD.flattenSegments(null).length, 0);

  h.group('flatten: curves');

  var circle = PD.flattenSegments(circleSegments(0, 0, 100));
  h.assert('a circle needs many points', circle.length / 2 > 20, 'got ' + circle.length / 2);

  // Every emitted point must lie on the circle to within the flattening tolerance. This is the
  // real contract: the tolerance is a DISTANCE, not a point count.
  var worst = 0;
  for (var i = 0; i < circle.length; i += 2) {
    var d = Math.abs(Math.sqrt(circle[i] * circle[i] + circle[i + 1] * circle[i + 1]) - 100);
    if (d > worst) worst = d;
  }
  h.assert('every point is within tolerance of the true circle', worst <= PD.FLATTEN_TOL,
    'worst deviation ' + worst.toFixed(6) + ' vs tolerance ' + PD.FLATTEN_TOL);

  // Tolerance must actually control the result, or it is decoration.
  var coarse = PD.flattenSegments(circleSegments(0, 0, 100), { flattenTol: 5 });
  var fine = PD.flattenSegments(circleSegments(0, 0, 100), { flattenTol: 0.01 });
  h.assert('a coarser tolerance yields fewer points', coarse.length < circle.length,
    coarse.length / 2 + ' vs ' + circle.length / 2);
  h.assert('a finer tolerance yields more', fine.length > circle.length,
    fine.length / 2 + ' vs ' + circle.length / 2);

  // Scale independence: the same shape at 10x needs about the same point count for a 10x
  // tolerance. Without this, large artwork would explode the fixture budget.
  var big = PD.flattenSegments(circleSegments(0, 0, 1000), { flattenTol: 1 });
  h.assert('flattening is scale-relative when the tolerance scales too',
    Math.abs(big.length - circle.length) / circle.length < 0.2,
    big.length / 2 + ' vs ' + circle.length / 2);

  h.group('flatten: degenerate input');

  // A cubic whose points are all identical must not recurse to the depth guard and must not hang.
  var degenerate = PD.flattenSegments([seg(5, 5, 5, 5, 5, 5, 5, 5)]);
  h.assert('an all-identical cubic terminates', degenerate.length >= 2,
    'got ' + degenerate.length / 2 + ' points');

  // A cusp - handles crossing over - is real in font outlines and must still terminate.
  var cusp = PD.flattenSegments([seg(0, 0, 100, 0, -100, 0, 0, 0)]);
  h.assert('a cusp terminates', cusp.length >= 2, 'got ' + cusp.length / 2);
  h.assert('a cusp stays finite', cusp.every(function (v) { return isFinite(v); }));

  h.group('flatten: transform');

  var ring = [0, 0, 10, 0, 10, 10, 0, 10];
  PD.transformRing(ring, [1, 0, 5, 0, 1, 7]);
  h.assertClose('translation moves x', ring[0], 5, 1e-12);
  h.assertClose('translation moves y', ring[1], 7, 1e-12);
  h.assertClose('translation is uniform', ring[2], 15, 1e-12);

  var scaled = [10, 20];
  PD.transformRing(scaled, [2, 0, 0, 0, 3, 0]);
  h.assertClose('non-uniform scale on x', scaled[0], 20, 1e-12);
  h.assertClose('non-uniform scale on y', scaled[1], 60, 1e-12);

  // Row-major [a, b, tx, c, d, ty]: b and c are the cross terms. Asymmetric values so a
  // transposed matrix could not pass.
  var sheared = [1, 0];
  PD.transformRing(sheared, [1, 2, 0, 3, 1, 0]);
  h.assertClose('b is the x<-y cross term', sheared[0], 1, 1e-12);
  h.assertClose('c is the y<-x cross term', sheared[1], 3, 1e-12);

  h.assert('a null transform is a no-op', PD.transformRing([1, 2], null)[0] === 1);

  h.group('flatten: end to end');

  // The whole point: a flattened circle with a flattened hole must decompose into planck parts.
  var outer = PD.flattenSegments(circleSegments(0, 0, 250));
  var inner = PD.flattenSegments(circleSegments(0, 0, 150));
  var faces = PD.buildFaces([outer, inner]);
  h.assertEqual('two concentric rings make one face', faces.length, 1);
  h.assertEqual('with one hole', faces[0].holes.length, 1);

  var parts = PD.decompose(faces[0]);
  h.assert('a flattened O decomposes', parts.length > 1, 'got ' + parts.length);
};
