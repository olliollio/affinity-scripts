# Shape Inflation — Design

**Goal:** Give a flat vector shape the look of an inflated pillow, in one step, without adding
nodes. The result is a curve the user can still edit as the shape they drew.

## What "inflated" means here

Two different effects go by the name. This builds the second.

- **Offset** moves every boundary point outward by the same distance. Corners round off uniformly,
  and a thin arm grows as much as a fat body. It reads as a fatter outline.
- **Pillow** grows a shape by the room available inside it. A fat body swells; a thin arm barely
  moves; corners stay comparatively pinched while the edges between them bow. It reads as inflated.

The difference is entirely in what scales the displacement. Offset uses a constant. A pillow uses
the **local thickness** — how far it is across the material at that point.

## Why this is not part of `gravity`

`gravity` simulates. This does not. There is no timestep, no solver, no world scale, no planck, and
no convergence criterion: every output point is a closed-form function of the input geometry and one
number.

`gravity` also demonstrates the trap this design exists to avoid. Its softbodies flatten every curve
to a polyline so the physics can step them, and write the result back with `lineToXY`
(`playback.js:268`, and `:190` for ropes) — so a smooth input returns faceted, and no amount of mesh
resolution fixes it, because the curve stopped existing before the mesh was built. Inflation never
flattens the output. Flattened rings are used only to **measure**; what gets written back is the
original Béziers with moved anchors and recomputed handles.

## Non-goals

- **Animation.** The result is a static shape, not a sequence.
- **Adding nodes.** Node count out equals node count in. A bulge that a single cubic per segment
  cannot follow is a recorded limitation, not a case to subdivide for.
- **3D shading, bevels or highlights.** This changes the outline only.
- **Self-intersection repair.** Not detected and not fixed in the first version; see Known risks.

## Architecture

A standalone script, `inflate/`, sibling to `gravity/`. The published artifact is one concatenated
file, so sharing sources across scripts costs nothing at install time.

| File | Supplies |
|---|---|
| `../gravity/src/contours.js` | `buildFaces` (groups rings into outer-plus-holes by nesting depth), `signedArea` |
| `../gravity/src/flatten.js` | `flattenSegments` (cubics to polygon rings), `transformRing`, `invertMatrix`, `FLATTEN_TOL` |
| `../gravity/src/softmesh.js` | `distanceToRings(x, y, face)`, `pointInFace(x, y, face)`. Self-contained in `GR` terms: no planck, no earcut |
| `src/thickness.js` | Local thickness at an anchor. Pure geometry, no SDK |
| `src/inflate.js` | The displacement rules: anchors and handles in, anchors and handles out. Pure geometry, no SDK |
| `src/ui.js` | One slider |
| `src/main.js` | Reads the selection, calls the above, writes back. The only file touching the Affinity SDK |
| `build.js` | Concatenates the above into `dist/inflate.js` |

`inflate/build.js` must be able to resolve sources outside its own `src/`; `gravity/build.js`
resolves every entry against `ROOT/src`. The mechanism is left to implementation.

`enforceWinding` is deliberately not used. `buildFaces` classifies purely by nesting-depth parity and
never reads winding, so normalising the rings first buys nothing — and it returns new arrays, which
would break the identity mapping from a flattened ring back to the original curve that produced it.
`buildFaces` pushes the caller's own array references, so that mapping is recovered by identity.

`matrixOf` lives in `extract.js`, which touches the SDK; rather than pull it in, `main.js` reads
`node.baseToSpreadTransform.data` directly. That keeps `main.js` the only file touching the SDK.

`LINE_EPS` in `flatten.js` is module-local and not exported, so this script defines its own. It is
relative: a handle counts as collapsed when `|c1 − A| <= 1e-6 · |B − A|`. The SDK reference says a
straight segment stores `c1 ≈ start`, not `c1 == start`, so an absolute threshold would be a guess
against unverified data. The constant is unverified until probed against real curves.

Everything except `main.js` and `ui.js` runs headlessly, so the entire algorithm is testable without
Affinity.

## Pipeline

1. **Read.** `node.curvesInterface.polyCurve`, mapped through `baseToSpreadTransform`. Curve
   coordinates are BASE space; `node.transform` is the LOCAL matrix and is the wrong one.
2. **Classify.** Flatten a working copy of every ring, preserving vertex order, and run `buildFaces`
   to learn which rings are counters of which. Rings of fewer than three points are dropped by
   `buildFaces`; those curves take the zero-area path below. Compute one **sign** per ring.
3. **Measure.** Local thickness `t` at each original anchor.
4. **Displace.** Move anchors, recompute handles.
5. **Write.** Map every point back through `invertMatrix(baseToSpreadTransform)` — `createSetCurves`
   writes BASE space, not spread. Build one `CurveBuilder` per curve, collect **every curve of a
   node into a single `PolyCurve`**, and issue exactly one `createSetCurves` per node.
   `createSetCurves` replaces a node's geometry outright, so a shape with counters must rebuild all
   its rings in one command. Multiple nodes are combined with `CompoundCommandBuilder` for a single
   undo step. A closed curve is closed with `cb.close()`, never by repeating the first point —
   repeating it yields `isClosed false`, which draws closed but fills wrong, and `isClosed` is
   read-only. Where the transform is unreadable or singular, `invertMatrix` returns null and the
   points are written unchanged.

## Local thickness

**`t` is measured per SEGMENT, at the segment's midpoint, and an anchor takes the larger of its two
adjacent segments' values.** For a segment with midpoint `M` and inward normal `−m`, `t = 2r` where
`r` is the largest value satisfying

```
distanceToRings(M + r·(−m), face) >= r − tau ,   tau = 2·flattenTol + 1e-9·bboxDiagonal
```

found by bisection over `[0, halfBboxDiagonal]`. Each step is one `distanceToRings` call against the
segment's own face — its outer ring and its holes, and no ring of any other face, so the stem of an
"i" does not measure across the gap to its dot.

**Why the probe is not the anchor.** Because `M` lies on the boundary, `distanceToRings(M + r·(−m))`
can never exceed `r`, so the predicate is really an equality: it finds the largest disc *tangent to
the boundary at the probe point*. At a convex corner that disc has radius zero — the nearest boundary
point to any nearby interior point is not the corner itself. Probing at anchors would therefore
return `t = 0` at every corner of a polygon, and a square, whose only anchors are its corners, would
come back unchanged.

**Why `tau`.** The rings are flattened, and a chord of a convex boundary lies inside the true curve,
so the measured distance falls short of `r` by roughly `flattenTol·r/R` on a curve of radius `R`.
Without slack the predicate is false for every `r > 0` on any curved shape. `tau` does not
over-report: on a true circle of radius `R`, `r > R` gives a distance of `r − R`, so the search still
caps at `R + tau`.

**The bisection is well posed, with no second root.** If the disc of radius `r` about `M + r·(−m)`
is boundary-free, then for any `r' < r` the smaller disc is contained in it, so the satisfying set is
exactly `[0, r*]` — connected and monotone. This holds on concave shapes too, which is what makes
bisection legitimate rather than merely convenient.

Values this yields:

| Probe | `r` | `t` |
|---|---|---|
| Slab of width `w` | `w/2` | `w` |
| Square, edge midpoint | `w/2` | `w` |
| Square, corner anchor | — | `w`, as the max of its two edges |
| Disc of radius `R` | `R` | `2R` |
| Annulus of wall `w` | `w/2` | `w` |
| Mid-spike on a star point | local half-width | the local width, not the star's diameter |

`distanceToRings` is **unsigned**, so a probe that has escaped the material satisfies the predicate
just as readily as one inside it, and a flipped normal would yield a plausible `t` in silence. The
probe centre is therefore checked with `pointInFace`; a probe that lands outside fails the segment,
which is named in the console.

Where the search returns `r` below `1e-9 · bboxDiagonal` — a zero-area ring, a doubled-back path —
the segment contributes no thickness, and an anchor with no thickness on either side is left in place
and named.

## Ring sign

The edge normal `(ey, −ex)/|e|` points out of the enclosed region of a positively-wound ring and
into it for a negatively-wound one. So if outer rings are positive and holes negative, one formula
points away from the material everywhere: outward on an outer ring, into the void on a counter.

**The original curves are not rewound** — reversing them would reorder the output nodes, and node
order is what this feature preserves. Instead each ring carries a sign computed once:

```
sign = (buildFaces classified this ring as outer ? +1 : −1)
     × (signedArea(originalRing) >= 0 ? +1 : −1)
```

`signedArea` is taken in **spread space**, the same coordinates the normals are computed in. Under a
mirroring transform base and spread windings differ, and the rule is reflection-invariant only when
both come from the same space.

and every normal derived from that ring is multiplied by it. That is one shoelace per ring, not a
test per anchor. `enforceWinding` is used to normalise the flattened working copies for
classification only, never as the source of a normal.

This is the opposite convention to `gravity`'s `softPressurePass`, which flips per ring so that every
ring defends its own enclosed area and a squashed counter grows back. Inflation increases material
thickness everywhere instead. The mesh vocabulary is shared; the objective, and therefore the sign,
is not.

## Normals

For each anchor, let `n_in` and `n_out` be the unit normals of the adjacent segments' end tangents,
each taken as `(ey, −ex)/|e|` and multiplied by the ring sign. Then

```
n = normalize(n_in + n_out)
```

This is the bisector at a corner and degenerates to the perpendicular at a smooth node, with no
corner/smooth threshold to pick and no divergence between implementations.

- **Collapsed handles.** Affinity stores a straight segment as a cubic with its handles on the
  anchors. Deriving a tangent from `c1 − A` therefore returns a zero vector on every straight
  segment, which is the common case. Where `|c1 − A| < LINE_EPS`, the tangent is the chord `A→B`.
- **Cusps.** Where `|n_in + n_out| < 1e-4` — a doubled-back node, a zero-width spike — the bisector
  direction is numerically arbitrary while the displacement magnitude is not, so the anchor would
  shoot sideways. Such anchors are left in place and named in the console. The threshold is on unit
  vectors and so is scale-free.
- **`m`, the segment normal**, is `(ey, −ex)/|e|` for `e = B − A`, with the same ring sign. A
  zero-length segment gets `bow = 0`.

At a corner of interior angle `θ`, the bisector displacement contributes only `cos(θ/2)` of itself
perpendicular to each adjacent edge. Corners therefore sit slightly inside the offset its edges
would imply. This miter shortfall is accepted: it is part of the pinched-corner look.

## The two rules

For an anchor `P` with normal `n` and thickness `t`, and a segment `A→B` with handles `c1, c2`,
segment normal `m` and segment thickness `t_seg`:

```
P'  = P + n · amount · t/2

chord growth      s = |B − A| < LINE_EPS ? 1 : |B' − A'| / |B − A|
tangential term   h1 = collapsed(c1, A) ? amount·(B − A)/3 : (c1 − A)
                  h2 = collapsed(c2, B) ? amount·(A − B)/3 : (c2 − B)

cornerness        k_A = clamp(1 − dot(unit T_in(A), unit T_out(A)), 0, 1)
bow               b   = K · amount · min(|B − A|, t_seg) / 2

c1' = A' + h1·s + m · b · k_A
c2' = B' + h2·s + m · b · k_B
```

**Handles must carry a tangential term.** A straight segment's handles sit on its anchors, so a
translate-only rule leaves the outgoing tangent equal to the bow — normal to the edge. Every anchor
would become a 90° kink and a square would inflate into four bulges meeting at spikes. Substituting
`chord/3` for a collapsed handle gives the curve somewhere to leave from, and gating that
substitution by `amount` is what keeps `amount = 0` the identity.

**Scaling by `s`** preserves whatever curvature the user drew as the shape grows. Handles keep their
original direction rather than rotating with the chord; where the two ends have different `t` the
chord rotates and the handles do not follow it.

**Cornerness gates the bow per end.** `k` is 0 where the two adjacent tangents are parallel — a
smooth node — and 1 at a right angle. So the bow vanishes on an already-round shape, whose handles
merely scale, and applies at full strength at the corners of a polygon, which is where a bulge has
to come from. This also preserves tangent continuity: a bow applied at a smooth anchor would give
its two sides different tangents and put a visible break in a curve that had none.

**`amount = 0` is the identity.** Every term carries an `amount` factor and `s = 1`. Equality is to
within floating-point reassociation, not bit-exact, since `A + (c1 − A)` need not reproduce `c1`.

A useful number for calibrating `K`: the bow moves a segment's midpoint by `0.75·b`, since
`B(0.5) = (A + 3c1 + 3c2 + B)/8`.

## The amount parameter

**`Inflate %`, 0–100, default 30, with `amount = pct / 100`. 100% doubles the local thickness.**

A slab of width `w` has `t = w`, and both of its facing boundary points move out by `amount · t/2`,
so at 100% the slab is `2w` across. The definition is scale-free: the same percentage means the same
thing on a 20pt letter and a 2000pt shape.

It is exact where the boundary is locally parallel-sided — a slab, a disc. At a corner both adjacent
walls contribute, so the material there more than doubles.

## Document behaviour

- Modifies the selected shapes in place, as one undo step, matching `add_anchor_points`.
- Every selected shape is inflated independently and keeps its own node count.
- Anything failing `isPolyCurveNode` is skipped, and the console names it and why.
- **An open curve is copied through unchanged** and named. It encloses no material, so there is no
  thickness to measure and no inside to grow into; its `isClosed` flag is preserved.
- **A zero-area ring** — a single straight line, a doubled-back path, or any ring `buildFaces`
  dropped for having fewer than three points — is copied through unchanged and named. It has no sign
  and no interior. The test is `|signedArea| < 1e-9 · bboxDiagonal²`, since exact zero is unlikely in
  floating point.
- **A live shape** never reaches any of this: the `isPolyCurveNode` filter excludes it, and the
  console says to run Convert to Curves first.
- Re-running compounds. Undo is how an overshoot is dialled back.

### Dialog

One `Inflate %` slider and one line of help. The dialog does not scroll: once it outgrows the screen
the OK and Cancel buttons move off the bottom and it cannot be dismissed at all. Every control and
every full-width help paragraph is spent against that budget.

## Testing

Everything but `main.js` and `ui.js` is headless.

- **`amount = 0` is the identity**, within `1e-12 · bboxDiagonal`, for every input in the fixture set.
  This is a headless test and so cannot catch a missing inverse transform, which is exactly what would
  make `amount = 0` move a shape in the real application.
- **Winding independence.** The same ring wound CW and CCW produces identical output geometry, as a
  sequence **up to reversal** — the original curves are deliberately not rewound, so the two outputs
  differ in vertex order and in nothing else. This is the assertion that catches a sign taken from a
  ring's accidental winding.
- **A counter closes while its outer ring grows**, on the same face, in one call.
- **A slab doubles at 100%**, within `1e-5·w + tau`. This pins the amount definition; the tolerance is
  the bisection's precision plus the flattening slack, and cannot be tightened past them.
- **Corner thickness.** `t` at a square's corner anchor equals `t` at its edge midpoints. A measure
  probed at the anchor rather than the segment returns 0 here, and returning 0 means a square is
  never inflated at all.
- **Spike thickness.** `t` on a five-point star's spike is close to the local width there, not to the
  star's diameter. This is what fails for a single-ray measure.
- **Straight-segment tangent continuity.** The output tangent at an anchor is not perpendicular to the
  input edge — what fails for a translate-only handle rule.
- **Smooth-anchor tangent continuity.** At an anchor whose input tangents are parallel, the output
  tangents are too. This is what `cornerness` exists to guarantee, and without it a bow at a smooth
  anchor puts a visible break in a curve that had none.
- **A circle inflates to a circle**, exactly, to the bisection's precision. A circle's anchors are all
  smooth, so `cornerness` is 0, no bow is applied, and the handles scale by `s = 1 + amount` — which
  is exactly the handle length a circle of radius `R(1 + amount)` requires, since `k·R·(1 + amount) =
  k·R'` for `k = (4/3)(√2 − 1)`. Under a translate-only rule the handles instead fall short by
  `k · amount · R` and the result is a rounded square.
- **Scale invariance.** The same percentage on a 2× shape gives 2× displacement, with `flattenTol`
  scaled alongside. `FLATTEN_TOL` is an absolute 0.1 source units, so without scaling it a 2× shape
  flattens to a differently-shaped polygon and the equality does not hold.
- **Node count and closedness are preserved** for every input ring.
- **Enclosed area increases monotonically** across a sweep of amounts. A smoke test only — an offset
  passes it too, so it is not coverage of the pillow behaviour.

**No assertion may take its expected value from the same code path as the actual.** An assertion
comparing an output length against the array that produced it, or against a constant the
implementation also reads, tests nothing. Where an invariant is needed, prefer a transform that
changes what is not being measured while holding what is — winding independence and scale invariance
are both that kind of test.

## Known risks and unmeasured constants

- **`K`, and whether displacement should be linear in `t`, are unmeasured.** They are shape
  heuristics. A provisional `K = 0.5` is a starting point, not a result. `cornerness` is derived
  rather than tuned, so it carries no free parameter. The first
  real output is the calibration; nothing in this document is a prediction of how it looks.
- **`FLATTEN_TOL` is an absolute 0.1 source units**, inherited from `flatten.js`. It bounds the
  accuracy of `t` and dominates on small artwork. It may need to become relative to the shape's
  bounding box.
- **Self-intersection at high amounts.** A thin crescent or an "S" can swallow its own concavity.
  `ringCrossings` (`softmesh.js`) can detect it, but detection is deferred: until `t` and `K` are
  calibrated against real output, a crossing is more likely to be a symptom of those than a case
  worth reporting.
- **One cubic per segment may not follow a complex bulge.** A long edge across a shape of varying
  thickness has a profile a single cubic can only approximate. Accepted, to hold node count; the
  fallback, if it matters, is inserting anchors only where fit error exceeds a tolerance.

## Verification

Nothing here has run against the Affinity SDK. Verification is a real run on real artwork, returning
the exported SVG rather than a screenshot — rasterising destroys the curve geometry that is the
entire subject of this feature, and exported curves can be checked directly.

The first real run must include a node with a **non-identity transform**. A freshly drawn shape has
an identity `baseToSpreadTransform` and round-trips whether or not the inverse is applied, so a
missing inverse stays invisible until a moved or scaled node is involved — and then it looks like a
displacement bug rather than a transform bug. Check `amount = 0` on such a node first: it must
reproduce the artwork exactly.
