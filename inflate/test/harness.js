/**
 * Headless test harness for the pure geometry layer.
 *
 * The `src/` modules are plain IIFEs over a shared `GR` namespace so that the build step can
 * concatenate them in order. Here they are loaded into a fresh global `GR` with
 * `vm.runInThisContext`, which is the same "no module system" environment they get inside the
 * Affinity sandbox — so the tests exercise the shipped form of the code, not a node-only variant.
 *
 * inflate vendors nothing: no UMD libraries, no earcut, no planck. Some of what is loaded here
 * is gravity's own geometry code (contours.js, flatten.js, softmesh.js), reused by path from a
 * sibling script rather than copied - see loadPD below.
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

// Entries are paths RELATIVE TO THE INFLATE ROOT, not bare filenames, so a sibling script's
// sources can be named directly. gravity's version joins against ROOT/src and cannot reach one.
function loadPD(files) {
  globalThis.GR = {};
  for (var i = 0; i < files.length; i++) {
    var file = path.join(ROOT, files[i]);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: files[i] });
  }
  return globalThis.GR;
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
  group: group,
  assert: assert,
  assertClose: assertClose,
  assertEqual: assertEqual,
  assertThrows: assertThrows,
  reportTests: reportTests
};
