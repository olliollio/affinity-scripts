/**
 * name: probe_fs_context
 * description: Discovery probe - v1.1 creates an export folder successfully and v2 does not, with the same path. Why?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: open a document and run. No selection needed. Copy the CONSOLE output.
 * WRITES: attempts to create up to four empty folders on your Desktop, named PDCTX_*.
 *         Delete them afterwards; nothing else is touched.
 *
 * examples/physicsdrop.js creates `E:\USER\Desktop/Gravity_20260803_133101` and exports 78
 * frames into it. gravity v2 builds a string of exactly the same shape and gets
 * PERMISSION_DENIED from `createDirectories`. The path is therefore NOT the difference, so
 * something about the CONTEXT of the call is.
 *
 * Candidates, in order of suspicion:
 *
 *   1. WHEN it is called. v1.1 reaches it while the script's original run is still on the stack.
 *      v2 reaches it much later, from a timer callback, after two modal dialogs have opened and
 *      closed. A sandbox may only honour filesystem calls that are still traceable to the user's
 *      Run action.
 *   2. HOW the path is built. `padStart` versus a hand-rolled pad, template literal versus
 *      concatenation - all should be identical strings, but this prints them side by side so
 *      "identical" is verified rather than assumed.
 *   3. WHICH root. The Desktop may differ from Documents.
 *
 * Section 1 runs immediately, on the same stack as the user's Run. Section 2 repeats the exact
 * same call from a timer. If 1 succeeds and 2 fails, the answer is timing, and the fix is to
 * create the folder up front rather than when the export starts.
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

var app, fsys;
try { app = require('/application').app; } catch (e) { console.log('no /application: ' + e); }
try { fsys = require('/fs'); } catch (e) { console.log('no /fs: ' + e); }

function p2(v) { return String(v).padStart(2, '0'); }

/** v1.1's construction, character for character. */
function v11Path(tag) {
  var desk = app.userDesktopPath;
  var st = new Date();
  return desk + '/PDCTX_' + tag + '_' + st.getFullYear() + p2(st.getMonth() + 1) + p2(st.getDate()) +
         '_' + p2(st.getHours()) + p2(st.getMinutes()) + p2(st.getSeconds());
}

function tryCreate(label, path) {
  console.log('  ' + label);
  console.log('    path: ' + path);
  var created = safe(function () {
    fsys.createDirectories(path);
    return 'createDirectories returned without throwing';
  });
  console.log('    create: ' + created);
  var isDir = safe(function () {
    var v = fsys.isDirectory(path);
    return typeof v + ' ' + String(v) + '  (truthy=' + (!!v) + ')';
  });
  console.log('    isDirectory: ' + isDir);
  return created.indexOf('ERR:') !== 0;
}

function main() {
  console.log('######## probe_fs_context v0.1.0 ########');
  if (!app || !fsys) { console.log('missing modules, cannot continue'); return; }

  // -------------------------------------- 1. immediately, on the user's stack
  H('1. Right now, still on the Run stack');
  L('  userDesktopPath', safe(function () { return app.userDesktopPath; }));

  var immediate = v11Path('immediate');
  var okImmediate = tryCreate('v1.1-style path, called immediately', immediate);

  // Same target, built by v2's own helper style, to prove the strings match.
  var desk = safe(function () { return app.userDesktopPath; });
  var handRolled = desk + '/' + 'PDCTX_handrolled_' + '20260803_134933';
  tryCreate('v2-style concatenation', handRolled);

  console.log('    strings identical in shape: ' +
    (immediate.indexOf(desk + '/PDCTX_') === 0 && handRolled.indexOf(desk + '/PDCTX_') === 0));

  // ------------------------------------------------------- 3. a different root
  H('2. A different root');
  var docs = String(desk).replace(/Desktop$/, 'Dokumente');
  tryCreate('Documents instead of Desktop', docs + '/PDCTX_docs');

  // ------------------------------------------------ 2. later, from a timer
  H('3. The same call, from a timer callback');
  console.log('  This is where v2 does it: after the sim, after playback, after two dialogs.');
  console.log('  If this fails while section 1 succeeded, the sandbox only honours filesystem');
  console.log('  calls still traceable to the user pressing Run - and the fix is to create the');
  console.log('  folder up front, before any of that.');

  var timers = null;
  try { timers = require('/timers'); } catch (e) { console.log('  no /timers: ' + e); }

  if (timers) {
    var fired = false;
    timers.setInterval(50, function (err) {
      if (fired) return;
      fired = true;
      try { timers.Timer.cancelAll(); } catch (e) { /* already gone */ }

      console.log('');
      console.log('  -- inside the timer callback --');
      var okTimer = tryCreate('v1.1-style path, from a timer', v11Path('timer'));

      console.log('');
      console.log('  VERDICT: immediate=' + (okImmediate ? 'OK' : 'DENIED') +
                  '  timer=' + (okTimer ? 'OK' : 'DENIED'));
      if (okImmediate && !okTimer) {
        console.log('  => timing is the answer. Create the folder before the simulation runs.');
      } else if (okImmediate && okTimer) {
        console.log('  => both work, so the difference is elsewhere in v2. Paths above are the clue.');
      } else {
        console.log('  => neither works from this script, while examples/physicsdrop.js does the');
        console.log('     same thing successfully. That points at per-script permission rather');
        console.log('     than per-call: this script may simply not be granted.');
      }
      console.log('');
      console.log('  Delete any PDCTX_* folders from your Desktop afterwards.');
      console.log('######## end ########');
    });
  }
}

main();
