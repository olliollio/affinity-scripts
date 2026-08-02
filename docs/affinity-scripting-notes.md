# Affinity Scripting — Session Notes & API Reference

Findings from building the artboard-aware Swiss Grid Generator. Applies to
**Affinity by Canva** (the newer version with MCP / AI Automation — classic
Affinity V2 had no scripting). Everything below was verified at runtime in this
build, not assumed from docs.

---


## Setup: getting the Script Manager connected

The [Affinity Script Manager](https://github.com/JiriKrblich/Affinity-Script-Manager)
(by JiriKrblich) talks to Affinity through a local **MCP bridge on port 6767**.
Two separate connections have to both be up:

1. **Manager ↔ Bridge** — shown in the connection window as "Online".
2. **Bridge ↔ Affinity** — shown in the library view; can say "not connected"
   even while the bridge itself is Online.

To get a full green chain:

- In Affinity MCP settings, enable **Affinity-MCP aktivieren** and **Zugriff auf
  Netzwerke** (network access — required for the local 6767 server, despite the
  "internet" wording).
- Keep **Skripte in Ihrem Panel speichern** on so the bridge may write scripts.
- Open the **Scripts panel** in Affinity: `Window → General → Scripts`
  (DE: `Fenster → Allgemein → Skripte`).
- **Create at least one category** in the Scripts panel (e.g. "My Scripts").
  Affinity refuses to register scripts until a category exists — this was the
  actual cause of the "Affinity not connected" state.

---

## Debugging technique (important)

> **Corrected 2026-08-02:** `console.log` **is** visible in the Scripts panel.
> The earlier claim below was wrong. Use the console — it has no length limit,
> no clipping, and the output can be copied as text. The dialog technique
> remains useful only when you need output while a modal is open.

Also, the built-in Documentation / SDK Search can fail ("Listing failed"), so
it's not reliable.

**Fallback: dump to a Dialog.** Build a modal dialog and write findings with
`addStaticText`. This is how much of the API below was reverse-engineered.
Pattern:

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
  (that call throws "is not a function" in this build).
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
  artboards (all read "ArtBoard1" in the test file) — don't rely on it for
  unique labels.

Since there's no "active artboard" accessor, a script targeting one artboard
must **enumerate `doc.artboards`, read each `spreadBaseBox`, and let the user
pick from a dropdown**. Sorting the list by `(y, x)` makes the dropdown order
match the visual layout.

A Box object has: `x, y, width, height` plus `topLeft, topRight, bottomLeft,
bottomRight, centre, area, offset, moveTo, clone, ...`.

### Guides
- `DocumentCommand.createAddGuide(isHorizontal, position)` — `isHorizontal`
  false = vertical guide at x, true = horizontal guide at y. Position is in
  **document pixels**, so to place a guide relative to an artboard you must add
  the artboard's `spreadBaseBox.x` / `.y` offset.
- Batch guides with `CompoundCommandBuilder.create()`, `builder.addCommand(cmd)`
  for each, then `doc.executeCommand(builder.createCommand())`.
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
- `grp.addComboBox(label, itemsArray, selectedIndex)` → `.selectedIndex`.
  **ComboBox items are fixed at creation** — cannot be re-labelled live.
- `grp.addCheckBox(label, bool)` → `.value`.
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

---

## Native (non-script) findings

- **Resize a clipped/parent object without scaling its inset content**: select
  the parent with the Move tool, enable **"Kinder sperren" / "Lock Children"**
  in the context toolbar. Hold the **Spacebar mid-drag** to temporarily toggle
  the lock state (start dragging first, *then* press Space, or Space acts as the
  pan tool). Not Alt/Shift — those are aspect-ratio and scale-from-centre.
  Works on Windows, macOS, iPad. Not exposed as a keyboard shortcut.

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

---

## The Swiss Grid Generator (this session's deliverable)

Started from `swiss_grid_generator_en.js`. Bug: on multi-artboard docs the grid
spanned the whole document instead of the selected artboard (it used
`doc.widthPixels/heightPixels` with origin 0,0).

Fixes applied, ending at **v1.4**:
1. Enumerate `doc.artboards`, read `spreadBaseBox` per board, offer an
   **Artboard dropdown** (sorted by position). Grid math switched from
   `0..W/0..H` to `X..X+W / Y..Y+H` using the chosen artboard's box; every
   guide gets the artboard's x/y offset.
2. Unique, position-sorted dropdown labels (descriptions were all identical).
3. **Readout unit dropdown** (mm / cm / px), defaulting to `doc.units`. Point
   excluded (unreliable factor). Reformats module-size readout + log.
4. Input fields (margins/gutter/baseline/base unit) created in the **document
   unit** so they show px on a px doc. Can't follow the dropdown live because
   `UnitValueEditor.units` is read-only.
