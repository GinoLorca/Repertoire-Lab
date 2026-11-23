import React, { useInsertionEffect } from 'react';
import { useSettings } from '../store';
import { boardColors, boardPieces } from '../lib/theme';
import { pieceImage } from '../lib/pieces';

// The pieces are the boards' own set (lib/theme boardPieces: the one picked
// for this theme, else the theme's own), each a picture filling its square:
// lib/pieces' pieceImage, with the theme's piece colors and drawing filter
// worked in, since a picture sees no CSS. The squares are the theme's too
// (boardColors); Custom with no colors of its own keeps the stylesheet's pair.
//
// The pictures go in one small stylesheet, each look's twelve once, keyed on
// the board's look (data-look) and the piece (data-mb), rather than a copy of
// a picture's data URL on every piece: a player with a few hundred games has
// thousands of pieces, and every inline copy is parsed and kept on its own.
// The few looks used last are kept (settings change rarely; every thumbnail on
// the page shares one).
const CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
const MAX_LOOKS = 8;
const installed = new Map(); // look id -> its rules
let sheet = null;

// A short, stable name for a look (FNV-1a over what it draws).
function lookId(look) {
  const key = `${look.set}|${look.skin}|${look.light}|${look.dark}|${JSON.stringify(look.tokens)}${look.inks ? `|${look.inks}` : ''}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${look.set}-${(h >>> 0).toString(36)}`;
}

function install(id, look) {
  if (typeof document === 'undefined' || installed.has(id)) return;
  installed.set(id, CODES.map((code) => (
    `.mini-board[data-look="${id}"] .mb-piece[data-mb="${code}"]{background-image:url("${pieceImage(code, look, 1)}")}`
  )).join('\n'));
  while (installed.size > MAX_LOOKS) installed.delete(installed.keys().next().value);
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.setAttribute('data-mini-boards', '');
    document.head.appendChild(sheet);
  }
  sheet.textContent = [...installed.values()].join('\n');
}

function squaresFromFen(fen) {
  const placement = (fen ?? '').split(' ')[0] ?? '';
  const rows = placement.split('/');
  const grid = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i += 1) cells.push(null);
      } else {
        const code = `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}`;
        cells.push(CODES.includes(code) ? code : null);
      }
    }
    grid.push(cells);
  }
  return grid;
}

const FILES = 'abcdefgh';

// A small static board — the position a game finished in, chess.com style.
// `marks`: squares to ring ('e4', …) — where two boards differ, say.
export default function MiniBoard({
  fen, size = 104, orientation = 'white', title, marks,
}) {
  const settings = useSettings();
  const look = boardPieces(settings);
  const id = lookId(look);
  // Before the board is painted, so its pieces never show up a frame late.
  useInsertionEffect(() => install(id, look), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = boardColors(settings);
  const grid = squaresFromFen(fen);
  const ringed = new Set(marks ?? []);
  const rows = orientation === 'black' ? [...grid].reverse() : grid;
  const cells = [];
  rows.forEach((row, y) => {
    const line = orientation === 'black' ? [...row].reverse() : row;
    line.forEach((code, x) => {
      const dark = (x + y) % 2 === 1;
      const sq = orientation === 'black' ? `${FILES[7 - x]}${y + 1}` : `${FILES[x]}${8 - y}`;
      cells.push(
        <span key={`${x}-${y}`} className={`mb-sq${dark ? ' dark' : ''}${ringed.has(sq) ? ' marked' : ''}`}>
          {code && <span className="mb-piece" data-mb={code} />}
        </span>,
      );
    });
  });
  const style = { width: size, height: size };
  if (chosen.squareLight) style['--board-light'] = chosen.squareLight;
  if (chosen.squareDark) style['--board-dark'] = chosen.squareDark;

  return (
    <div className="mini-board" title={title} data-look={id} data-set={look.set} style={style}>
      {cells}
    </div>
  );
}
