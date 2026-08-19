/**
 * ui.js — the settings dialog. One slider.
 *
 * Control shapes are taken from gravity's ui.js, which is known to render: addUnitValueEditor with
 * UnitType.Number, setShowPopupSlider(true), precision 0.
 *
 * The dialog does NOT scroll. Once it outgrows the screen the OK and Cancel buttons move off the
 * bottom and it cannot be dismissed at all, so every control and every full-width help paragraph is
 * spent against that budget. One slider and one line of help is the whole budget here.
 */
(function (GR) {
  'use strict';

  // 100% doubles the LOCAL THICKNESS: a slab of width w has t = w and both of its facing boundary
  // points move out by amount*t/2, so it ends up 2w across. Scale-free by construction — the same
  // percentage means the same thing on a 20pt letter and a 2000pt shape.
  var DEFAULT_PCT = 30;

  function showSettings() {
    var mod = require('/dialog');
    var Dialog = mod.Dialog, DialogResult = mod.DialogResult, UnitType = mod.UnitType;

    var dlg = Dialog.create('Inflate');
    dlg.initialWidth = 480;
    var col = dlg.addColumn();
    var grp = col.addGroup('Inflation');
    var ctl = grp.addUnitValueEditor('Inflate %', UnitType.Number, UnitType.Number, DEFAULT_PCT, 0, 100);
    ctl.setShowPopupSlider(true);
    ctl.precision = 0;
    // What the label "Inflate %" cannot say: growth follows LOCAL thickness (so a fat body swells
    // and a thin arm barely moves), what a corner does (a bisector move only delivers cos(45) of
    // itself perpendicular to each edge, so a corner falls SHORT of the flat-wall doubling — that
    // shortfall is the pinched-corner look, not a bug in it), and the one input that silently does
    // nothing: live shapes (need Convert to Curves first — inflate only ever moves curve anchors).
    //
    // addStaticText on the GROUP, not addText on the column: there is no addText, and calling it
    // throws before the dialog ever appears. setIsFullWidth is a METHOD - the isFullWidth property
    // is listed in the API but the setter is the form that works - and addStaticText returns the
    // control so it chains. Kept in the slider's own group rather than a second one, because a
    // group header costs height and this panel cannot scroll.
    grp.addStaticText('', 'Grows each shape by the room inside it: a fat body swells, a thin arm ' +
      'barely moves, and corners stay pinched rather than rounding off. 100% doubles the ' +
      'thickness across a flat span. Live shapes are skipped unchanged — Convert to Curves ' +
      'first. Re-run to compound; undo to dial back.').setIsFullWidth(true);

    // Compare through .value. Some builds return a DialogResult whose identity does not match the
    // enum member, and there the direct comparison reads every OK as a Cancel - the dialog closes
    // and nothing happens, with no error to explain it. Comparing .value is correct on both.
    var result = dlg.runModal();
    if (!result || result.value !== DialogResult.Ok.value) return null;
    return { amount: Math.max(0, Math.min(100, ctl.value)) / 100 };
  }

  GR.inflShowSettings = showSettings;
  GR.INFL_DEFAULT_PCT = DEFAULT_PCT;

})(GR);
