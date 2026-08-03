/**
 * name: probe_export_grant
 * description: Discovery probe - doc.export is PERMISSION_DENIED. Does a user-picked path lift that?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: open a document and run. A file picker WILL appear - choose somewhere on your Desktop.
 *        Copy the CONSOLE output afterwards.
 * WRITES: this probe attempts to write ONE image file, to a path you choose.
 *
 * probe_export established that the export API itself is fine — "PNG" is a valid preset,
 * FileExportArea.createForCurrentSpread() works — but `doc.export` to a path we composed ourselves
 * returns PERMISSION_DENIED, exactly like `/fs`. So `doc.export` is gated by the same sandbox
 * policy rather than exempt from it.
 *
 * `app.chooseFile` / `chooseFileAsync` are the outstanding lead: in a capability sandbox, a path
 * the USER picks arrives pre-authorised, while one the script composes does not. If a chosen path
 * exports successfully, the image sequence is possible — the user picks a location once and every
 * frame is written beside it. If it is still denied, export is impossible in this sandbox and the
 * feature should be dropped rather than left as a button that always fails.
 *
 * Answers, in order:
 *   1. The real preset names, instead of the 19 spellings guessed last time
 *   2. chooseFile's signature and what it returns
 *   3. Whether exporting to a chosen path is permitted
 *   4. Whether the chosen path's FOLDER can be reused for sibling files, which is what a sequence
 *      needs — one prompt, not three hundred
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

function sig(o, name) {
  try {
    var f = o[name];
    if (typeof f !== 'function') return '(not a function: ' + typeof f + ')';
    return 'arity=' + f.length + '  ' + String(f).replace(/\s+/g, ' ').slice(0, 260);
  } catch (e) { return 'ERR: ' + (e && e.message || e); }
}

function main() {
  console.log('######## probe_export_grant v0.1.0 ########');

  var app, doc, docMod;
  try { app = require('/application').app; } catch (e) { console.log('no /application: ' + e); return; }
  doc = app.documents.current;
  if (!doc) { console.log('Open a document first.'); return; }
  try { docMod = require('/document'); } catch (e) { console.log('no /document: ' + e); return; }

  // --------------------------------------------------- 1. the real preset names
  H('1. Preset names, asked rather than guessed');
  var FEO = docMod.FileExportOptions;
  L('  allPresetNames (as property)', safe(function () {
    var v = FEO.allPresetNames;
    return typeof v + '  ' + String(v) + '  len=' + (v && v.length);
  }));
  L('  allPresetNames() (as call)', safe(function () { return String(FEO.allPresetNames()); }));
  L('  enumeratePresetNames sig', sig(FEO, 'enumeratePresetNames'));
  L('  allPresetNames sig', sig(FEO, 'allPresetNames'));

  L('  listed presets', safe(function () {
    var got = [];
    var v = FEO.allPresetNames;
    if (typeof v === 'function') v = FEO.allPresetNames();
    if (v && typeof v.length === 'number') {
      for (var i = 0; i < v.length; i++) got.push(String(typeof v.at === 'function' ? v.at(i) : v[i]));
    } else if (v) {
      for (var s of v) got.push(String(s));
    }
    return got.length ? got.join(' | ') : '(nothing enumerable)';
  }));
  L('  via callback', safe(function () {
    var got = [];
    FEO.enumeratePresetNames(function (n) { got.push(String(n)); });
    return got.length ? got.join(' | ') : '(callback yielded nothing)';
  }));

  // ------------------------------------------------------ 2. the file picker
  H('2. app.chooseFile');
  L('  chooseFile sig', sig(app, 'chooseFile'));
  L('  chooseFileAsync sig', sig(app, 'chooseFileAsync'));

  console.log('');
  console.log('  A picker should appear now. It is an OPEN dialog, so pick any EXISTING file that');
  console.log('  sits in the folder you would want frames written to.');
  console.log('');
  console.log('  The file you pick is NEVER written to. Only new files named physicsdrop_probe_*');
  console.log('  beside it are attempted — which is also the real question, since a sequence needs');
  console.log('  hundreds of files from a single prompt.');

  var chosen = null;
  var attempts = [
    ['chooseFile()', function () { return app.chooseFile(); }],
    ['chooseFile(true)', function () { return app.chooseFile(true); }],
    ['chooseFile("png")', function () { return app.chooseFile('png'); }],
    ['chooseFile({})', function () { return app.chooseFile({}); }]
  ];
  for (var a = 0; a < attempts.length && !chosen; a++) {
    var r = safe(attempts[a][1]);
    L('  ' + attempts[a][0], r);
    if (r.indexOf('ERR:') !== 0 && r !== 'undefined' && r !== 'null' && r !== '') {
      chosen = r;
      break;   // one prompt is enough; do not pester
    }
  }

  if (!chosen) {
    console.log('');
    console.log('  No path came back. Either the picker was cancelled or the signature differs —');
    console.log('  the attempt log above shows what each call did.');
    console.log('######## end ########');
    return;
  }

  L('  chosen path', chosen);

  // The picked file is never touched. Everything below writes NEW names in its folder, which is
  // both the safe thing to do and the actual question: a sequence needs many files from one grant.
  var sep = String(chosen).lastIndexOf('\\') >= 0 ? '\\' : '/';
  var folder = String(chosen).slice(0, String(chosen).lastIndexOf(sep));
  L('  folder', folder || '(could not derive a folder)');

  // -------------------------------------- 3. does the grant cover NEW siblings?
  H('3. Writing new files in the chosen folder');
  var opts = null, area = null;
  L('  options', safe(function () { opts = FEO.createWithPresetName('PNG'); return String(opts); }));
  L('  area', safe(function () { area = docMod.FileExportArea.createForCurrentSpread(); return String(area); }));

  if (!opts || !area || !folder) {
    console.log('  cannot continue without options, area and a folder.');
    console.log('######## end ########');
    return;
  }

  var first = folder + sep + 'physicsdrop_probe_0001.png';
  L('  path', first);
  L('  doc.export  <-- THE QUESTION', safe(function () {
    doc.export(first, opts, area);
    return 'OK — a user-picked location lifts PERMISSION_DENIED';
  }));

  // ------------------------------------- 4. a second file, from the same grant
  H('4. A second file, without another prompt');
  console.log('  If this also succeeds the grant covers the folder and a sequence is possible.');
  console.log('  If only the first worked, the grant is per-file and export is not worth shipping.');

  var second = folder + sep + 'physicsdrop_probe_0002.png';
  L('  path', second);
  L('  doc.export', safe(function () {
    doc.export(second, opts, area);
    return 'OK — the grant covers the folder, so a sequence is possible';
  }));

  console.log('');
  console.log('  Delete physicsdrop_probe_0001.png / _0002.png afterwards; they are throwaway.');

  console.log('');
  console.log('######## end ########');
}

main();
