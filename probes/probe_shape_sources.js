/**
 * name: probe_shape_sources
 * description: Discovery probe - which node kinds can yield closed contours, by which API, and in which coordinate space?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select one or more objects, then run and copy the CONSOLE output.
 * READ-ONLY: this probe never touches the document.
 *
 * Select a MIXED set in one go so a single run answers everything:
 *   - a LIVE shape drawn with the shape tool (rectangle / ellipse), NOT converted
 *   - the same shape converted to curves
 *   - a letter converted to curves (something with a hole - O, B, 8)
 *   - a text frame still as live text
 *   - a placed image / pixel layer
 *   - a group containing some of the above
 *
 * Answers, in order:
 *   1. What each node is        -> the type key extract.js will switch on
 *   2. Curves without converting-> does a LIVE ShapeNode give real geometry?
 *   3. Flattening API           -> is there a built-in bezier->polygon, or do we write one?
 *   4. Coordinate space         -> which transform maps curve coords into the spread
 *   5. Raster alpha             -> can we reach pixels for marching squares?
 *   6. Text                     -> confirm it must be refused rather than guessed at
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }
function S(title) { console.log('  -- ' + title + ' --'); }

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

/** Only the members that look callable - the flattening API, if any, is in here. */
function methodsOf(o) {
  var all = members(o), out = [];
  for (var i = 0; i < all.length; i++) {
    var v;
    try { v = o[all[i]]; } catch (e) { continue; }
    if (typeof v === 'function') out.push(all[i] + '/' + v.length);
  }
  return out;
}

/** String(fn) leaks real parameter names - the SDK is a JS shim over a native API. */
function sig(o, name) {
  try {
    var f = o[name];
    if (typeof f !== 'function') return '(not a function)';
    var s = String(f).replace(/\s+/g, ' ');
    return s.slice(0, 160);
  } catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function pt(p) {
  if (!p) return String(p);
  try { return '(' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + ')'; } catch (e) { return '(?)'; }
}

function xfData(t) {
  if (!t) return String(t);
  try {
    var d = t.data;
    if (!d) return 'no .data, members: ' + members(t).slice(0, 14).join(',');
    return '[' + Array.prototype.slice.call(d).map(function (n) { return Number(n).toFixed(4); }).join(', ') + ']';
  } catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function typeKey(node) {
  var tag = safe(function () { return node[Symbol.toStringTag]; });
  var flags = [];
  var names = ['isShapeNode', 'isPolyCurveNode', 'isVectorNode', 'isGroupNode',
               'isPhysicalNode', 'isTextNode', 'isImageNode', 'isPixelNode',
               'isRasterNode', 'isLocked', 'isVisible'];
  for (var i = 0; i < names.length; i++) {
    var v;
    try { v = node[names[i]]; } catch (e) { continue; }
    if (v === true) flags.push(names[i]);
  }
  return tag + '  [' + flags.join(' ') + ']';
}

// ---------------------------------------------------------------------------

/**
 * Section 2+3 for one node: does it hand over curves, and can they be flattened?
 * The question is deliberately NOT "does curvesInterface exist" - a live shape may
 * expose the property and still refuse to produce geometry.
 */
function reportCurves(node) {
  var ci = null;
  L('    curvesInterface', safe(function () {
    ci = node.curvesInterface;
    return ci ? 'present' : String(ci);
  }));
  if (!ci) return;

  L('    ci members', safe(function () { return members(ci).join(', '); }));
  L('    ci.isMutable', safe(function () { return ci.isMutable; }));
  L('    ci.windingOrder', safe(function () {
    var w = ci.windingOrder;
    return (w && w.value !== undefined) ? ('enum .value=' + w.value) : String(w);
  }));

  // polyCurve vs corneredPolyCurve: a live rounded rect bakes its rounding only
  // into the cornered one, so they can disagree on vertex count.
  var which = ['polyCurve', 'corneredPolyCurve'];
  for (var w = 0; w < which.length; w++) {
    (function (key) {
      var pc = null;
      L('    ' + key, safe(function () {
        pc = ci[key];
        if (!pc) return String(pc);
        return 'curveCount=' + pc.curveCount;
      }));
      if (!pc || !pc.curveCount) return;

      L('      pc methods', safe(function () { return methodsOf(pc).join(', '); }));

      var c = null;
      L('      curve[0]', safe(function () {
        c = pc.at(0);
        var n = 0;
        for (var b of c.beziers) { n++; if (n > 5000) break; }
        return 'isClosed=' + c.isClosed + ' bezierCount=' + n;
      }));
      if (!c) return;

      L('      curve methods', safe(function () { return methodsOf(c).join(', '); }));
      L('      first 3 beziers', safe(function () {
        var s = [], n = 0;
        for (var b of c.beziers) {
          s.push(pt(b.start) + '->' + pt(b.end) + ' c1' + pt(b.c1) + ' c2' + pt(b.c2));
          if (++n >= 3) break;
        }
        return s.join(' | ');
      }));

      // The flattening question. If any of these exists we do not write our own
      // adaptive subdivision, and more importantly we inherit Affinity's own
      // idea of "close enough", which will match what the user sees.
      S('flatten candidates on curve[0]');
      var cands = ['generatePolygon', 'toPolygon', 'flatten', 'polygonise', 'polygonize',
                   'getPolygon', 'sample', 'points', 'length', 'getLength', 'arcLength'];
      for (var i = 0; i < cands.length; i++) {
        (function (name) {
          var t;
          try { t = typeof c[name]; } catch (e) { t = 'ERR'; }
          if (t === 'undefined') return;
          console.log('        ' + name + ' : ' + t + (t === 'function' ? '  sig=' + sig(c, name) : ' = ' + safe(function () { return c[name]; })));
        })(cands[i]);
      }
      // Brute-force a call with a tolerance argument - wrong guesses are free and
      // the error message usually names the expected type.
      L('      generatePolygon(0.1)', safe(function () {
        var poly = c.generatePolygon(0.1);
        if (!poly) return String(poly);
        var n = (poly.length !== undefined) ? poly.length
              : (poly.count !== undefined) ? poly.count
              : (poly.pointCount !== undefined) ? poly.pointCount : '?';
        return 'returned ' + (poly[Symbol.toStringTag] || typeof poly) + ' n=' + n +
               ' members=' + members(poly).slice(0, 14).join(',');
      }));
    })(which[w]);
  }
}

/** Section 4 for one node: every candidate for the local -> spread matrix. */
function reportSpace(node) {
  var cands = ['transform', 'baseToSpreadTransform', 'spreadToBaseTransform',
               'localToSpreadTransform'];
  for (var i = 0; i < cands.length; i++) {
    (function (name) {
      var v;
      try { v = node[name]; } catch (e) { L('    ' + name, 'ERR: ' + (e && e.message || e)); return; }
      if (v === undefined) return;
      L('    ' + name, xfData(typeof v === 'function' ? v.call(node) : v));
    })(cands[i]);
  }
  L('    ci.domainTransform', safe(function () { return xfData(node.curvesInterface.domainTransform); }));
  L('    baseBox', safe(function () { var b = node.baseBox; return members(b).slice(0, 10).join(',') + ' -> ' + JSON.stringify(b); }));
  L('    spreadBaseBox', safe(function () { return JSON.stringify(node.spreadBaseBox); }));
  L('    exactSpreadBaseBox', safe(function () { return JSON.stringify(node.exactSpreadBaseBox); }));
}

/** Section 5 for one node: any route from a pixel layer to an alpha value. */
function reportRaster(node) {
  var cands = ['image', 'pixelData', 'getPixelReader', 'pixelReader', 'raster',
               'bitmap', 'surface', 'getImage', 'imageInterface'];
  var any = false;
  for (var i = 0; i < cands.length; i++) {
    var t;
    try { t = typeof node[cands[i]]; } catch (e) { t = 'ERR'; }
    if (t === 'undefined') continue;
    any = true;
    L('    node.' + cands[i], t + (t === 'function' ? ' sig=' + sig(node, cands[i]) : ''));
  }
  if (!any) L('    node raster members', '(none of the guessed names exist)');

  // Modules are the likelier home for a pixel reader than the node itself.
  var mods = ['/image', '/images', '/pixels', '/raster', '/bitmap', '/rendering', '/render'];
  for (var m = 0; m < mods.length; m++) {
    (function (name) {
      var r = safe(function () { return Object.keys(require(name)).join(', '); });
      if (r.indexOf('ERR:') !== 0) L('    require("' + name + '")', r);
    })(mods[m]);
  }
  L('    PixelReaderRGBA8 reachable?', safe(function () {
    var mods2 = ['/image', '/images', '/pixels', '/raster'];
    for (var i = 0; i < mods2.length; i++) {
      try {
        var mm = require(mods2[i]);
        if (mm && mm.PixelReaderRGBA8) return 'yes, in ' + mods2[i] + ' -> ' + methodsOf(mm.PixelReaderRGBA8).join(',');
      } catch (e) { /* module absent */ }
    }
    return 'not found in the modules tried';
  }));
}

function reportNode(node, index, depth) {
  var pad = '';
  for (var d = 0; d < depth; d++) pad += '    ';
  console.log('');
  console.log(pad + '--- node[' + index + '] ' + typeKey(node));
  L(pad + '  description', safe(function () { return node.description; }));
  L(pad + '  defaultDescription', safe(function () { return node.defaultDescription; }));

  var tag = safe(function () { return node[Symbol.toStringTag]; });

  S('all members');
  console.log('    ' + members(node).join(', '));

  S('curves');
  reportCurves(node);

  S('shape (live shapes only)');
  L('    shape', safe(function () {
    var sh = node.shape;
    if (!sh) return String(sh);
    return (sh[Symbol.toStringTag] || 'shape') + ' members=' + members(sh).join(',');
  }));
  L('    shapeInterface', safe(function () {
    var si = node.shapeInterface;
    if (!si) return String(si);
    return 'members=' + members(si).join(',') + ' boundingBox=' + JSON.stringify(si.boundingBox);
  }));

  S('coordinate space');
  reportSpace(node);

  if (tag.indexOf('Text') >= 0) {
    S('text');
    L('    (this node must be REFUSED by extract.js)', 'convert to curves first');
    L('    textInterface?', safe(function () { return typeof node.textInterface; }));
    L('    story?', safe(function () { return typeof node.story; }));
  }

  if (tag.indexOf('Image') >= 0 || tag.indexOf('Pixel') >= 0 || tag.indexOf('Raster') >= 0) {
    S('raster');
    reportRaster(node);
  }
}

function main() {
  console.log('######## probe_shape_sources v0.1.0 ########');

  var doc;
  // app.documents.current, not app.activeDocument - there is no such member.
  try { doc = require('/application').app.documents.current; }
  catch (e) { console.log('Could not reach the document: ' + (e && e.message || e)); return; }
  if (!doc) {
    // Say WHAT is actually there, so a wrong guess diagnoses itself instead of just denying.
    console.log('app.documents.current is ' + String(doc) + '.');
    L('app members', safe(function () { return members(require('/application').app).join(', '); }));
    L('app.documents members', safe(function () { return members(require('/application').app.documents).join(', '); }));
    return;
  }

  H('0. Selection');
  var nodes = [];
  var err = safe(function () {
    var sel = doc.selection;
    for (var n of sel.nodes) nodes.push(n);
    return nodes.length + ' node(s) selected';
  });
  L('selection', err);
  if (!nodes.length) {
    console.log('Select at least one object and run again. See the header for a good mixed set.');
    return;
  }

  H('1-6. Per node');
  for (var i = 0; i < nodes.length; i++) {
    reportNode(nodes[i], i, 0);

    // Groups matter because a dropped word is usually a group of letters.
    var tag = safe(function () { return nodes[i][Symbol.toStringTag]; });
    if (tag === 'GroupNode') {
      S('group children (recursive)');
      var kids = [];
      L('    traverse', safe(function () {
        var nodesMod = require('/nodes');
        var it = nodesMod.getNodeChildrenRecursive(nodes[i].handle, nodesMod.NodeChildType.Main, false);
        for (var c of it) { kids.push(c); if (kids.length > 40) break; }
        return kids.length + ' descendant(s)';
      }));
      for (var k = 0; k < kids.length && k < 6; k++) reportNode(kids[k], i + '.' + k, 1);
      if (kids.length > 6) console.log('    (' + (kids.length - 6) + ' more descendants not dumped)');
    }
  }

  console.log('');
  console.log('######## end ########');
}

main();
