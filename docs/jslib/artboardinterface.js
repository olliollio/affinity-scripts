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

const { ArtboardInterfaceApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const ArtboardPropertiesModule = require('/artboardproperties.js');
const NodesModule = require('/nodes.js');
const PhysicalRootInterfaceModule = require('/physicalrootinterface.js');

// monkey patches:
require('/geometry.js');

class ArtboardInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'ArtboardInterface';
    }

    isSameObject(other) {
        return ArtboardInterfaceApi.isSameObject(this.handle, other.handle);
    }

    get isArtboardInterface() {
        return true;
    }

    get isArtboardEnabled() {
        return ArtboardInterfaceApi.isArtboardEnabled(this.handle);
    }

    get description() {
        return ArtboardInterfaceApi.getArtboardDescription(this.handle);
    }
    
    get baseBox() {
        return ArtboardInterfaceApi.getArtboardBaseBox(this.handle);
    }
    
    get spreadBaseBox() {
        return ArtboardInterfaceApi.getArtboardSpreadBaseBox(this.handle);
    }

    get marginBox() {
        const properties = this.artboardProperties;
        if (!properties)
            return null;
        const box = this.spreadBaseBox;
        const marginsInterface = properties.marginsInterface;
        if (marginsInterface.useMargins) {
            const margins = marginsInterface.margins;
            box.x += margins.left;
            box.y += margins.top;
            box.width -= margins.left + margins.right;
            box.height -= margins.top + margins.bottom;
        }
        return box;
    }
    
    get topOfPageMargin() {
        return ArtboardInterfaceApi.getTopOfPageMargin(this.handle);
    }

    get artboardProperties() {
        const handle = ArtboardInterfaceApi.getArtboardProperties(this.handle);
        return handle ? new ArtboardPropertiesModule.ArtboardProperties(handle) : null;
    }

    get node() {
        return NodesModule.createTypedNode(ArtboardInterfaceApi.getNode(this.handle));
    }
    
    #physicalRootInterface;
    get physicalRootInterface() {
        if (!this.#physicalRootInterface)
            this.#physicalRootInterface = new PhysicalRootInterfaceModule.PhysicalRootInterface(ArtboardInterfaceApi.getPhysicalRootInterface(this.handle));
        return this.#physicalRootInterface;
    }
    
    get physicalRootProperties() {
        return this.physicalRootInterface.physicalRootProperties;
    }
    
    get pageCount() {
        return this.physicalRootProperties?.pageCount ?? 0;
    }

    setArtboardEnabled(enabled, preview) {
        const node = this.node;
        return node.document.setArtboardEnabled(enabled, node, preview);
    }

    set isArtboardEnabled(enabled) {
        this.setArtboardEnabled(enabled);
    }
}

module.exports.ArtboardInterface = ArtboardInterface;
