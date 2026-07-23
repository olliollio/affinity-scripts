'use strict';

/**
 * name: probe_glyph_atts
 * description: Throwaway probe. Select some text, run it, and it dumps the real
 *              property names + values of story.getGlyphAtts(pos) to a dialog so
 *              we can wire the Font Family / Style / Text Fill / Text Stroke
 *              matchers in Select Same. Delete after use.
 * author: olliollio
 */

const { Document } = require('/document');
const { Selection, SubSelectionType } = require('/selections');
const { Dialog, DialogResult } = require('/dialog');

// Enumerate every own property name across an object's whole prototype chain.
function members(o) {
  if (o == null) return [];
  const out = []; let x = o;
  while (x && x !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(x)) out.push(k);
    x = Object.getPrototypeOf(x);
  }
  return [...new Set(out)].sort();
}

// Read a property and render it as a short, safe string. Objects show their
// [Symbol.toStringTag] so we can see the type (SolidFill, Colour, Font, ...).
function peek(obj, key) {
  let v;
  try { v = obj[key]; } catch (e) { return '<throws: ' + e + '>'; }
  if (typeof v === 'function') return '<fn>';
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') {
    let s = String(v);
    if (s.length > 40) s = s.slice(0, 40) + '…';
    return s;
  }
  // object: show its tag and, one level deep, any scalar-ish members
  const tag = (v && v[Symbol.toStringTag]) ? String(v[Symbol.toStringTag]) : 'object';
  return '[' + tag + ']';
}

const doc = Document.current;
if (!doc) {
  const d = Dialog.create('Probe'); d.addColumn().addGroup('!').addStaticText('', 'No document open.'); d.runModal();
} else {
  // Find the first selected node that has a text story.
  let node = null, pos = 0;
  const items = (doc.selection && doc.selection.items) ? doc.selection.items : [];
  for (const item of items) {
    const n = item.node;
    let story;
    try { story = n && n.storyInterface && n.storyInterface.story; } catch (e) { story = null; }
    if (!story || !story.length) continue;
    node = n;
    try {
      const sub = item.getSubSelectionOfType(SubSelectionType.Text);
      if (sub && !sub.isEmpty && sub.rangeCount > 0) {
        pos = Math.min(Math.min(sub.ranges[0].begin, sub.ranges[0].end), story.length - 1);
      }
    } catch (e) {}
    break;
  }

  const dlg = Dialog.create('Probe glyph atts');
  dlg.initialWidth = 640;
  const c1 = dlg.addColumn(); c1.widthProportion = 1;
  const c2 = dlg.addColumn(); c2.widthProportion = 1;

  if (!node) {
    c1.addGroup('!').addStaticText('', 'Select a text object (or some text) first, then run again.');
    dlg.runModal();
  } else {
    const story = node.storyInterface.story;
    const atts = story.getGlyphAtts(pos);

    // Column 1: full member list of the glyph atts object.
    const gAll = c1.addGroup('getGlyphAtts(' + pos + ') members');
    const mem = members(atts);
    // Chunk the raw name list so it can't clip; ~6 names per line.
    for (let i = 0; i < mem.length; i += 6) {
      gAll.addStaticText('', mem.slice(i, i + 6).join(', '));
    }

    // Column 1 (cont): values of every non-function member.
    const gVal = c1.addGroup('member = value');
    for (const k of mem) {
      const val = peek(atts, k);
      if (val !== '<fn>') gVal.addStaticText(k, val);
    }

    // Column 2: targeted guesses for the attributes we need, with values, plus
    // a one-level dive into any object-valued ones (to find colour.rgba8 etc.).
    const guesses = [
      'height', 'size', 'fontSize',
      'familyName', 'family', 'typefaceName', 'fontName', 'faceName', 'font',
      'styleName', 'style', 'weight', 'italic',
      'fill', 'brushFill', 'brushFillDescriptor', 'fillColour', 'fillColor',
      'stroke', 'penFill', 'penFillDescriptor', 'strokeColour', 'strokeColor',
      'colour', 'color',
    ];
    const gGuess = c2.addGroup('likely keys (exists? value)');
    const present = new Set(mem);
    for (const k of guesses) {
      if (present.has(k)) gGuess.addStaticText(k, peek(atts, k));
    }

    // Dive one level into object-valued members to reveal nested shape.
    const gDive = c2.addGroup('object members (1 level)');
    let dived = 0;
    for (const k of mem) {
      if (dived >= 6) break;
      let v;
      try { v = atts[k]; } catch (e) { continue; }
      if (v && typeof v === 'object' && typeof v !== 'function') {
        const sub = members(v).filter((x) => {
          try { return typeof v[x] !== 'function'; } catch (e) { return false; }
        });
        if (sub.length) {
          gDive.addStaticText(k, sub.slice(0, 10).join(', '));
          dived++;
        }
      }
    }

    dlg.runModal();
  }
}
