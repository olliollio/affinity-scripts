/**
 * main.js — the entry point.
 *
 * Runs the whole pipeline against the current selection and reports what happened, then hands the
 * recording to the scrubber. Pass `{ dryRun: true }` to stop before anything touches the document,
 * which is how the extraction layer was validated before playback existed.
 *
 * The console report is kept even in the full run, because it is the only view into the parts that
 * leave no trace on canvas. In particular the transform check — a body's position before stepping
 * must equal the artwork's own centroid — closes the loop through extract, flatten, transformRing
 * and bodies. A wrong base-to-spread matrix would offset every body equally and still produce a
 * simulation that looks entirely plausible while landing in the wrong place.
 */

(function (GR) {
  'use strict';

  // Breathing room OUTSIDE the artwork and the spread, never inside them. An inward margin looks
  // tidier but puts a wall through anything sitting near the page edge, and a body that starts
  // embedded in static geometry can never sleep - the run then burns to the frame cap every time.
  var MARGIN = 40;

  function fmt(n, dp) { return Number(n).toFixed(dp === undefined ? 2 : dp); }

  function main(opts) {
    var o = opts || {};
    var app;
    try { app = require('/application').app; }
    catch (e) { console.log('gravity: no /application module: ' + e); return null; }

    var doc = app.documents.current;   // NOT app.activeDocument, which does not exist
    if (!doc) { console.log('gravity: open a document first.'); return null; }

    var nodes = [];
    try { for (var n of doc.selection.nodes) nodes.push(n); }
    catch (e) { console.log('gravity: could not read the selection: ' + e); return null; }
    if (!nodes.length) { console.log('gravity: select something first.'); return null; }

    // Settings come from the dialog unless the caller supplied them, which is what lets a dry run
    // skip the UI entirely.
    if (!o.dryRun && !o.noDialog) {
      var chosenOpts = GR.showSettings({ scale: o.scale });
      if (!chosenOpts) { console.log('gravity: cancelled.'); return null; }
      for (var key in chosenOpts) {
        if (Object.prototype.hasOwnProperty.call(chosenOpts, key) && o[key] === undefined) {
          o[key] = chosenOpts[key];
        }
      }
    }

    console.log('gravity 1.0.0-dev' + (o.dryRun ? ' — dry run, the document is not modified' : ''));
    console.log('selection: ' + nodes.length + ' node(s)');

    // Conversion happens before extraction, and the selection is re-read afterwards because the
    // text nodes are replaced by new curve nodes - the old references would be stale.
    if (o.convertText && !o.dryRun) {
      // Only the text nodes are replaced by the command; every other reference stays valid. They
      // have to be kept explicitly, because createConvertToCurves REPLACES the app selection with
      // just the nodes it made - re-reading the selection wholesale would drop everything else.
      var survivors = [];
      for (var sv = 0; sv < nodes.length; sv++) {
        if (GR.classifyNode(nodes[sv]) !== 'text') survivors.push(nodes[sv]);
      }

      var conv = GR.convertTextToCurves(doc, nodes);
      if (conv.error) {
        console.log('  could not convert text to curves: ' + conv.error);
      } else if (conv.converted) {
        var fresh = [];
        try { for (var n2 of doc.selection.nodes) fresh.push(n2); }
        catch (e) { console.log('  could not read the selection after converting: ' + e); return null; }

        nodes = GR.mergeNodeLists(survivors, fresh);
        console.log('  converted ' + conv.converted + ' text object(s) to curves (undoable); ' +
                    survivors.length + ' other object(s) kept, ' + nodes.length + ' total');
      }
    }

    // ---------------------------------------------------------------- extract
    var ex = GR.extract(nodes, o);
    console.log('');
    console.log('== extracted ==');
    for (var i = 0; i < ex.objects.length; i++) {
      var ob = ex.objects[i];
      var holes = 0;
      for (var f = 0; f < ob.faces.length; f++) holes += ob.faces[f].holes.length;
      // Does the extracted geometry actually sit where the node does? A wrong coordinate space
      // produces rings that are perfectly self-consistent and land somewhere else entirely, which
      // no amount of downstream checking would catch. Comparing against the node's own reported
      // box is the cheap way to notice.
      var space = '';
      try {
        var bb = GR.ringsBBox(ob.rings);
        var sb = ob.node.spreadBaseBox;
        if (bb && sb) {
          var off = Math.max(Math.abs(bb.x0 - sb.x), Math.abs(bb.y0 - sb.y));
          var span = Math.max(sb.width, sb.height, 1);
          if (off > 0.5 * span) space = '  <-- SUSPECT: geometry is ' + fmt(off) + 'pt from the node box';
        }
      } catch (e) { /* not every node reports a box */ }

      console.log('  [' + i + '] ' + (ob.name || '(unnamed)') +
        '  rings=' + ob.rings.length +
        ' faces=' + ob.faces.length +
        ' holes=' + holes +
        (ob.isStatic ? ' STATIC' : '') +
        (ob.approximate ? ' (' + ob.approximate + ')' : '') +
        space);
    }
    for (var r = 0; r < ex.refusals.length; r++) console.log('  refused: ' + ex.refusals[r].message);
    if (!ex.objects.length) { console.log('gravity: nothing usable in the selection.'); return null; }

    // ------------------------------------------------------------------ world
    var ext;
    try { ext = doc.currentSpread.getSpreadExtents(); }
    catch (e) { console.log('gravity: could not read spread extents: ' + e); return null; }

    // The world scale is chosen from the artwork rather than fixed. Box2D's linearSlop is a
    // constant in SIM units, so a fixed scale that suits a 500pt letter leaves a 12pt glyph's stem
    // only a few multiples of slop thick and it skitters instead of settling.
    var sizes = [];
    for (var si = 0; si < ex.objects.length; si++) {
      if (ex.objects[si].isStatic) continue;
      var sbb = GR.ringsBBox(ex.objects[si].rings);
      if (sbb) sizes.push(Math.max(sbb.x1 - sbb.x0, sbb.y1 - sbb.y0));
    }
    var scale = o.scale || GR.suggestScale(sizes);

    // Gravity is an acceleration in sim units, so it depends on the scale just chosen.
    var grav = { x: 0, y: -10 };
    if (o.gravityMagnitude !== undefined) {
      grav = GR.gravityVector(o.gravityMagnitude, o.gravityAngle || 0, scale);
    } else if (o.gravityX !== undefined || o.gravityY !== undefined) {
      grav = { x: o.gravityX || 0, y: o.gravityY === undefined ? -10 : o.gravityY };
    }

    var W = GR.makeWorld({ scale: scale, gravityX: grav.x, gravityY: grav.y });
    // The box must contain the spread AND every piece of artwork, then stand off from both. Using
    // the spread alone is not enough: artwork routinely sits on or past the page edge, and any
    // body overlapping a wall at frame 0 keeps its island awake forever.
    var box = { x0: ext.x, y0: ext.y, x1: ext.x + ext.width, y1: ext.y + ext.height };
    for (var bi = 0; bi < ex.objects.length; bi++) {
      var rgs = ex.objects[bi].rings;
      for (var ri = 0; ri < rgs.length; ri++) {
        var rg = rgs[ri];
        for (var vi = 0; vi < rg.length; vi += 2) {
          if (rg[vi] < box.x0) box.x0 = rg[vi];
          if (rg[vi] > box.x1) box.x1 = rg[vi];
          if (rg[vi + 1] < box.y0) box.y0 = rg[vi + 1];
          if (rg[vi + 1] > box.y1) box.y1 = rg[vi + 1];
        }
      }
    }
    GR.addBounds(W, {
      x: box.x0 - MARGIN, y: box.y0 - MARGIN,
      width: (box.x1 - box.x0) + 2 * MARGIN,
      height: (box.y1 - box.y0) + 2 * MARGIN
    });

    // ----------------------------------------------------------------- bodies
    console.log('');
    console.log('== bodies ==');
    var made = [];
    var ropes = [];
    for (var k = 0; k < ex.objects.length; k++) {
      var obj = ex.objects[k];

      if (obj.isStatic) {
        for (var s = 0; s < obj.rings.length; s++) {
          GR.addStaticChain(W, obj.rings[s], { name: obj.name });
        }
        console.log('  static  ' + (obj.name || '(unnamed)') + '  chains=' + obj.rings.length);
        continue;
      }

      if (obj.isRope) {
        // An open path has no interior, so it becomes a chain of linked bodies rather than one
        // rigid body. Its geometry is rewritten during playback instead of being transformed.
        var madeRope = null;
        for (var rp = 0; rp < obj.polylines.length; rp++) {
          madeRope = GR.addRope(W, obj.polylines[rp], {
            thickness: obj.thickness,
            anchored: obj.anchored,
            friction: o.friction === undefined ? 0.4 : o.friction,
            restitution: o.restitution === undefined ? 0.15 : o.restitution,
            density: o.density === undefined ? 1 : o.density,
            name: obj.name,
            node: obj.node
          });
          if (madeRope) {
            madeRope.object = obj;
            madeRope.curveIndex = rp;
            ropes.push(madeRope);
            for (var li = 0; li < madeRope.links.length; li++) made.push(madeRope.links[li]);
          }
        }
        console.log('  rope    ' + (obj.name || '(unnamed)') +
          '  paths=' + obj.polylines.length +
          ' links=' + (madeRope ? madeRope.links.length : 0) +
          ' thickness=' + fmt(obj.thickness || 0, 1) + 'pt' +
          (obj.anchored ? ' PINNED' : ''));
        continue;
      }

      // One body per object, with every face's parts on it, so a two-part glyph like "i" stays
      // one rigid thing.
      var parts = [];
      for (var ff = 0; ff < obj.faces.length; ff++) {
        var p = GR.decompose(obj.faces[ff], o);
        for (var q = 0; q < p.length; q++) parts.push(p[q]);
      }
      if (!parts.length) { console.log('  SKIPPED ' + (obj.name || '(unnamed)') + ': decomposed to nothing'); continue; }

      var rec = GR.addBody(W, parts, {
        density: o.density === undefined ? 1 : o.density,
        equaliseMass: !!o.equaliseMass,
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

    if (!made.length) { console.log('gravity: no dynamic bodies.'); return null; }

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
      var st = GR.bodyState(W, made[b]);
      var drift = Math.sqrt((st.x - made[b].ox) * (st.x - made[b].ox) +
                            (st.y - made[b].oy) * (st.y - made[b].oy));
      if (drift > worstDrift) worstDrift = drift;
    }
    console.log('  worst round-trip drift: ' + worstDrift.toFixed(6) + ' pt' +
                (worstDrift < 1e-6 ? '  OK' : '  <-- SUSPECT'));

    var scaleInfo = GR.checkScale(W);
    console.log('  world scale: ' + fmt(W.scale, 2) + ' src units per sim unit' +
                (o.scale ? ' (fixed)' : ' (chosen from the artwork)'));
    console.log('  scale: ' + scaleInfo.note);
    // Thin features are what actually break: Box2D's linearSlop is a constant in sim units, so a
    // glyph stem only a few multiples of slop thick skitters instead of settling.
    try {
      var slopPt = W.planck.Settings.linearSlop * W.scale;
      console.log('  linearSlop is ' + fmt(slopPt, 3) + 'pt at this scale — features thinner than ' +
                  'about ' + fmt(slopPt * 10, 1) + 'pt will be unstable');
    } catch (e) { /* settings unavailable */ }
    console.log('  spread extents: x=' + fmt(ext.x) + ' y=' + fmt(ext.y) +
                ' w=' + fmt(ext.width) + ' h=' + fmt(ext.height));

    // -------------------------------------------------------------------- sim
    var t0 = Date.now();
    var frames = GR.run(W, {
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
      var pose = GR.poseAt(frames, frames.frameCount - 1, m);
      console.log('  ' + (made[m].name || '(unnamed)') +
        '  from (' + fmt(made[m].ox) + ',' + fmt(made[m].oy) + ')' +
        '  to (' + fmt(pose.x) + ',' + fmt(pose.y) + ')' +
        '  turned ' + fmt(pose.angle * 180 / Math.PI, 1) + ' deg');
    }

    // --------------------------------------------------------------- playback
    if (o.dryRun) {
      console.log('');
      console.log('gravity: dry run complete, document untouched.');
      return { world: W, bodies: made, frames: frames, extracted: ex };
    }

    var ctx;
    try {
      ctx = GR.playbackPrepare(doc, made, frames, ropes);
    } catch (e) {
      console.log('');
      console.log('gravity: playback unavailable (' + e + '); document untouched.');
      return { world: W, bodies: made, frames: frames, extracted: ex };
    }

    console.log('');
    console.log('gravity: playing ' + frames.frameCount + ' frames on canvas...');

    // The drop plays first so the behaviour can actually be judged, and the Finished dialog opens
    // when it ends. The dialog has to be raised from the timer callback rather than after this
    // call, because runModal would otherwise block the timer that drives playback.
    GR.playbackPlay(ctx, { intervalMs: o.intervalMs || 33 }, function () {
      var chosen = GR.showScrubber(ctx, { offerExport: !!o.exportSequence });
      console.log('gravity: kept frame ' + chosen.frame + ' of ' + frames.frameCount +
                  (chosen.accepted ? '' : ' (settled result)'));

      if (!chosen.wantsExport) return;

      console.log('gravity: exporting frames 0-' + chosen.frame + '...');
      GR.exportSequence(ctx, { jpeg: chosen.jpeg, lastFrame: chosen.frame, keepFrame: chosen.frame },
        function (res) {
          if (res.ok) {
            console.log('gravity: exported ' + res.written + ' frame(s) to ' + res.where +
                        (res.preset ? '  [preset "' + res.preset + '", from ' + res.module + ']' : ''));

            try { app.alert('Export complete: ' + res.written + ' frames.\n' + res.where +
                            '\n\nImport as an image sequence at 30fps.'); } catch (e) { /* no alert */ }
          } else {
            console.log('gravity: export failed after ' + (res.written || 0) + ' frame(s): ' + res.error);
            try { app.alert('Export failed: ' + res.error + '\nThe frame you chose has been kept.'); }
            catch (e) { /* no alert */ }
          }
        });
    });

    return { world: W, bodies: made, frames: frames, extracted: ex, playback: ctx };
  }

  GR.main = main;

})(GR);
