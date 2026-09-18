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
const {createTypedNode} = require('/node.js');

function testImageNode() {
    const doc = app.documents.current;
    if (doc) {
        // make sure your doc has a imagenode as its first node
        const imageNode = doc.layers.first;
        
        console.log("The extend type of the image node is:");
        console.log(imageNode.extendType);
        
        console.log("The upsampler type of the image node is:");
        console.log(imageNode.upsamplerType);
        
        console.log("The stock URL of the image node is:");
        console.log(imageNode.stockURL);
        
        console.log("The stock user profile URL of the image node is:");
        console.log(imageNode.stockUserProfileURL);
        
        console.log("The stock author of the image node is:");
        console.log(imageNode.stockAuthor);
        
        console.log("The last rendered timestamp of the image node is:");
        console.log(imageNode.lastRendered);
        
        console.log("The bitmap brush fill descriptor of the image node is:");
        console.log(imageNode.bitmapBrushFillDescriptor);
        
        console.log("Is the image node k only:");
        console.log(imageNode.isKOnly);
        
        console.log("The image resource interface of the image node is:")
        console.log(imageNode.imageResourceInterface)
        
        console.log("The raster interface of the image node is:")
        console.log(imageNode.rasterInterface)
    }
}

module.exports.testImageNode = testImageNode;
