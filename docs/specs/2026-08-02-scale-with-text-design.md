# Scale With Text — Design

**Date:** 2026-08-02
**Status:** Approved (pending user review of this document)
**Target:** Affinity by Canva v3.2, Scripts panel

---

## Problem

Scaling a group numerically in Affinity (typing a width in the Transform panel)
resizes every child *except* frame text — the frame box grows, the type stays at
its original point size. Only dragging the bottom-right handle scales type, and
even that only works for **Artistic Text**.

The distinction is by design: Artistic Text is path-like, so glyphs are geometry
and a transform scales them. **Frame Text is a layout container** — a transform
resizes the frame and the text re-flows unchanged. Users who lay out cards with
Frame Text (the common case for multi-line body copy) therefore have no
numeric-entry path to proportional scaling at all.

## Goal

One script: select anything, type a target width and/or height, pick an anchor,
get a true proportional scale — geometry *and* frame type — as a single undo step.

## Non-goals

- Rewriting Affinity's Transform panel behaviour.
- Scaling each node about its own anchor (a different tool).
- Scaling strokes or layer effects — Affinity's own "Scale with object" flags
  already handle both, and `createTransform` honours them.
- Creating or applying named Text Styles (no SDK support in v3.2).

---

## Runtime findings

Everything below was verified at runtime against a live document. Probes live in
`affinity-scripts/probes/`: `probe_transform.js`, `probe_transform2.js`,
`probe_text_scale.js`, `probe_anchor.js`.

| Finding | Evidence |
|---|---|
| `node.transform` is **getter-only** | descriptor on `Node`: `get=function set=undefined`. Assignment silently no-ops in non-strict mode — reports "NO THROW" while changing nothing. |
| `DocumentCommand.createTransform(selection, xf, options)` works | Constructed and executed; group went 540×744 → 810×1116 at ×1.5. |
| It operates in **spread coordinates about the spread origin** | `2959→4438.5`, `3132.55→4698.83`, all exactly ×1.5. |
| `options` is **unvalidated** | Accepted `{}`, `{scaleText:true}`, `true`, `1` identically. No hidden text flag. |
| It scales frame **boxes** but not frame **type** | Frame box 442→663 (×1.5); `glyphAtts.height` stayed 18. |
| Artistic text **is** scaled by it | Confirmed by user; must not be compensated or it double-scales. |
| No `isArtisticTextNode` property exists | Only `isFrameTextNode` is present on text nodes. |
| `story.attRuns` yields `{begin, end, glyphAtts, paragraphAtts}` | The correct run enumerator. |
| `story.getGlyphAttsRunEnd(0)` returns `0` | **Unusable** — a walk built on it never advances. Use `attRuns`. |
| Per-run sub-range formatting works | `18 → 27` at ×1.5 via `createFormatText` on a `StoryRange` sub-selection. |
| `Transform` lives in `/geometry` | With `createIdentity`, `createScale`, `createTranslate`, `createRotate`, `createShear`. |
| `Transform.data` is row-major 2×3 `[a,b,tx, c,d,ty]` | `createTranslate(10,20)` → `[1,0,10, 0,1,20]`. |
| `T(p)·S·T(−p)` produces a correct anchored scale | Anchor held exactly under a deliberately non-uniform kx=2 / ky=3 test. |
| Stroke weight is handled natively | The stroke panel's **"Scale with object"** checkbox governs it, and `createTransform` honours it. Confirmed against a stroked shape. The script must **not** touch `lineWeight`. |
| Layer effects are handled natively | Same mechanism — each effect's own "Scale with object" flag, honoured by `createTransform`. Confirmed. The script must **not** touch effects. |

### Leading is relative in practice

Every paragraph probed had `leadingType = RelativeToIdeal (0)` with
`relativeLeading = 1` or `1.4238`, and `absoluteLeading = 0`. Leading therefore
follows font size automatically. Scaling `absoluteLeading` unconditionally would
write into a field nothing reads — a silent no-op that presents as a bug.

`spaceAfter = 12` and `defaultTabStops = 36` **are** absolute and must scale, or
paragraph gaps stay fixed while type grows and blocks visually collapse.

Word and letter spacing (`0.8 / 1 / 1.33`) are fractions of a space glyph;
`characterSpacing` and `manualKerning` are em-based. All follow font size
automatically — scaling them double-applies.

---

## Architecture

One command, one undo step:

```
selection
  → union bounding box in spread space
  → kx, ky from the typed target W/H
  → anchor point p from the 3×3 anchor choice
  → xf = T(p) · scale(kx, ky) · T(−p)
  → CompoundCommand [
        createTransform(sel, xf),      // all geometry: shapes, images, curves,
                                       // artistic text, nested groups
        ...per-run frame-text deltas   // compensation, frame text only
    ]
  → doc.executeCommand(cmd)            // single undo step
```

`createTransform` does the geometry. The script patches only what that command
provably leaves behind.

### Module boundaries

Single file, four internal sections with no cross-talk beyond plain values:

| Unit | Responsibility | Input → Output |
|---|---|---|
| `collectTargets(doc)` | Resolve the selection into scale targets and the frame-text nodes needing compensation. | `doc` → `{nodes[], frames[], bbox}` |
| `buildAnchoredScale(bbox, kx, ky, anchorIndex)` | Pure matrix math. No document access. | numbers → `Transform` |
| `textDeltas(frame, kx, ky)` | Read every att run, emit the `DocumentCommand`s that compensate it. | node + factors → `DocumentCommand[]` |
| `showDialog(doc, bbox)` | Collect W, H, lock, anchor. No scaling logic. | `doc`, `bbox` → `{w, h, anchor}` or cancel |

`buildAnchoredScale` and `textDeltas` are pure enough to reason about in
isolation, which is where the correctness risk actually lives.

---

## Bounding box

Union of each selected node's `spreadBaseBox` (axis-aligned, spread space).

`spreadBaseBox` — not `spreadVisibleBox` — because it matches what the Transform
panel's W/H fields report. `spreadVisibleBox` includes stroke and effect bleed
(probed: `540×744` vs `653×857`), so typing "want 800 wide" against it would
produce a box that isn't 800 wide in the panel.

## Anchor

Nine positions on the union bbox, `p = (x + fx·w, y + fy·h)` where `fx, fy ∈
{0, 0.5, 1}`. Presented as a 9-item ComboBox — the Dialog SDK has no 3×3 widget
(only comboBox / checkBox / textBox / unitValueEditor / fontPicker). Cosmetic
loss only; the math is identical.

Default: **Top Left**, matching the user's Affinity setting.

## Scale factors

```
kx = targetW / bbox.width
ky = targetH / bbox.height
```

With lock-ratio on, editing W sets H (and vice versa) via
`onValueChangedHandler`, so `kx === ky`.

---

## Text compensation

For every descendant with `isFrameTextNode === true`, for every run in
`story.attRuns`:

| Attribute | Factor | Rationale |
|---|---|---|
| `GlyphAttDoubleType.Height` | `ky` | Font size. |
| `GlyphAttDoubleType.ScaleX` | `× kx/ky` | Non-uniform only. Reproduces anamorphic handle-drag. Skipped when `kx === ky`. |
| `GlyphAttDoubleType.BaselineAdvance`, `OffsetY` | `ky` | Absolute vertical. |
| `GlyphAttDoubleType.OffsetX` | `kx` | Absolute horizontal. |
| `GlyphAttDoubleType.AbsoluteLeading` | `ky`, **only if** `paragraphAtts.leadingType.value ∈ {2, 3, 4}` | Otherwise the field is unused. |
| `ParagraphAttDoubleType.SpaceBefore`, `SpaceAfter` | `ky` | Absolute vertical. |
| `ParagraphAttDoubleType.AbsoluteLeading` | `ky`, same leadingType guard | — |
| `ParagraphAttDoubleType.LeftIndent`, `RightIndent`, `FirstLineIndent`, `LastLineOutdent`, `DefaultTabStops`, `HyphenationZone`, `HyphenationZoneCapitals`, `HyphenationZoneParagraphEnd`, `HyphenationZoneColumnEnd` | `kx` | Absolute horizontal. |
| `RelativeLeading`, `Min/Desired/MaxWordSpacing`, `Min/Desired/MaxLetterSpacing`, `CharacterSpacing`, `ManualKerning` | **untouched** | Relative — follow font size automatically. |

Deltas are **absolute, not multiplicative**: each run's current value is read
first, then `value × k` is written.

Zero-valued attributes are skipped — `0 × k = 0` is a wasted command, and a
compound of hundreds of no-ops slows execution for no benefit.

### Node classification

Walk each selected node and its descendants via `getNodeChildrenRecursive`,
including the selected node itself:

- `isFrameTextNode === true` → compensate.
- Has `storyInterface` but not frame text → **skip** (artistic; already scaled).
- Anything else → untouched; `createTransform` handled it.

### Write path

```js
const s = Selection.create(doc, frameNode);
s.addSubSelectionForNode(frameNode, TextSelection.create(new StoryRange(run.begin, run.end)));
builder.addCommand(DocumentCommand.createFormatText(s, delta));
```

One delta per attribute per run, all appended to the same
`CompoundCommandBuilder` as the transform.

---

## Dialog

| Control | Detail |
|---|---|
| Width | `addUnitValueEditor` in `doc.units`, pre-filled with current bbox width. |
| Height | Same, pre-filled with current bbox height. |
| Lock aspect ratio | Checkbox, default **on**. |
| Anchor | ComboBox, 9 items, default Top Left. |

Known SDK constraints: `UnitValueEditor.units` is read-only (display unit fixed
at creation; users may still type `2cm` and Affinity converts), and a `null`
`max` resets the initial value to `0` — so `.value` is set explicitly after
creation.

---

## Error handling

| Condition | Behaviour |
|---|---|
| No document | `app.alert`, exit. |
| Empty selection | `app.alert("Select one or more objects"), exit. |
| bbox width or height is 0 | `app.alert`, exit (division by zero). |
| Target W or H ≤ 0 | `app.alert`, exit. |
| kx and ky both ≈ 1 | Exit silently — nothing to do, no empty undo step. |
| A frame's story read throws | Skip that frame, continue, report the count at the end. |
| Any uncaught throw | `try/catch` around `main()` rendering the message via `app.alert` — a throw before the dialog otherwise aborts silently. |

---

## Verification

`console.log` **is** visible in this build's Scripts panel (contradicting
`affinity-scripting-notes.md`, which should be corrected). Verification is
therefore direct: log before/after `spreadBaseBox` and per-run heights, and
confirm on canvas.

Manual test matrix:

1. Group with frame text, uniform ×1.5 — type scales, layout proportional.
2. Same group, each of the 9 anchors — the anchor point stays fixed.
3. Non-uniform (ratio unlocked) — box is anamorphic, type follows via `ScaleX`.
4. Group containing **artistic** text — scales once, not twice.
5. Multi-selection of unrelated objects — union bbox, correct relative spacing.
6. Nested groups — inner frame text compensated.
7. Multi-run frame (the probed `Roboto-Bold` + `Roboto-Light` frame) — both runs scale.
8. Paragraph with `spaceAfter = 12` — gap scales with the type.
9. Undo — one press restores everything.
10. Scale down (×0.5) as well as up.

---

## Open items

1. **Rotated nodes.** `spreadBaseBox` on a rotated node is axis-aligned, so the
   union bbox of rotated content is larger than its visual extent. Acceptable
   for v1.0 (it matches the Transform panel), but worth documenting in the UI.

---

## Deliverables

Following the repo's folder-per-script convention:

```
affinity-scripts/scale_with_text/
  scale_with_text_1.0.js
  registry.json
  screenshot.webp        (16:9, for community submission)
```

Plus a correction to `docs/affinity-scripting-notes.md` and
`docs/affinity-sdk-reference.md`: `console.log` is visible; `node.transform` is
read-only; `createTransform` / `createGroupTransform` signatures; `attRuns` is
the correct run enumerator and `getGlyphAttsRunEnd` is not.
