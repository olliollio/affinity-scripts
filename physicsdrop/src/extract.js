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
 *   - Curve coordinates are in BASE space. `node.transform` maps them to spread space.
 *     `node.localToSpreadTransform` is identity on every node, including offset ones — using it
 *     puts every grouped object in the wrong place.
 *   - `curve.generatePolygon(tolerance)` returns a PolygonHandle with NO readable members, so
 *     flattening is ours to do.
 *   - `ArtTextNode` reports curveCount === 1 for a whole string: one glyph. Text is refused.
 */

(function (PD) {
  'use strict';

  // A node whose name contains one of these is scenery: it collides but never moves.
  var STATIC_WORDS = ['wall', 'floor', 'ramp', 'static', 'ground'];

  /**
   * Static by name convention. Pure, so it is unit-tested rather than discovered in Affinity.
   *
   * Matched on word boundaries: "Wall 3" and "left-wall" are scenery, "Wallpaper" is not. Names
   * are user-facing and may be localised, so this is a convenience on top of the locked-layer
   * rule rather than the primary mechanism.
   */
  function isStaticName(name) {
    if (!name) return false;
    var s = String(name).toLowerCase();
    for (var i = 0; i < STATIC_WORDS.length; i++) {
      var w = STATIC_WORDS[i];
      var at = s.indexOf(w);
      while (at >= 0) {
        var before = at === 0 ? '' : s.charAt(at - 1);
        var after = s.charAt(at + w.length);
        var okBefore = at === 0 || !/[a-z0-9]/.test(before);
        var okAfter = !after || !/[a-z0-9]/.test(after);
        if (okBefore && okAfter) return true;
        at = s.indexOf(w, at + 1);
      }
    }
    return false;
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

  /** `Transform.data` is row-major 2x3 `[a, b, tx, c, d, ty]`. */
  function matrixOf(node) {
    try {
      var t = node.transform;
      if (!t || !t.data) return null;
      var d = t.data;
      return [d[0], d[1], d[2], d[3], d[4], d[5]];
    } catch (e) {
      return null;
    }
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

      var ring = PD.flattenSegments(segments, o);
      if (ring.length < 6) continue; // fewer than 3 points has no area
      PD.transformRing(ring, m);
      out.push(ring);
    }
    return out;
  }

  /** The image's placement rectangle, in spread coordinates. */
  function imageRect(node, opts) {
    // An ImageNode's curves ARE its placement rectangle, in local pixel coordinates, positioned
    // by node.transform. So the ordinary vector path already produces the right answer.
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
    var imagePolicy = o.imagePolicy || 'rectangle'; // 'rectangle' | 'refuse'
    var results = [];
    var refusals = [];

    function visit(node, depth) {
      var kind = classify(node);

      if (kind === 'group') {
        // A dropped word is usually a group of letters, and each letter should be its own body —
        // otherwise the word falls as one rigid slab.
        if (o.groupsAsOneBody) {
          var merged = [];
          eachDescendant(node, function (child) {
            if (classify(child) === 'vector') merged.push.apply(merged, ringsOf(child, o));
          });
          if (merged.length) results.push(makeResult(node, merged, o));
          return;
        }
        eachDescendant(node, function (child) { visit(child, depth + 1); });
        return;
      }

      if (kind === 'text') {
        // ArtTextNode exposes curves, but only ONE curve for an entire string. Using them would
        // silently build a body from a single glyph, which is worse than refusing.
        refusals.push({ node: node, reason: 'text', message: describe(node) + ': convert to curves first' });
        return;
      }

      if (kind === 'image') {
        if (imagePolicy === 'refuse') {
          refusals.push({ node: node, reason: 'image', message: describe(node) + ': images are not supported' });
          return;
        }
        var rect = imageRect(node, o);
        if (rect.length) {
          var r = makeResult(node, rect, o);
          r.approximate = 'placement rectangle';
          results.push(r);
        } else {
          refusals.push({ node: node, reason: 'image', message: describe(node) + ': no placement rectangle' });
        }
        return;
      }

      if (kind === 'vector') {
        var rings = ringsOf(node, o);
        if (!rings.length) {
          refusals.push({ node: node, reason: 'no-closed-curves', message: describe(node) + ': no closed curves' });
          return;
        }
        results.push(makeResult(node, rings, o));
        return;
      }

      refusals.push({ node: node, reason: 'unsupported', message: describe(node) + ': unsupported node type' });
    }

    for (var i = 0; i < nodes.length; i++) visit(nodes[i], 0);
    return { objects: results, refusals: refusals };
  }

  function makeResult(node, rings, o) {
    var faces = PD.buildFaces(rings, o);
    return {
      node: node,
      name: safeName(node),
      rings: rings,
      faces: faces,
      isStatic: isStaticNode(node)
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

  PD.isStaticName = isStaticName;
  PD.classifyNode = classify;
  PD.matrixOf = matrixOf;
  PD.ringsOf = ringsOf;
  PD.extract = extract;
  PD.STATIC_WORDS = STATIC_WORDS;

})(PD);
