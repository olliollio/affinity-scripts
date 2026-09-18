/*
BSD 3-Clause License

Copyright (c) 2026, Canva Pty Ltd.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

'use strict';

// Divides every segment of the selected curves into equal-length pieces.
// Handles are preserved. Previews live.

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { CurveBuilder, PolyCurve } = require('/geometry.js');
const { UnitType } = require('/units.js');

function isOk(result) {
    return (result?.value ?? result) == DialogResult.Ok.value;
}

function compound(cmds) {
    if (cmds.length == 0)
        return null;
    const builder = CompoundCommandBuilder.create();
    for (const cmd of cmds)
        builder.addCommand(cmd);
    return builder.createCommand();
}

// Applies a per-curve transform to every curve of every source, from the pre-preview snapshots.
function createCurvesCommand(sources, transformCurve) {
    const cmds = [];
    for (const { node, original } of sources) {
        const poly = PolyCurve.create();
        for (const curve of original)
            poly.addCurve(transformCurve(curve) ?? curve.clone());
        if (poly.curveCount > 0)
            cmds.push(DocumentCommand.createSetCurves(node.curvesInterface, poly));
    }
    return compound(cmds);
}

function selectedCurveSources(doc) {
    return doc.selection.nodes.filter(n => n.isPolyCurveNode).toArray()
        .map(node => ({ node, original: node.polyCurve.clone() }));
}

function previewLoop(doc, dlg, build, onCommit) {
    const update = (preview) => {
        const cmd = build();
        if (cmd)
            doc.executeCommand(cmd, preview);
        else
            doc.clearPreviews();
        return cmd;
    };
    dlg.onControlValueChangedHandler = () => update(true);
    update(true);
    if (isOk(dlg.runModal())) {
        const cmd = update(false);
        if (cmd && onCommit)
            onCommit(cmd);
    }
    doc.clearPreviews();
}

// Splits one cubic into `count` pieces of equal arc length.
function dividePieces(bez, count) {
    const pieces = [];
    let remaining = bez;
    const pieceLength = bez.length / count;
    for (let k = 1; k < count; ++k) {
        if (remaining.length <= pieceLength * 1e-6)
            break;
        const t = remaining.getParamAtLength(Math.min(pieceLength, remaining.length));
        const { left, right } = remaining.split(t);
        pieces.push(left);
        remaining = right;
    }
    pieces.push(remaining);
    return pieces;
}

function divideCurve(curve, count) {
    const bez = curve.beziers.toArray();
    if (bez.length == 0)
        return null;
    const b = CurveBuilder.create().beginXY(bez[0].start.x, bez[0].start.y);
    for (const segment of bez)
        for (const piece of dividePieces(segment, count))
            b.addBezierXY(piece.c1.x, piece.c1.y, piece.c2.x, piece.c2.y, piece.end.x, piece.end.y);
    if (curve.isClosed)
        b.close();
    return b.createCurve();
}

function buildDialog() {
    const dlg = Dialog.create("Divide Segments");
    const grp = dlg.addColumn().addGroup("Division");
    dlg.count = grp.addUnitValueEditor("Pieces per segment", UnitType.Number, UnitType.Number, 2, 2, 100).setPrecision(0);
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const sources = selectedCurveSources(doc);
    if (sources.length == 0) {
        alert("Please select one or more curve objects (convert shapes or text to curves first)");
        return;
    }
    const dlg = buildDialog();
    previewLoop(doc, dlg, () => createCurvesCommand(sources, curve => divideCurve(curve, Math.max(2, Math.round(dlg.count.value)))));
}

module.exports.main = main;