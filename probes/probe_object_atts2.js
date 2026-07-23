'use strict';

/**
 * name: probe_object_atts2
 * description: Throwaway probe. Select ONE object (any kind), run it, and it
 *              dumps the real property names + values of the node — plus a dive
 *              into its fill/shape/curve interfaces and a corner/radius sweep —
 *              so we can wire the object-level Select Same matchers: Opacity,
 *              Blend mode, Corner radius, Shape. Delete after use.
 * author: olliollio
 *
 * Everything runs inside one try/catch that renders any error into a dialog,
 * so the script can never "silently do nothing" (console.log is invisible in
 * the Scripts panel). Dialog control count is hard-capped so a node with many
 * members can't overflow the non-scrollable dialog and abort the build.
 */

const { Document } = require('/document');
const { app } = require('/application');
const { Dialog } = require('/dialog');

const MAX_CONTROLS = 120;  // safety cap on total addStaticText calls
let budget = MAX_CONTROLS;

// Every own property name across an object's whole prototype chain.
function members(o) {
  if (o == null) return [];
  const out = []; let x = o;
  while (x && x !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(x)) out.push(k);
    x = Object.getPrototypeOf(x);
  }
  return [...new Set(out)].sort();
}

// Render a property as a short, safe string. Objects show their toStringTag.
function peek(obj, key) {
  let v;
  try { v = obj[key]; } catch (e) { return '<throws>'; }
  if (typeof v === 'function') return '<fn>';
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') {
    let s = String(v);
    return s.length > 44 ? s.slice(0, 44) + '…' : s;
  }
  let tag = 'object';
  try { if (v[Symbol.toStringTag]) tag = String(v[Symbol.toStringTag]); } catch (e) {}
  return '[' + tag + ']';
}

// Budget-aware line writer. Returns false once the cap is hit.
function line(group, label, text) {
  if (budget <= 0) return false;
  try { group.addStaticText(String(label), String(text)); } catch (e) { return true; }
  budget--;
  return true;
}

// Dump up to `max` non-function members of an object into a group.
function dump(group, obj, max) {
  if (!obj) { line(group, '', '(null)'); return; }
  let shown = 0;
  for (const k of members(obj)) {
    if (shown >= max || budget <= 0) break;
    const val = peek(obj, k);
    if (val === '<fn>') continue;
    line(group, k, val);
    shown++;
  }
}

// Try every known selection accessor, each in its own guard so one failing
// path can't skip the others. sel.items is iterable (for-of) but NOT index-
// accessible, so we never do sel.items[0].
function grabNode(sel) {
  let n = null;
  try { if (sel && sel.firstNode) n = sel.firstNode; } catch (e) {}
  if (!n) { try { if (sel && sel.nodes && sel.nodes.first) n = sel.nodes.first; } catch (e) {} }
  if (!n && sel && sel.nodes) { try { for (const x of sel.nodes) { if (x) { n = x; break; } } } catch (e) {} }
  if (!n && sel && sel.items) { try { for (const it of sel.items) { if (it && it.node) { n = it.node; break; } } } catch (e) {} }
  return n;
}

// When no node is found, dump what the selection actually looks like instead of
// dead-ending -- this is the data that tells us why detection failed.
function selDiag(rows, label, sel) {
  rows.push(['---- ' + label, '']);
  if (!sel) { rows.push(['', '(no selection object)']); return; }
  let tag = ''; try { tag = String(sel[Symbol.toStringTag] || ''); } catch (e) {}
  rows.push(['tag', tag || '(none)']);
  try { rows.push(['length', String(sel.length)]); } catch (e) { rows.push(['length', '<throws>']); }
  try { rows.push(['firstNode', sel.firstNode ? peek(sel, 'firstNode') : 'null']); } catch (e) { rows.push(['firstNode', '<throws>']); }
  try { rows.push(['nodes', sel.nodes ? peek(sel, 'nodes') : 'null']); } catch (e) { rows.push(['nodes', '<throws>']); }
  try { rows.push(['nodes.first', (sel.nodes && sel.nodes.first) ? peek(sel.nodes, 'first') : 'null']); } catch (e) { rows.push(['nodes.first', '<throws>']); }
  let ic = -1, firstKeys = '';
  try { ic = 0; for (const it of sel.items) { if (ic === 0 && it) firstKeys = members(it).slice(0, 8).join(', '); ic++; } }
  catch (e) { ic = -2; }
  rows.push(['items count (for-of)', ic === -2 ? '<not iterable / throws>' : String(ic)]);
  if (firstKeys) rows.push(['item[0] members', firstKeys]);
}

function run() {
  const doc = Document.current;
  if (!doc) return { title: 'Probe', lines: [['!', 'No document open.']] };

  let sel = null; try { sel = doc.selection; } catch (e) {}
  let node = grabNode(sel);

  // Second source: some selections only populate via app.documents.current.
  let altsel = null;
  if (!node) {
    try { const ad = app.documents.current; altsel = ad && ad.selection; } catch (e) {}
    node = grabNode(altsel);
  }

  if (!node) {
    const rows = [['NOTE', 'No node from either source. Selection shape below:']];
    selDiag(rows, 'Document.current.selection', sel);
    selDiag(rows, 'app.documents.current.selection', altsel);
    return { title: 'Probe — selection diagnostic', lines: rows };
  }

  const dlg = Dialog.create('Probe object atts');
  dlg.initialWidth = 660;
  const c1 = dlg.addColumn(); c1.widthProportion = 1;
  const c2 = dlg.addColumn(); c2.widthProportion = 1;

  let tag = '(no tag)';
  try { if (node[Symbol.toStringTag]) tag = String(node[Symbol.toStringTag]); } catch (e) {}
  const mem = members(node);

  // -- Column 1: node type + scalar member values (capped). -----------------
  const gType = c1.addGroup('node');
  line(gType, 'type', tag);
  line(gType, 'member count', String(mem.length));

  const gVal = c1.addGroup('member = value (scalars only)');
  for (const k of mem) {
    if (budget <= 60) break; // keep plenty of room for the column-2 shape dives
    const val = peek(node, k);
    if (val !== '<fn>' && val.charAt(0) !== '[') line(gVal, k, val);
  }

  // -- Column 2: targeted guesses + corner sweep + interface dives. ----------
  const present = new Set(mem);
  const guesses = [
    'opacity', 'opacityValue', 'alpha', 'opacityInterface',
    'blendMode', 'blendingMode', 'compositeMode', 'compositingMode', 'compositing', 'compositingInterface',
    'shapeType', 'isShape', 'isCurve', 'nodeType', 'name',
    'shape', 'shapeInterface', 'shapeParameters', 'parameters',
    'curvesInterface', 'geometryInterface', 'boundsInterface',
    'hasBrushFill', 'brushFillDescriptor', 'hasPenFill', 'penFillDescriptor',
  ];
  const gGuess = c2.addGroup('likely keys (exists? value)');
  let any = false;
  for (const k of guesses) {
    if (present.has(k)) { line(gGuess, k, peek(node, k)); any = true; }
  }
  if (!any) line(gGuess, '', '(none exist — see column 1)');

  // Rotation hunt: sweep member names for anything transform/angle-ish, then
  // dump any transform/matrix object (WITH its full member name list, so a
  // getRotation()-style method is visible too). Run this on a ROTATED object.
  const rotHits = mem.filter((k) => /rotat|angle|orient|transform|matrix|skew|shear/i.test(k));
  const gRot = c2.addGroup('name ~ rotat|angle|transform');
  if (rotHits.length === 0) line(gRot, '', '(no matching member)');
  for (const k of rotHits) { if (budget <= 0) break; line(gRot, k, peek(node, k)); }
  for (const tk of ['transform', 'localTransform', 'worldTransform', 'placement',
                    'orientation', 'rotation', 'rotationAngle']) {
    if (budget <= 0) break;
    if (!present.has(tk)) continue;
    let tv; try { tv = node[tk]; } catch (e) { tv = null; }
    if (tv && typeof tv === 'object') {
      const g = c2.addGroup(tk + ' ->');
      line(g, '(all members)', members(tv).slice(0, 24).join(', '));
      dump(g, tv, 14);
    } else if (tv != null) {
      line(c2.addGroup(tk + ' ->'), tk, String(tv));
    }
  }

  // Live-shape deep dive: expand each rounded-rect corner proxy (to reveal the
  // corner-RADIUS property + its value) and the shapeType enum (for a shape-kind
  // key). This is the whole point of this run, so it goes first.
  let shp = null; try { shp = node.shape; } catch (e) {}
  if (shp && typeof shp === 'object') {
    line(c2.addGroup('shape (scalars)'), 'absoluteSizes', peek(shp, 'absoluteSizes'));
    for (const ck of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
      if (budget <= 0) break;
      let cp; try { cp = shp[ck]; } catch (e) { cp = null; }
      if (cp && typeof cp === 'object') dump(c2.addGroup('shape.' + ck + ' ->'), cp, 12);
    }
    for (const sk of ['shapeType', 'majorAxis']) {
      if (budget <= 0) break;
      let sv; try { sv = shp[sk]; } catch (e) { sv = null; }
      if (sv && typeof sv === 'object') dump(c2.addGroup('shape.' + sk + ' ->'), sv, 8);
    }
  } else {
    line(c2.addGroup('shape'), '', '(no live shape — this node is a curve, not a shape)');
  }

  // Corner / border radius can also hide under a node member name -> sweep.
  const cornerHits = mem.filter((k) => /corner|radius|round/i.test(k));
  if (cornerHits.length > 0) {
    const gCorner = c2.addGroup('name ~ corner|radius|round');
    for (const k of cornerHits) {
      if (budget <= 0) break;
      line(gCorner, k, peek(node, k));
      let v; try { v = node[k]; } catch (e) { v = null; }
      if (v && typeof v === 'object') dump(gCorner, v, 8);
    }
  }

  return { dialog: dlg };
}

// -- Entry point: always shows a dialog, even on error. ----------------------
try {
  const r = run();
  if (r.dialog) {
    r.dialog.runModal();
  } else {
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
  let stack = '';
  try { stack = String(err.stack || ''); } catch (e) {}
  const linesArr = stack.split('\n').slice(0, 8);
  for (let i = 0; i < linesArr.length; i++) g.addStaticText('', linesArr[i]);
  d.runModal();
}
