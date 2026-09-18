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

const {ErrorCode} = require('affinity:common');
const {Document} = require('/document.js');
const {DocumentPreset, NewDocumentOptions, DocumentPresetType} = require('/document.js');
const {DocumentCommand, AddChildNodesCommandBuilder} = require('/commands.js')
const {TestUtils} = require('/tests/testUtils.js');
const {ShapeNodeDefinition, NodeChildType, ImageNodeDefinition} = require('/nodes.js');
const {Selection} = require('/selections.js');
const {PixelBuffer, RasterFormat} = require('/rasterobject.js');

function testRasteriseObjects() {
    let doc = TestUtils.getA4Empty();
    let builder = AddChildNodesCommandBuilder.create();
    let snd = ShapeNodeDefinition.createDefault();
    builder.addNode(snd);
    let cmd = builder.createCommand(false, NodeChildType.Main);
    let result = doc.executeCommand(cmd);
    
    let node = doc.layers.first;
    console.assert(node.isVectorNode);
    
    let sel = Selection.create(doc, node);
    
    let rasteriseCmd = DocumentCommand.createRasteriseObjects(sel, false, false);
    doc.executeCommand(rasteriseCmd);
    
    let test = doc.layers.first;
    console.assert(test.isRasterNode);
    console.log("testRasteriseObjects OK");
    doc.close();
}

function testConvertToCurves() {
    let doc = TestUtils.getA4Empty();
    let builder = AddChildNodesCommandBuilder.create();
    let rnd = ImageNodeDefinition.create(RasterFormat.RGBA8);
   
    rnd.bitmap = TestUtils.getRandomRGBA8Bitmap(200, 200);
    builder.addNode(rnd);
    let cmd = builder.createCommand(false, NodeChildType.Main);
    let result = doc.executeCommand(cmd);
    
    let node = doc.layers.first;
    console.assert(node.isImageNode);
    
    let sel = Selection.create(doc, node);
    
    let toCurve = DocumentCommand.createConvertToCurves(sel);
    doc.executeCommand(toCurve);
    
    let test = doc.layers.first;
    console.assert(test.isVectorNode);
    console.log("testConvertToCurves OK");
    doc.close();
}

function runTests() {
    testRasteriseObjects();
    testConvertToCurves();
}

module.exports.runTests = runTests;
module.exports.testRasteriseObjects = testRasteriseObjects;
module.exports.testConvertToCurves = testConvertToCurves;
