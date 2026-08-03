/**
 * name: probe_planck_smoke
 * description: Discovery probe - can the sandbox load planck.js 1.5.0 from disk, step a world, and take a raised polygon-vertex cap?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: no selection needed, no document needed. Just run and copy the CONSOLE output.
 * READ-ONLY: this probe never touches the document. It only reads files.
 *
 * Answers, in order:
 *   1. /fs read surface   -> the surface itself; File.readAll(path) is the read call
 *   2. Permitted roots    -> WHERE the sandbox allows reads, which decides where the
 *                            dev loader and build output can live
 *   3. planck loads       -> does the 297KB UMD bundle eval and export?
 *   4. maxPolygonVertices -> default value, and does raising it stick?
 *   5. World steps        -> ground Chain + compound dynamic body, 180 steps, comes to rest?
 *   6. Throughput         -> ms per step for a 300-body pile, i.e. is real-time viable?
 *
 * Sections 3-6 are skipped if the read fails; the root scan still reports, which is
 * what tells us how to fix it.
 *
 * Reads from a dev tree staged at Desktop\gravity-dev\. Paths into the WSL share
 * (\\wsl.localhost\...) come back PERMISSION_DENIED - the sandbox resolves them and
 * then refuses, so this is policy about location, not a path-syntax problem.
 */

// ---------------------------------------------------------------------------
// Path relative to the Desktop. The dev tree is staged there because UNC paths
// into the WSL share come back PERMISSION_DENIED - the sandbox resolves them and
// then refuses, so no path syntax fixes it.
var DESKTOP_RELATIVE = 'gravity-dev/vendor/planck.min.js';

// Extra absolute paths to try after the Desktop one. Leave empty for none.
var CANDIDATE_PATHS = [];
// ---------------------------------------------------------------------------

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

/**
 * Try every plausible shape of "read this whole file as text" and report which
 * one worked. The member names are known from probe_vendor_lib; what was never
 * confirmed is that any of them can be CALLED successfully.
 */
/**
 * `File.readAll(path)` is a static on File, confirmed by call. There is no free
 * `fs.readFile`, and File has no `open` / `create` / `readText`.
 */
function tryRead(path) {
  var fsys;
  try { fsys = require('/fs'); } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  try {
    var v = fsys.File.readAll(path);
    if (typeof v === 'string' && v.length > 0) return { ok: true, how: 'File.readAll', text: v };
    // A non-string result is still information - a byte buffer would need decoding.
    return { ok: false, err: 'returned ' + (typeof v) + ' ' + members(v).slice(0, 12).join(',') };
  } catch (e) {
    return { ok: false, err: (e && e.message ? e.message : String(e)) };
  }
}

/**
 * Which roots is the sandbox willing to touch at all?
 *
 * The UNC attempts failed with PERMISSION_DENIED rather than a not-found error, so
 * the refusal is policy about WHERE, not about the path being wrong. Mapping the
 * permitted roots is what decides where the dev loader and build output can live.
 */
function probeRoots(desktop) {
  var fsys;
  try { fsys = require('/fs'); } catch (e) { return; }

  var roots = [
    ['Desktop', desktop],
    ['Desktop dev tree', desktop + '\\gravity-dev'],
    ['Documents', desktop.replace(/Desktop$/, 'Dokumente')],
    ['user home', desktop.replace(/\\Desktop$/, '')],
    ['E:\\', 'E:\\'],
    ['C:\\', 'C:\\'],
    ['C:\\Users', 'C:\\Users'],
    ['WSL UNC share root', '\\\\wsl.localhost\\Ubuntu-22.04'],
    ['WSL UNC home', '\\\\wsl.localhost\\Ubuntu-22.04\\home\\ollio']
  ];

  for (var i = 0; i < roots.length; i++) {
    (function (label, p) {
      var ex = safe(function () { return fsys.exists(p); });
      var dir = safe(function () { return fsys.isDirectory(p); });
      console.log('  ' + label + '  [' + p + ']');
      console.log('    exists=' + ex + '  isDirectory=' + dir);
    })(roots[i][0], roots[i][1]);
  }
}

function main() {
  console.log('######## probe_planck_smoke v0.1.0 ########');

  // -------------------------------------------------------- 1. /fs read surface
  H('1. /fs read surface');
  L('require("/fs") keys', safe(function () { return Object.keys(require('/fs')).join(', '); }));
  L('/fs module members', safe(function () { return members(require('/fs')).join(', '); }));
  L('/fs.File members', safe(function () { return members(require('/fs').File).join(', '); }));
  L('app.userDesktopPath', safe(function () { return require('/application').app.userDesktopPath; }));

  // ------------------------------------------------- 2. what may we read at all
  H('2. Which roots does the sandbox permit?');
  var desk = safe(function () { return require('/application').app.userDesktopPath; });
  if (desk.indexOf('ERR:') === 0) { console.log('No Desktop path: ' + desk); return; }
  probeRoots(desk);

  H('2b. Reading planck');
  var paths = [
    desk + '\\' + DESKTOP_RELATIVE.split('/').join('\\'),
    desk + '/' + DESKTOP_RELATIVE
  ].concat(CANDIDATE_PATHS);

  var src = null, srcPath = null;
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    L('  path[' + i + ']', p);
    // getFileSize is a cheaper permission answer than pulling 297KB across.
    L('    size', safe(function () { return require('/fs').getFileSize(p); }));
    var r = tryRead(p);
    L('    read', r.ok ? (r.text.length + ' chars via ' + r.how) : ('failed: ' + r.err));
    if (r.ok) { src = r.text; srcPath = p; break; }
  }

  if (!src) {
    console.log('');
    console.log('  planck could not be read. The root scan above says where we ARE allowed.');
    console.log('######## end (sections 3-6 skipped) ########');
    return;
  }

  L('chosen path', srcPath);
  L('source head', JSON.stringify(src.slice(0, 70)));

  // ------------------------------------------------------------ 3. planck loads
  H('3. planck loads');

  // Give the bundle its OWN module object. Evaluated bare it would hijack this
  // script's module.exports, because its UMD wrapper prefers the CommonJS branch.
  var planck = null;
  var t0 = Date.now();
  var loadErr = safe(function () {
    var mod = { exports: {} };
    var fn = new Function('module', 'exports', src);
    fn(mod, mod.exports);
    planck = mod.exports;
    return 'ok';
  });
  var t1 = Date.now();
  L('eval result', loadErr);
  L('parse + run ms', String(t1 - t0));
  if (loadErr.indexOf('ERR:') === 0 || !planck) {
    console.log('######## end (sections 4-6 skipped) ########');
    return;
  }
  L('export count', String(Object.keys(planck).length));
  L('has World/Body/Polygon/Chain/Vec2', String(
    !!planck.World && !!planck.Body && !!planck.Polygon && !!planck.Chain && !!planck.Vec2));
  L('version marker in source', String(/Planck\.js v([\d.]+)/.exec(src) ? /Planck\.js v([\d.]+)/.exec(src)[1] : 'not found'));

  // ------------------------------------------------- 4. maxPolygonVertices cap
  H('4. Settings.maxPolygonVertices');
  L('Settings.maxPolygonVertices', safe(function () { return planck.Settings.maxPolygonVertices; }));
  L('SettingsInternal.maxPolygonVertices', safe(function () { return planck.SettingsInternal.maxPolygonVertices; }));

  // Assigning to a getter-only property silently succeeds in sloppy mode, so the
  // descriptor is the only honest answer - see probe habits in the notes.
  L('Settings descriptor', safe(function () {
    var d = Object.getOwnPropertyDescriptor(planck.Settings, 'maxPolygonVertices');
    if (!d) return 'not an own property';
    return 'value=' + d.value + ' writable=' + d.writable + ' get=' + (d.get ? 'fn' : 'none') + ' set=' + (d.set ? 'fn' : 'none');
  }));
  L('SettingsInternal descriptor', safe(function () {
    var d = Object.getOwnPropertyDescriptor(planck.SettingsInternal, 'maxPolygonVertices');
    if (!d) return 'not an own property';
    return 'value=' + d.value + ' writable=' + d.writable + ' get=' + (d.get ? 'fn' : 'none') + ' set=' + (d.set ? 'fn' : 'none');
  }));
  L('write 16 -> reads back', safe(function () {
    planck.Settings.maxPolygonVertices = 16;
    return 'Settings=' + planck.Settings.maxPolygonVertices + ' Internal=' + planck.SettingsInternal.maxPolygonVertices;
  }));
  L('restore to 12', safe(function () {
    planck.Settings.maxPolygonVertices = 12;
    return String(planck.Settings.maxPolygonVertices);
  }));

  // A cap is only real if a shape with that many vertices survives construction
  // with all its vertices - planck silently truncates past the cap.
  L('12-gon fixture keeps 12 verts', safe(function () {
    var vs = [];
    for (var k = 0; k < 12; k++) {
      var a = k / 12 * Math.PI * 2;
      vs.push(new planck.Vec2(0.3 * Math.cos(a), 0.3 * Math.sin(a)));
    }
    var poly = new planck.Polygon(vs);
    return 'm_count=' + (poly.m_count !== undefined ? poly.m_count : poly.getVertexCount ? poly.getVertexCount() : '?');
  }));
  L('13-gon at cap 12 (expect truncation)', safe(function () {
    var vs = [];
    for (var k = 0; k < 13; k++) {
      var a = k / 13 * Math.PI * 2;
      vs.push(new planck.Vec2(0.3 * Math.cos(a), 0.3 * Math.sin(a)));
    }
    var poly = new planck.Polygon(vs);
    return 'm_count=' + (poly.m_count !== undefined ? poly.m_count : '?');
  }));

  // --------------------------------------------------------- 5. a world steps
  H('5. World steps (ground Chain + compound dynamic body)');
  var world = null, body = null;
  L('build world', safe(function () {
    world = new planck.World({ gravity: new planck.Vec2(0, -10) });
    var ground = world.createBody();
    ground.createFixture(
      new planck.Chain([new planck.Vec2(-5, 0), new planck.Vec2(5, 0)], false),
      { friction: 0.4 });

    body = world.createDynamicBody(new planck.Vec2(0, 3));
    body.createFixture(
      new planck.Polygon([new planck.Vec2(-0.2, -0.2), new planck.Vec2(0.2, -0.2),
                          new planck.Vec2(0.2, 0.2), new planck.Vec2(-0.2, 0.2)]),
      { density: 1, friction: 0.3, restitution: 0.2 });

    var vs = [];
    for (var k = 0; k < 12; k++) {
      var a = k / 12 * Math.PI * 2;
      vs.push(new planck.Vec2(0.25 + 0.15 * Math.cos(a), 0.15 * Math.sin(a)));
    }
    body.createFixture(new planck.Polygon(vs), { density: 1 });

    var n = 0, f = body.getFixtureList();
    while (f) { n++; f = f.getNext(); }
    return n + ' fixtures on the compound body';
  }));

  L('step 180x', safe(function () {
    var a = Date.now();
    for (var s = 0; s < 180; s++) world.step(1 / 60);
    var b = Date.now();
    var p = body.getPosition();
    return 'x=' + p.x.toFixed(4) + ' y=' + p.y.toFixed(4) +
           ' angle=' + body.getAngle().toFixed(4) +
           ' awake=' + body.isAwake() +
           ' in ' + (b - a) + 'ms';
  }));

  // ------------------------------------------------------------ 6. throughput
  H('6. Throughput (is a real-time pile viable?)');
  L('300 bodies x 120 steps', safe(function () {
    var w = new planck.World({ gravity: new planck.Vec2(0, -10) });
    var g = w.createBody();
    g.createFixture(new planck.Chain([new planck.Vec2(-20, 0), new planck.Vec2(20, 0)], false), {});
    for (var k = 0; k < 300; k++) {
      var b = w.createDynamicBody(new planck.Vec2((k % 20) * 0.5 - 5, 1 + Math.floor(k / 20) * 0.5));
      b.createFixture(new planck.Box(0.15, 0.15), { density: 1, friction: 0.3 });
    }
    var a = Date.now();
    for (var s = 0; s < 120; s++) w.step(1 / 60);
    var t = Date.now() - a;
    return t + 'ms total, ' + (t / 120).toFixed(2) + 'ms per step (33ms is one frame at 30fps)';
  }));

  console.log('');
  console.log('######## end ########');
}

main();
