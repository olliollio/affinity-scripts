/**
 * name: probe_stroke_bug
 * description: Which flag distinguishes "has a visible stroke" from "has a stored line weight but no stroke"?
 * version: 0.1.0
 * author: olliollio
 *
 * SETUP: select the artwork that reproduced the bug - the group whose shapes
 * gained strokes (outer box, yellow rectangle, circle). Ideally the selection
 * also contains at least one genuinely stroked shape for contrast.
 *
 * FULLY READ-ONLY. Nothing is written, no undo needed.
 */

function L(l, t) { console.log(l + ': ' + t); }
function H(t) { console.log(''); console.log('===== ' + t + ' ====='); }
function tag(o) { try { return String(o[Symbol.toStringTag]); } catch (e) { return '(no tag)'; } }
function safe(fn) {
  try { var v = fn(); return v === undefined ? 'undefined' : String(v); }
  catch (e) { return 'ERR'; }
}
function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s.substr(0, n);
}

function main() {
  console.log('######## probe_stroke_bug v0.1.0 (read-only) ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document'); return; }

  var nodesMod = require('/nodes');
  var all = [];
  var roots = [];
  try { for (var s of doc.selection.nodes) roots.push(s); } catch (e) {}
  if (!roots.length) { L('FATAL', 'select the artwork'); return; }

  for (var r = 0; r < roots.length; r++) {
    all.push(roots[r]);
    try {
      for (var k of nodesMod.getNodeChildrenRecursive(roots[r].handle, nodesMod.NodeChildType.Main, false)) all.push(k);
    } catch (e) {}
  }
  L('nodes in selection tree', all.length);

  H('every node, every stroke-ish flag');
  console.log(
    pad('#', 4) + pad('type', 16) + pad('description', 22) +
    pad('weight', 10) + pad('hasPen', 8) + pad('isNoFill', 10) +
    pad('lsVisible', 11) + pad('nodeVis', 9) + pad('penFill', 12) +
    pad('isScale', 9) + 'TARGETED?'
  );
  console.log(new Array(120).join('-'));

  var targetedNow = [];
  for (var i = 0; i < all.length; i++) {
    (function (n, idx) {
      var weight = safe(function () { return n.lineWeight; });
      var hasPen = safe(function () { return n.hasPenFill; });
      var isNoFill = safe(function () { return n.lineStyleInterface.isNoFill; });
      var lsVisible = safe(function () { return n.lineStyleInterface.isLineStyleVisible; });
      var nodeVis = safe(function () { return n.isLineStyleVisible; });
      var penFill = safe(function () { return tag(n.penFillDescriptor.fill); });
      var isScale = safe(function () { return n.lineStyleDescriptor.isScale; });

      // Exactly the predicate the shipped script uses today.
      var w = parseFloat(weight);
      var targeted = (isFinite(w) && w > 0 && String(isScale) === 'false');
      if (targeted) targetedNow.push(idx);

      console.log(
        pad(idx, 4) + pad(tag(n), 16) +
        pad(safe(function () { return String(n.description).substr(0, 20); }), 22) +
        pad(isFinite(w) ? w.toFixed(2) : weight, 10) +
        pad(hasPen, 8) + pad(isNoFill, 10) + pad(lsVisible, 11) +
        pad(nodeVis, 9) + pad(penFill, 12) + pad(isScale, 9) +
        (targeted ? '*** YES ***' : 'no')
      );
    })(all[i], i);
  }

  H('summary');
  L('targeted by the CURRENT predicate (weight>0 && isScale===false)', targetedNow.join(', ') || '(none)');

  // Candidate replacement predicates, scored against the same node set.
  var candidates = [
    ['isNoFill === false', function (n) { return String(safe(function () { return n.lineStyleInterface.isNoFill; })) === 'false'; }],
    ['lineStyleInterface.isLineStyleVisible === true', function (n) { return String(safe(function () { return n.lineStyleInterface.isLineStyleVisible; })) === 'true'; }],
    ['node.isLineStyleVisible === true', function (n) { return String(safe(function () { return n.isLineStyleVisible; })) === 'true'; }],
    ['penFillDescriptor.fill is not NoFill', function (n) {
      var t = safe(function () { return tag(n.penFillDescriptor.fill); });
      return t !== 'NoFill' && t !== 'ERR' && t !== 'undefined';
    }]
  ];

  console.log('');
  console.log('If a candidate is correct, its list should contain ONLY the shapes that');
  console.log('genuinely had a stroke before scaling - and none of the three that gained one.');
  for (var c = 0; c < candidates.length; c++) {
    (function (label, test) {
      var hits = [];
      for (var j = 0; j < all.length; j++) {
        var n = all[j];
        var w = parseFloat(safe(function () { return n.lineWeight; }));
        var isScale = safe(function () { return n.lineStyleDescriptor.isScale; });
        if (isFinite(w) && w > 0 && String(isScale) === 'false' && test(n)) hits.push(j);
      }
      L('  weight>0 && isScale===false && ' + label, hits.join(', ') || '(none)');
    })(candidates[c][0], candidates[c][1]);
  }

  console.log('');
  console.log('Tell me which row numbers are the shapes that WRONGLY gained a stroke.');
  console.log('######## probe done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
