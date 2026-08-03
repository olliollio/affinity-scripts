/**
 * ui.js — the settings dialog.
 *
 * Control shapes are taken from v1.1, which is known to render correctly: `addUnitValueEditor`
 * with `UnitType.Number` plus `setShowPopupSlider(true)` and `precision = 0`.
 *
 * Gravity is expressed in DOCUMENT units per second squared rather than sim units, because that is
 * the number the user can reason about — it is the same scale their artwork is measured in. The
 * divide by the world scale happens here, once, at the boundary.
 */

(function (PD) {
  'use strict';

  var DEFAULTS = {
    gravity: 1000,     // pt/s^2 — 10 sim units/s^2 at the default world scale
    angle: 0,          // 0 = down, 90 = right, matching v1.1
    bounce: 15,        // %
    friction: 40,      // %
    density: 1,
    seconds: 10,
    seed: 1
  };

  /**
   * Gravity from a magnitude and a compass angle, in SIM units.
   *
   * Angle 0 means down the page. Affinity's y axis points down and planck's points up, so the
   * vertical component is negated on the way through — the same flip world.js applies to geometry,
   * applied here to acceleration.
   */
  function gravityVector(magnitudePt, angleDeg, scale) {
    var rad = ((angleDeg || 0) % 360) * Math.PI / 180;
    var g = magnitudePt / scale;
    return { x: g * Math.sin(rad), y: -g * Math.cos(rad) };
  }

  /**
   * Shows the settings dialog. Returns null when the user cancels.
   *
   * Percentages are converted to the engine's 0..1 here so that nothing downstream has to know the
   * dialog exists.
   */
  function showSettings(opts) {
    var o = opts || {};
    var d = DEFAULTS;
    var mod = require('/dialog');
    var Dialog = mod.Dialog, DialogResult = mod.DialogResult, UnitType = mod.UnitType;

    var dlg = Dialog.create('Physics Drop');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();

    var sim = col.addGroup('Simulation');
    var gravityCtl = sim.addUnitValueEditor('Gravity', UnitType.Number, UnitType.Number, d.gravity, 100, 10000);
    gravityCtl.setShowPopupSlider(true); gravityCtl.precision = 0;
    var angleCtl = sim.addUnitValueEditor('Angle (0=down 90=right)', UnitType.Number, UnitType.Number, d.angle, 0, 360);
    angleCtl.setShowPopupSlider(true); angleCtl.precision = 0;
    var secsCtl = sim.addUnitValueEditor('Max duration (s)', UnitType.Number, UnitType.Number, d.seconds, 1, 30);
    secsCtl.setShowPopupSlider(true); secsCtl.precision = 0;
    var seedCtl = sim.addUnitValueEditor('Seed', UnitType.Number, UnitType.Number, d.seed, 1, 9999);
    seedCtl.setShowPopupSlider(true); seedCtl.precision = 0;

    var mat = col.addGroup('Material');
    var bounceCtl = mat.addUnitValueEditor('Bounciness %', UnitType.Number, UnitType.Number, d.bounce, 0, 95);
    bounceCtl.setShowPopupSlider(true); bounceCtl.precision = 0;
    var frictionCtl = mat.addUnitValueEditor('Friction %', UnitType.Number, UnitType.Number, d.friction, 0, 150);
    frictionCtl.setShowPopupSlider(true); frictionCtl.precision = 0;
    var densityCtl = mat.addUnitValueEditor('Density', UnitType.Number, UnitType.Number, d.density, 0.1, 10);
    densityCtl.setShowPopupSlider(true); densityCtl.precision = 1;

    var help = col.addGroup('How to use');
    help.addStaticText('', 'Select objects and run. Text must be converted to curves first — a live text ' +
      'frame is skipped, because Affinity only exposes one glyph of it.').setIsFullWidth(true);
    help.addStaticText('', 'Name an object "wall", "floor", "ramp" or "ground", or lock its layer, to make it ' +
      'solid scenery that never moves. Objects follow their true outline, holes included.').setIsFullWidth(true);
    help.addStaticText('', 'The drop plays once on canvas, then a Finished dialog lets you scrub to any frame. ' +
      'The whole thing is a single undo step.').setIsFullWidth(true);
    help.addStaticText('', 'Seed makes a drop reproducible: the same seed and settings always give the same ' +
      'result.').setIsFullWidth(true);
    help.addStaticText('', ' ').setIsFullWidth(true);

    var result = dlg.runModal();
    if (!result || result.value !== DialogResult.Ok.value) return null;

    var scale = o.scale || PD.WORLD_SCALE;
    var g = gravityVector(
      Math.max(100, gravityCtl.value || d.gravity),
      angleCtl.value === undefined ? d.angle : angleCtl.value,
      scale);

    var secs = Math.max(1, secsCtl.value || d.seconds);

    return {
      scale: scale,
      gravityX: g.x,
      gravityY: g.y,
      restitution: Math.min(0.95, Math.max(0, (bounceCtl.value === undefined ? d.bounce : bounceCtl.value) / 100)),
      friction: Math.max(0, (frictionCtl.value === undefined ? d.friction : frictionCtl.value) / 100),
      density: Math.max(0.1, densityCtl.value || d.density),
      seed: Math.max(1, Math.round(seedCtl.value || d.seed)),
      // The recording is 30fps, so duration in seconds is a frame count.
      maxFrames: Math.round(secs * 30)
    };
  }

  PD.gravityVector = gravityVector;
  PD.showSettings = showSettings;
  PD.UI_DEFAULTS = DEFAULTS;

})(PD);
