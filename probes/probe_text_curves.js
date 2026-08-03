/**
 * name: probe_text_curves
 * description: Discovery probe - can a live text node's full glyph outlines be read, or must it be converted first?
 * version: 0.1.0
 * author: ollio
 *
 * USAGE: select ONE live text object (art text or a text frame). Run and copy the CONSOLE output.
 * READ-ONLY: this probe never modifies the document.
 *
 * probe_shape_sources found that an ArtTextNode DOES expose curvesInterface, but reports
 * curveCount === 1 for a whole string — apparently a single glyph. extract.js refuses text on that
 * basis. Two things were never checked, and either would change that:
 *
 *   1. `curvesInterface.polyPolyCurves` — PLURAL. It was listed as a member and never read. If it
 *      holds one PolyCurve per glyph, text needs no conversion at all and nothing is destroyed.
 *   2. Whether a convert-to-curves COMMAND exists. The reference says many DocumentCommand.create*
 *      statics are undocumented and to enumerate them, so this dumps the list.
 *
 * Reading outlines directly beats converting: converting rewrites the user's document and throws
 * away editable text, which is a poor thing to do behind a checkbox.
 */

function L(label, text) { console.log(label + ': ' + text); }
function H(title) { console.log(''); console.log('===== ' + title + ' ====='); }

function safe(fn) {
  try { var v = fn(); return (v === undefined) ? 'undefined' : String(v); }
  catch (e) { return 'ERR: ' + (e && e.message ? e.message : e); }
}

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

function pt(p) {
  try { return '(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ')'; } catch (e) { return '(?)'; }
}

/** Counts curves and closed rings in a PolyCurve, plus where it sits, to tell glyphs apart. */
function describePolyCurve(label, pc) {
  if (!pc) { L('    ' + label, String(pc)); return; }
  var count = safe(function () { return pc.curveCount; });
  L('    ' + label, 'curveCount=' + count);
  var n = 0;
  try { n = pc.curveCount; } catch (e) { return; }
  var shown = Math.min(n, 8);
  for (var i = 0; i < shown; i++) {
    (function (idx) {
      L('      curve[' + idx + ']', safe(function () {
        var c = pc.at(idx);
        var segs = 0, first = null;
        for (var b of c.beziers) { if (!first) first = b; segs++; if (segs > 4000) break; }
        return 'closed=' + c.isClosed + ' beziers=' + segs +
               ' startsAt=' + (first ? pt(first.start) : '?') +
               ' len=' + safe(function () { return c.length.toFixed(2); });
      }));
    })(i);
  }
  if (n > shown) console.log('      (' + (n - shown) + ' more curves not shown)');
}

function main() {
  console.log('######## probe_text_curves v0.1.0 ########');

  var doc;
  try { doc = require('/application').app.documents.current; }
  catch (e) { console.log('Could not reach the document: ' + (e && e.message || e)); return; }
  if (!doc) { console.log('No open document.'); return; }

  var nodes = [];
  L('selection', safe(function () {
    for (var n of doc.selection.nodes) nodes.push(n);
    return nodes.length + ' node(s)';
  }));
  if (!nodes.length) { console.log('Select a text object and run again.'); return; }

  var node = nodes[0];
  L('node', safe(function () { return node[Symbol.toStringTag] + ' "' + node.description + '"'; }));
  L('isTextNode', safe(function () { return node.isTextNode; }));
  L('text', safe(function () { return node.text || (node.getText && node.getText()); }));

  // ------------------------------------------------------- 1. the plural one
  H('1. curvesInterface.polyPolyCurves — does it hold every glyph?');

  var ci = null;
  try { ci = node.curvesInterface; } catch (e) { /* reported below */ }
  if (!ci) { console.log('  no curvesInterface'); }
  else {
    L('  ci members', safe(function () { return members(ci).join(', '); }));

    describePolyCurve('polyCurve (known to report 1)', safe(function () { return ci.polyCurve; }) === 'ERR' ? null : ci.polyCurve);

    var ppc = null;
    try { ppc = ci.polyPolyCurves; } catch (e) { L('  polyPolyCurves', 'ERR: ' + (e && e.message || e)); }
    L('  polyPolyCurves', safe(function () { return String(ppc) + '  toStringTag=' + (ppc && ppc[Symbol.toStringTag]); }));
    L('  polyPolyCurves members', safe(function () { return members(ppc).join(', '); }));

    // It is probably a Collection, which probe_curve_readout showed supports .length / .at / for..of.
    L('  .length', safe(function () { return ppc.length; }));
    L('  .curveCount', safe(function () { return ppc.curveCount; }));
    L('  Array.from length', safe(function () { return Array.from(ppc).length; }));

    L('  iterate', safe(function () {
      var i = 0;
      for (var sub of ppc) {
        console.log('    [' + i + '] ' + String(sub) + ' tag=' + (sub && sub[Symbol.toStringTag]));
        describePolyCurve('sub[' + i + ']', sub);
        if (++i >= 6) { console.log('    (stopping after 6)'); break; }
      }
      return i + ' entries iterated';
    }));

    L('  .at(0)', safe(function () {
      var sub = ppc.at(0);
      return String(sub) + ' tag=' + (sub && sub[Symbol.toStringTag]) +
             ' curveCount=' + (sub && sub.curveCount);
    }));
  }

  // --------------------------------------------- 2. is there a convert command?
  H('2. Undocumented DocumentCommand factories');

  L('  DocumentCommand statics', safe(function () {
    var DocumentCommand = require('/commands').DocumentCommand;
    var all = members(DocumentCommand).filter(function (k) {
      return k.indexOf('create') === 0;
    });
    return all.join(', ');
  }));

  // Anything whose name suggests outlining, expanding or converting is the lead.
  L('  likely convert factories', safe(function () {
    var DocumentCommand = require('/commands').DocumentCommand;
    var hits = members(DocumentCommand).filter(function (k) {
      return /curve|outline|expand|convert|flatten|rasteri/i.test(k);
    });
    return hits.length ? hits.join(', ') : '(none by name)';
  }));

  L('  /commands exports', safe(function () { return Object.keys(require('/commands')).join(', '); }));

  console.log('');
  console.log('######## end ########');
}

main();
