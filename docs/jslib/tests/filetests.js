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

const {Buffer} = require('/buffer.js');
const {File, FileAsyncs, FileOrigin} = require('/file.js');
const {ErrorCode} = require('affinity:common');

function getDataPath(file) {
    return __dirname.concat('/testdata/'.concat(file));
}

function testOpen() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path);
    console.assert(f);
    console.assert(f.handle);
    console.assert(f.isOpen);
    f.close();
    console.assert(!f.isOpen);
}

function testDeferredOpen() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create();
    console.assert(f);
    console.assert(f.handle);
    console.assert(!f.isOpen);
    f.open(path);
    console.assert(f.isOpen);
    f.close();
    console.assert(!f.isOpen);
}

function testReadAll() {
    const path = getDataPath('filereaddata.txt');
    const buf = File.readAll(path);
    console.assert(buf instanceof Buffer);
    const expected = 'The quick brown fox jumps over the lazy dog\n';
    console.assert(buf.toString() == expected);
}

function testRead() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    console.assert(f.position == 0);
    
    let buf = Buffer.create(128);
    let num = f.read(buf, 3);
    console.assert(num == 3);
    console.assert(f.position == 3);
    console.assert(buf.toString() == 'The');
    
    buf = Buffer.create(128);
    f.seek(7, FileOrigin.Current);
    console.assert(f.position == 10);
    num = f.read(buf, 5);
    console.assert(num == 5);
    console.assert(f.position == 15);
    console.assert(buf.toString() == 'brown');
    
    buf = Buffer.create(128);
    f.seek(1, FileOrigin.Current);
    console.assert(f.position == 16);
    num = f.read(buf, 1);
    console.assert(num == 1);
    console.assert(f.position == 17);
    console.assert(buf.toString() == 'f');
    
    // rewind and repeat
    buf = Buffer.create(128);
    f.seek(-1, FileOrigin.Current);
    console.assert(f.position == 16);
    num = f.read(buf, 1);
    console.assert(num == 1);
    console.assert(f.position == 17);
    console.assert(buf.toString() == 'f');
    
    // test reading into a buffer smaller than the requested size
    f.seek(0, FileOrigin.Begin);
    buf = Buffer.create(5);
    num = f.read(buf, 10);
    console.assert(num == 5);
    console.assert(f.position == 5);
    console.assert(buf.toString() == 'The q');
}


function testRepeatedReads() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    f.seek(0, FileOrigin.Begin);
    console.assert(f.position == 0);
    let buf = Buffer.create(length);
    for (let i = 0; i < length; ++i) {
        f.read(buf.span(i), 1);
    }
    const expected = 'The quick brown fox jumps over the lazy dog\n';
    console.assert(buf.toString() == expected);
}


function testSeekAndTellBegin() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    for (let i = 0; i < 100; ++i) {
        let pos = Math.round(Math.random() * length);
        f.seek(pos, FileOrigin.Begin);
        console.assert(f.tell() == pos);
    }
}

function testSeekAndTellEnd() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    for (let i = 0; i < 100; ++i) {
        let pos = Math.round(Math.random() * length);
        f.seek(-pos, FileOrigin.End);
        console.assert(f.tell() == length - pos);
    }
}

function testSeekAndTellCurrent() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    
    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    for (let i = 0; i < 100; ++i) {
        let pos = Math.round(Math.random() * length);
        let relPos = pos - f.position
        f.seek(relPos, FileOrigin.Current);
        console.assert(f.tell() == pos);
    }
}

function testSeekUnder() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    f.seek(-1, FileOrigin.Begin)
    console.assert(f.position == 0);
    f.seek(-1, FileOrigin.Current)
    console.assert(f.position == 0);
    f.seek(-(length + 1), FileOrigin.End)
    console.assert(f.position == 0);
}

function testEof() {
    const path = getDataPath('filereaddata.txt');
    let f = File.create(path, "rb");
    const length = f.length;
    const buf = Buffer.create(length * 2);
    f.read(buf, buf.length);
    console.assert(f.isEof);
}

function testReadAllAsync() {
    const path = getDataPath('filereaddata.txt');
    FileAsyncs.readAll(path, (err, num, buf) => {
        console.assert(buf instanceof Buffer);
        const expected = 'The quick brown fox jumps over the lazy dog\n';
        console.assert(num == expected.length);
        console.assert(buf.toString() == expected);
    });
}

function testSequentialReadsAsync() {
    const path = getDataPath('filereaddata.txt');
    const length = File.length(path);
    const expected = 'The quick brown fox jumps over the lazy dog\n';
    let f = File.create(path);
    let buf = Buffer.create(length);
    let i = 0;
    
    function callback(err, num) {
        console.assert(!err || err.errorCode.value == ErrorCode.OK);
        console.assert(num == 1);
        if (i + 1 < length) {
            ++i;
            f.readAsync(buf.span(i), i, 1, callback);
        }
        else {
            console.assert(buf.toString() == expected);
        }
    }
    
    f.readAsync(buf, i, 1, callback);
}


function runAll() {
    testOpen();
    testDeferredOpen();
    testReadAll();
    testRead();
    testRepeatedReads();
    testSeekAndTellBegin();
    testSeekAndTellEnd();
    testSeekAndTellCurrent();
    testSeekUnder();
    testEof();
    testReadAllAsync();
    testSequentialReadsAsync();
}

module.exports.runAll = runAll;
