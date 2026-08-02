/**
 * name: probe_transform2
 * description: Find the call signature of createTransform / createGroupTransform, fix the att-run walk, and test whether a transform command scales TEXT.
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE GROUP containing text, then run. Console output.
 * Sections 1-4 are read-only (constructing a command does NOT mutate the doc).
 * Section 5 EXECUTES a 1.5x scale -> undo afterwards (Ctrl/Cmd+Z).
 */

var DO_EXECUTE = true;   // set false to skip the mutating section
var TEST_SCALE = 1.5;

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
function tag(o) { try { return String(o[Symbol.toStringTag]); } catch (e) { return '(no tag)'; } }
function safe(fn) {
  try { var v = fn(); return v === undefined ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}
function boxStr(b) {
  if (!b) return '(null)';
  return 'x=' + Number(b.x).toFixed(2) + ' y=' + Number(b.y).toFixed(2) +
         ' w=' + Number(b.width).toFixed(2) + ' h=' + Number(b.height).toFixed(2);
}

function main() {
  console.log('######## probe_transform2 v0.1.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document'); return; }
  var node = null;
  try { node = doc.selection.firstNode; } catch (e) {}
  if (!node) { L('FATAL', 'select a group containing text'); return; }
  L('node', tag(node) + ' / ' + safe(function () { return node.description; }));

  var cmds = require('/commands');
  var DocumentCommand = cmds.DocumentCommand;
  var Selection = require('/selections').Selection;

  // ---------------------------------------------------------------- 1
  H('1. arity + source of the transform commands');
  var names = ['createTransform', 'createGroupTransform', 'createMoveNodes',
               'createMoveMappedNodes', 'createSetSpreadSizeWithAnchor',
               'createSetArtboardSizeWithAnchor', 'createSetShapeFloatParam'];
  for (var i = 0; i < names.length; i++) {
    var fn = DocumentCommand[names[i]];
    L(names[i], (typeof fn) + ' arity=' + (fn && fn.length) +
                ' src=' + String(fn).replace(/\s+/g, ' ').substr(0, 160));
  }

  // Transform helper methods that could implement "scale about an anchor".
  H('1b. Transform helpers (about / around / translated)');
  var t0 = node.transform;
  L('about arity', safe(function () { return DocumentCommand && t0.about.length; }));
  L('around arity', safe(function () { return t0.around.length; }));
  L('translated arity', safe(function () { return t0.translated.length; }));
  L('scaled arity', safe(function () { return t0.scaled.length; }));
  L('t.about(...) src', String(t0.about).replace(/\s+/g, ' ').substr(0, 140));
  L('t.around(...) src', String(t0.around).replace(/\s+/g, ' ').substr(0, 140));

  // ---------------------------------------------------------------- 2
  H('2. geometry accessors on the group');
  L('baseBox', boxStr(node.baseBox));
  L('spreadBaseBox', boxStr(node.spreadBaseBox));
  L('exactSpreadBaseBox', safe(function () { return boxStr(node.exactSpreadBaseBox); }));
  L('localVisibleBox', safe(function () { return boxStr(node.localVisibleBox); }));
  L('spreadVisibleBox', safe(function () { return boxStr(node.spreadVisibleBox); }));
  L('getContentExtentsBox()', safe(function () { return boxStr(node.getContentExtentsBox()); }));
  L('getContentExtentsBoxOfChildren()', safe(function () { return boxStr(node.getContentExtentsBoxOfChildren()); }));
  L('baseToSpreadTransform', safe(function () {
    var b = node.baseToSpreadTransform;
    return 'x=' + b.xAxis.x + ',' + b.xAxis.y + ' y=' + b.yAxis.x + ',' + b.yAxis.y +
           ' o=' + b.origin.x + ',' + b.origin.y;
  }));
  L('localToSpreadTransform', safe(function () {
    var b = node.localToSpreadTransform;
    return 'x=' + b.xAxis.x + ',' + b.xAxis.y + ' y=' + b.yAxis.x + ',' + b.yAxis.y +
           ' o=' + b.origin.x + ',' + b.origin.y;
  }));
  L('node.children', safe(function () {
    var c = node.children;
    return tag(c) + ' len=' + c.length;
  }));

  // ---------------------------------------------------------------- 3
  H('3. text frame internals (the "why text does not scale" suspects)');
  var textNode = null;
  var nodesMod = require('/nodes');
  for (var k of nodesMod.getNodeChildrenRecursive(node.handle, nodesMod.NodeChildType.Main, false)) {
    try { if (k.isFrameTextNode) { textNode = k; break; } } catch (e) {}
  }
  if (!textNode) { L('textNode', 'none found'); }
  else {
    var si = textNode.storyInterface;
    var story = si.story;
    L('frame desc', safe(function () { return textNode.description; }));
    L('frame baseBox', boxStr(textNode.baseBox));
    L('frame spreadBaseBox', boxStr(textNode.spreadBaseBox));
    L('frame transform', safe(function () {
      var tt = textNode.transform;
      return 'x=' + tt.xAxis.x + ',' + tt.xAxis.y + ' y=' + tt.yAxis.x + ',' + tt.yAxis.y +
             ' o=' + tt.origin.x + ',' + tt.origin.y;
    }));
    L('*** textRenderScale', safe(function () { return si.textRenderScale; }));
    L('*** textUiScale', safe(function () { return si.textUiScale; }));
    L('textDefaultType', safe(function () { return si.textDefaultType && si.textDefaultType.value; }));
    L('domainTransform', safe(function () {
      var dt = si.domainTransform;
      return 'x=' + dt.xAxis.x + ',' + dt.xAxis.y + ' y=' + dt.yAxis.x + ',' + dt.yAxis.y;
    }));
    L('scalarDomainTransform', safe(function () { return String(si.scalarDomainTransform); }));
    L('textFrameInterface members', safe(function () { return members(textNode.textFrameInterface).join(', '); }));

    // ---- fixed att-run walk: use the Collection, not getGlyphAttsRunEnd ----
    H('3b. att runs via story.attRuns Collection');
    L('attRuns.length', safe(function () { return story.attRuns.length; }));
    L('attRuns.first tag', safe(function () { return tag(story.attRuns.first); }));
    L('attRuns.first members', safe(function () { return members(story.attRuns.first).join(', '); }));
    console.log(safe(function () {
      var arr = story.attRuns.toArray(), out = [];
      for (var r = 0; r < arr.length; r++) {
        var run = arr[r];
        out.push('  run[' + r + '] ' + JSON.stringify(Object.keys(run || {})) +
                 ' | ' + members(run).slice(0, 12).join(','));
      }
      return out.join('\n');
    }));
    L('getAttRunsFrom(0)', safe(function () {
      var c = story.getAttRunsFrom(0);
      return tag(c) + ' len=' + c.length;
    }));
    L('story.text', safe(function () { return JSON.stringify(story.text); }));
    L('story.getText(0, length)', safe(function () { return JSON.stringify(story.getText(0, story.length)); }));
    L('storyRange', safe(function () {
      var sr = si.storyRange;
      return tag(sr) + ' begin=' + sr.begin + ' end=' + sr.end;
    }));
    L('glyph height @0 / @mid / @last', safe(function () {
      var n = story.length;
      return story.getGlyphAtts(0).height + ' / ' +
             story.getGlyphAtts(Math.floor(n / 2)).height + ' / ' +
             story.getGlyphAtts(Math.max(0, n - 1)).height;
    }));
  }

  // ---------------------------------------------------------------- 4
  H('4. probing createTransform / createGroupTransform arg shapes (no mutation)');
  var scaled = node.transform.scaled(TEST_SCALE);
  var sel1 = safe(function () { return tag(Selection.create(doc, node)); });
  L('Selection.create(doc,node)', sel1);
  var S = null;
  try { S = Selection.create(doc, node); } catch (e) {}

  var candidates = [
    ['createTransform(sel, transform)', function () { return DocumentCommand.createTransform(S, scaled); }],
    ['createTransform(node, transform)', function () { return DocumentCommand.createTransform(node, scaled); }],
    ['createTransform(transform, sel)', function () { return DocumentCommand.createTransform(scaled, S); }],
    ['createTransform(doc, sel, transform)', function () { return DocumentCommand.createTransform(doc, S, scaled); }],
    ['createTransform(sel, transform, true)', function () { return DocumentCommand.createTransform(S, scaled, true); }],
    ['createGroupTransform(sel, transform)', function () { return DocumentCommand.createGroupTransform(S, scaled); }],
    ['createGroupTransform(node, transform)', function () { return DocumentCommand.createGroupTransform(node, scaled); }],
    ['createGroupTransform(doc, sel, transform)', function () { return DocumentCommand.createGroupTransform(doc, S, scaled); }],
    ['createGroupTransform(sel, transform, true)', function () { return DocumentCommand.createGroupTransform(S, scaled, true); }]
  ];
  var winners = [];
  for (var c = 0; c < candidates.length; c++) {
    var label = candidates[c][0];
    var res = null, err = null;
    try { res = candidates[c][1](); } catch (e) { err = e && e.message ? e.message : String(e); }
    if (err) L(label, 'ERR: ' + err);
    else { L(label, 'OK -> ' + tag(res)); winners.push([label, candidates[c][1]]); }
  }
  L('constructible candidates', winners.length);

  // ---------------------------------------------------------------- 5
  H('5. EXECUTE TEST (mutates - undo after)');
  if (!DO_EXECUTE) { L('skipped', 'DO_EXECUTE=false'); }
  else if (!winners.length) { L('skipped', 'no candidate constructed'); }
  else {
    var beforeBox = boxStr(node.spreadBaseBox);
    var beforeH = textNode ? safe(function () { return textNode.storyInterface.story.getGlyphAtts(0).height; }) : 'n/a';
    L('before  group spreadBaseBox', beforeBox);
    L('before  glyph height', beforeH);
    L('executing', winners[0][0]);
    L('result', safe(function () {
      doc.executeCommand(winners[0][1]());
      return 'executed';
    }));
    L('after   group spreadBaseBox', boxStr(node.spreadBaseBox));
    L('after   glyph height', textNode ? safe(function () { return textNode.storyInterface.story.getGlyphAtts(0).height; }) : 'n/a');
    L('after   frame spreadBaseBox', textNode ? boxStr(textNode.spreadBaseBox) : 'n/a');
    L('after   textRenderScale', textNode ? safe(function () { return textNode.storyInterface.textRenderScale; }) : 'n/a');
    console.log('!! CHECK CANVAS: did the group scale? did the TEXT visually scale with it? then UNDO.');
  }

  console.log('######## probe2 done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE2 THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
