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
};
