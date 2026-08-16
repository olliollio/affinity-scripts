# Softbody Self-Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a jelly passing through itself, so a crescent's arm can no longer fold into its own body and gouge the artwork with an even-odd hole.

**Architecture:** Every boundary node gains a second, smaller circle fixture that collides only with its own kind. Because `collideConnected: false` is already on every spring, a pair that is jointed cannot generate a contact — so any boundary pair sitting inside the new contact distance at rest is given a "brace" spring first, which both removes the frame-0 contact and adds structure where the lattice had none. The brace rule is pure distance with no ring-separation threshold, which makes a frame-0 explosion impossible by construction.

**Tech Stack:** planck.js 1.5.0 (vendored Box2D 2.x port), plain ES5-style JavaScript in `gravity/src/`, headless test suite under `gravity/test/` run by `node gravity/test/run.js`, bundle rebuilt by `node gravity/build.js`.

**Spec:** `docs/superpowers/specs/2026-08-16-softbody-self-collision-and-pressure-design.md`

**Not in this plan:** Part 2 of the spec (pressure / area preservation) is deliberately excluded. The spec requires self-collision to land alone so the pressure term is later tuned against a lattice that can no longer pass through itself.

---

## Background the implementer needs

**A softbody is a rig, not a body type.** planck has no soft bodies. `addSoftBody` in `gravity/src/softbody.js` builds many ordinary dynamic circle bodies on a grid and wires them with `DistanceJoint` springs. `gravity/src/softmesh.js` is the pure half — it takes faces and returns nodes and springs, and is tested headlessly with no planck world.

**Node layout.** `buildSoftMesh` emits boundary nodes **first**, so boundary nodes are indices `0 .. mesh.boundaryCount - 1` and interior nodes follow. `mesh.ringSpans` is a `{start, count}` per ring over those contiguous boundary nodes, in ring order.

**Springs.** `addSoftSprings` gives the interior a grid lattice with both diagonals, gives each ring its `i↔i+1` links, and attaches each boundary node to interior nodes within `1.5 * cell`. **Boundary nodes get no grid adjacency** — that is the fact this whole plan turns on. Two boundary nodes can therefore sit very close with no spring between them.

**Units.** `addSoftBody` takes faces in SOURCE units (points) and converts once. `softmesh.js` works entirely in SIM units. Test fixtures are written in points. A fixture accidentally written in sim units falls under the cell floor and returns `fallback: 'thin'` — check that first if tests go red.

**Why a second fixture rather than changing the existing one.** The existing `0.6 * cell` circle overlaps its neighbours by design; that overlap is what leaves the union no gap for a corner to pass through. Letting siblings collide with it would inflate every shape apart.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `gravity/src/softmesh.js` | Pure geometry. Gains `softBraces` — the unjointed boundary pairs inside a given distance. | Modify |
| `gravity/src/softbody.js` | The planck boundary. Gains the self-contact fixture, calls `softBraces`, records the brace diagnostics. | Modify |
| `gravity/src/main.js` | Reporting only. Prints brace count and the hairline warning. | Modify |
| `gravity/test/test_softmesh.js` | Pure tests for `softBraces` and `outlineFoldDepth`. | Modify |
| `gravity/test/test_softbody.js` | Rig tests: fixture filtering, mass invariance, the frame-0 invariant, the settle regression. | Modify |
| `gravity/test/fixtures_softscene.js` | The ten real scene shapes plus the `teardrop`, `squareRing` and `cShape` constructors, shared by both test files. **Already written — do not recreate.** | Done |
| `gravity/dist/gravity.js` | Generated bundle. Never edited by hand. | Rebuild |

---

## Task 1: `softBraces` — find the pairs that must be jointed

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing tests**

Add to `gravity/test/test_softmesh.js`, inside the exported function:

These fixtures are hand-built rather than meshed, so each assertion is about `softBraces` alone. All
four have been executed against the implementation below and produce the stated values.

**Watch the index arithmetic.** Ring separation wraps, so on a 5-ring the pair `(0, 3)` is *two*
apart, not three. An earlier draft of this test used `[0,0, 1,0, 2,0, 2.1,0.05, ...]` and asserted
the close pair `(2, 3)` would brace — it does not, because 2 and 3 are ring neighbours and therefore
already jointed. The fixture tested nothing and passed for the wrong reason.

```js
  h.group('softmesh: self-contact braces');

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

  // Ring NEIGHBOURS are already jointed, so they must never be braced however close they are -
  // a brace there would be a duplicate spring.
  var near = braceMesh([0, 0,  0.1, 0,  1, 1,  0, 1], 4);
  GR.addSoftSprings(near);
  h.assertEqual('ring neighbours are never braced', GR.softBraces(near, 0.5).pairs.length, 0);

  // No threshold on ring separation: the whole point. On an 8-ring, 0 and 3 really are 3 apart.
  var far = braceMesh([0, 0,  2, 0,  4, 0,  0.05, 0.05,  4, 4,  3, 5,  2, 5,  0, 4], 8);
  GR.addSoftSprings(far);
  var farBraces = GR.softBraces(far, 0.5);
  h.assertEqual('a pair three apart along the ring is braced', farBraces.pairs.length, 1);
  h.assertEqual('its separation is reported as three', farBraces.maxArc, 3);

  // Nothing close means nothing braced, which is the ordinary case.
  var open = braceMesh([0, 0,  3, 0,  3, 3,  0, 3], 4);
  GR.addSoftSprings(open);
  h.assertEqual('a shape with no close pair is not braced', GR.softBraces(open, 0.5).pairs.length, 0);
```

`addSoftSprings` tolerates the empty `grid: {}` on these hand-built meshes — verified, not assumed.

- [ ] **Step 2: Run to verify it fails**

Run: `node gravity/test/run.js 2>&1 | grep -A2 "self-contact braces"`
Expected: FAIL — `GR.softBraces is not a function`.

- [ ] **Step 3: Implement `softBraces`**

Add to `gravity/src/softmesh.js`, after `addSoftSprings`:

```js
  /**
   * Boundary pairs that must be jointed before self-contact fixtures can exist.
   *
   * A softbody's nodes never collided with each other, so nothing stopped one arm entering
   * another. Giving boundary nodes a small collision fixture fixes that, but only if no pair
   * STARTS inside the contact distance - a pair that does would be pushed apart on the first
   * step and the shape would inflate itself apart.
   *
   * Every such pair is therefore given a spring, which removes the contact via the
   * `collideConnected: false` that every joint in this rig already carries. That makes a frame-0
   * explosion impossible by construction rather than by margin.
   *
   * There is deliberately NO ring-separation threshold. It is tempting to brace only `i,i+2`,
   * because that is the only separation that occurs on a sample of ten real shapes - but the
   * convergence band is caused by `insetPoint` pushing nodes INSET_FRAC into the material from
   * both sides, so its width scales as 1/sin(half-angle). Measured on teardrops: 3 at a 39 degree
   * tip, 4 at 33 degrees, where the two-apart pair is OUTSIDE the contact distance and an
   * `|i-j| <= 2` rule would fire nothing at all.
   *
   * A brace can never span a GAP, only material: the inset moves both nodes away from empty
   * space, so across a gap the separation is at least 2 * INSET_FRAC * cell = 1.2 cells, well
   * outside any contact distance this rig uses. A "C" cannot be welded into an "O".
   */
  function softBraces(mesh, contactFrac) {
    var contact = contactFrac * mesh.cell;
    var nodes = mesh.nodes, bCount = mesh.boundaryCount;

    var jointed = {};
    for (var s = 0; s < mesh.springs.length; s++) {
      var a = mesh.springs[s][0], b = mesh.springs[s][1];
      jointed[(a < b ? a : b) + '-' + (a < b ? b : a)] = 1;
    }

    // Ring separation, so the report can say how far apart a braced pair was. Cross-ring and
    // cross-face pairs have no separation at all and report -1.
    function arcSeparation(p, q) {
      for (var r = 0; r < mesh.ringSpans.length; r++) {
        var span = mesh.ringSpans[r];
        var inP = p >= span.start && p < span.start + span.count;
        var inQ = q >= span.start && q < span.start + span.count;
        if (inP && inQ) {
          var raw = Math.abs(p - q);
          return Math.min(raw, span.count - raw);
        }
      }
      return -1;
    }

    var pairs = [], maxArc = 0;
    // Every boundary node against every other, across rings and across faces alike. Scoping this
    // per ring would leave a cross-ring pair in contact at rest, and the guarantee would be gone.
    for (var p = 0; p < bCount; p++) {
      for (var q = p + 1; q < bCount; q++) {
        if (jointed[p + '-' + q]) continue;
        var dx = nodes[p * 2] - nodes[q * 2], dy = nodes[p * 2 + 1] - nodes[q * 2 + 1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= contact) continue;
        pairs.push([p, q, d]);
        var arc = arcSeparation(p, q);
        if (arc > maxArc) maxArc = arc;
      }
    }
    return { pairs: pairs, maxArc: maxArc };
  }
```

And export it beside the others near the bottom of the file:

```js
  GR.softBraces = softBraces;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS, total assertion count risen by 6.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): find the boundary pairs that block self-collision"
```

---

## Task 2: The shared scene fixture — ALREADY DONE

**Files:**
- Created: `gravity/test/fixtures_softscene.js` ✅

**This task is complete.** The file was generated from the source artwork SVG and committed. It
exports `SCENE` (the ten real shapes, 64 points each, in SOURCE units, with `folds` marking the four
that fold today), plus three shape constructors the later tasks need: `teardrop`, `squareRing` and
`cShape`.

It has been run against the real pipeline and reproduces every figure the spec relies on:

| shape | cell | boundary nodes | closest unjointed | braces at 0.5c | after bracing |
|---|---|---|---|---|---|
| yellowgreen | 0.1994 | 28 | 0.401c | 1 | 0.741c |
| pink | 0.1200 | 21 | 0.420c | 1 | 0.668c |
| cyan | 0.1338 | 31 | 0.429c | 1 | 0.646c |
| green | 0.1200 | 21 | 0.493c | 1 | 0.684c |
| grey | 0.1200 | 19 | 0.600c | 0 | — |
| orange, blue, amber, teal, purple | — | 16–34 | 0.74–0.94c | 0 | — |

Teardrops, widest brace ring separation: **60° → 2, 47° → 2, 39° → 3, 33° → 4, 29° → 6.** The
`squareRing(300, 12)` stiffness fixture braces **0** pairs, which is what pins the radius at
`0.25 * cell`.

The "C" invariant holds at every aperture from 0.6 rad down to 0.015 rad — a mouth almost shut —
with **zero braces spanning the gap** in all eight. At the tightest mouths the widest brace
separation reaches **19 and 24**, across material near the cut faces, which is precisely why the rule
must not have a ring-separation threshold.

> ⚠️ **DO NOT WRITE THIS FILE.** It already exists, fully populated, and there is no artwork source
> in the repo to regenerate it from. The skeleton below is a description of what is already there,
> retained so a reader knows the shape of it. Writing it would replace real ring data with empty
> arrays and the data would be unrecoverable.

<details><summary>Structure of the file that already exists — reference only, do not write</summary>

```js
/**
 * The ten-shape scene the self-collision defect was measured on, in SOURCE units.
 *
 * Four of these fold through themselves when settled as jelly at softness 25 - orange with 1
 * crossing, amber 1, purple 1, green 3 - and the other six do not. Both halves matter: a fix that
 * stops the folding by stiffening everything would show up as the six changing too.
 *
 * Kept as flattened polylines rather than curves so the fixture cannot drift with the flattener.
 */

'use strict';

// name, folds-when-settled, ring (flat x,y pairs in points)
var SCENE = [
  { name: 'teal',         folds: false, ring: [ /* ... */ ] },
  { name: 'grey',         folds: false, ring: [ /* ... */ ] },
  { name: 'orange',       folds: true,  ring: [ /* ... */ ] },
  { name: 'blue',         folds: false, ring: [ /* ... */ ] },
  { name: 'amber',        folds: true,  ring: [ /* ... */ ] },
  { name: 'cyan',         folds: false, ring: [ /* ... */ ] },
  { name: 'pink',         folds: false, ring: [ /* ... */ ] },
  { name: 'purple',       folds: true,  ring: [ /* ... */ ] },
  { name: 'yellowgreen',  folds: false, ring: [ /* ... */ ] },
  { name: 'green',        folds: true,  ring: [ /* ... */ ] }
];

/**
 * A teardrop: a disc with a tangent wedge running to an apex.
 *
 * The construction is here rather than inline in a test because two reasonable constructions
 * disagree about WHICH ring separation comes out closest, so a test asserting a separation has to
 * pin the shape exactly. Half-angle satisfies sin(alpha) = R / D, so the tip angle is 2 * alpha.
 */
function teardrop(tipDegrees, R, segments) {
  var alpha = tipDegrees / 2 * Math.PI / 180;
  var D = R / Math.sin(alpha);
  var ta = Math.acos(R / D);
  var ring = [];
  for (var i = 0; i <= segments; i++) {
    var th = ta + (2 * Math.PI - 2 * ta) * i / segments;
    ring.push(R * Math.cos(th), R * Math.sin(th));
  }
  ring.push(D, 0);
  return ring;
}

/** A square, the shape the stiffness table was measured on. */
function squareRing(side, perEdge) {
  var pts = [[0, 0], [side, 0], [side, side], [0, side]], out = [];
  for (var e = 0; e < 4; e++) {
    for (var t = 0; t < perEdge; t++) {
      var u = t / perEdge, a = pts[e], b = pts[(e + 1) % 4];
      out.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
    }
  }
  return out;
}

module.exports = { SCENE: SCENE, teardrop: teardrop, squareRing: squareRing, cShape: cShape };
```

Rings were flattened at 16 segments per cubic with the SVG transforms applied and **the repeated
closing point dropped**: Affinity writes one explicitly, and a zero-length final segment makes
`outlineFolds` score a phantom crossing, so a clean square would read as folded.

</details>

- [ ] **Step 1: Confirm the fixture is present and sane**

Run:
```bash
node -e "
var f=require('./gravity/test/fixtures_softscene');
console.log('shapes', f.SCENE.length, 'folding', f.SCENE.filter(function(s){return s.folds;}).length);
console.log('constructors', typeof f.teardrop, typeof f.squareRing, typeof f.cShape);
"
```
Expected: `shapes 10 folding 4` and three `function`s.

---

## Task 3: Brace the rig, and assert the frame-0 invariant

**Files:**
- Modify: `gravity/src/softbody.js`
- Test: `gravity/test/test_softbody.js`

- [ ] **Step 1: Write the failing test**

Add to `gravity/test/test_softbody.js`:

```js
  h.group('softbody: no pair starts in self-contact');

  var scene = require('./fixtures_softscene');

  // THE frame-0 assertion. Every boundary pair that is not jointed must sit outside the contact
  // distance at rest - otherwise the shape is pushed apart on step one. Four of the ten scene
  // shapes violate this without braces, and so do sharp teardrops, which is why both are here:
  // the scene alone never exercises a ring separation above 2.
  function noPairInContact(label, ring) {
    var Wc = GR.makeWorld({ scale: 100 });
    var rig = GR.addSoftBody(Wc, [{ outer: ring, holes: [] }], { name: label, softness: 0.25 });
    h.assert(label + ' meshes', !rig.fallback, rig.fallback || '');
    if (rig.fallback) return;

    var mesh = rig.mesh, contact = 2 * GR.SOFT_SELF_RADIUS_FRAC * mesh.cell;
    var jointed = {};
    for (var s = 0; s < mesh.springs.length; s++) {
      var a = mesh.springs[s][0], b = mesh.springs[s][1];
      jointed[(a < b ? a : b) + '-' + (a < b ? b : a)] = 1;
    }
    var worst = Infinity;
    for (var p = 0; p < mesh.boundaryCount; p++) {
      for (var q = p + 1; q < mesh.boundaryCount; q++) {
        if (jointed[p + '-' + q]) continue;
        var dx = mesh.nodes[p * 2] - mesh.nodes[q * 2];
        var dy = mesh.nodes[p * 2 + 1] - mesh.nodes[q * 2 + 1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < worst) worst = d;
      }
    }
    h.assert('no unjointed pair of ' + label + ' starts in contact', worst >= contact,
      'closest ' + (worst / mesh.cell).toFixed(3) + 'c against contact ' +
      (contact / mesh.cell).toFixed(3) + 'c');
  }

  for (var si = 0; si < scene.SCENE.length; si++) {
    noPairInContact(scene.SCENE[si].name, scene.SCENE[si].ring);
  }
  [60, 47, 39, 33, 29].forEach(function (deg) {
    noPairInContact('teardrop' + deg, scene.teardrop(deg, 100, 96));
  });

  // A brace never spans a gap, only material. This is what makes the unbounded rule safe, and the
  // shape that would disprove it is a "C" whose mouth has nearly closed.
  h.group('softbody: a brace never spans a gap');
  var cRing = [];
  (function () {
    var Ro = 120, Ri = 60, open = 0.05;
    for (var i = 0; i <= 64; i++) {
      var a = open + (2 * Math.PI - 2 * open) * i / 64;
      cRing.push(Ro * Math.cos(a), Ro * Math.sin(a));
    }
    for (var j = 64; j >= 0; j--) {
      var b = open + (2 * Math.PI - 2 * open) * j / 64;
      cRing.push(Ri * Math.cos(b), Ri * Math.sin(b));
    }
  })();
  var Wc2 = GR.makeWorld({ scale: 100 });
  var cRig = GR.addSoftBody(Wc2, [{ outer: cRing, holes: [] }], { name: 'C', softness: 0.25 });
  h.assert('a nearly-closed C still meshes', !cRig.fallback, cRig.fallback || '');
  if (!cRig.fallback) {
    // The mouth is the only place two boundary nodes face each other across empty space. If any
    // brace landed there the C would be welded into an O, which is worse than the bug.
    h.assert('no brace welds the C shut', cRig.braceAcrossGap === 0,
      'braces across a gap: ' + cRig.braceAcrossGap);
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node gravity/test/run.js 2>&1 | grep -c FAIL`
Expected: several failures — `GR.SOFT_SELF_RADIUS_FRAC` is undefined, so `contact` is `NaN`, and `braceAcrossGap` is undefined.

- [ ] **Step 3: Implement braces in the rig**

In `gravity/src/softbody.js`, add the constant beside `RADIUS_FRAC`:

```js
  // The self-contact circle, a SECOND fixture that collides only with its own kind.
  //
  // 0.25 is a constraint rather than a preference. The 300pt square blob the stiffness table was
  // measured on has its closest unjointed boundary pair at 0.566 * cell, across an ordinary 90
  // degree corner - so at 0.3 the contact distance would be 0.6 * cell, a brace would fire on all
  // four corners of that fixture, and the table would move. At 0.25 the contact distance is
  // 0.5 * cell and nothing braces on either stiffness fixture.
  //
  // It cannot be raised to close the gap between the node ring and the drawn outline either.
  // INSET_FRAC and RADIUS_FRAC are both 0.6 on purpose - that identity is what makes the union of
  // the node circles reproduce the drawn silhouette - so the outline sits 0.6 * cell outside the
  // node ring and two surfaces overlap 0.7 * cell before contact fires. Self-collision BOUNDS
  // crossing depth; it does not remove crossings.
  var SELF_RADIUS_FRAC = 0.25;
```

After `GR.addSoftSprings(mesh);` in `addSoftBody`, add the braces:

```js
    // Brace every unjointed boundary pair that starts inside the self-contact distance, BEFORE any
    // fixture exists. Bracing removes the contact through the `collideConnected: false` that every
    // joint here already carries, so no pair can start overlapping and the shape cannot inflate
    // itself apart on step one.
    var braces = GR.softBraces(mesh, 2 * SELF_RADIUS_FRAC);
    for (var bz = 0; bz < braces.pairs.length; bz++) {
      // Rest length is the pair's current separation, exactly as addSoftSprings records it.
      mesh.springs.push([braces.pairs[bz][0], braces.pairs[bz][1], braces.pairs[bz][2]]);
    }
```

Note this must run **before** `var nodeCount = mesh.nodes.length / 2;` is used to build joints, and the braces are appended to `mesh.springs` so the existing joint loop creates them with no change — they take the same frequency and damping as every other spring, which is deliberate: a brace permanently removes that pair's contact, so a brace soft enough to be pushed through would let the two nodes pass with nothing to stop them.

Add the diagnostics to the returned record:

```js
      braceCount: braces.pairs.length,
      braceMaxArc: braces.maxArc,
      braceAcrossGap: acrossGap,
```

**The `give` fallback record must hard-code zeros, not read `braces`.** `give` is defined at
`softbody.js:120` and first called at line 130, *before* `braces` is ever assigned — writing
`braces.pairs.length` there throws `TypeError: Cannot read properties of undefined`, and because it
is an uncaught throw out of a test file the **whole suite dies** rather than one assertion failing.
This was verified by applying the edit literally and watching the existing hairline test crash.

```js
      // Nothing was meshed, so nothing was braced. Must not reference `braces`: give() runs before
      // it exists.
      braceCount: 0, braceMaxArc: 0, braceAcrossGap: 0,
```

`braceAcrossGap` counts braces whose midpoint falls outside the material — it should always be zero, and it is asserted rather than assumed. Compute it with the existing point-in-face test:

```js
    var acrossGap = 0;
    for (var ag = 0; ag < braces.pairs.length; ag++) {
      var na = braces.pairs[ag][0], nb = braces.pairs[ag][1];
      var mx = (mesh.nodes[na * 2] + mesh.nodes[nb * 2]) / 2;
      var my = (mesh.nodes[na * 2 + 1] + mesh.nodes[nb * 2 + 1]) / 2;
      var inside = false;
      for (var fq = 0; fq < simFaces.length; fq++) {
        if (GR.pointInFace(mx, my, simFaces[fq])) { inside = true; break; }
      }
      if (!inside) acrossGap++;
    }
```

If `pointInFace` is not currently exported from `softmesh.js`, export it — it is already a pure function there.

Export the constant at the bottom of `softbody.js`:

```js
  GR.SOFT_SELF_RADIUS_FRAC = SELF_RADIUS_FRAC;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS. If a scene shape still reports a pair in contact, `softBraces` is being called with a fraction rather than a distance — the argument is the contact **distance** as a fraction of a cell, `2 * SELF_RADIUS_FRAC`, not the radius.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softbody.js gravity/src/softmesh.js gravity/test/test_softbody.js
git commit -m "feat(gravity): brace the pairs that would start in self-contact"
```

---

## Task 4: The self-contact fixture

**Files:**
- Modify: `gravity/src/softbody.js`
- Test: `gravity/test/test_softbody.js`

- [ ] **Step 1: Write the failing test**

```js
  h.group('softbody: the self-contact fixture');

  var Ws = GR.makeWorld({ scale: 100 });
  var sq300 = [{ outer: square(0, 0, 300, 300), holes: [] }];
  var sRig = GR.addSoftBody(Ws, sq300, { name: 'blob', softness: 0.25, density: 1 });

  // Boundary nodes carry two fixtures, interior nodes one: only the boundary can fold visibly, and
  // restricting it keeps the added contact pairs proportional to the perimeter, not the area.
  var bFix = sRig.nodes[0].body.getFixtureList();
  var bCountFix = 0;
  for (var f0 = bFix; f0; f0 = f0.getNext()) bCountFix++;
  h.assertEqual('a boundary node has two fixtures', bCountFix, 2);
  h.assertEqual('the record reports two fixtures', sRig.nodes[0].fixtures, 2);

  var iFix = sRig.nodes[sRig.mesh.boundaryCount].body.getFixtureList();
  var iCountFix = 0;
  for (var f1 = iFix; f1; f1 = f1.getNext()) iCountFix++;
  h.assertEqual('an interior node has one fixture', iCountFix, 1);

  // The self-contact fixture must be invisible to the world. Group index MUST be 0: in planck a
  // matching non-zero group short-circuits category and mask entirely, so inheriting the body's
  // negative group would leave the feature inert while looking implemented.
  var selfFix = null;
  for (var f2 = bFix; f2; f2 = f2.getNext()) {
    if (f2.getShape().m_radius < GR.SOFT_RADIUS_FRAC * sRig.cell) selfFix = f2;
  }
  h.assert('the self-contact fixture exists', !!selfFix);
  h.assertEqual('it is in no filter group', selfFix.getFilterGroupIndex(), 0);
  h.assertEqual('it masks only its own category',
    selfFix.getFilterMaskBits(), selfFix.getFilterCategoryBits());
  h.assertClose('its radius is SELF_RADIUS_FRAC of a cell',
    selfFix.getShape().m_radius, GR.SOFT_SELF_RADIUS_FRAC * sRig.cell, 1e-9);

  // Mass must not move. Node density is solved backwards from a target, so a second fixture with
  // density would add roughly 25% per node and invalidate every number in the stiffness table.
  var Wm = GR.makeWorld({ scale: 100 });
  var mRig = GR.addSoftBody(Wm, sq300, { name: 'blob', softness: 0.25, density: 1 });
  var totalMass = 0;
  for (var mi = 0; mi < mRig.nodes.length; mi++) totalMass += mRig.nodes[mi].body.getMass();
  h.assertClose('the second fixture adds no mass', totalMass, mRig.totalMass, mRig.totalMass * 0.02);

  // The radius is pinned by these two fixtures: neither may brace, or the stiffness table moves.
  h.assertEqual('the square blob needs no brace', sRig.braceCount, 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node gravity/test/run.js 2>&1 | grep -A6 "self-contact fixture"`
Expected: FAIL — a boundary node has one fixture, not two.

- [ ] **Step 3: Implement the fixture**

In `softbody.js`, add the category constant beside `SELF_RADIUS_FRAC`:

```js
  // A category of its own, masked to itself alone, so the self-contact circle is invisible to the
  // ground, the walls and every other object. Collision needs BOTH directions to agree
  // - (catA & maskB) && (catB & maskA) - so masking one side is enough: an ordinary fixture is
  // category 1 by default, and 1 & SELF_CATEGORY is 0.
  //
  // Two DIFFERENT jellies' self-contact circles do share this category and so can collide, which
  // is harmless: at 0.25 * cell they sit well inside the 0.6 * cell world fixtures, which touch
  // first and keep them apart.
  var SELF_CATEGORY = 0x0002;
```

In the node creation loop, after the existing `body.createFixture(...)`, add:

```js
      // Boundary nodes only. Indices 0 .. boundaryCount-1 are the boundary by construction.
      if (n < mesh.boundaryCount) {
        body.createFixture(new pl.Circle(SELF_RADIUS_FRAC * sized.cell), {
          // Density ZERO. Node mass is solved backwards from a target above, so a second fixture
          // carrying density would break the "a jelly weighs what the rigid body would have
          // weighed" invariant and every measured stiffness number with it.
          density: 0,
          friction: 0,
          restitution: 0,
          filterCategoryBits: SELF_CATEGORY,
          filterMaskBits: SELF_CATEGORY,
          // MUST be 0 - see SELF_CATEGORY.
          filterGroupIndex: 0
        });
      }
```

Set `fixtures: n < mesh.boundaryCount ? 2 : 1` in the node record instead of the hard-coded `1`.

Note the spec's justification for this — "since main.js prints it" — is **wrong**: `main.js:547`
prints `fixtures=` only in the rigid `addBody` branch, and nothing reads a soft node's `fixtures`.
Setting it correctly is still worth doing so the record does not lie, but it changes no output.

- [ ] **Step 4: Run to verify it passes**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS. If mass moved, `density: 0` is missing.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softbody.js gravity/test/test_softbody.js
git commit -m "feat(gravity): a self-contact fixture so a jelly cannot enter itself"
```

---

## Task 5: Assert the constraint is actually enforced after settling

**Files:**
- Test: `gravity/test/test_softbody.js`

**Read this before writing the test.** An earlier draft of this plan proposed an `outlineFoldDepth`
measure of "how far a vertex reaches past the edge it crossed". It was written out, run, and it is
**wrong**: on a folded fixture whose true depth is 1 unit it returns 8.14, because every vertex of a
concave polygon sits on the outward side of some edge it spans, and the measure cannot tell an
honest concavity from a fold. Do not resurrect it. The lesson generalises — a geometric metric that
has not been run against a fixture with a known answer is a guess.

What *can* be asserted exactly is that the contact constraint is being enforced: after settling, no
two non-jointed boundary nodes may be closer than the self-contact distance. That is a direct test
of the mechanism this whole plan adds, it has an exact expected value, and it fails loudly if the
fixture is misfiltered — which is the realistic bug.

- [ ] **Step 1: Write the test**

```js
  h.group('softbody: self-contact is enforced after settling');

  var scene = require('./fixtures_softscene');
  var folders = scene.SCENE.filter(function (s) { return s.folds; });

  for (var fi = 0; fi < folders.length; fi++) {
    (function (shape) {
      var Wf = GR.makeWorld({ scale: 100 });
      GR.addBounds(Wf, { x: -600, y: -600, width: 1200, height: 1200 });
      var rig = GR.addSoftBody(Wf, [{ outer: shape.ring, holes: [] }],
        { name: shape.name, softness: 0.25 });
      if (rig.fallback) { h.assert(shape.name + ' meshes', false, rig.fallback); return; }

      GR.run(Wf, { seed: 1, maxFrames: 900 });

      var mesh = rig.mesh;
      var contact = 2 * GR.SOFT_SELF_RADIUS_FRAC * mesh.cell;
      var jointed = {};
      for (var s = 0; s < mesh.springs.length; s++) {
        var a = mesh.springs[s][0], b = mesh.springs[s][1];
        jointed[(a < b ? a : b) + '-' + (a < b ? b : a)] = 1;
      }
      // SIM units, straight off the body. NOT GR.poseAt - that reads GR.bodyState, which returns
      // GR.toSrc(...), i.e. POINTS. Comparing points against `mesh.cell` compares ~46 against 0.5
      // at scale 100, so the assertion can never fail and would pass even with the self-contact
      // fixture entirely misfiltered - the exact bug this test exists to catch. Measured: the
      // poseAt form reports 46.5c, 46.6c, 93.7c, 66.3c where the truth is 0.465c, 0.466c, 0.937c,
      // 0.663c. The sim has already run, so the bodies hold the settled pose and no recording is
      // needed.
      var pos = [];
      for (var nn = 0; nn < rig.nodes.length; nn++) {
        var pp = rig.nodes[nn].body.getPosition();
        pos.push(pp.x, pp.y);
      }
      var worst = Infinity;
      for (var p = 0; p < mesh.boundaryCount; p++) {
        for (var q = p + 1; q < mesh.boundaryCount; q++) {
          if (jointed[p + '-' + q]) continue;
          var dx = pos[p * 2] - pos[q * 2], dy = pos[p * 2 + 1] - pos[q * 2 + 1];
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < worst) worst = d;
        }
      }
      // planck lets a contact settle to within linearSlop, so allow exactly that and no more.
      //
      // Measured margins are real but not large - 0.465c, 0.466c, 0.937c and 0.663c against a
      // 0.500c contact distance - so two of the four sit only ~0.04c inside the slop allowance.
      // If this ever goes red, check the units above before touching the threshold.
      var slop = Wf.planck.Settings.linearSlop;
      h.assert('settled ' + shape.name + ' keeps its arms apart', worst >= contact - 2 * slop,
        'closest settled pair ' + (worst / mesh.cell).toFixed(3) + 'c against contact ' +
        (contact / mesh.cell).toFixed(3) + 'c');
    })(folders[fi]);
  }
```

- [ ] **Step 2: Run it**

Run: `node gravity/test/run.js 2>&1 | grep -A6 "self-contact is enforced"`
Expected: PASS. A failure here means the self-contact fixtures are not generating contacts at all —
check `filterGroupIndex` is `0`, since a matching non-zero group short-circuits category and mask and
would leave the feature inert while looking implemented.

- [ ] **Step 3: Commit**

```bash
git add gravity/test/test_softbody.js
git commit -m "test(gravity): a settled jelly holds its arms apart"
```

---

## Task 6: The outcome — measure the artwork, do not guess the threshold

**Files:**
- Test: `gravity/test/test_softbody.js`

Task 5 asserts the mechanism works. This one asks whether the artwork actually improved, which is a
different question and the only one the user cares about.

**Crossings will probably not reach zero, and the test must not demand it.** The drawn outline sits
`INSET_FRAC = 0.6 * cell` outside the node ring while contact begins at `0.5 * cell` of node
separation, so two surfaces overlap by about `0.7 * cell` before anything stops them. The honest
approach is to **measure first, then write the assertion around what was measured** — the opposite
order from every other task here, and deliberate.

- [ ] **Step 1: Measure the baseline, before asserting anything**

Write a scratch script (not committed) that settles each of the ten scene shapes twice — once with
the self-contact fixture disabled via `{ selfContact: false }`, once with it on — and prints
`outlineFolds` for each. Add that option to `addSoftBody` purely so this comparison is possible; it
also gives the suite a way to pin gain-0 behaviour later.

```
shape          crossings before   crossings after
orange                        1                 ?
amber                         1                 ?
purple                        1                 ?
green                         3                 ?
(six others)                  0                 0
```

**Do not assert crossing counts, and do not stop the plan on them.** An earlier draft of this task
asserted `after <= before` per shape plus `totalAfter < totalBefore` overall, and instructed the
implementer to halt if they failed. Both were measured against three headless harnesses and **neither
is satisfiable**:

| harness | total crossings, baseline → with self-contact |
|---|---|
| each shape dropped alone | 2 → **3** (amber 0 → 2) |
| all ten as a pile at scale 100 | 1 → 1 (`totalAfter < totalBefore` false) |
| all ten as a pile at `suggestScale` | 1 → **3** (green 1 → 3, so `after <= before` fails) |

None of them reproduces the spec's baseline of orange 1 / amber 1 / purple 1 / green 3 either — that
figure came from the **real Affinity run**: spread-space mesh, exported curves, real document
positions. The headless suite cannot construct it, so an implementer would measure a baseline
contradicting the plan's own table, watch the assertion fail, and halt on a false signal.

**Task 5 carries this plan.** It tests the mechanism directly, with an exact expected value, and it
fails loudly in the realistic bug case. Crossing counts stay a *reported diagnostic* here.

- [ ] **Step 2: Print the comparison, assert nothing about it**

```js
  // Reported, never asserted. Crossing count on a headless drop does not reproduce the figures the
  // defect was measured with in Affinity, and cannot: the real numbers come from spread-space
  // geometry and real document positions. It is printed so a human can see the direction of
  // travel; the mechanism itself is asserted in Task 5.
  console.log('  self-collision, crossings by shape (diagnostic only):');
  // ... per shape: outlineFolds(baseline) vs outlineFolds(withSelfContact)
```

`{ selfContact: false }` **must also disable braces**, or the baseline is a lattice carrying extra
springs and the comparison confounds two changes at once.

- [ ] **Step 3: Record the measured figures in a comment**

In the same style as the stiffness table in `softbody.js`, including which harness produced them.
A number without its harness is not reproducible, which is the whole lesson of this task.

- [ ] **Step 4: Commit**

```bash
git add gravity/test/test_softbody.js gravity/src/softbody.js
git commit -m "test(gravity): report crossing counts alongside self-collision"
```

---

## Task 7: Report it

**Files:**
- Modify: `gravity/src/main.js:494-511`

- [ ] **Step 1: Add the brace count to the soft report line**

After the `cross=` clause:

```js
            // Braces are the springs added where two boundary nodes started inside the
            // self-contact distance. A handful is ordinary - sharp tips produce them. A count
            // approaching the node count means the shape is a hairline that has been meshed into
            // a near-rigid chain, which the user should know about because it will not squash.
            (madeSoft.braceCount ? ' braces=' + madeSoft.braceCount : '') +
```

`springCount` includes braces once they are appended to `mesh.springs`, so `springs=` and `braces=`
overlap. That is fine — braces really are springs — but say so in a comment or the two numbers look
inconsistent.

- [ ] **Step 2: Warn on a hairline**

Measured worst cases at `0.25 * cell` are **3 braces of 62 boundary nodes** (the "C" at a 0.015 rad
mouth) and **3 of 53** (the 29° teardrop), so a `braceCount > boundaryCount / 3` threshold is
effectively unreachable and no fixture in this plan triggers it. Keep the warning as a guard against
artwork nobody has tried yet, but **do not claim it is tested**, and do not spend time building a
fixture to trigger it.

After the report line, before `continue;`:

```js
          if (madeSoft.braceCount > madeSoft.mesh.boundaryCount / 3) {
            console.log('    ' + (obj.name || '(unnamed)') + ' is very thin for its mesh: ' +
              madeSoft.braceCount + ' of ' + madeSoft.mesh.boundaryCount +
              ' boundary nodes needed bracing, so it will behave more rigidly than the ' +
              'softness setting asks. Simplify the shape or make it thicker.');
          }
```

- [ ] **Step 3: Verify nothing else changed**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS, same count as Task 6.

- [ ] **Step 4: Commit**

```bash
git add gravity/src/main.js
git commit -m "feat(gravity): report how much of a jelly needed bracing"
```

---

## Task 8: Rebuild the bundle and verify the whole suite

**Files:**
- Rebuild: `gravity/dist/gravity.js`

- [ ] **Step 1: Rebuild**

Run: `node gravity/build.js`

`dist/gravity.js` is generated and must never be hand-edited — the real diff lives in `src/`.

- [ ] **Step 2: Run the full suite**

Run: `node gravity/test/run.js`
Expected: every assertion passes. The baseline before this plan is **796 passed, 0 failed**, and the
plan adds roughly 61 assertions (6 in Task 1, ~32 in Task 3, 8 in Task 4, 4 in Task 5, ~11 elsewhere).

- [ ] **Step 3: Confirm the untouched tables really are untouched**

Run:
```bash
node gravity/test/run.js 2>&1 | grep -A20 "softbody: solver sag and softness"
node gravity/test/run.js 2>&1 | grep -A12 "softbody: mass"
node gravity/test/run.js 2>&1 | grep -A12 "softbody: filter groups"
```

These are the real group names — verified against the suite. A `grep -iE "stiffness|span"` matches
nothing, because no test name contains either word.

Expected: unchanged. The square blob and the bold "O" brace zero pairs at `0.25 * cell`, which is
exactly why that radius was chosen — if any sag assertion moved, the radius is wrong, not the
assertion.

- [ ] **Step 4: Commit**

```bash
git add gravity/dist/gravity.js
git commit -m "build(gravity): rebuild for softbody self-collision"
```

---

## Definition of done

- Every boundary pair that is not jointed starts outside the self-contact distance, on all ten scene shapes and on teardrops from 60° to 29°.
- No brace spans a gap on a nearly-closed "C".
- After settling, no non-jointed boundary pair is closer than the contact distance, within `linearSlop`. **This is the load-bearing assertion of the plan.**
- Crossing counts are reported as a diagnostic. They are deliberately *not* asserted — see Task 6.
- The 300pt square blob and the bold "O" brace zero pairs, and every stiffness and span figure is unchanged.
- Node mass is unchanged by the second fixture.
- The report says how many braces a shape needed. The hairline warning exists but is untested and unreachable on any known fixture — do not claim otherwise.

## Verified before shipping this plan

The API surface every task depends on was executed rather than read: `GR.bindOutline`,
`evalSoftOutline`, `outlineFolds`, `poseAt`, `run`, `makeWorld`, `addSoftBody`, `addSoftSprings`,
`buildSoftMesh`, `softCellSize`, `pointInFace` and `SOFT_RADIUS_FRAC` all exist; planck exposes
`getFilterGroupIndex`, `getFilterMaskBits`, `getFilterCategoryBits`, `getShape` and `getNext` on a
fixture, and accepts `density: 0`.

`softBraces` itself was implemented and run against all four of Task 1's fixtures, which produce the
asserted values exactly.

Three errors were caught that way and are already fixed above:

1. The walls helper is **`GR.addBounds(W, {x, y, width, height})`**, not `addWalls` — which does not
   exist.
2. The `outlineFoldDepth` measure originally proposed for Task 5 returned **8.14** on a fixture whose
   true depth is 1, because a concave polygon's vertices legitimately sit outside edges they span. It
   was removed rather than shipped, and Task 5 now asserts the contact constraint directly.
3. Task 1's first fixture put its "close pair" on ring-adjacent indices, so the pair was already
   jointed and the test would have passed while testing nothing.

A second reviewer then executed the plan against a patched copy of `src/` and found four more, all
fixed above:

4. Task 3's `give` fallback referenced `braces` before it is assigned, throwing out of a test file
   and killing the whole suite rather than failing one assertion.
5. Task 5 compared `GR.poseAt` output (SOURCE units) against `mesh.cell` (SIM units), so the
   assertion compared ~46 against 0.5 and **could not fail** — including in the misfiltered-fixture
   case it exists to catch.
6. Task 6's crossing-count assertions are not satisfiable in any headless harness, and its
   stop-the-plan instruction would have halted execution on a false signal.
7. Task 2's template would have overwritten the already-populated fixture file with empty arrays,
   unrecoverably.

The pattern across all seven is the same: every one was invisible to reading and obvious to
execution. Verified working, by execution: `softBraces` on all four fixtures, brace insertion
producing real joints, the category/mask filter rejecting collision in both directions, `density: 0`
adding no mass, the frame-0 invariant on ten shapes plus five teardrops plus a seven-aperture "C"
sweep, and zero braces on the square blob, the bold "O", the beam and the two-disc fixture.
