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

// Step and repeat: duplicates the selection a number of times, each copy offset, rotated and
// scaled a little more than the last. Previews live.

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { Transform, unionRects } = require('/geometry.js');
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

function createRepeatCommand(selection, centre, opts) {
    const cmds = [];
    for (let i = 1; i <= opts.count; ++i) {
        const scale = Math.pow(1 + opts.scaleStep / 100, i);
        const xf = Transform.createTranslate(centre.x + opts.dx * i, centre.y + opts.dy * i)
            .multiply(Transform.createRotate(opts.rotationStep * i * Math.PI / 180))
            .multiply(Transform.createScale(scale, scale))
            .multiply(Transform.createTranslate(-centre.x, -centre.y));
        cmds.push(DocumentCommand.createTransform(selection, xf, { duplicateNodes: true }));
    }
    return compound(cmds);
}

function buildDialog(doc, defaultOffset) {
    const dlg = Dialog.create("Step and Repeat");
    const col = dlg.addColumn();
    const repeat = col.addGroup("Repeat");
    dlg.count = repeat.addUnitValueEditor("Copies", UnitType.Number, UnitType.Number, 3, 1, 500).setPrecision(0);
    const step = col.addGroup("Each copy");
    dlg.dx = step.addUnitValueEditor("Move horizontally", UnitType.Pixel, doc.units, defaultOffset);
    dlg.dy = step.addUnitValueEditor("Move vertically", UnitType.Pixel, doc.units, 0);
    dlg.rotationStep = step.addUnitValueEditor("Rotate (°)", UnitType.Number, UnitType.Number, 0, -360, 360).setPrecision(1);
    dlg.scaleStep = step.addUnitValueEditor("Scale (%)", UnitType.Number, UnitType.Number, 0, -90, 400).setPrecision(1);
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const selection = doc.selection;
    const nodes = selection.nodes.toArray();
    if (nodes.length == 0) {
        alert("Please select one or more objects");
        return;
    }
    const bounds = nodes.map(n => n.getSpreadBaseBox()).reduce((a, b) => unionRects(a, b));
    const centre = bounds.centre;
    const dlg = buildDialog(doc, bounds.width * 1.2);
    previewLoop(doc, dlg, () => createRepeatCommand(selection, centre, {
        count: Math.max(1, Math.round(dlg.count.value)),
        dx: dlg.dx.value, dy: dlg.dy.value,
        rotationStep: dlg.rotationStep.value, scaleStep: dlg.scaleStep.value
    }));
}

module.exports.main = main;