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
const {HttpRequest, HttpResponse, RequestMethod, HttpStatusCode} = require('/network.js');
const {ErrorCode} = require('affinity:common');

function RequestCB(reqState, response, reason) {
    console.assert(reqState.value === ErrorCode.OK.value);
    console.assert(response.statusCode.value === HttpStatusCode.Ok.value);
    console.assert(response.content);
    console.log("Test Ok");
}

async function HttpRequestGetTestAsync() {
    var req = HttpRequest.create("https://affinity.serif.com/en-gb/", RequestMethod.Get);
    await req.doAsync(RequestCB);
}

async function HttpRequestPostTestAsync() {
    var req = HttpRequest.create("https://httpbin.org/post", RequestMethod.Post);
    req.setHeaderValue("accept", "application/json");
    await req.doAsync(RequestCB);
}

function HttpRequestGetTest() {
    var req = HttpRequest.create("https://affinity.serif.com/en-gb/", RequestMethod.Get);
    var result = req.do();
    RequestCB(result.state, result.response, result.reason);
}
 
function HttpRequestPostTest() {
    var req = HttpRequest.create("https://httpbin.org/post", RequestMethod.Post);
    req.setHeaderValue("accept", "application/json");
    var result = req.do();
    RequestCB(result.state, result.response, result.reason);
 }

async function runTests() {
    console.log("GET async:");
    await HttpRequestGetTestAsync();
    console.log("POST async:");
    await HttpRequestPostTestAsync();
    console.log("GET sync:");
    HttpRequestGetTest();
    console.log("POST sync:");
    HttpRequestPostTest();
}


module.exports.runTests = runTests;
module.exports.HttpRequestGetTest = HttpRequestGetTest;
