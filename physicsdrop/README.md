# Physics Drop v2 — pure geometry layer

Shape pipeline for the planck.js rewrite of `examples/physicsdrop.js`. Everything in `src/` so
far is **pure**: plain number arrays in, plain number arrays out, no Affinity API, so it is
verified headlessly instead of by running the script.

```
contours.js   rings -> faces      signed area, containment, nesting depth (even = solid, odd = void)
sanitize.js   face  -> face       dedupe, collinear cull, Douglas-Peucker, winding, area cull
decompose.js  face  -> parts[]    earcut (holes native) -> Hertel-Mehlhorn -> convex parts <= 12 verts
flatten.js    beziers -> ring     adaptive subdivision on flatness, then the base->spread matrix
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
node physicsdrop/test/run.js     # exit code is non-zero if anything fails
node physicsdrop/test/bench.js   # regenerates the fixture-count table below
```

## Building

```sh
node physicsdrop/build.js          # writes dist/physicsdrop.js
node physicsdrop/build.js --check  # non-zero exit if dist/ is stale
```

`dist/physicsdrop.js` is **generated** — the reviewable diff is `src/`. It is committed anyway
because it is the artefact that actually gets pasted into Affinity.

Everything travels inline in one file. The sandbox's `/fs` module denies **every** path, so a
script cannot load its own code from disk at runtime; a 433KB script is imported and parsed
intact, so inlining is the supported route rather than a workaround.

Each vendored library is wrapped in its own private `module` object. Both UMD bundles resolve to
their CommonJS branch in the sandbox, so evaluated bare they would assign to the host script's
`module.exports` and the second would clobber the first.

Three invariants run on every decomposition case (`test/invariants.js`):

1. **Area conservation** — `sum(part areas) == area(outer) - sum(hole areas)`, within 0.1%.
2. **Convexity** — every part convex, positively wound, within the vertex cap.
3. **Hole exclusion** — grid-sampled points strictly inside a hole land inside no part.

`test_decompose.js` also runs them against a deliberately broken decomposition (the outer ring
taken whole, hole ignored — the v1.1 failure mode) to prove the invariants actually fire.

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
dropping geometry. `decompose` therefore enforces the cap itself, and `PD.MAX_VERTS` is the one
place it is written down.

Simplification is the dominant lever on fixture count; the vertex cap is a minor one. Regenerate
this table with `node physicsdrop/test/bench.js`:

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

## Settling

`world.setAllowSleeping(true)` and "every body asleep" replace v1.1's `stillFrames` /
`flatSupport` / `stuckFrames` / `slowFrames` / `touchedSleeper` heuristics and its hard stops.

One backstop remains, for a case sleeping cannot handle. planck sleeps an island only when the
position solver has converged too — `minSleepTime >= timeToSleep && positionSolved`. A **compound**
body that starts deeply embedded in static geometry never converges: its fixtures penetrate the
same wall and impose corrections that cannot all be satisfied at once, the wall cannot move
aside, and per-step correction is capped. The body then sits at exactly zero velocity, awake,
indefinitely. A single-fixture body does not reproduce this — it just pushes itself out.

Artwork dropped already overlapping its container does exactly this, so `run()` also stops when
every body has stayed under planck's own sleep velocity thresholds for `quietFrames` (30, one
second) and reports the offending bodies in `staticOverlaps`. `settledBy` says which rule ended
the run: `sleep`, `quiescence` or `cap`.

Drops are reproducible: pass a `seed` and the initial tie-breaking jitter is deterministic.
v1.1 seeded from `Date.now()`, so a result the user liked could never be recovered.

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
- **Live text is skipped** unless "Convert text to curves" is ticked, which runs
  `DocumentCommand.createConvertToCurves` as its own undo step and then extracts the resulting
  `PolyCurveNode`s through the ordinary vector path. `curvesInterface.polyPolyCurves` does expose
  one `PolyCurve` per glyph, counters included, and `textPolicy: 'glyphs'` reads them directly —
  but the coordinate space `getTransformedPolyCurve(i)` returns is not established: in a real
  document the letters fell correctly and collided with nothing, which is how a body far from
  where it renders behaves. Conversion is the reliable route until that is probed.
- Classification order matters: an `ImageNode` also has `curvesInterface`, so the image test comes
  before the vector test. An image becomes its placement rectangle and is marked `approximate`;
  `imagePolicy: 'refuse'` rejects it instead.
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

`playback.js` writes the recording back to the canvas, ported from v1.1 whose preview/scrub/commit
dance is known to work: `executeCommand(cmd, true)` previews and supersedes the previous preview,
`executeCommand(cmd, false)` commits one undoable step, and `clearPreviews()` drops anything
uncommitted. Scrubbing is therefore cheap — each slider move is one replacing preview rather than
an undo stack to unwind.

Every body is transformed as a delta about its **original centroid**, so the artwork never moves
from its authored position as far as the document is concerned: replaying frame 0 restores it
exactly, and the whole drop stays one undo step.

> **Rotation sign.** v1.1 solved in Affinity's y-down space and applied its body angle straight to
> `Transform.createRotate`. v2 solves in planck's y-up space and `bodyState` negates the angle on
> the way out, so the value reaching `playback.js` is in the same convention v1.1 used — which is
> why nothing negates it again. If objects ever counter-rotate against the simulation, that is the
> only line to flip.

The drop **plays on canvas at a steady 30fps** before the scrubber opens. v1.1 animated while
solving, so a heavy scene ran at whatever rate the solver managed; v2 solves the whole drop first
— a few hundred milliseconds — and replays from the recording, so playback speed is independent of
scene weight and rewatching costs nothing. The Finished dialog is raised from the timer callback,
because `runModal` would otherwise block the timer driving playback.

## Settings

| Control | Maps to |
|---|---|
| Gravity | world gravity, entered in **document units** per second squared and divided by the world scale once |
| Angle | 0 = down the page, 90 = right |
| Max duration | frame cap, at 30fps |
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
from frame 0 up to the frame you keep — the range is only known after scrubbing, which is why the
format choice lives in the Finished dialog rather than the settings one. Cancel never exports:
it means "keep the settled result", not "write three hundred files".

Each frame is **committed**, exported, then undone. A preview is not guaranteed to render into an
export, so this cannot reuse the cheap preview path the scrubber uses. The loop runs on a timer so
the UI is not frozen and a failure can stop cleanly rather than wedging Affinity.

v1.1 created a timestamped output folder with `fsys.createDirectories`. `/fs` denies every path in
this sandbox, so that call throws and folder creation is best-effort: when it fails, frames are
written flat onto the Desktop sharing one timestamped prefix. `doc.export` is a document API rather
than a filesystem one, so it is attempted regardless. Frame numbers are zero-padded to four digits
either way, or a sequence sorts 1, 10, 11, 2 and imports scrambled.

## Not here yet

True silhouettes for placed images — the latter needs
`NodeRenderingEngine` from `/rasterobject` and `PixelReaderRGBA8` from `/pixelaccessor`, both of
which v1.1 already uses. Images currently collide as their placement rectangle.
