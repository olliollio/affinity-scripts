/**
 * name: probe_script_identity
 * description: Discovery probe - filesystem access is granted per script. What identifies a script, and where is the grant kept?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: open a document and run. No selection needed. Copy the CONSOLE output.
 * READ-ONLY apart from one folder-creation attempt on the Desktop.
 *
 * probe_fs_context settled it: `createDirectories` is PERMISSION_DENIED from this script even
 * immediately on the Run stack, with a path identical in shape to the one
 * examples/physicsdrop.js creates successfully on the same machine. Same call, same second,
 * different answer — so the grant is attached to the SCRIPT, not to the call, the path or the
 * timing.
 *
 * That makes the useful questions: what identifies a script to Affinity, and is the grant visible
 * or resettable from here?
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
  console.log('######## probe_script_identity v0.1.0 ########');

  var app;
  try { app = require('/application').app; } catch (e) { console.log('no /application: ' + e); return; }

  // ------------------------------------------------------- 1. app.settings
  H('1. app.settings — is a permission recorded anywhere?');
  L('  typeof', safe(function () { return typeof app.settings; }));
  L('  members', safe(function () { return members(app.settings).join(', '); }));
  L('  keys', safe(function () { return Object.keys(app.settings).join(', '); }));

  // A settings store usually reads by key. Ask for anything permission-shaped.
  ['get', 'getValue', 'value', 'getBool', 'has', 'keys', 'enumerate'].forEach(function (k) {
    var t = safe(function () { return typeof app.settings[k]; });
    if (t !== 'undefined' && t !== 'ERR') L('  settings.' + k, t);
  });
  ['scriptPermissions', 'fileAccess', 'allowFileAccess', 'permissions', 'scripting'].forEach(function (k) {
    var v = safe(function () { return app.settings[k]; });
    if (v !== 'undefined' && v.indexOf('ERR:') !== 0) L('  settings.' + k, v);
  });

  // ----------------------------------------------- 2. what am I, as a script?
  H('2. Does the script know its own identity?');
  // If a script can see its own name or path, that is likely the key the grant hangs on.
  ['scriptName', 'scriptPath', 'currentScript', 'script'].forEach(function (k) {
    var v = safe(function () { return app[k]; });
    if (v !== 'undefined' && v.indexOf('ERR:') !== 0) L('  app.' + k, v);
  });
  L('  globals mentioning script', safe(function () {
    return Object.getOwnPropertyNames(globalThis)
      .filter(function (k) { return /script|module|meta|__/i.test(k); }).join(', ');
  }));
  L('  typeof module', safe(function () { return typeof module; }));
  L('  module keys', safe(function () { return Object.keys(module).join(', '); }));
  L('  module.id / filename', safe(function () { return String(module.id) + ' | ' + String(module.filename); }));
  L('  typeof __filename', safe(function () { return typeof __filename; }));

  // ------------------------------------------- 3. modules that might grant
  H('3. Any permission-shaped module?');
  ['/permissions', '/security', '/scripting', '/script', '/host', '/sandbox', '/settings', '/preferences']
    .forEach(function (m) {
      var r = safe(function () { return Object.keys(require(m)).join(', '); });
      if (r.indexOf('ERR:') !== 0) L('  require("' + m + '")', r);
    });

  // ------------------------------------------------------ 4. confirm the state
  H('4. Confirm this script is still denied');
  L('  createDirectories', safe(function () {
    require('/fs').createDirectories(app.userDesktopPath + '/PDID_check');
    return 'OK — this script IS granted, so something else changed';
  }));

  console.log('');
  console.log('######## end ########');
}

main();
