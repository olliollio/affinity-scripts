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

  // The wall rectangle is worked out by GR.boundsForArtwork in world.js, which is pure and tested.
  // Breathing room goes OUTSIDE the artwork, never inside it: an inward margin looks tidier but
  // puts a wall through anything sitting near the edge, and a body that starts embedded in static
  // geometry can never sleep - the run then burns to the frame cap every time.

  function fmt(n, dp) { return Number(n).toFixed(dp === undefined ? 2 : dp); }

  /**
   * A node in one short string, for diagnostics only.
   *
   * The bounds matter more than the name here: several ropes commonly share the name "Curve", so a
   * name alone cannot say whether two references are two nodes or one node reported twice. A
   * bounding box distinguishes them, and reading it is safe on any node type.
   */
  function describeNode(node) {
    if (!node) return '(none)';
    var name = '?';
    try { name = String(node.description || node.name || '?'); } catch (e) { /* unnamed */ }
    var where = '';
    try {
      var b = node.boundsSpread || node.bounds;
      if (b) where = ' @(' + fmt(b.x, 0) + ',' + fmt(b.y, 0) + ' ' + fmt(b.w, 0) + 'x' + fmt(b.h, 0) + ')';
    } catch (e) { /* bounds unavailable on this node type */ }
    return '"' + name + '"' + where;
  }

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
      // The box is printed because counts alone cannot answer the question that keeps coming up:
      // does anything in the selection change when the artboard is resized? A background rectangle
      // sized to the page keeps its ring count and moves only its box, so the counts look identical
      // while the collider is a different shape. Ropes carry no rings, so fall back to polylines.
      var obox = null;
      try {
        obox = GR.ringsBBox(ob.rings);
        if (!obox && ob.polylines && ob.polylines.length) {
          for (var pj = 0; pj < ob.polylines.length; pj++) {
            var pp = ob.polylines[pj];
            for (var pk = 0; pk < pp.length; pk += 2) {
              if (!obox) obox = { x0: pp[pk], y0: pp[pk + 1], x1: pp[pk], y1: pp[pk + 1] };
              if (pp[pk] < obox.x0) obox.x0 = pp[pk];
              if (pp[pk] > obox.x1) obox.x1 = pp[pk];
              if (pp[pk + 1] < obox.y0) obox.y0 = pp[pk + 1];
              if (pp[pk + 1] > obox.y1) obox.y1 = pp[pk + 1];
            }
          }
        }
      } catch (e) { /* geometry may be empty */ }

      // Two checks, in two different spaces, because `spreadBaseBox` cannot be compared against a
      // tight geometry box at all. It is the four corners of `baseBox` pushed through the matrix and
      // then re-boxed, so it INFLATES under rotation while the artwork does not — a rotated circle
      // reports up to 41% larger than it is. Comparing the two directly is what made every rotated
      // object in an 85-node scene shout SUSPECT while the extraction was exactly right.
      //
      // So compare like with like:
      //
      //   MATRIX    our base-to-spread matrix applied to `baseBox` the same way the app does it,
      //             against `spreadBaseBox`. Rotation-safe, and still the check that catches a wrong
      //             matrix — extraction once used the node's LOCAL matrix, which is only the whole
      //             map while every ancestor is identity, and a resized artboard is not.
      //
      //   GEOMETRY  our spread rings pulled BACK through the inverse, against `baseBox`. In base
      //             space the node box is a tight box, so this compares two tight boxes and a wrong
      //             scale still shows up. Pulling the rings back rather than the box matters: an
      //             already-boxed shape re-inflates on the return trip, which is the same mistake
      //             in the other direction.
      //
      // Tolerance stays proportional. The polyline is a flattened approximation and the node box
      // includes the stroke, so exact equality was never on offer.
      var space = '';
      try {
        var sb = ob.node.spreadBaseBox;
        var bb = ob.node.baseBox;
        var mx = GR.matrixOf(ob.node);

        var predicted = GR.boxUnderMatrix(bb, mx);
        if (sb && predicted) {
          var mspan = Math.max(sb.width, sb.height, 1);
          var mtol = Math.max(1, 0.02 * mspan);
          var offM = Math.max(Math.abs(predicted.x0 - sb.x), Math.abs(predicted.y0 - sb.y),
                              Math.abs((predicted.x1 - predicted.x0) - sb.width),
                              Math.abs((predicted.y1 - predicted.y0) - sb.height));
          if (offM > mtol) {
            space = '  <-- SUSPECT: our base-to-spread matrix disagrees with the node box by ' +
                    fmt(offM) + 'pt';
          }
        }

        if (!space && bb && ob.rings.length) {
          var inv = GR.invertMatrix(mx);
          // A null inverse means a singular matrix — the node is scaled to nothing on some axis, so
          // there is no base box to compare against and nothing useful to say.
          if (inv) {
            var back = null;
            for (var bi = 0; bi < ob.rings.length; bi++) {
              var copy = ob.rings[bi].slice();
              GR.transformRing(copy, inv);
              var rb = GR.ringsBBox([copy]);
              if (!rb) continue;
              if (!back) back = rb;
              else {
                if (rb.x0 < back.x0) back.x0 = rb.x0;
                if (rb.y0 < back.y0) back.y0 = rb.y0;
                if (rb.x1 > back.x1) back.x1 = rb.x1;
                if (rb.y1 > back.y1) back.y1 = rb.y1;
              }
            }
            if (back) {
              var gspan = Math.max(bb.width, bb.height, 1);
              var gtol = Math.max(1, 0.02 * gspan);
              var offSize = Math.max(Math.abs((back.x1 - back.x0) - bb.width),
                                     Math.abs((back.y1 - back.y0) - bb.height));
              var offPos = Math.max(Math.abs(back.x0 - bb.x), Math.abs(back.y0 - bb.y));
              if (offSize > gtol) {
                space = '  <-- SUSPECT: geometry is ' + fmt(offSize) + 'pt off the node box in SIZE';
              } else if (offPos > gtol) {
                space = '  <-- SUSPECT: geometry is ' + fmt(offPos) + 'pt off the node box in POSITION';
              }
            }
          }
        }
      } catch (e) { /* not every node reports a box */ }

      // The node's OWN reported box and matrix, printed next to the geometry box. When a resize
      // makes a run differ, these three tell apart "the object really changed" from "the app
      // reports it in a space that moved". Base geometry that is identical while the matrix scales
      // means the matrix is page-relative, not that the artwork moved.
      var nb = '';
      try {
        var sb2 = ob.node.spreadBaseBox;
        if (sb2) nb += '  sbb=[' + fmt(sb2.x) + ',' + fmt(sb2.y) + ' ' +
                       fmt(sb2.width) + 'x' + fmt(sb2.height) + ']';
      } catch (e) { /* not every node reports a box */ }
      try {
        var bb2 = ob.node.baseBox;
        if (bb2) nb += ' bb=[' + fmt(bb2.x) + ',' + fmt(bb2.y) + ' ' +
                       fmt(bb2.width) + 'x' + fmt(bb2.height) + ']';
      } catch (e) { /* likewise */ }
      try {
        var td = ob.node.transform && ob.node.transform.data;
        if (td) nb += ' t=[' + fmt(td[0], 3) + ' ' + fmt(td[1], 3) + ' ' + fmt(td[2]) +
                      ' ' + fmt(td[3], 3) + ' ' + fmt(td[4], 3) + ' ' + fmt(td[5]) + ']';
      } catch (e) { /* likewise */ }

      console.log('  [' + i + '] ' + (ob.name || '(unnamed)') + nb +
        '  rings=' + ob.rings.length +
        ' faces=' + ob.faces.length +
        ' holes=' + holes +
        (obox ? '  box=[' + fmt(obox.x0) + ',' + fmt(obox.y0) + ' ' +
                fmt(obox.x1 - obox.x0) + 'x' + fmt(obox.y1 - obox.y0) + ']' : '  box=none') +
        (ob.isStatic ? ' STATIC' : '') +
        (ob.approximate ? ' (' + ob.approximate + ')' : '') +
        space);
    }
    // Kept after the fix rather than deleted: extraction used to map base to spread with the
    // node's LOCAL matrix, which is only the whole map while every ancestor is identity, and an
    // artboard resized with the Transform tool is not. Seeing the ancestors and the three rival
    // matrices side by side is what identified that, and it is what would identify the next one.
    console.log('');
    console.log('== node chain (base -> spread, innermost first) ==');
    for (var ci2 = 0; ci2 < ex.objects.length; ci2++) {
      var chain = [];
      var cur = ex.objects[ci2].node;
      for (var depth = 0; cur && depth < 8; depth++) {
        var ct = null;
        try { ct = cur.transform && cur.transform.data; } catch (e) { /* no matrix */ }
        var cn = '(unnamed)';
        try { cn = cur.name || '(unnamed)'; } catch (e) { /* no name */ }
        chain.push(cn + (ct ? ' t=[' + fmt(ct[0], 3) + ' ' + fmt(ct[1], 3) + ' ' + fmt(ct[2]) +
                              ' ' + fmt(ct[3], 3) + ' ' + fmt(ct[4], 3) + ' ' + fmt(ct[5]) + ']'
                            : ' t=none'));
        var nxt = null;
        try { nxt = cur.parent; } catch (e) { /* top of the tree */ }
        if (!nxt || nxt === cur) break;
        cur = nxt;
      }
      console.log('  [' + ci2 + '] ' + chain.join('  <-  '));

      // The reference notes assert these three are the same matrix, on the evidence of one grouped
      // child. If they diverge on a node whose ancestor carries a scale, the assertion is too weak
      // and the one that reproduces spreadBaseBox is the one extraction should be using.
      var alt = [];
      var nd = ex.objects[ci2].node;
      function m6(t) {
        if (!t || !t.data) return null;
        var q = t.data;
        return '[' + fmt(q[0], 3) + ' ' + fmt(q[1], 3) + ' ' + fmt(q[2]) + ' ' +
               fmt(q[3], 3) + ' ' + fmt(q[4], 3) + ' ' + fmt(q[5]) + ']';
      }
      try { var a1 = m6(nd.baseToSpreadTransform); if (a1) alt.push('baseToSpread=' + a1); }
      catch (e) { alt.push('baseToSpread=err'); }
      try { var a2 = m6(nd.localToSpreadTransform); if (a2) alt.push('localToSpread=' + a2); }
      catch (e) { alt.push('localToSpread=err'); }
      try { var a3 = m6(nd.curvesInterface && nd.curvesInterface.domainTransform); if (a3) alt.push('domain=' + a3); }
      catch (e) { alt.push('domain=err'); }
      if (alt.length) console.log('        ' + alt.join('  '));
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

    // The box hugs the ARTWORK, not the page.
    //
    // It used to start from the spread extents, which made the page part of the physics: resizing
    // the artboard moved the walls and silently produced a different drop from the same objects.
    // Worse for ropes specifically, because a rope roughly as long as the page rests its ends on
    // the side walls and is held up by them — grow the artboard and the same rope hangs free.
    //
    // Bounds still exist, because a body with nothing to hit falls forever and the run can only end
    // on the frame cap. They just no longer depend on something the user changes for layout
    // reasons. MARGIN stands the walls off, since a body overlapping a wall at frame 0 keeps its
    // island awake for the whole run.
    var box = null;
    function grow(pts) {
      for (var vi = 0; vi < pts.length; vi += 2) {
        if (!box) { box = { x0: pts[vi], y0: pts[vi + 1], x1: pts[vi], y1: pts[vi + 1] }; }
        if (pts[vi] < box.x0) box.x0 = pts[vi];
        if (pts[vi] > box.x1) box.x1 = pts[vi];
        if (pts[vi + 1] < box.y0) box.y0 = pts[vi + 1];
        if (pts[vi + 1] > box.y1) box.y1 = pts[vi + 1];
      }
    }
    for (var bi = 0; bi < ex.objects.length; bi++) {
      var rgs = ex.objects[bi].rings || [];
      for (var ri = 0; ri < rgs.length; ri++) grow(rgs[ri]);
      // Ropes carry no rings — an open path has no interior — so their polylines have to be walked
      // separately or a rope-only scene would produce an empty box. The spread extents used to hide
      // this by seeding the box with something non-degenerate.
      var pls = ex.objects[bi].polylines || [];
      for (var pi = 0; pi < pls.length; pi++) grow(pls[pi]);
    }
    // Nothing had any geometry at all. Fall back to the page rather than building a null world.
    var boxFromSpread = !box;
    if (!box) box = { x0: ext.x, y0: ext.y, x1: ext.x + ext.width, y1: ext.y + ext.height };

    // The walls are added AFTER the bodies, further down, because a slack rope hangs far below the
    // path it was drawn from. Sizing the box to the artwork alone put the floor through the middle
    // of a hanging rope: at 35% slack a 1640pt line settles 657pt down while its own box is only
    // 326pt tall, and the rope draped over the bottom wall with a 30 degree kink at each end. The
    // box has to hug what is actually in the world, not what it was derived from.

    // How far a rope may hang before it would start below something it should land ON. A slack
    // rope is laid along an arc, because excess length only looks right in the shape a rope really
    // hangs in — but a free-hanging arc for a 2470pt rope at 25% slack is ~865pt deep, and artwork
    // 515pt below would be missed entirely. Geometry you start past cannot be collided with.
    //
    // Measured from the STATIC rings rather than from bodies, because the statics may be built
    // after the ropes in the loop below, and because a ring is where the collider actually is.
    var CLEARANCE = 20;
    function clearDepthBelow(poly) {
      var minX = Infinity, maxX = -Infinity, lowest = -Infinity;
      for (var q = 0; q < poly.length; q += 2) {
        if (poly[q] < minX) minX = poly[q];
        if (poly[q] > maxX) maxX = poly[q];
        if (poly[q + 1] > lowest) lowest = poly[q + 1];
      }
      var nearest = Infinity;
      for (var so = 0; so < ex.objects.length; so++) {
        if (!ex.objects[so].isStatic) continue;
        var srings = ex.objects[so].rings || [];
        for (var sr = 0; sr < srings.length; sr++) {
          var ring = srings[sr];
          for (var sv = 0; sv < ring.length; sv += 2) {
            var vx = ring[sv], vy = ring[sv + 1];
            if (vx < minX || vx > maxX) continue;   // not under this rope
            if (vy <= lowest) continue;             // not below it
            if (vy < nearest) nearest = vy;
          }
        }
      }
      if (!isFinite(nearest)) return Infinity;      // nothing underneath: hang freely
      return Math.max(0, nearest - lowest - CLEARANCE);
    }

    // ----------------------------------------------------------------- bodies
    console.log('');
    console.log('== bodies ==');
    var made = [];
    var ropes = [];
    var softs = [];

    /**
     * The rig's rest lattice back in SPREAD points.
     *
     * `addSoftBody` meshes in SIM units, so `soft.mesh` cannot be handed to playback as it stands —
     * the binding, the poses and the mesh all have to be in one space, and poses come back in spread
     * points. Each node record already carries its own rest position in those units as `ox`/`oy`
     * (softbody.js keeps it for exactly this), so the lattice is rebuilt from the records rather
     * than rescaled from the sim mesh, and the y flip comes along for free.
     *
     * The spring INDICES are space-independent and transfer unchanged; only the rest length is a
     * distance, and it is scaled for consistency even though `evalSoftOutline` never reads it.
     */
    function spreadMeshOf(soft, scale) {
      var pts = [];
      for (var sn = 0; sn < soft.nodes.length; sn++) pts.push(soft.nodes[sn].ox, soft.nodes[sn].oy);
      var springs = [];
      for (var sp = 0; sp < soft.mesh.springs.length; sp++) {
        var spr = soft.mesh.springs[sp];
        springs.push([spr[0], spr[1], spr[2] * scale]);
      }
      return { nodes: pts, springs: springs, cell: soft.cell * scale };
    }

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
            slack: o.ropeSlack === undefined ? 0 : o.ropeSlack,
            maxSagDepth: clearDepthBelow(obj.polylines[rp]),
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
          (madeRope && madeRope.slack ? ' slack=' + fmt(madeRope.slack * 100, 0) + '%' : '') +
          (madeRope && madeRope.slack
            ? ' clearBelow=' + (isFinite(madeRope.maxSagDepth) ? fmt(madeRope.maxSagDepth, 0) + 'pt' : 'free')
            : '') +
          (obj.anchored ? ' PINNED' : ''));
        continue;
      }

      // AFTER the rope branch and BEFORE the rigid one, deliberately: an open path named "jelly"
      // carries both flags, and rope has to win because an open path has no interior to mesh.
      if (obj.isSoft) {
        var madeSoft = GR.addSoftBody(W, obj.faces, {
          softness: o.softness === undefined ? 0.5 : o.softness,
          density: o.density === undefined ? 1 : o.density,
          equaliseMass: !!o.equaliseMass,
          friction: o.friction === undefined ? 0.4 : o.friction,
          restitution: o.restitution === undefined ? 0.15 : o.restitution,
          name: obj.name,
          node: obj.node
        });

        if (madeSoft && !madeSoft.fallback) {
          for (var sn2 = 0; sn2 < madeSoft.nodes.length; sn2++) made.push(madeSoft.nodes[sn2]);

          // The outline is bound ONCE, at rest, against the spread-space lattice. Every face's outer
          // ring is bound before its own holes, and the faces in extraction order, because
          // `softCommands` walks this same array and emits one curve per entry into one PolyCurve —
          // a different order there would draw the holes against the wrong outlines.
          var spreadM = spreadMeshOf(madeSoft, W.scale);
          var bound = [];
          for (var sf = 0; sf < obj.faces.length; sf++) {
            var sface = obj.faces[sf];
            bound.push(GR.bindOutline(sface.outer, spreadM));
            var sholes = sface.holes || [];
            for (var sh = 0; sh < sholes.length; sh++) bound.push(GR.bindOutline(sholes[sh], spreadM));
          }

          softs.push({
            node: obj.node,
            mesh: spreadM,
            rings: bound,
            nodes: madeSoft.nodes,
            name: obj.name,
            object: obj,
            rig: madeSoft
          });

          console.log('  soft    ' + (obj.name || '(unnamed)') +
            '  cells=' + madeSoft.cellsAcross +
            ' cell=' + fmt(madeSoft.cell * W.scale, 1) + 'pt' +
            ' nodes=' + madeSoft.nodes.length +
            ' springs=' + madeSoft.springCount +
            // Only when there are several faces, because on the ordinary one-face object it is
            // always 0 and says nothing. On an "i" it is what holds the dot onto the stem.
            (madeSoft.mesh.crossFaceSprings ? ' cross=' + madeSoft.mesh.crossFaceSprings : '') +
            ' rings=' + bound.length +
            ' freq=' + fmt(madeSoft.frequency, 1) + 'Hz' +
            ' mass=' + fmt(madeSoft.totalMass, 4) +
            ' limit=' + madeSoft.limit);
          continue;
        }

        // Refusing is a real outcome, not an error: a shape whose wall cannot hold two cells at a
        // size the solver can work with is not jelly, and falling through to a rigid body is the
        // honest result. The reason is reported because "extent" and "thin" have different fixes.
        // No `continue` here on purpose — control drops out of this branch into the rigid path
        // below, so the shape still becomes an ordinary body via GR.addBody.
        console.log('  soft    ' + (obj.name || '(unnamed)') +
          '  NOT MESHED (' + (madeSoft ? madeSoft.fallback : 'unknown') + ') -> rigid');
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

    // ------------------------------------------------------------------ walls
    //
    // Now that every body exists, grow the box over where they actually START. A slack rope is laid
    // along a sagged arc, so its links begin well below the path they came from — the artwork box
    // alone would put the floor through the middle of the rope and it would drape over its own
    // wall. Each link contributes its full reach rather than its centre, since a link is a bar and
    // its ends stick out past its middle.
    for (var wb = 0; wb < made.length; wb++) {
      var wst = GR.bodyState(W, made[wb]);
      var reach = made[wb].halfLength || made[wb].simRadius * W.scale || 0;
      grow([wst.x - reach, wst.y - reach, wst.x + reach, wst.y + reach]);
    }
    // A pinned rope with slack starts on or above the path it was drawn along — never below it —
    // and only hangs once it settles, so where its links BEGIN says nothing about where they end.
    // Half the chain's length bounds how far it can reach below its pins.
    for (var wr = 0; wr < ropes.length; wr++) {
      if (!ropes[wr].reach) continue;
      var top = Infinity, lo = Infinity, hi = -Infinity;
      for (var wl = 0; wl < ropes[wr].links.length; wl++) {
        var ls = GR.bodyState(W, ropes[wr].links[wl]);
        if (ls.y < top) top = ls.y;
        if (ls.x < lo) lo = ls.x;
        if (ls.x > hi) hi = ls.x;
      }
      grow([lo, top, hi, top + ropes[wr].reach]);
    }
    // The rectangle itself is worked out by a pure function, so the degenerate cases have tests.
    var wallRect = GR.boundsForArtwork(box);
    GR.addBounds(W, wallRect);

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
    // The wall box is the one number that decides whether resizing the artboard can still reach the
    // physics. It is the union of the artwork now, so it must be identical at two artboard sizes.
    // Same size but shifted origin means a pure translation; a different size means something in
    // the selection is itself tracking the page.
    console.log('  physics box: x=' + fmt(wallRect.x) + ' y=' + fmt(wallRect.y) +
                ' w=' + fmt(wallRect.width) +
                ' h=' + fmt(wallRect.height) +
                (boxFromSpread ? '  <-- SUSPECT: fell back to the page, no artwork geometry' : ''));

    // -------------------------------------------------------------------- sim
    var t0 = Date.now();
    // A jelly is a lattice of springs, and the default 8/3 iterations leave it visibly stretchy —
    // the sag then measures solver error rather than the softness that was asked for. Raised only
    // when a softbody exists, so every scene that had none steps exactly as it did before.
    var frames = GR.run(W, {
      maxFrames: o.maxFrames === undefined ? 900 : o.maxFrames,
      seed: o.seed === undefined ? 1 : o.seed,
      velocityIterations: softs.length ? 24 : undefined,
      positionIterations: softs.length ? 8 : undefined
    });
    var ms = Date.now() - t0;

    console.log('');
    console.log('== simulation ==');
    if (softs.length) {
      console.log('  solver iterations raised to 24 velocity / 8 position (default 8 / 3) for ' +
                  softs.length + ' softbody/ies — that is where the extra time went');
    }
    console.log('  bodies=' + frames.bodyCount +
      ' frames=' + frames.frameCount +
      ' settledBy=' + frames.settledBy +
      ' in ' + ms + 'ms (' + fmt(ms / Math.max(1, frames.frameCount), 2) + 'ms/frame)');

    // A capped run is the one outcome that says nothing on its own, so say what was still moving.
    // Velocities come back in sim units; multiplied by the world scale they are points per second,
    // which is the only form in which "is that a lot?" has an answer.
    var rl = frames.restless;
    if (rl && frames.settledBy === 'cap') {
      console.log('  did NOT settle: ' + rl.awake + '/' + rl.total + ' bodies still awake, ' +
                  rl.overTolerance + ' over the sleep tolerance');
      console.log('  fastest ' + fmt(rl.maxLinear * W.scale, 3) + ' pt/s' +
                  (rl.worstName ? ' (' + rl.worstName + ')' : '') +
                  ', spin ' + fmt(rl.maxAngular, 4) + ' rad/s' +
                  '  — tolerance is ' + fmt(rl.linearTolerance * W.scale, 3) + ' pt/s and ' +
                  fmt(rl.angularTolerance, 4) + ' rad/s');
      console.log('  quiescence reached ' + frames.quietRun + ' of the ' +
                  frames.quietNeeded + ' consecutive quiet frames it needs');
      if (rl.overTolerance === 0) {
        console.log('  nothing is over tolerance NOW, so the run was still being interrupted late — ' +
                    'look at the overlap report above rather than at the physics.');
      }
    }

    if (frames.staticOverlaps.length) {
      console.log('  ' + frames.staticOverlaps.length +
        ' body/bodies started INSIDE static geometry — they can never sleep, so the run ended on');
      console.log('  the quiescence backstop. Move the artwork clear of its container to fix it.');
    }
    for (var wi = 0; wi < W.warnings.length; wi++) console.log('  warning: ' + W.warnings[wi]);

    console.log('');
    console.log('== final poses ==');
    // A softbody reports ONE line, not one per node. Its nodes are in `made` like everything else,
    // so the obvious loop prints ~164 lines for a single jelly and buries the rest of the report -
    // and the per-node numbers say nothing anyway, since no single node is the object. The centroid
    // is the honest summary: it is where the shape ended up. Rotation is omitted because a jelly
    // has none to report; every node carries its own angle and the object as a whole has no pose.
    var softCentroids = {};
    for (var m = 0; m < made.length; m++) {
      var rec = made[m];
      var pose = GR.poseAt(frames, frames.frameCount - 1, m);
      if (rec.isSoftNode) {
        var key = rec.softGroup;
        if (!softCentroids[key]) {
          softCentroids[key] = { name: rec.name, n: 0, ox: 0, oy: 0, x: 0, y: 0 };
        }
        var acc = softCentroids[key];
        acc.n++; acc.ox += rec.ox; acc.oy += rec.oy; acc.x += pose.x; acc.y += pose.y;
        continue;
      }
      console.log('  ' + (rec.name || '(unnamed)') +
        '  from (' + fmt(rec.ox) + ',' + fmt(rec.oy) + ')' +
        '  to (' + fmt(pose.x) + ',' + fmt(pose.y) + ')' +
        '  turned ' + fmt(pose.angle * 180 / Math.PI, 1) + ' deg');
    }
    for (var sc in softCentroids) {
      if (!Object.prototype.hasOwnProperty.call(softCentroids, sc)) continue;
      var a = softCentroids[sc];
      // The node names are "<object> [0]", "<object> [1]" and so on, so strip the index back off.
      var soleName = String(a.name || '(unnamed)').replace(/ \[\d+\]$/, '');
      console.log('  ' + soleName +
        '  from (' + fmt(a.ox / a.n) + ',' + fmt(a.oy / a.n) + ')' +
        '  to (' + fmt(a.x / a.n) + ',' + fmt(a.y / a.n) + ')' +
        '  centroid of ' + a.n + ' nodes');
    }

    // --------------------------------------------------------------- playback
    if (o.dryRun) {
      console.log('');
      console.log('gravity: dry run complete, document untouched.');
      return { world: W, bodies: made, frames: frames, extracted: ex };
    }

    var ctx;
    try {
      ctx = GR.playbackPrepare(doc, made, frames, ropes, softs);
    } catch (e) {
      console.log('');
      console.log('gravity: playback unavailable (' + e + '); document untouched.');
      return { world: W, bodies: made, frames: frames, extracted: ex };
    }

    // Ropes are drawn by rewriting their node's geometry, and `prepare` groups them by node
    // IDENTITY because createSetCurves replaces every curve on a node at once. That grouping is
    // invisible in its effects — a rope quietly assigned to the wrong group is simply never drawn,
    // and looks exactly like a rope that failed to fall. Report it, so the difference is one line
    // of console rather than a screenshot argument.
    if (ropes.length) {
      var groups = ctx.ropesByNode || [];
      var grouped = 0;
      for (var gi = 0; gi < groups.length; gi++) grouped += groups[gi].ropes.length;
      console.log('');
      console.log('== rope drawing ==');
      console.log('  ' + ropes.length + ' rope(s) -> ' + groups.length + ' node group(s)' +
        (groups.length === ropes.length ? '  OK' : '  <-- SUSPECT, expected one group per rope'));
      for (var gj = 0; gj < groups.length; gj++) {
        var gnames = [];
        for (var gk = 0; gk < groups[gj].ropes.length; gk++) gnames.push(groups[gj].ropes[gk].name);
        // The transform is the interesting column. A rope is redrawn by rewriting its node's
        // geometry, which lands in BASE space, while the poses are in spread space — so a node
        // with a non-identity transform needs the inverse applied or the rope draws displaced by
        // exactly that transform. An untransformed node is correct either way, which is why a
        // single rope on a freshly drawn path looked perfect for so long.
        var m = GR.matrixOf(groups[gj].node);
        var identity = !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0);
        console.log('    group ' + gj + ': ' + groups[gj].ropes.length + ' rope(s) [' + gnames.join(', ') + ']' +
          ' node=' + describeNode(groups[gj].node) +
          '  transform=' + (identity ? 'identity' :
            '[' + m.map(function (v) { return fmt(v, 2); }).join(' ') + ']') +
          '  toBase=' + (groups[gj].toBase ? 'ok' : (identity ? 'not needed' : 'SINGULAR, rope will draw displaced')));
      }
      if (grouped < ropes.length) {
        console.log('  ' + (ropes.length - grouped) + ' rope(s) have NO node and will never be drawn.');
      }
    }

    console.log('');
    console.log('gravity: playing ' + frames.frameCount + ' frames on canvas...');

    // The drop plays first so the behaviour can actually be judged, and the Finished dialog opens
    // when it ends. The dialog has to be raised from the timer callback rather than after this
    // call, because runModal would otherwise block the timer that drives playback.
    // No fallback number here on purpose. `|| 33` used to sit in this slot and quietly beat the
    // interval playback.js chooses, which is picked to land inside the timer's 15.4ms quantum —
    // 33 rounds up to three quanta and costs two thirds of the frame rate.
    GR.playbackPlay(ctx, { intervalMs: o.intervalMs }, function () {
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
                            '\n\nImport as an image sequence at ' + (res.fps || 30) + 'fps.'); } catch (e) { /* no alert */ }
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
