// scripts/sync-arcade.mjs's list of what the bridge uses of Chess Arcade (USES)
// is what the copy is asked about before it goes out on its own
// (__rlReview.missing(), scripts/check-arcade.mjs). A name the bridge uses but
// the list leaves out would never be asked about — so this keeps the two
// together: every name of Chess Arcade's own the bridge mentions is listed,
// and every listed name is one Chess Arcade has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARCADE_REVIEW_URL } from '../src/lib/arcadeBuild.js';

const script = readFileSync(new URL('../scripts/sync-arcade.mjs', import.meta.url), 'utf8');
const list = (name) => {
  const m = script.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `sync-arcade.mjs has no ${name} list`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const USES = list('USES');
const USES_IDS = list('USES_IDS');
const bridge = (() => {
  const a = script.indexOf('const BRIDGE = String.raw`');
  const b = script.indexOf('\n`;\n', a);
  assert.ok(a >= 0 && b > a, 'sync-arcade.mjs: the BRIDGE block moved — update this test');
  return script.slice(a, b).replace(/^\s*\/\/.*$/gm, '');
})();

// Chess Arcade's own code, as it is in the copy that's committed (the bridge left out).
const copy = readFileSync(new URL(`../public${ARCADE_REVIEW_URL}`, import.meta.url), 'utf8');
const arcade = copy.slice(0, copy.indexOf("// ---- Repertoire Lab's Game Review"));
// What it declares at the top of its one closure (two spaces in).
const declared = new Set();
for (const m of arcade.matchAll(/^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) declared.add(m[1]);
for (const m of arcade.matchAll(/^ {2}(?:const|let|var)\s+([^;]*);/gm)) {
  for (const part of m[1].split(',')) {
    const n = part.split('=')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
  }
}

test('every name of Chess Arcade’s the bridge uses is on the list the copy is checked against', () => {
  const locals = new Set([...bridge.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // what's in quotes is text (CSS selectors, ids), not a name in the code
  const code = bridge.replace(/'[^'\n]*'/g, "''");
  const used = [...new Set(code.match(/\b[A-Za-z_$][\w$]*\b/g))].filter((n) => declared.has(n) && !locals.has(n));
  const left = used.filter((n) => !USES.includes(n));
  assert.deepEqual(left, [], `add to USES in scripts/sync-arcade.mjs: ${left.join(', ')}`);
});

test('every name on the list is one Chess Arcade has, and every id is on its page', () => {
  const stale = USES.filter((n) => !declared.has(n));
  assert.deepEqual(stale, [], `not in Chess Arcade any more (or not at the top of its code): ${stale.join(', ')}`);
  for (const id of USES_IDS) assert.ok(arcade.includes(`id="${id}"`), `#${id} isn't on Chess Arcade's page`);
});

test('the copy is asked about every one of them', () => {
  for (const n of USES) assert.ok(copy.includes(`try{ void ${n}; }catch(e){ gone.push('${n}'); }`), n);
  assert.ok(copy.includes(JSON.stringify(USES_IDS)));
});
