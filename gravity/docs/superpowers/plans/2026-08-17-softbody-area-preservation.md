# Softbody Area Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A jelly resists losing its enclosed area under load, so artwork comes back the size it went in.

**Architecture:** A per-ring ideal-gas pressure term. Pure geometry (`ringAreas`) lives in `softmesh.js`; the force pass (`softPressurePass`) is the only new code touching planck and lives in `softbody.js`; `sim.run` gains an `onStep` hook; `main.js` closes over its softbodies and passes the callback in; `ui.js` gains one slider. Gain 0 reproduces today exactly, so the feature is bisectable.

**Tech Stack:** Plain ES5-style IIFEs over a shared `GR` global (no modules — this runs in the Affinity sandbox). planck.js 1.5.0. Tests are headless node: `node test/run.js`.

**Spec:** `docs/superpowers/specs/2026-08-17-softbody-area-preservation-design.md` — read it before starting. Every constant in this plan traces to a measurement in there.

**Ground rules for this codebase:**
- `src/` files are concatenated by `build.js` in a fixed order (`softmesh.js` before `softbody.js` before `sim.js` before `main.js`). Never reference a later module's function at load time — only inside a function body.
- Everything in `softmesh.js` is in **SIM units**. Everything in `softbody.js`'s `addSoftBody` **converts on the way in**. Mixing the two is the specific bug this codebase is written to avoid.
- Comments in this repo say **why**, with the measurement that settled it. Match that; do not write comments that restate the code.
- Run `node test/run.js` after every step that touches code. It must stay at **0 failed**.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/softmesh.js` | Pure geometry, sim units, no planck | **Modify** — add `ringAreas(mesh, positions)` |
| `src/softbody.js` | The rig; the only softbody module touching planck | **Modify** — record rest ring areas at build; add `softPressurePass(rig, gain, g)` |
| `src/sim.js` | The run loop | **Modify** — add optional `onStep(W, stepIndex)` |
| `src/main.js` | Orchestration and the console report | **Modify** — build the callback, carry `ringSpans` onto the spread mesh, add the report line |
| `src/ui.js` | The settings dialog | **Modify** — one slider, three lines, following `softness` |
| `test/test_softmesh.js` | Geometry tests | **Modify** — `ringAreas` group |
| `test/test_softbody.js` | Engine tests | **Modify** — pressure pass group + the crush criterion on three shapes |
| `test/bench_crush.js` | Standalone crush measurement | **Create** — prints the table, asserts nothing, exits 0 |
| `README.md` | Published measurements | **Modify** — the area preservation section |

---

## Task 1: `ringAreas` — signed area and perimeter of each ring's node loop

**Files:**
- Modify: `src/softmesh.js` (add the function near `ringSignedArea` at ~line 566; add the export beside `GR.ringSignedArea` at ~line 972)
- Test: `test/test_softmesh.js`

- [x] **Step 1: Write the failing tests**

Add a new group to `test/test_softmesh.js`, after the `softmesh: binding` group. `square` and `circle` helpers already exist in that file.

```js
  h.group('softmesh: ring areas');

  // One entry per ring, in ringSpans order - outer ring first, then that face's holes.
  var aface = { outer: square(0, 0, 4, 4), holes: [] };
  var amesh = GR.buildSoftMesh([aface], { cell: 0.5 });
  var arest = GR.ringAreas(amesh, amesh.nodes);
  h.assertEqual('one entry per ring', arest.length, amesh.ringSpans.length);
  h.assert('a ring has a non-zero area', Math.abs(arest[0].area) > 0);
  h.assert('a ring has a positive perimeter', arest[0].perimeter > 0);

  // The node loop is INSET by INSET_FRAC, so it encloses less than the drawn square. That is fine
  // - only the ratio of rest to current is ever used - but it must be true, or the inset is not
  // being applied and the mesh is wrong.
  h.assert('the node loop is inside the drawn ring', Math.abs(arest[0].area) < 16);

  // Rigid motion cannot change either number, or the term would fire on a shape that merely moved.
  var amoved = amesh.nodes.slice();
  for (var aq = 0; aq < amoved.length; aq += 2) { amoved[aq] += 9; amoved[aq + 1] -= 4; }
  var amov = GR.ringAreas(amesh, amoved);
  h.assertClose('translation does not change the area', amov[0].area, arest[0].area, 1e-9);
  h.assertClose('translation does not change the perimeter', amov[0].perimeter, arest[0].perimeter, 1e-9);

  // Halving every coordinate quarters the area and halves the perimeter. This is what makes the
  // ratio scale-free, which is what lets one gain mean the same thing on every shape.
  var ahalf = amesh.nodes.slice();
  for (aq = 0; aq < ahalf.length; aq++) ahalf[aq] *= 0.5;
  var ahlf = GR.ringAreas(amesh, ahalf);
  h.assertClose('halving quarters the area', ahlf[0].area, arest[0].area * 0.25, 1e-9);
  h.assertClose('halving halves the perimeter', ahlf[0].perimeter, arest[0].perimeter * 0.5, 1e-9);

  // A hole's node loop winds the OTHER way from its outer ring. That opposite sign is what lets a
  // hole defend its own emptiness with the same code and no winding convention assumed.
  var hface = { outer: square(0, 0, 8, 8), holes: [square(3, 3, 2, 2)] };
  var hmesh = GR.buildSoftMesh([hface], { cell: 0.5 });
  var hrest = GR.ringAreas(hmesh, hmesh.nodes);
  h.assertEqual('a face with a hole has two rings', hrest.length, 2);
  h.assert('the hole winds opposite to the outer ring', hrest[0].area * hrest[1].area < 0,
    'outer ' + hrest[0].area.toFixed(3) + ' hole ' + hrest[1].area.toFixed(3));
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node test/run.js 2>&1 | tail -12`
Expected: failures reading `GR.ringAreas is not a function`, or a thrown TypeError that stops the suite.

- [x] **Step 3: Write the implementation**

In `src/softmesh.js`, immediately after `ringSignedArea` (which is at ~line 566), add:

```js
  /**
   * Signed area and perimeter of each ring's NODE loop, in ringSpans order.
   *
   * `positions` is a flat x,y array in the same order as `mesh.nodes`, so the rest pose is
   * `mesh.nodes` itself and a settled pose is the node body positions read back.
   *
   * Boundary nodes are inset by INSET_FRAC, so an outer ring's loop encloses LESS than the drawn
   * shape and a hole's loop encloses MORE than the hole. That does not matter: rest and current
   * are measured identically and only their ratio is ever used.
   *
   * The SIGN is load-bearing. It carries the ring's winding, so a hole - which winds the other way
   * - gets an outward direction that points into its own emptiness, with no absolute winding
   * convention assumed anywhere. `insetPoint` states outright that ring winding is not trusted,
   * because rings arrive here from several sources.
   */
  function ringAreas(mesh, positions) {
    var out = [];
    for (var r = 0; r < mesh.ringSpans.length; r++) {
      var span = mesh.ringSpans[r];
      var ring = [];
      for (var i = 0; i < span.count; i++) {
        var n = span.start + i;
        ring.push(positions[n * 2], positions[n * 2 + 1]);
      }
      out.push({ area: ringSignedArea(ring), perimeter: ringPerimeter(ring) });
    }
    return out;
  }
```

Add the export beside `GR.ringSignedArea`:

```js
  GR.ringAreas = ringAreas;
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

- [x] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): measure each ring's own enclosed area

The signed area is what carries the winding, so a hole gets an outward
direction pointing into its own emptiness and no absolute winding convention
has to be assumed - which matters, because insetPoint says outright that ring
winding is not trusted here."
```

---

## Task 2: Record each ring's rest area at build time

**Files:**
- Modify: `src/softbody.js` (the return record at ~line 319)
- Test: `test/test_softbody.js`

- [x] **Step 1: Write the failing test**

Add to `test/test_softbody.js`, in the `softbody: rig` group (the `soft` rig on a 300pt square already exists there as `soft`):

```js
  // The reference the pressure term defends. Recorded at build, in SIM units, because that is the
  // space softmesh works in and the ratio must not depend on where the artwork sat on the page.
  h.assert('a rig records its rest ring areas', !!soft.restRings);
  h.assertEqual('one rest ring per mesh ring', soft.restRings.length, soft.mesh.ringSpans.length);
  h.assert('a rest ring has area', Math.abs(soft.restRings[0].area) > 0);
  h.assert('a rest ring has perimeter', soft.restRings[0].perimeter > 0);
```

- [x] **Step 2: Run to verify it fails**

Run: `node test/run.js 2>&1 | tail -8`
Expected: `a rig records its rest ring areas` fails.

- [x] **Step 3: Implement**

In `src/softbody.js`, inside `addSoftBody`, after the springs are created and before the `return {`, add:

```js
    // The area the pressure term defends, in SIM units, measured on the same node loop it will
    // measure later. Recorded here rather than derived at run time because the rest pose stops
    // existing the moment the first step runs.
    var restRings = GR.ringAreas(mesh, mesh.nodes);
```

Add to the returned record, beside `springCount`:

```js
      restRings: restRings,
```

Also add the same key to the `give()` fallback record (~line 149), so a rig that could not mesh does not return an object of a different shape:

```js
        nodes: [], mesh: null, restRings: [], groupIndex: 0, cell: null, cellsAcross: 0,
```

> **Why the fallback matters:** `give()` runs BEFORE `mesh` exists. Reading `mesh` there throws out of a test file and takes the whole suite down — this exact bug happened once already with `braces`. Hard-code the empty array.

- [x] **Step 4: Run to verify it passes**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

- [x] **Step 5: Commit**

```bash
git add gravity/src/softbody.js gravity/test/test_softbody.js
git commit -m "feat(gravity): a jelly remembers the area it started with

Recorded at build rather than derived later, because the rest pose stops
existing the moment the first step runs."
```

---

## Task 3: `softPressurePass` — the force pass

**Files:**
- Modify: `src/softbody.js` (constants near `NODE_LINEAR_DAMPING` ~line 103; function after `addSoftBody`; exports at the tail)
- Test: `test/test_softbody.js`

- [x] **Step 1: Write the failing tests**

Add a new group to `test/test_softbody.js`:

```js
  h.group('softbody: area pressure');

  // A helper, because every test here needs a rig sitting at some known compression.
  function squashed(frac) {
    var Wp = GR.makeWorld({ scale: 100 });
    var rig = GR.addSoftBody(Wp, [{ outer: square(0, 0, 300, 300), holes: [] }],
      { name: 'p', softness: 0.25, density: 1 });
    // Move every node toward the rig's centroid vertically. Nothing is stepped, so this is a pose,
    // not a simulation - the pass must be a pure function of where the nodes ARE.
    var cy = 0;
    for (var i = 0; i < rig.nodes.length; i++) cy += rig.nodes[i].body.getPosition().y;
    cy /= rig.nodes.length;
    for (i = 0; i < rig.nodes.length; i++) {
      var p = rig.nodes[i].body.getPosition();
      rig.nodes[i].body.setTransform(new GR.planck.Vec2(p.x, cy + (p.y - cy) * frac), 0);
    }
    return { W: Wp, rig: rig };
  }

  // GAIN 0 IS OFF. Every measurement already in this file was taken without this term, and they
  // stay valid only if zero really means zero.
  var pOff = squashed(0.5);
  var offRes = GR.softPressurePass(pOff.rig, 0, 10);
  h.assertEqual('gain 0 pushes no ring', offRes.ringsPushed, 0);

  // THE DEADBAND. A jelly settling under its own weight alone loses up to 4.0% of its area on the
  // crush bench, and if the term fires on that no jelly scene ever reaches `sleep` - the run ends
  // on the quiescence backstop instead. 0.97 is 3% compression, inside the 6% deadband.
  var pRest = squashed(0.97);
  h.assertEqual('a barely-squashed ring is left alone',
    GR.softPressurePass(pRest.rig, 1, 10).ringsPushed, 0);

  // And it does fire once past the band.
  var pHard = squashed(0.5);
  var hardRes = GR.softPressurePass(pHard.rig, 1, 10);
  h.assertEqual('a crushed ring is pushed', hardRes.ringsPushed, 1);

  // ZERO NET FORCE. Sum(outward normal x edge length) = 0 around any closed loop, so pressure
  // cannot thrust an object sideways however lopsided the compression. Asserted on the UNCLAMPED
  // field: once FMAX binds on some nodes and not others the applied forces genuinely do have a net
  // component, and that is deliberate - see the clamped case below.
  h.assertEqual('no node was clamped in this pose', hardRes.nodesClamped, 0);
  var scaleF = Math.abs(hardRes.netX) + Math.abs(hardRes.netY);
  h.assert('pressure has no net force', scaleF < 1e-9, 'net ' + scaleF);

  // A ring whose signed area has FLIPPED is folded. The ratio is meaningless and the outward
  // direction reference is exactly what the flip is evidence of having broken, so the ring is
  // skipped rather than driven at maximum force - which would push the fold deeper.
  var pFlip = squashed(-0.5);
  h.assertEqual('a flipped ring is skipped', GR.softPressurePass(pFlip.rig, 1, 10).ringsPushed, 0);

  // A HOLE, at both windings. Every other fixture here is a solid square, so without this the
  // `sign` branch - the entire reason the signed area is called load-bearing - has no test at all.
  // A SAME-wound hole is not hypothetical: nothing on the soft path normalises winding
  // (sanitizeFace is reached only by the RIGID path via decompose), so it is what real artwork can
  // hand us, and it must behave identically to a counter-wound one.
  //
  // Direction cannot be read off the return value - it reports aggregates, not per-node vectors -
  // so it is measured as motion, against a gain-0 control run on an identical rig. The control is
  // what subtracts the springs out: they pull on these same nodes during the step and would
  // otherwise swamp the term being tested.
  function holeRadial(holeRing, gain) {
    var Wh = GR.makeWorld({ scale: 100 });
    // Gravity off in the WORLD, but still passed to the pass, so the only thing moving these nodes
    // is the term under test plus the springs the control subtracts.
    Wh.world.setGravity(new GR.planck.Vec2(0, 0));
    var rig = GR.addSoftBody(Wh, [{ outer: square(0, 0, 300, 300), holes: [holeRing] }],
      { name: 'h', softness: 0.25, density: 1 });

    // Squash uniformly toward the rig centroid. This shrinks the hole's node loop too, which is
    // what puts its ratio above the deadband.
    var cx = 0, cy = 0, i;
    for (i = 0; i < rig.nodes.length; i++) {
      var q = rig.nodes[i].body.getPosition();
      cx += q.x; cy += q.y;
    }
    cx /= rig.nodes.length; cy /= rig.nodes.length;
    for (i = 0; i < rig.nodes.length; i++) {
      var b = rig.nodes[i].body, q2 = b.getPosition();
      b.setTransform(new GR.planck.Vec2(cx + (q2.x - cx) * 0.7, cy + (q2.y - cy) * 0.7), 0);
      b.setLinearVelocity(new GR.planck.Vec2(0, 0));
    }

    // Ring 1 is the hole - ringSpans is outer first, then that face's holes.
    var span = rig.mesh.ringSpans[1];
    var hx = 0, hy = 0;
    for (i = 0; i < span.count; i++) {
      var hp = rig.nodes[span.start + i].body.getPosition();
      hx += hp.x; hy += hp.y;
    }
    hx /= span.count; hy /= span.count;

    GR.softPressurePass(rig, gain, 10);
    Wh.world.step(1 / 60, 8, 3);

    // Mean outward-from-the-hole-centre velocity. Positive means the counter is being defended.
    var radial = 0;
    for (i = 0; i < span.count; i++) {
      var rec = rig.nodes[span.start + i], rp = rec.body.getPosition(), rv = rec.body.getLinearVelocity();
      var dx = rp.x - hx, dy = rp.y - hy, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) radial += (rv.x * dx + rv.y * dy) / d;
    }
    return radial / span.count;
  }

  var holeCCW = square(110, 110, 80, 80);
  var holeCW = [];
  for (var hw = holeCCW.length - 2; hw >= 0; hw -= 2) holeCW.push(holeCCW[hw], holeCCW[hw + 1]);

  var ccwPush = holeRadial(holeCCW, 1) - holeRadial(holeCCW, 0);
  var cwPush = holeRadial(holeCW, 1) - holeRadial(holeCW, 0);
  h.assert('a squashed hole is pushed away from its own centre', ccwPush > 0,
    'radial ' + ccwPush.toFixed(5));
  h.assert('and identically when the hole winds the other way', cwPush > 0,
    'radial ' + cwPush.toFixed(5));
  h.assertClose('winding changes nothing but the sign it is read from', ccwPush, cwPush, 1e-6);

  // The cap is per NODE on the accumulated vector. A per-edge clamp would cap a node at 2*FMAX and
  // depend on the order edges are visited.
  var pCap = squashed(0.2);
  var capRes = GR.softPressurePass(pCap.rig, 400, 10);
  h.assert('a huge gain clamps some nodes', capRes.nodesClamped > 0);
  var capNode = pCap.rig.nodes[0];
  h.assert('no node exceeds the cap',
    capRes.worstForce <= GR.SOFT_AREA_FORCE_CAP * capNode.body.getMass() * 10 * (1 + 1e-9),
    'worst ' + capRes.worstForce);
```

- [x] **Step 2: Run to verify it fails**

Run: `node test/run.js 2>&1 | tail -12`
Expected: `GR.softPressurePass is not a function`.

- [x] **Step 3: Implement**

In `src/softbody.js`, beside `NODE_LINEAR_DAMPING`, add the constants:

```js
  // Below this much compression the area term is exactly zero. Measured on the crush bench: a jelly
  // settling under nothing but its own weight already loses 0.3% to 4.0% of its area - purple is
  // the 4.0% - and the term must not fire on that. `sim.run` ends when every body is asleep, so a
  // term that fired forever would push every jelly scene off `sleep` and onto the quiescence
  // backstop. 0.06 clears every shape on the bench with headroom.
  var AREA_DEADBAND = 0.06;

  // Per-node force ceiling, as a multiple of that node's OWN weight - which is what keeps it free
  // of scale. Capping the PRESSURE instead would leave the per-node force free by a factor of the
  // edge length, and edge lengths vary across a ring.
  var AREA_FORCE_CAP = 8;
```

After `addSoftBody`, add:

```js
  /**
   * One step of the area-preservation term. Call before `world.step`.
   *
   * Ideal gas, one-sided, per ring:
   *
   *   ratio = restArea / area                       signed, so a fold is detectable
   *   P     = gain * P0 * (ratio^2 - (1+DEADBAND)^2)     clamped at 0 below
   *   P0    = totalMass * g / ringPerimeter
   *   Fnode = sum over the node's two ring edges, THEN clamped to FMAX
   *
   * `P0` is the load the shape must hold divided by the length holding it - a pressure whose units
   * are already right, which is what leaves `gain` dimensionless and makes one slider position mean
   * the same thing at every artwork scale, shape size and cell size.
   *
   * The deadband is subtracted INSIDE the square rather than gating the term, so P rises
   * continuously from zero at the threshold instead of jumping to 0.12*P0. A step discontinuity
   * there is a limit-cycle source sitting precisely where the run needs shapes to sleep.
   *
   * Every ring of an object uses the OBJECT's mass, a counter's ring included: what a counter must
   * resist is the whole object's weight bearing on it, not a share apportioned by area.
   *
   * Returns what it did, so the tests can assert on the force field rather than on its effect.
   */
  function softPressurePass(rig, gain, g) {
    var res = { ringsPushed: 0, nodesClamped: 0, netX: 0, netY: 0, worstForce: 0 };
    if (!rig || !rig.mesh || !rig.restRings || !(gain > 0) || !(g > 0)) return res;

    var mesh = rig.mesh, nodes = rig.nodes;
    var positions = [];
    for (var n = 0; n < nodes.length; n++) {
      var p = nodes[n].body.getPosition();
      positions.push(p.x, p.y);
    }
    var now = GR.ringAreas(mesh, positions);
    var thresh = (1 + AREA_DEADBAND) * (1 + AREA_DEADBAND);

    for (var r = 0; r < mesh.ringSpans.length; r++) {
      var rest = rig.restRings[r], cur = now[r];
      // Same sign means the ring still winds the way it was built. Opposite - or either area at
      // zero - means it is folded, and then both candidate direction references are broken: the
      // rest winding pushes the fold deeper and the current winding has just reversed. Zeroing
      // fires exactly when the sim is already in trouble, which is the wrong moment to apply the
      // largest force in the model.
      if (!(cur.area * rest.area > 0)) continue;

      var ratio = rest.area / cur.area;
      var P = gain * (rig.totalMass * g / rest.perimeter) * (ratio * ratio - thresh);
      if (!(P > 0)) continue;

      var span = mesh.ringSpans[r];
      var fx = [], fy = [], i;
      for (i = 0; i < span.count; i++) { fx.push(0); fy.push(0); }

      // Outward normal of edge a->b is (ey, -ex)/len for a ring with POSITIVE signed area - check
      // it on the CCW unit square (0,0)->(1,0)->(1,1)->(0,1), shoelace +1, where edge (0,0)->(1,0)
      // gives (0,-1), away from the interior. For a NEGATIVE ring that same expression points
      // inward, and this sign flips it back out. So both windings end up pushing outward-of-loop,
      // and every ring defends its OWN enclosed area - for a hole that means away from the hole's
      // centre, growing a squashed counter back toward its rest size.
      //
      // The reference is each ring's own REST sign, never an absolute convention, and that is not
      // a stylistic choice: nothing on the soft path normalises hole winding. sanitizeFace is
      // reached only by the RIGID path via decompose; the soft path is main.js -> addSoftBody ->
      // convertRing (scale and y-flip only) -> buildSoftMesh, and contours.js says outright that
      // rings arrive "by reference, unmodified". A same-wound hole must therefore work identically,
      // and it does, because the winding cancels.
      var sign = rest.area > 0 ? 1 : -1;
      for (i = 0; i < span.count; i++) {
        var a = span.start + i, b = span.start + ((i + 1) % span.count);
        var ex = positions[b * 2] - positions[a * 2];
        var ey = positions[b * 2 + 1] - positions[a * 2 + 1];
        var len = Math.sqrt(ex * ex + ey * ey);
        if (!(len > 0)) continue;
        var half = 0.5 * P * len;
        var hx = half * sign * ey / len, hy = half * -sign * ex / len;
        fx[i] += hx; fy[i] += hy;
        fx[(i + 1) % span.count] += hx; fy[(i + 1) % span.count] += hy;
      }

      for (i = 0; i < span.count; i++) {
        var rec = nodes[span.start + i];
        var cap = AREA_FORCE_CAP * rec.body.getMass() * g;
        var mag = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
        if (mag > cap && mag > 0) {
          fx[i] *= cap / mag; fy[i] *= cap / mag;
          mag = cap;
          res.nodesClamped++;
        }
        if (mag > res.worstForce) res.worstForce = mag;
        res.netX += fx[i]; res.netY += fy[i];
        // wake FALSE. An already-sleeping crushed shape is sitting at the equilibrium this term
        // defines, and waking it would stop every jelly scene ending on `sleep`.
        rec.body.applyForceToCenter(new GR.planck.Vec2(fx[i], fy[i]), false);
      }
      res.ringsPushed++;
    }
    return res;
  }
```

Add the exports at the tail of `softbody.js`:

```js
  GR.softPressurePass = softPressurePass;
  GR.SOFT_AREA_DEADBAND = AREA_DEADBAND;
  GR.SOFT_AREA_FORCE_CAP = AREA_FORCE_CAP;
```

- [x] **Step 4: Run to verify it passes**

Run: `node test/run.js 2>&1 | tail -6`
Expected: `==== NNN passed, 0 failed ====`

If `pressure has no net force` fails by a large amount, the outward normal sign is wrong — check it against a counter-clockwise unit square: edge `(0,0)->(1,0)` must give normal `(0,-1)`.

- [x] **Step 5: Commit**

```bash
git add gravity/src/softbody.js gravity/test/test_softbody.js
git commit -m "feat(gravity): a pressure term so a jelly keeps its area

Ideal gas, one-sided, per ring, normalised by the object's own weight over the
ring's own perimeter so one gain means the same thing at every scale.

The clamp is per node on the accumulated vector, not per edge: a boundary node
sits on two ring edges, so a per-edge clamp caps it at 2*FMAX and depends on
edge visiting order - materially, in exactly the near-collapse regime the cap
exists for."
```

---

## Task 4: `onStep` hook in `sim.run`

**Files:**
- Modify: `src/sim.js:188-240`
- Test: `test/test_engine.js`

- [x] **Step 1: Write the failing test**

Add to `test/test_engine.js` (it already builds worlds and calls `GR.run`):

```js
  h.group('sim: the onStep hook');

  var hookW = GR.makeWorld({ scale: 100 });
  GR.addBounds(hookW, { x: 0, y: 0, width: 400, height: 400 });
  GR.addBody(hookW, [[50, 50, 90, 50, 90, 90, 50, 90]], { name: 'box' });
  var seen = [];
  var hookRec = GR.run(hookW, { maxFrames: 5, quietFrames: 0, onStep: function (W, i) {
    seen.push(i);
    if (W !== hookW) throw new Error('onStep got the wrong world');
  } });

  // Steps, not frames. `stepsPerFrame` is a supported option and the two diverge the moment it is
  // above 1 - defining the hook against frames now would have to be corrected later.
  h.assertEqual('onStep runs once per step',
    seen.length, hookRec.frameCount * GR.SIM_DEFAULTS.stepsPerFrame);
  h.assertEqual('the step index starts at zero', seen[0], 0);
  h.assertEqual('the step index increments', seen[1], 1);

  // BEFORE the step, so a force applied in the hook is integrated by the step it precedes rather
  // than surviving a frame in planck's accumulator.
  var order = [];
  var orderW = GR.makeWorld({ scale: 100 });
  GR.addBounds(orderW, { x: 0, y: 0, width: 400, height: 400 });
  var ob = GR.addBody(orderW, [[50, 50, 90, 50, 90, 90, 50, 90]], { name: 'box' });
  GR.run(orderW, { maxFrames: 1, quietFrames: 0, onStep: function () {
    order.push(ob.body.getLinearVelocity().y);
  } });
  h.assertEqual('the hook runs before the first step', order[0], 0);

  // Absent by default, so nothing that does not ask for it pays anything.
  var plainW = GR.makeWorld({ scale: 100 });
  GR.addBounds(plainW, { x: 0, y: 0, width: 400, height: 400 });
  GR.addBody(plainW, [[50, 50, 90, 50, 90, 90, 50, 90]], { name: 'box' });
  h.assert('a run without a hook still works', GR.run(plainW, { maxFrames: 3 }).frameCount === 3);
```

- [x] **Step 2: Run to verify it fails**

Run: `node test/run.js 2>&1 | tail -8`
Expected: `onStep runs once per step` fails with `expected "N" got "0"`.

- [x] **Step 3: Implement**

In `src/sim.js`, inside `run`, beside the other option reads:

```js
    // Called immediately before each world.step, so a force applied here is integrated by the step
    // it precedes rather than sitting in planck's accumulator for a frame. Counts STEPS, not
    // frames: `stepsPerFrame` is a supported option and the two diverge the moment it is above 1.
    var onStep = o.onStep;
```

Add `var stepIndex = 0;` beside `var frame = 0;`, and replace the step loop:

```js
      for (var s = 0; s < stepsPerFrame; s++) {
        if (onStep) onStep(W, stepIndex);
        W.world.step(dt, vIters, pIters);
        stepIndex++;
      }
```

- [x] **Step 4: Run to verify it passes**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

- [x] **Step 5: Commit**

```bash
git add gravity/src/sim.js gravity/test/test_engine.js
git commit -m "feat(gravity): a per-step hook on the run loop

Steps rather than frames, because stepsPerFrame is a supported option and the
two diverge the moment it is above 1. Nothing sets it above 1 today, which is
exactly why the axis has to be right now rather than corrected later."
```

---

## Task 5: The crush bench, and pinning the default gain

This is the measurement task. It produces two numbers the rest of the plan depends on.

**Files:**
- Create: `test/bench_crush.js`
- Test: `test/test_softbody.js`

- [x] **Step 1: Write the bench**

Create `test/bench_crush.js`. It is a benchmark, not a test: it asserts nothing and always exits 0, exactly like the existing `test/bench.js`.

```js
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
// suggestScale.
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
console.log('shape         area%    peak%  cross  settledBy   frames');
var worst = 1, worstName = '';
for (var i = 0; i < SCENE.length; i++) {
  var r = crush(SCENE[i], LOAD, GAIN);
  if (!r) { console.log(SCENE[i].name + '  (did not mesh)'); continue; }
  console.log(r.name.replace(/$/, '            ').slice(0, 12) + ' ' +
    (100 * r.area - 100).toFixed(1).replace(/^/, '      ').slice(-6) + '  ' +
    (100 * r.peak - 100).toFixed(1).replace(/^/, '      ').slice(-6) + '  ' +
    String(r.crossings).replace(/^/, '    ').slice(-4) + '  ' +
    r.settledBy.replace(/$/, '           ').slice(0, 11) + ' ' + r.frames);
  if (r.area < worst) { worst = r.area; worstName = r.name; }
}
console.log('worst: ' + worstName + ' at ' + (100 * worst - 100).toFixed(1) + '%');
```

> **`frameIndex`:** `GR.run` assigns it (`sim.js`), so it is available the moment `run` returns. It used to be set only in `playbackPrepare` — which is how the settled report ended up reading `undefined` for every node and printing "797 loop(s) removed" about an all-NaN outline. If you find yourself reaching for a fallback here, something has regressed; check `test_engine.js`'s `sim: every body knows its index into the recording` group first.

- [x] **Step 2: Run the bench with GAIN=0 to confirm it reproduces the defect**

Run: `LOAD=4 GAIN=0 node test/bench_crush.js`
Expected: teal about −55%, purple about −52%, green about −24%, yellowgreen about −1%. If those are wildly different, stop — the bench is not measuring what the spec measured, and every constant below would be tuned against the wrong thing.

- [x] **Step 3: Sweep the gain**

Run each and record the worst shape:

```bash
for G in 0 0.25 0.5 1 2 4; do LOAD=4 GAIN=$G node test/bench_crush.js | tail -1; done
```

Pick the **lowest** gain where all three gates hold:
1. worst shape ≥ −10% (the success criterion)
2. every shape's `peak%` ≤ +5.0, and the settled `area%` ≤ 0
3. every shape's `settledBy` is `sleep`, not `quiescence`

Then confirm at LOAD=0 that nothing overshoots: `LOAD=0 GAIN=<pinned> node test/bench_crush.js`.

**If no gain clears all three**, retreat in this order and record which step was taken:
1. Raise `AREA_FORCE_CAP` — it only binds near collapse, so it changes nothing in the working band.
2. Lower `AREA_DEADBAND`, but **not below 0.045** — under that it crosses the 4.0% a resting purple loses under its own weight, the term starts firing on a settled shape, and the sleep argument fails.
3. Relax the criterion, and state the number actually reached rather than the one that was wanted.

Raising the gain past the overshoot gate is **not** on the list: a shape that rings past its rest area is a worse artefact than one that stays squashed, because it is visible in motion.

- [x] **Step 4: Write the criterion into the test suite**

The full sweep is ~1.2s per load over ten shapes, too slow for the commit gate. Put the three worst shapes only into `test/test_softbody.js`:

```js
  h.group('softbody: the crush criterion');

  // The three shapes that fail worst without the term: teal -55.0%, purple -52.2%, green -24.2% at
  // LOAD 4. The full ten-shape sweep lives in test/bench_crush.js, which asserts nothing - at 1.2s
  // per load it is too slow to gate a commit.
  var CRUSH = ['teal', 'purple', 'green'];
  var scene = require('./fixtures_softscene').SCENE;

  for (var cs = 0; cs < CRUSH.length; cs++) {
    var shape = null;
    for (var sc = 0; sc < scene.length; sc++) if (scene[sc].name === CRUSH[cs]) shape = scene[sc];
    var held = crushOne(shape, 4, GR.SOFT_AREA_DEFAULT_GAIN);
    h.assert(CRUSH[cs] + ' keeps its area under a 4x load', held.area >= 0.90,
      CRUSH[cs] + ' at ' + (100 * held.area - 100).toFixed(1) + '%');
    h.assert(CRUSH[cs] + ' does not ring past its rest area', held.peak <= 1.05,
      'peak ' + (100 * held.peak - 100).toFixed(1) + '%');
    h.assert(CRUSH[cs] + ' still sleeps', held.settledBy === 'sleep', held.settledBy);
  }

  // The control the deadband is sized against: under its own weight alone a jelly loses only a few
  // percent, and the term must be silent on that.
  var free = crushOne(scene[0], 0, GR.SOFT_AREA_DEFAULT_GAIN);
  h.assert('an unloaded jelly is left alone', free.area >= 0.95 && free.peak <= 1.001,
    'area ' + free.area.toFixed(4) + ' peak ' + free.peak.toFixed(4));
```

Factor `crush()` out of the bench into a small shared helper so both use one copy — put it in `test/fixtures_softscene.js` as `crushOne(GR, shape, load, gain)` and have `bench_crush.js` call it too. DRY: two copies of a measurement rig will drift and then disagree, and there is no way to tell which one was right.

> **Carried forward from Task 3's review — three mutations survive the commit gate, and this is where two of them get closed.**
> - `AREA_FORCE_CAP 8 -> 16` survives, because `'no node exceeds the cap'` compares `worstForce` against `GR.SOFT_AREA_FORCE_CAP` itself. That assertion is self-referential: ANY cap value passes it. The cap has to be pinned against something external — the bench is that something.
> - `AREA_DEADBAND 0.06 -> 0.12` survives, because only the band's LOWER edge is pinned (by `squashed(0.97)`). The upper edge is what the "an unloaded jelly is left alone" control is really testing, so state the measured margin rather than assuming it.
> - `wake false -> true` also survives. It is a `settledBy` question, so the `still sleeps` assertions below are its natural home — confirm they actually fail with `wake true`, or say why they do not.

- [x] **Step 5: Record the pinned gain as a constant**

In `src/softbody.js`, beside `AREA_FORCE_CAP`:

```js
  // Pinned on the crush bench (test/bench_crush.js), LOAD = 4, softness 25. The table it came from
  // is in README.md. <FILL IN: the sweep, e.g. "gain 0 leaves teal at -55.0%, 0.5 at -21.3%, 1 at
  // -8.4%, 2 overshoots to +6.1% peak - so 1.">
  var AREA_DEFAULT_GAIN = <PINNED>;
```

Export it: `GR.SOFT_AREA_DEFAULT_GAIN = AREA_DEFAULT_GAIN;`

- [x] **Step 6: Run the full suite**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

- [x] **Step 7: Commit**

```bash
git add gravity/test/bench_crush.js gravity/test/fixtures_softscene.js gravity/test/test_softbody.js gravity/src/softbody.js
git commit -m "test(gravity): a crush bench, and the gain pinned on it

A pile in Affinity is not a measuring instrument - replaying the same ten
shapes headlessly puts four of them somewhere else and compresses six times
less, because a pile diverges chaotically from any difference at all. So the
rig is one jelly under one slab of a stated multiple of its own mass.

Three shapes gate commits; the full sweep is a benchmark that asserts nothing,
because at 1.2s a load it is too slow for the gate."
```

---

## Task 6: Wire it into the run and the dialog

**Files:**
- Modify: `src/main.js` (`spreadMeshOf` ~line 398, the `GR.run` call ~line 648, the settled report block ~line 703)
- Modify: `src/ui.js` (default ~line 29, editor ~line 96, normalise ~line 137)

- [x] **Step 1: Carry `ringSpans` onto the spread mesh**

`spreadMeshOf` currently returns `{ nodes, springs, cell }`, which `ringAreas` cannot read. In `src/main.js`:

```js
      return {
        nodes: pts,
        springs: springs,
        cell: soft.cell * scale,
        // The spans are INDICES, so they transfer between spaces unchanged - only distances scale.
        // Without them the report cannot measure what the area term did.
        ringSpans: soft.mesh.ringSpans,
        boundaryCount: soft.mesh.boundaryCount
      };
```

- [x] **Step 2: Pass the callback to `sim.run`**

In `src/main.js`, just before the `GR.run` call:

```js
    // The pressure term needs the softbody records - mesh, rest ring areas, totalMass - and those
    // exist only in what addSoftBody returned, so the callback is built here rather than in sim.js.
    var firmness = o.firmness === undefined ? GR.SOFT_AREA_DEFAULT_GAIN : o.firmness;
    var gvec = W.world.getGravity();
    var gMag = Math.sqrt(gvec.x * gvec.x + gvec.y * gvec.y);
    var areaStep = (softs.length && firmness > 0) ? function () {
      for (var ps = 0; ps < softs.length; ps++) GR.softPressurePass(softs[ps].rig, firmness, gMag);
    } : undefined;
```

and add `onStep: areaStep,` to the options object.

- [x] **Step 3: Add the report line**

In the settled report block in `src/main.js` (the one that prints the fold and hairline lines), inside the existing per-softbody loop that already computes `fpos`, accumulate:

```js
        // What the area term actually achieved, or how far the shape was crushed without it. The
        // fold lines are the idiom: they print their OK case too, because "it held its area" is
        // the result the user came for.
        var arNow = GR.ringAreas(sf.mesh, fpos);
        var arRest = GR.ringAreas(sf.mesh, sf.mesh.nodes);
        for (var ar = 0; ar < arNow.length; ar++) {
          if (!(Math.abs(arRest[ar].area) > 0)) continue;
          var held = Math.abs(arNow[ar].area) / Math.abs(arRest[ar].area);
          if (held < worstArea) { worstArea = held; worstAreaName = sf.name || '(unnamed)'; }
        }
```

with `var worstArea = Infinity, worstAreaName = '';` declared beside the other accumulators, and after the fold/hairline lines:

```js
      if (isFinite(worstArea)) {
        console.log('  jelly area: worst shape settled at ' + fmt(100 * worstArea, 1) + '% of its ' +
          'rest area (' + worstAreaName + ')' +
          (firmness > 0 ? ', firmness ' + fmt(100 * firmness, 0) + '%' : ', firmness OFF'));
      }
```

- [x] **Step 4: Add the slider**

In `src/ui.js`, beside `softness: 25` in the defaults:

```js
    // How hard a jelly refuses to lose its enclosed area. A mass-spring lattice constrains edge
    // LENGTHS and nothing at all constrains AREA, so without this a shape under a pile flattens -
    // measured on the crush bench at a 4x load, teal settled at -55.0% of its rest area.
    firmness: <PINNED * 100>
```

beside the `softCtl` editor:

```js
    // Independent of softness: how readily a shape deforms and how hard it resists being squashed
    // are different questions. Mapped LINEARLY downstream, unlike softness, because the
    // non-linearity already lives in the pressure law's square.
    var firmCtl = mat.addUnitValueEditor('Jelly firmness %', UnitType.Number, UnitType.Number, d.firmness, 0, 100);
    firmCtl.setShowPopupSlider(true); firmCtl.precision = 0;
```

beside the `softness` normalise line:

```js
      firmness: Math.max(0, Math.min(1, (firmCtl.value === undefined ? d.firmness : firmCtl.value) / 100)),
```

- [x] **Step 5: Run the suite**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

The `playback` and `main` tests should be untouched — if `test_playback_handoff.js` goes red, `spreadMeshOf` returned the wrong shape.

- [x] **Step 6: Commit**

```bash
git add gravity/src/main.js gravity/src/ui.js
git commit -m "feat(gravity): a firmness slider, and a report line saying what it did

The callback is built in main.js rather than sim.js because it needs the
softbody records, and those exist only in what addSoftBody returned.

spreadMeshOf now carries ringSpans across. The spans are indices, so they
transfer between spaces unchanged - without them the report cannot measure the
one thing this feature is for."
```

---

## Task 7: Documentation and the bundle

**Files:**
- Modify: `README.md` (the Softbodies section, after the outline-repair subsection)
- Modify: `gravity/dist/gravity.js` (generated)

- [x] **Step 1: Write the README section**

Add after the "The outline is repaired on the way into the document" subsection. It must contain: the defect table from the real run, the crush bench table at GAIN=0 and at the pinned gain, the law, and every constant with the measurement that pinned it. Regenerate the tables with `node test/bench_crush.js` rather than copying them from the spec — the spec's numbers were taken before the term existed, and a published number that was never regenerated is the thing this README exists to prevent.

- [x] **Step 2: Rebuild the bundle**

Run: `node build.js`
Expected: `wrote dist/gravity.js  NNNKB, NNNN lines`

- [x] **Step 3: Run the suite one last time**

Run: `node test/run.js 2>&1 | tail -4`
Expected: `==== NNN passed, 0 failed ====`

- [x] **Step 4: Commit**

```bash
git add gravity/README.md gravity/dist/gravity.js
git commit -m "docs(gravity): publish the area preservation measurements"
```

- [ ] **Step 5: Hand off for verification in Affinity**

Nothing here has run against the real SDK. Ask olliollio to reinstall `gravity/dist/gravity.js`, run the ten-shape scene at softness 25 with firmness at the new default, and send back:
- the `== bodies ==` lines and the settled report block
- the exported SVG

Then check the exported outlines with `GR.ringAreas` against the rest shapes, the same way the repair pass was verified. State the prediction BEFORE the run so it can be wrong.

---

## Out of scope

- **`SHELL_MIN_FREQ` stays at 28.** It is expected to come down once this lands, because ring buckling is this same missing term seen from the other side. That relaxation needs its own measurement of the buckling cliff with pressure active.
- **The rope shell** — replacing ring `DistanceJoint`s with constraints that resist stretch but not compression. Parked; lead with the impulse-share measurement if it is picked up.
