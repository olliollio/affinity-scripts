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
const { DocumentCommand, CompoundCommandBuilder } = require('/commands.js');
const { CurveBuilder, PolyCurve } = require('/geometry.js');

const doc = Document.current;

function createNewCurve(curve) {
    const builder = CurveBuilder.create();
    const firstPoint = curve.beziers.first?.start;
    if (!firstPoint)
        return;
    builder.begin(firstPoint);
    for (const bez of curve.beziers) {
        const t = bez.getParamAtLength(bez.length * 0.5);
        const curves = bez.split(t);
        builder.addBezierXY(curves.left.c1.x, curves.left.c1.y, curves.left.c2.x, curves.left.c2.y, curves.left.end.x, curves.left.end.y);
        builder.addBezierXY(curves.right.c1.x, curves.right.c1.y, curves.right.c2.x, curves.right.c2.y, curves.right.end.x, curves.right.end.y);
    }
    return builder.createCurve();
}

function createNewPolyCurve(polyCurve) {
    const newPolyCurve = PolyCurve.create();
    for (const curve of polyCurve) {
        const newCurve = createNewCurve(curve);
        if (newCurve) {
            newPolyCurve.addCurve(newCurve);
        }
    }
    return newPolyCurve;
}

function addPoints(polyCurveNodes) {
    const cmds = [];
    for (const polyCurveNode of polyCurveNodes) {
        const newPoly = createNewPolyCurve(polyCurveNode.polyCurve);
        if (newPoly.curveCount > 0) {
            cmds.push(DocumentCommand.createSetCurves(polyCurveNode.curvesInterface, newPoly));
        }
    }

    if (cmds.length == 0)
        return;
    if (cmds.length == 1)
        doc.executeCommand(cmds[0]);
    else {
        const builder = CompoundCommandBuilder.create();
        for (const cmd of cmds) {
            builder.addCommand(cmd);
        }
        doc.executeCommand(builder.createCommand());
    }
}

function main() {
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const nodes = doc.selection.nodes.filter(node => node.isPolyCurveNode);
    if (nodes.isEmpty) {
        alert("Select some curves");
        return;
    }
    addPoints(nodes);
}

module.exports.main = main;
