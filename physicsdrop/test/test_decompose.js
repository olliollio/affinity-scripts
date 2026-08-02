/**
 * decompose.js — earcut triangulation plus Hertel-Mehlhorn merging into convex parts.
 *
 * Every case runs the three shared invariants (area, convexity, hole exclusion) on top of its
 * own specific assertion, because a decomposition can look right by part count and still leak.
 */

'use strict';

var inv = require('./invariants');

// Deterministic PRNG so a property-test failure is reproducible from the seed alone.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function box(x0, y0, x1, y1) { return [x0, y0, x1, y0, x1, y1, x0, y1]; }

// A polygon sampled as radius-per-angle around a centre is always simple, never self-crossing,
// and goes as concave as the radius range allows — ideal random input for a decomposer.
function starPolygon(rand, n, rMin, rMax) {
  var ring = [];
  for (var i = 0; i < n; i++) {
    var a = 2 * Math.PI * i / n;
    var r = rMin + (rMax - rMin) * rand();
    ring.push(50 + r * Math.cos(a), 50 + r * Math.sin(a));
  }
  return ring;
}

module.exports = function (PD, h) {

  // decompose() sanitises (and simplifies) its input before triangulating, so the area it must
  // conserve is the area of the *sanitised* face, not of the raw contour. What sanitising itself
  // costs is a separate claim, bounded separately below and in test_sanitize.
  function run(face) {
    var clean = PD.sanitizeFace(face);
    return { clean: clean, parts: PD.decompose(clean) };
  }

  h.group('decompose: convex input');

  var square = { outer: box(0, 0, 10, 10), holes: [] };
  var squareRun = run(square); var squareParts = squareRun.parts;
  h.assertEqual('a square comes back as one part', squareParts.length, 1);
  h.assertEqual('the one part is a quad', squareParts[0].length >> 1, 4);
  inv.assertInvariants(PD, h, 'square', squareRun.clean, squareParts);

  var tri = { outer: [0, 0, 10, 0, 5, 8], holes: [] };
  var triRun = run(tri); var triParts = triRun.parts;
  h.assertEqual('a triangle stays one part', triParts.length, 1);
  inv.assertInvariants(PD, h, 'triangle', triRun.clean, triParts);

  h.group('decompose: concave input');

  // L-shape: two convex pieces is the optimal decomposition.
  var L = { outer: [0, 0, 60, 0, 60, 20, 20, 20, 20, 60, 0, 60], holes: [] };
  var lRun = run(L); var lParts = lRun.parts;
  h.assertEqual('an L splits into two parts', lParts.length, 2);
  inv.assertInvariants(PD, h, 'L', lRun.clean, lParts);

  // A comb has a reflex vertex per tooth; part count must stay proportional, not explode.
  var comb = [0, 0, 100, 0, 100, 40];
  for (var t = 0; t < 4; t++) {
    var x = 100 - t * 25;
    comb.push(x, 40, x - 5, 15, x - 20, 15, x - 20, 40);
  }
  comb.push(0, 40);
  var combFace = { outer: comb, holes: [] };
  var combRun = run(combFace); var combParts = combRun.parts;
  h.assert('a 4-tooth comb stays under 12 parts', combParts.length < 12, 'got ' + combParts.length);
  inv.assertInvariants(PD, h, 'comb', combRun.clean, combParts);

  h.group('decompose: holes');

  // "O" — the case v1.1 gets wrong by hulling it into a solid slab.
  var ring = { outer: box(0, 0, 100, 100), holes: [box(30, 30, 70, 70)] };
  var ringRun = run(ring); var ringParts = ringRun.parts;
  h.assert('a ring needs at least 4 parts', ringParts.length >= 4, 'got ' + ringParts.length);
  h.assert('the ring is not one slab', ringParts.length > 1);
  inv.assertInvariants(PD, h, 'O', ringRun.clean, ringParts);

  // "B" / "8" — two counters on one outline.
  var b = { outer: box(0, 0, 100, 100), holes: [box(20, 10, 80, 40), box(20, 60, 80, 90)] };
  var bRun = run(b); var bParts = bRun.parts;
  inv.assertInvariants(PD, h, 'B', bRun.clean, bParts);

  // An off-centre, non-rectangular counter, so the answer cannot come out right by symmetry.
  var odd = {
    outer: [0, 0, 120, 0, 120, 80, 70, 100, 0, 80],
    holes: [[20, 20, 60, 25, 55, 55, 25, 50]]
  };
  var oddRun = run(odd); var oddParts = oddRun.parts;
  inv.assertInvariants(PD, h, 'odd counter', oddRun.clean, oddParts);

  h.group('decompose: vertex cap');

  var poly = [];
  for (var i = 0; i < 24; i++) poly.push(50 + 40 * Math.cos(2 * Math.PI * i / 24), 50 + 40 * Math.sin(2 * Math.PI * i / 24));
  var disc = { outer: poly, holes: [] };
  var discRun = run(disc); var discParts = discRun.parts;
  h.assert('a 24-gon needs several parts', discParts.length >= 4, 'got ' + discParts.length);
  inv.assertInvariants(PD, h, '24-gon', discRun.clean, discParts);

  var capped = PD.decompose(disc, { maxVerts: 4 });
  var worst = 0;
  for (var c = 0; c < capped.length; c++) worst = Math.max(worst, capped[c].length >> 1);
  h.assert('a tighter cap is honoured', worst <= 4, 'largest part had ' + worst + ' vertices');
  inv.assertInvariants(PD, h, '24-gon capped', PD.sanitizeFace(disc, { maxVerts: 4 }), capped, { maxVerts: 4 });

  h.group('decompose: degenerate input');

  h.assertEqual('a collapsed outer yields no parts', PD.decompose({ outer: [0, 0, 5, 0, 10, 0], holes: [] }).length, 0);
  h.assertEqual('an empty face yields no parts', PD.decompose({ outer: [], holes: [] }).length, 0);
  h.assertEqual('a missing face yields no parts', PD.decompose(null).length, 0);

  h.group('invariants: negative control');

  // The invariants are only worth their runtime if they actually fire. Feed them the v1.1 failure
  // mode — the outer ring taken whole, hole ignored — and all three must object.
  var slab = [ringRun.clean.outer.slice()];
  h.assert('area conservation rejects an ignored hole',
    Math.abs(inv.partsArea(PD, slab) - inv.faceArea(PD, ringRun.clean)) > 1e-3 * inv.faceArea(PD, ringRun.clean));
  var leak = inv.checkHoleExclusion(PD, ringRun.clean, slab);
  h.assert('hole exclusion rejects an ignored hole', leak.ok === false, 'checker said ok');
  h.assert('hole exclusion actually sampled points', leak.samples > 0, 'sampled ' + leak.samples);

  var goodSamples = inv.checkHoleExclusion(PD, ringRun.clean, ringParts);
  h.assert('hole exclusion samples the real decomposition too', goodSamples.samples >= 4,
    'sampled ' + goodSamples.samples);

  // Convexity must reject a reflex part, an over-long part and a negatively wound one.
  h.assert('convexity rejects a reflex part',
    inv.checkConvexPart(PD, [0, 0, 60, 0, 60, 20, 20, 20, 20, 60, 0, 60], 8).ok === false);
  h.assert('convexity rejects a part over the cap',
    inv.checkConvexPart(PD, poly, 8).ok === false);
  h.assert('convexity rejects negative winding',
    inv.checkConvexPart(PD, [0, 0, 0, 10, 10, 10, 10, 0], 8).ok === false);
  h.assert('convexity accepts a clean quad',
    inv.checkConvexPart(PD, box(0, 0, 10, 10), 8).ok === true);

  h.group('decompose: property test');

  var rand = mulberry32(20260802);
  var failures = 0;
  var maxParts = 0;
  var worstSimplifyCost = 0;
  for (var k = 0; k < 60; k++) {
    var n = 5 + Math.floor(rand() * 20);
    var face = { outer: PD.enforceWinding(starPolygon(rand, n, 12, 45), true), holes: [] };
    var r = run(face);
    maxParts = Math.max(maxParts, r.parts.length);

    var want = inv.faceArea(PD, r.clean);
    var got = inv.partsArea(PD, r.parts);
    if (Math.abs(got - want) > 1e-3 * want) { failures++; continue; }
    for (var p = 0; p < r.parts.length; p++) {
      if (!inv.checkConvexPart(PD, r.parts[p], 8).ok) { failures++; break; }
    }

    // Separately: what sanitising cost. Simplification is allowed to move area, but only a little.
    var raw = inv.faceArea(PD, face);
    worstSimplifyCost = Math.max(worstSimplifyCost, Math.abs(want - raw) / raw);
  }
  h.assertEqual('60 random star polygons all decompose cleanly', failures, 0);
  h.assert('random polygons stay under 20 parts', maxParts < 20, 'worst was ' + maxParts);
  h.assert('sanitising costs under 1% of area on random input', worstSimplifyCost < 0.01,
    'worst was ' + (worstSimplifyCost * 100).toFixed(3) + '%');
};
