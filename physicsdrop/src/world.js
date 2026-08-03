/**
 * world.js — the planck world, its scale, and all static geometry.
 *
 * Box2D's solver is tuned for bodies roughly 0.1-10 units across. Affinity artwork is measured in
 * points and a dropped letter is commonly 500 of them, which is far outside that band: contacts
 * resolve badly, bodies jitter, stacks sink. Everything therefore lives in SIM units internally
 * and is converted at the boundary. The scale divide is not a nicety, it is the difference
 * between a simulation and mush.
 *
 * Source units (Affinity points) are called "src"; planck units are called "sim".
 */

(function (PD) {
  'use strict';

  // 100 src units per sim unit puts a 500pt letter at 5 sim units, mid-band.
  var DEFAULT_SCALE = 100;

  // Bodies outside this band are the ones Box2D handles badly. Reported, not corrected: the right
  // fix is the scale factor, and silently rescaling one body would break its contacts with others.
  var GOOD_MIN = 0.1;
  var GOOD_MAX = 10;

  // Affinity's y axis points down, planck's points up. Flipping y at the boundary keeps every
  // matrix in the Affinity layer untouched and confines the disagreement to two functions.
  function makeWorld(opts) {
    var o = opts || {};
    if (!PD.planck) throw new Error('world: planck is not loaded');
    var pl = PD.planck;

    var scale = o.scale || DEFAULT_SCALE;
    var gx = o.gravityX === undefined ? 0 : o.gravityX;
    var gy = o.gravityY === undefined ? -10 : o.gravityY;

    var world = new pl.World({ gravity: new pl.Vec2(gx, gy) });
    // Sleeping is what ends the simulation; without it every settle test is a heuristic.
    world.setAllowSleeping(o.allowSleeping === false ? false : true);

    return {
      planck: pl,
      world: world,
      scale: scale,
      statics: [],
      dynamics: [],
      warnings: []
    };
  }

  /** src point -> sim point. */
  function toSim(W, x, y) {
    return new W.planck.Vec2(x / W.scale, -y / W.scale);
  }

  /** sim point -> src point. Returns a plain object; the Affinity layer wants numbers, not Vec2. */
  function toSrc(W, x, y) {
    return { x: x * W.scale, y: -y * W.scale };
  }

  /**
   * Static geometry as a planck Chain rather than loose Edges.
   *
   * A chain carries ghost vertices, so the solver knows which neighbour each segment has and stops
   * bodies catching on the internal seams between segments. v1.1 worked around exactly that with a
   * `segSide` hack; the chain removes the need for it.
   */
  function addStaticChain(W, ring, opts) {
    var o = opts || {};
    if (!ring || ring.length < 4) return null;

    var pts = [];
    for (var i = 0; i < ring.length; i += 2) pts.push(toSim(W, ring[i], ring[i + 1]));

    var body = W.world.createBody();
    var closed = o.closed === undefined ? true : o.closed;
    // A closed chain wants its first vertex only once; planck joins the loop itself.
    var shape = new W.planck.Chain(pts, closed);
    body.createFixture(shape, {
      friction: o.friction === undefined ? 0.4 : o.friction,
      restitution: o.restitution === undefined ? 0 : o.restitution
    });

    var rec = { body: body, ring: ring, name: o.name || '' };
    W.statics.push(rec);
    return rec;
  }

  /**
   * Four walls around a rectangle in src units, as one open chain per side would leave corner
   * seams — a single closed chain has no seams at all.
   */
  function addBounds(W, rect, opts) {
    var o = opts || {};
    var x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.width, y1 = rect.y + rect.height;
    var ring = [x0, y0, x1, y0, x1, y1, x0, y1];
    var rec = addStaticChain(W, ring, {
      closed: true,
      friction: o.friction === undefined ? 0.4 : o.friction,
      restitution: o.restitution === undefined ? 0 : o.restitution,
      name: o.name || 'bounds'
    });
    if (rec) rec.isBounds = true;
    return rec;
  }

  /**
   * Is the artwork sized so the solver can do its job? Answered after the bodies exist, because it
   * is a property of the whole scene, not of the scale constant alone.
   */
  function checkScale(W) {
    var sizes = [];
    for (var i = 0; i < W.dynamics.length; i++) {
      var d = W.dynamics[i];
      if (d.simRadius) sizes.push(d.simRadius * 2);
    }
    if (!sizes.length) return { ok: true, note: 'no dynamic bodies' };

    sizes.sort(function (a, b) { return a - b; });
    var median = sizes[sizes.length >> 1];
    var ok = median >= GOOD_MIN && median <= GOOD_MAX;
    var note = 'median body size ' + median.toFixed(3) + ' sim units' +
      (ok ? ' (good)' : ' — outside ' + GOOD_MIN + '-' + GOOD_MAX + ', adjust scale (currently ' + W.scale + ')');
    if (!ok) W.warnings.push(note);
    return { ok: ok, median: median, note: note, smallest: sizes[0], largest: sizes[sizes.length - 1] };
  }

  /**
   * A world scale that puts typical artwork in the band Box2D solves well.
   *
   * A fixed scale cannot serve both a 500pt letter and a 12pt one. The solver's `linearSlop` is
   * 0.005 SIM units, so at a fixed scale of 100 a 12pt glyph's stem is barely three times the
   * tolerance the contact solver works to, and it skitters. Measured: 12pt type at scale 100
   * drifts about twice as far sideways as 300pt type does; matching the scale to the artwork makes
   * the two behave identically.
   *
   * `sizes` are body extents in SOURCE units. The median is used rather than the mean so one large
   * background object cannot drag the whole scene out of band.
   */
  function suggestScale(sizes, target) {
    if (!sizes || !sizes.length) return DEFAULT_SCALE;
    var t = target || 3;
    var s = sizes.slice().sort(function (a, b) { return a - b; });
    var median = s[s.length >> 1];
    if (!(median > 0)) return DEFAULT_SCALE;
    // Clamped so degenerate artwork cannot produce an absurd world.
    return Math.min(10000, Math.max(0.01, median / t));
  }

  PD.makeWorld = makeWorld;
  PD.suggestScale = suggestScale;
  PD.toSim = toSim;
  PD.toSrc = toSrc;
  PD.addStaticChain = addStaticChain;
  PD.addBounds = addBounds;
  PD.checkScale = checkScale;
  PD.WORLD_SCALE = DEFAULT_SCALE;

})(PD);
