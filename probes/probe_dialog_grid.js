/**
 * name: probe_dialog_grid
 * description: Can the Dialog API render a 3x3 anchor grid of mutually-exclusive checkboxes?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: run with no selection needed. A dialog opens - click around the grid,
 * then OK. Console reports what worked.
 */

function L(l, t) { console.log(l + ': ' + t); }
function H(t) { console.log(''); console.log('===== ' + t + ' ====='); }

function members(o) {
  if (o === null || o === undefined) return [];
  var out = [], x = o;
  while (x && x !== Object.prototype) {
    var names = Object.getOwnPropertyNames(x);
    for (var i = 0; i < names.length; i++) out.push(names[i]);
    x = Object.getPrototypeOf(x);
  }
  var seen = {}, uniq = [];
  for (var j = 0; j < out.length; j++) if (!seen[out[j]]) { seen[out[j]] = 1; uniq.push(out[j]); }
  return uniq.sort();
}
function safe(fn) {
  try { var v = fn(); return v === undefined ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}
function descriptorOf(o, name) {
  var x = o;
  while (x && x !== Object.prototype) {
    var d = Object.getOwnPropertyDescriptor(x, name);
    if (d) return 'get=' + (typeof d.get) + ' set=' + (typeof d.set) + ' writable=' + d.writable;
    x = Object.getPrototypeOf(x);
  }
  return '(no descriptor)';
}

function main() {
  console.log('######## probe_dialog_grid v0.1.0 ########');

  var dialogMod = require('/dialog');
  var UnitType = require('/units').UnitType;
  var dlg = dialogMod.Dialog.create('Anchor grid probe');
  dlg.initialWidth = 420;

  H('0. container APIs');
  L('Dialog members', members(dlg).join(', '));

  var col0 = dlg.addColumn();
  L('Column members', members(col0).join(', '));
  var g0 = col0.addGroup('Probe');
  L('Group members', members(g0).join(', '));

  // A reference control, so the grid's alignment is judgeable.
  var wField = g0.addUnitValueEditor('Width', UnitType.Pixel, UnitType.Pixel, 100, 0.01, 1000000);
  wField.value = 100;

  H('1. build the 3x3 grid: 3 columns x 3 checkboxes');
  // Column = the only horizontal unit; each control in a group is a row.
  var boxes = [];          // flat, row-major: index = row*3 + col
  var colGroups = [];
  var buildErr = null;
  try {
    for (var c = 0; c < 3; c++) {
      var col = dlg.addColumn();
      try { col.widthProportion = 1; } catch (e) {}
      var grp = col.addGroup(c === 0 ? 'Anchor' : ' ');
      colGroups.push(grp);
    }
    // Add row by row so the visual order is row-major.
    for (var r = 0; r < 3; r++) {
      for (var cc = 0; cc < 3; cc++) {
        var cb = colGroups[cc].addCheckBox('', r === 2 && cc === 2);
        boxes[r * 3 + cc] = cb;
      }
    }
    L('built checkboxes', boxes.length);
  } catch (e) {
    buildErr = e && e.message ? e.message : String(e);
    L('BUILD FAILED', buildErr);
  }

  H('2. is CheckBox.value writable?');
  if (boxes.length) {
    L('CheckBox members', members(boxes[0]).join(', '));
    L('descriptor for "value"', descriptorOf(boxes[0], 'value'));
    L('value before write', safe(function () { return boxes[0].value; }));
    L('write true', safe(function () { boxes[0].value = true; return 'no throw'; }));
    L('value after write', safe(function () { return boxes[0].value; }));
    L('WRITABLE?', safe(function () { return boxes[0].value === true ? 'YES' : 'NO - silently ignored'; }));
    L('reset to false', safe(function () { boxes[0].value = false; return String(boxes[0].value); }));
  }

  H('3. empty label rendering');
  L('note', 'check the dialog: are the 9 boxes a tidy 3x3 with no stray labels?');

  // ---- mutual exclusion, same pattern the real script would use ----
  var selected = 8;        // bottom-right, matching the initial checked box
  var syncing = false;     // programmatic writes fire handlers - guard needed
  var fireCount = 0;

  function wire(idx) {
    boxes[idx].onValueChangedHandler = function () {
      fireCount++;
      if (syncing) return;
      syncing = true;
      if (boxes[idx].value) {
        selected = idx;
        for (var i = 0; i < 9; i++) if (i !== idx) boxes[i].value = false;
      } else {
        // Refuse to leave nothing selected.
        boxes[idx].value = true;
      }
      syncing = false;
      console.log('  anchor -> ' + selected);
    };
  }
  if (boxes.length === 9) {
    for (var i = 0; i < 9; i++) wire(i);
    L('handlers wired', 'click the grid, then press OK');
  }

  var res = dlg.runModal();
  var Ok = dialogMod.DialogResult.Ok;
  var ok = (res === Ok) || (res && res.value !== undefined && Ok && res.value === Ok.value);

  H('4. results');
  L('dialog result', ok ? 'OK' : 'cancelled');
  L('handler fire count', fireCount);
  L('final selected index', selected);
  L('final checked states', safe(function () {
    var s = [];
    for (var i = 0; i < 9; i++) s.push(boxes[i].value ? '1' : '0');
    return s.join('') + '  (exactly one "1" expected)';
  }));

  console.log('######## probe done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
