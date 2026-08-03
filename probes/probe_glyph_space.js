/**
 * name: probe_glyph_space
 * description: Discovery probe - which coordinate space do a text node's glyph outlines arrive in?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE live text object, ideally NOT at the page origin and NOT unrotated,
 *        so an identity transform cannot hide a mistake. Run and copy the CONSOLE output.
 * READ-ONLY: this probe never modifies the document.
 *
 * `curvesInterface.polyPolyCurves` holds one PolyCurve per glyph. Extraction assumed
 * `getTransformedPolyCurve(i)` returns the glyph in the node's BASE space, so `node.transform`
 * would finish the job as it does for every other node. In a real document the letters then fell
 * correctly and collided with nothing, which is exactly how a body far from where it renders
 * behaves — so that assumption is wrong and this measures the truth instead of guessing a third
 * time.
 *
 * The ground truth is `node.spreadBaseBox`: whatever composition reproduces THAT is the right one.
 * Four candidates are compared against it:
 *
 *   A  getPolyCurve(i)                              raw, expected to be em space
 *   B  getPolyCurve(i)            + node.transform
 *   C  getTransformedPolyCurve(i)                   what the code does now, minus the node matrix
 *   D  getTransformedPolyCurve(i) + node.transform  what the code does now
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function members(o) {
  if (o === null || o === undefined) return [];
  var out = [], x = o;
  while (x && x !== Object.prototype) {
    var names = Object.getOwnPropertyNames(x);
    for (var i = 0; i < names.length; i++) out.push(names[i]);
    x = Object.getPrototypeOf(x);
  }
  var seen = {}, uniq = [];
  for (var j = 0; j < out.length; j++) { if (!seen[out[j]]) { seen[out[j]] = 1; uniq.push(out[j]); } }
  return uniq.sort();
}

function fmt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(3) : String(n); }

function xf(t) {
  if (!t) return String(t);
  try {
    var d = t.data;
    if (!d) return '(no .data) members=' + members(t).slice(0, 12).join(',');
    return '[' + fmt(d[0]) + ' ' + fmt(d[1]) + ' ' + fmt(d[2]) + ' | ' +
           fmt(d[3]) + ' ' + fmt(d[4]) + ' ' + fmt(d[5]) + ']';
  } catch (e) { return 'ERR: ' + (e && e.message || e); }
}

/** Bounding box of a PolyCurve's actual bezier anchors, optionally through a 2x3 matrix. */
function bboxOf(pc, m) {
  var b = null, n = 0;
  try { n = pc.curveCount; } catch (e) { return null; }
  for (var i = 0; i < n; i++) {
    var c;
    try { c = pc.at(i); } catch (e) { continue; }
    try {
      for (var z of c.beziers) {
        var pts = [z.start, z.c1, z.c2, z.end];
        for (var k = 0; k < pts.length; k++) {
          var x = pts[k].x, y = pts[k].y;
          if (m) { var xx = m[0] * x + m[1] * y + m[2]; y = m[3] * x + m[4] * y + m[5]; x = xx; }
          if (!b) b = { x0: x, y0: y, x1: x, y1: y };
          if (x < b.x0) b.x0 = x;
          if (x > b.x1) b.x1 = x;
          if (y < b.y0) b.y0 = y;
          if (y > b.y1) b.y1 = y;
        }
      }
    } catch (e) { /* next curve */ }
  }
  return b;
}

function showBox(label, b) {
  if (!b) { console.log('    ' + label + ': (none)'); return; }
  console.log('    ' + label + ': x ' + fmt(b.x0) + '..' + fmt(b.x1) +
              '   y ' + fmt(b.y0) + '..' + fmt(b.y1) +
              '   (w ' + fmt(b.x1 - b.x0) + ' h ' + fmt(b.y1 - b.y0) + ')');
}

function main() {
  console.log('######## probe_glyph_space v0.1.0 ########');

  var doc;
  try { doc = require('/application').app.documents.current; }
  catch (e) { console.log('Could not reach the document: ' + (e && e.message || e)); return; }
  if (!doc) { console.log('No open document.'); return; }

  var nodes = [];
  try { for (var n of doc.selection.nodes) nodes.push(n); } catch (e) { /* reported below */ }

  var node = null;
  for (var i = 0; i < nodes.length; i++) {
    var isText = false;
    try { isText = nodes[i].isTextNode === true; } catch (e) { /* skip */ }
    if (isText) { node = nodes[i]; break; }
  }
  if (!node) { console.log('Select a live text object and run again.'); return; }

  // ------------------------------------------------------------ ground truth
  H('1. Where does Affinity say this text IS?');
  L('  node', safe(function () { return node[Symbol.toStringTag] + ' "' + node.description + '"'; }));
  L('  node.transform', safe(function () { return xf(node.transform); }));
  L('  baseBox', safe(function () { return JSON.stringify(node.baseBox); }));
  L('  spreadBaseBox  <-- GROUND TRUTH', safe(function () { return JSON.stringify(node.spreadBaseBox); }));

  var m = null;
  try {
    var d = node.transform.data;
    m = [d[0], d[1], d[2], d[3], d[4], d[5]];
  } catch (e) { /* leave null */ }
  L('  transform is identity', String(!m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0)) +
    '  (if true, move or rotate the text and re-run — identity hides the answer)');

  var ci = null;
  try { ci = node.curvesInterface; } catch (e) { /* reported below */ }
  if (!ci) { console.log('no curvesInterface'); return; }

  var ppc = null;
  try { ppc = ci.polyPolyCurves; } catch (e) { /* reported below */ }
  if (!ppc) { console.log('no polyPolyCurves'); return; }

  L('  polyCurveCount', safe(function () { return ppc.polyCurveCount; }));
  L('  ppc.boundingBox', safe(function () { return JSON.stringify(ppc.boundingBox); }));
  L('  ppc.getBoundingBox()', safe(function () { return JSON.stringify(ppc.getBoundingBox()); }));
  L('  ppc.transform', safe(function () { return xf(ppc.transform); }));

  // -------------------------------------------------- the four candidate spaces
  H('2. Candidate spaces, per glyph');
  console.log('Compare each against spreadBaseBox above. The one that matches is the right route.');

  var count = 0;
  try { count = ppc.polyCurveCount; } catch (e) { count = 0; }
  var show = Math.min(count, 3);

  for (var g = 0; g < show; g++) {
    console.log('');
    console.log('  glyph[' + g + ']');
    L('    getPolyCurveTransform(' + g + ')', safe(function () { return xf(ppc.getPolyCurveTransform(g)); }));

    var raw = null, tr = null;
    try { raw = ppc.getPolyCurve(g); } catch (e) { L('    getPolyCurve', 'ERR: ' + (e && e.message || e)); }
    try { tr = ppc.getTransformedPolyCurve(g); } catch (e) { L('    getTransformedPolyCurve', 'ERR: ' + (e && e.message || e)); }

    if (raw) showBox('A  raw                      ', bboxOf(raw, null));
    if (raw && m) showBox('B  raw + node.transform    ', bboxOf(raw, m));
    if (tr) showBox('C  transformed             ', bboxOf(tr, null));
    if (tr && m) showBox('D  transformed + node.xf   ', bboxOf(tr, m));
  }

  // Whole-string extents are the clearest comparison: they should span the text box.
  H('3. All glyphs together');
  function unionAll(useTransformed, applyNode) {
    var b = null;
    for (var k = 0; k < count; k++) {
      var pc = null;
      try { pc = useTransformed ? ppc.getTransformedPolyCurve(k) : ppc.getPolyCurve(k); } catch (e) { continue; }
      if (!pc) continue;
      var sub = bboxOf(pc, applyNode ? m : null);
      if (!sub) continue;
      if (!b) b = { x0: sub.x0, y0: sub.y0, x1: sub.x1, y1: sub.y1 };
      if (sub.x0 < b.x0) b.x0 = sub.x0;
      if (sub.y0 < b.y0) b.y0 = sub.y0;
      if (sub.x1 > b.x1) b.x1 = sub.x1;
      if (sub.y1 > b.y1) b.y1 = sub.y1;
    }
    return b;
  }
  showBox('A  raw                      ', unionAll(false, false));
  showBox('B  raw + node.transform     ', unionAll(false, true));
  showBox('C  transformed              ', unionAll(true, false));
  showBox('D  transformed + node.xf    ', unionAll(true, true));
  L('  spreadBaseBox again', safe(function () { return JSON.stringify(node.spreadBaseBox); }));

  console.log('');
  console.log('######## end ########');
}

main();
