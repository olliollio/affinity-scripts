/**
 * Playback handoff tests: how `play()` finishes.
 *
 * These guard a bug that made the script unusable on any scene big enough to matter, and that took
 * five probes to corner because it had no error message at all.
 *
 * `play()` used to call `onDone()` directly from inside its interval callback. `onDone` opens the
 * Finished panel, and a modal opened from inside that callback never appears: `runModal` does not
 * return, and reports ABORTED (errorCode 6) only when Affinity shuts down. The document is then
 * holding a modal it never drew — the Script panel stops responding, and every later `runModal`
 * fails with INVALID_OP until Affinity is restarted.
 *
 * The timer shape itself is legal; a modal from a trivial interval callback opens fine
 * (probes/probe_modal_from_timer.js). What breaks it is the callback's own work.
 * `intervalCallback` re-arms the timer BEFORE invoking the callback (JSLib/timers.js:125-126), so
 * once a preview costs more than the interval the waits pile up and the modal is raised into that
 * backlog. Preview cost scales with the artwork, which is why only heavy scenes ever showed it.
 *
 * What made it expensive was the silence, and that is worth its own assertion. `finish()` was
 * called from INSIDE the callback's try, so when `onDone` threw, the catch called `finish()` again,
 * hit the `stopped` guard and returned — the exception vanished. The one symptom that would have
 * named this on day one was the one thing the code made impossible.
 *
 * So: assert that onDone is deferred, and assert that a throwing onDone is reported rather than
 * swallowed. Neither can be checked from the canvas, and both are one-line regressions.
 */

'use strict';

module.exports = function (GR, h) {

  // ------------------------------------------------------------------ fakes
  //
  // play() reaches the host through require('/timers') and, on the failure path, require(
  // '/application'). Under vm.runInThisContext those resolve to globalThis.require, so a stub
  // there is the whole harness needed — no Affinity, no real clock.

  /**
   * A controllable stand-in for /timers. Nothing fires on its own; the test decides when.
   *
   * `intervals` and `timeouts` are kept apart because the distinction is the entire point of the
   * fix: the finish must move off the interval and onto a fresh timeout.
   */
  function makeTimers() {
    var t = { intervals: [], timeouts: [] };
    t.setInterval = function (ms, cb) {
      var entry = { ms: ms, cb: cb, cancelled: false };
      entry.cancel = function () { entry.cancelled = true; };
      t.intervals.push(entry);
      return entry;
    };
    t.setTimeout = function (ms, cb) {
      var entry = { ms: ms, cb: cb, cancelled: false };
      entry.cancel = function () { entry.cancelled = true; };
      t.timeouts.push(entry);
      return entry;
    };
    t.Timer = { cancelAll: function () { /* play() prefers the handle when it has one */ } };
    return t;
  }

  /** A playback context with one frame and no bodies, so preview() has nothing to do. */
  function makeCtx() {
    return {
      doc: { executeCommand: function () { /* commandForFrame returns null with no bodies */ },
             clearPreviews: function () { /* nothing previewed */ } },
      sdk: null,
      bodies: [],
      frames: { frameCount: 1 },
      ropesByNode: [],
      lastIndex: 0
    };
  }

  /** Runs `fn` with require('/timers') and require('/application') stubbed. Always restores. */
  function withHost(timers, alerts, fn) {
    var saved = globalThis.require;
    globalThis.require = function (id) {
      if (id === '/timers') return timers;
      if (id === '/application') return { app: { alert: function (m) { alerts.push(m); } } };
      throw new Error('unexpected require: ' + id);
    };
    try { return fn(); } finally { globalThis.require = saved; }
  }

  // ------------------------------------------------------------------ the handoff

  h.group('playback: the finish is handed off, not called inline');

  var timers = makeTimers();
  var calls = [];
  var alerts = [];

  withHost(timers, alerts, function () {
    GR.playbackPlay(makeCtx(), { intervalMs: 8 }, function () { calls.push('onDone'); });
  });

  h.assertEqual('play arms exactly one interval', timers.intervals.length, 1);
  h.assertEqual('and no timeout before the interval has fired', timers.timeouts.length, 0);

  // One tick is enough: the context has a single frame, so this both previews and finishes.
  withHost(timers, alerts, function () { timers.intervals[0].cb(null); });

  h.assertEqual('the interval is cancelled when playback ends', timers.intervals[0].cancelled, true);
  // The assertion the bug would have failed. onDone used to run right here, still inside the
  // callback, which is the state in which a modal never appears.
  h.assertEqual('onDone is NOT called from inside the interval callback', calls.length, 0);
  h.assertEqual('it is deferred onto a fresh timeout instead', timers.timeouts.length, 1);

  // The delay is asserted as a property, not a value: what matters is that the callback gets a
  // chance to return and the backlog to drain, not that the number is exactly 300.
  h.assert('with a delay long enough to leave the callback',
    timers.timeouts[0].ms >= 100, String(timers.timeouts[0].ms));

  withHost(timers, alerts, function () { timers.timeouts[0].cb(null); });
  h.assertEqual('and firing that timeout is what runs onDone', calls.join(','), 'onDone');

  // ------------------------------------------------------------------ cancellation

  h.group('playback: a cancelled handoff does not finish');

  var t2 = makeTimers();
  var calls2 = [];
  withHost(t2, alerts, function () {
    GR.playbackPlay(makeCtx(), { intervalMs: 8 }, function () { calls2.push('onDone'); });
    t2.intervals[0].cb(null);
    // Affinity reports a cancelled wait as an error through the same callback. Treating that as a
    // reason to finish would open the panel after the user had already moved on.
    t2.timeouts[0].cb('ABORTED');
  });
  h.assertEqual('an aborted handoff timer leaves onDone alone', calls2.length, 0);

  // ------------------------------------------------------------------ the silence

  h.group('playback: a failing finish is reported, not swallowed');

  var t3 = makeTimers();
  var alerts3 = [];
  withHost(t3, alerts3, function () {
    GR.playbackPlay(makeCtx(), { intervalMs: 8 }, function () { throw new Error('ABORTED'); });
    t3.intervals[0].cb(null);
    t3.timeouts[0].cb(null);
  });

  h.assertEqual('a throwing onDone produces exactly one alert', alerts3.length, 1);
  h.assert('which names the panel and carries the error',
    /Finished panel/.test(alerts3[0]) && /ABORTED/.test(alerts3[0]), alerts3[0]);

  // Swallowing was the expensive part, so this is stated as its own assertion rather than left
  // implied by the one above.
  h.assert('so the failure cannot be silent', alerts3.length > 0);

  // ------------------------------------------------------------------ softbodies
  //
  // A softbody DEFORMS, so it cannot be drawn by transforming its node the way a rigid body is:
  // every outline point moves on its own. Its geometry is rewritten every frame with
  // createSetCurves, exactly as a rope's is.
  //
  // What is checkable headlessly is OUR side of that: which bodies get a selection, how softbodies
  // are grouped by node, which pose each mesh node reads, and the exact sequence of builder calls
  // one frame produces. What Affinity DRAWS from those calls is not checkable here at all — the
  // fake below records arguments, it does not render. So "closed" and "in base space" below mean
  // closed and in base space IN THE ARGUMENTS HANDED TO THE SDK, which is as far as a headless
  // test can go; only a live document can say the fill is right.

  /** A stand-in for /geometry, /commands and /selections that records what playback asks of it. */
  function makeSdk() {
    var rec = { setCurves: [], transforms: [], selections: [], failOn: null };
    rec.host = {
      '/geometry': {
        Transform: {
          createTranslate: function (x, y) { return { x: x, y: y, multiply: function () { return this; } }; },
          createRotate: function (a) { return { angle: a, around: function () { return this; } }; }
        },
        PolyCurve: {
          create: function () {
            var p = { curves: [] };
            p.addCurve = function (c) { p.curves.push(c); };
            return p;
          }
        },
        CurveBuilder: {
          create: function () {
            var cb = { pts: [], closes: 0, created: 0 };
            cb.beginXY = function (x, y) { cb.pts.push(x, y); };
            cb.lineToXY = function (x, y) { cb.pts.push(x, y); };
            cb.close = function () { cb.closes++; };
            cb.createCurve = function () { cb.created++; return cb; };
            return cb;
          }
        }
      },
      '/commands': {
        DocumentCommand: {
          createSetCurves: function (ci, poly) {
            if (rec.failOn && ci === rec.failOn) throw new Error('this node will not take curves');
            var c = { ci: ci, poly: poly };
            rec.setCurves.push(c);
            return c;
          },
          createTransform: function (sel, xf) {
            var c = { sel: sel, xf: xf };
            rec.transforms.push(c);
            return c;
          }
        },
        CompoundCommandBuilder: {
          create: function () {
            var cc = { cmds: [] };
            cc.addCommand = function (c) { cc.cmds.push(c); };
            cc.createCommand = function () { return cc; };
            return cc;
          }
        }
      },
      '/selections': {
        Selection: {
          createEmpty: function (doc) {
            var s = { doc: doc, nodes: [] };
            s.addNode = function (n) { s.nodes.push(n); };
            rec.selections.push(s);
            return s;
          }
        }
      }
    };
    return rec;
  }

  /** Runs `fn` with the whole SDK stubbed. Same shape as withHost, one module list wider. */
  function withSdk(sdk, fn) {
    var saved = globalThis.require;
    globalThis.require = function (id) {
      if (sdk.host[id]) return sdk.host[id];
      throw new Error('unexpected require: ' + id);
    };
    try { return fn(); } finally { globalThis.require = saved; }
  }

  /** A curve node carrying a base-to-spread transform, so the trip back to base space is visible. */
  function makeNode(tx, ty) {
    return {
      curvesInterface: { id: 'ci' + tx + ',' + ty },
      baseToSpreadTransform: { data: [1, 0, tx, 0, 1, ty] }
    };
  }

  /**
   * A four-node square lattice with its own outline bound to it, in SPREAD points.
   *
   * The outline points sit exactly on the mesh nodes, so at rest — and under any pure translation —
   * evalSoftOutline must give the square back unchanged. That is what makes an exact coordinate
   * assertion possible at all.
   */
  function makeSoft(node, x0, y0, size) {
    var diag = Math.sqrt(2) * size;
    var mesh = {
      nodes: [x0, y0, x0 + size, y0, x0 + size, y0 + size, x0, y0 + size],
      springs: [[0, 1, size], [1, 2, size], [2, 3, size], [3, 0, size], [0, 2, diag], [1, 3, diag]]
    };
    var ring = mesh.nodes.slice();
    var recs = [];
    for (var i = 0; i < 4; i++) recs.push({ isSoftNode: true, node: node, name: 'jelly[' + i + ']' });
    return { node: node, mesh: mesh, rings: [GR.bindOutline(ring, mesh)], nodes: recs, ring: ring };
  }

  /** A one-frame recording placing every body at `positions` (flat x,y, in body order). */
  function makeFrames(positions) {
    var frames = [];
    for (var i = 0; i < positions.length; i += 2) frames.push(positions[i], positions[i + 1], 0);
    return { frameCount: 1, bodyCount: positions.length / 2, frames: frames };
  }

  /** Largest coordinate error between a built curve and `ring` shifted by (dx, dy). */
  function ringError(curve, ring, dx, dy) {
    if (curve.pts.length !== ring.length) return Infinity;
    var worst = 0;
    for (var i = 0; i < ring.length; i += 2) {
      worst = Math.max(worst,
        Math.abs(curve.pts[i] - (ring[i] + dx)),
        Math.abs(curve.pts[i + 1] - (ring[i + 1] + dy)));
    }
    return worst;
  }

  h.group('playback: a softbody is drawn, not transformed');

  var sdkSel = makeSdk();
  var fakeSoft = [{ isSoftNode: true, node: {}, body: null }];
  withSdk(sdkSel, function () {
    GR.playbackPrepare(null, fakeSoft, { frameCount: 1, bodyCount: 1, frames: [0, 0, 0] }, [], []);
  });
  // The node is redrawn by createSetCurves; transforming it as well would move the shape twice.
  h.assert('a soft node gets no selection', !fakeSoft[0].selection);
  h.assertEqual('so nothing is selected at all', sdkSel.selections.length, 0);

  h.group('playback: softbodies are grouped by node');

  var nodeA = makeNode(50, 20);
  var nodeB = makeNode(0, 0);
  var softA1 = makeSoft(nodeA, 0, 0, 10);
  var softA2 = makeSoft(nodeA, 40, 0, 10);
  var softB = makeSoft(nodeB, 0, 0, 10);
  var softBodies = softA1.nodes.concat(softA2.nodes, softB.nodes);
  var rest = softA1.mesh.nodes.concat(softA2.mesh.nodes, softB.mesh.nodes);
  var restFrames = makeFrames(rest);

  var matrixCalls = 0;
  var realMatrixOf = GR.matrixOf;
  GR.matrixOf = function (n) { matrixCalls++; return realMatrixOf(n); };
  var ctxG = null;
  try {
    withSdk(makeSdk(), function () {
      ctxG = GR.playbackPrepare(null, softBodies, restFrames, [], [softA1, softA2, softB]);
    });
  } finally { GR.matrixOf = realMatrixOf; }

  // createSetCurves replaces EVERY curve on a node, so two jellies sharing a node have to rebuild
  // in one command or the second would erase the first.
  h.assertEqual('two nodes make two entries', ctxG.softsByNode.length, 2);
  h.assertEqual('and the shared node holds both softbodies', ctxG.softsByNode[0].softs.length, 2);
  h.assertEqual('the inverse matrix is taken once per node, not per body', matrixCalls, 2);
  h.assert('and it is the inverse of the node matrix', Math.abs(ctxG.softsByNode[0].toBase[2] + 50) < 1e-12,
    String(ctxG.softsByNode[0].toBase));

  h.group('playback: a rest frame rebuilds the rings in base space');

  var sdkR = makeSdk();
  withSdk(sdkR, function () {
    var c = GR.playbackPrepare(null, softBodies, restFrames, [], [softA1, softA2, softB]);
    GR.playbackCommandForFrame(c, 0);
  });

  h.assertEqual('one createSetCurves per node', sdkR.setCurves.length, 2);
  var polyA = sdkR.setCurves[0].poly;
  h.assertEqual('with one curve per ring on the shared node', polyA.curves.length, 2);
  h.assert('each built by its own CurveBuilder', polyA.curves[0] !== polyA.curves[1]);
  h.assertEqual('every ring is closed with close()', polyA.curves[0].closes, 1);
  // Closing by repeating the first point instead would leave isClosed false — it draws closed but
  // fills wrong, and isClosed is read-only so nothing downstream could repair it. It would show up
  // here as one extra point, which is why the count is asserted exactly.
  h.assertEqual('and carries exactly the ring points, none added', polyA.curves[0].pts.length, softA1.ring.length);
  // Nothing is simplified: a jelly's outline IS the user's own points, and frame 0 has to give the
  // flattened rings back unchanged.
  h.assertClose('frame 0 reproduces the ring, mapped into base space',
    ringError(polyA.curves[0], softA1.ring, -50, -20), 0, 1e-9);
  h.assertClose('and the second ring on that node too',
    ringError(polyA.curves[1], softA2.ring, -50, -20), 0, 1e-9);
  // The worst bug available here is skipping the inverse: it displaces every shape by exactly its
  // own node transform, which is invisible on a freshly drawn node and reads as a PHYSICS fault on
  // any node that has been moved. Stated as its own assertion because it is that expensive.
  h.assert('spread coordinates are not written through unmapped',
    ringError(polyA.curves[0], softA1.ring, 0, 0) > 1);

  h.group('playback: the outline follows its own mesh nodes');

  var moved = rest.slice();
  for (var mi = 0; mi < 8; mi += 2) { moved[mi] += 7; moved[mi + 1] -= 3; }
  var sdkM = makeSdk();
  withSdk(sdkM, function () {
    var c = GR.playbackPrepare(null, softBodies, makeFrames(moved), [], [softA1, softA2, softB]);
    GR.playbackCommandForFrame(c, 0);
  });
  var polyM = sdkM.setCurves[0].poly;
  h.assertClose('a moved lattice carries its ring with it',
    ringError(polyM.curves[0], softA1.ring, 7 - 50, -3 - 20), 0, 1e-9);
  // Poses are addressed by index into the recording, so a body reading the wrong index would drag
  // the neighbouring jelly along with it.
  h.assertClose('and the jelly that did not move stays put',
    ringError(polyM.curves[1], softA2.ring, -50, -20), 0, 1e-9);

  h.group('playback: a softbody that will not rebuild does not stop the frame');

  var sdkF = makeSdk();
  withSdk(sdkF, function () {
    var c = GR.playbackPrepare(null, softBodies, restFrames, [], [softA1, softA2, softB]);
    sdkF.failOn = nodeA.curvesInterface;
    GR.playbackCommandForFrame(c, 0);
  });
  h.assertEqual('the node that threw is skipped', sdkF.setCurves.length, 1);
  h.assert('and the rest of the frame still draws', sdkF.setCurves[0].ci === nodeB.curvesInterface);
};
