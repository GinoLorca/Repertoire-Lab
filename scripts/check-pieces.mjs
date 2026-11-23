// Says when Chess Arcade's piece sets have moved ahead of what Repertoire
// Lab's own boards draw (src/lib/pieceArt.gen.js, the CSS ported by hand).
// It only ever warns: the hourly Game Review sync runs it as a soft step, so a
// Chess Arcade piece change can never stop that sync, and never reaches RL's
// boards without `npm run sync:pieces` in an RL change with screenshots.
//
//   npm run check:pieces                          against the Game Review copy (src/lib/arcadeBuild.js)
//   npm run check:pieces -- --from <index.html>   against a Chess Arcade index.html, or a copy
//   npm run check:pieces -- --strict              exits 1 on any warning (by hand, before shipping)
//   npm run check:pieces -- --record-css          records the copy's piece CSS as ported
//                                                 (src/lib/pieceCss.ported.json) — only once the
//                                                 port has been checked in screenshots, in the
//                                                 same RL change
//
// What it warns about:
//   1. the piece data (sets, names, descriptions, theme defaults, piece colors,
//      Rim Light's cream, drawings) isn't what pieceArt.gen.js holds;
//   2. Chess Arcade's Default drawings no longer have the shape of RL's TREES;
//   3. an RL theme Chess Arcade doesn't have, a Chess Arcade default RL doesn't
//      offer, or a set RL offers that Chess Arcade dropped;
//   4. a group of Chess Arcade's piece CSS differs from what was recorded as
//      ported (scripts/lib/arcadePieces.mjs pieceCssGroups).
// In GitHub Actions each is a ::warning:: line; here, a plain one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractArcadePieces, pieceCssGroups, pieceDataSha, dataFromModule, describeDrift, drawingGeometry, treesFromPiecesJsx,
} from './lib/arcadePieces.mjs';
import { root, flagValue, pieceSource } from './lib/pieceSource.mjs';
import { SKIN_ORDER } from '../src/lib/skins.js';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const recordCss = args.includes('--record-css');
const CSS_FILE = join(root, 'src', 'lib', 'pieceCss.ported.json');
const inActions = process.env.GITHUB_ACTIONS === 'true';
const warnings = [];
const warn = (m) => warnings.push(m);
const SYNC = 'run `npm run sync:pieces` in a Repertoire Lab change, with screenshots';

let label = 'the Game Review copy';
try {
  const src = pieceSource(flagValue(args, '--from'));
  label = src.label;
  const data = extractArcadePieces(src.html, { themes: [...SKIN_ORDER, 'custom'] });

  // 1. The piece data, against the module.
  try {
    const mod = await import('../src/lib/pieceArt.gen.js');
    const held = dataFromModule(mod);
    if (pieceDataSha(held) !== mod.PIECE_DATA_SHA) warn('src/lib/pieceArt.gen.js isn\'t what sync:pieces wrote (edited by hand?): run `npm run sync:pieces`.');
    if (pieceDataSha(data) !== mod.PIECE_DATA_SHA) {
      const what = describeDrift(held, data);
      warn(`Chess Arcade's pieces and src/lib/pieceArt.gen.js (from ${mod.PIECE_ART_FROM}) differ: ${what.join('; ') || 'something in them'} — ${SYNC}.`);
    }
  } catch (err) {
    warn(`src/lib/pieceArt.gen.js can't be read (${err.message}) — ${SYNC}.`);
  }

  // 2. Default's drawings, against RL's own TREES (same art, two inks made placeholders).
  const trees = treesFromPiecesJsx(readFileSync(join(root, 'src', 'lib', 'pieces.jsx'), 'utf8'));
  const codes = [...new Set([...Object.keys(trees), ...Object.keys(data.art.default ?? {})])];
  const differ = codes.filter((c) => JSON.stringify(drawingGeometry(trees[c])) !== JSON.stringify(drawingGeometry(data.art.default?.[c])));
  if (differ.length) warn(`Chess Arcade's Default Chess Set no longer has the shape of RL's TREES (src/lib/pieces.jsx): ${differ.join(', ')}.`);

  // 3. Themes and sets.
  if (data.missingThemes.length) warn(`Chess Arcade has no ${data.missingThemes.join(', ')} theme (its #skin-row): there it falls back to the Default Chess Set.`);
  try {
    const { RL_PIECE_STYLES } = await import('../src/lib/pieceStyles.js');
    for (const [skin, set] of Object.entries(data.defaults)) {
      if (!RL_PIECE_STYLES.includes(set)) warn(`Chess Arcade gives ${skin} the ${set} set, which Repertoire Lab doesn't offer (RL_PIECE_STYLES in src/lib/pieceStyles.js): RL shows the Default Chess Set there.`);
    }
    for (const set of RL_PIECE_STYLES) if (!data.order.includes(set)) warn(`Repertoire Lab offers ${set}, which Chess Arcade no longer has.`);
  } catch (err) {
    warn(`src/lib/pieceStyles.js can't be read (${err.message}).`);
  }

  // 4. The piece CSS, against what was ported.
  const groups = pieceCssGroups(src.html);
  if (recordCss) {
    writeFileSync(CSS_FILE, `${JSON.stringify({ from: src.label, groups }, null, 2)}\n`);
    console.log(`check-pieces: recorded ${Object.keys(groups).length} groups of piece CSS as ported → src/lib/pieceCss.ported.json`);
  }
  if (!existsSync(CSS_FILE)) {
    warn('piece CSS not recorded yet (src/lib/pieceCss.ported.json): `npm run check:pieces -- --record-css` once the port is checked.');
  } else {
    const ported = JSON.parse(readFileSync(CSS_FILE, 'utf8')).groups ?? {};
    const keys = [...new Set([...Object.keys(ported), ...Object.keys(groups)])].sort();
    const moved = keys.filter((k) => ported[k] !== groups[k]);
    if (moved.length) {
      warn(`Chess Arcade's piece CSS has moved on from what RL ported: ${moved.map((k) => `${k}${!ported[k] ? ' (new)' : !groups[k] ? ' (gone)' : ''}`).join(', ')} — port it in src/styles.css, then \`npm run check:pieces -- --record-css\`.`);
    }
  }
} catch (err) {
  warn(err.message.startsWith('arcadePieces:') ? `Chess Arcade's pieces can't be read: ${err.message}` : `check-pieces: ${err.message}`);
}

for (const w of warnings) console.log(inActions ? `::warning title=Piece styles::${w}` : `check-pieces: ${w}`);
if (!warnings.length) console.log(`check-pieces: Repertoire Lab's pieces are in step with ${label}.`);
else if (!inActions) console.log(`check-pieces: ${warnings.length} warning${warnings.length === 1 ? '' : 's'} against ${label}.`);
process.exit(strict && warnings.length ? 1 : 0);
