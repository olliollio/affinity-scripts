/**
 * name: probe_stroke
 * description: Find the stroke "Scale with object" flag, the lineWeight write path, and what createTransform does to strokes.
 * version: 0.1.0
 * author: olliollio
 *
 * SETUP: make a group containing at least two STROKED shapes -
 *   shape A: stroke panel "Scale with object" ON
 *   shape B: stroke panel "Scale with object" OFF
 * Ideally also a DASHED stroke, and a shape with a non-uniform-friendly stroke.
 * Select the group, then run.
 *
 * Sections 0-3 read-only. Section 4 EXECUTES a non-uniform transform
 * (kx=2, ky=1) -> undo afterwards.
 */

var DO_EXECUTE = true;
var KX = 2.0;
var KY = 1.0;   // non-uniform on purpose: reveals which factor Affinity uses

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
function descriptorOf(o, name) {
  var x = o;
  while (x && x !== Object.prototype) {
    var d = Object.getOwnPropertyDescriptor(x, name);
    if (d) return 'get=' + (typeof d.get) + ' set=' + (typeof d.set) + ' writable=' + d.writable;
    x = Object.getPrototypeOf(x);
  }
  return '(no descriptor)';
}

// Dump every numeric/boolean member of an object - the flag is in here somewhere.
function scalars(o) {
  if (!o) return '(null)';
  var keys = members(o), out = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'constructor' || k === 'handle') continue;
    var v;
    try { v = o[k]; } catch (e) { continue; }
    if (typeof v === 'number' || typeof v === 'boolean') out.push(k + '=' + v);
    else if (v && v.isEnumValue) out.push(k + '=enum(' + v.value + ')');
  }
  return out.join(' ');
}

function main() {
  console.log('######## probe_stroke v0.1.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document'); return; }
  var root = null;
  try { root = doc.selection.firstNode; } catch (e) {}
  if (!root) { L('FATAL', 'select a group of stroked shapes'); return; }

  // ---------------------------------------------------------------- 0
  H('0. stroke-related commands');
  var DocumentCommand = require('/commands').DocumentCommand;
  var names = ['createSetLineStyle', 'createSetLineStyleDescriptor', 'createSetCurveNodeStyle',
               'createSetStrokeAlignment', 'createSetPenFill', 'createSetPenFillIsAnchoredToSpread',
               'createSetAllLayerEffectsScaleWithObject'];
  for (var i = 0; i < names.length; i++) {
    var fn = DocumentCommand[names[i]];
    L(names[i], (typeof fn) + ' arity=' + (fn && fn.length) +
                ' src=' + String(fn).replace(/\s+/g, ' ').substr(0, 190));
  }
  var all = members(DocumentCommand), hits = [];
  for (var a = 0; a < all.length; a++) if (/line|stroke|dash|weight/i.test(all[a])) hits.push(all[a]);
  L('~line/stroke/dash/weight', hits.join(', '));

  // ---------------------------------------------------------------- 1
  H('1. stroked nodes in the selection');
  var nodesMod = require('/nodes');
  var stroked = [];
  function consider(n) {
    var w = 0, hasPen = false;
    try { w = n.lineWeight; } catch (e) {}
    try { hasPen = !!n.hasPenFill; } catch (e) {}
    if (hasPen || (typeof w === 'number' && w > 0)) stroked.push(n);
  }
  consider(root);
  try {
    for (var k of nodesMod.getNodeChildrenRecursive(root.handle, nodesMod.NodeChildType.Main, false)) consider(k);
  } catch (e) { L('walk', 'ERR ' + e.message); }
  L('stroked node count', stroked.length);
  if (!stroked.length) { L('STOP', 'no stroked nodes found - add strokes and rerun'); return; }

  // ---------------------------------------------------------------- 2
  H('2. where is the "Scale with object" flag?');
  var s0 = stroked[0];
  L('node tag', tag(s0) + ' / ' + safe(function () { return s0.description; }));
  L('lineWeight / lineWeightPts', safe(function () { return s0.lineWeight + ' / ' + s0.lineWeightPts; }));
  L('descriptor lineWeight', descriptorOf(s0, 'lineWeight'));
  L('lineStyleDescriptor tag', safe(function () { return tag(s0.lineStyleDescriptor); }));
  L('lineStyleDescriptor members', safe(function () { return members(s0.lineStyleDescriptor).join(', '); }));
  L('lineStyleDescriptor scalars', safe(function () { return scalars(s0.lineStyleDescriptor); }));
  L('lineStyleInterface members', safe(function () { return members(s0.lineStyleInterface).join(', '); }));
  L('lineStyleInterface scalars', safe(function () { return scalars(s0.lineStyleInterface); }));
  L('lineStyle tag/members', safe(function () { return tag(s0.lineStyle) + ' | ' + members(s0.lineStyle).join(', '); }));
  L('lineStyle scalars', safe(function () { return scalars(s0.lineStyle); }));
  L('penFillDescriptor scalars', safe(function () { return scalars(s0.penFillDescriptor); }));
  L('penFillDescriptor.isScaleWithObject', safe(function () { return s0.penFillDescriptor.isScaleWithObject; }));
  L('dashPattern', safe(function () { return Array.prototype.join.call(s0.dashPattern, ','); }));
  L('dashPhase', safe(function () { return s0.dashPhase; }));

  // ---------------------------------------------------------------- 3
  H('3. per-node snapshot (compare flag vs. what happens in section 4)');
  var before = [];
  for (var s = 0; s < stroked.length; s++) {
    var n = stroked[s];
    var rec = {
      node: n,
      desc: safe(function () { return String(n.description).substr(0, 28); }),
      weight: safe(function () { return n.lineWeight; }),
      pts: safe(function () { return n.lineWeightPts; }),
      penScale: safe(function () { return n.penFillDescriptor.isScaleWithObject; }),
      lsScalars: safe(function () { return scalars(n.lineStyleDescriptor); }),
      dash: safe(function () { return Array.prototype.join.call(n.dashPattern, ','); })
    };
    before.push(rec);
    console.log('  [' + s + '] "' + rec.desc + '" weight=' + rec.weight +
                ' pts=' + rec.pts + ' penScaleWithObject=' + rec.penScale +
                ' dash=[' + rec.dash + ']');
    console.log('       lineStyleDescriptor: ' + rec.lsScalars);
  }

  // ---------------------------------------------------------------- 4
  H('4. EXECUTE non-uniform transform kx=' + KX + ' ky=' + KY);
  if (!DO_EXECUTE) { L('skipped', 'DO_EXECUTE=false'); return; }

  var Transform = require('/geometry').Transform;
  var Selection = require('/selections').Selection;
  var box = root.spreadBaseBox;
  var xf = Transform.createTranslate(box.x, box.y)
                    .multiply(Transform.createScale(KX, KY))
                    .multiply(Transform.createTranslate(-box.x, -box.y));

  L('exec', safe(function () {
    doc.executeCommand(DocumentCommand.createTransform(Selection.create(doc, root), xf));
    return 'ok';
  }));

  console.log('-- after --');
  for (var b = 0; b < before.length; b++) {
    var rec2 = before[b];
    var nowW = safe(function () { return rec2.node.lineWeight; });
    var ratio = (parseFloat(nowW) / parseFloat(rec2.weight));
    console.log('  [' + b + '] "' + rec2.desc + '" ' + rec2.weight + ' -> ' + nowW +
                '  ratio=' + (isFinite(ratio) ? ratio.toFixed(4) : '?') +
                '  (penScaleWithObject was ' + rec2.penScale + ')');
    console.log('       dash now [' + safe(function () {
      return Array.prototype.join.call(rec2.node.dashPattern, ',');
    }) + '] was [' + rec2.dash + ']');
  }
  console.log('');
  console.log('READ THIS: for a flag-ON shape, ratio tells us which factor Affinity uses:');
  console.log('  ' + KX + ' = kx    ' + KY + ' = ky    ' +
              Math.sqrt(KX * KY).toFixed(4) + ' = sqrt(kx*ky)    ' +
              ((KX + KY) / 2).toFixed(4) + ' = mean');
  console.log('For a flag-OFF shape, ratio should be 1.0000 (untouched).');
  console.log('!! UNDO now (Ctrl/Cmd+Z).');

  console.log('######## probe done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
