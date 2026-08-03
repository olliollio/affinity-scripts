/**
 * export.js — writes the drop out as a 30fps image sequence.
 *
 * Ported from v1.1, with one change forced by the sandbox: v1.1 created a timestamped output
 * folder with `fsys.createDirectories`, and `/fs` denies every path here (see
 * probes/probe_fs_permissions.js), so that call throws. `doc.export` is a DOCUMENT API rather than
 * a filesystem one, so it is tried regardless — and if the folder cannot be made, files are
 * written flat into the Desktop with a timestamped prefix instead of failing outright.
 *
 * Each frame is COMMITTED, exported, then undone. A preview is not guaranteed to render into an
 * export, which is why this cannot reuse the cheap preview path the scrubber uses.
 *
 * The loop runs on a timer rather than a `for` loop so the UI is not frozen for the duration, and
 * so a failure can stop cleanly instead of wedging Affinity.
 */

(function (PD) {
  'use strict';

  function pad(v, n) {
    var s = String(v);
    while (s.length < n) s = '0' + s;
    return s;
  }

  /** A timestamp that sorts, for folder and file names. */
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '_' +
           pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2);
  }

  /**
   * Works out where files can actually be written.
   *
   * Returns a function that maps a frame number to a path, plus a description of what was chosen.
   * The subfolder is preferred because a sequence is much easier to import when it is alone in a
   * directory; the flat fallback exists because folder creation needs `/fs`, which is denied.
   */
  function resolveTarget(app, ext) {
    var desk;
    try { desk = app.userDesktopPath; }
    catch (e) { return { error: 'no Desktop path: ' + e }; }
    if (!desk) return { error: 'no Desktop path' };

    var name = 'PhysicsDrop_' + stamp();
    var dir = desk + '/' + name;

    var madeDir = false;
    try {
      var fsys = require('/fs');
      fsys.createDirectories(dir);
      madeDir = fsys.isDirectory(dir) === true;
    } catch (e) {
      madeDir = false;   // /fs is denied; fall through to writing flat
    }

    if (madeDir) {
      return {
        path: function (f) { return dir + '/drop_' + pad(f, 4) + '.' + ext; },
        where: dir,
        folder: true
      };
    }
    return {
      path: function (f) { return desk + '/' + name + '_' + pad(f, 4) + '.' + ext; },
      where: desk + '/' + name + '_####.' + ext,
      folder: false
    };
  }

  /**
   * The export presets this install actually offers.
   *
   * `FileExportOptions` exposes both `allPresetNames` and `enumeratePresetNames`, and the shape of
   * neither is documented, so both are tried as property and as function. Preset names are exact
   * and case-sensitive — "PNG" is accepted where "png" is not — which makes asking far more
   * reliable than spelling guesses.
   */
  function presetNames(FileExportOptions) {
    var out = [];

    function absorb(v) {
      if (!v) return;
      if (typeof v === 'string') { out.push(v); return; }
      try {
        if (typeof v.length === 'number') {
          for (var i = 0; i < v.length; i++) {
            var item = (typeof v.at === 'function') ? v.at(i) : v[i];
            if (typeof item === 'string') out.push(item);
          }
          return;
        }
      } catch (e) { /* not indexable */ }
      try { for (var s of v) { if (typeof s === 'string') out.push(s); } } catch (e) { /* not iterable */ }
    }

    try { absorb(FileExportOptions.allPresetNames); } catch (e) { /* not a property */ }
    if (!out.length) {
      try { absorb(FileExportOptions.allPresetNames()); } catch (e) { /* not a function */ }
    }
    if (!out.length) {
      try { absorb(FileExportOptions.enumeratePresetNames()); } catch (e) { /* not argless */ }
    }
    if (!out.length) {
      // Callback form, which is how the SDK enumerates elsewhere.
      try { FileExportOptions.enumeratePresetNames(function (n) { if (typeof n === 'string') out.push(n); }); }
      catch (e) { /* give up; the caller falls back to guesses */ }
    }
    return out;
  }

  /**
   * Exports frames 0..lastFrame of a prepared playback context.
   *
   * `ctx` is what `PD.playbackPrepare` returns. The document is left showing `keepFrame`, which is
   * whatever the user chose in the scrubber, so exporting never changes the result they accepted.
   */
  function exportSequence(ctx, opts, onDone) {
    var o = opts || {};
    var app, timers;
    try {
      app = require('/application').app;
      timers = require('/timers');
    } catch (e) {
      if (onDone) onDone({ ok: false, error: 'modules unavailable: ' + e });
      return;
    }

    // v1.1 imports both classes from /document and calls them exactly as this does, so the failure
    // is not a porting mistake and the classes may simply live elsewhere now. Cheaper to look than
    // to assume.
    var FileExportOptions = null, FileExportArea = null, foundIn = null;
    var MODULES = ['/document', '/documents', '/export', '/exports', '/files', '/io'];
    for (var mi = 0; mi < MODULES.length && !FileExportOptions; mi++) {
      try {
        var mod = require(MODULES[mi]);
        if (mod && mod.FileExportOptions && mod.FileExportArea) {
          FileExportOptions = mod.FileExportOptions;
          FileExportArea = mod.FileExportArea;
          foundIn = MODULES[mi];
        }
      } catch (e) { /* module absent */ }
    }
    if (!FileExportOptions) {
      if (onDone) onDone({
        ok: false,
        error: 'FileExportOptions / FileExportArea were not found in ' + MODULES.join(', ') +
               '. Run probes/probe_export.js to find where this Affinity build keeps them.'
      });
      return;
    }

    var useJpeg = !!o.jpeg;
    var ext = useJpeg ? 'jpg' : 'png';
    var target = resolveTarget(app, ext);
    if (target.error) {
      if (onDone) onDone({ ok: false, error: target.error });
      return;
    }

    // Preset names are exact and case-sensitive: "PNG" is accepted while "png", "JPEG" and every
    // other spelling probed is rejected. Guessing them was the wrong approach - FileExportOptions
    // can list its own, so ask it and match, and fall back to guesses only if it will not say.
    var available = presetNames(FileExportOptions);
    var wanted = useJpeg ? /jpe?g/i : /png/i;

    var names = [];
    if (o.presetName) names.push(o.presetName);
    for (var av = 0; av < available.length; av++) {
      if (wanted.test(available[av])) names.push(available[av]);
    }
    // Whatever the install offers, in preference order, then the historical guesses.
    names = names.concat(useJpeg ? ['JPEG', 'JPG', 'jpeg'] : ['PNG', 'png']);

    var exportOpts = null, usedPreset = null, presetErr = null;
    for (var p = 0; p < names.length && !exportOpts; p++) {
      try {
        var candidate = FileExportOptions.createWithPresetName(names[p]);
        if (candidate) { exportOpts = candidate; usedPreset = names[p]; }
      } catch (e) {
        presetErr = (e && e.message) ? e.message : String(e);
      }
    }
    if (!exportOpts) {
      if (onDone) onDone({
        ok: false,
        error: 'no export preset was accepted (tried ' + names.join(', ') + '); last error: ' + presetErr +
               '. Run probes/probe_export.js to discover the preset names this install uses.'
      });
      return;
    }

    var exportArea = null;
    var areaAttempts = [
      ['createForCurrentSpread', function () { return FileExportArea.createForCurrentSpread(); }],
      ['createForDocument', function () { return FileExportArea.createForDocument(); }],
      ['createForSelection', function () { return FileExportArea.createForSelection(); }]
    ];
    var areaErr = null;
    for (var q = 0; q < areaAttempts.length && !exportArea; q++) {
      try { exportArea = areaAttempts[q][1](); } catch (e) {
        areaErr = areaAttempts[q][0] + ': ' + ((e && e.message) ? e.message : String(e));
      }
    }
    if (!exportArea) {
      if (onDone) onDone({ ok: false, error: 'no export area could be made (' + areaErr + ')' });
      return;
    }

    var last = o.lastFrame === undefined ? ctx.lastIndex : Math.min(o.lastFrame, ctx.lastIndex);
    var keepFrame = o.keepFrame === undefined ? last : o.keepFrame;

    // The scrubber has already committed a frame. That commit has to come off before replaying
    // from the start, or every exported frame would be a delta on top of it.
    var undone = false;
    var frame = 0;
    var written = 0;
    var finished = false;

    function stop(result) {
      if (finished) return;
      finished = true;
      try { timers.Timer.cancelAll(); } catch (e) { /* already gone */ }
      // Always leave the document on the frame the user accepted, whatever happened.
      try { PD.playbackCommit(ctx, keepFrame); } catch (e) { /* nothing more to do */ }
      if (onDone) onDone(result);
    }

    timers.setInterval(o.intervalMs || 5, function (err) {
      if (finished) return;
      if (err) { stop({ ok: false, error: 'timer error: ' + err, written: written }); return; }

      try {
        if (!undone) {
          undone = true;
          try { ctx.doc.undo(); } catch (e) { /* nothing committed yet */ }
        }

        if (frame > last) {
          stop({ ok: true, written: written, where: target.where, folder: target.folder, preset: usedPreset, module: foundIn });
          return;
        }

        PD.playbackCommit(ctx, frame);
        ctx.doc.export(target.path(frame), exportOpts, exportArea);
        written++;
        try { ctx.doc.undo(); } catch (e) { /* keep going; the next commit is absolute anyway */ }
        frame++;
      } catch (e) {
        stop({
          ok: false,
          error: 'failed at frame ' + frame + ': ' + (e && e.message ? e.message : e),
          written: written,
          where: target.where
        });
      }
    });
  }

  PD.exportSequence = exportSequence;
  PD.exportStamp = stamp;
  PD.exportResolveTarget = resolveTarget;

})(PD);
