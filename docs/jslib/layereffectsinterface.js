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
const { LayerEffectsInterfaceApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');
const { createTypedLayerEffect } = require('/layereffects.js');

// cyclics:
const NodesModule = require('/nodes.js');

class LayerEffectsInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'LayerEffectsInterface';
    }

    get effectCount() {
        return LayerEffectsInterfaceApi.getEffectCount(this.handle);
    }

    getEffect(index) {
        return createTypedLayerEffect(LayerEffectsInterfaceApi.getEffect(this.handle, index));
    }

    enumerateEffects(callback) {
        if (typeof callback === 'function') {
            function wrapped(effectHandle) {
                return callback(createTypedLayerEffect(effectHandle));
            }
            return LayerEffectsInterfaceApi.enumerateEffects(this.handle, wrapped);
        }
        return LayerEffectsInterfaceApi.enumerateEffects(this.handle, callback);
    }

    get effects() {
        const res = [];
        this.enumerateEffects(effect => {
            res.push(effect);
            return EnumerationResult.Continue;
        });
        return res;
    }

    get hasAnyVisibleEffects() {
        return LayerEffectsInterfaceApi.hasAnyVisibleEffects(this.handle);
    }

    get hasActiveEffects() {
        return LayerEffectsInterfaceApi.hasActiveEffects(this.handle);
    }

    get isScaleWithObject() {
        return LayerEffectsInterfaceApi.isScaleWithObject(this.handle);
    }

    get node() {
        return NodesModule.createTypedNode(LayerEffectsInterfaceApi.getNode(this.handle));
    }
}

module.exports.LayerEffectsInterface = LayerEffectsInterface;
