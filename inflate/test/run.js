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
  'src/thickness.js'
]);

var SUITES = [];

for (var i = 0; i < SUITES.length; i++) SUITES[i](GR, h);

process.exit(h.reportTests() ? 0 : 1);
