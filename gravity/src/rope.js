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

  // Enough links to bend smoothly without turning one rope into a hundred bodies.
  var MAX_SEGMENTS = 32;
  var MIN_SEGMENTS = 3;

  // A link shorter than this in SIM units is solving against linearSlop (0.005), and a long chain
  // of such links compounds the error every step until the rope tears itself apart. Measured on a
  // 400pt rope pinned at both ends: 0.125 sim units per link holds and sags 41pt, 0.083 explodes
  // to y=24300. Thickness alone is not the predictor - a short fat link is fine, a long chain of
  // thin short ones is not.
  var MIN_LINK_SIM = 0.12;

  // A link much thinner than this jitters, because Box2D resolves contacts to linearSlop and a
  // link comparable to that tolerance is fighting the solver's own noise.
  var MIN_THICKNESS = 1.5;

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

    var stable = Math.floor((length / s) / MIN_LINK_SIM);
    var ceiling = Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, stable));

    if (o.segments) return Math.max(MIN_SEGMENTS, Math.min(ceiling, Math.floor(o.segments)));

    var t = Math.max(MIN_THICKNESS, thickness || MIN_THICKNESS);
    var byThickness = Math.round(length / (t * 2));
    return Math.max(MIN_SEGMENTS, Math.min(ceiling, byThickness));
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
    var length = polylineLength(points);
    if (!(length > 0)) return null;

    var scale = W.scale;
    var n = segmentCount(length, thickness, o, scale);
    var sampled = resample(points, n + 1);
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
        angularDamping: o.angularDamping === undefined ? 0.05 : o.angularDamping
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
      node: o.node || null,
      name: o.name || 'rope'
    };
  }

  GR.isAnchoredName = isAnchoredName;
  GR.polylineLength = polylineLength;
  GR.resamplePolyline = resample;
  GR.polylineFromPoses = polylineFromPoses;
  GR.ropeSegmentCount = segmentCount;
  GR.addRope = addRope;
  GR.ROPE_ANCHOR_WORDS = ANCHOR_WORDS;

})(GR);
