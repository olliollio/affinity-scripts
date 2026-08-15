/**
 * ui.js — the settings dialog.
 *
 * Control shapes are taken from physicsdrop, which is known to render correctly: `addUnitValueEditor`
 * with `UnitType.Number` plus `setShowPopupSlider(true)` and `precision = 0`.
 *
 * Gravity is expressed in DOCUMENT units per second squared rather than sim units, because that is
 * the number the user can reason about — it is the same scale their artwork is measured in. The
 * divide by the world scale happens here, once, at the boundary.
 */

(function (GR) {
  'use strict';

  var DEFAULTS = {
    gravity: 1000,     // pt/s^2 — 10 sim units/s^2 at the default world scale
    angle: 0,          // 0 = down, 90 = right, matching physicsdrop
    bounce: 15,        // %
    friction: 40,      // %
    seconds: 10,
    seed: 1,
    slack: 0        // % - a straight rope has no spare length, so drape is opt-in
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

    var dlg = Dialog.create('Gravity');
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
    //
    // Checkbox labels must fit ONE line. The control sits in a narrow right-hand column and the
    // row height is fixed, so a label that wraps is simply clipped — it cannot be read at all.
    // Anything longer than about "Keep groups as one object" belongs in the help text below, which
    // is full width and wraps properly.
    var equaliseCtl = mat.addCheckBox('Equalise mass', false);
    // Rope slack lives with Material rather than Simulation because it is a property of the rope,
    // not of the world. A rope drawn as a straight line has length exactly equal to the gap between
    // its ends, so a correctly simulated one has nothing spare and cannot drape - it needs to be
    // told it is longer than it looks.
    var slackCtl = mat.addUnitValueEditor('Rope slack %', UnitType.Number, UnitType.Number, d.slack, 0, 100);
    slackCtl.setShowPopupSlider(true); slackCtl.precision = 0;

    var beh = col.addGroup('Objects');
    var convertCtl = beh.addCheckBox('Split text into letters', false);
    var groupCtl = beh.addCheckBox('Keep groups as one object', false);
    var exportCtl = beh.addCheckBox('Export image sequence', false);
    // A dry run stops after the console report, before playback and before anything is written.
    // It exists because comparing two runs is only meaningful if neither run altered the artwork
    // the next one reads — an ordinary run ends by keeping a frame, so the second run of a pair
    // would be measuring the first one's output.
    var dryCtl = beh.addCheckBox('Dry run, report only', false);

    var help = col.addGroup('How to use');
    help.addStaticText('', 'Select objects and run. Name an object or group "collider", "wall", ' +
      '"floor", "ramp" or "ground" — or lock it — to make it scenery that never moves.').setIsFullWidth(true);
    help.addStaticText('', 'Live text drops as one piece. "Split text into letters" converts it to ' +
      'curves first so each letter falls on its own — that changes the document.').setIsFullWidth(true);
    help.addStaticText('', 'Equalise mass stops big artwork bulldozing small artwork. Export writes ' +
      'a 30fps sequence to your Desktop.').setIsFullWidth(true);
    help.addStaticText('', 'The drop plays on canvas, then you can scrub to any frame. It is one ' +
      'undo step. The same seed always gives the same result.').setIsFullWidth(true);
    help.addStaticText('', 'Dry run writes the report to the console and stops there — nothing ' +
      'plays, nothing is exported and the document is not touched.').setIsFullWidth(true);

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
      ropeSlack: Math.max(0, Math.min(1, (slackCtl.value === undefined ? d.slack : slackCtl.value) / 100)),
      seed: Math.max(1, Math.round(seedCtl.value || d.seed)),
      groupsAsOneBody: !!groupCtl.value,
      convertText: !!convertCtl.value,
      exportSequence: !!exportCtl.value,
      dryRun: !!dryCtl.value,
      // Duration in seconds is a frame count at the recorded rate. Reading GR.FPS rather than a
      // literal is what stops this drifting when the recording rate changes — it was 30 here and
      // in four other places, and the duration control would have silently halved.
      maxFrames: Math.round(secs * GR.FPS)
    };
  }

  GR.gravityVector = gravityVector;
  GR.showSettings = showSettings;
  GR.UI_DEFAULTS = DEFAULTS;

})(GR);
