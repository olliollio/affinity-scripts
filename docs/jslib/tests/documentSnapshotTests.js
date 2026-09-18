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
const { DocumentCommand } = require('/commands.js');

const { sleep } = require('affinity:timers');

function runTests() {
    let doc = TestUtils.getFile("/TextTest.afdesign");

    console.assert(doc.snapshots.length === 0);
    console.assert(doc.currentSnapshotIndex === -1);
    console.assert(doc.currentSnapshotHistoryIndex === -1);

    doc.executeCommand(DocumentCommand.createAddDocumentSnapshot("snapshot0"), false);
    console.assert(doc.snapshots.length === 1);
    console.assert(doc.currentSnapshotIndex === -1);
    console.assert(doc.snapshots[0].description === "snapshot0");

    doc.executeCommand(DocumentCommand.createSetCurrentSnapshot(doc.snapshots[0]), false);
    console.assert(doc.currentSnapshotIndex === 0);

    doc.executeCommand(DocumentCommand.createSelectAll(), false);
    doc.executeCommand(DocumentCommand.createDeleteSelection(doc.selection, false, true), false);
    doc.executeCommand(DocumentCommand.createAddDocumentSnapshot("snapshot1"), false);
    console.assert(doc.snapshots.length === 2);
    console.assert(doc.currentSnapshotIndex === 0);
    console.assert(doc.snapshots[1].description === "snapshot1");

    let newdoc1 = doc.snapshots[0].createDocument();
    console.assert(newdoc1.snapshots.length === 0);
    console.assert(newdoc1.currentSnapshotIndex === -1);
    console.assert(newdoc1.currentSnapshotHistoryIndex === -1);

    /*
    TODO: commented out for now as document promise to be implemented.
    let promise = doc.promises.createFromSnapshot(doc.snapshots[0]);
    let newdoc2;
    try {
        newdoc2 = await promise;
    } catch (e) {
        console.assert(false, "DocumentPromises.createFromSnapshot:", e);
    }
    console.assert(newdoc2.snapshots.length === 0);
    console.assert(newdoc2.currentSnapshotIndex === -1);
    console.assert(newdoc2.currentSnapshotHistoryIndex === -1);*/

    doc.executeCommand(DocumentCommand.createSetCurrentSnapshot(doc.snapshots[0]), false);
    console.assert(doc.currentSnapshotIndex === 0);

    doc.executeCommand(DocumentCommand.createRestoreDocumentSnapshot(doc.snapshots[0]), false);
    doc.executeCommand(DocumentCommand.createRestoreDocumentSnapshot(doc.snapshots[1]), false);
    doc.executeCommand(DocumentCommand.createDeleteDocumentSnapshot(doc.snapshots[0]), false);
    console.assert(doc.snapshots.length === 1);
    console.assert(doc.currentSnapshotIndex === -1);
    console.assert(doc.snapshots[0].description === "snapshot1");

    doc.executeCommand(DocumentCommand.createDeleteDocumentSnapshot(doc.snapshots[0]), false);
    console.assert(doc.snapshots.length === 0);
    console.assert(doc.currentSnapshotIndex === -1);

    console.assert(doc.currentSnapshotHistoryIndex === -1);
    doc.executeCommand(DocumentCommand.createSetCurrentSnapshotFromHistoryIndex(0), false);
    console.assert(doc.currentSnapshotHistoryIndex === 0);
    doc.executeCommand(DocumentCommand.createSetCurrentSnapshotFromHistoryIndex(3), false);
    console.assert(doc.currentSnapshotHistoryIndex === 3);

    doc.undo();
    doc.undo();
    doc.undo();
    doc.undo();

    newdoc1.close();
    //newdoc2.close();
    doc.close();
}

module.exports.runTests = runTests
