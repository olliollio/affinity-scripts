/**
 * name: probe_vendor_lib
 * description: Discovery probe - can the Affinity script sandbox host a vendored third-party JS library (planck.js / matter.js / poly-decomp)?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: no selection needed, no document needed. Just run and copy the CONSOLE output.
 * READ-ONLY: this probe never touches the document.
 *
 * Answers, in order:
 *   1. ES language level          -> which library build to vendor (ES5 vs ES2020)
 *   2. UMD host environment       -> will the library's module wrapper resolve?
 *   3. Global writes              -> can Matter see a global `decomp` (poly-decomp)?
 *   4. eval / Function ctor       -> can we load the library from disk instead of inlining it?
 *   5. /fs read surface           -> ditto, is there a readable-file API?
 *   6. Timing + throughput        -> how many solver-ish ops fit in one 33ms tick?
 *   7. In-memory string size      -> any runtime cap near library-sized payloads?
 *
 * The file-SIZE question (can a ~300KB script be imported at all) is NOT answered
 * here - it needs a separate padded file. See probe_vendor_size.js.
 */

// Optional: put a .js file on your Desktop and set its NAME here to test disk loading.
// Leave '' to skip. Example: 'planck.min.js'
var DISK_TEST_FILENAME = '';

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

// Feature probes are written as strings so a PARSE error in one does not kill
// the whole script. Syntax we cannot parse would otherwise abort at load time.
function feature(name, src) {
  var ok, note = '';
  try {
    var fn = new Function('return (' + src + ');');
    var v = fn();
    ok = (v === true || v === undefined) ? true : !!v;
    if (v !== true && v !== undefined) note = ' -> ' + String(v);
  } catch (e) {
    ok = false;
    note = ' (' + (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : e) + ')';
  }
  console.log('  ' + (ok ? '[ok]   ' : '[FAIL] ') + name + note);
  return ok;
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
  console.log('######## probe_vendor_lib v0.1.0 ########');

  // ---------------------------------------------------------------- 1. ES level
  H('1. ES language level');
  console.log('-- ES5 / ES2015 baseline --');
  feature('strict mode honoured', '(function () { "use strict"; return this === undefined; })()');
  feature('Object.defineProperty', 'typeof Object.defineProperty === "function"');
  feature('getters/setters in literals', '(function () { var o = { get v() { return 7; } }; return o.v === 7; })()');
  feature('arrow functions', '(() => 1)() === 1');
  feature('class syntax', '(function () { class A { m() { return 1; } } return new A().m() === 1; })()');
  feature('let/const + block scope', '(function () { { let a = 1; const b = 2; return a + b === 3; } })()');
  feature('template literals', '`a${1}b` === "a1b"');
  feature('destructuring + spread', '(function () { var [a, ...r] = [1, 2, 3]; return a === 1 && r.length === 2; })()');
  feature('default + rest params', '(function (a, b) { return (function (x, y) { return y; })(1) === undefined; })()');
  feature('Map / Set', 'typeof Map === "function" && typeof Set === "function"');
  feature('Symbol.iterator', 'typeof Symbol === "function" && !!Symbol.iterator');
  feature('generators', '(function () { function* g() { yield 1; } return g().next().value === 1; })()');
  feature('Proxy', 'typeof Proxy === "function"');
  feature('Reflect', 'typeof Reflect === "object"');

  console.log('-- typed arrays (solver hot paths) --');
  feature('Float64Array', 'typeof Float64Array === "function" && new Float64Array(2).length === 2');
  feature('Float32Array', 'typeof Float32Array === "function"');
  feature('Int32Array', 'typeof Int32Array === "function"');
  feature('ArrayBuffer', 'typeof ArrayBuffer === "function"');
  feature('DataView', 'typeof DataView === "function"');
  feature('WebAssembly (rapier would need this)', 'typeof WebAssembly === "object"');

  console.log('-- ES2016..ES2022 (planck ES2020 build needs these) --');
  feature('exponent operator **', '2 ** 3 === 8');
  feature('async/await', '(function () { return (async function () { return 1; })() instanceof Promise; })()');
  feature('Promise', 'typeof Promise === "function"');
  feature('optional chaining ?.', '(function () { var o = null; return o?.x === undefined; })()');
  feature('nullish coalescing ??', '(null ?? 5) === 5');
  feature('Object.entries', 'typeof Object.entries === "function"');
  feature('Object.assign', 'typeof Object.assign === "function"');
  feature('Array.prototype.includes', 'typeof [].includes === "function"');
  feature('Array.prototype.flat', 'typeof [].flat === "function"');
  feature('String.padStart', 'typeof "".padStart === "function"');
  feature('class private #fields', '(function () { class A { #v = 1; get v() { return this.#v; } } return new A().v === 1; })()');
  feature('class static blocks', '(function () { class A { static x; static { A.x = 1; } } return A.x === 1; })()');
  feature('logical assignment ||=', '(function () { var a = 0; a ||= 5; return a === 5; })()');
  feature('BigInt', 'typeof BigInt === "function"');

  // ---------------------------------------------------------- 2. UMD host env
  H('2. UMD host environment (which branch will a library take?)');
  L('typeof module', safe(function () { return typeof module; }));
  L('typeof module.exports', safe(function () { return typeof module.exports; }));
  L('typeof exports', safe(function () { return typeof exports; }));
  L('typeof require', safe(function () { return typeof require; }));
  L('typeof define (AMD)', safe(function () { return typeof define; }));
  L('typeof define.amd', safe(function () { return typeof define.amd; }));
  L('typeof window', safe(function () { return typeof window; }));
  L('typeof document', safe(function () { return typeof document; }));
  L('typeof self', safe(function () { return typeof self; }));
  L('typeof global', safe(function () { return typeof global; }));
  L('typeof globalThis', safe(function () { return typeof globalThis; }));
  L('typeof process', safe(function () { return typeof process; }));
  L('typeof navigator', safe(function () { return typeof navigator; }));
  L('sloppy-mode this (indirect)', safe(function () {
    return String((function () { return this; })());
  }));
  L('top-level module keys', safe(function () { return Object.keys(module).join(', '); }));

  // Exactly the wrapper shape planck / matter / poly-decomp ship with.
  L('UMD wrapper resolves', safe(function () {
    var picked = 'none';
    (function (root, factory) {
      if (typeof exports === 'object' && typeof module !== 'undefined') { picked = 'commonjs'; module.__probeUmd = factory(); }
      else if (typeof define === 'function' && define.amd) { picked = 'amd'; define([], factory); }
      else { picked = 'global'; (root || this).__probeUmd = factory(); }
    })(typeof globalThis !== 'undefined' ? globalThis : this, function () { return { ok: true }; });
    return 'branch=' + picked;
  }));

  // --------------------------------------------------------- 3. global writes
  H('3. global writes (Matter needs a global `decomp` for poly-decomp)');
  L('globalThis.X = 1 then read', safe(function () {
    globalThis.__probeGlobal = 42;
    return String(globalThis.__probeGlobal) + ' / bare read: ' + String(__probeGlobal);
  }));
  L('implicit global (sloppy assign)', safe(function () {
    (function () { __probeImplicit = 7; })();
    return String(globalThis.__probeImplicit);
  }));
  L('global visible inside new Function', safe(function () {
    return String(new Function('return typeof __probeGlobal;')());
  }));

  // --------------------------------------------- 4. runtime code loading
  H('4. eval / Function ctor (could we load the lib from disk, not inline it?)');
  L('new Function works', safe(function () { return new Function('return 1 + 1;')(); }));
  L('direct eval', safe(function () { return eval('1 + 1'); }));
  L('eval defines a function', safe(function () {
    eval('function __probeEvalFn() { return "yes"; }');
    return String(typeof __probeEvalFn === 'function' ? __probeEvalFn() : typeof __probeEvalFn);
  }));
  L('new Function on a 200KB source', safe(function () {
    var body = 'var s = 0;\n';
    // ~200KB of real statements, not a comment - forces an actual parse.
    while (body.length < 200000) body += 's += 1; ';
    body += 'return s;';
    var t0 = Date.now();
    var v = new Function(body)();
    return 'parsed+ran ' + body.length + ' chars in ' + (Date.now() - t0) + 'ms, result ' + v;
  }));

  // ------------------------------------------------------------ 5. /fs surface
  H('5. /fs read surface');
  L('require("/fs") keys', safe(function () {
    var fsys = require('/fs');
    return Object.keys(fsys).join(', ');
  }));
  L('/fs.File members', safe(function () {
    return members(require('/fs').File).join(', ');
  }));
  L('/fs module members', safe(function () {
    return members(require('/fs')).join(', ');
  }));
  L('app.userDesktopPath', safe(function () { return require('/application').app.userDesktopPath; }));
  if (DISK_TEST_FILENAME) {
    L('read Desktop file', safe(function () {
      var app = require('/application').app;
      var fsys = require('/fs');
      var path = app.userDesktopPath + '/' + DISK_TEST_FILENAME;
      var txt = null;
      // Try the plausible shapes - whichever exists will answer it.
      if (typeof fsys.readFile === 'function') txt = fsys.readFile(path);
      else if (fsys.File && typeof fsys.File.readText === 'function') txt = fsys.File.readText(path);
      else if (fsys.File && typeof fsys.File.open === 'function') {
        var f = fsys.File.open(path);
        txt = f.readAll ? f.readAll() : (f.read ? f.read() : null);
      }
      if (txt == null) return 'no read API found (see members above)';
      return 'read ' + String(txt).length + ' chars, head: ' + String(txt).slice(0, 60);
    }));
  } else {
    L('read Desktop file', 'skipped (set DISK_TEST_FILENAME at top of file)');
  }

  // --------------------------------------------------- 6. timing + throughput
  H('6. timing + solver throughput (budget is one 33ms tick)');
  L('Date.now()', safe(function () { return Date.now(); }));
  L('typeof performance', safe(function () { return typeof performance; }));
  L('performance.now()', safe(function () { return performance.now(); }));
  L('Date.now resolution (ms)', safe(function () {
    var a = Date.now(), b = a, n = 0;
    while (b === a && n < 5e7) { b = Date.now(); n++; }
    return String(b - a) + ' (after ' + n + ' reads)';
  }));

  // Stand-in for a contact-solve inner loop: dot products, hypot, sqrt, branches.
  L('solver-ish ops per 33ms', safe(function () {
    var N = 2000000, t0 = Date.now(), acc = 0;
    for (var i = 0; i < N; i++) {
      var ax = i * 0.001, ay = i * 0.002;
      var d = ax * 0.6 + ay * 0.8;
      var l = Math.sqrt(ax * ax + ay * ay);
      acc += (l > 0 ? d / l : 0);
    }
    var ms = Date.now() - t0;
    var perTick = ms > 0 ? Math.round(N / ms * 33) : -1;
    return N + ' ops in ' + ms + 'ms  =>  ~' + perTick + ' ops per 33ms tick (acc ' + acc.toFixed(2) + ')';
  }));

  L('object-alloc rate (engines allocate Vec2 heavily)', safe(function () {
    var N = 500000, t0 = Date.now(), keep = null;
    for (var i = 0; i < N; i++) keep = { x: i, y: i + 1 };
    var ms = Date.now() - t0;
    return N + ' objects in ' + ms + 'ms (last ' + keep.x + ')';
  }));

  // ----------------------------------------------- 7. in-memory string size
  H('7. in-memory payload size');
  L('build 1MB string', safe(function () {
    var s = 'x';
    while (s.length < 1048576) s += s;
    return 'built ' + s.length + ' chars OK';
  }));
  L('build 8MB string', safe(function () {
    var s = 'x';
    while (s.length < 8388608) s += s;
    return 'built ' + s.length + ' chars OK';
  }));

  console.log('');
  console.log('######## probe done - copy everything above ########');
}

try {
  main();
} catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(no stack)'));
}
