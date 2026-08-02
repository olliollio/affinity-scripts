/**
 * name: probe_stroke2
 * description: Read effectiveWeight, learn cloneScaled(), and verify the createSetLineStyleDescriptor write path.
 * version: 0.1.0
 * author: olliollio
 *
 * SETUP: same group as probe_stroke - two stroked shapes, one with the stroke
 * panel's "Scale with object" ON (isScale=true), one OFF (isScale=false).
 * Select the group, then run.
 *
 * Sections 0-2 read-only. Section 3 EXECUTES a non-uniform transform, section 4
 * EXECUTES a stroke write. Undo twice afterwards.
 */

var DO_TRANSFORM = true;
var DO_WRITE = true;
var KX = 2.0;
var KY = 1.0;
var WRITE_SCALE = 3.0;   // obvious on canvas

function L(l, t) { console.log(l + ': ' + t); }
function H(t) { console.log(''); console.log('===== ' + t + ' ====='); }

function members(o) {
  if (o === null || o === undefined) return [];
  var out = [], x = o;
  while (x && x !== Object.prototype) {
    var names = Object.getOwnPropertyNames(x);
    for (var i = 0; i < names.length; i++) out.push(names[i]);
    x = Object.getPrototypeOf(x);
  }
  var seen = {}, uniq = [];
  for (var j = 0; j < out.length; j++) if (!seen[out[j]]) { seen[out[j]] = 1; uniq.push(out[j]); }
  return uniq.sort();
}
function tag(o) { try { return String(o[Symbol.toStringTag]); } catch (e) { return '(no tag)'; } }
function safe(fn) {
  try { var v = fn(); return v === undefined ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function main() {
  console.log('######## probe_stroke2 v0.1.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document'); return; }
  var root = null;
  try { root = doc.selection.firstNode; } catch (e) {}
  if (!root) { L('FATAL', 'select the stroked group'); return; }

  var DocumentCommand = require('/commands').DocumentCommand;
  var Selection = require('/selections').Selection;
  var nodesMod = require('/nodes');

  // Collect nodes that actually carry a stroke (skip weight-0 containers).
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
  L('stroked nodes (weight > 0)', stroked.length);
  if (!stroked.length) { L('STOP', 'none found'); return; }

  // ---------------------------------------------------------------- 0
  H('0. effectiveWeight and the descriptor API');
  var d0 = stroked[0].lineStyleDescriptor;
  L('typeof effectiveWeight', safe(function () { return typeof d0.effectiveWeight; }));
  L('effectiveWeight value', safe(function () { return d0.effectiveWeight; }));
  L('effectiveWeight()', safe(function () { return d0.effectiveWeight(); }));
  L('effectiveWeight src', String(d0.effectiveWeight).replace(/\s+/g, ' ').substr(0, 200));
  L('cloneScaled arity', safe(function () { return d0.cloneScaled.length; }));
  L('cloneScaled src', String(d0.cloneScaled).replace(/\s+/g, ' ').substr(0, 240));
  L('clone src', String(d0.clone).replace(/\s+/g, ' ').substr(0, 200));
  L('lineStyle.weight', safe(function () { return d0.lineStyle.weight; }));
  L('descriptor isScale', safe(function () { return d0.isScale; }));

  H('0b. multiple strokes per node?');
  L('descriptorCount', safe(function () { return stroked[0].lineStyleInterface.descriptorCount; }));
  L('getAllLineStyleDescriptors', safe(function () {
    var all = stroked[0].lineStyleInterface.getAllLineStyleDescriptors();
    return tag(all) + ' len=' + all.length;
  }));
  L('createSetLineStyleDescriptor src', String(DocumentCommand.createSetLineStyleDescriptor)
      .replace(/\s+/g, ' ').substr(0, 300));

  // ---------------------------------------------------------------- 1
  H('1. per-node snapshot');
  var snap = [];
  for (var s = 0; s < stroked.length; s++) {
    var n = stroked[s];
    var rec = {
      node: n,
      desc: safe(function () { return String(n.description).substr(0, 28); }),
      weight: safe(function () { return n.lineWeight; }),
      eff: safe(function () {
        var d = n.lineStyleDescriptor;
        return (typeof d.effectiveWeight === 'function') ? d.effectiveWeight() : d.effectiveWeight;
      }),
      isScale: safe(function () { return n.lineStyleDescriptor.isScale; })
    };
    snap.push(rec);
    console.log('  [' + s + '] "' + rec.desc + '" isScale=' + rec.isScale +
                ' lineWeight=' + rec.weight + ' effectiveWeight=' + rec.eff);
  }

  // ---------------------------------------------------------------- 2
  H('2. cloneScaled behaviour (no document change)');
  L('cloneScaled(2) weight', safe(function () {
    var c = stroked[0].lineStyleDescriptor.cloneScaled(2);
    return 'lineStyle.weight=' + c.lineStyle.weight + ' isScale=' + c.isScale;
  }));
  L('cloneScaled(2,2) weight', safe(function () {
    var c = stroked[0].lineStyleDescriptor.cloneScaled(2, 2);
    return 'lineStyle.weight=' + c.lineStyle.weight;
  }));
  L('original unchanged?', safe(function () { return stroked[0].lineStyleDescriptor.lineStyle.weight; }));

  // ---------------------------------------------------------------- 3
  H('3. EXECUTE transform kx=' + KX + ' ky=' + KY + ' - what happens to effectiveWeight?');
  if (DO_TRANSFORM) {
    var Transform = require('/geometry').Transform;
    var box = root.spreadBaseBox;
    var xf = Transform.createTranslate(box.x, box.y)
                      .multiply(Transform.createScale(KX, KY))
                      .multiply(Transform.createTranslate(-box.x, -box.y));
    L('exec', safe(function () {
      doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, root), xf));
      return 'ok';
    }));

    console.log('-- after transform --');
    for (var b = 0; b < snap.length; b++) {
      var rec2 = snap[b];
      var nowEff = safe(function () {
        var d = rec2.node.lineStyleDescriptor;
        return (typeof d.effectiveWeight === 'function') ? d.effectiveWeight() : d.effectiveWeight;
      });
      var ratio = parseFloat(nowEff) / parseFloat(rec2.eff);
      console.log('  [' + b + '] "' + rec2.desc + '" isScale=' + rec2.isScale +
                  '  effectiveWeight ' + rec2.eff + ' -> ' + nowEff +
                  '  ratio=' + (isFinite(ratio) ? ratio.toFixed(4) : '?'));
    }
    console.log('');
    console.log('FACTOR KEY: 2 = kx | 1 = ky/untouched | ' + Math.sqrt(KX * KY).toFixed(4) +
                ' = sqrt(kx*ky) | ' + ((KX + KY) / 2).toFixed(4) + ' = mean');
  } else { L('skipped', 'DO_TRANSFORM=false'); }

  // ---------------------------------------------------------------- 4
  H('4. EXECUTE stroke write on the isScale=false node');
  if (!DO_WRITE) { L('skipped', 'DO_WRITE=false'); }
  else {
    var target = null;
    for (var t = 0; t < stroked.length; t++) {
      if (String(snap[t].isScale) === 'false') { target = stroked[t]; break; }
    }
    if (!target) { L('skipped', 'no isScale=false node in the selection'); }
    else {
      L('target', safe(function () { return target.description; }));
      L('weight before', safe(function () { return target.lineWeight; }));

      // Preferred path: cloneScaled + createSetLineStyleDescriptor
      L('write via cloneScaled', safe(function () {
        var scaled = target.lineStyleDescriptor.cloneScaled(WRITE_SCALE);
        doc.executeCommand(DocumentCommand.createSetLineStyleDescriptor(
          Selection.create(doc, target), scaled));
        return 'executed';
      }));
      L('weight after', safe(function () { return target.lineWeight; }));
      L('effectiveWeight after', safe(function () {
        var d = target.lineStyleDescriptor;
        return (typeof d.effectiveWeight === 'function') ? d.effectiveWeight() : d.effectiveWeight;
      }));
      L('isScale after', safe(function () { return target.lineStyleDescriptor.isScale; }));
      console.log('!! CHECK CANVAS: is that shape stroke ' + WRITE_SCALE + 'x thicker?');
    }
  }

  console.log('');
  console.log('!! UNDO twice (transform + stroke write).');
  console.log('######## probe done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
