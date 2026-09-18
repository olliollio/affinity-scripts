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
const { GroupTransformAnchor, GroupTransformData, GroupTransformOrder, GroupTransformType } = require('/commands.js');

const doc = Document.current;

function createGroupTransformData(alignment, considerMargins) {
    const res = new GroupTransformData();    
    res.type = alignment;
    res.anchor = considerMargins ? GroupTransformAnchor.PageMargins : GroupTransformAnchor.Page;
    return res;
}

function doPageAlign(alignX, alignY, considerMargins) {
    const xData = createGroupTransformData(alignX, considerMargins);
    const yData = createGroupTransformData(alignY, considerMargins);
    doc.applyGroupTransform(xData, yData);
}

function buildDialog() {
    const dlg = Dialog.create("Align To Page");
    const grp = dlg.addColumn().addGroup("");
    dlg.y = grp.addComboBox("Vertical", ["Top", "Centre", "Bottom", "None"]);
    dlg.x = grp.addComboBox("Horizontal", ["Left", "Centre", "Right", "None"]);
    dlg.margins = grp.addSwitch("Consider margins");
    return dlg;
}

function main() {
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    const dlg = buildDialog();
    if (dlg.runModal() == DialogResult.Ok.value) {
        let getAlignType = (value) => {
            switch (value) {
                case 0: return GroupTransformType.Min;
                case 1: return GroupTransformType.Mid;
                case 2: return GroupTransformType.Max;
                default:  return GroupTransformType.None;
            }
        };
        
        const alignX = getAlignType(dlg.x.selectedIndex);
        const alignY = getAlignType(dlg.y.selectedIndex);
        if (alignX.value == GroupTransformType.None && alignY.value == GroupTransformType.None) {
            return;
        }
        doPageAlign(alignX, alignY, dlg.margins.value);
    }
}

module.exports.main = main;
