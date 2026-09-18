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

const { Document } = require('/document.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Rectangle, Transform } = require('/geometry.js');
const { FrameTextNodeDefinition, ShapeNodeDefinition } = require('/nodes.js');
const { Selection } = require('/selections.js');
const { ShapeRectangle } = require('/shapes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { UnitType } = require('/units.js');

const FrameType = Object.freeze({ Rectangle: 0, Text: 1, Picture: 2 });

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

function cellRects(rc, rows, cols, rowGutter, colGutter) {
    const cellW = (rc.width - colGutter * (cols - 1)) / cols;
    const cellH = (rc.height - rowGutter * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0)
        return [];
    const cells = [];
    for (let r = 0; r < rows; ++r)
        for (let c = 0; c < cols; ++c)
            cells.push(new Rectangle(rc.x + c * (cellW + colGutter), rc.y + r * (cellH + rowGutter), cellW, cellH));
    return cells;
}

// Spread-space transform mapping rectangle `from` onto rectangle `to`.
function fitTransform(from, to) {
    return Transform.createTranslate(to.x, to.y)
        .multiply(Transform.createScale(to.width / from.width, to.height / from.height))
        .multiply(Transform.createTranslate(-from.x, -from.y));
}

function createFrameDefinition(doc, rect, frameType) {
    if (frameType == FrameType.Text) {
        const sb = StoryBuilder.create();
        sb.setToFrameTextDefaultStyle(doc.dpi, doc.rasterFormat);
        return FrameTextNodeDefinition.createFromStoryBuilder(rect, sb);
    }
    const def = ShapeNodeDefinition.createDefault();
    def.shape = ShapeRectangle.create();
    def.setBoundingRectangle(rect);
    if (frameType == FrameType.Picture)
        def.setPictureFrameEnabled(true);
    return def;
}

// Previews change the document, so the cell layout comes from boxes captured up front.
function createGridCommand(doc, sources, opts) {
    const cmds = [];
    const originals = [];
    for (const { node, rc } of sources) {
        const cells = cellRects(rc, opts.rows, opts.cols, opts.rowGutter, opts.colGutter);
        if (cells.length == 0)
            continue;
        if (opts.retain) {
            for (const cell of cells)
                cmds.push(DocumentCommand.createTransform(Selection.create(doc, node), fitTransform(rc, cell), { duplicateNodes: true }));
        }
        else {
            const builder = AddChildNodesCommandBuilder.create();
            for (const cell of cells)
                builder.addNode(createFrameDefinition(doc, cell, opts.frameType));
            cmds.push(builder.createCommand(false));
        }
        originals.push(node);
    }
    if (opts.deleteOriginal && originals.length > 0)
        cmds.push(DocumentCommand.createDeleteSelection(Selection.create(doc, originals)));
    return compound(cmds);
}

function readOptions(dlg) {
    return {
        rows: Math.round(dlg.rows.value),
        cols: Math.round(dlg.cols.value),
        rowGutter: dlg.rowGutter.value,
        colGutter: dlg.colGutter.value,
        frameType: dlg.frameType.selectedIndex,
        retain: dlg.retain.value,
        deleteOriginal: dlg.deleteOriginal.value
    };
}

function buildDialog(doc) {
    const pt = doc.dpi / 72;
    const dlg = Dialog.create("Make Grid");
    const col = dlg.addColumn();

    const grid = col.addGroup("Grid");
    dlg.rows = grid.addUnitValueEditor("Rows", UnitType.Number, UnitType.Number, 2, 1, 1000).setPrecision(0);
    dlg.cols = grid.addUnitValueEditor("Columns", UnitType.Number, UnitType.Number, 2, 1, 1000).setPrecision(0);
    dlg.rowGutter = grid.addUnitValueEditor("Row gutter", UnitType.Pixel, doc.units, 12 * pt, 0).setNoMaxValue();
    dlg.colGutter = grid.addUnitValueEditor("Column gutter", UnitType.Pixel, doc.units, 12 * pt, 0).setNoMaxValue();

    const opts = col.addGroup("Options");
    dlg.retain = opts.addSwitch("Duplicate original into each cell", true);
    dlg.frameType = opts.addComboBox("Frame type", ["Rectangle", "Text frame", "Picture frame"], FrameType.Rectangle);
    const updateFrameType = () => dlg.frameType.isEnabled = !dlg.retain.value;
    dlg.retain.onValueChangedHandler = updateFrameType;
    updateFrameType();
    dlg.deleteOriginal = opts.addSwitch("Delete original object", true);
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const nodes = doc.selection.nodes.toArray();
    if (nodes.length == 0) {
        alert("Please select one or more objects");
        return;
    }
    const sources = nodes.map(node => ({ node, rc: node.getSpreadBaseBox() }));
    const dlg = buildDialog(doc);
    const update = (preview) => {
        const cmd = createGridCommand(doc, sources, readOptions(dlg));
        if (cmd)
            doc.executeCommand(cmd, preview);
        else
            doc.clearPreviews();
        return cmd;
    };
    dlg.onControlValueChangedHandler = () => update(true);
    update(true);
    while (isOk(dlg.runModal())) {
        const cmd = update(false);
        if (cmd) {
            const newNodes = cmd.newNodes;
            if (newNodes.length > 0)
                doc.selection = Selection.create(doc, newNodes);
            break;
        }
        alert("The gutters leave no room for the cells");
    }
    doc.clearPreviews();
}

module.exports.main = main;