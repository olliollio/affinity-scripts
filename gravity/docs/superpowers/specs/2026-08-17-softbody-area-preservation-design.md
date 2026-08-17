# Softbody area preservation

A jelly keeps its shape's area under load. Today it does not: a mass-spring lattice constrains
edge LENGTHS and nothing at all constrains enclosed AREA, so a shape under a pile flattens and the
artwork comes back smaller than it went in.

This is the second half of the softbody work. The first half — self-collision and outline repair —
is shipped and verified: all ten outlines of the reference scene export with zero self-intersections
where four gouged before. What is left is compression.

## The defect, measured

Settled area against rest area, ten-shape scene at softness 25, from a real Affinity run. No folds
remain to contaminate the shoelace, so these are clean numbers:

| teal | grey | orange | blue | amber | cyan | pink | purple | yellowgreen | green |
|---|---|---|---|---|---|---|---|---|---|
| −9.5% | −13.5% | −14.0% | −0.9% | −4.4% | −19.1% | −4.0% | −22.3% | −1.0% | −33.8% |

A pile in Affinity is not a measuring instrument — it diverges chaotically, and a headless replay of
the same scene puts four of the ten shapes somewhere else entirely and compresses about six times
less. So the reference rig for this work is not the scene. It is a **crush bench**: one jelly on the
floor, one rigid slab resting on it whose mass is a stated multiple of the jelly's own. Deterministic,
and the load is a single number.

Measured on the bench at softness 25, area against rest:

| load × own weight | 0 | 2 | 4 | 6 | 8 |
|---|---|---|---|---|---|
| yellowgreen | −0.3 | −0.8 | −1.2 | −1.7 | −2.2 |
| teal | −0.9 | −1.0 | −55.0 | −65.5 | −66.9 |
| green | −2.4 | −4.2 | −24.2 | −40.6 | −45.1 |
| purple | −4.0 | −17.9 | −52.2 | −67.8 | −72.7 |

**LOAD = 4 is the operating point**, because it lands in the same band as the real run. LOAD = 0 is
the control: a jelly resting under nothing but its own weight still loses **0.3% to 4.0%**, and that
number sets the deadband below.

Two further things the bench established:

- **Folding is a crush signature.** Crossings appear only under load — teal has 0 at LOAD 2 and 4 at
  LOAD 4. Repair already guarantees the exported curve is clean, so this is not a correctness issue
  any more, but it does mean area preservation and fold prevention are the same lever.
- **A uniform affine squash of node positions never folds.** Folding needs IRREGULAR displacement.

## Success criterion

**At LOAD = 4, no shape on the bench is under −10% of its rest area.** Today the worst three are
teal −55.0%, purple −52.2% and green −24.2%.

LOAD 6 and 8 are deliberately left alone. A jelly under a pile that heavy should squash; a term
tuned to defeat it would be a rigid body with extra steps, and the force needed would rival gravity.

## The law

Ideal gas, one-sided, with the FORCE capped rather than the pressure. Per ring:

```
ratio = restArea / area                          signed areas, so a sign flip is detectable
P     = gain * P0 * (ratio² − 1)                 0 below, and 0 entirely when ratio < 1 + DEADBAND
P0    = totalMass * g / ringPerimeter
Fnode = clamp(0.5 * P * edgeLength, 0, FMAX)     along the edge's outward normal
FMAX  = FORCE_CAP * nodeMass * g
```

- **`ratio² − 1`** is soft at first and rises steeply: barely present at 10% compression, close to a
  wall approaching 50%. A linear law cannot do both jobs — strong enough to hold purple up under a
  slab, it is already intrusive at rest. Area preservation has to be invisible until it is needed,
  and that requires a superlinear response.
- **One-sided.** Clamped at zero, so the term can only refuse to LOSE area, never add it. A term
  that pushes outward when a shape is larger than rest is what makes pressure models inflate and
  ring, and it buys nothing: no observed failure involves a shape growing.
- **`P0 = totalMass * g / ringPerimeter`** is the load the shape must hold divided by the length
  holding it — a pressure whose units are already right, which is what leaves `gain` dimensionless.
  `totalMass` is the OBJECT's mass, `g` the world gravity magnitude in sim units, and
  `ringPerimeter` that ring's own node-loop perimeter. Every ring of an object uses the object's
  full mass, a counter's ring included: what a counter must resist is the whole object's weight
  bearing on it, not a share apportioned by area. Without this normalisation a fixed gain would be
  overwhelming on a small shape, irrelevant on a large one, and would silently depend on mesh
  resolution.
- **`FMAX`** caps the per-node force. Capping `P` instead would leave the per-node force free by a
  factor of the edge length, which varies across a ring, and a steep law near total collapse can
  otherwise produce a force large enough to break the timestep. Expressing the cap as a multiple of
  a node's OWN weight is what keeps it free of scale.
- **`gain` maps linearly** over 0..1, unlike softness which is log-spaced. Softness is log-spaced
  because droop is strongly non-linear in Hz; here the non-linearity already lives in `ratio²`, and
  a log slider would compound it.

Forces are applied with `applyForceToCenter`. Nodes are `fixedRotation: true`, so applying at a
point would be equivalent — naming the centre form avoids implying a torque that cannot exist.

### Constants

| constant | value | how it was arrived at |
|---|---|---|
| `DEADBAND` | 0.06 | Measured. A jelly settling under its own weight alone loses up to 4.0% (purple), and the term must not fire on that. 0.06 clears every shape on the bench with headroom. |
| `FORCE_CAP` | 8 | Starting point. Pinned on the bench during implementation; this is the number to move if a scene proves unstable. |
| default `gain` | pinned on the bench | The lowest gain that meets the success criterion without a shape gaining area or the run failing to sleep. Recorded in a code comment with the table it came from. |

### Why the deadband is load-bearing

`sim.run` ends when every body is asleep. A term that fired forever would push every jelly scene off
`sleep` and onto the quiescence backstop, which is a real regression in run time and in the report.

Below the deadband `P` is exactly zero, and the force is applied with planck's wake flag **false**.
Together: a shape that settles near its rest area stops generating force and sleeps normally; a shape
genuinely held crushed reaches equilibrium between pressure and the load above it, which is zero
velocity and therefore also sleeps; and an already-sleeping crushed shape is not resurrected, which
is correct, because that equilibrium IS the settled state.

Damping is already present as `NODE_LINEAR_DAMPING = 0.5`. No separate damping term is introduced
until measurement shows one is needed.

### A ring whose area flips sign

If a ring's current signed area approaches zero or flips — which a fold can cause — the ratio is
meaningless and **the term is zeroed for that ring** until the sign recovers.

Driving the force to `FMAX` instead would aim the largest force in the model along a direction
reference that the sign flip is itself evidence of having broken: taken from the rest winding it
pushes the fold deeper, taken from the current winding it has just reversed. Zeroing fires exactly
when the sim is already in trouble, which is the wrong moment to apply maximum force.

## Where each piece lives

**`softmesh.js`** — `ringAreas(mesh, positions)` returns the signed area and perimeter of each ring's
node loop, over `mesh.ringSpans`. Each span is a `{start, count}` over contiguous boundary nodes in
ring order, which is exactly the loop the shoelace formula needs and already exists. Pure geometry,
in sim units, headlessly testable, no planck.

Boundary nodes are inset into the material by `INSET_FRAC`, so an outer ring's node loop encloses
less than the shape and a hole's node loop encloses more than the hole. Rest and current areas are
measured identically, so the ratio is unaffected either way.

Per ring is also what makes holes work with no special case: every ring resists losing its own
enclosed area, and each ring's own signed area AT REST supplies the direction reference. No absolute
winding convention is assumed — which matters, because `insetPoint` states explicitly that ring
winding is not trusted, rings arriving from several sources.

**`softbody.js`** — records each ring's rest area and perimeter at build time, and exports
`softPressurePass(rig, gain)`, which computes the areas and applies the forces. The only place in
this feature that touches planck.

**`sim.js`** — `run` gains one optional `onStep(W, stepIndex)`, invoked immediately before each
`world.step`, defaulting to absent. It counts **steps, not frames**: `stepsPerFrame` is a supported
option that several tests set, and the two diverge whenever it is greater than one.

**`main.js`** — builds the callback. It has to live here rather than in `sim.js` because it needs the
softbody records, and those exist only in what `addSoftBody` returns. main.js closes over its
softbodies and passes the callback to `sim.run`.

**`ui.js`** — a second slider, independent of softness: how strongly a shape resists being squashed,
orthogonal to how readily it deforms. Needs the default beside `softness`, the editor, and the
normalise step, plus option plumbing through main.js into `addSoftBody`.

## Testing

- **The crush bench becomes a test file**, not a scratchpad script: ten shapes from
  `fixtures_softscene.js`, one rigid slab of `LOAD × own weight`, settle, measure. Asserts the
  success criterion at LOAD = 4 and records the LOAD = 0 control, so the deadband's justification
  stays visible.
- **Zero net force.** `Σ (outward normal × edge length) = 0` around any closed loop, so pressure
  cannot thrust an object sideways however lopsided the compression. Asserted directly rather than
  trusted.
- **Gain 0 reproduces today exactly.** Every existing softbody measurement stays valid, and the
  feature is bisectable.
- **No force at rest.** At LOAD = 0 the pass applies zero force on every step, which is the deadband
  doing its job.
- **A scene with pressure active still ends on `sleep`**, not on the quiescence backstop.
- **A flipped ring is skipped** rather than driven, on a hand-built folded fixture.

## Out of scope

- **`SHELL_MIN_FREQ` stays at 28.** It is expected to come down once this lands, because ring
  buckling is this same missing term seen from the other side — nothing resists a counter ovalising.
  That relaxation needs its own measurement of the buckling cliff with pressure active, and the
  floor stays where it is until that exists.
- **The rope shell** — replacing ring `DistanceJoint`s with constraints that resist stretch but not
  compression — attacks the same defect from the constraint side and is parked. Lead with the
  impulse-share measurement (ring springs against attach springs at settle) if it is ever picked up.
- **Fold prevention as a separate goal.** Repair already guarantees a clean exported curve.
