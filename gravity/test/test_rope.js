/**
 * Tests for rope.js.
 *
 * The pure parts carry the risk: uneven resampling gives links of unequal mass and the rope hangs
 * wrong, and a sign error in the pose-to-polyline rebuild would draw the rope inside out while the
 * simulation itself looked perfect.
 */

'use strict';

function line(x0, y0, x1, y1, n) {
  var pts = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    pts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
  return pts;
}

function segLengths(points) {
  var out = [];
  for (var i = 2; i < points.length; i += 2) {
    var dx = points[i] - points[i - 2], dy = points[i + 1] - points[i - 1];
    out.push(Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

module.exports = function (GR, h) {

  h.group('rope: anchor naming');

  ['hang', 'Hang', 'pin', 'anchor', 'washing hang', 'pin-2'].forEach(function (n) {
    h.assert('"' + n + '" anchors', GR.isAnchoredName(n) === true);
  });
  // Word boundaries, like the scenery names: a name that merely contains the letters must not pin.
  ['hanger', 'pinned', 'anchorage', 'unpin', 'changing'].forEach(function (n) {
    h.assert('"' + n + '" does not anchor', GR.isAnchoredName(n) === false);
  });
  h.assert('no name does not anchor', GR.isAnchoredName('') === false);

  h.group('rope: length and resampling');

  h.assertClose('a straight line measures its length', GR.polylineLength([0, 0, 100, 0]), 100, 1e-9);
  h.assertClose('an L measures both legs', GR.polylineLength([0, 0, 30, 0, 30, 40]), 70, 1e-9);
  h.assertEqual('a single point has no length', GR.polylineLength([5, 5]), 0);

  var even = GR.resamplePolyline(line(0, 0, 100, 0, 3), 11);
  h.assertEqual('resampling gives the requested count', even.length / 2, 11);
  h.assertClose('starting exactly at the start', even[0], 0, 1e-9);
  h.assertClose('and ending exactly at the end', even[even.length - 2], 100, 1e-6);

  var lens = segLengths(even);
  var minLen = Math.min.apply(null, lens), maxLen = Math.max.apply(null, lens);
  h.assert('with evenly spaced links', (maxLen - minLen) < 1e-6,
    'lengths ranged ' + minLen.toFixed(6) + '..' + maxLen.toFixed(6));

  // The case index-based sampling gets wrong: one long segment followed by many short ones. Walking
  // by arc length must still produce a uniform chain, or link masses come out uneven.
  var lumpy = [0, 0, 90, 0, 92, 0, 94, 0, 96, 0, 98, 0, 100, 0];
  var fixed = GR.resamplePolyline(lumpy, 11);
  var fixedLens = segLengths(fixed);
  var spread = Math.max.apply(null, fixedLens) - Math.min.apply(null, fixedLens);
  h.assert('uneven input still resamples evenly', spread < 1e-6, 'spread was ' + spread);

  // A corner must survive as a corner rather than being cut across.
  var corner = GR.resamplePolyline([0, 0, 50, 0, 50, 50], 3);
  h.assertEqual('a corner path resamples to the asked count', corner.length / 2, 3);
  h.assertClose('through the corner', corner[2], 50, 1e-6);

  h.assertEqual('a degenerate path is returned as-is', GR.resamplePolyline([1, 2], 5).length, 2);
  h.assertEqual('an empty path stays empty', GR.resamplePolyline([], 5).length, 0);
  h.assertEqual('a zero-length path collapses to two points',
    GR.resamplePolyline([7, 7, 7, 7], 6).length / 2, 2);

  h.group('rope: segment count');

  h.assert('a long thin rope gets many links', GR.ropeSegmentCount(1000, 2, {}, 100) > 20);
  h.assert('a short thick one gets few', GR.ropeSegmentCount(40, 10, {}, 100) < 10);
  h.assert('never fewer than three', GR.ropeSegmentCount(1, 100, {}, 100) >= 3);
  // Two caps now: a slack rope can afford resolution, a taut one cannot. Both must still be capped,
  // because the thickness rule alone would ask for thousands of links on a long hairline.
  h.assert('and never runaway', GR.ropeSegmentCount(100000, 0.1, {}, 100) <= GR.ROPE_MAX_SEGMENTS_SLACK);
  h.assert('and a taut one is capped harder',
    GR.ropeSegmentCount(100000, 0.1, { anchored: true }, 100) <= GR.ROPE_MAX_SEGMENTS);
  h.assertEqual('an explicit count wins', GR.ropeSegmentCount(500, 3, { segments: 12 }, 100), 12);

  // The stability ceiling. A 400pt rope at scale 100 is 4 sim units, so links may not go below
  // about 0.12 sim units each - measured, 33 links hold and 48 tear the rope apart.
  h.assert('the world scale caps the count', GR.ropeSegmentCount(400, 0.5, {}, 100) <= 33,
    'got ' + GR.ropeSegmentCount(400, 0.5, {}, 100));
  h.assert('even when asked for more', GR.ropeSegmentCount(400, 0.5, { segments: 48 }, 100) <= 33,
    'got ' + GR.ropeSegmentCount(400, 0.5, { segments: 48 }, 100));
  // A 100pt rope is only 1 sim unit at scale 100, so the ceiling bites hard there and not at all
  // at scale 20. At 400pt both hit the MAX_SEGMENTS cap first and the scale would look irrelevant.
  h.assert('a smaller world scale allows more links',
    GR.ropeSegmentCount(100, 0.5, {}, 20) > GR.ropeSegmentCount(100, 0.5, {}, 100),
    GR.ropeSegmentCount(100, 0.5, {}, 20) + ' vs ' + GR.ropeSegmentCount(100, 0.5, {}, 100));

  h.group('rope: rebuilding the polyline');

  // A horizontal chain of two links, each 10 long, lying along +x.
  var poses = [{ x: 10, y: 100, angle: 0 }, { x: 30, y: 100, angle: 0 }];
  var poly = GR.polylineFromPoses(poses, 10);
  h.assertEqual('two links give three points', poly.length / 2, 3);
  h.assertClose('the free start is behind the first link', poly[0], 0, 1e-9);
  h.assertClose('the joint sits between them', poly[2], 20, 1e-9);
  h.assertClose('and the end is past the last', poly[4], 40, 1e-9);
  h.assertClose('all at the same height', poly[3], 100, 1e-9);

  // A rotated link must extend along its own axis. Getting the sign wrong here would draw the rope
  // mirrored while the simulation looked perfect, which is the failure mode worth pinning.
  var turned = GR.polylineFromPoses([{ x: 0, y: 0, angle: Math.PI / 2 }], 10);
  h.assertClose('a quarter-turn link runs down the page in x', turned[0], 0, 1e-9);
  h.assertClose('from -halfLength', turned[1], -10, 1e-9);
  h.assertClose('to +halfLength', turned[3], 10, 1e-9);

  h.assertEqual('no poses gives no polyline', GR.polylineFromPoses([], 5).length, 0);
  h.assertEqual('missing poses are tolerated', GR.polylineFromPoses(null, 5).length, 0);

  h.group('rope: smoothing');

  var coarse = [0, 0, 100, 0, 200, 100, 300, 100];
  var smooth = GR.smoothPolyline(coarse, 4);
  h.assertEqual('smoothing multiplies the point count', smooth.length / 2, 3 * 4 + 1);

  // Interpolating, not approximating: every original joint must survive exactly where the solver
  // put it, or the drawn rope would drift away from the simulated one.
  h.assertClose('the first point is untouched', smooth[0], 0, 1e-9);
  h.assertClose('and the last', smooth[smooth.length - 2], 300, 1e-9);
  var foundMid = false;
  for (var si = 0; si < smooth.length; si += 2) {
    if (Math.abs(smooth[si] - 100) < 1e-9 && Math.abs(smooth[si + 1] - 0) < 1e-9) foundMid = true;
  }
  h.assert('and every original joint is still on the curve', foundMid);

  // A straight input must stay straight — no wobble invented where there is no curvature.
  var straight = GR.smoothPolyline([0, 0, 50, 0, 100, 0], 4);
  var maxDev = 0;
  for (var q = 1; q < straight.length; q += 2) maxDev = Math.max(maxDev, Math.abs(straight[q]));
  h.assert('a straight rope stays straight', maxDev < 1e-9, 'deviated by ' + maxDev);

  h.assertEqual('two points are returned unchanged', GR.smoothPolyline([0, 0, 10, 10], 4).length, 4);
  h.assertEqual('an empty polyline stays empty', GR.smoothPolyline([], 4).length, 0);
  h.assertEqual('subdivision of one is a no-op', GR.smoothPolyline(coarse, 1).length, coarse.length);

  h.group('rope: simulated');

  // End to end: a horizontal line above a floor should sag and come to rest on it.
  var W = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addStaticChain(W, [-400, 300, 400, 300, 400, 320, -400, 320], { closed: true });
  var rope = GR.addRope(W, line(-200, 0, 200, 0, 8), { thickness: 4, name: 'rope' });

  h.assert('a rope is built', rope !== null);
  h.assert('with several links', rope.links.length >= 3, 'got ' + (rope && rope.links.length));
  h.assertEqual('each link is one fixture', rope.links[0].fixtures, 1);
  h.assert('and every link joined the world', W.dynamics.length === rope.links.length);

  var startPoly = GR.polylineFromPoses(rope.links.map(function (l) { return GR.bodyState(W, l); }),
    rope.halfLength);
  h.assertClose('it starts where it was drawn', startPoly[1], 0, 1.0);

  var rec = GR.run(W, { maxFrames: 900 });
  var endPoses = rope.links.map(function (l) { return GR.bodyState(W, l); });
  var endPoly = GR.polylineFromPoses(endPoses, rope.halfLength);

  var lowest = -Infinity;
  for (var i = 1; i < endPoly.length; i += 2) if (endPoly[i] > lowest) lowest = endPoly[i];
  h.assert('the rope fell', lowest > 100, 'lowest point reached y=' + lowest.toFixed(1));
  h.assert('and stopped at the floor', lowest < 330, 'lowest point reached y=' + lowest.toFixed(1));
  h.assert('the run ended', rec.settled === true, 'settledBy=' + rec.settledBy);

  // Links must stay joined: no gap may exceed roughly one link length.
  var worstGap = 0;
  for (var k = 1; k < endPoses.length; k++) {
    var dx = endPoses[k].x - endPoses[k - 1].x, dy = endPoses[k].y - endPoses[k - 1].y;
    worstGap = Math.max(worstGap, Math.sqrt(dx * dx + dy * dy));
  }
  // Neighbours are pinned, so their centres stay one link apart. A loose bound here would pass
  // even on a rope that had torn itself to pieces, which is exactly what it failed to catch once.
  h.assert('the chain stayed joined', worstGap < rope.halfLength * 2.6,
    'worst neighbour distance ' + worstGap.toFixed(2) + ' vs link length ' + (rope.halfLength * 2).toFixed(2));

  h.group('rope: a taut rope does not stretch');

  // The regression that matters. A rope pinned at both ends with no slack is the worst case for an
  // iterative solver, and past a certain link count it tears apart entirely - measured stretch went
  // from 1.03x to 54x between 40 and 48 links on a 1000pt rope. The link cap exists for this.
  [300, 600, 1000, 1800].forEach(function (len) {
    var Wt = GR.makeWorld({ scale: 100, gravityY: -10 });
    var taut = GR.addRope(Wt, line(-len / 2, 0, len / 2, 0, 8), { thickness: 4, anchored: true });
    GR.run(Wt, { maxFrames: 600 });

    var poses = taut.links.map(function (l) { return GR.bodyState(Wt, l); });
    var chain = 0;
    for (var i = 1; i < poses.length; i++) {
      chain += Math.sqrt(Math.pow(poses[i].x - poses[i - 1].x, 2) + Math.pow(poses[i].y - poses[i - 1].y, 2));
    }
    var ideal = (poses.length - 1) * taut.halfLength * 2;
    h.assert('a ' + len + 'pt taut rope keeps its length',
      chain / ideal < 1.2,
      taut.links.length + ' links stretched ' + (chain / ideal).toFixed(2) + 'x');
  });

  h.group('rope: anchored');

  var Wa = GR.makeWorld({ scale: 100, gravityY: -10 });
  var hung = GR.addRope(Wa, line(-200, 0, 200, 0, 8), { thickness: 4, anchored: true, name: 'hang' });
  GR.run(Wa, { maxFrames: 600 });
  var hungPoses = hung.links.map(function (l) { return GR.bodyState(Wa, l); });
  var hungPoly = GR.polylineFromPoses(hungPoses, hung.halfLength);

  h.assertClose('the pinned start stayed put', hungPoly[0], -200, 25);
  h.assertClose('and the pinned end too', hungPoly[hungPoly.length - 2], 200, 25);

  var mid = hungPoses[Math.floor(hungPoses.length / 2)];
  h.assert('while the middle sagged', mid.y > 20, 'middle only reached y=' + mid.y.toFixed(1));

  h.group('rope: slack ropes get finer links than taut ones');

  // A taut rope is the worst case for an iterative solver and keeps the measured 32-link cap. A
  // slack one has no tension to compound and can afford resolution — which it needs, because a link
  // longer than a gap simply cannot enter it.
  var LONG = 1800, THICK = 10;
  var slackN = GR.ropeSegmentCount(LONG, THICK, {}, 100);
  var tautN = GR.ropeSegmentCount(LONG, THICK, { anchored: true }, 100);

  h.assert('a taut rope stays at the conservative cap', tautN <= GR.ROPE_MAX_SEGMENTS,
    tautN + ' links, cap ' + GR.ROPE_MAX_SEGMENTS);
  h.assert('a slack rope of the same length gets more', slackN > tautN,
    'slack ' + slackN + ' vs taut ' + tautN);
  h.assert('but not past its own cap', slackN <= GR.ROPE_MAX_SEGMENTS_SLACK, slackN + ' links');

  // The thickness rule is what actually picks the number; the cap only stops it running away. Links
  // about twice as long as they are thick is the target, so this rope should land near 90.
  h.assertClose('and the count still comes from thickness, not from the cap', slackN, LONG / (THICK * 2), 5);

  h.group('rope: a slack rope drapes into a gap narrower than a coarse link');

  // The reported symptom, reduced: a rope lying across lettering bridged the gaps between letters
  // rather than dipping into them, which looked like the collider being ignored. It was resolution
  // — at 32 links an 1800pt rope has 56pt links, and a rigid 56pt link cannot enter a 30pt gap.
  //
  // Two plinths with a gap between them stand in for two letters. The same rope is built twice,
  // once forced to the old coarse count and once at its natural fine one, and the fine one must
  // reach deeper into the gap. Comparing the two is what makes this a test of resolution rather
  // than of gravity.
  // The gap is deliberately NARROWER than a coarse link and much wider than a fine one, because
  // that is the whole mechanism: a rigid link longer than the gap has nowhere to pivot to and
  // simply rests across it, however hard gravity pulls. A first version of this test used a gap
  // wider than both link sizes and measured almost nothing — the rope lay flat on the plinths with
  // no slack to feed in, so it was measuring friction, not resolution.
  var GAP = 40, TOP = 400, LEN = 600;
  function drapeDepth(segments) {
    var Wd = GR.makeWorld({ scale: 100, gravityY: -10 });
    // Left plinth, gap, right plinth.
    GR.addStaticChain(Wd, [-400, TOP, -GAP / 2, TOP, -GAP / 2, TOP + 300, -400, TOP + 300], { closed: true });
    GR.addStaticChain(Wd, [GAP / 2, TOP, 400, TOP, 400, TOP + 300, GAP / 2, TOP + 300], { closed: true });

    var opts = { thickness: 8 };
    if (segments) opts.segments = segments;
    var r = GR.addRope(Wd, line(-LEN / 2, TOP - 100, LEN / 2, TOP - 100, 24), opts);
    GR.run(Wd, { maxFrames: 900 });

    // How far the lowest part of the rope got below the plinth tops, i.e. into the gap.
    var poly = GR.polylineFromPoses(
      r.links.map(function (l) { return GR.bodyState(Wd, l); }), r.halfLength);
    var lowest = -Infinity;
    for (var i = 1; i < poly.length; i += 2) if (poly[i] > lowest) lowest = poly[i];
    return { depth: lowest - TOP, links: r.links.length, linkLen: r.halfLength * 2 };
  }

  var coarse = drapeDepth(10);  // 60pt links: longer than the gap, so they cannot enter it
  var fine = drapeDepth(0);     // driven by thickness: ~16pt links, well inside the gap

  h.assert('the coarse links really are longer than the gap', coarse.linkLen > GAP,
    coarse.linkLen.toFixed(1) + 'pt links vs a ' + GAP + 'pt gap');
  h.assert('and the fine ones really are shorter', fine.linkLen < GAP,
    fine.linkLen.toFixed(1) + 'pt links vs a ' + GAP + 'pt gap');
  h.assert('the fine rope has more links', fine.links > coarse.links,
    fine.links + ' vs ' + coarse.links);

  h.assert('the coarse rope bridges the gap', coarse.depth < GAP / 3,
    'coarse sank ' + coarse.depth.toFixed(1) + 'pt into a ' + GAP + 'pt gap');
  h.assert('while the fine rope drops into it', fine.depth > coarse.depth * 2,
    'fine sank ' + fine.depth.toFixed(1) + 'pt, coarse ' + coarse.depth.toFixed(1) + 'pt');

  h.group('rope: many links stay joined');

  // Raising the cap is only safe if a 90-link chain does not tear the way a taut one does. Same
  // bound the single-rope test uses: no neighbour pair may drift past about one link length.
  var Wf = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addStaticChain(Wf, [-1000, 700, 1000, 700, 1000, 760, -1000, 760], { closed: true });
  var big = GR.addRope(Wf, line(-900, 0, 900, 0, 24), { thickness: 10 });
  GR.run(Wf, { maxFrames: 900 });

  h.assert('a long slack rope uses many links', big.links.length > GR.ROPE_MAX_SEGMENTS,
    big.links.length + ' links');
  var bigPoses = big.links.map(function (l) { return GR.bodyState(Wf, l); });
  var bigGap = 0;
  for (var bg = 1; bg < bigPoses.length; bg++) {
    bigGap = Math.max(bigGap, Math.sqrt(
      Math.pow(bigPoses[bg].x - bigPoses[bg - 1].x, 2) + Math.pow(bigPoses[bg].y - bigPoses[bg - 1].y, 2)));
  }
  h.assert('and still stays joined', bigGap < big.halfLength * 2.6,
    'worst neighbour distance ' + bigGap.toFixed(2) + ' vs link length ' + (big.halfLength * 2).toFixed(2));

  h.group('rope: several ropes at once');

  // Every test above builds exactly ONE rope, which left the multi-rope path unguarded — and that
  // is where it broke in the real document: with three lines above the artwork, only the lowest
  // behaved while the other two straightened out and hung in mid-air.
  //
  // The risk multiple ropes add is not physics, it is INDEXING. Poses are addressed by position in
  // the recording, `playback.prepare` assigns each body its index from its position in the flat
  // `made` list, and `ropeCommands` then looks each link up by that index. With one rope those two
  // orderings cannot disagree, because there is only one run of links starting at zero. With three
  // they can, and every rope after the first would draw using another rope's poses — which is the
  // symptom, since a rope drawn from a HIGHER rope's poses appears not to fall.
  var Wm = GR.makeWorld({ scale: 100, gravityY: -10 });
  GR.addStaticChain(Wm, [-400, 400, 400, 400, 400, 420, -400, 420], { closed: true });

  var heights = [0, 120, 240];
  var multi = heights.map(function (y, idx) {
    return GR.addRope(Wm, line(-200, y, 200, y, 8), { thickness: 4, name: 'rope' + idx });
  });

  h.assert('all three ropes were built', multi.every(function (r) { return r !== null; }));

  // This is what playback.prepare does: one flat list, index = position in it.
  var made = [];
  multi.forEach(function (r) { r.links.forEach(function (l) { made.push(l); }); });
  made.forEach(function (l, i) { l.frameIndex = i; });

  h.assertEqual('the flat body list matches the world exactly', made.length, Wm.dynamics.length);

  // The ordering assumption spelled out. `made` is built by walking the ropes in creation order,
  // and the world was filled the same way; if those ever diverge, every index below is off.
  var aligned = true;
  for (var mi = 0; mi < made.length; mi++) if (made[mi] !== Wm.dynamics[mi]) aligned = false;
  h.assert('and is in the same order, which is what makes an index a pose', aligned);

  var mrec = GR.run(Wm, { maxFrames: 1800 });
  h.assert('the run ended', mrec.settled === true, 'settledBy=' + mrec.settledBy);

  // Rebuild each rope exactly the way ropeCommands does — through the recording, by index — rather
  // than from the live bodies. Reading the bodies directly would pass even with the indices
  // crossed, because the bodies are always right; it is the LOOKUP that was suspect.
  var lastFrame = mrec.frameCount - 1;
  multi.forEach(function (rope, idx) {
    var viaIndex = rope.links.map(function (l) { return GR.poseAt(mrec, lastFrame, l.frameIndex); });
    var viaBody = rope.links.map(function (l) { return GR.bodyState(Wm, l); });

    var worst = 0;
    for (var i = 0; i < viaIndex.length; i++) {
      worst = Math.max(worst, Math.abs(viaIndex[i].x - viaBody[i].x), Math.abs(viaIndex[i].y - viaBody[i].y));
    }
    h.assert('rope ' + idx + ' reads its OWN poses out of the recording', worst < 0.01,
      'worst disagreement ' + worst.toFixed(3) + 'pt between index lookup and body state');
  });

  // And the behaviour the screenshot showed was wrong: all three must fall, not just the lowest.
  // A rope that straightens and stays at its drawn height is the failure being guarded against.
  multi.forEach(function (rope, idx) {
    var poly = GR.polylineFromPoses(
      rope.links.map(function (l) { return GR.poseAt(mrec, lastFrame, l.frameIndex); }), rope.halfLength);
    var lowest = -Infinity;
    for (var i = 1; i < poly.length; i += 2) if (poly[i] > lowest) lowest = poly[i];
    h.assert('rope ' + idx + ' fell to the floor rather than hanging in the air', lowest > 380,
      'started at y=' + heights[idx] + ', lowest point reached y=' + lowest.toFixed(1));
  });
};
