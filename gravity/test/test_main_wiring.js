/**
 * Wiring tests for main.js: the two pieces of orchestration that decide whether the area term
 * reaches the user at all.
 *
 * main.js is otherwise untestable headlessly — `main()` reads `app.documents.current` on its first
 * line — so only the two pure helpers it exports are exercised here. Everything about the dialog
 * itself needs the Affinity `/dialog` module and is NOT covered; the one dialog fact that can be
 * checked without it is the exported defaults object, and it is checked below because the default
 * slider position is what decides the gain almost every run will use.
 */

'use strict';

function square(x0, y0, w, hgt) {
  return [x0, y0, x0 + w, y0, x0 + w, y0 + hgt, x0, y0 + hgt];
}

module.exports = function (GR, h) {

  h.group('main: the spread mesh carries the rings');

  var W = GR.makeWorld({ scale: 100 });
  var faces = [{ outer: square(0, 0, 400, 400), holes: [square(150, 150, 100, 100)] }];
  var rig = GR.addSoftBody(W, faces, { name: 'jelly', softness: 5, density: 1 });
  h.assert('the fixture meshes', !!rig && !rig.fallback);

  var spreadM = GR.spreadMeshOf(rig, W.scale);
  h.assert('the spread mesh carries ringSpans', !!spreadM.ringSpans);
  h.assertEqual('one span per ring, outer plus hole', spreadM.ringSpans.length, rig.mesh.ringSpans.length);
  h.assertEqual('two rings on a face with one hole', spreadM.ringSpans.length, 2);
  // Asserted as a POSITIVE number before it is compared: `assertEqual` stringifies, so
  // undefined-equals-undefined would sail through if the field were never added at all.
  h.assert('boundaryCount is a real count', spreadM.boundaryCount > 0);
  h.assertEqual('the spread mesh carries boundaryCount', spreadM.boundaryCount, rig.mesh.boundaryCount);
  h.assertEqual('the node array still pairs with the rig records',
    spreadM.nodes.length, rig.nodes.length * 2);

  // The reason the spans transfer at all: they are INDICES into the node array, and spreadMeshOf
  // rebuilds that array one-for-one in the same order. A span that pointed past the end here would
  // make ringAreas read undefined and report NaN, which the report would then print as a number.
  var lastSpan = spreadM.ringSpans[spreadM.ringSpans.length - 1];
  h.assert('the last span ends inside the node array',
    (lastSpan.start + lastSpan.count) * 2 <= spreadM.nodes.length);

  var spreadRings = GR.ringAreas(spreadM, spreadM.nodes);
  h.assertEqual('ringAreas reads the spread mesh', spreadRings.length, rig.restRings.length);
  h.assert('every spread ring has an area', Math.abs(spreadRings[0].area) > 0 && Math.abs(spreadRings[1].area) > 0);

  // THE units check. The report divides a settled area measured from `poseAt` output by a rest area
  // measured from this mesh, so the two have to be in one space or the ratio means nothing. Spread
  // points are sim units times the world scale with y negated, so an area is exactly scale^2 times
  // the sim-unit area the rig recorded - and the y flip negates the SIGN, which is why the report
  // compares magnitudes. Anything else here means spreadMeshOf is not measuring what the rig is.
  for (var r = 0; r < spreadRings.length; r++) {
    var expect = Math.abs(rig.restRings[r].area) * W.scale * W.scale;
    h.assertClose('ring ' + r + ' is the rig ring scaled to spread points',
      Math.abs(spreadRings[r].area), expect, expect * 1e-9);
    h.assert('ring ' + r + ' flips sign with the y axis',
      spreadRings[r].area * rig.restRings[r].area < 0);
  }

  h.group('main: firmness is a multiple of the calibrated gain');

  // The slider says "% of the gain the crush bench calibrated", not a raw gain, so what reaches
  // softPressurePass is the product. The recorded arguments are the only way to see that from
  // outside: a callback that merely EXISTS would pass an assertion on its own, and the version of
  // this wiring that passed the slider fraction straight through as the gain did exactly that
  // while delivering 1/64th of the force.
  var realPass = GR.softPressurePass;
  var calls = [];
  function record() {
    calls = [];
    GR.softPressurePass = function (rg, gain, g) { calls.push({ rig: rg, gain: gain, g: g }); };
  }
  function restore() { GR.softPressurePass = realPass; }

  var softs = [{ rig: rig }];

  record();
  var stepDefault = GR.areaStepFor(W, softs, undefined);
  h.assert('an undefined firmness still builds a callback', typeof stepDefault === 'function');
  stepDefault();
  h.assertEqual('the default fires once per softbody', calls.length, 1);
  h.assertClose('the default IS the calibrated gain', calls[0].gain, GR.SOFT_AREA_DEFAULT_GAIN, 1e-12);
  // Identity, not `assertEqual`: that stringifies, and every object stringifies to "[object
  // Object]", so passing the softs record instead of its rig would have passed.
  h.assert('the callback passes the rig, not the record', calls[0].rig === rig);
  h.assert('and that rig is the one carrying restRings', !!calls[0].rig.restRings);

  record();
  var stepHalf = GR.areaStepFor(W, softs, 0.5);
  stepHalf();
  h.assertClose('50% is half the calibrated gain', calls[0].gain, GR.SOFT_AREA_DEFAULT_GAIN * 0.5, 1e-12);

  record();
  var stepDouble = GR.areaStepFor(W, softs, 2);
  stepDouble();
  h.assertClose('200% is twice the calibrated gain', calls[0].gain, GR.SOFT_AREA_DEFAULT_GAIN * 2, 1e-12);
  restore();

  // Gravity is a 3-4-5 triangle so that the magnitude, 10, differs from BOTH components. Zero
  // gravity makes softPressurePass a no-op, so a magnitude read off the wrong field would disable
  // the whole feature silently - and `Math.abs(gvec.y)`, which is right in every downward scene,
  // would be wrong here and is the mistake this catches.
  var Wg = GR.makeWorld({ scale: 100, gravityX: 6, gravityY: -8 });
  record();
  GR.areaStepFor(Wg, softs, 1)();
  h.assertClose('the callback passes the gravity MAGNITUDE', calls[0].g, 10, 1e-12);
  restore();

  h.assert('firmness 0 builds no callback at all', GR.areaStepFor(W, softs, 0) === undefined);
  h.assert('a scene with no softbody builds no callback', GR.areaStepFor(W, [], 1) === undefined);

  record();
  var stepTwo = GR.areaStepFor(W, [{ rig: rig }, { rig: rig }], 1);
  stepTwo();
  h.assertEqual('every softbody gets its own pass', calls.length, 2);
  restore();

  h.group('main: the dialog default means 100% of the calibrated gain');

  // The dialog hands main.js `firmness` already divided by 100, so the default slider position has
  // to land on 1.0 or the shipped default is not the gain the crush bench pinned. This is the whole
  // point of making the control a multiplier: re-pinning SOFT_AREA_DEFAULT_GAIN moves everyone's
  // default without changing what a saved slider position meant.
  h.assertEqual('the dialog default is 100%', GR.UI_DEFAULTS.firmness, 100);
  record();
  var stepUi = GR.areaStepFor(W, softs, GR.UI_DEFAULTS.firmness / 100);
  stepUi();
  h.assertClose('the dialog default delivers the calibrated gain',
    calls[0].gain, GR.SOFT_AREA_DEFAULT_GAIN, 1e-12);
  restore();
};
