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

  // ── The interval to ask setInterval for. Do NOT round this to a "nicer" number. ──────────────
  //
  // Affinity's timer does not deliver the interval requested. It delivers the next whole multiple
  // of a ~15.4ms quantum — the host scheduler tick, 64.9Hz — having rounded the request UP.
  // Measured with an empty callback, 40 ticks each (probes/probe_timer_floor.js):
  //
  //     asked   1ms -> 15.3ms    asked  16ms -> 30.5ms    asked  50ms ->  61.6ms
  //     asked   8ms -> 15.5ms    asked  33ms -> 46.2ms    asked 100ms -> 107.8ms
  //
  // Every one of those is n x 15.4. The consequence is a cliff, not a slope: this used to ask for
  // 33ms, which is one millisecond past two quanta, so it got THREE — 46.2ms, 21.6fps, for a
  // recording that was itself only 30fps. Asking for 8ms gets one quantum and 64.6fps.
  //
  // 16 would be the worst possible choice, and the obvious one: 0.6ms over a quantum, rounded to
  // two, half the frame rate. 8 sits in the middle of a quantum, so no drift in either direction
  // can push it over.
  //
  // Drawing is not the constraint and never was. A full 193-point rope submits in 0.7ms against a
  // 15.4ms quantum, and 60 ticks at 8ms measured sd 0.5ms with zero bursts — the timer paces the
  // loop rather than the loop outrunning the timer.
  var FRAME_MS = 8;

  // What the above actually delivers, for anything that needs to convert frames to seconds. The
  // recording is GR.FPS (60), so playback runs about 8% fast. That is the price of a quantum grid
  // that has no multiple at 16.7ms, and it is well worth paying against 21.6fps.
  var PLAYBACK_MS = 15.4;

  // ── How long to wait after playback before opening the Finished panel. ───────────────────────
  //
  // This is not a cosmetic pause. A modal opened from INSIDE the playback interval callback never
  // appears at all: `runModal` does not return, and reports ABORTED (errorCode 6) only when
  // Affinity shuts down. The app is then holding a modal it never drew — the Script panel stops
  // responding and every later `runModal` fails with INVALID_OP until Affinity is restarted.
  //
  // The timer shape is not the culprit. A modal raised from a trivial interval callback, cancel
  // included, opens fine — probes/probe_modal_from_timer.js still asks that question, four ways.
  // Nor is it the live previews: clearing every one of them before the modal does not help. Nor the
  // panel's own controls: a bare modal opened from the same place does not appear either. Each of
  // those was a build of this script with one line changed, kept only long enough to answer.
  //
  // What breaks it is this callback's WORK. `intervalCallback` re-arms the timer BEFORE invoking
  // the callback (JSLib/timers.js:125-126), so once a preview costs more than the interval the
  // waits pile up, and the modal is raised into that backlog. It only ever showed on heavy scenes
  // because preview cost is the one thing here that scales with the artwork.
  //
  // 300 is the value that was verified end to end against the scene that failed. It is generous on
  // purpose: it is imperceptible after a drop that just played, and a smaller number would be
  // guessing against a backlog whose length depends on the scene.
  var HANDOFF_MS = 300;

  /**
   * Reports a failure that happens after the script's main body has already returned.
   *
   * Both channels, deliberately. The console is the useful one — it keeps the text, and it sits
   * next to the rest of the run's report. But this whole class of failure happens once `runModal`
   * is unavailable, and a console nobody opens is indistinguishable from nothing going wrong: the
   * modal bug above cost days precisely because it was silent. `app.alert` is the one channel that
   * was still working when Dialog was not, so it is what guarantees the user finds out at all.
   */
  function report(message) {
    try { console.log(message); } catch (e) { /* no console in this host */ }
    try { require('/application').app.alert(message); } catch (e) { /* no alert either */ }
  }

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

    // Softbodies deform too, so they ride along the same way for the same reason.
    var softCmds = softCommands(ctx, frameIndex);
    for (var sc = 0; sc < softCmds.length; sc++) { cc.addCommand(softCmds[sc]); any = true; }

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
   * is cheap - measured at 0.7ms per rewrite at 193 points, against the 15.4ms budget FRAME_MS
   * explains above - so a rope scrubs and animates like everything else. Drawing has never been
   * what limits this; the requested timer interval was.
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

        // Then drop the points that the curve does not need. Smoothing multiplies 33 poses into
        // nearly 200 vertices, and every one of them became a node on the user's path. The
        // tolerance is a fraction of a point, so the drape is preserved to well under what any
        // output could show — a curve keeps its curvature and only a rope that genuinely ended up
        // straight collapses, because it is straight. Simplifying here, BEFORE the map back into
        // base space, keeps the tolerance in the units the physics ran in, for the same reason
        // smoothing does.
        var simpTol = ctx.ropeSimplifyTol === undefined ? 0.3 : ctx.ropeSimplifyTol;
        if (simpTol > 0 && GR.simplifyChain) pts = GR.simplifyChain(pts, simpTol);

        // Back into the node's own space. Applied AFTER smoothing so the curve is interpolated in
        // the space the physics ran in — an affine map commutes with Catmull-Rom, but a non-uniform
        // scale would still make "6 subdivisions" mean different things along each axis.
        if (entry.toBase) GR.transformRing(pts, entry.toBase);

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
   * Commands that rewrite each softbody's geometry for a frame.
   *
   * The two-dimensional sibling of ropeCommands, and for the same reason: a jelly DEFORMS, so no
   * transform can express it — every outline point moves on its own. Its rings are re-evaluated from
   * the mesh node poses and written with `createSetCurves`, which replaces a curve node's geometry
   * outright and works as a preview, so a jelly scrubs like everything else.
   *
   * Two things are deliberately NOT done here, both of which ropes do:
   *
   *  - nothing is smoothed. A rope interpolates because its solver link count is capped for
   *    stability and the drawn curve should not be a faceted chain. A jelly's outline is not built
   *    from its nodes, it is BOUND to them, so it already has whatever resolution the artwork had.
   *  - nothing is simplified. The rope tolerance exists to keep smoothing from dumping ~200 invented
   *    vertices onto the user's path. A jelly's outline IS the user's own points, so simplifying
   *    would only lose them — and frame 0 has to give the flattened rings back exactly.
   *
   * Softbodies are grouped by node first, exactly as ropes are: `createSetCurves` replaces ALL
   * curves on a node, so two jellies sharing one node must rebuild in one command.
   */
  function softCommands(ctx, frameIndex) {
    var out = [];
    if (!ctx.softsByNode) return out;
    var g = ctx.sdk;

    for (var n = 0; n < ctx.softsByNode.length; n++) {
      var entry = ctx.softsByNode[n];
      var poly = g.PolyCurve.create();
      var built = 0;

      for (var s = 0; s < entry.softs.length; s++) {
        var soft = entry.softs[s];
        var rings = soft.rings || [];
        if (!soft.mesh || !rings.length) continue;

        try {
          // Every ring of one softbody is driven by the same lattice, so the poses are gathered once
          // per body rather than once per ring.
          var positions = [];
          for (var p = 0; p < soft.nodes.length; p++) {
            var pose = GR.poseAt(ctx.frames, frameIndex, soft.nodes[p].frameIndex);
            positions.push(pose.x, pose.y);
          }

          for (var r = 0; r < rings.length; r++) {
            var pts = GR.evalSoftOutline(rings[r], soft.mesh, positions);
            if (pts.length < 6) continue;   // fewer than three points is not a ring

            // Back into the node's own space, AFTER evaluating — the binding was built in the space
            // the physics ran in, and so are the poses driving it.
            if (entry.toBase) GR.transformRing(pts, entry.toBase);

            var cb = g.CurveBuilder.create();
            cb.beginXY(pts[0], pts[1]);
            for (var k = 2; k < pts.length; k += 2) cb.lineToXY(pts[k], pts[k + 1]);
            // The real closing call, probed 2026-08-15. Repeating the first point instead builds a
            // curve that reports `isClosed false`: it draws closed but fills wrong, and `isClosed`
            // is read-only, so nothing downstream can repair it.
            cb.close();
            poly.addCurve(cb.createCurve());
            built++;
          }
        } catch (e) { /* one jelly that will not rebuild must not stop the rest */ }
      }

      if (!built) continue;
      try {
        out.push(g.DocumentCommand.createSetCurves(entry.node.curvesInterface, poly));
      } catch (e) { /* nor may a node that will not take curves */ }
    }
    return out;
  }

  /**
   * Prepares playback for a finished simulation.
   *
   * `bodies` must be in the SAME order as the recording, because poses are addressed by index.
   *
   * Each entry of `softs` describes one softbody to redraw:
   *
   *     { node, mesh, rings: [binding, ...], nodes: [bodyRecord, ...] }
   *
   * `mesh` is the rest lattice, `rings` are `GR.bindOutline` results — one per drawn ring — and
   * `nodes` are the body records driving it, in mesh node order. All three must be in SPREAD
   * points, the units poses come back in, because `softCommands` feeds the poses straight into
   * `evalSoftOutline` and converts nothing on the way. `softbody.js` keeps each node's rest position
   * in exactly those units as `ox`/`oy` for that reason.
   */
  function prepare(doc, bodies, frames, ropes, softs) {
    var sdk = loadSdk();

    for (var i = 0; i < bodies.length; i++) {
      // Poses are addressed by index into the recording, and a rope's links are in there too.
      bodies[i].frameIndex = i;

      // A rope link must NOT get a selection: it is drawn by rewriting its node's geometry, and
      // transforming that node as well would move the rope twice. A softbody's mesh nodes are the
      // same case — and worse, since there are hundreds of them all pointing at one node.
      var node = (bodies[i].isRopeLink || bodies[i].isSoftNode)
        ? null
        : (bodies[i].node || (bodies[i].object && bodies[i].object.node));
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
      if (!entry) {
        // Poses come back in SPREAD space, and createSetCurves writes into the node's BASE space.
        // The inverse of the node's own transform is what bridges them. Computed once per node
        // here rather than per frame, since nothing transforms a rope's node during playback.
        entry = { node: rope.node, ropes: [], toBase: GR.invertMatrix(GR.matrixOf(rope.node)) };
        byNode.push(entry);
      }
      entry.ropes.push(rope);
    }

    // Same grouping, same reason: two jellies on one node rebuild together or the second erases the
    // first. The inverse matrix is taken once per node here rather than per frame, since nothing
    // transforms a softbody's node during playback — the node is only ever redrawn.
    var softByNode = [];
    for (var s = 0; s < (softs || []).length; s++) {
      var soft = softs[s];
      if (!soft || !soft.node || !soft.nodes || !soft.nodes.length) continue;
      var se = null;
      for (var k = 0; k < softByNode.length; k++) {
        if (softByNode[k].node === soft.node) { se = softByNode[k]; break; }
      }
      if (!se) {
        se = { node: soft.node, softs: [], toBase: GR.invertMatrix(GR.matrixOf(soft.node)) };
        softByNode.push(se);
      }
      se.softs.push(soft);
    }

    return {
      doc: doc, sdk: sdk, bodies: bodies, frames: frames,
      ropesByNode: byNode,
      softsByNode: softByNode,
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
   * Plays the recording on canvas, then calls `onDone`.
   *
   * physicsdrop animated WHILE solving, so its frame rate was whatever the solver could manage and a
   * heavy scene crawled. v2 solves the whole drop first — a few hundred milliseconds — and replays
   * it from the recording, so playback runs at a steady rate no matter how expensive the physics
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
    var handle = null;

    function finish() {
      if (stopped) return;
      stopped = true;
      // Cancel OUR timer, not every timer in the script. Timer.cancelAll() was used here and works
      // only because nothing else is running; export drives its own timer the same way, and one of
      // them stopping must not silently kill the other.
      try { if (handle && handle.cancel) handle.cancel(); else timers.Timer.cancelAll(); }
      catch (e) { /* already gone */ }
      if (!onDone) return;

      // Hand the finish off to a fresh timer so THIS callback returns first. onDone opens a modal,
      // and a modal opened from inside this callback never appears at all — see HANDOFF_MS above
      // for why, and for what was ruled out before landing on it.
      //
      // The error is reported rather than swallowed. It used to vanish: finish() was called from
      // inside the interval callback's try, so a throw from onDone was caught by the catch, which
      // called finish() again, hit the `stopped` guard and returned. The one symptom that would
      // have named this bug on day one — a panel that failed loudly — was the one thing the code
      // made impossible.
      timers.setTimeout(HANDOFF_MS, function (timerErr) {
        if (timerErr) return;   // cancelled during the handoff; there is nothing left to finish
        try { onDone(); }
        catch (e) { report('gravity: the Finished panel could not open: ' + e); }
      });
    }

    handle = timers.setInterval(o.intervalMs || FRAME_MS, function (err) {
      if (stopped) return;
      // A cancelled timer reports ABORTED through this same callback. `stopped` already swallows
      // it, which matters: answering it with another cancel would take down any timer armed since.
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
    var secs = ((last + 1) / GR.FPS).toFixed(1);

    var dlg = Dialog.create(o.title || 'Gravity — Finished');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();
    var grp = col.addGroup('Replay');

    var frameCtl = grp.addUnitValueEditor('Frame', UnitType.Number, UnitType.Number, last, 0, last);
    frameCtl.setShowPopupSlider(true);
    frameCtl.precision = 0;
    // One line, not three. Each full-width static text costs real dialog height, and the panel had
    // grown tall enough that the buttons at the bottom were hard to reach.
    grp.addStaticText('', (last + 1) + ' frames, ' + secs + 's @ ' + GR.FPS + 'fps. OK keeps the frame shown; ' +
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
  GR.PLAYBACK_FRAME_MS = FRAME_MS;
  GR.PLAYBACK_ACTUAL_MS = PLAYBACK_MS;

})(GR);
