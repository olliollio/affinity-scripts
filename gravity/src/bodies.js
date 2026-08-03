/**
 * bodies.js — convex parts to one planck body with N polygon fixtures.
 *
 * Every part of one object becomes a fixture on a SINGLE body, which is what makes a letter behave
 * as one rigid thing rather than a pile of loose convex crumbs. Because holes were resolved in
 * decompose.js, mass and rotational inertia come out right for free: a hollow "O" weighs less than
 * a solid one and spins more readily, which physicsdrop could not express at all.
 */

(function (GR) {
  'use strict';

  // Below this radius in sim units a body can tunnel through a wall in one 1/60 step, so it gets
  // continuous collision. Bullet bodies cost more, hence a threshold rather than always-on.
  var BULLET_RADIUS = 0.15;

  /** Area and centroid of one positively-wound ring, by the standard polygon moment formulas. */
  function ringCentroid(ring) {
    var n = ring.length >> 1;
    if (n < 3) return null;
    var a2 = 0, cx = 0, cy = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var x0 = ring[i * 2], y0 = ring[i * 2 + 1];
      var x1 = ring[j * 2], y1 = ring[j * 2 + 1];
      var cross = x0 * y1 - x1 * y0;
      a2 += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (a2 === 0) return null;
    return { area: a2 / 2, x: cx / (3 * a2), y: cy / (3 * a2) };
  }

  /**
   * Area-weighted centroid over all parts.
   *
   * This is where the body origin goes. With uniform density the area centroid IS the centre of
   * mass, so after offsetting, planck's body position and the artwork's centroid are the same
   * point — which is what lets the Affinity layer map a body straight back to a Transform about
   * the original centroid, with no bookkeeping.
   */
  function partsCentroid(parts) {
    var sum = 0, sx = 0, sy = 0;
    for (var i = 0; i < parts.length; i++) {
      var c = ringCentroid(parts[i]);
      if (!c) continue;
      var w = Math.abs(c.area);
      sum += w; sx += c.x * w; sy += c.y * w;
    }
    if (!sum) return null;
    return { x: sx / sum, y: sy / sum, area: sum };
  }

  /** Largest distance from the centroid, in src units — the body's bounding radius. */
  function boundingRadius(parts, cx, cy) {
    var r2 = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      for (var k = 0; k < p.length; k += 2) {
        var dx = p[k] - cx, dy = p[k + 1] - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 > r2) r2 = d2;
      }
    }
    return Math.sqrt(r2);
  }

  /**
   * One dynamic body from parts given in SRC units.
   *
   * Vertices are offset by -centroid and then converted, so each fixture is expressed relative to
   * the body origin and the body is placed at the centroid.
   */
  function addBody(W, parts, opts) {
    var o = opts || {};
    var pl = W.planck;
    if (!parts || !parts.length) return null;

    var c = partsCentroid(parts);
    if (!c) return null;

    var radius = boundingRadius(parts, c.x, c.y);
    var simRadius = radius / W.scale;

    var body = W.world.createDynamicBody({
      position: GR.toSim(W, c.x, c.y),
      angle: 0,
      linearDamping: o.linearDamping === undefined ? 0 : o.linearDamping,
      angularDamping: o.angularDamping === undefined ? 0.02 : o.angularDamping
    });

    // Continuous collision for anything small enough to pass through a wall between steps.
    var bullet = o.bullet === undefined ? (simRadius < BULLET_RADIUS) : o.bullet;
    if (bullet) body.setBullet(true);

    // Mass is area x density, so a placed photo outweighs a letter by orders of magnitude and
    // simply bulldozes it. That is correct physics and often the wrong result for artwork, where
    // the objects are all "the same kind of thing" regardless of size. Equalising picks a density
    // per body that lands every mass on the same target, leaving rotational inertia to still grow
    // with size - a big object stays harder to spin, it just stops being a wrecking ball.
    var density = o.density === undefined ? 1 : o.density;
    if (o.equaliseMass) {
      var simArea = c.area / (W.scale * W.scale);
      var target = o.targetMass === undefined ? 1 : o.targetMass;
      // Degenerate areas would otherwise produce an infinite or zero density and planck would
      // reject every fixture on the body.
      density = simArea > 1e-12 ? target / simArea : 1;
      density = Math.min(1e6, Math.max(1e-6, density));
    }

    var fixtureOpts = {
      density: density,
      friction: o.friction === undefined ? 0.4 : o.friction,
      restitution: o.restitution === undefined ? 0.1 : o.restitution
    };

    var made = 0, rejected = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var vs = [];
      // Reverse while converting. Flipping y mirrors the plane, which reverses winding; parts
      // arrive positively wound and planck wants counter-clockwise. planck's Polygon would rebuild
      // the hull and hide this, but then a genuinely broken part would be silently "fixed" too.
      for (var k = p.length - 2; k >= 0; k -= 2) {
        vs.push(new pl.Vec2((p[k] - c.x) / W.scale, -(p[k + 1] - c.y) / W.scale));
      }
      if (vs.length < 3) { rejected.push(i); continue; }
      try {
        body.createFixture(new pl.Polygon(vs), fixtureOpts);
        made++;
      } catch (e) {
        rejected.push(i);
      }
    }

    if (!made) {
      W.world.destroyBody(body);
      return null;
    }

    var rec = {
      body: body,
      // The original centroid in src units. Playback rotates about this point.
      ox: c.x,
      oy: c.y,
      angle0: 0,
      area: c.area,
      radius: radius,
      simRadius: simRadius,
      bullet: bullet,
      density: density,
      fixtures: made,
      rejected: rejected,
      name: o.name || '',
      node: o.node || null
    };
    W.dynamics.push(rec);
    return rec;
  }

  /**
   * Where a body has moved to, in SRC units, plus how far it has turned.
   *
   * Because the vertices were offset by -centroid, the body position IS the centroid, so this is
   * everything the Affinity layer needs to build its Transform. The angle is negated for the same
   * reason the y axis is: a mirrored plane reverses the sense of rotation.
   */
  function bodyState(W, rec) {
    var p = rec.body.getPosition();
    var s = GR.toSrc(W, p.x, p.y);
    return { x: s.x, y: s.y, angle: -rec.body.getAngle() };
  }

  GR.ringCentroid = ringCentroid;
  GR.partsCentroid = partsCentroid;
  GR.boundingRadius = boundingRadius;
  GR.addBody = addBody;
  GR.bodyState = bodyState;
  GR.BULLET_RADIUS = BULLET_RADIUS;

})(GR);
