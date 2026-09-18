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

const { RasterFormat } = require('affinity:raster');
const { StoryBuilderApi } = require('affinity:story');
const { GlyphAtts } = require('/glyphatts.js');
const { HandleObject } = require('/handleobject.js');
const { ParagraphAtts } = require('/paragraphatts.js');

class StoryBuilder extends HandleObject {
    get [Symbol.toStringTag]() { return 'StoryBuilder'; }

    constructor(handle) { super(handle); }

    static create() {
        return new StoryBuilder(StoryBuilderApi.create());
    }

    setToFrameTextDefaultStyle(dpi, format) {
        StoryBuilderApi.setToFrameTextDefaultStyle(this.handle, dpi, format);
        return this;
    }

    setToArtisticTextDefaultStyle(dpi, format) {
        StoryBuilderApi.setToArtisticTextDefaultStyle(this.handle, dpi, format);
        return this;
    }

    clearText() {
        StoryBuilderApi.clearText(this.handle);
        return this;
    }

    addText(text) {
        StoryBuilderApi.addText(this.handle, text);
        return this;
    }

    addParagraphBreak() {
        StoryBuilderApi.addParagraphBreak(this.handle);
        return this;
    }

    setGlyphAtts(glyphAtts) {
        StoryBuilderApi.setGlyphAtts(this.handle, glyphAtts.handle);
        return this;
    }

    setParagraphAtts(paragraphAtts) {
        StoryBuilderApi.setParagraphAtts(this.handle, paragraphAtts.handle);
        return this;
    }

    applyGlyphDelta(delta) {
        StoryBuilderApi.applyGlyphDelta(this.handle, delta.handle);
        return this;
    }

    applyParagraphDelta(delta) {
        StoryBuilderApi.applyParagraphDelta(this.handle, delta.handle);
        return this;
    }

    get glyphAtts() {
        return new GlyphAtts(StoryBuilderApi.getGlyphAtts(this.handle));
    }

    get paragraphAtts() {
        return new ParagraphAtts(StoryBuilderApi.getParagraphAtts(this.handle));
    }
}

module.exports.RasterFormat = RasterFormat;
module.exports.StoryBuilder = StoryBuilder;
