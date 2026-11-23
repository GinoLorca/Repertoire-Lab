// Brings Chess Arcade's piece sets onto Repertoire Lab's own boards. By hand,
// and only as part of a Repertoire Lab change that gets screenshots: the hourly
// Game Review sync (scripts/sync-arcade.mjs) never runs this, and never writes
// what it writes.
//
//   npm run sync:pieces                          from the Game Review copy (src/lib/arcadeBuild.js)
//   npm run sync:pieces -- --from <index.html>   from a Chess Arcade index.html (a clean checkout of
//                                                its main) or a copy
//
// It reads the sets, their names and descriptions, each theme's own set, each
// theme's piece colors, Rim Light's cream and the drawings (scripts/lib/
// arcadePieces.mjs) and writes them to src/lib/pieceArt.gen.js. Anything it
// can't read stops it, with the old file left as it was. Running it twice
// changes nothing. `npm run check:pieces` says when it's due again.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractArcadePieces, pieceArtModule, pieceDataSha, drawingGeometry, treesFromPiecesJsx } from './lib/arcadePieces.mjs';
import { root, flagValue, pieceSource } from './lib/pieceSource.mjs';
import { SKIN_ORDER } from '../src/lib/skins.js';

const OUT = join(root, 'src', 'lib', 'pieceArt.gen.js');
const src = pieceSource(flagValue(process.argv.slice(2), '--from'));
let data;
try {
  data = extractArcadePieces(src.html, { themes: [...SKIN_ORDER, 'custom'] });
} catch (err) {
  console.error(`sync-pieces: ${err.message}\nsync-pieces: src/lib/pieceArt.gen.js is left as it was.`);
  process.exit(1);
}
const warn = (m) => console.warn(`sync-pieces: warning — ${m}`);
if (src.dirty) warn(`${src.file} has uncommitted changes: fine for a draft, but ship from a clean checkout of Chess Arcade's main (or the Game Review copy).`);
if (data.missingThemes.length) warn(`Chess Arcade's themes don't include ${data.missingThemes.join(', ')}: those get the Default Chess Set.`);
// Which sets Repertoire Lab offers is its own list. Read after the data, and
// not fatal: a broken module must never stop the sync that would mend it.
try {
  const { RL_PIECE_STYLES } = await import('../src/lib/pieceStyles.js');
  for (const [skin, set] of Object.entries(data.defaults)) {
    if (!RL_PIECE_STYLES.includes(set)) warn(`Chess Arcade gives ${skin} ${set}, which Repertoire Lab doesn't offer (RL_PIECE_STYLES): ${skin} gets the Default Chess Set.`);
  }
  for (const set of RL_PIECE_STYLES) if (!data.order.includes(set)) warn(`Repertoire Lab offers ${set}, which Chess Arcade no longer has.`);
} catch (err) {
  warn(`couldn't read RL_PIECE_STYLES (${err.message}); not checked.`);
}
try {
  const trees = treesFromPiecesJsx(readFileSync(join(root, 'src', 'lib', 'pieces.jsx'), 'utf8'));
  const differ = Object.keys(data.art.default ?? {})
    .filter((c) => JSON.stringify(drawingGeometry(trees[c])) !== JSON.stringify(drawingGeometry(data.art.default[c])));
  if (differ.length) warn(`Chess Arcade's Default drawings no longer match Repertoire Lab's TREES (${differ.join(', ')}); RL keeps drawing its own.`);
} catch (err) {
  warn(`couldn't hold Default against TREES (${err.message}).`);
}

const text = pieceArtModule(data, src.label);
let before = '';
try { before = readFileSync(OUT, 'utf8'); } catch { /* the first run */ }
if (before !== text) writeFileSync(OUT, text);
const drawn = Object.keys(data.art).filter((s) => s !== 'default').length;
const own = Object.entries(data.defaults).filter(([, s]) => s !== 'default').map(([k, s]) => `${k}:${s}`).join(' ');
console.log(`sync-pieces: ${src.label}`);
console.log(`pieces: ${data.order.length} sets (${drawn} drawn here), defaults ${own} (the rest default), sha ${pieceDataSha(data).slice(0, 12)}`
  + ` → src/lib/pieceArt.gen.js${before === text ? ' (unchanged)' : ` (${(text.length / 1024).toFixed(0)} KB, written)`}`);
