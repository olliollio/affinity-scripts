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

const { HttpRequestApi, HttpRequestResult, HttpResponseApi, HttpStatusCode, RequestMethod } = require('affinity:network');
const { HandleObject } = require('/handleobject.js');

class HttpRequest extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'HttpRequest';
    }

    setTimeoutInSec(timeoutSec) {
        return HttpRequestApi.setTimeoutInSec(this.handle, timeoutSec);
    }
    
    setSuppressUserAgentHeader(suppress) {
        return HttpRequestApi.setSuppressUserAgentHeader(this.handle, suppress);
    }
    
    setEncodeHeaderValuesAsRfc2047(encodeAs2047) {
        return HttpRequestApi.setEncodeHeaderValuesAsRfc2047(this.handle, encodeAs2047);
    }
    
    setUseExpensiveNetwork(useExpensive) {
        return HttpRequestApi.setUseExpensiveNetwork(this.handle, useExpensive);
    }
    
    setUseConstrainedNetwork(useConstrained) {
        return HttpRequestApi.setUseConstrainedNetwork(this.handle, useConstrained);
    }
    
    setAvoidChunkedTransferEncoding(avoid) {
        return HttpRequestApi.setAvoidChunkedTransferEncoding(this.handle, avoid);
    }
    
    setHeaderValue(headerKey, headerVal) {
        return HttpRequestApi.setHeaderValue(this.handle, headerKey, headerVal);
    }
    
    getHeaderValue(headerKey) {
        return HttpRequestApi.getHeaderValue(this.handle, headerKey);
    }

    do() {
        var result = HttpRequestApi.do(this.handle);
        result.response = new HttpResponse(result.response);
        return result;
    }

    doAsync(callback) {
        if (typeof callback === 'function') {
            function wrapped(state, responseHandle, reason) {
                callback(state, new HttpResponse(responseHandle), reason);
            }
            return HttpRequestApi.doAsync(this.handle, wrapped);
        }
        return HttpRequestApi.doAsync(this.handle, callback);
    }
    
    static create(url, method) {
        return new HttpRequest(HttpRequestApi.create(url, method));
    }
}

class HttpResponse extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'HttpResponse';
    }
    
    get statusCode() {
        return HttpResponseApi.getStatusCode(this.handle);
    }

    getHeaderValue(headerKey) {
        return HttpResponseApi.getHeaderValue(this.handle, headerKey);
    }

    get content() {
        return HttpResponseApi.getContent(this.handle);
    }
}

module.exports.HttpRequest = HttpRequest;
module.exports.HttpRequestResult = HttpRequestResult;
module.exports.HttpResponse = HttpResponse;
module.exports.RequestMethod = RequestMethod;
module.exports.HttpStatusCode = HttpStatusCode;
