/**
 * name: probe_text_scale
 * description: Verify the frame-text write path - enum names, per-run attribute values, and an actual 1.5x text scale.
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE GROUP containing FRAME text, then run. Console output.
 * Sections 1-3 read-only. Section 4 EXECUTES a text scale -> undo after (Ctrl/Cmd+Z).
 */

var DO_EXECUTE = true;
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
function num(v) { return (typeof v === 'number') ? Number(v.toFixed(4)) : v; }

// Dump an enum-like namespace object as "NAME=value" pairs.
function dumpEnum(obj) {
  if (!obj) return '(null)';
  var keys = members(obj), out = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === 'constructor' || k === 'prototype') continue;
    var v;
    try { v = obj[k]; } catch (e) { continue; }
    if (v && v.value !== undefined) out.push(k + '=' + v.value);
    else if (typeof v === 'number') out.push(k + '=' + v);
    else if (typeof v !== 'function') out.push(k + '?' + typeof v);
  }
  return out.join(', ');
}

function main() {
  console.log('######## probe_text_scale v0.1.0 ########');

  var app = require('/application').app;
  var doc = app.documents.current;
  if (!doc) { L('FATAL', 'no document'); return; }
  var root = null;
  try { root = doc.selection.firstNode; } catch (e) {}
  if (!root) { L('FATAL', 'select a group containing frame text'); return; }

  // ---------------------------------------------------------------- 0
  H('0. modules + enum names');
  var glyphatts = null, paragraphatts = null, storydelta = null, storymod = null, sels = null;
  L('/glyphatts', safe(function () { glyphatts = require('/glyphatts'); return members(glyphatts).join(', '); }));
  L('/paragraphatts', safe(function () { paragraphatts = require('/paragraphatts'); return members(paragraphatts).join(', '); }));
  L('/storydelta', safe(function () { storydelta = require('/storydelta'); return members(storydelta).join(', '); }));
  L('affinity:story', safe(function () { storymod = require('affinity:story'); return members(storymod).join(', '); }));
  L('/selections', safe(function () { sels = require('/selections'); return members(sels).join(', '); }));

  L('GlyphAttDoubleType', safe(function () { return dumpEnum(glyphatts.GlyphAttDoubleType); }));
  L('ParagraphAttDoubleType', safe(function () { return dumpEnum(paragraphatts.ParagraphAttDoubleType); }));
  L('ParagraphLeadingType', safe(function () { return dumpEnum(paragraphatts.ParagraphLeadingType); }));
  L('LeadingOverrideType', safe(function () { return dumpEnum(glyphatts.LeadingOverrideType); }));
  L('StoryDelta statics', safe(function () { return members(storydelta.StoryDelta).join(', '); }));
  L('StoryDelta.createGlyphDouble src', safe(function () {
    return String(storydelta.StoryDelta.createGlyphDouble).replace(/\s+/g, ' ').substr(0, 200);
  }));
  L('StoryDelta.createParagraphDouble src', safe(function () {
    return String(storydelta.StoryDelta.createParagraphDouble).replace(/\s+/g, ' ').substr(0, 200);
  }));
  L('TextSelection.create src', safe(function () {
    return String(sels.TextSelection.create).replace(/\s+/g, ' ').substr(0, 200);
  }));
  L('StoryRange ctor src', safe(function () {
    return String(storymod.StoryRange).replace(/\s+/g, ' ').substr(0, 200);
  }));

  // ---------------------------------------------------------------- 1
  H('1. createTransform options arg');
  var DocumentCommand = require('/commands').DocumentCommand;
  var Selection = sels.Selection;
  var S = Selection.create(doc, root);
  var xf = root.transform.scaled(1.0);
  var optTries = [
    ['options = {}', {}],
    ['options = {scaleText:true}', { scaleText: true }],
    ['options = true', true],
    ['options = 1', 1]
  ];
  for (var o = 0; o < optTries.length; o++) {
    (function (label, val) {
      L(label, safe(function () { return tag(DocumentCommand.createTransform(S, xf, val)); }));
    })(optTries[o][0], optTries[o][1]);
  }

  // ---------------------------------------------------------------- 2
  H('2. frame-text inventory (which nodes need compensation)');
  var nodesMod = require('/nodes');
  var frames = [];
  var kids = nodesMod.getNodeChildrenRecursive(root.handle, nodesMod.NodeChildType.Main, false);
  for (var k of kids) {
    var isFrame = false, isArtistic = false;
    try { isFrame = !!k.isFrameTextNode; } catch (e) {}
    try { isArtistic = !!k.isArtisticTextNode; } catch (e) {}
    if (isFrame || isArtistic) {
      frames.push(k);
      console.log('  ' + tag(k) +
                  ' | isFrameTextNode=' + isFrame +
                  ' isArtisticTextNode=' + isArtistic +
                  ' | hasScaledText=' + safe(function () { return k.textFrameInterface.hasScaledText; }) +
                  ' | "' + safe(function () { return String(k.description).substr(0, 24); }) + '"');
    }
  }
  L('text node count', frames.length);
  // Distinguishing flag matters: artistic text already scaled, must NOT be touched.
  L('root ~isArtistic member present?', safe(function () {
    return members(frames[0] || root).filter(function (n) { return /artistic|frameText/i.test(n); }).join(', ');
  }));

  // ---------------------------------------------------------------- 3
  H('3. per-run attribute values (absolute vs relative)');
  var GLYPH_NUM = ['height', 'absoluteLeading', 'characterSpacing', 'manualKerning',
                   'baselineAdvance', 'offsetX', 'offsetY', 'scaleX', 'scaleY',
                   'shearX', 'autoKernMinHeight'];
  var PARA_NUM = ['absoluteLeading', 'relativeLeading', 'spaceBefore', 'spaceAfter',
                  'firstLineIndent', 'leftIndent', 'rightIndent', 'lastLineOutdent',
                  'defaultTabStops', 'hyphenationZone', 'minWordSpacing', 'desiredWordSpacing',
                  'maxWordSpacing', 'minLetterSpacing', 'desiredLetterSpacing', 'maxLetterSpacing'];

  for (var f = 0; f < frames.length; f++) {
    var fn2 = frames[f];
    console.log('--- frame[' + f + '] "' + safe(function () { return String(fn2.description).substr(0, 30); }) + '"');
    console.log(safe(function () {
      var story = fn2.storyInterface.story;
      var runs = story.attRuns.toArray(), out = [];
      out.push('    runs=' + runs.length + ' storyLength=' + story.length);
      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        var g = run.glyphAtts, p = run.paragraphAtts;
        var gs = [], ps = [];
        for (var i = 0; i < GLYPH_NUM.length; i++) {
          var gv = g ? g[GLYPH_NUM[i]] : undefined;
          if (typeof gv === 'number') gs.push(GLYPH_NUM[i] + '=' + num(gv));
        }
        for (var j = 0; j < PARA_NUM.length; j++) {
          var pv = p ? p[PARA_NUM[j]] : undefined;
          if (typeof pv === 'number') ps.push(PARA_NUM[j] + '=' + num(pv));
        }
        out.push('    run[' + r + '] ' + run.begin + '..' + run.end +
                 ' font=' + safe(function () { return g.font.postscriptName; }));
        out.push('      glyph: ' + gs.join(' '));
        out.push('      para : ' + ps.join(' '));
        out.push('      leadingType=' + safe(function () { return p.leadingType.value; }) +
                 ' leadingOverride=' + safe(function () { return g.leadingOverrideType.value; }) +
                 ' useModernLeading=' + safe(function () { return p.useModernLeading; }));
      }
      return out.join('\n');
    }));
  }

  // ---------------------------------------------------------------- 4
  H('4. EXECUTE: scale run heights x' + TEST_SCALE + ' on frame[0]');
  if (!DO_EXECUTE) { L('skipped', 'DO_EXECUTE=false'); return; }
  if (!frames.length) { L('skipped', 'no text nodes'); return; }

  var target = frames[0];
  var StoryDelta = storydelta.StoryDelta;
  var GlyphAttDoubleType = glyphatts.GlyphAttDoubleType;
  var StoryRange = storymod.StoryRange;
  var TextSelection = sels.TextSelection;

  L('before heights', safe(function () {
    var runs = target.storyInterface.story.attRuns.toArray(), o2 = [];
    for (var r = 0; r < runs.length; r++) o2.push(runs[r].begin + '..' + runs[r].end + ':' + runs[r].glyphAtts.height);
    return o2.join(' ');
  }));

  // Variant A: sub-range selection (what the real script needs, run-by-run).
  L('EXEC A per-run sub-range', safe(function () {
    var story = target.storyInterface.story;
    var runs = story.attRuns.toArray();
    var CompoundCommandBuilder = require('/commands').CompoundCommandBuilder;
    var builder = CompoundCommandBuilder.create();
    var made = 0;
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var s = Selection.create(doc, target);
      s.addSubSelectionForNode(target, TextSelection.create(new StoryRange(run.begin, run.end)));
      var delta = StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, run.glyphAtts.height * TEST_SCALE);
      builder.addCommand(DocumentCommand.createFormatText(s, delta));
      made++;
    }
    doc.executeCommand(builder.createCommand());
    return 'executed ' + made + ' deltas';
  }));

  L('after heights', safe(function () {
    var runs = target.storyInterface.story.attRuns.toArray(), o3 = [];
    for (var r = 0; r < runs.length; r++) o3.push(runs[r].begin + '..' + runs[r].end + ':' + runs[r].glyphAtts.height);
    return o3.join(' ');
  }));
  console.log('!! CHECK CANVAS: did frame[0] text get bigger? then UNDO.');

  console.log('######## probe_text_scale done ########');
}

try { main(); }
catch (err) {
  console.log('!!!! PROBE THREW !!!!');
  console.log('message: ' + (err && err.message ? err.message : err));
  console.log('stack: ' + (err && err.stack ? err.stack : '(none)'));
}
