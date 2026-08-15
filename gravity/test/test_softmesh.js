/**
 * Tests for softmesh.js — the pure half of softbodies.
 *
 * Everything here is in SIM units, because softmesh.js is. Mixing point space and sim space inside
 * it is the specific bug this module is written to avoid, so the tests never feed it points.
 */

'use strict';

/** A closed ring approximating a circle, counter-clockwise, in sim units. */
function circle(cx, cy, r, n) {
  var p = [];
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

/** A ring wound the other way, which is what a hole is. */
function circleCW(cx, cy, r, n) {
  var p = [];
  for (var i = n - 1; i >= 0; i--) {
    var a = i / n * Math.PI * 2;
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

function square(x0, y0, w, hgt) {
  return [x0, y0, x0 + w, y0, x0 + w, y0 + hgt, x0, y0 + hgt];
}

module.exports = function (GR, h) {

  h.group('softmesh: area and perimeter');

  var sq = { outer: square(0, 0, 2, 2), holes: [] };
  h.assertClose('a square face has its own area', GR.faceArea(sq), 4, 1e-9);
  h.assertClose('a square face has its own perimeter', GR.facePerimeter(sq), 8, 1e-9);

  // The identity the thickness limit rests on: for an annulus, 2*area/perimeter IS the wall.
  var ann = { outer: circle(0, 0, 1.0, 256), holes: [circleCW(0, 0, 0.9, 256)] };
  h.assertClose('an annulus area is hole-subtracted', GR.faceArea(ann),
    Math.PI * (1.0 * 1.0 - 0.9 * 0.9), 0.01);
  h.assertClose('an annulus perimeter includes the hole', GR.facePerimeter(ann),
    2 * Math.PI * (1.0 + 0.9), 0.05);
  h.assertClose('2*area/perimeter returns the wall width', GR.faceThickness(ann), 0.1, 0.005);

  h.group('softmesh: cell sizing');

  // A chunky blob: the extent limit wins and it meshes at exactly MAX_CELLS.
  var blob = GR.softCellSize([{ outer: circle(0, 0, 1.5, 64), holes: [] }]);
  h.assert('a solid blob meshes', blob.fallback === null);
  h.assertClose('a solid blob is sized by extent', blob.cell, 3.0 / GR.SOFT_MAX_CELLS, 1e-9);
  h.assertEqual('a solid blob uses the whole cap', blob.cellsAcross, GR.SOFT_MAX_CELLS);

  // The bold 300pt "O" at its own scale: outer 3.0 sim, wall 0.6 sim.
  var bold = GR.softCellSize([{ outer: circle(0, 0, 1.5, 128), holes: [circleCW(0, 0, 0.9, 128)] }]);
  h.assert('a bold ring meshes', bold.fallback === null);
  h.assert('a bold ring is sized by extent, not thickness', bold.limit === 'extent');
  h.assertEqual('a bold ring sits exactly at the cap', bold.cellsAcross, GR.SOFT_MAX_CELLS);

  // The 200pt "O" with a 20pt wall: thickness wins, and that pushes it past the cap.
  //
  // FIXTURE SIZES MATTER HERE, and getting them wrong sends the test chasing the wrong constant.
  // `suggestScale` normalises the median body to about 3 sim units WHATEVER its point size, so a
  // 200pt "O" is 3.0 sim across and its 20pt wall is 0.3 sim — not 0.2, which is what a naive
  // "scale is 100" reading gives. Built at the naive size this shape refuses as 'thin' (the cell
  // floor binds first) instead of 'extent', and the assertion would then be pinned to the wrong
  // mechanism. Verified: at 3.0 across with a 0.3 wall it asks for 21 cells and refuses on extent.
  var thin = GR.softCellSize([{ outer: circle(0, 0, 1.5, 128), holes: [circleCW(0, 0, 1.2, 128)] }]);
  h.assertEqual('a thin ring refuses, on extent', thin.fallback, 'extent');
  h.assert('a thin ring reports no cell size', thin.cell === null);

  // The two fallbacks divide at a measurable line, so both are reachable and neither is dead:
  //   'thin'   <- thickness < 2 * MIN_CELL_SIM  (the wall cannot hold two cells at the floor)
  //   'extent' <- thickness >= 2 * MIN_CELL_SIM AND thickness < maxDim / 6
  var reallyThin = GR.softCellSize([{ outer: circle(0, 0, 1.5, 128), holes: [circleCW(0, 0, 1.35, 128)] }]);
  h.assertEqual('a wall below two floor-cells refuses as thin', reallyThin.fallback, 'thin');

  // Sizing is per OBJECT and byThickness takes the MINIMUM over faces, so a dot cannot be
  // starved by a stem. Two faces: a chunky bar and a much thinner one.
  var two = GR.softCellSize([
    { outer: square(0, 0, 3, 3), holes: [] },
    { outer: square(5, 0, 3, 0.4), holes: [] }
  ]);
  h.assert('a multi-face object is sized by its thinnest face',
    two.fallback !== null || two.cell <= GR.faceThickness({ outer: square(5, 0, 3, 0.4), holes: [] }) / 2 + 1e-9);

  h.group('softmesh: cell sizing floors');

  // Below MIN_CELL_SIM the mesh would fight linearSlop, so it refuses rather than shrinking.
  var tiny = GR.softCellSize([{ outer: square(0, 0, 0.2, 0.2), holes: [] }]);
  h.assertEqual('artwork below the cell floor refuses', tiny.fallback, 'thin');
};
