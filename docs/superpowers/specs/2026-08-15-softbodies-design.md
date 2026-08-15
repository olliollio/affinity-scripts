# Softbodies in Gravity — design

A closed path marked soft becomes **jelly**: it slumps under its own weight, squashes on impact and
keeps the deformed shape. The letterform is a suggestion, not a constraint. This is the softest end
of the range deliberately — shape-matching restoration forces are the expensive part of a real soft
body engine, and slumping is the goal, so plain distance springs suffice.

## planck has no soft bodies, and this is built from rigid parts

planck 1.5.0 is a Box2D 2.x port: rigid bodies, fixtures, and eleven joint types. Nothing in it
deforms. `b2ParticleSystem` — what is usually meant by "Box2D soft bodies" — belongs to LiquidFun,
a separate fork, and was never ported. planck's `RopeJoint` is a maximum-distance constraint and
not Box2D's `b2Rope` solver.

So a softbody is not a kind of body. It is a **rig**: many ordinary dynamic bodies wired together
with springs so that they behave as one deformable thing. Gravity already does this in one
dimension — `addRope` builds N box bodies and N-1 revolute joints and calls the result a rope. A
softbody is that idea in two dimensions, and it reuses more of the rope machinery than it replaces:
even resampling, drawn-resolution decoupled from solver resolution, `createSetCurves` write-back,
the base/spread inverse matrix, and per-node damping to kill the settling tail.

The one thing that does not carry over from 1D: a chain needs no interior, a sheet does. Springs
along a shape's outline alone let it collapse flat, because a polygon's perimeter is unchanged by
squashing it. Interior structure is mandatory.

## Declaring a softbody

`SOFT_WORDS = ['soft', 'jelly', 'squish']`, whole-word matched, following `STATIC_WORDS` in
`extract.js` and `ANCHOR_WORDS` in `rope.js`. Static beats soft, because locking or naming
something scenery is an explicit act that must not be overridden.

Rope and soft are resolved by **branch order — static, rope, soft, rigid — and not by assuming they
are exclusive.** `isSoft` keys off the name alone, and `makeResult` is called on the rope path too,
so an open path named "jelly" carries both flags. Rope is tested first, so it stays a rope: an open
path has no interior to mesh, and the naming is the user asking for something the geometry cannot
give.

`extract.js` sets `obj.isSoft` in **`makeResult`**, not beside `rr.anchored` — `anchored` is set in
the rope branch, which is only reached when a node has no closed rings, and soft requires closed
rings. `main.js` gains a fourth branch in its object loop — static, rope, soft, rigid.

`isStaticName` and `isAnchoredName` are already the same whole-word scan written twice. A third
copy is where that becomes a cost, so they collapse into one `hasWord(name, words)` helper, tested
once. Both existing names stay exported from `GR`: `test_extract.js` and `test_rope.js` cover them,
and the refactor must not be visible to those tests.

## The mesh

`src/softmesh.js` is pure and headlessly testable, like `decompose.js`. It takes the existing
`{outer, holes}` face — already flattened, already in spread coordinates — and returns nodes and
springs.

A square grid is laid over the shape at spacing `cell`. Interior points are kept where they fall
inside the outer ring and outside every hole, with clearance so they cannot coincide with boundary
points. Boundary points come from resampling each ring — outer and holes alike — at roughly the
same spacing. Springs run along both grid axes **and both diagonals**; a grid without its diagonals
is a mechanism, not a structure, and shears flat under its own weight.

**Boundary nodes are not on the grid, so their connectivity is the one part that is not
arithmetic.** They come from resampling a ring and can land anywhere. Each boundary node is
therefore sprung to three things: its two neighbours along the ring, every interior node within
`1.5 * cell`, and — where a ring passes close to itself — nothing else, so no special case is
needed for thin necks. The radius is generous deliberately: a boundary node that catches no
interior node is a node hanging off the structure by two ring springs, which is a chain, and the
ring becomes a rope draped on a lattice rather than the edge of a sheet.

Interior points are kept only where they clear every ring by `INTERIOR_CLEAR` (half a cell), which
is what makes `ATTACH_RADIUS` of 1.5 cells the right reach: a boundary node inset by `0.6 * cell`
sits at most about `1.1 * cell` from the nearest admissible interior point.

**This is the step most likely to be built wrong, because every other mesh assertion passes on a
disconnected mesh.** The mesh tests must include a connectivity check — every node reachable from
every other through springs, one component, no orphans. Connectivity alone is not sufficient,
though: ring springs hold an under-attached boundary in one component while it behaves as a rope
draped on a lattice, which is the failure `ATTACH_RADIUS` exists to prevent and the one a component
count cannot see. So the stronger assertion is the one that must be written: **every boundary node
has at least one spring to an interior node.** `MIN_WALL_CELLS` of 2 is the value that assertion
validates rather than something to assume — on a bold 300pt "O" the worst-case boundary-to-interior
distance lands close enough to `ATTACH_RADIUS` that it should be measured, not trusted.

**No triangulation step exists, and `decompose.js` must not be reached for here.** earcut
triangulates a polygon strictly from its boundary vertices and cannot introduce interior (Steiner)
points, so a filled blob comes out as a fan of slivers with no interior nodes — a mesh that hinges
instead of resisting squash. Meshing a filled region properly needs constrained Delaunay, which is
a large thing to write. Generating the points on a grid sidesteps it: place the nodes yourself and
adjacency is arithmetic rather than geometry.

Holes need no special handling anywhere in this. A hole is a region where the inside test fails, so
the grid simply has no points there, and its ring is resampled exactly like the outer one.

### The mesh is capped in CELLS, not in cell size

```
MAX_CELLS      12     along the longer axis; the run raises iterations to 24/8 to earn it
MIN_CELL_SIM    0.12  sim units, the same floor as MIN_LINK_SIM
MIN_WALL_CELLS  2     across the shape's own THICKNESS, which the bounding box cannot see
INTERIOR_CLEAR  0.5   of a cell: how far an interior point must clear any ring
ATTACH_RADIUS   1.5   of a cell: how far a boundary node reaches for interior nodes
```

One cell size serves the whole object. It is the smaller of two limits, because the bounding box
and the shape are not the same thing. Everything here is in **sim units** — `softmesh.js` is
otherwise pure over a spread-space face, so the world scale is passed in and the face converted
once on entry, rather than comparing a sim-unit floor against point-space extents:

```js
// all quantities in SIM units; the caller converts the face once
var byExtent    = maxDim / MAX_CELLS;
var thickness   = 2 * totalArea / totalPerimeter;   // mean wall width
var byThickness = thickness / MIN_WALL_CELLS;
var cell        = Math.max(MIN_CELL_SIM, Math.min(byExtent, byThickness));
```

`totalArea` is **hole-subtracted** and `totalPerimeter` **includes hole rings**, both summed over
every face of the object. Only with both does `2 * area / perimeter` return an annulus wall exactly,
which is the identity the thickness limit rests on; it is also how `bodies.js` measures area, which
the mass equality test depends on.

**Sizing is per OBJECT, and `byThickness` takes the minimum over its faces.** An "i" is two faces on
one body, and a cell size blended across a stem and a dot can leave the dot with no interior nodes
while the stem looks fine. Taking the minimum guarantees every face gets `MIN_WALL_CELLS` across its
own wall, at the cost of a finer mesh than the stem alone would need. The fallback below is likewise
all-or-nothing per object: a half-soft, half-rigid "i" would break the shared `filterGroupIndex`,
the mass derivation and the single write-back at once.

**What the thickness limit actually buys is a clean decision, not a working mesh.** `2*area/perimeter`
is the mean wall width — for an annulus it returns the wall exactly — and it costs one pass over
rings already in hand. Take a 200pt "O" with a 20pt wall. Its bounding box is 200 by 200, so the
extent limit alone gives `200/12 = 16.7pt` cells and calls it fine; but no interior point fits
inside a 20pt wall at that size, and insetting the outer and inner rings by `0.6 * 16.7 = 10pt` each
consumes the whole 20pt wall, so the two boundary rings meet. Without the thickness limit that "O"
silently becomes the outline-only mesh this design opens by calling fatal — no error, no failed
assertion, just a letter that behaves like a rope.

With the thickness limit it asks for 10pt cells, which is **20 cells across its longer axis, past
`MAX_CELLS`** — so it falls back to a rigid body and says why. That is the correct outcome and it is
worth being blunt about: **a 200pt "O" with a 20pt wall cannot be jelly.** The thickness limit turns
a silent failure into an honest refusal; it does not make thin artwork work.

The rule this implies, stated so it is not discovered later: staying within the cap needs
`thickness >= maxDim / 6`. **Jelly wants chunky artwork.** A bold 300pt "O" with a 60pt wall asks
for 30pt cells against an extent limit of 25pt, so the extent limit wins, and it meshes at exactly
12 cells. Note where that lands: the canonical good case sits *at* the cap rather than inside it,
which is honest about how little headroom there is. A hairline script face falls back. Simple shapes
and heavy letterforms are the domain, and the report names which limit decided each case.

There is no separate minor-axis check. An earlier draft had one, and it is unreachable once
thickness is measured: for it to fire, the extent limit would have to win — `thickness > maxDim/4` —
while the minor extent is under `maxDim/4`, and mean thickness never exceeds the minor extent. The
400x20pt bar it was written for is caught anyway and by a better route: its mean thickness is
`2*8000/840 = 19.05pt`, so it asks for 9.5pt cells and 42 across, and falls back on the cell-count
cap.

`MAX_CELLS` is 12 rather than the 8 that gravity's default iterations allow, because raising
iterations is cheap on an offline simulation and buys the range that thin-walled letters need.
Rigid-lattice droop in sim units, by cell count and iteration count:

| cells | v8/p3 | v16/p6 | v24/p8 | v32/p12 |
|---|---|---|---|---|
| 8 | 0.0347 | 0.0308 | 0.0303 | 0.0272 |
| 10 | 0.1897 | 0.0635 | 0.0582 | 0.0517 |
| 11 | 0.4065 | 0.0913 | 0.0749 | 0.0665 |
| 12 | 0.7111 | 0.1894 | 0.1046 | 0.0885 |
| 13 | 0.9591 | 0.3879 | 0.1967 | 0.1149 |
| 14 | 1.3103 | 0.5885 | 0.3401 | 0.1733 |

**The run therefore raises solver iterations to 24/8 whenever any softbody exists**, at about 80%
more solver time — 407ms to 732ms on a 300-node scene. At 24/8, twelve cells hold to 0.105 sim
units, three times the 8-cell figure but still small, and 13 doubles again. Twelve is where the
curve is still shallow.

### The cap is scale-invariant, and that had to be measured

The sag table below varies cell count and physical span together — every row uses 20pt cells — so on
its own it cannot say which of the two drives the sag. That matters, because the design's rule is
that cell size grows with the artwork: if sag scaled with span, a large letter at 8 cells would sag
visibly while the bench said it was fine. Measured separately, at a fixed cell count with cell size
swept over 16x:

| cell (sim) | 8 cells | 10 cells | 13 cells |
|---|---|---|---|
| 0.05 | 0.0402 (10.1%) | 0.2208 (44.2%) | 0.5240 (80.6%) |
| 0.1 | 0.0356 (4.4%) | 0.2167 (21.7%) | 0.7502 (57.7%) |
| 0.2 | 0.0347 (2.2%) | 0.1897 (9.5%) | 0.9591 (36.9%) |
| 0.4 | 0.0346 (1.1%) | 0.1766 (4.4%) | 1.0347 (19.9%) |
| 0.8 | 0.0346 (0.5%) | 0.1743 (2.2%) | 1.1367 (10.9%) |

Sim-unit droop, with droop as a percentage of the beam's own span in brackets.

**At a cap the solver can hold, absolute sag is constant in sim units** — 0.0346 across the whole
sweep at 8 cells — so it does not grow with the artwork, and relative sag therefore *falls* as
shapes get larger. The reason the rule works is not that cell count is the governing variable; it is
that the solver's residual error is a fixed sim-space quantity, which `suggestScale` then holds
steady by normalising median artwork to about 3 sim units whatever its point size. Where the solver
is overrun the invariance goes with it: at 13 cells and 8/3 iterations absolute droop varies by more
than 2x with cell size, so sag becomes size-dependent exactly where it is already too large.

Invariance was re-checked at the chosen cap, since the cap moved to 12 on the strength of raised
iterations and an invariance measured at 8 does not transfer for free. At 12 cells and 24/8, droop
is 0.1052, 0.1030, 0.1046, 0.1044, 0.1044 sim units across the same 16x sweep of cell size — flat,
so the cap holds for the same reason at the same strength.

This is why the engine test asserts **sim units at `MAX_CELLS`** rather than points at some
particular cell size. A points-at-20pt-cells assertion would pass on the bench rig and say nothing
about a large letter.

This cap is the load-bearing decision in the whole design, and it is measured. A **rigid** lattice —
`frequencyHz` 0, so the springs are exact constraints — still droops, because Box2D propagates
constraints iteratively along a chain and a long span cannot converge in the iterations available.
Measured on a 3-row cantilever with 20pt cells, left column static:

| cells | span | v8/p3 | v16/p6 | v24/p8 | v32/p12 |
|---|---|---|---|---|---|
| 4 | 80pt | 0.2pt | 0.3pt | 0.2pt | 0.2pt |
| 8 | 160pt | 3.5pt | 3.1pt | 3.0pt | 2.7pt |
| 10 | 200pt | 19.0pt | 6.4pt | 5.8pt | 5.2pt |
| 13 | 260pt | 95.9pt | 38.8pt | 19.7pt | 11.5pt |
| 16 | 320pt | 212.6pt | 108.9pt | 81.9pt | 41.0pt |
| 20 | 400pt | 323.3pt | 233.7pt | 206.3pt | 164.5pt |
| 25 | 500pt | 440.1pt | 418.0pt | 377.1pt | 317.0pt |

Gravity runs at 8 velocity and 3 position iterations by default. Past roughly eight cells at those
settings the sag is the solver rather than the springs; raising iterations moves that boundary out
to about twelve, and past twenty no iteration count rescues it. This is the rope link-count limit in
two dimensions — the same mechanism, for the same reason.

**So the obvious rule is backwards: bigger artwork gets bigger cells, not more of them.** Scaling
resolution with size buys detail and pays for it in sag that looks exactly like softness, is not
controlled by the softness setting, and varies with the size of the shape — two letters at one
setting would land differently for reasons invisible to the user.

Cost is not the constraint. 600 steps, ten seconds of simulation, of a 300-node 1082-spring lattice
takes 407ms at 8/3 and 732ms at 24/8. The simulation is offline; several jelly letters stay
sub-second.

### Square with diagonals, not triangular

A triangular grid is the intuitive choice, on the reasoning that a square grid's diagonal spring is
`cell*sqrt(2)` where its edges are `cell`, so one `frequencyHz` "must" mean different stiffnesses
along different axes. That reasoning is wrong: Box2D expresses a soft constraint in frequency and
normalises by the effective mass of the constrained pair, which absorbs the rest-length difference.

Measured directly, by pulling a square patch in pure tension along x and along y — identical
geometry under a 90 degree rotation, so any difference is the lattice and nothing else:

| freqHz | topology | pull x | pull y | x/y |
|---|---|---|---|---|
| 20 | square+diag | 2.0pt | 2.0pt | 1.00 |
| 20 | triangular | 2.9pt | 2.4pt | 1.22 |
| 5 | square+diag | 28.2pt | 28.2pt | 1.00 |
| 5 | triangular | 45.5pt | 33.7pt | 1.35 |
| 2 | square+diag | 139.0pt | 139.0pt | 1.00 |
| 2 | triangular | 245.5pt | 179.7pt | 1.37 |

Square with diagonals is isotropic to 1.00 at every frequency tested. It is also better
conditioned — rigid droop 9.6pt against triangular's 20.9pt at 24/8 — and it keeps the earlier
stiffness measurements valid, since those were taken on the same topology. It costs 110 springs
against 86 on a 13x3 patch.

The triangular column of that table is **not** evidence that a triangular lattice is anisotropic.
Its row pitch is `cell*sqrt(3)/2`, so a nominally square triangular patch is 1.40 by 1.21 units and
is not in fact square; extension under a uniform body force scales with length, and the ratio
predicted from aspect alone is 1.33 against the 1.35 measured. The question is unresolved and is
moot unless triangular is revisited.

## The rig

`src/softbody.js` is the only softbody module that touches planck, mirroring `rope.js`, where
`addRope` is the sole impure function.

Each mesh point becomes a dynamic body carrying one circle fixture of radius `0.6 * cell`, so
neighbouring circles overlap and the union leaves no gap for a corner to pass through. Boundary
nodes are inset by that radius, because the collision silhouette is the union of the circles rather
than the drawn curve — nodes placed on the outline collide about half a cell fatter than the shape
looks, which reads as the jelly hovering.

**Self-collision is filtered off** with a negative `filterGroupIndex`, one value per softbody
counting down from -1. Non-neighbour nodes within a shape overlap by construction, and without the
filter the shape inflates itself apart; separate negative groups keep two jellies colliding with
each other normally.

**Node density is solved backwards from the target mass.** Overlapping circles double-count badly,
and a jelly letter that outweighs the rigid letter beside it will bulldoze it. The target is
whatever the *rigid* body in the same scene would have weighed, which means honouring Equalise mass
exactly as `bodies.js` does — it overrides density so every rigid body lands on `targetMass` (1)
regardless of area, so a jelly that ignored it would become the single heavy object in the scene
and cause precisely the bulldozing this paragraph exists to prevent:

```js
// simArea and radius are ALREADY in sim units: softmesh.js works there throughout,
// and its cell size, node positions and node radius all come out in sim units.
var totalMass   = equaliseMass ? targetMass : simArea * density;   // simArea hole-subtracted,
var perNode     = totalMass / nodeCount;                           // summed over every face
var nodeDensity = perNode / (Math.PI * radius * radius);           // radius = 0.6 * cell, sim
```

Density is a sim-space quantity — `bodies.js` divides by `scale * scale` for exactly this reason —
so the conversion happens once, when the face enters `softmesh.js`, and nothing downstream converts
again. This snippet is the thing an implementer copies, so it says which space it is in rather than
leaving it to the prose.

**The unit of mass is the OBJECT, not the face.** `contours.js` returns two faces for an "i" — also
for "!", "%", ":" and quote marks — and `main.js` puts every face's parts on a single rigid body, so
an entire "i" weighs `targetMass` under Equalise mass. A per-face derivation would give a two-face
jelly twice the mass of the rigid letter beside it, which is the bulldozing this paragraph exists to
prevent. So one object is **one softbody**: all of its faces are meshed, the node count and area are
summed across them, they share one `filterGroupIndex`, they produce one report line, and they are
written back together — which they must be anyway, since `createSetCurves` replaces every curve on
the node at once.

Springs are `DistanceJoint` with `frequencyHz` from the softness setting, `dampingRatio` 0.4 and
`collideConnected` false. Nodes carry `linearDamping` for the same reason rope links do: a run ends
only when every body is quiet at once, and a large soft structure has a very long tail of small
motion.

## Binding and write-back

The drawn outline is not the mesh, and keeps its full detail. Every original outline point, holes
included, is bound at rest to its **four nearest mesh nodes** with weights proportional to `1/d²`,
normalised. Each frame its position is rebuilt from where those nodes ended up, with the stored
offset carried in each node's local frame:

```
theta_i = atan2( SUM cross(rest_ij, now_ij), SUM dot(rest_ij, now_ij) )
p       = SUM_i  w_i * ( x_i + R(theta_i) * (p0 - X_i) )
```

where `j` runs over node `i`'s rest neighbours. Omitting the rotation term produces the classic
candy-wrapper collapse: a jelly that rotates has its outline shrink toward the mesh centroid,
because averaging four rotated positions cuts the corner. In two dimensions the best-fit rotation
is one `atan2` over a sum of cross and dot products, so there is no reason to omit it.

Weighted binding is chosen over barycentric coordinates for robustness. Barycentric needs a
containing triangle per point; a triangle that **inverts** under large deformation turns its bound
points inside out, and thin features may get no cell at all and fall outside the mesh entirely.
Weighted binding has neither failure mode — it degrades smoothly as the mesh gets sparser. The
`1/d²` weights need an epsilon guard, since an outline point can land exactly on a mesh node.

Write-back follows ropes exactly. Poses come back in **spread** space and `createSetCurves` writes
**base** space, so `prepare` caches `invertMatrix(matrixOf(node))` once per node — nothing
transforms a softbody's node during playback. Every ring — the outer ring and the holes of every
face — is built with its **own** `CurveBuilder` and added to one shared `PolyCurve`, which is what
`createSetCurves` receives; that is the shape `playback.js` already uses, one builder per curve
rather than one builder holding several. Submitting them together is required rather than tidy,
since `createSetCurves` replaces every curve on a node at once.

Softbody nodes get no selection, the way `playback.js` excludes rope links via `isRopeLink`. They
need an equivalent flag, or the node is transformed as well as redrawn and the shape moves twice.

Unlike ropes, no Catmull-Rom smoothing is needed. The outline keeps its original points through
binding, so drawn detail is preserved rather than reconstructed. That detail is not free at
write-back time: ropes simplify their output with `simplifyChain` at 0.3 partly to avoid dumping
hundreds of nodes onto the user's path, and a jelly keeps every flattened point by design. A
193-point rope rewrite measures 0.7ms against the 15.4ms `FRAME_MS` budget, so a dense glyph has
room, but several dense glyphs on one frame should be measured rather than assumed.

**What "reproduces the artwork" can mean.** Write-back emits `lineToXY` polylines, so the geometry
returned is the **flattened** rings at `FLATTEN_TOL` (0.1), not the original Béziers — and since a
run ends by keeping a frame, a curved glyph is permanently replaced by a polygon. This is already
true of ropes and is inherent to `createSetCurves` write-back; it is stated here so the frame-0
assertion is written against the flattened rings, which is the only reference it can be exact
against.

**Open question requiring a probe:** rope curves are built open, with `beginXY` and `lineToXY`. A
jelly outline must close, and the closing call on `CurveBuilder` is unverified. One console probe
settles it before this part is written. If no closing call exists, the fallback is to repeat the
first point as the last — which draws correctly and may leave the fill open, so the probe result
decides whether that fallback is acceptable rather than being assumed.

## Settings, and what changes around them

**Jelly softness %** joins the Material group beside Rope slack, mapped log-spaced onto frequency
because droop is strongly non-linear in Hz: 0% gives 30Hz and barely yields, 100% gives 2Hz and
behaves as goo. Rigid is not a position on the slider — rigid is simply not naming the object.

**Seed jitter must change.** It currently writes an independent random velocity to every entry in
`W.dynamics`, and softbody nodes live there, so a lattice would be shaken rather than nudged — and a
2Hz structure holds injected energy for a long time. The jitter becomes one draw per softbody,
applied identically to all of its nodes, which breaks symmetry without deforming anything.

The console report gains a `soft` line beside `body` and `rope`, carrying cells, nodes, springs,
cell size, resulting mass, and — when a shape fell back to rigid — which limit decided it, extent or
thickness. Wall sizing needs no change: nodes are ordinary dynamics and the existing loop over
created bodies already covers them.

`checkScale` will get noisy, and it should be expected rather than investigated. It takes the median
`simRadius` over `W.dynamics`, so a few hundred soft nodes at `0.6 * cell` drag that median down and
can fire a spurious "adjust the scale" warning. Rope links already pollute it the same way, so this
is pre-existing rather than new, but a jelly scene makes it loud enough to look like a fault.

Settling is the known risk. Hundreds of soft nodes are the rope tail problem multiplied, and node
damping is the same lever. Jelly scenes are expected to end on `quiescence` more often than on
`sleep`; `restless` already reports which, and that is a thing to measure rather than to promise.

## Tests

Mesh tests mirror `test_decompose.js` and `test_robustness.js`: no cell inside a hole, boundary
nodes inset, springs symmetric and free of duplicates, every cell cap respected, **the mesh is one
connected component**, and the degenerate set — 4pt glyphs, 0.2pt hairlines, a hole sharing an edge
with the outline, coordinates a million points from the origin, **and a thin-walled ring whose
bounding box passes every extent check** — producing either a valid mesh or a clean rigid fallback,
never a broken mesh. The thin-walled ring is the case the extent limits alone cannot catch, and the
connectivity check is the one every other assertion would pass without.

Binding tests carry the rope lesson:

- **the rest pose reproduces the flattened rings exactly.** This is the frame-0 rule and the most
  valuable assertion here. A write-back bug hides unusually well, because a freshly drawn shape has
  an identity transform and round-trips correctly either way; it then presents as a physics failure.
- translating every node translates the outline by the same vector, exactly.
- **rotating every node rotates the outline** — the assertion that catches candy-wrapper collapse,
  and the one that fails loudly if the rotation term is ever dropped.

Engine tests assert what was measured above. A rigid lattice at `MAX_CELLS`, with the raised 24/8
iterations a softbody scene uses, droops under **0.15 sim units** — measured 0.1046 — and the
threshold is stated in sim units rather than points because the sag is a fixed sim-space quantity
and a points threshold would silently depend on the rig's cell size. Softness is monotonic in the
setting. A jelly's total mass matches what `addBody` would have given the same
**object**, with Equalise mass both on and off, and the two-face "i" is the fixture that makes that
assertion mean something.

Implementation order has one hard constraint: **the `CurveBuilder` closing probe comes first**,
because it gates every write-back task. There is no precedent to read off in the codebase —
`extract.js` only ever reads `curve.isClosed` and never writes closure — so it cannot be resolved
from the source and has to come from a live console.

## Rejected alternatives

**Outline points as the sim nodes**, triangulated with earcut. Cheapest to write and reuses
`decompose.js` directly, but earcut adds no interior points, so the result hinges about a single
vertex rather than resisting squash — weak exactly where jelly needs strength. Flattening also
emits dense points on curves and sparse ones on straights, so spring lengths would vary by an order
of magnitude across one glyph and stiffness would vary with them; this is the same defect uneven
rope links had, and the reason `resample` exists.

**A pressurised boundary ring**, springs along the ring plus an outward force proportional to
`1/area`. Very cheap and very bouncy, but it needs a per-step force hook the run loop does not
have, each hole needs its own inward pressure and stability story, and pressure models are known to
go unstable on concave shapes — which is every interesting letter.
