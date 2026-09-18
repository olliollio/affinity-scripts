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

// Counts the selected objects and reports a breakdown by type, including nested children.

const { Document } = require('/document.js');

function classify(node) {
    if (node.isImageNode)
        return "Images";
    if (node.isEmbeddedDocumentNode)
        return "Placed documents";
    if (node.isVectorNode && node.pictureFrameEnabled)
        return "Picture frames";
    if (node.isShapeNode)
        return "Shapes";
    if (node.isPolyCurveNode)
        return "Curves";
    if (node.isTextNode)
        return "Text";
    if (node.isGroupNode)
        return "Groups";
    if (node.isContainerNode)
        return "Layers";
    return "Other";
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const nodes = doc.selection.nodes.toArray();
    if (nodes.length == 0) {
        alert("Nothing is selected");
        return;
    }

    const counts = new Map();
    const tally = node => counts.set(classify(node), (counts.get(classify(node)) ?? 0) + 1);
    let nested = 0;
    for (const node of nodes) {
        tally(node);
        for (const child of node.children.all) {
            tally(child);
            ++nested;
        }
    }

    const lines = [`${nodes.length} selected object${nodes.length == 1 ? "" : "s"}`];
    if (nested > 0)
        lines.push(`${nested} nested object${nested == 1 ? "" : "s"} inside them`);
    lines.push("");
    for (const [type, count] of [...counts].sort((a, b) => b[1] - a[1]))
        lines.push(`${type}: ${count}`);
    alert(lines.join("\n"));
}

module.exports.main = main;