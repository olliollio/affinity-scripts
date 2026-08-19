/**
 * Curve fixtures for inflate's geometry tests.
 *
 * A fixture curve is `{ segments: [{start, c1, c2, end}], isClosed }`, each point `{x, y}` -
 * the shape `curve.beziers` yields once the caller reduces it to plain numbers. This is
 * Affinity's own node representation, not a simplified stand-in for it, because the thickness
 * probe has to work on what the sandbox actually hands it.
 *
 * Every straight edge here stores its handles COLLAPSED ON THE ANCHORS (c1 === start,
 * c2 === end) rather than at the third-points a "generic cubic" would use. That is how
 * Affinity itself stores a straight segment, and it is the common case in real artwork
 * (every polygon, every rounded rect's flat sides), so a fixture that used third-point
 * handles would test a curve-evaluation path the real input never exercises, and would
 * never catch a bug that only shows up on a truly flat cubic.
 *
 * Node-only: not part of the Affinity sandbox build. Test suites `require` this directly.
 */

'use strict';

// Handle length as a fraction of the RADIUS for a circle drawn as four cubics. This is not an
// exact circle: the radius is right at t = 0, 0.5 and 1, and low by up to 0.0273% of R around
// t = 0.21 and t = 0.79. Any "comes back a circle" assertion needs a tolerance above that, or
// better, one taken relative to the input's own roundness - 1e-9 will chase a fixture property
// into the inflate maths.
var K = (4 / 3) * (Math.sqrt(2) - 1);

function P(x, y) { return { x: x, y: y }; }

/** A closed polygon from [x0,y0,x1,y1,...], with COLLAPSED handles, as Affinity stores it.
 * Every anchor is a corner - the hard case for a thickness probe, since the largest circle
 * tangent to the boundary AT a convex corner has radius zero. */
function poly(pts) {
  var segs = [], n = pts.length >> 1;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    var a = P(pts[i * 2], pts[i * 2 + 1]), b = P(pts[j * 2], pts[j * 2 + 1]);
    segs.push({ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b });
  }
  return { segments: segs, isClosed: true };
}

function rect(x, y, w, h) { return poly([x, y, x + w, y, x + w, y + h, x, y + h]); }

function ngon(cx, cy, R, n) {
  var pts = [];
  for (var i = 0; i < n; i++) {
    var th = -Math.PI / 2 + i * 2 * Math.PI / n;
    pts.push(cx + R * Math.cos(th), cy + R * Math.sin(th));
  }
  return poly(pts);
}

/** Four cubics: the case that must come back an exact circle (bow = 0). `ccw === false` gives
 * the SAME circle at the opposite winding, at natural node order - unlike `reverseCurve`, which
 * gives opposite winding AND reverses the node order. The two are not redundant: a test that
 * wants winding-independence but a stable node order wants `ccw`, not `reverseCurve`. */
function circle(cx, cy, R, ccw) {
  var s = ccw === false ? -1 : 1, a = [], i;
  for (i = 0; i < 4; i++) {
    var th = s * i * Math.PI / 2;
    a.push(P(cx + R * Math.cos(th), cy + R * Math.sin(th)));
  }
  var segs = [];
  for (i = 0; i < 4; i++) {
    var A = a[i], B = a[(i + 1) % 4];
    var tA = P(-s * (A.y - cy), s * (A.x - cx)), tB = P(-s * (B.y - cy), s * (B.x - cx));
    segs.push({ start: A, c1: P(A.x + K * tA.x, A.y + K * tA.y),
                c2: P(B.x - K * tB.x, B.y - K * tB.y), end: B });
  }
  return { segments: segs, isClosed: true };
}

/** 4 straight sides + 4 quarter-arc cubics, 8 anchors: smooth anchors AND flat sides in one
 * shape, which is what separates a real pillow effect from a plain outline offset. */
function roundRect(x, y, w, h, r) {
  var pts = [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r],
             [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]]
            .map(function (p) { return P(p[0], p[1]); });
  var k = K * r, segs = [];
  function line(a, b) { segs.push({ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b }); }
  // ca is the unit tangent LEAVING a. cb is the unit tangent entering b, NEGATED, because c2
  // sits back along the curve from b - so a call reading "(0,-1) at the end" means the end
  // tangent is (0,+1). Both must be unit: k = K * r already carries the magnitude.
  function arc(a, b, ca, cb) {
    segs.push({ start: a, c1: P(a.x + ca.x * k, a.y + ca.y * k),
                c2: P(b.x + cb.x * k, b.y + cb.y * k), end: b });
  }
  line(pts[0], pts[1]);  arc(pts[1], pts[2], P(1, 0),  P(0, -1));
  line(pts[2], pts[3]);  arc(pts[3], pts[4], P(0, 1),  P(1, 0));
  line(pts[4], pts[5]);  arc(pts[5], pts[6], P(-1, 0), P(0, 1));
  line(pts[6], pts[7]);  arc(pts[7], pts[0], P(0, -1), P(-1, 0));
  return { segments: segs, isClosed: true };
}

// Reflex junctions at the notches, and thin spikes at the points: a thickness measure has to
// return the LOCAL width there, not the star's overall diameter.
function star(cx, cy, Router, Rinner, points) {
  var pts = [];
  for (var i = 0; i < points * 2; i++) {
    var R = (i % 2 === 0) ? Router : Rinner;
    var th = -Math.PI / 2 + i * Math.PI / points;
    pts.push(cx + R * Math.cos(th), cy + R * Math.sin(th));
  }
  return poly(pts);
}

/** Same shape, opposite winding, reversed node order. For the winding-independence test. */
function reverseCurve(curve) {
  return {
    segments: curve.segments.slice().reverse().map(function (s) {
      return { start: s.end, c1: s.c2, c2: s.c1, end: s.start };
    }),
    isClosed: curve.isClosed
  };
}

/** An open path: two segments, isClosed false. Must be copied through untouched. */
function openPath() {
  var a = P(0, 0), b = P(50, 30), c = P(100, 0);
  return { segments: [{ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b },
                      { start: b, c1: P(b.x, b.y), c2: P(c.x, c.y), end: c }], isClosed: false };
}

/** A closed ring of zero enclosed area: out and back along the same line. No inside to
 * grow into, so this exercises the pass-through path rather than the inflate math. */
function degenerateRing() { return poly([0, 0, 100, 0, 50, 0]); }

module.exports = { K: K, P: P, poly: poly, rect: rect, ngon: ngon, circle: circle,
                   roundRect: roundRect, star: star, reverseCurve: reverseCurve,
                   openPath: openPath, degenerateRing: degenerateRing };
