/**
 * Tests for raster.js.
 *
 * The whole point of marching squares over physicsdrop's convex hull is that concavities and holes
 * survive, so the cases that matter are a ring (which a hull would fill in) and two disjoint blobs
 * (which a hull would bridge). Both are asserted against the real pipeline, not just the tracer.
 */

'use strict';

/** An alpha mask from a predicate, in the shape extract.js supplies from PixelReaderRGBA8. */
function mask(width, height, solid) {
  return function (px, py) { return solid(px, py) ? 255 : 0; };
}

function disc(cx, cy, r) {
  return function (x, y) {
    var dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
}

function ringMask(cx, cy, outer, inner) {
  return function (x, y) {
    var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    return d2 <= outer * outer && d2 > inner * inner;
  };
}

module.exports = function (GR, h) {

  h.group('raster: sampling step');

  h.assertEqual('a small image is sampled every pixel', GR.rasterSampleStep(100, 80), 1);
  h.assert('a large one is stepped down', GR.rasterSampleStep(4000, 3000) > 1);
  h.assert('and lands within the cell cap',
    Math.ceil(4000 / GR.rasterSampleStep(4000, 3000)) <= 200,
    'cols would be ' + Math.ceil(4000 / GR.rasterSampleStep(4000, 3000)));

  h.group('raster: basic shapes');

  var square = GR.alphaContours(60, 60, mask(60, 60, function (x, y) {
    return x >= 15 && x <= 45 && y >= 15 && y <= 45;
  }), { step: 1 });
  h.assertEqual('a square gives one ring', square.length, 1);

  var bb = GR.ringsBBox(square);
  h.assert('the ring covers the square', bb.x0 >= 12 && bb.x1 <= 48 && bb.y0 >= 12 && bb.y1 <= 48,
    JSON.stringify(bb));

  h.assertEqual('an empty mask gives nothing',
    GR.alphaContours(40, 40, mask(40, 40, function () { return false; }), { step: 1 }).length, 0);

  // A fully solid image still yields a ring, because a transparent border is asserted around the
  // grid — without it a shape running to the edge has an open boundary and encloses nothing.
  h.assertEqual('a fully solid image still gives one ring',
    GR.alphaContours(30, 30, mask(30, 30, function () { return true; }), { step: 1 }).length, 1);

  h.group('raster: holes survive');

  // The case physicsdrop cannot express: a convex hull of the opaque pixels would fill this in.
  var annulus = GR.alphaContours(120, 120, mask(120, 120, ringMask(60, 60, 50, 25)), { step: 1 });
  h.assertEqual('a ring traces two contours', annulus.length, 2);

  var faces = GR.buildFaces(annulus);
  h.assertEqual('which classify as one face', faces.length, 1);
  h.assertEqual('with one hole', faces[0].holes.length, 1);

  var parts = GR.decompose(faces[0]);
  h.assert('and decompose into parts', parts.length > 1, 'got ' + parts.length);

  // Area must be the annulus, not the disc. This is the assertion that would fail if the hole were
  // silently dropped, which is exactly the failure mode being designed out.
  var area = 0;
  for (var i = 0; i < parts.length; i++) area += Math.abs(GR.signedArea(parts[i]));
  var expected = Math.PI * (50 * 50 - 25 * 25);
  h.assert('total area matches the ring, not the disc',
    Math.abs(area - expected) / expected < 0.12,
    'got ' + area.toFixed(0) + ' expected about ' + expected.toFixed(0));

  h.group('raster: disjoint shapes');

  // A convex hull would bridge these into one blob.
  var two = GR.alphaContours(140, 60, mask(140, 60, function (x, y) {
    return disc(30, 30, 20)(x, y) || disc(110, 30, 20)(x, y);
  }), { step: 1 });
  h.assertEqual('two blobs trace two contours', two.length, 2);

  var twoFaces = GR.buildFaces(two);
  h.assertEqual('and stay two separate faces', twoFaces.length, 2);
  h.assertEqual('neither with a hole', twoFaces[0].holes.length + twoFaces[1].holes.length, 0);

  h.group('raster: thresholds and stepping');

  // Antialiasing: a soft edge must land near the half-alpha point rather than at either extreme.
  var soft = function (px, py) {
    var d = Math.sqrt((px - 50) * (px - 50) + (py - 50) * (py - 50));
    if (d < 25) return 255;
    if (d > 35) return 0;
    return Math.round(255 * (35 - d) / 10);
  };
  var softRings = GR.alphaContours(100, 100, soft, { step: 1 });
  h.assertEqual('a soft edge still traces one ring', softRings.length, 1);
  var sb = GR.ringsBBox(softRings);
  var radius = (sb.x1 - sb.x0) / 2;
  h.assert('and lands mid-gradient', radius > 26 && radius < 34, 'radius came out ' + radius.toFixed(1));

  // Stepping must not change what the shape IS, only how finely it is traced.
  var fine = GR.alphaContours(200, 200, mask(200, 200, ringMask(100, 100, 80, 40)), { step: 1 });
  var coarse = GR.alphaContours(200, 200, mask(200, 200, ringMask(100, 100, 80, 40)), { step: 4 });
  h.assertEqual('stepping keeps both contours', coarse.length, fine.length);
  h.assert('and far fewer points', coarse[0].length < fine[0].length,
    coarse[0].length / 2 + ' vs ' + fine[0].length / 2);

  h.group('raster: degenerate input');

  h.assertEqual('zero width gives nothing', GR.alphaContours(0, 10, function () { return 255; }).length, 0);
  h.assertEqual('zero height gives nothing', GR.alphaContours(10, 0, function () { return 255; }).length, 0);
  h.assertEqual('a one-pixel grid gives nothing', GR.marchingSquares(1, 1, function () { return true; }).length, 0);

  // A sampler that throws or returns rubbish must not produce NaN geometry downstream.
  var odd = GR.alphaContours(30, 30, function () { return undefined; }, { step: 1 });
  h.assertEqual('a sampler returning undefined reads as transparent', odd.length, 0);
};
