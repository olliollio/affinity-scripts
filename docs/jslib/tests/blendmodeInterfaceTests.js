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

const { TestUtils } = require('/tests/testUtils.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { DocumentCommand } = require('/commands.js');
const { ShapeNodeDefinition, NodeChildType } = require('/nodes.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { Spline, SplineProfile } = require('/geometry.js');
const { BlendMode, AntialiasingMode } = require('/blendmodeinterface.js');

function testBlendModeInterface() {
    let doc = TestUtils.newA4Empty();
    
    let shapeDef = ShapeNodeDefinition.createDefault();
    
    let acnBuilder = AddChildNodesCommandBuilder.create();
    acnBuilder.addNode(shapeDef);
    let addCommand = acnBuilder.createCommand(false, NodeChildType.Main);
    doc.executeCommand(addCommand);
    
    let shapeNode = doc.layers.first;
    console.assert(shapeNode.isShapeNode, "Should be a ShapeNode");
    
    let blendModeIface = shapeNode.blendModeInterface;
    console.assert(blendModeIface.isBlendModeInterface, "Should have BlendModeInterface");
    
    let initialBlendMode = blendModeIface.blendMode;
    console.assert(initialBlendMode !== undefined, "Should have blend mode");
    
    let antialiasingMode = blendModeIface.antialiasingMode;
    console.assert(antialiasingMode !== undefined, "Should have antialiasing mode");
    
    let blendOptions = blendModeIface.blendOptions;
    console.assert(blendOptions.isBlendOptions, "Should have BlendOptions");
    
    let selection = Selection.create(doc, shapeNode);
    
    let setGammaCmd = DocumentCommand.createSetBlendGamma(selection, 2.4);
    doc.executeCommand(setGammaCmd);
    
    blendOptions = shapeNode.blendOptions;
    let newGamma = blendOptions.gamma;
    console.assert(TestUtils.floatEqual(newGamma, 2.4), "Gamma should be 2.4");
    
    let masterSpline = Spline.createFromProfile(SplineProfile.Linear);
    let p1 = {x: 0.3, y: 0.5};
    let p2 = {x: 0.7, y: 0.9};
    masterSpline.insertPoint(p1);
    masterSpline.insertPoint(p2);
    
    blendOptions.masterSourceLayerRanges = masterSpline;
    
    let readBackSpline = blendOptions.masterSourceLayerRanges;
    console.assert(readBackSpline.pointCount === 4, "Master source spline should have 4 points");
    console.assert(TestUtils.floatEqual(readBackSpline.getPoint(1).y, 0.5), "Point 1 y should be 0.5");
    
    let channelSpline = Spline.createFromProfile(SplineProfile.Linear);
    let p3 = {x: 0.2, y: 0.3};
    let p4 = {x: 0.8, y: 0.7};
    channelSpline.insertPoint(p3);
    channelSpline.insertPoint(p4);
    
    blendOptions.setChannelSourceLayerRanges(0, channelSpline);
    let readChannelSpline = blendOptions.getChannelSourceLayerRanges(0);
    console.assert(readChannelSpline.pointCount === 4, "Channel 0 source spline should have 4 points");
    console.assert(TestUtils.floatEqual(readChannelSpline.getPoint(1).y, 0.3), "Channel point 1 y should be 0.3");
    
    blendOptions.masterUnderlyingCompositionRanges = masterSpline;
    let underlyingSpline = blendOptions.masterUnderlyingCompositionRanges;
    console.assert(underlyingSpline.pointCount === 4, "Master underlying spline should have 4 points");
    
    blendOptions.setChannelUnderlyingCompositionRanges(1, channelSpline);
    let readUnderlyingChannel = blendOptions.getChannelUnderlyingCompositionRanges(1);
    console.assert(readUnderlyingChannel.pointCount === 4, "Channel 1 underlying spline should have 4 points");
    
    let setRangesCmd = DocumentCommand.createSetBlendRanges(selection, blendOptions);
    doc.executeCommand(setRangesCmd);
    
    let blendOptionsAfterCmd = shapeNode.blendOptions;
    let verifySpline = blendOptionsAfterCmd.getChannelSourceLayerRanges(0);
    console.assert(verifySpline.pointCount === 4, "Channel 0 should persist after command");
    
    let nodeBack = blendModeIface.node;
    console.assert(nodeBack.isSameNode(shapeNode), "GetNode should return same node");
    
    
    doc.close();
    console.log("testBlendModeInterface OK");
}

module.exports.testBlendModeInterface = testBlendModeInterface;
