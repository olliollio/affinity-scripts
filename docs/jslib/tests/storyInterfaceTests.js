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
const { IndexRange } = require('affinity:story')
const { Transform } = require('/geometry.js')

function doStoryInterfaceTests(iface, node) {
    console.assert(iface.isMultiFrameTextFlow === false);
    console.assert(iface.domainTransform instanceof Transform);
    console.assert(iface.scalarDomainTransform instanceof Transform);
    console.assert(iface.textDefaultType === (node.isFrameTextNode ? 1 : 0));
    console.assert(iface.textRenderScale instanceof Transform);
    console.assert(iface.textUiScale instanceof Transform);
}

function doStoryTests(iface) {
    console.assert(!iface.containsBookEndnotes);
    console.assert(!iface.containsIndex);
    console.assert(!iface.containsToc);

    let isEmpty = iface.isEmpty;
    console.assert(iface.length > 0 ? !isEmpty : isEmpty);
    console.assert(!iface.isRangenoteBodyStory);
    console.assert(!iface.isTable);
    console.assert(!iface.usesGlobalNumbering);
    console.assert(iface.all.end === iface.clientAll.end + 1);
    console.assert(iface.storyBegin === iface.all.begin);
    console.assert(iface.storyBegin === iface.clientAll.begin);
    console.assert(iface.getStoryEnd(false) === iface.all.end);
    console.assert(iface.getStoryEnd(true) === iface.all.end);
    console.assert(iface.clientAll.end === iface.length);
    console.assert(iface.clientAll.end === iface.storyTerminator);
}

function doPosTests(iface) {
    console.assert(iface.hasGlyph(iface.storyTerminator));
    console.assert(iface.hasGlyph(iface.all.begin));

    let pos = iface.getCellBegin(iface.all.begin);
    console.assert(iface.isCellBegin(pos));
    console.assert(iface.isCellEnd(pos) === (iface.length === 0));

    pos = iface.getCellBegin(iface.clientAll.end);
    console.assert(iface.isCellBegin(pos));
    console.assert(iface.isCellEnd(pos) === (iface.length === 0));

    pos = iface.getCellEnd(iface.all.begin);
    console.assert(iface.isCellBegin(iface.length === 0 ? pos : pos - 1) === (iface.length === 0));
    console.assert(iface.isCellEnd(pos));

    pos = iface.getCellEnd(iface.clientAll.end);
    console.assert(iface.isCellBegin(pos) === (iface.length === 0));
    console.assert(iface.isCellEnd(pos));

    console.assert(!iface.isDeletableGlyph(iface.storyTerminator));
    if (iface.length > 0)
        console.assert(iface.isDeletableGlyph(iface.all.begin));

    console.assert(iface.isHardBreak(iface.all.begin) === (iface.length === 0));
    console.assert(iface.isHardBreak(iface.clientAll.end));

    console.assert(!iface.isInWord(iface.all.begin));
    console.assert(!iface.isInWord(iface.clientAll.end));

    let paragraph = iface.getParagraph(iface.all.begin, true);
    console.assert(iface.isParagraphBegin(iface.getParagraphBegin(paragraph.begin)));
    console.assert(iface.isParagraphEnd(iface.getParagraphEnd(paragraph, false)));
    console.assert(iface.isParagraphEnd(iface.getParagraphEnd(paragraph, true)));

    if (iface.length > 0)
        console.assert(!iface.isStoryTerminator(iface.storyTerminator - 1));

    console.assert(iface.isStoryBegin(iface.all.begin));
    if (iface.length > 0)
        console.assert(!iface.isStoryBegin(iface.all.begin + 1));

    console.assert(iface.isStoryEnd(iface.all.end));
    console.assert(!iface.isStoryEnd(iface.all.end - 1));

    console.assert(iface.isStoryTerminator(iface.storyTerminator));
    if (iface.length > 0)
        console.assert(!iface.isStoryTerminator(iface.storyTerminator - 1));

    console.assert(!iface.isToComposedForward(iface.all.begin));
    console.assert(!iface.isToComposedForward(iface.clientAll.end));

    pos = iface.getWordBegin(iface.clientAll.end);
    console.assert(iface.isWordBegin(pos) === (iface.length > 0));
    console.assert(iface.isWordEnd(pos) === (iface.length === 0));
    console.assert(iface.isWordPart(pos) === (iface.length > 0));

    pos = iface.getWordEnd(iface.clientAll.begin);
    if (iface.length > 0)
    {
        console.assert(!iface.isWordBegin(pos))
        console.assert(iface.isWordEnd(pos));
        console.assert(!iface.isWordPart(pos))
    }

    console.assert(iface.isWordEnd(iface.getWordEnd(iface.clientAll.end)) === (iface.length > 0));

    console.assert(iface.getGlyphAttsRunEnd(iface.clientAll) === (iface.length > 0 ? 1 : 0));

    console.assert(iface.getParagraphAttsRunEnd(iface.clientAll) === (iface.length > 0 ? iface.clientAll.end : 0));

    console.assert(iface.getNextWordBegin(iface.all.begin) === iface.all.end);
    console.assert(iface.getWordBreakBackward(iface.all.begin) === iface.all.begin);
    console.assert(iface.getWordBreakForward(iface.all.begin) === (iface.length > 0 ? iface.clientAll.end : iface.all.end));

    console.assert(iface.find(iface.all, iface.getGlyph(iface.clientAll.begin)) === iface.clientAll.begin);
    console.assert(iface.reverseFind(iface.all, iface.getGlyph(iface.clientAll.begin)) === iface.clientAll.begin);
    console.assert(iface.find(iface.clientAll, iface.getGlyph(iface.clientAll.begin)) === (iface.length > 0 ? iface.clientAll.begin : -1));
    console.assert(iface.reverseFind(iface.clientAll, iface.getGlyph(iface.clientAll.begin)) === (iface.length > 0 ? iface.clientAll.begin : -1));
}

function doRangeTests(iface) {
    let glyph0 = iface.getGlyph(iface.clientAll.begin)
    let glyph1 = iface.getGlyph(iface.clientAll.end);

    console.assert(iface.contains(iface.all, glyph0));
    console.assert(iface.contains(iface.all, glyph1));
    let contains = iface.contains(iface.clientAll, glyph0);
    console.assert(iface.length > 0 ? contains : !contains);
    console.assert(!iface.contains(iface.clientAll, glyph1));

    console.assert(!iface.hasStoryTerminator(iface.clientAll));
    console.assert(iface.hasStoryTerminator(iface.all));

    console.assert(iface.overlaps(new IndexRange(iface.all.begin), new IndexRange(iface.all.begin)));
    console.assert(iface.overlaps(new IndexRange(iface.all.end), new IndexRange(iface.all.end)));
    console.assert(!iface.overlaps(iface.clientAll, new IndexRange(iface.all.end)));
}

function runTests() {
    let doc = TestUtils.getFile("/TextTest.afdesign");
    for (const spread of doc.spreads)
        for (const node of spread.layers)
            if (node.isFrameTextNode || node.isArtTextNode) {
                let iface = node.storyInterface;
                doStoryInterfaceTests(iface, node);
                doStoryTests(iface);
                doPosTests(iface);
                doRangeTests(iface);
            }
    doc.close();
}

module.exports.runTests = runTests
