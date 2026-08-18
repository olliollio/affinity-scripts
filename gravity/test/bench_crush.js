/**
 * Crush bench for softbody area preservation.
 *
 *   node gravity/test/bench_crush.js            LOAD=4 GAIN=0 by default
 *   LOAD=6 GAIN=1 node gravity/test/bench_crush.js
 *
 * Prints the table the constants in src/softbody.js are pinned against. It is a benchmark, not a
 * test: it asserts nothing and always exits 0. It exists so those numbers can be regenerated rather
 * than trusted - every figure in AREA_DEADBAND's, AREA_FORCE_CAP's and AREA_DEFAULT_GAIN's comments
 * comes from a run of this file.
 *
 * The rig itself is `crushOne` in fixtures_softscene.js, shared with the three shapes that gate
 * commits in test_softbody.js - see the argument there for why it is not a second copy here.
 * This file is the sweep: all ten shapes, and the LOAD and GAIN knobs the constants were pinned
 * with.
 */

'use strict';

var h = require('./harness');
var GR = h.loadPD(['contours.js', 'sanitize.js', 'decompose.js', 'flatten.js', 'raster.js',
  'extract.js', 'world.js', 'bodies.js', 'rope.js', 'softmesh.js', 'softbody.js', 'sim.js'],
  { planck: true });
var fx = require('./fixtures_softscene');
var SCENE = fx.SCENE;

var LOAD = +(process.env.LOAD || 4);
// Defaults to 0 - the DEFECT, not the shipped constant. The bench's job is to show the gap, so
// the gain has to be named on the command line to be believed.
var GAIN = +(process.env.GAIN || 0);
var SOFTNESS = +(process.env.SOFTNESS || 0.25);

console.log('crush bench  LOAD=' + LOAD + '  GAIN=' + GAIN + '  softness=' + SOFTNESS);
console.log('shape         area%   peak%  cross  settledBy   frames');
// Infinity, not 1: at a gain high enough to inflate every shape past rest, starting at 1 would
// leave the worst line naming no shape at all and printing 0.0%.
var worst = Infinity, worstName = '(none)';
for (var i = 0; i < SCENE.length; i++) {
  var r = fx.crushOne(GR, SCENE[i], LOAD, GAIN, SOFTNESS);
  if (!r) { console.log(SCENE[i].name + '  (did not mesh)'); continue; }
  if (r.noFrameIndex) {
    console.log(SCENE[i].name + '  (no frameIndex - GR.run stopped assigning it; every number ' +
      'this bench prints would be NaN)');
    continue;
  }
  console.log(r.name.replace(/$/, '            ').slice(0, 12) + ' ' +
    (100 * r.area - 100).toFixed(1).replace(/^/, '      ').slice(-6) + '  ' +
    (100 * r.peak - 100).toFixed(1).replace(/^/, '      ').slice(-6) + '  ' +
    String(r.crossings).replace(/^/, '    ').slice(-4) + '  ' +
    r.settledBy.replace(/$/, '           ').slice(0, 11) + ' ' + r.frames);
  if (r.area < worst) { worst = r.area; worstName = r.name; }
}
console.log('worst: ' + worstName + ' at ' +
  (isFinite(worst) ? (100 * worst - 100).toFixed(1) + '%' : 'n/a'));
