/**
 * Crush bench for softbody area preservation.
 *
 *   node gravity/test/bench_crush.js            LOAD=4 GAIN=0 by default
 *   LOAD=6 GAIN=1 node gravity/test/bench_crush.js
 *
 * Prints the table quoted in README.md. It is a benchmark, not a test: it asserts nothing and
 * always exits 0. It exists so the published numbers can be regenerated rather than trusted.
 *
 * WHY A BENCH AND NOT THE REAL SCENE. A pile in Affinity is not a measuring instrument. Replaying
 * the same ten shapes headlessly puts four of them somewhere else entirely and compresses about six
 * times less, because a pile diverges chaotically from any difference at all. So the rig here is
 * one jelly on the floor with one rigid slab resting on it, whose mass is a stated multiple of the
 * jelly's own. Deterministic, and the load is a single number. LOAD = 4 reproduces the compression
 * band of the real run.
 */

'use strict';

var h = require('./harness');
var GR = h.loadPD(['contours.js', 'sanitize.js', 'decompose.js', 'flatten.js', 'raster.js',
  'extract.js', 'world.js', 'bodies.js', 'rope.js', 'softmesh.js', 'softbody.js', 'sim.js'],
  { planck: true });
var SCENE = require('./fixtures_softscene').SCENE;

// The scale the real run chose from this artwork. Fixed here so the bench does not drift with
// suggestScale. Checked rather than asserted: suggestScale takes the MEDIAN of max(w, h) over the
// ten shapes and divides by 3, which on this scene is 151.14 / 3 = 50.38 exactly.
var SCALE = 50.38;
var LOAD = +(process.env.LOAD || 4);
var GAIN = +(process.env.GAIN || 0);
var SOFTNESS = +(process.env.SOFTNESS || 0.25);

function bbox(r) {
  var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (var i = 0; i < r.length; i += 2) {
    if (r[i] < b.x0) b.x0 = r[i];
    if (r[i] > b.x1) b.x1 = r[i];
    if (r[i + 1] < b.y0) b.y0 = r[i + 1];
    if (r[i + 1] > b.y1) b.y1 = r[i + 1];
  }
  return b;
}

/** One shape on the floor under a slab of LOAD x its own mass. Returns what it settled at. */
function crush(shape, load, gain) {
  var W = GR.makeWorld({ scale: SCALE });
  var b = bbox(shape.ring), w = b.x1 - b.x0, hh = b.y1 - b.y0;
  var ring = [];
  for (var i = 0; i < shape.ring.length; i += 2) {
    ring.push(shape.ring[i] - b.x0 + 200 - w / 2, shape.ring[i + 1] - b.y0 + 300 - hh);
  }

  var rig = GR.addSoftBody(W, [{ outer: ring, holes: [] }],
    { name: shape.name, softness: SOFTNESS, density: 1 });
  if (!rig || rig.fallback) return null;

  var pts = [];
  for (var n = 0; n < rig.nodes.length; n++) pts.push(rig.nodes[n].ox, rig.nodes[n].oy);
  var springs = [];
  for (var s = 0; s < rig.mesh.springs.length; s++) {
    var sp = rig.mesh.springs[s];
    springs.push([sp[0], sp[1], sp[2] * SCALE]);
  }
  var mesh = { nodes: pts, springs: springs, cell: rig.cell * SCALE,
               ringSpans: rig.mesh.ringSpans, boundaryCount: rig.mesh.boundaryCount };
  var bind = GR.bindOutline(ring, mesh);

  // A slab as wide as the shape, one point above it, with a density chosen so its mass is `load`
  // times the jelly's - so the load means the same thing on every shape.
  if (load > 0) {
    var sh = w * 0.25;
    GR.addBody(W, [[200 - w / 2, 300 - hh - sh - 1, 200 + w / 2, 300 - hh - sh - 1,
                    200 + w / 2, 300 - hh - 1, 200 - w / 2, 300 - hh - 1]],
      { density: load * rig.totalMass / ((w / SCALE) * (sh / SCALE)),
        name: 'slab', friction: 0.4, restitution: 0 });
  }
  GR.addBounds(W, { x: 0, y: -200, width: 400, height: 502 });

  var gv = W.world.getGravity();
  var gMag = Math.sqrt(gv.x * gv.x + gv.y * gv.y);
  var rest = Math.abs(GR.ringSignedArea(ring));
  var peak = 1;

  var rec = GR.run(W, {
    maxFrames: 2000, velocityIterations: 24, positionIterations: 8, seed: 1,
    onStep: function () { GR.softPressurePass(rig, gain, gMag); }
  });

  // `frameIndex` is assigned by GR.run over W.dynamics, so it exists the moment run returns. A
  // missing one used to produce an all-NaN outline that the settled report then described as 797
  // repaired folds, so it is checked here rather than defended with a fallback - a fallback would
  // hide exactly the regression worth catching. The row is dropped rather than thrown on, because
  // a bench still has to exit 0; what it must never do is print a number it did not measure.
  for (n = 0; n < rig.nodes.length; n++) {
    if (typeof rig.nodes[n].frameIndex !== 'number') return { noFrameIndex: true };
  }

  // Peak area over the run is the overshoot gate: the term is one-sided so it cannot drive a shape
  // past rest in steady state, but momentum can carry it there.
  for (var f = 0; f < rec.frameCount; f++) {
    var fpos = [];
    for (n = 0; n < rig.nodes.length; n++) {
      var p = GR.poseAt(rec, f, rig.nodes[n].frameIndex);
      fpos.push(p.x, p.y);
    }
    var a = Math.abs(GR.ringSignedArea(GR.evalSoftOutline(bind, mesh, fpos))) / rest;
    if (a > peak) peak = a;
  }

  var last = [];
  for (n = 0; n < rig.nodes.length; n++) {
    var q = GR.toSrc(W, rig.nodes[n].body.getPosition().x, rig.nodes[n].body.getPosition().y);
    last.push(q.x, q.y);
  }
  var out = GR.evalSoftOutline(bind, mesh, last);
  return {
    name: shape.name,
    area: Math.abs(GR.ringSignedArea(out)) / rest,
    peak: peak,
    crossings: GR.ringCrossings(out),
    settledBy: rec.settledBy,
    frames: rec.frameCount
  };
}

console.log('crush bench  LOAD=' + LOAD + '  GAIN=' + GAIN + '  softness=' + SOFTNESS);
console.log('shape         area%   peak%  cross  settledBy   frames');
// Infinity, not 1: at a gain high enough to inflate every shape past rest, starting at 1 would
// leave the worst line naming no shape at all and printing 0.0%.
var worst = Infinity, worstName = '(none)';
for (var i = 0; i < SCENE.length; i++) {
  var r = crush(SCENE[i], LOAD, GAIN);
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
