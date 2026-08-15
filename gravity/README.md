# Gravity

Drop vector objects into a scene and let them fall, collide and settle, on a real rigid-body
solver — planck.js, with true concave and holed collision shapes.

> **Using the script rather than working on it?** See **[MANUAL.md](MANUAL.md)**. This file is for
> people reading `src/`; the manual is for people running it in Affinity.

> **Provenance.** Gravity is a separate script, not a new version of anything. The repository also
> contains `examples/physicsdrop.js`, an earlier physics script by another author; it is referenced
> throughout these notes and in code comments purely as **prior art**, because it exercises parts
> of the undocumented Affinity SDK and so proves what the API actually does. Where a comment says
> "physicsdrop does X", it means that script, not an earlier release of this one.

Everything under `src/` except `extract.js`, `playback.js` and `export.js` is **pure**: plain
number arrays in, plain number arrays out, no Affinity API, so it is verified headlessly instead
of by running the script.

```
contours.js   rings -> faces      signed area, containment, nesting depth (even = solid, odd = void)
sanitize.js   face  -> face       dedupe, collinear cull, Douglas-Peucker, winding, area cull
decompose.js  face  -> parts[]    earcut (holes native) -> Hertel-Mehlhorn -> convex parts <= 12 verts
flatten.js    beziers -> ring     adaptive subdivision on flatness, then the base->spread matrix
raster.js     alpha -> rings      marching squares over the alpha mask, holes included
rope.js       polyline -> chain   even resampling, linked bodies, polyline rebuilt from poses
extract.js    nodes -> rings      the ONLY module that touches the Affinity API
world.js      -> world           planck world, scale, y-flip, static Chain geometry
bodies.js     parts -> body      centroid offset, winding reversal, one body with N fixtures
sim.js        world -> frames    step, settle, record [x, y, angle] per body per frame
```

A **ring** is a flat, implicitly-closed coordinate array `[x0, y0, x1, y1, ...]`. A **face** is
`{outer, holes[]}`. A **part** is a convex, positively wound ring that becomes one planck fixture.

Holes are real: neither planck nor Box2D supports a hole in a fixture, so the void is resolved
here, before the engine sees anything. That is what lets a letter drop *inside* a container
instead of resting on its filled counter.

## Running the tests

```sh
node gravity/test/run.js     # exit code is non-zero if anything fails
node gravity/test/bench.js   # regenerates the fixture-count table below
```

## Building

```sh
node gravity/build.js          # writes dist/gravity.js
node gravity/build.js --check  # non-zero exit if dist/ is stale
```

`dist/gravity.js` is **generated** — the reviewable diff is `src/`. It is committed anyway
because it is the artefact that actually gets pasted into Affinity.

Everything travels inline in one file. A script cannot reliably load its own code from disk at
runtime — `/fs` is unavailable in the testing environment, where most iteration happens — and a
433KB script is imported and parsed intact, so inlining is the supported route rather than a
workaround.

Each vendored library is wrapped in its own private `module` object. Both UMD bundles resolve to
their CommonJS branch in the sandbox, so evaluated bare they would assign to the host script's
`module.exports` and the second would clobber the first.

Three invariants run on every decomposition case (`test/invariants.js`):

1. **Area conservation** — `sum(part areas) == area(outer) - sum(hole areas)`, within 0.1%.
2. **Convexity** — every part convex, positively wound, within the vertex cap.
3. **Hole exclusion** — grid-sampled points strictly inside a hole land inside no part.

`test_decompose.js` also runs them against a deliberately broken decomposition (the outer ring
taken whole, hole ignored — the physicsdrop failure mode) to prove the invariants actually fire.

## Tuning

All thresholds are `opts` overridable; the defaults are in source units (Affinity points),
applied before the world-scale divide.

| Constant | Default | Job |
|---|---|---|
| `MERGE_EPS` | `1e-6` | points closer than this are the same point |
| `FLAT_EPS` | `1e-4` | perpendicular distance under which a vertex is collinear |
| `SIMPLIFY_FRAC` / `SIMPLIFY_MIN` | `0.0015` / `0.25pt` | Douglas-Peucker tolerance, relative to the face's bbox diagonal with an absolute floor |
| `SIMPLIFY_MAX_AREA_FRAC` | `0.01` | area a ring may lose to simplification; the tolerance halves until it fits |
| `MIN_AREA` / `MIN_AREA_FRAC` | `0.01pt²` / `1e-4` | a hole must clear both to survive; an outer clears the absolute rule only |
| `MAX_VERTS` | `12` | `planck.Settings.maxPolygonVertices`, whose default is 12 in planck 1.x |

Exceeding the vertex cap is not an error in planck — the polygon is **truncated**, silently
dropping geometry. `decompose` therefore enforces the cap itself, and `GR.MAX_VERTS` is the one
place it is written down.

Simplification is the dominant lever on fixture count; the vertex cap is a minor one. Regenerate
this table with `node gravity/test/bench.js`:

| Input | Input verts | Parts without simplify | Parts with | Area cost |
|---|---|---|---|---|
| 250pt "O", 120-segment rings | 120 | 130 | **35** | 0.063% |
| traced raster contour | 1383 | 764 | **20** | 0.027% |
| traced raster + 3 holes | 1383 | 1304 | **104** | 0.012% |

Raising the cap past 12 buys nothing on any of these — 8 → 12 → 16 gives 38 → 35 → 35 parts on
the "O" — because above 8 vertices it is convexity, not the cap, that refuses the next merge.

A traced raster contour is modelled as a **staircase**, not as a noisy curve, because marching
squares walks pixel edges and emits axis-aligned steps. The distinction dominates the result:
Douglas-Peucker collapses a staircase almost entirely, since the error is correlated along each
run, and barely touches random jitter at any tolerance.

A chord tolerance is blind to feature thickness — 1.5pt of allowed deviation eats a 0.2pt
hairline whole, or flattens the notch out of a thin stem and leaves a solid slab. So the
tolerance is only a starting point: `simplifyWithinBudget` halves it until the ring both survives
and stays within its area budget. Simplification therefore never *deletes* geometry; only the
explicit area rules do.

Sanitising is idempotent, which matters because `decompose()` sanitises its own input and the
pipeline sanitises before calling it.

## The engine boundary

Two conversions happen between Affinity and planck, and both are easy to get wrong in ways that
still produce a plausible-looking simulation.

**Scale.** Box2D is tuned for bodies 0.1-10 units across; a dropped letter is ~500pt. Everything
divides by `WORLD_SCALE` (100) going in and multiplies going out. `checkScale()` reports the
median body size and warns when it leaves that band — it reports rather than corrects, because
rescaling one body would break its contacts with every other body.

**Axes.** Affinity's y points down, planck's points up. Flipping y at the boundary confines the
disagreement to `toSim` / `toSrc`, but it also mirrors the plane, which **reverses winding and
the sense of rotation**. `bodies.js` therefore reverses each part's vertex order and negates the
reported angle. planck rebuilds a convex hull per fixture and would silently paper over the
winding half of this, which is exactly why the tests assert that no vertex is dropped.

Because holes are real, mass and rotational inertia come out right for free: a hollow "O" weighs
less than the disc containing it, and spins more readily.

**Bounds are worked out by `boundsForArtwork` in `world.js`, which is pure and therefore tested.**
It lived inline in `main.js`, which touches the Affinity API and is never exercised headlessly - so
the degenerate case below could not have been caught where it was. No axis of the box may be
smaller than `MIN_SPAN_FRAC` (0.15) of the artwork's larger dimension: FLAT artwork has a
zero-height bounding box, and a fixed margin then left a horizontal rope 40pt of room to fall into,
clipping its sag to 33.5pt where the natural sag is 105.7pt. It read as the anchoring having failed
when the ends were held exactly right and the world was 80pt tall. 0.15 fixes that while leaving
working scenes untouched: 1830x778 artwork needs 274 and already has 778, so its box is unchanged
to the point. Growth is about the centre, or the artwork would shift inside its box and the
artboard-independence property would be lost.

**Bounds hug the artwork, not the page.** A closed static box is added around everything, standing
off by `MARGIN`, so a body with nothing to hit cannot fall forever and the run can end on something
better than the frame cap. It is built from the union of every ring **and every rope polyline** —
ropes carry no rings, since an open path has no interior, so walking rings alone would leave a
rope-only scene with a degenerate box.

> This used to start from `getSpreadExtents()`, which made the **page part of the physics**:
> resizing the artboard moved the walls and produced a different drop from identical artwork. It
> hit ropes hardest, because a rope about as long as the page rests its ends on the side walls and
> is held up by them — grow the artboard and the same rope hangs free, which reads as the
> simulation having changed for no reason. The spread is now only a fallback for the degenerate
> case where nothing has any geometry at all.
>
> **Known issue: resizing the artboard still changes the result.** The bounds above were one real
> cause and not the only one. Ruled out so far: `suggestScale` reads body extents rather than the
> page, the Douglas–Peucker tolerance is a fraction of each **ring's own** bounding box, and
> `FLATTEN_TOL` is a constant. The open suspects are a selected static that is itself sized to the
> artboard — which would change the collider, not the world — and the possibility that a scene of
> long ropes draped over lettering is simply chaotic enough that any perturbation diverges. Runs
> are reproducible for identical input; nothing promises similarity under a changed one.

## Ropes

**An open path becomes a rope.** A closed path encloses an area and becomes a rigid body; an open
one encloses nothing, so it used to be skipped entirely. The distinction is already unambiguous,
so no naming convention is needed — draw a line above a shape, run, and it drapes over it.

The path is resampled to evenly spaced links (uneven links have uneven mass and hang wrong), each
link becomes a small box body, and neighbours are joined by a revolute joint with
`collideConnected` off — links that touch by construction must not also collide, or the rope spends
every step pushing itself apart. Thickness comes from the stroke weight.

Ends fall free, so a rope slides off a shape it is unbalanced on. Name the path **`hang`**, `pin`
or `anchor` to pin both ends and get a washing line that sags in the middle. Pinning uses a static
body and a joint rather than a static end link, so a hanging rope can still swivel about its pin.

> **Link count is a stability limit, not a quality dial**, and two separate limits apply. A link
> shorter than about **0.12 sim units** solves against `linearSlop` (0.005): a 400pt rope at 0.083
> per link tore itself apart and flung its middle to y=24300, while 0.121 held and sagged 41pt.
> Separately, a **taut** chain fails past a link count no size rule predicts, because Box2D
> propagates constraints iteratively along it — measured, a 1000pt rope pinned at both ends
> stretched 1.03x at 40 links and **54x** at 48, while 1500pt was fine at 48. That boundary is
> chaotic, so `MAX_SEGMENTS` takes margin rather than chasing it: **32**, which held on every
> length tested at worst 1.02x. A draped rope has slack and is far more forgiving.

**That last sentence is why there are two caps.** Tension is what tears a chain, and a slack rope
has none to build, so it is capped at `MAX_SEGMENTS_SLACK` (**96**) while an anchored one keeps the
conservative **32**. Both are ceilings, not targets — the count still comes from the thickness rule
(links about twice as long as they are thick), and `MIN_LINK_SIM` still overrides both.

The reason a slack rope needs the resolution is geometric rather than aesthetic: **a rigid link
longer than a gap cannot enter it.** At 32 links an 1800pt rope has 56pt links, so laid across
lettering it bridges every gap narrower than 56pt and appears to ignore the collider entirely,
when in fact it is simply too blunt to find it. The tests assert this via the mechanism — a gap
deliberately narrower than a coarse link and wider than a fine one — rather than by measuring sag,
because a rope with no slack to feed in measures friction instead of resolution.

**Appearance is decoupled from the solver.** The drawn curve is Catmull-Rom interpolated through
the link joints — `smoothPolyline`, 6 subdivisions by default — so a 32-link rope draws as roughly
190 points. Catmull-Rom interpolates rather than approximates, so every joint stays exactly where
the solver put it and only the space between joints is invented.

> **Ropes used to look janky, and the cause was neither the solver nor the drawing.** Adding the
> smoothing above changed nothing visible, which correctly ruled out drawn resolution but was read
> at the time as "so it must be the physics". It was not. The rope was being **undersampled in
> time and then delivered slowly**: recorded at 30fps and played back at 21.6, because
> `setInterval` rounds its interval up to a 15.4ms quantum and playback asked for 33ms — one
> millisecond past two quanta, so it got three. A rigid object survives that, since the eye tracks
> a single point; a rope is a whole line moving at once and strobes. Recording every physics step
> and asking for 8ms instead fixed it: 60 samples per second, delivered at 64.6fps. See
> [Frame rate](#frame-rate).

Playback cannot transform a rope, because a rope **deforms**. Its polyline is rebuilt from the link
poses each frame and written with `createSetCurves`, riding the same compound command as everything
else so a frame is still one preview and one undo step. Ropes sharing a node rebuild together,
since `createSetCurves` replaces every curve on a node at once, and rope links deliberately get no
selection — transforming their node as well would move the rope twice.

**Poses come back in spread space; `createSetCurves` writes base space.** Extraction only ever maps
base → spread, because a rigid body moves with `createTransform` and never needs the return trip. A
rope does, so `prepare` stores `invertMatrix(matrixOf(node))` per node — once, since nothing
transforms a rope's node during playback — and `ropeCommands` applies it after smoothing.

> Omitting that inverse displaces each rope by exactly its own node transform, and the failure is
> unusually good at hiding: **a freshly drawn path has an identity transform and round-trips
> correctly either way**, so one rope looks perfect and the bug only appears once a second, moved
> node is involved. It then presents as a *physics* failure — ropes that "don't fall" — even though
> the final-pose log shows them landing correctly. The discriminator is **frame 0**, which must
> reproduce the artwork exactly; if it is already wrong, the fault is in the write-back and no
> amount of looking at the solver will find it.

Ropes take `slack`, which lengthens the path before the link count and layout are decided. The
extra length goes into a single ARC — `4*d*t*(1-t)`, zero at both ends, so the anchor pins stay
exactly where they were drawn. Depth is solved by bisection, because the curve's arc length has no
useful closed form and the control has to mean what it says.

The interesting decision is which WAY the arc goes. `main.js` measures the clear depth from the
static rings under the rope's span, less 20pt, and passes it as `maxSagDepth`. Within that, the arc
hangs down, because that is how a rope hangs. Beyond it the arc goes **up** instead — the surplus is
carried above the drawn line, where nothing constrains it.

Upward looks wrong for a frame and is the only direction that always works. The rule it protects is
that a rope must never be initialised below the thing it should land on: geometry you start past can
never be hit, which reads as "slack breaks collision" rather than as a bad starting pose. A deep
unclamped arc put a 20% slack rope 485pt below its own path and under the artwork it was drawn
above. Measured on a 2470pt rope with lettering 512pt below: unclamped at 25% slack it started 832pt
down, past the lettering, and 11 links finished underneath it; clamped, none did and 41 links rested
on it instead of 4.

Two shapes were tried before this one and both looked right first. The deep arc is above. The other
was a RIPPLE — the surplus as `A*sin(2*PI*waves*t)`, which keeps the rope near its path. Its
waviness is set by the slack alone: amplitude/wavelength measures `sqrt(slack)/pi` at every wave
count, so no tuning hides it. A rope drawn close above artwork therefore started as a visible comb —
on a real scene, two ropes over a headline with 300pt and 35pt of clearance both did, even at 10%
slack, because 25% on a 1623pt rope wants 547pt of arc. Worse, the comb did not wash out: at rest on
a surface with friction it is a stable shape, so it survived into the settled frame, which is the
one the user keeps. `waves` remains in the signature as a sampling-resolution hint and no longer
names a shape.

`slackenPolyline` densifies its input first: the offset is zero at both ends by construction, so a
two-point straight line — the exact input the feature exists for — cannot bend at all otherwise.
Eight passing assertions on the length identity meant nothing until an end-to-end test fed it one.

There are THREE link caps, because what tears a chain apart is tension and being pinned is only the
worst case while also taut. Taut and pinned keeps 32. Free keeps 96. Pinned WITH slack sits between
at 64: measured on a 1640pt rope, stable through 72 links at 35%, 50% and 80% slack, tearing at 76
for two of the three — the same chaotic boundary the taut cap refuses to chase, so it takes margin.

A pinned rope also needs the walls to allow for where it will END, not where it starts: it begins on
or above its path — never below it — and only hangs once it settles. `reach` is half the chain's length, which
bounds how far it can fall below its pins. Sizing the box to the starting positions put the floor
through the middle of the finished drape and the rope kinked 30 degrees at each anchor.

## Softbodies

**planck has no soft bodies at all.** There is no deformable primitive to reach for, so a jelly is a
RIG: a lattice of small circular point bodies joined by `DistanceJoint` springs with a frequency and
damping ratio. That is the same trick `addRope` already uses, applied in two dimensions instead of
one. Name a closed shape **`jelly`**, `soft` or `squish` and it meshes; everything else stays rigid.
An open path named `jelly` stays a rope, because rope wins deliberately — an open path has no
interior to mesh.

**There is no triangulation, and that was the first thing to go.** `earcut` triangulates a polygon
using only the points it is given and cannot introduce interior ones, so a boundary-only
triangulation of an outline is all edge and no inside: it HINGES rather than resisting squash. Nodes
are placed on a regular grid clipped to the shape instead, which has the second benefit that
adjacency becomes arithmetic — a node's neighbours are known from its indices, with no search and no
tolerance to tune.

The mesh is capped at **12 cells** across the longer axis (`SOFT_MAX_CELLS`). The cap is not about
node count or speed; past it a lattice sags from SOLVER error rather than from its springs, so the
sag stops meaning what the softness control says it means. Measured rigid droop in sim units at
24/8 iterations, with the springs asked to be perfectly stiff:

| Cells across | Rigid droop |
|---|---|
| 8 | 0.030 |
| 10 | 0.058 |
| 12 | 0.105 |
| 13 | 0.197 |
| 14 | 0.340 |

The knee is between 12 and 13, and 12 is what the raised iterations buy: **a scene containing any
softbody steps at 24/8 instead of the default 8/3**, which is what earns 12 rather than 8. On the
shipped rig the same measurement is 0.112 rigid, against **1.07 / 2.06 / 3.32** at softness 0 / 0.25
/ 0.75 — an order of magnitude of headroom between solver error and the softest setting. At the
default 8/3 that same rigid beam sags **0.575**, five times worse and over the test's threshold, so
the iteration raise is not an optimisation but a correctness requirement. It is applied only when a
softbody exists, so every scene that had none steps bit-identically to before.

**The grid is square WITH both diagonals, not triangular.** The triangular grid was built first, on
the reasoning that one rest length throughout must mean isotropic stiffness. That reasoning is
wrong: Box2D normalises a soft constraint by the pair's effective mass, so equal rest lengths do not
imply equal response. Measured by pulling a square patch in pure tension along x and then along y,
square-plus-diagonals is isotropic to **1.00** at every frequency tested, while the triangular grid
measured **1.22–1.40** — and it was also softer and less rigid at equal Hz, so it lost on both
counts.

**Cell size comes from the shape's own WALL, not its bounding box.** The thickness estimate is
`2 * area / perimeter`, which returns the wall of an annulus exactly. Without it a 200pt "O" with a
20pt wall is sized from its 200pt box, admits no interior node at all, and silently becomes an
outline-only mesh that behaves like a rope — a jelly-shaped failure that still runs. Two limits are
computed, `thickness` and `extent`, and the smaller wins; the report says which one decided, because
"too thin" and "too big" have different fixes.

The honest consequence is a shape rule: staying inside the cap needs `thickness >= maxDim / 6`, so
**jelly wants chunky artwork**. A bold 300pt "O" with a 60pt wall meshes at exactly 12 cells. A
hairline face has nowhere to put an interior node, falls back to a rigid body rather than pretending,
and the report says which limit refused it.

**The drawn outline is not the mesh.** Meshing at 12 cells would destroy the artwork if the lattice
were drawn directly, so every original point is BOUND once, at rest, to its 4 nearest nodes with
`1/d²` weights, and carried each frame through each node's best-fit rotation as well as its
translation. Dropping the rotation term produces candy-wrapper collapse — the outline shrinks toward
the mesh centroid, because averaging rotated positions without rotating the offsets loses the radius.
Measured: a π/3 rotation is off by **0.41 sim units** without the rotation term against **8.9e-16**
with it. The TRANSLATION test passes either way and catches none of this, which is why it is not the
test that guards the feature.

**Mass is solved backwards from the target**, not accumulated from the node fixtures. Overlapping
node circles double-count area, so summing them overshoots; the desired total is chosen first and
each node's density derived from it. It honours Equalise mass for the same reason everything else
does — a jelly that ignored it would be the one heavy object in the scene and would bulldoze the
rigid letter beside it. A two-face "i" weighs **1** in total, not 2.

`seedJitter` now draws **once per softbody** rather than once per node. An independent nudge per node
does not nudge a lattice, it SHAKES it, and a soft structure holds that energy rather than shrugging
it off the way a rigid body does. Measured velocity spread across one lattice: **0.0198** before,
**0** after. Scenes without jelly reproduce bit-identically, since the draw order for rigid bodies is
unchanged.

Write-back uses `createSetCurves`, exactly as ropes do, with the same per-node inverse matrix to get
back from spread space into base space, and closes each ring with `CurveBuilder.close()`.

> **Repeating the first point does not close a curve.** Probed: a builder fed a duplicate final point
> reports `isClosed false`. It would draw closed and FILL wrong, which is the failure mode that
> matters for a jelly, since a jelly is a filled shape with holes in it.

**What is not verified.** The write-back is tested against a recording SDK fake, so "closed" and "in
base space" are properties of the CALLS rather than of rendered output — nothing here has been
compared against pixels. Multi-ring fills are unmeasured on canvas. So is preview cost at jelly point
counts: ropes have a measured 0.7ms per rewrite, a jelly has no such figure yet and has considerably
more points. Settling behaviour on real scenes — whether a lattice reliably reaches planck's sleep
thresholds, or leans on the quiescence backstop — is also unmeasured.

## Settling

`world.setAllowSleeping(true)` and "every body asleep" replace physicsdrop's `stillFrames` /
`flatSupport` / `stuckFrames` / `slowFrames` / `touchedSleeper` heuristics and its hard stops.

One backstop remains, for a case sleeping cannot handle. planck sleeps an island only when the
position solver has converged too — `minSleepTime >= timeToSleep && positionSolved`. A **compound**
body that starts deeply embedded in static geometry never converges: its fixtures penetrate the
same wall and impose corrections that cannot all be satisfied at once, the wall cannot move
aside, and per-step correction is capped. The body then sits at exactly zero velocity, awake,
indefinitely. A single-fixture body does not reproduce this — it just pushes itself out.

Artwork dropped already overlapping its container does exactly this, so `run()` also stops when
every body has stayed under planck's own sleep velocity thresholds for `quietFrames` (one second,
derived from `FPS`) and reports the offending bodies in `staticOverlaps`. `settledBy` says which
rule ended the run: `sleep`, `quiescence` or `cap`.

`cap` on its own says nothing, so `run()` also returns `restless`: how many bodies are awake, how
many are over tolerance, the fastest linear and angular speeds and the tolerances they are measured
against. That distinguishes a scene still genuinely creeping from one that is motionless but
unsleepable — the two have completely different causes and the frame count cannot tell them apart.
It is measured on every run, so a settled run can also be confirmed rather than assumed.

Long ropes are the case that defeats both exits: a run ends only when *every* body is quiet at
once, and 84 links draped over lettering never manage it. Measured on a real scene, 52 of 168
bodies were over tolerance at 5 seconds and 11 still were at 20. Rope links therefore carry
`linearDamping` and `angularDamping` (see `rope.js`), which roughly halve the residual motion.
Note what that does *not* claim: on a deliberately hard fixture, undamped settled 0 times out of 5
seeds and damped settles about 3 — "usually" rather than "never", which is worth having and is not
the same as solved.

Drops are reproducible: pass a `seed` and the initial tie-breaking jitter is deterministic.
physicsdrop seeded from `Date.now()`, so a result the user liked could never be recovered.

`test_robustness.js` runs the full invariant set over the input the pipeline will actually meet:
counters touching the outline, holes sharing an edge, 0.2pt hairlines, 4pt glyphs, 20 counters on
one outline, coordinates a million points from the origin, duplicated points, and NaN/Infinity in
the contour.

## Vendored

`vendor/earcut.min.js` — earcut 3.2.3, ISC.
`vendor/planck.min.js` — planck.js 1.5.0, MIT.

See `vendor/LICENSES.md`. Both are UMD builds that resolve to their **CommonJS branch** inside
the Affinity sandbox. earcut v3 exports the triangulator as `exports.default`; planck has no DOM
or host dependencies and needs no shims.

## Reading Affinity geometry

`extract.js` is the only module that touches the SDK, and it is deliberately thin: it pulls plain
numbers out and hands them to the pure modules. Every SDK fact it relies on was verified by a
probe in `probes/`, not assumed.

- **Every node type exposes `curvesInterface`** — live `ShapeNode`, `ArtTextNode` and `ImageNode`
  included. There is no live shape without curves, so no bounding-box fallback is needed.
- Curve coordinates are in **base space**; `node.transform` maps them to spread space.
  `node.localToSpreadTransform` reports identity even for offset nodes and must not be used.
- `curve.generatePolygon(tolerance)` returns a `PolygonHandle` with no readable members, so
  flattening is `flatten.js`'s job. Straight edges arrive as cubics with collapsed handles and are
  emitted as single segments rather than subdivided.
- **Live text drops as one rigid body**, read non-destructively and left editable.
  `curvesInterface.polyCurve` reports `curveCount === 1` for a whole string — one glyph — but
  `polyPolyCurves` holds one `PolyCurve` per glyph with counters included, and
  `getTransformedPolyCurve(i)` returns them in **base space**: measured against a rotated, offset
  text node, it reproduces `baseBox` exactly and `node.transform` lands it on `spreadBaseBox`.
  > It is **one** body rather than one per glyph because a text node is a single node. Playback
  > moves a body by transforming its node, so ten glyph bodies sharing one node would apply ten
  > conflicting transforms to it every frame — the text lurches while the physics, which is
  > correct, is never seen. Letters can only move independently if they are separate nodes, which
  > is what "Split text into letters" produces via `DocumentCommand.createConvertToCurves`.
  `textPolicy: 'refuse'` skips text entirely.
- Classification order matters: an `ImageNode` also has `curvesInterface`, so the image test comes
  before the vector test.
- **Images collide as their true silhouette**, traced from the alpha channel by `raster.js`.
  physicsdrop samples a 48x48 grid and takes the convex hull, which fills in every concavity and
  hole; marching squares walks the real boundary and returns the hole rings too, which the nesting
  classifier then handles like any other contour. The bitmap comes from `createCompatibleBitmap`,
  or `NodeRenderingEngine.createDefault` as a fallback, and is read with `PixelReaderRGBA8` from
  `/pixelaccessor` — the same APIs physicsdrop uses, so they are known to work. A fully opaque
  image legitimately is its rectangle, so that remains the fallback: `imagePolicy: 'rectangle'`
  forces it, `'refuse'` skips images entirely.
- A group yields **one body per child**, so a dropped word tumbles as letters rather than as a
  slab. `groupsAsOneBody` merges it when that is what you want.
- Static geometry is marked by **both** routes: a locked node, or a name containing `wall`,
  `floor`, `ramp`, `static`, `ground` or `collider` on a word boundary — `left-wall` is scenery, `Wallpaper`
  is not. **Scenery is inherited**, so naming a *group* `wall` makes everything inside it scenery,
  however deeply nested. Otherwise a container built from several shapes would need every one of
  them renamed, and a group whose name plainly said "wall" would drop as loose debris.

`test_extract.js` runs against mock nodes copying the shape the probes recorded. They prove the
module behaves correctly given that shape; only a probe run inside Affinity proves the shape.

## Playback

`playback.js` writes the recording back to the canvas, ported from physicsdrop whose preview/scrub/commit
dance is known to work: `executeCommand(cmd, true)` previews and supersedes the previous preview,
`executeCommand(cmd, false)` commits one undoable step, and `clearPreviews()` drops anything
uncommitted. Scrubbing is therefore cheap — each slider move is one replacing preview rather than
an undo stack to unwind.

Every body is transformed as a delta about its **original centroid**, so the artwork never moves
from its authored position as far as the document is concerned: replaying frame 0 restores it
exactly, and the whole drop stays one undo step.

> **Rotation sign.** physicsdrop solved in Affinity's y-down space and applied its body angle straight to
> `Transform.createRotate`. v2 solves in planck's y-up space and `bodyState` negates the angle on
> the way out, so the value reaching `playback.js` is in the same convention physicsdrop used — which is
> why nothing negates it again. If objects ever counter-rotate against the simulation, that is the
> only line to flip.

The drop **plays on canvas at a steady 64.6fps** before the scrubber opens. physicsdrop animated while
solving, so a heavy scene ran at whatever rate the solver managed; v2 solves the whole drop first
— a few hundred milliseconds — and replays from the recording, so playback speed is independent of
scene weight and rewatching costs nothing.

The Finished dialog cannot be raised inline at the end of playback, and it cannot be raised from the
playback callback either. Inline is wrong because `runModal` blocks, and the timer driving playback
would stop; from inside the callback is worse, because a modal opened there **never appears at all**.
`runModal` neither returns nor throws — it sits, the app holds a modal it never drew, the Scripts
panel stops responding, and every later `runModal` fails with `INVALID_OP` until Affinity restarts.
The only trace is an `ABORTED` at shutdown. It is the callback's own work that does it: the timer is
re-armed *before* the callback runs, so once a frame costs more than the interval the waits pile up
and the modal lands in that backlog — which is why only heavy scenes ever showed it. So `finish()`
hands the dialog to a fresh `setTimeout` and lets the callback return first. See §20 of the SDK
reference, and `probes/probe_modal_from_timer.js` for the four cases that clear the timer of blame.

### Frame rate

**`setInterval` does not give you the interval you ask for.** It rounds the request **up** to the
next whole multiple of a **15.4ms quantum** — the host scheduler tick, 64.9Hz. Measured with an
empty callback, 40 ticks each, by `probes/probe_timer_floor.js`:

| asked | 1ms | 8ms | 16ms | 33ms | 50ms | 100ms |
|---|---|---|---|---|---|---|
| **delivered** | 15.3 | 15.5 | 30.5 | 46.2 | 61.6 | 107.8 |
| **quanta** | 1 | 1 | 2 | 3 | 4 | 7 |

Delivery is otherwise excellent — sd 0.5ms, no late frames — so this is a cliff, not a slope, and
it is invisible unless measured. **16 is the trap**: it is what anyone writes for 60fps, it is
0.6ms over one quantum, and it halves the frame rate. Playback asks for **8ms**, mid-quantum, so no
drift can push it over. `test/test_timing.js` asserts the property rather than the number, so a
future tidy-up to a rounder value fails the suite.

Drawing is not the constraint and never was: a full 193-point rope submits in **0.7ms** against a
15.4ms quantum, and 60 ticks at 8ms measured sd 0.5ms with zero bursts.

Recording is therefore **one physics step per frame** — `STEPS_PER_FRAME = 1`, 60fps — since there
is no point delivering 64fps of a 30fps recording. This costs no extra physics, only a recording
array twice the size; the step count for a given span of simulated time is unchanged. `GR.FPS` is
derived from `dt × stepsPerFrame` and is the single source of truth for the duration control, the
scrubber's seconds readout and the export stride, all of which assumed a literal `30` before.

Playback runs about **8% fast**, because the quantum grid has no multiple at 16.7ms. That is the
price of 64.6fps over 21.6.

## Settings

| Control | Maps to |
|---|---|
| Gravity | world gravity, entered in **document units** per second squared and divided by the world scale once |
| Angle | 0 = down the page, 90 = right |
| Max duration | frame cap, at the recorded 60fps |
| Seed | initial tie-breaking jitter, so a drop can be reproduced |
| Bounciness % | fixture `restitution` |
| Friction % | fixture `friction` |
| Equalise mass | scales each body's density inversely to its area |

Gravity carries the same y-flip as the geometry, so "down the page" comes out negative in sim
units. All four compass directions are unit-tested for that reason.

`main.js` runs the whole pipeline and hands the recording to the scrubber. Pass `{ dryRun: true }`
to stop before anything touches the document; that is how the extraction layer was validated
before playback existed, and the console report it prints is still the only view into the parts
that leave no trace on canvas.

## Exporting

Tick "Export image sequence when finished" and the drop is written as a 30fps PNG or JPEG sequence
from frame 0 up to the frame you keep. The recording is 60fps, so export takes **every second
frame** — playback needs the extra samples, a file on disk does not, and every frame is a full
`doc.export`, which is by far the slowest thing the script does. Files are numbered by files
written rather than by recorded frame, since an image sequence with holes in it does not import.
`exportStridePlan` reports the rate it actually achieved rather than the one requested, because a
stride is a whole number and most rates are not reachable — the range is only known after scrubbing, which is why the
format choice lives in the Finished dialog rather than the settings one. Cancel never exports:
it means "keep the settled result", not "write three hundred files".

Each frame is **committed**, exported, then undone. A preview is not guaranteed to render into an
export, so this cannot reuse the cheap preview path the scrubber uses. The loop runs on a timer so
the UI is not frozen and a failure can stop cleanly rather than wedging Affinity.

> **Export only works from an INSTALLED script.** Run from the Script Manager's testing
> environment, `/fs` and `doc.export` return `PERMISSION_DENIED`; install the same file as a script
> and it exports normally. Nothing about the code changes. If an export fails, install it and try
> again before looking anywhere else.

Two sandbox rules govern where files can go, and both are easy to get wrong silently:

**Separators.** Paths are built as the backslash root Affinity hands out with **forward slashes**
appended — `E:\USER\Desktop/Gravity_20260803_133101/drop_0000.png` — matching the form the
working physicsdrop export uses. Whether backslashes would also work is untested: the denials that
suggested otherwise turned out to be the permission problem above, not the separator.

**Write where you created.** Frames land in a folder the script made itself. There is no
writing-flat fallback, because the Desktop root was refused in testing and a fallback there would
turn a clear failure into a confusing later one.

`isDirectory` must be tested for truthiness rather than `=== true`: `/fs` exports a `PathType` enum
(`Directory = 3`), so a strict comparison reads a perfectly good folder as a failure.

Preset names are exact and case-sensitive. `PNG` exists bare; there is **no** preset called just
`JPEG` — they are all qualified, `JPEG (Best quality)` and so on — so the names are read from
`FileExportOptions.allPresetNames` rather than guessed. Frame numbers are zero-padded to four
digits, or a sequence sorts 1, 10, 11, 2 and imports scrambled.

## Least proven

Live text now drops without conversion, and images collide as their traced alpha silhouette
rather than their placement rectangle — both shipped.

The raster path is the thinnest ice. `createCompatibleBitmap` and `PixelReaderRGBA8` from
`/pixelaccessor` are the APIs physicsdrop uses, so they are known to work, but they are the one
part of extraction with **no headless test behind them** — `raster.js` itself is tested against
synthetic masks through an injected sampler, which proves the tracer and not the plumbing. A
fully opaque image legitimately *is* its rectangle, so the rectangle stays the fallback both for
that case and for any failure reaching pixels.

**Reproducibility across edits is partly settled.** The same input always gives the same result —
the seed feeds a mulberry32 PRNG and the drop is recorded rather than solved live.

Resizing the artboard used to shift the result, and that turned out to be a real bug rather than
chaos: extraction mapped base to spread with `node.transform`, the node's LOCAL matrix, which only
equals the base-to-spread matrix while every ancestor is identity. Give an artboard a scale and
every object is wrong by exactly that scale, silently. It now uses `baseToSpreadTransform`.
Confirmed by prediction rather than by eye: two artboard sizes differing by a pure 447.13pt
translation reproduced frame 0 exactly, and after 600 steps of a chaotic 168-body scene the worst
disagreement was 0.4pt.

What is still *not* established is how far a genuinely different input should be expected to change
the outcome. A scene of long ropes draped over lettering is exactly the shape where contact
ordering diverges freely, and nothing guarantees that a small perturbation produces a small change.
That wants a deliberate experiment rather than a fix.

**Ropes contribute nothing to the world-scale estimate.** `suggestScale` is fed `ringsBBox(obj.rings)`,
and a rope's `rings` is empty by construction, so a scene of ropes plus static scenery silently
falls back to `DEFAULT_SCALE` instead of a fitted one. Known, unfixed on purpose: correcting it
moves the scale enough to change the physics of scenes that currently behave, so it needs a
measured before-and-after rather than a quiet patch.
