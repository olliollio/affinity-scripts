/**
 * extract.js — Affinity nodes to rings. The ONLY module that touches the Affinity API.
 *
 * Everything here is deliberately thin: pull plain numbers out of the SDK, hand them to the pure
 * modules, and pass their answers back. The reason is that this file cannot be tested headlessly,
 * so anything with real logic in it belongs in flatten.js, contours.js or sanitize.js instead.
 *
 * Facts this module depends on, all verified by probe (probes/probe_shape_sources.js,
 * probes/probe_curve_readout.js), because guessing at SDK shapes has cost whole cycles before:
 *
 *   - EVERY node type exposes `curvesInterface`, including live ShapeNode, ArtTextNode and
 *     ImageNode. There is no such thing as a live shape with no curves.
 *   - Curve coordinates are in BASE space. `node.baseToSpreadTransform` maps them to spread space.
 *     `node.transform` is the node's LOCAL matrix, relative to its parent, and only equals the
 *     base-to-spread matrix while every ancestor is identity. It looked interchangeable for a long
 *     time because the test document's artboard happened to be unscaled; resize an artboard and a
 *     rope came out a third short. `node.localToSpreadTransform` is the parent-chain product, so
 *     it is identity only when there is no meaningful parent — it is not a general no-op either.
 *   - `curve.generatePolygon(tolerance)` returns a PolygonHandle with NO readable members, so
 *     flattening is ours to do.
 *   - `curvesInterface.polyCurve` reports curveCount === 1 for an entire string — one glyph.
 *     `curvesInterface.polyPolyCurves` holds one PolyCurve per glyph, counters included, and
 *     `getTransformedPolyCurve(i)` returns them in BASE space — measured against `spreadBaseBox`,
 *     it reproduces `baseBox` exactly, and the base-to-spread matrix lands it on `spreadBaseBox`. So
 *     text needs no conversion and nothing is destroyed. It becomes ONE body, because a live text
 *     node is one node and playback can only transform it once per frame.
 */

(function (GR) {
  'use strict';

  // A node whose name contains one of these is scenery: it collides but never moves.
  var STATIC_WORDS = ['wall', 'floor', 'ramp', 'static', 'ground', 'collider'];

  /**
   * Is `word` present in `name` as a whole word?
   *
   * Three naming conventions now use this — scenery, rope anchoring and softbodies — and it was
   * written twice before the third arrived. Whole-word matching is what stops "jellyfish" being
   * jelly and "grounded" being ground.
   */
  function hasWord(name, words) {
    if (!name) return false;
    var s = String(name).toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var at = s.indexOf(w);
      while (at >= 0) {
        var before = at === 0 ? '' : s.charAt(at - 1);
        var after = s.charAt(at + w.length);
        if ((at === 0 || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) return true;
        at = s.indexOf(w, at + 1);
      }
    }
    return false;
  }

  /**
   * Static by name convention. Pure, so it is unit-tested rather than discovered in Affinity.
   *
   * Matched on word boundaries: "Wall 3" and "left-wall" are scenery, "Wallpaper" is not. Names
   * are user-facing and may be localised, so this is a convenience on top of the locked-layer
   * rule rather than the primary mechanism.
   */
  function isStaticName(name) {
    return hasWord(name, STATIC_WORDS);
  }

  /** What kind of thing is this, in terms of what we can do with it? */
  function classify(node) {
    if (!node) return 'none';
    try { if (node.isGroupNode === true) return 'group'; } catch (e) { /* fall through */ }
    try { if (node.isTextNode === true) return 'text'; } catch (e) { /* fall through */ }
    try { if (node.isImageNode === true) return 'image'; } catch (e) { /* fall through */ }
    try { if (node.curvesInterface) return 'vector'; } catch (e) { /* fall through */ }
    return 'unknown';
  }

  /**
   * The base-to-spread matrix, as row-major 2x3 `[a, b, tx, c, d, ty]` (`Transform.data`).
   *
   * `baseToSpreadTransform` first, because it is the only one of these that has the ancestors
   * composed into it. `domainTransform` is the curve data's own declared domain and measured
   * identical to it. `node.transform` is last and is a fallback only: it is the LOCAL matrix, so
   * on a node inside a scaled artboard it is wrong by the artboard's scale.
   */
  function matrixOf(node) {
    function data(t) {
      if (!t || !t.data) return null;
      var d = t.data;
      if (d.length < 6) return null;
      return [d[0], d[1], d[2], d[3], d[4], d[5]];
    }
    var m = null;
    try { m = data(node.baseToSpreadTransform); } catch (e) { /* older build, try the next */ }
    if (!m) { try { m = data(node.curvesInterface && node.curvesInterface.domainTransform); } catch (e) { /* likewise */ } }
    if (!m) { try { m = data(node.transform); } catch (e) { /* nothing usable */ } }
    return m;
  }

  /**
   * All closed rings of one node, in SPREAD coordinates.
   *
   * `corneredPolyCurve` is preferred: on a live shape the corner rounding is baked into it, and on
   * everything else the two agree. Open curves are skipped — an unclosed path has no interior, so
   * it cannot become a body.
   */
  function ringsOf(node, opts) {
    var o = opts || {};
    var out = [];
    var ci;
    try { ci = node.curvesInterface; } catch (e) { return out; }
    if (!ci) return out;

    var pc = null;
    try { pc = ci.corneredPolyCurve || ci.polyCurve; } catch (e) { pc = null; }
    if (!pc) { try { pc = ci.polyCurve; } catch (e) { return out; } }
    if (!pc) return out;

    var m = matrixOf(node);
    var count = 0;
    try { count = pc.curveCount; } catch (e) { return out; }

    for (var i = 0; i < count; i++) {
      var curve;
      try { curve = pc.at(i); } catch (e) { continue; }
      if (!curve) continue;

      var closed = true;
      try { closed = curve.isClosed !== false; } catch (e) { /* assume closed */ }
      if (!closed && !o.includeOpen) continue;

      // Reduce to plain numbers immediately. Past this point nothing is an SDK object, which is
      // what lets flatten.js be tested without Affinity.
      var segments = [];
      try {
        for (var b of curve.beziers) {
          segments.push({
            start: { x: b.start.x, y: b.start.y },
            c1: { x: b.c1.x, y: b.c1.y },
            c2: { x: b.c2.x, y: b.c2.y },
            end: { x: b.end.x, y: b.end.y }
          });
        }
      } catch (e) {
        continue;
      }
      if (!segments.length) continue;

      var ring = GR.flattenSegments(segments, o);
      if (ring.length < 6) continue; // fewer than 3 points has no area
      GR.transformRing(ring, m);
      out.push(ring);
    }
    return out;
  }

  /**
   * Every glyph of a text node, as one ring list per glyph, in SPREAD coordinates.
   *
   * `curvesInterface.polyCurve` reports a single curve for an entire string — one glyph — which is
   * why text used to be refused. `polyPolyCurves` is the real container: one `PolyCurve` per
   * glyph, counters included ("o" and "e" report two curves, outer plus hole).
   *
   * Each glyph's own `PolyCurve` is in em space, near the origin, so `getTransformedPolyCurve(i)`
   * is used rather than `getPolyCurve(i)` — it applies the per-glyph placement and lands the
   * outline in the node's base space, where `node.baseToSpreadTransform` finishes the job.
   *
   * Reading the outlines leaves the text editable. `DocumentCommand.createConvertToCurves` exists,
   * but converting rewrites the user's document to work around a read we can simply do.
   */
  function glyphRingsOf(node, opts) {
    var o = opts || {};
    var out = [];
    var ci;
    try { ci = node.curvesInterface; } catch (e) { return out; }
    if (!ci) return out;

    var ppc;
    try { ppc = ci.polyPolyCurves; } catch (e) { return out; }
    if (!ppc) return out;

    var count = 0;
    try { count = ppc.polyCurveCount; } catch (e) { count = 0; }
    if (!count) return out;

    var m = matrixOf(node);

    for (var g = 0; g < count; g++) {
      var pc = null;
      try { pc = ppc.getTransformedPolyCurve(g); } catch (e) { continue; }
      if (!pc) continue;

      var rings = [];
      var curves = 0;
      try { curves = pc.curveCount; } catch (e) { continue; }

      for (var i = 0; i < curves; i++) {
        var curve;
        try { curve = pc.at(i); } catch (e) { continue; }
        if (!curve) continue;
        var closed = true;
        try { closed = curve.isClosed !== false; } catch (e) { /* assume closed */ }
        if (!closed && !o.includeOpen) continue;

        var segments = [];
        try {
          for (var b of curve.beziers) {
            segments.push({
              start: { x: b.start.x, y: b.start.y },
              c1: { x: b.c1.x, y: b.c1.y },
              c2: { x: b.c2.x, y: b.c2.y },
              end: { x: b.end.x, y: b.end.y }
            });
          }
        } catch (e) { continue; }
        if (!segments.length) continue;

        var ring = GR.flattenSegments(segments, o);
        if (ring.length < 6) continue;
        GR.transformRing(ring, m);
        rings.push(ring);
      }
      if (rings.length) out.push(rings);
    }
    return out;
  }

  /** Bounding box of a ring list, for sanity-checking that geometry landed in the right space. */
  function ringsBBox(rings) {
    var b = null;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      for (var k = 0; k < r.length; k += 2) {
        if (!b) b = { x0: r[k], y0: r[k + 1], x1: r[k], y1: r[k + 1] };
        if (r[k] < b.x0) b.x0 = r[k];
        if (r[k] > b.x1) b.x1 = r[k];
        if (r[k + 1] < b.y0) b.y0 = r[k + 1];
        if (r[k + 1] > b.y1) b.y1 = r[k + 1];
      }
    }
    return b;
  }

  /**
   * The OPEN curves of a node, as polylines in SPREAD coordinates.
   *
   * A closed path encloses an area and becomes a rigid body; an open one encloses nothing and used
   * to be skipped entirely. It becomes a rope instead, which needs no naming convention because
   * the distinction is already unambiguous.
   */
  function polylinesOf(node, opts) {
    var o = opts || {};
    var out = [];
    var ci;
    try { ci = node.curvesInterface; } catch (e) { return out; }
    if (!ci) return out;

    var pc = null;
    try { pc = ci.corneredPolyCurve || ci.polyCurve; } catch (e) { pc = null; }
    if (!pc) return out;

    var m = matrixOf(node);
    var count = 0;
    try { count = pc.curveCount; } catch (e) { return out; }

    for (var i = 0; i < count; i++) {
      var curve;
      try { curve = pc.at(i); } catch (e) { continue; }
      if (!curve) continue;
      var closed = true;
      try { closed = curve.isClosed !== false; } catch (e) { /* assume closed */ }
      if (closed) continue;

      var segments = [];
      try {
        for (var b of curve.beziers) {
          segments.push({
            start: { x: b.start.x, y: b.start.y },
            c1: { x: b.c1.x, y: b.c1.y },
            c2: { x: b.c2.x, y: b.c2.y },
            end: { x: b.end.x, y: b.end.y }
          });
        }
      } catch (e) { continue; }
      if (!segments.length) continue;

      // flattenSegments drops a trailing point that repeats the first, which is right for a ring
      // and wrong for a line, so the open case is rebuilt from the segment ends directly.
      var poly = [segments[0].start.x, segments[0].start.y];
      for (var sIdx = 0; sIdx < segments.length; sIdx++) {
        var seg = segments[sIdx];
        GR.flattenCubic(poly, seg.start.x, seg.start.y, seg.c1.x, seg.c1.y,
          seg.c2.x, seg.c2.y, seg.end.x, seg.end.y, o.flattenTol);
      }
      if (poly.length < 4) continue;
      GR.transformRing(poly, m);
      out.push(poly);
    }
    return out;
  }

  /** Stroke weight in points, which is how thick a rope should collide. */
  function lineWeightOf(node) {
    try {
      var w = node.lineWeight;
      if (typeof w === 'number' && w > 0) return w;
    } catch (e) { /* fall through */ }
    try {
      var w2 = node.lineStyleInterface && node.lineStyleInterface.lineWeight;
      if (typeof w2 === 'number' && w2 > 0) return w2;
    } catch (e) { /* none */ }
    return 0;
  }

  /**
   * An image's true silhouette from its alpha channel, in SPREAD coordinates.
   *
   * The API is the one physicsdrop uses and is therefore known to work: `createCompatibleBitmap`
   * on the node, or `NodeRenderingEngine.createDefault` as a fallback, then `PixelReaderRGBA8` to
   * read pixels. What differs is what is done with them — physicsdrop takes the convex hull of a
   * 48x48 grid, which fills in every concavity and hole, whereas `raster.js` traces the real
   * boundary and returns the hole rings too.
   *
   * An ImageNode's own curves are its placement rectangle in local pixel coordinates, so pixel
   * space maps to base space by the ratio of the node's box to the bitmap, and `node.baseToSpreadTransform`
   * finishes the job as it does for vector nodes.
   */
  function rasterRingsOf(node, opts) {
    var o = opts || {};

    var bm = null;
    try { if (typeof node.createCompatibleBitmap === 'function') bm = node.createCompatibleBitmap(true); }
    catch (e) { bm = null; }
    if (!bm) {
      try {
        var ro = require('/rasterobject');
        var engine = ro.NodeRenderingEngine.createDefault(node, ro.RasterFormat.RGBA8);
        bm = engine.createCompatibleBitmap(true);
      } catch (e) { bm = null; }
    }
    if (!bm || !bm.width || !bm.height) return [];

    var reader = null;
    try { reader = require('/pixelaccessor').PixelReaderRGBA8.create(bm); }
    catch (e) { return []; }

    var rings;
    try {
      rings = GR.alphaContours(bm.width, bm.height, function (px, py) {
        var p = reader.readPixel(px, py);
        if (!p) return 0;
        return p.alpha === undefined ? 255 : p.alpha;
      }, o);
    } catch (e) {
      rings = [];
    } finally {
      // The reader holds native memory; leaking one per image would be a real cost on a big scene.
      try { if (reader && typeof reader.dispose === 'function') reader.dispose(); } catch (e) { /* gone */ }
    }
    if (!rings.length) return [];

    var box = null;
    try { box = node.baseBox; } catch (e) { box = null; }
    if (!box || !(box.width > 0) || !(box.height > 0)) return [];

    var sx = box.width / bm.width;
    var sy = box.height / bm.height;
    var m = matrixOf(node);

    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      for (var k = 0; k < r.length; k += 2) {
        r[k] = box.x + r[k] * sx;
        r[k + 1] = box.y + r[k + 1] * sy;
      }
      GR.transformRing(r, m);
    }
    return rings;
  }

  /** The image's placement rectangle, in spread coordinates. */
  function imageRect(node, opts) {
    // An ImageNode's curves ARE its placement rectangle, in local pixel coordinates, positioned
    // by the base-to-spread matrix. So the ordinary vector path already produces the right answer.
    return ringsOf(node, opts);
  }

  /**
   * Walks a selection into extraction results.
   *
   * Returns one entry per usable object plus a list of refusals, rather than throwing on the first
   * problem: a user who selected a word and one stray text frame should get the word simulated and
   * one clear message, not a dead script.
   */
  function extract(nodes, opts) {
    var o = opts || {};
    var imagePolicy = o.imagePolicy || 'silhouette'; // 'silhouette' | 'rectangle' | 'refuse'
    var textPolicy = o.textPolicy || 'glyphs';      // 'glyphs' | 'refuse'
    var results = [];
    var refusals = [];

    function visit(node, depth, inheritedStatic) {
      var kind = classify(node);
      // Scenery is inherited. Naming a GROUP "wall" has to make everything inside it scenery,
      // because that is plainly what the name means - and the alternative is renaming every child.
      var isStatic = inheritedStatic || isStaticNode(node);

      if (kind === 'group') {
        // A dropped word is usually a group of letters, and each letter should be its own body —
        // otherwise the word falls as one rigid slab.
        if (o.groupsAsOneBody) {
          var merged = [];
          eachDescendant(node, function (child) {
            if (classify(child) === 'vector') merged.push.apply(merged, ringsOf(child, o));
          });
          if (merged.length) results.push(makeResult(node, merged, o, isStatic));
          return;
        }
        eachDescendant(node, function (child) { visit(child, depth + 1, isStatic); });
        return;
      }

      if (kind === 'text') {
        if (textPolicy === 'refuse') {
          refusals.push({
            node: node, reason: 'text',
            message: describe(node) + ': text is skipped'
          });
          return;
        }

        // ONE body for the whole text node, carrying every glyph outline.
        //
        // Splitting it per glyph is tempting - a word tumbling as letters looks far better - but a
        // live text node is a SINGLE node. Playback moves each body by transforming its node, so
        // ten glyph bodies sharing one node means ten conflicting transforms applied to it every
        // frame: the text lurches around while the physics, which is perfectly correct, is never
        // seen. That is exactly what "flies around" and later "falls with no collision" were.
        //
        // Letters can only move independently if they are separate nodes, which is what "Convert
        // text to curves" produces. Live text falls as one rigid piece, and that is honest.
        var glyphs = glyphRingsOf(node, o);
        if (!glyphs.length) {
          refusals.push({
            node: node, reason: 'text',
            message: describe(node) + ': no glyph outlines available, convert to curves first'
          });
          return;
        }
        var allGlyphs = [];
        for (var gi = 0; gi < glyphs.length; gi++) allGlyphs.push.apply(allGlyphs, glyphs[gi]);
        results.push(makeResult(node, allGlyphs, o, isStatic));
        return;
      }

      if (kind === 'image') {
        if (imagePolicy === 'refuse') {
          refusals.push({ node: node, reason: 'image', message: describe(node) + ': images are not supported' });
          return;
        }
        // The alpha silhouette is the default: a photo cut out on transparency should collide as
        // its shape, not as the rectangle it happens to be stored in. The rectangle remains the
        // fallback, because a fully opaque image legitimately IS its rectangle and because the
        // raster APIs are the one part of extraction with no headless test behind them.
        if (imagePolicy !== 'rectangle') {
          var silhouette = rasterRingsOf(node, o);
          if (silhouette.length) {
            var sr = makeResult(node, silhouette, o, isStatic);
            sr.approximate = null;
            results.push(sr);
            return;
          }
        }

        var rect = imageRect(node, o);
        if (rect.length) {
          var r = makeResult(node, rect, o, isStatic);
          r.approximate = 'placement rectangle';
          results.push(r);
        } else {
          refusals.push({ node: node, reason: 'image', message: describe(node) + ': no placement rectangle' });
        }
        return;
      }

      if (kind === 'vector') {
        var rings = ringsOf(node, o);
        if (rings.length) {
          results.push(makeResult(node, rings, o, isStatic));
          return;
        }

        // No closed area, so it cannot be a rigid body. An open path becomes a rope.
        if (o.ropes !== false) {
          var polys = polylinesOf(node, o);
          if (polys.length) {
            var rr = makeResult(node, [], o, isStatic);
            rr.isRope = true;
            rr.polylines = polys;
            rr.thickness = lineWeightOf(node);
            rr.anchored = GR.isAnchoredName(rr.name);
            results.push(rr);
            return;
          }
        }

        refusals.push({ node: node, reason: 'no-closed-curves', message: describe(node) + ': no closed curves' });
        return;
      }

      refusals.push({ node: node, reason: 'unsupported', message: describe(node) + ': unsupported node type' });
    }

    for (var i = 0; i < nodes.length; i++) visit(nodes[i], 0, false);
    return { objects: results, refusals: refusals };
  }

  function makeResult(node, rings, o, forcedStatic) {
    var faces = GR.buildFaces(rings, o);
    return {
      node: node,
      name: safeName(node),
      rings: rings,
      faces: faces,
      isStatic: !!forcedStatic || isStaticNode(node)
    };
  }

  /** Static by BOTH routes, as agreed: the name convention and the locked flag. */
  function isStaticNode(node) {
    var locked = false;
    try { locked = node.isLocked === true; } catch (e) { /* ignore */ }
    return locked || isStaticName(safeName(node));
  }

  function safeName(node) {
    try { return String(node.description || node.defaultDescription || ''); }
    catch (e) { return ''; }
  }

  function describe(node) {
    var tag = 'node';
    try { tag = String(node[Symbol.toStringTag] || 'node'); } catch (e) { /* keep */ }
    var name = safeName(node);
    return name ? (tag + ' "' + name + '"') : tag;
  }

  /** Recursive descent over a group's children. */
  function eachDescendant(node, fn) {
    try {
      var mod = require('/nodes');
      // The first argument is the HANDLE, not the node.
      for (var child of mod.getNodeChildrenRecursive(node.handle, mod.NodeChildType.Main, false)) {
        fn(child);
      }
      return;
    } catch (e) {
      // Fall back to sibling walking if the module shape differs.
    }
    try {
      for (var c = node.firstChild; c; c = c.nextSibling) fn(c);
    } catch (e2) { /* nothing to walk */ }
  }

  /**
   * Converts live text to curves in the document, so it goes through the ordinary vector path.
   *
   * Destructive and explicit: the user asks for it, and it lands in the undo stack as its own step.
   * It is the reliable route because the result is ordinary `PolyCurveNode`s, whose extraction is
   * already proven — as opposed to reading glyph outlines out of a live text node, where the
   * coordinate space is not yet established.
   *
   * The command signature is unknown, so several shapes are tried. `DocumentCommand.create*` are
   * pure factories: a wrong guess costs nothing and its error message names the expected type.
   */
  function convertTextToCurves(doc, nodes) {
    var textNodes = [];
    for (var i = 0; i < nodes.length; i++) {
      if (classify(nodes[i]) === 'text') textNodes.push(nodes[i]);
    }
    if (!textNodes.length) return { converted: 0, error: null };

    var Selection, DocumentCommand;
    try {
      Selection = require('/selections').Selection;
      DocumentCommand = require('/commands').DocumentCommand;
    } catch (e) {
      return { converted: 0, error: 'modules unavailable: ' + e };
    }
    if (typeof DocumentCommand.createConvertToCurves !== 'function') {
      return { converted: 0, error: 'this Affinity build has no createConvertToCurves' };
    }

    var sel = Selection.createEmpty(doc);
    for (var k = 0; k < textNodes.length; k++) sel.addNode(textNodes[k]);

    var attempts = [
      function () { return DocumentCommand.createConvertToCurves(sel); },
      function () { return DocumentCommand.createConvertToCurves(sel, {}); },
      function () { return DocumentCommand.createConvertToCurves(sel, true); }
    ];
    var lastErr = null;
    for (var a = 0; a < attempts.length; a++) {
      try {
        var cmd = attempts[a]();
        if (!cmd) { lastErr = 'factory returned ' + cmd; continue; }
        doc.executeCommand(cmd, false);
        return { converted: textNodes.length, error: null };
      } catch (e) {
        lastErr = (e && e.message) ? e.message : String(e);
      }
    }
    return { converted: 0, error: lastErr };
  }

  /**
   * Are these two references the same document node?
   *
   * `isSameNode` is the SDK's own answer and is preferred; `handle` and identity are fallbacks,
   * because a plain `===` is not reliable when the SDK hands back a fresh wrapper each time.
   */
  function sameNode(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    try { if (typeof a.isSameNode === 'function') return !!a.isSameNode(b); } catch (e) { /* fall through */ }
    try { if (a.handle !== undefined && b.handle !== undefined) return a.handle === b.handle; } catch (e) { /* fall through */ }
    return false;
  }

  /**
   * Concatenates two node lists without duplicates.
   *
   * Needed because converting text REPLACES the app selection with just the new nodes, so the
   * surviving objects have to be carried across by hand — and the replacement list may or may not
   * also contain them, depending on what the command does.
   */
  function mergeNodeLists(a, b) {
    var out = [];
    function add(list) {
      for (var i = 0; i < list.length; i++) {
        var node = list[i];
        if (!node) continue;
        var seen = false;
        for (var k = 0; k < out.length && !seen; k++) seen = sameNode(out[k], node);
        if (!seen) out.push(node);
      }
    }
    add(a || []);
    add(b || []);
    return out;
  }

  GR.sameNode = sameNode;
  GR.mergeNodeLists = mergeNodeLists;
  GR.convertTextToCurves = convertTextToCurves;
  GR.isStaticName = isStaticName;
  GR.hasWord = hasWord;
  GR.classifyNode = classify;
  GR.matrixOf = matrixOf;
  GR.ringsOf = ringsOf;
  GR.glyphRingsOf = glyphRingsOf;
  GR.ringsBBox = ringsBBox;
  GR.rasterRingsOf = rasterRingsOf;
  GR.polylinesOf = polylinesOf;
  GR.lineWeightOf = lineWeightOf;
  GR.extract = extract;
  GR.STATIC_WORDS = STATIC_WORDS;

})(GR);
