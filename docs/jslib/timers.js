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

const { TimerApi } = require('affinity:timers');
const { HandleObject } = require('/handleobject.js');

class Timer extends HandleObject {
    constructor(handle) {
        super(handle);
    }

    get [Symbol.toStringTag]() {
        return 'Timer';
    }
    
    static create() {
        return new Timer(TimerApi.create());
    }
    
    cancel() {
        TimerApi.cancel(this.handle);
    }
    
    static cancelAll() {
        TimerApi.cancelAll();
    }
    
    static get now() {
        return TimerApi.getNow();
    }

    static get nowBigInt() {
        return TimerApi.getNow(true);
    }
    
    get expiry() {
        return TimerApi.getExpiry(this.handle);
    }
    
    set expiry(integerOrBigInt) {
        TimerApi.setExpiry(this.handle, integerOrBigInt);
    }

    get expiryBigInt() {
        return TimerApi.getExpiry(this.handle, true);
    }

    /**
    * @deprecated Use set expiry() instead
    */
    set expiryBigInt(integerOrBigInt) {
        console.warn("Using deprecated Timer set expiryBigInt() function. Use set expiry() instead.");
        this.expiry = integerOrBigInt;
    }

    moveExpiry(integerOrBigInt) {
        TimerApi.moveExpiry(this.handle, integerOrBigInt);
    }
    
    get expiryFromNow() {
        return TimerApi.getExpiryFromNow(this.handle);
    }
    
    set expiryFromNow(integerOrBigInt) {
        TimerApi.setExpiryFromNow(this.handle, integerOrBigInt);
    }

    get expiryFromNowBigInt() {
        return TimerApi.getExpiryFromNow(this.handle, true);
    }
    
    waitAsync(callback) {
        TimerApi.waitAsync(this.handle, callback);
    }

    dispose() {
        TimerApi.dispose(this.handle);
    }

    // ASIO-esque aliases
    get expiresFromNow() {
        return this.expiryFromNow;
    }
    
    set expiresFromNow(integerOrBigInt) {
        this.expiryFromNow = integerOrBigInt;
    }

    get expiresFromNowBigInt() {
        return this.expiryFromNowBigInt;
    }
}

function timeoutCallback(errorCode, callback, ...args) {
    callback(errorCode, ...args);
}

function setTimeout(delay, callback, ...args) {
    let timer = Timer.create();
    timer.expiryFromNow = delay;
    if (typeof callback === 'function') {
        timer.waitAsync((errorCode) => timeoutCallback(errorCode, callback, ...args));
    } else {
        timer.waitAsync(callback);
    }
    return timer;
}

function intervalCallback(err, timer, delay, callback, ...args) {
    if (!err) {
        timer.expiryFromNow = delay;
        timer.waitAsync((errorCode) => intervalCallback(errorCode, timer, delay, callback, ...args));
    }
    callback(err, ...args);
}

function setInterval(delay, callback, ...args) {
    let timer = Timer.create();
    timer.expiryFromNow = delay;
    if (typeof callback === 'function') {
        timer.waitAsync((errorCode) => intervalCallback(errorCode, timer, delay, callback, ...args));
    } else {
        timer.waitAsync(callback);
    }
    return timer;
}

// This isn't really like Node's setImmediate because it does the equivalent of setTimeout(0),
// but it will provide some level of compatibility.
function setImmediate(callback, ...args) {
    let timer = Timer.create();
    timer.expiryFromNow = 0;
    if (typeof callback === 'function') {
        timer.waitAsync((errorCode) => timeoutCallback(errorCode, callback, ...args));
    } else {
        timer.waitAsync(callback);
    }
    return timer;
}

module.exports.Timer = Timer;
module.exports.setImmediate = setImmediate;
module.exports.setTimeout = setTimeout;
module.exports.setInterval = setInterval;
