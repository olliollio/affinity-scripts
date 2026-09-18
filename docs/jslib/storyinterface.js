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

const { StoryInterfaceApi, TextDefaultType } = require('affinity:dom');
const { StoryIoFormat } = require('affinity:story');
const { Collection } = require('/collection.js');
const { HandleObject} = require('/handleobject.js');

// cyclics:
const GlyphsModule = require('/glyphs.js');
const NodesModule = require('/nodes.js');
const StoryModule = require('/story.js');

// monkey patches:
require('/geometry.js');

class StoryInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'StoryInterface';
    }

    get domainTransform() {
        return StoryInterfaceApi.getDomainTransform(this.handle);
    }

    get scalarDomainTransform() {
        return StoryInterfaceApi.getScalarDomainTransform(this.handle);
    }

    get textDefaultType() {
        return StoryInterfaceApi.getTextDefaultType(this.handle);
    }

    get textRenderScale() {
        return StoryInterfaceApi.getTextRenderScale(this.handle);
    }

    get textUiScale() {
        return StoryInterfaceApi.getTextUiScale(this.handle);
    }

    get isMultiFrameTextFlow() {
        return StoryInterfaceApi.isMultiFrameTextFlow(this.handle);
    }

    get story() {
        return new StoryModule.Story(StoryInterfaceApi.getStory(this.handle));
    }

    get storyRange() {
        return StoryInterfaceApi.getStoryRange(this.handle);
    }

    getText(startPos = 0, maxLength = -1, format = StoryIoFormat.ClipboardDescriptions) {
        const range = this.storyRange;
        if (startPos > range.length)
            return "";
        if (maxLength < 0)
            maxLength = range.length;
        return this.story.getText(range.begin + startPos, maxLength, format);
    }

    get text() {
        return this.story.getTextRange(this.storyRange);
    }
    
    get glyphIndexes() {
        const range = this.storyRange;
        return Collection.range(range.begin, range.length);
    }

    get glyphs() {
        const story = this.story;
        return this.glyphIndexes.map(i => story.getGlyph(i));
    }
    
    get anchorGlyphs() {
        return this.glyphs.filter(glyph => glyph.isAnchorGlyph);
    }

    get charGlyphs() {
        return this.glyphs.filter(glyph => glyph.isCharGlyph);
    }

    get crossReferenceSubGlyphs() {
        return this.glyphs.filter(glyph => glyph.isCrossReferenceSubGlyph);
    }

    get documentFieldGlyphs() {
        return this.glyphs.filter(glyph => glyph.isDocumentFieldGlyph);
    }

    get fieldGlyphs() {
        return this.glyphs.filter(glyph => glyph.isFieldGlyph);
    }

    get crossReferenceGlyphs() {
        return this.glyphs.filter(glyph => glyph.isCrossReferenceGlyph);
    }

    get fillerTextGlyphs() {
        return this.glyphs.filter(glyph => glyph.isFillerTextGlyph);
    }

    get formattableFieldGlyphs() {
        return this.glyphs.filter(glyph => glyph.isFormattableFieldGlyph);
    }

    get capturedDateTimeGlyphs() {
        return this.glyphs.filter(glyph => glyph.isCapturedDateTimeGlyph);
    }

    get customFieldGlyphs() {
        return this.glyphs.filter(glyph => glyph.isCustomFieldGlyph);
    }

    get dataMergeGlyphs() {
        return this.glyphs.filter(glyph => glyph.isDataMergeGlyph);
    }

    get dataMergeFieldGlyphs() {
        return this.glyphs.filter(glyph => glyph.isDataMergeFieldGlyph);
    }

    get dataMergeSourceGlyphs() {
        return this.glyphs.filter(glyph => glyph.isDataMergeSourceGlyph);
    }
    
    get runningHeaderGlyphs() {
        return this.glyphs.filter(glyph => glyph.isRunningHeaderGlyph);
    }

    get pageNumberGlyphs() {
        return this.glyphs.filter(glyph => glyph.isPageNumberGlyph);
    }

    get rangenoteBodyGlyphs() {
        return this.glyphs.filter(glyph => glyph.isRangenoteBodyGlyph);
    }

    get rangenoteReferenceGlyphs() {
        return this.glyphs.filter(glyph => glyph.isRangenoteReferenceGlyph);
    }

    get sectionNameGlyphs() {
        return this.glyphs.filter(glyph => glyph.isSectionNameGlyph);
    }

    get glyphIndexGlyphs() {
        return this.glyphs.filter(glyph => glyph.isGlyphIndexGlyph);
    }

    get hardBreakGlyphs() {
        return this.glyphs.filter(glyph => glyph.isHardBreakGlyph);
    }
    
    get indentToHereGlyphs() {
        return this.glyphs.filter(glyph => glyph.isIndentToHereGlyph);
    }
    
    get indexMarkGlyphs() {
        return this.glyphs.filter(glyph => glyph.isIndexMarkGlyph);
    }
    
    get listNumberGlyphs() {
        return this.glyphs.filter(glyph => glyph.isListNumberGlyph);
    }
    
    get noteNumberGlyphs() {
        return this.glyphs.filter(glyph => glyph.isNoteNumberGlyph);
    }
    
    get pinGlyphs() {
        return this.glyphs.filter(glyph => glyph.isPinGlyph);
    }

    get rangenoteEndGlyphs() {
        return this.glyphs.filter(glyph => glyph.isRangenoteEndGlyph);
    }
    
    get rightIndentTabGlyphs() {
        return this.glyphs.filter(glyph => glyph.isRightIndentTabGlyph);
    }

    get node() {
        return NodesModule.createTypedNode(StoryInterfaceApi.getNode(this.handle));
    }
}

module.exports.StoryInterface = StoryInterface;
module.exports.TextDefaultType = TextDefaultType;
