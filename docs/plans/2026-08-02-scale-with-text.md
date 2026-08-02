# Scale With Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Affinity script that scales any selection to a typed width/height about a chosen anchor, scaling **frame text** along with the geometry — the thing the Transform panel's W/H fields cannot do.

**Architecture:** One `DocumentCommand.createTransform` handles all geometry (shapes, images, curves, artistic text, nesting). Frame text is then compensated with per-run `createFormatText` deltas, because `createTransform` resizes a frame's box but leaves its type at the original point size. Both go into one `CompoundCommandBuilder` so the whole operation is a single undo step.

**Tech Stack:** JavaScript (ES5-flavoured, Affinity's script runtime), Affinity by Canva v3.2 SDK — `/commands`, `/geometry`, `/selections`, `/nodes`, `/storydelta`, `/glyphatts`, `/paragraphatts`, `affinity:story`, `/dialog`, `/units`.

**Spec:** `affinity-scripts/docs/specs/2026-08-02-scale-with-text-design.md`

---

## Runtime constraints (read before starting)

These are verified facts. Violating them produces silent failures, not errors.

1. **`node.transform` is getter-only.** Assigning to it silently does nothing in non-strict mode. All geometry changes go through `DocumentCommand.createTransform(selection, xf)`.
2. **`createTransform` works in spread coordinates about the spread origin.** Anchoring is our job: `xf = T(p) · scale(kx,ky) · T(−p)`.
3. **`story.getGlyphAttsRunEnd(pos)` returns `0`** and cannot drive a run walk. Use `story.attRuns.toArray()`, whose items are `{begin, end, glyphAtts, paragraphAtts}`.
4. **StoryDelta values are absolute, not multiplicative.** Read the current value, write `value × k`.
5. **`console.log` IS visible** in this build's Scripts panel. It is the only debugging channel that works well.
6. **A throw before a dialog opens aborts silently.** Everything is wrapped in `try/catch` that logs and alerts.
7. **`UnitValueEditor` with `max = null` resets the value to `0`.** Set `.value` explicitly after creating each editor.
8. **Do not touch `lineWeight` or layer effects.** Affinity's own "Scale with object" flags handle both, and `createTransform` honours them. Scaling them here double-applies.
9. **Do not touch artistic text.** `createTransform` already scaled it. Detect via `isFrameTextNode === true`; a text node that is *not* a frame text node is artistic and must be skipped.

## Testing model

No test runner exists in this runtime. Instead:

- All correctness-critical logic is written as **pure functions** taking plain objects.
- The script carries a `SELFTEST` flag. Set it `true`, run from the Scripts panel, and it runs assertions against fabricated inputs, logs `PASS`/`FAIL` per case plus a summary, and **returns before touching the document**.
- SDK-touching code is verified manually against the canvas, with before/after values logged.

"Run the tests" throughout this plan means: set `SELFTEST = true`, run the script in the Scripts panel, read the console.

## File structure

```
affinity-scripts/scale_with_text/
  scale_with_text_1.0.js     # the whole script (Affinity has no local module system)
  registry.json              # community-directory metadata
  screenshot.webp            # 16:9 preview (manual, last)
```

Single file is forced by the runtime, but it is internally divided into sections with no cross-talk beyond plain values:

| Section | Responsibility | Purity |
|---|---|---|
| Self-test harness | `assert`, `assertClose`, reporting | pure |
| Geometry helpers | `unionBox`, `anchorPoint`, `scaleFactors`, `buildAnchoredScale` | pure (except `Transform` require) |
| Text rules | `GLYPH_RULES`, `PARA_RULES`, `planRunDeltas` | pure |
| Document layer | `collectTargets`, `buildTextCommands` | SDK |
| UI | `showDialog` | SDK |
| `main` | wiring | SDK |

---

## Task 1: Scaffold + self-test harness

**Files:**
- Create: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Create the file with metadata header, flags, and harness**

```js
/**
 * name: scale_with_text_1.0
 * description: Scale a selection to a target width/height about an anchor - including frame text, which Affinity's Transform panel leaves unscaled.
 * version: 1.0.0
 * author: ollio
 */

// Set true to run the built-in assertions instead of the script.
var SELFTEST = false;

// ---------------------------------------------------------------- harness

var _tests = { pass: 0, fail: 0 };

function assert(name, cond) {
  if (cond) { _tests.pass++; console.log('PASS  ' + name); }
  else { _tests.fail++; console.log('FAIL  ' + name); }
}

function assertClose(name, actual, expected, tol) {
  var t = (tol === undefined) ? 1e-6 : tol;
  var ok = Math.abs(actual - expected) <= t;
  if (ok) { _tests.pass++; console.log('PASS  ' + name); }
  else { _tests.fail++; console.log('FAIL  ' + name + '  expected ' + expected + ' got ' + actual); }
}

function assertEqual(name, actual, expected) {
  var ok = String(actual) === String(expected);
  if (ok) { _tests.pass++; console.log('PASS  ' + name); }
  else { _tests.fail++; console.log('FAIL  ' + name + '  expected "' + expected + '" got "' + actual + '"'); }
}

function reportTests() {
  console.log('');
  console.log('==== ' + _tests.pass + ' passed, ' + _tests.fail + ' failed ====');
}
```

- [ ] **Step 2: Add the bottom entry point**

```js
// ---------------------------------------------------------------- entry

function main() {
  console.log('scale_with_text: not implemented yet');
}

try {
  if (SELFTEST) { runSelfTests(); reportTests(); }
  else { main(); }
} catch (err) {
  console.log('ERROR: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
  try { require('/application').app.alert(String(err && err.message ? err.message : err), 'Scale With Text'); } catch (e) {}
}
```

- [ ] **Step 3: Add an empty test runner so the file loads**

```js
function runSelfTests() {
  console.log('#### scale_with_text selftest ####');
}
```

- [ ] **Step 4: Verify the file runs**

Import into the Scripts panel and run with `SELFTEST = false`.
Expected console: `scale_with_text: not implemented yet`

Then set `SELFTEST = true`, re-import, run.
Expected console: `#### scale_with_text selftest ####` then `==== 0 passed, 0 failed ====`

> Reminder: the Script Manager caches a **copy**. Editing the file on disk does not update Affinity — re-import after every change.

---

## Task 2: `unionBox`

Combines the selected nodes' boxes into one. Uses `spreadBaseBox` (matches the Transform panel), not `spreadVisibleBox` (includes stroke/effect bleed).

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Write the failing tests**

Add to `runSelfTests()`:

```js
  console.log('-- unionBox --');
  var b1 = { x: 10, y: 20, width: 30, height: 40 };
  var b2 = { x: 50, y: 10, width: 10, height: 10 };

  var u1 = unionBox([b1]);
  assertClose('single box x', u1.x, 10);
  assertClose('single box width', u1.width, 30);

  var u2 = unionBox([b1, b2]);
  assertClose('union x', u2.x, 10);
  assertClose('union y', u2.y, 10);
  assertClose('union width', u2.width, 50);   // 10..60
  assertClose('union height', u2.height, 50); // 10..60

  assert('empty returns null', unionBox([]) === null);
```

- [ ] **Step 2: Run to verify failure**

`SELFTEST = true`, run.
Expected: `ERROR: unionBox is not defined`

- [ ] **Step 3: Implement**

```js
// ---------------------------------------------------------------- geometry

// Axis-aligned union of {x,y,width,height} boxes. Null for an empty list.
function unionBox(boxes) {
  if (!boxes || !boxes.length) return null;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 5 PASS, `==== 5 passed, 0 failed ====`

- [ ] **Step 5: Save**

---

## Task 3: `ANCHORS` + `anchorPoint`

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Write the failing tests**

```js
  console.log('-- anchorPoint --');
  var box = { x: 100, y: 200, width: 40, height: 60 };

  assertEqual('anchor count', ANCHORS.length, 9);
  assertEqual('default label', ANCHORS[0].label, 'Top Left');

  var tl = anchorPoint(box, 0);
  assertClose('top-left x', tl.x, 100);
  assertClose('top-left y', tl.y, 200);

  var c = anchorPoint(box, 4);
  assertClose('centre x', c.x, 120);
  assertClose('centre y', c.y, 230);

  var br = anchorPoint(box, 8);
  assertClose('bottom-right x', br.x, 140);
  assertClose('bottom-right y', br.y, 260);
```

- [ ] **Step 2: Run to verify failure**

Expected: `ERROR: ANCHORS is not defined`

- [ ] **Step 3: Implement**

Order is row-major so the combo box reads like the 3×3 widget it replaces.

```js
// Row-major, mirroring Affinity's 3x3 anchor widget.
var ANCHORS = [
  { label: 'Top Left',      fx: 0,   fy: 0   },
  { label: 'Top Centre',    fx: 0.5, fy: 0   },
  { label: 'Top Right',     fx: 1,   fy: 0   },
  { label: 'Middle Left',   fx: 0,   fy: 0.5 },
  { label: 'Centre',        fx: 0.5, fy: 0.5 },
  { label: 'Middle Right',  fx: 1,   fy: 0.5 },
  { label: 'Bottom Left',   fx: 0,   fy: 1   },
  { label: 'Bottom Centre', fx: 0.5, fy: 1   },
  { label: 'Bottom Right',  fx: 1,   fy: 1   }
];

// The point that must stay fixed during the scale.
function anchorPoint(box, index) {
  var a = ANCHORS[index] || ANCHORS[0];
  return { x: box.x + a.fx * box.width, y: box.y + a.fy * box.height };
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 13 passed, 0 failed.

- [ ] **Step 5: Save**

---

## Task 4: `scaleFactors`

Turns typed W/H plus the lock-ratio flag into `kx, ky`.

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Write the failing tests**

```js
  console.log('-- scaleFactors --');
  var bx = { x: 0, y: 0, width: 200, height: 100 };

  var f1 = scaleFactors(bx, 400, 100, false);
  assertClose('unlocked kx', f1.kx, 2);
  assertClose('unlocked ky', f1.ky, 1);

  var f2 = scaleFactors(bx, 400, 100, true);
  assertClose('locked kx', f2.kx, 2);
  assertClose('locked ky follows width', f2.ky, 2);

  var f3 = scaleFactors(bx, 200, 100, false);
  assert('no-op detected', isNoOp(f3));

  var f4 = scaleFactors(bx, 100, 100, false);
  assert('real change not a no-op', !isNoOp(f4));
```

- [ ] **Step 2: Run to verify failure**

Expected: `ERROR: scaleFactors is not defined`

- [ ] **Step 3: Implement**

```js
// With the ratio locked, width is authoritative and height follows.
function scaleFactors(box, targetW, targetH, lockRatio) {
  var kx = targetW / box.width;
  var ky = lockRatio ? kx : (targetH / box.height);
  return { kx: kx, ky: ky };
}

// Guard against committing an empty undo step.
function isNoOp(f) {
  return Math.abs(f.kx - 1) < 1e-6 && Math.abs(f.ky - 1) < 1e-6;
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 17 passed, 0 failed.

- [ ] **Step 5: Save**

---

## Task 5: `buildAnchoredScale`

The matrix. Probe-verified construction — see spec.

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Write the failing tests**

`Transform.data` is row-major 2×3 `[a, b, tx, c, d, ty]`. For a scale about `p`:
`a = kx`, `tx = px(1−kx)`, `d = ky`, `ty = py(1−ky)`.

Deliberately non-uniform factors — with `kx === ky`, an axis swap is invisible.

```js
  console.log('-- buildAnchoredScale --');
  var sbox = { x: 400, y: 170, width: 1000, height: 800 };
  var xf = buildAnchoredScale(sbox, 2, 3, 0);   // anchor top-left
  var d = xf.data;
  assertClose('matrix a (kx)', d[0], 2, 1e-4);
  assertClose('matrix b', d[1], 0, 1e-4);
  assertClose('matrix tx', d[2], 400 * (1 - 2), 1e-4);
  assertClose('matrix c', d[3], 0, 1e-4);
  assertClose('matrix d (ky)', d[4], 3, 1e-4);
  assertClose('matrix ty', d[5], 170 * (1 - 3), 1e-4);

  // The anchor must map to itself.
  var Point = require('/geometry').Point;
  var moved = xf.applyToPoint(new Point(400, 170));
  assertClose('anchor x fixed', moved.x, 400, 1e-4);
  assertClose('anchor y fixed', moved.y, 170, 1e-4);

  // Centre anchor: the centre must map to itself.
  var xf2 = buildAnchoredScale(sbox, 2, 2, 4);
  var ctr = xf2.applyToPoint(new Point(900, 570));
  assertClose('centre x fixed', ctr.x, 900, 1e-4);
  assertClose('centre y fixed', ctr.y, 570, 1e-4);
```

- [ ] **Step 2: Run to verify failure**

Expected: `ERROR: buildAnchoredScale is not defined`

- [ ] **Step 3: Implement**

Use the explicit `T(p) · S · T(−p)` form. `around()` and `translated()` also matched in probing, but `around()` mutates its receiver and `translated()`'s multiply side is undocumented — both are landmines. This form reads as the maths.

```js
// Scale by (kx,ky) while holding the anchor point fixed: T(p) . S . T(-p)
function buildAnchoredScale(box, kx, ky, anchorIndex) {
  var Transform = require('/geometry').Transform;
  var p = anchorPoint(box, anchorIndex);
  return Transform.createTranslate(p.x, p.y)
                  .multiply(Transform.createScale(kx, ky))
                  .multiply(Transform.createTranslate(-p.x, -p.y));
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 27 passed, 0 failed.

- [ ] **Step 5: Save**

---

## Task 6: Text attribute rules + `planRunDeltas`

The heart of the feature, and pure — so it is fully testable without a document.

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Write the failing tests**

Fabricate a run shaped like a real one (values taken from the probe output).

```js
  console.log('-- planRunDeltas --');

  function fakeRun(glyphOverrides, paraOverrides) {
    var g = { height: 18, absoluteLeading: 0, characterSpacing: 0, manualKerning: 0,
              baselineAdvance: 0, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
    var p = { absoluteLeading: 0, relativeLeading: 1, spaceBefore: 0, spaceAfter: 12,
              firstLineIndent: 0, leftIndent: 0, rightIndent: 0, lastLineOutdent: 0,
              defaultTabStops: 36, hyphenationZone: 0,
              leadingType: { value: 0 } };
    var kk;
    for (kk in (glyphOverrides || {})) g[kk] = glyphOverrides[kk];
    for (kk in (paraOverrides || {})) p[kk] = paraOverrides[kk];
    return { begin: 0, end: 10, glyphAtts: g, paragraphAtts: p };
  }

  function findDelta(list, scope, key) {
    for (var i = 0; i < list.length; i++)
      if (list[i].scope === scope && list[i].key === key) return list[i];
    return null;
  }

  // Uniform 2x
  var plan = planRunDeltas(fakeRun(), 2, 2);
  assertClose('height doubled', findDelta(plan, 'glyph', 'Height').value, 36);
  assertClose('spaceAfter doubled', findDelta(plan, 'para', 'SpaceAfter').value, 24);
  assertClose('tab stops doubled', findDelta(plan, 'para', 'DefaultTabStops').value, 72);

  // Relative attributes must be left alone.
  assert('relativeLeading untouched', findDelta(plan, 'para', 'RelativeLeading') === null);
  assert('characterSpacing untouched', findDelta(plan, 'glyph', 'CharacterSpacing') === null);
  assert('manualKerning untouched', findDelta(plan, 'glyph', 'ManualKerning') === null);

  // Zero-valued attributes produce no command.
  assert('zero spaceBefore skipped', findDelta(plan, 'para', 'SpaceBefore') === null);
  assert('zero offsetX skipped', findDelta(plan, 'glyph', 'OffsetX') === null);

  // absoluteLeading only when the paragraph is actually in an absolute mode.
  var relPlan = planRunDeltas(fakeRun({ absoluteLeading: 20 }, { leadingType: { value: 0 } }), 2, 2);
  assert('absLeading skipped in relative mode', findDelta(relPlan, 'glyph', 'AbsoluteLeading') === null);

  var absPlan = planRunDeltas(fakeRun({ absoluteLeading: 20 }, { leadingType: { value: 2 } }), 2, 2);
  assertClose('absLeading scaled in absolute mode',
              findDelta(absPlan, 'glyph', 'AbsoluteLeading').value, 40);

  // Uniform scaling must not write ScaleX.
  assert('no ScaleX when uniform', findDelta(plan, 'glyph', 'ScaleX') === null);

  // Non-uniform: height follows ky, ScaleX carries the difference.
  var aniso = planRunDeltas(fakeRun(), 2, 4);
  assertClose('aniso height uses ky', findDelta(aniso, 'glyph', 'Height').value, 72);
  assertClose('aniso ScaleX = kx/ky', findDelta(aniso, 'glyph', 'ScaleX').value, 0.5);

  // Horizontal attributes use kx, vertical use ky.
  var axes = planRunDeltas(fakeRun({ offsetX: 10, offsetY: 10 }), 2, 4);
  assertClose('offsetX uses kx', findDelta(axes, 'glyph', 'OffsetX').value, 20);
  assertClose('offsetY uses ky', findDelta(axes, 'glyph', 'OffsetY').value, 40);
```

- [ ] **Step 2: Run to verify failure**

Expected: `ERROR: planRunDeltas is not defined`

- [ ] **Step 3: Implement**

```js
// ---------------------------------------------------------------- text rules

// Leading modes in which absoluteLeading is the field actually read.
// ParagraphLeadingType: RelativeToIdeal=0, RelativeToHeight=1,
// ExactlyAbsolute=2, AtLeastAbsolute=3, RelativeToIdealAbsolute=4
var ABSOLUTE_LEADING_TYPES = [2, 3, 4];

// `key` is the enum member name; `prop` is the property on the atts object.
// `axis` picks the factor: 'x' -> kx, 'y' -> ky.
var GLYPH_RULES = [
  { key: 'Height',          prop: 'height',          axis: 'y' },
  { key: 'BaselineAdvance', prop: 'baselineAdvance', axis: 'y' },
  { key: 'OffsetY',         prop: 'offsetY',         axis: 'y' },
  { key: 'OffsetX',         prop: 'offsetX',         axis: 'x' },
  { key: 'AbsoluteLeading', prop: 'absoluteLeading', axis: 'y', absoluteLeadingOnly: true }
];

var PARA_RULES = [
  { key: 'SpaceBefore',                 prop: 'spaceBefore',                 axis: 'y' },
  { key: 'SpaceAfter',                  prop: 'spaceAfter',                  axis: 'y' },
  { key: 'AbsoluteLeading',             prop: 'absoluteLeading',             axis: 'y', absoluteLeadingOnly: true },
  { key: 'LeftIndent',                  prop: 'leftIndent',                  axis: 'x' },
  { key: 'RightIndent',                 prop: 'rightIndent',                 axis: 'x' },
  { key: 'FirstLineIndent',             prop: 'firstLineIndent',             axis: 'x' },
  { key: 'LastLineOutdent',             prop: 'lastLineOutdent',             axis: 'x' },
  { key: 'DefaultTabStops',             prop: 'defaultTabStops',             axis: 'x' },
  { key: 'HyphenationZone',             prop: 'hyphenationZone',             axis: 'x' },
  { key: 'HyphenationZoneCapitals',     prop: 'hyphenationZoneCapitals',     axis: 'x' },
  { key: 'HyphenationZoneParagraphEnd', prop: 'hyphenationZoneParagraphEnd', axis: 'x' },
  { key: 'HyphenationZoneColumnEnd',    prop: 'hyphenationZoneColumnEnd',    axis: 'x' }
];

function usesAbsoluteLeading(paragraphAtts) {
  var lt = paragraphAtts && paragraphAtts.leadingType;
  var v = (lt && lt.value !== undefined) ? lt.value : lt;
  for (var i = 0; i < ABSOLUTE_LEADING_TYPES.length; i++)
    if (ABSOLUTE_LEADING_TYPES[i] === v) return true;
  return false;
}

function applyRules(rules, atts, paragraphAtts, kx, ky, scope, out) {
  var absLeading = usesAbsoluteLeading(paragraphAtts);
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if (r.absoluteLeadingOnly && !absLeading) continue;
    var v = atts ? atts[r.prop] : undefined;
    if (typeof v !== 'number') continue;   // absent on this build
    if (v === 0) continue;                 // 0 * k = 0, no command worth issuing
    var k = (r.axis === 'x') ? kx : ky;
    out.push({ scope: scope, key: r.key, value: v * k });
  }
}

// Pure: describes what to write for one attribute run. No SDK objects.
// Returns [{scope:'glyph'|'para', key:<enum member name>, value:<number>}]
function planRunDeltas(run, kx, ky) {
  var out = [];
  var g = run.glyphAtts, p = run.paragraphAtts;

  applyRules(GLYPH_RULES, g, p, kx, ky, 'glyph', out);
  applyRules(PARA_RULES, p, p, kx, ky, 'para', out);

  // Anamorphic type: height carries ky, ScaleX carries the remaining ratio.
  if (Math.abs(kx - ky) > 1e-6 && g && typeof g.scaleX === 'number') {
    out.push({ scope: 'glyph', key: 'ScaleX', value: g.scaleX * (kx / ky) });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Expected: 42 passed, 0 failed.

- [ ] **Step 5: Save**

---

## Task 7: `collectTargets`

First SDK-touching unit. Verified by logging, not assertions.

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Implement**

```js
// ---------------------------------------------------------------- document

// Returns { nodes: [...], frames: [...], box: {...} } or null when nothing usable.
// `frames` holds only FRAME text nodes; artistic text is deliberately excluded
// because createTransform already scales it.
function collectTargets(doc) {
  var nodesMod = require('/nodes');
  var sel = doc.selection;
  var nodes = [], boxes = [], frames = [];

  for (var n of sel.nodes) { nodes.push(n); }
  if (!nodes.length) return null;

  function considerText(node) {
    var isFrame = false;
    try { isFrame = !!node.isFrameTextNode; } catch (e) { return; }
    if (isFrame) frames.push(node);
    // A node with a story that is NOT a frame text node is artistic text.
    // createTransform already scaled it - touching it would double-scale.
  }

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    try { boxes.push(node.spreadBaseBox); } catch (e) {}
    considerText(node);
    try {
      var kids = nodesMod.getNodeChildrenRecursive(node.handle, nodesMod.NodeChildType.Main, false);
      for (var k of kids) { considerText(k); }
    } catch (e) {}
  }

  var box = unionBox(boxes);
  if (!box) return null;
  return { nodes: nodes, frames: frames, box: box };
}
```

- [ ] **Step 2: Wire a temporary probe into `main()`**

```js
function main() {
  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { app.alert('No document open.', 'Scale With Text'); return; }

  var t = collectTargets(doc);
  if (!t) { app.alert('Select one or more objects.', 'Scale With Text'); return; }

  console.log('nodes: ' + t.nodes.length);
  console.log('frame text nodes: ' + t.frames.length);
  console.log('box: x=' + t.box.x.toFixed(2) + ' y=' + t.box.y.toFixed(2) +
              ' w=' + t.box.width.toFixed(2) + ' h=' + t.box.height.toFixed(2));
}
```

- [ ] **Step 3: Verify manually**

| Selection | Expected |
|---|---|
| The card group from `screenshots/image.png` | `frame text nodes:` matches its visible text frames; box matches the Transform panel W/H |
| Nothing selected | alert "Select one or more objects." |
| Two separate objects | `nodes: 2`, box spans both |
| A group containing artistic text | that artistic node is **not** counted in `frames` |

- [ ] **Step 4: Save**

---

## Task 8: `buildTextCommands`

Turns the pure plan into SDK commands.

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Implement**

```js
// Converts planRunDeltas() output into DocumentCommands for one frame.
function buildTextCommands(doc, frame, kx, ky) {
  var DocumentCommand = require('/commands').DocumentCommand;
  var sels = require('/selections');
  var StoryDelta = require('/storydelta').StoryDelta;
  var GlyphAttDoubleType = require('/glyphatts').GlyphAttDoubleType;
  var ParagraphAttDoubleType = require('/paragraphatts').ParagraphAttDoubleType;
  var StoryRange = require('affinity:story').StoryRange;

  var cmds = [];
  var story = frame.storyInterface.story;
  var runs = story.attRuns.toArray();

  for (var r = 0; r < runs.length; r++) {
    var run = runs[r];
    var plan = planRunDeltas(run, kx, ky);
    if (!plan.length) continue;

    for (var d = 0; d < plan.length; d++) {
      var item = plan[d];
      var delta;
      if (item.scope === 'glyph') {
        delta = StoryDelta.createGlyphDouble(GlyphAttDoubleType[item.key], item.value);
      } else {
        delta = StoryDelta.createParagraphDouble(ParagraphAttDoubleType[item.key], item.value);
      }
      // A fresh selection per delta: sub-selections are consumed by the command.
      var s = sels.Selection.create(doc, frame);
      s.addSubSelectionForNode(frame, sels.TextSelection.create(new StoryRange(run.begin, run.end)));
      cmds.push(DocumentCommand.createFormatText(s, delta));
    }
  }
  return cmds;
}
```

- [ ] **Step 2: Wire a temporary test into `main()`**

Replace the logging block with a hardcoded ×1.5 run, no dialog yet:

```js
  var factors = { kx: 1.5, ky: 1.5 };
  var xf = buildAnchoredScale(t.box, factors.kx, factors.ky, 0);

  var cmds = require('/commands');
  var Selection = require('/selections').Selection;
  var builder = cmds.CompoundCommandBuilder.create();

  var sel = Selection.createEmpty(doc);
  for (var i = 0; i < t.nodes.length; i++) sel.add(t.nodes[i]);
  builder.addCommand(cmds.DocumentCommand.createTransform(sel, xf));

  var total = 0;
  for (var f = 0; f < t.frames.length; f++) {
    var fc = buildTextCommands(doc, t.frames[f], factors.kx, factors.ky);
    for (var c = 0; c < fc.length; c++) builder.addCommand(fc[c]);
    total += fc.length;
  }
  console.log('text commands: ' + total);
  doc.executeCommand(builder.createCommand());
  console.log('done');
```

- [ ] **Step 3: Verify manually**

Select the card group, run.

| Check | Expected |
|---|---|
| Geometry | Everything ×1.5, top-left corner unmoved |
| Frame text | Type ×1.5, proportional to its box |
| Paragraph gaps | The `spaceAfter = 12` gap scales too |
| Multi-run frame | Both the Bold and Light runs scale |
| Artistic text (if present) | Scales once, not twice |
| Undo | **One** Ctrl/Cmd+Z restores everything |

The single-undo check is the important one — it proves the compound command is intact.

- [ ] **Step 4: Save**

---

## Task 9: `showDialog`

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Implement**

```js
// ---------------------------------------------------------------- ui

// Returns { width, height, anchor } or null when cancelled.
function showDialog(doc, box) {
  var dialogMod = require('/dialog');
  var UnitType = require('/units').UnitType;

  var displayUnit = UnitType.Pixel;
  try {
    if (String(doc.units).toLowerCase().indexOf('milli') === 0) displayUnit = UnitType.Millimetre;
    else if (String(doc.units).toLowerCase().indexOf('centi') === 0) displayUnit = UnitType.Centimetre;
    else if (String(doc.units).toLowerCase().indexOf('inch') === 0) displayUnit = UnitType.Inch;
  } catch (e) {}

  var dlg = dialogMod.Dialog.create('Scale With Text');
  dlg.initialWidth = 380;
  var grp = dlg.addColumn().addGroup('Target size');

  var wField = grp.addUnitValueEditor('Width', UnitType.Pixel, displayUnit, box.width, 0.01, 1000000);
  wField.value = box.width;                        // SDK resets the value otherwise
  var hField = grp.addUnitValueEditor('Height', UnitType.Pixel, displayUnit, box.height, 0.01, 1000000);
  hField.value = box.height;

  var lock = grp.addCheckBox('Lock aspect ratio', true);

  var labels = [];
  for (var i = 0; i < ANCHORS.length; i++) labels.push(ANCHORS[i].label);
  var anchorBox = grp.addComboBox('Anchor', labels, 0);

  var ratio = box.height / box.width;
  var syncing = false;

  // Width is authoritative while locked; height mirrors it.
  wField.onValueChangedHandler = function () {
    if (syncing || !lock.value) return;
    syncing = true;
    hField.value = wField.value * ratio;
    syncing = false;
  };
  hField.onValueChangedHandler = function () {
    if (syncing || !lock.value) return;
    syncing = true;
    wField.value = hField.value / ratio;
    syncing = false;
  };

  var res = dlg.runModal();
  var ok = (res === dialogMod.DialogResult.Ok) ||
           (res && res.value !== undefined && dialogMod.DialogResult.Ok &&
            res.value === dialogMod.DialogResult.Ok.value);
  if (!ok) return null;

  return { width: wField.value, height: hField.value, anchor: anchorBox.selectedIndex };
}
```

- [ ] **Step 2: Verify manually**

| Check | Expected |
|---|---|
| Fields pre-filled | Match the Transform panel W/H |
| Lock on, type a width | Height updates proportionally |
| Lock off, type a width | Height stays put |
| Typing `2cm` | Converts (the editor's unit label is fixed, but input is parsed) |
| Anchor dropdown | 9 entries, Top Left first |
| Cancel | Returns null, script exits without changing anything |

`syncing` guards against the two handlers ping-ponging each other into a feedback loop.

- [ ] **Step 3: Save**

---

## Task 10: Final `main`

**Files:**
- Modify: `affinity-scripts/scale_with_text/scale_with_text_1.0.js`

- [ ] **Step 1: Replace `main()` with the real wiring**

```js
function main() {
  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { app.alert('No document open.', 'Scale With Text'); return; }

  var t = collectTargets(doc);
  if (!t) { app.alert('Select one or more objects.', 'Scale With Text'); return; }
  if (t.box.width <= 0 || t.box.height <= 0) {
    app.alert('Selection has no measurable size.', 'Scale With Text'); return;
  }

  var input = showDialog(doc, t.box);
  if (!input) return;                       // cancelled
  if (input.width <= 0 || input.height <= 0) {
    app.alert('Width and height must be greater than zero.', 'Scale With Text'); return;
  }

  var f = scaleFactors(t.box, input.width, input.height, false);
  if (isNoOp(f)) { console.log('nothing to do'); return; }

  var cmdsMod = require('/commands');
  var Selection = require('/selections').Selection;
  var builder = cmdsMod.CompoundCommandBuilder.create();

  var sel = Selection.createEmpty(doc);
  for (var i = 0; i < t.nodes.length; i++) sel.add(t.nodes[i]);
  builder.addCommand(cmdsMod.DocumentCommand.createTransform(sel, buildAnchoredScale(t.box, f.kx, f.ky, input.anchor)));

  var skipped = 0, deltaCount = 0;
  for (var fr = 0; fr < t.frames.length; fr++) {
    try {
      var fc = buildTextCommands(doc, t.frames[fr], f.kx, f.ky);
      for (var c = 0; c < fc.length; c++) builder.addCommand(fc[c]);
      deltaCount += fc.length;
    } catch (e) {
      skipped++;
      console.log('skipped a text frame: ' + (e && e.message ? e.message : e));
    }
  }

  doc.executeCommand(builder.createCommand());

  console.log('scaled ' + t.nodes.length + ' object(s) by kx=' + f.kx.toFixed(4) +
              ' ky=' + f.ky.toFixed(4) + ' about "' + ANCHORS[input.anchor].label + '"');
  console.log('compensated ' + t.frames.length + ' frame(s), ' + deltaCount + ' delta(s)');
  if (skipped) app.alert(skipped + ' text frame(s) could not be scaled. See the console.', 'Scale With Text');
}
```

Note `scaleFactors` is called with `lockRatio = false`: the dialog has already
reconciled the two fields, so both values are authoritative by this point.
Re-deriving height here would discard a deliberately unlocked entry.

- [ ] **Step 2: Run the full manual test matrix**

From the spec:

| # | Case | Expected |
|---|---|---|
| 1 | Group + frame text, uniform ×1.5 | Type scales, layout proportional |
| 2 | Each of the 9 anchors | The anchor point stays fixed |
| 3 | Non-uniform (lock off) | Box anamorphic, type follows via ScaleX |
| 4 | Group with artistic text | Scales once, not twice |
| 5 | Multi-selection | Union bbox, relative spacing preserved |
| 6 | Nested groups | Inner frame text compensated |
| 7 | Multi-run frame | Both runs scale |
| 8 | Paragraph with `spaceAfter = 12` | Gap scales with the type |
| 9 | Undo | One press restores everything |
| 10 | Scale down (×0.5) | Works symmetrically |
| 11 | Cancel dialog | No change, no undo entry |
| 12 | Type the current size (no-op) | Exits silently, no undo entry |

- [ ] **Step 3: Re-run the self-tests**

`SELFTEST = true` → expect 42 passed, 0 failed. Confirms nothing regressed.

- [ ] **Step 4: Save**

---

## Task 11: Packaging

**Files:**
- Create: `affinity-scripts/scale_with_text/registry.json`
- Create: `affinity-scripts/scale_with_text/screenshot.webp` (manual)

- [ ] **Step 1: Write `registry.json`**

```json
{
  "scripts": [{
    "id": "scale_with_text_1.0",
    "name": "scale_with_text_1.0",
    "description": "Scale a selection to a target width/height about an anchor - including frame text, which Affinity's Transform panel leaves unscaled.",
    "version": "1.0.0",
    "author": "ollio",
    "contributors": ["ollio"],
    "category": "Transform",
    "image": "screenshot.webp",
    "email": "oertel.oliver@googlemail.com",
    "download_url": "https://raw.githubusercontent.com/<user>/<repo>/main/scale_with_text/scale_with_text_1.0.js"
  }]
}
```

- [ ] **Step 2: Capture a 16:9 before/after screenshot as `screenshot.webp`**

- [ ] **Step 3: Save**

---

## Task 12: Correct the docs

Several documented facts turned out to be wrong or incomplete. Leaving them
misleads the next script.

**Files:**
- Modify: `affinity-scripts/docs/affinity-scripting-notes.md`
- Modify: `affinity-scripts/docs/affinity-sdk-reference.md`

- [ ] **Step 1: Fix the `console.log` claim**

Both files state `console.log` is invisible and prescribe dialog-dumping. It **is**
visible in this build. Keep the dialog technique as a fallback, but lead with the
console.

- [ ] **Step 2: Add the transform section**

- `node.transform` is **getter-only**; assignment silently no-ops.
- `DocumentCommand.createTransform(selection, xf, options)` — spread coordinates, about the spread origin; `options` is unvalidated.
- `DocumentCommand.createGroupTransform(selection, xDataOrNull, yDataOrNull)` takes `GroupTransformData` — likely the Transform panel's W/H path.
- `Transform` is exported from `/geometry` with `createIdentity`, `createScale`, `createTranslate`, `createRotate`, `createShear`.
- `Transform.data` is row-major 2×3 `[a, b, tx, c, d, ty]`.
- Anchored scale: `T(p).multiply(S).multiply(T(-p))`.

- [ ] **Step 3: Correct the text-run guidance**

- `story.getGlyphAttsRunEnd(pos)` returns `0` and **cannot** drive a run walk.
- Use `story.attRuns.toArray()` → `{begin, end, glyphAtts, paragraphAtts}`.
- Frame text is not scaled by `createTransform`; artistic text is.
- Strokes and layer effects carry their own "Scale with object" flags, which `createTransform` honours — never scale them from a script.

- [ ] **Step 4: Add a gotchas row**

"Assigning to a getter-only SDK property silently succeeds in non-strict mode —
verify with `Object.getOwnPropertyDescriptor` across the prototype chain, not by
try/catch."

- [ ] **Step 5: Save**
