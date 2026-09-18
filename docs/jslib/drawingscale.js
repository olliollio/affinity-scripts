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

const { EnumerationResult, UnitType } = require('affinity:common');
const { DrawingScaleApi } = require('affinity:dom');
const { HandleObject } = require('/handleobject.js');

// monkey patches:
require('/units.js');

class DrawingScale extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'DrawingScale';
    }

    toString(useTightFormat, showUnits, indicateApproximations) {
        return DrawingScaleApi.getAsString(this.handle, useTightFormat, showUnits, indicateApproximations);
    }

    get leftValue() {
        return DrawingScaleApi.getLeftValue(this.handle);
    }

    get rightValue() {
        return DrawingScaleApi.getRightValue(this.handle);
    }

    static enumerateDefaults(units, callback) {
        const wrapped = (drawingScaleHandle) => { return callback(new DrawingScale(drawingScaleHandle)) ;}
        return DrawingScaleApi.enumerateDefaults(units, wrapped);
    }

    static getDefaults(units) {
        let res = [];
        function callback (drawingScale) {
            res.push(drawingScale);
            return EnumerationResult.Continue;
        }
        DrawingScale.enumerateDefaults(units, callback);
        return res;
    }

    static createFromIntegers(left, right, simplifyFaction) {
        return new DrawingScale(DrawingScaleApi.createFromIntegers(left, right, simplifyFaction));
    }

    static create(leftUnitValue, rightUnitValue) {
        return new DrawingScale(DrawingScaleApi.create(leftUnitValue, rightUnitValue));
    }

    static createFromString(str, simplifyFraction, simplifyDecimalPlaces, allowOneToOne) {
        return new DrawingScale(DrawingScaleApi.createFromString(str, simplifyFraction, simplifyDecimalPlaces, allowOneToOne));
    }

    static get identity() {
        return this.createFromIntegers(1, 1);
    }
}

module.exports.DrawingScale = DrawingScale;
module.exports.UnitType = UnitType;
