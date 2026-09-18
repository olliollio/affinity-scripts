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

const {PhysicalRootInterface} = require('/physicalrootinterface.js');
const {PhysicalRootPropertiesInterface} = require('/physicalrootpropertiesinterface.js');
const {Document, NewDocumentOptions} = require('/document.js');

function runTests() {
    let options = NewDocumentOptions.createDefault();
    options.createArtboard = true;
    let doc = Document.createFromOptions(options);
    console.assert(doc);

    let artboardInterface = doc.layers.first.artboardInterface;
    console.log(artboardInterface);
    console.log('description:', artboardInterface.description);
    console.log('enabled:', artboardInterface.enabled);
    console.log('topOfPageMargin:', artboardInterface.topOfPageMargin);
    console.log('spreadBaseBox:', artboardInterface.spreadBaseBox);
    console.log('baseBox:', artboardInterface.baseBox);
    console.log('pageCount:', artboardInterface.physicalRootInterface.physicalRootProperties.pageCount);
    console.log('\n');

    let artboardProperties = artboardInterface.artboardProperties;
    console.log(artboardProperties);
    console.log('marginBox:', artboardInterface.marginBox);
    console.log('marginFill:', artboardProperties.marginFill);
    console.log('\n');

    let marginsInterface = artboardProperties.marginsInterface;
    console.log(marginsInterface);
    console.log('hasMargins:', marginsInterface.hasMargins);
    console.log('useMargins:', marginsInterface.useMargins);
    console.log('\n');

    let physicalRootPropertiesInterface = artboardProperties.physicalRootPropertiesInterface;
    console.log(physicalRootPropertiesInterface);
    console.log('pageCount:', physicalRootPropertiesInterface.pageCount);
    console.log('\n');

    let physicalRootInterface = artboardInterface.physicalRootInterface;
    console.log(physicalRootInterface);
    console.log('properties:', physicalRootInterface.physicalRootProperties);
    console.log('\n');

    let spread = doc.spreads.first;
    console.log(spread);
    console.log('physicalRootInterface.physicalRootProperties:', spread.physicalRootInterface.physicalRootProperties);
    console.log('PhysicalRootInterface.fromNode:', PhysicalRootInterface.fromNode(spread));
    console.log('PhysicalRootPropertiesInterface.fromNode:', PhysicalRootPropertiesInterface.fromNode(spread));
    console.log('\n');

    //doc.close();
}

module.exports.runTests = runTests;
