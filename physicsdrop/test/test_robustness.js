/**
 * Pathological input the pipeline will actually meet.
 *
 * Real font outlines and traced rasters are not the tidy boxes the unit tests use: contours touch
 * each other, stems are thinner than any sensible tolerance, artboard coordinates sit a million
 * points from the origin, and the occasional NaN gets through. Each case here asserts the full
 * invariant set rather than a specific part count — the requirement is "does not produce geometry
 * planck would choke on", not "produces exactly N parts".
 */

'use strict';

var inv = require('./invariants');

module.exports = function (PD, h) {

  function box(x0, y0, x1, y1) { return [x0, y0, x1, y0, x1, y1, x0, y1]; }
  function circle(cx, cy, r, n, rev) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * (rev ? -i : i) / n;
      p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return p;
  }

  // Runs the whole pipeline and reports the three invariants under one label.
  function survives(label, face, expectDropped) {
    var clean, parts;
    try {
      clean = PD.sanitizeFace(face);
      parts = clean ? PD.decompose(clean) : [];
    } catch (e) {
      h.assert(label + ': does not throw', false, e.message);
      return;
    }
    if (expectDropped) {
      h.assert(label + ': is rejected', clean === null || parts.length === 0);
      return;
    }
    h.assert(label + ': yields parts', clean !== null && parts.length > 0,
      clean === null ? 'face was dropped' : 'no parts');
    if (clean && parts.length) inv.assertInvariants(PD, h, label, clean, parts);
  }

  h.group('robustness: touching contours');

  // Where a stem meets a bowl, a counter can touch the outline at a single point or share an edge
  // with it outright. earcut bridges holes, so these must not produce overlapping or inverted parts.
  survives('hole touching outer at a vertex', { outer: box(0, 0, 100, 100), holes: [[0, 50, 40, 20, 40, 80]] });
  survives('hole sharing an edge with outer', { outer: box(0, 0, 100, 100), holes: [[0, 20, 40, 20, 40, 80, 0, 80]] });
  survives('two holes touching each other', { outer: box(0, 0, 100, 100), holes: [box(20, 20, 50, 80), box(50, 20, 80, 80)] });
  survives('pinched outer (figure eight)', { outer: [0, 0, 50, 49.999, 100, 0, 100, 100, 50, 50.001, 0, 100], holes: [] });

  h.group('robustness: extreme proportions');

  // A hairline rule is a legitimate object to drop into the sim; simplification must not eat it.
  survives('1000 x 0.2pt hairline', { outer: box(0, 0, 1000, 0.2), holes: [] });
  survives('1.5pt stem on a 1000pt bracket',
    { outer: [0, 0, 300, 0, 300, 1.5, 1.5, 1.5, 1.5, 1000, 0, 1000], holes: [] });
  survives('4pt glyph with a counter', { outer: box(0, 0, 4, 4), holes: [box(1.5, 1.5, 2.5, 2.5)] });
  survives('20 counters on one outline', (function () {
    var holes = [];
    for (var i = 0; i < 20; i++) holes.push(circle(50 + 40 * Math.cos(i), 50 + 40 * Math.sin(i), 3, 12, true));
    return { outer: circle(50, 50, 49, 80), holes: holes };
  })());

  h.group('robustness: numerics');

  // Artboard coordinates are absolute: a shape can sit far from the origin with no loss of detail.
  survives('offset a million points from the origin',
    { outer: box(1e6, 1e6, 1e6 + 100, 1e6 + 100), holes: [box(1e6 + 30, 1e6 + 30, 1e6 + 70, 1e6 + 70)] });

  survives('every point duplicated', (function () {
    var c = circle(0, 0, 200, 60), o = [];
    for (var i = 0; i < c.length; i += 2) o.push(c[i], c[i + 1], c[i], c[i + 1]);
    return { outer: o, holes: [] };
  })());

  survives('a NaN in the contour', { outer: [0, 0, NaN, NaN, 100, 0, 100, 100, 0, 100], holes: [] });
  survives('an Infinity in the contour', { outer: [0, 0, Infinity, 5, 100, 0, 100, 100, 0, 100], holes: [] });

  // Genuinely empty geometry must be refused, not turned into a degenerate body.
  survives('a zero-area contour', { outer: [0, 0, 100, 0, 100, 0, 0, 0], holes: [] }, true);
  survives('a single repeated point', { outer: [5, 5, 5, 5, 5, 5, 5, 5], holes: [] }, true);
};
