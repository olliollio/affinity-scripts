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

const { ShapeInterfaceApi, } = require('affinity:dom');
const { ShapeType } = require('affinity:geometry');
const { HandleObject } = require('/handleobject.js');
const { createTypedShape } = require('/shapes.js');

// cyclics:
const NodesModule = require('/nodes.js');

// monkey patches:
require('/geometry.js');

class ShapeInterface extends HandleObject {

    constructor(handle) {
        super(handle);
    }

    get isShapeInterface() {
        return true;
    }

    get boundingBox() {
        return ShapeInterfaceApi.getShapeBoundingBox(this.handle);
    }

    get shape() {
        let shapeHandle = ShapeInterfaceApi.getShape(this.handle);
        return createTypedShape(shapeHandle);
    }

    get type() {
        return ShapeInterfaceApi.getType(this.handle);
    }

    get domainTransform() {
        return ShapeInterfaceApi.getDomainTransform(this.handle);
    }

    get node() {
        return NodesModule.createTypedNode(ShapeInterfaceApi.getNode(this.handle));
    }

    // mutating helpers
    setShape(shape, preview) {
        const node = this.node;
        return node.document.setShape(shape, node, null, preview);
    }

    // mutating async helpers
    setShapeAsync(shape, callback, preview) {
        const node = this.node;
        return node.document.setShapeAsync(shape, node, callback, preview);
    }

    // mutating properties
    set shape(shape) {
        this.setShape(shape);
    }
}

module.exports.ShapeInterface = ShapeInterface;
module.exports.ShapeType = ShapeType;
