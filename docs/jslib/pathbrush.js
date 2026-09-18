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

const {
    CornerStrategy,
    PathBrushApi,
    PathBrushDynamicControllerType
} = require('affinity:brushes');

const { Spline } = require('/geometry.js');
const { HandleObject } = require('/handleobject.js');

class PathBrush extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'PathBrush';
    }

    static createDefault() {
        // Note: This would need to be implemented in the C++ API
        throw new Error('PathBrush.createDefault() not yet implemented in C++ API');
    }

    clone() {
        return new PathBrush(PathBrushApi.clone(this.handle));
    }

    // Simplified size properties (direct access, no BrushDynamic objects)
    get brushWidth() {
        return PathBrushApi.getBrushWidth(this.handle);
    }

    set brushWidth(newBrushWidth) {
        PathBrushApi.setBrushWidth(this.handle, newBrushWidth);
    }

    get sizeVariance() {
        return PathBrushApi.getSizeVariance(this.handle);
    }

    set sizeVariance(newSizeVariance) {
        PathBrushApi.setSizeVariance(this.handle, newSizeVariance);
    }

    get sizeControllerType() {
        return PathBrushApi.getSizeControllerType(this.handle);
    }

    set sizeControllerType(newSizeControllerType) {
        PathBrushApi.setSizeControllerType(this.handle, newSizeControllerType);
    }

    #sizeSpline;
    get sizeSpline() {
        if (!this.#sizeSpline)
            this.#sizeSpline = new Spline(PathBrushApi.getSizeSpline(this.handle));
        return this.#sizeSpline;
    }

    set sizeSpline(newSizeSpline) {
        PathBrushApi.setSizeSpline(this.handle, newSizeSpline.handle);
        this.#sizeSpline = null; // Clear cache
    }

    // Opacity properties
    get opacityVariance() {
        return PathBrushApi.getOpacityVariance(this.handle);
    }

    set opacityVariance(newOpacityVariance) {
        PathBrushApi.setOpacityVariance(this.handle, newOpacityVariance);
    }

    // Path brush-specific properties
    get tailOffset() {
        return PathBrushApi.getTailOffset(this.handle);
    }

    set tailOffset(newTailOffset) {
        PathBrushApi.setTailOffset(this.handle, newTailOffset);
    }

    get headOffset() {
        return PathBrushApi.getHeadOffset(this.handle);
    }

    set headOffset(newHeadOffset) {
        PathBrushApi.setHeadOffset(this.handle, newHeadOffset);
    }

    get isRepeat() {
        return PathBrushApi.isRepeat(this.handle);
    }

    set isRepeat(newIsRepeat) {
        PathBrushApi.setIsRepeat(this.handle, newIsRepeat);
    }

    get cornerStrategy() {
        return PathBrushApi.getCornerStrategy(this.handle);
    }

    set cornerStrategy(newCornerStrategy) {
        PathBrushApi.setCornerStrategy(this.handle, newCornerStrategy);
    }
}

module.exports.PathBrush = PathBrush;
module.exports.PathBrushDynamicControllerType = PathBrushDynamicControllerType;
module.exports.CornerStrategy = CornerStrategy;
