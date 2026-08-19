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

var ROOT = __dirname;
var OUT_DIR = path.join(ROOT, 'dist');
var OUT_FILE = path.join(OUT_DIR, 'inflate.js');

// Paths are relative to the INFLATE ROOT so that gravity's pure-geometry modules can be named
// directly. They are reused by reference rather than copied: a copy goes stale silently, and
// nothing would fail loudly when it had.
// read() exits 1 on a missing file, so every entry must name a file that exists. Order is
// dependency order: a module may use anything defined above it, and new ones go at the end.
var SRC = [
  '../gravity/src/contours.js',
  '../gravity/src/flatten.js',
  '../gravity/src/softmesh.js',
  'src/thickness.js',
  'src/inflate.js',
  'src/ui.js'
];

var VERSION = '1.0.0-dev';

var HEADER = [
  'name: inflate',
  'description: Give a flat vector shape the look of an inflated pillow.',
  'version: ' + VERSION,
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

// read() catches a file named in SRC but absent from disk. This catches the OPPOSITE, which is the
// one that fails quietly: a src file that exists and was never added to SRC ships nothing, and
// --check still passes, because --check only compares dist against what SRC named. The omission
// would surface first inside Affinity, where there is no debugger.
function checkSrcComplete() {
  var onDisk = fs.readdirSync(path.join(ROOT, 'src'));
  for (var d = 0; d < onDisk.length; d++) {
    if (/\.js$/.test(onDisk[d]) && SRC.indexOf('src/' + onDisk[d]) < 0) {
      console.error('build: src/' + onDisk[d] + ' exists but is not in SRC');
      process.exit(1);
    }
  }
}

function build() {
  checkSrcComplete();

  var parts = [];

  parts.push('/**');
  for (var h = 0; h < HEADER.length; h++) parts.push(' * ' + HEADER[h]);
  parts.push(' *');
  parts.push(' * GENERATED FILE - do not edit. Built from inflate/src/ (and gravity/src/, reused by');
  parts.push(' * path) by inflate/build.js. Edit the sources and rebuild; the real diff lives in src/.');
  parts.push(' *');
  parts.push(' * The reused gravity modules carry comments about planck.js and earcut - gravity\'s');
  parts.push(' * vendored libraries. inflate bundles neither; those comments describe gravity, not this file.');
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
  parts.push('else console.log(\'inflate ' + VERSION +
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
