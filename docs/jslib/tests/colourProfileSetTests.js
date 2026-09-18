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
const {
    ColourProfile,
    ColourProfileSet,
} = require('/colours.js');


function testColourProfileSet() {
    // create the default colour profile set with either of the following
    const profileSet = ColourProfileSet.default;
    //const profileSet = ColourProfileSet.create();
    
    // get/set the intent of the profile set
    const origIntent = profileSet.intent
    profileSet.intent = 2 // Saturation
    console.log(profileSet.intent)
    profileSet.intent = origIntent
    
    // get/set use black point compensation
    const temp = profileSet.blackPointCompensation
    profileSet.blackPointCompensation = (!temp)
    console.log(profileSet.blackPointCompensation)
    profileSet.blackPointCompensation = temp
    
    
    // get profile out of the profile set / or setup your own
    var profile = profileSet.getProfileForFormat(0)
    profileSet.setProfileForFormat(1, profile)
    var newprofile = profileSet.getProfileForFormat(1)
    console.assert(profile.colourSpaceStr == newprofile.colourSpaceStr)

    // get/set profile with colour space
    var profilecs = profileSet.getProfileForColourSpaceType(3) // CMYK
    profileSet.setProfileForColourSpaceType(3, profilecs)
    var newprofilecs = profileSet.getProfileForColourSpaceType(3)
    console.assert(profilecs.colourSpaceStr == newprofilecs.colourSpaceStr)
}

module.exports.testColourProfileSet = testColourProfileSet;
