'use strict';

/**
 * name: probe_text_io
 * description: Throwaway probe. Select a TEXT frame (or some text), run it. It
 *              dumps the story's members, attempts a LIVE read of the frame's
 *              string via several accessors, and lists the text-related
 *              DocumentCommand / StoryDelta / StoryRange APIs — so we can wire
 *              Text Find & Replace (range-aware, formatting-safe) and Lorem
 *              Ipsum (whole-frame set). Read-only: it never executes a command.
 *              Delete after use.
 * author: olliollio
 */

const { Document } = require('/document');
const { Dialog } = require('/dialog');

// Optional modules — guard each so a missing one can't abort the probe.
let SubSelectionType, Selection, TextSelection, DocumentCommand, StoryDelta, StoryRange;
try { ({ SubSelectionType, Selection, TextSelection } = require('/selections')); } catch (e) {}
try { ({ DocumentCommand } = require('/commands')); } catch (e) {}
try { ({ StoryDelta } = require('/storydelta')); } catch (e) {}
try { ({ StoryRange } = require('affinity:story')); } catch (e) {}

const MAX_CONTROLS = 110;
let budget = MAX_CONTROLS;

function members(o) {
  if (o == null) return [];
  const out = []; let x = o;
  while (x && x !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(x)) out.push(k);
    x = Object.getPrototypeOf(x);
  }
  return [...new Set(out)].sort();
}

function line(group, label, text) {
  if (budget <= 0) return false;
  try { group.addStaticText(String(label), String(text)); } catch (e) { return true; }
  budget--;
  return true;
}

// Render any value briefly. Strings are quoted + truncated so we can see the
// actual text content; objects show their toStringTag.
function brief(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v.length > 56 ? v.slice(0, 56) + '…' : v);
  if (t === 'number' || t === 'boolean') return String(v);
  if (t === 'function') return '<fn>';
  let tag = 'object'; try { if (v[Symbol.toStringTag]) tag = String(v[Symbol.toStringTag]); } catch (e) {}
  return '[' + tag + ']';
}

// Call a read-only accessor/method and show what it returns (or how it throws).
function probe(group, label, fn) {
  if (budget <= 0) return;
  let out;
  try { out = fn(); }
  catch (e) { line(group, label, '<throws: ' + (e && e.message ? e.message : e) + '>'); return; }
  line(group, label, brief(out));
}

function scalarDump(group, obj, max) {
  let shown = 0;
  for (const k of members(obj)) {
    if (shown >= max || budget <= 0) break;
    let v; try { v = obj[k]; } catch (e) { v = '<throws>'; }
    if (typeof v === 'function') continue;
    line(group, k, brief(v)); shown++;
  }
}

// Find the first selected node that owns a text story; fall back to any node.
function firstTextNode(sel) {
  const cands = [];
  try { if (sel && sel.firstNode) cands.push(sel.firstNode); } catch (e) {}
  try { if (sel && sel.nodes && sel.nodes.first) cands.push(sel.nodes.first); } catch (e) {}
  try { if (sel && sel.items) for (const it of sel.items) { if (it && it.node) cands.push(it.node); } } catch (e) {}
  for (const n of cands) {
    try { if (n && n.storyInterface && n.storyInterface.story) return n; } catch (e) {}
  }
  return cands[0] || null;
}

function run() {
  const doc = Document.current;
  if (!doc) return { title: 'Probe', lines: [['!', 'No document open.']] };

  let sel = null; try { sel = doc.selection; } catch (e) {}
  const node = firstTextNode(sel);
  if (!node) return { title: 'Probe text I/O', lines: [['!', 'Select a text frame (or some text), then run again.']] };

  let story = null;
  try { story = node.storyInterface && node.storyInterface.story; } catch (e) {}
  if (!story) {
    return { title: 'Probe text I/O', lines: [
      ['node type', String(node[Symbol.toStringTag] || '?')],
      ['!', 'Selected node has no text story. Select a TEXT frame and retry.'],
    ] };
  }

  let len = 0; try { len = story.length; } catch (e) {}

  const dlg = Dialog.create('Probe text I/O');
  dlg.initialWidth = 680;
  const c1 = dlg.addColumn(); c1.widthProportion = 1;
  const c2 = dlg.addColumn(); c2.widthProportion = 1;

  // -- Column 1: story shape + LIVE text-read attempts. ----------------------
  const gStory = c1.addGroup('story');
  line(gStory, 'node type', String(node[Symbol.toStringTag] || '?'));
  line(gStory, 'length', String(len));

  const gMem = c1.addGroup('story members');
  const mem = members(story);
  for (let i = 0; i < mem.length; i += 5) { if (budget <= 30) break; line(gMem, '', mem.slice(i, i + 5).join(', ')); }

  // The important part: which accessor actually returns the frame's string?
  const gRead = c1.addGroup('LIVE text read (what returns the string?)');
  probe(gRead, 'story.text', () => story.text);
  probe(gRead, 'story.string', () => story.string);
  probe(gRead, 'story.plainText', () => story.plainText);
  probe(gRead, 'story.getText(0,len)', () => story.getText(0, len));
  probe(gRead, 'story.getString(0,len)', () => story.getString(0, len));
  probe(gRead, 'story.substring(0,len)', () => story.substring(0, len));
  probe(gRead, 'story.toString()', () => story.toString());
  if (StoryRange) {
    probe(gRead, 'story.getText(StoryRange)', () => story.getText(new StoryRange(0, len)));
    probe(gRead, 'story.getString(StoryRange)', () => story.getString(new StoryRange(0, len)));
  }

  // -- Column 2: the write/range APIs we need for replace + generate. --------
  const gSI = c2.addGroup('storyInterface members');
  let si = null; try { si = node.storyInterface; } catch (e) {}
  if (si) scalarDump(gSI, si, 12);

  // Text-related command factories (createSetText is known; hunt for range ops).
  const gCmd = c2.addGroup('DocumentCommand text/range creators');
  if (DocumentCommand) {
    const hits = members(DocumentCommand).filter((k) => /text|story|set|replace|insert|delete|range/i.test(k));
    line(gCmd, '(matching)', hits.length ? hits.join(', ') : '(none matched)');
  } else line(gCmd, '', '(/commands not available)');

  // StoryDelta creators (for formatting-safe / range text edits).
  const gDelta = c2.addGroup('StoryDelta create* factories');
  if (StoryDelta) {
    const creators = members(StoryDelta).filter((k) => /^create/i.test(k) || /text|string|range/i.test(k));
    for (let i = 0; i < creators.length; i += 4) { if (budget <= 8) break; line(gDelta, '', creators.slice(i, i + 4).join(', ')); }
  } else line(gDelta, '', '(/storydelta not available)');

  // StoryRange shape (for addressing sub-ranges).
  const gRange = c2.addGroup('StoryRange instance');
  if (StoryRange) {
    try {
      const r = new StoryRange(0, Math.min(1, len));
      line(gRange, '(members)', members(r).slice(0, 16).join(', '));
      probe(gRange, 'begin', () => r.begin);
      probe(gRange, 'end', () => r.end);
    } catch (e) { line(gRange, '', '<StoryRange ctor throws: ' + (e && e.message ? e.message : e) + '>'); }
  } else line(gRange, '', '(affinity:story not available)');

  return { dialog: dlg };
}

// -- Entry point: always shows a dialog, even on error. ----------------------
try {
  const r = run();
  if (r.dialog) { r.dialog.runModal(); }
  else {
    const d = Dialog.create(r.title || 'Probe');
    const g = d.addColumn().addGroup('');
    for (const [l, t] of r.lines) g.addStaticText(l, t);
    d.runModal();
  }
} catch (err) {
  const d = Dialog.create('Probe ERROR');
  d.initialWidth = 560;
  const g = d.addColumn().addGroup('The probe threw — this is the cause');
  g.addStaticText('error', String(err && err.message ? err.message : err));
  let stack = ''; try { stack = String(err.stack || ''); } catch (e) {}
  for (const s of stack.split('\n').slice(0, 8)) g.addStaticText('', s);
  d.runModal();
}
