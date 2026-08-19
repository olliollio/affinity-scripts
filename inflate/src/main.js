/**
 * main.js — reads the selection, inflates it, writes it back. The ONLY file touching the SDK.
 *
 * Everything above this file is plain numbers in, plain numbers out, and is verified headlessly.
 * What cannot be verified headlessly is exactly what lives here: the base/spread round trip, and
 * whether the SDK's curve builder accepts the cubics this produces.
 */
(function (GR) {
  'use strict';

  var TITLE = 'Inflate';

  /**
   * The base-to-spread matrix as row-major 2x3.
   *
   * Curve coordinates are BASE space. baseToSpreadTransform is the only one of the three matrices
   * with the ancestors composed into it; node.transform is the LOCAL matrix and on a node inside a
   * scaled artboard it is wrong by the artboard's scale. gravity learned that the hard way — an
   * extraction using the local matrix made its whole simulation depend on the artboard.
   *
   * matrixOf lives in gravity's extract.js, which touches the SDK; rather than pull that whole
   * module in, the four lines are repeated here so main.js stays the only SDK file.
   *
   * The node.transform fallback looks like it contradicts all of the above, and would if this
   * module MEASURED in spread space and wrote in base. It does not: the same matrix is used forward
   * and inverted back, and thickness is relative to the shape itself, so a wrong-but-consistent
   * matrix still round-trips and still inflates by the right proportion. It is reached only on a
   * build old enough to lack the other two.
   */
  function matrixOf(node) {
    function data(t) {
      if (!t || !t.data) return null;
      var d = t.data;
      if (d.length < 6) return null;
      return [d[0], d[1], d[2], d[3], d[4], d[5]];
    }
    var m = null;
    try { m = data(node.baseToSpreadTransform); } catch (e) { /* older build, try the next */ }
    if (!m) { try { m = data(node.curvesInterface && node.curvesInterface.domainTransform); } catch (e) { /* likewise */ } }
    if (!m) { try { m = data(node.transform); } catch (e) { /* nothing usable */ } }
    return m;
  }

  function mapPoint(p, m) {
    if (!m) return { x: p.x, y: p.y };
    return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
  }

  /** Pure, and exported, because it is where the transform bugs live. */
  function mapSegment(s, m) {
    return { start: mapPoint(s.start, m), c1: mapPoint(s.c1, m),
             c2: mapPoint(s.c2, m), end: mapPoint(s.end, m) };
  }

  /** Every curve of one node, in SPREAD space, as plain numbers. */
  function readCurves(node) {
    var out = [];
    var ci = node.curvesInterface;
    if (!ci) return out;
    var pc = null;
    try { pc = ci.polyCurve; } catch (e) { return out; }
    if (!pc) return out;
    var m = matrixOf(node);
    for (var c = 0; c < pc.curveCount; c++) {
      var curve = pc.at(c);
      var segs = [];
      for (var bz of curve.beziers) segs.push(mapSegment(bz, m));
      out.push({ segments: segs, isClosed: curve.isClosed });
    }
    return out;
  }

  function main() {
    // `app` is a module export, not a sandbox global: every shipped script in this repository —
    // add_anchor_points and gravity alike — reaches it through /application, and the SDK reference
    // documents it that way. Reading it off the global object instead would throw a ReferenceError
    // on the success alert, i.e. at the end of every run that worked.
    var app = require('/application').app;
    var Document = require('/document').Document;
    var geometry = require('/geometry');
    var commands = require('/commands');
    var CurveBuilder = geometry.CurveBuilder, PolyCurve = geometry.PolyCurve;
    var DocumentCommand = commands.DocumentCommand,
        CompoundCommandBuilder = commands.CompoundCommandBuilder;

    var doc = Document.current;
    if (!doc) { app.alert('No active document.', TITLE); return; }

    // A live shape is parametric: there are no anchors to move, so it is excluded rather than
    // silently mangled, exactly as add_anchor_points does. But anything skipped must be NAMED, and
    // a plain .filter() drops a live shape mixed in with real curves with no message at all — the
    // user sees some of their selection inflate and some not, and nothing says why. So the refusals
    // are collected rather than discarded.
    var nodes = [], refused = [];
    for (var sel of doc.selection.nodes) {
      if (sel.isPolyCurveNode) nodes.push(sel); else refused.push(sel);
    }
    for (var rI = 0; rI < refused.length; rI++) {
      var nm = 'a node';
      try { if (refused[rI].name) nm = '"' + refused[rI].name + '"'; } catch (e) { /* unnamed */ }
      console.log(TITLE + ': skipped ' + nm + ' — not a curve shape. Run Convert to Curves first.');
    }
    if (!nodes.length) {
      app.alert('Select one or more vector (curve) shapes first.\n' +
                '(For a live shape, run Convert to Curves first.)', TITLE);
      return;
    }

    var settings = GR.inflShowSettings();
    if (!settings) return;

    var plans = [], skipped = [], notes = [];
    for (var node of nodes) {
      var curves = readCurves(node);
      if (!curves.length) { skipped.push('a node with no curve geometry'); continue; }

      var inflated = GR.inflateCurves(curves, settings.amount, undefined, settings.round);
      for (var k = 0; k < inflated.length; k++) {
        var nn = inflated[k].notes || [];
        for (var q = 0; q < nn.length; q++) notes.push('curve ' + k + ': ' + nn[q]);
      }

      // Where the transform is unreadable or singular there is no sensible inverse to invent, so
      // the points go back unchanged rather than displaced by the node's own transform.
      var inv = GR.invertMatrix(matrixOf(node));

      // createSetCurves replaces a node's geometry OUTRIGHT, so every curve of a node — a shape and
      // all its counters — must be rebuilt into ONE PolyCurve and issued as ONE command. Rebuilding
      // them separately would have the second command erase the first.
      var poly = PolyCurve.create();
      for (var i = 0; i < inflated.length; i++) {
        var segs = inflated[i].segments;
        if (!segs.length) continue;
        // begin(point) + addBezier(c1, c2, end), NOT the XY forms. This pair is round-trip
        // verified in add_anchor_points_1.0.js:120-122, and its `lerp` (line 29) shows it being fed
        // plain {x, y} OBJECT LITERALS — exactly what mapPoint returns — so no SDK point type has
        // to be constructed. `addBezierXY` exists in examples/joinpaths.js:150 but has no verified
        // use in this repository, and there is nothing to gain by preferring it.
        var cb = CurveBuilder.create();
        cb.begin(mapPoint(segs[0].start, inv));
        for (var s = 0; s < segs.length; s++) {
          cb.addBezier(mapPoint(segs[s].c1, inv), mapPoint(segs[s].c2, inv),
                       mapPoint(segs[s].end, inv));
        }
        // A closed curve is closed with close(), NEVER by repeating the first point: repeating it
        // yields isClosed false, which draws closed but FILLS wrong, and isClosed is read-only.
        if (inflated[i].isClosed) cb.close();
        poly.addCurve(cb.createCurve());
      }
      plans.push({ ci: node.curvesInterface, poly: poly });
    }

    if (!plans.length) { app.alert('Nothing to inflate.', TITLE); return; }

    var cmds = plans.map(function (p) { return DocumentCommand.createSetCurves(p.ci, p.poly); });
    if (cmds.length === 1) {
      doc.executeCommand(cmds[0]);
    } else {
      // One undo step for the whole selection, matching add_anchor_points.
      var builder = CompoundCommandBuilder.create();
      for (var ci2 = 0; ci2 < cmds.length; ci2++) builder.addCommand(cmds[ci2]);
      doc.executeCommand(builder.createCommand());
    }

    // The console is the only place a per-curve note can go; a modal for each would be unusable.
    for (var nI = 0; nI < notes.length; nI++) console.log(TITLE + ': ' + notes[nI]);
    for (var sI = 0; sI < skipped.length; sI++) console.log(TITLE + ': skipped ' + skipped[sI]);

    app.alert('Inflated ' + plans.length + ' shape' + (plans.length === 1 ? '' : 's') +
              ' by ' + Math.round(settings.amount * 100) + '%.' +
              (notes.length ? '\n' + notes.length + ' note(s) in the console.' : ''), TITLE);
  }

  GR.inflMapPoint = mapPoint;
  GR.inflMapSegment = mapSegment;
  GR.main = main;

})(GR);
