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
number. A shape goes in, a shape comes out, in milliseconds.

`gravity` also demonstrates the trap this design is built to avoid. Its softbodies flatten every
curve to a polyline (`flatten.js`) so the physics can step them, and write the result back with
`lineToXY` (`playback.js:190`) — so a smooth input returns faceted, and no amount of mesh resolution
fixes it, because the curve stopped existing before the mesh was built. Inflation never flattens the
output. The flattened ring is used only to *measure*; the thing written back is the original
Béziers with moved anchors and recomputed handles.

## Non-goals

- **Animation.** The result is a static shape, not a sequence.
- **Adding nodes.** Node count out equals node count in. A shape whose bulge a single cubic per
  segment cannot follow is a known limitation, recorded below, not a case to subdivide for.
- **3D shading, bevels or highlights.** This changes the outline only.
- **Self-intersection repair.** Detected and reported; not fixed.

## Architecture

A standalone script, `inflate/`, sibling to `gravity/`. The published artifact is one concatenated
file, so sharing sources across scripts costs nothing at install time.

| File | Responsibility |
|---|---|
| `../gravity/src/flatten.js` | Cubic Béziers to polygon rings. Reused unchanged. |
| `../gravity/src/contours.js` | `buildFaces` — groups rings into outer-plus-holes by nesting depth. Reused unchanged. |
| `../gravity/src/sanitize.js` | `enforceWinding` — outer positive, holes negative. Reused unchanged. |
| `src/thickness.js` | Local thickness at a point, by inward ray cast. Pure geometry, no SDK. |
| `src/inflate.js` | The displacement rules. Takes segments plus thicknesses, returns moved anchors and handles. Pure geometry, no SDK. |
| `src/ui.js` | One slider. |
| `src/main.js` | Reads the selection, calls the above, writes back. The only file that touches the Affinity SDK. |
| `build.js` | Concatenates the above into `dist/inflate.js`. |

`gravity/build.js` resolves every source against its own `src/`. `inflate/build.js` needs per-file
roots so its `SRC` list can name files in `../gravity/src/`. That is the only change to the build
pattern.

The split matters for testing: everything except `main.js` and `ui.js` runs headlessly, so the
entire algorithm is testable without Affinity.

## Pipeline

1. **Read.** `node.curvesInterface.polyCurve`, mapped through `baseToSpreadTransform`. Curve
   coordinates are BASE space; `node.transform` is the LOCAL matrix and is the wrong one.
2. **Classify.** Flatten a working copy of every ring, run `buildFaces` to find which rings are
   counters of which, then `enforceWinding` so outer rings are positive and holes negative.
3. **Measure.** For each original anchor, the local thickness `t` — see below.
4. **Displace.** Move anchors, recompute handles.
5. **Write.** `CurveBuilder.begin` / `addBezier` / `close` per curve, then
   `DocumentCommand.createSetCurves`. This round-trip is already proven in `add_anchor_points`.

## Local thickness

At an anchor `P` with inward normal `-n`, cast a ray along `-n` and take the distance to the first
ring intersection. That distance is `t`, the room across the material at `P`.

The ray must ignore the two segments meeting at `P`, or it reports 0 immediately. Excluding those
two by index is exact and needs no epsilon.

A ray that escapes without hitting anything means the point is on a ring that does not enclose
material in that direction — a degenerate or self-intersecting input. Those anchors take the median
`t` of the ring, so a bad input deforms plausibly instead of throwing.

Distance to the nearest boundary is the wrong primitive here. At an anchor, which is itself on the
boundary, it is 0 everywhere.

## The two rules

For an anchor `P` with outward normal `n` and thickness `t`, and a segment `A→B` with anchors
`A, B`, handles `c1, c2`, and segment normal `m`:

```
P'  = P  + n · amount · t/2

c1' = c1 + n_A · amount · t_A/2  +  m · bow
c2' = c2 + n_B · amount · t_B/2  +  m · bow

bow = K · amount · min(|B−A|, (t_A + t_B)/2) / 2
```

Handles translate with their own anchor first, which preserves whatever curvature the user drew, and
the bow is added on top. A straight segment stays straight at `amount = 0` and bows at every value
above it.

**`n` is the bisector at a corner and the perpendicular to the tangent at a smooth node.** Corners
therefore only translate, while the edges between them bow — which is the whole of the pillow read.

### Winding does the hole logic for free

With `enforceWinding` applied, the edge normal `(ey, −ex)/len` points **away from the material** on
every ring, with no per-ring sign test:

- On an outer ring (positive area) it points out of the enclosed region, which is out of the material.
- On a hole (negative area) it points into the enclosed region, which is into the void.

So one formula grows the outside and closes the counters. This is the opposite convention to
`gravity`'s `softPressurePass`, which flips the sign per ring so that every ring defends its own
enclosed area and a counter grows back. The two are not in conflict: `gravity` preserves each ring's
area, inflation increases material thickness everywhere. Naming the difference here because the
mesh vocabulary is shared and the sign is not.

## The amount parameter

**`Inflate %`, 0–100, default 30. 100% doubles the local thickness.**

A bar of width `w` has `t = w`, and both of its facing boundary points move out by `amount · t/2`, so
at 100% the bar is `2w` across. The definition is scale-free: the same percentage means the same
thing on a 20pt letter and a 2000pt shape, which is what lets one slider position be meaningful
across a document.

## Document behaviour

- Modifies the selected shapes in place, as one undo step. This matches `add_anchor_points`.
- Every selected shape is inflated independently; each keeps its own node count.
- Anything failing `isPolyCurveNode` is skipped, and the console names it and why.
- Re-running compounds. Undo is how an overshoot is dialled back.

### Dialog

One `Inflate %` slider and one line of help. The dialog does not scroll: once it outgrows the screen
the OK and Cancel buttons move off the bottom and it cannot be dismissed at all. Every control and
every full-width help paragraph is spent against that budget.

## Testing

Everything but `main.js` and `ui.js` is headless. Assertions, each chosen so that a wrong
implementation fails it:

- **A circle inflates to a circle.** Every anchor moves the same distance; the radius grows by the
  predicted amount.
- **Scale invariance.** The same percentage on a 2× shape gives exactly 2× displacement. This is
  what makes the slider mean one thing on all artwork, and it is the assertion an implementation
  that hard-codes a distance cannot pass.
- **A square's corners and edges move differently.** Corner displacement along the bisector, edge
  midpoint displacement larger. Equal values mean the bow is not being applied and the result is an
  offset, not a pillow.
- **A counter closes while its outer ring grows**, on the same face, in one call. The sign
  convention is the single most likely thing to be silently inverted.
- **Enclosed area increases monotonically** across a sweep of amounts.
- **Node count and closedness are preserved** for every input ring.
- **`amount = 0` is the identity**, to the last bit, so the feature is bisectable.

**No assertion may take its expected value from the same code path as the actual.** An assertion
comparing an output length against the array that produced it, or against a constant the
implementation also reads, tests nothing. Where an invariant is needed, prefer a transform that
changes what is not being measured while holding what is — scale invariance above is that test here.

## Known risks

- **`K`, and whether displacement should be linear in `t`, are unmeasured.** They are shape
  heuristics. The first real output is the calibration; nothing in this document should be read as
  a prediction of how it looks.
- **Self-intersection at high amounts.** A thin crescent or an "S" can swallow its own concavity.
  `ringCrossings` detects it. The first version reports the count and leaves the geometry alone;
  whether to clamp the amount or warn is a decision for real output, not for this document.
- **One cubic per segment may not follow a complex bulge.** A long straight edge across a shape of
  varying thickness has a bulge profile a single cubic can only approximate. Accepted, to hold node
  count; the fallback, if it matters, is inserting anchors only where fit error exceeds a tolerance.

## Verification

Nothing here has run against the Affinity SDK. Verification is a real run on real artwork, returning
the exported SVG rather than a screenshot — rasterising destroys the curve geometry that is the
entire subject of this feature, and the exported curves can be checked directly.
