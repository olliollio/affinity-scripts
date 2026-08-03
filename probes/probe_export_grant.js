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
  console.log('  A picker should appear now. Choose a location on your Desktop and name the file');
  console.log('  something like drop_test.png — then the export below is attempted there.');

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

  // --------------------------------------------- 3. does a chosen path export?
  H('3. Exporting to the chosen path');
  var opts = null, area = null;
  L('  options', safe(function () { opts = FEO.createWithPresetName('PNG'); return String(opts); }));
  L('  area', safe(function () { area = docMod.FileExportArea.createForCurrentSpread(); return String(area); }));

  if (opts && area) {
    L('  doc.export(chosen)  <-- THE QUESTION', safe(function () {
      doc.export(chosen, opts, area);
      return 'OK — a file should now exist at the path you chose';
    }));
  }

  // ------------------------------------- 4. can siblings be written beside it?
  H('4. Sibling files in the same folder');
  console.log('  A sequence needs hundreds of files from ONE prompt, so the grant has to extend to');
  console.log('  neighbouring names — otherwise export means one dialog per frame, which is useless.');

  var sibling = String(chosen).replace(/(\.[A-Za-z0-9]+)?$/, '_sibling0001.png');
  L('  sibling path', sibling);
  L('  doc.export(sibling)', safe(function () {
    doc.export(sibling, opts, area);
    return 'OK — the grant covers the folder, so a sequence is possible';
  }));

  console.log('');
  console.log('######## end ########');
}

main();
