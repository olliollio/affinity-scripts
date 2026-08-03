/**
 * main.js — the entry point. READ-ONLY for now.
 *
 * This runs the whole pipeline against a real selection and reports what happened, without
 * touching the document. Every module below it is verified headlessly or against mock nodes; this
 * is the first thing that meets actual Affinity nodes, so it exists to prove the SDK assumptions
 * before playback.js is built on top of them.
 *
 * What it is checking, in order of how badly a mistake would hurt:
 *   1. extract.js reads real nodes at all
 *   2. the base->spread transform is right — a body's start position must match the artwork's
 *      own centroid, and that is checkable without moving anything
 *   3. the world scale suits the artwork
 *   4. the simulation settles, and by which rule
 */

(function (PD) {
  'use strict';

  // Keeps bodies off the spread edge, so the boundary chain is visible in a preview later.
  var MARGIN = 60;

  function fmt(n, dp) { return Number(n).toFixed(dp === undefined ? 2 : dp); }

  function main(opts) {
    var o = opts || {};
    var app;
    try { app = require('/application').app; }
    catch (e) { console.log('physicsdrop: no /application module: ' + e); return null; }

    var doc = app.documents.current;   // NOT app.activeDocument, which does not exist
    if (!doc) { console.log('physicsdrop: open a document first.'); return null; }

    var nodes = [];
    try { for (var n of doc.selection.nodes) nodes.push(n); }
    catch (e) { console.log('physicsdrop: could not read the selection: ' + e); return null; }
    if (!nodes.length) { console.log('physicsdrop: select something first.'); return null; }

    console.log('physicsdrop 2.0.0-dev — dry run, the document is not modified');
    console.log('selection: ' + nodes.length + ' node(s)');

    // ---------------------------------------------------------------- extract
    var ex = PD.extract(nodes, o);
    console.log('');
    console.log('== extracted ==');
    for (var i = 0; i < ex.objects.length; i++) {
      var ob = ex.objects[i];
      var holes = 0;
      for (var f = 0; f < ob.faces.length; f++) holes += ob.faces[f].holes.length;
      console.log('  [' + i + '] ' + (ob.name || '(unnamed)') +
        '  rings=' + ob.rings.length +
        ' faces=' + ob.faces.length +
        ' holes=' + holes +
        (ob.isStatic ? ' STATIC' : '') +
        (ob.approximate ? ' (' + ob.approximate + ')' : ''));
    }
    for (var r = 0; r < ex.refusals.length; r++) console.log('  refused: ' + ex.refusals[r].message);
    if (!ex.objects.length) { console.log('physicsdrop: nothing usable in the selection.'); return null; }

    // ------------------------------------------------------------------ world
    var ext;
    try { ext = doc.currentSpread.getSpreadExtents(); }
    catch (e) { console.log('physicsdrop: could not read spread extents: ' + e); return null; }

    var W = PD.makeWorld({
      scale: o.scale || PD.WORLD_SCALE,
      gravityX: o.gravityX === undefined ? 0 : o.gravityX,
      gravityY: o.gravityY === undefined ? -10 : o.gravityY
    });
    PD.addBounds(W, {
      x: ext.x + MARGIN, y: ext.y + MARGIN,
      width: ext.width - 2 * MARGIN, height: ext.height - 2 * MARGIN
    });

    // ----------------------------------------------------------------- bodies
    console.log('');
    console.log('== bodies ==');
    var made = [];
    for (var k = 0; k < ex.objects.length; k++) {
      var obj = ex.objects[k];

      if (obj.isStatic) {
        for (var s = 0; s < obj.rings.length; s++) {
          PD.addStaticChain(W, obj.rings[s], { name: obj.name });
        }
        console.log('  static  ' + (obj.name || '(unnamed)') + '  chains=' + obj.rings.length);
        continue;
      }

      // One body per object, with every face's parts on it, so a two-part glyph like "i" stays
      // one rigid thing.
      var parts = [];
      for (var ff = 0; ff < obj.faces.length; ff++) {
        var p = PD.decompose(obj.faces[ff], o);
        for (var q = 0; q < p.length; q++) parts.push(p[q]);
      }
      if (!parts.length) { console.log('  SKIPPED ' + (obj.name || '(unnamed)') + ': decomposed to nothing'); continue; }

      var rec = PD.addBody(W, parts, {
        density: o.density === undefined ? 1 : o.density,
        friction: o.friction === undefined ? 0.4 : o.friction,
        restitution: o.restitution === undefined ? 0.15 : o.restitution,
        name: obj.name,
        node: obj.node
      });
      if (!rec) { console.log('  SKIPPED ' + (obj.name || '(unnamed)') + ': no fixture was accepted'); continue; }

      rec.object = obj;
      made.push(rec);
      console.log('  body    ' + (obj.name || '(unnamed)') +
        '  parts=' + parts.length +
        ' fixtures=' + rec.fixtures +
        (rec.rejected.length ? ' REJECTED=' + rec.rejected.length : '') +
        ' mass=' + fmt(rec.body.getMass(), 4) +
        (rec.bullet ? ' bullet' : '') +
        '  centroid=(' + fmt(rec.ox) + ',' + fmt(rec.oy) + ')');
    }

    if (!made.length) { console.log('physicsdrop: no dynamic bodies.'); return null; }

    // --------------------------------------------------- the transform check
    //
    // The most valuable line in this whole script. Bodies are built with their vertices offset by
    // -centroid, so before a single step the body position must equal the artwork's own centroid.
    // If the base->spread matrix were wrong, every body would be offset by the same amount and the
    // simulation would still look plausible while landing in the wrong place.
    console.log('');
    console.log('== transform check (should be 0.0000 before stepping) ==');
    var worstDrift = 0;
    for (var b = 0; b < made.length; b++) {
      var st = PD.bodyState(W, made[b]);
      var drift = Math.sqrt((st.x - made[b].ox) * (st.x - made[b].ox) +
                            (st.y - made[b].oy) * (st.y - made[b].oy));
      if (drift > worstDrift) worstDrift = drift;
    }
    console.log('  worst round-trip drift: ' + worstDrift.toFixed(6) + ' pt' +
                (worstDrift < 1e-6 ? '  OK' : '  <-- SUSPECT'));

    var scaleInfo = PD.checkScale(W);
    console.log('  scale: ' + scaleInfo.note);
    console.log('  spread extents: x=' + fmt(ext.x) + ' y=' + fmt(ext.y) +
                ' w=' + fmt(ext.width) + ' h=' + fmt(ext.height));

    // -------------------------------------------------------------------- sim
    var t0 = Date.now();
    var frames = PD.run(W, {
      maxFrames: o.maxFrames === undefined ? 900 : o.maxFrames,
      seed: o.seed === undefined ? 1 : o.seed
    });
    var ms = Date.now() - t0;

    console.log('');
    console.log('== simulation ==');
    console.log('  bodies=' + frames.bodyCount +
      ' frames=' + frames.frameCount +
      ' settledBy=' + frames.settledBy +
      ' in ' + ms + 'ms (' + fmt(ms / Math.max(1, frames.frameCount), 2) + 'ms/frame)');

    if (frames.staticOverlaps.length) {
      console.log('  ' + frames.staticOverlaps.length +
        ' body/bodies started INSIDE static geometry — they can never sleep, so the run ended on');
      console.log('  the quiescence backstop. Move the artwork clear of its container to fix it.');
    }
    for (var wi = 0; wi < W.warnings.length; wi++) console.log('  warning: ' + W.warnings[wi]);

    console.log('');
    console.log('== final poses ==');
    for (var m = 0; m < made.length; m++) {
      var pose = PD.poseAt(frames, frames.frameCount - 1, m);
      console.log('  ' + (made[m].name || '(unnamed)') +
        '  from (' + fmt(made[m].ox) + ',' + fmt(made[m].oy) + ')' +
        '  to (' + fmt(pose.x) + ',' + fmt(pose.y) + ')' +
        '  turned ' + fmt(pose.angle * 180 / Math.PI, 1) + ' deg');
    }

    console.log('');
    console.log('physicsdrop: dry run complete, document untouched.');
    return { world: W, bodies: made, frames: frames, extracted: ex };
  }

  PD.main = main;

})(PD);
