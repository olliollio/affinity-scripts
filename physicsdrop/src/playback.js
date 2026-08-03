/**
 * playback.js — recorded frames back onto the canvas. Touches the Affinity API.
 *
 * Ported from v1.1, whose preview/scrub/commit dance is known to work. The parts that carry over
 * unchanged are deliberate: `executeCommand(cmd, true)` previews and replaces the previous
 * preview, `executeCommand(cmd, false)` commits one undoable step, and `clearPreviews()` drops
 * anything uncommitted. That behaviour is what makes scrubbing cheap — each slider move is one
 * preview that supersedes the last, not an undo stack to unwind.
 *
 * ── Rotation sign, the one thing to watch ─────────────────────────────────────
 * v1.1 solved directly in Affinity's y-down space and applied its body angle straight to
 * `Transform.createRotate`, and it looked right on canvas. v2 solves in planck's y-up space and
 * `PD.bodyState` already negates the angle on the way out, so the value reaching this module is
 * in the SAME convention v1.1 used. That is why no further negation happens here. If a first run
 * shows objects counter-rotating against the simulation, this is the line to flip — and only
 * this line, because nothing else touches rotation.
 */

(function (PD) {
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
      var pose = PD.poseAt(ctx.frames, frameIndex, i);

      // around() mutates its receiver, which is fine on a Transform we just created and own.
      var rot = g.Transform.createRotate(pose.angle - (b.angle0 || 0)).around(b.ox, b.oy);
      var xf = g.Transform.createTranslate(pose.x - b.ox, pose.y - b.oy).multiply(rot);
      cc.addCommand(g.DocumentCommand.createTransform(b.selection, xf, { mergeable: false }));
      any = true;
    }
    return any ? cc.createCommand() : null;
  }

  /** Gathers the SDK pieces once, so a missing module fails here rather than mid-scrub. */
  function loadSdk() {
    var geometry = require('/geometry');
    var commands = require('/commands');
    var selections = require('/selections');
    return {
      Transform: geometry.Transform,
      DocumentCommand: commands.DocumentCommand,
      CompoundCommandBuilder: commands.CompoundCommandBuilder,
      Selection: selections.Selection
    };
  }

  /**
   * Prepares playback for a finished simulation.
   *
   * `bodies` must be in the SAME order as the recording, because poses are addressed by index.
   */
  function prepare(doc, bodies, frames) {
    var sdk = loadSdk();
    for (var i = 0; i < bodies.length; i++) {
      var node = bodies[i].node || (bodies[i].object && bodies[i].object.node);
      if (!node) { bodies[i].selection = null; continue; }
      var sel = sdk.Selection.createEmpty(doc);
      sel.addNode(node);
      bodies[i].selection = sel;
    }
    return { doc: doc, sdk: sdk, bodies: bodies, frames: frames, lastIndex: frames.frameCount - 1 };
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
   * v1.1 animated WHILE solving, so its frame rate was whatever the solver could manage and a
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
   * OK keeps the frame being viewed, Cancel keeps the settled result — the same contract as v1.1,
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

    var dlg = Dialog.create(o.title || 'Physics Drop — Finished');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();
    var grp = col.addGroup('Replay');

    var frameCtl = grp.addUnitValueEditor('Frame', UnitType.Number, UnitType.Number, last, 0, last);
    frameCtl.setShowPopupSlider(true);
    frameCtl.precision = 0;
    grp.addStaticText('', (last + 1) + ' frames (' + secs + 's @ 30fps). Drag the Frame slider to ' +
      'replay the drop on canvas. OK keeps the frame you are viewing; Cancel keeps the settled ' +
      'result.').setIsFullWidth(true);

    if (ctx.frames.settledBy !== 'sleep') {
      grp.addStaticText('', ctx.frames.settledBy === 'quiescence'
        ? 'Note: some artwork started inside static geometry, so the run ended once everything ' +
          'stopped moving rather than by the solver going to sleep.'
        : 'Note: the run hit its frame limit before settling.').setIsFullWidth(true);
    }

    // Export is offered here rather than up front, because the sequence runs from the start of the
    // drop to the frame being viewed — which is not known until the user has scrubbed.
    var fmtCtl = null;
    if (o.offerExport) {
      var eg = col.addGroup('Export image sequence');
      fmtCtl = eg.addRadioGroup('Format', ['PNG', 'JPEG'], 0);
      eg.addStaticText('', 'OK exports the drop from the start up to the frame you are viewing, ' +
        'as a 30fps sequence on your Desktop. Do not touch the document while it runs.').setIsFullWidth(true);
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

  PD.playbackPlay = play;
  PD.playbackPrepare = prepare;
  PD.playbackCommandForFrame = commandForFrame;
  PD.playbackPreview = preview;
  PD.playbackCommit = commit;
  PD.playbackClear = clear;
  PD.showScrubber = showScrubber;

})(PD);
