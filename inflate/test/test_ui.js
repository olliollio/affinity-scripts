/**
 * test_ui.js — the dialog, against a stub that offers ONLY the documented control surface.
 *
 * A dialog cannot be asserted for looks, but it can be asserted for API: every method it calls has
 * to exist on the object it is called on. The stub below therefore defines exactly the controls the
 * SDK reference documents and nothing else, so a call to a method that does not exist fails here
 * with the same TypeError Affinity would raise — which is how `col.addText is not a function`
 * reached a real run and cost a round trip.
 *
 * It also pins the two things that fail SILENTLY rather than loudly: the runModal comparison (some
 * builds return a result whose identity does not match the enum member, and there a direct
 * comparison reads every OK as a Cancel, so the dialog closes and nothing happens with no error to
 * explain it), and the percent-to-fraction conversion.
 */
'use strict';

module.exports = function (GR, h) {
  h.group('ui — the dialog calls only methods that exist');

  // Exactly the surface documented for a dialog group. Anything else is absent on purpose.
  function group(log) {
    return {
      addUnitValueEditor: function (label, ua, ub, value, min, max) {
        var ctl = { label: label, value: value, min: min, max: max, precision: null, slider: false };
        ctl.setShowPopupSlider = function (b) { ctl.slider = b; return ctl; };
        log.editors.push(ctl);
        return ctl;
      },
      addStaticText: function (label, text) {
        var ctl = { label: label, text: text, fullWidth: false };
        ctl.setIsFullWidth = function (b) { ctl.fullWidth = b; return ctl; };
        log.texts.push(ctl);
        return ctl;
      },
      addCheckBox: function (label, v) { var c = { label: label, value: v }; log.checks.push(c); return c; },
      addComboBox: function (label, items, i) { var c = { selectedIndex: i }; log.combos.push(c); return c; }
    };
  }

  function stub(result) {
    var log = { title: null, width: null, groups: [], editors: [], texts: [], checks: [], combos: [],
                modalRuns: 0 };
    var dlg = {
      addColumn: function () {
        return { addGroup: function (name) { log.groups.push(name); return group(log); } };
      },
      runModal: function () { log.modalRuns++; return result; }
    };
    Object.defineProperty(dlg, 'initialWidth', { set: function (v) { log.width = v; }, get: function () { return log.width; } });
    log.mod = {
      Dialog: { create: function (t) { log.title = t; return dlg; } },
      DialogResult: { Ok: { value: 1 }, Cancel: { value: 0 } },
      UnitType: { Number: 'number' }
    };
    return log;
  }

  function run(log) {
    var saved = globalThis.require;
    globalThis.require = function (id) {
      if (id === '/dialog') return log.mod;
      throw new Error('unexpected require: ' + id);
    };
    try { return GR.inflShowSettings(); } finally { globalThis.require = saved; }
  }

  // The OK path. If any call in showSettings names a method the stub does not define, this throws
  // rather than failing an assertion — which is the point.
  var ok = stub({ value: 1 });
  var got = run(ok);

  h.assertEqual('the dialog is titled', ok.title, 'Inflate');
  h.assertEqual('it builds exactly one group', ok.groups.length, 1);
  h.assertEqual('with exactly one slider', ok.editors.length, 1);
  h.assertEqual('and one paragraph of help', ok.texts.length, 1);

  h.assertEqual('the slider is a popup slider', ok.editors[0].slider, true);
  h.assertEqual('its range is 0..100 percent', ok.editors[0].min + '..' + ok.editors[0].max, '0..100');
  h.assertEqual('its default is the module default', ok.editors[0].value, GR.INFL_DEFAULT_PCT);
  h.assertEqual('whole percentages only', ok.editors[0].precision, 0);

  // Height is the scarce resource in a panel that cannot scroll, and help only wraps when it is
  // full width. Without this it is a clipped single line.
  h.assertEqual('the help is full width', ok.texts[0].fullWidth, true);

  h.group('ui — what it returns');

  // Guarded before dereferencing. A null here means OK was read as Cancel, and dereferencing it
  // would abort the whole run with a TypeError - detecting the bug but hiding every result after
  // it. A test that finds a defect unreadably is barely better than one that misses it.
  h.assert('an OK press returns settings, not null', got !== null,
    'null means the runModal comparison read OK as Cancel');
  var amount = got ? got.amount : NaN;

  // The dialog speaks percent because that is what a user reasons about; everything downstream
  // takes a fraction. This is the one conversion, and it happens here.
  h.assertClose('percent becomes a fraction', amount, GR.INFL_DEFAULT_PCT / 100, 1e-12);

  // Cancel must be distinguishable from "0%", which is a legitimate setting that means the identity.
  var cancelled = run(stub({ value: 0 }));
  h.assertEqual('cancel returns null, not zero', cancelled, null);

  // THE SILENT ONE. Some builds return a result object that is not the enum member itself, so
  // comparing identity reads every OK as a Cancel: the dialog closes and nothing happens, with no
  // error anywhere. Comparing .value is correct on both kinds of build.
  var foreign = stub({ value: 1 });
  foreign.mod.DialogResult.Ok = { value: 1 };     // a DIFFERENT object with the same value
  h.assert('OK is recognised even when the result is not the enum member itself',
    run(foreign) !== null, 'a by-identity comparison would return null here');

  h.assertEqual('the modal is shown exactly once per call', ok.modalRuns, 1);
};
