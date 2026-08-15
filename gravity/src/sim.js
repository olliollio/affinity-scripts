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

  // One sim step per recorded frame: the recording samples the physics at its own 60Hz rate.
  //
  // This was 2, giving 30fps, on the assumption that the canvas could not show more. Measurement
  // says otherwise - the playback timer delivers 64.6fps while drawing a full 193-point rope (see
  // FRAME_MS in playback.js) - and 30 samples per second is not enough for a rope. A rigid object
  // reads fine at 30fps because the eye tracks one point; a rope is a whole line moving at once,
  // and undersampling it strobes. That strobing is what was reported as "janky", and no amount of
  // smoothing the DRAWN curve could fix it, because the missing information is in time, not space.
  //
  // Costs nothing in physics: the step count for a given span of simulated time is unchanged, only
  // how often a pose is written down. The recording array doubles, which is a few megabytes.
  var STEPS_PER_FRAME = 1;
  var MAX_FRAMES = 1800; // 30 seconds at 60fps

  // The recorded frame rate, derived rather than declared so it cannot drift from the two constants
  // that actually determine it. Everything downstream - the duration control, the scrubber's
  // seconds readout, the export stride - reads this rather than assuming a number.
  var FPS = Math.round(1 / (DT * STEPS_PER_FRAME));

  // Frames every body must stay below the sleep thresholds before we call it settled ourselves.
  // One second of recording, twice planck's own 0.5s timeToSleep.
  var QUIET_FRAMES = FPS;

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
    // One draw per SOFTBODY rather than per node. A lattice given an independent velocity per node
    // is shaken rather than nudged, and a soft structure holds that energy for a long time — the
    // jitter exists to break a symmetry, not to deform anything.
    var groups = {};
    for (var i = 0; i < W.dynamics.length; i++) {
      var rec = W.dynamics[i];
      var key = rec.isSoftNode ? ('soft:' + rec.softGroup) : ('body:' + i);
      if (groups[key] === undefined) {
        groups[key] = { av: (r() - 0.5) * 2 * amt, lv: (r() - 0.5) * 2 * amt };
      }
      rec.body.setAngularVelocity(groups[key].av);
      rec.body.setLinearVelocity(new W.planck.Vec2(groups[key].lv, 0));
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
   * What is still moving, and how much.
   *
   * A run that ends on the frame cap says only that it did not settle, which is the one outcome
   * with no information in it. The distinction that matters is between a scene that is genuinely
   * still creeping and one that is motionless but cannot be certified still: sleeping needs the
   * position solver to converge, and quiescence needs EVERY body under tolerance for a full second
   * with `quiet` resetting to zero on any frame that fails. A handful of bodies twitching at a
   * hundredth of a point per second defeats both while looking perfectly settled.
   *
   * Velocities are reported in SIM units, alongside the tolerance they are measured against, so the
   * caller can convert to points with the world scale and the reader can see how far off it is.
   */
  function restlessness(W) {
    var S = W.planck.Settings;
    var out = {
      awake: 0,
      total: W.dynamics.length,
      maxLinear: 0,
      maxAngular: 0,
      worstName: '',
      linearTolerance: S.linearSleepTolerance,
      angularTolerance: S.angularSleepTolerance,
      overTolerance: 0
    };
    for (var i = 0; i < W.dynamics.length; i++) {
      var rec = W.dynamics[i];
      var b = rec.body;
      if (b.isAwake()) out.awake++;
      var v = b.getLinearVelocity();
      var lin = Math.sqrt(v.x * v.x + v.y * v.y);
      var ang = Math.abs(b.getAngularVelocity());
      if (lin > S.linearSleepTolerance || ang > S.angularSleepTolerance) out.overTolerance++;
      if (lin > out.maxLinear) { out.maxLinear = lin; out.worstName = rec.name || ''; }
      if (ang > out.maxAngular) out.maxAngular = ang;
    }
    return out;
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
      staticOverlaps: overlaps || [],
      // Measured at the last recorded frame either way. On a settled run it confirms the scene
      // really is still; on a capped one it is the whole diagnosis.
      restless: restlessness(W),
      // How close quiescence came. `quiet` counts consecutive frames under tolerance and resets to
      // zero on any frame that fails, so a capped run ending with a small number here means
      // something interrupted it recently rather than the scene never having been quiet at all.
      quietRun: quiet,
      quietNeeded: quietFrames
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
  GR.FPS = FPS;
  GR.SIM_DEFAULTS = {
    dt: DT,
    velocityIterations: VELOCITY_ITERS,
    positionIterations: POSITION_ITERS,
    stepsPerFrame: STEPS_PER_FRAME,
    maxFrames: MAX_FRAMES,
    quietFrames: QUIET_FRAMES
  };

})(GR);
