# Vendored libraries

Third-party code bundled into the released `physicsdrop` script. Licence headers are
preserved in the concatenated build output; full texts are next to this file.

| Library | Version | Licence | File |
|---|---|---|---|
| earcut | 3.2.3 | ISC | `earcut.min.js` (`earcut-LICENSE.txt`) |
| planck.js | _not vendored yet_ | MIT (Zlib for the Box2D parts) | – |

## earcut

Source: <https://registry.npmjs.org/earcut/-/earcut-3.2.3.tgz>, file `dist/earcut.min.js`
(the UMD build — the package `main` is ESM-only and unusable in the sandbox).

The UMD wrapper resolves to its **CommonJS branch** in the Affinity sandbox, because
`typeof module === 'object'` and `typeof exports === 'object'` there. Version 3 exports the
triangulator as **`exports.default`** (v2 exported the function itself), alongside
`deviation`, `flatten` and `refine`.
