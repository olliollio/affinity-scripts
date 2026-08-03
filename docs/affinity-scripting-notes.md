# Affinity Scripting — Notes & API Reference

Practical notes for scripting **Affinity by Canva** (the newer version with MCP /
AI Automation — classic Affinity V2 has no scripting). Everything below was
verified at runtime, not assumed from documentation.

---

## Setup: getting the Script Manager connected

The [Affinity Script Manager](https://github.com/JiriKrblich/Affinity-Script-Manager)
(by JiriKrblich) talks to Affinity through a local **MCP bridge on port 6767**.
Two separate connections have to both be up:

1. **Manager ↔ Bridge** — shown in the connection window as "Online".
2. **Bridge ↔ Affinity** — shown in the library view; can say "not connected"
   even while the bridge itself is Online.

To get a full green chain:

- In Affinity's MCP settings, enable **Enable Affinity-MCP** (DE: *Affinity-MCP
  aktivieren*) and **Network access** (DE: *Zugriff auf Netzwerke*) — the latter
  is required for the local 6767 server despite the "internet" wording.
- Keep **Save scripts in your panel** (DE: *Skripte in Ihrem Panel speichern*) on
  so the bridge may write scripts.
- Open the **Scripts panel**: `Window → General → Scripts`
  (DE: `Fenster → Allgemein → Skripte`).
- **Create at least one category** in the Scripts panel (e.g. "My Scripts").
  Affinity refuses to register scripts until a category exists — a common cause
  of a persistent "Affinity not connected" state.

> **Cache note:** the Script Manager saves a *copy* of your script into
> Affinity's library. Editing the file on disk does **not** update that copy —
> re-import to pick up changes.

---

## Debugging technique

`console.log` **is** visible in the Scripts panel. It is the best debugging
channel: no length limit, no clipping, and the output can be selected and copied
as text. Prefer it for everything.

The built-in Documentation / SDK Search can fail ("Listing failed"), so it is not
a reliable reference.

**Fallback: dump to a Dialog.** Useful when you need output while a modal is
open. Build a modal dialog and write findings with `addStaticText`:

```javascript
const { Dialog } = require('/dialog');
const dlg = Dialog.create('Probe');
dlg.initialWidth = 520;
const grp = dlg.addColumn().addGroup('Result');
function show(l, t) { grp.addStaticText(l, String(t)); }

// enumerate members of any object across its prototype chain
function members(o) {
  if (o == null) return '(null)';
  const out = []; let x = o;
  while (x && x !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(x)) out.push(k);
    x = Object.getPrototypeOf(x);
  }
  return [...new Set(out)].sort().join(', ');
}
dlg.runModal();
```

Caveat: the dialog is **not scrollable** and can clip at the bottom. Keep probes
short, or chunk long output into multiple `addStaticText` fields.

Wrap the whole script in a `try/catch` that reports the error. A throw before the
dialog opens otherwise aborts silently, and the script appears to do nothing.

---

## The testing environment is not the same runtime

**`/fs` and `doc.export` work in an INSTALLED script and are denied in the Script
Manager's testing environment.** The same file, unchanged, exports frames once
installed and is `PERMISSION_DENIED` every time it is run from the testing
environment.

So when a filesystem or export call is refused: **install the script and run it
again before changing a single line.** Plausible-looking theories that all fitted
the evidence and were all wrong — path separators, call timing, script size,
export preset names, a per-script grant, a blanket capability gate — came out of
never varying the one variable that mattered.

Access can also lapse mid-session and return after restarting Affinity, so
confirm the current state with a known-good script before concluding anything.

---

## Deforming geometry can be animated

`DocumentCommand.createSetCurves(curvesInterface, polyCurve)` works as a **preview** —
`executeCommand(cmd, true)` — and is cheap: measured at 0.2ms per rewrite at 7 points and 1.0ms at
41, against a 33ms frame budget, with `clearPreviews()` restoring the original.

That matters because a rigid `createTransform` can only move a node, not reshape it. Rewriting the
curve each frame is what makes ropes, cloth or any soft body possible at 30fps.

It replaces **every** curve on the node, so several paths on one node must be rebuilt together in a
single command.

---

## Verified API facts

### Document
- `Document.current` — the active document (null if none open).
- `doc.dpi`, `doc.widthPixels`, `doc.heightPixels` — document-level size in px.
  NOTE: on a multi-artboard doc these describe the whole spread, **not** any
  single artboard.
- `doc.units` — returns the document's display unit as a string, e.g. `"Pixel"`.
- `doc.unitValueConverter` — has `getConversionFactor(fromUnit, toUnit)`.
- `doc.hasArtboards` (bool), `doc.artboards` (**a real Array**, `.length` works).
- `doc.selection` — an object, **not** an array; empty (`length: 0`) with
  artboards selected. Not a reliable way to find the active artboard.
- `doc.currentSpread` — the spread object. Has NO `getActiveArtboard` method
  (that call throws "is not a function").
- `doc.executeCommand(cmd)` / `doc.executeCommand(cmd, true)` (true = preview).
- `doc.clearPreviews()`.

### Artboards — the key gotcha
Each artboard exposes `baseBox`, `spreadBaseBox`, `artboardProperties`, `node`,
`description`, and more.

- **`artboard.baseBox`** is the artboard-**LOCAL** box — always `x=0, y=0`, and
  the same size for every artboard. **Useless for positioning.**
- **`artboard.spreadBaseBox`** is the real box in **document space**:
  `x, y, width, height` all correct and distinct per artboard. **Use this.**
- `artboard.artboardProperties` is not a geometry box (returns NaN for x/y/w/h).
- `artboard.description` exists but can be **identical or empty** across
  artboards — don't rely on it for unique labels.

Since there's no "active artboard" accessor, a script targeting one artboard
must **enumerate `doc.artboards`, read each `spreadBaseBox`, and let the user
pick from a dropdown**. Sorting the list by `(y, x)` makes the dropdown order
match the visual layout, and gives usable labels when the descriptions are all
identical.

A common bug in artboard-aware scripts: using `doc.widthPixels` /
`doc.heightPixels` with origin `0,0`, which spans the whole document instead of
the chosen artboard. Work in `X .. X+W` / `Y .. Y+H` from the artboard's
`spreadBaseBox` instead, and add its `x` / `y` offset to every coordinate.

A Box object has: `x, y, width, height` plus `topLeft, topRight, bottomLeft,
bottomRight, centre, area, offset, moveTo, clone, ...`.

### Guides
- `DocumentCommand.createAddGuide(isHorizontal, position)` — `isHorizontal`
  false = vertical guide at x, true = horizontal guide at y. Position is in
  **document pixels**, so to place a guide relative to an artboard you must add
  the artboard's `spreadBaseBox.x` / `.y` offset.
- Batch guides with `CompoundCommandBuilder.create()`, `builder.addCommand(cmd)`
  for each, then `doc.executeCommand(builder.createCommand())`. This also makes
  the whole set a single undo step.
- Open question (untested): whether guides get *bound* to an artboard or are
  plain document guides. Visually they land correctly either way.

### Units
- `UnitType` uses **British spelling**: `Millimetre`, `Centimetre`, `Metre`,
  `Point`, `Inch`, `Pixel`, `Pica`, `Foot`, `Yard`, `Mile`, `Kilometre`...
  (`Millimeter` / `Centimeter` do NOT exist).
- `getConversionFactor(Pixel, Millimetre)` ≈ 0.35278 (correct).
- `getConversionFactor(Pixel, Centimetre)` ≈ 0.035278 (correct).
- `getConversionFactor(Pixel, Inch)` ≈ 0.013889 (correct).
- ⚠️ `getConversionFactor(Pixel, Point)` returns **1** regardless of dpi —
  unreliable. Avoid offering Point, or compute it manually from dpi.

### Dialog controls
- `Dialog.create(title)`, `dlg.initialWidth`, `dlg.runModal()` → returns
  `DialogResult.Ok` / else. Dialog is **not resizable/scrollable**; content
  clips if too tall.
- `dlg.addColumn()`, `col.widthProportion = n`, `col.addGroup(title)`.
  Columns are the only horizontal unit and divide the dialog by
  `widthProportion` (a ratio, not pixels); each control added to a group is a new
  row. A grid of controls is therefore several columns side by side.
- `grp.addComboBox(label, itemsArray, selectedIndex)` → `.selectedIndex`.
  **ComboBox items are fixed at creation** — cannot be re-labelled live.
- `grp.addCheckBox(label, bool)` → `.value` (readable **and** writable, so
  mutually-exclusive checkbox groups can be hand-rolled).
- `grp.addStaticText(label, text)` → `.text`.
- `grp.addUnitValueEditor(label, storageUnit, displayUnit, value, min, max)`.
  - Members: `value, units, precision, isEnabled, isVisible, isFullWidth,
    setValue, setPrecision, setShowPopupSlider, onValueChangedHandler, ...`
  - **`units` is READ-ONLY** ("has only a getter") — the display unit is fixed
    at creation and **cannot follow a live dropdown**. To show a field in the
    document's unit, pass that unit as `displayUnit` when creating it.
  - You can type any unit into the field regardless (`100px`, `2cm`, `5mm`) and
    Affinity converts to the stored unit correctly; only the label is fixed.
  - **SDK bug**: when `max` is `null`, the initial value resets to 0. Workaround:
    set `.value` explicitly right after creating the editor.
- Change handlers: per-control `control.onValueChangedHandler = () => {...}`, or
  dialog-wide `dlg.onControlValueChangedHandler = () => {...}`.
  Setting a control's value from a handler fires that control's own handler, so
  linked fields need a re-entrancy guard or they ping-pong.
- Labels do not reflow the layout: a label wider than its column is clipped, and
  one that wraps to a second line is clipped vertically because the group's
  height doesn't grow. Treat label length as a layout constraint. Checkbox
  labels in particular must fit **one line** — roughly "Keep groups as one
  object" is the ceiling.
- **Height is the scarce resource.** OK/Cancel sit below the content, and the
  dialog neither scrolls nor resizes, so a dialog that grows too tall puts its
  own buttons out of reach. Merge help text into fewer, longer full-width
  paragraphs (`ctrl.setIsFullWidth(true)` — a method) rather than one line per
  thought.
- `UnitType` is re-exported from `/dialog`, so a dialog module needn't require
  `/units` separately. For a plain numeric slider:
  `addUnitValueEditor(label, UnitType.Number, UnitType.Number, v, min, max)`,
  then `.setShowPopupSlider(true)` and `.precision = 0`.

### Geometry, text & images

- **Every** node exposes `curvesInterface` — live `ShapeNode` and `ImageNode`
  included. Curve coordinates are in **BASE** space; `node.transform` maps them
  to the spread. ⚠️ `node.localToSpreadTransform` is **identity on every node**
  and is not the accessor its name suggests.
- Live text: `polyCurve` reports `curveCount === 1` for a whole string (one
  glyph). Per-glyph outlines, counters included, come from
  `curvesInterface.polyPolyCurves` → `getTransformedPolyCurve(i)`, which is in
  base space. No conversion to curves is needed to *read* them.
- An `ImageNode`'s curves are only its placement rectangle. Real pixels:
  `node.createCompatibleBitmap(true)` then
  `require('/pixelaccessor').PixelReaderRGBA8.create(bm)` →
  `readPixel(x, y).alpha`. Call `reader.dispose()` — it holds native memory.

---

## Native (non-script) findings

- **Resize a clipped/parent object without scaling its inset content**: select
  the parent with the Move tool, enable **"Lock Children"** (DE: *Kinder
  sperren*) in the context toolbar. Hold the **Spacebar mid-drag** to temporarily
  toggle the lock state (start dragging first, *then* press Space, or Space acts
  as the pan tool). Not Alt/Shift — those are aspect-ratio and
  scale-from-centre. Works on Windows, macOS, iPad. Not exposed as a keyboard
  shortcut.

---

## Publishing to the Community directory

Community site: <https://jirikrblich.github.io/Affinity-Community-Scripts/>
Central repo: `github.com/JiriKrblich/Affinity-Community-Scripts`
Submissions go via **GitHub Issues**, not pull requests. You don't edit
`registry.json` — the maintainer does after review.

Two routes:
- **From the app**: "Share (GitHub)" action on a script, or "Submit Script" in
  the Community tab → app copies a ready-to-submit issue to clipboard and opens
  GitHub. No tokens; credentials never touch the app.
- **Manual**: Issues tab → New Issue → fill template (Script Name, Author,
  Description, 16:9 preview image, Version, Code — paste JS or a **raw**
  GitHub URL, not the `/tree/` link).

Before submitting: verify the `/** ... */` metadata header (name, description,
version, author — this feeds the card), and prepare a 16:9 preview image.
