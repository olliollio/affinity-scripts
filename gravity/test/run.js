/**
 * Test runner for the pure geometry layer.
 *
 *   node gravity/test/run.js
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
  'decompose.js',
  'flatten.js',
  'raster.js',
  'extract.js',
  'world.js',
  'bodies.js',
  'rope.js',
  'softmesh.js',
  'sim.js',
  'export.js',
  'ui.js',
  // playback.js touches the Affinity API, but only from inside its functions — every require() is
  // local to a call. So it loads headlessly, and loading it is what lets the playback interval be
  // asserted. That interval is exactly where the frame rate was being thrown away, so leaving it
  // outside the test suite would leave the one number that caused the bug unguarded.
  'playback.js'
];

var GR = h.loadPD(SRC, { planck: true });

var SUITES = [
  require('./test_contours'),
  require('./test_sanitize'),
  require('./test_decompose'),
  require('./test_robustness'),
  require('./test_flatten'),
  require('./test_raster'),
  require('./test_extract'),
  require('./test_export'),
  require('./test_engine'),
  require('./test_rope'),
  require('./test_softmesh'),
  require('./test_timing'),
  require('./test_playback_handoff')
];

for (var i = 0; i < SUITES.length; i++) SUITES[i](GR, h);

process.exit(h.reportTests() ? 0 : 1);
