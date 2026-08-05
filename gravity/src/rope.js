/**
 * rope.js — open paths become ropes: a chain of small bodies joined end to end.
 *
 * `extract.js` skips open paths, because a path with no interior cannot be a rigid body. Making
 * them ropes costs nothing in ambiguity — a closed path is an object, an open one is a rope — and
 * needs no naming convention.
 *
 * The pure parts live here and are tested headlessly: resampling a polyline to even segments, and
 * rebuilding a polyline from segment poses. `addRope` is the only function that touches planck.
 *
 * Ends fall free unless the path is named "hang" or "pin", which anchors them. A line dropped over
 * a shape should drape and slide; a washing line should stay up. Naming is how the user says which.
 */

(function (GR) {
  'use strict';

  // Two caps, because the link count that tears a rope apart depends entirely on whether it is
  // taut. See the measurements below MIN_LINK_SIM: pinned at both ends, a chain goes from 1.03x to
  // 54x stretch between 40 and 48 links, and the boundary is chaotic. A SLACK rope has nowhere for
  // that tension to build and was measured as far more forgiving.
  //
  // Keeping one conservative cap for both meant a long draped rope was needlessly coarse: at 32
  // links an 1800pt rope has 56pt links, and a rigid 56pt link cannot enter a 30pt gap between two
  // letters, so the rope bridges fine detail instead of draping into it. That reads as the collider
  // being ignored when it is really the rope being too blunt to find it.
  var MAX_SEGMENTS = 32;        // anchored: the worst case for an iterative solver
  var MAX_SEGMENTS_SLACK = 96;  // free-hanging: resolution matters more than tension does
  var MIN_SEGMENTS = 3;

  // Two independent stability limits, both found by measurement rather than derived.
  //
  // A link shorter than this in SIM units solves against linearSlop (0.005) and a chain of them
  // compounds the error every step: a 400pt rope at 0.083 sim per link tore itself apart and flung
  // its middle to y=24300, while 0.121 held and sagged 41pt.
  var MIN_LINK_SIM = 0.12;
  //
  // Separately, a TAUT chain has a link-count limit that no size rule predicts, because Box2D
  // propagates constraints iteratively along the chain. Measured stretch factors for ropes pinned
  // at both ends: 600pt tore apart at 40 links, 1000pt at 48, 1500pt was fine at 48. The boundary
  // is chaotic, so MAX_SEGMENTS takes margin instead of chasing it - 32 links held on every length
  // tested, at worst 1.02x stretch. A draped rope has slack and is far more forgiving; taut is the
  // worst case. Appearance does not suffer, because smoothPolyline draws far more points than the
  // solver simulates.

  // A link much thinner than this jitters, because Box2D resolves contacts to linearSlop and a
  // link comparable to that tolerance is fighting the solver's own noise.
  var MIN_THICKNESS = 1.5;

  // Damping, in Box2D's per-step form `v /= (1 + dt * d)`, which over one second at 60Hz is close
  // to a factor of e^-d. So these read as "how much velocity survives a second": spin keeps 14%,
  // travel keeps 67%. Terminal speed under damping is g/d, here 25 sim units per second, which is
  // far above anything a drop reaches - so this slows the settling tail, not the fall.
  //
  // They exist because a long rope has a very long tail of tiny motion, and a run only ends when
  // EVERY body is asleep, or when every body stays under tolerance for a full second. 84 links
  // draped over lettering managed neither: on a real scene 52 of 168 bodies were over tolerance at
  // 5 seconds and 11 were still over at 20, the fastest at 1.8pt/s against a 1.0pt/s threshold. It
  // was converging, far too slowly to ever report itself settled.
  //
  // Angular is the heavier of the two because the measurements said so: spin was 33x its tolerance
  // where travel was 20x. A rope's residual motion is folds rotating against their neighbours
  // rather than the rope travelling. The old value was 0.05, a 5% decay per second - over a whole
  // 20 second run that is a factor of 2.7 while contacts alone delivered 10x. It was not
  // participating in the result at all.
  //
  // Chosen from a sweep over five seeds of a rope draped across four obstacles, which is the
  // fixture that actually reproduces the problem - a rope dropped onto a flat floor settles either
  // way and can measure nothing. Undamped settled 0 times out of 5. Every value between 0.1/0.5 and
  // 0.6/2.5 settled 2-3 times out of 5, so the differences within that range are chaos rather than
  // signal; 0.4/2.0 is taken for having the best worst case (9 bodies over tolerance against 13-14
  // either side) and a good median settling frame, and it is treated as a plateau rather than a
  // peak. Note what this does NOT claim: damping does not make a hard scene settle reliably. It
  // roughly halves the residual motion and turns "never" into "usually", which is worth having and
  // is not the same as a fix.
  //
  // Raising them further is not free. Damping is a lie about the world, and enough of it makes a
  // rope look like it is falling through syrup - more objectionable than a run that ends on the
  // frame cap. These are the knob to turn if the drop ever reads as floaty.
  var LINK_LINEAR_DAMPING = 0.4;
  var LINK_ANGULAR_DAMPING = 2.0;

  var ANCHOR_WORDS = ['hang', 'pin', 'anchor'];

  /** Is this path pinned at its ends? Pure, so it is unit-tested like the scenery names. */
  function isAnchoredName(name) {
    if (!name) return false;
    var s = String(name).toLowerCase();
    for (var i = 0; i < ANCHOR_WORDS.length; i++) {
      var w = ANCHOR_WORDS[i];
      var at = s.indexOf(w);
      while (at >= 0) {
        var before = at === 0 ? '' : s.charAt(at - 1);
        var after = s.charAt(at + w.length);
        if ((at === 0 || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) return true;
        at = s.indexOf(w, at + 1);
      }
    }
    return false;
  }

  /** Total length of a polyline given as a flat `[x0, y0, x1, y1, ...]` array. */
  function polylineLength(points) {
    var total = 0;
    for (var i = 2; i < points.length; i += 2) {
      var dx = points[i] - points[i - 2];
      var dy = points[i + 1] - points[i - 1];
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }

  /**
   * Resamples a polyline to evenly spaced points.
   *
   * Even spacing matters because every link becomes a body of the same length: uneven links give
   * uneven mass and the rope hangs wrong. Sampling walks by arc length rather than by index, so a
   * path with one long segment and twenty short ones still yields a uniform chain.
   */
  function resample(points, count) {
    if (!points || points.length < 4) return points ? points.slice() : [];
    var n = Math.max(2, Math.floor(count));
    var total = polylineLength(points);
    if (!(total > 0)) return [points[0], points[1], points[2], points[3]];

    var step = total / (n - 1);
    var out = [points[0], points[1]];
    var travelled = 0;
    var target = step;
    var i = 2;

    while (i < points.length && out.length / 2 < n) {
      var x0 = points[i - 2], y0 = points[i - 1];
      var x1 = points[i], y1 = points[i + 1];
      var dx = x1 - x0, dy = y1 - y0;
      var segLen = Math.sqrt(dx * dx + dy * dy);

      if (segLen <= 0) { i += 2; continue; }

      // Emit every sample that falls inside this segment before moving to the next one.
      while (travelled + segLen >= target && out.length / 2 < n) {
        var t = (target - travelled) / segLen;
        out.push(x0 + dx * t, y0 + dy * t);
        target += step;
      }
      travelled += segLen;
      i += 2;
    }

    // Floating-point drift can leave the last sample short; the end point is exact by definition.
    if (out.length / 2 < n) out.push(points[points.length - 2], points[points.length - 1]);
    return out;
  }

  /**
   * Rebuilds a rope's polyline from its segment poses.
   *
   * Each pose is `{x, y, angle}` in SOURCE units, as `bodyState` reports it, and `halfLength` is
   * half a link in source units. A link's local +X axis maps to `(cos a, sin a)` in source space:
   * the y-flip mirrors the plane, which negates the angle, and `bodyState` has already done that —
   * so no further sign correction belongs here.
   */
  function polylineFromPoses(poses, halfLength) {
    var out = [];
    if (!poses || !poses.length) return out;

    for (var i = 0; i < poses.length; i++) {
      var p = poses[i];
      var dx = Math.cos(p.angle) * halfLength;
      var dy = Math.sin(p.angle) * halfLength;
      if (i === 0) out.push(p.x - dx, p.y - dy);
      out.push(p.x + dx, p.y + dy);
    }
    return out;
  }

  /**
   * How many links a path of this length should have.
   *
   * Two limits apply. Thickness sets the ideal - links about twice as long as they are thick bend
   * smoothly - and the world scale sets a hard ceiling, because links too short in sim units make
   * the chain unstable however good they look on the page.
   */
  function segmentCount(length, thickness, opts, scale) {
    var o = opts || {};
    var s = scale || GR.WORLD_SCALE;

    // Anchored ropes keep the conservative cap; slack ones get the resolution to drape into detail.
    var cap = o.anchored ? MAX_SEGMENTS : MAX_SEGMENTS_SLACK;
    var stable = Math.floor((length / s) / MIN_LINK_SIM);
    var ceiling = Math.max(MIN_SEGMENTS, Math.min(cap, stable));

    if (o.segments) return Math.max(MIN_SEGMENTS, Math.min(ceiling, Math.floor(o.segments)));

    var t = Math.max(MIN_THICKNESS, thickness || MIN_THICKNESS);
    var byThickness = Math.round(length / (t * 2));
    return Math.max(MIN_SEGMENTS, Math.min(ceiling, byThickness));
  }

  // Slack is capped because the sag needed grows without bound as the extra length does, and a rope
  // told to be three times its span would be initialised in a loop below the artboard.
  var MAX_SLACK = 1.0;

  // How finely a path is resampled before the sag is applied. The sag displaces vertices and is
  // zero at both ends, so the curve can only be as smooth as the vertices available to move.
  var SAG_SAMPLES = 64;

  /**
   * Lengthens a path by `slack` (0.2 = 20% longer) by sagging it, keeping both ends exactly put.
   *
   * This is what lets a straight line hang. A rope drawn as a straight line has length equal to the
   * distance between its ends, so a correctly simulated chain has NOTHING spare and cannot drape —
   * measured, a 1640pt pinned rope sags 105.7pt, and all of that is joint stretch rather than
   * drape. Extra length has to come from somewhere, and the honest place is the initial shape.
   *
   * The sag is a parabola, `4d·t·(1-t)`, which is zero at both ends — so the endpoints, and
   * therefore the anchor pins, stay exactly where the user drew them. Only the middle moves. That
   * keeps the frame-0 rule ("the first frame reproduces the artwork") true where it matters most:
   * a slack rope starts visibly sagging, but it starts sagging FROM the right place.
   *
   * `d` is solved rather than derived. The small-sag approximation `d = L·sqrt(3·slack/8)` is only
   * good to a few percent by 30% slack, and the whole point is that the length comes out right, so
   * it is used as a seed and then corrected. Pure, so the length identity is unit-tested.
   *
   * Sag is applied down the page (+y in source space) because that is where gravity points by
   * default. A different gravity angle makes this an imperfect starting guess and nothing worse —
   * it is an initial condition, and the solver takes over on the first step.
   */
  function sagPolyline(points, slack) {
    var s = Math.max(0, Math.min(MAX_SLACK, slack || 0));
    if (!points || points.length < 4 || s <= 0) return points ? points.slice() : [];

    // Densify FIRST. The sag is applied by displacing existing vertices, and the displacement is
    // zero at both ends by construction — so a path with no vertices between its ends cannot sag at
    // all. A straight line drawn with two points is exactly that, and it is the input this whole
    // feature exists for: eight passing assertions on the length identity meant nothing until an
    // end-to-end test fed it a raw two-point line and the rope came out identical to a taut one.
    var src = points.length / 2 < SAG_SAMPLES ? resample(points, SAG_SAMPLES) : points;

    var L = polylineLength(src);
    if (!(L > 0)) return src.slice();
    var target = L * (1 + s);

    // Arc position of every point, normalised, so the sag is placed by distance along the path
    // rather than by index — an unevenly sampled path would otherwise sag lopsidedly.
    var ts = [0];
    var run = 0;
    for (var i = 2; i < src.length; i += 2) {
      var dx = src[i] - src[i - 2], dy = src[i + 1] - src[i - 1];
      run += Math.sqrt(dx * dx + dy * dy);
      ts.push(run / L);
    }

    function withSag(d) {
      var out = src.slice();
      for (var k = 0; k < ts.length; k++) {
        var t = ts[k];
        out[k * 2 + 1] += 4 * d * t * (1 - t);
      }
      return out;
    }

    // Seed from the small-sag closed form, then bisect. Length grows monotonically with d, so a
    // bracket plus a fixed iteration count converges without needing a derivative.
    var lo = 0, hi = Math.max(L * Math.sqrt(3 * s / 8) * 2, L);
    for (var it = 0; it < 40; it++) {
      var mid = (lo + hi) / 2;
      if (polylineLength(withSag(mid)) < target) lo = mid; else hi = mid;
    }
    return withSag((lo + hi) / 2);
  }

  /**
   * Builds a rope in the world from a polyline in SOURCE coordinates.
   *
   * Neighbouring links are joined by a revolute joint at the point they share, with
   * `collideConnected` off — links that touch by construction must not also collide, or the rope
   * spends every step pushing itself apart.
   *
   * Anchoring uses a static body and a joint rather than making the end link static, so a hanging
   * rope can still swivel about its pin instead of being welded rigid.
   */
  function addRope(W, points, opts) {
    var o = opts || {};
    var pl = W.planck;
    if (!points || points.length < 4) return null;

    var thickness = Math.max(MIN_THICKNESS, o.thickness || MIN_THICKNESS);
    // Slack lengthens the rope before anything else is decided, because the link count, the link
    // length and the layout all follow from how long the rope actually is.
    var slack = Math.max(0, Math.min(MAX_SLACK, o.slack || 0));
    var path = slack > 0 ? sagPolyline(points, slack) : points;

    var length = polylineLength(path);
    if (!(length > 0)) return null;

    var scale = W.scale;
    var n = segmentCount(length, thickness, o, scale);
    var sampled = resample(path, n + 1);
    var linkCount = sampled.length / 2 - 1;
    if (linkCount < 1) return null;

    var halfLen = (length / linkCount) / 2;
    var halfThick = thickness / 2;

    var links = [];
    for (var i = 0; i < linkCount; i++) {
      var ax = sampled[i * 2], ay = sampled[i * 2 + 1];
      var bx = sampled[i * 2 + 2], by = sampled[i * 2 + 3];
      var midX = (ax + bx) / 2, midY = (ay + by) / 2;

      // Source y grows downward and sim y grows upward, so the angle negates on the way in — the
      // same mirror bodies.js applies to winding.
      var angleSrc = Math.atan2(by - ay, bx - ax);
      var angleSim = -angleSrc;

      var body = W.world.createDynamicBody({
        position: GR.toSim(W, midX, midY),
        angle: angleSim,
        linearDamping: o.linearDamping === undefined ? LINK_LINEAR_DAMPING : o.linearDamping,
        angularDamping: o.angularDamping === undefined ? LINK_ANGULAR_DAMPING : o.angularDamping
      });
      body.createFixture(
        new pl.Box(halfLen / scale, halfThick / scale),
        {
          density: o.density === undefined ? 1 : o.density,
          friction: o.friction === undefined ? 0.4 : o.friction,
          restitution: o.restitution === undefined ? 0 : o.restitution
        });

      var rec = {
        body: body,
        ox: midX,
        oy: midY,
        angle0: 0,
        halfLength: halfLen,
        simRadius: halfLen / scale,
        fixtures: 1,
        rejected: [],
        bullet: false,
        name: (o.name || 'rope') + ' [' + i + ']',
        node: o.node || null,
        isRopeLink: true
      };
      W.dynamics.push(rec);
      links.push(rec);
    }

    // Pin neighbours together at the point they share.
    for (var j = 1; j < links.length; j++) {
      var sharedX = sampled[j * 2], sharedY = sampled[j * 2 + 1];
      W.world.createJoint(new pl.RevoluteJoint(
        { collideConnected: false },
        links[j - 1].body,
        links[j].body,
        GR.toSim(W, sharedX, sharedY)));
    }

    if (o.anchored && links.length) {
      var anchorBody = W.world.createBody();
      var sx = sampled[0], sy = sampled[1];
      var ex = sampled[sampled.length - 2], ey = sampled[sampled.length - 1];
      W.world.createJoint(new pl.RevoluteJoint(
        { collideConnected: false }, anchorBody, links[0].body, GR.toSim(W, sx, sy)));
      W.world.createJoint(new pl.RevoluteJoint(
        { collideConnected: false }, anchorBody, links[links.length - 1].body, GR.toSim(W, ex, ey)));
    }

    return {
      links: links,
      halfLength: halfLen,
      thickness: thickness,
      anchored: !!o.anchored,
      slack: slack,
      node: o.node || null,
      name: o.name || 'rope'
    };
  }

  /**
   * Smooths a polyline by Catmull-Rom interpolation, passing through every original point.
   *
   * Physics link count is capped by stability — links below about 0.12 sim units tear the chain
   * apart — but that has nothing to do with how the rope should LOOK. Drawing straight lines
   * between joint centres makes a perfectly good simulation look faceted and cheap, so the drawn
   * curve is subdivided independently of the links driving it.
   *
   * Catmull-Rom is used because it interpolates rather than approximates: every joint stays exactly
   * where the solver put it, and only the space between joints is invented.
   */
  function smoothPolyline(points, perSegment) {
    var n = points ? points.length / 2 : 0;
    if (n < 3) return points ? points.slice() : [];

    var sub = Math.max(1, Math.floor(perSegment || 4));
    if (sub === 1) return points.slice();

    function px(i) { return points[Math.max(0, Math.min(n - 1, i)) * 2]; }
    function py(i) { return points[Math.max(0, Math.min(n - 1, i)) * 2 + 1]; }

    var out = [px(0), py(0)];
    for (var i = 0; i < n - 1; i++) {
      // The clamped ends duplicate the first and last point, which keeps the curve from
      // overshooting where there is no neighbour to take a tangent from.
      var x0 = px(i - 1), y0 = py(i - 1);
      var x1 = px(i), y1 = py(i);
      var x2 = px(i + 1), y2 = py(i + 1);
      var x3 = px(i + 2), y3 = py(i + 2);

      for (var k = 1; k <= sub; k++) {
        var t = k / sub;
        var t2 = t * t;
        var t3 = t2 * t;
        out.push(
          0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
          0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
        );
      }
    }
    return out;
  }

  GR.smoothPolyline = smoothPolyline;
  GR.isAnchoredName = isAnchoredName;
  GR.polylineLength = polylineLength;
  GR.resamplePolyline = resample;
  GR.polylineFromPoses = polylineFromPoses;
  GR.ropeSegmentCount = segmentCount;
  GR.sagPolyline = sagPolyline;
  GR.ROPE_MAX_SLACK = MAX_SLACK;
  GR.addRope = addRope;
  GR.ROPE_ANCHOR_WORDS = ANCHOR_WORDS;
  GR.ROPE_MAX_SEGMENTS = MAX_SEGMENTS;
  GR.ROPE_MAX_SEGMENTS_SLACK = MAX_SEGMENTS_SLACK;

})(GR);
