/**
 * name: probe_setcurves
 * description: Discovery probe - can a curve node's geometry be rewritten as a PREVIEW, and how fast?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE open path (a line or polyline drawn with the pen tool) and run.
 *        Copy the CONSOLE output. Watch the canvas while it runs.
 * WRITES: previews only, then restores the original geometry. Nothing is committed — but if
 *         something goes wrong, one undo returns the path.
 *
 * Gravity moves rigid objects with `createTransform`, which cannot express a rope: a rope DEFORMS.
 * Rewriting the path's geometry each frame with `createSetCurves` can, and that command is already
 * round-trip verified by `add_anchor_points`. What is NOT known is whether it works in PREVIEW
 * mode — `executeCommand(cmd, true)` — which is what makes scrubbing and playback cheap.
 *
 * If previews work, a rope animates as smoothly as everything else. If only commits work, every
 * frame becomes an undo entry and playback would have to be rethought, so this is worth knowing
 * before any of it is built.
 *
 * Answers:
 *   1. Does createSetCurves accept a rebuilt PolyCurve at all?
 *   2. Does it work as a preview, and does clearPreviews() restore the original?
 *   3. How long does one rewrite take, i.e. is 30fps realistic?
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function main() {
  console.log('######## probe_setcurves v0.1.0 ########');

  var app, doc, geometry, commands;
  try {
    app = require('/application').app;
    geometry = require('/geometry');
    commands = require('/commands');
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

  L('node', safe(function () { return node[Symbol.toStringTag] + ' "' + node.description + '"'; }));

  var ci = node.curvesInterface;
  L('isMutable', safe(function () { return ci.isMutable; }));

  // Read the original geometry as plain numbers, so it can be rebuilt exactly afterwards.
  var pts = [];
  var closed = false;
  L('read geometry', safe(function () {
    var pc = ci.polyCurve;
    var curve = pc.at(0);
    closed = curve.isClosed;
    var first = true;
    for (var b of curve.beziers) {
      if (first) { pts.push({ x: b.start.x, y: b.start.y }); first = false; }
      pts.push({ x: b.end.x, y: b.end.y });
    }
    return pts.length + ' points, closed=' + closed;
  }));
  if (pts.length < 2) { console.log('Need at least two points.'); return; }

  /** Rebuilds the path from a point list. This is exactly what rope playback would do per frame. */
  function buildPolyCurve(points) {
    var out = geometry.PolyCurve.create();
    var cb = geometry.CurveBuilder.create();
    cb.beginXY(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) cb.lineToXY(points[i].x, points[i].y);
    if (closed) cb.close();
    out.addCurve(cb.createCurve());
    return out;
  }

  // ------------------------------------------------- 1. does a rewrite work?
  H('1. Rewrite as a COMMIT is already known to work — check the rebuild is sound');
  L('buildPolyCurve from the original points', safe(function () {
    var pc = buildPolyCurve(pts);
    return 'built, curveCount=' + pc.curveCount;
  }));

  // ------------------------------------------------------- 2. preview mode
  H('2. Preview mode — the question');
  console.log('  Watch the canvas: the path should visibly sag, then snap back.');

  // A deliberate sag, so the change is obvious on screen and clearly not a no-op.
  var sagged = [];
  for (var i = 0; i < pts.length; i++) {
    var t = pts.length === 1 ? 0 : i / (pts.length - 1);
    var droop = Math.sin(t * Math.PI) * 60;
    sagged.push({ x: pts[i].x, y: pts[i].y + droop });
  }

  L('executeCommand(cmd, true)  <-- preview', safe(function () {
    var cmd = commands.DocumentCommand.createSetCurves(ci, buildPolyCurve(sagged));
    doc.executeCommand(cmd, true);
    return 'accepted — does the path look sagged on canvas?';
  }));

  L('clearPreviews restores it', safe(function () {
    doc.clearPreviews();
    return 'called — is the path back to its original shape?';
  }));

  // ------------------------------------------------------------- 3. speed
  H('3. Speed — is 30fps realistic?');
  L('30 preview rewrites', safe(function () {
    var t0 = Date.now();
    for (var f = 0; f < 30; f++) {
      var amount = Math.sin(f / 30 * Math.PI * 2) * 40;
      var frame = [];
      for (var k = 0; k < pts.length; k++) {
        var tt = pts.length === 1 ? 0 : k / (pts.length - 1);
        frame.push({ x: pts[k].x, y: pts[k].y + Math.sin(tt * Math.PI) * amount });
      }
      doc.executeCommand(commands.DocumentCommand.createSetCurves(ci, buildPolyCurve(frame)), true);
    }
    var ms = Date.now() - t0;
    doc.clearPreviews();
    return ms + 'ms for 30 frames = ' + (ms / 30).toFixed(1) + 'ms per frame' +
           '  (33ms per frame is the 30fps budget)';
  }));

  // A denser path is what a real rope would be: 40 segments rather than a handful.
  L('30 rewrites at 40 points', safe(function () {
    var dense = [];
    for (var k = 0; k <= 40; k++) {
      var tt = k / 40;
      var idx = tt * (pts.length - 1);
      var lo = Math.floor(idx), hi = Math.min(pts.length - 1, lo + 1), f2 = idx - lo;
      dense.push({
        x: pts[lo].x + (pts[hi].x - pts[lo].x) * f2,
        y: pts[lo].y + (pts[hi].y - pts[lo].y) * f2
      });
    }
    var t0 = Date.now();
    for (var f = 0; f < 30; f++) {
      var frame = [];
      for (var d = 0; d < dense.length; d++) {
        frame.push({ x: dense[d].x, y: dense[d].y + Math.sin(d / dense.length * Math.PI) * (f % 10) * 4 });
      }
      doc.executeCommand(commands.DocumentCommand.createSetCurves(ci, buildPolyCurve(frame)), true);
    }
    var ms = Date.now() - t0;
    doc.clearPreviews();
    return ms + 'ms = ' + (ms / 30).toFixed(1) + 'ms per frame at 41 points';
  }));

  H('4. Cleanup');
  L('clearPreviews', safe(function () { doc.clearPreviews(); return 'done — the path should be untouched'; }));
  console.log('  Nothing was committed. If the path looks wrong, one undo restores it.');

  console.log('');
  console.log('######## end ########');
}

main();
