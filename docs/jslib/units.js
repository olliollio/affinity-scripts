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

const { UnitCategory, UnitType, UnitValue, UnitValueApi, UnitValueConverterApi, UserUnitType } = require('affinity:common');
const { HandleObject } = require('/handleobject.js');

// Add object-oriented helpers to the UnitValue prototype that delegate to UnitValueApi
Object.assign(UnitValue.prototype, {
    assign: function(source) { UnitValueApi.assign(this, source); return this; },
    makeZero: function() { UnitValueApi.makeZero(this); return this; },
    makeInfinity: function() { UnitValueApi.makeInfinity(this); return this; },
    getValueAsDegrees: function() { return UnitValueApi.getValueAsDegrees(this); },
    getValueAsRadians: function() { return UnitValueApi.getValueAsRadians(this); },
    getValueAsNumber: function() { return UnitValueApi.getValueAsNumber(this); },
    getValueAsPixels: function(converter) { return UnitValueApi.getValueAsPixels(this, converter); },
    getValueAsUnitType: function(converter, unitType) { return UnitValueApi.getValueAsUnitType(this, converter, unitType); },
    getValueAsUnitTypePower: function(converter, unitTypePower) { return UnitValueApi.getValueAsUnitTypePower(this, converter, unitTypePower); },
});

Object.defineProperties(UnitValue.prototype, {
    isFinite: { get() { return UnitValueApi.isFinite(this); } },
});

// Static helpers on UnitValue that delegate to UnitValueApi
UnitValue.getTypeCategory = function(unitType) { return UnitValueApi.getTypeCategory(unitType); };

class UnitValueConverter extends HandleObject {
    constructor(handle) {
        super(handle)
    }

    get [Symbol.toStringTag]() {
        return 'UnitValueConverter';
    }

    static create(dpi, viewDpi = -1) {
        return new UnitValueConverter(UnitValueConverterApi.createWithViewDpi(dpi, viewDpi));
    }

    clone() {
        return new UnitValueConverter(UnitValueConverterApi.clone(this.handle));
    }

    get dpi() {
        return UnitValueConverterApi.getDpi(this.handle);
    }

    get viewDpi() {
        return UnitValueConverterApi.getViewDpi(this.handle);
    }

    getConversionFactor(from, to) {
        return UnitValueConverterApi.getConversionFactor(this.handle, from, to);
    }
}

module.exports.UnitCategory = UnitCategory;
module.exports.UnitType = UnitType;
module.exports.UnitValue = UnitValue;
module.exports.UnitValueConverter = UnitValueConverter;
module.exports.UserUnitType = UserUnitType;
