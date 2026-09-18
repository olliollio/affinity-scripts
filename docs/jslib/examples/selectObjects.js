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

const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { ShapeType } = require('/shapes.js');

function isOk(result) {
    return (result?.value ?? result) == DialogResult.Ok.value;
}

function matches(node, opts) {
    if (node.isImageNode)
        return opts.images;
    if (node.isEmbeddedDocumentNode)
        return opts.placedDocuments;
    if (node.isVectorNode && node.pictureFrameEnabled)
        return opts.pictureFrames;
    if (node.isShapeNode) {
        const type = node.shapeType.value;
        if (type == ShapeType.Rectangle.value)
            return opts.rectangles;
        if (type == ShapeType.Ellipse.value)
            return opts.ellipses;
        return opts.otherShapes;
    }
    if (node.isPolyCurveNode)
        return opts.curves;
    if (node.isFrameTextNode)
        return opts.textFrames;
    if (node.isTextNode)
        return opts.otherText;
    if (node.isGroupNode)
        return opts.groups;
    return false;
}

function selectObjects(doc, opts) {
    const candidates = opts.currentSpreadOnly ? doc.currentSpread.children.all : doc.rootNode.children.all;
    const nodes = [];
    for (const node of candidates) {
        if (matches(node, opts))
            nodes.push(node);
    }
    if (nodes.length == 0) {
        alert(opts.currentSpreadOnly ? "No matching objects on the current spread" : "No matching objects in the document");
        return;
    }
    doc.selection = Selection.create(doc, nodes, true);
}

function buildDialog() {
    const dlg = Dialog.create("Select Objects");
    const col = dlg.addColumn();
    const grp = col.addGroup("Select");
    dlg.rectangles = grp.addSwitch("Rectangles", true);
    dlg.ellipses = grp.addSwitch("Ellipses", true);
    dlg.otherShapes = grp.addSwitch("Other shapes", true);
    dlg.curves = grp.addSwitch("Curves", true);
    dlg.textFrames = grp.addSwitch("Text frames", true);
    dlg.otherText = grp.addSwitch("Other text", true);
    dlg.groupsSwitch = grp.addSwitch("Groups", true);
    dlg.pictureFrames = grp.addSwitch("Picture frames", true);
    dlg.images = grp.addSwitch("Images", true);
    dlg.placedDocuments = grp.addSwitch("Placed documents", true);

    const switches = [
        dlg.rectangles, dlg.ellipses, dlg.otherShapes, dlg.curves, dlg.textFrames,
        dlg.otherText, dlg.groupsSwitch, dlg.pictureFrames, dlg.images, dlg.placedDocuments
    ];
    const row = col.addGroup("").addColumnStack();
    const addButton = (label, setValue) => {
        const button = row.addColumn().addGroup().addButton(label).setIsFullWidth();
        button.onClickHandler = () => switches.forEach(sw => sw.value = setValue(sw.value));
    };
    addButton("All", () => true);
    addButton("None", () => false);
    addButton("Invert", v => !v);

    const scope = col.addGroup("Scope");
    dlg.currentSpreadOnly = scope.addSwitch("Current spread only", true);
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const dlg = buildDialog();
    if (!isOk(dlg.runModal()))
        return;
    selectObjects(doc, {
        rectangles: dlg.rectangles.value,
        ellipses: dlg.ellipses.value,
        otherShapes: dlg.otherShapes.value,
        curves: dlg.curves.value,
        textFrames: dlg.textFrames.value,
        otherText: dlg.otherText.value,
        groups: dlg.groupsSwitch.value,
        pictureFrames: dlg.pictureFrames.value,
        images: dlg.images.value,
        placedDocuments: dlg.placedDocuments.value,
        currentSpreadOnly: dlg.currentSpreadOnly.value
    });
}

module.exports.main = main;