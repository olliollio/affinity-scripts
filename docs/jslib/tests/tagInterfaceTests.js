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
const {Document} = require('/document.js');
const {DocumentCommand, AddChildNodesCommandBuilder, NodeChildType} = require('/commands.js');
const {ShapeNodeDefinition} = require('/nodes.js');
const {TagInterface, PredefinedTagKey} = require('/taginterface.js');
const {TestUtils} = require('/tests/testUtils.js');

function testTagInterface() {
    let doc = TestUtils.newA4Empty();
    
    let acnBuilder = AddChildNodesCommandBuilder.create();
    let def = ShapeNodeDefinition.createDefault();
    acnBuilder.addNode(def);
    let cmd = acnBuilder.createCommand(true, NodeChildType.Main);
    let result = doc.executeCommand(cmd);
    
    let scrTag = "Test";
    let setTagCmd = DocumentCommand.createSetTagValueForPredefinedKey(null, PredefinedTagKey.ScriptLabel, scrTag);
    result = doc.executeCommand(setTagCmd);
    
    const shNode = doc.layers.first;
    let iface = shNode.tagInterface;
    console.assert(iface.hasPredefinedKey(PredefinedTagKey.ScriptLabel));
    let res = iface.getValueForPredefinedKey(PredefinedTagKey.ScriptLabel);
    console.assert(TestUtils.strEqual(scrTag, res));
    console.log("testTagInterface Ok");
    
    // waiting for close to be fixed.
    //doc.close();
}

module.exports.testTagInterface = testTagInterface;
