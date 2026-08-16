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

  h.group('softmesh: inside tests');

  var ring = { outer: square(0, 0, 4, 4), holes: [square(1, 1, 2, 2)] };
  h.assert('a point in the wall is inside', GR.pointInFace(0.5, 2, ring) === true);
  h.assert('a point in the hole is outside', GR.pointInFace(2, 2, ring) === false);
  h.assert('a point beyond the outline is outside', GR.pointInFace(-1, 2, ring) === false);

  h.assertClose('distance to the nearest ring, from the wall', GR.distanceToRings(0.5, 2, ring), 0.5, 1e-9);
  h.assertClose('distance measures the HOLE when it is nearer', GR.distanceToRings(0.9, 2, ring), 0.1, 1e-9);

  h.group('softmesh: nodes');

  var face = { outer: square(0, 0, 3, 3), holes: [] };
  var mesh = GR.buildSoftMesh([face], { cell: 0.5 });

  h.assert('a mesh has nodes', mesh.nodes.length > 0);
  h.assert('a mesh has interior nodes', mesh.interiorCount > 0);
  h.assert('a mesh has boundary nodes', mesh.boundaryCount > 0);

  // CURVED rings are the case that matters, and a square cannot test it. Real artwork is flattened
  // at FLATTEN_TOL 0.1, so its segments are far shorter than a cell — and a resampler that only
  // places a point when the CURRENT segment is long enough places none at all. Measured on the
  // broken version: a 128-segment circle of perimeter 9.42 gave ONE point instead of 38, and the
  // resulting annulus meshed with 2 boundary nodes while every connectivity assertion still passed.
  var curved = GR.resampleRing(circle(0, 0, 1.5, 128), 0.25);
  var wantPts = Math.round(GR.ringPerimeter(circle(0, 0, 1.5, 128)) / 0.25);
  h.assert('a curved ring resamples to about perimeter/step points',
    Math.abs(curved.length / 2 - wantPts) <= 2);

  // Even spacing is the reason to resample at all: uneven nodes carry uneven mass and stiffness,
  // the same defect uneven rope links had.
  var lo = Infinity, hi = 0;
  for (var ci = 0; ci < curved.length; ci += 2) {
    var cj = (ci + 2) % curved.length;
    var cdx = curved[cj] - curved[ci], cdy = curved[cj + 1] - curved[ci + 1];
    var d = Math.sqrt(cdx * cdx + cdy * cdy);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  h.assertClose('a resampled ring is evenly spaced', hi / lo, 1, 0.01);

  // Every node must sit inside the material, or it collides where the shape is not.
  var allInside = true;
  for (var ni = 0; ni < mesh.nodes.length; ni += 2) {
    if (!GR.pointInFace(mesh.nodes[ni], mesh.nodes[ni + 1], face)) allInside = false;
  }
  h.assert('every node is inside the face', allInside);

  // A hole must be empty of nodes.
  var holed = { outer: square(0, 0, 6, 6), holes: [square(2, 2, 2, 2)] };
  var hmesh = GR.buildSoftMesh([holed], { cell: 0.5 });
  var inHole = 0;
  for (var hi = 0; hi < hmesh.nodes.length; hi += 2) {
    var hx = hmesh.nodes[hi], hy = hmesh.nodes[hi + 1];
    if (hx > 2.05 && hx < 3.95 && hy > 2.05 && hy < 3.95) inHole++;
  }
  h.assertEqual('no node lands inside a hole', inHole, 0);

  // Boundary nodes are inset, so the collision hull hugs the outline instead of bulging past it.
  var minDist = Infinity;
  for (var bi = 0; bi < hmesh.boundaryCount; bi++) {
    var d = GR.distanceToRings(hmesh.nodes[bi * 2], hmesh.nodes[bi * 2 + 1], holed);
    if (d < minDist) minDist = d;
  }
  h.assert('boundary nodes are inset from the rings', minDist > 0.5 * GR.SOFT_INSET_FRAC * 0.5);

  h.group('softmesh: springs and connectivity');

  var smesh = GR.buildSoftMesh([{ outer: square(0, 0, 4, 4), holes: [] }], { cell: 0.5 });
  GR.addSoftSprings(smesh);

  h.assert('a mesh has springs', smesh.springs.length > 0);

  // No duplicates, no self-springs, and every index in range.
  var seen = {}, dupes = 0, selfs = 0, oob = 0;
  for (var si = 0; si < smesh.springs.length; si++) {
    var s = smesh.springs[si];
    if (s[0] === s[1]) selfs++;
    if (s[0] < 0 || s[1] < 0 || s[0] >= smesh.nodes.length / 2 || s[1] >= smesh.nodes.length / 2) oob++;
    var key = Math.min(s[0], s[1]) + '-' + Math.max(s[0], s[1]);
    if (seen[key]) dupes++;
    seen[key] = 1;
  }
  h.assertEqual('no spring joins a node to itself', selfs, 0);
  h.assertEqual('no spring is duplicated', dupes, 0);
  h.assertEqual('every spring index is in range', oob, 0);

  // THE assertion. Every other check above passes on a lattice with a detached boundary loop.
  h.assertEqual('the mesh is one connected component', GR.softMeshComponents(smesh), 1);

  // Connectivity alone is not enough: ring springs hold an under-attached boundary in one
  // component while it behaves as a rope draped on a lattice. This is what ATTACH_RADIUS is for.
  //
  // Assert on the FALLBACK COUNT, not on "is every boundary node attached". The latter is
  // tautological — addSoftSprings attaches any stranded node to its nearest interior neighbour so
  // the mesh is never disconnected, so that test can never fail while an interior node exists.
  // `attachFallbacks` counts how many nodes needed that safety net, and zero is the real claim:
  // ATTACH_RADIUS was wide enough on its own.
  h.assertEqual('no boundary node needed the attach fallback', smesh.attachFallbacks, 0);

  // The same, on the shape the radius is tightest for: a ring whose wall holds MIN_WALL_CELLS.
  var ringFace = { outer: circle(0, 0, 1.5, 128), holes: [circleCW(0, 0, 0.9, 128)] };
  var sized = GR.softCellSize([ringFace]);
  h.assert('the bold ring meshes at all', sized.fallback === null);
  var rmesh = GR.buildSoftMesh([ringFace], { cell: sized.cell });
  GR.addSoftSprings(rmesh);
  h.assertEqual('a bold ring is one component', GR.softMeshComponents(rmesh), 1);
  h.assertEqual('a bold ring needs no attach fallback', rmesh.attachFallbacks, 0);

  // A boundary count far below perimeter/cell means the resampler collapsed — the failure that
  // hides behind every other assertion here. Measured on the fixed version: 61 against ~60.
  var wantB = Math.round(
    (GR.ringPerimeter(ringFace.outer) + GR.ringPerimeter(ringFace.holes[0])) / sized.cell);
  h.assert('a bold ring has about perimeter/cell boundary nodes',
    Math.abs(rmesh.boundaryCount - wantB) <= 4);

  h.group('softmesh: multi-face objects');

  // Two discs, the shape of an "i". `buildFaces` returns two faces for "i", and also for "!", "%",
  // ":" and quote marks, so this is the ordinary case rather than an exotic one.
  var discA = { outer: circle(0.6, 0.6, 0.6, 64), holes: [] };
  var discB = { outer: circle(0.6, 2.4, 0.6, 64), holes: [] };
  var twoMesh = GR.buildSoftMesh([discA, discB], { cell: 0.25 });
  GR.addSoftSprings(twoMesh);

  // faceOf covers EVERY node, boundary and interior alike, and each one is inside the face it
  // claims. This is the record the cross-face join is built on, so a wrong entry there would stitch
  // a face to itself and leave the other loose.
  var faceOk = true, faceLen = twoMesh.faceOf.length === twoMesh.nodes.length / 2;
  for (var fo = 0; fo < twoMesh.faceOf.length; fo++) {
    var whichFace = twoMesh.faceOf[fo] === 0 ? discA : discB;
    if (twoMesh.faceOf[fo] !== 0 && twoMesh.faceOf[fo] !== 1) faceOk = false;
    if (!GR.pointInFace(twoMesh.nodes[fo * 2], twoMesh.nodes[fo * 2 + 1], whichFace)) faceOk = false;
  }
  h.assert('faceOf has one entry per node', faceLen);
  h.assert('every node maps to the face it lies inside', faceOk);

  // Both kinds of node are covered, not just the boundary — an interior-blind faceOf would still
  // pass the test above on a mesh whose interiors all defaulted to face 0.
  var bFaces = {}, iFaces = {};
  for (var fb = 0; fb < twoMesh.boundaryCount; fb++) bFaces[twoMesh.faceOf[fb]] = 1;
  for (var fi3 = twoMesh.boundaryCount; fi3 < twoMesh.faceOf.length; fi3++) iFaces[twoMesh.faceOf[fi3]] = 1;
  h.assert('boundary nodes come from both faces', bFaces[0] === 1 && bFaces[1] === 1);
  h.assert('interior nodes come from both faces', iFaces[0] === 1 && iFaces[1] === 1);

  // THE assertion for multi-face objects. Without cross-face springs this is 2, and the two halves
  // of an "i" are two unattached heaps that also cannot collide, because they share one negative
  // filter group. Measured before this existed: two 120pt discs 300pt overall started 1.800 sim
  // units apart and settled 0.018 apart — the dot ended up inside the stem.
  h.assertEqual('a two-face mesh is ONE connected component', GR.softMeshComponents(twoMesh), 1);
  h.assertEqual('a two-face mesh gets three cross-face springs', twoMesh.crossFaceSprings, 3);

  // Three, not one, because one spring is a hinge and the dot would swing about it. And they must
  // not all meet at one node, or three is a hinge too: assert the anchors are spread on BOTH sides.
  var cross = twoMesh.springs.slice(twoMesh.springs.length - twoMesh.crossFaceSprings);
  var crossOk = true, spreadOk = true;
  for (var cx2 = 0; cx2 < cross.length; cx2++) {
    if (twoMesh.faceOf[cross[cx2][0]] === twoMesh.faceOf[cross[cx2][1]]) crossOk = false;
    for (var cy2 = cx2 + 1; cy2 < cross.length; cy2++) {
      var pA = cross[cx2], pB = cross[cy2];
      if (pA[0] === pB[0] || pA[1] === pB[1]) spreadOk = false;
    }
  }
  h.assert('every cross-face spring joins two different faces', crossOk);
  h.assert('no two cross-face springs share an anchor', spreadOk);

  // Rest length is the CURRENT distance, so the faces hold the separation they were drawn with
  // rather than being dragged together on the first step.
  var restOk = true;
  for (var cr2 = 0; cr2 < cross.length; cr2++) {
    var ca = cross[cr2][0], cb = cross[cr2][1];
    var rdx = twoMesh.nodes[ca * 2] - twoMesh.nodes[cb * 2];
    var rdy = twoMesh.nodes[ca * 2 + 1] - twoMesh.nodes[cb * 2 + 1];
    if (Math.abs(Math.sqrt(rdx * rdx + rdy * rdy) - cross[cr2][2]) > 1e-9) restOk = false;
  }
  h.assert('a cross-face spring rests at the drawn separation', restOk);

  // Three faces get three springs EACH, so a stack cannot leave the top one hanging off the bottom.
  var threeMesh = GR.buildSoftMesh([discA, discB, { outer: circle(0.6, 4.2, 0.6, 64), holes: [] }],
    { cell: 0.25 });
  GR.addSoftSprings(threeMesh);
  h.assertEqual('a three-face mesh is one connected component', GR.softMeshComponents(threeMesh), 1);
  h.assertEqual('each extra face adds three cross-face springs', threeMesh.crossFaceSprings, 6);

  // A single-face mesh is untouched by any of this — no cross springs, and the spring count is
  // exactly what it was before cross-face joining existed.
  var oneMesh = GR.buildSoftMesh([discA], { cell: 0.25 });
  GR.addSoftSprings(oneMesh);
  h.assertEqual('a single-face mesh has no cross-face springs', oneMesh.crossFaceSprings, 0);
  h.assertEqual('a single-face mesh is still one component', GR.softMeshComponents(oneMesh), 1);
  h.assert('a single-face mesh maps every node to face 0',
    oneMesh.faceOf.length === oneMesh.nodes.length / 2 && Math.max.apply(null, oneMesh.faceOf) === 0);

  h.group('softmesh: binding');

  var bface = { outer: square(0, 0, 4, 4), holes: [] };
  var bmesh = GR.buildSoftMesh([bface], { cell: 0.5 });
  GR.addSoftSprings(bmesh);

  var outline = square(0, 0, 4, 4);
  var binding = GR.bindOutline(outline, bmesh);

  // FRAME 0. The rest pose must reproduce the input exactly, or the artwork jumps on the first
  // frame and the fault reads as physics rather than as write-back.
  var rest = GR.evalSoftOutline(binding, bmesh, bmesh.nodes);
  var worst = 0;
  for (var q = 0; q < outline.length; q++) worst = Math.max(worst, Math.abs(rest[q] - outline[q]));
  h.assertClose('the rest pose reproduces the outline exactly', worst, 0, 1e-9);

  // Rigid translation of every node must translate the outline by the same vector.
  var moved = bmesh.nodes.slice();
  for (var m = 0; m < moved.length; m += 2) { moved[m] += 3; moved[m + 1] -= 7; }
  var tOut = GR.evalSoftOutline(binding, bmesh, moved);
  var tWorst = 0;
  for (var t2 = 0; t2 < outline.length; t2 += 2) {
    tWorst = Math.max(tWorst, Math.abs(tOut[t2] - (outline[t2] + 3)));
    tWorst = Math.max(tWorst, Math.abs(tOut[t2 + 1] - (outline[t2 + 1] - 7)));
  }
  h.assertClose('translating every node translates the outline', tWorst, 0, 1e-9);

  // THE candy-wrapper assertion. Rotate every node about the centroid; a binding without the
  // per-node rotation term shrinks the outline toward the centre instead of rotating it.
  var ang = Math.PI / 3, ca = Math.cos(ang), sa = Math.sin(ang);
  var cx = 2, cy = 2;
  var spun = bmesh.nodes.slice();
  for (var r2 = 0; r2 < spun.length; r2 += 2) {
    var ox = spun[r2] - cx, oy = spun[r2 + 1] - cy;
    spun[r2] = cx + ox * ca - oy * sa;
    spun[r2 + 1] = cy + ox * sa + oy * ca;
  }
  var rOut = GR.evalSoftOutline(binding, bmesh, spun);
  var rWorst = 0;
  for (var r3 = 0; r3 < outline.length; r3 += 2) {
    var ex = cx + (outline[r3] - cx) * ca - (outline[r3 + 1] - cy) * sa;
    var ey = cy + (outline[r3] - cx) * sa + (outline[r3 + 1] - cy) * ca;
    rWorst = Math.max(rWorst, Math.abs(rOut[r3] - ex), Math.abs(rOut[r3 + 1] - ey));
  }
  h.assertClose('rotating every node rotates the outline', rWorst, 0, 1e-6);

  h.group('softmesh: degenerate input');

  function meshOrRefusal(faces) {
    var sized = GR.softCellSize(faces);
    if (sized.fallback) return { refused: sized.fallback };
    var m = GR.buildSoftMesh(faces, { cell: sized.cell });
    GR.addSoftSprings(m);
    return { mesh: m };
  }

  var cases = [
    ['a 0.04 sim hairline', [{ outer: square(0, 0, 3, 0.04), holes: [] }]],
    ['a tiny glyph', [{ outer: square(0, 0, 0.04, 0.04), holes: [] }]],
    ['a hole touching the outline', [{ outer: square(0, 0, 4, 4), holes: [square(0, 1, 2, 2)] }]],
    ['a duplicated point', [{ outer: [0, 0, 2, 0, 2, 0, 2, 2, 0, 2], holes: [] }]],
    ['coordinates far from the origin', [{ outer: square(1e6, 1e6, 3, 3), holes: [] }]],
    ['a zero-area ring', [{ outer: [0, 0, 1, 1, 2, 2], holes: [] }]]
  ];

  for (var di = 0; di < cases.length; di++) {
    var name = cases[di][0];
    var res = meshOrRefusal(cases[di][1]);
    if (res.refused) {
      h.assert(name + ' refuses cleanly', res.refused === 'thin' || res.refused === 'extent');
    } else {
      h.assert(name + ' produces a connected mesh', GR.softMeshComponents(res.mesh) === 1);
      var finite = true;
      for (var fi2 = 0; fi2 < res.mesh.nodes.length; fi2++) {
        if (!isFinite(res.mesh.nodes[fi2])) finite = false;
      }
      h.assert(name + ' produces finite nodes', finite);
    }
  }

  // The case extent checks alone cannot catch: a thin wall inside a generous bounding box.
  var thinWall = [{ outer: circle(0, 0, 1.0, 128), holes: [circleCW(0, 0, 0.92, 128)] }];
  var tw = GR.softCellSize(thinWall);
  h.assert('a thin-walled ring never meshes silently', tw.fallback !== null);

  h.group('softmesh: repairing a folded ring');

  function ringsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // A clean ring must come back byte-identical, not merely equivalent. Repair runs on every frame,
  // so a "repair" that perturbs clean geometry would rewrite every curve in the document.
  var cleanSq = square(0, 0, 4, 4);
  var rsq = GR.repairRing(cleanSq);
  h.assert('a clean square is returned unchanged', ringsEqual(rsq.points, cleanSq));
  h.assert('a clean square is not reported as repaired', rsq.repaired === false);
  h.assertEqual('a clean square loses nothing', rsq.loopsRemoved, 0);
  var cleanCirc = circle(0, 0, 2, 64);
  h.assert('a clean circle is returned unchanged',
    ringsEqual(GR.repairRing(cleanCirc).points, cleanCirc));

  // A REAL fold: a short contiguous excursion whose two crossings sit close together in ring order,
  // so the loop between them is small. That distinction is the whole ballgame. A bowtie-like shape,
  // whose crossings are far apart, is HALVED by a split at either one - measured, a 25-area bowtie
  // collapses to a 12.86 triangle - and is refused by the valve below. Writing this fixture as a
  // bowtie would assert the opposite of what it means to.
  var folded = [0, 0,  20, 0,  20, 20,  12, 20,  8, 26,  14, 26,  10, 20,  0, 20];
  h.assert('the fold fixture really does cross itself', GR.ringCrossings(folded) > 0);
  var rf = GR.repairRing(folded);
  h.assert('a folded ring is repaired', rf.repaired === true, 'abandoned: ' + rf.abandoned);
  h.assertEqual('the repaired ring has no crossing left', GR.ringCrossings(rf.points), 0);
  h.assert('a real fold costs little area', rf.lossFraction < 0.1,
    'lost ' + (100 * rf.lossFraction).toFixed(1) + '%');

  // Winding survives because both candidate loops are built in the ring's own traversal order.
  var foldedCW = [];
  for (var fc = folded.length - 2; fc >= 0; fc -= 2) foldedCW.push(folded[fc], folded[fc + 1]);
  h.assert('the reversed fixture is clockwise', GR.ringSignedArea(foldedCW) < 0);
  var rcw = GR.repairRing(foldedCW);
  h.assert('a clockwise ring stays clockwise', rcw.repaired && GR.ringSignedArea(rcw.points) < 0,
    'area ' + GR.ringSignedArea(rcw.points).toFixed(2));

  // THE VALVE. Refusing is not a failure mode, it is the feature: handing back mangled artwork is
  // worse than handing back folded artwork.
  //
  // A symmetric figure-eight has lost == kept exactly, and its |shoelace| is exactly 0 - which is
  // why the fraction is measured against the RETAINED area rather than the original ring. Against
  // the original, this ring divides by zero.
  var eight = [0, 0,  10, 0,  0, 10,  10, 10];
  h.assertClose('a figure-eight has zero signed area', GR.ringSignedArea(eight), 0, 1e-12);
  var re = GR.repairRing(eight);
  h.assert('a symmetric figure-eight is refused', !re.repaired && re.abandoned === 'loss');
  h.assert('a refusal returns the input unchanged', ringsEqual(re.points, eight));
  h.assert('a refusal still reports what it would have lost', re.lossFraction > 0);

  // A pentagram loses 44.7% in one pass and must be refused too.
  var star = [];
  for (var sp = 0; sp < 5; sp++) {
    var sa = sp * 4 * Math.PI / 5 - Math.PI / 2;
    star.push(100 * Math.cos(sa), 100 * Math.sin(sa));
  }
  var rst = GR.repairRing(star);
  h.assert('a pentagram is refused', !rst.repaired && rst.abandoned === 'loss',
    'frac ' + rst.lossFraction.toFixed(3));

  // Repair runs every frame, so running it on its own output must be a no-op.
  var again = GR.repairRing(rf.points);
  h.assert('repair is idempotent', !again.repaired && ringsEqual(again.points, rf.points));

  // Where the ring happens to start must not change what is kept.
  var rotRing = folded.slice(4).concat(folded.slice(0, 4));
  h.assertClose('repair does not depend on the starting vertex',
    Math.abs(GR.ringSignedArea(GR.repairRing(rotRing).points)),
    Math.abs(GR.ringSignedArea(rf.points)), 1e-9);

  // A zero-length segment scores a phantom crossing in outlineFolds and hands CurveBuilder a
  // degenerate lineTo, so the splice must not leave one.
  var dupFound = false;
  for (var dp = 0; dp < rf.points.length; dp += 2) {
    var dq = (dp + 2) % rf.points.length;
    if (rf.points[dp] === rf.points[dq] && rf.points[dp + 1] === rf.points[dq + 1]) dupFound = true;
  }
  h.assert('repair leaves no consecutive duplicate points', !dupFound);

  h.group('softmesh: the settled scene folds as measured');

  // A fixture that does not reproduce the defect cannot prove it was fixed, so this asserts the
  // starting condition before anything asserts the cure.
  var scene = require('./fixtures_softscene');
  var foldedNames = [], settledClean = 0;
  for (var st = 0; st < scene.SETTLED.length; st++) {
    if (GR.ringCrossings(scene.SETTLED[st].ring) > 0) foldedNames.push(scene.SETTLED[st].name);
    else settledClean++;
  }
  h.assertEqual('five settled shapes cross themselves', foldedNames.length, 5);
  h.assertEqual('five settled shapes do not', settledClean, 5);

  h.group('softmesh: repairing the real settled scene');

  // Measured on the exported artwork of a real Affinity run, and the numbers belong here rather
  // than behind a threshold nobody can check:
  //
  //     shape     crossings   loops   area lost
  //     orange      2 -> 0        2       0.25%
  //     amber       1 -> 0        1       1.97%
  //     cyan        1 -> 0        1       2.03%
  //     purple      1 -> 0        1       0.01%
  //     green       1 -> 0        1       0.22%
  //     the other five: untouched
  var worstLoss = 0, repairedCount = 0;
  for (var sr = 0; sr < scene.SETTLED.length; sr++) {
    var settled = scene.SETTLED[sr];
    var res = GR.repairRing(settled.ring);
    h.assertEqual('settled ' + settled.name + ' ends with no crossing',
      GR.ringCrossings(res.points), 0);
    if (res.repaired) {
      repairedCount++;
      if (res.lossFraction > worstLoss) worstLoss = res.lossFraction;
    } else {
      h.assert('untouched ' + settled.name + ' is byte-identical',
        ringsEqual(res.points, settled.ring));
    }
  }
  h.assertEqual('five of the ten needed repair', repairedCount, 5);
  h.assert('the worst real loss is far under the valve', worstLoss < 0.05,
    'worst ' + (100 * worstLoss).toFixed(2) + '%');

  h.group('softmesh: self-contact braces');

  // Hand-built rather than meshed, so every assertion here is about softBraces alone.
  //
  // Watch the index arithmetic: ring separation WRAPS, so on a 5-ring the pair (0,3) is TWO apart,
  // not three. A first draft of these fixtures put the close pair on ring-ADJACENT indices, where
  // addSoftSprings has already jointed them - so nothing was braced, and the test passed while
  // asserting nothing.
  function braceMesh(nodes, count) {
    return { nodes: nodes, boundaryCount: count, interiorCount: 0,
      ringSpans: [{ start: 0, count: count }], cell: 1, springs: [], grid: {} };
  }

  // Two apart on a 4-ring: 0 and 2 are not neighbours, so nothing joints them and the brace must.
  var bm = braceMesh([0, 0,  1, 0,  0.05, 0.05,  0, 2], 4);
  GR.addSoftSprings(bm);
  var braces = GR.softBraces(bm, 0.5);
  h.assertEqual('a close unjointed pair is braced', braces.pairs.length, 1);
  h.assertEqual('the brace joins node 0', braces.pairs[0][0], 0);
  h.assertEqual('the brace joins node 2', braces.pairs[0][1], 2);
  h.assertClose('the brace rest length is the current separation',
    braces.pairs[0][2], Math.sqrt(0.005), 1e-9);
  h.assertEqual('the widest brace separation is reported', braces.maxArc, 2);

  // Ring NEIGHBOURS are already jointed, so they are never braced however close they are - a brace
  // there would be a duplicate spring.
  var nearRing = braceMesh([0, 0,  0.1, 0,  1, 1,  0, 1], 4);
  GR.addSoftSprings(nearRing);
  h.assertEqual('ring neighbours are never braced', GR.softBraces(nearRing, 0.5).pairs.length, 0);

  // No threshold on ring separation, which is the whole point. On an 8-ring, 0 and 3 really are 3
  // apart. Measured on teardrops, the band reaches 3 at a 39 degree tip and 4 at 33 degrees.
  var farRing = braceMesh([0, 0,  2, 0,  4, 0,  0.05, 0.05,  4, 4,  3, 5,  2, 5,  0, 4], 8);
  GR.addSoftSprings(farRing);
  var farBraces = GR.softBraces(farRing, 0.5);
  h.assertEqual('a pair three apart along the ring is braced', farBraces.pairs.length, 1);
  h.assertEqual('its separation is reported as three', farBraces.maxArc, 3);

  // Nothing close means nothing braced, which is the ordinary case.
  var openRing = braceMesh([0, 0,  3, 0,  3, 3,  0, 3], 4);
  GR.addSoftSprings(openRing);
  h.assertEqual('a shape with no close pair is not braced',
    GR.softBraces(openRing, 0.5).pairs.length, 0);

  h.group('softmesh: fold detection');

  // A clean convex ring never crosses itself.
  h.assertEqual('a square outline does not fold', GR.outlineFolds(square(0, 0, 4, 4)), 0);
  h.assertEqual('a circle outline does not fold', GR.outlineFolds(circle(0, 0, 2, 64)), 0);

  // A bowtie is the minimal self-crossing closed shape: swap two opposite corners.
  h.assert('a bowtie folds', GR.outlineFolds([0, 0, 4, 4, 4, 0, 0, 4]) > 0);

  // A shape that folds a single lobe back through its own edge - the shape a crushed lattice
  // actually produces, and the one that fills with a white gouge.
  var folded = [0, 0, 10, 0, 10, 6, 5, -3, 0, 6];
  h.assert('a lobe folded back through an edge is detected', GR.outlineFolds(folded) > 0);

  // Concave alone is NOT folding - an L-shape must come back clean, or the check would cry wolf
  // on every letterform.
  h.assertEqual('a concave L does not fold', GR.outlineFolds([0, 0, 6, 0, 6, 2, 2, 2, 2, 6, 0, 6]), 0);

  // Degenerate input must not throw or report nonsense.
  h.assertEqual('a two-point outline cannot fold', GR.outlineFolds([0, 0, 1, 1]), 0);
  h.assertEqual('an empty outline cannot fold', GR.outlineFolds([]), 0);

  // The cap exists so a badly mangled outline cannot cost O(n^2) unbounded work in the report.
  h.assert('the crossing count is capped', GR.outlineFolds([0, 0, 4, 4, 4, 0, 0, 4], 1) <= 1);
};
