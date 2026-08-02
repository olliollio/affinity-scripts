/**
 * Test runner for the pure geometry layer.
 *
 *   node physicsdrop/test/run.js
 *
 * Everything here is headless: no Affinity API is touched, every module under test takes and
 * returns plain number arrays. Exit code is non-zero when any assertion fails, so this can gate
 * a commit.
 */

'use strict';

var h = require('./harness');

var SRC = [
  'contours.js',
  'sanitize.js',
  'decompose.js'
];

var PD = h.loadPD(SRC);

var SUITES = [
  require('./test_contours'),
  require('./test_sanitize'),
  require('./test_decompose'),
  require('./test_robustness')
];

for (var i = 0; i < SUITES.length; i++) SUITES[i](PD, h);

process.exit(h.reportTests() ? 0 : 1);
