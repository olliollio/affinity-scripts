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
const { BrushFillInterfaceApi, ContentType } = require('affinity:dom');
const { FillDescriptor } = require('/fills.js');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');
const SelectionsModule = require('/selections.js');

// monkey patches:
require('/geometry.js');

class BrushFillInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'BrushFillInterface';
    }

    get isBrushFillInterface() {
        return true;
    }
    
    get isNoFill() {
        return BrushFillInterfaceApi.isNoFill(this.handle);
    }

    getIsVisible(minAlpha) {
        return BrushFillInterfaceApi.isBrushFillVisible(this.handle, minAlpha);
    }

    domainTransform() {
        return BrushFillInterfaceApi.getDomainTransform(this.handle);
    }

    get contentType() {
        return BrushFillInterfaceApi.getContentType(this.handle);
    }

    get descriptorCount() {
        return BrushFillInterfaceApi.getDescriptorCount(this.handle);
    }

    getDescriptor(index, obeyScaleWithObject = true) {
        return new FillDescriptor(BrushFillInterfaceApi.getDescriptor(this.handle, index, obeyScaleWithObject));
    }

    getCurrentDescriptor(obeyScaleWithObject = true) {
        return new FillDescriptor(BrushFillInterfaceApi.getCurrentDescriptor(this.handle, obeyScaleWithObject));
    }

    get currentIndex() {
        return BrushFillInterfaceApi.getCurrentIndex(this.handle);
    }

    enumerateDescriptors(callback, obeyScaleWithObject = true) {
        function wrapped(fillDescriptorHandle) {
            return callback(fillDescriptorHandle ? new FillDescriptor(fillDescriptorHandle) : null);
        }
        return BrushFillInterfaceApi.enumerateDescriptors(this.handle, obeyScaleWithObject, wrapped);
    }

    get subSelectionCount() {
        return BrushFillInterfaceApi.getSubSelectionCount(this.handle);
    }

    getSubSelection(index) {
        return SelectionsModule.createTypedSubSelection(BrushFillInterfaceApi.getSubSelection(this.handle, index));
    }

    get node() {
        return NodesModule.createTypedNode(BrushFillInterfaceApi.getNode(this.handle));
    }

    // helpers
    setCurrentDescriptor(fillDescriptorOrColour, options, preview) {
        const node = this.node;
        const doc = node.document;
        doc.setBrushFillDescriptor(fillDescriptorOrColour, node, options, preview);
    }

    get currentDescriptor() {
        return this.getCurrentDescriptor(true);
    }

    set currentDescriptor(fillDescriptorOrColour) {
        this.setCurrentDescriptor(fillDescriptorOrColour, null, false);
    }
    
    getAllDescriptors(obeyScaleWithObject = true) {
        let descriptors = [];
        this.enumerateDescriptors(descriptor => {
            descriptors.push(descriptor);
            return EnumerationResult.Continue;
        }, obeyScaleWithObject);
        return descriptors;
    }

    get isAnchoredToSpread() {
        return this.currentDescriptor.isAnchoredToSpread
    }

    setIsAnchoredToSpread(anchored, applyToAllFills, preview) {
        const node = this.node;
        const doc = node.document;
        return doc.setBrushFillIsAnchoredToSpread(anchored, node, {applyToAllFills: applyToAllFills}, preview);
    }

    set isAnchoredToSpread(value) {
        this.setIsAnchoredToSpread(value);
    }

    // aliases
    get fillDescriptor() {
        return this.getCurrentDescriptor(true);
    }

    set fillDescriptor(fillDescriptorOrColour) {
        this.setCurrentDescriptor(fillDescriptorOrColour, null, false);
    }

    get allDescriptors() {
        return this.getAllDescriptors();
    }
}

module.exports.BrushFillInterface = BrushFillInterface;
module.exports.ContentType = ContentType;
