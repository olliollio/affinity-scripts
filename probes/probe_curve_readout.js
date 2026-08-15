/**
 * name: probe_curve_readout
 * description: Discovery probe - how do you read points out of a PolygonHandle, and how do you reach an image's pixels?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE closed vector object and, if you can, ONE placed image. Run and copy the
 *        CONSOLE output.
 * READ-ONLY: this probe never touches the document.
 *
 * Follow-up to probe_shape_sources, which settled the big questions and left two gaps:
 *
 *   1. `curve.generatePolygon(tolerance)` returns a `PolygonHandle`. Enumerating its members
 *      came back EMPTY, so it is a native object that does not answer to
 *      getOwnPropertyNames. This probe finds the accessor by trying every shape a handle
 *      collection normally takes. Affinity's own flattener is worth having over a hand-rolled
 *      one: it matches what the user sees on canvas.
 *
 *   2. Raster access was probed under invented names (`pixelData`, `getPixelReader`) and found
 *      nothing. The real ImageNode members are `rasterInterface`, `rasterWidth`, `rasterHeight`,
 *      `rasterFormat`, `pixelSize`, `createCompatibleBuffer`, `createCompatibleBitmap`,
 *      `copyTo`, `imageFilePath`. This probe walks those instead.
 *
 * Also collects the fallback route: reading beziers directly and flattening them ourselves.
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

/**
 * When members() comes back empty the object is native and hiding its shape. The prototype chain,
 * the toStringTag and a raw String() still leak what it is.
 */
function describe(label, o) {
  console.log('  ' + label + ':');
  console.log('    typeof=' + (typeof o) + '  String=' + safe(function () { return String(o); }));
  console.log('    toStringTag=' + safe(function () { return o[Symbol.toStringTag]; }));
  console.log('    ownNames=' + safe(function () { return Object.getOwnPropertyNames(o).join(','); }));
  console.log('    keys=' + safe(function () { return Object.keys(o).join(','); }));
  var chain = [], x = o, guard = 0;
  try {
    while (x && guard++ < 8) {
      x = Object.getPrototypeOf(x);
      if (!x) break;
      chain.push((x.constructor && x.constructor.name) || '?' );
      var names = Object.getOwnPropertyNames(x);
      console.log('    proto[' + (guard - 1) + '] ' + ((x.constructor && x.constructor.name) || '?') +
                  ' -> ' + names.slice(0, 40).join(','));
    }
  } catch (e) { console.log('    proto walk: ERR ' + (e && e.message || e)); }
  console.log('    isIterable=' + safe(function () { return typeof o[Symbol.iterator]; }));
}

/** Every plausible way a native collection exposes its length and its elements. */
function probeCollection(label, coll) {
  describe(label, coll);

  S(label + ': size accessors');
  ['length', 'count', 'size', 'pointCount', 'nodeCount', 'vertexCount', 'numPoints'].forEach(function (k) {
    var v = safe(function () { return coll[k]; });
    if (v !== 'undefined') L('    .' + k, v);
  });

  S(label + ': element accessors');
  ['at', 'get', 'getPoint', 'item', 'point', 'getAt', 'toArray', 'toString'].forEach(function (k) {
    var t = safe(function () { return typeof coll[k]; });
    if (t !== 'undefined' && t !== 'ERR') L('    typeof .' + k, t);
  });

  // Index access, iteration and the named getters, each independently - any one of them working
  // is enough to read the geometry out.
  L('    coll[0]', safe(function () {
    var p = coll[0];
    return p === undefined ? 'undefined' : (String(p) + ' x=' + p.x + ' y=' + p.y);
  }));
  L('    coll.at(0)', safe(function () {
    var p = coll.at(0);
    return String(p) + ' x=' + p.x + ' y=' + p.y;
  }));
  L('    coll.getPoint(0)', safe(function () {
    var p = coll.getPoint(0);
    return String(p) + ' x=' + p.x + ' y=' + p.y;
  }));
  L('    for..of first 3', safe(function () {
    var out = [], n = 0;
    for (var p of coll) {
      out.push('(' + p.x + ',' + p.y + ')');
      if (++n >= 3) break;
    }
    return out.join(' ') + (n ? '' : '(iterated nothing)');
  }));
  L('    Array.from length', safe(function () { return Array.from(coll).length; }));
  L('    spread length', safe(function () { return [].concat(Array.prototype.slice.call(coll)).length; }));
}

function main() {
  console.log('######## probe_curve_readout v0.1.0 ########');

  var doc;
  try { doc = require('/application').app.documents.current; }
  catch (e) { console.log('Could not reach the document: ' + (e && e.message || e)); return; }
  if (!doc) { console.log('No open document.'); return; }

  var nodes = [];
  var selErr = safe(function () {
    for (var n of doc.selection.nodes) nodes.push(n);
    return nodes.length + ' selected';
  });
  L('selection', selErr);
  if (!nodes.length) { console.log('Select something and run again.'); return; }

  // ------------------------------------------------------ 1. the flattener
  H('1. generatePolygon -> PolygonHandle');

  var curve = null, owner = null;
  for (var i = 0; i < nodes.length && !curve; i++) {
    var ci = null;
    try { ci = nodes[i].curvesInterface; } catch (e) { continue; }
    if (!ci) continue;
    try {
      var pc = ci.polyCurve;
      if (pc && pc.curveCount) { curve = pc.at(0); owner = nodes[i]; }
    } catch (e) { /* next node */ }
  }

  if (!curve) {
    console.log('  No selected node yielded a curve. Select a closed vector object.');
  } else {
    L('  taken from', safe(function () { return owner[Symbol.toStringTag] + ' "' + owner.description + '"'; }));
    L('  curve.isClosed', safe(function () { return curve.isClosed; }));
    L('  curve.length', safe(function () { return curve.length; }));

    // Tolerance sweep: the point count tells us what the argument MEANS (points? document units?)
    // and how it trades against fidelity. Our own Douglas-Peucker pass runs after this, so a
    // sensible starting tolerance here saves work downstream.
    S('tolerance sweep');
    [10, 1, 0.5, 0.1, 0.01].forEach(function (tol) {
      L('    generatePolygon(' + tol + ')', safe(function () {
        var poly = curve.generatePolygon(tol);
        var n = 'unknown';
        try { if (poly.length !== undefined) n = poly.length; } catch (e) { /* keep */ }
        try { if (n === 'unknown' && poly.count !== undefined) n = poly.count; } catch (e) { /* keep */ }
        try { if (n === 'unknown') n = Array.from(poly).length; } catch (e) { /* keep */ }
        return String(poly) + '  n=' + n;
      }));
    });

    var poly = null;
    try { poly = curve.generatePolygon(0.1); } catch (e) { /* reported above */ }
    if (poly) probeCollection('PolygonHandle', poly);

    // /geometry may expose the class, which would name the accessor outright.
    S('is the class exported anywhere?');
    ['/geometry', '/shapes', '/curves'].forEach(function (m) {
      var r = safe(function () { return Object.keys(require(m)).join(', '); });
      if (r.indexOf('ERR:') !== 0) L('    require("' + m + '")', r);
    });
    L('    geometry.Polygon members', safe(function () {
      return members(require('/geometry').Polygon).join(', ');
    }));

    // ------------------------------------------- 2. the fallback we control
    H('2. Fallback: read the beziers ourselves');

    // Straight segments are stored as cubics with handles collapsed onto the anchors, and those
    // cubics are not constant-speed, so subdividing by parameter t bunches points at the ends.
    // Worth knowing exactly what arrives before writing an adaptive subdivider.
    L('  curve.points', safe(function () { return String(curve.points); }));
    probeCollection('curve.points', safe(function () { return curve.points; }) === 'ERR' ? null : curve.points);

    L('  curve.getPoint(0)', safe(function () { var p = curve.getPoint(0); return 'x=' + p.x + ' y=' + p.y; }));
    L('  curve.getNode(0)', safe(function () { var n = curve.getNode(0); return String(n) + ' members=' + members(n).join(','); }));
    L('  curve.getCubicBezier(0)', safe(function () {
      var b = curve.getCubicBezier(0);
      return String(b) + ' members=' + members(b).join(',');
    }));
    L('  curve.enumerateNodes(cb)', safe(function () {
      var seen = 0, first = '';
      curve.enumerateNodes(function (n) {
        if (!seen) first = String(n) + ' members=' + members(n).slice(0, 14).join(',');
        seen++;
      });
      return seen + ' node(s); first: ' + first;
    }));

    S('shape classification (cheap wins for extract.js)');
    ['isRectangleTolerance', 'isEllipseTolerance', 'isPolylineTolerance', 'isStraightLineTolerance'].forEach(function (k) {
      L('    ' + k + '(0.5)', safe(function () { return curve[k](0.5); }));
    });
  }

  // ----------------------------------------------------------- 3. raster
  H('3. Raster access (real member names this time)');

  var img = null;
  for (var k = 0; k < nodes.length; k++) {
    var tag = safe(function () { return nodes[k][Symbol.toStringTag]; });
    if (tag === 'ImageNode' || tag === 'PixelNode' || safe(function () { return nodes[k].isImageNode; }) === 'true') {
      img = nodes[k]; break;
    }
  }

  if (!img) {
    console.log('  No image selected. Add a placed image to the selection to answer this part.');
  } else {
    L('  node', safe(function () { return img[Symbol.toStringTag] + ' "' + img.description + '"'; }));
    ['rasterWidth', 'rasterHeight', 'rasterFormat', 'pixelSize', 'imageFilePath',
     'imageFileType', 'imageFileTypeName', 'imageFileSize', 'isKOnly', 'extendType'].forEach(function (k2) {
      L('  ' + k2, safe(function () {
        var v = img[k2];
        return (v && v.value !== undefined) ? ('enum .value=' + v.value) : String(v);
      }));
    });

    describe('rasterInterface', safe(function () { return img.rasterInterface; }) === 'ERR' ? null : img.rasterInterface);
    L('  rasterInterface members', safe(function () { return members(img.rasterInterface).join(', '); }));
    L('  imageResourceInterface members', safe(function () { return members(img.imageResourceInterface).join(', '); }));
    L('  lastRendered', safe(function () { return String(img.lastRendered) + ' members=' + members(img.lastRendered).join(','); }));

    // These three are the likely route to actual pixels: make a buffer, copy into it, read it.
    ['createCompatibleBuffer', 'createCompatibleBitmap', 'copyTo'].forEach(function (k3) {
      L('  ' + k3 + ' sig', safe(function () {
        var f = img[k3];
        if (typeof f !== 'function') return '(not a function: ' + typeof f + ')';
        return 'arity=' + f.length + ' ' + String(f).replace(/\s+/g, ' ').slice(0, 220);
      }));
    });

    L('  createCompatibleBuffer()', safe(function () {
      var b = img.createCompatibleBuffer();
      return String(b) + ' members=' + members(b).slice(0, 24).join(',');
    }));
    L('  createCompatibleBitmap()', safe(function () {
      var b = img.createCompatibleBitmap();
      return String(b) + ' members=' + members(b).slice(0, 24).join(',');
    }));

    S('modules that might hold a pixel reader');
    ['/bitmap', '/bitmaps', '/buffer', '/buffers', '/raster', '/rasters', '/image', '/images',
     '/pixels', '/colours', '/rendering'].forEach(function (m) {
      var r = safe(function () { return Object.keys(require(m)).join(', '); });
      if (r.indexOf('ERR:') !== 0) L('    require("' + m + '")', r);
    });
  }

  console.log('');
  console.log('######## end ########');
}

main();
