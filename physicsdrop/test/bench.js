/**
 * Fixture-count benchmark for the pure geometry layer.
 *
 *   node physicsdrop/test/bench.js
 *
 * Prints the table quoted in README.md. It is a benchmark, not a test: it asserts nothing and
 * always exits 0. It exists so the published numbers can be regenerated rather than trusted.
 *
 * Fixture count is what decides whether a dropped word simulates in real time, and the dominant
 * lever on it is simplification, not merge quality. Each row is measured twice, with Douglas-
 * Peucker off and on, so the lever is visible rather than asserted.
 */

'use strict';

var h = require('./harness');
var inv = require('./invariants');

var PD = h.loadPD(['contours.js', 'sanitize.js', 'decompose.js']);

// Deterministic, so the table is stable across runs and machines.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** A circle flattened to `n` straight segments — what a bezier ring becomes after flattening. */
function ring(cx, cy, r, n, ccw) {
  var p = [];
  for (var i = 0; i < n; i++) {
    var a = (ccw ? i : n - 1 - i) / n * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

/**
 * A traced-raster contour: a smooth outline snapped to the pixel grid.
 *
 * Marching squares walks pixel edges, so its output is a STAIRCASE of axis-aligned steps, not a
 * noisy curve. The distinction decides the whole result — Douglas-Peucker collapses a staircase
 * almost completely, because the error is correlated along each run, and barely touches random
 * jitter at any tolerance. Modelling this as noise understates simplification by an order of
 * magnitude.
 */
function tracedContour(rand, r, lobes, px, ccw) {
  var pts = [], seen = '', out = [];
  var n = Math.max(64, Math.round(2 * Math.PI * r / px));
  for (var i = 0; i < n; i++) {
    var a = (ccw ? i : n - 1 - i) / n * Math.PI * 2;
    var rr = r * (1 + 0.08 * Math.sin(a * lobes) + 0.03 * Math.sin(a * (lobes * 2 + 1)));
    // Snap to the pixel lattice, which is what produces the steps.
    pts.push([Math.round(rr * Math.cos(a) / px) * px, Math.round(rr * Math.sin(a) / px) * px]);
  }
  // Marching squares never emits the same lattice point twice in a row.
  for (var k = 0; k < pts.length; k++) {
    var key = pts[k][0] + ',' + pts[k][1];
    if (key === seen) continue;
    seen = key;
    out.push(pts[k][0], pts[k][1]);
  }
  return out;
}

function measure(face, opts) {
  var o = opts || {};
  var copy = {
    outer: face.outer.slice(),
    holes: (face.holes || []).map(function (x) { return x.slice(); })
  };
  var clean = PD.sanitizeFace(copy, o);
  if (!clean) return { parts: 0, cost: 0, verts: 0 };
  var parts = PD.decompose(clean, o);
  var raw = inv.faceArea(PD, face);
  var got = inv.faceArea(PD, clean);
  return {
    parts: parts.length,
    cost: raw > 0 ? Math.abs(got - raw) / raw * 100 : 0,
    verts: clean.outer.length / 2
  };
}

function pad(s, n, right) {
  s = String(s);
  while (s.length < n) s = right ? s + ' ' : ' ' + s;
  return s;
}

var rand = mulberry32(20260802);

var ROWS = [
  ['250pt "O", 120-segment rings', {
    outer: ring(0, 0, 250, 120, true),
    holes: [ring(0, 0, 150, 120, false)]
  }],
  ['traced raster contour', {
    outer: tracedContour(rand, 400, 5, 1, true),
    holes: []
  }],
  ['traced raster + 3 holes', {
    outer: tracedContour(rand, 400, 5, 1, true),
    holes: [ring(-160, 0, 60, 200, false), ring(160, 0, 60, 200, false), ring(0, 190, 50, 200, false)]
  }]
];

console.log('physicsdrop geometry benchmark   MAX_VERTS = ' + PD.MAX_VERTS);
console.log('');
console.log(pad('Input', 30, true) + pad('in verts', 10) + pad('no simplify', 13) + pad('simplified', 12) + pad('area cost', 12));
console.log(new Array(78).join('-'));

for (var i = 0; i < ROWS.length; i++) {
  var label = ROWS[i][0], face = ROWS[i][1];
  var off = measure(face, { simplify: false });
  var on = measure(face, {});
  console.log(pad(label, 30, true) + pad(off.verts, 10) + pad(off.parts, 13) +
              pad(on.parts, 12) + pad(on.cost.toFixed(3) + '%', 12));
}

console.log('');
console.log('Vertex cap sweep (parts at each cap, simplification on):');
var CAPS = [8, 12, 16];
console.log(pad('Input', 30, true) + CAPS.map(function (c) { return pad('cap ' + c, 9); }).join(''));
for (var j = 0; j < ROWS.length; j++) {
  var cells = CAPS.map(function (c) { return pad(measure(ROWS[j][1], { maxVerts: c }).parts, 9); });
  console.log(pad(ROWS[j][0], 30, true) + cells.join(''));
}
