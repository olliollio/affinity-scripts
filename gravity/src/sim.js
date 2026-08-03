/**
 * sim.js — stepping, settling and frame recording.
 *
 * The simulation is RECORDED, not played live: it runs to completion and stores a pose per body
 * per frame. Timer jitter in the Affinity layer then affects playback speed only, never the
 * result, and scrubbing backwards is free.
 *
 * Settling is the part that shrinks most against physicsdrop, which needed stillFrames / flatSupport /
 * stuckFrames / slowFrames / touchedSleeper and a pile of hard stops — roughly a hundred lines of
 * heuristics, plus a visible pop when a body was teleported to its sleep pose. planck has real
 * island sleeping, so the whole question becomes "is every body asleep".
 */

(function (GR) {
  'use strict';

  // Box2D defaults. 1/60 is the timestep the constraint tuning assumes; drifting from it changes
  // how bouncy and how stiff everything feels.
  var DT = 1 / 60;
  var VELOCITY_ITERS = 8;
  var POSITION_ITERS = 3;

  // Two sim steps per recorded frame gives 30fps output from 60Hz physics.
  var STEPS_PER_FRAME = 2;
  var MAX_FRAMES = 900; // 30 seconds at 30fps

  // Frames every body must stay below the sleep thresholds before we call it settled ourselves.
  // One second at 30fps, twice planck's own 0.5s timeToSleep.
  var QUIET_FRAMES = 30;

  // A contact deeper than this many multiples of linearSlop counts as a real overlap rather than
  // the ordinary slop the solver maintains on every resting contact.
  var OVERLAP_SLOP_FACTOR = 4;

  /**
   * Deterministic PRNG so a good drop can be reproduced.
   *
   * physicsdrop seeded its initial jitter from Date.now(), which meant a result the user liked was gone
   * the moment they re-ran it. mulberry32 is small, fast and has no state beyond one integer.
   */
  function rng(seed) {
    var a = (seed | 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Nudges bodies so a symmetric arrangement does not balance forever.
   *
   * Perfectly stacked artwork is common — duplicated letters, aligned rows — and a symmetric pile
   * can stand indefinitely in an exact solver. The jitter is angular and tiny; it breaks ties
   * without being visible.
   */
  function seedJitter(W, seed, amount) {
    var r = rng(seed);
    var amt = amount === undefined ? 0.01 : amount;
    if (!amt) return;
    for (var i = 0; i < W.dynamics.length; i++) {
      var b = W.dynamics[i].body;
      b.setAngularVelocity((r() - 0.5) * 2 * amt);
      b.setLinearVelocity(new W.planck.Vec2((r() - 0.5) * 2 * amt, 0));
    }
  }

  /** Is every body below the velocity thresholds planck uses to decide a body could sleep? */
  function allQuiet(W) {
    var S = W.planck.Settings;
    var linSqr = S.linearSleepTolerance * S.linearSleepTolerance;
    var angTol = S.angularSleepTolerance;
    for (var i = 0; i < W.dynamics.length; i++) {
      var b = W.dynamics[i].body;
      var v = b.getLinearVelocity();
      if (v.x * v.x + v.y * v.y > linSqr) return false;
      if (Math.abs(b.getAngularVelocity()) > angTol) return false;
    }
    return true;
  }

  /**
   * Dynamic bodies that are deeply overlapping STATIC geometry.
   *
   * This is the one case where the simulation cannot end on its own. planck only lets an island
   * sleep when the position solver has converged as well as the velocities having died down
   * (`minSleepTime >= timeToSleep && positionSolved`), and a body embedded in a wall never
   * converges: the wall cannot move aside, and per-step position correction is capped. The body
   * then sits at exactly zero velocity, awake, forever.
   *
   * It happens whenever artwork is dropped already overlapping its container, which is ordinary
   * user behaviour rather than an edge case, so it is reported rather than left to the frame cap.
   */
  function findStaticOverlaps(W) {
    var out = [];
    var limit = -OVERLAP_SLOP_FACTOR * W.planck.Settings.linearSlop;
    for (var c = W.world.getContactList(); c; c = c.getNext()) {
      if (!c.isTouching()) continue;
      var bA = c.getFixtureA().getBody();
      var bB = c.getFixtureB().getBody();
      var aStatic = bA.isStatic(), bStatic = bB.isStatic();
      if (aStatic === bStatic) continue; // want exactly one static side
      var wm = c.getWorldManifold(null);
      if (!wm || !wm.separations) continue;
      var deepest = 0;
      for (var p = 0; p < wm.separations.length; p++) {
        if (wm.separations[p] < deepest) deepest = wm.separations[p];
      }
      if (deepest >= limit) continue;
      var dyn = aStatic ? bB : bA;
      for (var i = 0; i < W.dynamics.length; i++) {
        if (W.dynamics[i].body === dyn) { out.push({ index: i, rec: W.dynamics[i], depth: deepest }); break; }
      }
    }
    return out;
  }

  /**
   * Runs to settle and records every frame.
   *
   * Recording is one flat Float64Array of [x, y, angle] per body per frame: 50 bodies over 300
   * frames is 45k floats, which is nothing, and a flat typed array keeps the playback scrubber a
   * pair of index multiplications rather than an object graph walk.
   */
  function run(W, opts) {
    var o = opts || {};
    var maxFrames = o.maxFrames === undefined ? MAX_FRAMES : o.maxFrames;
    var stepsPerFrame = o.stepsPerFrame === undefined ? STEPS_PER_FRAME : o.stepsPerFrame;
    var dt = o.dt === undefined ? DT : o.dt;
    var vIters = o.velocityIterations === undefined ? VELOCITY_ITERS : o.velocityIterations;
    var pIters = o.positionIterations === undefined ? POSITION_ITERS : o.positionIterations;

    var bodies = W.dynamics;
    var n = bodies.length;

    if (o.seed !== undefined) seedJitter(W, o.seed, o.jitter);

    var quietFrames = o.quietFrames === undefined ? QUIET_FRAMES : o.quietFrames;

    var frames = new Float64Array(maxFrames * n * 3);
    var frame = 0;
    var settledAt = -1;
    var settledBy = 'cap';
    var quiet = 0;
    var overlaps = null;

    while (frame < maxFrames) {
      for (var s = 0; s < stepsPerFrame; s++) W.world.step(dt, vIters, pIters);

      var base = frame * n * 3;
      for (var i = 0; i < n; i++) {
        var st = GR.bodyState(W, bodies[i]);
        frames[base + i * 3] = st.x;
        frames[base + i * 3 + 1] = st.y;
        frames[base + i * 3 + 2] = st.angle;
      }
      frame++;

      // Contacts only exist once the broadphase has run, so the first step is the earliest point
      // at which a body embedded in a wall can be spotted.
      if (frame === 1) overlaps = findStaticOverlaps(W);

      // Everything asleep means the solver itself has decided nothing is moving. No thresholds of
      // ours, and no teleport: the recorded pose is the pose the body already had.
      var awake = false;
      for (var k = 0; k < n; k++) {
        if (bodies[k].body.isAwake()) { awake = true; break; }
      }
      if (!awake) { settledAt = frame; settledBy = 'sleep'; break; }

      // Backstop for the embedded-body case above, where sleeping can never happen however long
      // we wait. This is the only heuristic in the settle path, and it is a fallback rather than
      // the primary rule: when planck can sleep, it decides.
      quiet = allQuiet(W) ? quiet + 1 : 0;
      if (quietFrames && quiet >= quietFrames) { settledAt = frame; settledBy = 'quiescence'; break; }
    }

    return {
      frames: frames.subarray(0, frame * n * 3),
      frameCount: frame,
      bodyCount: n,
      settled: settledAt >= 0,
      settledAt: settledAt,
      settledBy: settledBy,
      hitFrameCap: settledAt < 0,
      staticOverlaps: overlaps || []
    };
  }

  /** Pose of one body on one frame, straight out of the flat recording. */
  function poseAt(rec, frame, bodyIndex) {
    var i = (frame * rec.bodyCount + bodyIndex) * 3;
    return { x: rec.frames[i], y: rec.frames[i + 1], angle: rec.frames[i + 2] };
  }

  GR.rng = rng;
  GR.seedJitter = seedJitter;
  GR.allQuiet = allQuiet;
  GR.findStaticOverlaps = findStaticOverlaps;
  GR.run = run;
  GR.poseAt = poseAt;
  GR.SIM_DEFAULTS = {
    dt: DT,
    velocityIterations: VELOCITY_ITERS,
    positionIterations: POSITION_ITERS,
    stepsPerFrame: STEPS_PER_FRAME,
    maxFrames: MAX_FRAMES,
    quietFrames: QUIET_FRAMES
  };

})(GR);
