# Official Affinity JSLib — vendored reference copy

**This is not our code. Do not edit these files, and do not execute them from
this repo.** They are here to be *read*.

## What this is

The convenience library that Affinity ships inside the application. It wraps the
raw JavaScript SDK (the `XxxApi` / `XxxHandle` native layer) in a friendlier
object API. Affinity publishes it separately for reference; this is that copy.

- 135 JS files, 51,584 lines
- 34 worked examples in `examples/`
- ~50 test files in `tests/`, with real `.afdesign` / `.af` fixtures
- **BSD 3-Clause License, Copyright (c) 2026, Canva Pty Ltd** — see the header
  block at the top of any source file. Redistributable with attribution, which
  is why it can live in this repo.

## Why it matters here

**These files are the modules our scripts already `require`.** Every `/module`
path used anywhere in this repo resolves to a file in this folder:

```
application  colours  commands  dialog  document  fills  fs  geometry
glyphatts  nodes  paragraphatts  pixelaccessor  rasterobject  selections
shapes  storydelta  timers  units
```

So `require('/geometry')` in one of our scripts is loading Affinity's own copy of
`geometry.js`, and the file of that name here is its source. Before this landed,
the only way to learn a wrapper's behaviour was to dump objects into a modal
dialog at runtime.

## How to read it

Every wrapper is a `HandleObject` subclass holding a private `#handle`, and each
method forwards to the native layer with that handle as the first argument:

```js
// curvesinterface.js
class CurvesInterface extends HandleObject {
    get polyCurve() {
        return new PolyCurve(CurvesInterfaceApi.getCurves(this.handle));
    }
}
```

That gives the general mapping between the two official sources:

| Native method (Sphinx docs) | What we write (this library) |
|---|---|
| `CurvesInterfaceApi.getCurves(self)` | `node.curvesInterface.polyCurve` |
| `XxxApi.foo(self, a, b)` | `handleObject.foo(a, b)` |
| `XxxApi.getFoo(self)` | `handleObject.foo` (a getter) |

`handleobject.js` is the place to start — it explains `liveStruct`, the reason
both `params.position = {x, y}` and `params.position.x = 5` write through to the
document.

There is **no JSDoc** anywhere in the library (no `@param`, no `@returns`, no
`@example`). Prose comments are rare but good where they exist; `@deprecated`
markers are the main annotation. The value is the source, the examples and the
tests.

## Where this sits among our sources

1. **This library** — definitive for the API we actually write.
2. **The published SDK docs** (`https://sdk.affinity.studio/33000/js/`) —
   definitive for the native `XxxApi` surface: exact signatures, argument types,
   return types, and the full enum list.
3. **`../affinity-sdk-reference.md` and `../affinity-scripting-notes.md`** —
   definitive for *behaviour*. Neither official source documents the quantised
   timer interval, the modal-from-a-working-callback crash, base-space curve
   coordinates, the preview/commit model, or the installed-vs-panel runtime
   split. Those are ours and stay ours.

## Caveat

This is the library as shipped in some unidentified build — there is no version
marker anywhere in the tree. If it drifts from the copy inside the Affinity
install being scripted, reading it could mislead. Spot-check a signature at
runtime before relying on it for anything load-bearing.
