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
probabilistic** — per ring — because it operates on exactly the geometry that gets written.

## The algorithm

A crossing splits a closed ring into exactly two closed loops, both passing through the crossing
point. **Keep the larger; discard the smaller.** A fold is the smaller lobe by construction, so no
heuristic is needed to decide which is which.

1. Scan segment pairs for the first proper crossing — shared endpoints excluded, parameters strictly
   inside both segments, zero determinant rejected, so touching and collinear overlap do not count.
2. Build both loops: `[X, v(i+1) … v(j)]` and `[X, v(j+1) … v(i)]`.
3. Keep whichever has the larger absolute shoelace area, accumulating the discarded area.
4. Drop any consecutive duplicate point the splice produced.
5. Repeat until no crossing remains, or `REPAIR_MAX_PASSES` is reached.

Winding needs no special case, and this is measured rather than assumed: **0 sign flips across 3648
random self-intersecting rings**, including reversed hole rings and rings whose fold exceeds the
remainder. (Low stakes under even-odd, but it costs nothing.)

**Termination is proven, not hoped for.** Both loops have at least 3 points and together `n + 2`, so
the kept loop is at most `n - 1` — every pass strictly shrinks the ring, bounding the count at
`n - 3`. And every segment of the kept loop is a *sub-segment* of an original segment, so a pass can
never create a crossing that did not already exist. Oscillation is therefore impossible, and crossing
count was measured monotonically non-increasing on every case tried.

`REPAIR_MAX_PASSES` is **`n`**, from that bound, and **reaching it routes into the abandon path
below** rather than writing a partially repaired ring. This matters: a 124-point ring with 40 folds
needs 39 passes, and a fixed cap of 32 would leave 19 crossings in the curve that then gets written —
silently shipping the exact defect this design exists to prevent.

Ties are broken arbitrarily by `>=`. An exact equal-area figure-eight still reaches zero crossings;
which lobe survives is unspecified, and that is fine.

Measured on the settled artwork, repairing each ring:

| shape | crossings | loops removed | area lost | of shape | 
|---|---|---|---|---|
| orange | 2 → 0 | 2 | 25 | 0.25% |
| amber | 1 → 0 | 1 | 181 | 1.93% |
| cyan | 1 → 0 | 1 | 131 | 1.99% |
| purple | 1 → 0 | 1 | 0 | 0.01% |
| green | 1 → 0 | 1 | 4 | 0.22% |
| the other five | 0 → 0 | 0 | 0 | 0.00% |

**Six crossings to zero, worst case 1.99% of a shape's area.** The ten rest rings of the fixture are
returned untouched, and repair is idempotent — `repair(repair(x))` is bit-exact — and invariant to
which vertex the ring starts at.

### The safety valve, and its denominator

"Keep the larger loop" is wrong if a shape folds so catastrophically that the fold exceeds what it
folded out of. The valve abandons the repair and writes the **original curve unchanged**, with a
report: handing back mangled artwork is worse than handing back folded artwork.

**The fraction is measured against the RETAINED area, not the original ring's area.** This is the
subtle part and getting it wrong makes the valve useless. A folded ring's `|shoelace|` *already has
the fold subtracted*, because the lobe is traversed with opposite orientation — so that denominator
collapses toward zero exactly as the fold grows, which is when the valve has to decide. Measured: an
equal-lobe figure-eight has `|shoelace| = 0` **exactly**, giving a ratio of `Infinity` and abandoning
a ring the algorithm repairs perfectly. Across 3648 random folded rings the worst
`lost / |originalShoelace|` was 62784% against `lost / kept` of 563%.

```
abandon when  keptArea <= 0  or  lostArea > REPAIR_MAX_LOSS * keptArea
REPAIR_MAX_LOSS = 0.25
```

The valve is **load-bearing, not decorative**, and the spec's earlier claim that it "never fires on
known work" was wrong. Measured counterexamples on plausible shapes: a barbell — two blobs joined by
a neck, with the neck strands crossed — repairs to zero crossings by **deleting an entire blob**, 45%
of the ring; a five-crossing pentagram loses 44.7% in a single pass. Both must be refused. Real
artwork sits at `lost / kept ≈ 0.02`, two orders of magnitude clear of the threshold.

A ring left with fewer than three points is abandoned the same way.

## Where it runs, and when

`repairRing` is pure and lives in `softmesh.js` beside `outlineFolds`, headlessly testable. It is
called from `playback.js` immediately after `GR.evalSoftOutline` (line 248) and before
`transformRing` (253), so it operates in the space the physics ran in and the transform back to base
space is untouched.

**On every frame, preview and commit alike** — because it is cheap enough that the alternative buys
nothing:

| measurement | cost |
|---|---|
| all ten real rings, warm | **0.151 ms** |
| all ten rings when already clean (the common case) | 0.118 ms |
| first call, cold | ~3 ms |
| 80 rings | 0.92 ms (linear in ring count) |
| one 1024-point ring | 1.7 ms (quadratic in points) |

That is about 1% of a frame. An earlier draft of this design claimed 8 ms per scene and used it to
justify repairing only on commit, threading a `repair` flag through `commandForFrame → softCommands`.
**The 8 ms was a measurement error** — a `Date.now()` window that enclosed file reads, SVG parsing,
twenty `outlineFolds` calls and ten `console.log`s — and the per-shape column in that same draft
summed to 2.39 ms, which should have caught it. With the real number the flag disappears, and with it
the accepted mismatch where a preview showed a fold that the committed artwork would not have.

This also settles `export.js`, which calls `GR.playbackCommit` per exported frame (line 272) and once
for the keep frame (253). Every exported frame is persisted artwork and every one of them is
repaired, which is what is wanted; the earlier "once on the frame that matters, never per playback
frame" wording would have contradicted that.

## Reporting

Always on, and always reported. Repair silently alters the user's geometry, so silence would be
wrong. There is no setting: a self-intersecting closed curve is never a thing anyone wants, so an
"off" switch could only ever produce gouged artwork, and the valve already covers the case where
repair would do harm.

**The counts cannot be produced inside `softCommands`.** It returns a command array with no channel
out, and `main.js` prints the jelly-fold report (699–723) *before* `playbackPlay` / `showScrubber`
(819–820) ever run — the numbers do not exist yet at that point. The committed frame is also the
user's scrubbed frame, not the settled frame the report measures.

So the report is produced where the fold report already is: **`main.js` runs `repairRing` on the
settled-frame outline at report time**, beside the existing `outlineFolds` call at line 710, and
reports what repair will do to that frame — loops removed and fraction of area lost, or that the
valve refused. It describes the settled frame, exactly as the fold report already does, and carries
the same caveat. The repair inside `playback.js` then does the work silently on whatever frame is
written.

## Testing

Pure, in `test_softmesh.js`:

- A clean square and a clean circle are returned unchanged — no points moved, no area lost.
- An **asymmetric** bowtie repairs to a simple ring with no proper crossings. Asymmetric on purpose:
  a symmetric figure-eight has `lost == kept` and is refused by the valve, which is its own test.
- A lobe folded back through an edge loses exactly that lobe, and the discarded area matches the
  lobe's own area.
- A clockwise hole ring keeps its winding sign through repair.
- The valve refuses the barbell and the pentagram, returning the input unchanged.
- Hitting `REPAIR_MAX_PASSES` routes to abandon, not to a partially repaired ring.
- Idempotence, and invariance to the ring's starting vertex.
- Repair leaves no consecutive duplicate points.
- The five folded rings from the real settled scene each reach zero proper crossings, and the six
  clean ones are untouched.

**Assert on the repair's own crossing predicate, not on `outlineFolds`.** The two disagree by design:
`outlineFolds` (softmesh.js:753) counts a collinear or touching pair as a crossing, because `side()`
returns 0 and `0 !== ±1`, while the repair requires a proper crossing and rejects a zero determinant.
Measured: `squareRing(100, 12)` sheared by 2.5 — an affine map of a simple ring, which *cannot* self
intersect — reports `outlineFolds = 1`, and a clean square with duplicate points reports 3. A
correctly repaired ring can therefore still be reported as folded. Self-touching and collinear-overlap
rings are, correctly, left alone by repair.

The scene fixture already exists as `gravity/test/fixtures_softscene.js`; its **settled** outlines
need adding, since it currently carries only the rest shapes.

## Known limits

**Repair is per ring.** `softCommands` loops the rings of a softbody and `repairRing` sees one at a
time, so an outer ring folding across an inner hole ring produces the same even-odd gouge and repair
cannot see it. `outlineFolds` has the same blind spot today, so this is not a regression — but
"guaranteed" holds per ring, not per shape.

## Rejected alternatives

**Re-tracing the union boundary** — treating the self-overlap as a union rather than an error, so the
fold becomes a bulge and no area is lost at all. Correct, and it needs a robust polygon-boolean
implementation with its own degenerate-case burden. Rejected on cost against a measured worst case of
1.99% area loss, which is imperceptible on artwork of this kind.

**Relaxing the outline points apart before writing** — nudging crossing points until the curve is
simple. It has no termination guarantee, where loop removal has a proven one, and it moves points
that were not part of the fold.

**Raising the self-contact radius so surfaces meet when node circles do.** Measured and rejected in
the self-collision design: at `0.6 * cell` the stiffness fixture braces its corners, brace counts
reach 14 on a 28-node ring, and the gap-spanning guarantee expires so a nearly-closed "C" can weld
shut. It trades a 2%-of-area cosmetic loss for the worst failure available.
