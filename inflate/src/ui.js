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
    // and a thin arm barely moves), what a notch does (stays pinched, does not swell shut), what an
    // outward corner does (grows past the flat-wall doubling, because two walls push it at once —
    // see the P' formula in inflate.js), and the two inputs that silently do nothing: live shapes
    // (need Convert to Curves first — inflate only ever moves curve anchors) and open paths (no
    // enclosed material to measure, copied through as drawn).
    col.addText('Grows each shape by the room inside it: a fat body swells, a thin arm barely ' +
                'moves, a notch stays pinched rather than closing up. 100% doubles the thickness ' +
                '— more at an outward corner, where two walls both push. Live shapes are skipped, ' +
                'left unchanged — Convert to Curves first. Re-run to compound; undo to dial back.');

    if (dlg.runModal() !== DialogResult.Ok) return null;
    return { amount: Math.max(0, Math.min(100, ctl.value)) / 100 };
  }

  GR.inflShowSettings = showSettings;
  GR.INFL_DEFAULT_PCT = DEFAULT_PCT;

})(GR);
