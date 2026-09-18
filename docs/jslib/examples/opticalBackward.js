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

// Optical Backward: moves the selection backward in the z-order past the nearest sibling whose
// bounds overlap it, so every step produces a visible change. Ordinary "Back One"
// steps past siblings that may not touch the selection at all.

const { DocumentCommand, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { rectsIntersect, unionRects } = require('/geometry.js');

const Forward = false;

function opticalMove(doc, forward) {
    const nodes = doc.selection.nodes.toArray();
    if (nodes.length == 0) {
        alert("Please select one or more objects");
        return;
    }
    const parent = nodes[0].parent;
    if (!parent || nodes.some(n => !n.parent || !n.parent.isSameNode(parent))) {
        alert("The selected objects must share the same parent");
        return;
    }

    // Children run back to front; the selection's siblings and its extent.
    const siblings = parent.children.toArray();
    const isSelected = siblings.map(s => nodes.some(n => n.isSameNode(s)));
    const bounds = nodes.map(n => n.getSpreadVisibleBox()).reduce((a, b) => unionRects(a, b));

    // Nearest sibling beyond the selection, in the direction of travel, that overlaps it.
    const indices = isSelected.flatMap((sel, i) => sel ? [i] : []);
    const start = forward ? Math.max(...indices) + 1 : Math.min(...indices) - 1;
    const step = forward ? 1 : -1;
    let target = null;
    for (let i = start; i >= 0 && i < siblings.length; i += step) {
        if (!isSelected[i] && rectsIntersect(bounds, siblings[i].getSpreadVisibleBox())) {
            target = siblings[i];
            break;
        }
    }
    if (!target)
        return;
    doc.executeCommand(DocumentCommand.createMoveNodes(doc.selection, target, forward ? NodeMoveType.After : NodeMoveType.Before));
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    opticalMove(doc, Forward);
}

module.exports.main = main;