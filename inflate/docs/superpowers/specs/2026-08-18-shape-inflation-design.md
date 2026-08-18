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
| `../gravity/src/sanitize.js` | `enforceWinding`. Calls `GR.signedArea` from `contours.js` at run time, so concatenation order is free but both files are required |
| `../gravity/src/flatten.js` | `flattenSegments` (cubics to polygon rings), `transformRing`, `invertMatrix`, `matrixOf` |
| `../gravity/src/softmesh.js` | `distanceToRings(x, y, face)` — distance from a point to a face's rings. Self-contained in `GR` terms: no planck, no earcut |
| `src/thickness.js` | Local thickness at an anchor. Pure geometry, no SDK |
| `src/inflate.js` | The displacement rules: anchors and handles in, anchors and handles out. Pure geometry, no SDK |
| `src/ui.js` | One slider |
| `src/main.js` | Reads the selection, calls the above, writes back. The only file touching the Affinity SDK |
| `build.js` | Concatenates the above into `dist/inflate.js` |

`inflate/build.js` must be able to resolve sources outside its own `src/`; `gravity/build.js`
resolves every entry against `ROOT/src`. The mechanism is left to implementation.

Everything except `main.js` and `ui.js` runs headlessly, so the entire algorithm is testable without
Affinity.

## Pipeline

1. **Read.** `node.curvesInterface.polyCurve`, mapped through `baseToSpreadTransform`. Curve
   coordinates are BASE space; `node.transform` is the LOCAL matrix and is the wrong one.
2. **Classify.** Flatten a working copy of every ring, preserving vertex order, and run `buildFaces`
   to learn which rings are counters of which. Compute one **sign** per ring, below.
3. **Measure.** Local thickness `t` at each original anchor.
4. **Displace.** Move anchors, recompute handles.
5. **Write.** Map every point back through `invertMatrix(baseToSpreadTransform)` — `createSetCurves`
   writes BASE space, not spread. Build one `CurveBuilder` per curve, collect **every curve of a
   node into a single `PolyCurve`**, and issue exactly one `createSetCurves` per node.
   `createSetCurves` replaces a node's geometry outright, so a shape with counters must rebuild all
   its rings in one command. Multiple nodes are combined with `CompoundCommandBuilder` for a single
   undo step.

## Local thickness

**`t` at an anchor `P` is the diameter of the largest disc that fits inside the material and touches
the boundary at `P`.** Its centre lies along the inward normal, so `t = 2r` where `r` is the largest
value satisfying

```
distanceToRings(P + r·n_in, face) >= r
```

found by bisection on `r` over `[0, halfBboxDiagonal]`. Twenty iterations reach a relative precision
of about 1e-6, and each step is one `distanceToRings` call against the anchor's own face — its outer
ring and its holes, and no ring of any other face, so the stem of an "i" does not measure across the
gap to its dot.

This definition is well behaved where a single ray cast is not:

- **A slab of width `w`** gives `r = w/2`, so `t = w` exactly. This is what makes the amount
  parameter's definition exact rather than approximate.
- **A spike tip** — a star point, a leaf, the apex of an "A" — admits only a tiny disc, so `t → 0`
  and the tip barely moves. A ray along the inward normal would instead run down the spike's axis
  and return the length of the whole shape.
- **A square corner** gives `r = w/2`, the same as an edge midpoint, so corners and edges translate
  by the same amount and the pinch comes entirely from the bow. A normal-direction ray would return
  the diagonal, `1.41×` the wall, and corners would move *further* than edges — the pillow read
  inverted.

Distance from the anchor to the boundary is not the primitive: at an anchor, which is on the
boundary, it is 0. The distance is evaluated at the **disc centre**, not at `P`.

Where the bisection returns `r` below a floor of `1e-9 · bboxDiagonal` — a zero-area ring, a
doubled-back path — the anchor is left in place and named in the console.

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
- **Cusps.** Where `|n_in + n_out| < 1e-9` — a doubled-back node, a zero-width spike — `n` is
  genuinely undefined. The anchor is left in place and named in the console.
- **`m`, the segment normal**, is `(ey, −ex)/|e|` for `e = B − A`, with the same ring sign. A
  zero-length segment gets `bow = 0`.

At a corner of interior angle `θ`, the bisector displacement contributes only `cos(θ/2)` of itself
perpendicular to each adjacent edge. Corners therefore sit slightly inside the offset its edges
would imply. This miter shortfall is accepted: it is part of the pinched-corner look.

## The two rules

For an anchor `P` with normal `n` and thickness `t`, and a segment `A→B` with handles `c1, c2` and
segment normal `m`:

```
P'  = P + n · amount · t/2

chord growth      s = |B' − A'| / |B − A|
tangential term   h1 = (|c1 − A| < LINE_EPS) ? (B − A)/3 : (c1 − A)
                  h2 = (|c2 − B| < LINE_EPS) ? (A − B)/3 : (c2 − B)

c1' = A' + h1·s + m·bow
c2' = B' + h2·s + m·bow

bow = K · amount · min(|B − A|, (t_A + t_B)/2) / 2 · straightness
```

**Handles must carry a tangential term, not only translate.** A straight segment's handles sit on
its anchors, so a translate-only rule leaves the outgoing tangent equal to `m · bow` — normal to the
edge. Every anchor would become a 90° kink and a square would inflate into four bulges meeting at
spikes. Substituting `chord/3` for a collapsed handle is what gives the curve somewhere to leave
from.

**Scaling by `s`** preserves whatever curvature the user drew as the shape grows, rather than
flattening it.

**`straightness`** tapers the bow to zero on a segment that already bulges outward as much as the
bow would add, so that an already-round shape is not made lumpy. It is `1` for a segment with
collapsed handles and falls toward `0` as the segment's existing outward sagitta approaches
`min(|B − A|, t̄)/4`.

**`amount = 0` is the identity**, exactly: every term above carries an `amount` factor, and `s = 1`.
This makes the feature bisectable and is the first assertion to write.

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
- **A zero-area ring** — a single straight line, a doubled-back path — is copied through unchanged
  and named. `signedArea` is 0, so it has no sign and no interior.
- Re-running compounds. Undo is how an overshoot is dialled back.

### Dialog

One `Inflate %` slider and one line of help. The dialog does not scroll: once it outgrows the screen
the OK and Cancel buttons move off the bottom and it cannot be dismissed at all. Every control and
every full-width help paragraph is spent against that budget.

## Testing

Everything but `main.js` and `ui.js` is headless.

- **`amount = 0` is the identity**, to the last bit, for every input in the fixture set. Note this is
  a headless test and therefore cannot catch a missing inverse transform, which is what would make
  `amount = 0` move a shape in the real application.
- **Winding independence.** The same ring wound CW and CCW produces identical output geometry. This
  is the assertion that catches a sign derived from the original curve's accidental winding.
- **A counter closes while its outer ring grows**, on the same face, in one call.
- **A slab doubles at 100%.** Width `w` in, `2w` out, exactly — this pins the amount definition.
- **Spike thickness.** `t` at the tip of a five-point star is close to the local width there, not to
  the star's diameter. This is the assertion that fails for a single-ray thickness measure.
- **Straight-segment tangent continuity.** The output tangent at an anchor is not perpendicular to
  the input edge — the assertion that fails for a translate-only handle rule.
- **Scale invariance.** The same percentage on a 2× shape gives 2× displacement, with `flattenTol`
  scaled alongside. `FLATTEN_TOL` is an absolute 0.1 source units, so without scaling it a 2× shape
  flattens to a differently-shaped polygon and the equality does not hold exactly.
- **A circle inflates to a circle**, within a stated tolerance: sampled at 32 parameters, the output
  stays within `ε` of radius `R(1 + amount)`. A circle is four cubic arcs, so this requires the
  handle rule to scale its tangential term; under a translate-only rule the handles fall short by
  `k · amount · R` with `k = (4/3)(√2 − 1)` and the result is a rounded square. `ε` is bounded by the
  residual bow that `straightness` does not fully suppress, so it is a function of `K`.
- **Node count and closedness are preserved** for every input ring.
- **Enclosed area increases monotonically** across a sweep of amounts. A smoke test only — an offset
  passes it too, so it is not coverage of the pillow behaviour.

**No assertion may take its expected value from the same code path as the actual.** An assertion
comparing an output length against the array that produced it, or against a constant the
implementation also reads, tests nothing. Where an invariant is needed, prefer a transform that
changes what is not being measured while holding what is — winding independence and scale invariance
are both that kind of test.

## Known risks and unmeasured constants

- **`K`, `straightness`'s taper, and whether displacement should be linear in `t` are unmeasured.**
  They are shape heuristics. A provisional `K = 0.5` is a starting point, not a result. The first
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
