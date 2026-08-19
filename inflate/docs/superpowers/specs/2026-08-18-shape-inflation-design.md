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
no convergence criterion: every output point is a closed-form function of the input geometry and two
numbers.

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
- **Self-intersection repair.** Not repaired. The guards below keep real artwork clear of it at
  100%, and `ringCrossings` can detect what remains; see Known risks.

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
| `src/ui.js` | Two sliders |
| `src/main.js` | Reads the selection, calls the above, writes back. The only file touching the Affinity SDK |
| `build.js` | Concatenates the above into `dist/inflate.js` |

`inflate/build.js` resolves entries against the inflate root rather than against `ROOT/src`, so a
sibling script's sources can be named directly. `test/harness.js` does the same. Runtime geometry is
reused **by reference**, where drift is dangerous because behaviour must match and a stale copy fails
silently; the build and test harness are **copied**, where drift is harmless because the two scripts
legitimately differ.

`build.js` guards both directions. `read()` catches a file named in `SRC` but absent from disk;
`checkSrcComplete()` catches the opposite, which is the one that fails quietly — a `src` file that
exists and was never added to `SRC` ships nothing, and `--check` still passes, because `--check`
compares `dist` only against what `SRC` named.

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

**`t` is measured per SEGMENT, probed at the segment's curve midpoint.** For a segment with

```
M     = B(0.5)  = (A + 3c1 + 3c2 + B) / 8
m     = the unit normal of B'(0.5) = (3/4)(B + c2 - c1 - A), times the ring sign
```

**The flatten tolerance is RELATIVE**, `5e-4` of the face's bounding-box diagonal, not the absolute
`FLATTEN_TOL` of `flatten.js`. `tau` is built from it and `tau` bounds the accuracy of `t`, so an
absolute tolerance makes the error scale-dependent: a slab measured at 0.005× comes out at −600% and
an annulus at −767%, against an identical 1.0% at every scale for a relative one.

`probeCtx` therefore **requires** the tolerance the rings were actually flattened at, and `classify`
returns it. It cannot be defaulted: `classify` picks one tolerance for the whole selection from the
hull of every curve, while a face knows only its own box, and on a letter "i" those differ by 5×.
A `tau` computed from the dot's own box is too small to cover chords flattened at the stem's scale,
and the dot then measures 31.0 against a true 50 — a plausible number rather than a zero, so it
would ship as "the dots look under-inflated" rather than as a failure.

`t = 2r`, where `r` is the largest value satisfying

```
distanceToRings(M + r·(-m), face) >= r - tau ,   tau = 2·flattenTol + 1e-9·faceBboxDiagonal
```

found by bisection over `[0, halfFaceBboxDiagonal]`. `distanceToRings` is evaluated against the
segment's own face — its outer ring and its holes, and no ring of any other face, so the stem of an
"i" does not measure across the gap to its dot. `bboxDiagonal` is the face's, not the selection's.

`M` is the curve midpoint, never the chord midpoint. On a straight segment the two coincide, but on
a quarter-arc of a disc of radius `R` the chord midpoint sits `R(1 - cos 45°) = 0.293R` inside the
material, and the probe returns `t = 1.71R` instead of `2R` — so a disc would grow to `1.86R` at
100% rather than doubling. The probe direction comes from the curve tangent for the same reason: on
an asymmetric segment the chord normal is not the surface normal.

**Why the probe is not an anchor.** Because `M` lies on the boundary, `distanceToRings(M + r·(-m))`
can never exceed `r`, so the predicate is really an equality: it finds the largest disc *tangent to
the boundary at the probe point*. At a convex corner that disc has radius zero — the nearest boundary
point to a nearby interior point is not the corner itself. Probing at anchors therefore returns `t`
near zero at every corner of a polygon, and a square, whose only anchors are its corners, would come
back unchanged.

**An anchor takes its own probe where that probe is well posed, and the larger of its two adjacent
segments where it is not.** The degeneracy above is a property of convex corners only; at a smooth
anchor the anchor probe is perfectly well behaved and is the more accurate measure. On a rounded
rectangle 300x100 with corner radius 20, the anchors joining arc to side measure 40 by their own
probe, against 100 for the adjacent long side — taking the larger would over-report by 2.5x at
exactly the anchors where nothing was wrong. No fixed combining rule over the two segments works:
at a reflex junction, such as a disc meeting a narrow stem, the larger value is the right one and
the smaller would crease the notch away from the disc it belongs to.

**An anchor probe is corner-limited when `2·r·(1 − sin(θ/2)) >= tau`.** No fixed floor works. A
CONVEX corner of interior angle `θ` caps its own bisector probe at `tau/(1 − sin(θ/2))` — 3.41·tau at
90°, 5.24 at 108°, 7.46 at 120° — so a floor that is right at one angle is wrong at every other. A
floor of `4·tau` accepts everything blunter than about 97°, and a pentagon then inflates by 1.05
units where it should inflate by 80.

Rearranged, a purely corner-limited probe satisfies `2·r·(1 − sin(θ/2)) == 2·tau` *exactly, at every
angle*, while a probe stopped by real material across the shape comes in under that. The test
therefore discriminates by a factor of two and needs no angle threshold at all. `|n_in + n_out| / 2`
**is** `sin(θ/2)`, and the bisector already computes it, so this costs nothing. At a smooth anchor
`θ = 180°`, the left side is zero and the anchor's own probe always wins — which is what is wanted
there.

**One expression, two rules.** `sin` is not injective over a full turn, so a reflex angle and its
convex complement share a `sinHalf`: a star's 249.6° notch and a 110.4° corner both give 0.8208. A
reflex vertex is therefore rejected too. That is wanted, but for the separate reason given above —
the larger neighbour is the thickness that belongs to the anchor — and not because its probe is
bad. At a 270° L-corner the own probe measures a perfectly real 28.92 and is rejected anyway. The
flag is named for the decision it makes, not for a defect in the probe.

Convex and reflex are told apart by the cross product of the travel-direction tangents, folded with
the ring sign so it means the same on a counter as on an outer ring; `sinHalf` alone cannot.

Where only one adjacent tangent exists — a duplicated anchor, common in traced paths — there is no
bisector and no angle, and `sinHalf` is reported as null rather than as a fabricated 0.5.

**The bisection is well posed, with no second root, for any `tau`.** `dist(C(r))` is 1-Lipschitz in
`r` and `|dC/dr| = 1`, so `dist(C(r)) - r` is non-increasing; the satisfying set is therefore exactly
`[0, r*]`. This holds on concave shapes too, which is what makes bisection legitimate rather than
merely convenient.

**`tau` is load-bearing, not slack.** With `tau = 0` every curved probe returns ~0 — a disc of
radius 100 measures 0.002. The reason is not that the probe point is off the ring: `flatten.js`
subdivides at `t = 0.5`, so `B(0.5)` **is** a flattening vertex and its own distance to the ring is
exactly zero. The deficit lives in the neighbouring chords, which cut inside the true arc, so a
"measure the local deficit at the probe point" variant cannot work.

**What `tau` costs.** It inflates the probe RADIUS by `tau/(1 − cos θ)`, where `θ` is the angle
between the binding wall and the probe path; `t = 2r`, so the error in `t` is double that. Head-on
the radius error is `tau/2` and the `t` error is exactly `tau` — measured on a slab and on an
annulus wall, and 0.858·tau on a disc where the flattening deficit partly cancels it. Across a
convex corner it is not head-on: on a 300×100 rounded rectangle the probe centre passes the corner
arc's own centre and the binding walls become the top and right edges, symmetric at 45° to the probe
path, giving 3.41·tau of radius error and so 6.8·tau on `t`.

Values this yields, measured:

| Probe | `t` |
|---|---|
| Slab of width `w` | `w` |
| Square, edge midpoint | `w` |
| Square, corner anchor | `w`, via the fallback |
| Rounded rect, side midpoint / arc anchor | `100` / `40` |
| Disc of radius `R` | `2R` |
| Annulus of wall `w` | `w` |
| Mid-spike on a star point | the local width, not the star's diameter |

`distanceToRings` is **unsigned**, so a probe that has escaped the material satisfies the predicate
as readily as one inside it, and a flipped normal would yield a plausible `t` in silence. The probe
centre is therefore checked with `pointInFace`; a probe that lands outside fails its segment, which
is named in the console.

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
test per anchor.

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

For an anchor `P` with normal `n` and thickness `t`, and a segment `A->B` with handles `c1, c2`,
curve midpoint `M`, midpoint normal `n_M` and thickness `t_seg`:

```
P'   = P + n · amount · t/2

s    = |B - A| < LINE_EPS ? 1 : |B' - A'| / |B - A|
h1   = collapsed(c1, A) ? amount·(B - A)/3 : (c1 - A)
h2   = collapsed(c2, B) ? amount·(A - B)/3 : (c2 - B)

M'      = M + n_M · amount · t_seg/2                 where the midpoint should land
M_naive = (A' + 3(A' + h1·s) + 3(B' + h2·s) + B') / 8    where it lands without a bow
b       = dot(M' - M_naive, n_M) / 0.75

c1' = A' + h1·s + n_M · b
c2' = B' + h2·s + n_M · b
```

**Handles must carry a tangential term.** A straight segment's handles sit on its anchors, so a
translate-only rule leaves the outgoing tangent equal to the bow — normal to the edge. Every anchor
would become a 90 degree kink and a square would inflate into four bulges meeting at spikes.
Substituting `chord/3` for a collapsed handle gives the curve somewhere to leave from, and gating
that substitution by `amount` is what keeps `amount = 0` the identity.

**Scaling by `s`** preserves whatever curvature the user drew as the shape grows. Handles keep their
original direction rather than rotating with the chord; where the two ends have different `t` the
chord rotates and the handles do not follow it.

**The bow is derived, not tuned.** It is exactly the residual between where the pillow surface puts
the segment's midpoint and where the translated, scaled handles already put it, divided by `0.75`
because that is the midpoint's sensitivity to a symmetric handle offset — `B(0.5) = (A + 3c1 + 3c2 +
B)/8`. There is no gain constant to calibrate. The consequences fall out rather than being asserted:

- **A circle needs no bow.** Its handles scaled by `s = 1 + amount` already land the midpoint on the
  grown circle, so `M_naive = M'` and `b = 0`. The circle stays exactly a circle.
- **A rounded rectangle's flat sides bulge.** Their anchors move by the corner arcs' thickness while
  the side's own midpoint target is the full half-width, so `b` is large and positive — the case an
  anchor-smoothness gate gets wrong, because a straight side between two smooth anchors is precisely
  where a bulge is needed.
- **A square's edges bulge by the miter shortfall**, `amount·w/2·(1 - cos 45°)`, which is what its
  corners moving along their bisectors leaves uncovered.
- **A segment already on target gets nothing.**

**Tangent continuity at a smooth anchor is restored by a post-pass.** A bow points along its own
segment's normal, so at an anchor shared by two bowed segments the two handles pick up different
directions and a curve that was smooth acquires a visible break. After all handles are computed,
every anchor whose *input* tangents were parallel has its two output handles re-collinearised:
their directions are replaced by the normalised sum of the two, lengths unchanged. This preserves
node count and continuity at the cost of a small midpoint error, and it runs only where the input
was smooth.

**Tangent direction convention.** Both tangents are taken in the direction of travel:
`T_in(A) = A - c2_prev` and `T_out(A) = c1 - A`, each falling back to the chord where the handle is
collapsed. Affinity stores the incoming handle as `c2`, and `c2 - A` points backward — using it
directly makes every smooth node look like a cusp, and the failure shows up as a bow artefact rather
than a sign error.

**`amount = 0` is the identity.** Every term carries an `amount` factor, `s = 1`, and `M_naive = M`
so `b = 0`. Equality is to within floating-point reassociation, not bit-exact, since `A + (c1 - A)`
need not reproduce `c1`.

## The amount parameter

**`Inflate %`, 0–100, default 30, with `amount = pct / 100`. 100% doubles the local thickness.**

A slab of width `w` has `t = w`, and both of its facing boundary points move out by `amount · t/2`,
so at 100% the slab is `2w` across. The definition is scale-free: the same percentage means the same
thing on a 20pt letter and a 2000pt shape.

It is exact where the boundary is locally parallel-sided — a slab, a disc. **At a corner the shape
grows LESS**, and that is the pinched-corner look rather than a shortfall to be corrected: a bisector
move delivers only `sin(θ/2)` of itself perpendicular to its two edges, so on a 100 square at 100%
the flat side's midpoint gains 50.07 while the corner gains 35.41 — short by 14.67, which is this
document's own miter shortfall, `amount·w/2·(1 − cos 45°)`.

The shortfall grows as the corner sharpens, and past about 80° the edges swell past the corner and
the outline goes out-in-out — a re-entrant dip that draws as a spike. Convex corners are therefore
compensated toward keeping pace, with 90° as the reference so the square above is untouched, and
bounded because full compensation is exactly a miter join and miters blow out without limit as the
angle closes.

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

Two sliders and one line of help. The dialog does not scroll: once it outgrows the screen the OK and
Cancel buttons move off the bottom and it cannot be dismissed at all. Every control and every
full-width help paragraph is spent against that budget.

`Inflate %`, 0–100, default 30, as above.

`Round corners %`, 0–200, default 90, as a fraction of the pillow's depth at that corner. **How
round a corner should be is taste rather than geometry**, so it is the one guard the user sets. 0
turns it off and leaves the pinched point. The range runs past 100 because the radius is a fraction
of a depth rather than of anything bounded, and a corner can legitimately be rounded harder than the
shape puffed.

The sharpness gate is deliberately not exposed. It sits at 85°, below the square whose pinched
corner this design asks for, so a control that could cross it would let the dialog contradict the
amount parameter's own definition.

Help text is `grp.addStaticText(label, text)` on the group, chained with `.setIsFullWidth(true)`;
there is no `addText`. `dlg.runModal()` is compared through `.value`, because some builds return a
result that is not the enum member itself, and there a direct comparison reads every OK as a Cancel
— the dialog closes, nothing happens, and no error explains it.

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
- **Corner thickness.** `t` at a square's corner anchor equals `t` at its edge midpoints, within
  `tau`. A measure probed only at the anchor returns near zero here, and near zero means a square is
  never inflated at all.
- **Smooth-anchor thickness.** On a rounded rectangle, an anchor joining a corner arc to a flat side
  measures the arc's thickness, not the side's. Taking the larger of the two adjacent segments
  over-reports by 2.5x here.
- **A disc doubles at 100%.** Radius `R` in, `2R` out. This is what fails when the thickness probe
  uses the chord midpoint instead of the curve midpoint — the disc grows to `1.86R` and the circle
  assertion below still passes, because a uniform wrong `t` still yields an exact circle.
- **A rounded rectangle bulges.** Its flat sides are not straight in the output. This is what fails
  when the bow is gated on anchor smoothness, which turns the whole operation into an offset.
- **Spike thickness.** `t` on a five-point star's spike is close to the local width there, not to the
  star's diameter. This is what fails for a single-ray measure.
- **Straight-segment tangent continuity.** The output tangent at an anchor is not perpendicular to the
  input edge — what fails for a translate-only handle rule.
- **Smooth-anchor tangent continuity.** At an anchor whose input tangents are parallel, the output
  tangents are too. A bow points along its own segment's normal, so without the re-collinearising
  post-pass a smooth curve acquires a break at every anchor.
- **A circle inflates to a circle**, asserted RELATIVE and against its own input. A circle drawn as
  four cubics is itself `2.7e-4` off a true circle, so at `R = 200` its radii already spread by
  0.0546 before anything is inflated, and an absolute tolerance here would be a number tuned to
  whatever the code emits. The property that holds, and that fails under a translate-only handle
  rule, is that the output is no less round than its input. Its handles scale by
  `s = 1 + amount`, which is exactly the handle length a circle of radius `R(1 + amount)` requires
  since `k·R·(1 + amount) = k·R'` for `k = (4/3)(sqrt2 - 1)`, so the midpoint is already on target and
  `b = 0`. Under a translate-only rule the handles instead fall short by `k · amount · R` and the
  result is a rounded square.
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

- **Whether displacement should be linear in `t` is unmeasured.** It is the one shape heuristic
  left; the bow is derived from it rather than tuned alongside it, so there is no second parameter to
  trade against. The first real output is the calibration.
- **The re-collinearising post-pass trades midpoint accuracy for continuity.** On a 300×100 rounded
  rectangle at `amount = 0.5`, against an intended displacement of 25, the flat side's midpoint lands
  7.65 off target and the corner arc's 4.26. A square never shows it: its corners are not smooth, so
  the pass skips them and its midpoint lands exactly. The error is bounded by a regression assertion;
  whether it reads as a defect is a judgement, and the candidate change if it ever does is applying
  the bow *after* collinearising rather than before.
- **`LINE_EPS`**, the collapsed-handle threshold, is relative but its value is not set from real
  curve data. The SDK reference says a straight segment stores `c1 ≈ start`, not `c1 == start`;
  logging `|c1 − A| / |B − A|` over a drawn rectangle would settle it.
- **Self-intersection at high amounts.** A thin crescent or an "S" can swallow its own concavity.
  `ringCrossings` (`softmesh.js`) can detect it. The guards keep real artwork — letters with
  counters, a star with a round hole — clear of self-intersection at 100%, so detection has not been
  needed in the pipeline; a sufficiently thin crescent at a high amount remains the open case.
- **One cubic per segment may not follow a complex bulge.** A long edge across a shape of varying
  thickness has a profile a single cubic can only approximate. Accepted, to hold node count; the
  fallback, if it matters, is inserting anchors only where fit error exceeds a tolerance.

## Guards

The rules above scale by the **material thickness**, and nothing in them relates that to the size of
the **feature** they are applied to. Those diverge wherever a small step adjoins thick material,
which is most of what a letterform is. Each guard is inert where nothing is degenerating, and names
what it held back in the console.

Every one of them scales the segment's **midpoint target** as well as its anchors. The bow
re-derives from `t` to land the midpoint on the pillow surface *wherever the anchors ended up*, so a
cap applied to anchors alone is simply absorbed: capping a ring's anchors without its bow took a
counter to 1% of its area, worse than not capping at all.

- **No chord below half its original length.** Solved per segment as the largest uniform scale on
  both its anchors' displacements, each anchor taking the minimum over its two segments. Without it,
  a capital R's 22.4-long notch under the bowl closes to 5.8 at 30%, because the stem beside it
  measures 89.6 and both anchors move 13.4 toward each other.
- **No handle longer than its chord.** A cubic whose handle outruns its chord loops rather than
  bulges. This fires where the chord never collapsed at all, so the floor above does not cover it.
- **No ring closing past its own width**, capped at a fraction of its own inradius. A counter closes
  by `amount·t/2` where `t` is the wall *around* it, which says nothing about the size of the hole:
  a capital A's counter has an inradius of 33.9 against a wall of 90, so at 100% it is asked to
  close by 45 and vanishes outright at 75%. Node count is preserved, so it cannot simply be dropped.
  Only a closing ring can run out of room, so the area says which rings these are and no
  counter/outer test is needed.
- **Sharp convex corners are rounded**, by the amount the user sets. Nothing else here can round a
  corner: this design moves anchors and recomputes handles but never adds a node, so a corner anchor
  stays a corner and its output tangent break comes out at `180° − the input angle`. A capital A's
  apex reads round not because anything rounded it but because 110° is already blunt.

  Rounding reuses the collinearising post-pass, but **shortens the handles at that anchor to the
  pillow's depth there first**. Handle length is what sets the rounding radius, and rotating a
  handle of 136 without shortening it sweeps the letterform away — a 40-wide slab comes out 117
  across instead of 80. Reflex vertices are excluded: rounding a notch fills it in.

## Verification

Nothing here has run against the Affinity SDK. Verification is a real run on real artwork, returning
the exported SVG rather than a screenshot — rasterising destroys the curve geometry that is the
entire subject of this feature, and exported curves can be checked directly.

The first real run must include a node with a **non-identity transform**. A freshly drawn shape has
an identity `baseToSpreadTransform` and round-trips whether or not the inverse is applied, so a
missing inverse stays invisible until a moved or scaled node is involved — and then it looks like a
displacement bug rather than a transform bug. Check `amount = 0` on such a node first: it must
reproduce the artwork exactly.
