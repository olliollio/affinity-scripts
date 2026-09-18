'use strict';

/**
 * name: Find and Replace Text
 * description: Find and replace text across the selected frame(s) or the whole
 *              document, with match-case and whole-word options. Replaces each
 *              match in place (as a text sub-range) so surrounding formatting is
 *              preserved. Fills a gap in Affinity, which has no text find &
 *              replace.
 * version: 1.0.0
 * author: olliollio - analog digitalagentur
 */

const { app } = require('/application');
const { Document } = require('/document');
const { Selection, TextSelection } = require('/selections');
const { StoryRange } = require('affinity:story');
const { NodeChildType, getNodeChildrenRecursive } = require('/nodes');
const { DocumentCommand, CompoundCommandBuilder } = require('/commands');
const { Dialog, DialogResult } = require('/dialog');

const VERSION = 'v1.0';
const TITLE = 'Find and Replace';

const SCOPE_SELECTED = 0;
const SCOPE_DOCUMENT = 1;

// -- Target text frames -----------------------------------------------------
function isTextFrame(n) {
  try { return !!(n && n.storyInterface && n.storyInterface.story); } catch (e) { return false; }
}

function selectedFrames(doc) {
  const frames = [], seen = new Set();
  const add = (n) => { if (isTextFrame(n) && !seen.has(n)) { seen.add(n); frames.push(n); } };
  const sel = doc.selection;
  try { if (sel && sel.items) for (const it of sel.items) add(it.node); } catch (e) {}
  if (frames.length === 0) { try { add(sel && sel.firstNode); } catch (e) {} }
  return frames;
}

function documentFrames(doc) {
  const frames = [], seen = new Set();
  const scope = doc.currentSpread;
  if (!scope || !scope.handle) return frames;
  try {
    for (const n of getNodeChildrenRecursive(scope.handle, NodeChildType.Main, false)) {
      if (isTextFrame(n) && !seen.has(n)) { seen.add(n); frames.push(n); }
    }
  } catch (e) {}
  return frames;
}

// -- Matching ---------------------------------------------------------------
// A regex built from the (escaped) search term, so match-case and whole-word
// are trivial. Returns [{begin, end}] ranges in glyph-index space, which lines
// up with story.text for normal runs.
function buildRegex(find, matchCase, wholeWord) {
  let pat = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) pat = '\\b' + pat + '\\b';
  return new RegExp(pat, matchCase ? 'g' : 'gi');
}

function findMatches(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }   // guard zero-length
    out.push({ begin: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// Replace one glyph range [begin,end) with `text`, preserving the rest of the
// frame's formatting. createSetText on a sub-range selection edits only that
// range (unlike a whole-frame selection, which replaces everything).
function replaceRangeCmd(doc, frame, begin, end, text) {
  const sel = Selection.create(doc, frame);
  const ts = TextSelection.create(new StoryRange(begin, end));
  sel.addSubSelectionForNode(frame, ts);
  return DocumentCommand.createSetText(sel, text);
}

function main() {
  const doc = Document.current;
  if (!doc) { app.alert('Open a document first.', TITLE); return; }

  const hasSelection = selectedFrames(doc).length > 0;

  // -- Dialog --------------------------------------------------------------
  const dlg = Dialog.create(TITLE + ' ' + VERSION);
  dlg.initialWidth = 420;
  const col = dlg.addColumn();

  const grpText = col.addGroup('Text');
  const findBox = grpText.addTextBox('Find', '');
  findBox.isFullWidth = true;
  const replBox = grpText.addTextBox('Replace with', '');
  replBox.isFullWidth = true;

  const grpOpts = col.addGroup('Options');
  const chkCase = grpOpts.addCheckBox('Match case', false);
  const chkWord = grpOpts.addCheckBox('Whole word only', false);
  // Default to the selection when text frames are selected, else the document.
  const scopeCombo = grpOpts.addComboBox('Scope',
    ['Selected frame(s)', 'Whole document'], hasSelection ? SCOPE_SELECTED : SCOPE_DOCUMENT);

  if (dlg.runModal() !== DialogResult.Ok) return;

  const find = String(findBox.text || '');
  const repl = String(replBox.text || '');
  if (find.length === 0) { app.alert('Enter the text to find.', TITLE); return; }

  const scope = scopeCombo.selectedIndex;
  const frames = (scope === SCOPE_DOCUMENT) ? documentFrames(doc) : selectedFrames(doc);
  if (frames.length === 0) {
    app.alert(scope === SCOPE_DOCUMENT
      ? 'No text frames found in the document.'
      : 'Select a text frame first (or choose "Whole document").', TITLE);
    return;
  }

  // -- Find + replace ------------------------------------------------------
  try {
    const builder = CompoundCommandBuilder.create();
    let total = 0, framesHit = 0;

    for (const frame of frames) {
      let text;
      try { text = frame.storyInterface.story.text; } catch (e) { continue; }
      if (typeof text !== 'string' || text.length === 0) continue;

      const matches = findMatches(text, buildRegex(find, chkCase.value, chkWord.value));
      if (matches.length === 0) continue;

      // Apply back-to-front so earlier ranges keep their indices as later
      // (higher-index) matches are replaced first.
      for (let i = matches.length - 1; i >= 0; i--) {
        builder.addCommand(replaceRangeCmd(doc, frame, matches[i].begin, matches[i].end, repl));
      }
      total += matches.length;
      framesHit++;
    }

    if (total === 0) {
      app.alert('No matches for "' + find + '".', TITLE);
      return;
    }

    doc.executeCommand(builder.createCommand());
    app.alert('Replaced ' + total + ' occurrence' + (total === 1 ? '' : 's') +
      ' of "' + find + '" across ' + framesHit + ' frame' + (framesHit === 1 ? '' : 's') + '.', TITLE);
  } catch (err) {
    app.alert('Find and replace failed:\n' + (err && err.message ? err.message : err), TITLE);
  }
}

main();
