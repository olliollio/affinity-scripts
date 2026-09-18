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
const { HatchLineApi, HatchPatternApi } = require('affinity:hatches');
const { HandleObject } = require('/handleobject.js');

// monkey patches:
require('/geometry.js');

class HatchLine extends HandleObject {
    constructor(handle) {
        super(handle)
    }

    get [Symbol.toStringTag]() {
        return 'HatchLine';
    }

    clone() {
        return new HatchLine(HatchLineApi.clone(this.handle));
    }

    static create(origin, rotation, step, pattern) {
        return new HatchLine(HatchLineApi.create(origin, rotation, step, pattern?.handle));
    }

    get origin() {
        return HatchLineApi.getOrigin(this.handle);
    }

    get rotation() {
        return HatchLineApi.getRotation(this.handle);
    }

    get step() {
        return HatchLineApi.getStep(this.handle);
    }

    get patternDashCount() {
        return HatchLineApi.getPatternDashCount(this.handle);
    }

    getPatternDash(index) {
        return HatchLineApi.getPatternDash(this.handle, index);
    }

    get pattern() {
        let res = [];
        this.enumeratePattern(dash => {
            res.push(dash);
            return EnumerationResult.Continue;
        });
        return res;
    }

    enumeratePattern(callback) {
        return HatchLineApi.enumeratePattern(this.handle, callback);
    }

    get isSolid() {
        return HatchLineApi.isSolid(this.handle);
    }

    set origin(value) {
        HatchLineApi.setOrigin(this.handle, value);
    }

    set rotation(value) {
        HatchLineApi.setRotation(this.handle, value);
    }

    set step(value) {
        HatchLineApi.setStep(this.handle, value);
    }

    set pattern(value) {
        HatchLineApi.setPattern(this.handle, value);
    }
}


class HatchPattern extends HandleObject {
    constructor(handle) {
        super(handle)
    }

    get [Symbol.toStringTag]() {
        return 'HatchPattern';
    }

    clone() {
        return new HatchPattern(HatchPatternApi.clone(this.handle));
    }

    static createEmpty() {
        return new HatchPattern(HatchPatternApi.createEmpty());
    }

    static createDefault() {
        return new HatchPattern(HatchPatternApi.createDefault());
    }

    get hatchLineCount() {
        return HatchPatternApi.getHatchLineCount(this.handle);
    }

    getHatchLine(index) {
        return new HatchLine(HatchPatternApi.getHatchLine(this.handle, index));
    }

    enumerateHatchLines(callback) {
        if (typeof callback === 'function') {
            function wrapped(handle) {
                return callback(new HatchLine(handle));
            }
            return HatchPatternApi.enumerateHatchLines(this.handle, wrapped);
        }
        return HatchPatternApi.enumerateHatchLines(this.handle, callback);
    }

    appendHatchLine(hatchLine) {
        return HatchPatternApi.appendHatchLine(this.handle, hatchLine.handle);
    }

    appendHatchLineData(origin, rotation, step, pattern) {
        return HatchPatternApi.appendHatchLineData(this.handle, origin, rotation, step, pattern);
    }

    clearHatchLines() {
        return HatchPatternApi.clearHatchLines(this.handle);
    }

    eraseHatchLine(index) {
        return HatchPatternApi.eraseHatchLine(this.handle, index);
    }

    insertHatchLine(index, hatchLine) {
        return HatchPatternApi.insertHatchLine(this.handle, index, hatchLine.handle);
    }

    insertHatchLineData(index, origin, rotation, step, pattern) {
        return HatchPatternApi.insertHatchLineData(this.handle, index, origin, rotation, step, pattern);
    }
}

module.exports.HatchLine = HatchLine;
module.exports.HatchPattern = HatchPattern;
