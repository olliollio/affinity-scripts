/**
 * Tests for extract.js, against MOCK nodes.
 *
 * The mocks copy the node shape recorded by probes/probe_shape_sources.js and
 * probes/probe_curve_readout.js: `curvesInterface.corneredPolyCurve.at(i)` yielding a curve with
 * `isClosed` and an iterable `beziers` of `{start, c1, c2, end}` points, plus `transform.data` as
 * row-major `[a, b, tx, c, d, ty]`.
 *
 * These prove extract.js behaves correctly GIVEN that shape. They cannot prove the shape itself —
 * only a probe run inside Affinity does that, which is why the shape came from one.
 */

'use strict';

function pt(x, y) { return { x: x, y: y }; }

/** A straight edge, stored the way Affinity stores it: a cubic with collapsed handles. */
function edge(x0, y0, x1, y1) {
  return { start: pt(x0, y0), c1: pt(x0, y0), c2: pt(x1, y1), end: pt(x1, y1) };
}

function boxBeziers(x0, y0, x1, y1) {
  return [edge(x0, y0, x1, y0), edge(x1, y0, x1, y1), edge(x1, y1, x0, y1), edge(x0, y1, x0, y0)];
}

function mockCurve(beziers, closed) {
  return { isClosed: closed !== false, beziers: beziers };
}

function mockNode(spec) {
  var curves = spec.curves || [];
  var node = {
    description: spec.name || '',
    defaultDescription: spec.name || '',
    isLocked: spec.locked === true,
    handle: spec.name || 'h',
    transform: spec.transform ? { data: spec.transform } : { data: [1, 0, 0, 0, 1, 0] }
  };
  node[Symbol.toStringTag] = spec.tag || 'PolyCurveNode';

  if (spec.tag === 'GroupNode') node.isGroupNode = true;
  if (spec.tag === 'ArtTextNode') node.isTextNode = true;
  if (spec.tag === 'ImageNode') node.isImageNode = true;

  if (curves.length || spec.glyphs) {
    var pc = {
      curveCount: curves.length,
      at: function (i) { return curves[i]; }
    };
    node.curvesInterface = { corneredPolyCurve: pc, polyCurve: pc, isMutable: !!spec.mutable };

    // PolyPolyCurve as the probe recorded it: polyCurveCount plus getTransformedPolyCurve(i),
    // one PolyCurve per glyph. Glyphs live in em space until transformed, which is why the
    // untransformed getter is deliberately NOT what extract.js calls.
    if (spec.glyphs) {
      node.curvesInterface.polyPolyCurves = {
        polyCurveCount: spec.glyphs.length,
        getPolyCurve: function () { throw new Error('em space — extract must not use this'); },
        getTransformedPolyCurve: function (g) {
          var list = spec.glyphs[g];
          return { curveCount: list.length, at: function (i) { return list[i]; } };
        }
      };
    }
  }

  // Groups are walked through firstChild/nextSibling, because require('/nodes') is unavailable
  // outside Affinity and extract.js falls back to sibling walking.
  if (spec.children) {
    for (var i = 0; i < spec.children.length; i++) {
      spec.children[i].nextSibling = spec.children[i + 1] || null;
    }
    node.firstChild = spec.children[0] || null;
  }
  return node;
}

module.exports = function (PD, h) {

  h.group('extract: static naming');

  ['wall', 'Wall', 'FLOOR', 'left-wall', 'Wall 3', 'the ramp', 'static', 'ground'].forEach(function (n) {
    h.assert('"' + n + '" is scenery', PD.isStaticName(n) === true);
  });
  // Word boundaries matter: a name that merely contains the letters must not become scenery.
  ['Wallpaper', 'flooring', 'rampage', 'ecstatic', 'background', 'Walls0'].forEach(function (n) {
    h.assert('"' + n + '" is not scenery', PD.isStaticName(n) === false);
  });
  h.assert('an empty name is not scenery', PD.isStaticName('') === false);
  h.assert('a missing name is not scenery', PD.isStaticName(null) === false);

  h.group('extract: classification');

  h.assertEqual('a curve node is vector',
    PD.classifyNode(mockNode({ curves: [mockCurve(boxBeziers(0, 0, 10, 10))] })), 'vector');
  h.assertEqual('a text node is text', PD.classifyNode(mockNode({ tag: 'ArtTextNode' })), 'text');
  h.assertEqual('an image node is image', PD.classifyNode(mockNode({ tag: 'ImageNode' })), 'image');
  h.assertEqual('a group is a group', PD.classifyNode(mockNode({ tag: 'GroupNode' })), 'group');
  h.assertEqual('nothing is none', PD.classifyNode(null), 'none');

  // Order matters: an ImageNode ALSO has curvesInterface, so a curves-first test would
  // misclassify every image as a plain vector object.
  var imgWithCurves = mockNode({ tag: 'ImageNode', curves: [mockCurve(boxBeziers(0, 0, 599, 301))] });
  h.assertEqual('an image with curves is still an image', PD.classifyNode(imgWithCurves), 'image');
  var textWithCurves = mockNode({ tag: 'ArtTextNode', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  h.assertEqual('text with curves is still text', PD.classifyNode(textWithCurves), 'text');

  h.group('extract: rings and transform');

  var plain = mockNode({ curves: [mockCurve(boxBeziers(0, 0, 100, 50))] });
  var rings = PD.ringsOf(plain);
  h.assertEqual('one closed curve gives one ring', rings.length, 1);
  h.assertEqual('a rectangle flattens to 4 points', rings[0].length / 2, 4);

  // The whole reason node.transform is used rather than localToSpreadTransform: a grouped child
  // is offset, and the offset has to reach the ring.
  var moved = mockNode({ curves: [mockCurve(boxBeziers(0, 0, 100, 50))], transform: [1, 0, 220, 0, 1, 228] });
  var movedRings = PD.ringsOf(moved);
  h.assertClose('the transform is applied to x', movedRings[0][0], 220, 1e-9);
  h.assertClose('the transform is applied to y', movedRings[0][1], 228, 1e-9);

  var scaledNode = mockNode({ curves: [mockCurve(boxBeziers(0, 0, 599, 301))], transform: [0.5976, 0, 236.6482, 0, 0.5976, 657.8902] });
  var scaledRings = PD.ringsOf(scaledNode);
  h.assertClose('a scaling transform reaches the far corner x',
    scaledRings[0][2], 599 * 0.5976 + 236.6482, 1e-6);

  h.assertEqual('matrixOf reads the row-major data', PD.matrixOf(moved).join(','), '1,0,220,0,1,228');
  h.assertEqual('matrixOf on a node without one is null', PD.matrixOf({}), null);

  // An open path has no interior, so it cannot become a body.
  var open = mockNode({ curves: [mockCurve(boxBeziers(0, 0, 100, 50), false)] });
  h.assertEqual('an open curve is skipped', PD.ringsOf(open).length, 0);
  h.assertEqual('unless explicitly included', PD.ringsOf(open, { includeOpen: true }).length, 1);

  h.group('extract: selection walking');

  var letterO = mockNode({
    name: 'O',
    curves: [
      mockCurve(boxBeziers(0, 0, 100, 100)),
      mockCurve(boxBeziers(30, 30, 70, 70))
    ]
  });
  var res = PD.extract([letterO]);
  h.assertEqual('one object extracted', res.objects.length, 1);
  h.assertEqual('no refusals', res.refusals.length, 0);
  h.assertEqual('two rings became one face', res.objects[0].faces.length, 1);
  h.assertEqual('with one hole', res.objects[0].faces[0].holes.length, 1);

  // A refusal must not abort the rest of the selection.
  var mixed = PD.extract([letterO, mockNode({ tag: 'ArtTextNode', name: 'Lorem ipsum' })]);
  h.assertEqual('the usable object still comes through', mixed.objects.length, 1);
  h.assertEqual('and the text is refused', mixed.refusals.length, 1);
  h.assertEqual('for the right reason', mixed.refusals[0].reason, 'text');
  h.assert('with a message naming the node',
    mixed.refusals[0].message.indexOf('Lorem ipsum') >= 0, mixed.refusals[0].message);

  h.group('extract: text glyphs');

  // "Lorem ipsum" style: several glyphs, two of them with counters. polyCurve would report a
  // single curve for the whole string, which is why polyPolyCurves is the one that matters.
  var textNode = mockNode({
    tag: 'ArtTextNode',
    name: 'Lorem ipsum',
    curves: [mockCurve(boxBeziers(0, 0, 10, 10))],   // the misleading single-glyph polyCurve
    glyphs: [
      [mockCurve(boxBeziers(0, 0, 40, 60))],                                     // L
      [mockCurve(boxBeziers(50, 0, 90, 60)), mockCurve(boxBeziers(60, 15, 80, 45))], // o, with counter
      [mockCurve(boxBeziers(100, 0, 140, 60))]                                   // r
    ]
  });

  // Live text is skipped by DEFAULT. Glyph outlines can be read, but they have not been shown to
  // land in the right coordinate space — in a real document the letters fell correctly and
  // collided with nothing, which is exactly how a body far from where it renders behaves.
  // Converting to curves goes through the proven vector path instead.
  var skipped = PD.extract([textNode]);
  h.assertEqual('live text is skipped by default', skipped.objects.length, 0);
  h.assertEqual('and reported', skipped.refusals.length, 1);
  h.assert('with the fix named in the message',
    skipped.refusals[0].message.indexOf('Convert text to curves') >= 0,
    skipped.refusals[0].message);

  var t = PD.extract([textNode], { textPolicy: 'glyphs' });
  h.assertEqual('glyph extraction is available on request', t.refusals.length, 0);
  h.assertEqual('one body per glyph', t.objects.length, 3);
  h.assertEqual('the counter became a hole', t.objects[1].faces[0].holes.length, 1);
  h.assert('glyph bodies are named individually',
    t.objects[0].name.indexOf('[0]') >= 0 && t.objects[2].name.indexOf('[2]') >= 0,
    t.objects.map(function (x) { return x.name; }).join(','));

  // The glyphs must come from the TRANSFORMED getter — the untransformed one throws in the mock,
  // so reaching for it would fail loudly rather than silently piling every letter at the origin.
  var moved2 = PD.glyphRingsOf(textNode);
  h.assertEqual('all glyphs extracted', moved2.length, 3);
  var bb = PD.ringsBBox(moved2[0]);
  h.assertClose('the first glyph is where the transform put it', bb.x0, 0, 1e-9);
  h.assertClose('and spans its own width', bb.x1, 40, 1e-9);

  var merged2 = PD.extract([textNode], { textPolicy: 'glyphs', groupsAsOneBody: true });
  h.assertEqual('merging makes the whole string one body', merged2.objects.length, 1);
  h.assertEqual('carrying every glyph ring', merged2.objects[0].rings.length, 4);

  // A text node with no glyph outlines must refuse rather than silently drop the object, even
  // when glyph extraction was explicitly asked for.
  var emptyText = mockNode({ tag: 'ArtTextNode', name: 'Empty', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  var et = PD.extract([emptyText], { textPolicy: 'glyphs' });
  h.assertEqual('text without glyph outlines is refused', et.refusals.length, 1);
  h.assert('and says why', et.refusals[0].message.indexOf('convert to curves') >= 0,
    et.refusals[0].message);

  // convertTextToCurves must not throw when the SDK is absent, which is how it behaves in tests.
  var conv = PD.convertTextToCurves(null, [textNode]);
  h.assertEqual('conversion reports failure rather than throwing', conv.converted, 0);
  h.assert('and explains itself', typeof conv.error === 'string' && conv.error.length > 0, String(conv.error));
  h.assertEqual('with no text nodes it is a no-op',
    PD.convertTextToCurves(null, [mockNode({ curves: [mockCurve(boxBeziers(0, 0, 10, 10))] })]).converted, 0);

  h.group('extract: merging node lists after conversion');

  // createConvertToCurves REPLACES the app selection with just the nodes it produced, so the
  // objects it did not touch have to be carried across by hand. Losing them is what made a run
  // simulate only the converted text.
  var keepA = mockNode({ name: 'A', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  var keepB = mockNode({ name: 'B', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  var newC = mockNode({ name: 'C', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });

  var merged3 = PD.mergeNodeLists([keepA, keepB], [newC]);
  h.assertEqual('survivors and new nodes are both kept', merged3.length, 3);
  h.assertEqual('survivors come first',
    merged3.map(function (x) { return x.description; }).join(','), 'A,B,C');

  // The replacement list may or may not also contain the untouched nodes, so duplicates must go.
  h.assertEqual('a node present in both lists appears once',
    PD.mergeNodeLists([keepA, keepB], [keepB, newC]).length, 3);

  // Identity is not reliable across SDK calls, so handles decide when they are present.
  var wrapper1 = { handle: 'h7', description: 'same' };
  var wrapper2 = { handle: 'h7', description: 'same again' };
  h.assert('two wrappers with one handle are one node', PD.sameNode(wrapper1, wrapper2) === true);
  h.assertEqual('and merge to a single entry', PD.mergeNodeLists([wrapper1], [wrapper2]).length, 1);
  h.assert('different handles stay distinct',
    PD.sameNode({ handle: 'h7' }, { handle: 'h8' }) === false);
  h.assert('isSameNode wins when present',
    PD.sameNode({ handle: 'a', isSameNode: function () { return true; } }, { handle: 'b' }) === true);

  h.assertEqual('empty lists merge to nothing', PD.mergeNodeLists([], []).length, 0);
  h.assertEqual('missing lists are tolerated', PD.mergeNodeLists(null, null).length, 0);
  h.assertEqual('nulls inside a list are dropped', PD.mergeNodeLists([null, keepA], [null]).length, 1);

  h.group('extract: groups');

  // A dropped word is a group of letters, and each letter must be its own body — otherwise the
  // word falls as one rigid slab.
  var group = mockNode({
    tag: 'GroupNode',
    name: 'Group',
    children: [
      mockNode({ name: 'A', curves: [mockCurve(boxBeziers(0, 0, 50, 50))] }),
      mockNode({ name: 'B', curves: [mockCurve(boxBeziers(60, 0, 110, 50))] })
    ]
  });
  var g = PD.extract([group]);
  h.assertEqual('a group yields one body per child', g.objects.length, 2);
  h.assertEqual('and keeps their names', g.objects.map(function (x) { return x.name; }).join(','), 'A,B');

  var oneBody = PD.extract([group], { groupsAsOneBody: true });
  h.assertEqual('unless asked to merge the group', oneBody.objects.length, 1);
  h.assertEqual('in which case both rings are on it', oneBody.objects[0].rings.length, 2);

  h.group('extract: statics and images');

  var wall = mockNode({ name: 'left-wall', curves: [mockCurve(boxBeziers(0, 0, 500, 20))] });
  h.assert('a named wall is static', PD.extract([wall]).objects[0].isStatic === true);

  var lockedThing = mockNode({ name: 'Curves', locked: true, curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  h.assert('a locked node is static', PD.extract([lockedThing]).objects[0].isStatic === true);

  var loose = mockNode({ name: 'Curves', curves: [mockCurve(boxBeziers(0, 0, 10, 10))] });
  h.assert('an ordinary node is dynamic', PD.extract([loose]).objects[0].isStatic === false);

  var img = mockNode({ tag: 'ImageNode', name: 'Image.png', curves: [mockCurve(boxBeziers(0, 0, 599, 301))] });
  var imgRes = PD.extract([img]);
  h.assertEqual('an image becomes its placement rectangle by default', imgRes.objects.length, 1);
  h.assertEqual('and says so', imgRes.objects[0].approximate, 'placement rectangle');
  h.assertEqual('or is refused on request', PD.extract([img], { imagePolicy: 'refuse' }).refusals.length, 1);

  h.group('extract: end to end');

  // The real contract: a selection goes in, planck fixtures come out.
  var W = PD.makeWorld({ scale: 100 });
  var out = PD.extract([letterO]);
  var parts = PD.decompose(out.objects[0].faces[0]);
  var body = PD.addBody(W, parts, {});
  h.assert('an extracted object becomes a body', body !== null);
  h.assert('with fixtures', body.fixtures > 0, 'got ' + body.fixtures);
  h.assertEqual('and no rejected parts', body.rejected.length, 0);
};
