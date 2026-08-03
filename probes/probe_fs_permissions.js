/**
 * name: probe_fs_permissions
 * description: Discovery probe - /fs exists but denies every path. Is there a grant mechanism, or is filesystem access simply off?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: no selection needed, no document needed. Just run and copy the CONSOLE output.
 * MOSTLY READ-ONLY: the last section attempts one directory create and removes it again.
 *                   Set TRY_WRITES = false to skip it.
 *
 * Context: probe_planck_smoke found that /fs throws PERMISSION_DENIED for EVERY path -
 * E:\, C:\, app.userDesktopPath itself, and \\wsl.localhost UNC paths alike. Even exists()
 * and getFileSize() are refused. So this is a blanket capability gate, not a per-path ACL,
 * and naming a better path will not help.
 *
 * Answers, in order:
 *   1. Enum values       -> FileOrigin / FilePermissions / PermOptions / PathType name the model
 *   2. Function shapes   -> String(fn) leaks real parameter names; do any take an origin or a
 *                           permission argument rather than a bare path?
 *   3. Alternate entries -> fs.fs, fs.promises, FileSystemApi, Directory, File.prototype
 *   4. Path forms        -> is ANY path accepted: relative, bare filename, script-relative,
 *                           app-provided paths, a directory rather than a file
 *   5. Where a grant might come from -> app members, other modules, a file picker
 *   6. Writes            -> is the gate read-specific or total?
 *
 * If everything here is denied too, the answer is that the dev loader is not possible and the
 * release build must inline its libraries - which probe_vendor_size already proved works.
 */

var TRY_WRITES = true;

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

/** Enum objects in this SDK carry .value; dumping name -> value shows the model's vocabulary. */
function dumpEnum(label, obj) {
  if (!obj) { L('  ' + label, String(obj)); return; }
  var names = members(obj), pairs = [];
  for (var i = 0; i < names.length; i++) {
    var k = names[i];
    if (k === 'prototype' || k === 'length' || k === 'name' || k === 'caller' ||
        k === 'arguments' || k === 'apply' || k === 'bind' || k === 'call') continue;
    var v;
    try { v = obj[k]; } catch (e) { continue; }
    if (v === null || v === undefined) { pairs.push(k + '=' + String(v)); continue; }
    if (typeof v === 'function') { pairs.push(k + '()'); continue; }
    if (typeof v === 'object') {
      pairs.push(k + '=' + (v.value !== undefined ? v.value : JSON.stringify(members(v).slice(0, 6))));
      continue;
    }
    pairs.push(k + '=' + String(v));
  }
  L('  ' + label, pairs.join(', ') || '(no readable members)');
}

/** The SDK is a JS shim over a native API, so String(fn) leaks the real parameter names. */
function dumpSig(label, o, name) {
  var f;
  try { f = o[name]; } catch (e) { L('  ' + label, 'ERR: ' + (e && e.message || e)); return; }
  if (typeof f !== 'function') { L('  ' + label, '(not a function: ' + typeof f + ')'); return; }
  L('  ' + label, 'arity=' + f.length + '  ' + String(f).replace(/\s+/g, ' ').slice(0, 200));
}

function main() {
  console.log('######## probe_fs_permissions v0.1.0 ########');

  var fsys;
  try { fsys = require('/fs'); } catch (e) { console.log('require("/fs") threw: ' + e); return; }

  // ------------------------------------------------------------ 1. the vocabulary
  H('1. Enum values - what does the permission model talk about?');
  dumpEnum('FileOrigin', fsys.FileOrigin);
  dumpEnum('FilePermissions', fsys.FilePermissions);
  dumpEnum('PermOptions', fsys.PermOptions);
  dumpEnum('PathType', fsys.PathType);
  dumpEnum('CopyOptions', fsys.CopyOptions);
  dumpEnum('FileStatus', fsys.FileStatus);

  // ------------------------------------------------------------ 2. what they take
  H('2. Function shapes - does anything accept an origin or a permission?');
  dumpSig('File.readAll', fsys.File, 'readAll');
  dumpSig('File.readAllAsync', fsys.File, 'readAllAsync');
  dumpSig('File.size', fsys.File, 'size');
  dumpSig('File (as ctor)', fsys, 'File');
  dumpSig('exists', fsys, 'exists');
  dumpSig('getFileSize', fsys, 'getFileSize');
  dumpSig('getAbsolute', fsys, 'getAbsolute');
  dumpSig('getCanonical', fsys, 'getCanonical');
  dumpSig('setFilePermissions', fsys, 'setFilePermissions');
  dumpSig('createDirectories', fsys, 'createDirectories');
  L('  File.prototype members', safe(function () { return members(fsys.File.prototype).join(', '); }));
  L('  Directory members', safe(function () { return members(fsys.Directory).join(', '); }));
  L('  DirectoryIterator members', safe(function () { return members(fsys.DirectoryIterator).join(', '); }));

  // ------------------------------------------------------ 3. other ways in
  H('3. Alternate entry points');
  L('  typeof fs.fs', safe(function () { return typeof fsys.fs; }));
  L('  fs.fs members', safe(function () { return members(fsys.fs).join(', '); }));
  L('  typeof fs.promises', safe(function () { return typeof fsys.promises; }));
  L('  fs.promises members', safe(function () { return members(fsys.promises).join(', '); }));
  L('  FileSystemApi members', safe(function () { return members(fsys.FileSystemApi).join(', '); }));
  L('  FileSystemPromises members', safe(function () { return members(fsys.FileSystemPromises).join(', '); }));
  // If FileSystemApi is constructible it may take a scope or an origin.
  dumpSig('  FileSystemApi ctor', fsys, 'FileSystemApi');
  L('  new FileSystemApi()', safe(function () {
    var a = new fsys.FileSystemApi();
    return 'constructed, members: ' + members(a).slice(0, 20).join(', ');
  }));

  // ---------------------------------------------------------- 4. path forms
  H('4. Is ANY path form accepted?');
  var app = null;
  try { app = require('/application').app; } catch (e) { /* reported below */ }
  var desktop = app ? safe(function () { return app.userDesktopPath; }) : '(no app)';

  var forms = [
    ['bare filename', 'planck.min.js'],
    ['relative', './planck.min.js'],
    ['relative parent', '../planck.min.js'],
    ['dot', '.'],
    ['empty string', ''],
    ['forward-slash drive', 'E:/USER/Desktop'],
    ['desktop path itself', desktop],
    ['temp-ish', 'C:\\Windows\\Temp'],
    ['posix root', '/'],
    ['posix tmp', '/tmp']
  ];
  for (var i = 0; i < forms.length; i++) {
    (function (label, p) {
      if (p === undefined || String(p).indexOf('ERR:') === 0) return;
      // getAbsolute / getCanonical are pure path maths in most implementations. If THEY are
      // denied too, the gate sits in front of the whole module rather than in front of I/O.
      var abs = safe(function () { return fsys.getAbsolute(p); });
      var ex = safe(function () { return fsys.exists(p); });
      console.log('  ' + label + ' [' + p + ']');
      console.log('    getAbsolute=' + abs);
      console.log('    exists=' + ex);
    })(forms[i][0], forms[i][1]);
  }

  // ------------------------------------------------- 5. where could a grant come from?
  H('5. Where might a grant come from?');
  L('  app members', app ? safe(function () { return members(app).join(', '); }) : '(no /application)');
  var pathish = ['userDesktopPath', 'userDocumentsPath', 'userHomePath', 'scriptPath',
                 'scriptsPath', 'applicationPath', 'temporaryPath', 'userDataPath'];
  for (var k = 0; k < pathish.length; k++) {
    (function (name) {
      if (!app) return;
      var v;
      try { v = app[name]; } catch (e) { return; }
      if (v === undefined) return;
      L('  app.' + name, String(v));
    })(pathish[k]);
  }

  // A file picker is the usual way a sandboxed host hands out a grant.
  var mods = ['/dialogs', '/dialog', '/ui', '/interface', '/panels', '/files', '/filesystem',
              '/io', '/permissions', '/security', '/scripting', '/scripts', '/host'];
  for (var m = 0; m < mods.length; m++) {
    (function (name) {
      var r = safe(function () { return Object.keys(require(name)).join(', '); });
      if (r.indexOf('ERR:') !== 0) L('  require("' + name + '")', r);
    })(mods[m]);
  }

  // The document knows its own file - if a saved document yields a readable path, then a
  // path that came from the HOST is trusted while a path we typed is not. That distinction
  // is exactly what FileOrigin would encode.
  H('5b. Does a host-provided path behave differently?');
  L('  activeDocument members', safe(function () {
    return members(require('/application').app.activeDocument).join(', ');
  }));
  var docPathNames = ['fileName', 'filePath', 'path', 'url', 'location', 'file'];
  for (var d = 0; d < docPathNames.length; d++) {
    (function (name) {
      var v = safe(function () { return require('/application').app.activeDocument[name]; });
      if (v === 'undefined' || v.indexOf('ERR:') === 0) return;
      L('  activeDocument.' + name, v);
      L('    exists() on it', safe(function () { return fsys.exists(v); }));
    })(docPathNames[d]);
  }

  // --------------------------------------------------------------- 6. writes
  H('6. Are writes denied too, or only reads?');
  if (!TRY_WRITES) {
    console.log('  skipped (TRY_WRITES = false)');
  } else {
    var target = (desktop && desktop.indexOf('ERR:') !== 0)
      ? desktop + '\\affinity_probe_tmp'
      : 'C:\\Windows\\Temp\\affinity_probe_tmp';
    L('  target', target);
    L('  createDirectories', safe(function () { return fsys.createDirectories(target); }));
    L('  exists after create', safe(function () { return fsys.exists(target); }));
    L('  remove (cleanup)', safe(function () { return fsys.remove(target); }));
  }

  console.log('');
  console.log('######## end ########');
}

main();
