# Physics Drop v2 — pure geometry layer

Shape pipeline for the planck.js rewrite of `examples/physicsdrop.js`. Everything in `src/` so
far is **pure**: plain number arrays in, plain number arrays out, no Affinity API, so it is
verified headlessly instead of by running the script.

```
contours.js   rings -> faces      signed area, containment, nesting depth (even = solid, odd = void)
sanitize.js   face  -> face       dedupe, collinear cull, Douglas-Peucker, winding, area cull
decompose.js  face  -> parts[]    earcut (holes native) -> Hertel-Mehlhorn -> convex parts <= 8 verts
```

A **ring** is a flat, implicitly-closed coordinate array `[x0, y0, x1, y1, ...]`. A **face** is
`{outer, holes[]}`. A **part** is a convex, positively wound ring that becomes one planck fixture.

Holes are real: neither planck nor Box2D supports a hole in a fixture, so the void is resolved
here, before the engine sees anything. That is what lets a letter drop *inside* a container
instead of resting on its filled counter.

## Running the tests

```sh
node physicsdrop/test/run.js     # exit code is non-zero if anything fails
```

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
| `MAX_VERTS` | `8` | `planck.Settings.maxPolygonVertices` |

Simplification is the dominant lever on fixture count, measured on a 250pt-radius "O" flattened
to 120 segments per ring:

| Input | Parts without simplify | Parts with | Area cost |
|---|---|---|---|
| 250pt "O", 120-segment rings | 137 | **38** | 0.06% |
| 2000-point raster contour | 899 | **44** | <0.5% |
| raster contour + 3 holes | 761 | **108** | <0.5% |

A chord tolerance is blind to feature thickness — 1.5pt of allowed deviation eats a 0.2pt
hairline whole, or flattens the notch out of a thin stem and leaves a solid slab. So the
tolerance is only a starting point: `simplifyWithinBudget` halves it until the ring both survives
and stays within its area budget. Simplification therefore never *deletes* geometry; only the
explicit area rules do.

Sanitising is idempotent, which matters because `decompose()` sanitises its own input and the
pipeline sanitises before calling it.

`test_robustness.js` runs the full invariant set over the input the pipeline will actually meet:
counters touching the outline, holes sharing an edge, 0.2pt hairlines, 4pt glyphs, 20 counters on
one outline, coordinates a million points from the origin, duplicated points, and NaN/Infinity in
the contour.

## Vendored

`vendor/earcut.min.js` — earcut 3.2.3, ISC. See `vendor/LICENSES.md`; note that v3 exports the
triangulator as `exports.default`, and that the UMD build resolves to its CommonJS branch inside
the Affinity sandbox.

## Not here yet

`extract.js` (Affinity node -> contours), `world.js`, `bodies.js`, `sim.js`, `playback.js`,
`build.js` and the planck vendoring. The pure layer was built first because it needs no probe
cycles.
