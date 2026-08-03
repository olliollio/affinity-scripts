/**
 * export.js — writes the drop out as a 30fps image sequence.
 *
 * Ported from v1.1, which exports successfully — so anything failing here is ours, not the SDK's.
 *
 * Two rules make the difference, both learned the hard way:
 *
 *   1. **Path separators.** A path joined with backslashes is refused by every `/fs` call and by
 *      `doc.export`. The backslash root Affinity hands out, with FORWARD slashes appended, works:
 *      `E:\USER\Desktop/PhysicsDrop_x/drop_0000.png`. Earlier probes concluded `/fs` was denied
 *      outright; they had simply joined with backslashes throughout.
 *   2. **Write where you created.** Export lands in a folder the script made itself. The Desktop
 *      root, an existing folder and an existing file are all refused even with forward slashes.
 *
 * So folder creation is not optional and there is no writing-flat fallback: without the folder
 * there is nowhere permitted to write, and pretending otherwise only produces a later failure.
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

  /** The filename for one frame. Zero padded, or a sequence sorts 1, 10, 11, 2 and imports wrong. */
  function frameName(f, ext) { return 'drop_' + pad(f, 4) + '.' + ext; }

  /**
   * Works out where files can actually be written.
   *
   * Returns a function mapping a frame number to a path, or an `error` explaining why nowhere is
   * writable. The subfolder is not a nicety: it is the only location the sandbox permits writing
   * to, and it also keeps the sequence alone in a directory, which is how it wants importing.
   */
  function resolveTarget(app, ext) {
    var desk;
    try { desk = app.userDesktopPath; }
    catch (e) { return { error: 'no Desktop path: ' + e }; }
    if (!desk) return { error: 'no Desktop path' };

    // Forward slashes, appended to a backslash Windows root. That mixed form is what works here -
    // `E:\USER\Desktop/PhysicsDrop_.../drop_0000.png` - while fully backslashed paths come back
    // PERMISSION_DENIED.
    var name = 'PhysicsDrop_' + stamp();
    var dir = desk + '/' + name;

    var note = '';
    var madeDir = false;
    try {
      var fsys = require('/fs');
      fsys.createDirectories(dir);
      // TRUTHY, not === true. /fs exports a PathType enum (Directory = 3), so isDirectory may well
      // answer with an enum or a number rather than a boolean, and a strict comparison then reads
      // a perfectly good folder as a failure.
      var isDir = fsys.isDirectory(dir);
      madeDir = !!isDir;
      note = 'isDirectory returned ' + (typeof isDir) + ' ' + String(isDir);
    } catch (e) {
      note = 'threw: ' + ((e && e.message) ? e.message : String(e));
      madeDir = false;
    }

    // No flat fallback. The Desktop ROOT is denied for export, so writing there is a guaranteed
    // failure dressed up as a graceful degradation - better to say the folder could not be made.
    if (!madeDir) {
      return { error: 'could not create the export folder ' + dir + ' (' + note + ')' };
    }

    return {
      path: function (f) { return dir + '/' + frameName(f, ext); },
      where: dir,
      folder: true,
      note: note
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
    // Real names from a live install: 'PNG' exists bare, but every JPEG preset is qualified -
    // 'JPEG (Best quality)', '(High quality)' and so on. There is no preset called just 'JPEG'.
    names = names.concat(useJpeg ? ['JPEG (Best quality)', 'JPEG (High quality)'] : ['PNG']);

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
  PD.exportFrameName = frameName;

})(PD);
