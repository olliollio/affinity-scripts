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

const { FocalPoint, TransformInterfaceApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');

// monkey patches:
require('/geometry.js');

class TransformInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'TransformInterface';
    }

    get transform() {
        return TransformInterfaceApi.getTransform(this.handle, false);
    }

    getTransform(forceConstraints) {
        return TransformInterfaceApi.getTransform(this.handle, forceConstraints);
    }

    get unconstrainedTransform() {
        return TransformInterfaceApi.getUnconstrainedTransform(this.handle);
    }

    get frameTextScale() {
        return TransformInterfaceApi.getFrameTextScale(this.handle);
    }

    get storyPinPathTransform() {
        return TransformInterfaceApi.getStoryPinPathTransform(this.handle);
    }

    get prefersAspectRatioLockedResize() {
        return TransformInterfaceApi.prefersAspectRatioLockedResize(this.handle);
    }

    get focalPoint() {
        return TransformInterfaceApi.getFocalPoint(this.handle);
    }

    get domainTransform() {
        return TransformInterfaceApi.getDomainTransform(this.handle);
    }

    get node() {
        return NodesModule.createTypedNode(TransformInterfaceApi.getNode(this.handle));
    }

    getDomainTransform() {
        return TransformInterfaceApi.getDomainTransform(this.handle);
    }

    getTextFrameScaleToDomainTransform() {
        return TransformInterfaceApi.getTextFrameScaleToDomainTransform(this.handle);
    }

    getNode() {
        return NodesModule.createTypedNode(TransformInterfaceApi.getNode(this.handle));
    }
}

module.exports.FocalPoint = FocalPoint;
module.exports.TransformInterface = TransformInterface;
