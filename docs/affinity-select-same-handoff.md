# Affinity "Select By / Select Same" Scripting — Handoff

Context dump for continuing this work in Claude CLI. Covers two prior chat
sessions: (1) getting the Affinity Script Manager connected, (2) concepting a
"Select Same" script toolkit. Environment: Windows 11 / WSL2 / DDEV / Cursor.

---

## 1. Goal

Adobe Illustrator has a rich **Select → Same** submenu. Affinity's native
equivalent is thin. We want to close the gap by scripting the missing
"select same X" behaviors into Affinity via the Affinity Script Manager
(MCP-based). Build them **one at a time**.

**First target chosen: Same Font Size.**

---

## 2. Affinity Script Manager — working setup (already solved)

Tool: https://github.com/JiriKrblich/Affinity-Script-Manager/

The connection chain is **Manager → Bridge (port 6767) → Affinity**. Both the
Affinity app (which *is* the server once MCP is on) and the bridge must run.

Settings that had to be enabled inside Affinity's MCP settings:
- **Affinity-MCP aktivieren** — on
- **Zugriff auf Netzwerke** — ON. This was the original `ECONNREFUSED ::1:6767
  / 127.0.0.1:6767` cause. Despite the "internet" wording, the local bridge
  server on 6767 needs this permission.
- **Gespeicherte Skripte verwenden** — on
- **Skripte in Ihrem Panel für Skripte speichern** — on
- "Auf Dateien auf dem Desktop zugreifen" — optional (only for file I/O; the
  markdown importer needs files on the Desktop specifically)
- "Studio-Features mit Canva AI" — off (unrelated, burns Canva AI quota)

Second gotcha after network access (bridge "online" but "not connected"):
Affinity only reports **connected** once the **Scripts panel is open AND at
least one category exists**. Fix:
1. **Fenster → Allgemein → Skripte** (Window → General → Scripts)
2. Create a category in the panel (e.g. "My Scripts")
3. Refresh / re-click install in the Manager → dot turns green

Status: **connection works, dot goes green.** Setup is done.

---

## 3. Native Affinity "Select Same" — what already exists

From the screenshot of Illustrator's full Select→Same menu, mapped against
Affinity's native capability. Affinity natively covers only **3**:

- **Fill Colour** ✅ (Select → Select Same → Fill Colour)
- **Stroke Colour** ✅
- **Stroke Weight** ✅

Affinity also has a **Select → Select Object** menu (select by category:
curves, text, images/placed, objects on current layer) and older
same-layer-vs-document scoping. Not attribute-based.

### Illustrator's full Select→Same menu (the target list)

**Shapes & Text**
| Illustrator item      | Affinity native? |
|-----------------------|------------------|
| Appearance            | ❌ |
| Appearance Attribute  | ❌ |
| Blending Mode         | ❌ |
| Fill & Stroke (combined) | ❌ (separate only) |
| Fill Color            | ✅ |
| Opacity               | ❌ |
| Stroke Color          | ✅ |
| Stroke Weight         | ✅ |
| Graphic Style         | ❌ |
| Shape                 | ❌ |
| Symbol Instance       | ❌ |
| Link Block Series     | ❌ |

**Text**
| Illustrator item          | Affinity native? |
|---------------------------|------------------|
| Font Family               | ❌ |
| Font Family & Style       | ❌ |
| Font Family, Style & Size | ❌ |
| Font Size                 | ❌  ← **FIRST BUILD TARGET** |
| Text Fill Color           | ⚠️ partial (general fill catches it, not text-scoped) |
| Text Stroke Color         | ⚠️ partial |
| Text Fill & Stroke Color  | ❌ |

### Recommended build order (high value, mechanically clean)
Opacity, Blending Mode, Font Family, Font Size, Shape, and combined
Fill & Stroke. User picked **Font Size** first.

---

## 4. Affinity scripting API — verified findings

Affinity release in scope: **April 2026 (v3.2)**. (The community Affinity Hub
installer targets v3.2 as well: https://affinityhub.js.org/)

**Key discovery: the authoritative SDK docs live INSIDE the local MCP server**,
not on the public web. Extract them with the helper repo below (must be run
against a live Affinity + MCP on localhost:6767).

Reference repo (helpers + one real example script):
https://github.com/rabidgremlin/affinity-scripting

### MCP tool names (confirmed from that repo's code)
- `list_sdk_documentation` — lists all SDK doc topics (CSV)
- `read_sdk_documentation_topic` (arg: `filename`) — reads one topic
- `search_sdk_hints` (arg: `prompt`) — fuzzy global hint search (results
  mediocre for now). Note: docs reference `search_sdk_skills` but that tool
  does NOT exist; the real one is `search_sdk_hints`.
- `add_sdk_hint` — seems to update the `preamble` doc
- `list_library_scripts`
- `save_script_to_library` (args: `title`, `description`, `code`)
- `read_library_script` (arg: `title`)
- **No delete tool** — scripts can only be deleted in Affinity's Scripts panel UI.

MCP endpoint: `http://localhost:6767/sse` (SSE transport).
Inspector: `npx @modelcontextprotocol/inspector --sse http://localhost:6767/sse`

### Confirmed API surface (from the real `markdown_import_to_text_frame.js`)

Module imports (Affinity's `require` uses virtual module paths):
```js
const { app } = require('/application');
const { File } = require('/fs');
const { Document } = require('/document');
const { Selection, TextSelection } = require('/selections');
const { StoryRange } = require('affinity:story');
const { DocumentCommand } = require('/commands');
const { StoryDelta } = require('/storydelta');
const { ParagraphAttStringType } = require('/paragraphatts');
const { GlyphAttStringType } = require('/glyphatts');
```

Confirmed patterns:
- `Document.current` → active document (or null)
- `doc.selection.nodes` → node list, has `.length` and `.first`
- Text frame node test: `node.isFrameTextNode && node.storyInterface && node.storyInterface.story`
- Build a selection over a node: `Selection.create(doc, frameNode)`
- Build a text range sub-selection:
  ```js
  const sel = Selection.create(doc, frameNode);
  const textSel = TextSelection.create(new StoryRange(begin, end));
  sel.addSubSelectionForNode(frameNode, textSel);
  ```
- Apply a glyph (character) attribute to a range:
  ```js
  const delta = StoryDelta.createGlyphString(GlyphAttStringType.StyleName, styleName);
  const cmd = DocumentCommand.createFormatText(selection, delta);
  doc.executeCommand(cmd);
  ```
- Paragraph attr variant: `StoryDelta.createParagraphString(ParagraphAttStringType.StyleName, name)`
- Set frame text wholesale: `DocumentCommand.createSetText(selection, text)`
- `app.alert(msg, title?)`, `app.chooseFile()`, `app.getUserDesktopPath`
- File read: `File.readAll(path)` → buffer; `PERMISSION_DENIED` unless file is
  on Desktop or filesystem access enabled for scripts
- Hello world minimal:
  ```js
  const { app } = require('/application');
  app.alert('Hello, World!');
  ```
- Scripts run immediately when clicked in the panel; convention is a `main()`
  called at end of file, with `module.exports.main = main`.

Note: `StoryDelta.createGlyphString(GlyphAttStringType.StyleName, …)` uses a
"String"-typed attribute. Font size is numeric, so it's likely a *different*
constructor (e.g. a `createGlyphDouble`/`…Float`/`…Int` variant) and a
different `GlyphAttStringType`-sibling enum for the size key. **Unverified —
confirm in the extracted docs.**

---

## 5. OPEN UNKNOWNS — must resolve before Font Size script will run

The markdown example only ever *sets* glyph attrs on a known range. A
"select same font size" script needs three things it never demonstrates:

1. **Iterate ALL nodes in the document** (not just `doc.selection`). Need the
   traversal/spread call — how to walk the layer tree / get all nodes.
2. **READ font size off a node's story/glyph run.** Need: the glyph-size
   attribute key, and the read accessor (the example only writes). Also how to
   handle mixed sizes within one frame (per-run, not per-frame).
3. **SET the document's active selection** to a computed list of nodes.
   The example builds `Selection` objects only to *format* them, never to
   commit them as the app's live selection. Need the "make this the current
   selection" call.

### How to resolve (run against live MCP — user will do in CLI)
```bash
git clone https://github.com/rabidgremlin/affinity-scripting
cd affinity-scripting && npm install
node extract_docs.js          # dumps all SDK docs to ./docs
node search_sdk.js "glyph font size read attribute"
node search_sdk.js "select nodes set document selection"
node search_sdk.js "iterate all nodes layers traverse"
```
Then grep `./docs` for: `glyphatts`, `GlyphAtt`, `FontSize`/`Size`, `selection`,
`Node`, `traverse`, `children`, `spread`, `Selection`. Feed the relevant topics
back to Claude to finalize the script.

---

## 6. Font Size script — design (pending unknowns above)

Intended behavior:
1. Require an active document + a non-empty selection (the "sample").
2. Read the sample's font size(s). Decide semantics for multi-size samples —
   simplest v1: require the sample to be a single uniform size, else alert.
3. Walk all text nodes in the document; for each glyph run, compare size to
   the target within a small epsilon (float compare, e.g. |a-b| < 0.01).
4. Collect matching nodes (v1: whole-frame match = frame contains the target
   size; a stricter v2 could select sub-ranges).
5. Commit those nodes as the new document selection.
6. `app.alert` a summary (n matches) — also useful as diagnostic during bring-up.

### Bring-up strategy
Write v1 with a **diagnostic fallback**: wrap each unverified API call so a
failure alerts *which* call/line failed, so one run tells us exactly which of
the three unknowns needs the doc lookup. Iterate from there.

### Install once written
```bash
node script_mgr.js add \
  --title "Select Same — Font Size" \
  --description "Selects all text with the same font size as the current selection" \
  --file select_same_font_size.js
# then click it in Affinity's Scripts panel (panel open + a category must exist)
```

---

## 7. Immediate next step for CLI session

1. Run the extractor + the three `search_sdk.js` queries above.
2. Resolve the 3 unknowns (node traversal, read glyph size, set selection).
3. Have Claude write `select_same_font_size.js` against the real API.
4. Install via `script_mgr.js add`, run, iterate using the diagnostic alerts.
5. Once Font Size works, reuse the skeleton for the next targets:
   Opacity → Blending Mode → Font Family → Shape → Fill & Stroke.

---

## Reference links
- Manager: https://github.com/JiriKrblich/Affinity-Script-Manager/
- API helpers + example: https://github.com/rabidgremlin/affinity-scripting
- Community script hub (v3.2): https://affinityhub.js.org/
- Affinity MCP connector setup: https://www.affinity.studio/help/ai-connector-setup/#configure-affinity
