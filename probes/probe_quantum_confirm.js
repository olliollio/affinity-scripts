/**
 * name: probe_quantum_confirm
 * description: Confirms the 15.4ms timer quantum and checks that a real rope holds 65fps at an 8ms request
 * version: 0.3.0
 * author: ollio
 *
 * USAGE: select ONE open path (a line or polyline drawn with the pen tool) and run.
 *        WATCH THE CANVAS - the last two phases are the ones to judge by eye.
 *        Copy the whole console output. About 15 seconds.
 * WRITES: previews only. Nothing is committed. One undo restores the path if it looks wrong.
 *
 * ── What is already established ───────────────────────────────────────────────
 * probe_timer_floor swept the requested interval with an empty callback and every result landed on
 * a multiple of 15.4ms, with the request rounded UP to the next whole quantum:
 *
 *     asked   1ms -> 15.3   (1 quantum)      asked  33ms -> 46.2   (3 quanta)
 *     asked   8ms -> 15.5   (1 quantum)      asked  50ms -> 61.6   (4 quanta)
 *     asked  16ms -> 30.5   (2 quanta)       asked 100ms -> 107.8  (7 quanta)
 *
 * 15.4ms is 64.9Hz, which is the host's scheduler tick. Six requests fitting n x 15.4 is not
 * coincidence, so playback's 33ms request - one millisecond past two quanta - has been silently
 * costing a third of the framerate: 46.2ms, 21.7fps, for a recording sampled at 30fps.
 *
 * Drawing was measured at the same time and is NOT the constraint: 1.4ms to submit a 193-point
 * rope, 0.5ms at 33 points, against a 15.4ms quantum.
 *
 * ── What is NOT yet established, and is the point of this probe ───────────────
 * Those draw measurements used a 1ms request, and their delivery was bursty - min 0ms, max 16ms,
 * sd ~6.5 - because a 1ms request asks for callbacks faster than a quantum can deliver them, so
 * they queue and flush together. Bursty delivery is exactly the strobing we are trying to remove,
 * so it must not be carried into the fix.
 *
 * The proposed playback configuration is an 8ms request - comfortably inside one quantum, so the
 * timer paces the loop rather than the loop outrunning the timer - while drawing a full 193-point
 * rope every frame. That combination has never been run. It has to be measured before any code
 * changes, because a promising interval that turns bursty under real drawing load would trade a
 * steady 21fps for an uneven 65fps, which looks worse, not better.
 *
 * Phase 4 is the control: today's exact settings, 33ms and a real rope, so the improvement can be
 * judged against what shipping code actually does rather than against an abstraction.
 *
 * Judge phases 3 and 4 BY EYE as well as by the numbers. The numbers can only say that frames
 * arrived on time; whether the motion reads as continuous is a question about your eye, and that
 * is the thing originally reported as janky.
 */

var TICKS = 60;
var SMOOTH_POINTS = 193; // 32 links smoothed 6x - what playback.js draws today
var SWEEP = 40;          // shorter runs for the confirmation sweep

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function main() {
  console.log('######## probe_quantum_confirm v0.3.0 ########');

  var app, doc, geometry, commands, timers;
  try {
    app = require('/application').app;
    geometry = require('/geometry');
    commands = require('/commands');
    timers = require('/timers');
  } catch (e) { console.log('modules unavailable: ' + e); return; }

  doc = app.documents.current;
  if (!doc) { console.log('Open a document first.'); return; }

  var node = null;
  try {
    for (var n of doc.selection.nodes) { if (n.curvesInterface) { node = n; break; } }
  } catch (e) { /* reported below */ }
  if (!node) { console.log('Select a path (a line drawn with the pen tool) and run again.'); return; }
  var ci = node.curvesInterface;

  var pts = [];
  try {
    var curve = ci.polyCurve.at(0);
    var first = true;
    for (var b of curve.beziers) {
      if (first) { pts.push({ x: b.start.x, y: b.start.y }); first = false; }
      pts.push({ x: b.end.x, y: b.end.y });
    }
  } catch (e) { console.log('could not read geometry: ' + e); return; }
  if (pts.length < 2) { console.log('Need at least two points.'); return; }

  var base = [];
  for (var k = 0; k < SMOOTH_POINTS; k++) {
    var t = k / (SMOOTH_POINTS - 1);
    var idx = t * (pts.length - 1);
    var lo = Math.floor(idx), hi = Math.min(pts.length - 1, lo + 1), f = idx - lo;
    base.push({ x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f });
  }

  function polyFrom(speed) {
    var pc = geometry.PolyCurve.create();
    var cb = geometry.CurveBuilder.create();
    for (var i = 0; i < base.length; i++) {
      var t = i / (base.length - 1);
      // The wave advances by wall-clock, not by tick, so a 65fps phase and a 21fps phase show the
      // SAME motion at the same speed. Otherwise the faster phase would merely look faster, and
      // speed is not what is being judged - smoothness is.
      var y = base[i].y + Math.sin(t * Math.PI * 2 + speed) * 45;
      if (i === 0) cb.beginXY(base[i].x, y); else cb.lineToXY(base[i].x, y);
    }
    pc.addCurve(cb.createCurve());
    return pc;
  }

  var phases = [
    // 1-2 test the quantum prediction where it is most falsifiable: 15 should give ONE quantum and
    // 17 should give TWO, so a 2ms change in the request must nearly halve the rate. No smooth
    // model of timer overhead predicts that; only quantisation does.
    { name: '1. empty @15ms  (predict ~15.4, 1 quantum)', ms: 15, draw: false, ticks: SWEEP },
    { name: '2. empty @17ms  (predict ~30.8, 2 quanta)', ms: 17, draw: false, ticks: SWEEP },
    // 3 is the proposed fix, 4 is what ships today. Same rope, same motion, different request.
    { name: '3. PROPOSED: rope 193pts @8ms', ms: 8, draw: true, ticks: TICKS },
    { name: '4. TODAY:    rope 193pts @33ms', ms: 33, draw: true, ticks: TICKS }
  ];

  H('Confirming the quantum, then pricing the fix');
  console.log('  Phases 1 and 2 differ by 2ms of request. If the quantum theory holds, phase 2');
  console.log('  runs at HALF the rate of phase 1. Watch phases 3 and 4 on canvas and say which');
  console.log('  looks smoother - they animate at the same speed on purpose, so only smoothness');
  console.log('  differs.');

  var phase = 0, tick = 0, last = 0, t0Phase = 0, deltas = [], workMs = 0;

  function report(p) {
    if (!deltas.length) { L(p.name, 'no ticks'); return; }
    var min = Infinity, max = -Infinity, sum = 0;
    for (var i = 0; i < deltas.length; i++) {
      if (deltas[i] < min) min = deltas[i];
      if (deltas[i] > max) max = deltas[i];
      sum += deltas[i];
    }
    var mean = sum / deltas.length;
    var v = 0;
    for (var j = 0; j < deltas.length; j++) v += (deltas[j] - mean) * (deltas[j] - mean);
    var sd = Math.sqrt(v / deltas.length);

    // A burst is a callback arriving in under a third of the mean: the timer catching up rather
    // than pacing. Bursts are what a 1ms request produced, and they must not survive into the fix.
    var bursts = 0;
    for (var b = 0; b < deltas.length; b++) if (deltas[b] < mean / 3) bursts++;

    L(p.name,
      'mean ' + mean.toFixed(1) + 'ms (' + (1000 / mean).toFixed(1) + 'fps)' +
      ' | sd ' + sd.toFixed(1) +
      ' | min ' + min + ' max ' + max +
      ' | bursts ' + bursts + '/' + deltas.length +
      (p.draw ? ' | submit ' + (workMs / deltas.length).toFixed(1) + 'ms' : ''));
  }

  function startPhase() {
    var mine = phase;
    tick = 0; deltas = []; workMs = 0; last = Date.now(); t0Phase = last;
    timers.setInterval(phases[phase].ms, function (err) { onTick(mine, err); });
  }

  function onTick(mine, err) {
    // A stale timer must not touch live state, and ABORTED is the echo of our own cancel.
    if (mine !== phase) return;
    if (err) return;

    var now = Date.now();
    if (tick > 0) deltas.push(now - last);
    last = now;

    var p = phases[phase];
    if (p.draw) {
      var t0 = Date.now();
      try {
        doc.executeCommand(
          commands.DocumentCommand.createSetCurves(ci, polyFrom((now - t0Phase) / 250)), true);
      } catch (e) { /* one bad frame must not end the phase */ }
      workMs += Date.now() - t0;
    }

    tick++;
    if (tick <= p.ticks) return;

    report(p);
    try { doc.clearPreviews(); } catch (e) {}

    phase++;
    try { timers.Timer.cancelAll(); } catch (e) {}
    if (phase < phases.length) { startPhase(); return; }

    H('Done');
    console.log('  Expected if the quantum theory is right: phase 1 near 15.4ms, phase 2 near 30.8,');
    console.log('  phase 3 near 15.4 with FEW bursts, phase 4 near 46.2.');
    console.log('  Phase 3 turning bursty would mean 8ms is too aggressive under real drawing load,');
    console.log('  and the fix should ask for 15ms instead - same quantum, more headroom.');
    console.log('  Nothing was committed. One undo restores the path if it looks wrong.');
    console.log('######## end ########');
  }

  startPhase();
}

main();
