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

module.exports = function (GR, h) {

  h.group('flatten: straight segments');

  // A straight edge must survive as exactly two endpoints. Subdividing it would multiply every
  // rectangle's vertex count for nothing, and every glyph is mostly straight edges.
  var sq = GR.flattenSegments([
    line(0, 0, 100, 0), line(100, 0, 100, 100), line(100, 100, 0, 100), line(0, 100, 0, 0)
  ]);
  h.assertEqual('a square flattens to 4 points', sq.length / 2, 4);
  h.assertClose('and keeps its first corner', sq[0], 0, 1e-12);
  h.assertClose('and its second corner', sq[2], 100, 1e-12);

  h.assert('the closing point is not duplicated',
    !(Math.abs(sq[sq.length - 2] - sq[0]) < 1e-12 && Math.abs(sq[sq.length - 1] - sq[1]) < 1e-12) ||
    sq.length / 2 === 4);

  var single = GR.flattenSegments([line(0, 0, 10, 0)]);
  h.assertEqual('one open line gives 2 points', single.length / 2, 2);

  h.assertEqual('no segments gives an empty ring', GR.flattenSegments([]).length, 0);
  h.assertEqual('null gives an empty ring', GR.flattenSegments(null).length, 0);

  h.group('flatten: curves');

  var circle = GR.flattenSegments(circleSegments(0, 0, 100));
  h.assert('a circle needs many points', circle.length / 2 > 20, 'got ' + circle.length / 2);

  // Every emitted point must lie on the circle to within the flattening tolerance. This is the
  // real contract: the tolerance is a DISTANCE, not a point count.
  var worst = 0;
  for (var i = 0; i < circle.length; i += 2) {
    var d = Math.abs(Math.sqrt(circle[i] * circle[i] + circle[i + 1] * circle[i + 1]) - 100);
    if (d > worst) worst = d;
  }
  h.assert('every point is within tolerance of the true circle', worst <= GR.FLATTEN_TOL,
    'worst deviation ' + worst.toFixed(6) + ' vs tolerance ' + GR.FLATTEN_TOL);

  // Tolerance must actually control the result, or it is decoration.
  var coarse = GR.flattenSegments(circleSegments(0, 0, 100), { flattenTol: 5 });
  var fine = GR.flattenSegments(circleSegments(0, 0, 100), { flattenTol: 0.01 });
  h.assert('a coarser tolerance yields fewer points', coarse.length < circle.length,
    coarse.length / 2 + ' vs ' + circle.length / 2);
  h.assert('a finer tolerance yields more', fine.length > circle.length,
    fine.length / 2 + ' vs ' + circle.length / 2);

  // Scale independence: the same shape at 10x needs about the same point count for a 10x
  // tolerance. Without this, large artwork would explode the fixture budget.
  var big = GR.flattenSegments(circleSegments(0, 0, 1000), { flattenTol: 1 });
  h.assert('flattening is scale-relative when the tolerance scales too',
    Math.abs(big.length - circle.length) / circle.length < 0.2,
    big.length / 2 + ' vs ' + circle.length / 2);

  h.group('flatten: degenerate input');

  // A cubic whose points are all identical must not recurse to the depth guard and must not hang.
  var degenerate = GR.flattenSegments([seg(5, 5, 5, 5, 5, 5, 5, 5)]);
  h.assert('an all-identical cubic terminates', degenerate.length >= 2,
    'got ' + degenerate.length / 2 + ' points');

  // A cusp - handles crossing over - is real in font outlines and must still terminate.
  var cusp = GR.flattenSegments([seg(0, 0, 100, 0, -100, 0, 0, 0)]);
  h.assert('a cusp terminates', cusp.length >= 2, 'got ' + cusp.length / 2);
  h.assert('a cusp stays finite', cusp.every(function (v) { return isFinite(v); }));

  h.group('flatten: transform');

  var ring = [0, 0, 10, 0, 10, 10, 0, 10];
  GR.transformRing(ring, [1, 0, 5, 0, 1, 7]);
  h.assertClose('translation moves x', ring[0], 5, 1e-12);
  h.assertClose('translation moves y', ring[1], 7, 1e-12);
  h.assertClose('translation is uniform', ring[2], 15, 1e-12);

  var scaled = [10, 20];
  GR.transformRing(scaled, [2, 0, 0, 0, 3, 0]);
  h.assertClose('non-uniform scale on x', scaled[0], 20, 1e-12);
  h.assertClose('non-uniform scale on y', scaled[1], 60, 1e-12);

  // Row-major [a, b, tx, c, d, ty]: b and c are the cross terms. Asymmetric values so a
  // transposed matrix could not pass.
  var sheared = [1, 0];
  GR.transformRing(sheared, [1, 2, 0, 3, 1, 0]);
  h.assertClose('b is the x<-y cross term', sheared[0], 1, 1e-12);
  h.assertClose('c is the y<-x cross term', sheared[1], 3, 1e-12);

  h.assert('a null transform is a no-op', GR.transformRing([1, 2], null)[0] === 1);

  h.group('flatten: inverting a transform');

  // Extraction only ever maps base -> spread, because a rigid body moves with createTransform and
  // never needs the return trip. A rope does: it is redrawn with createSetCurves, which writes into
  // the node's BASE space, so spread-space poses have to come back. Getting this wrong displaces a
  // rope by exactly its node's own transform — invisible on an untransformed node, wrong on every
  // other, which is exactly how it reached a screenshot rather than a test.
  function roundTrip(m, pts) {
    var fwd = GR.transformRing(pts.slice(), m);
    return GR.transformRing(fwd, GR.invertMatrix(m));
  }

  var probe = [10, 20, -300, 45.5, 0, 0];

  [
    ['translation', [1, 0, 250, 0, 1, -80]],
    ['scale', [2, 0, 0, 0, 3, 0]],
    ['rotation', [Math.cos(0.7), -Math.sin(0.7), 0, Math.sin(0.7), Math.cos(0.7), 0]],
    ['shear plus translation', [1, 2, 17, 3, 1, -42]],
    ['flip', [-1, 0, 100, 0, 1, 0]]
  ].forEach(function (pair) {
    var back = roundTrip(pair[1], probe);
    var worst = 0;
    for (var i = 0; i < probe.length; i++) worst = Math.max(worst, Math.abs(back[i] - probe[i]));
    h.assert('a ' + pair[0] + ' round-trips', worst < 1e-9, 'worst drift ' + worst);
  });

  // The identity case is the one that hid the bug: a node that has never been moved round-trips
  // whether or not the inverse is applied, so a single untransformed rope looked perfectly correct.
  var idBack = roundTrip([1, 0, 0, 0, 1, 0], probe);
  h.assertClose('identity is unchanged either way', idBack[0], probe[0], 1e-12);

  h.assertEqual('a null matrix has no inverse', GR.invertMatrix(null), null);
  // Singular means an axis has been scaled to nothing. There is no inverse to invent, and callers
  // fall back to writing points unchanged rather than emitting NaN geometry.
  h.assertEqual('a singular matrix has no inverse', GR.invertMatrix([0, 0, 5, 0, 0, 5]), null);
  h.assertEqual('and a collapsed axis is singular too', GR.invertMatrix([2, 1, 0, 4, 2, 0]), null);

  h.group('flatten: a box under a transform');

  // `spreadBaseBox` is not a tight box around the artwork. It is the four corners of `baseBox`
  // pushed through the matrix and re-boxed, so it grows under rotation while the shape does not.
  // Comparing it against a tight geometry box made every rotated object in an 85-node scene report
  // SUSPECT while the extraction was exactly right — a diagnostic crying wolf is worse than none,
  // because it teaches you to ignore the one run where it means something.
  //
  // The six matrices below are read from that run's log, alongside the sizes Affinity reported for
  // the same nodes. Base box is 23.88pt square in every case; the scale is uniform at ~2.513.
  var BASE_BOX = { x: 309.52, y: 213.41, width: 23.88, height: 23.88 };

  [
    ['unrotated',      [2.513, -0.000, 191.94, 0.000, 2.513, 31.23],      60.00],
    ['rotated 2.7deg', [-2.510, 0.118, 1569.28, -0.118, -2.510, 1187.95], 62.76],
    ['rotated 22deg',  [2.332, -0.937, 1091.63, 0.937, 2.332, -380.08],   78.05],
    ['rotated 104deg', [-0.620, 2.435, 1409.67, -2.435, -0.620, 1501.74], 72.96],
    ['rotated 56deg',  [1.386, -2.096, 1288.53, 2.096, 1.386, -261.76],   83.14],
    ['near 45deg',     [-1.484, -2.028, 2552.16, 2.028, -1.484, -56.16],  83.85]
  ].forEach(function (row) {
    var b = GR.boxUnderMatrix(BASE_BOX, row[1]);
    // 0.2pt: the matrices are quoted to three decimals, and that rounding alone moves a corner by
    // about 0.15pt at these coordinates. Anything tighter would be testing the log's formatting.
    h.assert('a ' + row[0] + ' node boxes to ' + row[2] + 'pt',
      Math.abs((b.x1 - b.x0) - row[2]) < 0.2 && Math.abs((b.y1 - b.y0) - row[2]) < 0.2,
      'got ' + (b.x1 - b.x0).toFixed(2) + 'x' + (b.y1 - b.y0).toFixed(2));
  });

  // The property behind those numbers, stated directly: a square rotated by t boxes to
  // side * (|cos t| + |sin t|), peaking at sqrt(2) — 41% — at 45 degrees.
  var unit = { x: 0, y: 0, width: 1, height: 1 };
  var t45 = Math.PI / 4;
  var r45 = GR.boxUnderMatrix(unit, [Math.cos(t45), -Math.sin(t45), 0, Math.sin(t45), Math.cos(t45), 0]);
  h.assertClose('45 degrees is the worst case, at sqrt(2)', r45.x1 - r45.x0, Math.SQRT2, 1e-12);

  var r90 = GR.boxUnderMatrix(unit, [0, -1, 0, 1, 0, 0]);
  h.assertClose('90 degrees is back to unchanged', r90.x1 - r90.x0, 1, 1e-12);

  // Rotation is the whole point, so the degenerate paths are worth pinning too.
  var idBox = GR.boxUnderMatrix(BASE_BOX, null);
  h.assertClose('a null matrix leaves the box alone', idBox.x1 - idBox.x0, BASE_BOX.width, 1e-12);
  h.assertEqual('a missing box has no answer', GR.boxUnderMatrix(null, [1, 0, 0, 0, 1, 0]), null);
  h.assertEqual('nor does a box with a NaN edge',
    GR.boxUnderMatrix({ x: 0, y: 0, width: NaN, height: 1 }, null), null);

  h.group('flatten: end to end');

  // The whole point: a flattened circle with a flattened hole must decompose into planck parts.
  var outer = GR.flattenSegments(circleSegments(0, 0, 250));
  var inner = GR.flattenSegments(circleSegments(0, 0, 150));
  var faces = GR.buildFaces([outer, inner]);
  h.assertEqual('two concentric rings make one face', faces.length, 1);
  h.assertEqual('with one hole', faces[0].holes.length, 1);

  var parts = GR.decompose(faces[0]);
  h.assert('a flattened O decomposes', parts.length > 1, 'got ' + parts.length);
};
