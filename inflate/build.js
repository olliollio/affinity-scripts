/**
 * Build script for inflate.
 *
 *   node inflate/build.js            # writes inflate/dist/inflate.js
 *   node inflate/build.js --check    # verifies the committed output is up to date, exit 1 if not
 *
 * Concatenates every src/ module (plus the reused gravity geometry modules) into ONE
 * self-contained script, because the Affinity sandbox denies /fs for every path: a script cannot
 * load its own code from disk at runtime, so everything has to travel inline.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname);
// Keep BOTH: gravity's body calls fs.existsSync(OUT_DIR) and fs.mkdirSync(OUT_DIR), so replacing
// the pair with a single OUT_FILE gives `ReferenceError: OUT_DIR is not defined` at write time.
var OUT_DIR = path.join(ROOT, 'dist');
var OUT_FILE = path.join(OUT_DIR, 'inflate.js');

// Paths are relative to the INFLATE ROOT so that gravity's pure-geometry modules can be named
// directly. They are reused by reference rather than copied: a copy goes stale silently, and
// nothing would fail loudly when it had.
// `read()` exits 1 on a missing file, so SRC must name only what EXISTS at this task. Each later
// task appends its own entry as it creates the file; the order below is the dependency order and
// new entries go at the end.
var SRC = [
  '../gravity/src/contours.js',
  '../gravity/src/flatten.js',
  '../gravity/src/softmesh.js',
  'src/thickness.js'
];

var HEADER = [
  'name: inflate',
  'description: Give a flat vector shape the look of an inflated pillow.',
  'version: 1.0.0-dev',
  'author: ollio'
];

function read(rel) {
  var p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error('build: missing ' + rel);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

function build() {
  var parts = [];

  parts.push('/**');
  for (var h = 0; h < HEADER.length; h++) parts.push(' * ' + HEADER[h]);
  parts.push(' *');
  parts.push(' * GENERATED FILE - do not edit. Built from inflate/src/ (and gravity/src/, reused by');
  parts.push(' * path) by inflate/build.js. Edit the sources and rebuild; the real diff lives in src/.');
  parts.push(' */');
  parts.push('');
  parts.push("'use strict';");
  parts.push('');
  parts.push('var GR = {};');
  parts.push('');

  for (var s = 0; s < SRC.length; s++) {
    parts.push('// ' + new Array(74).join('-'));
    parts.push('// ' + SRC[s]);
    parts.push(read(SRC[s]).replace(/\s+$/, ''));
    parts.push('');
  }

  parts.push('// ' + new Array(74).join('-'));
  parts.push('// entry');
  parts.push('if (typeof GR.main === \'function\') GR.main();');
  parts.push('else console.log(\'inflate ' + HEADER[2].split(': ')[1] +
             ' - geometry layer only, no entry point yet. Loaded: \' + Object.keys(GR).sort().join(\', \'));');
  parts.push('');

  return parts.join('\n');
}

var code = build();

if (process.argv.indexOf('--check') >= 0) {
  if (!fs.existsSync(OUT_FILE)) {
    console.error('build --check: ' + path.relative(process.cwd(), OUT_FILE) + ' does not exist');
    process.exit(1);
  }
  if (fs.readFileSync(OUT_FILE, 'utf8') !== code) {
    console.error('build --check: dist is stale, run `node inflate/build.js`');
    process.exit(1);
  }
  console.log('build --check: dist is up to date');
  process.exit(0);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, code);

console.log('wrote ' + path.relative(process.cwd(), OUT_FILE) +
            '  ' + (code.length / 1024).toFixed(0) + 'KB, ' +
            code.split('\n').length + ' lines');
