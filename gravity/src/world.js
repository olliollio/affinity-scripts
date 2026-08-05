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

(function (GR) {
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
    if (!GR.planck) throw new Error('world: planck is not loaded');
    var pl = GR.planck;

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
   * bodies catching on the internal seams between segments. physicsdrop worked around exactly that with a
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
  // How far the walls stand off the artwork. A body overlapping a wall at frame 0 keeps its island
  // awake for the whole run, so the box never touches the artwork.
  var MARGIN = 40;

  // No axis of the box may be smaller than this fraction of the artwork's larger dimension.
  //
  // A fixed margin is fine until the artwork is FLAT. A horizontal rope, a rule, a baseline: the
  // bounding box has zero height, so the box is 2*MARGIN tall and the rope lands on its own floor
  // after 40pt. Measured on a 1640pt pinned rope, the sag was clipped to 33.5pt where the rope's
  // natural sag is 105.7pt — it looked like the anchoring had failed when the ends were in fact
  // held exactly right and the world was 80pt tall.
  //
  // 0.15 is chosen to fix that while leaving real scenes alone. It gives the 1640pt rope 246pt of
  // headroom, which the measurements show is enough to reach the full 105.7pt sag, and it is below
  // the aspect ratio of any scene that already works: artwork 1830x778 needs 274 and has 778, so
  // the box is untouched. Raising it further would start moving scenes that are behaving.
  var MIN_SPAN_FRAC = 0.15;

  /**
   * The wall rectangle for a piece of artwork, from the artwork's own bounding box.
   *
   * Pure, and separated from `addBounds` precisely so this can be tested: it used to live inline in
   * `main.js`, which touches the Affinity API and so is never exercised headlessly. The degenerate
   * case it exists to handle could not have been caught there.
   */
  function boundsForArtwork(box, opts) {
    var o = opts || {};
    var margin = o.margin === undefined ? MARGIN : o.margin;
    var frac = o.minSpanFrac === undefined ? MIN_SPAN_FRAC : o.minSpanFrac;

    var w = box.x1 - box.x0, h = box.y1 - box.y0;
    var minSpan = frac * Math.max(w, h);

    // Grow about the centre, so the artwork keeps its place in the box and the physics stays
    // translation-invariant — the property that makes the result independent of the artboard.
    var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    if (w < minSpan) w = minSpan;
    if (h < minSpan) h = minSpan;

    return {
      x: cx - w / 2 - margin,
      y: cy - h / 2 - margin,
      width: w + 2 * margin,
      height: h + 2 * margin
    };
  }

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

  GR.makeWorld = makeWorld;
  GR.suggestScale = suggestScale;
  GR.toSim = toSim;
  GR.toSrc = toSrc;
  GR.addStaticChain = addStaticChain;
  GR.addBounds = addBounds;
  GR.boundsForArtwork = boundsForArtwork;
  GR.BOUNDS_MARGIN = MARGIN;
  GR.BOUNDS_MIN_SPAN_FRAC = MIN_SPAN_FRAC;
  GR.checkScale = checkScale;
  GR.WORLD_SCALE = DEFAULT_SCALE;

})(GR);
