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
const {app} = require('/application.js');
const {Document, DocumentPromises, DocumentPreset} = require('/document.js');
const {PixelBuffer, RasterFormat} = require('/rasterobject.js');

class TestUtils {
    static getRandomRGBA8Bitmap(width, height) {
        let pixels = PixelBuffer.create(width, height, RasterFormat.RGBA8);
        let view = new Uint8Array(pixels.buffer);
        for (let i = 0; i < view.length; i++) {
            view[i] = Math.floor(Math.random() * 256);
        }
        return pixels.createCompatibleBitmap(true);
    }
    
    static getFile(filename) {
        let path = __dirname.concat(filename);
        console.log(path);
        return Document.load(path);
    }

    static floatEqual(a, b, epsilon = 1e-6) {
        return (Math.abs(a - b) < epsilon);
    }

    static strEqual(stra, strb) {
        return (stra.includes(strb) && strb.includes(stra));
    }
    
    static newA4Empty() {
        let a4p = DocumentPreset.all.filter(preset => preset.name.includes("A4"))[0];
        return Document.createFromPreset(a4p, false);
    }

}


module.exports.TestUtils = TestUtils;
