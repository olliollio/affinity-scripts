/**
 * Headless test harness for the pure geometry layer.
 *
 * The `src/` modules are plain IIFEs over a shared `PD` namespace so that the build step can
 * concatenate them in order. Here they are loaded into a fresh global `PD` with
 * `vm.runInThisContext`, which is the same "no module system" environment they get inside the
 * Affinity sandbox — so the tests exercise the shipped form of the code, not a node-only variant.
 *
 * Assertion style matches `scale_with_text_1.0.js` (`assert` / `assertClose` / `reportTests`)
 * so that the same tests can be pasted into a script's SELFTEST block if that is ever useful.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- module loading

/**
 * Loads a vendored UMD build the same way the sandbox does: via the CommonJS branch.
 *
 * The globals have to be saved and restored around it, because each bundle assigns to whatever
 * `module.exports` it finds — loading two of them without this, the second overwrites the first.
 * `build.js` solves the same problem lexically, by giving each library its own wrapper.
 */
function loadUMD(file) {
  var shim = {};
  var savedModule = globalThis.module;
  var savedExports = globalThis.exports;
  globalThis.module = { exports: shim };
  globalThis.exports = shim;
  try {
    var code = fs.readFileSync(path.join(ROOT, 'vendor', file), 'utf8');
    vm.runInThisContext(code, { filename: 'vendor/' + file });
  } finally {
    globalThis.module = savedModule;
    globalThis.exports = savedExports;
  }
  return shim;
}

// planck is 297KB and only the engine tests need it, so it loads on demand.
var _planck = null;
function loadPlanck() {
  if (!_planck) _planck = loadUMD('planck.min.js');
  return _planck;
}

// Builds the PD namespace from src/, in concatenation order.
function loadPD(files, opts) {
  var o = opts || {};
  globalThis.PD = { earcut: loadUMD('earcut.min.js').default };
  if (o.planck) globalThis.PD.planck = loadPlanck();
  for (var i = 0; i < files.length; i++) {
    var file = path.join(ROOT, 'src', files[i]);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'src/' + files[i] });
  }
  return globalThis.PD;
}

// ---------------------------------------------------------------- assertions

var _tests = { pass: 0, fail: 0, failures: [] };
var _group = '';

function group(name) {
  _group = name;
  console.log('');
  console.log('-- ' + name);
}

function _pass(name) { _tests.pass++; console.log('   PASS  ' + name); }

function _fail(name, detail) {
  _tests.fail++;
  _tests.failures.push(_group + ' / ' + name + (detail ? '  ' + detail : ''));
  console.log('   FAIL  ' + name + (detail ? '  ' + detail : ''));
}

function assert(name, cond, detail) {
  if (cond) _pass(name); else _fail(name, detail);
}

function assertClose(name, actual, expected, tol) {
  var t = (tol === undefined) ? 1e-6 : tol;
  var ok = Math.abs(actual - expected) <= t;
  if (ok) _pass(name);
  else _fail(name, 'expected ' + expected + ' got ' + actual);
}

function assertEqual(name, actual, expected) {
  var ok = String(actual) === String(expected);
  if (ok) _pass(name);
  else _fail(name, 'expected "' + expected + '" got "' + actual + '"');
}

function assertThrows(name, fn) {
  try { fn(); } catch (e) { _pass(name); return; }
  _fail(name, 'expected a throw');
}

function reportTests() {
  console.log('');
  if (_tests.failures.length) {
    console.log('Failures:');
    for (var i = 0; i < _tests.failures.length; i++) console.log('  ' + _tests.failures[i]);
    console.log('');
  }
  console.log('==== ' + _tests.pass + ' passed, ' + _tests.fail + ' failed ====');
  return _tests.fail === 0;
}

module.exports = {
  loadPD: loadPD,
  loadPlanck: loadPlanck,
  group: group,
  assert: assert,
  assertClose: assertClose,
  assertEqual: assertEqual,
  assertThrows: assertThrows,
  reportTests: reportTests
};
