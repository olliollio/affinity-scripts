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

// Strokes Weight Up: increases the stroke weight of every selected object by 1pt.

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { LineStyle, LineStyleMask } = require('/linestyle.js');
const { Selection } = require('/selections.js');

const StepPoints = 1;

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const nodes = doc.selection.nodes.filter(n => n.isVectorNode || n.isTextNode).toArray();
    if (nodes.length == 0) {
        alert("Please select one or more objects with a stroke");
        return;
    }
    const step = StepPoints * doc.dpi / 72;
    const builder = CompoundCommandBuilder.create();
    for (const node of nodes) {
        const lineStyle = LineStyle.createDefault();
        lineStyle.weight = Math.max(0, node.lineWeight + step);
        builder.addCommand(DocumentCommand.createSetLineStyle(Selection.create(doc, node), lineStyle, { lineStyleMask: LineStyleMask.Weight }));
    }
    doc.executeCommand(builder.createCommand());
}

module.exports.main = main;