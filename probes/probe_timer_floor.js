/**
 * name: probe_timer_floor
 * description: Discovery probe - what is the fastest interval /timers can actually deliver, and what does drawing cost on top?
 * version: 0.2.0
 * author: ollio
 *
 * USAGE: select ONE open path (a line or polyline drawn with the pen tool) and run.
 *        Copy the WHOLE console output. Takes about 20 seconds.
 * WRITES: previews only. Nothing is committed; clearPreviews restores the path at the end.
 *
 * ── What the previous run established ─────────────────────────────────────────
 * probe_playback_cadence asked for 33ms with an EMPTY callback and got 46.3ms, sd 0.5, min 45,
 * max 47, zero late ticks. Two things follow, and they close off most of the search space:
 *
 *   - Delivery is METRONOME-STEADY. An sd of 0.5ms over 60 ticks is as regular as a timer gets, so
 *     jank is not caused by uneven frame arrival. That whole hypothesis is dead.
 *   - The rate is 21.6fps with NOTHING being drawn. So playback cannot run at 30fps, never mind
 *     the 60 that would fix temporal undersampling. The recording is sampled at 30fps and delivered
 *     at 21.6, which is both slow motion AND below the rate at which fast motion reads as
 *     continuous - a sufficient explanation for "steppy" on its own.
 *
 * That probe then aborted after phase 1, and the reason is worth writing down: its error branch
 * called `Timer.cancelAll()`. Cancelling delivers ABORTED to the cancelled callback, so answering
 * ABORTED with another cancelAll killed the freshly-armed next phase, which reported ABORTED in
 * turn. ABORTED is the CONFIRMATION of a cancel, not a failure, and must be swallowed. This probe
 * additionally tags every callback with the phase that armed it, so a stale timer cannot touch the
 * state of the phase that replaced it.
 *
 * ── The question now ──────────────────────────────────────────────────────────
 * Is 46ms a FLOOR or an OVERHEAD? They predict different numbers and imply different fixes:
 *
 *   - A floor: every request below ~46ms returns ~46ms, and larger requests are honoured.
 *     Something fixed per callback - most likely the MCP bridge round-trip, since scripts reach
 *     Affinity over a local bridge - sets the cost. Nothing in gravity can raise the framerate;
 *     the fix has to be to make 21fps LOOK right rather than to ask for more frames.
 *   - A constant overhead: every request returns request + ~13ms, so asking 16 gives ~29 and
 *     asking 100 gives ~113. Then asking for less genuinely buys frames, and play()'s 33ms should
 *     be lowered.
 *
 * Phase 6 then adds real drawing at the best interval available, to price a frame of rope on top
 * of whatever that floor turns out to be.
 *
 * ── One variable this cannot see ──────────────────────────────────────────────
 * The testing environment and an INSTALLED script are known to differ - /fs and export are denied
 * in testing and permitted when installed. If the 46ms is bridge latency, an installed script may
 * not pay it. Worth running this a second time from an installed copy before designing around the
 * number.
 */

var TICKS = 40;
var REQUESTS = [1, 8, 16, 33, 50, 100];  // spans well below and well above the observed 46ms
var SMOOTH_POINTS = 193;                 // 32 links smoothed 6x - what playback.js draws today
var RAW_POINTS = 33;                     // the same rope drawn straight between joint centres

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function main() {
  console.log('######## probe_timer_floor v0.2.0 ########');

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

  // Does setInterval hand back a handle with its own cancel? If it does, phases can be switched
  // without the cancelAll dance that broke the last probe, and playback could stop one timer
  // without disturbing anything else the script is running.
  H('0. What does setInterval return?');
  try {
    var h = timers.setInterval(5000, function () {});
    var keys = [];
    for (var k in h) keys.push(k + ':' + typeof h[k]);
    L('return value', (h === undefined ? 'undefined' : (typeof h) + ' ' + String(h)));
    L('members', keys.length ? keys.join(', ') : '(none enumerable)');
    L('has .cancel()', h && typeof h.cancel === 'function');
    timers.Timer.cancelAll();
  } catch (e) { L('return value', 'ERR: ' + e); }

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

  function polyFrom(base, tick) {
    var pc = geometry.PolyCurve.create();
    var cb = geometry.CurveBuilder.create();
    for (var i = 0; i < base.length; i++) {
      var t = i / (base.length - 1);
      var y = base[i].y + Math.sin(t * Math.PI * 2 + tick * 0.3) * 40;
      if (i === 0) cb.beginXY(base[i].x, y); else cb.lineToXY(base[i].x, y);
    }
    pc.addCurve(cb.createCurve());
    return pc;
  }

  var phases = [];
  for (var r = 0; r < REQUESTS.length; r++) {
    phases.push({ name: 'empty  @' + REQUESTS[r] + 'ms', ms: REQUESTS[r], base: null });
  }
  // Drawing is priced at 1ms so the request cannot be what limits it - whatever comes back is the
  // true cost of a frame, floor included.
  phases.push({ name: 'draw  33pts @1ms', ms: 1, base: raw });
  phases.push({ name: 'draw 193pts @1ms', ms: 1, base: smooth });

  H('Timing - ' + TICKS + ' ticks per phase');
  console.log('  Watch the canvas during the last two phases and say whether they look steppy.');

  var phase = 0, tick = 0, last = 0, deltas = [], workMs = 0;

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
    L(p.name,
      'mean ' + mean.toFixed(1) + 'ms (' + (1000 / mean).toFixed(1) + 'fps)' +
      ' | sd ' + Math.sqrt(v / deltas.length).toFixed(1) +
      ' | min ' + min + ' max ' + max +
      (p.base ? ' | submit ' + (workMs / deltas.length).toFixed(1) + 'ms' : ''));
  }

  function startPhase() {
    var mine = phase;
    tick = 0; deltas = []; workMs = 0; last = Date.now();
    timers.setInterval(phases[phase].ms, function (err) { onTick(mine, err); });
  }

  function onTick(mine, err) {
    // A timer from a finished phase must not touch anything. ABORTED in particular is the echo of
    // our own cancel, and answering it with another cancel is what killed the previous probe.
    if (mine !== phase) return;
    if (err) return;

    var now = Date.now();
    if (tick > 0) deltas.push(now - last);
    last = now;

    var p = phases[phase];
    if (p.base) {
      var t0 = Date.now();
      try {
        doc.executeCommand(commands.DocumentCommand.createSetCurves(ci, polyFrom(p.base, tick)), true);
      } catch (e) { /* one bad frame must not end the phase */ }
      workMs += Date.now() - t0;
    }

    tick++;
    if (tick <= TICKS) return;

    report(p);
    try { doc.clearPreviews(); } catch (e) {}

    // Advance FIRST, so the ABORTED that cancelAll is about to deliver is already stale.
    phase++;
    try { timers.Timer.cancelAll(); } catch (e) {}

    if (phase < phases.length) { startPhase(); return; }

    H('Done');
    console.log('  If every empty phase reports about the same ms, that number is a hard FLOOR');
    console.log('  and no setting in gravity can beat it. If they track the request instead, it is');
    console.log('  overhead and asking for less buys real frames.');
    console.log('  Nothing was committed. One undo restores the path if it looks wrong.');
    console.log('######## end ########');
  }

  startPhase();
}

main();
