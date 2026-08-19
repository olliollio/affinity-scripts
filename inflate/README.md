# Inflate

Give a flat vector shape the look of an inflated pillow, in one step, without adding nodes. The
result is a curve you can still edit as the shape you drew.

> **Using the script rather than working on it?** See **[MANUAL.md](MANUAL.md)**. This file is for
> people reading `src/`; the manual is for people running it in Affinity.

## What "inflated" means here

Two different effects go by that name, and this builds the second.

**Offset** moves every boundary point outward by the same distance. Corners round off uniformly and
a thin arm grows as much as a fat body. It reads as a fatter outline.

**Pillow** grows a shape by the room available inside it. A fat body swells, a thin arm barely
moves, and the edges between corners bow. It reads as inflated.

The difference is entirely in what scales the displacement. Offset uses a constant; a pillow uses
the **local thickness** — how far it is across the material at that point. Measured on a 200x200
square against a 20x200 slab at 50%, the square's edge moves 50.07 and the slab's 5.10, a ratio of
9.8:1 where an offset would tie at 1.0. That ratio is the whole feature, and one of the invariants
asserts it.

## Why this is not part of `gravity`

`gravity` simulates. This does not: no timestep, no solver, no world scale, no planck, no
convergence criterion. Every output point is a closed-form function of the input geometry and two
numbers.

`gravity` also demonstrates the trap this exists to avoid. Its softbodies flatten every curve to a
polyline so the physics can step them and write the result back with `lineToXY`, so a smooth input
returns faceted, and no amount of mesh resolution fixes it — the curve stopped existing before the
mesh was built. Inflation never flattens the output. Flattened rings are used only to **measure**;
what is written back is the original Béziers with moved anchors and recomputed handles.

## Layout

Everything except `main.js` and `ui.js` is **pure**: plain numbers in, plain numbers out, no
Affinity API, so it is verified headlessly rather than by running the script.

```
thickness.js  curves -> faces, signs, and the local thickness at any boundary point
inflate.js    anchors and handles in, anchors and handles out. The displacement rules
ui.js         two sliders
main.js       reads the selection, writes it back. The ONLY file touching the Affinity SDK
```

Three of `gravity`'s pure-geometry modules are reused **by path reference, not by copy**:

```
../gravity/src/contours.js   buildFaces (rings -> outer-plus-holes by nesting depth), signedArea
../gravity/src/flatten.js    flattenSegments, invertMatrix, transformRing
../gravity/src/softmesh.js   distanceToRings, pointInFace, ringCrossings
```

That split is deliberate and worth not "tidying": runtime geometry is reused **by reference**, where
drift is dangerous because behaviour must match and a stale copy fails silently; the build and test
harness are **copied**, where drift is harmless because the two scripts legitimately differ. If a
third script ever appears, extract the assertion helpers only and leave each script its own loader.

## Running the tests

```
node inflate/test/run.js
```

Everything but `main.js` and `ui.js` runs headlessly. `main.js` and `ui.js` are exercised against
stubs that offer exactly the SDK's documented surface and nothing else, so calling a method that
does not exist fails there with the same `TypeError` Affinity raises.

## Building

```
node inflate/build.js            # writes inflate/dist/inflate.js
node inflate/build.js --check    # verifies the committed output is current, exit 1 if not
```

One concatenated file, because the Affinity sandbox denies `/fs` for every path: a script cannot
load its own code from disk at runtime, so everything travels inline.

`build.js` guards both directions. `read()` catches a file named in `SRC` but absent from disk;
`checkSrcComplete()` catches the opposite, which is the one that fails quietly — a `src` file that
exists and was never added to `SRC` ships nothing, and `--check` still passes, because `--check`
only compares `dist` against what `SRC` named.

## How it works

### Local thickness

`t` is measured per SEGMENT, probed at the segment's **curve** midpoint `B(0.5)`, never the chord
midpoint. On a quarter-arc of a disc of radius `R` the chord midpoint sits `0.293R` inside the
material and the probe returns `1.71R` instead of `2R`.

The probe finds the largest disc tangent to the boundary at that point, by bisection. It is well
posed with no second root: `dist` is 1-Lipschitz in `r` and `|dC/dr| = 1`, so `dist(C(r)) - r` is
non-increasing and the satisfying set is exactly `[0, r*]`. That holds on concave shapes too, which
is what makes bisection legitimate rather than merely convenient.

`tau` is **load-bearing, not slack**. With `tau = 0` every curved probe returns ~0 — a disc of
radius 100 measures 0.002. The reason is not that the probe point is off the ring: `flatten.js`
subdivides at `t = 0.5`, so `B(0.5)` IS a flattening vertex and its own distance to the ring is
exactly zero. The deficit lives in the neighbouring chords, which cut inside the true arc. A
"measure the local deficit at the probe point" variant does not work, for that reason.

`tau` costs accuracy in one direction: it inflates the probe radius by `tau/(1 - cos th)` where `th`
is the angle between the binding wall and the probe path. Head-on that is exactly `tau` on `t`;
across a convex corner it is not — on a 300x100 rounded rectangle the binding walls are the top and
right edges at 45 degrees, giving `6.8*tau`.

The flatten tolerance is **relative** to the face's bounding box, not the absolute 0.1 of
`flatten.js`. `tau` is built from it and `tau` bounds the accuracy of `t`, so an absolute tolerance
makes the error scale-dependent: measured on a slab at 0.005x it gives -600%, against an identical
1.0% at every scale for a relative one.

### The anchor measure

An anchor takes its own probe where that probe is well posed, and the larger of its two adjacent
segments where it is not.

The largest tangent disc at a **convex corner** has radius zero — the nearest boundary point to a
nearby interior point is not the corner itself — so probing at anchors returns near zero at every
corner of a polygon, and a square, whose only anchors are corners, would come back unchanged. But
the probe is not worthless everywhere: at a smooth anchor it is the more accurate measure, and on a
rounded rectangle taking the larger adjacent segment instead over-reports by 2.5x at exactly the
anchors where nothing was wrong.

A fixed floor cannot separate those two cases. A convex corner of interior angle `th` caps its own
probe at `tau/(1 - sin(th/2))` — 3.41 at 90 degrees, 5.24 at 108, 7.46 at 120 — so any fixed
multiple of `tau` is right for one angle and wrong for the rest. Rearranged, a purely corner-limited
probe satisfies `2*r*(1 - sin(th/2)) == 2*tau` **exactly, at every angle**, while a probe stopped by
real material comes in under that. `|n_in + n_out| / 2` IS `sin(th/2)`, and the bisector already
computes it, so the test costs nothing.

That expression carries two rules. `sin` is not injective over a full turn, so a reflex angle and
its convex complement share a `sinHalf` — a star's 249.6 degree notch and a 110.4 degree corner both
give 0.8208. Reflex vertices are therefore rejected too, which is wanted, but for the separate
reason that the larger neighbour is the thickness belonging to that anchor. The flag is called
`useOwnProbe` because it names a decision, not a defect in the probe.

### Ring sign

The edge normal `(ey, -ex)/|e|` points out of the enclosed region of a positively-wound ring and
into it for a negatively-wound one. Multiplying by a per-ring sign makes one formula point away
from the **material** everywhere: outward on an outer ring, into the void on a counter.

The sign is NOT simply `+1` outer / `-1` counter. It is the ring's role times its **own winding**,
because `(ey, -ex)` already points into the void of a negatively-wound hole and needs no flip
there. The original curves are deliberately **not** rewound: reversing them would reorder the output
nodes, and node order is what this feature preserves.

`enforceWinding` is unused for the same reason `buildFaces` can be trusted: `buildFaces` classifies
by nesting-depth parity and never reads winding, and it pushes the caller's own array references, so
a face's ring maps back to the curve that produced it **by identity**. `enforceWinding` returns new
arrays and would break exactly that.

### The two rules

For an anchor `P` with bisector normal `n` and thickness `t`, and a segment `A->B` with handles
`c1, c2`, curve midpoint `M`, midpoint normal `n_M` and thickness `t_seg`:

```
P'      = P + n * amount * t/2
s       = |B' - A'| / |B - A|
h1      = collapsed(c1, A) ? amount*(B - A)/3 : (c1 - A)
h2      = collapsed(c2, B) ? amount*(A - B)/3 : (c2 - B)
M'      = M + n_M * amount * t_seg/2
M_naive = (A' + 3(A' + h1*s) + 3(B' + h2*s) + B') / 8
b       = dot(M' - M_naive, n_M) / 0.75
c1'     = A' + h1*s + n_M*b        c2' = B' + h2*s + n_M*b
```

**The bow is derived, not tuned.** It is exactly the residual between where the pillow surface puts
the segment's midpoint and where the translated, scaled handles already put it, over `0.75` because
that is the midpoint's sensitivity to a symmetric handle offset. There is no gain constant, and the
consequences fall out rather than being asserted: a circle needs no bow at all, because its handles
scaled by `s = 1 + amount` already land the midpoint on the grown circle; a rounded rectangle's flat
sides bulge hard, because their anchors move by the corner arcs' thickness while the side's own
midpoint target is the full half-width.

**Handles must carry a tangential term.** A straight segment's handles sit on its anchors, so a
translate-only rule leaves the outgoing tangent equal to the bow — normal to the edge. Every anchor
would become a 90 degree kink and a square would inflate into four bulges meeting at spikes. Gating
the `chord/3` substitution by `amount` is what keeps `amount = 0` the identity.

**The bow is also the most persistent trap in this file.** It re-derives from `segT` to land the
midpoint on the pillow surface *wherever the anchors ended up*, so it will silently compensate for a
broken anchor rule and fight any cap applied to anchors alone. Every guard below scales the
segment's midpoint target as well as its anchors, and each one learned that separately.

### Guards

The rules above are scaled by the **material thickness**, and nothing in them relates that to the
size of the **feature** it is applied to. Those diverge wherever a small step adjoins thick
material, which is most of what a letterform is. Each guard below is inert where nothing is
degenerating.

| Guard | Catches | Without it |
|---|---|---|
| `COLLAPSE_FLOOR` | Adjacent anchors converging | A capital R's 22.4-long notch closes to 5.8 at 30% |
| `HANDLE_MAX` | A bow overshooting on a chord that never collapsed | Handles at 1.10 of chord, which draws as a loop |
| `CORNER_BOOST_MAX` | A sharp corner falling behind its own edges | A 70 degree tip keeps 57% of its edge's bulge and goes re-entrant |
| `CLOSURE_MAX` | A ring closing past its own width | The A's counter has an inradius of 33.9 and a wall of 90; at 100% it is asked to close by 45 |
| `ROUND_FRAC` | Nothing — it is the user's rounding radius | Sharp corners stay pinched points |

**Corner rounding** is the one guard exposed in the dialog, because how round a corner should be is
taste rather than geometry. Nothing else here can round a corner: this design moves anchors and
recomputes handles but never adds a node, so a corner anchor stays a corner and its output tangent
break comes out at `180 - the input angle`. A capital A's apex reads round not because anything
rounded it but because 110 degrees is already blunt.

Rounding shortens the handles at that anchor to the pillow's depth there **before** making them
collinear. Handle length is what sets the rounding radius, and rotating a handle of 136 without
shortening it sweeps the letterform away — measured, a 40-wide slab came out 117 across instead of
80. Only corners sharper than `ROUND_BELOW_SIN` (85 degrees) are touched, so a square keeps the
pinched corner the design asks for and whose miter shortfall an assertion pins.

## Reading and writing Affinity geometry

Curve coordinates are **BASE** space. `node.baseToSpreadTransform` is the only one of the three
matrices with the ancestors composed into it; `node.transform` is the LOCAL matrix and is wrong by
an artboard's scale.

`createSetCurves` writes **BASE** space, so geometry computed in spread space needs the inverse of
the same matrix it was read with. A freshly drawn node has an identity transform and round-trips
either way, so a missing inverse stays invisible until a moved node is involved — and then it looks
like a displacement bug rather than a transform bug. The suite therefore drives `main()` end to end
against a stubbed SDK and asserts the numbers handed to `CurveBuilder` are the node's own base
coordinates. Asserting the helpers alone is not enough: deleting the `invertMatrix` call passed a
helper-level suite 85 to 0.

`createSetCurves` replaces a node's geometry outright, so a shape and all its counters must be
rebuilt into ONE `PolyCurve` and issued as ONE command. A closed curve is closed with `cb.close()`,
never by repeating the first point — repeating it yields `isClosed false`, which draws closed but
fills wrong, and `isClosed` is read-only.

`app` is not a sandbox global; it is `require('/application').app`. `dlg.runModal()` is compared
through `.value`, because some builds return a result that is not the enum member itself and there a
direct comparison reads every OK as a Cancel — the dialog closes, nothing happens, and there is no
error to explain it.

## Least proven

- **`LINE_EPS`**, the collapsed-handle threshold, is relative (a handle counts as collapsed within
  `1e-6` of the chord length) but its value has not been set from real curve data. The SDK reference
  says a straight segment stores `c1 ~= start`, not `c1 == start`. Logging `|c1 - A| / |B - A|` over
  a drawn rectangle's segments would settle it.
- **Whether displacement should be linear in `t`** is the one shape heuristic left. The bow is
  derived from it rather than tuned alongside it, so there is no second parameter to trade against.
- **Self-intersection is detected but not repaired.** `ringCrossings` is available and the guards
  above keep real artwork clear of it at 100%, but a sufficiently thin crescent can still swallow
  its own concavity.
- **One cubic per segment** cannot follow a bulge across a long edge of varying thickness. Accepted,
  to hold node count; the fallback, if it ever matters, is inserting anchors only where fit error
  exceeds a tolerance — and that breaks the feature's central promise, so it is a user's decision
  rather than an implementer's.
