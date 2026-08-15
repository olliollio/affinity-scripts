/**
 * name: probe_multi_setcurves
 * description: Does one compound command honour several createSetCurves on DIFFERENT nodes, or only one?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select THREE separate open paths (three pen-tool lines, three separate layers) and run.
 *        WATCH THE CANVAS. Copy the whole console output.
 * WRITES: previews, then one commit that is immediately undone. If anything looks wrong afterwards,
 *         undo until the paths are back.
 *
 * ── Why ───────────────────────────────────────────────────────────────────────
 * Gravity draws ropes by rewriting each rope's node geometry every frame with `createSetCurves`,
 * and packs every node's rewrite into ONE `CompoundCommandBuilder` so a frame stays a single
 * preview and a single undo step. With one rope that compound holds one rewrite, which is the only
 * case that has ever run.
 *
 * With three ropes it holds three, on three different nodes, and the result on canvas is that only
 * ONE rope moves. The simulation is provably fine — the script's own final-pose log shows all three
 * ropes landing on the artwork, while the canvas shows one on the artwork and two still floating
 * where they were drawn. So the poses are right and the drawing is not.
 *
 * That points at one of two SDK behaviours, and they need different fixes:
 *
 *   A. A compound command only honours ONE createSetCurves. Then each node's rewrite has to be its
 *      own command, and playback has to decide what that means for previews and undo depth.
 *   B. Compounds are fine, and the bug is in gravity's own grouping — the wrong node, a stale
 *      reference, or an exception being swallowed by the try/catch in ropeCommands.
 *
 * Section 3 tests the same rewrites as SEPARATE previews, because "previews replace one another"
 * is documented behaviour and would explain A exactly: three previews in a row leaving only the
 * last one visible is precisely the symptom, one rope moving and the rest untouched.
 *
 * ── How it checks, and why not by eye ────────────────────────────────────────
 * Each path is moved by a DIFFERENT vertical offset — 100, 200, 300 — so a readback says not just
 * whether a path moved but WHICH rewrite reached it. Reading the geometry back also catches the
 * case where the canvas looks right but the document was not actually changed, and the case where
 * a command throws and gravity's try/catch hides it.
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function main() {
  console.log('######## probe_multi_setcurves v0.1.0 ########');

  var app, doc, geometry, commands;
  try {
    app = require('/application').app;
    geometry = require('/geometry');
    commands = require('/commands');
  } catch (e) { console.log('modules unavailable: ' + e); return; }

  doc = app.documents.current;
  if (!doc) { console.log('Open a document first.'); return; }

  var nodes = [];
  try {
    for (var n of doc.selection.nodes) { if (n.curvesInterface) nodes.push(n); }
  } catch (e) { console.log('could not read the selection: ' + e); return; }

  L('paths selected', nodes.length);
  if (nodes.length < 2) {
    console.log('Select at least two separate open paths (three is ideal) and run again.');
    return;
  }

  /** Reads a node's first curve as plain points, so a rewrite can be verified rather than eyeballed. */
  function read(node) {
    var pts = [];
    try {
      var curve = node.curvesInterface.polyCurve.at(0);
      var first = true;
      for (var b of curve.beziers) {
        if (first) { pts.push({ x: b.start.x, y: b.start.y }); first = false; }
        pts.push({ x: b.end.x, y: b.end.y });
      }
    } catch (e) { return null; }
    return pts;
  }

  function build(points, dy) {
    var pc = geometry.PolyCurve.create();
    var cb = geometry.CurveBuilder.create();
    cb.beginXY(points[0].x, points[0].y + dy);
    for (var i = 1; i < points.length; i++) cb.lineToXY(points[i].x, points[i].y + dy);
    pc.addCurve(cb.createCurve());
    return pc;
  }

  var originals = [];
  for (var i = 0; i < nodes.length; i++) {
    var p = read(nodes[i]);
    if (!p || p.length < 2) { console.log('path ' + i + ' could not be read; aborting.'); return; }
    originals.push(p);
    L('path ' + i, p.length + ' points, first y=' + p[0].y.toFixed(1));
  }

  // A distinct offset per path, so a readback identifies WHICH rewrite landed.
  var OFFSETS = [];
  for (var k = 0; k < nodes.length; k++) OFFSETS.push((k + 1) * 100);
  L('offsets to apply', OFFSETS.join(', ') + '  (path 0 moves 100 down, path 1 moves 200, ...)');

  /** How far each path actually moved from its original, by readback. */
  function measure() {
    for (var i = 0; i < nodes.length; i++) {
      var now = read(nodes[i]);
      if (!now || !now.length) { L('  path ' + i, 'unreadable'); continue; }
      var moved = now[0].y - originals[i][0].y;
      L('  path ' + i, 'moved ' + moved.toFixed(1) + ' (wanted ' + OFFSETS[i] + ')' +
        (Math.abs(moved - OFFSETS[i]) < 0.5 ? '   <-- APPLIED' : '   <-- NOT APPLIED'));
    }
  }

  // ------------------------------------------- 1. all rewrites in ONE compound, as a preview
  H('1. One compound command holding every rewrite — PREVIEW');
  console.log('  This is exactly what playback.commandForFrame builds. Watch the canvas: ALL of the');
  console.log('  paths should jump down by different amounts.');
  try {
    var cc = commands.CompoundCommandBuilder.create();
    for (var a = 0; a < nodes.length; a++) {
      cc.addCommand(commands.DocumentCommand.createSetCurves(
        nodes[a].curvesInterface, build(originals[a], OFFSETS[a])));
    }
    doc.executeCommand(cc.createCommand(), true);
    L('compound preview', 'accepted');
  } catch (e) { L('compound preview', 'ERR: ' + e); }
  measure();
  console.log('  How many paths moved ON CANVAS? (the readback above may or may not see a preview)');

  try { doc.clearPreviews(); } catch (e) { /* nothing previewed */ }

  // ------------------------------------------- 2. the same compound, COMMITTED
  //
  // A preview is a different code path from a commit, and the readback may simply not see an
  // uncommitted change. Committing removes that ambiguity: whatever the readback says here is
  // certainly what the document holds.
  H('2. The same compound — COMMITTED, then undone');
  try {
    var cc2 = commands.CompoundCommandBuilder.create();
    for (var b2 = 0; b2 < nodes.length; b2++) {
      cc2.addCommand(commands.DocumentCommand.createSetCurves(
        nodes[b2].curvesInterface, build(originals[b2], OFFSETS[b2])));
    }
    doc.executeCommand(cc2.createCommand(), false);
    L('compound commit', 'accepted');
  } catch (e) { L('compound commit', 'ERR: ' + e); }
  measure();
  try { doc.undo(); } catch (e) { L('undo', 'ERR: ' + e); }

  // ------------------------------------------- 3. separate previews, one per node
  //
  // The alternative shape, and the one that would explain the bug: previews are documented to
  // REPLACE one another, so three previews in a row may leave only the last visible — one rope
  // moving and the rest untouched, which is the reported symptom exactly.
  H('3. Separate previews, one command per node');
  console.log('  If previews replace one another, only the LAST path will have moved.');
  try {
    for (var c = 0; c < nodes.length; c++) {
      doc.executeCommand(commands.DocumentCommand.createSetCurves(
        nodes[c].curvesInterface, build(originals[c], OFFSETS[c])), true);
    }
    L('separate previews', 'accepted');
  } catch (e) { L('separate previews', 'ERR: ' + e); }
  measure();
  console.log('  How many paths moved ON CANVAS this time?');

  try { doc.clearPreviews(); } catch (e) { /* nothing previewed */ }

  // ------------------------------------------- 4. are the nodes actually distinct?
  //
  // Cheap, and it rules out the dull explanation before any SDK behaviour is blamed: gravity groups
  // ropes by node identity, so two ropes reported as separate nodes that are in fact the same
  // object would overwrite each other with no SDK quirk involved at all.
  H('4. Are these really different nodes and different curvesInterfaces?');
  var dupNode = 0, dupCi = 0;
  for (var x = 0; x < nodes.length; x++) {
    for (var y = x + 1; y < nodes.length; y++) {
      if (nodes[x] === nodes[y]) dupNode++;
      if (nodes[x].curvesInterface === nodes[y].curvesInterface) dupCi++;
    }
  }
  L('duplicate node objects', dupNode);
  L('duplicate curvesInterface objects', dupCi + (dupCi ? '   <-- would explain everything' : ''));
  L('isMutable per path', nodes.map(function (nd) {
    try { return String(nd.curvesInterface.isMutable); } catch (e) { return 'ERR'; }
  }).join(', '));

  H('Done');
  console.log('  Nothing should remain changed. Undo until the paths are back if they are not.');
  console.log('  Please report, for sections 1 and 3, how many paths moved ON CANVAS.');
  console.log('######## end ########');
}

main();
