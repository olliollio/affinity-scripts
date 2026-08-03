/**
 * playback.js — recorded frames back onto the canvas. Touches the Affinity API.
 *
 * Ported from physicsdrop, whose preview/scrub/commit dance is known to work. The parts that carry over
 * unchanged are deliberate: `executeCommand(cmd, true)` previews and replaces the previous
 * preview, `executeCommand(cmd, false)` commits one undoable step, and `clearPreviews()` drops
 * anything uncommitted. That behaviour is what makes scrubbing cheap — each slider move is one
 * preview that supersedes the last, not an undo stack to unwind.
 *
 * ── Rotation sign, the one thing to watch ─────────────────────────────────────
 * physicsdrop solved directly in Affinity's y-down space and applied its body angle straight to
 * `Transform.createRotate`, and it looked right on canvas. v2 solves in planck's y-up space and
 * `GR.bodyState` already negates the angle on the way out, so the value reaching this module is
 * in the SAME convention physicsdrop used. That is why no further negation happens here. If a first run
 * shows objects counter-rotating against the simulation, this is the line to flip — and only
 * this line, because nothing else touches rotation.
 */

(function (GR) {
  'use strict';

  /**
   * One transform command per body for a given frame.
   *
   * Rotating about the ORIGINAL centroid is what keeps this a pure delta: the artwork never moves
   * from its authored position in the document's mind, so replaying frame 0 restores it exactly
   * and the undo stack stays one step deep.
   */
  function commandForFrame(ctx, frameIndex) {
    var g = ctx.sdk;
    var cc = g.CompoundCommandBuilder.create();
    var any = false;

    for (var i = 0; i < ctx.bodies.length; i++) {
      var b = ctx.bodies[i];
      if (!b.selection) continue;
      var pose = GR.poseAt(ctx.frames, frameIndex, i);

      // around() mutates its receiver, which is fine on a Transform we just created and own.
      var rot = g.Transform.createRotate(pose.angle - (b.angle0 || 0)).around(b.ox, b.oy);
      var xf = g.Transform.createTranslate(pose.x - b.ox, pose.y - b.oy).multiply(rot);
      cc.addCommand(g.DocumentCommand.createTransform(b.selection, xf, { mergeable: false }));
      any = true;
    }

    // Ropes are rewritten rather than transformed, but ride the same compound command so the whole
    // frame stays one preview and one undo step.
    var ropeCmds = ropeCommands(ctx, frameIndex);
    for (var r = 0; r < ropeCmds.length; r++) { cc.addCommand(ropeCmds[r]); any = true; }

    return any ? cc.createCommand() : null;
  }

  /** Gathers the SDK pieces once, so a missing module fails here rather than mid-scrub. */
  function loadSdk() {
    var geometry = require('/geometry');
    var commands = require('/commands');
    var selections = require('/selections');
    return {
      Transform: geometry.Transform,
      PolyCurve: geometry.PolyCurve,
      CurveBuilder: geometry.CurveBuilder,
      DocumentCommand: commands.DocumentCommand,
      CompoundCommandBuilder: commands.CompoundCommandBuilder,
      Selection: selections.Selection
    };
  }

  /**
   * Commands that rewrite each rope's geometry for a frame.
   *
   * A rigid transform cannot express a rope, because a rope DEFORMS: the whole point is that its
   * shape changes. So its polyline is rebuilt from its link poses and written with
   * `createSetCurves`, which replaces a curve node's geometry outright. That works as a PREVIEW and
   * is cheap - measured at 0.2ms per rewrite at 7 points and 1.0ms at 41, against a 33ms frame
   * budget - so a rope scrubs and animates like everything else.
   *
   * Ropes are grouped by node first. `createSetCurves` replaces ALL curves on a node, so a node
   * carrying two open paths must have both rebuilt in one command or the second would erase the
   * first.
   */
  function ropeCommands(ctx, frameIndex) {
    var out = [];
    if (!ctx.ropesByNode) return out;
    var g = ctx.sdk;

    for (var n = 0; n < ctx.ropesByNode.length; n++) {
      var entry = ctx.ropesByNode[n];
      var poly = g.PolyCurve.create();
      var built = 0;

      for (var r = 0; r < entry.ropes.length; r++) {
        var rope = entry.ropes[r];
        var poses = [];
        for (var l = 0; l < rope.links.length; l++) {
          poses.push(GR.poseAt(ctx.frames, frameIndex, rope.links[l].frameIndex));
        }
        var pts = GR.polylineFromPoses(poses, rope.halfLength);
        if (pts.length < 4) continue;
        // The solver's link count is capped for stability; the drawn curve is not, so the rope
        // reads as a rope rather than as a faceted chain.
        pts = GR.smoothPolyline(pts, ctx.ropeSmoothing || 6);

        var cb = g.CurveBuilder.create();
        cb.beginXY(pts[0], pts[1]);
        for (var k = 2; k < pts.length; k += 2) cb.lineToXY(pts[k], pts[k + 1]);
        poly.addCurve(cb.createCurve());
        built++;
      }

      if (!built) continue;
      try {
        out.push(g.DocumentCommand.createSetCurves(entry.node.curvesInterface, poly));
      } catch (e) { /* a rope that will not rebuild must not stop the rest */ }
    }
    return out;
  }

  /**
   * Prepares playback for a finished simulation.
   *
   * `bodies` must be in the SAME order as the recording, because poses are addressed by index.
   */
  function prepare(doc, bodies, frames, ropes) {
    var sdk = loadSdk();

    for (var i = 0; i < bodies.length; i++) {
      // Poses are addressed by index into the recording, and a rope's links are in there too.
      bodies[i].frameIndex = i;

      // A rope link must NOT get a selection: it is drawn by rewriting its node's geometry, and
      // transforming that node as well would move the rope twice.
      var node = bodies[i].isRopeLink ? null : (bodies[i].node || (bodies[i].object && bodies[i].object.node));
      if (!node) { bodies[i].selection = null; continue; }
      var sel = sdk.Selection.createEmpty(doc);
      sel.addNode(node);
      bodies[i].selection = sel;
    }

    // createSetCurves replaces every curve on a node, so ropes sharing a node rebuild together.
    var byNode = [];
    for (var r = 0; r < (ropes || []).length; r++) {
      var rope = ropes[r];
      if (!rope || !rope.node) continue;
      var entry = null;
      for (var e = 0; e < byNode.length; e++) {
        if (byNode[e].node === rope.node) { entry = byNode[e]; break; }
      }
      if (!entry) { entry = { node: rope.node, ropes: [] }; byNode.push(entry); }
      entry.ropes.push(rope);
    }

    return {
      doc: doc, sdk: sdk, bodies: bodies, frames: frames,
      ropesByNode: byNode,
      lastIndex: frames.frameCount - 1
    };
  }

  /** Shows one frame as a preview. Previews replace one another, so scrubbing costs nothing. */
  function preview(ctx, frameIndex) {
    var idx = Math.max(0, Math.min(ctx.lastIndex, Math.round(frameIndex)));
    var cmd = commandForFrame(ctx, idx);
    if (cmd) ctx.doc.executeCommand(cmd, true);
    return idx;
  }

  /** Commits one frame as a single undoable step. */
  function commit(ctx, frameIndex) {
    var idx = Math.max(0, Math.min(ctx.lastIndex, Math.round(frameIndex)));
    var cmd = commandForFrame(ctx, idx);
    if (cmd) ctx.doc.executeCommand(cmd, false);
    return idx;
  }

  function clear(ctx) {
    try { ctx.doc.clearPreviews(); } catch (e) { /* nothing previewed */ }
  }

  /**
   * Plays the recording on canvas at 30fps, then calls `onDone`.
   *
   * physicsdrop animated WHILE solving, so its frame rate was whatever the solver could manage and a
   * heavy scene crawled. v2 solves the whole drop first — a few hundred milliseconds — and replays
   * it from the recording, so playback runs at a steady 30fps no matter how expensive the physics
   * was, and rewatching costs nothing.
   *
   * Nothing is committed here: every frame is a preview that supersedes the last, so the document
   * is untouched until the Finished dialog resolves.
   */
  function play(ctx, opts, onDone) {
    var o = opts || {};
    var timers = require('/timers');
    var frame = 0;
    var stopped = false;
    var step = o.frameStep || 1;

    function finish() {
      if (stopped) return;
      stopped = true;
      try { timers.Timer.cancelAll(); } catch (e) { /* already gone */ }
      if (onDone) onDone();
    }

    timers.setInterval(o.intervalMs || 33, function (err) {
      if (stopped) return;
      if (err) { finish(); return; }
      try {
        preview(ctx, frame);
        frame += step;
        if (frame > ctx.lastIndex) finish();
      } catch (e) {
        // A failed frame must not leave a timer running forever.
        finish();
      }
    });

    return { cancel: finish };
  }

  /**
   * The finished dialog: a frame slider that scrubs the drop on canvas.
   *
   * OK keeps the frame being viewed, Cancel keeps the settled result — the same contract as physicsdrop,
   * because a drop that looked best mid-tumble is a legitimate thing to want, and landing back on
   * the original layout by accident is not.
   */
  function showScrubber(ctx, opts) {
    var o = opts || {};
    var dialogMod = require('/dialog');
    var Dialog = dialogMod.Dialog;
    var DialogResult = dialogMod.DialogResult;
    var UnitType = dialogMod.UnitType;

    var last = ctx.lastIndex;
    var secs = ((last + 1) / 30).toFixed(1);

    var dlg = Dialog.create(o.title || 'Gravity — Finished');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();
    var grp = col.addGroup('Replay');

    var frameCtl = grp.addUnitValueEditor('Frame', UnitType.Number, UnitType.Number, last, 0, last);
    frameCtl.setShowPopupSlider(true);
    frameCtl.precision = 0;
    // One line, not three. Each full-width static text costs real dialog height, and the panel had
    // grown tall enough that the buttons at the bottom were hard to reach.
    grp.addStaticText('', (last + 1) + ' frames, ' + secs + 's @ 30fps. OK keeps the frame shown; ' +
      'Cancel keeps the settled result.' +
      (ctx.frames.settledBy === 'quiescence'
        ? ' Some artwork started inside scenery, so the run ended when everything stopped rather ' +
          'than by sleeping.'
        : ctx.frames.settledBy === 'cap' ? ' The run hit its time limit before settling.' : ''))
      .setIsFullWidth(true);

    // Export is offered here rather than up front, because the sequence runs from the start of the
    // drop to the frame being viewed — which is not known until the user has scrubbed.
    var fmtCtl = null;
    if (o.offerExport) {
      var eg = col.addGroup('Export image sequence');
      fmtCtl = eg.addRadioGroup('Format', ['PNG', 'JPEG'], 0);
      eg.addStaticText('', 'OK exports frames 0-' + last + ' to your Desktop. Do not touch the ' +
        'document while it runs.').setIsFullWidth(true);
    }

    var shown = last;
    frameCtl.setOnValueChangedHandler(function () {
      try { shown = preview(ctx, frameCtl.value === undefined ? last : frameCtl.value); }
      catch (e) { /* a failed preview must not kill the dialog */ }
    });

    preview(ctx, last);   // open on the settled state

    var result = dlg.runModal();
    clear(ctx);

    var accepted = !!(result && result.value === DialogResult.Ok.value);
    var keep = accepted ? shown : last;
    commit(ctx, keep);

    return {
      frame: keep,
      accepted: accepted,
      // Only export on OK: Cancel means "keep the settled result", not "write 300 files".
      wantsExport: accepted && !!o.offerExport,
      jpeg: !!(fmtCtl && fmtCtl.selectedIndex === 1)
    };
  }

  GR.playbackPlay = play;
  GR.playbackPrepare = prepare;
  GR.playbackCommandForFrame = commandForFrame;
  GR.playbackPreview = preview;
  GR.playbackCommit = commit;
  GR.playbackClear = clear;
  GR.showScrubber = showScrubber;

})(GR);
