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
const {Dialog, DialogResult} = require('/dialog.js');
const {UnitType} = require('/units.js');
const {unionRects} = require('/geometry.js');
const {DocumentCommand, CompoundCommandBuilder} = require('/commands.js');

function calculateOffsets(dlg) {
    const offsets = {
        left:0,
        top:0,
        right:0,
        bottom:0,
        hCentre:0,
        vCentre:0
    };
    if (dlg.enableOffsets.value) {
        const inflate = dlg.offsetMode.selectedIndex == 1;
        if (inflate) {
            offsets.left = -dlg.hOffset.value;
            offsets.top = -dlg.vOffset.value;
            offsets.right = dlg.hOffset.value;
            offsets.bottom = dlg.vOffset.value;
        }
        else {
            offsets.left = dlg.hOffset.value;
            offsets.top = dlg.vOffset.value;
            offsets.right = dlg.hOffset.value;
            offsets.bottom = dlg.vOffset.value;
            offsets.hCentre = dlg.hOffset.value;
            offsets.vCentre = dlg.vOffset.value;
        }
    }
    return offsets;
}

function addCommands(rc, dlg, offsets, cmds) {
    if (dlg.left.value) {
        cmds.push(DocumentCommand.createAddGuide(false, rc.x + offsets.left));
    }
    if (dlg.top.value) {
        cmds.push(DocumentCommand.createAddGuide(true, rc.y + offsets.top));
    }
    if (dlg.right.value) {
        cmds.push(DocumentCommand.createAddGuide(false, rc.x + rc.width + offsets.right));
    }
    if (dlg.bottom.value) {
        cmds.push(DocumentCommand.createAddGuide(true, rc.y + rc.height + offsets.bottom));
    }
    if (dlg.hCentre.value) {
        cmds.push(DocumentCommand.createAddGuide(false, rc.centre.x + offsets.hCentre));
    }
    if (dlg.vCentre.value) {
        cmds.push(DocumentCommand.createAddGuide(true, rc.centre.y + offsets.vCentre));
    }
}

function createGuides(doc, nodes, dlg, preview) {
    
    if (!dlg.anyGuidesSelected())
        return; // nothing to do
    
    const subCmds = [];
    const offsets = calculateOffsets(dlg);
    
    switch (dlg.guidesBounds.selectedIndex) {
        case 0: { // put guides around each object
            const builder = CompoundCommandBuilder.create();
            for (const node of nodes) {
                const rcNode = node.getSpreadBaseBox();
                addCommands(rcNode, dlg, offsets, subCmds);
            }
        }
        break;
        case 1: { // put guides around selection
            let rc = null;
            for (const node of nodes) {
                const rcNode = node.getSpreadBaseBox();
                if (rc == null)
                    rc = rcNode;
                else {
                    rc = unionRects(rc, rcNode);
                }
            }
            if (rc == null) {
                return;
            }
            addCommands(rc, dlg, offsets, subCmds);
        }
        break;
    }
    if (subCmds.length == 0)
        return;
    if (subCmds.length == 1)
        doc.executeCommand(subCmds[0], preview);
    else {
        const builder = CompoundCommandBuilder.create();
        for (const cmd of subCmds) {
            builder.addCommand(cmd);
        }
        doc.executeCommand(builder.createCommand(), preview);
    }
}

function buildDialog() {
    const dlg = Dialog.create("Add Guides");
    const column = dlg.addColumn();
    const grp1 = column.addGroup("Add Guides At");
    dlg.left = grp1.addSwitch("Left");
    dlg.top = grp1.addSwitch("Top");
    dlg.right = grp1.addSwitch("Right");
    dlg.bottom = grp1.addSwitch("Bottom");
    dlg.hCentre = grp1.addSwitch("Horizontal Centre");
    dlg.vCentre = grp1.addSwitch("Vertical Centre");
    dlg.guidesBounds = grp1.addButtonSet("Around", ["Each object", "Entire Selection"], 1);
    
    const grp2 = column.addGroup("Offsets");
    dlg.enableOffsets = grp2.addSwitch("Enabled");
    dlg.offsetMode = grp2.addButtonSet("Mode", ["Absolute", "Inflate"]);
    dlg.hOffset = grp2.addUnitValueEditor("Horizontal", UnitType.Pixel, UnitType.Millimetre, 0);
    dlg.vOffset = grp2.addUnitValueEditor("Vertical", UnitType.Pixel, UnitType.Millimetre, 0);
    dlg.offsetMode.isEnabled = false;
    dlg.hOffset.isEnabled = false;
    dlg.vOffset.isEnabled = false;
    dlg.enableOffsets.onValueChangedHandler = () => {
        const enabled = dlg.enableOffsets.value;
        dlg.offsetMode.isEnabled = enabled;
        dlg.hOffset.isEnabled = enabled;
        dlg.vOffset.isEnabled = enabled;
    };
    dlg.initialWidth = 300;
    dlg.anyGuidesSelected = () => {
        return dlg.top.value || dlg.left.value || dlg.bottom.value || dlg.right.value || dlg.hCentre.value || dlg.vCentre.value;
    }
    return dlg;
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
    }
    else {
        const selection = doc.selection;
        const nodes = selection.nodes;
        if (nodes.isEmpty) {
            alert("Please select some objects");
        }
        else {
            const dlg = buildDialog();
            function update() {
                if (dlg.anyGuidesSelected()) {
                    createGuides(doc, nodes, dlg, true);
                }
                else {
                    doc.clearPreviews();
                }
            }
            dlg.onControlValueChangedHandler = update;
            while (dlg.runModal() == DialogResult.Ok) {
                if (dlg.anyGuidesSelected()) {
                    createGuides(doc, nodes, dlg);
                    break;
                }
                else {
                    alert("Please select some guides to create");
                }
            }
            doc.clearPreviews();
        }
    }
}

module.exports.main = main;
