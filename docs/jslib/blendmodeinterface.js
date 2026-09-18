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

const { AntialiasingMode, BlendModeInterfaceApi, BlendOptionsApi } = require('affinity:dom');
const { BlendMode } = require('affinity:common');
const { Spline } = require('/geometry.js');
const { HandleObject } = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');

class BlendOptions extends HandleObject {
    get [Symbol.toStringTag]() {
        return 'BlendOptions';
    }
    
    constructor(handle) {
        super(handle);
    }

    get isBlendOptions() {
        return true;
    }
    
    get gamma() {
        return BlendOptionsApi.getGamma(this.handle);
    }
    
    set gamma(value) {
        BlendOptionsApi.setGamma(this.handle, value);
    }
    
    get masterSourceLayerRanges() {
        return new Spline(BlendOptionsApi.getMasterSourceLayerRanges(this.handle));
    }
    
    set masterSourceLayerRanges(spline) {
        BlendOptionsApi.setMasterSourceLayerRanges(this.handle, spline.handle);
    }
    
    get masterUnderlyingCompositionRanges() {
        return new Spline(BlendOptionsApi.getMasterUnderlyingCompositionRanges(this.handle));
    }
    
    set masterUnderlyingCompositionRanges(spline) {
        BlendOptionsApi.setMasterUnderlyingCompositionRanges(this.handle, spline.handle);
    }
    
    getChannelSourceLayerRanges(channel) {
        return new Spline(BlendOptionsApi.getChannelSourceLayerRanges(this.handle, channel));
    }
    
    setChannelSourceLayerRanges(channel, spline) {
        BlendOptionsApi.setChannelSourceLayerRanges(this.handle, channel, spline.handle);
    }
    
    getChannelUnderlyingCompositionRanges(channel) {
        return new Spline(BlendOptionsApi.getChannelUnderlyingCompositionRanges(this.handle, channel));
    }
    
    setChannelUnderlyingCompositionRanges(channel, spline) {
        BlendOptionsApi.setChannelUnderlyingCompositionRanges(this.handle, channel, spline.handle);
    }
}

class BlendModeInterface extends HandleObject {
    get [Symbol.toStringTag]() {
        return 'BlendModeInterface';
    }
    
    constructor(handle) {
        super(handle);
    }

    get isBlendModeInterface() {
        return true;
    }
    
    get blendMode() {
        return BlendModeInterfaceApi.getBlendMode(this.handle);
    }
    
    get blendOptions() {
        return new BlendOptions(BlendModeInterfaceApi.getBlendOptions(this.handle));
    }
    
    get antialiasingMode() {
        return BlendModeInterfaceApi.getAntialiasingMode(this.handle);
    }

    get node() {  
        return NodesModule.createTypedNode(BlendModeInterfaceApi.getNode(this.handle));
    }

    setBlendMode(blendMode, setPassthrough) {
        const node = this.node;
        const doc = node.document;
        return doc.setBlendMode(blendMode, setPassthrough, node);
    }
}

module.exports.BlendOptions = BlendOptions;
module.exports.BlendModeInterface = BlendModeInterface;
module.exports.BlendMode = BlendMode;
module.exports.AntialiasingMode = AntialiasingMode;
