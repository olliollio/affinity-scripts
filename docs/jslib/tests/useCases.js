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
const {app} = require('/application.js');
const {GaussianBlurFilterRasterNodeDefinition, ExposureAdjustmentRasterNodeDefinition, createTypedNode, Node, NodeChildType, AddNoiseType} = require('/nodes.js');
const {PolyCurveNodeDefinition, ShapeNodeDefinition} = require('/nodes.js');
const dommodule = require('affinity:dom');
const {DocumentCommand, AddChildNodesCommandBuilder, InsertionMode} = require('/commands.js');
const {Document, DocumentPromises} = require('/document.js');
const {Shape, ShapeType} = require('/shapes.js');
const {Fill, FillDescriptor} = require('/fills.js');
const {BlendMode} = require('affinity:common');
const {Rectangle, PolyCurve} = require('/geometry.js');
const {LineStyleDescriptor, LineType} = require('/linestyle.js');
const {Colour, RGBA8, ColourSpaceType, SVG11} = require('/colours.js');
const {ErrorCode} = require('affinity:common');
const {Selection} = require('/selections.js');
const {TestUtils} = require('/tests/testUtils.js');
const {PixelReaderWriterRGBA8} = require('/pixelaccessor.js');

function BisectCurves(curves) {
    let resCurves = [];
    for (const curve of curves) {
        let result = curve.cut(true, 0.5);
        resCurves.push(result.curveA);
        resCurves.push(result.curveB);
    }
    return resCurves;
}

function JitterCurve(curve) {
    for (let i = 0; i < curve.pointCount; i++) {
        let p = curve.getPoint(i);
        p.x += (Math.random() - 0.5) * 100;
        p.y += (Math.random() - 0.5) * 100;
        curve.setPoint(i, p);
    }
}

function UseCaseJitterCurve() {
    let doc = TestUtils.newA4Empty();
    
    let cat = Shape.create(ShapeType.Cat3);
    let box = new Rectangle(0, 0, 2048, 2048);
    const brushFill = FillDescriptor.createSolid(SVG11.red, BlendMode.Normal);
    const lineFill = FillDescriptor.createSolid(SVG11.green, BlendMode.Normal);
    const lineStyle = LineStyleDescriptor.createDefault(3);
    const transFill = FillDescriptor.createSolid(SVG11.blue, BlendMode.ColourBurn);
    
    let snd = ShapeNodeDefinition.create(cat, box, brushFill, lineFill, lineStyle, transFill);
    let acnBuilder = AddChildNodesCommandBuilder.create();
    acnBuilder.addNode(snd);
    let anCommand = acnBuilder.createCommand(false, NodeChildType.Main);
    let result = doc.executeCommand(anCommand);
    
    let sn = doc.layers.first;
    
    let sel = Selection.create(doc, sn);
    let toCurve = DocumentCommand.createConvertToCurves(sel);
    doc.executeCommand(toCurve);
    
    let cn = doc.layers.first;
    
    let iface = cn.curvesInterface;
    let pCurves = iface.polyCurve;
    
    let newCurves = pCurves.clone();
    for (let i = 0; i < 9; i++) {
        newCurves = BisectCurves(newCurves);
    }
    
    let polyCurve = new PolyCurve();
    for (let c of newCurves) {
        JitterCurve(c);
        polyCurve.addCurve(c);
    }
    
    let pcNodeDef = PolyCurveNodeDefinition.create(polyCurve, brushFill, lineFill, lineStyle, transFill);
    
    acnBuilder.addPolyCurveNode(pcNodeDef);
    
    let anCommand2 = acnBuilder.createCommand();
    let result2 = doc.executeCommand(anCommand2);
    
    doc.close();
}


function UseCaseCyaniseLowLuminosity() {
    let doc = Document.current;
    //let doc = TestUtils.getFile("CyanisePixel.affinity");
    
    let sumPixCount = 0;
    let destColour = {r:0, g:255, b:255, alpha:255*0.75};
    for (var child of doc.layers) {
        if (child.isRasterNode) {
            let bmp = child.rasterInterface.createCompatibleBitmap(true);
            let rw = PixelReaderWriterRGBA8.create(bmp);
            let changed = false;
            for (var y = 0; y < bmp.height; ++y) {
                for (var x = 0; x < bmp.width; ++x) {
                    let px = rw.readPixel(x, y);
                    let pxColour = Colour.createRGBA8(px);
                    let lumino = pxColour.hsl.l;
                    if (lumino < 0.2 && !(px.r == 0 && px.g == 0 && px.b == 0 && px.alpha == 0)) {
                        changed = true;
                        sumPixCount += 1;
                        rw.writePixel(x, y, destColour);
                    }
                }
            }
            if (changed) {
                let sel = Selection.create(doc, child);
                let cmd = DocumentCommand.createReplaceBitmap(sel, bmp);
                doc.executeCommand(cmd);
            }
        }
    }
    
    console.log("Changed pixel count: " + sumPixCount);
    
    doc.close();
}

module.exports.UseCaseJitterCurve = UseCaseJitterCurve;
module.exports.UseCaseCyaniseLowLuminosity = UseCaseCyaniseLowLuminosity;
