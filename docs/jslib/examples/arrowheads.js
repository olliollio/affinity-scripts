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

// Applies arrowheads to the start and end of the selected curves' strokes, with a scale
// factor. Previews live.

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { ArrowHead, ArrowHeadStyle } = require('/linestyle.js');
const { Selection } = require('/selections.js');
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

const StyleNames = ["None", "Triangle", "Triangle Tall", "Triangle Wide", "Curved", "Barbed", "Simple", "Simple Tall", "Simple Wide",
    "Simple Closed", "Simple Closed Tall", "Simple Closed Wide", "Circle", "Circle Solid", "Square", "Square Solid", "Bar"];
const Styles = [null, ArrowHeadStyle.Triangle, ArrowHeadStyle.TriangleTall, ArrowHeadStyle.TriangleWide, ArrowHeadStyle.Curved,
    ArrowHeadStyle.Barbed, ArrowHeadStyle.Simple, ArrowHeadStyle.SimpleTall, ArrowHeadStyle.SimpleWide, ArrowHeadStyle.SimpleClosed,
    ArrowHeadStyle.SimpleClosedTall, ArrowHeadStyle.SimpleClosedWide, ArrowHeadStyle.Circle, ArrowHeadStyle.CircleSolid,
    ArrowHeadStyle.Square, ArrowHeadStyle.SquareSolid, ArrowHeadStyle.Bar];

function arrowHead(index, scale) {
    const style = Styles[index];
    return style ? ArrowHead.create(style, { scaleX: scale, scaleY: scale }) : null;
}

function createArrowsCommand(doc, sources, opts) {
    const cmds = sources.map(({ node, descriptor }) =>
        DocumentCommand.createSetLineStyleDescriptor(Selection.create(doc, node),
            descriptor.cloneWithNewArrowHeads(arrowHead(opts.start, opts.scale), arrowHead(opts.end, opts.scale))));
    return compound(cmds);
}

function buildDialog() {
    const dlg = Dialog.create("Arrowheads");
    const grp = dlg.addColumn().addGroup("Arrowheads");
    dlg.start = grp.addComboBox("Start", StyleNames, 0);
    dlg.end = grp.addComboBox("End", StyleNames, 1);
    dlg.scale = grp.addUnitValueEditor("Scale %", UnitType.Number, UnitType.Number, 100, 10, 1000).setPrecision(0);
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const sources = doc.selection.nodes.filter(n => n.isVectorNode && !n.isImageNode).toArray()
        .map(node => ({ node, descriptor: node.lineStyleDescriptor }));
    if (sources.length == 0) {
        alert("Please select one or more curves or shapes with a stroke");
        return;
    }
    const dlg = buildDialog();
    previewLoop(doc, dlg, () => createArrowsCommand(doc, sources, { start: dlg.start.selectedIndex, end: dlg.end.selectedIndex, scale: dlg.scale.value / 100 }));
}

module.exports.main = main;
