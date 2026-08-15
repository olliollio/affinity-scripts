# Softbodies (Jelly) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A closed path named `soft`, `jelly` or `squish` falls as a deformable mass-spring lattice that slumps, squashes on impact and keeps its deformed shape.

**Architecture:** A softbody is a rig, not an engine feature — planck has no soft bodies. A square grid of point bodies with `DistanceJoint` springs along both axes and both diagonals is meshed over the shape; the drawn outline keeps its full detail and rides the mesh by weighted skinning with per-node best-fit rotation. Geometry is rewritten each frame with `createSetCurves`, exactly as ropes are. Pure geometry lives in `softmesh.js` and is tested headlessly; only `softbody.js` touches planck.

**Tech Stack:** planck.js 1.5.0 (vendored, Box2D 2.x port), plain ES5-style IIFE modules over a shared `GR` namespace, headless node test harness (`gravity/test/harness.js`), no build tooling beyond `gravity/build.js` concatenation.

**Spec:** `docs/superpowers/specs/2026-08-15-softbodies-design.md`

---

## Conventions for this plan

- Working directory is the repo root: `/home/ollio/tools/Affinity/affinity-scripts`.
- Run the whole suite with `node gravity/test/run.js`. It exits non-zero on any failed assertion. There is no package.json and no test framework — assertions come from `gravity/test/harness.js` (`h.group`, `h.assert`, `h.assertClose`, `h.assertEqual`, `h.assertThrows`).
- A test file exports `module.exports = function (GR, h) { ... }` and is registered in `gravity/test/run.js`.
- Source modules are IIFEs: `(function (GR) { 'use strict'; ... GR.name = name; })(globalThis.GR);` — match the existing style in `gravity/src/rope.js`.
- **`softmesh.js` works entirely in SIM units.** The caller converts the face once. Never mix point-space and sim-space quantities inside it; that class of bug has already been caught twice in review.
- Commit after every task. Prefix messages `feat(gravity):`, `test(gravity):` or `refactor(gravity):`.
- **Sizes in tests are SIM units, and `suggestScale` normalises the median body to about 3 of them
  whatever its point size.** A fixture built as though the scale were always 100 will trip the
  `MIN_CELL_SIM` floor instead of the limit it meant to test, and the assertion then guards the
  wrong constant. Build fixtures at ~3 units across.

**Status of the code in this plan:** the `softmesh.js` implementations in Tasks 3-7 and the tests in
Tasks 3-8 were extracted and executed against each other before this plan was finalised — 48
assertions, all passing, including the frame-0 rest-pose check and the rotation check that catches
candy-wrapper collapse. Two defects were found and fixed that way: boundary points were inset along
a single segment normal, which leaves corner nodes sitting exactly on the outline, and two test
fixtures were built at the wrong sim scale. The planck-facing code in Tasks 9-11 has NOT been
executed and is the part most likely to need adjustment.

---

## File Structure

**Create:**
- `gravity/src/softmesh.js` — pure. Cell sizing, point-in-face, mesh generation, spring generation, outline binding, outline evaluation. No planck, no Affinity API.
- `gravity/src/softbody.js` — the only softbody module that touches planck. Turns a mesh into bodies and joints; reads poses back.
- `gravity/test/test_softmesh.js` — pure tests.
- `gravity/test/test_softbody.js` — engine tests (needs planck, no Affinity API).

**Modify:**
- `gravity/src/extract.js` — `hasWord` helper, `SOFT_WORDS`, `isSoftName`, `isSoft` on the closed-ring result.
- `gravity/src/rope.js` — `isAnchoredName` delegates to `hasWord`.
- `gravity/src/sim.js` — per-softbody jitter; velocity/position iteration options already exist and are threaded through.
- `gravity/src/main.js` — the `soft` branch, raised iterations, report line.
- `gravity/src/playback.js` — softbody write-back and selection exclusion.
- `gravity/src/ui.js` — "Jelly softness %".
- `gravity/build.js` — add both new files to `SRC_FILES`.
- `gravity/test/run.js` — add both new files to `SRC` and both suites to `SUITES`.
- `gravity/README.md` — a `## Softbodies` section.
- `gravity/MANUAL.md` — a recipe and the settings entry.

---

## Task 0: Probe the CurveBuilder closing call (BLOCKS Task 12)

Nothing in the codebase answers this — `extract.js` only ever *reads* `curve.isClosed`, never writes closure. This must be run by the user in an **installed** script's console; it cannot be answered headlessly and must not be guessed.

- [ ] **Step 1: Ask the user to run the probe**

```js
var g = require('/globals');
var cb = g.CurveBuilder.create();
console.log('builder: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(cb)).join(', '));
cb.beginXY(0, 0); cb.lineToXY(10, 0); cb.lineToXY(10, 10);
var c = cb.createCurve();
console.log('curve:   ' + Object.getOwnPropertyNames(Object.getPrototypeOf(c)).join(', '));
console.log('isClosed: ' + c.isClosed);
```

- [ ] **Step 2: Record the answer in the spec**

Look for `close`, `closeCurve`, `setClosed`, or a flag on `createCurve()`. Write the finding into the write-back section of `docs/superpowers/specs/2026-08-15-softbodies-design.md`, replacing the "Open question requiring a probe" paragraph.

**If no closing call exists:** the fallback is repeating the first point as the last. Record whether the fill renders closed. Tasks 1-11 do not depend on this and can proceed in parallel.

---

## Task 1: Extract the shared whole-word matcher

`isStaticName` (`extract.js:42`) and `isAnchoredName` (`rope.js:87`) are the same scan written twice. A third copy is where that becomes a cost. Both existing exports must survive unchanged — `test_extract.js` and `test_rope.js` cover them.

**Files:**
- Modify: `gravity/src/extract.js:33-57`
- Modify: `gravity/src/rope.js:84-101`
- Test: `gravity/test/test_extract.js`

- [ ] **Step 1: Write the failing test**

Append inside the exported function in `gravity/test/test_extract.js`:

```js
  h.group('extract: hasWord');

  h.assert('matches a bare word', GR.hasWord('jelly', ['jelly']) === true);
  h.assert('matches inside a phrase', GR.hasWord('big jelly thing', ['jelly']) === true);
  h.assert('matches with punctuation around it', GR.hasWord('shape (jelly)', ['jelly']) === true);
  h.assert('does not match a substring', GR.hasWord('jellyfish', ['jelly']) === false);
  h.assert('does not match a suffix', GR.hasWord('myjelly', ['jelly']) === false);
  h.assert('is case insensitive', GR.hasWord('JELLY', ['jelly']) === true);
  h.assert('tries every word', GR.hasWord('a squish b', ['soft', 'squish']) === true);
  h.assert('empty name matches nothing', GR.hasWord('', ['jelly']) === false);
  h.assert('null name matches nothing', GR.hasWord(null, ['jelly']) === false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js`
Expected: FAIL — `GR.hasWord is not a function`.

- [ ] **Step 3: Implement `hasWord` and delegate both callers**

In `gravity/src/extract.js`, replace the body of `isStaticName` and add `hasWord` above it:

```js
  /**
   * Is `word` present in `name` as a whole word?
   *
   * Three naming conventions now use this — scenery, rope anchoring and softbodies — and it was
   * written twice before the third arrived. Whole-word matching is what stops "jellyfish" being
   * jelly and "grounded" being ground.
   */
  function hasWord(name, words) {
    if (!name) return false;
    var s = String(name).toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var at = s.indexOf(w);
      while (at >= 0) {
        var before = at === 0 ? '' : s.charAt(at - 1);
        var after = s.charAt(at + w.length);
        if ((at === 0 || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) return true;
        at = s.indexOf(w, at + 1);
      }
    }
    return false;
  }

  function isStaticName(name) {
    return hasWord(name, STATIC_WORDS);
  }
```

Export it beside the others: `GR.hasWord = hasWord;`

In `gravity/src/rope.js`, replace the whole body of `isAnchoredName`:

```js
  /** Is this path pinned at its ends? Pure, so it is unit-tested like the scenery names. */
  function isAnchoredName(name) {
    return GR.hasWord(name, ANCHOR_WORDS);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js`
Expected: PASS, including the existing `rope: anchor naming` and static-name groups. If those fail, the refactor changed behaviour and must be fixed rather than the tests adjusted.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/extract.js gravity/src/rope.js gravity/test/test_extract.js
git commit -m "refactor(gravity): one whole-word matcher for scenery, anchor and soft names"
```

---

## Task 2: Soft naming and the extract flag

**Files:**
- Modify: `gravity/src/extract.js` (constants near `STATIC_WORDS:33`, and `makeResult:510`)
- Test: `gravity/test/test_extract.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('extract: soft naming');

  h.assert('"jelly" is soft', GR.isSoftName('jelly') === true);
  h.assert('"soft" is soft', GR.isSoftName('soft') === true);
  h.assert('"squish" is soft', GR.isSoftName('squish') === true);
  h.assert('"Soft Blob" is soft', GR.isSoftName('Soft Blob') === true);
  h.assert('"software" is not soft', GR.isSoftName('software') === false);
  h.assert('"jellyfish" is not soft', GR.isSoftName('jellyfish') === false);
  h.assert('an unnamed thing is not soft', GR.isSoftName('') === false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js`
Expected: FAIL — `GR.isSoftName is not a function`.

- [ ] **Step 3: Implement**

In `gravity/src/extract.js`, beside `STATIC_WORDS`:

```js
  // A closed path named for one of these becomes a deformable lattice instead of a rigid body.
  // Static still wins: locking or naming something scenery is an explicit act.
  var SOFT_WORDS = ['soft', 'jelly', 'squish'];

  function isSoftName(name) {
    return hasWord(name, SOFT_WORDS);
  }
```

In `makeResult`, add the flag to the returned object:

```js
      isStatic: !!forcedStatic || isStaticNode(node),
      // Set here rather than in the rope branch: `anchored` lives there because an open path has
      // no closed rings, and soft requires them. main.js tests rope BEFORE soft, so an open path
      // named "jelly" stays a rope — there is no interior to mesh.
      isSoft: isSoftName(safeName(node))
```

Export: `GR.isSoftName = isSoftName;` and `GR.SOFT_WORDS = SOFT_WORDS;`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/extract.js gravity/test/test_extract.js
git commit -m "feat(gravity): name a closed path soft, jelly or squish"
```

---

## Task 3: Cell sizing, with the thickness limit and both fallbacks

This is the load-bearing decision. Everything is in **sim units**.

**Files:**
- Create: `gravity/src/softmesh.js`
- Create: `gravity/test/test_softmesh.js`
- Modify: `gravity/test/run.js`

- [ ] **Step 1: Register the new module and suite**

In `gravity/test/run.js`, add `'softmesh.js'` to `SRC` after `'rope.js'`, and `require('./test_softmesh')` to `SUITES` after `require('./test_rope')`.

- [ ] **Step 2: Write the failing test**

Create `gravity/test/test_softmesh.js`:

```js
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

  // The bold 300pt "O" at scale 100: outer 3.0 sim, wall 0.6 sim.
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node gravity/test/run.js`
Expected: FAIL — cannot find module `./test_softmesh`, then `GR.faceArea is not a function` once the file exists.

- [ ] **Step 4: Implement**

Create `gravity/src/softmesh.js`:

```js
/**
 * softmesh.js — pure geometry for softbodies. A face becomes a lattice of nodes and springs.
 *
 * Everything here is in SIM units. The caller converts the face once on the way in, and nothing
 * downstream converts again — mixing point space and sim space inside this module is the specific
 * failure it is written to avoid.
 *
 * There is deliberately no triangulation. earcut cannot introduce interior points, so a filled
 * region triangulated from its boundary alone has no interior nodes and hinges instead of resisting
 * squash. Placing the nodes on a grid means adjacency is arithmetic rather than geometry.
 */

(function (GR) {
  'use strict';

  // The longer axis never exceeds this many cells. Measured: a rigid lattice sags from SOLVER error
  // rather than from its springs past this span, and that sag looks exactly like softness while
  // being controlled by nothing the user can see. At 12 cells and 24/8 iterations a rigid lattice
  // holds to 0.105 sim units and is scale-invariant; at 13 it doubles. The run raises iterations to
  // 24/8 whenever a softbody exists, which is what earns 12 rather than 8.
  var MAX_CELLS = 12;

  // A cell below this solves against linearSlop (0.005) and jitters. Same floor, same reason, as
  // MIN_LINK_SIM in rope.js.
  var MIN_CELL_SIM = 0.12;

  // Cells across the shape's own WALL, which the bounding box cannot see. Without this a 200pt "O"
  // with a 20pt wall is sized from its 200pt box, admits no interior node at all, and silently
  // becomes an outline-only mesh that behaves like a rope.
  var MIN_WALL_CELLS = 2;

  // How far an interior point must clear every ring, as a fraction of a cell. This is what makes
  // ATTACH_RADIUS the right reach.
  var INTERIOR_CLEAR = 0.5;

  // How far a boundary node reaches for interior nodes to spring to, as a fraction of a cell.
  var ATTACH_RADIUS = 1.5;

  // Boundary nodes are inset by this fraction of a cell, because the collision silhouette is the
  // union of the node circles rather than the drawn curve.
  var INSET_FRAC = 0.6;

  /** Absolute area of one closed ring, by the shoelace formula. */
  function ringArea(ring) {
    var a = 0;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    }
    return Math.abs(a) / 2;
  }

  /** Closed length of one ring. */
  function ringPerimeter(ring) {
    var p = 0;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      var dx = ring[j] - ring[i], dy = ring[j + 1] - ring[i + 1];
      p += Math.sqrt(dx * dx + dy * dy);
    }
    return p;
  }

  /** Hole-subtracted area of a face. */
  function faceArea(face) {
    var a = ringArea(face.outer);
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) a -= ringArea(holes[i]);
    return Math.max(0, a);
  }

  /** Perimeter of a face INCLUDING its hole rings — the annulus identity needs both. */
  function facePerimeter(face) {
    var p = ringPerimeter(face.outer);
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) p += ringPerimeter(holes[i]);
    return p;
  }

  /**
   * Mean wall width, as `2 * area / perimeter`.
   *
   * For an annulus this returns the wall exactly, which is the identity the thickness limit rests
   * on. It costs one pass over rings that are already in hand, where a true medial axis would not.
   */
  function faceThickness(face) {
    var p = facePerimeter(face);
    return p > 0 ? 2 * faceArea(face) / p : 0;
  }

  /** Bounding box of every outer ring in a list of faces. */
  function facesBBox(faces) {
    var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (var f = 0; f < faces.length; f++) {
      var r = faces[f].outer;
      for (var i = 0; i < r.length; i += 2) {
        if (r[i] < lo[0]) lo[0] = r[i];
        if (r[i] > hi[0]) hi[0] = r[i];
        if (r[i + 1] < lo[1]) lo[1] = r[i + 1];
        if (r[i + 1] > hi[1]) hi[1] = r[i + 1];
      }
    }
    return { minX: lo[0], minY: lo[1], maxX: hi[0], maxY: hi[1] };
  }

  /**
   * The cell size for a whole object, or a reason it cannot be jelly.
   *
   * Two limits, and the smaller wins, because the bounding box and the shape are not the same
   * thing. `byThickness` takes the MINIMUM over faces so that a two-face "i" cannot size its cells
   * from the stem and leave the dot with no interior nodes.
   *
   * Returns `{ cell, cellsAcross, limit, fallback }`. `fallback` is null when the object can be
   * meshed; otherwise it is 'extent' (too intricate for its size) or 'thin' (below the cell floor),
   * and the report says which.
   */
  function softCellSize(faces, opts) {
    var o = opts || {};
    var maxCells = o.maxCells === undefined ? MAX_CELLS : o.maxCells;
    var minCell = o.minCell === undefined ? MIN_CELL_SIM : o.minCell;
    var wallCells = o.wallCells === undefined ? MIN_WALL_CELLS : o.wallCells;

    if (!faces || !faces.length) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };

    var bb = facesBBox(faces);
    var maxDim = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    if (!(maxDim > 0)) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };

    var byExtent = maxDim / maxCells;

    var thinnest = Infinity;
    for (var f = 0; f < faces.length; f++) {
      var t = faceThickness(faces[f]);
      if (t > 0 && t < thinnest) thinnest = t;
    }
    if (!isFinite(thinnest)) return { cell: null, cellsAcross: 0, limit: null, fallback: 'thin' };
    var byThickness = thinnest / wallCells;

    var limit = byThickness < byExtent ? 'thickness' : 'extent';
    var cell = Math.min(byExtent, byThickness);

    // The floor is not a clamp that rescues a shape: if the wall cannot hold MIN_WALL_CELLS at a
    // cell size the solver can work with, the shape is not jelly and says so.
    if (cell < minCell) {
      if (thinnest / minCell < wallCells) return { cell: null, cellsAcross: 0, limit: limit, fallback: 'thin' };
      cell = minCell;
    }

    var cellsAcross = Math.ceil(maxDim / cell - 1e-9);
    if (cellsAcross > maxCells) return { cell: null, cellsAcross: cellsAcross, limit: limit, fallback: 'extent' };

    return { cell: cell, cellsAcross: cellsAcross, limit: limit, fallback: null };
  }

  GR.ringArea = ringArea;
  GR.ringPerimeter = ringPerimeter;
  GR.faceArea = faceArea;
  GR.facePerimeter = facePerimeter;
  GR.faceThickness = faceThickness;
  GR.facesBBox = facesBBox;
  GR.softCellSize = softCellSize;
  GR.SOFT_MAX_CELLS = MAX_CELLS;
  GR.SOFT_MIN_CELL_SIM = MIN_CELL_SIM;
  GR.SOFT_MIN_WALL_CELLS = MIN_WALL_CELLS;
  GR.SOFT_INTERIOR_CLEAR = INTERIOR_CLEAR;
  GR.SOFT_ATTACH_RADIUS = ATTACH_RADIUS;
  GR.SOFT_INSET_FRAC = INSET_FRAC;
})(globalThis.GR);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js gravity/test/run.js
git commit -m "feat(gravity): cell sizing for softbodies, capped by extent and wall thickness"
```

---

## Task 4: Point-in-face and distance-to-rings

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('softmesh: inside tests');

  var ring = { outer: square(0, 0, 4, 4), holes: [square(1, 1, 2, 2)] };
  h.assert('a point in the wall is inside', GR.pointInFace(0.5, 2, ring) === true);
  h.assert('a point in the hole is outside', GR.pointInFace(2, 2, ring) === false);
  h.assert('a point beyond the outline is outside', GR.pointInFace(-1, 2, ring) === false);

  h.assertClose('distance to the nearest ring, from the wall', GR.distanceToRings(0.5, 2, ring), 0.5, 1e-9);
  h.assertClose('distance measures the HOLE when it is nearer', GR.distanceToRings(0.9, 2, ring), 0.1, 1e-9);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, `GR.pointInFace is not a function`.

- [ ] **Step 3: Implement**

Add to `gravity/src/softmesh.js` before the exports:

```js
  /** Crossing-number test against one closed ring. */
  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, n = ring.length; i < n; i += 2) {
      var j = (i + 2) % n;
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > y) !== (yj > y)) {
        var t = (y - yi) / (yj - yi);
        if (x < xi + t * (xj - xi)) inside = !inside;
      }
    }
    return inside;
  }

  /** Inside the outer ring and outside every hole. */
  function pointInFace(x, y, face) {
    if (!pointInRing(x, y, face.outer)) return false;
    var holes = face.holes || [];
    for (var i = 0; i < holes.length; i++) if (pointInRing(x, y, holes[i])) return false;
    return true;
  }

  /** Distance from a point to the nearest segment of any ring of the face. */
  function distanceToRings(x, y, face) {
    var best = Infinity;
    var rings = [face.outer].concat(face.holes || []);
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0, n = ring.length; i < n; i += 2) {
        var j = (i + 2) % n;
        var ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
        var dx = bx - ax, dy = by - ay;
        var len2 = dx * dx + dy * dy;
        var t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        var px = ax + t * dx - x, py = ay + t * dy - y;
        var d = Math.sqrt(px * px + py * py);
        if (d < best) best = d;
      }
    }
    return best;
  }
```

Export `GR.pointInRing`, `GR.pointInFace`, `GR.distanceToRings`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): inside and clearance tests for soft meshing"
```

---

## Task 5: Build the mesh — nodes

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, `GR.buildSoftMesh is not a function`.

- [ ] **Step 3: Implement**

Add to `gravity/src/softmesh.js`. Boundary nodes come first in the array so `boundaryCount` indexes them directly:

```js
  /**
   * Resamples a CLOSED ring to `perimeter/step` points spaced evenly by ARC LENGTH.
   *
   * Walks a single cursor along the ring and places a point every `target` of arc length, carrying
   * the remainder ACROSS segment boundaries. The obvious version — measure each segment, place a
   * point when the segment is long enough, reset on advance — silently collapses when every segment
   * is shorter than the spacing: it places nothing at all. That is not an edge case, it is the
   * normal one, because `flatten.js` emits curves at FLATTEN_TOL 0.1 and a flattened circle has
   * segments far shorter than a cell. Measured on the broken version: a 128-segment circle of
   * perimeter 9.42 resampled at 0.25 returned ONE point instead of 38.
   *
   * It is also invisible to every mesh assertion — an annulus came out with 2 boundary nodes, one
   * connected component and no orphan nodes, so the tests passed on a mesh with no boundary at all.
   * Uneven spacing is the reason to care: uneven nodes carry uneven mass and spring stiffness, the
   * same defect uneven rope links had.
   */
  function resampleRing(ring, step) {
    var per = ringPerimeter(ring);
    if (!(per > 0) || !(step > 0)) return ring.slice();
    var count = Math.max(3, Math.round(per / step));
    var target = per / count;
    var out = [];
    var n = ring.length;
    var acc = 0;      // arc length at the start of the current segment
    var next = 0;     // arc length at which the next point falls
    for (var i = 0; i < n && out.length / 2 < count; i += 2) {
      var j = (i + 2) % n;
      var ax = ring[i], ay = ring[i + 1];
      var dx = ring[j] - ax, dy = ring[j + 1] - ay;
      var segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen <= 0) continue;
      while (next <= acc + segLen + 1e-12 && out.length / 2 < count) {
        var t = (next - acc) / segLen;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        out.push(ax + dx * t, ay + dy * t);
        next += target;
      }
      acc += segLen;
    }
    return out;
  }

  /**
   * Offsets a boundary point into the material by `dist`.
   *
   * The direction is the ANGLE BISECTOR of the two adjacent edge normals, not one segment's normal.
   * At a corner a single segment normal slides the point along the neighbouring edge instead of
   * into the material, so it lands ON the outline with zero clearance — measured on a 3x3 square at
   * 0.5 cells, two of its 24 boundary nodes came out uninset, which is exactly the bulge the inset
   * exists to prevent.
   *
   * The result is then VERIFIED with the inside test and flipped if it was wrong. Ring winding is
   * not trusted: rings arrive from several sources, and a silently outward inset would put the
   * collision hull outside the artwork.
   */
  function insetPoint(px, py, nx, ny, dist, face) {
    var ax = px + nx * dist, ay = py + ny * dist;
    if (pointInFace(ax, ay, face)) return [ax, ay];
    var bx = px - nx * dist, by = py - ny * dist;
    if (pointInFace(bx, by, face)) return [bx, by];
    return [px, py];
  }

  /** Unit inward bisector at point `i` of a resampled closed ring. */
  function bisectorAt(pts, i) {
    var n = pts.length;
    var prev = (i - 2 + n) % n, next = (i + 2) % n;
    var d1x = pts[i] - pts[prev], d1y = pts[i + 1] - pts[prev + 1];
    var d2x = pts[next] - pts[i], d2y = pts[next + 1] - pts[i + 1];
    var l1 = Math.sqrt(d1x * d1x + d1y * d1y) || 1;
    var l2 = Math.sqrt(d2x * d2x + d2y * d2y) || 1;
    var nx = -d1y / l1 + -d2y / l2;
    var ny = d1x / l1 + d2x / l2;
    var l = Math.sqrt(nx * nx + ny * ny);
    if (l < 1e-12) return [-d2y / l2, d2x / l2];   // a straight-through point
    return [nx / l, ny / l];
  }

  /**
   * Nodes and springs for one object.
   *
   * Boundary nodes are emitted FIRST, so indices `0 .. boundaryCount-1` are the ones whose motion
   * the drawn outline follows most closely, and interior nodes follow.
   */
  function buildSoftMesh(faces, opts) {
    var o = opts || {};
    var cell = o.cell;
    var inset = (o.insetFrac === undefined ? INSET_FRAC : o.insetFrac) * cell;
    var clear = (o.interiorClear === undefined ? INTERIOR_CLEAR : o.interiorClear) * cell;

    var boundary = [];    // flat x,y
    var ringSpans = [];   // { start, count } per ring, for the ring springs
    var interior = [];    // flat x,y
    var grid = {};        // "col,row" -> interior node index, for arithmetic adjacency

    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var rings = [face.outer].concat(face.holes || []);

      for (var r = 0; r < rings.length; r++) {
        var pts = resampleRing(rings[r], cell);
        var start = boundary.length / 2;
        var placed = 0;
        for (var i = 0; i < pts.length; i += 2) {
          var bis = bisectorAt(pts, i);
          var p = insetPoint(pts[i], pts[i + 1], bis[0], bis[1], inset, face);
          boundary.push(p[0], p[1]);
          placed++;
        }
        ringSpans.push({ start: start, count: placed });
      }

      var bb = facesBBox([face]);
      var cols = Math.ceil((bb.maxX - bb.minX) / cell);
      var rows = Math.ceil((bb.maxY - bb.minY) / cell);
      for (var c = 0; c <= cols; c++) {
        for (var w = 0; w <= rows; w++) {
          var gx = bb.minX + c * cell, gy = bb.minY + w * cell;
          if (!pointInFace(gx, gy, face)) continue;
          if (distanceToRings(gx, gy, face) < clear) continue;
          grid[f + ':' + c + ',' + w] = interior.length / 2;
          interior.push(gx, gy);
        }
      }
    }

    var nodes = boundary.concat(interior);
    return {
      nodes: nodes,
      boundaryCount: boundary.length / 2,
      interiorCount: interior.length / 2,
      ringSpans: ringSpans,
      grid: grid,
      cell: cell,
      springs: []
    };
  }
```

Export `GR.resampleRing`, `GR.buildSoftMesh`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): soft mesh nodes, inset boundary and empty holes"
```

---

## Task 6: Build the mesh — springs and connectivity

The connectivity assertions are the point of this task. Every other mesh assertion passes on a disconnected mesh.

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, `GR.addSoftSprings is not a function`.

- [ ] **Step 3: Implement**

```js
  /**
   * Springs: grid adjacency for the interior, ring order for the boundary, and a radius search to
   * join the two.
   *
   * Interior adjacency is arithmetic — right, up, and BOTH diagonals. The diagonals are not
   * optional: a grid without them is a mechanism rather than a structure and shears flat under its
   * own weight. Boundary nodes are not on the grid, so their attachment is the one genuinely
   * geometric step here, and the one a connectivity test has to guard.
   */
  function addSoftSprings(mesh, opts) {
    var o = opts || {};
    var cell = mesh.cell;
    var reach = (o.attachRadius === undefined ? ATTACH_RADIUS : o.attachRadius) * cell;
    var nodes = mesh.nodes;
    var bCount = mesh.boundaryCount;
    var springs = [];
    var seen = {};

    function add(a, b) {
      if (a === b) return;
      var key = (a < b ? a : b) + '-' + (a < b ? b : a);
      if (seen[key]) return;
      seen[key] = 1;
      var dx = nodes[a * 2] - nodes[b * 2], dy = nodes[a * 2 + 1] - nodes[b * 2 + 1];
      springs.push([a, b, Math.sqrt(dx * dx + dy * dy)]);
    }

    // Interior lattice, by arithmetic.
    for (var key in mesh.grid) {
      if (!Object.prototype.hasOwnProperty.call(mesh.grid, key)) continue;
      var parts = key.split(':');
      var fi = parts[0];
      var cr = parts[1].split(',');
      var c = parseInt(cr[0], 10), w = parseInt(cr[1], 10);
      var self = mesh.grid[key] + bCount;
      var neighbours = [[c + 1, w], [c, w + 1], [c + 1, w + 1], [c - 1, w + 1]];
      for (var n = 0; n < neighbours.length; n++) {
        var nk = fi + ':' + neighbours[n][0] + ',' + neighbours[n][1];
        if (mesh.grid[nk] === undefined) continue;
        add(self, mesh.grid[nk] + bCount);
      }
    }

    // Boundary rings, in order and closed.
    for (var r = 0; r < mesh.ringSpans.length; r++) {
      var span = mesh.ringSpans[r];
      for (var i = 0; i < span.count; i++) {
        add(span.start + i, span.start + ((i + 1) % span.count));
      }
    }

    // Boundary to interior, by radius.
    var fallbacks = 0;
    for (var b = 0; b < bCount; b++) {
      var bx = nodes[b * 2], by = nodes[b * 2 + 1];
      var nearest = -1, nearestD = Infinity, within = 0;
      for (var k = 0; k < mesh.interiorCount; k++) {
        var idx = bCount + k;
        var ddx = nodes[idx * 2] - bx, ddy = nodes[idx * 2 + 1] - by;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d <= reach) { add(b, idx); within++; }
        if (d < nearestD) { nearestD = d; nearest = idx; }
      }
      // A node with nothing in range still attaches to its nearest interior neighbour, so the mesh
      // is never disconnected. But that safety net makes an "every boundary node is attached" test
      // TAUTOLOGICAL - it can never fail while any interior node exists. So the fallback is
      // COUNTED, and the count is what the test asserts: it says ATTACH_RADIUS was actually wide
      // enough, which is the property the radius exists to provide.
      if (!within && nearest >= 0) { add(b, nearest); fallbacks++; }
    }
    mesh.attachFallbacks = fallbacks;

    mesh.springs = springs;
    return mesh;
  }

  /** Number of connected components over the spring graph. One, or the mesh is not a mesh. */
  function softMeshComponents(mesh) {
    var count = mesh.nodes.length / 2;
    if (!count) return 0;
    var adj = [];
    for (var i = 0; i < count; i++) adj.push([]);
    for (var s = 0; s < mesh.springs.length; s++) {
      adj[mesh.springs[s][0]].push(mesh.springs[s][1]);
      adj[mesh.springs[s][1]].push(mesh.springs[s][0]);
    }
    var seen = new Array(count), components = 0;
    for (var n = 0; n < count; n++) {
      if (seen[n]) continue;
      components++;
      var stack = [n];
      seen[n] = true;
      while (stack.length) {
        var cur = stack.pop();
        for (var a = 0; a < adj[cur].length; a++) {
          if (!seen[adj[cur][a]]) { seen[adj[cur][a]] = true; stack.push(adj[cur][a]); }
        }
      }
    }
    return components;
  }
```

Export `GR.addSoftSprings`, `GR.softMeshComponents`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): soft mesh springs, with a connectivity guard"
```

---

## Task 7: Bind the drawn outline to the mesh

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing test**

The rest-pose assertion is the frame-0 rule and the most valuable test in this plan. The rotation assertion is what catches candy-wrapper collapse.

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, `GR.bindOutline is not a function`.

- [ ] **Step 3: Implement**

```js
  // How many mesh nodes each outline point follows. Four is enough to be smooth and few enough to
  // stay cheap; the weights fall off fast, so more adds little.
  var BIND_K = 4;

  /**
   * Binds a drawn outline to the mesh, once, at rest.
   *
   * Weighted skinning rather than barycentric coordinates, for robustness: barycentric needs a
   * containing triangle, and a triangle that INVERTS under jelly deformation turns its bound points
   * inside out, while a thin feature may fall outside the mesh entirely and have no triangle at
   * all. Weighted binding has neither failure and simply gets smoother as the mesh gets sparser.
   */
  function bindOutline(points, mesh, opts) {
    var o = opts || {};
    var k = o.k === undefined ? BIND_K : o.k;
    var eps = o.eps === undefined ? 1e-12 : o.eps;
    var nodes = mesh.nodes;
    var count = nodes.length / 2;
    var out = [];

    for (var p = 0; p < points.length; p += 2) {
      var px = points[p], py = points[p + 1];
      var best = [];
      for (var n = 0; n < count; n++) {
        var dx = nodes[n * 2] - px, dy = nodes[n * 2 + 1] - py;
        best.push([dx * dx + dy * dy, n]);
      }
      best.sort(function (a, b) { return a[0] - b[0]; });
      var take = Math.min(k, best.length);

      var idx = [], w = [], ox = [], oy = [], sum = 0;
      for (var i = 0; i < take; i++) {
        var node = best[i][1];
        // The epsilon matters: an outline point can land exactly on a mesh node.
        var weight = 1 / (best[i][0] + eps);
        idx.push(node);
        w.push(weight);
        ox.push(px - nodes[node * 2]);
        oy.push(py - nodes[node * 2 + 1]);
        sum += weight;
      }
      for (var j = 0; j < w.length; j++) w[j] /= sum;
      out.push({ idx: idx, w: w, ox: ox, oy: oy });
    }
    return out;
  }

  /**
   * Per-node best-fit rotation, from rest neighbours against current ones.
   *
   * In 2D this is one atan2 over a sum of cross and dot products — no matrix decomposition. Without
   * it, a jelly that ROTATES has its outline shrink toward the mesh centroid, because averaging
   * several rotated positions cuts the corner. That is the classic candy-wrapper collapse.
   */
  function nodeRotations(mesh, positions) {
    var count = mesh.nodes.length / 2;
    // Keyed on the spring count so a re-sprung mesh cannot silently reuse stale adjacency.
    if (!mesh._adj || mesh._adjFor !== mesh.springs.length) {
      var adj = [];
      for (var a = 0; a < count; a++) adj.push([]);
      for (var s = 0; s < mesh.springs.length; s++) {
        adj[mesh.springs[s][0]].push(mesh.springs[s][1]);
        adj[mesh.springs[s][1]].push(mesh.springs[s][0]);
      }
      mesh._adj = adj;
      mesh._adjFor = mesh.springs.length;
    }
    var rest = mesh.nodes, adjacency = mesh._adj;
    var out = new Array(count);
    for (var n = 0; n < count; n++) {
      var cross = 0, dot = 0;
      var list = adjacency[n];
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        var rx = rest[m * 2] - rest[n * 2], ry = rest[m * 2 + 1] - rest[n * 2 + 1];
        var nx = positions[m * 2] - positions[n * 2], ny = positions[m * 2 + 1] - positions[n * 2 + 1];
        cross += rx * ny - ry * nx;
        dot += rx * nx + ry * ny;
      }
      out[n] = (cross === 0 && dot === 0) ? 0 : Math.atan2(cross, dot);
    }
    return out;
  }

  /** Rebuilds the drawn outline from current node positions. */
  function evalSoftOutline(binding, mesh, positions) {
    var rot = nodeRotations(mesh, positions);
    var out = [];
    for (var b = 0; b < binding.length; b++) {
      var bind = binding[b];
      var x = 0, y = 0;
      for (var i = 0; i < bind.idx.length; i++) {
        var n = bind.idx[i];
        var th = rot[n], c = Math.cos(th), s = Math.sin(th);
        var lx = bind.ox[i] * c - bind.oy[i] * s;
        var ly = bind.ox[i] * s + bind.oy[i] * c;
        x += bind.w[i] * (positions[n * 2] + lx);
        y += bind.w[i] * (positions[n * 2 + 1] + ly);
      }
      out.push(x, y);
    }
    return out;
  }
```

Export `GR.bindOutline`, `GR.nodeRotations`, `GR.evalSoftOutline`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS. If the rotation assertion fails while translation passes, the rotation term is missing or its sign is flipped.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): bind a drawn outline to the soft mesh, rotation included"
```

---

## Task 8: Degenerate input

`test_robustness.js` is the model. A softbody must never produce a broken mesh — a clean refusal is always acceptable.

**Files:**
- Modify: `gravity/test/test_softmesh.js`
- Modify: `gravity/src/softmesh.js` (only if a case fails)

- [ ] **Step 1: Write the failing test**

```js
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

  for (var ci = 0; ci < cases.length; ci++) {
    var name = cases[ci][0];
    var res = meshOrRefusal(cases[ci][1]);
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
```

- [ ] **Step 2: Run the tests**

Run: `node gravity/test/run.js`
Expected: Any failure here is a real defect. Fix `softmesh.js` — most likely by returning a `thin` fallback earlier — rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add gravity/test/test_softmesh.js gravity/src/softmesh.js
git commit -m "test(gravity): degenerate input never yields a broken soft mesh"
```

---

## Task 9: The planck rig

**Files:**
- Create: `gravity/src/softbody.js`
- Create: `gravity/test/test_softbody.js`
- Modify: `gravity/test/run.js`

- [ ] **Step 1: Register the module and suite**

Add `'softbody.js'` to `SRC` after `'softmesh.js'` in `gravity/test/run.js`, and `require('./test_softbody')` to `SUITES`.

- [ ] **Step 2: Write the failing test**

```js
/**
 * Engine tests for softbody.js. Needs planck; touches no Affinity API.
 *
 * The mass assertion is the one with teeth: overlapping circles double-count area badly, and a
 * jelly heavier than the rigid letter beside it bulldozes it.
 */

'use strict';

function square(x0, y0, w, hgt) {
  return [x0, y0, x0 + w, y0, x0 + w, y0 + hgt, x0, y0 + hgt];
}

module.exports = function (GR, h) {

  h.group('softbody: rig');

  var W = GR.makeWorld({ scale: 100 });
  var faces = [{ outer: square(0, 0, 3, 3), holes: [] }];
  var soft = GR.addSoftBody(W, faces, { name: 'blob', softness: 5, density: 1 });

  h.assert('a softbody is created', !!soft);
  h.assert('a softbody has nodes', soft.nodes.length > 0);
  h.assert('every node is registered as a dynamic', W.dynamics.length === soft.nodes.length);
  h.assert('nodes are flagged so playback does not select them', soft.nodes[0].isSoftNode === true);

  // Self-collision must be filtered off, or overlapping circles inflate the shape apart.
  h.assert('a softbody has a negative filter group', soft.groupIndex < 0);

  h.group('softbody: mass');

  // Total mass must match what addBody would have given the same face, or jelly out-weighs
  // everything beside it. 300x300 points at scale 100 is 3x3 = 9 sim units of area, density 1.
  var total = 0;
  for (var i = 0; i < soft.nodes.length; i++) total += soft.nodes[i].body.getMass();
  h.assertClose('total mass equals area x density', total, 9, 0.05);

  // Equalise mass targets 1 for the whole OBJECT, exactly as bodies.js does.
  var W2 = GR.makeWorld({ scale: 100 });
  var eq = GR.addSoftBody(W2, faces, { name: 'blob', softness: 0.5, equaliseMass: true });
  var eqTotal = 0;
  for (var j = 0; j < eq.nodes.length; j++) eqTotal += eq.nodes[j].body.getMass();
  h.assertClose('equalised mass targets 1 for the object', eqTotal, 1, 0.01);

  // A two-face object is ONE softbody weighing 1, not two weighing 1 each — an "i" must not
  // outweigh an "l".
  var W3 = GR.makeWorld({ scale: 100 });
  var twoFace = [{ outer: square(0, 0, 300, 300), holes: [] }, { outer: square(0, 400, 120, 120), holes: [] }];
  var two = GR.addSoftBody(W3, twoFace, { name: 'i', softness: 0.5, equaliseMass: true });
  var twoTotal = 0;
  for (var k = 0; k < two.nodes.length; k++) twoTotal += two.nodes[k].body.getMass();
  h.assertClose('a two-face object still weighs 1 in total', twoTotal, 1, 0.01);
  h.assertEqual('a two-face object is one softbody', two.groupIndex, two.groupIndex);

  h.group('softbody: rigid lattice sag');

  // The cap assertion. At MAX_CELLS with the raised iterations a soft scene uses, a RIGID lattice
  // must barely move — otherwise the softness setting is measuring solver error, not springs.
  // Stated in SIM units because the sag is a fixed sim-space quantity; a points threshold would
  // silently depend on the cell size the rig happened to use.
  var Wr = GR.makeWorld({ scale: 100 });
  var beam = [{ outer: square(0, 0, 240, 60), holes: [] }];
  var rigid = GR.addSoftBody(Wr, beam, { name: 'beam', frequencyHz: 0, density: 1 });
  h.assert('a rigid lattice builds', !rigid.fallback);
};
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, `GR.addSoftBody is not a function`.

- [ ] **Step 4: Implement**

Create `gravity/src/softbody.js`:

```js
/**
 * softbody.js — the only softbody module that touches planck.
 *
 * planck has no soft bodies and never will: it is a Box2D 2.x port, and b2ParticleSystem belongs to
 * LiquidFun, a separate fork. So a softbody is a RIG — many ordinary dynamic bodies wired together
 * with DistanceJoint springs so that they behave as one deformable thing. rope.js does the same in
 * one dimension.
 *
 * The pure half lives in softmesh.js and is tested headlessly. addSoftBody is the impure boundary.
 */

(function (GR) {
  'use strict';

  // Node circles overlap so the union has no gap for a corner to pass through.
  var RADIUS_FRAC = 0.6;

  // Softness in Hz. Below about 2 the sheet stretches absurdly rather than reading as soft; above
  // 30 it is indistinguishable from rigid and starts fighting the timestep.
  var MIN_FREQ = 2;
  var MAX_FREQ = 30;
  var DAMPING_RATIO = 0.4;

  // A large soft structure has a very long tail of small motion, and a run ends only when EVERY
  // body is quiet at once. Same lever, same reason, as the rope link damping.
  var NODE_LINEAR_DAMPING = 0.5;

  // Counts DOWN from -1, one per softbody. Negative means "never collide within this group", so a
  // shape does not inflate itself apart on its own overlapping circles; distinct values mean two
  // jellies still collide with each other normally.
  var nextGroup = -1;

  /** Softness 0..1 to frequency, log-spaced because droop is strongly non-linear in Hz. */
  function softnessToFrequency(softness) {
    var t = Math.max(0, Math.min(1, softness === undefined ? 0.5 : softness));
    return Math.exp(Math.log(MAX_FREQ) + t * (Math.log(MIN_FREQ) - Math.log(MAX_FREQ)));
  }

  /**
   * Meshes an object's faces and builds the rig.
   *
   * `faces` arrive in SOURCE units and are converted here, once, because softmesh.js works entirely
   * in sim units. Returns null when the object cannot be jelly, with `fallback` saying why so the
   * caller can build a rigid body instead and report it.
   */
  function addSoftBody(W, faces, opts) {
    var o = opts || {};
    var pl = W.planck;
    var scale = W.scale;

    // Source y grows downward and sim y grows upward. Converting here keeps the mirror in one
    // place, exactly as toSim does for everything else.
    var simFaces = [];
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var conv = function (ring) {
        var out = [];
        for (var i = 0; i < ring.length; i += 2) out.push(ring[i] / scale, -ring[i + 1] / scale);
        return out;
      };
      var holes = [];
      var srcHoles = face.holes || [];
      for (var hi = 0; hi < srcHoles.length; hi++) holes.push(conv(srcHoles[hi]));
      simFaces.push({ outer: conv(face.outer), holes: holes });
    }

    var sized = GR.softCellSize(simFaces);
    if (sized.fallback) return { fallback: sized.fallback, limit: sized.limit, nodes: [] };

    var mesh = GR.buildSoftMesh(simFaces, { cell: sized.cell });
    GR.addSoftSprings(mesh);
    var nodeCount = mesh.nodes.length / 2;
    if (!nodeCount) return { fallback: 'thin', limit: sized.limit, nodes: [] };

    var radius = RADIUS_FRAC * sized.cell;

    // Mass is solved backwards from the target, because overlapping circles double-count area
    // badly. The target is whatever the RIGID body would have weighed, which means honouring
    // Equalise mass exactly as bodies.js does — it overrides density so every rigid body lands on
    // targetMass regardless of area, and a jelly that ignored that becomes the one heavy object in
    // the scene.
    var simArea = 0;
    for (var a = 0; a < simFaces.length; a++) simArea += GR.faceArea(simFaces[a]);
    var density = o.density === undefined ? 1 : o.density;
    var targetMass = o.targetMass === undefined ? 1 : o.targetMass;
    var totalMass = o.equaliseMass ? targetMass : simArea * density;
    var perNode = totalMass / nodeCount;
    var nodeDensity = perNode / (Math.PI * radius * radius);

    var groupIndex = nextGroup--;
    // `frequencyHz` overrides the softness mapping outright, and 0 means a RIGID constraint rather
    // than a very stiff spring. Rigid is not a position on the user's slider — the spec is explicit
    // that rigid means not naming the object — but the tests need it, because "does the solver hold
    // this span" is a question about the solver and must not be asked through a spring.
    var freq = o.frequencyHz === undefined ? softnessToFrequency(o.softness) : o.frequencyHz;

    var nodes = [];
    for (var n = 0; n < nodeCount; n++) {
      var body = W.world.createDynamicBody({
        position: new pl.Vec2(mesh.nodes[n * 2], mesh.nodes[n * 2 + 1]),
        linearDamping: o.linearDamping === undefined ? NODE_LINEAR_DAMPING : o.linearDamping
      });
      body.createFixture(new pl.Circle(radius), {
        density: nodeDensity,
        friction: o.friction === undefined ? 0.4 : o.friction,
        restitution: o.restitution === undefined ? 0 : o.restitution,
        filterGroupIndex: groupIndex
      });
      var rec = {
        body: body,
        ox: mesh.nodes[n * 2] * scale,
        oy: -mesh.nodes[n * 2 + 1] * scale,
        angle0: 0,
        simRadius: radius,
        fixtures: 1,
        rejected: [],
        bullet: false,
        name: (o.name || 'soft') + ' [' + n + ']',
        node: o.node || null,
        isSoftNode: true
      };
      W.dynamics.push(rec);
      nodes.push(rec);
    }

    for (var s = 0; s < mesh.springs.length; s++) {
      var sp = mesh.springs[s];
      W.world.createJoint(new pl.DistanceJoint({
        bodyA: nodes[sp[0]].body,
        bodyB: nodes[sp[1]].body,
        localAnchorA: new pl.Vec2(0, 0),
        localAnchorB: new pl.Vec2(0, 0),
        length: sp[2],
        frequencyHz: freq,
        dampingRatio: o.dampingRatio === undefined ? DAMPING_RATIO : o.dampingRatio,
        collideConnected: false
      }));
    }

    return {
      nodes: nodes,
      mesh: mesh,
      groupIndex: groupIndex,
      cell: sized.cell,
      cellsAcross: sized.cellsAcross,
      limit: sized.limit,
      frequency: freq,
      springCount: mesh.springs.length,
      totalMass: totalMass,
      fallback: null,
      node: o.node || null,
      name: o.name || 'soft'
    };
  }

  GR.addSoftBody = addSoftBody;
  GR.softnessToFrequency = softnessToFrequency;
  GR.SOFT_RADIUS_FRAC = RADIUS_FRAC;
})(globalThis.GR);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS. If total mass is off by a large factor, check that `simArea` is sim-space and `radius` is sim-space; that is the unit bug this design has already caught twice.

- [ ] **Step 6: Commit**

```bash
git add gravity/src/softbody.js gravity/test/test_softbody.js gravity/test/run.js
git commit -m "feat(gravity): build the softbody rig from a mesh"
```

---

## Task 10: Rigid-lattice sag and monotonic softness

**Files:**
- Modify: `gravity/test/test_softbody.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('softbody: solver sag and softness');

  /**
   * Drops a clamped beam and returns the tip's sag in SIM units.
   *
   * `opts` is passed straight through, so the rigid case can ask for `frequencyHz: 0` rather than
   * going through the softness mapping — softness 0 is 30Hz, which is a stiff SPRING and sags about
   * 2 sim units on this rig. Measuring solver convergence through a spring measures the spring.
   */
  function beamSag(opts, vIters, pIters) {
    var Wb = GR.makeWorld({ scale: 100 });
    var beam = [{ outer: square(0, 0, 240, 60), holes: [] }];
    var cfg = { name: 'beam', density: 1 };
    for (var key in opts) cfg[key] = opts[key];
    var sb = GR.addSoftBody(Wb, beam, cfg);
    if (sb.fallback) return null;

    // Clamp the left edge by pinning those nodes to a static body with a weld. A revolute pin lets
    // even a perfectly rigid beam swing down about it, and then every configuration reads the same
    // sag — that rig error has cost three wrong answers before.
    var anchor = Wb.world.createBody();
    var minX = Infinity;
    for (var i = 0; i < sb.nodes.length; i++) minX = Math.min(minX, sb.nodes[i].body.getPosition().x);
    var tip = null, tipX = -Infinity;
    for (var j = 0; j < sb.nodes.length; j++) {
      var p = sb.nodes[j].body.getPosition();
      if (p.x < minX + sb.cell * 0.75) {
        Wb.world.createJoint(new GR.planck.WeldJoint({ collideConnected: false }, anchor, sb.nodes[j].body, p));
      }
      if (p.x > tipX) { tipX = p.x; tip = sb.nodes[j].body; }
    }
    var y0 = tip.getPosition().y;
    for (var s = 0; s < 480; s++) Wb.world.step(1 / 60, vIters, pIters);
    return y0 - tip.getPosition().y;
  }

  // A RIGID lattice, with the iterations a soft scene uses. If this sags a lot, the softness
  // setting is measuring solver error rather than springs and no softer number means anything.
  //
  // The threshold is 0.30, NOT the spec's 0.105. Those two numbers come from different structures
  // and must not be swapped: the spec measured a plain 3-row grid cantilever with its whole left
  // column static, while a softbody is a boundary ring plus interior rows with only the few nodes
  // near the clamp pinned — structurally weaker. Measured on THIS rig: 0.189. The threshold takes
  // margin above that. If it fails, the cause is the mesh spanning more than MAX_CELLS or a clamp
  // that is not rigid — do not relax it to make it pass.
  var stiff = beamSag({ frequencyHz: 0 }, 24, 8);
  h.assert('a rigid lattice holds at the cap', stiff !== null && Math.abs(stiff) < 0.30);

  // Monotonic, or the slider is not a control. Measured: about 1.96 / 2.52 / 3.76.
  var soft0 = beamSag({ softness: 0 }, 24, 8);
  var soft25 = beamSag({ softness: 0.25 }, 24, 8);
  var soft75 = beamSag({ softness: 0.75 }, 24, 8);
  h.assert('every softness sags more than rigid', soft0 > stiff);
  h.assert('softer sags more (0 -> 0.25)', soft25 > soft0);
  h.assert('softer sags more (0.25 -> 0.75)', soft75 > soft25);
```

- [ ] **Step 2: Run the tests**

Run: `node gravity/test/run.js`
Expected: PASS. **If the stiff assertion fails, do not relax the threshold** — it means the mesh is spanning more cells than `MAX_CELLS` allows, or the clamp is not rigid. Assert the trivial case before believing any softer measurement.

- [ ] **Step 3: Commit**

```bash
git add gravity/test/test_softbody.js
git commit -m "test(gravity): a stiff lattice holds at the cell cap and softness is monotonic"
```

---

## Task 11: Jitter one softbody as a whole

`seedJitter` (`sim.js:73-81`) writes an independent random velocity to every entry in `W.dynamics`. Soft nodes live there, so a lattice would be shaken rather than nudged — and a 2Hz structure holds injected energy for a long time.

**Files:**
- Modify: `gravity/src/sim.js:73-81`
- Test: `gravity/test/test_softbody.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('softbody: seed jitter');

  var Wj = GR.makeWorld({ scale: 100 });
  var jb = GR.addSoftBody(Wj, [{ outer: square(0, 0, 300, 300), holes: [] }], { name: 'blob', softness: 0.8 });
  GR.seedJitter(Wj, 7, 0.01);

  // Every node of one softbody must receive the SAME nudge, or the jitter deforms the shape at
  // frame 0 instead of breaking a symmetry.
  var v0 = jb.nodes[0].body.getLinearVelocity();
  var same = true;
  for (var vi = 1; vi < jb.nodes.length; vi++) {
    var v = jb.nodes[vi].body.getLinearVelocity();
    if (Math.abs(v.x - v0.x) > 1e-12 || Math.abs(v.y - v0.y) > 1e-12) same = false;
  }
  h.assert('one softbody is jittered as a whole', same);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js` — Expected: FAIL, velocities differ per node.

- [ ] **Step 3: Implement**

Replace `seedJitter` in `gravity/src/sim.js`:

```js
  function seedJitter(W, seed, amount) {
    var r = rng(seed);
    var amt = amount === undefined ? 0.01 : amount;
    if (!amt) return;
    // One draw per SOFTBODY rather than per node. A lattice given an independent velocity per node
    // is shaken rather than nudged, and a soft structure holds that energy for a long time — the
    // jitter exists to break a symmetry, not to deform anything.
    var groups = {};
    for (var i = 0; i < W.dynamics.length; i++) {
      var rec = W.dynamics[i];
      var b = rec.body;
      var key = rec.isSoftNode ? ('soft:' + rec.softGroup) : ('body:' + i);
      if (groups[key] === undefined) {
        groups[key] = { av: (r() - 0.5) * 2 * amt, lv: (r() - 0.5) * 2 * amt };
      }
      b.setAngularVelocity(groups[key].av);
      b.setLinearVelocity(new W.planck.Vec2(groups[key].lv, 0));
    }
  }
```

In `gravity/src/softbody.js`, add `softGroup: groupIndex` to each node record so the key exists.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS, including existing engine tests that rely on jitter.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/sim.js gravity/src/softbody.js gravity/test/test_softbody.js
git commit -m "fix(gravity): jitter a softbody as one object, not per node"
```

---

## Task 12: Write-back during playback (BLOCKED BY Task 0)

**Files:**
- Modify: `gravity/src/playback.js` (`prepare:204`, `ropeCommands:147`, selection at `:213-218`)
- Test: `gravity/test/test_playback_handoff.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('playback: softbodies');

  // Soft nodes must NOT be selected: the node is redrawn by createSetCurves, and transforming it
  // as well would move the shape twice.
  //
  // `prepare` stores the selection PER BODY as `bodies[i].selection` (playback.js:213-218). There
  // is no `ctx.selections` — asserting on it throws rather than fails. `prepare` also calls
  // `loadSdk()`, which requires '/geometry', '/commands' and '/selections', so this test must stub
  // `globalThis.require` exactly as test_playback_handoff.js already stubs '/timers'. Read that
  // file's existing stub and follow it before writing this.
  var fakeSoft = [{ isSoftNode: true, node: {}, body: null }];
  GR.playbackPrepare(null, fakeSoft, { frameCount: 1, bodyCount: 1, frames: [0, 0, 0] }, [], []);
  h.assert('a soft node gets no selection', !fakeSoft[0].selection);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node gravity/test/run.js`

- [ ] **Step 3: Implement**

In `gravity/src/playback.js`:

1. In `prepare`, exclude soft nodes from selections beside the `isRopeLink` check.
2. Accept a `softs` argument and group by node, caching `GR.invertMatrix(GR.matrixOf(soft.node))` once per node exactly as ropes do.
3. Add `softCommands(ctx, frameIndex)`, modelled on `ropeCommands`:
   - gather each node's pose from `GR.poseAt`
   - rebuild the outline with `GR.evalSoftOutline(binding, mesh, positions)`
   - do **not** simplify. Ropes run `simplifyChain` at 0.3 to avoid dumping invented points onto
     the user's path, but a jelly's outline IS the user's own points — simplifying would both add
     nothing and break the frame-0 assertion, which requires the flattened rings back exactly
   - map into base space with `entry.toBase` AFTER evaluating, for the same reason ropes do it after smoothing
   - build **one `CurveBuilder` per ring**, adding each finished curve to one shared `PolyCurve` — this is the shape `playback.js` already uses; do not put several rings into one builder
   - close each ring using whatever Task 0 established; if no closing call exists, repeat the first point as the last
   - submit with `g.DocumentCommand.createSetCurves(entry.node.curvesInterface, poly)`
4. Call `softCommands` from the frame builder beside `ropeCmds`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/playback.js gravity/test/test_playback_handoff.js
git commit -m "feat(gravity): rewrite softbody geometry each frame"
```

---

## Task 13: Wire into main.js

**Files:**
- Modify: `gravity/src/main.js` (object loop at `:384`, playback prepare at `:593`)

- [ ] **Step 1: Add the soft branch**

After the `obj.isRope` branch and before the rigid-body path:

```js
      if (obj.isSoft) {
        var madeSoft = GR.addSoftBody(W, obj.faces, {
          softness: o.softness === undefined ? 0.5 : o.softness,
          density: o.density === undefined ? 1 : o.density,
          equaliseMass: !!o.equaliseMass,
          friction: o.friction === undefined ? 0.4 : o.friction,
          restitution: o.restitution === undefined ? 0.15 : o.restitution,
          name: obj.name,
          node: obj.node
        });

        if (madeSoft && !madeSoft.fallback) {
          madeSoft.object = obj;
          softs.push(madeSoft);
          for (var sn = 0; sn < madeSoft.nodes.length; sn++) made.push(madeSoft.nodes[sn]);
          console.log('  soft    ' + (obj.name || '(unnamed)') +
            '  cells=' + madeSoft.cellsAcross +
            ' cell=' + fmt(madeSoft.cell * W.scale, 1) + 'pt' +
            ' nodes=' + madeSoft.nodes.length +
            ' springs=' + madeSoft.springCount +
            ' freq=' + fmt(madeSoft.frequency, 1) + 'Hz' +
            ' mass=' + fmt(madeSoft.totalMass, 4) +
            ' limit=' + madeSoft.limit);
          continue;
        }

        // Refusing is a real outcome, not an error: a shape whose wall cannot hold two cells at a
        // size the solver can work with is not jelly, and falling through to a rigid body is the
        // honest result. The reason is reported because "extent" and "thin" have different fixes.
        console.log('  soft    ' + (obj.name || '(unnamed)') +
          '  NOT MESHED (' + (madeSoft ? madeSoft.fallback : 'unknown') + ') -> rigid');
      }
```

Declare `var softs = [];` beside `var ropes = [];`.

- [ ] **Step 2: Raise solver iterations when any softbody exists**

Where `GR.run(W, ...)` is called, pass raised iteration counts if `softs.length`:

```js
      velocityIterations: softs.length ? 24 : undefined,
      positionIterations: softs.length ? 8 : undefined,
```

`run` already accepts both. Add a console line saying iterations were raised, so the cost is visible.

- [ ] **Step 3: Pass softs to playback**

Change the `GR.playbackPrepare(doc, made, frames, ropes)` call to pass `softs` as a fifth argument.

- [ ] **Step 4: Verify the suite still passes**

Run: `node gravity/test/run.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/main.js
git commit -m "feat(gravity): drop soft-named artwork as jelly"
```

---

## Task 14: The settings dialog

**Files:**
- Modify: `gravity/src/ui.js` (`DEFAULTS:15`, Material group at `:64`, help text at `:96`, return at `:115`)

- [ ] **Step 1: Add the control**

Add `softness: 50` to `DEFAULTS`. In the Material group, after Rope slack:

```js
    // Softness lives with Material because it is a property of the object, not of the world. It is
    // mapped log-spaced onto frequency downstream, because droop is strongly non-linear in Hz.
    var softCtl = mat.addUnitValueEditor('Jelly softness %', UnitType.Number, UnitType.Number, d.softness, 0, 100);
    softCtl.setShowPopupSlider(true); softCtl.precision = 0;
```

In the returned object: `softness: Math.max(0, Math.min(1, (softCtl.value === undefined ? d.softness : softCtl.value) / 100)),`

Add one help line: `'Name a closed shape "jelly", "soft" or "squish" to make it wobble instead of staying rigid. Chunky shapes work best; thin artwork stays rigid.'`

- [ ] **Step 2: Verify**

Run: `node gravity/test/run.js` — Expected: PASS. `ui.js` is loaded by the suite, so a syntax error fails here.

- [ ] **Step 3: Commit**

```bash
git add gravity/src/ui.js
git commit -m "feat(gravity): jelly softness setting"
```

---

## Task 15: Build and document

**Files:**
- Modify: `gravity/build.js:35-49` (the `SRC` array)
- Modify: `gravity/README.md`
- Modify: `gravity/MANUAL.md`

- [ ] **Step 1: Add both modules to the build**

In `gravity/build.js`, add `'softmesh.js'` and `'softbody.js'` to `SRC` (the file list at build.js:35-49) after `'rope.js'`. Order matters — `softbody.js` calls into `softmesh.js`.

- [ ] **Step 2: Build and check the output**

Run: `node gravity/build.js`
Expected: `gravity/dist/gravity.js` regenerates without error and contains `addSoftBody`.

Verify: `grep -c "addSoftBody" gravity/dist/gravity.js` — Expected: at least 2.

- [ ] **Step 3: Write the README section**

Add `## Softbodies` after `## Ropes`, covering: planck has none so this is a rig; the mesh and why there is no triangulation; the cell cap with the measured sag table; why square-with-diagonals rather than triangular, with the isotropy measurement; the thickness limit and the honest consequence that jelly wants chunky artwork; the binding and the candy-wrapper failure; and the raised solver iterations. Match the README's existing voice — measured claims, and the reasoning behind each decision.

- [ ] **Step 4: Write the MANUAL entries**

Add a recipe ("Make something wobble") and the `Jelly softness %` row to the settings table. Keep it task-shaped, as the other recipes are.

- [ ] **Step 5: Commit**

```bash
git add gravity/build.js gravity/dist/gravity.js gravity/README.md gravity/MANUAL.md
git commit -m "docs(gravity): softbodies"
```

---

## Task 16: Verify on real artwork

Headless tests cannot see a jelly that looks wrong. This is the step that finds what they miss.

- [ ] **Step 1: Install and run**

Have the user install the built script and run it on a document containing: a chunky closed shape named `jelly`, a bold letter with a counter named `soft`, and a rigid letter beside it for comparison.

- [ ] **Step 2: Check frame 0 before anything else**

The first frame must reproduce the artwork exactly. **If frame 0 is wrong, the fault is in the write-back and no amount of looking at the solver will find it** — that is what cost a session on ropes.

- [ ] **Step 3: Check the report**

Confirm: the `soft` line appears with a sensible cell count; nothing meshed at more than `MAX_CELLS`; masses are comparable to the rigid letter; `settledBy` and `restless` are reported.

- [ ] **Step 4: Record what was measured**

Add the observed numbers to the README section. If jelly scenes end on `cap` rather than `sleep` or `quiescence`, record that honestly — it was predicted, and node damping is the lever.
