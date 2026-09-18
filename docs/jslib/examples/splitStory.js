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

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { StoryDelta } = require('/storydelta.js');


function executeAll(doc, cmds) {
    if (cmds.length == 0)
        return;
    if (cmds.length == 1) {
        doc.executeCommand(cmds[0]);
        return;
    }
    const builder = CompoundCommandBuilder.create();
    for (const cmd of cmds)
        builder.addCommand(cmd);
    doc.executeCommand(builder.createCommand());
}

// Every frame of the flow the given frame belongs to, in flow order.
function framesInFlow(frame) {
    return frame.textFrameInterface.textFlowNodes;
}

// Story range each frame currently displays: from its text begin to the next frame's.
function visibleRanges(frames) {
    const story = frames[0].story;
    const begins = frames.map(f => f.textFrameInterface.textBegin);
    return begins.map((begin, i) => ({ begin, end: i + 1 < begins.length ? begins[i + 1] : story.length }));
}

function textSelection(doc, node, begin, end) {
    const selection = Selection.create(doc, node);
    selection.addSubSelectionForNode(node, TextSelection.create([{ begin, end }]));
    return selection;
}

// ---- Formatting capture -------------------------------------------------------------------

// Attribute runs within [begin, end), re-based to the range start, each with its full state.
function captureRuns(runs, range, attsKey, makeDelta) {
    const result = [];
    for (const run of runs) {
        if (run.begin >= range.end)
            break;
        result.push({
            begin: Math.max(run.begin, range.begin) - range.begin,
            end: Math.min(run.end, range.end) - range.begin,
            delta: makeDelta(run[attsKey])
        });
    }
    return result;
}

// Everything needed to rebuild a range of the story in another frame.
function captureRange(story, range) {
    const glyphs = [];
    for (let pos = range.begin; pos < range.end; ++pos)
        glyphs.push(story.getGlyph(pos));
    return {
        glyphs,
        glyphRuns: captureRuns(story.getGlyphAttRunsFrom(range.begin), range, "glyphAtts", StoryDelta.createFromGlyphAtts),
        paragraphRuns: captureRuns(story.getParagraphAttRunsFrom(range.begin), range, "paragraphAtts", StoryDelta.createFromParagraphAtts)
    };
}

// Re-insert the glyphs, then restore the full attribute state over each run.
function restoreCommands(doc, node, captured, cmds) {
    captured.glyphs.forEach((glyph, i) => cmds.push(DocumentCommand.createInsertGlyph(textSelection(doc, node, i, i), glyph)));
    for (const run of captured.paragraphRuns)
        cmds.push(DocumentCommand.createFormatText(textSelection(doc, node, run.begin, run.end), run.delta));
    for (const run of captured.glyphRuns)
        cmds.push(DocumentCommand.createFormatText(textSelection(doc, node, run.begin, run.end), run.delta));
}

// ---- Split ----------------------------------------------------------------------------------

function splitStory(doc, frames) {
    const story = frames[0].story;
    const ranges = visibleRanges(frames);
    const captured = ranges.slice(1).map(r => captureRange(story, r));

    // Unlink from the back; the first frame is left holding the whole story.
    executeAll(doc, frames.slice(1).reverse().map(n => DocumentCommand.createUnlinkTextFrame(n)));

    const cmds = [];
    if (ranges.length > 1)
        cmds.push(DocumentCommand.createSetText(textSelection(doc, frames[0], ranges[1].begin, story.length), ""));
    frames.slice(1).forEach((frame, i) => restoreCommands(doc, frame, captured[i], cmds));
    executeAll(doc, cmds);
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }
    const frame = doc.selection.nodes.filter(n => n.isTextNode).first;
    if (!frame) {
        alert("Please select a text frame");
        return;
    }
    if (!frame.textFrameInterface.isMultiFrameTextFlow) {
        alert("Please select a story containing more than one text frame");
        return;
    }
    splitStory(doc, framesInFlow(frame));
}

module.exports.main = main;
