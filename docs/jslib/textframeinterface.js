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

const { EnumerationResult } = require('affinity:common');
const { TextFrameInterfaceApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');

// monkey patches:
require('/geometry.js');

class TextFrameInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'TextFrameInterface';
    }

    get canHideOverflow() {
        return TextFrameInterfaceApi.canHideOverflow(this.handle);
    }

    get canUseBaselineGrid() {
        return TextFrameInterfaceApi.canUseBaselineGrid(this.handle);
    }

    get canUseTextWraps() {
        return TextFrameInterfaceApi.canUseTextWraps(this.handle);
    }

    get hasScaledText() {
        return TextFrameInterfaceApi.hasScaledText(this.handle);
    }

    get ignoreBaselineGrid() {
        return TextFrameInterfaceApi.ignoreBaselineGrid(this.handle);
    }

    get ignoreTextWraps() {
        return TextFrameInterfaceApi.ignoreTextWraps(this.handle);
    }

    get isMultiFrameTextFlow() {
        return TextFrameInterfaceApi.isMultiFrameTextFlow(this.handle);
    }

    get isTextFlowBack() {
        return TextFrameInterfaceApi.isTextFlowBack(this.handle);
    }

    get isTextFlowFront() {
        return TextFrameInterfaceApi.isTextFlowFront(this.handle);
    }

    get isWrappingText() {
        return TextFrameInterfaceApi.isWrappingText(this.handle);
    }

    get textBegin() {
        return TextFrameInterfaceApi.getTextBegin(this.handle);
    }

    get textFlowIndex() {
        return TextFrameInterfaceApi.getTextFlowIndex(this.handle);
    }

    enumerateTextFlowNodes(callback) {
        if (typeof callback === 'function') {
            function wrapped(nodeHandle) {
                return callback(NodesModule.createTypedNode(nodeHandle));
            }
            return TextFrameInterfaceApi.enumerateTextFlowNodes(this.handle, wrapped);
        }
        return TextFrameInterfaceApi.enumerateTextFlowNodes(this.handle, callback);
    }

    get textFlowNodes() {
        const nodes = [];
        this.enumerateTextFlowNodes(node => {
            nodes.push(node);
            return EnumerationResult.Continue;
        });
        return nodes;
    }

    get scalarStoryToDomainTransform() {
        return TextFrameInterfaceApi.getScalarStoryToDomainTransform(this.handle);
    }

    get storyToDomainTransform() {
        return TextFrameInterfaceApi.getStoryToDomainTransform(this.handle);
    }

    get textRenderScale() {
        return TextFrameInterfaceApi.getTextRenderScale(this.handle);
    }

    get textUiScale() {
        return TextFrameInterfaceApi.getTextUiScale(this.handle);
    }

    get node() {
        return NodesModule.createTypedNode(TextFrameInterfaceApi.getNode(this.handle));
    }

    get spreadNode() {
        return NodesModule.createTypedNode(TextFrameInterfaceApi.getSpreadNode(this.handle));
    }
}

module.exports.TextFrameInterface = TextFrameInterface;
