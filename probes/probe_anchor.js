/**
 * name: probe_anchor
 * description: Determine how to build a "scale kx,ky about point p" Transform, and verify the anchor stays fixed.
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE node (group is fine), run. Console output.
 * Sections 0-2 read-only. Section 3 EXECUTES a scale anchored TOP-LEFT -> undo after.
 */

var DO_EXECUTE = true;
var KX = 2.0;
var KY = 3.0;   // deliberately non-uniform so axis mix-ups are obvious

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
function dat(t) {
  if (!t) return '(null)';
  var a = [];
  for (var i = 0; i < t.data.length; i++) a.push(Number(t.data[i]).toFixed(4));
  return '[' + a.join(', ') + ']';
}
function boxStr(b) {
  return 'x=' + Number(b.x).toFixed(2) + ' y=' + Number(b.y).toFixed(2) +
         ' w=' + Number(b.width).toFixed(2) + ' h=' + Number(b.height).toFixed(2);
}

function main() {
  console.log('######## probe_anchor v0.1.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  var node = null;
  try { node = doc.selection.firstNode; } catch (e) {}
  if (!node) { L('FATAL', 'select something'); return; }

  var box = node.spreadBaseBox;
  L('node', tag(node));
  L('spreadBaseBox', boxStr(box));

  // Anchor under test: TOP-LEFT of the bbox.
  var px = box.x, py = box.y;
  L('anchor p (top-left)', px.toFixed(4) + ', ' + py.toFixed(4));

  // Target matrix for "scale (KX,KY) about p", row-major 2x3 [a,b,tx, c,d,ty]:
  //   a=KX  b=0  tx=px*(1-KX)
  //   c=0   d=KY ty=py*(1-KY)
  var expect = [KX, 0, px * (1 - KX), 0, KY, py * (1 - KY)];
  L('EXPECTED data', '[' + expect.map(function (v) { return Number(v).toFixed(4); }).join(', ') + ']');

  // ---------------------------------------------------------------- 0
  H('0. where does Transform live?');
  var TransformClass = null;
  L('node.transform.constructor', safe(function () {
    TransformClass = node.transform.constructor;
    return String(TransformClass.name) + ' statics=' + members(TransformClass).join(', ');
  }));
  L('require("/geometry")', safe(function () { return members(require('/geometry')).join(', '); }));
  L('new TransformClass()', safe(function () { return dat(new TransformClass()); }));
  L('TransformClass.createTranslate(10,20)', safe(function () {
    return dat(TransformClass.createTranslate(10, 20));
  }));
  L('TransformClass.createScale?', safe(function () { return dat(TransformClass.createScale(2, 3)); }));

  function identity() {
    var t = node.transform.clone();
    t.setIdentity();
    return t;
  }
  L('identity()', safe(function () { return dat(identity()); }));
  L('identity().scaled(KX,KY)', safe(function () { return dat(identity().scaled(KX, KY)); }));

  // ---------------------------------------------------------------- 1
  H('1. candidate constructions (compare to EXPECTED)');
  var candidates = [
    ['A  identity().scaled(KX,KY).around(px,py)', function () {
      return identity().scaled(KX, KY).around(px, py);
    }],
    ['B  identity().around(px,py) then scaled', function () {
      return identity().around(px, py).scaled(KX, KY);
    }],
    ['C  identity().scaled(KX,KY).translated(px*(1-KX), py*(1-KY))', function () {
      return identity().scaled(KX, KY).translated(px * (1 - KX), py * (1 - KY));
    }],
    ['D  identity().translated(px*(1-KX), py*(1-KY)) then scaled', function () {
      return identity().translated(px * (1 - KX), py * (1 - KY)).scaled(KX, KY);
    }],
    ['E  T(p) * S * T(-p) via multiply', function () {
      var T1 = TransformClass.createTranslate(px, py);
      var S = identity().scaled(KX, KY);
      var T2 = TransformClass.createTranslate(-px, -py);
      return T1.multiply(S).multiply(T2);
    }],
    ['F  T(p) premultipliedBy chain', function () {
      var S = identity().scaled(KX, KY);
      return S.premultipliedBy(TransformClass.createTranslate(-px, -py))
              .postmultipliedBy(TransformClass.createTranslate(px, py));
    }],
    ['G  S.postmultipliedBy(T(-p)).premultipliedBy(T(p))', function () {
      var S = identity().scaled(KX, KY);
      return S.postmultipliedBy(TransformClass.createTranslate(-px, -py))
              .premultipliedBy(TransformClass.createTranslate(px, py));
    }]
  ];

  var best = null;
  for (var c = 0; c < candidates.length; c++) {
    var label = candidates[c][0], t = null, err = null;
    try { t = candidates[c][1](); } catch (e) { err = e && e.message ? e.message : String(e); }
    if (err) { L(label, 'ERR: ' + err); continue; }
    var d = t.data;
    var match = true;
    for (var i = 0; i < 6; i++) if (Math.abs(d[i] - expect[i]) > 0.01) match = false;
    L(label, dat(t) + (match ? '   <<<< MATCH' : ''));
    if (match && !best) best = candidates[c][1];
  }
  L('winner found', best ? 'yes' : 'NO - none matched');

  // Sanity: does the winner map p to itself?
  if (best) {
    L('winner applyToPoint(p)', safe(function () {
      var t = best();
      var geo = require('/geometry');
      var pt = t.applyToPoint(geo.Point ? new geo.Point(px, py) : { x: px, y: py });
      return pt.x.toFixed(3) + ', ' + pt.y.toFixed(3) + '  (should equal ' + px.toFixed(3) + ', ' + py.toFixed(3) + ')';
    }));
  }

  // ---------------------------------------------------------------- 2
  H('2. does createTransform scale stroke weight / effects?');
  L('node.lineWeight before', safe(function () { return node.lineWeight; }));
  L('node.lineWeightPts before', safe(function () { return node.lineWeightPts; }));

  // ---------------------------------------------------------------- 3
  H('3. EXECUTE anchored scale (top-left must stay fixed)');
  if (!DO_EXECUTE) { L('skipped', 'DO_EXECUTE=false'); return; }
  if (!best) { L('skipped', 'no matching construction'); return; }

  var DocumentCommand = require('/commands').DocumentCommand;
  var Selection = require('/selections').Selection;
  L('before box', boxStr(node.spreadBaseBox));
  L('exec', safe(function () {
    var sel = Selection.create(doc, node);
    doc.executeCommand(DocumentCommand.createTransform(sel, best()));
    return 'ok';
  }));
  var after = node.spreadBaseBox;
  L('after box', boxStr(after));
  L('anchor held?', 'x ' + (Math.abs(after.x - px) < 0.5 ? 'FIXED' : 'MOVED ' + after.x.toFixed(2)) +
                    ' | y ' + (Math.abs(after.y - py) < 0.5 ? 'FIXED' : 'MOVED ' + after.y.toFixed(2)));
  L('size ratio', 'w ' + (after.width / box.width).toFixed(4) + ' (want ' + KX + ')' +
                  ' | h ' + (after.height / box.height).toFixed(4) + ' (want ' + KY + ')');
  L('node.lineWeight after', safe(function () { return node.lineWeight; }));
  console.log('!! UNDO now (Ctrl/Cmd+Z).');

  console.log('######## probe_anchor done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
