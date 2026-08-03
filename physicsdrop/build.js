/**
 * Build script for physicsdrop v2.
 *
 *   node physicsdrop/build.js            # writes physicsdrop/dist/physicsdrop.js
 *   node physicsdrop/build.js --check    # verifies the committed output is up to date, exit 1 if not
 *
 * Concatenates the vendored libraries and every src/ module into ONE self-contained script,
 * because the Affinity sandbox denies /fs for every path (probe_planck_smoke): a script cannot
 * load its own code from disk at runtime, so everything has to travel inline. probe_vendor_size
 * established that a 433KB script imports, parses and runs intact.
 *
 * Each vendored library gets a PRIVATE module object. Their UMD wrappers resolve to the
 * CommonJS branch inside the sandbox, so evaluated bare they would assign to the host script's
 * own module.exports and the second library would clobber the first.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var OUT_DIR = path.join(ROOT, 'dist');
var OUT_FILE = path.join(OUT_DIR, 'physicsdrop.js');

// Concatenation order is the only contract between modules: each src file is an IIFE over the
// shared PD namespace and may use anything defined above it.
var VENDOR = [
  // [file, PD key, how to pick the export off the private module]
  ['earcut.min.js', 'earcut', 'module.exports.default'],  // earcut v3 exports the fn as .default
  ['planck.min.js', 'planck', 'module.exports']
];

var SRC = [
  'contours.js',
  'sanitize.js',
  'decompose.js',
  'flatten.js',
  'extract.js',
  'world.js',
  'bodies.js',
  'sim.js'
  // Not written yet: playback.js.
  // Adding one is a one-line edit here; order matters, dependencies go above dependents.
];

var HEADER = [
  'name: physicsdrop',
  'description: Drop vector objects into a scene and let them fall, collide and settle.',
  'version: 2.0.0-dev',
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

/** The licence texts have to travel with the code, so pull the real files rather than retype. */
function licenceBlock() {
  var out = ['Bundled third-party code:', ''];
  var libs = [
    ['earcut 3.2.3', 'ISC', 'earcut-LICENSE.txt'],
    ['planck.js 1.5.0', 'MIT', 'planck-LICENSE.txt']
  ];
  for (var i = 0; i < libs.length; i++) {
    out.push('  ' + libs[i][0] + ' - ' + libs[i][1]);
  }
  out.push('');
  for (var j = 0; j < libs.length; j++) {
    out.push('--- ' + libs[j][0] + ' -------------------------------------------------');
    var text = read(path.join('vendor', libs[j][2])).replace(/\s+$/, '');
    var lines = text.split(/\r?\n/);
    for (var k = 0; k < lines.length; k++) out.push('  ' + lines[k]);
    out.push('');
  }
  return out;
}

function build() {
  var parts = [];

  parts.push('/**');
  for (var h = 0; h < HEADER.length; h++) parts.push(' * ' + HEADER[h]);
  parts.push(' *');
  parts.push(' * GENERATED FILE - do not edit. Built from physicsdrop/src/ by physicsdrop/build.js.');
  parts.push(' * Edit the sources and rebuild; the real diff lives in src/.');
  parts.push(' *');
  var lic = licenceBlock();
  for (var l = 0; l < lic.length; l++) parts.push(' * ' + lic[l]);
  parts.push(' */');
  parts.push('');
  parts.push("'use strict';");
  parts.push('');
  parts.push('var PD = {};');
  parts.push('');

  for (var v = 0; v < VENDOR.length; v++) {
    var file = VENDOR[v][0], key = VENDOR[v][1], pick = VENDOR[v][2];
    parts.push('// ' + new Array(74).join('-'));
    parts.push('// vendor/' + file);
    parts.push('PD.' + key + ' = (function () {');
    // A private module object per library. Without it the CommonJS branch of each UMD wrapper
    // would write to the host script's module.exports and the libraries would overwrite one
    // another - the same save/restore dance test/harness.js does dynamically.
    parts.push('  var module = { exports: {} };');
    parts.push('  var exports = module.exports;');
    parts.push(read(path.join('vendor', file)).replace(/\s+$/, ''));
    parts.push('  ;return ' + pick + ';');
    parts.push('})();');
    parts.push('');
  }

  for (var s = 0; s < SRC.length; s++) {
    parts.push('// ' + new Array(74).join('-'));
    parts.push('// src/' + SRC[s]);
    parts.push(read(path.join('src', SRC[s])).replace(/\s+$/, ''));
    parts.push('');
  }

  parts.push('// ' + new Array(74).join('-'));
  parts.push('// entry');
  parts.push('if (typeof PD.main === \'function\') PD.main();');
  parts.push('else console.log(\'physicsdrop ' + HEADER[2].split(': ')[1] +
             ' - geometry layer only, no entry point yet. Loaded: \' + Object.keys(PD).sort().join(\', \'));');
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
    console.error('build --check: dist is stale, run `node physicsdrop/build.js`');
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
