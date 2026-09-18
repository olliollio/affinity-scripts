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

const { app } = require('/application.js');
const { BuildKind, UiParadigm } = require('affinity:application');

function runTests() {
    console.assert(typeof app.compileDate === "string");
    console.assert(typeof app.platformName === "string");
    console.assert(typeof app.shortVersion === "string");
    console.assert(typeof app.version === "string");
    console.assert(typeof app.buildVersion === "number");
    console.assert(typeof app.majorVersion === "number");
    console.assert(typeof app.minorVersion === "number");
    console.assert(typeof app.revisionVersion === "number");

    console.assert(app.buildKind instanceof BuildKind);
    console.assert(typeof app.productCopyrightMessage === "string");
    console.assert(typeof app.productFullName === "string");
    console.assert(typeof app.productLongName === "string");
    console.assert(typeof app.productPrimaryFileExtension === "string");
    console.assert(typeof app.productShortName === "string");
    console.assert(typeof app.productVersionName === "string");
    console.assert(typeof app.suiteFullName === "string");
    console.assert(app.uiParadigm instanceof UiParadigm);
    console.log(app.argC);
    console.log(app.argV);
}

module.exports.runTests = runTests;
