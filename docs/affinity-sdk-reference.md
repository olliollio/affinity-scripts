# Affinity (by Canva) Scripting SDK — Developer Reference

A practical, runtime-verified reference for scripting **Affinity by Canva** — the
AI/MCP-enabled Affinity. (Classic Affinity V2 has **no** scripting.)

- **Version in scope:** Affinity **v3.2** (April 2026).
- **Language:** JavaScript. Scripts run when clicked in the **Scripts panel**;
  convention is either top-level code or a `main()` called at end of file
  (optionally `module.exports.main = main`).
- **How this was verified:** everything below was confirmed at runtime by
  probing a live document (dumping objects into dialogs) or taken from working
  community scripts — not assumed from documentation. Items still unconfirmed
  are marked **(unverified)**.

> **The authoritative SDK docs live inside the local MCP server**, not on the
> public web. See [MCP / connection](#1-environment--connection) to extract them.

---

## Table of contents
1. [Environment & connection](#1-environment--connection)
2. [Debugging technique](#2-debugging-technique)
3. [Module require paths](#3-module-require-paths)
4. [Application & Document](#4-application--document)
5. [Spreads & Artboards](#5-spreads--artboards)
6. [Selection (read & write)](#6-selection-read--write)
7. [Node model & traversal](#7-node-model--traversal)
8. [Object-level node attributes](#8-object-level-node-attributes)
9. [Shape nodes](#9-shape-nodes)
10. [Transform & rotation](#10-transform--rotation)
11. [Fill descriptors & colours](#11-fill-descriptors--colours)
12. [Text: stories & glyph attributes](#12-text-stories--glyph-attributes)
13. [Fonts](#13-fonts)
14. [Enum objects](#14-enum-objects)
15. [Units](#15-units)
16. [Dialog UI controls](#16-dialog-ui-controls)
17. [Commands, preview & undo](#17-commands-preview--undo)
18. [Raster & pixel access](#18-raster--pixel-access)
19. [Filesystem & export](#19-filesystem--export)
20. [Timers](#20-timers)
21. [Known bugs & gotchas](#21-known-bugs--gotchas)
22. [Publishing to the community directory](#22-publishing-to-the-community-directory)
23. [Appendix: raw member dumps](#23-appendix-raw-member-dumps)

---

## 1. Environment & connection

Scripts are managed by the **Affinity Script Manager** (JiriKrblich) which talks
to Affinity through a local **MCP bridge on port 6767**. Connection chain:
**Manager → Bridge (6767) → Affinity**. Affinity itself *is* the MCP server once
MCP is enabled.

- MCP endpoint: `http://localhost:6767/sse` (SSE transport).
- Inspect: `npx @modelcontextprotocol/inspector --sse http://localhost:6767/sse`

**Affinity MCP settings that must be on** (German UI labels in parentheses):

| Setting | State | Why |
|---|---|---|
| Enable Affinity-MCP (*Affinity-MCP aktivieren*) | on | — |
| Network access (*Zugriff auf Netzwerke*) | **ON** | Fixes `ECONNREFUSED ::1:6767 / 127.0.0.1:6767`. The local bridge needs it despite the "internet" wording. |
| Use saved scripts (*Gespeicherte Skripte verwenden*) | on | — |
| Save scripts in your panel (*Skripte in Ihrem Panel speichern*) | on | Lets the bridge write scripts. |
| Desktop file access | optional | Only for file I/O (files must be on Desktop). |

**Two gotchas** that leave the bridge "online" but Affinity "not connected":
1. The **Scripts panel must be open**: `Window → General → Scripts`
   (*Fenster → Allgemein → Skripte*).
2. **At least one category must exist** in the Scripts panel (e.g. "My Scripts").
   Affinity refuses to register scripts until a category exists.

**MCP tools** (for reading SDK docs / managing the library):

| Tool | Args | Purpose |
|---|---|---|
| `list_sdk_documentation` | — | List all SDK doc topics (CSV). |
| `read_sdk_documentation_topic` | `filename` | Read one topic. |
| `search_sdk_hints` | `prompt` | Fuzzy hint search. (`search_sdk_skills` does **not** exist.) |
| `list_library_scripts` | — | List installed scripts. |
| `save_script_to_library` | `title`, `description`, `code` | Install/overwrite a script. |
| `read_library_script` | `title` | Read one. |

There is **no delete tool** — scripts can only be deleted in Affinity's Scripts
panel UI.

> **Cache note:** the Script Manager saves a *copy* of your script into
> Affinity's library. Editing the file on disk does **not** update that copy —
> re-import / re-save to pick up changes.

---

## 2. Debugging technique

- **`console.log` IS visible** in the Scripts panel. It is the best debugging
  channel: no clipping, no control-count cap, copyable as text. Prefer it.
- The built-in Documentation / SDK Search can fail ("Listing failed").

**Fallback — dump to a Dialog** (this is how much of the API below was
reverse-engineered):

```js
const { Dialog } = require('/dialog');
const dlg = Dialog.create('Probe');
dlg.initialWidth = 520;
const grp = dlg.addColumn().addGroup('Result');
function show(l, t) { grp.addStaticText(l, String(t)); }

// Enumerate members of any object across its whole prototype chain:
function members(o) {
  if (o == null) return [];
  const out = []; let x = o;
  while (x && x !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(x)) out.push(k);
    x = Object.getPrototypeOf(x);
  }
  return [...new Set(out)].sort();
}
dlg.runModal();
```

**Tips:**
- The dialog is **not scrollable** and clips at the bottom. Keep probes short or
  chunk output; cap the number of controls (~90–120 is safe).
- Wrap the whole script in a `try/catch` that renders the error into a dialog —
  otherwise a thrown error before `runModal()` just silently aborts.
- Use `app.alert(msg, title)` for simple user-facing output.

---

## 3. Module require paths

Affinity's `require` uses **virtual module paths** (leading `/`). A trailing
`.js` is accepted but optional.

| `require(...)` | Exports (partial) |
|---|---|
| `/application` | `app` |
| `/document` | `Document` |
| `/selections` | `Selection`, `TextSelection`, `SubSelectionType` |
| `/nodes` | `NodeChildType`, `getNodeChildrenRecursive`, `createTypedNode`, `FrameTextNodeDefinition`, `ShapeNodeDefinition` |
| `/commands` | `DocumentCommand`, `CompoundCommandBuilder`, `AddChildNodesCommandBuilder`, `NodeChildType` |
| `/dialog` | `Dialog`, `DialogResult` |
| `/units` | `UnitType` |
| `/fonts` | `Font` |
| `/geometry` | `Rectangle`, `CurveBuilder`, `PolyCurve` |
| `/shapes` | `ShapeRectangle` |
| `/fills` | `FillDescriptor` |
| `/colours` | `SVG11` |
| `/storybuilder` | `StoryBuilder` |
| `/storydelta` | `StoryDelta`, `GlyphAttDoubleType` |
| `/glyphatts` | `GlyphAttDoubleType`, `LeadingOverrideType` |
| `/paragraphatts` | `ParagraphAttStringType`, `ParagraphAttDoubleType`, `ParagraphLeadingType` |
| `affinity:story` | `StoryRange` |
| `/fs` | `File`, `createDirectories`, `isDirectory`, `exists`, `getFileSize`, `PathType` |
| `/timers` | `setInterval`, `Timer` |
| `/document` | also `FileExportOptions`, `FileExportArea` (export lives here, not in an `/export` module) |
| `/rasterobject` | `NodeRenderingEngine`, `RasterFormat` |
| `/pixelaccessor` | `PixelReaderRGBA8` |

`/dialog` also re-exports `UnitType`, so a dialog module need not require `/units`
separately.

---

## 4. Application & Document

| Member | Notes |
|---|---|
| `app` | `require('/application')`. |
| `app.documents.current` | Active document (or null). |
| `Document.current` | Also the active document. Both wrappers see the same selection in practice. |
| `app.alert(msg, title?)` | Modal alert. |
| `app.userDesktopPath` | Property (no `get` prefix). Windows path, e.g. `E:\USER\Desktop`. |
| `app.chooseFile()` | Opens an **Open** dialog and returns an existing file's path. Grants **no** write access to that file or its folder. |
| `doc.export(path, options, area[, size])` | See [Filesystem & export](#19-filesystem--export). |
| `doc.dpi` | Document DPI. |
| `doc.widthPixels`, `doc.heightPixels` | Whole-spread size in px (**not** any single artboard on multi-artboard docs). |
| `doc.units` | Display unit as a string, e.g. `"Pixel"`. |
| `doc.unitValueConverter` | `.getConversionFactor(fromUnit, toUnit)`. |
| `doc.hasArtboards` | bool. |
| `doc.artboards` | A real Array (`.length` works). |
| `doc.selection` | See [Selection](#6-selection-read--write). |
| `doc.currentSpread` | The active spread node. **No** `getActiveArtboard()`. |
| `doc.executeCommand(cmd[, preview])` | `preview=true` renders a non-committed preview. |
| `doc.clearPreviews()` | Clear previews. |
| `doc.undo()` | Undo last command. |
| `doc.formatText(delta, selection)` | Apply a `StoryDelta` to a selection (see [Text](#12-text-stories--glyph-attributes)). |

---

## 5. Spreads & Artboards

There is **no "active artboard" accessor**. To target one artboard, either
enumerate `doc.artboards` and let the user pick, or (when you have a reference
node) walk up its parents to find the containing artboard.

**Per-artboard geometry:**

| Member | Notes |
|---|---|
| `artboard.baseBox` | Artboard-**LOCAL** box — always `x=0,y=0`, identical size for every artboard. **Useless for positioning.** |
| `artboard.spreadBaseBox` | Real box in **document space** (`x,y,width,height` distinct per artboard). **Use this.** |
| `artboard.artboardProperties` | Not a geometry box (NaN for x/y/w/h). |
| `artboard.description` | Can be identical/empty across artboards — not a reliable unique label. |

A **Box** has `x, y, width, height, topLeft, topRight, bottomLeft, bottomRight,
centre, area, offset, moveTo, clone, …`.

**Find the artboard containing a node** (verified pattern):

```js
function artboardAncestor(node) {
  let n = node;
  while (n) {
    try { const ai = n.artboardInterface; if (ai && ai.isArtboardEnabled) return n; }
    catch (e) {}
    n = n.parent;
  }
  return null;
}
```
The artboard node's box is `n.artboardInterface.baseBox`. The top of the tree is
a **SpreadNode** (`node[Symbol.toStringTag] === 'SpreadNode'`); spread extents via
`spread.getSpreadExtents()`, and `doc.spreads.first`.

---

## 6. Selection (read & write)

`doc.selection` is an object (not an array).

| Member | Notes |
|---|---|
| `sel.length` | Count (0 when empty; also 0 with artboards selected). |
| `sel.firstNode` | First selected node, or null. |
| `sel.nodes` | Node collection: `sel.nodes.first`, `.isEmpty`, `.filter(fn)`, and `for…of`. |
| `sel.items` | **Iterable** collection. Each item: `.node`, `.getSubSelectionOfType(SubSelectionType.Text)`. |

⚠️ **Gotcha:** `sel.items` is iterable (`for...of`) but **NOT index-accessible** —
`sel.items[0]` is `undefined`, so `sel.items[0].node` throws. Use `sel.firstNode`
or iterate. When trying multiple accessors, guard each **separately**; one shared
`try/catch` lets the first throw skip all fallbacks.

**Text sub-selection** (from `item.getSubSelectionOfType(SubSelectionType.Text)`):
`.isEmpty`, `.rangeCount`, `.ranges[i].{begin, end}`.

**Set the live selection** (verified):

```js
const { Selection } = require('/selections');
const sel = Selection.createEmpty(doc);
for (const n of nodes) sel.addNode(n);   // addNode is the verified member name
doc.selection = sel;                 // commits as the app's live selection
```

`DocumentCommand.createSetSelection(selection)` does the same as an undoable
command — `createSetSelection(Selection.createEmpty(doc))` deselects everything.

**Node identity:** the SDK hands back a **fresh wrapper** for the same document
node, so `a === b` is not reliable. Use `a.isSameNode(b)`, falling back to
`a.handle === b.handle`. This matters whenever a command replaces the selection
and you need to tell the new nodes from the ones you were already holding.

Shortcuts worth knowing:

- **`Selection.create(doc, nodeOrArray)`** accepts an **array** of nodes, not
  just one.
- **`node.selfSelection`** is a ready-made selection for that node — no need to
  build one.
- **`node.getSpreadBaseBox(false)`** returns a spread-space box.

Build a selection over one node / a text range:

```js
const s = Selection.create(doc, frameNode);
const ts = TextSelection.create(new StoryRange(begin, end));
s.addSubSelectionForNode(frameNode, ts);
```

---

## 7. Node model & traversal

Every node exposes (partial): `parent`, `firstChild`, `lastChild`,
`nextSibling`, `handle`, `description`, `defaultDescription`, plus many `is…`
type flags (`isNode`, `isVisible`, `isLocked`, `isSelectable`, `isVectorNode`,
`isShapeNode`, `isPolyCurveNode`, `isGroupNode`, …).

**Node type** is `node[Symbol.toStringTag]` — observed values: `ShapeNode`,
`PolyCurveNode`, `GroupNode`, `SpreadNode`, `FrameTextNode`(text).

**Recursive traversal** (verified):

```js
const { NodeChildType, getNodeChildrenRecursive } = require('/nodes');
const scope = refNode.parent || doc.currentSpread;   // container to search
for (const child of getNodeChildrenRecursive(scope.handle, NodeChildType.Main, false)) {
  // child is every descendant node
}
```
Note the first arg is `scope.handle` (not the node itself).

---

## 8. Object-level node attributes

These apply across node types (shapes, groups, text frames).

| Attribute | Accessor | Notes |
|---|---|---|
| Object opacity | `node.globalOpacity` | `0..1`. The object opacity slider. |
| Fill opacity | `node.fillOpacity` | `0..1`. The fill layer's own opacity. |
| Blend mode | `node.blendMode` | An **enum object** — read `.value` (numeric). See [Enums](#14-enum-objects). |
| Line/stroke weight | `node.lineWeight`, `node.lineWeightPts` | — |
| Solid fill (brush) | `node.hasBrushFill`, `node.brushFillDescriptor` | See [Fills](#11-fill-descriptors--colours). |
| Solid stroke (pen) | `node.hasPenFill`, `node.penFillDescriptor` | — |
| Transform / rotation | `node.transform` | See [Transform](#10-transform--rotation). |
| Description / name | `node.description`, `node.defaultDescription` | Human-facing shape name e.g. "Polyline", "Rounded Rectangle". **May be localised** ("Abgerundetes Rechteck", "Gruppe") — avoid as a stable key. |

---

## 9. Shape nodes

A **live** shape (drawn with a shape tool, **not** converted to curves) has type
`ShapeNode`, `node.isShapeNode === true`, and exposes the shape object.

> A rectangle **converted to curves** becomes a `PolyCurveNode` with **no shape
> and no corner-radius parameter** — the rounding is baked into
> `curvesInterface.corneredPolyCurve` geometry.

| Accessor | Notes |
|---|---|
| `node.shape` | The shape object, e.g. `ShapeRectangle`. |
| `node.shapeInterface` | `{ shape, type, boundingBox, domainTransform, node, isShapeInterface, handle }`. |
| `node.shape.shapeType` | **Enum** — `.value` is the shape kind (`0` = rectangle, …). Use for "same shape type". |
| `node.shape.isPlainRectangle` | bool (false when corners are rounded). |
| `node.shape.absoluteSizes` | bool — **false** = corner radius is a `0..1` fraction of the shape; **true** = absolute px. |
| `node.shape.topLeft` / `topRight` / `bottomLeft` / `bottomRight` | Each a **`ShapeRectangleCornerProxy`**. |
| `node.shape.majorAxis`, `node.shape.rotationOrder` | Enum / int. |

**Corner proxy** (`ShapeRectangleCornerProxy`):

| Member | Notes |
|---|---|
| `radius` | Number. Relative (0..1) or px per `absoluteSizes`. |
| `cornerType` | **Enum** (Round / Straight / Concave / …) — read `.value`. |
| `handle` | — |

**Create shapes** (from working code):

```js
const { ShapeRectangle } = require('/shapes');
const { ShapeNodeDefinition } = require('/nodes');
const { Rectangle } = require('/geometry');
const { FillDescriptor } = require('/fills');
const { SVG11 } = require('/colours');

const shape = ShapeRectangle.create();
const rect  = new Rectangle(x, y, w, h);
builder.addShapeNode(ShapeNodeDefinition.create(shape, rect,
  FillDescriptor.createSolid(SVG11.black)));
```

**Curves** — `node.curvesInterface`: members `polyCurve` `[PolyCurve]`,
`corneredPolyCurve` `[PolyCurve]`, `polyPolyCurves`, `windingOrder`,
`domainTransform`, `isMutable`, `node`, `handle`.

> **Every node type exposes `curvesInterface`** — `PolyCurveNode`, live
> `ShapeNode`, `ArtTextNode` and `ImageNode` alike. There is no such thing as a
> live shape with no curves: a live rounded rectangle hands over 8 beziers with
> the rounding already baked into `polyCurve`, so no bounding-box fallback is
> needed. `curvesInterface.isMutable` is what separates genuinely editable
> geometry (`PolyCurveNode` → `true`) from generated geometry (live `ShapeNode`,
> `ArtTextNode`, `ImageNode` → `false`).

### Coordinate space — curve coords are BASE space

The matrix mapping curve coordinates to spread space is **`node.transform`**,
which equals `node.baseToSpreadTransform` and equals
`curvesInterface.domainTransform`.

> ⚠️ **`node.localToSpreadTransform` is identity on every node**, including ones
> that are demonstrably offset — a grouped child sitting at +220.0/+228.6 still
> reports identity. Using it silently places every grouped object at the wrong
> position. It is not the accessor its name suggests.

Cross-checks: a grouped child's `baseBox.x` 251.99 → `spreadBaseBox.x` 471.99
(= 251.99 + 220.0034); an image's 599×301 base box → 357.93×179.86 spread box
under a 0.5976 scale.

### Glyph outlines from live text

`polyCurve` reports **`curveCount === 1` for an entire string** — that is one
glyph, and reading it is what makes live text look unsupported. The real
container is **`curvesInterface.polyPolyCurves`**: one `PolyCurve` per glyph,
counters included ("o" and "e" report two curves, outer plus hole).

| Member | Notes |
|---|---|
| `polyPolyCurves.polyCurveCount` | Glyph count. |
| `getTransformedPolyCurve(i)` | Glyph outline in the node's **BASE** space — verified on a rotated, offset text node, it reproduces `baseBox` exactly and `node.transform` then lands it on `spreadBaseBox`. **Use this one.** |
| `getPolyCurve(i)` | Em space, near the origin. Not directly usable. |

Reading these leaves the text **editable** — no conversion needed.
`DocumentCommand.createConvertToCurves(selection)` exists as the destructive
alternative, and is the only way to get glyphs that can move *independently*,
because it produces one `PolyCurveNode` per letter. Note it **replaces the app
selection** with just the new nodes, so anything else you were holding must be
carried across by hand (see [Selection](#6-selection-read--write) on node
identity).

> ⚠️ A live text node is **one node**. Any scheme that derives several
> independently-moving objects from it will apply several conflicting transforms
> to that single node — the artwork lurches while the geometry is perfectly
> correct and never visible.

**Affinity's own flattener** is `curve.generatePolygon(tolerance)`, which returns
a **`PolygonHandle` whose members do not enumerate**; no accessor for its points
has been found. Flattening `curve.beziers` yourself — by **arc length**, not by
parameter `t` — is the working route. Useful classifiers on `Curve`:
`isRectangleTolerance`, `isEllipseTolerance`, `isPolylineTolerance`,
`isStraightLineTolerance`.

**Read** the geometry:
- `pc = ci.polyCurve`; `pc.curveCount`; `pc.at(i)` → a `Curve`.
- `curve.beziers` — iterable of segments; each `bz` has `bz.start, bz.c1, bz.c2,
  bz.end` (points with `.x` / `.y`). `curve.isClosed`.

> ⚠️ **Straight segments are stored as cubics** with the handles collapsed onto
> the anchors (`c1 ≈ start`, `c2 ≈ end`), and those cubics are **not
> constant-speed** — so distributing points by curve *parameter* `t` bunches
> them toward the ends. Distribute by **arc length** when you need even spacing.

**Rebuild & write back** (round-trip verified in `add_anchor_points`):

```js
const { CurveBuilder, PolyCurve } = require('/geometry');
const ci  = node.curvesInterface;
const pc  = ci.polyCurve;
const out = PolyCurve.create();
for (let i = 0; i < pc.curveCount; i++) {
  const curve = pc.at(i);
  const cb = CurveBuilder.create();
  cb.begin(firstSeg.start);
  for (const s of segments) cb.addBezier(s.c1, s.c2, s.end);
  if (curve.isClosed) cb.close();
  out.addCurve(cb.createCurve());
}
doc.executeCommand(DocumentCommand.createSetCurves(ci, out));
```

An exact **De Casteljau split** preserves shape exactly (lines stay lines,
curves keep their form). `examples/redundantnodesremover.js` is the inverse op.
Filter selected curves with `doc.selection.nodes.filter((n) => n.isPolyCurveNode)`
(`sel.nodes` supports `.filter()`, `.isEmpty`, and `for…of`).

---

## 10. Transform & rotation

> ⚠️ **`node.transform` is GETTER-ONLY.** The descriptor on `Node` is
> `get=function set=undefined`. Assigning to it **silently does nothing** in
> non-strict mode — no throw, no change. To verify writability of any SDK
> property, walk the prototype chain with `Object.getOwnPropertyDescriptor`;
> a try/catch tells you nothing here.

**To change geometry, use a command:**

| Call | Notes |
|---|---|
| `DocumentCommand.createTransform(selection, xf, options)` | Applies `xf` to the selection. Works in **spread coordinates about the spread origin** — anchoring is your job. `options` is **unvalidated** (accepts `{}`, `true`, `1` alike); there is no hidden "scale text" flag. |
| `DocumentCommand.createGroupTransform(selection, xDataOrNull, yDataOrNull)` | Takes `GroupTransformData`, not a `Transform`. Almost certainly the Transform panel's W/H box-relayout path — the one that does *not* scale text. |

`Transform` is exported from **`/geometry`**, with statics `createIdentity`,
`createScale`, `createTranslate`, `createRotate`, `createShear`, plus
`multiply` / `add` / `subtract`.

`Transform.data` is **row-major 2×3**: `[a, b, tx, c, d, ty]`.
(`createTranslate(10,20)` → `[1,0,10, 0,1,20]`.)

**Scale about an anchor point `p`** (verified against a non-uniform kx=2/ky=3 test):

```js
const { Transform } = require('/geometry');
const xf = Transform.createTranslate(p.x, p.y)
                    .multiply(Transform.createScale(kx, ky))
                    .multiply(Transform.createTranslate(-p.x, -p.y));
// data === [kx, 0, p.x*(1-kx), 0, ky, p.y*(1-ky)]
```
`t.around(x,y)` and `t.translated(...)` produce the same matrix but `around()`
**mutates its receiver** and `translated()`'s multiply side is undocumented —
prefer the explicit form. `t.about()` is deprecated in favour of `around()`.

**What `createTransform` scales for you — do NOT scale these from a script:**

| Thing | Handled by |
|---|---|
| Shapes, images, curves, nested groups | the transform itself |
| **Artistic** text | the transform (glyphs are geometry) |
| Stroke weight | the stroke panel's **"Scale with object"** flag — see below |
| Layer effects | each effect's own **"Scale with object"** flag |
| **Frame text** | ❌ **nothing** — the frame box scales, the type does not. Compensate manually (see [Text](#12-text-stories--glyph-attributes)). |

Useful geometry accessors on any node: `baseBox` (local), `spreadBaseBox` /
`exactSpreadBaseBox` (document space, matches the Transform panel W/H),
`localVisibleBox` / `spreadVisibleBox` (includes stroke + effect bleed),
`getContentExtentsBox()`, `getContentExtentsBoxOfChildren()`, plus
`baseToSpreadTransform` / `spreadToBaseTransform` / `localToSpreadTransform`.
There is **no** `node.boundingBox` or `node.getBounds()`.

### Strokes and scaling

`node.lineStyleDescriptor` is a **`LineStyleDescriptor`**:

| Member | Notes |
|---|---|
| `isScale` | **This is the stroke panel's "Scale with object" checkbox.** (Not `penFillDescriptor.isScaleWithObject` — that governs fill anchoring and reads `true` on almost everything, including groups.) |
| `effectiveWeight(localTransform?, worldTransform?)` | A **method**, not a property. With no arguments it returns the nominal weight. |
| `cloneScaled(scale)` | Returns a new descriptor with the weight scaled. **Arity 1** — a second argument is silently ignored. Original untouched. |
| `clone`, `cloneWithNewLineStyle`, `cloneWithNewArrowHeads`, `lineStyle`, `strokeAlignment`, `isBehind`, `pressure`, `frontArrowHead`, `backArrowHead` | — |

**Nothing is stored scaled.** `createTransform` leaves `lineWeight` and
`effectiveWeight()` untouched on *every* node, flag or not — the scaling happens
at render time from the node's transform. Measuring `lineWeight` before/after a
transform therefore proves nothing.

The rendering model is visible through `effectiveWeight`'s two arguments:

| | `local` slot | `world` slot | product |
|---|---|---|---|
| `isScale = false` | scales | inverse | **1.0** → stroke unchanged |
| `isScale = true` | scales | 1.0 | **factor** → stroke scales |

The `local` factor is **not** gated by `isScale`; the flag only decides whether
`world` cancels it.

**Affinity's stroke-scale factor is the RMS of the axis scales:**

```js
factor = Math.sqrt((kx*kx + ky*ky) / 2);
```
Measured: `(2,2)→2.0000`, `(2,1)→1.5811` (=√2.5), `(2,4)→3.1623` (=√10),
`(0.5,0.5)→0.5000`, and symmetric in kx/ky. **Not** `sqrt(kx*ky)` (1.4142) and
**not** a mean (1.5).

**⚠️ `lineWeight > 0` does NOT mean the node has a stroke.** Affinity keeps the
stored weight — and the dash pattern — when you remove a stroke's colour. Such a
node reports a plausible weight (e.g. `4.17`) with:

```
hasPenFill = true            // means "has a pen fill SLOT", not a visible stroke
lineStyleInterface.isNoFill            = true
lineStyleInterface.isLineStyleVisible  = false
penFillDescriptor.fill                 -> NoFill
```

Writing a `LineStyleDescriptor` to it **materialises that dormant stroke**,
dashes and all. Before touching a stroke, require:

```js
const ls = node.lineStyleInterface;
const hasStroke = node.lineWeight > 0 &&
                  ls.isLineStyleVisible === true &&
                  ls.isNoFill !== true;
```
`node.isLineStyleVisible` exists in the member list but reads `undefined` — the
usable one is on `lineStyleInterface`.

**To scale a stroke that Affinity would skip** (`isScale === false`):

```js
const scaled = node.lineStyleDescriptor.cloneScaled(factor);
doc.executeCommand(DocumentCommand.createSetLineStyleDescriptor(
  Selection.create(doc, node), scaled));
```
Signature is `createSetLineStyleDescriptor(selection, lineStyleDescriptor, options)`
where `options` may carry `lineStyleMask`, `contentType`, `useTextSelection`,
`defaultsMode` — all optional. **Never** do this when `isScale === true`; the
renderer already applies the factor and you would double-scale.

`node.lineStyleInterface` exposes `descriptorCount` and
`getAllLineStyleDescriptors()`, so a node can carry more than one stroke.

### Rotation

`node.transform` is a `Transform`.

| Member | Type | Notes |
|---|---|---|
| `xAxis` | `Vector` | Transformed (1,0) basis. `.x`, `.y`. |
| `yAxis` | `Vector` | Transformed (0,1) basis. |
| `origin` | `Point` | `.x`, `.y`. |
| `data` | `Float64Array` | Raw affine matrix components. |
| `inverted` | `Transform` | Inverse. |
| `decompose()`, `rotate()`, `rotated()`, `scale()`, `scaled()`, `shear()`, `compose()`, `multiply()`, `invert()`, `setIdentity()`, `clone()`, `applyToPoint()`, `applyToVector()` | methods | — |

**Rotation angle** (robust — independent of scale and raw-matrix order):

```js
function rotationDeg(node) {
  const t = node.transform, ax = t && t.xAxis;
  if (!ax) return null;
  const deg = Math.atan2(ax.y, ax.x) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;   // normalise to [0,360)
}
```
Sign/convention may differ from the Transform panel (Affinity's Y is screen-down)
but is deterministic. For a "same rotation" match, bucket the result (e.g.
`.toFixed(1)`).

---

## 11. Fill descriptors & colours

A **FillDescriptor** wraps a fill (object fills and text runs both use it).

| Member | Notes |
|---|---|
| `fill` | The actual Fill: `SolidFill` / `NoFill` / gradient / pattern. |
| `fillType` | Enum. |
| `blendMode` | Enum — fill-level blend (separate from the node's blend). |
| `transform`, `isAnchoredToSpread`, `isScaleWithObject`, `handle` | — |

Only a **SolidFill** compares reliably. Canonical colour key:

```js
function solidColourKey(fill) {
  if (fill && fill[Symbol.toStringTag] === 'SolidFill') {
    const c = fill.colour.rgba8;      // { r, g, b, alpha } 0..255
    return c.r + ',' + c.g + ',' + c.b + ',' + c.alpha;
  }
  return null;                        // gradient / none / pattern
}
```

Create fills / colours: `FillDescriptor.createSolid(colour)`; named colours via
`require('/colours').SVG11` (e.g. `SVG11.black`, `SVG11.lightgrey`).

---

## 12. Text: stories & glyph attributes

A text frame node satisfies:
`node.isFrameTextNode && node.storyInterface && node.storyInterface.story`.

> This section is about text **content and formatting**. For the *geometry* of
> the letters — glyph outlines usable as paths or collision shapes — see
> [Glyph outlines from live text](#glyph-outlines-from-live-text).

- `story = node.storyInterface.story`
- `story.length` — glyph count (valid positions `0 … length-1`)
- `story.getGlyphAtts(pos)` — the glyph attributes at a position (see schema)

### Reading & writing text content (verified)

Reading the frame's string:

| Accessor | Result |
|---|---|
| `story.text` | The whole string. ✅ |
| `story.getText(begin, end)` | Substring by glyph index. ✅ |
| `story.getText(new StoryRange(begin, end))` | Substring by range. ✅ |
| `story.string` / `.plainText` / `.getString` / `.substring` | do **not** exist |
| `story.toString()` | `"[object Story]"` (not the text) |

### Attribute runs — use `attRuns`, not `getGlyphAttsRunEnd`

> ⚠️ **`story.getGlyphAttsRunEnd(pos)` returns `0`** and cannot drive a run
> walk — a loop built on it never advances.

Use the `attRuns` **Collection** instead. Each item is a plain
`{begin, end, glyphAtts, paragraphAtts}`:

```js
const runs = story.attRuns.toArray();
for (const run of runs) {
  run.begin; run.end;
  run.glyphAtts.height;              // font size, points
  run.paragraphAtts.spaceAfter;      // absolute, points
  run.paragraphAtts.leadingType.value;
}
```
`story.getAttRunsFrom(pos)` returns the same shape from an offset.

**Format one run** (verified — 18pt → 27pt at ×1.5):

```js
const s = Selection.create(doc, frameNode);
s.addSubSelectionForNode(frameNode, TextSelection.create(new StoryRange(run.begin, run.end)));
doc.executeCommand(DocumentCommand.createFormatText(s,
  StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, run.glyphAtts.height * 1.5)));
```
Build a **fresh `Selection` per delta** — sub-selections are consumed by the
command that receives them. Batch with `CompoundCommandBuilder` for one undo step.

### Which text attributes are absolute vs relative

Matters whenever you scale type. Absolute ones must be multiplied; relative ones
already follow the font size, so scaling them **double-applies**.

| Absolute (scale these) | Relative (leave alone) |
|---|---|
| glyph: `height`, `baselineAdvance`, `offsetX`, `offsetY` | glyph: `characterSpacing`, `manualKerning` (em-based) |
| para: `spaceBefore`, `spaceAfter`, `leftIndent`, `rightIndent`, `firstLineIndent`, `lastLineOutdent`, `defaultTabStops`, `hyphenationZone*` | para: `relativeLeading`, `min`/`desired`/`max` word + letter spacing (fractions) |

`absoluteLeading` (on **both** glyph and paragraph atts) is only read when
`paragraphAtts.leadingType.value ∈ {2 ExactlyAbsolute, 3 AtLeastAbsolute,
4 RelativeToIdealAbsolute}`. In the common `0 RelativeToIdeal` mode it is `0`
and unused — scaling it is a silent no-op.

Non-uniform type scaling: set `height *= ky`, then `scaleX *= kx/ky`.

Boundary / range helpers on the story (for word- or paragraph-aware search &
replace): `getWordRange`, `getParagraphRange`, `getTextRange`, `getGlyphRange`,
`findWordBegin`, `findWordEnd`, `findWordPart`, `findParagraphBreak`,
`rFindWordBegin`, `rFindWordEnd` (reverse find), `isWordBegin`, `isWordEnd`,
`isEmpty`, `length`. Also `fillerTextGlyphs` — Affinity's native filler /
placeholder text.

**Set a frame's text** (whole-frame; replaces all existing runs):

```js
const { Selection } = require('/selections');
const sel = Selection.create(doc, frameNode);
doc.executeCommand(DocumentCommand.createSetText(sel, 'Hello\nWorld'));
// '\n' acts as a paragraph break.
```

`Math.random()` **is** available in the Affinity script runtime (used for e.g.
placeholder-text generation). `storyInterface` also exposes many `*Glyphs`
collections (`charGlyphs`, `anchorGlyphs`, `dataMergeGlyphs`, `fieldGlyphs`, …)
plus `domainTransform`.

**Read a font size** (verified):

```js
const { SubSelectionType } = require('/selections');
const story = node.storyInterface.story;
const sub = item.getSubSelectionOfType(SubSelectionType.Text);
const pos = (sub && !sub.isEmpty && sub.rangeCount) ? sub.ranges[0].begin : 0;
const sizePt = story.getGlyphAtts(pos).height;   // in POINTS
```

### `getGlyphAtts(pos)` schema (verified)

Scalar / enum members:

| Member | Type / value | Notes |
|---|---|---|
| `height` | number | **Font size in points** (matches the Text panel — no 96/72 conversion). |
| `styleName` | string | Empty for a regular style. |
| `characterSpacing` | number | — |
| `manualKerning` | number | — |
| `baselineAdvance` | number | — |
| `absoluteLeading` | number | — |
| `autoKernMinHeight` | number | — |
| `offsetX`, `offsetY` | number | — |
| `scaleX`, `scaleY` | number | Glyph scale (1 = 100%). |
| `shearX` | number | — |
| `isNoBreak` | bool | — |
| `spellingLanguageId` | string | e.g. `"de-DE"`. |
| `openTypeLanguageTag`, `openTypeScriptTag` | number | — |
| `capsType`, `superSubType`, `opticalAlignmentType`, `leadingOverrideType`, `strikeoutType`, `underlineType`, `tocRoleType` | **enum** | Read `.value`. |
| `hyphenationLanguageId` | string | — |

Object members:

| Member | Type | Notes |
|---|---|---|
| `font` | `Font` | See [Fonts](#13-fonts). |
| `brushFill` | `FillDescriptor` | **Text FILL** colour → `.fill` → SolidFill. |
| `penFill` | `FillDescriptor` | **Text STROKE** colour. |
| `highlightFill`, `strikeoutFill`, `underlineFill`, `transparency` | `FillDescriptor` | — |
| `lineStyleDescriptor` | `LineStyleDescriptor` | — |
| `handle` | `GlyphAttsHandle` | — |

Accessors on the atts object: `getDoubleValue`, `getStringValue`,
`setDoubleValue`, `setStringValue`, `clone`.

### Writing text formatting

```js
const { StoryDelta } = require('/storydelta');
const { GlyphAttDoubleType } = require('/glyphatts');

// Simple: apply to the current selection
doc.formatText(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, 24), doc.selection);

// Command form
const delta = StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, 24);
const cmd = DocumentCommand.createFormatText(selection, delta);
doc.executeCommand(cmd);
```

Other deltas seen in the wild: `StoryDelta.createGlyphString(GlyphAttStringType.StyleName, name)`,
`StoryDelta.createBrushFill(fillDescriptor)`, `StoryDelta.createPostscriptName(name)`,
`StoryDelta.createFamilyName(name)`, `StoryDelta.createParagraphString(ParagraphAttStringType.StyleName, name)`,
`DocumentCommand.createSetText(selection, text)`.

> **No document text-style creation API** in v3.2 — you can set
> `ParagraphAttStringType.StyleName` as metadata and apply direct formatting, but
> you cannot register a named Text Style from a script.

---

## 13. Fonts

`atts.font` (and `Font.createDefault()`, `addFontPicker().font`) is a `Font`:

| Member | Notes |
|---|---|
| `familyName` | e.g. "Helvetica". Use for "same font family". |
| `postscriptName` | Uniquely identifies family **+ style**. Use for "same family & style". |
| `isBold`, `isItalic` | bool. |
| `isBoldAvailable`, `isItalicAvailable`, `isCondensed`, `isExpanded`, `isMonospaced`, `isNormal` | bool. |
| `isValid` | bool. |
| `handle` | — |

Apply a font to a run: `StoryDelta.createPostscriptName(font.postscriptName)`
(preferred) or `StoryDelta.createFamilyName(font.familyName)`.

---

## 14. Enum objects

Affinity enums (`BlendMode`, `ShapeType`, `ShapeCornerType`, `CapsType`, …) are
**objects**, not primitives. Each carries:

| Member | Notes |
|---|---|
| `value` | Numeric id — use this as a stable comparison key. |
| `isEnumValue` | `true`. |

```js
function enumVal(e) {
  return (e && e.value !== undefined) ? e.value : e;
}
```
Observed: `ShapeType.value === 0` for a rectangle.

---

## 15. Units

`UnitType` uses **British spelling**: `Millimetre`, `Centimetre`, `Metre`,
`Point`, `Inch`, `Pixel`, `Pica`, `Foot`, `Yard`, `Mile`, `Kilometre`, `Number`
(unitless). `Millimeter` / `Centimeter` do **not** exist.

`doc.unitValueConverter.getConversionFactor(from, to)`:

| Conversion | Factor | Note |
|---|---|---|
| Pixel → Millimetre | ≈ 0.35278 | correct |
| Pixel → Centimetre | ≈ 0.035278 | correct |
| Pixel → Inch | ≈ 0.013889 | correct |
| Pixel → **Point** | **1** | ⚠️ wrong regardless of dpi — avoid Point, or compute from dpi. |

---

## 16. Dialog UI controls

| Call | Notes |
|---|---|
| `Dialog.create(title)` | — |
| `dlg.initialWidth = n` | Dialog is **not resizable/scrollable**; content clips if too tall. |
| `dlg.runModal()` | Returns `DialogResult.Ok` / else. Some builds compare via `.value` (`res.value === DialogResult.Ok.value`). |
| `dlg.addColumn()` | → column. `col.widthProportion = n`. |
| `col.addGroup(title)` | → group. |
| `grp.addComboBox(label, itemsArray, selectedIndex)` | `.selectedIndex`. **Items fixed at creation** (can't relabel live). |
| `grp.addCheckBox(label, bool)` | `.value`. |
| `grp.addStaticText(label, text)` | `.text`. |
| `grp.addTextBox(label, text)` | `.text`. `.isFullWidth`. |
| `grp.addFontPicker(label)` | `.font`. `.isFullWidth`. |
| `grp.addUnitValueEditor(label, storageUnit, displayUnit, value, min, max)` | `.value`, `.units` (**read-only**), `.precision`, `.isEnabled`, `.isVisible`, `.setValue`, `.setPrecision`, `.setShowPopupSlider`. |
| Change handlers | Per-control `ctrl.onValueChangedHandler = () => {}`; dialog-wide `dlg.onControlValueChangedHandler = () => {}`. |

- **`UnitValueEditor.units` is read-only** — the display unit is fixed at
  creation and can't follow a live dropdown. Users can still *type* any unit
  (`2cm`, `5mm`) and Affinity converts to the stored unit.
- **Bug:** when `max` is `null`, the initial value resets to `0`. Workaround: set
  `.value` explicitly right after creating the editor.

**A plain numeric slider** — the shape that renders correctly for unitless
values:

```js
const { Dialog, DialogResult, UnitType } = require('/dialog');   // UnitType comes from /dialog too
const ctl = grp.addUnitValueEditor('Gravity', UnitType.Number, UnitType.Number, 1000, 100, 10000);
ctl.setShowPopupSlider(true);
ctl.precision = 0;
```

**Height is the scarce resource.** The dialog neither scrolls nor resizes, and
the OK/Cancel buttons sit *below* the content — so a dialog that grows too tall
does not clip harmlessly, it puts its own buttons out of reach. Budget for it:

- Each full-width `addStaticText` costs real height. Merge help text into fewer,
  longer paragraphs rather than one line per thought.
- **Checkbox labels must fit one line.** The control sits in a narrow column and
  the row height is fixed, so a label that wraps is clipped and cannot be read at
  all. Roughly "Keep groups as one object" is the ceiling; anything longer
  belongs in full-width help text, which does wrap properly.
- `ctrl.setIsFullWidth(true)` is a **method** (the `isFullWidth` property is
  listed, but the setter is the form that works). `addStaticText` returns the
  control, so it is normally called straight off that.

---

## 17. Commands, preview & undo

| Call | Notes |
|---|---|
| `DocumentCommand.createAddGuide(isHorizontal, position)` | `false` = vertical guide at x; `true` = horizontal at y. Position in **document px** (add the artboard's `spreadBaseBox.x`/`.y` offset to place relative to an artboard). |
| `DocumentCommand.createFormatText(selection, delta)` | Text formatting. |
| `DocumentCommand.createSetText(selection, text)` | Replace a frame's whole text. `selection` = `Selection.create(doc, frameNode)`; `'\n'` = paragraph break. |
| `DocumentCommand.createSetCurves(curvesInterface, polyCurve)` | Replace a curve node's geometry (see [Shape nodes → Curves](#9-shape-nodes)). |
| `DocumentCommand.createSetSelection(selection)` | Set the selection as an undoable command. `Selection.createEmpty(doc)` deselects all. |
| `DocumentCommand.createConvertToCurves(selection)` | Convert live text / shapes to `PolyCurveNode`s. Destructive; **replaces the app selection** with the new nodes. |
| `DocumentCommand.createTransform(sel, xf, { mergeable: false })` | The options bag is **unvalidated** (see [Transform](#10-transform--rotation)); `{ mergeable: false }` is what working animation code passes, but its effect has not been isolated. |
| `DocumentCommand.createSetDescription(...)`, `createSetOpacity(...)`, `createSetCurveNodeStyle(...)`, `createSetDocumentProperties(...)` | Many `createSet*` setters exist (opacity, description, effects, adjustments, …) — enumerate `members(DocumentCommand)` to discover. |
| `CompoundCommandBuilder.create()` → `.addCommand(cmd)` → `.createCommand()` | Batch many commands into one undo step. |
| `AddChildNodesCommandBuilder.create()` → `.setInsertionTarget(node)` / `.addNode(def)` / `.addShapeNode(def)` → `.createCommand(true, NodeChildType.Main)` | Insert nodes. |
| `doc.executeCommand(cmd)` / `doc.executeCommand(cmd, true)` | `true` = preview (non-committed). |
| `doc.clearPreviews()` | Clear previews. |
| `doc.undo()` | Undo. |

### Commands that create nodes

**A command exposes the nodes it created** — execute it, then read `cmd.newNodes`:

```js
const cmd = DocumentCommand.createKnifeCut(cutCurve, Selection.create(doc, node));
doc.executeCommand(cmd);
const pieces = cmd.newNodes;      // >= 2 when the cut actually split the node
```

| Call | Notes |
|---|---|
| `createKnifeCut(curve, selection)` | Splits nodes along a curve into **real separate nodes**. Build the curve with `new CurveBuilder().beginXY(x,y).lineToXY(x,y).createCurve()` and extend it well past the shape's bounds. Feeding each pass the pieces from the last is how one shape becomes many. |
| `createTransform(selection, null, { duplicateNodes: true })` | Duplicates. A **null transform is legal** here, and `newNodes[0]` is the copy. Fails on groups — shape, image or text only. |
| `createSetVisibility(selection, bool)` | — |
| `createMoveNodes(selection, target, NodeMoveType.After, NodeChildType.Main)` | `NodeMoveType` and `NodeChildType` both come from `/commands`. |

Separate nodes are the only way to move things independently — one node can
carry only one transform (see [Glyph outlines](#glyph-outlines-from-live-text)).

*(Verified from `examples/crack_and_explode.js` by rbonelli, a shipping script,
rather than from a probe.)*

### The preview / commit model

This is what makes live scrubbing cheap, and it is worth stating exactly:

- `executeCommand(cmd, true)` renders a **preview that supersedes the previous
  preview**. Dragging a slider therefore costs one preview per move, not an undo
  stack to unwind afterwards.
- `executeCommand(cmd, false)` **commits** one undoable step.
- `clearPreviews()` drops anything uncommitted, returning the document to its
  last committed state.

Because a preview is not guaranteed to render into an **export**, an export loop
must commit each frame, export, then `undo()` — it cannot reuse the cheap preview
path.

---

## 18. Raster & pixel access

An `ImageNode`'s **curves are only its placement rectangle**, in local pixel
coordinates (e.g. `0,0–599,301`), positioned by `node.transform`. To reach real
pixels — for a true silhouette, an alpha mask, colour sampling — you need the
raster path.

`ImageNode` raster members: `rasterInterface`, `rasterWidth`, `rasterHeight`,
`rasterFormat`, `pixelSize`, `createCompatibleBuffer`, `createCompatibleBitmap`,
`copyTo`, `imageFilePath`.

```js
// Preferred: the node makes its own bitmap.
let bm = node.createCompatibleBitmap(true);

// Fallback: render the node explicitly.
if (!bm) {
  const ro = require('/rasterobject');
  bm = ro.NodeRenderingEngine.createDefault(node, ro.RasterFormat.RGBA8)
         .createCompatibleBitmap(true);
}

const reader = require('/pixelaccessor').PixelReaderRGBA8.create(bm);
const p = reader.readPixel(px, py);      // { r, g, b, alpha }, 0..255
reader.dispose();                        // holds native memory — release it
```

- `bm.width` / `bm.height` are the bitmap's pixel dimensions.
- **`PixelReaderRGBA8` lives in `/pixelaccessor`.** There is no `/image`,
  `/images`, `/pixels` or `/raster` module — those were invented names and do not
  exist.
- Map pixel space to base space by the ratio of `node.baseBox` to the bitmap
  (`sx = box.width / bm.width`), then apply `node.transform` as for any vector
  node.

---

## 19. Filesystem & export

> ## ⚠️ Read this before debugging any permission denial
>
> **`/fs` and `doc.export` work in an INSTALLED script and are denied in the
> Script Manager's testing environment.** The same file, unchanged, exports
> frames once installed and is `PERMISSION_DENIED` every time it is run from the
> testing environment.
>
> **So: never debug an `/fs` or `doc.export` denial in code — install the script
> and try again first.** A long chain of plausible theories came out of not
> knowing this: path separators, call timing, script size, export preset names,
> a per-script grant, a blanket capability gate. Every one of them fitted the
> evidence, because the real variable was never varied. If a filesystem call is
> denied while a known-good script succeeds, the difference is *how the script is
> being run*.
>
> Denials can also come and go within a session — an installed script exported
> successfully, failed an hour later, and was restored by restarting Affinity.
> Confirm the current state with a known-good script before drawing conclusions.

### `/fs`

| Call | Notes |
|---|---|
| `fsys.createDirectories(path)` | Creates a directory chain. |
| `fsys.isDirectory(path)` | ⚠️ Test for **truthiness, not `=== true`**: `/fs` exports a `PathType` enum (`Directory = 3`), so a strict boolean comparison reads a perfectly good folder as a failure. |
| `fsys.exists(path)`, `fsys.getFileSize(path)` | — |
| `File` | `File.prototype` carries the primitives: `open`, `read`, `write`, `writeStringAsUtf8`, `seek`, `getLength`. |

**`File.readAll` returns a Buffer, not a string.** `String(File.readAll)` leaks
the shim — `new File(path,'rb')` → `Buffer.create(f.length)` → `f.read(buf, …)` —
so a `typeof v === 'string'` check rejects a perfectly successful read.

`FileOrigin` is a red herring: its values are `Begin/Current/End`, i.e. seek
origin. `FilePermissions` is POSIX mode bits for `setFilePermissions`. **Neither
grants anything** — there is no in-script mechanism to request access.

### Paths

- `app.userDesktopPath` is the root to build from; on Windows it returns a
  backslash path (`E:\USER\Desktop`).
- The form proven to work is that **backslash root with forward slashes
  appended**: `E:\USER\Desktop/MyFolder/frame_0000.png`. Whether a fully
  backslashed path also works is untested — the denials that once suggested
  otherwise turned out to be the installed-vs-testing problem above.
- **Write into a folder the script created itself.** The Desktop root was
  refused in testing, so folder creation is not a nicety and a "write flat
  instead" fallback only converts a clear failure into a confusing later one.
- `app.chooseFile()` opens an **Open** dialog and returns an existing file's
  path. It does **not** confer write access to that file or its folder.

### Export

`FileExportOptions` and `FileExportArea` are exported from **`/document`** —
there is no `/export` module.

```js
const { FileExportOptions, FileExportArea } = require('/document');
const opts = FileExportOptions.createWithPresetName('PNG');
const area = FileExportArea.createForCurrentSpread();   // also createForDocument / createForSelection
doc.export(path, opts, area);                           // 4th arg: size
```

**Preset names are exact and case-sensitive**, and guessing them is the wrong
approach: `FileExportOptions.allPresetNames` is a **property** listing all 64 on
a live install. `PNG` exists bare, but every JPEG preset is qualified — `JPEG
(Best quality)`, `JPEG (High quality)` — so there is **no** preset called just
`JPEG`, and `png` in lower case is rejected. Ask for the list and match against
it.

---

## 20. Timers

`require('/timers')` gives `setInterval` and `Timer`. The callback receives an
**error first**, so a long-running loop can stop cleanly instead of wedging
Affinity:

```js
const { setInterval, Timer } = require('/timers');
setInterval(33, (err) => {
  if (err) { Timer.cancelAll(); return; }
  // … one frame of work …
  if (done) Timer.cancelAll();
});
```

`Timer.cancelAll()` is the stop. Driving a long job from a timer rather than a
`for` loop is what keeps the UI responsive for its duration — and modal dialogs
can be raised from inside the callback.

---

## 21. Known bugs & gotchas

| # | Gotcha | Detail / workaround |
|---|---|---|
| 1 | Assigning to a getter-only SDK property silently succeeds | Non-strict mode discards it — no throw, no change. `node.transform` is the notable case. Verify with `Object.getOwnPropertyDescriptor` across the prototype chain, **not** with try/catch. |
| 2 | `story.getGlyphAttsRunEnd(pos)` returns `0` | Unusable for run walks. Use `story.attRuns.toArray()`. |
| 3 | `createTransform` doesn't scale frame text | Frame text is a layout container; the box scales, the type doesn't. Artistic text *is* scaled. Compensate frame text with per-run `createFormatText` deltas. |
| 4 | Stroke scaling is never stored | `lineWeight` / `effectiveWeight()` are identical before and after a transform on every node. Read `lineStyleDescriptor.isScale` for the flag and `effectiveWeight(localTransform)` for the rendered value. `effectiveWeight` is a **method** — reading it as a property returns the function, which stringifies to something that looks like data. |
| 5 | `sel.items[0]` throws | `sel.items` is iterable, not indexable. Use `for...of` or `sel.firstNode`. |
| 6 | Shared `try/catch` hides fallbacks | Guard each selection accessor separately. |
| 7 | Script library caches a copy | Re-import to apply on-disk edits. |
| 8 | Silent abort on error | A throw before the dialog opens shows nothing — wrap the whole script in `try/catch` and log or alert the message. |
| 9 | `UnitValueEditor` `max: null` | Resets value to 0; set `.value` after creation. |
| 10 | `UnitValueEditor.units` read-only | Can't follow a live dropdown. |
| 11 | Pixel→Point factor = 1 | Avoid Point, or compute from dpi. |
| 12 | `artboard.baseBox` is local | Use `spreadBaseBox` for document-space geometry. |
| 13 | No active-artboard accessor | Enumerate `doc.artboards` or walk parents. |
| 14 | `description` may be localised | Don't use as a stable key (use `shapeType.value` etc.). |
| 15 | Converted rectangle ≠ shape | A `PolyCurveNode` has no `shape`/corner-radius params. |
| 16 | No text-style creation API | Only direct formatting + `StyleName` metadata. |
| 17 | Dialog not scrollable | Cap control count; chunk long output. |
| 18 | `lineWeight > 0` ≠ has a stroke | Removing a stroke's colour leaves the weight and dash pattern stored. Writing a `LineStyleDescriptor` to such a node creates a visible stroke from nothing. Gate on `lineStyleInterface.isLineStyleVisible === true` and `isNoFill !== true`. `hasPenFill` means "has a pen fill slot" and is `true` even on strokeless groups. |
| 19 | Dialog labels don't reflow | A label wider than its column is clipped; one that wraps to a second line is clipped vertically. Treat label length as a layout constraint. |
| 20 | `/fs` and `doc.export` denied | Almost always because the script is being run from the **Script Manager's testing environment**. Install it and try again *before* changing any code. See [Filesystem & export](#19-filesystem--export). |
| 21 | `isDirectory(path) === true` fails | `/fs` returns a `PathType` enum (`Directory = 3`), not a boolean. Test truthiness. |
| 22 | `File.readAll` returns a Buffer | A `typeof === 'string'` check rejects a successful read. |
| 23 | `localToSpreadTransform` is identity | On **every** node, including offset ones. Use `node.transform` to map curve coordinates into spread space. |
| 24 | `polyCurve.curveCount === 1` on text | That is one glyph, not the string. Per-glyph outlines live in `polyPolyCurves` via `getTransformedPolyCurve(i)`. |
| 25 | Export preset names are case-sensitive | `PNG` works, `png` does not, and there is no bare `JPEG`. Read `FileExportOptions.allPresetNames` instead of guessing. |
| 26 | `generatePolygon()` output is unreadable | Returns a `PolygonHandle` whose members don't enumerate. Flatten `curve.beziers` yourself, by arc length. |
| 27 | Tall dialogs hide their own buttons | The dialog neither scrolls nor resizes and OK/Cancel sit below the content, so excess height puts them out of reach — not merely clipping cosmetic text. |
| 28 | One node can only hold one transform | Deriving several independently-moving objects from a single node (e.g. per-glyph bodies from a live text node) applies conflicting transforms to it; the artwork lurches while the geometry is correct and invisible. |

---

## 22. Publishing to the community directory

- Community site: <https://jirikrblich.github.io/Affinity-Community-Scripts/>
- Central repo: `github.com/JiriKrblich/Affinity-Community-Scripts`
- Community hub (v3.2): <https://affinityhub.js.org/>

Submissions go via **GitHub Issues**, not pull requests — the maintainer edits
the central `registry.json` after review.

**Two routes:**
- **From the app:** "Share (GitHub)" on a script, or "Submit Script" in the
  Community tab → app copies a ready-to-submit issue to clipboard and opens
  GitHub.
- **Manual:** Issues → New Issue → fill the template (Script Name, Author,
  Description, **16:9 preview image**, Version, Code — paste JS or a **raw**
  GitHub URL, not the `/tree/` link).

**Per-script metadata header** (feeds the card):

```js
/**
 * name: my_script_1.0
 * description: ...
 * version: 1.0.0
 * author: yourname
 */
```

**Per-script `registry.json`** (folder-per-script layout):

```json
{
  "scripts": [{
    "id": "my_script_1.0",
    "name": "my_script_1.0",
    "description": "...",
    "version": "1.0.0",
    "author": "yourname",
    "contributors": ["yourname"],
    "category": "Selection",
    "image": "screenshot.webp",
    "url": "https://example.com",
    "email": "you@example.com",
    "download_url": "https://raw.githubusercontent.com/<user>/<repo>/main/my_script/my_script_1.0.js"
  }]
}
```

---

## 23. Appendix: raw member dumps

Verbatim member lists captured from probes (v3.2), for reference.

### `getGlyphAtts(pos)` — text run
```
absoluteLeading, autoKernMinHeight, baselineAdvance, brushFill, capsType,
characterSpacing, clone, constructor, font, getDoubleValue, getStringValue,
handle, height, highlightFill, hyphenationLanguageId, isNoBreak,
leadingOverrideType, lineStyleDescriptor, manualKerning, offsetX, offsetY,
openTypeLanguageTag, openTypeScriptTag, opticalAlignmentType, penFill, scaleX,
scaleY, setDoubleValue, setStringValue, shearX, spellingLanguageId,
strikeoutFill, strikeoutType, styleName, superSubType, tocRoleType,
transparency, underlineFill, underlineType
```

### `ShapeNode` (live rounded rectangle) — scalar members
```
artboardDescription, artboardEnabled, artboardOrigin, canBeExpressedAsVectorClip,
canTransformWhileProtecting…, dashPhase, defaultDescription,
defaultDescriptionForDisplay, description, exportConfig, fillOpacity, firstChild,
globalOpacity, hasBalancedDashes, hasBrushFill, hasPenFill, isEditable,
isLineStyleVisible, isLocalEditable, isLocked, isMarkAsDecoration, isMasterEditable,
isNode, isPhysicalNode, isSelectable, isShapeNode, isVectorNode, isVisible,
isVisibleInDomain, isVisibleInExport, lastChild, lineWeight, lineWeightPts,
nextSibling, pictureFrameDescription, pictureFrameEnabled, tagColour, userDescription
```
Object members include: `blendMode`, `shape`, `shapeInterface`, `curvesInterface`,
`brushFillDescriptor`, `penFillDescriptor`, `transform`, `parent`, `handle`.

### `shape` (`ShapeRectangle`)
```
absoluteSizes, bottomLeft, bottomRight, displayName, handle, isAffectedByScale,
isPlainRectangle, majorAxis, rotationOrder, shapeType, topLeft, topRight
```

### corner proxy (`ShapeRectangleCornerProxy`)
```
cornerType, handle, radius
```

### `transform` (`Transform`)
```
about, applyToPoint, applyToVector, around, assign, clone, compose, constructor,
data, decompose, invert, inverted, multiply, origin, postmultipliedBy,
postmultiplyBy, premultipliedBy, premultiplyBy, rotate, rotated, scale, scaled,
setIdentity, shear, xAxis, yAxis
```

### `curvesInterface`
```
corneredPolyCurve, domainTransform, handle, isMutable, node, polyCurve,
polyPolyCurves, windingOrder
```

### `story` (text frame — `node.storyInterface.story`)
```
anchorGlyphs, attRuns, charGlyphs, containsBookEndnotes, containsIndex,
containsToc, dataMergeGlyphs, documentFieldGlyphs, fieldGlyphs, fillerTextGlyphs,
findParagraphBreak, findWordBegin, findWordEnd, findWordPart, formattableFieldGlyphs,
getAttRunsFrom, getGlyph, getGlyphAtts, getGlyphAttsRunEnd, getGlyphType,
getParagraphAtts, getParagraphRange, getSoftBreakType, getText, getTextRange,
getWordRange, glyphs, handle, hardBreakGlyphs, isEmpty, isParagraphBreak, isTable,
isWordBegin, isWordEnd, isWordPart, length, listNumberGlyphs, nonSpaceParts,
pageNumberGlyphs, paragraphRanges, punctuationParts, rFindParagraphBreak,
rFindWordBegin, rFindWordEnd, spaceParts, text, usesGlobalNumbering, wordParts,
wordRanges
```
(`story.text` returns the whole string; `getText`/`getTextRange`/`getWordRange`/
`getParagraphRange` address sub-ranges. No `string`/`getString`/`substring`.)

---

*Compiled from runtime probing of Affinity by Canva v3.2 and working community
scripts. Members marked as enums expose a numeric `.value`. Verify anything
marked **(unverified)** against the live MCP SDK docs before relying on it.*
