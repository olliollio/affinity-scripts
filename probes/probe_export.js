/**
 * name: probe_export
 * description: Discovery probe - why does FileExportOptions.createWithPresetName fail, and what export API actually works?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: open a document. A selection is not needed. Run and copy the CONSOLE output.
 * MOSTLY READ-ONLY: the last section attempts ONE real export to the Desktop. Set TRY_EXPORT
 *                   to false to skip it.
 *
 * The v2 exporter, ported from v1.1, fails at:
 *
 *     FileExportOptions.createWithPresetName('PNG')
 *     FileExportArea.createForCurrentSpread()
 *
 * with `Error: ERROR`, which says nothing. Leading suspicion: export PRESETS ARE LOCALISED, so a
 * preset literally named "PNG" need not exist in a non-English install — Affinity is known to
 * localise other user-facing names (`defaultDescription` returns "Abgerundetes Rechteck"). If that
 * is it, the fix is to discover the real preset names rather than hardcode one.
 *
 * Answers, in order:
 *   1. Are the classes even there, and what do they expose?
 *   2. Real parameter names, via String(fn)
 *   3. Which of the two calls actually throws
 *   4. Which preset names are accepted
 *   5. Whether any export succeeds at all
 */

var TRY_EXPORT = true;

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

/** String(fn) leaks the real parameter names - the SDK is a JS shim over a native API. */
function sig(o, name) {
  try {
    var f = o[name];
    if (typeof f !== 'function') return '(not a function: ' + typeof f + ')';
    return 'arity=' + f.length + '  ' + String(f).replace(/\s+/g, ' ').slice(0, 200);
  } catch (e) { return 'ERR: ' + (e && e.message || e); }
}

function main() {
  console.log('######## probe_export v0.1.0 ########');

  var app, doc, docMod;
  try { app = require('/application').app; } catch (e) { console.log('no /application: ' + e); return; }
  doc = app.documents.current;
  if (!doc) { console.log('Open a document first.'); return; }
  try { docMod = require('/document'); } catch (e) { console.log('no /document: ' + e); return; }

  // ------------------------------------------------------ 1. what is exported
  H('1. The /document module');
  L('  exports', safe(function () { return Object.keys(docMod).join(', '); }));

  // v1.1 imports both classes from /document and calls them exactly as v2 does, so a porting
  // mistake is ruled out - which raises the possibility that they have MOVED. Worth knowing before
  // any amount of preset-name guessing.
  console.log('  -- where do these classes actually live? --');
  ['/document', '/documents', '/export', '/exports', '/exporting', '/files', '/io',
   '/application', '/rasterobject', '/rendering'].forEach(function (m) {
    var r = safe(function () {
      var mod = require(m);
      var hits = Object.keys(mod).filter(function (k) { return /export/i.test(k); });
      return hits.length ? hits.join(', ') : '(no export-ish exports)';
    });
    if (r.indexOf('ERR:') !== 0) console.log('    ' + m + ' -> ' + r);
  });
  L('  typeof FileExportOptions', safe(function () { return typeof docMod.FileExportOptions; }));
  L('  typeof FileExportArea', safe(function () { return typeof docMod.FileExportArea; }));
  L('  FileExportOptions members', safe(function () { return members(docMod.FileExportOptions).join(', '); }));
  L('  FileExportArea members', safe(function () { return members(docMod.FileExportArea).join(', '); }));
  L('  FileExportOptions.prototype', safe(function () { return members(docMod.FileExportOptions.prototype).join(', '); }));
  L('  FileExportArea.prototype', safe(function () { return members(docMod.FileExportArea.prototype).join(', '); }));

  // ------------------------------------------------------- 2. what they take
  H('2. Signatures');
  ['createWithPresetName', 'create', 'createWithPreset', 'createDefault'].forEach(function (k) {
    L('  FileExportOptions.' + k, sig(docMod.FileExportOptions, k));
  });
  ['createForCurrentSpread', 'createForSpread', 'createForSelection', 'createForDocument',
   'createForArea', 'create'].forEach(function (k) {
    L('  FileExportArea.' + k, sig(docMod.FileExportArea, k));
  });
  L('  doc.export', sig(doc, 'export'));
  L('  doc members mentioning export', safe(function () {
    return members(doc).filter(function (k) { return /export/i.test(k); }).join(', ');
  }));

  // -------------------------------------------------- 3. which call throws?
  H('3. Which of the two calls fails?');
  L('  FileExportOptions.createWithPresetName("PNG")', safe(function () {
    return String(docMod.FileExportOptions.createWithPresetName('PNG'));
  }));
  L('  FileExportArea.createForCurrentSpread()', safe(function () {
    return String(docMod.FileExportArea.createForCurrentSpread());
  }));

  // ------------------------------------------------ 4. which presets exist?
  H('4. Preset names');
  // If presets are localised, a hardcoded "PNG" cannot work in a German install. Anything that
  // LISTS them is worth far more than any guess.
  L('  a listing API?', safe(function () {
    var hits = members(docMod.FileExportOptions).filter(function (k) {
      return /preset|list|names|all/i.test(k);
    });
    return hits.length ? hits.join(', ') : '(none by name)';
  }));
  L('  doc.exportConfig', safe(function () {
    var c = doc.exportConfig;
    return String(c) + ' members=' + members(c).join(',');
  }));
  L('  exportableInterface', safe(function () {
    var n = doc.selection && doc.selection.nodes;
    for (var x of n) return String(x.exportableInterface) + ' members=' + members(x.exportableInterface).join(',');
    return '(no selection to inspect)';
  }));

  // Brute force. A factory is cheap to call and its failures are free.
  var candidates = [
    'PNG', 'png', 'JPEG', 'jpeg', 'JPG', 'jpg',
    'PNG-24', 'PNG 24', 'PNG-8', 'JPEG (Beste Qualität)', 'JPEG (best quality)',
    'PNG (Flatten)', 'TIFF', 'GIF', 'WEBP', 'PDF', 'SVG', 'EPS',
    'Default', 'Standard'
  ];
  console.log('  -- preset name attempts --');
  var accepted = [];
  for (var i = 0; i < candidates.length; i++) {
    (function (nm) {
      var r = safe(function () {
        var v = docMod.FileExportOptions.createWithPresetName(nm);
        return v ? 'OK ' + String(v) : String(v);
      });
      if (r.indexOf('ERR:') !== 0) accepted.push(nm);
      console.log('    ' + JSON.stringify(nm) + ' -> ' + r);
    })(candidates[i]);
  }
  L('  accepted', accepted.length ? accepted.join(', ') : '(none)');

  // ------------------------------------------------------- 5. does it export?
  H('5. A real export attempt');
  if (!TRY_EXPORT) {
    console.log('  skipped (TRY_EXPORT = false)');
  } else if (!accepted.length) {
    console.log('  skipped: no preset name was accepted, so there is nothing to export with.');
  } else {
    var path = safe(function () { return app.userDesktopPath + '/physicsdrop_export_test.' +
      (accepted[0].toLowerCase().indexOf('jp') >= 0 ? 'jpg' : 'png'); });
    L('  path', path);
    L('  export result', safe(function () {
      var opts = docMod.FileExportOptions.createWithPresetName(accepted[0]);
      var area = docMod.FileExportArea.createForCurrentSpread();
      doc.export(path, opts, area);
      return 'OK — check your Desktop for the file';
    }));
  }

  console.log('');
  console.log('######## end ########');
}

main();
