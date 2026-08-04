/**
 * Timing tests: the recorded frame rate, the playback interval, and the export stride.
 *
 * These guard a bug that cost a whole cycle to find and one character to fix, and which no
 * assertion anywhere else could have caught, because nothing was WRONG — the simulation was
 * correct, the drawing was correct, and the rope still looked steppy.
 *
 * Affinity's timer does not honour the interval asked of it. It rounds the request UP to the next
 * whole multiple of a ~15.4ms quantum, the host scheduler tick at 64.9Hz. Measured with an empty
 * callback over 40 ticks (probes/probe_timer_floor.js):
 *
 *     asked   1ms -> 15.3ms    asked  16ms -> 30.5ms    asked  50ms ->  61.6ms
 *     asked   8ms -> 15.5ms    asked  33ms -> 46.2ms    asked 100ms -> 107.8ms
 *
 * Playback asked for 33ms — one millisecond past two quanta — and so got three, running at 21.6fps
 * while its comment claimed 30. The failure mode is what makes a test worth having: the number
 * looks reasonable, the code reads correctly, and the cost is invisible without measurement.
 *
 * 16 is the dangerous value. It is the number anyone would write for 60fps, it is only 0.6ms over
 * the quantum, and it halves the frame rate. So the assertion below is deliberately not
 * `FRAME_MS === 8` — pinning the exact value would only say someone changed it. It asserts the
 * property that actually matters: whatever the value is, it must still fall inside ONE quantum.
 */

'use strict';

// The measured quantum. Not a tunable — it is a property of the host, recorded here so the
// assertions can state their reasoning rather than a magic comparison.
var QUANTUM_MS = 15.4;

module.exports = function (GR, h) {

  h.group('timing: the recorded frame rate');

  h.assertEqual('the recording is 60fps', GR.FPS, 60);
  h.assertEqual('which is dt and steps-per-frame agreeing',
    Math.round(1 / (GR.SIM_DEFAULTS.dt * GR.SIM_DEFAULTS.stepsPerFrame)), GR.FPS);

  // A rope is a whole line moving at once, so it needs a sample per physics step. Two steps per
  // frame halves that and strobes, which is the original "janky" report.
  h.assertEqual('one physics step per recorded frame', GR.SIM_DEFAULTS.stepsPerFrame, 1);

  // These three are all durations expressed as frame counts, so all three move together with FPS.
  // They were 900 and 30 when the recording was 30fps; leaving either behind would silently halve
  // the maximum duration or the settle window.
  h.assertEqual('the frame cap is still 30 seconds', GR.SIM_DEFAULTS.maxFrames / GR.FPS, 30);
  h.assertEqual('and the quiet window is still one second', GR.SIM_DEFAULTS.quietFrames / GR.FPS, 1);

  h.group('timing: the playback interval must fit inside one quantum');

  var ms = GR.PLAYBACK_FRAME_MS;
  h.assert('there is a playback interval', typeof ms === 'number' && ms > 0, String(ms));

  // THE assertion. Anything above 15.4 rounds up to two quanta and halves the frame rate.
  h.assertEqual('the request rounds up to exactly one quantum', Math.ceil(ms / QUANTUM_MS), 1);

  // Stated separately from the rule above so a failure says which mistake was made. 16 and 33 are
  // the two values that look right and are not.
  h.assert('so it is not 16, which looks like 60fps and delivers 32', ms !== 16);
  h.assert('and not 33, which looks like 30fps and delivers 21.6', ms !== 33);

  // Sitting mid-quantum rather than at its edge: 15 would satisfy every assertion above and still
  // be one rounding error from doubling.
  h.assert('and it has headroom rather than sitting on the boundary', ms <= QUANTUM_MS * 0.75,
    ms + 'ms of a ' + QUANTUM_MS + 'ms quantum');

  h.group('timing: export stride');

  var plan = GR.exportStridePlan;

  // The default. Export is unchanged by the recording rate going up: same file count, same
  // duration, and doc.export is by far the slowest thing the script does.
  var d = plan(60);
  h.assertEqual('60fps recorded exports every 2nd frame by default', d.stride, 2);
  h.assertEqual('yielding the 30fps it always did', d.fps, 30);

  h.assertEqual('asking for 60 exports every frame', plan(60, 60).stride, 1);
  h.assertEqual('asking for 15 exports every 4th', plan(60, 15).stride, 4);
  h.assertEqual('and reports 15', plan(60, 15).fps, 15);

  // The rate is REPORTED, not assumed, because a stride is a whole number and most rates are not
  // reachable. Telling the user to import at 45 when the files are 60 plays the sequence slow.
  var odd = plan(60, 45);
  h.assertEqual('45 out of 60 is not reachable, so the stride is 1', odd.stride, 1);
  h.assertEqual('and the reported rate is the truth, not the request', odd.fps, 60);

  h.assertEqual('an explicit stride overrides the rate', plan(60, 30, 3).stride, 3);
  h.assertEqual('and its rate is derived from it', plan(60, 30, 3).fps, 20);

  // A stride below 1 would rewind through the recording; above the frame rate it exports one file.
  h.assertEqual('a zero stride is clamped up', plan(60, 30, 0).stride, 2);
  h.assertEqual('a negative stride is clamped up', plan(60, 30, -5).stride, 1);
  h.assertEqual('an absurd stride is clamped down', plan(60, 30, 9999).stride, 60);
  h.assertEqual('and an absurd rate cannot exceed the recording', plan(60, 9999).stride, 1);
};
