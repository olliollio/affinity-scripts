/**
 * name: probe_stroke3
 * description: Can effectiveWeight(transform) tell us Affinity's own stroke-scale factor for a non-uniform transform?
 * version: 0.1.0
 * author: olliollio
 *
 * SETUP: same stroked group (one isScale=true shape, one isScale=false).
 * Select it and run. FULLY READ-ONLY - no undo needed.
 */

function L(l, t) { console.log(l + ': ' + t); }
function H(t) { console.log(''); console.log('===== ' + t + ' ====='); }
function safe(fn) {
  try { var v = fn(); return v === undefined ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function main() {
  console.log('######## probe_stroke3 v0.1.0 (read-only) ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  var root = null;
  try { root = doc.selection.firstNode; } catch (e) {}
  if (!root) { L('FATAL', 'select the stroked group'); return; }

  var Transform = require('/geometry').Transform;
  var nodesMod = require('/nodes');

  var stroked = [];
  function consider(n) {
    var w = 0;
    try { w = n.lineWeight; } catch (e) { return; }
    if (typeof w === 'number' && w > 0) stroked.push(n);
  }
  consider(root);
  try {
    for (var k of nodesMod.getNodeChildrenRecursive(root.handle, nodesMod.NodeChildType.Main, false)) consider(k);
  } catch (e) {}
  L('stroked nodes', stroked.length);
  if (!stroked.length) { L('STOP', 'none'); return; }

  // Candidate transforms. Origin does not matter for a weight, only the basis.
  var cases = [
    ['uniform 2x',      Transform.createScale(2, 2)],
    ['non-uniform 2,1', Transform.createScale(2, 1)],
    ['non-uniform 1,2', Transform.createScale(1, 2)],
    ['non-uniform 2,4', Transform.createScale(2, 4)],
    ['half 0.5',        Transform.createScale(0.5, 0.5)]
  ];

  for (var s = 0; s < stroked.length; s++) {
    var n = stroked[s];
    var d = n.lineStyleDescriptor;
    H('node[' + s + '] "' + safe(function () { return String(n.description).substr(0, 28); }) +
      '"  isScale=' + safe(function () { return d.isScale; }));

    var base = parseFloat(safe(function () { return d.effectiveWeight(); }));
    L('effectiveWeight()', base);

    for (var c = 0; c < cases.length; c++) {
      (function (label, xf) {
        var asLocal = safe(function () { return d.effectiveWeight(xf, null); });
        var asWorld = safe(function () { return d.effectiveWeight(null, xf); });
        var asBoth  = safe(function () { return d.effectiveWeight(xf, xf); });
        function r(v) {
          var f = parseFloat(v) / base;
          return isFinite(f) ? f.toFixed(4) : v;
        }
        L('  ' + label, 'local=' + r(asLocal) + '  world=' + r(asWorld) + '  both=' + r(asBoth));
      })(cases[c][0], cases[c][1]);
    }
  }

  console.log('');
  console.log('WHAT TO LOOK FOR:');
  console.log('  uniform 2x should give 2.0000 in whichever slot is the live one.');
  console.log('  non-uniform 2,1 then reveals the rule: 2=kx, 1=ky, 1.4142=sqrt(kx*ky), 1.5=mean.');
  console.log('  If every ratio is 1.0000 on the isScale=false node but not on the');
  console.log('  isScale=true node, the flag gates the calculation and we can only');
  console.log('  measure the factor from a flag-ON descriptor.');
  console.log('######## probe done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
