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

const { EnvironmentApi, EnvironmentPermission, HeapStatistics } = require('affinity:application');
const { EnumerationResult, LogLevel } = require('affinity:common');
const { ConfigurationItem } = require('./configuration.js');

let environmentPermissions = null;
let environmentConfiguration = null;

class Environment {
    static get [Symbol.toStringTag]() {
        return 'Environment';
    }

    static toString() {
        return Environment[Symbol.toStringTag];
    }

    static postTask(func) {
        EnvironmentApi.postTask(func);
    }

    static quit() {
        EnvironmentApi.quit();
    }

    static get sdkVersionStr() {
        return EnvironmentApi.getSDKVersionStr();
    }

    static get v8VersionStr() {
        return EnvironmentApi.getV8VersionStr();
    }

    static hasPermission(environmentPermission) {
        return EnvironmentApi.hasPermission(environmentPermission);
    }

    static get configuration() {
        if (environmentConfiguration == null) {
            const h = EnvironmentApi.getConfiguration();
            if (h) {
                environmentConfiguration = new ConfigurationItem(h);
            }
        }
        return environmentConfiguration;
    }

    static enumerateFileSystemRoots(callback) {
        return EnvironmentApi.enumerateFileSystemRoots(callback);
    }

    static get fileSystemRoots() {
        const res = [];
        Environment.enumerateFileSystemRoots((root) => { res.push(root); return EnumerationResult.Continue; });
        return res;
    }

    static getHeapStatistics() {
        return EnvironmentApi.getHeapStatistics();
    }

    static get logLevel() {
        return EnvironmentApi.getLogLevel();
    }

    static set logLevel(level) {
        EnvironmentApi.setLogLevel(level);
    }

    static get permissions() {
        if (environmentPermissions == null) {
            environmentPermissions = Object.fromEntries(EnvironmentPermission.keys.map(perm => 
                [
                    perm.charAt(0).toLowerCase() + perm.slice(1),
                    Environment.hasPermission(EnvironmentPermission[perm])
                ]));
            Object.freeze(environmentPermissions);
        }
        return environmentPermissions;
    }
}

module.exports.Environment = Environment;
module.exports.EnvironmentPermission = EnvironmentPermission;
module.exports.LogLevel = LogLevel;
module.exports.HeapStatistics = HeapStatistics;
