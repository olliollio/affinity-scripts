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
const { Polygon } = require('/geometry.js');
const { EnumerationResult } = require('affinity:common');

function runPolygonTests() {
    console.log("Running Polygon tests...");
    
    // Test creation methods
    testCreateEmpty();
    testCreateLine();
    testCreateTriangle();
    testCreateRectangle();
    
    // Test point manipulation
    testAddPoint();
    testInsertPoint();
    testClear();
    
    // Test geometric operations
    testAddLine();
    testAddTriangle();
    testAddRectangle();
    testClose();
    testReverse();
    
    // Test property checks
    testIsEmpty();
    testIsClosed();
    testIsRectangle();
    testIsClockwise();
    
    // Test point enumeration
    testEnumeratePoints();
    
    console.log("Polygon tests OK");
}

function testCreateEmpty() {
    console.log("Testing empty polygon creation...");
    const polygon = Polygon.create();
    console.assert(polygon !== null);
    console.assert(polygon.isEmpty());
}

function testCreateLine() {
    console.log("Testing line creation...");
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 10};
    const polygon = Polygon.createLine(p1, p2);
    
    console.assert(polygon !== null);
    console.assert(!polygon.isEmpty());
    console.assert(!polygon.isClosed());
}

function testCreateTriangle() {
    console.log("Testing triangle creation...");
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    const polygon = Polygon.createTriangle(p1, p2, p3);
    
    console.assert(polygon !== null);
    console.assert(!polygon.isEmpty());
    console.assert(polygon.isClosed());
}

function testCreateRectangle() {
    console.log("Testing rectangle creation...");
    const rect = {x: 0, y: 0, width: 10, height: 10};
    const polygon = Polygon.createRectangle(rect);
    
    console.assert(polygon !== null);
    console.assert(!polygon.isEmpty());
    console.assert(polygon.isClosed());
    console.assert(polygon.isRectangle());
}

function testAddPoint() {
    console.log("Testing point addition...");
    const polygon = Polygon.create();
    const p1 = {x: 5, y: 5};
    
    polygon.addPoint(p1);
    console.assert(!polygon.isEmpty());
}

function testInsertPoint() {
    console.log("Testing point insertion...");
    const polygon = Polygon.create();
    
    const p1 = {x: 5, y: 5};
    polygon.insertPoint(0, p1);
    
    console.assert(!polygon.isEmpty());
}

function testClear() {
    console.log("Testing clear...");
    const polygon = Polygon.create();
    const p1 = {x: 5, y: 5};
    
    polygon.addPoint(p1);
    console.assert(!polygon.isEmpty());
    
    polygon.clear();
    console.assert(polygon.isEmpty());
}

function testAddLine() {
    console.log("Testing line addition...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 10};
    
    polygon.addLine(p1, p2);
    console.assert(!polygon.isEmpty());
}

function testAddTriangle() {
    console.log("Testing triangle addition...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addTriangle(p1, p2, p3);
    console.assert(!polygon.isEmpty());
    console.assert(polygon.isClosed());
}

function testAddRectangle() {
    console.log("Testing rectangle addition...");
    const polygon = Polygon.create();
    const rect = {x: 0, y: 0, width: 10, height: 10};
    
    polygon.addRectangle(rect);
    console.assert(!polygon.isEmpty());
    console.assert(polygon.isClosed());
}

function testClose() {
    console.log("Testing close...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addPoint(p1);
    polygon.addPoint(p2);
    polygon.addPoint(p3);
    
    console.assert(!polygon.isClosed());
    polygon.close();
    console.assert(polygon.isClosed());
}

function testReverse() {
    console.log("Testing reverse...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addPoint(p1);
    polygon.addPoint(p2);
    polygon.addPoint(p3);
    
    const originalClockwise = polygon.isClockwise();
    polygon.reverse();
    console.assert(polygon.isClockwise() !== originalClockwise);
}

function testIsEmpty() {
    console.log("Testing isEmpty...");
    const polygon = Polygon.create();
    console.assert(polygon.isEmpty());
    
    const p1 = {x: 5, y: 5};
    polygon.addPoint(p1);
    console.assert(!polygon.isEmpty());
}

function testIsClosed() {
    console.log("Testing isClosed...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addPoint(p1).addPoint(p2).addPoint(p3);
    
    console.assert(!polygon.isClosed());
    polygon.close();
    console.assert(polygon.isClosed());
}

function testIsRectangle() {
    console.log("Testing isRectangle...");
    const polygon = Polygon.create();
    const rect = {x: 0, y: 0, width: 10, height: 10};
    
    polygon.addRectangle(rect);
    console.assert(polygon.isRectangle());
    
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    polygon.clear();
    polygon.addPoint(p1);
    polygon.addPoint(p2);
    polygon.addPoint(p3);
    polygon.close();
    
    console.assert(!polygon.isRectangle());
}

function testIsClockwise() {
    console.log("Testing isClockwise...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addPoint(p1);
    polygon.addPoint(p2);
    polygon.addPoint(p3);
    polygon.close();
    
    const clockwise = polygon.isClockwise();
    polygon.reverse();
    console.assert(polygon.isClockwise() !== clockwise);
}

function testEnumeratePoints() {
    console.log("Testing point enumeration...");
    const polygon = Polygon.create();
    const p1 = {x: 0, y: 0};
    const p2 = {x: 10, y: 0};
    const p3 = {x: 5, y: 10};
    
    polygon.addPoint(p1);
    polygon.addPoint(p2);
    polygon.addPoint(p3);
    
    let pointCount = 0;
    polygon.enumeratePoints((point) => {
        pointCount++;
        return EnumerationResult.Continue;
    });
    
    console.assert(pointCount === 3);
}

module.exports.runPolygonTests = runPolygonTests;
