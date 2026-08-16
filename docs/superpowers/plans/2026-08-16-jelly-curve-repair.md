# Jelly Curve Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a folded jelly coming back as gouged artwork, by removing self-intersection loops from the outline on its way into the document.

**Architecture:** A crossing splits a closed ring into exactly two closed loops; keep the larger, because a fold is the smaller lobe. `repairRing` is pure and lives in `softmesh.js`; `playback.js` calls it between `evalSoftOutline` and `transformRing`. A safety valve refuses the repair when it would discard too much, because returning mangled artwork is worse than returning folded artwork.

**Tech Stack:** plain ES5-style JavaScript in `gravity/src/`, headless suite via `node gravity/test/run.js`, bundle rebuilt by `node gravity/build.js`.

**Spec:** `docs/superpowers/specs/2026-08-16-jelly-curve-repair-design.md`

---

## Everything below was executed before this plan was written

The full implementation and its test suite were written and run in a scratch harness. **17 of 17
assertions pass.** The code in Task 1 is that verified code, and the numbers in Task 4 are what it
actually produced. Two things were found this way and are already folded in:

1. **A fixture modelling a "small fold" as a bowtie-like shape is wrong**, and the difference is not
   cosmetic. A real fold is a *short contiguous excursion* — the arm tip pokes in and comes back out,
   so its two crossings sit close together in index order and the loop between them is small. In a
   bowtie the crossings are far apart, so splitting at either one halves the ring: measured, a
   25-area bowtie collapses to a 12.86 triangle, discarding 12.14. The valve refuses it correctly,
   but a test written around that fixture asserts the opposite of what it means to.
2. **`abandon()` must report what it would have discarded.** A refusal with no number leaves the user
   unable to judge it, and "would have lost 49% of this shape" is the useful part.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `gravity/src/softmesh.js` | Pure geometry. Gains `repairRing`, `ringCrossings` and `ringSignedArea`. | Modify |
| `gravity/src/playback.js` | Calls `repairRing` between `evalSoftOutline` (248) and `transformRing` (253). | Modify |
| `gravity/src/main.js` | Reports what repair will do to the settled frame, beside the fold report at 710. | Modify |
| `gravity/test/test_softmesh.js` | Pure tests for `repairRing`. | Modify |
| `gravity/test/fixtures_softscene.js` | Gains the **settled** outlines; currently carries only rest shapes. | Modify |
| `gravity/dist/gravity.js` | Generated bundle. | Rebuild |

---

## Task 1: `repairRing` — the pure algorithm

**Files:**
- Modify: `gravity/src/softmesh.js`
- Test: `gravity/test/test_softmesh.js`

- [ ] **Step 1: Write the failing tests**

Add to `test_softmesh.js`. These are the verified assertions, minus the ones needing the settled
fixture (Task 2 adds those).

```js
  h.group('softmesh: repairing a folded ring');

  function ringsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // A clean ring must come back byte-identical - not merely equivalent. Repair runs on every frame,
  // and a "repair" that perturbs clean geometry would rewrite every curve in the document.
  var cleanSq = square(0, 0, 4, 4);
  var rsq = GR.repairRing(cleanSq);
  h.assert('a clean square is returned unchanged', ringsEqual(rsq.points, cleanSq));
  h.assert('a clean square is not reported as repaired', rsq.repaired === false);
  h.assertEqual('a clean square loses nothing', rsq.loopsRemoved, 0);
  var cleanCirc = circle(0, 0, 2, 64);
  h.assert('a clean circle is returned unchanged',
    ringsEqual(GR.repairRing(cleanCirc).points, cleanCirc));

  // A REAL fold: a short contiguous excursion whose two crossings sit close together in ring order,
  // so the loop between them is small. This distinction is the whole ballgame - a bowtie-like
  // shape, whose crossings are far apart, is halved by a split at either one and is refused by the
  // valve below. Measured: a 25-area bowtie collapses to a 12.86 triangle.
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
  // why the fraction is measured against the RETAINED area and not the original ring. Against the
  // original this ring divides by zero.
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
  var rot = folded.slice(4).concat(folded.slice(0, 4));
  h.assertClose('repair does not depend on the starting vertex',
    Math.abs(GR.ringSignedArea(GR.repairRing(rot).points)),
    Math.abs(GR.ringSignedArea(rf.points)), 1e-9);

  // A zero-length segment scores a phantom crossing in outlineFolds and hands CurveBuilder a
  // degenerate lineTo, so the splice must not leave one.
  var dupFound = false;
  for (var dp = 0; dp < rf.points.length; dp += 2) {
    var dq = (dp + 2) % rf.points.length;
    if (rf.points[dp] === rf.points[dq] && rf.points[dp + 1] === rf.points[dq + 1]) dupFound = true;
  }
  h.assert('repair leaves no consecutive duplicate points', !dupFound);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node gravity/test/run.js 2>&1 | grep -A3 "repairing a folded ring"`
Expected: FAIL — `GR.repairRing is not a function`.

- [ ] **Step 3: Implement**

Add to `softmesh.js`, beside `outlineFolds`. This is verified code — 17 of 17 assertions passed
against it in a scratch harness before this plan was written.

```js
  // How much of a ring repair may discard before it is refused, as a fraction of what it KEEPS.
  //
  // Measured against the retained area and not the original ring's, and that is the subtle part: a
  // folded ring's |shoelace| ALREADY has the fold subtracted, because the lobe is traversed with
  // opposite orientation. So the original-area denominator collapses toward zero exactly as the
  // fold grows - an equal-lobe figure-eight has |shoelace| of exactly 0 - which is precisely when
  // the valve has to decide.
  //
  // 0.25 sits two orders of magnitude above real artwork, which repairs at 0.01% to 2% of area, and
  // below the shapes that must be refused: a pentagram loses 44.7% in a single pass.
  var REPAIR_MAX_LOSS = 0.25;

  /** Signed shoelace area. The SIGN carries the winding, so repair can prove it preserved it. */
  function ringSignedArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i += 2) {
      var j = (i + 2) % p.length;
      a += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    return a / 2;
  }

  /**
   * Where two segments PROPERLY cross, or null.
   *
   * Strictly interior on both, and a zero determinant rejected, so touching endpoints and collinear
   * overlap do not count. This is deliberately stricter than `outlineFolds`, which counts a
   * collinear pair because its `side()` returns 0 - a sheared square, which is an affine map of a
   * simple ring and cannot self-intersect, reports a fold there but nothing here.
   */
  function properCross(ax, ay, bx, by, cx, cy, dx, dy) {
    var rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    var den = rx * sy - ry * sx;
    if (den === 0) return null;
    var t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    var u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
    return [ax + t * rx, ay + t * ry];
  }

  /** Every proper self-crossing of a closed ring, or just the first when `firstOnly`. */
  function scanCrossings(pts, firstOnly) {
    var n = pts.length / 2, count = 0;
    for (var i = 0; i < n; i++) {
      var i2 = (i + 1) % n;
      for (var j = i + 1; j < n; j++) {
        var j2 = (j + 1) % n;
        if (j === i || j2 === i || i2 === j) continue;
        var X = properCross(pts[i * 2], pts[i * 2 + 1], pts[i2 * 2], pts[i2 * 2 + 1],
                            pts[j * 2], pts[j * 2 + 1], pts[j2 * 2], pts[j2 * 2 + 1]);
        if (!X) continue;
        if (firstOnly) return { i: i, j: j, X: X };
        count++;
      }
    }
    return firstOnly ? null : count;
  }

  /** How many proper self-crossings does this closed ring have? */
  function ringCrossings(pts) { return scanCrossings(pts, false); }

  /** Drops any point identical to the one after it, including across the wrap. */
  function dedupeRing(p) {
    var out = [];
    for (var i = 0; i < p.length; i += 2) {
      var j = (i + 2) % p.length;
      if (p[i] === p[j] && p[i + 1] === p[j + 1]) continue;
      out.push(p[i], p[i + 1]);
    }
    return out;
  }

  /**
   * Removes self-intersection loops from a closed ring.
   *
   * A closed curve that crosses itself fills with a HOLE under even-odd, so a folded jelly comes
   * back as gouged artwork. Self-collision cannot prevent this and the reason is structural: the
   * drawn outline sits INSET_FRAC = 0.6 cell outside the node ring while self-contact begins at
   * 0.5 cell of node separation, so two arms resting against each other legally have already
   * overlapped 0.7 cell on paper. Repairing the curve is the last defence, and unlike the physics
   * it is guaranteed - per ring - because it operates on exactly the geometry that gets written.
   *
   * A crossing splits a closed ring into exactly two closed loops, both through the crossing point.
   * Keep the larger: a fold is the smaller lobe by construction, so nothing has to guess which.
   *
   * Termination is proven rather than hoped for. Both loops have at least 3 points and together
   * n + 2, so the kept loop is at most n - 1 and every pass strictly shrinks the ring, bounding the
   * count at n - 3. And every segment of a kept loop is a SUB-SEGMENT of an original, so a pass can
   * never create a crossing that was not already there - oscillation is impossible.
   *
   * Returns the ORIGINAL points whenever it will not or need not act, so the caller can always use
   * `.points` unconditionally.
   */
  function repairRing(points, opts) {
    var o = opts || {};
    var maxLoss = o.maxLoss === undefined ? REPAIR_MAX_LOSS : o.maxLoss;
    var pts = points.slice();
    var maxPasses = o.maxPasses === undefined ? points.length / 2 : o.maxPasses;
    var removed = 0, lost = 0, passes = 0;

    // Reports what it WOULD have discarded: a refusal with no number leaves the user unable to
    // judge it, and "would have lost 49% of this shape" is the useful part.
    function abandon(why, frac) {
      return { points: points, loopsRemoved: 0, lostArea: lost, lossFraction: frac || 0,
               repaired: false, abandoned: why };
    }

    for (;;) {
      if (pts.length / 2 < 3) return abandon('degenerate');
      var f = scanCrossings(pts, true);
      if (!f) break;
      if (passes >= maxPasses) return abandon('passes');
      passes++;

      var n = pts.length / 2, A = [f.X[0], f.X[1]], B = [f.X[0], f.X[1]], k;
      for (k = f.i + 1; k <= f.j; k++) A.push(pts[(k % n) * 2], pts[(k % n) * 2 + 1]);
      for (k = f.j + 1; k <= f.i + n; k++) B.push(pts[(k % n) * 2], pts[(k % n) * 2 + 1]);

      var aA = Math.abs(ringSignedArea(A)), aB = Math.abs(ringSignedArea(B));
      if (aA >= aB) { pts = A; lost += aB; } else { pts = B; lost += aA; }
      removed++;
      pts = dedupeRing(pts);
    }

    if (!removed) {
      return { points: points, loopsRemoved: 0, lostArea: 0, lossFraction: 0,
               repaired: false, abandoned: null };
    }
    if (pts.length / 2 < 3) return abandon('degenerate');

    var kept = Math.abs(ringSignedArea(pts));
    if (kept <= 0) return abandon('zeroArea', Infinity);
    var frac = lost / kept;
    if (frac > maxLoss) return abandon('loss', frac);

    return { points: pts, loopsRemoved: removed, lostArea: lost, lossFraction: frac,
             repaired: true, abandoned: null };
  }
```

Export them:

```js
  GR.repairRing = repairRing;
  GR.ringCrossings = ringCrossings;
  GR.ringSignedArea = ringSignedArea;
  GR.SOFT_REPAIR_MAX_LOSS = REPAIR_MAX_LOSS;
```

- [ ] **Step 4: Run to verify it passes**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS, roughly 18 assertions added to the 864 baseline.

- [ ] **Step 5: Commit**

```bash
git add gravity/src/softmesh.js gravity/test/test_softmesh.js
git commit -m "feat(gravity): remove self-intersection loops from a jelly outline"
```

---

## Task 2: The settled outlines in the fixture

**Files:**
- Modify: `gravity/test/fixtures_softscene.js`

The fixture carries the ten shapes at REST. The repair regression needs them **settled**, because
that is where the folds are. These come from the exported artwork of a real Affinity run with
self-collision active.

- [ ] **Step 1: Add a `SETTLED` export**

Same shape as `SCENE` — `{name, fill, ring}` per shape, flattened polylines, repeated closing point
dropped. Five of the ten carry proper crossings: orange 2, amber 1, cyan 1, purple 1, green 1.

- [ ] **Step 2: Assert the fixture reproduces the defect**

```js
  h.group('softmesh: the settled scene folds as measured');

  var scene = require('./fixtures_softscene');
  var foldedNames = [], cleanCount = 0;
  for (var st = 0; st < scene.SETTLED.length; st++) {
    var sr = scene.SETTLED[st];
    if (GR.ringCrossings(sr.ring) > 0) foldedNames.push(sr.name); else cleanCount++;
  }
  h.assertEqual('five settled shapes cross themselves', foldedNames.length, 5);
  h.assertEqual('five settled shapes do not', cleanCount, 5);
```

A fixture that does not reproduce the defect cannot prove it was fixed.

- [ ] **Step 3: Assert repair clears them**

```js
  h.group('softmesh: repairing the real settled scene');

  // Measured, and the numbers belong here rather than in a threshold nobody can check:
  //
  //     shape     crossings   loops   area lost
  //     orange      2 -> 0        2       0.25%
  //     amber       1 -> 0        1       1.97%
  //     cyan        1 -> 0        1       2.03%
  //     purple      1 -> 0        1       0.01%
  //     green       1 -> 0        1       0.22%
  //     the other five: untouched
  var worstLoss = 0, repairedCount = 0;
  for (var sr2 = 0; sr2 < scene.SETTLED.length; sr2++) {
    var shape = scene.SETTLED[sr2];
    var res = GR.repairRing(shape.ring);
    h.assertEqual('settled ' + shape.name + ' ends with no crossing',
      GR.ringCrossings(res.points), 0);
    if (res.repaired) { repairedCount++; if (res.lossFraction > worstLoss) worstLoss = res.lossFraction; }
  }
  h.assertEqual('five of the ten needed repair', repairedCount, 5);
  h.assert('the worst real loss is far under the valve', worstLoss < 0.05,
    'worst ' + (100 * worstLoss).toFixed(2) + '%');
```

- [ ] **Step 4: Run and commit**

```bash
node gravity/test/run.js
git add gravity/test/fixtures_softscene.js gravity/test/test_softmesh.js
git commit -m "test(gravity): the settled scene, and repair clearing every fold in it"
```

---

## Task 3: Wire it into the write-back

**Files:**
- Modify: `gravity/src/playback.js:248`

- [ ] **Step 1: Call `repairRing` between evaluation and transform**

```js
          for (var r = 0; r < rings.length; r++) {
            var pts = GR.evalSoftOutline(rings[r], soft.mesh, positions);
            if (pts.length < 6) continue;   // fewer than three points is not a ring

            // A folded outline fills with a hole under even-odd, so the artwork comes back gouged.
            // Repaired HERE, in the space the physics ran in and before the transform back to base,
            // because this is the last point at which the geometry is still ours.
            //
            // On every frame, preview and commit alike: ten real rings repair in 0.151ms warm and
            // 0.118ms when already clean, which is about 1% of a frame. `repairRing` returns the
            // original points when it declines, so this is unconditional.
            pts = GR.repairRing(pts).points;
```

Nothing else changes: `transformRing`, `CurveBuilder` and `createSetCurves` all follow as before.
There is deliberately no `repair` flag threaded through `commandForFrame` — an earlier draft added
one on the strength of an 8ms measurement that turned out to be 53x too high.

- [ ] **Step 2: Confirm the suite is unmoved**

Run: `node gravity/test/run.js 2>&1 | tail -3`
Expected: PASS. `playback.js` loads headlessly — every `require` inside it is local to a call — so
`test_playback_handoff.js` exercises this path.

- [ ] **Step 3: Commit**

```bash
git add gravity/src/playback.js
git commit -m "feat(gravity): repair a jelly outline on the way into the document"
```

---

## Task 4: Report it

**Files:**
- Modify: `gravity/src/main.js` around the jelly-fold report at 699-723

The counts cannot come from `softCommands` — it returns only a command array, and this report is
printed before playback runs at all. So repair is run again here, on the settled frame, beside the
existing `outlineFolds` call.

- [ ] **Step 1: Extend the settled-frame loop**

Inside the existing `if (softs.length)` block, alongside `shapeCross`, accumulate `GR.repairRing`
results per ring: how many rings were repaired, total loops removed, the worst `lossFraction`, and
how many were refused with their reason.

- [ ] **Step 2: Say it plainly**

Replace the current "those shapes will come back gouged" advice, which is no longer true when repair
succeeds:

- repaired: `N jelly outline(s) folded and were repaired (worst X% of a shape's area removed).`
- refused: `N jelly outline(s) folded so badly that repairing them would have removed X% of the
  shape, so they were left alone and WILL come back gouged. Lower the softness.`
- clean: unchanged.

- [ ] **Step 3: Run and commit**

```bash
node gravity/test/run.js
git add gravity/src/main.js
git commit -m "feat(gravity): report what the curve repair did"
```

---

## Task 5: Rebuild and verify

- [ ] **Step 1:** `node gravity/build.js`
- [ ] **Step 2:** `node gravity/test/run.js` — expect green, roughly 890 assertions.
- [ ] **Step 3:** Confirm nothing else moved:

```bash
node gravity/test/run.js 2>&1 | grep -A8 "softbody: solver sag and softness"
node gravity/test/run.js 2>&1 | grep -A6 "softmesh: fold detection"
```

- [ ] **Step 4:** Commit the bundle.

```bash
git add gravity/dist/gravity.js
git commit -m "build(gravity): rebuild for jelly curve repair"
```

---

## Definition of done

- A clean ring is returned byte-identical; repair never perturbs geometry it does not need to touch.
- Every one of the five folded settled rings ends with zero proper crossings, and the five clean ones
  are untouched.
- Winding survives, repair is idempotent, and no consecutive duplicate points are produced.
- The valve refuses a figure-eight and a pentagram, returns the input unchanged, and still reports
  what it would have discarded.
- The report distinguishes repaired from refused, and only claims artwork will be gouged when it will.

## Verified before this plan shipped

`repairRing`, `ringCrossings`, `ringSignedArea` and `dedupeRing` were implemented exactly as written
above and run against every assertion in Tasks 1 and 2: **17 of 17 passed.** The real settled scene
figures in Task 2 are that run's output. Not verified here, and left to execution: the `main.js`
report wording and the `playback.js` call site, which need the SDK.
