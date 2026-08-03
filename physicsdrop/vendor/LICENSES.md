# Vendored libraries

Third-party code bundled into the released `physicsdrop` script. Licence headers are
preserved in the concatenated build output; full texts are next to this file.

| Library | Version | Licence | File |
|---|---|---|---|
| earcut | 3.2.3 | ISC | `earcut.min.js` (`earcut-LICENSE.txt`) |
| planck.js | 1.5.0 | MIT | `planck.min.js` (`planck-LICENSE.txt`) |

## planck.js

Source: <https://registry.npmjs.org/planck/-/planck-1.5.0.tgz>, file `dist/planck.min.js`
(the UMD build; the package also ships ESM and TypeScript declarations, neither usable here).
297KB minified.

The bundle has **no DOM or host dependencies**: the only occurrences of `document` and `self`
in the whole file are the MIT licence text and the UMD wrapper's `global || self` fallback.
It never touches `performance`, `window`, `navigator`, `process` or `requestAnimationFrame`,
so it loads in the sandbox with no shims. Like earcut, its UMD wrapper resolves to the
**CommonJS branch** and assigns to `module.exports`.

`Settings.maxPolygonVertices` defaults to **12** in planck 1.x (Box2D 2.3 used 8).
`SettingsInternal.maxPolygonVertices` is a getter-only alias that reads `Settings` live, so
raising the cap at runtime affects every shape built afterwards.

## earcut

Source: <https://registry.npmjs.org/earcut/-/earcut-3.2.3.tgz>, file `dist/earcut.min.js`
(the UMD build — the package `main` is ESM-only and unusable in the sandbox).

The UMD wrapper resolves to its **CommonJS branch** in the Affinity sandbox, because
`typeof module === 'object'` and `typeof exports === 'object'` there. Version 3 exports the
triangulator as **`exports.default`** (v2 exported the function itself), alongside
`deviation`, `flatten` and `refine`.
