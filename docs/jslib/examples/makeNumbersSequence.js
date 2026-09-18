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

// Fills the selected text objects with a numbered sequence, with optional prefix, suffix and
// zero padding, ordered by selection, left to right or top to bottom. Previews live.

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { UnitType } = require('/units.js');

const Order = Object.freeze({ Selection: 0, LeftToRight: 1, TopToBottom: 2 });

function isOk(result) {
    return (result?.value ?? result) == DialogResult.Ok.value;
}

function storySelection(doc, node) {
    const selection = Selection.create(doc, node);
    selection.addSubSelectionForNode(node, TextSelection.create(node.storyRange));
    return selection;
}

function orderNodes(sources, order) {
    const sorted = sources.slice();
    if (order == Order.LeftToRight)
        sorted.sort((a, b) => a.rc.x - b.rc.x || a.rc.y - b.rc.y);
    else if (order == Order.TopToBottom)
        sorted.sort((a, b) => a.rc.y - b.rc.y || a.rc.x - b.rc.x);
    return sorted;
}

function formatNumber(value, opts) {
    const negative = value < 0;
    let digits = String(Math.abs(value));
    if (opts.padding > digits.length)
        digits = "0".repeat(opts.padding - digits.length) + digits;
    return opts.prefix + (negative ? "-" : "") + digits + opts.suffix;
}

function createSequenceCommand(doc, sources, opts) {
    const builder = CompoundCommandBuilder.create();
    orderNodes(sources, opts.order).forEach(({ node }, i) => {
        const text = formatNumber(opts.start + i * opts.increment, opts);
        builder.addCommand(DocumentCommand.createSetText(storySelection(doc, node), text));
    });
    return builder.createCommand();
}

function buildDialog() {
    const dlg = Dialog.create("Make Numbers Sequence");
    const col = dlg.addColumn();

    const numbers = col.addGroup("Numbers");
    dlg.start = numbers.addUnitValueEditor("Start at", UnitType.Number, UnitType.Number, 1).setPrecision(0);
    dlg.increment = numbers.addUnitValueEditor("Increment", UnitType.Number, UnitType.Number, 1).setPrecision(0);
    dlg.padding = numbers.addUnitValueEditor("Minimum digits", UnitType.Number, UnitType.Number, 1, 1, 12).setPrecision(0);

    const text = col.addGroup("Text");
    dlg.prefix = text.addTextBox("Prefix", "");
    dlg.suffix = text.addTextBox("Suffix", "");

    const order = col.addGroup("Order");
    dlg.order = order.addButtonSet("Number by", ["Selection", "Left to right", "Top to bottom"], Order.LeftToRight);
    dlg.initialWidth = 380;
    return dlg;
}

function readOptions(dlg) {
    return {
        start: Math.round(dlg.start.value),
        increment: Math.round(dlg.increment.value),
        padding: Math.round(dlg.padding.value),
        prefix: dlg.prefix.text,
        suffix: dlg.suffix.text,
        order: dlg.order.selectedIndex
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const nodes = doc.selection.nodes.filter(n => n.isTextNode && !n.isTableTextNode).toArray();
    if (nodes.length == 0) {
        alert("Please select one or more text objects");
        return;
    }
    const sources = nodes.map(node => ({ node, rc: node.getSpreadBaseBox() }));
    const dlg = buildDialog();
    const update = (preview) => doc.executeCommand(createSequenceCommand(doc, sources, readOptions(dlg)), preview);
    dlg.onControlValueChangedHandler = () => update(true);
    update(true);
    if (isOk(dlg.runModal()))
        update(false);
    doc.clearPreviews();
}

module.exports.main = main;