# Softbody self-collision and area preservation — design

Jelly shipped with two defects that share a single root cause: **a mass-spring lattice has no notion
of the material it represents.** Springs resist stretching between the pairs they connect and
nothing else. Nothing tells one arm of a shape that another arm is already there, and nothing tells
a face that it has an area worth keeping. The lattice is therefore free to pass through itself and
free to collapse, and both happen on ordinary artwork.

The two failures are independent, and neither fix subsumes the other.

## What the artwork does

Measured on a ten-shape scene at softness 25 (21.6 Hz), settled, comparing source curves against
exported curves. Areas come from the curves themselves, not from a raster, so occlusion in the pile
does not enter.

| shape        | rest area | settled area | change | self-crossings |
|--------------|-----------|--------------|--------|----------------|
| blue         | 10876     | 10760        | −1.1%  | 0 |
| yellow-green | 11181     | 10994        | −1.7%  | 0 |
| pink         | 3157      | 3079         | −2.5%  | 0 |
| grey         | 3205      | 3085         | −3.7%  | 0 |
| teal         | 6072      | 5754         | −5.2%  | 0 |
| cyan         | 7785      | 5985         | −23.1% | 0 |
| amber        | 10521     | 9652         | −8.3%  | 1 |
| orange       | 11609     | 10163        | −12.5% | 1 |
| purple       | 2488      | 1938         | −22.1% | 1 |
| green        | 3327      | 1659         | −50.1% | 3 |

**Four of ten outlines self-intersect.** A closed curve that crosses itself fills with a hole under
even-odd, so those shapes come back gouged. Only the largest gouge is visible at a glance; the rest
are slivers, which is why the defect survived visual review.

The settled areas of the four folded shapes are not usable as compression evidence: the shoelace
formula counts a folded-over lobe negatively, so part of each of those losses is the fold itself.
**Cyan is the clean datum — 23.1% of its area gone with no crossing anywhere.** That is compression
alone, and it is the case no amount of self-collision would address.

The shapes that fail are the crescents. Blue and yellow-green are thick and hold to within 2%. Grey
at 3205 and green at 3327 are the same size and lose 3.7% and 50.1% respectively, so this is driven
by shape rather than by scale: a thin arm gets few cells across it and so has the least structure to
resist with.

## Part 1 — a shape cannot pass through itself

Every node of a softbody currently carries one circle fixture of radius `0.6 * cell`, all sharing
one negative `filterGroupIndex`. A negative group means *never collide within this group*, so no two
nodes of the same jelly ever generate a contact. When a crescent's upper arm folds over, it enters
the lower arm and keeps going.

The negative group exists for a real reason and it must stay. Node circles are `0.6 * cell` at
`1.0 * cell` spacing, so **neighbours overlap by design** — that overlap is what leaves the union no
gap for a corner to pass through. Simply letting siblings collide would make every shape blow itself
apart on the first step.

### Which pairs may collide, established by measurement

The interior lattice is grid-arithmetic with both diagonals, but **that is interior nodes only** —
`mesh.grid` is keyed `face:col,row` and boundary nodes are never in it. A boundary node is sprung to
exactly three things (`addSoftSprings`): its two ring neighbours `i↔i±1`, every interior node within
`ATTACH_RADIUS = 1.5 * cell`, and up to three cross-face links. Nothing else. So "every adjacent pair
is jointed and therefore already excluded" is **false for boundary nodes**, and the exclusion cannot
be left to `collideConnected` alone.

Measured over all ten shapes of the scene above, meshed at their real cell sizes — every boundary
pair with no spring between it, by distance:

| shape | cell | boundary nodes | closest unjointed pair | ring separation |
|---|---|---|---|---|
| yellow-green | 0.1994 | 28 | **0.408 · cell** | \|i−j\| = 2 |
| pink | 0.1200 | 21 | **0.424 · cell** | \|i−j\| = 2 |
| cyan | 0.1338 | 31 | **0.432 · cell** | \|i−j\| = 2 |
| green | 0.1200 | 21 | **0.499 · cell** | \|i−j\| = 2 |
| grey | 0.1200 | 19 | 0.603 · cell | \|i−j\| = 2 |
| orange, amber, teal, blue, purple | — | 16–34 | 0.73 – 0.95 · cell | — |

Every close pair in that scene is `|i − j| = 2`, the second neighbour along the same ring across a
sharp tip. **That is a property of the sample and not a rule**, and building an index threshold on it
would be wrong. The cause is `insetPoint`: every boundary node is pushed `INSET_FRAC = 0.6 * cell`
into the material from both sides, so wherever the local wall thins to about `1.2 * cell` the two
sides' nodes converge on the same place. The ring separation at which that happens scales as
`1 / sin(half-angle)`, so it walks outward as a tip sharpens. Measured on teardrops — a disc with a
tangent wedge, all of which pass `softCellSize` and all of which are ordinary artwork:

| tip angle | closest unjointed pair | at \|i−j\| | its \|i−j\| = 2 pair |
|---|---|---|---|
| 60° | 0.055 · cell | 2 | 0.055 |
| 47° | 0.419 · cell | 2 | 0.419 |
| 39° | 0.310 · cell | **3** | 0.652 |
| 33° | 0.060 · cell | **4** | 0.588 — outside contact |
| 29° | 0.371 · cell | **4** | 0.496 |

At 33° the closest pair is four apart along the ring while the two-apart pair is outside the contact
distance entirely, so any `|i − j| ≤ 2` rule fires nothing and the shape explodes.

### The design

**A brace, by distance and not by index.** Every unjointed boundary pair that starts closer than the
self-contact distance gains a spring. There is no ring-separation threshold, and the tip/neck
distinction is not drawn at all — it does not need to be. A pair already inside contact distance at
rest could never be pushed apart by that contact without the shape inflating, and a genuinely thin
neck is already touching, so a contact there buys nothing either way.

This makes a frame-0 explosion **impossible by construction**: after bracing, every remaining
unjointed pair is outside the contact distance by definition. The property is structural rather than
a margin that a future shape might exceed.

Bracing reuses the existing `collideConnected: false` exclusion rather than inventing a filter.
planck 1.5.0 offers no world-level contact filter — `shouldCollide` is a `Fixture` method invoked as
`fixtureB.shouldCollide(fixtureA)` — so a joint is the only per-pair exclusion available without
patching a vendored library. `Body.shouldCollide` walks the joint list and never inspects joint
state, so the exclusion holds regardless of how the brace behaves numerically. A brace can be shorter
than `linearSlop` (0.005 sim units) on a very sharp tip; planck's `DistanceJoint` zeroes its
direction vector below that and simply contributes no impulse, which is harmless and must not be
"fixed" — `MIN_CELL_SIM`'s note about short constraints jittering does not apply to a constraint that
carries no impulse.

The brace threshold uses the **default** contact distance, fixed at `0.5 * cell`, so the brace set
never depends on anything computed later.

**A brace only ever spans material, never a gap.** This is the invariant that makes an unbounded
index rule safe, and it follows from `insetPoint` moving every boundary node *into* the material:
across any gap the node separation is `gap + 2 * INSET_FRAC * cell`, at least `1.2 * cell`, which is
never inside a `0.5 * cell` contact distance. Measured on a "C" — an annulus with a wedge removed —
at eight apertures from 0.6 rad down to 0.015 rad, a mouth nearly shut: **no brace spans the mouth in
any of them.** A "C" cannot be welded into an "O". The braces that do fire are at the sharp corners
of the cut faces, across material.

Bracing a genuinely thin *wall* is possible but confined to a narrow band, because two suppressors
work against it: below about `1.2 * cell` of wall, `insetPoint`'s both-directions-fail fallback
leaves nodes un-inset and therefore too far apart to brace, and opposing walls resample independently
so the closest cross-wall pair is `sqrt(gap² + offset²)` with a stagger of up to half a cell. Where a
brace does land on a wall it pins that wall's thickness against both closing and opening. planck
1.5.0 has no minimum-distance constraint — `enableLimit` belongs to prismatic, revolute and wheel
joints, and `RopeJoint`'s `m_maxLength` is a maximum — so a one-sided "resist closing, free to open"
brace cannot be expressed, and a two-sided `DistanceJoint` at the one place the lattice had no cross
structure at all is the accepted trade.

Braces take the **same frequency and damping as every other spring** in the rig. This matters because
a brace permanently removes that pair's contact: a brace soft enough to be pushed through would let
the two nodes pass with nothing at all to stop them. No new knob is introduced.

The scan covers **every boundary node of the object** — across the rings of a face and across faces —
not each ring in isolation. A cross-ring or cross-face pair scoped out of the scan would explode at
frame 0 and would break the "impossible by construction" property outright.

**A second fixture per boundary node**, radius `0.25 * cell`, reserved for self-contact:

- The existing `0.6 * cell` fixture is unchanged and keeps the negative group. It remains the only
  thing that touches the world, the walls and other jellies.
- The new fixture carries `filterGroupIndex: 0` and a category bit masked against **itself and
  nothing else**. The group index must be zero: in planck a matching non-zero group short-circuits
  category and mask entirely, so inheriting the body's negative group would leave the feature inert
  while looking implemented.
- `density: 0`. Node mass is solved backwards from a target — `nodeDensity = perNode / (π · r²)` —
  so a second fixture with density would add roughly 25% mass per node, break the "a jelly weighs
  what the rigid body would have weighed" invariant, and invalidate the measured stiffness table.
- `rec.fixtures` becomes 2 on a boundary node so the record does not lie. Nothing reads it for a
  soft node — `main.js` prints `fixtures=` only in the rigid `addBody` branch — so this changes no
  output.

**`0.25 * cell` is a constraint, not a preference.** The repo's primary stiffness fixture, a 300pt
square blob, meshes to a closest unjointed pair of `0.566 * cell` at an ordinary 90° corner (the bold
"O" is clear at 1.199). At `0.3 * cell` the contact distance would be `0.6 * cell` — wider than that
corner — so braces would fire on all four corners of the fixture the stiffness table was measured on,
and the table would move. At `0.25 * cell` the contact distance is `0.5 * cell` and no brace fires on
either fixture, so every existing measurement stands.

Interior nodes get no self-contact fixture: contacts scale with the perimeter rather than the area,
and only the boundary can fold visibly. That second clause is an **assumption, not a construction** —
`bindOutline` skins the drawn outline from the four nearest nodes over the whole mesh, interior
included, so an interior node does influence the curve. The crossings test below is the arbiter; if
folds survive it, the fixture extends to interior nodes and the cost goes up.

**The shell does not seal, and is not claimed to.** Boundary nodes sit about `1.0 * cell` apart, so
`0.25 * cell` circles leave `0.5 * cell` gaps between consecutive self-contact fixtures. This blocks
node-against-node approach, not passage of a single node between two others. A fold brings whole arms
together rather than one node, so this is expected to suffice — but it is a probabilistic argument
and the crossings test is what settles it.

### What replaces the guard

Because bracing is defined by the contact distance itself, there is no residual case to guard
against and no per-shape radius to shrink. What remains is **reporting**, and one degenerate shape.

`addSoftBody` records how many braces it added and the largest ring separation any of them spanned.
A shape needing braces across most of its boundary is a hairline that has been meshed into a
near-rigid chain, and the record carries a flag main.js reports in the same voice as the fold
report. It is never silently dropped: a jelly that quietly cannot self-collide looks exactly like the
bug being fixed.

The brace count is also the diagnostic that makes the `insetPoint` behaviour visible. That routine
only checks `pointInFace`, so at a sharp taper it will push a node past the shape's centreline onto
the far side, which is what produces the 0.060 `cell` figures above. That is a latent mesh defect
rather than this work's problem, but the brace count is where it will show up first.

## Part 2 — a face keeps its area

`sim.run` gains one optional `onStep(W, stepIndex)` callback, invoked immediately before each
`world.step`. It counts **steps, not frames** — `stepsPerFrame` is a supported option that several
tests set, and the two diverge whenever it is greater than one. It defaults to absent.

The callback is built in **main.js**, not in `sim.js`, because it needs the softbody records — mesh,
per-ring rest areas, `totalMass` — and those exist only in what `addSoftBody` returns. `softbody.js`
exports the force pass; main.js closes over its softbodies and passes it to `sim.run`.

The force pass works **per ring**, using `mesh.ringSpans` — each entry is a `{start, count}` over
contiguous boundary nodes in ring order, which is exactly the loop the shoelace formula needs and
already exists:

1. At build time, record each ring's signed area over its boundary nodes at rest.
2. Each step, recompute the signed area from current node positions.
3. `ratio = restArea / area`, comparing **signed** areas so the sign carries.
4. For each edge of the ring, push both endpoints along the edge's outward normal with
   `0.5 * P * edgeLength`.

Per ring is what makes holes work without a special case: every ring resists losing its own enclosed
area, and each ring's **own signed area at rest** supplies the reference direction. No absolute
winding convention is assumed — which matters, because `insetPoint` states explicitly that ring
winding is not trusted, rings arriving from several sources.

Boundary nodes are inset into the material, so an outer ring's node loop encloses less than the
shape and a hole's node loop encloses more than the hole. Rest and current areas are measured
identically, so the ratio is unaffected either way.

If a ring's current area approaches zero or flips sign — which a fold can cause — the ratio is
meaningless. **The term is zeroed for that ring** until its sign recovers. Driving the force to
`FMAX` instead would aim maximum force along a direction reference that the sign flip is itself
evidence of having broken: taken from the rest winding it pushes the fold deeper, and taken from the
current winding it has just reversed. Zeroing fires exactly when the sim is already in trouble, which
is the wrong moment to apply the largest force in the model.

### The pressure law

Ideal gas, one-sided, with the **force** capped rather than the pressure:

```
P     = gain * P0 * (ratio² − 1),  clamped at 0 below, and 0 entirely when ratio < 1 + DEADBAND
Fnode = clamp(|0.5 * P * edgeLength|, 0, FMAX) along the edge's outward normal
FMAX  = FORCE_CAP * nodeMass * gravity
```

Capping `P` would leave the per-node force free by a factor of the edge length, which varies across a
ring. `FMAX` is expressed as a multiple of a node's own weight so it carries no hidden dependence on
scale, and `FORCE_CAP` is the number to tune if a scene proves unstable.

Constants, all to be pinned by measurement during implementation and stated in code comments the way
the stiffness table is: `DEADBAND` starting at 0.02, `FORCE_CAP` starting at 8. The slider maps to
`gain` **linearly** over 0..1 — unlike softness, which is log-spaced because droop is strongly
non-linear in Hz. Here the non-linearity already lives in `ratio²`, so a log slider would compound
it.

The force is applied with `applyForceToCenter`. Nodes are `fixedRotation: true`, so applying at a
point would be equivalent, and naming the centre form avoids implying a torque that cannot exist.

A closed ring's pressure sums to **zero net force**, since `Σ outwardNormal · edgeLength = 0` around
any closed loop. That is why the term cannot thrust an object sideways however lopsided the
compression, and it is worth asserting directly rather than trusting.

- **`ratio² − 1`** is soft at first and rises steeply — barely present at 10% compression, close to
  a wall approaching 50%. A linear law cannot do both jobs at once: strong enough to hold cyan up
  under a pile, it is already intrusive at rest. Area preservation must be invisible until it is
  needed, and that requires a superlinear response.
- **One-sided** — clamped at zero, so the term can only refuse to lose area and never add it. A term
  that pushes outward when a shape is *larger* than rest is what makes pressure models inflate and
  ring, and it buys nothing here: no observed failure involves a shape growing.
- **`P0 = totalMass * gravity / ringPerimeter`**, where `totalMass` is the **object's** mass, gravity
  is the world's gravity magnitude in sim units, and `ringPerimeter` is that ring's own node-loop
  perimeter. Every ring of an object uses the object's full mass, including a counter's ring: the
  load a counter must resist is the whole object's weight bearing on it, not a share apportioned by
  area. This normalisation is what makes the slider mean the same thing across cell sizes, shape
  sizes and artwork scales — without it a fixed gain would be overwhelming on a small shape and
  irrelevant on a large one, and would silently depend on mesh resolution.
- **`FMAX`** caps the per-node force, because a steep law near total collapse can otherwise produce
  a force large enough to break the timestep.

**A deadband, and no forced wake.** Below a small compression threshold `P` is exactly zero, and the
force is applied with planck's wake flag **false**. Together these are what keep the run loop's
termination intact: `sim.run` ends when every body is asleep, so a term that fired forever would push
every jelly scene off `sleep` and onto the quiescence backstop. With a deadband a shape that settles
near its rest area stops generating force and sleeps normally; a shape genuinely held crushed reaches
equilibrium between pressure and the load above it, which is zero velocity and therefore also sleeps.
Not waking means an already-sleeping crushed shape is not resurrected, which is correct — that
equilibrium is the settled state.

Damping is already present as `NODE_LINEAR_DAMPING`; no separate damping term is introduced until
measurement shows one is needed.

### The setting

Softness stays as it is. Area preservation is a **second, independent slider** — how strongly a
shape resists being squashed, orthogonal to how readily it deforms. It needs `ui.js` (the default
beside `softness`, the editor, and the normalise step) and option plumbing through main.js into
`addSoftBody`.

Gain 0 reproduces current behaviour exactly, which keeps every existing measurement valid and makes
the feature bisectable.

`SHELL_MIN_FREQ` is expected to come down from 28 once this lands, because ring buckling is this
same missing term seen from the other side: nothing resists a counter ovalising. That relaxation is
**not** part of this work — it needs its own measurement of the buckling cliff with pressure active,
and the floor stays where it is until that exists.

## Order, and why

Self-collision first. It is contained to `softbody.js` and `softmesh.js`, it fixes four of the ten
observed defects outright, and it adds no new force law — it does add brace springs to the rig, but
no mechanism that did not already exist — so if the pressure term later needs
tuning, it is being tuned against a lattice that can no longer pass through itself. Landing them
together would leave two variables moving at once across every measurement.

## Testing

Headless, in `test_softbody.js` and `test_softmesh.js`:

- The ten shapes of the scene become a fixture. The four that fold assert their crossing **depth**
  falls under one cell and their settled area recovers toward rest; the six that do not fold assert
  they still do not. `outlineFolds` already exists and is already tested against bowties, concave
  L-shapes and lobes folded back through an edge, and gains a companion that reports depth.

  **Zero crossings is not reachable and must not be the criterion.** `INSET_FRAC` and `RADIUS_FRAC`
  are both 0.6 by design — that identity is what makes the union of node circles reproduce the drawn
  silhouette — so the drawn outline sits `0.6 * cell` outside the boundary-node ring. Self-contact
  begins at `0.5 * cell` of node separation, by which point the two drawn surfaces have already
  passed through each other by `2(0.6) − 0.5 = 0.7 * cell`. The design therefore bounds crossing
  depth at roughly `0.7 * cell` rather than eliminating crossings, and on this scene's cell sizes
  that is 8–14pt. An implementer told to reach zero would build this correctly and watch the headline
  test fail with no way to know the target was impossible.
  **A fixture built from exported SVG must have its repeated closing point stripped** — a
  zero-length final segment scores one phantom crossing, so a clean square would read as folded.
  Gravity's own rings are unaffected, since `flatten.js` and `sanitize.js` both drop it.
- **No *unjointed* boundary pair starts inside the self-contact distance** — the wording matters,
  since braced pairs are inside it by definition and an unqualified form could never pass. This is
  the frame-0 assertion, and it must be asserted over the ten scene shapes *and* the teardrop sweep,
  because the scene alone does not exercise `|i − j|` above 2.
- Brace count is non-zero on the four affected scene shapes and **zero on the 300pt square blob and
  the bold "O"** — the assertion that pins the radius at `0.25 * cell`, since the blob's corners
  brace at any radius from `0.35 * cell` up and the stiffness table would move with them.
- Every brace spans material, on all fixtures including the "C" sweep.
- On at least one teardrop the closest unjointed pair is **more than two apart along the ring**.
  Stated structurally on purpose: exact per-shape brace counts must stay diagnostics rather than
  assertions, because measured closest-pair distances cluster within a few hundredths of a cell of
  the threshold and flip under a change in flattening resolution or cell size. That is the same
  argument `SHELL_MIN_FREQ` makes about the buckling cliff — a number that moves with resampling is
  not a property of the shape. Any teardrop fixture must carry its construction (disc radius, apex at
  `R / sin(half-angle)`, segment count) in the test, since two reasonable constructions already
  disagree on which separation is closest.
- A hairline shape sets the brace-count flag and is reported rather than silently degraded.
- Node mass is unchanged by the second fixture.
- Ring area loss under load falls below a threshold at maximum gain, and reproduces today's figure
  at gain 0.
- A counter does not close: signed area and pressure direction are correct for a hole.
- At gain 0 the stiffness table, the span table and settle behaviour are unchanged. At gain above 0,
  `settledBy` must still be `sleep` rather than the quiescence backstop — that is the deadband's own
  test, and the failure it guards against is a feature that silently doubles every run.

Assertions on a self-intersecting outline must not use shoelace area, for the reason given above.

## Rejected alternatives

**Pressure alone, without self-collision.** The original design rejected a pressurised boundary ring
as a *replacement* for the lattice. It must also be rejected as a complete fix here, for a sharper
reason: pressure is indifferent to folding. An arm folding onto another arm changes the enclosed
area barely or not at all, so the term is satisfied while the outline crosses. It cannot address
four of the ten defects.

**Self-collision alone, without pressure.** Cyan loses 23.1% of its area with no crossing at all.
Contacts cannot supply a restoring force toward a rest area they know nothing about.

**One fixture with a smaller radius for everything.** Shrinking the single collider to `0.25 * cell`
would let siblings collide without a second fixture, but the `0.6 * cell` overlap is what leaves the
union no gap for a corner to pass through. It trades a self-intersection bug for a tunnelling bug.

**Enabling self-collision through the group filter alone.** A positive `filterGroupIndex` forces
collision and bypasses category and mask entirely, so the self-contact fixture would also collide
with the ground and with every other object.

**Sizing the self-contact radius per shape from the closest unjointed pair, with no brace.** The
pairs measured at 0.408–0.499 `cell` would force a radius near `0.18 * cell` on ordinary artwork,
leaving `0.64 * cell` gaps between consecutive fixtures — wider than the fixtures themselves. A 33°
teardrop would force `0.027 * cell`. The shape most in need of self-collision would get the weakest
shell, because a crescent has the sharpest tips.

**Bracing only pairs within a fixed ring separation.** An index threshold looks natural because every
close pair in the ten-shape scene is `|i − j| = 2`, but the band moves outward as `1 / sin(half-angle)`:
measured, 39° puts it at 3 and 33° at 4, where the two-apart pair is outside the contact distance and
a `≤ 2` rule fires nothing at all. Any fixed width is a shape sharp enough to defeat it. The distance
rule has no threshold to get wrong.

**Patching `Fixture.prototype.shouldCollide` to filter pairs directly.** This is the only way to
express arbitrary per-pair exclusion in planck 1.5.0. It is rejected because it modifies vendored
library behaviour from application code, and because the brace achieves the same exclusion through a
mechanism the rig already uses.

**A self-contact radius of `0.6 * cell`, matching the inset.** This is the only radius that removes
residual crossings entirely, since contact would begin exactly as the drawn surfaces meet. It is
rejected on measurement: the 300pt square blob braces its four corners at any radius from
`0.35 * cell`, so the stiffness table moves; brace counts reach 14 on a 28-node ring; and the
gap-spanning guarantee expires, because a gap costs `gap + 1.2 * cell` which is outside a
`0.5 * cell` contact but sits exactly at a `1.2 * cell` one — so a nearly-closed "C" could weld shut,
reintroducing the worst available failure in order to remove a bounded one.

**An offset self-contact circle**, placed `0.35 * cell` outward so its surface reaches the drawn
outline. planck supports `new pl.Circle(center, radius)`, but softbody nodes are `fixedRotation:
true`, so the offset direction is frozen at rest orientation and points the wrong way as soon as the
jelly tumbles.
