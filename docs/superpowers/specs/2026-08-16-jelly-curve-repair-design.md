# Repairing a folded jelly curve — design

A jelly whose outline crosses itself comes back gouged: a closed curve that self-intersects fills
with a hole under even-odd, and the hole is in the user's artwork. Self-collision reduced the
interpenetration that causes it but **cannot remove it**, and this is structural rather than a
tuning failure — so the last defence is the curve itself, repaired on the way out.

## Why physics cannot finish this job

`INSET_FRAC` and `RADIUS_FRAC` are both 0.6 by design: that identity is what makes the union of the
node circles reproduce the drawn silhouette. The drawn outline therefore sits `0.6 * cell` **outside**
the boundary-node ring, while self-contact begins at `0.5 * cell` of node separation. Two arms that
rest against each other perfectly legally have already overlapped **`0.7 * cell`** on paper.

Measured on the real ten-shape scene, exported from Affinity, before and after self-collision landed:

| | shapes folded | total crossings |
|---|---|---|
| before self-collision | 4 of 10 | 6 |
| after self-collision | 5 of 10 | 6 |

Self-collision did what it was built to do — settled arm separation went from `0.052 * cell` to
`0.465 * cell`, and the three worst-compressed shapes recovered area (green +7.8 points, cyan +7.5,
teal +2.6) — and the artwork still came back gouged. Raising the self-contact radius to close the
0.7 gap was measured and rejected: it moves the stiffness table, welds up to 14 pairs on a 28-node
ring, and lets a nearly-closed "C" weld shut.

So the curve is repaired instead. Unlike every physics approach this one is **guaranteed rather than
probabilistic**, because it operates on exactly the geometry that gets written to the document.

## The algorithm

A crossing splits a closed ring into exactly two closed loops, both passing through the crossing
point. **Keep the larger; discard the smaller.** A fold is the smaller lobe by construction, so no
heuristic is needed to decide which is which.

1. Scan segment pairs for the first proper crossing — shared endpoints excluded, parameters strictly
   inside both segments so touching does not count.
2. Build both loops: `[X, v(i+1) … v(j)]` and `[X, v(j+1) … v(i)]`.
3. Keep whichever has the larger absolute shoelace area, accumulating the discarded area.
4. Repeat until no crossing remains, or a pass cap is hit.

Winding needs no special case. Both candidate loops are built in the ring's own traversal order, so
a hole ring keeps its opposite winding for free — which was the part most likely to need one.

Measured on the settled artwork, repairing each ring:

| shape | crossings | loops removed | area lost | of shape | time |
|---|---|---|---|---|---|
| orange | 2 → 0 | 2 | 25 | 0.25% | 0.94 ms |
| amber | 1 → 0 | 1 | 181 | 1.93% | 0.56 ms |
| cyan | 1 → 0 | 1 | 131 | 1.99% | 0.53 ms |
| purple | 1 → 0 | 1 | 0 | 0.01% | 0.20 ms |
| green | 1 → 0 | 1 | 4 | 0.22% | 0.16 ms |
| the other five | 0 → 0 | 0 | 0 | 0.00% | — |

**Six crossings to zero, worst case 1.99% of a shape's area, 8 ms for the whole scene.**

### The safety valve

"Keep the larger loop" is wrong if a shape folds so catastrophically that the fold exceeds what it
folded out of. If the total discarded area exceeds `REPAIR_MAX_LOSS` of the ring's original area —
0.25 to start — **the repair is abandoned for that ring and the original curve is written unchanged**,
with a report. Handing back mangled artwork is worse than handing back folded artwork.

Measured worst case is 1.99%, so this never fires on known work; it is a guard against artwork nobody
has tried. A ring left with fewer than three points is abandoned the same way.

## Where it runs, and when

`repairRing` is pure and lives in `softmesh.js` beside `outlineFolds`, headlessly testable. It is
called from `playback.js` immediately after `GR.evalSoftOutline` and before `transformRing`, so it
operates in the space the physics ran in and the transform back to base space is untouched.

**On commit, never on preview.** `preview()` and `commit()` share `commandForFrame`, but a preview
never persists — the document is untouched until the Finished dialog resolves. At 8 ms per scene,
repairing every preview frame would consume half the 16 ms budget at 60fps, and playback was measured
at 64.6fps drawing a full rope. A `repair` flag therefore threads `commandForFrame → softCommands`,
defaulting to false, and `commit` passes true. This is the same idiom the fold report already uses:
once on the frame that matters, never per playback frame.

The accepted consequence: **the preview can show a fold that the committed artwork will not have.**
That mismatch is in the safe direction — the result is always better than what was previewed — and
the alternative is a measurably slower scrub that grows worse with shape count.

## Reporting

Always on, and always reported. Repair silently alters the user's geometry, so silence would be
wrong. The `soft` report line gains the loops removed and the fraction of area lost, and an abandoned
repair says so explicitly in the same voice as the fold report.

There is no setting. A self-intersecting closed curve is never a thing anyone wants, so an "off"
switch would only ever produce gouged artwork; the safety valve already covers the case where repair
would do harm.

## Testing

Pure, in `test_softmesh.js`:

- A clean square and a clean circle are returned unchanged — no points moved, no area lost.
- A bowtie repairs to a simple ring with no crossings.
- A lobe folded back through an edge loses exactly that lobe: crossings reach zero and the discarded
  area matches the lobe's own area.
- A hole ring keeps its winding sign through repair.
- The safety valve abandons the repair and reports when the loss exceeds the cap, returning the input
  unchanged rather than a mangled ring.
- Idempotence: repairing an already-repaired ring changes nothing.
- The five folded rings from the real scene each reach zero crossings, and the six clean ones are
  untouched — the fixture that makes this concrete rather than theoretical.

The scene fixture already exists as `gravity/test/fixtures_softscene.js`; its **settled** outlines
need adding, since it currently carries only the rest shapes.

## Rejected alternatives

**Re-tracing the union boundary** — treating the self-overlap as a union rather than an error, so the
fold becomes a bulge and no area is lost at all. Correct, and it needs a robust polygon-boolean
implementation with its own degenerate-case burden. Rejected on cost against a measured worst case of
1.99% area loss, which is imperceptible on artwork of this kind.

**Relaxing the outline points apart before writing** — nudging crossing points until the curve is
simple. It has no termination guarantee, it moves points that were not part of the fold, and it would
have to run to convergence per frame.

**Raising the self-contact radius so surfaces meet when node circles do.** Measured and rejected in
the self-collision design: at `0.6 * cell` the stiffness fixture braces its corners, brace counts
reach 14 on a 28-node ring, and the gap-spanning guarantee expires so a nearly-closed "C" can weld
shut. It trades a 2%-of-area cosmetic loss for the worst failure available.
