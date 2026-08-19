'use strict';

module.exports = function (GR, h) {
  h.group('main — the base/spread round trip');

  // createSetCurves writes BASE space, not spread. Geometry computed in spread space needs the
  // INVERSE of baseToSpreadTransform applied first — the same matrix it was read with, or the round
  // trip does not close. A freshly drawn node has an identity transform and round-trips either way,
  // so this stays invisible until a MOVED node is involved, and then it looks like a displacement
  // bug rather than a transform bug.
  var m = [2, 0, 100, 0, 3, -50];                    // scale 2x3, translate (100, -50)
  var seg = { start: {x:1,y:2}, c1: {x:3,y:4}, c2: {x:5,y:6}, end: {x:7,y:8} };

  var fwd = GR.inflMapSegment(seg, m);
  h.assertClose('forward maps the start x', fwd.start.x, 2*1 + 0*2 + 100, 1e-12);
  h.assertClose('forward maps the start y', fwd.start.y, 0*1 + 3*2 - 50, 1e-12);

  var back = GR.inflMapSegment(fwd, GR.invertMatrix(m));
  ['start','c1','c2','end'].forEach(function (k) {
    h.assertClose('round trip closes on ' + k + '.x', back[k].x, seg[k].x, 1e-9);
    h.assertClose('round trip closes on ' + k + '.y', back[k].y, seg[k].y, 1e-9);
  });

  // A singular matrix has no sensible inverse to invent. invertMatrix returns null, and the points
  // must then be written UNCHANGED rather than mangled.
  h.assertEqual('a singular matrix inverts to null', GR.invertMatrix([0,0,5,0,0,5]), null);
  var unchanged = GR.inflMapSegment(seg, null);
  h.assertClose('a null matrix leaves the points alone', unchanged.c2.y, 6, 1e-12);

  h.group('main — the amount definition survives the round trip');
  // The headless identity test cannot catch a missing inverse, because there is no transform in it.
  // This one can: inflate at amount 0 THROUGH a non-identity matrix and require the original back.
  var F = require('./fixtures');
  var sq = F.rect(0, 0, 100, 100);
  var spread = { segments: sq.segments.map(function (s) { return GR.inflMapSegment(s, m); }),
                 isClosed: true };
  var out = GR.inflateCurves([spread], 0)[0];
  var base = out.segments.map(function (s) { return GR.inflMapSegment(s, GR.invertMatrix(m)); });
  var drift = 0;
  for (var i = 0; i < base.length; i++) {
    ['start','c1','c2','end'].forEach(function (k) {
      drift = Math.max(drift, Math.hypot(base[i][k].x - sq.segments[i][k].x,
                                         base[i][k].y - sq.segments[i][k].y));
    });
  }
  h.assert('amount = 0 through a non-identity transform is the identity', drift < 1e-9,
    'max drift ' + drift.toExponential(2));

  h.group('main — one end-to-end run against a stubbed SDK');

  // The two suites above prove the maths of the round trip but never run main(), so dropping the
  // invertMatrix call inside main() leaves them all green — measured, not assumed. Everything main()
  // reaches the host through is a require, and under vm.runInThisContext those resolve to
  // globalThis.require, so stubbing that is the whole harness needed: no Affinity, no document.
  //
  // What this cannot prove is that the real SDK ACCEPTS these calls. It proves the calls are made,
  // in the right order, with base-space numbers in them.

  /** A node whose curve data is `base`, presented in BASE space with `mat` as its base-to-spread. */
  function fakeNode(base, mat) {
    return {
      name: 'square',
      isPolyCurveNode: true,
      baseToSpreadTransform: { data: mat },
      curvesInterface: {
        polyCurve: {
          curveCount: 1,
          at: function () { return { isClosed: base.isClosed, beziers: base.segments }; }
        }
      }
    };
  }

  /** Records every CurveBuilder / PolyCurve / command call main() makes. */
  function recorder() {
    var log = { curves: [], commands: [], executed: [], alerts: [], compounds: 0 };
    log.geometry = {
      CurveBuilder: { create: function () {
        var c = { begin: null, beziers: [], closed: false };
        log.curves.push(c);
        return {
          begin: function (p) { c.begin = p; },
          addBezier: function (c1, c2, end) { c.beziers.push({ c1: c1, c2: c2, end: end }); },
          close: function () { c.closed = true; },
          createCurve: function () { return c; }
        };
      } },
      PolyCurve: { create: function () {
        var pc = { curves: [] };
        pc.addCurve = function (cv) { pc.curves.push(cv); };
        return pc;
      } }
    };
    log.commands_mod = {
      DocumentCommand: { createSetCurves: function (ci, poly) {
        var cmd = { ci: ci, poly: poly };
        log.commands.push(cmd);
        return cmd;
      } },
      CompoundCommandBuilder: { create: function () {
        log.compounds++;
        var parts = [];
        return { addCommand: function (c) { parts.push(c); },
                 createCommand: function () { return { compound: parts }; } };
      } }
    };
    log.doc = {
      selection: { nodes: [] },
      executeCommand: function (c) { log.executed.push(c); }
    };
    log.app = { alert: function (msg) { log.alerts.push(msg); } };
    return log;
  }

  /** Runs main() with the SDK modules and the settings dialog stubbed. Always restores both. */
  function runMain(log, amount) {
    var savedRequire = globalThis.require, savedSettings = GR.inflShowSettings;
    globalThis.require = function (id) {
      if (id === '/application') return { app: log.app };
      if (id === '/document') return { Document: { current: log.doc } };
      if (id === '/geometry') return log.geometry;
      if (id === '/commands') return log.commands_mod;
      throw new Error('unexpected require: ' + id);
    };
    GR.inflShowSettings = function () { return { amount: amount }; };
    try { GR.main(); }
    finally { globalThis.require = savedRequire; GR.inflShowSettings = savedSettings; }
  }

  var log = recorder();
  log.doc.selection.nodes = [fakeNode(sq, m)];
  runMain(log, 0);

  h.assertEqual('one node yields one setCurves command', log.commands.length, 1);
  h.assertEqual('and it is executed directly, not wrapped in a compound', log.compounds, 0);
  h.assertEqual('exactly one command reaches the document', log.executed.length, 1);
  h.assertEqual('the command targets the node\'s own curvesInterface',
    log.commands[0].ci === log.doc.selection.nodes[0].curvesInterface, true);
  h.assertEqual('the rebuilt PolyCurve holds one curve', log.commands[0].poly.curves.length, 1);

  var built = log.curves[0];
  h.assertEqual('a closed input is closed with close()', built.closed, true);
  h.assertEqual('four input segments give four addBezier calls', built.beziers.length, 4);

  // The one that dies when main() forgets to invert: at amount 0 the numbers HANDED TO THE SDK must
  // be the node's own base coordinates, not those coordinates pushed through its transform.
  var wrote = 0;
  wrote = Math.max(wrote, Math.hypot(built.begin.x - sq.segments[0].start.x,
                                     built.begin.y - sq.segments[0].start.y));
  for (var b = 0; b < built.beziers.length; b++) {
    ['c1','c2','end'].forEach(function (k) {
      wrote = Math.max(wrote, Math.hypot(built.beziers[b][k].x - sq.segments[b][k].x,
                                         built.beziers[b][k].y - sq.segments[b][k].y));
    });
  }
  h.assert('the points written back are in BASE space', wrote < 1e-9,
    'max offset from the input ' + wrote.toExponential(2));

  h.assertEqual('the run reports what it did', log.alerts.length, 1);
  h.assert('and says how many shapes', /1 shape/.test(log.alerts[0] || ''), log.alerts[0]);

  // A live shape has no anchors to move. It must be refused rather than mangled, and refusing
  // everything must not reach the document at all.
  var live = recorder();
  live.doc.selection.nodes = [{ name: 'live rectangle', isPolyCurveNode: false }];
  runMain(live, 0.3);
  h.assertEqual('a non-curve node issues no command', live.executed.length, 0);
  h.assert('and the user is told', /curve/.test(live.alerts[0] || ''), live.alerts[0]);

  // Two nodes must land in ONE undo step, or undoing an inflate half-undoes it.
  var two = recorder();
  two.doc.selection.nodes = [fakeNode(sq, m), fakeNode(F.rect(0, 0, 50, 80), [1, 0, 0, 0, 1, 0])];
  runMain(two, 0.25);
  h.assertEqual('two nodes still execute a single command', two.executed.length, 1);
  h.assertEqual('and that command is a compound', two.compounds, 1);
  h.assertEqual('holding both setCurves', (two.executed[0].compound || []).length, 2);
};
