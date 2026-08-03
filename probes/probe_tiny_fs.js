// Minimal filesystem check. Paste this into a BRAND NEW script entry and run it.
//
// examples/physicsdrop.js can create a folder; physicsdrop v2 cannot, on the same machine in the
// same session, with the same path. This is the smallest possible script that asks the same
// question, so that content, size and structure are all removed as variables: if a six-line
// script in a new entry is also denied, then a NEW ENTRY is what is denied, not our code.
//
// Deliberately no metadata header, matching v1.1, in case the header format matters.

const { app } = require('/application');
const fsys = require('/fs');

const dir = app.userDesktopPath + '/PDTINY_test';
try {
  fsys.createDirectories(dir);
  console.log('created: ' + dir);
  console.log('isDirectory: ' + fsys.isDirectory(dir));
} catch (e) {
  console.log('DENIED: ' + e);
}
