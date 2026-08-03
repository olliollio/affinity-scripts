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
    // Not a density slider. One global density multiplies every mass equally, which leaves every
    // mass RATIO unchanged, and contact response depends only on ratios - so it is provably a
    // no-op. What actually bites is that mass grows with area, so a placed photo outweighs a
    // letter by around 90x and bulldozes it.
    var equaliseCtl = mat.addCheckBox('Equalise mass', false);
    mat.addStaticText('', 'On: every object weighs the same regardless of size, so big artwork ' +
      'stops bulldozing small artwork. Off: real physics, where area decides weight.').setIsFullWidth(true);

    var beh = col.addGroup('Objects');
    var convertCtl = beh.addCheckBox('Convert text to curves', false);
    beh.addStaticText('', 'Live text is skipped. Tick this to convert it to curves first so it ' +
      'drops as letters. This changes the document, as its own undo step.').setIsFullWidth(true);
    var groupCtl = beh.addCheckBox('Keep groups as one object', false);
    beh.addStaticText('', 'Off: every object in a group drops on its own, so a word tumbles as ' +
      'letters. On: the group falls as one rigid piece.').setIsFullWidth(true);

    var help = col.addGroup('How to use');
    help.addStaticText('', 'Select objects and run. Live text is skipped unless you tick "Convert ' +
      'text to curves" above.').setIsFullWidth(true);
    help.addStaticText('', 'Name an object or a GROUP "collider", "wall", "floor", "ramp" or ' +
      '"ground", or lock it, ' +
      'to make it solid scenery that never moves — everything inside a named group counts too. ' +
      'Scenery follows its true outline, holes included.').setIsFullWidth(true);
    help.addStaticText('', 'The drop plays once on canvas, then a Finished dialog lets you scrub to any frame. ' +
      'The whole thing is a single undo step.').setIsFullWidth(true);
    help.addStaticText('', 'Seed makes a drop reproducible: the same seed and settings always give the same ' +
      'result.').setIsFullWidth(true);
    help.addStaticText('', ' ').setIsFullWidth(true);

    var result = dlg.runModal();
    if (!result || result.value !== DialogResult.Ok.value) return null;

    var secs = Math.max(1, secsCtl.value || d.seconds);

    // The magnitude and angle travel as-is. The world scale is not known yet - it is chosen from
    // the artwork - and gravity divides by it, so the vector is built later, once.
    return {
      gravityMagnitude: Math.max(100, gravityCtl.value || d.gravity),
      gravityAngle: angleCtl.value === undefined ? d.angle : angleCtl.value,
      restitution: Math.min(0.95, Math.max(0, (bounceCtl.value === undefined ? d.bounce : bounceCtl.value) / 100)),
      friction: Math.max(0, (frictionCtl.value === undefined ? d.friction : frictionCtl.value) / 100),
      equaliseMass: !!equaliseCtl.value,
      seed: Math.max(1, Math.round(seedCtl.value || d.seed)),
      groupsAsOneBody: !!groupCtl.value,
      convertText: !!convertCtl.value,
      // The recording is 30fps, so duration in seconds is a frame count.
      maxFrames: Math.round(secs * 30)
    };
  }

  PD.gravityVector = gravityVector;
  PD.showSettings = showSettings;
  PD.UI_DEFAULTS = DEFAULTS;

})(PD);
