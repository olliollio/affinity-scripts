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
const {ImageResourceInterface} = require('/imageresourceinterface.js');
const {ColourProfileSet} = require('/colour.js');
const {createTypedNode} = require('/node.js');

function testImageResourceInterface() {
    const doc = app.documents.current;
    if (doc) {
        // make sure your doc has a imagenode as its first node
        const imageNode = doc.layers.first;
        const imgResInterface = imageNode.imageResourceInterface;
        
        console.log("Getters of imageResourceInterface:");
        console.log(".imageFilePath:");
        console.log(imgResInterface.imageFilePath);
        
        console.log(".getImageFileSize(asBigInt):");
        console.log(imgResInterface.getImageFileSize(false));
        console.log(imgResInterface.getImageFileSize(true));
        
        console.log(".getModifiedTime(asBigInt):");
        console.log(imgResInterface.getModifiedTime(false));
        console.log(imgResInterface.getModifiedTime(true));
        
        console.log(".fileType:");
        console.log(imgResInterface.fileType);
        
        console.log(".fileTypeName:");
        console.log(imgResInterface.fileTypeName);
        
        console.log(".page:");
        console.log(imgResInterface.page);
        
        console.log(".artboard:");
        console.log(imgResInterface.artboard);
        
        console.log(".isOnArtboard:");
        console.log(imgResInterface.isOnArtboard);
        
        console.log(".originalDPI:");
        console.log(imgResInterface.originalDPI);
        
        console.log(".iccProfile:");
        console.log(imgResInterface.iccProfile);
        
        console.log(".placedSize:");
        console.log(imgResInterface.placedSize);
        
        console.log(".originalSize:");
        console.log(imgResInterface.originalSize);
        
        console.log(".imagePlacement:");
        console.log(imgResInterface.imagePlacement);
        
        console.log(".masterPage:");
        console.log(imgResInterface.masterPage);
        
        console.log(".resourceNode:");
        console.log(imgResInterface.resourceNode);
        
        console.log(".canEditOriginalImage:");
        console.log(imgResInterface.canEditOriginalImage);
        
        console.log("Functions of image resource interface:");
        console.log(".getColourFormat(allowRemote):");
        console.log(imgResInterface.getColourFormat(false));
        
        const colourProfileSet = ColourProfileSet.default;
        console.log(".getSmallThumbnail(format, colourProfileSet):");
        console.log(imgResInterface.getSmallThumbnail(0, colourProfileSet));
        
        console.log(".getLargeThumbnail(format, colourProfileSet):");
        console.log(imgResInterface.getLargeThumbnail(0, colourProfileSet));
        
        console.log(".createFileTypeName():");
        console.log(imgResInterface.createFileTypeName());
        
        console.log(".saveOriginalFile(filename):");
        console.log(imgResInterface.saveOriginalFile("definitelyanewname.png"));
    }
}

module.exports.testImageResourceInterface = testImageResourceInterface;
