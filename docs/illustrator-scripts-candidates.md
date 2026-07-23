# Illustrator Scripts → Affinity Candidate List

Source: https://www.illustratorscripts.com/ (crawled 2026-07-23, all 10 pages, ~110 scripts).

Goal: pick which of these are worth porting to Affinity. Each entry has a **Port** rating:

- ✅ **Easy** — pure geometry / selection / color logic, no Illustrator-only APIs. Ports cleanly.
- 🟡 **Medium** — needs UI, gradients, symbols, or document features Affinity supports differently.
- 🔴 **Hard/N-A** — depends on Illustrator-only features (fonts-as-QR, ExtendScript file IO, physics/animation, prepress trapping, etc.) or duplicates a native Affinity feature.

Priority ⭐ = strong fit for this repo's current direction (selection / transform / color utilities).

---

## Selection

| Script | What it does | Port |
|---|---|---|
| Select by Name ⭐ | Select objects by object name | ✅ (aligns w/ Select Same) |
| Symbol Selector | Select all instances of a symbol | 🟡 |
| Select by Font ⭐ | Select text frames by font | ✅ |
| Select by Artboard | Select objects on a given artboard | 🟡 |
| Select Similar Text Frames ⭐ | Select text frames matching attributes | ✅ |
| Image Selector | Find/filter/select linked & embedded images | 🟡 |
| Select Every Nth Object ⭐ | Select every Nth object in a group | ✅ |
| Select Objects Across Multiple Layers | Select by clicking layer names | 🟡 |
| Select Objects by Size Range ⭐ | Select objects within a size range | ✅ |
| Randomly Select Objects ⭐ | Select a % or N random objects from selection | ✅ |

## Transform / Move

| Script | What it does | Port |
|---|---|---|
| Smart Rotate (reference points) ⭐ | Rotate with reference-point UI | ✅ |
| Smart Resize ⭐ | Precise scaling UI | ✅ |
| Skew with Custom Axis ⭐ | Skew around chosen axis | ✅ |
| Reflect Across Custom Axes ⭐ | Mirror around arbitrary axis | ✅ |
| Move by Distance ⭐ | Move objects by exact distance | ✅ |
| Stroke Scaler ⭐ | Scale stroke weight proportionally | ✅ |
| MirrorMove | Mirror the last transform | 🟡 |
| Rescale / ResizeToSize | Resize artwork to exact dimensions | ✅ |
| Swap Object Positions ⭐ | Swap position + size of two objects | ✅ |
| Set Multiple Object Properties ⭐ | Batch-apply transforms to many objects | ✅ |
| Point Attractor | Rotate/scale objects toward a target point | 🟡 |
| distributeStackedObjects | Distribute + center selected objects | ✅ |
| copyToObject / copyToMultipleObjects | Copy top object onto other objects' positions | ✅ |
| Randomly Swap Object Positions | Shuffle positions of selected objects | ✅ |

## Color / Appearance / Swatches

| Script | What it does | Port |
|---|---|---|
| Swap Fill and Stroke Colors ⭐ | Swap fill/stroke | ✅ |
| Invert Colors ⭐ | Invert colors of selection | ✅ |
| Swatch Type Converter | Convert swatch types (spot/process) | 🟡 |
| Color Value Converter | Convert between color models | ✅ |
| Random Swatch Color Generator | Generate random swatches | ✅ |
| Randomize / Vary Hues ⭐ | Randomize colors from swatches | ✅ |
| Cycle Colors Through Swatches | Apply swatches sequentially | ✅ |
| Convert Flat Colors to Gradients | Solid fill → gradient | 🟡 |
| Distribute Gradient Stops | Even-space gradient stops | 🟡 |
| Inner Shadow Effect | SVG inner shadow (not native in AI) | 🟡 |
| renderSwatchLegend | Draw a swatch legend on the artboard | ✅ |
| Color Blindness Simulator | Preview/recolor for colorblindness | 🟡 |
| ContrastChecker | WCAG contrast checker | ✅ |
| CMYKtoPMS | Match CMYK to nearest Pantone | 🟡 (needs PMS table) |
| AddSwatchesLightAndShadow | Light/shadow swatches for animators | ✅ |

## Path / Anchor Editing

| Script | What it does | Port |
|---|---|---|
| Smart Corner Rounder ⭐ | Intelligent corner rounding | ✅ |
| Round Corners w/ Precision ⭐ | Custom corner rounding | ✅ |
| Round Any Selected Corner Point | Round selected corners | ✅ |
| Add Anchor Points ⭐ | Add anchors to paths | ✅ |
| Remove Anchor Points ⭐ | Remove selected anchors | ✅ |
| Cut Path at Selected Anchors | Split path at anchors | ✅ |
| Close Open Paths ⭐ | Auto-close open paths | ✅ |
| Handle Tweaker | Adjust bezier handle length | ✅ |
| Extend Bezier Handles | Scale handles by % | ✅ |
| Sharpen Smooth Corners | Remove handles → sharp points | ✅ |
| Make All Paths One Direction ⭐ | Normalize path direction | ✅ |
| Divide Path into Equal Segments | Split by equal length | ✅ |
| Calculate Path Length | Measure path length(s) | ✅ |
| ArcTwister | Twist control handles | ✅ |
| DivideAndDash | Cuttable dashed line for laser | 🟡 |

## Text

| Script | What it does | Port |
|---|---|---|
| Release Type on a Path | Separate text from its path | 🟡 |
| Combine Multiple Text Frames ⭐ | Merge text frames into one | ✅ |
| joinTextFrames | Join text frames | ✅ |
| Break Text into Lines / Words | Split text frame into words/lines | ✅ |
| Text Tweaker | Batch-edit text attributes | ✅ |
| Text Block Layout Tool | Auto-resize text blocks | 🟡 |
| Monoline Text Effect | Single-line engraving text | 🟡 |

## Layers / Document Cleanup

| Script | What it does | Port |
|---|---|---|
| Move/Copy Objects Between Layers | Move objects to a layer | ✅ |
| Layer Name Case Converter | Change layer-name casing | ✅ |
| Delete Empty Layers ⭐ | Remove empty layers | ✅ |
| Remove Empty Objects ⭐ | Remove empty paths/frames | ✅ |
| Group by Attributes | Group objects by shared attributes | ✅ |
| Organize and Sort Objects | Sort by attribute (z-order etc.) | ✅ |
| Group Overlapping Objects | Auto-group overlapping shapes | ✅ |

## Artboards

| Script | What it does | Port |
|---|---|---|
| Artboard Remover | Delete artboards via UI | 🟡 |
| Artboard Color Fill | Fill artboard with color | 🟡 |
| Rotate Artboard with All Objects | Rotate artboard + contents | 🟡 |
| Resize Artboard and Scale Objects | Resize artboard, scale contents | 🟡 |

## Generative / Pattern

| Script | What it does | Port |
|---|---|---|
| Voronoi Pattern Generator | Voronoi diagram | ✅ |
| Triangulator Pro | Voronoi & triangle patterns | ✅ |
| Spirograph Pattern Generator | Spirograph from 2 circles | ✅ |
| Scallop Pattern Generator | Dots on anchors / scallop edge | ✅ |
| Metaball Effect Generator | Connect shapes with metaballs | ✅ |
| Fractalize Paths | Fractal path duplication | ✅ |
| Place Objects Inside a Shape | Circle-fill packing | ✅ |
| Logo Grid Line Generator | Construction grid lines for logos | ✅ |
| Bento Grid Layout Generator | Bento-style grid of cells | ✅ |
| Sankey Diagram Generator | Flow diagrams | ✅ |
| Draw Common Tangent Lines | Tangents between circles | ✅ |
| allPoints | Line from every point to... | ✅ |
| Organify | Randomize anchor points | ✅ |
| fleurify | Fleur-de-lis generator | ✅ |
| Random Eye Generator | Random animal eyes | ✅ |
| QR Code Generator | QR codes (vector) | 🟡 |
| Barcode Generator | Barcode (needs OCR-B font) | 🔴 |

## Export / Image

| Script | What it does | Port |
|---|---|---|
| Export Layers as Images | Export each layer to a file | 🟡 (Affinity file IO differs) |
| Multi Exporter | Batch-export artboards/layers | 🟡 |
| Crop Images with Custom Shapes | Shape-based image cropping | 🟡 |

## Utility / View

| Script | What it does | Port |
|---|---|---|
| Unit Converter ⭐ | Convert between units | ✅ |
| ZoomAndCenterSelection | Zoom to selection | ✅ |
| Panels Manager | Manage/toggle panels | 🔴 (AI-specific UI) |
| Script Launcher | Palette to launch scripts | 🟡 |
| Open Scripts Folder | Open the scripts folder | 🔴 |
| Randomize Multiple Object Properties | Randomize many props at once | ✅ |
| Performance test | ExtendScript benchmark | 🔴 (dev-only) |

## Fun / Animation (low priority)

| Script | What it does | Port |
|---|---|---|
| Physics Panel | Real-time 2D physics (Planck.js) | 🔴 |
| Chess Game | Chess board inside AI | 🔴 |
| Animate Objects | Frame-by-frame animation helper | 🔴 |
| Dance | Animated dancing figures | 🔴 |

---

## Suggested first wave (easy + on-strategy ⭐)

Best overlap with the repo's current selection/transform/color focus, and all pure-logic ports:

1. **Select by Name / by Font / Similar Text Frames / by Size Range / Every Nth / Randomly** — natural companions to the existing **Select Same** script; could even fold into one "Select" suite.
2. **Move by Distance, Stroke Scaler, Swap Fill/Stroke, Invert Colors** — tiny, high-utility, one-shot commands.
3. **Close Open Paths, Make All Paths One Direction, Delete Empty Layers, Remove Empty Objects** — document-cleanup quick wins.
4. **Smart Corner Rounder / Round Corners** — popular, and Affinity's native corner tool has gaps worth filling.
