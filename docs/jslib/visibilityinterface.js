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

const { TextVisibilityOptionsApi, VisibilityInterfaceApi, VisibilityTestOptionsApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');

class VisibilityInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'VisibilityInterface';
    }

    get globalOpacity() {
        return VisibilityInterfaceApi.getGlobalOpacity(this.handle);
    }

    get fillOpacity() {
        return VisibilityInterfaceApi.getFillOpacity(this.handle);
    }

    get isVisible() {
        return VisibilityInterfaceApi.isVisible(this.handle);
    }

    get isVisibleInExport() {
        return VisibilityInterfaceApi.isVisibleInExport(this.handle);
    }

    get isVisibleInDomain() {
        return VisibilityInterfaceApi.isVisibleInDomain(this.handle);
    }

    testVisibility(options) {
        return VisibilityInterfaceApi.testVisibility(this.handle, options.handle);
    }

    get node() {
        return NodesModule.createTypedNode(VisibilityInterfaceApi.getNode(this.handle));
    }
}

class VisibilityTestOptions extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'VisibilityTestOptions';
    }

    static create() {
        return new VisibilityTestOptions(VisibilityTestOptionsApi.create());
    }

    clone() {
        return new VisibilityTestOptions(VisibilityTestOptionsApi.clone(this.handle));
    }

    get textVisibilityOptions() {
        return new TextVisibilityOptions(VisibilityTestOptionsApi.getTextVisibilityOptions(this.handle));
    }

    set textVisibilityOptions(options) {
        VisibilityTestOptionsApi.setTextVisibilityOptions(this.handle, options.handle);
    }

    get ignoreVisibilityFlags() {
        return VisibilityTestOptionsApi.getIgnoreVisibilityFlags(this.handle);
    }

    set ignoreVisibilityFlags(value) {
        VisibilityTestOptionsApi.setIgnoreVisibilityFlags(this.handle, value);
    }

    get applyExportableVisibility() {
        return VisibilityTestOptionsApi.getApplyExportableVisibility(this.handle);
    }

    set applyExportableVisibility(value) {
        VisibilityTestOptionsApi.setApplyExportableVisibility(this.handle, value);
    }

    get showEmptyRects() {
        return VisibilityTestOptionsApi.getShowEmptyRects(this.handle);
    }

    set showEmptyRects(value) {
        VisibilityTestOptionsApi.setShowEmptyRects(this.handle, value);
    }

    get showPictureFrames() {
        return VisibilityTestOptionsApi.getShowPictureFrames(this.handle);
    }

    set showPictureFrames(value) {
        VisibilityTestOptionsApi.setShowPictureFrames(this.handle, value);
    }

    get clipToSpread() {
        return VisibilityTestOptionsApi.getClipToSpread(this.handle);
    }

    set clipToSpread(value) {
        VisibilityTestOptionsApi.setClipToSpread(this.handle, value);
    }

    get allowInvisibleLayers() {
        return VisibilityTestOptionsApi.getAllowInvisibleLayers(this.handle);
    }

    set allowInvisibleLayers(value) {
        VisibilityTestOptionsApi.setAllowInvisibleLayers(this.handle, value);
    }
}

class TextVisibilityOptions extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'TextVisibilityOptions';
    }

    static create() {
        return new TextVisibilityOptions(TextVisibilityOptionsApi.create());
    }

    clone() {
        return new TextVisibilityOptions(TextVisibilityOptionsApi.clone(this.handle));
    }

    equals(other) {
        return TextVisibilityOptionsApi.equals(this.handle, other.handle);
    }

    anySet() {
        return TextVisibilityOptionsApi.anySet(this.handle);
    }

    setNone() {
        TextVisibilityOptionsApi.setNone(this.handle);
    }

    setNewViewDefaults() {
        TextVisibilityOptionsApi.setNewViewDefaults(this.handle);
    }

    get showSpecialCharacters() {
        return TextVisibilityOptionsApi.getShowSpecialCharacters(this.handle);
    }

    set showSpecialCharacters(value) {
        TextVisibilityOptionsApi.setShowSpecialCharacters(this.handle, value);
    }

    get showIndexMarks() {
        return TextVisibilityOptionsApi.getShowIndexMarks(this.handle);
    }

    set showIndexMarks(value) {
        TextVisibilityOptionsApi.setShowIndexMarks(this.handle, value);
    }

    get showAnchors() {
        return TextVisibilityOptionsApi.getShowAnchors(this.handle);
    }

    set showAnchors(value) {
        TextVisibilityOptionsApi.setShowAnchors(this.handle, value);
    }

    get showNoteMarks() {
        return TextVisibilityOptionsApi.getShowNoteMarks(this.handle);
    }

    set showNoteMarks(value) {
        TextVisibilityOptionsApi.setShowNoteMarks(this.handle, value);
    }

    get highlightFields() {
        return TextVisibilityOptionsApi.getHighlightFields(this.handle);
    }

    set highlightFields(value) {
        TextVisibilityOptionsApi.setHighlightFields(this.handle, value);
    }
}

module.exports.VisibilityInterface = VisibilityInterface;
module.exports.VisibilityTestOptions = VisibilityTestOptions;
module.exports.TextVisibilityOptions = TextVisibilityOptions;
module.exports.VisibilityTestOptionsApi = VisibilityTestOptionsApi;
module.exports.TextVisibilityOptionsApi = TextVisibilityOptionsApi;
