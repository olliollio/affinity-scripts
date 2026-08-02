/**
 * name: probe_transform
 * description: Discovery probe - can a script write a node transform, and what geometry/bbox accessors exist?
 * version: 0.2.0
 * author: ollio
 *
 * USAGE: select ONE GROUP that contains at least one text frame, then run.
 * Output goes to the CONSOLE (no dialog, no clipping).
 * Everything is read-only except the final WRITE TEST (guarded by TRY_WRITE).
 * If the write test mutates the document -> press Cmd/Ctrl+Z once.
 */

// Flip to false for a purely read-only run.
var TRY_WRITE = true;

function L(label, text) {
  console.log(label + ': ' + text);
}
function H(title) {
  console.log('');
  console.log('===== ' + title + ' =====');
}

// --- helpers ---------------------------------------------------------------

function members(o) {
  if (o === null || o === undefined) return [];
  var out = [], x = o;
  while (x && x !== Object.prototype) {
    var names = Object.getOwnPropertyNames(x);
    for (var i = 0; i < names.length; i++) out.push(names[i]);
    x = Object.getPrototypeOf(x);
  }
  var seen = {}, uniq = [];
  for (var j = 0; j < out.length; j++) { if (!seen[out[j]]) { seen[out[j]] = 1; uniq.push(out[j]); } }
  return uniq.sort();
}

function grep(list, re) {
  var out = [];
  for (var i = 0; i < list.length; i++) if (re.test(list[i])) out.push(list[i]);
  return out;
}

// Find the property descriptor for `name` anywhere on o's prototype chain.
// Tells us whether a SETTER exists WITHOUT mutating anything.
function descriptorOf(o, name) {
  var x = o;
  while (x && x !== Object.prototype) {
    var d = Object.getOwnPropertyDescriptor(x, name);
    if (d) {
      return 'get=' + (typeof d.get) + ' set=' + (typeof d.set) +
             ' writable=' + d.writable + ' valueType=' + (typeof d.value) +
             ' definedOn=' + (x[Symbol.toStringTag] || x.constructor && x.constructor.name || 'proto');
    }
    x = Object.getPrototypeOf(x);
  }
  return '(no descriptor found)';
}

function tag(o) {
  try { return String(o[Symbol.toStringTag]); } catch (e) { return '(no tag)'; }
}

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

function boxStr(b) {
  if (!b) return '(null)';
  return 'x=' + b.x + ' y=' + b.y + ' w=' + b.width + ' h=' + b.height;
}

// --- probe -----------------------------------------------------------------

function main() {
  console.log('######## probe_transform v0.2.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document open'); return; }

  var sel = doc.selection;
  var node = null;
  try { node = sel.firstNode; } catch (e) {}
  if (!node) { L('FATAL', 'nothing selected - select one group containing text'); return; }

  H('0. selection');
  L('sel.length', safe(function () { return sel.length; }));
  L('node tag', tag(node));
  L('node desc', safe(function () { return node.description; }));
  L('isGroupNode', safe(function () { return node.isGroupNode; }));

  H('1. DocumentCommand setters');
  var DocumentCommand = null;
  try { DocumentCommand = require('/commands').DocumentCommand; } catch (e) {}
  if (DocumentCommand) {
    var dcAll = members(DocumentCommand);
    L('count', dcAll.length);
    L('~transform/scale/size', grep(dcAll, /transform|scale|size|resiz|bound|box|geometr|matrix/i).join(', ') || '(none)');
    L('~move/pos/place', grep(dcAll, /move|posit|place|translat|offset|origin/i).join(', ') || '(none)');
    console.log('-- DocumentCommand ALL --');
    for (var i = 0; i < dcAll.length; i++) console.log('  ' + dcAll[i]);
  } else {
    L('DocumentCommand', 'require("/commands") failed');
  }

  H('2. transform: readable? writable?');
  var t = null;
  try { t = node.transform; } catch (e) {}
  L('node.transform tag', tag(t));
  L('descriptor for "transform"', descriptorOf(node, 'transform'));
  L('t.xAxis', safe(function () { return t.xAxis.x + ',' + t.xAxis.y; }));
  L('t.yAxis', safe(function () { return t.yAxis.x + ',' + t.yAxis.y; }));
  L('t.origin', safe(function () { return t.origin.x + ',' + t.origin.y; }));
  L('t.data', safe(function () { return Array.prototype.join.call(t.data, ','); }));
  L('t.decompose()', safe(function () {
    var dd = t.decompose();
    var s = JSON.stringify(dd);
    return (s && s !== '{}') ? s : members(dd).join(',');
  }));
  L('t.scaled(2)', safe(function () { return tag(t.scaled(2)); }));
  L('t.scaled(2,3)', safe(function () { return tag(t.scaled(2, 3)); }));
  L('Transform members', members(t).join(', '));

  H('3. bounding box accessors on the node');
  var nodeAll = members(node);
  L('member count', nodeAll.length);
  L('~box/bound/size', grep(nodeAll, /box|bound|size|extent|width|height|rect/i).join(', ') || '(none)');
  L('~interface', grep(nodeAll, /interface/i).join(', ') || '(none)');
  L('node.baseBox', safe(function () { return boxStr(node.baseBox); }));
  L('node.boundingBox', safe(function () { return boxStr(node.boundingBox); }));
  L('node.spreadBaseBox', safe(function () { return boxStr(node.spreadBaseBox); }));
  L('node.getBounds()', safe(function () { return boxStr(node.getBounds()); }));
  console.log('-- node ALL --');
  for (var m = 0; m < nodeAll.length; m++) console.log('  ' + nodeAll[m]);

  H('4. descendants + the text frame');
  var textNode = null;
  try {
    var nodesMod = require('/nodes');
    var kids = nodesMod.getNodeChildrenRecursive(node.handle, nodesMod.NodeChildType.Main, false);
    var n = 0;
    for (var k of kids) {
      n++;
      console.log('  [' + n + '] ' + tag(k) + ' | ' + safe(function () { return k.description; }));
      if (!textNode) { try { if (k.isFrameTextNode) textNode = k; } catch (e2) {} }
    }
    L('descendant count', n);
  } catch (e) {
    L('getNodeChildrenRecursive', 'ERR ' + e.message);
  }

  if (textNode) {
    H('5. text frame');
    L('textNode tag', tag(textNode));
    L('~box/bound/frame', grep(members(textNode), /box|bound|size|extent|frame|rect/i).join(', ') || '(none)');
    L('text transform', safe(function () {
      var tt = textNode.transform;
      return 'xAxis=' + tt.xAxis.x + ',' + tt.xAxis.y +
             ' yAxis=' + tt.yAxis.x + ',' + tt.yAxis.y +
             ' origin=' + tt.origin.x + ',' + tt.origin.y;
    }));
    L('descriptor for "transform" (text)', descriptorOf(textNode, 'transform'));
    L('storyInterface members', safe(function () { return members(textNode.storyInterface).join(', '); }));
    L('story.length', safe(function () { return textNode.storyInterface.story.length; }));
    L('glyph height @0 (pt)', safe(function () { return textNode.storyInterface.story.getGlyphAtts(0).height; }));
    L('glyph scaleX/scaleY @0', safe(function () {
      var a = textNode.storyInterface.story.getGlyphAtts(0);
      return a.scaleX + ' / ' + a.scaleY;
    }));
    L('absoluteLeading @0', safe(function () { return textNode.storyInterface.story.getGlyphAtts(0).absoluteLeading; }));
    L('leadingOverrideType @0', safe(function () {
      return textNode.storyInterface.story.getGlyphAtts(0).leadingOverrideType.value;
    }));
    L('characterSpacing @0', safe(function () { return textNode.storyInterface.story.getGlyphAtts(0).characterSpacing; }));
    L('getGlyphAttsRunEnd(0)', safe(function () { return textNode.storyInterface.story.getGlyphAttsRunEnd(0); }));
    L('story.attRuns', safe(function () {
      var ar = textNode.storyInterface.story.attRuns;
      return tag(ar) + ' | ' + members(ar).join(',');
    }));

    // Walk every attribute run so we know the per-run write plan is viable.
    console.log('-- att runs --');
    console.log(safe(function () {
      var story = textNode.storyInterface.story;
      var out = [], pos = 0, guard = 0;
      while (pos < story.length && guard++ < 200) {
        var end = story.getGlyphAttsRunEnd(pos);
        var a = story.getGlyphAtts(pos);
        out.push('  [' + pos + '..' + end + ') height=' + a.height +
                 ' font=' + (a.font && a.font.familyName) +
                 ' text="' + String(story.getText(pos, Math.min(end, pos + 20))).replace(/\n/g, '\\n') + '"');
        if (end <= pos) break;
        pos = end;
      }
      return out.join('\n');
    }));

    // Paragraph attributes carry leading/space-before/after - also scale targets.
    L('paragraphAtts @0 members', safe(function () {
      return members(textNode.storyInterface.story.getParagraphAtts(0)).join(', ');
    }));
  } else {
    L('textNode', 'NO FrameTextNode found - rerun with a group containing text');
  }

  H('6. WRITE TEST');
  if (!TRY_WRITE) {
    L('skipped', 'TRY_WRITE = false');
  } else {
    var before = safe(function () { return node.transform.xAxis.x; });
    L('xAxis.x before', before);

    L('WRITE A  node.transform = t.scaled(2)', safe(function () {
      node.transform = node.transform.scaled(2);
      return 'NO THROW -> xAxis.x now ' + node.transform.xAxis.x;
    }));

    L('WRITE B  t.scale(2) in place', safe(function () {
      var tt = node.transform;
      tt.scale(2);
      return 'NO THROW -> xAxis.x now ' + node.transform.xAxis.x;
    }));

    L('xAxis.x after', safe(function () { return node.transform.xAxis.x; }));
    console.log('!! CHECK CANVAS: did the group visibly scale? did the TEXT scale with it? then undo (Ctrl/Cmd+Z).');
  }

  console.log('######## probe done ########');
}

try {
  main();
} catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(no stack)'));
}
