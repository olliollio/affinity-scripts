/**
 * name: probe_export_last
 * description: Last check - can a document export ANYWHERE? Its own folder, an existing file, or asynchronously?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: open a SAVED document (one with a file on disk, not an unsaved new one).
 *        Before running, create a throwaway file on your Desktop named exactly:
 *            physicsdrop_overwrite_me.png
 *        (right-click > New > ... or copy any png and rename it). It WILL be overwritten.
 *        Then run and copy the CONSOLE output.
 * WRITES: only to the document's own folder and to that one throwaway file.
 *
 * Everything so far says export is walled off: `doc.export` to a composed path is
 * PERMISSION_DENIED, and probe_export_grant showed that a folder reached via `app.chooseFile` is
 * denied too. Three possibilities remain, and this settles all of them at once:
 *
 *   1. The DOCUMENT'S OWN FOLDER is granted. Sandboxes commonly allow writing beside the file the
 *      user already opened. If so, a sequence works: frames land next to the .af document.
 *   2. The grant is PER-FILE, covering only a path that already exists and was picked. Then export
 *      needs one dialog per frame, which is useless for a sequence.
 *   3. `exportAsync` goes through a different permission path than `export`.
 *
 * If all three fail, image-sequence export is not possible in this sandbox and the feature should
 * be removed rather than shipped as a button that always fails.
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

function main() {
  console.log('######## probe_export_last v0.1.0 ########');

  var app, doc, docMod;
  try { app = require('/application').app; } catch (e) { console.log('no /application: ' + e); return; }
  doc = app.documents.current;
  if (!doc) { console.log('Open a document first.'); return; }
  try { docMod = require('/document'); } catch (e) { console.log('no /document: ' + e); return; }

  var opts = null, area = null;
  try {
    opts = docMod.FileExportOptions.createWithPresetName('PNG');
    area = docMod.FileExportArea.createForCurrentSpread();
  } catch (e) { console.log('could not build export options/area: ' + e); return; }

  // --------------------------------------------- 1. where does this document live?
  H('1. The document own path');
  L('  doc members mentioning path/file/url', safe(function () {
    return members(doc).filter(function (k) { return /path|file|url|name|location|save/i.test(k); }).join(', ');
  }));
  ['fileName', 'filePath', 'path', 'url', 'location', 'file', 'name', 'documentPath', 'savePath']
    .forEach(function (k) {
      var v = safe(function () { return doc[k]; });
      if (v !== 'undefined' && v.indexOf('ERR:') !== 0) L('  doc.' + k, v);
    });

  // ------------------------------------- 2. export beside the document itself
  H('2. Export into the document own folder');
  var docPath = null;
  ['filePath', 'path', 'fileName', 'url'].forEach(function (k) {
    if (docPath) return;
    var v = null;
    try { v = doc[k]; } catch (e) { return; }
    if (typeof v === 'string' && v.length > 3 && /[\\/]/.test(v)) docPath = v;
  });

  if (!docPath) {
    console.log('  The document does not report a path — save it first, or it is unsaved.');
  } else {
    var sep = docPath.lastIndexOf('\\') >= 0 ? '\\' : '/';
    var folder = docPath.slice(0, docPath.lastIndexOf(sep));
    L('  document folder', folder);
    var beside = folder + sep + 'physicsdrop_probe_beside.png';
    L('  path', beside);
    L('  doc.export  <-- best remaining hope', safe(function () {
      doc.export(beside, opts, area);
      return 'OK — the document folder is writable, so a sequence works';
    }));
  }

  // ------------------------------- 3. an existing file, chosen by the user
  H('3. Overwriting a file that already exists');
  console.log('  If only an existing, user-picked path is writable, the grant is per-file and a');
  console.log('  sequence would need one dialog per frame.');
  var desk = safe(function () { return app.userDesktopPath; });
  if (desk.indexOf('ERR:') !== 0) {
    var throwaway = desk + '\\physicsdrop_overwrite_me.png';
    L('  path (must already exist)', throwaway);
    L('  doc.export', safe(function () {
      doc.export(throwaway, opts, area);
      return 'OK — an existing path is writable';
    }));
  }

  // ------------------------------------------------- 4. the async variant
  H('4. exportAsync');
  L('  doc.exportAsync sig', safe(function () {
    var f = doc.exportAsync;
    return typeof f === 'function' ? ('arity=' + f.length + ' ' + String(f).replace(/\s+/g, ' ').slice(0, 200)) : String(f);
  }));
  if (desk.indexOf('ERR:') !== 0) {
    L('  exportAsync to Desktop', safe(function () {
      doc.exportAsync(desk + '\\physicsdrop_probe_async.png', opts, area, function (err) {
        console.log('    async callback: ' + (err ? ('ERR ' + err) : 'OK — async is permitted'));
      });
      return 'call accepted; watch for the callback line above';
    }));
  }

  console.log('');
  console.log('  Delete any physicsdrop_probe_* files afterwards.');
  console.log('######## end ########');
}

main();
