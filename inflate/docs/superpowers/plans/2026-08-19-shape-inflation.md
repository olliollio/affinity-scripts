# Shape Inflation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a flat vector shape the look of an inflated pillow, in one step, without adding nodes, by scaling every boundary displacement by the LOCAL THICKNESS of the material there.

**Architecture:** A standalone script, `inflate/`, sibling to `gravity/`. It reuses three of gravity's pure-geometry modules by path-prefixed reference (no copy, no move) and adds two of its own. Everything except `main.js` and `ui.js` is plain numbers in, plain numbers out, so the whole algorithm is verified headlessly. Nothing flattens the OUTPUT — flattened rings are used only to measure; what is written back is the original Béziers with moved anchors and recomputed handles.

**Tech Stack:** ES5-style JS in `GR`-namespace IIFEs (the form the Affinity sandbox gets), node + `vm.runInThisContext` for tests, no dependencies.

**Spec:** `inflate/docs/superpowers/specs/2026-08-18-shape-inflation-design.md`

---

## Before you start: four measured corrections to the spec

The spec was reviewed three times but never executed. A working prototype of its algorithm was run
against hand-derived exact answers before this plan was written, and found four defects. **Each
correction below is what this plan implements; the spec document is stale on these four points and
should be patched to match.** Everything else in the spec was confirmed correct by the same run.

### C1 — the corner-degeneracy threshold must be angle-aware (severity: breaks most polygons)

The spec calls an anchor probe degenerate when `r < 4·tau`. A bisector probe at a corner of interior
angle `θ` is capped by the corner's own two walls at

```
r = tau / (1 - sin(θ/2))
```

which was measured to match to three decimals at every angle tested. That is `3.41·tau` at 90°, so a
SQUARE falls under the `4·tau` floor and the spec's one corner test passes. It is `5.2·tau` at 108°
and `7.5·tau` at 120°, so every convex polygon with five or more sides is ACCEPTED as well posed and
takes a thickness made entirely of `tau`. Measured at `amount = 1`, `R = 100`:

| n | interior | `t` used | true across-flats | error |
|---|---|---|---|---|
| 4 | 90° | 141.62 | 141.42 | +0.1% |
| 5 | 108° | 2.09 | 161.80 | **−98.7%** |
| 6 | 120° | 2.99 | 173.21 | **−98.3%** |
| 12 | 150° | 11.74 | 193.19 | **−93.9%** |

A pentagon at 100% grows by 1.05 units instead of 80 — visually unchanged.

**The fix.** Rearranging the cap, a purely corner-limited probe satisfies `2·r·(1 − sin(θ/2)) == 2·tau`
*exactly, at every angle*, while a probe stopped by real geometry across the material comes in under
that. So discriminate by a factor of two:

```
degenerate  ⟺  2 · r · (1 - sin(θ/2))  >=  tau
```

`|n_in + n_out| / 2` **is** `sin(θ/2)`, and the bisector already computes it, so this costs nothing
and needs no angle threshold to be chosen. At a smooth anchor `θ = 180°` and the test collapses to
`0 >= tau`, false — always well posed, which is exactly where the anchor's own probe is wanted.
Verified: every polygon from a triangle to a 48-gon now lands within 0.09%, and the rounded
rectangle's smooth anchor still takes its own probe (40.368) rather than its long side (100.20).

### C2 — the flatten tolerance must be RELATIVE (severity: breaks small artwork and scale invariance)

`FLATTEN_TOL` is an absolute 0.1 source units. `tau` is built from it, and `tau` is what bounds the
accuracy of `t`. Measured relative error in `t` at three scales:

| shape | ×0.005 | ×1 | ×20 |
|---|---|---|---|
| slab side | **−600%** | 0.50% | 0.03% |
| annulus wall | **−767%** | 0.67% | 0.03% |
| rrect corner arc | **+293%** | 3.38% | 0.15% |

With `tol = 5e-4 · faceBboxDiagonal` the same table is *identical at every scale* — 1.01%, 0.94%,
4.78%. The spec's scale-invariance test says "with `flattenTol` scaled alongside"; making the
tolerance relative is what lets that test assert the property instead of arranging it. Measured
end-to-end on the rounded rectangle at `amount = 0.5`: absolute tolerance spreads the scaled
displacement by **198%** across ×0.005/×1/×20, relative tolerance by **0.00%**.

This also removes the spec's "Known risk" entry about `FLATTEN_TOL`.

### C3 — "`tau` does not over-report" holds only for head-on constraints

The spec proves the claim on a circle (the far wall closes at rate 2) and a slab (rate 1). Where the
binding wall meets the probe path at angle `θ` the closing rate is `1 − cos θ`, so the radius error is
`tau/(1 − cos θ)` and is **unbounded** as the wall turns parallel to the probe. Measured on the
rounded rectangle's corner arc: past `r = 20` the probe centre crosses the arc's centre and the
binding wall becomes the top edge at 45°, giving `t = 41.35` against an exact 40 — an over-report of
**6.8·tau**, not `tau`.

Consequence for the tests: `within tau` is correct for the slab, the disc, the annulus wall and the
flat sides, and wrong for anything measured across a convex corner. Task 3 uses `6.8·tau` there and
says why.

### C4 — the circle test cannot assert absolute roundness

A circle built from four cubics is itself `2.7e-4` off a true circle, so at `R = 200` its radii
already spread by 0.0546 before anything is inflated. The spec's "exactly, to the bisection's
precision" is unreachable and, worse, invites an absolute tolerance tuned to whatever the code
happens to emit. The property that actually holds — and that fails under a translate-only handle
rule — is that the output is **no less round, relatively, than its input**. Measured: input relative
spread `2.734e-4`, output `2.746e-4`.

### Confirmed correct, and worth not re-litigating

Run against the prototype and behaving exactly as specified: the ring-sign formula (including holes
and mirrored windings), the bisector normal, the collapsed-handle tangential term, the derived bow
(a circle really does get `b = 0`), the re-collinearising post-pass, winding independence, node-count
and closedness preservation, the annulus counter closing while its outer ring grows, and the
segment-midpoint probe (`B(0.5)`, not the chord midpoint).

One clarification the spec does not record: `tau` is **load-bearing, not slack**. With `tau = 0` every
curved shape returns `t ≈ 0.002`. The reason is not that the probe point is off the ring —
`flatten.js` subdivides at `t = 0.5`, so `B(0.5)` IS a flattening vertex and its distance to the ring
is exactly 0. The deficit lives in the NEIGHBOURING chords, which cut inside the true arc. This is
why a "measure the local deficit at the probe point" variant does not work, and it was tried.

---

## File structure

| File | Responsibility |
|---|---|
| `inflate/build.js` | Concatenates sources into `dist/inflate.js`. Resolves entries against the inflate root, so `../gravity/src/...` works |
| `inflate/test/harness.js` | Same as gravity's, but `loadPD` takes root-relative paths |
| `inflate/test/run.js` | Loads the module list, runs the suites, exits non-zero on failure |
| `inflate/src/thickness.js` | Local thickness. Bezier midpoint/tangent, ring classification and sign, the bisection probe. Pure geometry |
| `inflate/src/inflate.js` | The displacement rules: anchors, handles, bow, collinearising post-pass. Pure geometry |
| `inflate/src/ui.js` | One slider |
| `inflate/src/main.js` | Reads the selection, calls the above, writes back. **The only file touching the Affinity SDK** |
| `inflate/test/fixtures.js` | Curve fixtures: polygons, discs, rounded rectangles, stars, annuli |
| `inflate/test/test_thickness.js` | Thickness and classification assertions |
| `inflate/test/test_inflate.js` | Displacement and invariant assertions |

Reused from gravity by reference, unmodified: `contours.js` (`buildFaces`, `signedArea`),
`flatten.js` (`flattenSegments`, `transformRing`, `invertMatrix`, `FLATTEN_TOL`), `softmesh.js`
(`distanceToRings`, `pointInFace`). Verified: those three load standalone and reference neither
planck nor earcut anywhere in their 1364 lines.

`enforceWinding` is deliberately unused: `buildFaces` classifies by nesting-depth parity and never
reads winding, and it pushes the CALLER'S array references — which is how a flattened ring is mapped
back by identity to the curve that produced it. `enforceWinding` returns new arrays and would break
exactly that mapping.

---

## Task 1: Build and test scaffolding

**Files:**
- Create: `inflate/build.js`
- Create: `inflate/test/harness.js`
- Create: `inflate/test/run.js`
- Create: `inflate/src/thickness.js` (stub, so the concatenation has something to eat)

- [ ] **Step 1: Copy gravity's harness and make `loadPD` root-relative**

`gravity/test/harness.js` joins every entry against `ROOT/src`, which cannot reach a sibling script.
Copy the file to `inflate/test/harness.js` and change only the loader; keep the assertion helpers
byte-identical so the two suites read the same.

```js
var ROOT = path.join(__dirname, '..');

// Entries are paths RELATIVE TO THE INFLATE ROOT, not bare filenames, so a sibling script's
// sources can be named directly. gravity's version joins against ROOT/src and cannot reach one.
function loadPD(files) {
  globalThis.GR = {};
  for (var i = 0; i < files.length; i++) {
    var file = path.join(ROOT, files[i]);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: files[i] });
  }
  return globalThis.GR;
}
```

There is no `loadUMD`, no `loadPlanck` and no `earcut` seed: inflate vendors nothing. Verified that
`contours.js`, `flatten.js` and `softmesh.js` load into a bare `{}` and export 41 symbols.

**Delete `loadUMD` and `loadPlanck` themselves, AND the `loadPlanck: loadPlanck` line in
`module.exports`.** "Change only the loader" is not enough — gravity's harness exports `loadPlanck`,
and a copy that drops the function but keeps the export throws `ReferenceError: loadPlanck is not
defined` at require time, before a single test runs. Measured: that is exactly what happened when
this plan's own code was assembled and run.

- [ ] **Step 2: Write `inflate/build.js`**

Copy `gravity/build.js` and make three changes: drop the `VENDOR` loop and the licence block
entirely (nothing is vendored), change `read()` to resolve against `ROOT` rather than `ROOT/src`,
and make `SRC` hold root-relative paths.

```js
var ROOT = __dirname;
var OUT_DIR = path.join(ROOT, 'dist');
var OUT_FILE = path.join(OUT_DIR, 'inflate.js');

// Paths are relative to the INFLATE ROOT so that gravity's pure-geometry modules can be named
// directly. They are reused by reference rather than copied: a copy goes stale silently, and
// nothing would fail loudly when it had.
// read() exits 1 on a missing file, so every entry must name a file that exists. Order is
// dependency order: a module may use anything defined above it, and new ones go at the end.
var SRC = [
  '../gravity/src/contours.js',
  '../gravity/src/flatten.js',
  '../gravity/src/softmesh.js',
  'src/thickness.js'
];

function read(rel) {
  var p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.error('build: missing ' + rel); process.exit(1); }
  return fs.readFileSync(p, 'utf8');
}

// read() catches a file named in SRC but absent from disk. This catches the OPPOSITE, which is the
// one that fails quietly: a src file that exists and was never added to SRC ships nothing, and
// --check still passes, because --check only compares dist against what SRC named. The omission
// would surface first inside Affinity, where there is no debugger.
function checkSrcComplete() {
  var onDisk = fs.readdirSync(path.join(ROOT, 'src'));
  for (var d = 0; d < onDisk.length; d++) {
    if (/\.js$/.test(onDisk[d]) && SRC.indexOf('src/' + onDisk[d]) < 0) {
      console.error('build: src/' + onDisk[d] + ' exists but is not in SRC');
      process.exit(1);
    }
  }
}
```

**Note on `OUT_DIR`:** keep both `OUT_DIR` and `OUT_FILE`. Gravity's body calls `fs.existsSync(OUT_DIR)`
and `fs.mkdirSync(OUT_DIR)`, so collapsing the pair into a single `OUT_FILE` gives
`ReferenceError: OUT_DIR is not defined` at write time. This is a note to you, not a comment for the
file — do not paste it into the source.

Call `checkSrcComplete()` once at the top of `build()`. Every later task appends its file to `SRC` in
the same task that creates it, and this is what makes forgetting loud rather than silent.

Three more edits gravity's file needs, all of which fail loudly but cost a cycle each if missed:

- the src loop becomes `read(SRC[s])`, not `read(path.join('src', SRC[s]))` — the paths are already
  root-relative
- `HEADER` is renamed to inflate (`name: inflate`, its own description, `author: ollio`)
- the entry fallback's `else console.log('gravity ...')` message names inflate

Keep gravity's `--check` mode verbatim — it is what stops a stale `dist/` being committed. Keep the
`var GR = {};` preamble and the `if (typeof GR.main === 'function') GR.main();` entry line.

- [ ] **Step 3: Stub `inflate/src/thickness.js` and `inflate/test/run.js`**

```js
// inflate/src/thickness.js
/**
 * thickness.js — local thickness at a point on a boundary. Pure geometry, no Affinity API.
 *
 * A stub until Task 3. It exists so the concatenation has a body to eat and so the module's
 * contract is stated before anything depends on it.
 */
(function (GR) {
  'use strict';
})(GR);
```

Deliberately no `GR.inflateVersion`: the version already lives in `HEADER` in `build.js`, and a second
copy inside a geometry module is a source of truth that drifts the first time either changes.
An empty IIFE concatenates and loads perfectly well.

```js
// inflate/test/run.js
'use strict';
var h = require('./harness');
var GR = h.loadPD([
  '../gravity/src/contours.js',
  '../gravity/src/flatten.js',
  '../gravity/src/softmesh.js',
  'src/thickness.js'
]);
var SUITES = [];
// Zero suites still reports "0 passed, 0 failed" and exits 0, which is a green light from a suite
// that asserts nothing. Say so out loud until Task 3 lands the first one.
if (!SUITES.length) console.log('(no suites yet - this run asserts nothing)');
for (var i = 0; i < SUITES.length; i++) SUITES[i](GR, h);
process.exit(h.reportTests() ? 0 : 1);
```

- [ ] **Step 4: Run both, and verify gravity is untouched**

```bash
cd /home/ollio/tools/Affinity/affinity-scripts
node inflate/test/run.js          # expect: "0 passed, 0 failed", exit 0
node inflate/build.js             # expect: "wrote inflate/dist/inflate.js ... KB" (thickness.js only)
node inflate/build.js --check     # expect: "build --check: dist is up to date"
node gravity/test/run.js          # expect: gravity's existing suite, still all passing
node gravity/build.js --check     # expect: "dist is up to date" — inflate must not have touched it
```

- [ ] **Step 5: Commit**

```bash
git add inflate/build.js inflate/test/harness.js inflate/test/run.js inflate/src/thickness.js inflate/dist/inflate.js
git commit -m "build(inflate): scaffolding that reaches gravity's geometry by path"
```

---

## Task 2: Fixtures

**Files:**
- Create: `inflate/test/fixtures.js`

A curve is `{ segments: [{start, c1, c2, end}], isClosed }`, each point `{x, y}` — the shape
`curve.beziers` yields once the caller reduces it to plain numbers.

- [ ] **Step 1: Write the fixtures**

Straight segments must store their handles ON the anchors (`c1 = start`, `c2 = end`). Affinity
stores every straight edge that way, so it is the common case, and a fixture that puts handles at
the third-points would quietly test a code path the real input never takes.

```js
'use strict';
var K = (4 / 3) * (Math.sqrt(2) - 1);   // circle-from-4-cubics handle fraction

function P(x, y) { return { x: x, y: y }; }

/** A closed polygon from [x0,y0,x1,y1,...], with COLLAPSED handles, as Affinity stores it. */
function poly(pts) {
  var segs = [], n = pts.length >> 1;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    var a = P(pts[i * 2], pts[i * 2 + 1]), b = P(pts[j * 2], pts[j * 2 + 1]);
    segs.push({ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b });
  }
  return { segments: segs, isClosed: true };
}

function rect(x, y, w, h) { return poly([x, y, x + w, y, x + w, y + h, x, y + h]); }

function ngon(cx, cy, R, n) {
  var pts = [];
  for (var i = 0; i < n; i++) {
    var th = -Math.PI / 2 + i * 2 * Math.PI / n;
    pts.push(cx + R * Math.cos(th), cy + R * Math.sin(th));
  }
  return poly(pts);
}

/** Four cubics. `ccw === false` gives the SAME circle at the opposite winding. */
function circle(cx, cy, R, ccw) {
  var s = ccw === false ? -1 : 1, a = [], i;
  for (i = 0; i < 4; i++) {
    var th = s * i * Math.PI / 2;
    a.push(P(cx + R * Math.cos(th), cy + R * Math.sin(th)));
  }
  var segs = [];
  for (i = 0; i < 4; i++) {
    var A = a[i], B = a[(i + 1) % 4];
    var tA = P(-s * (A.y - cy), s * (A.x - cx)), tB = P(-s * (B.y - cy), s * (B.x - cx));
    segs.push({ start: A, c1: P(A.x + K * tA.x, A.y + K * tA.y),
                c2: P(B.x - K * tB.x, B.y - K * tB.y), end: B });
  }
  return { segments: segs, isClosed: true };
}

/** 4 straight sides + 4 quarter-arc cubics, 8 anchors. */
function roundRect(x, y, w, h, r) {
  var pts = [[x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r],
             [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r]]
            .map(function (p) { return P(p[0], p[1]); });
  var k = K * r, segs = [];
  function line(a, b) { segs.push({ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b }); }
  function arc(a, b, ca, cb) {
    segs.push({ start: a, c1: P(a.x + ca.x * k, a.y + ca.y * k),
                c2: P(b.x + cb.x * k, b.y + cb.y * k), end: b });
  }
  line(pts[0], pts[1]);  arc(pts[1], pts[2], P(1, 0),  P(0, -1));
  line(pts[2], pts[3]);  arc(pts[3], pts[4], P(0, 1),  P(1, 0));
  line(pts[4], pts[5]);  arc(pts[5], pts[6], P(-1, 0), P(0, 1));
  line(pts[6], pts[7]);  arc(pts[7], pts[0], P(0, -1), P(-1, 0));
  return { segments: segs, isClosed: true };
}

function star(cx, cy, Router, Rinner, points) {
  var pts = [];
  for (var i = 0; i < points * 2; i++) {
    var R = (i % 2 === 0) ? Router : Rinner;
    var th = -Math.PI / 2 + i * Math.PI / points;
    pts.push(cx + R * Math.cos(th), cy + R * Math.sin(th));
  }
  return poly(pts);
}

/** Same shape, opposite winding, reversed node order. For the winding-independence test. */
function reverseCurve(curve) {
  return {
    segments: curve.segments.slice().reverse().map(function (s) {
      return { start: s.end, c1: s.c2, c2: s.c1, end: s.start };
    }),
    isClosed: curve.isClosed
  };
}

/** An open path: two segments, isClosed false. Must be copied through untouched. */
function openPath() {
  var a = P(0, 0), b = P(50, 30), c = P(100, 0);
  return { segments: [{ start: a, c1: P(a.x, a.y), c2: P(b.x, b.y), end: b },
                      { start: b, c1: P(b.x, b.y), c2: P(c.x, c.y), end: c }], isClosed: false };
}

/** A closed ring of zero enclosed area: out and back along the same line. */
function degenerateRing() { return poly([0, 0, 100, 0, 50, 0]); }

module.exports = { K: K, P: P, poly: poly, rect: rect, ngon: ngon, circle: circle,
                   roundRect: roundRect, star: star, reverseCurve: reverseCurve,
                   openPath: openPath, degenerateRing: degenerateRing };
```

- [ ] **Step 2: Verify the fixtures are what they claim, before anything depends on them**

The four-cubic circle's whole justification is that `B(0.5)` lands ON the circle. Check that
directly rather than assuming `K`.

```bash
cd /home/ollio/tools/Affinity/affinity-scripts
node -e '
var F = require("./inflate/test/fixtures.js");
var s = F.circle(0, 0, 100).segments[0];
var m = { x: (s.start.x + 3*s.c1.x + 3*s.c2.x + s.end.x) / 8,
          y: (s.start.y + 3*s.c1.y + 3*s.c2.y + s.end.y) / 8 };
console.log("circle B(0.5) radius (want 100):", Math.hypot(m.x, m.y).toFixed(9));
console.log("roundRect segments (want 8):", F.roundRect(0,0,300,100,20).segments.length);
'
```
Expected: `100.000000000` and `8`.

- [ ] **Step 3: Commit**

```bash
git add inflate/test/fixtures.js
git commit -m "test(inflate): curve fixtures with Affinity's collapsed straight handles"
```

---

## Task 3: `thickness.js` — classification, sign, and the segment probe

**Files:**
- Modify: `inflate/src/thickness.js` (replace the stub)
- Create: `inflate/test/test_thickness.js`
- Modify: `inflate/test/run.js` (register the suite)

- [ ] **Step 1: Write the failing test**

Every expected value below is derived by hand from the shape's definition, never read back from the
code. `t` is a WIDTH: a slab of width `w` measures `w`, a disc of radius `R` measures `2R`.

```js
// inflate/test/test_thickness.js
'use strict';
var F = require('./fixtures');

module.exports = function (GR, h) {
  h.group('thickness — classification and sign');

  // tau over-reports by tau/(1 - cos th) where th is the angle the binding wall makes with the
  // probe path. Head-on (a slab, a disc, an annulus wall, a flat side) that is exactly tau. Across
  // a convex corner it is not: on this rounded rectangle the binding wall is the top edge at 45
  // degrees, giving 6.8*tau. That is a property of the geometry, not a slack to be tightened.
  //
  // The head-on over-report is EXACTLY tau by construction, so asserting "within tau" is asserting
  // equality at the boundary and fails on floating-point dust — measured at 6.7e-15 over, on the
  // annulus. Every head-on tolerance below therefore carries a 1% margin, which is slack against
  // arithmetic and not against the geometry.
  var MARGIN = 1.01;

  function one(curves, tol) {
    var c = GR.inflClassify(curves, tol), r = c.recs[0];
    return { rec: r, ctx: GR.inflProbeCtx(r.face, tol) };
  }

  var TOL = 0.1;   // absolute here ONLY so these unit numbers stay hand-checkable

  var slab = one([F.rect(0, 0, 40, 400)], TOL);
  h.assertClose('slab of width 40 measures 40',
    GR.inflSegmentThickness(F.rect(0, 0, 40, 400).segments[1], slab.rec.sign, slab.ctx).t,
    40, slab.ctx.tau * MARGIN);

  var disc = one([F.circle(0, 0, 100)], TOL);
  h.assertClose('disc of radius 100 measures 200',
    GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, disc.ctx).t,
    200, disc.ctx.tau * MARGIN);

  var rr = F.roundRect(0, 0, 300, 100, 20), rrc = one([rr], TOL);
  h.assertClose('rounded rect flat side measures the full 100',
    GR.inflSegmentThickness(rr.segments[0], rrc.rec.sign, rrc.ctx).t, 100, rrc.ctx.tau * MARGIN);
  h.assertClose('rounded rect corner arc measures the arc, not the body',
    GR.inflSegmentThickness(rr.segments[1], rrc.rec.sign, rrc.ctx).t, 40, 6.8 * rrc.ctx.tau);

  // An annulus is the case that proves distanceToRings is evaluated against the segment's OWN face,
  // holes included: measured across the wall it is 30, not the 200 of the outer disc.
  var ann = GR.inflClassify([F.circle(0, 0, 100), F.circle(0, 0, 70, false)], TOL);
  var actx = GR.inflProbeCtx(ann.recs[0].face, TOL);
  h.assertClose('annulus wall of 30 measures 30',
    GR.inflSegmentThickness(ann.recs[0].curve.segments[0], ann.recs[0].sign, actx).t, 30, actx.tau * MARGIN);
  h.assertEqual('annulus is one face with one hole', ann.faces.length + '/' + ann.faces[0].holes.length, '1/1');

  // The sign is what makes ONE normal formula point away from the MATERIAL on every ring: outward
  // on an outer ring, into the void on a counter.
  //
  // A counter's sign is NOT simply -1. It is the product of its role and its OWN winding, because
  // (ey, -ex) already points into the void of a negatively-wound hole and needs no flip there. So
  // the assertion is that the sign TRACKS the winding, and — the thing that actually matters — that
  // the counter closes either way. Measured: a hole at either winding closes from 70 to 62.447,
  // identically. Asserting `sign === -1` instead fails on a correct implementation.
  var holeNeg = GR.inflClassify([F.circle(0,0,100), F.circle(0,0,70,false)], TOL);
  var holePos = GR.inflClassify([F.circle(0,0,100), F.circle(0,0,70)], TOL);
  h.assertEqual('outer ring sign is +1', holeNeg.recs[0].sign, 1);
  h.assertEqual('a negatively-wound counter signs +1', holeNeg.recs[1].sign, 1);
  h.assertEqual('a positively-wound counter signs -1', holePos.recs[1].sign, -1);

  // Reflection invariance: the same disc wound the other way must classify the same, because the
  // signed area is taken in the SAME space the normals are.
  var revd = GR.inflClassify([F.circle(0, 0, 100, false)], TOL);
  h.assertClose('mirrored winding measures the same thickness',
    GR.inflSegmentThickness(revd.recs[0].curve.segments[0], revd.recs[0].sign,
                            GR.inflProbeCtx(revd.recs[0].face, TOL)).t, 200, disc.ctx.tau * MARGIN);

  h.group('thickness — pass-through cases');
  var pt = GR.inflClassify([F.openPath(), F.degenerateRing()], TOL);
  h.assertEqual('an open path is marked for pass-through', pt.recs[0].skip, 'open');
  h.assert('a zero-area ring is marked for pass-through', !!pt.recs[1].skip, 'got ' + pt.recs[1].skip);

  h.group('thickness — tau is load-bearing');
  // With no tau the probe finds nothing on any curved boundary. B(0.5) is itself a flattening
  // vertex, so its own distance to the ring is 0; the deficit lives in the NEIGHBOURING chords,
  // which cut inside the true arc. This asserts the failure, so nobody "simplifies" tau away.
  var noTau = { face: disc.rec.face, tau: 0, maxR: disc.ctx.maxR };
  h.assert('tau = 0 collapses a curved probe to nothing',
    GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, noTau).t < 0.01,
    'got ' + GR.inflSegmentThickness(F.circle(0, 0, 100).segments[0], disc.rec.sign, noTau).t);
};
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /home/ollio/tools/Affinity/affinity-scripts
node inflate/test/run.js
```
Expected: a crash, `GR.inflClassify is not a function`. Register the suite in `run.js` first if it
does not run at all.

- [ ] **Step 3: Implement `thickness.js`**

```js
/**
 * thickness.js — local thickness at a point on a boundary. Pure geometry, no Affinity API.
 *
 * "Local thickness" is how far it is ACROSS the material, and it is what separates a pillow from an
 * offset: an offset moves every boundary point by a constant, so a thin arm grows as much as a fat
 * body. Scaling the displacement by thickness instead is the whole effect.
 */
(function (GR) {
  'use strict';

  // Relative: a handle counts as collapsed when it sits within this fraction of the chord length of
  // its anchor. flatten.js's LINE_EPS is module-local and ABSOLUTE; the SDK reference says a
  // straight segment stores `c1 ~= start`, not `c1 == start`, so an absolute threshold would be a
  // guess against unverified data. UNVERIFIED against real curves until Task 9 probes it.
  var LINE_EPS = 1e-6;

  // The flatten tolerance, as a fraction of the face's bounding-box diagonal. RELATIVE, not the
  // absolute 0.1 of flatten.js: tau is built from this and tau bounds the accuracy of t, so an
  // absolute tolerance makes the error scale-dependent. Measured on a slab at 0.005x, an absolute
  // tolerance gives -600%; this gives the same 1.0% at every scale.
  var TOL_FRAC = 5e-4;

  var ZERO_AREA_REL = 1e-9;

  function collapsed(cx, cy, ax, ay, chordLen) {
    var dx = cx - ax, dy = cy - ay;
    return Math.sqrt(dx * dx + dy * dy) <= LINE_EPS * chordLen;
  }

  /** B(0.5) = (A + 3c1 + 3c2 + B) / 8 — the CURVE midpoint, never the chord midpoint. */
  function midPoint(s) {
    return { x: (s.start.x + 3 * s.c1.x + 3 * s.c2.x + s.end.x) / 8,
             y: (s.start.y + 3 * s.c1.y + 3 * s.c2.y + s.end.y) / 8 };
  }

  /** B'(0.5) = (3/4)(B + c2 - c1 - A). The 3/4 is dropped: only the direction is used. */
  function midTangent(s) {
    return { x: s.end.x + s.c2.x - s.c1.x - s.start.x,
             y: s.end.y + s.c2.y - s.c1.y - s.start.y };
  }

  /**
   * (ey, -ex)/|e|, times the ring sign.
   *
   * That formula points OUT of the enclosed region of a positively-wound ring and INTO it for a
   * negatively-wound one. So with outer rings signed +1 and counters -1, one formula points away
   * from the MATERIAL everywhere: outward on an outer ring, into the void on a hole.
   */
  function normalOf(dx, dy, sign) {
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return null;
    return { x: sign * dy / len, y: -sign * dx / len };
  }

  function faceBBoxDiagonal(face) {
    var rings = [face.outer].concat(face.holes || []);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var i = 0; i < ring.length; i += 2) {
        if (ring[i] < x0) x0 = ring[i];
        if (ring[i] > x1) x1 = ring[i];
        if (ring[i + 1] < y0) y0 = ring[i + 1];
        if (ring[i + 1] > y1) y1 = ring[i + 1];
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The control-point hull bounds the curve, so this needs no flattening and is exact enough. */
  function hullDiagonal(curves) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var c = 0; c < curves.length; c++) {
      var segs = curves[c].segments || [];
      for (var i = 0; i < segs.length; i++) {
        var pts = [segs[i].start, segs[i].c1, segs[i].c2, segs[i].end];
        for (var p = 0; p < 4; p++) {
          if (pts[p].x < x0) x0 = pts[p].x;
          if (pts[p].x > x1) x1 = pts[p].x;
          if (pts[p].y < y0) y0 = pts[p].y;
          if (pts[p].y > y1) y1 = pts[p].y;
        }
      }
    }
    if (!isFinite(x0)) return 0;
    return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  }

  /** The flatten tolerance for a set of curves. One pass: the hull needs no flattening to find. */
  function tolFor(curves) {
    var d = hullDiagonal(curves);
    return d > 0 ? TOL_FRAC * d : GR.FLATTEN_TOL;
  }

  /**
   * Flattens every closed curve, groups the rings into faces, and gives each curve its face and its
   * ring sign.
   *
   * The original curves are NOT rewound. Reversing them would reorder the output nodes, and node
   * order is what this feature exists to preserve, so the sign is carried alongside instead — one
   * shoelace per ring, not a test per anchor.
   *
   * buildFaces pushes the CALLER'S array references, so a face's ring is mapped back to the curve
   * that produced it BY IDENTITY. That is why enforceWinding is not used: it returns new arrays and
   * would break exactly this mapping, and it would buy nothing anyway because buildFaces classifies
   * by nesting-depth parity and never reads winding.
   */
  function classify(curves, flattenTol) {
    var tol = flattenTol === undefined ? tolFor(curves) : flattenTol;
    var recs = [], i;
    for (i = 0; i < curves.length; i++) {
      var c = curves[i];
      recs.push({ curve: c, index: i, face: null, sign: 0,
                  ring: c.isClosed ? GR.flattenSegments(c.segments, { flattenTol: tol }) : null,
                  skip: c.isClosed ? null : 'open' });
    }

    var rings = [];
    for (i = 0; i < recs.length; i++) if (recs[i].ring) rings.push(recs[i].ring);
    var faces = GR.buildFaces(rings);

    function tag(ring, face, outerSign) {
      for (var k = 0; k < recs.length; k++) {
        if (recs[k].ring === ring) {                       // identity, not value
          recs[k].face = face;
          // signedArea is taken in the SAME space the normals are computed in. Under a mirroring
          // transform base and spread windings differ, and the rule is reflection-invariant only
          // when both come from one space.
          recs[k].sign = outerSign * (GR.signedArea(ring) >= 0 ? 1 : -1);
          return;
        }
      }
    }
    for (var f = 0; f < faces.length; f++) {
      tag(faces[f].outer, faces[f], 1);
      var holes = faces[f].holes || [];
      for (var hI = 0; hI < holes.length; hI++) tag(holes[hI], faces[f], -1);
    }

    // A ring buildFaces dropped (fewer than three points), and a ring of no enclosed area, have no
    // sign and no interior to grow into. Exact zero is unlikely in floating point, so the test is
    // relative to the face's own box.
    for (i = 0; i < recs.length; i++) {
      if (recs[i].skip) continue;
      if (!recs[i].face) { recs[i].skip = 'degenerate ring'; continue; }
      var diag = faceBBoxDiagonal(recs[i].face);
      if (Math.abs(GR.signedArea(recs[i].ring)) < ZERO_AREA_REL * diag * diag) recs[i].skip = 'zero area';
    }
    return { recs: recs, faces: faces, tol: tol };
  }

  /**
   * tau is NOT slack. With tau = 0 every curved probe returns ~0: the flattened ring's chords cut
   * INSIDE the true arc, so a probe disc that is tangent to the curve still clips the polygon. The
   * deficit cannot be measured at the probe point — flatten.js subdivides at t = 0.5, so B(0.5) is
   * itself a flattening vertex and its own distance to the ring is exactly zero. 2x the tolerance
   * is the sagitta bound plus a factor of two.
   */
  function probeCtx(face, flattenTol) {
    var diag = faceBBoxDiagonal(face);
    var tol = flattenTol === undefined ? TOL_FRAC * diag : flattenTol;
    return { face: face, tau: 2 * tol + 1e-9 * diag, maxR: diag / 2, diag: diag };
  }

  /**
   * The largest r whose probe disc, centred r INSIDE the boundary at (px, py), still clears the
   * geometry by r. Because the probe point is ON the boundary, dist can never EXCEED r, so the
   * predicate is really an equality: this finds the largest disc TANGENT to the boundary here.
   *
   * The bisection is well posed with no second root: dist is 1-Lipschitz in r and |dC/dr| = 1, so
   * dist(C(r)) - r is non-increasing and the satisfying set is exactly [0, r*]. That holds on
   * concave shapes too, which is what makes bisection legitimate rather than merely convenient.
   *
   * Returns -1 when the probe escaped the material. distanceToRings is UNSIGNED, so a probe that
   * has left the shape satisfies the predicate as readily as one inside it and a flipped normal
   * would yield a plausible t in silence; pointInFace is what catches that.
   */
  function probeRadius(px, py, nx, ny, face, maxR, tau) {
    var lo = 0, hi = maxR;
    for (var it = 0; it < 60; it++) {
      var mid = (lo + hi) / 2;
      if (GR.distanceToRings(px - mid * nx, py - mid * ny, face) >= mid - tau) lo = mid; else hi = mid;
    }
    if (lo > 0 && !GR.pointInFace(px - lo * nx, py - lo * ny, face)) return -1;
    return lo;
  }

  /** t = 2r at the segment's CURVE midpoint, probed along the inward normal THERE. */
  function segmentThickness(seg, sign, ctx) {
    var M = midPoint(seg), T = midTangent(seg);
    var n = normalOf(T.x, T.y, sign);
    if (!n) n = normalOf(seg.end.x - seg.start.x, seg.end.y - seg.start.y, sign);
    if (!n) return { t: 0, r: 0, M: M, n: null };
    var r = probeRadius(M.x, M.y, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r, M: M, n: n };
  }

  function anchorThickness(px, py, n, ctx) {
    if (!n) return { t: -1, r: -1 };
    var r = probeRadius(px, py, n.x, n.y, ctx.face, ctx.maxR, ctx.tau);
    return { t: r < 0 ? -1 : 2 * r, r: r };
  }

  GR.INFL_LINE_EPS = LINE_EPS;
  GR.INFL_TOL_FRAC = TOL_FRAC;
  GR.inflCollapsed = collapsed;
  GR.inflMidPoint = midPoint;
  GR.inflMidTangent = midTangent;
  GR.inflNormalOf = normalOf;
  GR.inflFaceBBoxDiagonal = faceBBoxDiagonal;
  GR.inflHullDiagonal = hullDiagonal;
  GR.inflTolFor = tolFor;
  GR.inflClassify = classify;
  GR.inflProbeCtx = probeCtx;
  GR.inflProbeRadius = probeRadius;
  GR.inflSegmentThickness = segmentThickness;
  GR.inflAnchorThickness = anchorThickness;

})(GR);
```

- [ ] **Step 4: Run the tests**

```bash
node inflate/test/run.js
node inflate/build.js && node inflate/build.js --check
```
Expected: every assertion in `test_thickness.js` PASS, then a rebuilt `dist/` that `--check` calls
up to date.

**Rebuild before every commit that stages `dist/inflate.js`.** `--check` is the staleness guard this
plan installs, and it fails against a `dist/` built from older sources — so a task that edits `src/`
and commits `dist/` without rebuilding poisons the next task's check rather than its own.

If the annulus wall reads 200 rather than 30,
`distanceToRings` is being handed the wrong face. If a sign is inverted, check that `signedArea` is
being taken on the SPREAD-space ring.

- [ ] **Step 5: Commit**

```bash
git add inflate/src/thickness.js inflate/test/test_thickness.js inflate/test/run.js inflate/dist/inflate.js
git commit -m "feat(inflate): local thickness by tangent-disc bisection"
```

---

## Task 4: The anchor measure — and the angle-aware degeneracy test

**This is correction C1.** It is the defect that made every polygon of five or more sides come back
visually unchanged, so it gets its own task and its own test.

**Files:**
- Modify: `inflate/src/thickness.js`
- Modify: `inflate/test/test_thickness.js`

- [ ] **Step 1: Write the failing test**

The expected values are the polygons' across-flats widths, `2R·cos(π/n)`, derived from the shape's
definition. A test that only checked a square would pass against the broken rule.

```js
  h.group('thickness — the anchor measure across corner angles');

  // A bisector probe at a corner of interior angle th is capped at tau/(1 - sin(th/2)) by the
  // corner's own walls and by NOTHING to do with the material. At 90 degrees that is 3.41*tau, so a
  // square slips under a fixed 4*tau floor and a square-only test passes; at 108 degrees it is
  // 5.2*tau and a pentagon does not. Every one of these must come back as the across-flats width.
  [3, 4, 5, 6, 8, 12, 24, 48].forEach(function (n) {
    var g = F.ngon(0, 0, 100, n);
    var cl = GR.inflClassify([g]), rec = cl.recs[0], ctx = GR.inflProbeCtx(rec.face, cl.tol);
    var m = GR.inflAnchorMeasure(g.segments, 0, rec.sign, ctx);
    h.assertClose(n + '-gon anchor measures its across-flats width',
      m.t, 2 * 100 * Math.cos(Math.PI / n), 8 * ctx.tau);
  });

  // The other half of the same rule: at a SMOOTH anchor the anchor's own probe is the more accurate
  // measure and must be kept. On a 300x100 rounded rectangle with corner radius 20, the anchor
  // joining arc to side measures 40 by its own probe against 100 for the adjacent long side, so
  // "take the larger adjacent segment" over-reports by 2.5x at exactly the anchors where nothing
  // was wrong.
  var rr2 = F.roundRect(0, 0, 300, 100, 20);
  var rcl = GR.inflClassify([rr2]), rrec = rcl.recs[0], rctx = GR.inflProbeCtx(rrec.face, rcl.tol);
  var sm = GR.inflAnchorMeasure(rr2.segments, 1, rrec.sign, rctx);
  h.assert('smooth anchor uses its OWN probe', sm.wellPosed === true, 'wellPosed ' + sm.wellPosed);
  h.assertClose('smooth anchor measures the arc (40), not the side (100)', sm.t, 40, 8 * rctx.tau);

  // A reflex junction: at the notch of a star the LARGER adjacent segment is the right answer, and
  // the smaller would crease the notch away from the body it belongs to.
  var st = F.star(0, 0, 100, 40, 5);
  var scl = GR.inflClassify([st]), srec = scl.recs[0], sctx = GR.inflProbeCtx(srec.face, scl.tol);
  var tip = GR.inflAnchorMeasure(st.segments, 0, srec.sign, sctx);
  h.assert('a spike measures its LOCAL width, not the star diameter', tip.t < 60,
    'got ' + tip.t.toFixed(2) + ' against a diameter of 200');
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node inflate/test/run.js
```
Expected: `GR.inflAnchorMeasure is not a function`.

**And before implementing, verify the defect is real** — this is the check that justifies the whole
task, and it must be seen failing under the naive rule:

```bash
node -e '
var h = require("./inflate/test/harness"), F = require("./inflate/test/fixtures");
var GR = h.loadPD(["../gravity/src/contours.js","../gravity/src/flatten.js",
                   "../gravity/src/softmesh.js","src/thickness.js"]);
[4,5,6,12].forEach(function (n) {
  var g = F.ngon(0,0,100,n), cl = GR.inflClassify([g]), rec = cl.recs[0];
  var ctx = GR.inflProbeCtx(rec.face, cl.tol);
  var A = g.segments[0].start, L = Math.hypot(A.x, A.y);
  var ap = GR.inflAnchorThickness(A.x, A.y, {x: A.x/L, y: A.y/L}, ctx);
  console.log(n + "-gon: anchor probe r=" + ap.r.toFixed(3) +
    "  naive 4*tau floor would " + (ap.r >= 4*ctx.tau ? "ACCEPT it -> t=" + ap.t.toFixed(2) : "reject it") +
    "   true across-flats " + (2*100*Math.cos(Math.PI/n)).toFixed(2));
});'
```
Expected: the square is rejected, the pentagon/hexagon/12-gon are ACCEPTED with thicknesses of
roughly 2, 3 and 12 against true widths of 162, 173 and 193.

- [ ] **Step 3: Implement `inflAnchorMeasure`**

Add to `thickness.js`, before the exports:

```js
  // Where the two adjacent normals cancel — a doubled-back node, a zero-width spike — the bisector
  // DIRECTION is numerically arbitrary while the displacement magnitude is not, so the anchor would
  // shoot sideways. The threshold is on UNIT vectors and so is scale-free.
  var CUSP_EPS = 1e-4;

  /**
   * The two tangents at anchor `i`, both IN THE DIRECTION OF TRAVEL.
   *
   * Affinity stores the incoming handle as c2, and `c2 - A` points BACKWARD. Using it directly makes
   * every smooth node look like a cusp, and the failure surfaces as a bow artefact rather than as a
   * sign error, which is a much harder thing to read.
   *
   * Affinity also stores a straight segment as a cubic with its handles ON the anchors, so deriving
   * a tangent from `c1 - A` returns a zero vector on every straight segment — the COMMON case, not
   * a rare one. There the chord stands in.
   */
  function tangentsAt(segs, i) {
    var n = segs.length, cur = segs[i], prv = segs[(i - 1 + n) % n];
    var chordOut = { x: cur.end.x - cur.start.x, y: cur.end.y - cur.start.y };
    var chordIn = { x: prv.end.x - prv.start.x, y: prv.end.y - prv.start.y };
    var lOut = Math.sqrt(chordOut.x * chordOut.x + chordOut.y * chordOut.y);
    var lIn = Math.sqrt(chordIn.x * chordIn.x + chordIn.y * chordIn.y);
    return {
      tOut: collapsed(cur.c1.x, cur.c1.y, cur.start.x, cur.start.y, lOut)
        ? chordOut : { x: cur.c1.x - cur.start.x, y: cur.c1.y - cur.start.y },
      tIn: collapsed(prv.c2.x, prv.c2.y, prv.end.x, prv.end.y, lIn)
        ? chordIn : { x: prv.end.x - prv.c2.x, y: prv.end.y - prv.c2.y }
    };
  }

  /**
   * The bisector normal and the thickness at one anchor.
   *
   * n = normalize(n_in + n_out) is the bisector at a corner and degenerates to the perpendicular at
   * a smooth node, with no corner/smooth threshold to pick and so no divergence between
   * implementations.
   *
   * THE DEGENERACY TEST. Because the probe point lies on the boundary, the largest tangent disc at
   * a CONVEX CORNER has radius zero — the nearest boundary point to a nearby interior point is not
   * the corner itself. So probing at anchors returns near zero at every corner of a polygon and a
   * square, whose only anchors are corners, would come back unchanged. But the probe is not
   * worthless everywhere: at a SMOOTH anchor it is perfectly well behaved and is the MORE accurate
   * measure, and on a rounded rectangle taking the larger adjacent segment instead over-reports by
   * 2.5x at exactly the anchors where nothing was wrong.
   *
   * A fixed floor cannot separate those two cases. A corner of interior angle th caps its own probe
   * at r = tau/(1 - sin(th/2)) — 3.41*tau at 90 degrees, 5.2*tau at 108, 23*tau at 165 — so any
   * fixed multiple of tau is right for one angle and wrong for the rest. Measured against a fixed
   * 4*tau floor: a pentagon inflated at 100% grew by 1.05 units instead of 80.
   *
   * Rearranged, a purely corner-limited probe satisfies 2*r*(1 - sin(th/2)) == 2*tau EXACTLY, at
   * every angle, while a probe stopped by real geometry across the material comes in under that. So
   * the test discriminates by a factor of two and needs no angle threshold at all. |n_in + n_out|/2
   * IS sin(th/2), and the bisector already computed it, so this costs nothing. At a smooth anchor
   * th = 180, the left side is 0, and every probe is well posed — which is what is wanted there.
   */
  function anchorMeasure(segs, i, sign, ctx, segT) {
    var n = segs.length;
    var tg = tangentsAt(segs, i);
    var nIn = normalOf(tg.tIn.x, tg.tIn.y, sign);
    var nOut = normalOf(tg.tOut.x, tg.tOut.y, sign);
    var sum = (nIn && nOut) ? { x: nIn.x + nOut.x, y: nIn.y + nOut.y } : (nIn || nOut);
    if (!sum) return { n: null, t: 0, cusp: true, wellPosed: false };
    var L = Math.sqrt(sum.x * sum.x + sum.y * sum.y);
    if (L < CUSP_EPS) return { n: null, t: 0, cusp: true, wellPosed: false };

    var nrm = { x: sum.x / L, y: sum.y / L };
    var ap = anchorThickness(segs[i].start.x, segs[i].start.y, nrm, ctx);
    var sinHalf = L / 2;                                   // == sin(th/2)
    var wellPosed = ap.r >= 0 && 2 * ap.r * (1 - sinHalf) < ctx.tau;

    var t;
    if (wellPosed) {
      t = ap.t;
    } else if (segT) {
      // At a reflex junction — a disc meeting a narrow stem — the LARGER value is the right one, and
      // the smaller would crease the notch away from the disc it belongs to.
      t = Math.max(segT[(i - 1 + n) % n], segT[i]);
    } else {
      t = Math.max(segmentThickness(segs[(i - 1 + n) % n], sign, ctx).t,
                   segmentThickness(segs[i], sign, ctx).t);
    }
    return { n: nrm, t: t, cusp: false, wellPosed: wellPosed, own: ap.t, sinHalf: sinHalf };
  }
```

Export `GR.inflTangentsAt = tangentsAt;` and `GR.inflAnchorMeasure = anchorMeasure;`, and add
`GR.INFL_CUSP_EPS = CUSP_EPS;`.

- [ ] **Step 4: Run the tests**

```bash
node inflate/test/run.js
node inflate/build.js && node inflate/build.js --check
```
Expected: all eight polygons PASS, the smooth anchor reports `wellPosed true` and measures ~40, the
star spike measures ~25. Reference numbers from the prototype, at `amount = 1`, `R = 100`:

| n | want R' | got R' |
|---|---|---|
| 3 | 150.00 | 150.13 |
| 5 | 180.90 | 181.01 |
| 12 | 196.59 | 196.69 |
| 48 | 199.79 | 199.89 |

- [ ] **Step 5: Commit**

```bash
git add inflate/src/thickness.js inflate/test/test_thickness.js inflate/dist/inflate.js
git commit -m "fix(inflate): tell a corner-limited probe from a real one by angle, not by a floor"
```

---

## Task 5: `inflate.js` — the two rules

**Files:**
- Create: `inflate/src/inflate.js`
- Create: `inflate/test/test_inflate.js`
- Modify: `inflate/test/run.js` — **two** edits: add `'src/inflate.js'` to the `loadPD` module list
  AND register the suite. Missing the first gives `GR.inflateCurves is not a function`, which is
  character-for-character the failure Step 2 tells you to expect, so it reads as "the test is still
  red" rather than "the module never loaded".
- Modify: `inflate/build.js` (append `'src/inflate.js'` to `SRC`)

- [ ] **Step 1: Write the failing test**

```js
// inflate/test/test_inflate.js
'use strict';
var F = require('./fixtures');

module.exports = function (GR, h) {
  function ring(curve, tol) { return GR.flattenSegments(curve.segments, { flattenTol: tol || 0.001 }); }
  function bboxOf(r) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
      if (r[i+1] < y0) y0 = r[i+1]; if (r[i+1] > y1) y1 = r[i+1];
    }
    return { w: x1 - x0, h: y1 - y0 };
  }
  function radii(curve, cx, cy) {
    var r = ring(curve), out = [];
    for (var i = 0; i < r.length; i += 2) out.push(Math.hypot(r[i] - cx, r[i+1] - cy));
    return out;
  }
  function mid(s) {
    return { x: (s.start.x + 3*s.c1.x + 3*s.c2.x + s.end.x) / 8,
             y: (s.start.y + 3*s.c1.y + 3*s.c2.y + s.end.y) / 8 };
  }

  h.group('inflate — amount = 0 is the identity');
  // Every term carries an `amount` factor, s = 1, and M_naive = M so b = 0. Equality is to within
  // floating-point REASSOCIATION, not bit-exact, since A + (c1 - A) need not reproduce c1.
  //
  // This is a headless test and so CANNOT catch a missing inverse transform, which is exactly what
  // would make amount = 0 move a shape in the real application. Task 9 is what catches that.
  [['square', F.rect(0,0,100,100)], ['disc', F.circle(0,0,100)],
   ['rrect', F.roundRect(0,0,300,100,20)], ['star', F.star(0,0,100,40,5)]].forEach(function (c) {
    var o = GR.inflateCurves([c[1]], 0)[0], d = 0;
    for (var i = 0; i < c[1].segments.length; i++) {
      var a = c[1].segments[i], b = o.segments[i];
      ['start','c1','c2','end'].forEach(function (k) {
        d = Math.max(d, Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y));
      });
    }
    h.assert('amount = 0 identity: ' + c[0], d <= 1e-12 * 400, 'max drift ' + d.toExponential(2));
  });

  h.group('inflate — node count and closedness are preserved');
  [['square', F.rect(0,0,100,100)], ['disc', F.circle(0,0,100)],
   ['rrect', F.roundRect(0,0,300,100,20)], ['star', F.star(0,0,100,40,5)]].forEach(function (c) {
    var o = GR.inflateCurves([c[1]], 0.5)[0];
    h.assertEqual('node count: ' + c[0], o.segments.length, c[1].segments.length);
    h.assertEqual('closedness: ' + c[0], o.isClosed, true);
  });

  h.group('inflate — the amount definition');
  // A slab of width w has t = w and BOTH facing boundary points move out by amount*t/2, so at 100%
  // it is 2w across. The tolerance is the bisection's precision plus the flattening slack and
  // cannot be tightened past them.
  var slab = GR.inflateCurves([F.rect(0,0,40,400)], 1)[0];
  var stau = 2 * GR.inflTolFor([F.rect(0,0,40,400)]);
  h.assertClose('slab of 40 doubles to 80 at 100%', bboxOf(ring(slab)).w, 80, 1e-5 * 40 + stau);

  var disc = GR.inflateCurves([F.circle(0,0,100)], 1)[0];
  var dr = radii(disc, 0, 0);
  h.assertClose('disc of R=100 doubles to R=200 at 100%', Math.max.apply(null, dr), 200, 0.5);

  h.group('inflate — a circle stays a circle');
  // Its handles scale by s = 1 + amount, which is EXACTLY the handle length a circle of radius
  // R(1+amount) needs, since k*R*(1+amount) = k*R'. So the midpoint is already on target and b = 0.
  // Under a translate-only rule the handles fall short by k*amount*R and the result is a rounded
  // square.
  //
  // The assertion is RELATIVE and against the INPUT, because a four-cubic circle is itself 2.7e-4
  // off a true circle: at R = 200 its radii already spread by 0.0546 before anything is inflated.
  // An absolute tolerance here would be a number tuned to whatever the code happens to emit.
  var dr0 = radii(F.circle(0,0,100), 0, 0);
  var relIn = (Math.max.apply(null,dr0) - Math.min.apply(null,dr0)) / Math.max.apply(null,dr0);
  var relOut = (Math.max.apply(null,dr) - Math.min.apply(null,dr)) / Math.max.apply(null,dr);
  h.assert('output is no less round than its input', relOut <= relIn * 1.05,
    'input ' + relIn.toExponential(3) + ' output ' + relOut.toExponential(3));

  h.group('inflate — the bow');
  // A square's extent is set by its BULGED EDGES, not by its corners: the corners move along their
  // bisectors and pick up only cos(45) of that perpendicular to each edge, so they sit INSIDE the
  // offset their edges imply. That miter shortfall is the pinched-corner look, not an error.
  var sq = GR.inflateCurves([F.rect(0,0,100,100)], 1)[0];
  h.assertClose('square extent is set by the bulged edges', bboxOf(ring(sq)).w, 200, 0.5);
  h.assertClose('square edge midpoint bows out by w/2', mid(sq.segments[0]).y, -50, 0.3);
  h.assertClose('square corner sits inside by the miter shortfall',
    50 - Math.abs(sq.segments[0].start.x), 50 * (1 - Math.cos(Math.PI/4)), 0.15);

  // A rounded rectangle's flat sides bulge: their ANCHORS move by the corner arcs' thickness (40)
  // while the side's own midpoint target is the full half-width (100), so b is large and positive.
  // This is the case an anchor-smoothness gate gets wrong — a straight side between two smooth
  // anchors is precisely where a bulge is needed — and getting it wrong turns the whole operation
  // into an offset.
  var rr = GR.inflateCurves([F.roundRect(0,0,300,100,20)], 0.5)[0];
  var side = rr.segments[0];
  h.assert('a rounded rect\'s flat side is not straight in the output',
    Math.abs((side.c1.y + side.c2.y)/2 - (side.start.y + side.end.y)/2) > 1.0);

  h.group('inflate — tangent continuity');
  // A straight segment's handles sit ON its anchors, so a translate-only rule leaves the outgoing
  // tangent equal to the bow — normal to the edge. Every anchor would become a 90 degree kink and a
  // square would inflate into four bulges meeting at spikes.
  var sq2 = GR.inflateCurves([F.rect(0,0,100,100)], 0.5)[0];
  var tOut = { x: sq2.segments[0].c1.x - sq2.segments[0].start.x,
               y: sq2.segments[0].c1.y - sq2.segments[0].start.y };
  h.assert('output tangent is not perpendicular to the input edge',
    Math.abs(tOut.x / Math.hypot(tOut.x, tOut.y)) > 0.5);

  // A bow points along its OWN segment's normal, so at an anchor shared by two bowed segments the
  // two handles pick up different directions and a curve that was smooth acquires a visible break.
  var rr2 = GR.inflateCurves([F.roundRect(0,0,300,100,20)], 0.5)[0];
  var worst = 0;
  for (var i = 0; i < rr2.segments.length; i++) {
    var p = (i - 1 + rr2.segments.length) % rr2.segments.length;
    var dO = { x: rr2.segments[i].c1.x - rr2.segments[i].start.x,
               y: rr2.segments[i].c1.y - rr2.segments[i].start.y };
    var dI = { x: rr2.segments[p].end.x - rr2.segments[p].c2.x,
               y: rr2.segments[p].end.y - rr2.segments[p].c2.y };
    if (Math.hypot(dO.x,dO.y) < 1e-9 || Math.hypot(dI.x,dI.y) < 1e-9) continue;
    var ang = Math.abs(Math.atan2(dO.x*dI.y - dO.y*dI.x, dO.x*dI.x + dO.y*dI.y)) * 180 / Math.PI;
    if (ang > worst) worst = ang;
  }
  h.assert('smooth input anchors stay smooth in the output', worst < 0.5,
    'worst break ' + worst.toFixed(4) + ' deg');

  h.group('inflate — faces and pass-through');
  // createSetCurves replaces a node's geometry outright, so a shape with counters must rebuild ALL
  // its rings in one call. This is that case, computed in one call.
  // Run at BOTH hole windings: the ring sign is what makes a counter close rather than grow, and a
  // sign taken from a ring's accidental winding would pass at one and fail at the other.
  [['negatively-wound', F.circle(0,0,70,false)], ['positively-wound', F.circle(0,0,70)]]
    .forEach(function (c) {
      var ann = GR.inflateCurves([F.circle(0,0,100), c[1]], 0.5);
      h.assert('outer ring grows, ' + c[0] + ' counter',
        Math.max.apply(null, radii(ann[0],0,0)) > 100.5);
      // 70 - 0.5 * 30/2 = 62.5: the counter's wall is 30, so at amount 0.5 it closes by 7.5.
      h.assertClose('counter closes, ' + c[0], Math.max.apply(null, radii(ann[1],0,0)), 62.5, 0.25);
    });

  var thru = GR.inflateCurves([F.openPath(), F.degenerateRing()], 1);
  h.assertEqual('an open path is copied through', thru[0].segments[1].end.x, 100);
  h.assertEqual('an open path keeps isClosed false', thru[0].isClosed, false);
  h.assert('a zero-area ring is copied through', !!thru[1].notes.length);
};
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node inflate/test/run.js
```
Expected: `GR.inflateCurves is not a function`.

- [ ] **Step 3: Implement `inflate/src/inflate.js`**

```js
/**
 * inflate.js — the displacement rules. Anchors and handles in, anchors and handles out.
 *
 * Pure geometry, no Affinity API, no flattening of the OUTPUT. Flattened rings exist only to
 * measure; what leaves here is the original Béziers with moved anchors and recomputed handles.
 * gravity's softbodies are the cautionary case: they flatten every curve so the physics can step
 * it, write the result back with lineToXY, and a smooth input returns faceted no matter how fine
 * the mesh is — because the curve stopped existing before the mesh was built.
 */
(function (GR) {
  'use strict';

  // Two input tangents this close to parallel count as a smooth anchor for the continuity pass.
  var PARALLEL_EPS = 1e-6;

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function unit(a) { var l = len(a); return l > 0 ? { x: a.x / l, y: a.y / l } : null; }

  /**
   * Inflates ONE closed curve. Same segment count out as in, always.
   *
   * P'   = P + n * amount * t/2
   * s    = |B' - A'| / |B - A|
   * h1   = collapsed(c1, A) ? amount*(B - A)/3 : (c1 - A)
   * h2   = collapsed(c2, B) ? amount*(A - B)/3 : (c2 - B)
   * b    = dot(M' - M_naive, n_M) / 0.75
   * c1'  = A' + h1*s + n_M*b        c2' = B' + h2*s + n_M*b
   */
  function inflateCurve(curve, sign, ctx, amount) {
    var segs = curve.segments, n = segs.length, i;
    var notes = [];

    // --- one probe per segment ---------------------------------------------------
    var segT = [], segN = [], segM = [];
    for (i = 0; i < n; i++) {
      var st = GR.inflSegmentThickness(segs[i], sign, ctx);
      if (st.t < 0) {
        // distanceToRings is UNSIGNED, so a flipped normal would have yielded a plausible t in
        // silence. Naming the segment is the only way this is ever noticed.
        notes.push('segment ' + i + ': probe left the material, treated as zero thickness');
        st.t = 0;
      }
      segT.push(st.t); segN.push(st.n); segM.push(st.M);
    }

    // --- anchors ------------------------------------------------------------------
    var Ap = [];
    for (i = 0; i < n; i++) {
      var m = GR.inflAnchorMeasure(segs, i, sign, ctx, segT);
      if (m.cusp) {
        // The bisector direction is arbitrary here while the magnitude is not, so the anchor would
        // shoot sideways. Leave it exactly where it is, and say so.
        notes.push('anchor ' + i + ': cusp, left in place');
        Ap.push({ x: segs[i].start.x, y: segs[i].start.y });
        continue;
      }
      Ap.push(add(segs[i].start, mul(m.n, amount * m.t / 2)));
    }

    // --- handles ------------------------------------------------------------------
    var out = [];
    for (i = 0; i < n; i++) {
      var s = segs[i], j = (i + 1) % n, A = s.start, B = s.end;
      var chord = sub(B, A), clen = len(chord);
      // Scaling by s preserves whatever curvature the user drew as the shape grows. Handles keep
      // their ORIGINAL direction rather than rotating with the chord; where the two ends have
      // different t the chord rotates and the handles deliberately do not follow it.
      var sc = clen < 1e-12 ? 1 : len(sub(Ap[j], Ap[i])) / clen;

      // Substituting chord/3 for a collapsed handle gives the curve somewhere to leave from, and
      // gating that substitution by `amount` is what keeps amount = 0 the identity.
      var h1 = GR.inflCollapsed(s.c1.x, s.c1.y, A.x, A.y, clen)
        ? mul(chord, amount / 3) : sub(s.c1, A);
      var h2 = GR.inflCollapsed(s.c2.x, s.c2.y, B.x, B.y, clen)
        ? mul(chord, -amount / 3) : sub(s.c2, B);

      var c1n = add(Ap[i], mul(h1, sc)), c2n = add(Ap[j], mul(h2, sc));

      // The bow is DERIVED, not tuned: it is exactly the residual between where the pillow surface
      // puts the midpoint and where the translated, scaled handles already put it, over 0.75 —
      // the midpoint's sensitivity to a symmetric handle offset, since B(0.5) = (A+3c1+3c2+B)/8.
      // There is no gain constant to calibrate.
      var b = 0, nM = segN[i];
      if (nM && clen > 0) {
        var Mt = add(segM[i], mul(nM, amount * segT[i] / 2));
        var Mn = { x: (Ap[i].x + 3 * c1n.x + 3 * c2n.x + Ap[j].x) / 8,
                   y: (Ap[i].y + 3 * c1n.y + 3 * c2n.y + Ap[j].y) / 8 };
        b = dot(sub(Mt, Mn), nM) / 0.75;
      }
      var bow = nM ? mul(nM, b) : { x: 0, y: 0 };
      out.push({ start: Ap[i], c1: add(c1n, bow), c2: add(c2n, bow), end: Ap[j] });
    }

    // --- restore tangent continuity where the INPUT was smooth --------------------
    // Runs only where the input was smooth, and trades a small midpoint error for continuity.
    for (i = 0; i < n; i++) {
      var p = (i - 1 + n) % n;
      var tg = GR.inflTangentsAt(segs, i);
      var a1 = unit(tg.tIn), a2 = unit(tg.tOut);
      if (!a1 || !a2) continue;
      if (Math.abs(a1.x * a2.y - a1.y * a2.x) > PARALLEL_EPS || dot(a1, a2) <= 0) continue;
      // BOTH directions are taken in travel order. The incoming handle is stored as c2 and points
      // backward, so summing `c2 - A` with `c1 - A` would very nearly CANCEL instead of averaging.
      var dOut = unit(sub(out[i].c1, out[i].start));
      var dIn = unit(sub(out[p].end, out[p].c2));
      if (!dOut || !dIn) continue;
      var d = unit(add(dOut, dIn));
      if (!d) continue;
      var lOut = len(sub(out[i].c1, out[i].start)), lIn = len(sub(out[p].end, out[p].c2));
      out[i].c1 = add(out[i].start, mul(d, lOut));       // lengths unchanged, directions replaced
      out[p].c2 = sub(out[p].end, mul(d, lIn));
    }

    return { segments: out, isClosed: curve.isClosed, notes: notes };
  }

  /** Inflates every curve of one node. Open, degenerate and zero-area curves pass through. */
  function inflateCurves(curves, amount, flattenTol) {
    var cl = GR.inflClassify(curves, flattenTol);
    var out = [];
    for (var i = 0; i < cl.recs.length; i++) {
      var r = cl.recs[i];
      if (r.skip) {
        out.push({ segments: r.curve.segments, isClosed: r.curve.isClosed,
                   notes: ['copied through unchanged: ' + r.skip] });
        continue;
      }
      out.push(inflateCurve(r.curve, r.sign, GR.inflProbeCtx(r.face, cl.tol), amount));
    }
    return out;
  }

  GR.inflateCurve = inflateCurve;
  GR.inflateCurves = inflateCurves;
  GR.INFL_PARALLEL_EPS = PARALLEL_EPS;

})(GR);
```

- [ ] **Step 4: Run the tests**

```bash
# append 'src/inflate.js' to SRC in inflate/build.js FIRST, or it will not reach dist/
node inflate/test/run.js
node inflate/build.js && node inflate/build.js --check
```
Expected: every assertion PASS. The prototype these were taken from reported 25 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add inflate/src/inflate.js inflate/test/test_inflate.js inflate/test/run.js inflate/build.js inflate/dist/inflate.js
git commit -m "feat(inflate): displace anchors by thickness and derive the bow from the residual"
```

---

## Task 6: The invariants

These are the assertions that catch a defect no fixture-by-fixture check can, because each holds a
property fixed while changing something the property must not depend on.

**Files:**
- Modify: `inflate/test/test_inflate.js`

- [ ] **Step 1: Write the failing tests**

```js
  h.group('inflate — invariants');

  // WINDING INDEPENDENCE. The original curves are deliberately NOT rewound, so the two outputs
  // differ in vertex ORDER and in nothing else — the comparison is up to reversal, via a quantity
  // that does not depend on order. This is the assertion that catches a sign taken from a ring's
  // accidental winding.
  function absArea(c) { return Math.abs(GR.signedArea(ring(c))); }
  var fwd = GR.inflateCurves([F.star(0,0,100,40,5)], 0.4)[0];
  var rev = GR.inflateCurves([F.reverseCurve(F.star(0,0,100,40,5))], 0.4)[0];
  h.assertClose('same area at either winding', absArea(fwd), absArea(rev), absArea(fwd) * 1e-6);
  h.assertEqual('same node count at either winding', fwd.segments.length, rev.segments.length);

  // SCALE INVARIANCE. The same percentage on a 2x shape must give 2x displacement. This is what
  // fails for an ABSOLUTE flatten tolerance: measured across x0.005/x1/x20 the scaled displacement
  // spread 198% with an absolute tolerance and 0.00% with a relative one.
  var disp = [0.005, 1, 20].map(function (S) {
    var o = GR.inflateCurves([F.roundRect(0, 0, 300*S, 100*S, 20*S)], 0.5)[0];
    return Math.abs(o.segments[0].start.y) / S;
  });
  h.assertClose('displacement scales with the shape (x0.005 vs x1)', disp[0], disp[1], disp[1] * 1e-3);
  h.assertClose('displacement scales with the shape (x20 vs x1)', disp[2], disp[1], disp[1] * 1e-3);

  // A SMOKE TEST ONLY. An offset passes this too, so it is not coverage of the pillow behaviour —
  // it only catches an inflation that shrinks.
  var prev = -1, mono = true;
  [0, 0.1, 0.25, 0.5, 0.75, 1].forEach(function (a) {
    var ar = absArea(GR.inflateCurves([F.star(0,0,100,40,5)], a)[0]);
    if (ar <= prev) mono = false;
    prev = ar;
  });
  h.assert('enclosed area increases monotonically in amount', mono);

  // THE PILLOW PROPERTY ITSELF, which the monotonic test above does NOT cover: a fat body must grow
  // more than a thin arm. Under an offset both grow the same, so this is the assertion that
  // separates the two effects.
  var fat = GR.inflateCurves([F.rect(0, 0, 200, 200)], 0.5)[0];
  var thin = GR.inflateCurves([F.rect(0, 0, 20, 200)], 0.5)[0];
  var fatGrow = Math.abs(mid(fat.segments[0]).y);
  var thinGrow = Math.abs(mid(thin.segments[0]).y);
  h.assert('a fat body grows more than a thin arm', fatGrow > thinGrow * 5,
    'fat ' + fatGrow.toFixed(2) + ' vs thin ' + thinGrow.toFixed(2) + ' — an offset would tie');
```

- [ ] **Step 2: Run**

```bash
node inflate/test/run.js
```
Expected: all PASS. The fat/thin ratio should be about 10:1 — `0.5·200/2 = 50` against `0.5·20/2 = 5`.
If it is 1:1 the displacement is not scaling with thickness and the whole feature is an offset.

- [ ] **Step 3: Commit**

```bash
git add inflate/test/test_inflate.js
git commit -m "test(inflate): winding, scale and the pillow property itself"
```

---

## Task 7: `ui.js` — one slider

**Files:**
- Create: `inflate/src/ui.js`
- Modify: `inflate/build.js` (append `'src/ui.js'` to `SRC`), `inflate/test/run.js`

- [ ] **Step 1: Write it**

There is no headless test for a dialog. The control shapes are taken from `gravity/src/ui.js`, which
is known to render correctly.

```js
/**
 * ui.js — the settings dialog. One slider.
 *
 * Control shapes are taken from gravity's ui.js, which is known to render: addUnitValueEditor with
 * UnitType.Number, setShowPopupSlider(true), precision 0.
 *
 * The dialog does NOT scroll. Once it outgrows the screen the OK and Cancel buttons move off the
 * bottom and it cannot be dismissed at all, so every control and every full-width help paragraph is
 * spent against that budget. One slider and one line of help is the whole budget here.
 */
(function (GR) {
  'use strict';

  // 100% doubles the LOCAL THICKNESS: a slab of width w has t = w and both of its facing boundary
  // points move out by amount*t/2, so it ends up 2w across. Scale-free by construction — the same
  // percentage means the same thing on a 20pt letter and a 2000pt shape.
  var DEFAULT_PCT = 30;

  function showSettings() {
    var mod = require('/dialog');
    var Dialog = mod.Dialog, DialogResult = mod.DialogResult, UnitType = mod.UnitType;

    var dlg = Dialog.create('Inflate');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();
    var grp = col.addGroup('Inflation');
    var ctl = grp.addUnitValueEditor('Inflate %', UnitType.Number, UnitType.Number, DEFAULT_PCT, 0, 100);
    ctl.setShowPopupSlider(true);
    ctl.precision = 0;
    col.addText('Grows each shape by the room inside it: a fat body swells, a thin arm barely ' +
                'moves, corners stay pinched. 100% doubles the thickness. Re-run to compound; ' +
                'undo to dial back.');

    if (dlg.runModal() !== DialogResult.Ok) return null;
    return { amount: Math.max(0, Math.min(100, ctl.value)) / 100 };
  }

  GR.inflShowSettings = showSettings;
  GR.INFL_DEFAULT_PCT = DEFAULT_PCT;

})(GR);
```

- [ ] **Step 2: Verify it loads headlessly**

`require('/dialog')` is inside the function, so nothing runs at load. Add `src/ui.js` to `run.js`'s
module list and confirm the suite still passes — that is the assertion that it will not throw on
import inside the sandbox.

```bash
# append 'src/ui.js' to SRC in inflate/build.js FIRST
node inflate/test/run.js
node inflate/build.js && node inflate/build.js --check
```

- [ ] **Step 3: Commit**

```bash
git add inflate/src/ui.js inflate/build.js inflate/test/run.js inflate/dist/inflate.js
git commit -m "feat(inflate): one slider, and help that says what the label cannot"
```

---

## Task 8: `main.js` — the only file that touches the SDK

**Files:**
- Create: `inflate/src/main.js`
- Create: `inflate/test/test_main_wiring.js`
- Modify: `inflate/build.js` (append `'src/main.js'` to `SRC`), `inflate/test/run.js`

- [ ] **Step 1: Write the failing wiring test**

`main()` itself cannot run headlessly, but the pure helpers it is built from can, and they are where
the transform bugs live. Load `main.js` — nothing outside a function body runs — and assert them.

```js
// inflate/test/test_main_wiring.js
'use strict';

module.exports = function (GR, h) {
  h.group('main — the base/spread round trip');

  // createSetCurves writes BASE space, not spread. Geometry computed in spread space needs the
  // INVERSE of baseToSpreadTransform applied first — the same matrix it was read with, or the round
  // trip does not close. A freshly drawn node has an identity transform and round-trips either way,
  // so this stays invisible until a MOVED node is involved, and then it looks like a displacement
  // bug rather than a transform bug.
  var m = [2, 0, 100, 0, 3, -50];                    // scale 2x3, translate (100, -50)
  var seg = { start: {x:1,y:2}, c1: {x:3,y:4}, c2: {x:5,y:6}, end: {x:7,y:8} };

  var fwd = GR.inflMapSegment(seg, m);
  h.assertClose('forward maps the start x', fwd.start.x, 2*1 + 0*2 + 100, 1e-12);
  h.assertClose('forward maps the start y', fwd.start.y, 0*1 + 3*2 - 50, 1e-12);

  var back = GR.inflMapSegment(fwd, GR.invertMatrix(m));
  ['start','c1','c2','end'].forEach(function (k) {
    h.assertClose('round trip closes on ' + k + '.x', back[k].x, seg[k].x, 1e-9);
    h.assertClose('round trip closes on ' + k + '.y', back[k].y, seg[k].y, 1e-9);
  });

  // A singular matrix has no sensible inverse to invent. invertMatrix returns null, and the points
  // must then be written UNCHANGED rather than mangled.
  h.assertEqual('a singular matrix inverts to null', GR.invertMatrix([0,0,5,0,0,5]), null);
  var unchanged = GR.inflMapSegment(seg, null);
  h.assertClose('a null matrix leaves the points alone', unchanged.c2.y, 6, 1e-12);

  h.group('main — the amount definition survives the round trip');
  // The headless identity test cannot catch a missing inverse, because there is no transform in it.
  // This one can: inflate at amount 0 THROUGH a non-identity matrix and require the original back.
  var F = require('./fixtures');
  var sq = F.rect(0, 0, 100, 100);
  var spread = { segments: sq.segments.map(function (s) { return GR.inflMapSegment(s, m); }),
                 isClosed: true };
  var out = GR.inflateCurves([spread], 0)[0];
  var base = out.segments.map(function (s) { return GR.inflMapSegment(s, GR.invertMatrix(m)); });
  var drift = 0;
  for (var i = 0; i < base.length; i++) {
    ['start','c1','c2','end'].forEach(function (k) {
      drift = Math.max(drift, Math.hypot(base[i][k].x - sq.segments[i][k].x,
                                         base[i][k].y - sq.segments[i][k].y));
    });
  }
  h.assert('amount = 0 through a non-identity transform is the identity', drift < 1e-9,
    'max drift ' + drift.toExponential(2));
};
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node inflate/test/run.js
```
Expected: `GR.inflMapSegment is not a function`.

- [ ] **Step 3: Implement `inflate/src/main.js`**

```js
/**
 * main.js — reads the selection, inflates it, writes it back. The ONLY file touching the SDK.
 *
 * Everything above this file is plain numbers in, plain numbers out, and is verified headlessly.
 * What cannot be verified headlessly is exactly what lives here: the base/spread round trip, and
 * whether the SDK's curve builder accepts the cubics this produces.
 */
(function (GR) {
  'use strict';

  var TITLE = 'Inflate';

  /**
   * The base-to-spread matrix as row-major 2x3.
   *
   * Curve coordinates are BASE space. baseToSpreadTransform is the only one of the three matrices
   * with the ancestors composed into it; node.transform is the LOCAL matrix and on a node inside a
   * scaled artboard it is wrong by the artboard's scale. gravity learned that the hard way — an
   * extraction using the local matrix made its whole simulation depend on the artboard.
   *
   * matrixOf lives in gravity's extract.js, which touches the SDK; rather than pull that whole
   * module in, the four lines are repeated here so main.js stays the only SDK file.
   *
   * The node.transform fallback looks like it contradicts all of the above, and would if this
   * module MEASURED in spread space and wrote in base. It does not: the same matrix is used forward
   * and inverted back, and thickness is relative to the shape itself, so a wrong-but-consistent
   * matrix still round-trips and still inflates by the right proportion. It is reached only on a
   * build old enough to lack the other two.
   */
  function matrixOf(node) {
    function data(t) {
      if (!t || !t.data) return null;
      var d = t.data;
      if (d.length < 6) return null;
      return [d[0], d[1], d[2], d[3], d[4], d[5]];
    }
    var m = null;
    try { m = data(node.baseToSpreadTransform); } catch (e) { /* older build, try the next */ }
    if (!m) { try { m = data(node.curvesInterface && node.curvesInterface.domainTransform); } catch (e) { /* likewise */ } }
    if (!m) { try { m = data(node.transform); } catch (e) { /* nothing usable */ } }
    return m;
  }

  function mapPoint(p, m) {
    if (!m) return { x: p.x, y: p.y };
    return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
  }

  /** Pure, and exported, because it is where the transform bugs live. */
  function mapSegment(s, m) {
    return { start: mapPoint(s.start, m), c1: mapPoint(s.c1, m),
             c2: mapPoint(s.c2, m), end: mapPoint(s.end, m) };
  }

  /** Every curve of one node, in SPREAD space, as plain numbers. */
  function readCurves(node) {
    var out = [];
    var ci = node.curvesInterface;
    if (!ci) return out;
    var pc = null;
    try { pc = ci.polyCurve; } catch (e) { return out; }
    if (!pc) return out;
    var m = matrixOf(node);
    for (var c = 0; c < pc.curveCount; c++) {
      var curve = pc.at(c);
      var segs = [];
      for (var bz of curve.beziers) segs.push(mapSegment(bz, m));
      out.push({ segments: segs, isClosed: curve.isClosed });
    }
    return out;
  }

  function main() {
    var Document = require('/document').Document;
    var geometry = require('/geometry');
    var commands = require('/commands');
    var CurveBuilder = geometry.CurveBuilder, PolyCurve = geometry.PolyCurve;
    var DocumentCommand = commands.DocumentCommand,
        CompoundCommandBuilder = commands.CompoundCommandBuilder;

    var doc = Document.current;
    if (!doc) { app.alert('No active document.', TITLE); return; }

    // A live shape is parametric: there are no anchors to move, so it is excluded rather than
    // silently mangled, exactly as add_anchor_points does. But the spec requires that anything
    // skipped be NAMED, and a plain .filter() drops a live shape mixed in with real curves with no
    // message at all — the user sees some of their selection inflate and some not, and nothing says
    // why. So the refusals are collected rather than discarded.
    var nodes = [], refused = [];
    for (var sel of doc.selection.nodes) {
      if (sel.isPolyCurveNode) nodes.push(sel); else refused.push(sel);
    }
    for (var rI = 0; rI < refused.length; rI++) {
      var nm = 'a node';
      try { if (refused[rI].name) nm = '"' + refused[rI].name + '"'; } catch (e) { /* unnamed */ }
      console.log(TITLE + ': skipped ' + nm + ' — not a curve shape. Run Convert to Curves first.');
    }
    if (!nodes.length) {
      app.alert('Select one or more vector (curve) shapes first.\n' +
                '(For a live shape, run Convert to Curves first.)', TITLE);
      return;
    }

    var settings = GR.inflShowSettings();
    if (!settings) return;

    var plans = [], skipped = [], notes = [];
    for (var node of nodes) {
      var curves = readCurves(node);
      if (!curves.length) { skipped.push('a node with no curve geometry'); continue; }

      var inflated = GR.inflateCurves(curves, settings.amount);
      for (var k = 0; k < inflated.length; k++) {
        var nn = inflated[k].notes || [];
        for (var q = 0; q < nn.length; q++) notes.push('curve ' + k + ': ' + nn[q]);
      }

      // Where the transform is unreadable or singular there is no sensible inverse to invent, so
      // the points go back unchanged rather than displaced by the node's own transform.
      var inv = GR.invertMatrix(matrixOf(node));

      // createSetCurves replaces a node's geometry OUTRIGHT, so every curve of a node — a shape and
      // all its counters — must be rebuilt into ONE PolyCurve and issued as ONE command. Rebuilding
      // them separately would have the second command erase the first.
      var poly = PolyCurve.create();
      for (var i = 0; i < inflated.length; i++) {
        var segs = inflated[i].segments;
        if (!segs.length) continue;
        // begin(point) + addBezier(c1, c2, end), NOT the XY forms. This pair is round-trip
        // verified in add_anchor_points_1.0.js:120-122, and its `lerp` (line 29) shows it being fed
        // plain {x, y} OBJECT LITERALS — exactly what mapPoint returns — so no SDK point type has
        // to be constructed. `addBezierXY` exists in examples/joinpaths.js:150 but has no verified
        // use in this repository, and there is nothing to gain by preferring it.
        var cb = CurveBuilder.create();
        cb.begin(mapPoint(segs[0].start, inv));
        for (var s = 0; s < segs.length; s++) {
          cb.addBezier(mapPoint(segs[s].c1, inv), mapPoint(segs[s].c2, inv),
                       mapPoint(segs[s].end, inv));
        }
        // A closed curve is closed with close(), NEVER by repeating the first point: repeating it
        // yields isClosed false, which draws closed but FILLS wrong, and isClosed is read-only.
        if (inflated[i].isClosed) cb.close();
        poly.addCurve(cb.createCurve());
      }
      plans.push({ ci: node.curvesInterface, poly: poly });
    }

    if (!plans.length) { app.alert('Nothing to inflate.', TITLE); return; }


    var cmds = plans.map(function (p) { return DocumentCommand.createSetCurves(p.ci, p.poly); });
    if (cmds.length === 1) {
      doc.executeCommand(cmds[0]);
    } else {
      // One undo step for the whole selection, matching add_anchor_points.
      var builder = CompoundCommandBuilder.create();
      for (var ci2 = 0; ci2 < cmds.length; ci2++) builder.addCommand(cmds[ci2]);
      doc.executeCommand(builder.createCommand());
    }

    // The console is the only place a per-curve note can go; a modal for each would be unusable.
    for (var nI = 0; nI < notes.length; nI++) console.log(TITLE + ': ' + notes[nI]);
    for (var sI = 0; sI < skipped.length; sI++) console.log(TITLE + ': skipped ' + skipped[sI]);

    app.alert('Inflated ' + plans.length + ' shape' + (plans.length === 1 ? '' : 's') +
              ' by ' + Math.round(settings.amount * 100) + '%.' +
              (notes.length ? '\n' + notes.length + ' note(s) in the console.' : ''), TITLE);
  }

  GR.inflMapPoint = mapPoint;
  GR.inflMapSegment = mapSegment;
  GR.main = main;

})(GR);
```

- [ ] **Step 4: Run the tests, then build**

```bash
# append 'src/main.js' to SRC in inflate/build.js FIRST — this is the last entry
node inflate/test/run.js
node inflate/build.js
node inflate/build.js --check
```
Expected: every assertion PASS, and a `dist/inflate.js` that is up to date.

- [ ] **Step 5: Commit**

```bash
git add inflate/src/main.js inflate/test/test_main_wiring.js inflate/test/run.js inflate/build.js inflate/dist/inflate.js
git commit -m "feat(inflate): read the selection, write cubics back as one undo step"
```

---

## Task 9: Verification against real artwork — the part no test above can do

**Nothing in Tasks 1–8 has run against the Affinity SDK.** Three things are unverified by
construction and this task is the only place they can be settled.

- [ ] **Step 1: Ask for a probe of the three unverified assumptions**

The developer cannot run Affinity. Ask the user to install `dist/inflate.js` and paste the console
output. **`/fs` and export work only in an INSTALLED script, never in the testing environment.**

The probe must answer:

1. **Does `cb.addBezier` accept the plain `{x, y}` literals `mapPoint` returns?** It does in
   `add_anchor_points_1.0.js` — `lerp` (line 29) builds literals and line 122 feeds them straight in —
   so this is expected to pass and is listed only because gravity itself never writes a cubic, only
   `lineToXY`. If it fails, `beginXY` / `addBezierXY` (`examples/joinpaths.js:150`) is the fallback.
2. **Is `LINE_EPS = 1e-6` right for a real straight segment?** The SDK reference says a straight
   segment stores `c1 ≈ start`, not `c1 == start`. Log `|c1 − A| / |B − A|` for every segment of a
   drawn rectangle; the constant must sit well above the largest value seen on a straight edge and
   well below the smallest seen on a curved one.
3. **Does the base/spread round trip close on a MOVED node?** A freshly drawn shape has an identity
   `baseToSpreadTransform` and round-trips whether or not the inverse is applied, so a missing
   inverse stays invisible until a moved or scaled node is involved.

- [ ] **Step 2: The first real run must include a non-identity transform**

Ask for a document containing, at minimum:
- a rectangle converted to curves, **moved and scaled** after being drawn
- an ellipse converted to curves
- a letter "O" or "B" converted to curves — an outer ring with counters, in one node
- a shape with an obtuse corner: a pentagon or a hexagon (this is the C1 case)

Run `Inflate` at **0%** first. It must reproduce the artwork exactly. If it moves, the inverse
transform is wrong, and no amount of geometry debugging will find it.

- [ ] **Step 3: Ask for the result as SVG, not a screenshot**

Rasterising destroys the curve geometry that is the entire subject of this feature. Exported curves
can be checked directly, and `gravity`'s `outlineFolds` can be run over them. Ask for
**File > Export > SVG** of the inflated result.

Check on the returned SVG:
- node count per path is unchanged from the input
- the ellipse is still an ellipse (four cubics, `b = 0`)
- the pentagon actually grew (this is what the old `4·tau` rule got wrong by −98.7%)
- the "O" counter closed while its outer ring grew
- no path self-intersects at 100% — and if one does, that is the deferred `ringCrossings` case, not
  a regression

- [ ] **Step 4: Calibrate what only a real output can calibrate**

Two things in the spec are explicitly unmeasured, and this is their calibration:

- **Whether displacement should be LINEAR in `t`.** It is the one shape heuristic left. The bow is
  derived from it rather than tuned alongside it, so there is no second parameter to trade against.
- **How visible the re-collinearising post-pass's midpoint error is.** It trades midpoint accuracy
  for continuity, and nothing in the design predicts how that looks.

Do not change either without a real output in hand. Record what the run showed in the spec's
"Known risks" section, replacing the prediction with the measurement.

- [ ] **Step 5: Patch the spec to match what shipped**

The preamble says the spec is stale on four points. Nothing above changes it, so do it here — with
the real run's numbers in hand, not this plan's prototype numbers.

- **C1**, the `4·tau` degeneracy rule in "Local thickness": replace with
  `degenerate ⟺ 2·r·(1 − sin(θ/2)) >= tau`, and the reason — a fixed multiple of `tau` is right at
  one corner angle and wrong at every other.
- **C2**, the `FLATTEN_TOL` entry under "Known risks and unmeasured constants": it is no longer a
  risk, it is resolved. Move it into "Local thickness" as `TOL_FRAC = 5e-4` of the face box.
- **C3**, the "`tau` does not over-report" paragraph: qualify it to head-on constraints and give the
  `tau/(1 − cos θ)` amplification.
- **C4**, the circle assertion in "Testing": relative-against-input, not absolute.

Also add the finding that `tau` is load-bearing rather than slack, and why a local-deficit variant
cannot replace it — otherwise someone will try it again.

Per the repository convention, `docs/` ships to the community: write these as the current design,
**not** as a dated correction log or a narrative of how they were found.

- [ ] **Step 6: Write the docs and commit**

Write `inflate/README.md` (for people reading `src/`) and `inflate/MANUAL.md` (for people running it
in Affinity), following gravity's split. The README must state that `contours.js`, `flatten.js` and
`softmesh.js` are gravity's files used by reference, not copies.

```bash
git add inflate/README.md inflate/MANUAL.md inflate/docs
git commit -m "docs(inflate): what it does, and what the first real run measured"
```

---

## What is deliberately not in this plan

- **Self-intersection repair.** A thin crescent or an "S" can swallow its own concavity at high
  amounts. `ringCrossings` (`softmesh.js`) can detect it, but until `t` is calibrated against real
  output a crossing is more likely a symptom of that than a case worth reporting.
- **Subdividing to follow a complex bulge.** One cubic per segment cannot follow a long edge across
  varying thickness. Accepted, to hold node count. The fallback, if it matters, is inserting anchors
  only where fit error exceeds a tolerance — and that breaks the feature's central promise, so it
  needs the user's decision, not the implementer's.
- **Animation, 3D shading, bevels, highlights.** Out of scope per the spec.
