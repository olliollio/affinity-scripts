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

const { FileType, ImagePlacement, ImageResourceInterfaceApi } = require('affinity:dom');
const { RasterFormat } = require('affinity:raster');
const { HandleObject} = require('/handleobject.js');

// cyclics:
const NodesModule = require('/nodes.js');

class ImageResourceInterface extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'ImageResourceInterface';
    }
    
    get imageFilePath() {
        return ImageResourceInterfaceApi.getImageFilePath(this.handle);
    }
    
    getImageFileSize(asBigInt) {
        return ImageResourceInterfaceApi.getImageFileSize(this.handle, asBigInt);
    }

    get imageFileSize() {
        return this.getImageFileSize();
    }
    
    getModifiedTime(asBigInt) {
        return ImageResourceInterfaceApi.getModifiedTime(this.handle, asBigInt);
    }

    get modifiedTime() {
        return this.getModifiedTime();
    }
    
    get fileType() {
        return ImageResourceInterfaceApi.getFileType(this.handle);
    }
    
    get fileTypeName() {
        return ImageResourceInterfaceApi.getFileTypeName(this.handle);
    }
    
    get page() {
        return ImageResourceInterfaceApi.getPage(this.handle);
    }
    
    get artboard() {
        return ImageResourceInterfaceApi.getArtboard(this.handle);
    }
    
    get isOnArtboard() {
        return ImageResourceInterfaceApi.isOnArtboard(this.handle);
    }
    
    get originalDPI() {
        return ImageResourceInterfaceApi.getOriginalDPI(this.handle);
    }
    
    get iccProfile() {
        return ImageResourceInterfaceApi.getICCProfile(this.handle);
    }
    
    get placedSize() {
        return ImageResourceInterfaceApi.getPlacedSize(this.handle);
    }
    
    get originalSize() {
        return ImageResourceInterfaceApi.getOriginalSize(this.handle);
    }
    
    getColourFormat(allowRemote) {
        return ImageResourceInterfaceApi.getColourFormat(this.handle, allowRemote);
    }
    
    get imagePlacement() {
        return ImageResourceInterfaceApi.getImagePlacement(this.handle);
    }
    
    get masterPage() {
        return ImageResourceInterfaceApi.getMasterPage(this.handle);
    }
    
    getSmallThumbnail(format, colourProfileSet) {
        return ImageResourceInterfaceApi.getSmallThumbnail(this.handle, format, colourProfileSet.handle);
    }
    
    getLargeThumbnail(format, colourProfileSet) {
        return ImageResourceInterfaceApi.getLargeThumbnail(this.handle, format, colourProfileSet.handle);
    }
    
    get resourceNode() {
        return NodesModule.createTypedNode(ImageResourceInterfaceApi.getResourceNode(this.handle));
    }
    
    get canEditOriginalImage() {
        return ImageResourceInterfaceApi.canEditOriginalImage(this.handle);
    }
    
    
    createFileTypeName() {
        return ImageResourceInterfaceApi.createFileTypeName(this.handle);
    }
    
    saveOriginalFile(filename) {
        return ImageResourceInterfaceApi.saveOriginalFile(this.handle, filename);
    }

    get node() {
        return NodesModule.createTypedNode(ImageResourceInterfaceApi.getNode(this.handle));
    }
}

module.exports.FileType = FileType;
module.exports.ImagePlacement = ImagePlacement;
module.exports.ImageResourceInterface = ImageResourceInterface;
module.exports.RasterFormat = RasterFormat;
