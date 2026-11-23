// The oldest browsers the app runs on. Vite builds for its default target
// (es2020, Safari 14, Chrome 87, Firefox 78, Edge 88) and adds no polyfills, so
// a newer built-in in src/ ships as it is and throws where it's missing: on a
// Mac left on Safari 14 (Mojave's last) or an iPad on iOS 15.0-15.3, a call on
// the startup path leaves the app blank. Repertoire Lab's main has none of
// these; this keeps it that way, so the floor can't move without anyone noticing.
// (The two generated files are left out: they carry Chess Arcade's data and
// commit subjects, not app code.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const GENERATED = new Set(['lib/pieceArt.gen.js', 'lib/arcadeBuild.js']);
// Safari 15.4 (March 2022) built-ins, and what to write instead.
const NEWER = [
  [/\bObject\.hasOwn\(/, 'Object.hasOwn( — use Object.prototype.hasOwnProperty.call(obj, key)'],
  [/\bstructuredClone\(/, 'structuredClone( — copy by hand or with JSON'],
  [/\.findLast(Index)?\(/, '.findLast( / .findLastIndex( — loop from the end'],
  [/\.at\(/, '.at( — use [i] (or [length - 1])'],
];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(jsx?|mjs)$/.test(e.name) ? [p] : [];
  });
}

test('src/ uses no built-in newer than the build’s target (Safari 14): Object.hasOwn, structuredClone, findLast, .at', () => {
  const all = files(SRC);
  assert.ok(all.length > 50, 'found the app’s source');
  const found = [];
  for (const file of all) {
    const rel = relative(SRC, file).split('\\').join('/');
    if (GENERATED.has(rel)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const [re, what] of NEWER) if (re.test(line)) found.push(`src/${rel}:${i + 1}: ${what}`);
    });
  }
  assert.deepEqual(found, []);
});
