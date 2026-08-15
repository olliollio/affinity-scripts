/**
 * name: probe_playback_cadence
 * description: Discovery probe - does the playback timer actually deliver 33ms frames, and what does drawing a rope cost?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE open path (a line or polyline drawn with the pen tool) and run.
 *        Watch the canvas, then copy the WHOLE console output.
 * WRITES: previews only. Nothing is committed; clearPreviews restores the path at the end.
 *         If anything looks wrong afterwards, one undo returns it.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * Gravity's ropes simulate correctly but look janky, and the jank was described as STEPPING or
 * STROBING between frames rather than buzzing or stretching. That rules out the solver and points
 * at the playback path, where there are two very different causes with opposite fixes:
 *
 *   A. TEMPORAL UNDERSAMPLING. The recording stores one pose per TWO physics steps
 *      (sim.js STEPS_PER_FRAME = 2), so a 60Hz simulation is sampled at 30fps. A swinging rope
 *      moves far between samples and the eye tracks the whole line at once, so it aliases.
 *      Fix: record every step and play at 60. Costs twice the frames and twice the draw calls.
 *
 *   B. IRREGULAR DELIVERY. play() asks for 33ms ticks, but if the timer cannot keep that or a
 *      frame's repaint overruns the budget, frames arrive unevenly. Uneven delivery looks far
 *      worse than a steady low rate, because timing variance is easier to see than a constant rate.
 *      Fix: draw less per frame. Recording at 60fps would make this case WORSE, not better.
 *
 * These produce the same complaint and demand opposite changes, so guessing is expensive - and a
 * guess has already cost one cycle here, when Catmull-Rom smoothing was built on an assumption
 * about the word "janky" and changed nothing visible.
 *
 * ── Why the existing timing number does not settle it ──────────────────────────
 * probe_setcurves measured 30 rewrites in a TIGHT LOOP and reported ~1.0ms per frame at 41 points.
 * A tight loop never yields, so that timed command construction and submission only - not the
 * canvas repaint that has to happen between frames. The only honest measurement is inside a real
 * timer callback, spaced like real playback. That is what this does.
 *
 * ── What each phase separates ─────────────────────────────────────────────────
 *   1. empty @33ms   - can the timer alone hold 30fps with NO document work? Isolates the timer.
 *   2. empty @16ms   - is 60fps even available as a delivery rate?
 *   3.  33 pts @33ms - one solver point per link, drawn raw. What playback would cost unsmoothed.
 *   4. 193 pts @33ms - 32 links smoothed 6x, which is what ships today (playback.js line 102).
 *   5. 193 pts @16ms - today's geometry at the framerate that would fix undersampling.
 *
 * Reading the result:
 *   - Phase 1 already ragged        -> the timer is the ceiling. Neither fix helps; rethink playback.
 *   - Phase 1 clean, phase 4 ragged -> drawing is too expensive. Cut smoothing BEFORE raising fps.
 *   - Phases 1-4 all clean          -> delivery is fine, so it is undersampling. Go to 60fps.
 *   - Phase 4 clean but 5 ragged    -> 60fps is affordable only with less geometry per frame.
 */

var TICKS = 60;          // 2s at 33ms - long enough for a stall to show, short enough to sit through
var SMOOTH_POINTS = 193; // 32 links -> 33 joints -> smoothPolyline(pts, 6) = 193 drawn points
var RAW_POINTS = 33;     // the same rope drawn straight between joint centres

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function main() {
  console.log('######## probe_playback_cadence v0.1.0 ########');

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
    for (var n of doc.selection.nodes) {
      if (n.curvesInterface) { node = n; break; }
    }
  } catch (e) { /* reported below */ }
  if (!node) { console.log('Select a path (a line drawn with the pen tool) and run again.'); return; }

  var ci = node.curvesInterface;
  L('node', String(node.description));

  // Read the path once, so every phase animates the same real geometry.
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
  L('source points', pts.length);

  /**
   * Resamples the path to exactly `count` points along its own line.
   *
   * The phases must differ ONLY in point count, so both the 33-point and 193-point cases have to
   * come from the same path rather than from two different shapes with different bounds - the
   * renderer's cost depends on the area covered as well as the vertex count.
   */
  function resampleTo(count) {
    var out = [];
    for (var k = 0; k < count; k++) {
      var t = count === 1 ? 0 : k / (count - 1);
      var idx = t * (pts.length - 1);
      var lo = Math.floor(idx), hi = Math.min(pts.length - 1, lo + 1), f = idx - lo;
      out.push({ x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f });
    }
    return out;
  }

  var raw = resampleTo(RAW_POINTS);
  var smooth = resampleTo(SMOOTH_POINTS);

  /** One frame of a travelling wave, so the canvas genuinely redraws rather than repeating itself. */
  function wave(base, tick) {
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var t = i / (base.length - 1);
      out.push({ x: base[i].x, y: base[i].y + Math.sin(t * Math.PI * 2 + tick * 0.3) * 40 });
    }
    return out;
  }

  function polyFrom(points) {
    var pc = geometry.PolyCurve.create();
    var cb = geometry.CurveBuilder.create();
    cb.beginXY(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) cb.lineToXY(points[i].x, points[i].y);
    pc.addCurve(cb.createCurve());
    return pc;
  }

  // Each phase: what to request, and what to draw (null = draw nothing, to time the timer alone).
  var phases = [
    { name: '1. empty tick        @33ms', ms: 33, base: null },
    { name: '2. empty tick        @16ms', ms: 16, base: null },
    { name: '3. rope,  33 points  @33ms', ms: 33, base: raw },
    { name: '4. rope, 193 points  @33ms', ms: 33, base: smooth },
    { name: '5. rope, 193 points  @16ms', ms: 16, base: smooth }
  ];

  H('Timing - watch the canvas as well as the numbers');
  console.log('  Five phases, ' + TICKS + ' ticks each, about 10 seconds total.');
  console.log('  Note by eye which phases look SMOOTH and which look STEPPY - the numbers say what');
  console.log('  the timer did, your eye says what it looked like, and both are needed.');

  var phase = 0;
  var tick = 0;
  var last = 0;
  var deltas = [];
  var workMs = 0;

  function report(p) {
    if (!deltas.length) { L(p.name, 'no ticks recorded'); return; }

    var min = Infinity, max = -Infinity, sum = 0;
    for (var i = 0; i < deltas.length; i++) {
      var d = deltas[i];
      if (d < min) min = d;
      if (d > max) max = d;
      sum += d;
    }
    var mean = sum / deltas.length;

    // Standard deviation is the number that matters most here. A steady 45ms tick still LOOKS
    // fine; a mean of 33 that swings between 16 and 90 does not, and only the spread shows that.
    var varSum = 0;
    for (var j = 0; j < deltas.length; j++) varSum += (deltas[j] - mean) * (deltas[j] - mean);
    var sd = Math.sqrt(varSum / deltas.length);

    // A tick arriving at over 1.5x the requested interval is a frame the viewer never saw.
    var late = 0;
    for (var k = 0; k < deltas.length; k++) if (deltas[k] > p.ms * 1.5) late++;

    L(p.name,
      'asked ' + p.ms + 'ms | actual mean ' + mean.toFixed(1) +
      'ms (' + (1000 / mean).toFixed(1) + 'fps)' +
      ' | sd ' + sd.toFixed(1) +
      ' | min ' + min + ' max ' + max +
      ' | late ' + late + '/' + deltas.length +
      (p.base ? ' | draw ' + (workMs / deltas.length).toFixed(1) + 'ms of it' : ''));
  }

  function startPhase() {
    tick = 0;
    deltas = [];
    workMs = 0;
    last = Date.now();
    timers.setInterval(phases[phase].ms, onTick);
  }

  function onTick(err) {
    if (err) { try { timers.Timer.cancelAll(); } catch (e) {} console.log('timer error: ' + err); return; }

    var now = Date.now();
    // The first delta is measured from before the timer was armed, so it includes setup and would
    // skew a 60-sample mean noticeably.
    if (tick > 0) deltas.push(now - last);
    last = now;

    var p = phases[phase];
    if (p.base) {
      var t0 = Date.now();
      try {
        doc.executeCommand(commands.DocumentCommand.createSetCurves(ci, polyFrom(wave(p.base, tick))), true);
      } catch (e) { /* one bad frame must not end the phase */ }
      workMs += Date.now() - t0;
    }

    tick++;
    if (tick <= TICKS) return;

    try { timers.Timer.cancelAll(); } catch (e) {}
    report(p);
    try { doc.clearPreviews(); } catch (e) {}

    phase++;
    if (phase < phases.length) { startPhase(); return; }

    H('Done');
    console.log('  Nothing was committed. If the path looks wrong, one undo restores it.');
    console.log('  Please also say which phases looked smooth and which looked steppy.');
    console.log('######## end ########');
  }

  startPhase();
}

main();
