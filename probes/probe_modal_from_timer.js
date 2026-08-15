/**
 * probe_modal_from_timer.js
 *
 * Gravity's Finished panel never appears. The cause is confirmed: `Dialog.runModal()` raised from
 * inside the playback interval callback throws `Error: ABORTED` (errorCode 6), and `play()`'s catch
 * swallows it.
 *
 *   Error: ABORTED
 *     at Dialog.runModal (JSLib/dialog.js:1209:26)
 *     at Object.showScrubber (main:3296:36)
 *     at finish (main:3222:27)
 *     at intervalCallback (JSLib/timers.js:128:2)
 *
 * What is NOT yet known is which of two rules is being broken, and the fix differs:
 *
 *   H1  Cancelling the timer poisons the modal. `intervalCallback` re-arms the timer BEFORE calling
 *       our callback (timers.js:125-126); `finish()` then cancels that fresh wait and only then
 *       opens the modal, so the pending cancellation lands inside the modal's nested loop.
 *       -> fix is small: cancel after the modal, or defer the modal by one tick.
 *
 *   H2  No modal may open from a timer callback at all.
 *       -> fix is structural: playback and the panel cannot be sequenced this way.
 *
 * Four cases, cheapest and safest first, the gravity shape last so the earlier ones still run if
 * the session gets poisoned. Case "timeout" is the important one: if a modal opens fine from a
 * setTimeout callback, H1 holds and the repair is a one-liner.
 *
 * The failure being tested is a modal that BLOCKS, not one that throws: gravity's scrubber only
 * reported ABORTED when Affinity shut down, which means the call was still sitting there. So a
 * failing case never returns, and the run simply stops at that case. That is a result, not a
 * washout — the last alert you saw names the last case that completed.
 *
 * WHAT YOU WILL SEE: for each case, a small dialog (click OK), then an alert listing results so
 * far (click OK). When a case's dialog never appears and Affinity goes unresponsive, stop: close
 * Affinity and screenshot every alert, including any that appear during shutdown.
 */

(function () {
  'use strict';

  var app = require('/application').app;
  var timers = require('/timers');
  var D = require('/dialog');

  var results = [];

  function note(s) {
    results.push(s);
    try { console.log('probe: ' + s); } catch (e) { /* no console */ }
  }

  /** Opens the smallest possible modal and records what happened. Never throws. */
  function tryModal(tag) {
    try {
      var dlg = D.Dialog.create('Probe: ' + tag);
      dlg.addColumn().addGroup('Modal test')
        .addStaticText('', tag + ' — press OK').setIsFullWidth(true);
      var r = dlg.runModal();
      note(tag + ': OK, result.value = ' + (r && r.value));
    } catch (e) {
      var line = tag + ': THREW ' + e;
      try { line += '  errorCode.value=' + (e && e.errorCode && e.errorCode.value); } catch (x) { /* none */ }
      note(line);
    }
  }

  function report() {
    var msg = 'PROBE modal-from-timer\n\n' + results.join('\n');
    try { console.log(msg); } catch (e) { /* no console */ }
    try { app.alert(msg); } catch (e) { /* alert gone too */ }
  }

  // ---- the cases ---------------------------------------------------------
  // Each takes a `done` continuation so they run strictly one after another; a case that dies
  // still calls done(), so the report always happens.

  function caseBody(done) {
    // Control. This is how every working Affinity dialog is opened.
    tryModal('1 script body');
    done();
  }

  function caseTimeout(done) {
    // A one-shot timer callback. No cancel is involved: setTimeout does not re-arm.
    timers.setTimeout(50, function (err) {
      if (err) { note('2 setTimeout: callback got err ' + err + ', modal not attempted'); done(); return; }
      tryModal('2 setTimeout callback');
      done();
    });
  }

  function caseIntervalNoCancel(done) {
    // An interval callback, modal FIRST and cancel afterwards. Isolates "is it the callback?"
    // from "is it the cancel?".
    var fired = false;
    var t = timers.setInterval(200, function (err) {
      if (err) return;             // the cancel below reports ABORTED here; ignore it
      if (fired) return;           // the interval keeps firing while a modal is open
      fired = true;
      tryModal('3 interval callback, cancel AFTER');
      try { t.cancel(); } catch (e) { /* already gone */ }
      done();
    });
  }

  function caseIntervalCancelFirst(done) {
    // Exactly gravity's shape: cancel the interval, then open the modal, still inside the callback.
    // Expected to throw ABORTED. Runs last because it is the one that poisons the session.
    var fired = false;
    var t = timers.setInterval(200, function (err) {
      if (err) return;
      if (fired) return;
      fired = true;
      try { t.cancel(); } catch (e) { /* already gone */ }
      tryModal('4 interval callback, cancel BEFORE (gravity shape)');
      done();
    });
  }

  var chain = [caseBody, caseTimeout, caseIntervalNoCancel, caseIntervalCancelFirst];

  function next(i) {
    if (i >= chain.length) { report(); return; }
    var advanced = false;
    chain[i](function () {
      if (advanced) return;
      advanced = true;
      // Report after EVERY case, not only at the end. The failure mode being tested is a modal that
      // blocks rather than throws, and a blocked case never returns — so a single report at the end
      // would never run. An alert raised before the block displays normally.
      report();
      next(i + 1);
    });
  }

  next(0);
})();
