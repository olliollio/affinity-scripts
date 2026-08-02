/**
 * sanitize.js — makes real font outlines safe for earcut and planck.
 *
 * Flattened glyph contours arrive with duplicated points, long collinear runs and zero-area
 * slivers. Every one of those either inflates the part count or trips a planck assertion, so
 * this module is the difference between "works on my test rectangle" and "works on Helvetica".
 */

'use strict';

module.exports = function (PD, h) {

  function ringLen(ring) { return ring.length >> 1; }

  h.group('sanitize.sanitizeRing');

  var dup = PD.sanitizeRing([0, 0, 0, 0, 10, 0, 10, 10, 0, 10]);
  h.assertEqual('duplicate consecutive point is dropped', ringLen(dup), 4);
  h.assertClose('duplicate does not change area', PD.signedArea(dup), 100);

  var nearDup = PD.sanitizeRing([0, 0, 1e-9, 1e-9, 10, 0, 10, 10, 0, 10]);
  h.assertEqual('sub-epsilon neighbour is merged', ringLen(nearDup), 4);

  var wrapDup = PD.sanitizeRing([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]);
  h.assertEqual('closing point equal to the first is dropped', ringLen(wrapDup), 4);

  var collinear = PD.sanitizeRing([0, 0, 5, 0, 10, 0, 10, 10, 0, 10]);
  h.assertEqual('midpoint of a straight run is dropped', ringLen(collinear), 4);
  h.assertClose('collinear removal does not change area', PD.signedArea(collinear), 100);

  var wrapCollinear = PD.sanitizeRing([5, 0, 10, 0, 10, 10, 0, 10, 0, 0]);
  h.assertEqual('collinear vertex at the wrap point is dropped', ringLen(wrapCollinear), 4);

  var manyCollinear = PD.sanitizeRing([0, 0, 1, 0, 2, 0, 3, 0, 10, 0, 10, 10, 0, 10]);
  h.assertEqual('a whole collinear run collapses to one edge', ringLen(manyCollinear), 4);

  h.assert('an all-collinear ring is rejected',
    PD.sanitizeRing([0, 0, 5, 0, 10, 0, 5, 0]) === null);
  h.assert('a zero-area sliver is rejected',
    PD.sanitizeRing([0, 0, 10, 0, 10, 1e-12, 0, 1e-12]) === null);
  h.assert('a ring that collapses below 3 points is rejected',
    PD.sanitizeRing([0, 0, 1e-12, 0, 0, 1e-12]) === null);
  h.assert('an empty ring is rejected', PD.sanitizeRing([]) === null);

  var input = [0, 0, 0, 0, 10, 0, 10, 10, 0, 10];
  PD.sanitizeRing(input);
  h.assertEqual('the input ring is not mutated', input.length, 10);

  var clean = [0, 0, 10, 0, 10, 10, 0, 10];
  var cleaned = PD.sanitizeRing(clean);
  h.assertEqual('an already clean ring keeps its points', ringLen(cleaned), 4);
  h.assert('an already clean ring is returned as a copy', cleaned !== clean);

  // Curve flattening puts many near-collinear points on shallow arcs; the tolerance must be
  // tight enough to keep a genuine curve from being straightened into a chord.
  var arc = [];
  for (var a = 0; a <= 12; a++) arc.push(50 * Math.cos(a * Math.PI / 24), 50 * Math.sin(a * Math.PI / 24));
  arc.push(0, 0);
  var keptArc = PD.sanitizeRing(arc);
  h.assert('a genuine arc survives collinear culling', ringLen(keptArc) >= 12,
    'kept ' + ringLen(keptArc) + ' of ' + ringLen(arc));

  h.group('sanitize.enforceWinding');

  var cw = [0, 0, 0, 10, 10, 10, 10, 0];
  var madeCcw = PD.enforceWinding(cw, true);
  h.assertClose('a clockwise ring is flipped to positive', PD.signedArea(madeCcw), 100);
  h.assertEqual('flipping keeps every point', ringLen(madeCcw), 4);
  h.assertEqual('the source ring is not mutated', PD.signedArea(cw), -100);

  var ccw = [0, 0, 10, 0, 10, 10, 0, 10];
  h.assertClose('a ring already positive is left alone', PD.signedArea(PD.enforceWinding(ccw, true)), 100);
  h.assertClose('asking for negative flips a positive ring',
    PD.signedArea(PD.enforceWinding(ccw, false)), -100);
  h.assertClose('asking for negative leaves a negative ring',
    PD.signedArea(PD.enforceWinding(cw, false)), -100);

  h.group('sanitize.simplifyRing');

  // Every flattened vertex kept is fixture budget spent. Douglas-Peucker trades a bounded
  // deviation for far fewer convex parts: a 250pt-radius "O" goes from 137 parts to ~38 at a
  // ~1pt tolerance, for 0.06% area error.
  function circleRing(r, n, rev) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * (rev ? -i : i) / n;
      p.push(r * Math.cos(a), r * Math.sin(a));
    }
    return p;
  }
  function ringArea(r) { return Math.abs(PD.signedArea(r)); }

  var bumped = PD.simplifyRing([0, 0, 50, 0.05, 100, 0, 100, 100, 0, 100], { simplifyTol: 0.25 });
  h.assertEqual('a bump under tolerance is flattened away', ringLen(bumped), 4);

  var kinked = PD.simplifyRing([0, 0, 50, 8, 100, 0, 100, 100, 0, 100], { simplifyTol: 0.25 });
  h.assertEqual('a real corner survives', ringLen(kinked), 5);

  var c120 = circleRing(250, 120);
  var cSimp = PD.simplifyRing(c120);
  h.assert('a flattened circle loses points', ringLen(cSimp) < 80, 'kept ' + ringLen(cSimp));
  h.assert('a flattened circle keeps its shape',
    Math.abs(ringArea(cSimp) - ringArea(c120)) < 0.005 * ringArea(c120),
    'area moved ' + (100 * (ringArea(cSimp) - ringArea(c120)) / ringArea(c120)).toFixed(3) + '%');

  // The whole point of a relative tolerance: the same drawing at another size decomposes the same.
  h.assertEqual('the tolerance is scale-free',
    ringLen(PD.simplifyRing(circleRing(2500, 120))), ringLen(PD.simplifyRing(circleRing(250, 120))));

  // ...but never below the absolute floor, or small art dissolves into its own rounding noise.
  var tiny = PD.simplifyRing(circleRing(2, 120));
  h.assert('the absolute floor still applies to small art', ringLen(tiny) < 40,
    'kept ' + ringLen(tiny) + ' of 120');

  h.assertClose('simplifying does not flip winding',
    Math.sign(PD.signedArea(PD.simplifyRing(circleRing(250, 120, true)))), -1);

  var srcRing = circleRing(250, 120);
  PD.simplifyRing(srcRing);
  h.assertEqual('the source ring is not mutated', ringLen(srcRing), 120);

  h.assert('a ring with fewer than 3 points is rejected',
    PD.simplifyRing([0, 0, 10, 10], { simplifyTol: 100 }) === null);
  // Three points are already the minimum; culling a degenerate triangle is sanitizeRing's job.
  h.assertEqual('a triangle is never simplified away',
    ringLen(PD.simplifyRing([0, 0, 100, 0, 50, 80], { simplifyTol: 10 })), 3);
  // A tolerance larger than the shape collapses it to a chord. Rejecting is the safe answer:
  // fabricating a triangle would invent geometry the input never had, and planck cannot take a
  // 2-gon fixture at all.
  h.assert('a tolerance larger than the shape rejects it',
    PD.simplifyRing(circleRing(250, 120), { simplifyTol: 1e6 }) === null);

  h.group('sanitize.sanitizeFace');

  function box(x0, y0, x1, y1) { return [x0, y0, x1, y0, x1, y1, x0, y1]; }
  function boxCw(x0, y0, x1, y1) { return [x0, y0, x0, y1, x1, y1, x1, y0]; }

  var plain = PD.sanitizeFace({ outer: boxCw(0, 0, 100, 100), holes: [] });
  h.assertClose('the outer comes back positive', PD.signedArea(plain.outer), 10000);
  h.assertEqual('a face without holes keeps none', plain.holes.length, 0);

  var holed = PD.sanitizeFace({ outer: box(0, 0, 100, 100), holes: [box(20, 20, 80, 80)] });
  h.assertEqual('a real counter is kept', holed.holes.length, 1);
  h.assertClose('holes come back negative', PD.signedArea(holed.holes[0]), -3600);
  h.assertClose('net signed area is outer minus hole',
    PD.signedArea(holed.outer) + PD.signedArea(holed.holes[0]), 6400);

  // Absolute rule: 0.05 x 0.05 = 0.0025pt^2, below the 0.01pt^2 floor.
  var dust = PD.sanitizeFace({ outer: box(0, 0, 100, 100), holes: [box(50, 50, 50.05, 50.05)] });
  h.assertEqual('a speck of a hole is dropped', dust.holes.length, 0);
  h.assert('dropping a hole keeps the face', dust.outer !== undefined);

  // Relative rule: 5 x 5 = 25pt^2 clears the absolute floor, but is 2.5e-5 of a 1e6pt^2 outer.
  var bigGlyph = PD.sanitizeFace({ outer: box(0, 0, 1000, 1000), holes: [box(10, 10, 15, 15)] });
  h.assertEqual('a hole too small for its face is dropped', bigGlyph.holes.length, 0);

  var sameHoleSmallFace = PD.sanitizeFace({ outer: box(0, 0, 100, 100), holes: [box(10, 10, 15, 15)] });
  h.assertEqual('the same hole on a smaller face is kept', sameHoleSmallFace.holes.length, 1);

  h.assert('a face below the absolute floor is dropped',
    PD.sanitizeFace({ outer: box(0, 0, 0.05, 0.05), holes: [] }) === null);
  h.assert('a face whose outer collapses is dropped',
    PD.sanitizeFace({ outer: [0, 0, 5, 0, 10, 0], holes: [] }) === null);

  var badHole = PD.sanitizeFace({ outer: box(0, 0, 100, 100), holes: [[0, 0, 5, 0, 10, 0]] });
  h.assert('a collapsing hole does not take the face with it', badHole !== null);
  h.assertEqual('the collapsing hole is gone', badHole.holes.length, 0);

  var mixedHoles = PD.sanitizeFace({
    outer: box(0, 0, 100, 100),
    holes: [box(10, 10, 40, 40), box(50, 50, 50.05, 50.05), box(60, 60, 90, 90)]
  });
  h.assertEqual('good holes survive alongside a dropped one', mixedHoles.holes.length, 2);

  h.assertEqual('a missing holes array is treated as none',
    PD.sanitizeFace({ outer: box(0, 0, 100, 100) }).holes.length, 0);

  var srcOuter = boxCw(0, 0, 100, 100);
  var srcHole = box(20, 20, 80, 80);
  PD.sanitizeFace({ outer: srcOuter, holes: [srcHole] });
  h.assertClose('the source outer is not rewound', PD.signedArea(srcOuter), -10000);
  h.assertClose('the source hole is not rewound', PD.signedArea(srcHole), 3600);

  var bigO = { outer: circleRing(250, 120), holes: [circleRing(40, 120, true)] };
  var simplified = PD.sanitizeFace(bigO);
  h.assert('sanitizeFace simplifies the outer', ringLen(simplified.outer) < 80,
    'kept ' + ringLen(simplified.outer));
  h.assert('sanitizeFace simplifies holes too', ringLen(simplified.holes[0]) < 80,
    'kept ' + ringLen(simplified.holes[0]));

  // The tolerance is a property of the face, not of each ring: 1pt of positional error is 1pt
  // whether it lands on the outline or on a counter, and a counter measured against its own
  // smaller diagonal stays needlessly dense. The per-ring area budget still caps it, so the face
  // tolerance only wins where the hole is large enough to afford it.
  var wideRing = { outer: circleRing(250, 120), holes: [circleRing(150, 120, true)] };
  var wideClean = PD.sanitizeFace(wideRing);
  var holeAlone = PD.simplifyRing(circleRing(150, 120, true));
  h.assert('a big hole is simplified at the face tolerance, not its own',
    ringLen(wideClean.holes[0]) < ringLen(holeAlone),
    'hole kept ' + ringLen(wideClean.holes[0]) + ', standalone kept ' + ringLen(holeAlone));

  var netBefore = ringArea(bigO.outer) - ringArea(bigO.holes[0]);
  var netAfter = ringArea(simplified.outer) - ringArea(simplified.holes[0]);
  h.assert('simplifying a face costs under 0.5% of its area',
    Math.abs(netAfter - netBefore) < 0.005 * netBefore,
    'moved ' + (100 * (netAfter - netBefore) / netBefore).toFixed(3) + '%');

  // A chord tolerance is blind to feature thickness: 1.5pt of allowed deviation will happily eat
  // a 0.2pt hairline or shave a thin stem. Simplification is an optimisation and must never cost
  // more area than its budget, whatever the tolerance says.
  var hairline = PD.sanitizeFace({ outer: [0, 0, 1000, 0, 1000, 0.2, 0, 0.2], holes: [] });
  h.assert('a 1000 x 0.2pt hairline is not simplified away', hairline !== null, 'face was dropped');
  if (hairline) {
    h.assertClose('the hairline keeps its area', ringArea(hairline.outer), 200, 4);
  }

  // A 1000pt-tall bracket drawn with a 1.5pt stem: the tolerance derived from the bounding box is
  // wider than the stem, so an unbudgeted pass flattens the notch and the shape balloons into a
  // solid slab.
  var stem = { outer: [0, 0, 300, 0, 300, 1.5, 1.5, 1.5, 1.5, 1000, 0, 1000], holes: [] };
  var stemClean = PD.sanitizeFace(stem);
  h.assert('a thin stem survives', stemClean !== null, 'face was dropped');
  if (stemClean) {
    h.assert('the thin stem keeps its area within 2%',
      Math.abs(ringArea(stemClean.outer) - ringArea(stem.outer)) < 0.02 * ringArea(stem.outer),
      'moved ' + (100 * (ringArea(stemClean.outer) - ringArea(stem.outer)) / ringArea(stem.outer)).toFixed(2) + '%');
  }

  // The budget must not blunt simplification on ordinary art.
  h.assert('a smooth circle still simplifies hard', ringLen(PD.sanitizeFace(bigO).outer) < 80,
    'kept ' + ringLen(PD.sanitizeFace(bigO).outer));

  var unsimplified = PD.sanitizeFace(bigO, { simplify: false });
  h.assertEqual('simplification can be switched off', ringLen(unsimplified.outer), 120);

  // Simplification is switched off here as well: a 0.05pt hole is smaller than the simplification
  // tolerance, so it would collapse before the area thresholds ever saw it.
  var loose = PD.sanitizeFace(
    { outer: box(0, 0, 100, 100), holes: [box(50, 50, 50.05, 50.05)] },
    { minArea: 0, minAreaFrac: 0, simplify: false }
  );
  h.assertEqual('thresholds can be turned off', loose.holes.length, 1);

  // decompose() sanitises its own input, so a face that already went through the pipeline gets
  // sanitised twice. Douglas-Peucker must therefore be a fixed point at a given tolerance, or the
  // geometry would quietly erode on every pass.
  var pass1 = PD.sanitizeFace(bigO);
  var pass2 = PD.sanitizeFace(pass1);
  h.assertEqual('sanitising twice does not erode the outer', ringLen(pass2.outer), ringLen(pass1.outer));
  h.assertEqual('sanitising twice does not erode holes',
    ringLen(pass2.holes[0]), ringLen(pass1.holes[0]));
  h.assertClose('sanitising twice does not move area',
    PD.signedArea(pass2.outer), PD.signedArea(pass1.outer), 1e-9);

  // Simplification is an optimisation, never a deletion: a 0.05pt hole is far below the
  // simplification tolerance, but the area budget pulls the tolerance back rather than losing it.
  // Whether such a hole is worth keeping is the area rules' decision alone.
  var tinyKept = PD.sanitizeFace(
    { outer: box(0, 0, 100, 100), holes: [box(50, 50, 50.05, 50.05)] },
    { minArea: 0, minAreaFrac: 0 }
  );
  h.assertEqual('simplification never deletes a hole on its own', tinyKept.holes.length, 1);
};
