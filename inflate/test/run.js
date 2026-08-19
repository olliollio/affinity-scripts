/**
 * Test runner for the pure geometry layer.
 *
 *   node inflate/test/run.js
 *
 * Everything here is headless: no Affinity API is touched, every module under test takes and
 * returns plain number arrays. Exit code is non-zero when any assertion fails, so this can gate
 * a commit.
 */

'use strict';

var h = require('./harness');

var GR = h.loadPD([
  '../gravity/src/contours.js',
  '../gravity/src/flatten.js',
  '../gravity/src/softmesh.js',
  'src/thickness.js',
  'src/inflate.js',
  'src/ui.js'
]);

var SUITES = [
  require('./test_thickness'),
  require('./test_inflate')
];

// Zero suites still reports "0 passed, 0 failed" and exits 0, which is a green light from a suite
// that asserts nothing. Say so out loud rather than exiting green on an empty run.
if (!SUITES.length) console.log('(no suites yet - this run asserts nothing)');

for (var i = 0; i < SUITES.length; i++) SUITES[i](GR, h);

process.exit(h.reportTests() ? 0 : 1);
