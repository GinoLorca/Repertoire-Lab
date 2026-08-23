// Pure FEN <-> board-map helpers for the Board Editor. Deliberately not built
// on chess.js: an editor has to tolerate positions chess.js would reject
// outright — no king yet, two queens, a lone pawn on the 1st rank while
// you're still setting a study position up — so placement here never
// validates anything, only converts between the two shapes.

export const START_MAP = (() => {
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const map = {};
  'abcdefgh'.split('').forEach((f, i) => {
    map[`${f}1`] = `w${back[i]}`;
    map[`${f}2`] = 'wP';
    map[`${f}7`] = 'bP';
    map[`${f}8`] = `b${back[i]}`;
  });
  return map;
})();

export function fenToBoardMap(fen) {
  const placement = String(fen ?? '').trim().split(' ')[0] ?? '';
  const map = {};
  placement.split('/').forEach((row, ri) => {
    const rank = 8 - ri;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      if (file > 7) continue;
      const square = `${'abcdefgh'[file]}${rank}`;
      map[square] = `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}`;
      file += 1;
    }
  });
  return map;
}

export function fenMeta(fen) {
  const parts = String(fen ?? '').trim().split(/\s+/);
  const castling = parts[2] && parts[2] !== '-' ? parts[2] : '';
  return {
    sideToMove: parts[1] === 'b' ? 'b' : 'w',
    castling: { K: castling.includes('K'), Q: castling.includes('Q'), k: castling.includes('k'), q: castling.includes('q') },
    // A preset or a pasted FEN often starts mid-game — dropping this (always
    // writing "0 1" back out) is what made a position sent to Analysis read
    // as move 1 no matter which move it actually was.
    halfmove: Number(parts[4]) || 0,
    fullmove: Number(parts[5]) || 1,
  };
}

export function boardMapToFen(map, sideToMove, castling, halfmove = 0, fullmove = 1) {
  const rows = [];
  for (let r = 8; r >= 1; r -= 1) {
    let row = '';
    let empty = 0;
    for (const f of 'abcdefgh') {
      const p = map[`${f}${r}`];
      if (!p) { empty += 1; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row || '8');
  }
  const cast = ['K', 'Q', 'k', 'q'].filter((k) => castling[k]).join('') || '-';
  return `${rows.join('/')} ${sideToMove} ${cast} - ${halfmove} ${fullmove}`;
}

// A handful of quick starting points beyond the standard opening array — the
// point of the editor is skipping past setup a coach doesn't want to play
// out by hand every time.
//
// Each FEN below is chess.js's own output from actually playing the named
// line move by move (see the repo history for the script), not hand-built —
// a hand-built board string is exactly the kind of thing that silently drops
// a developed piece, which is precisely what happened here the first time.
export const PRESETS = {
  kingsideBoth: {
    // 1.Nf3 Nf6 2.g3 g6 3.Bg2 Bg7 4.O-O O-O
    label: 'Kingside castled (both)',
    fen: 'rnbq1rk1/ppppppbp/5np1/8/8/5NP1/PPPPPPBP/RNBQ1RK1 w - - 4 5',
  },
  queensideBoth: {
    // 1.d4 d5 2.Nc3 Nc6 3.Bf4 Bf5 4.Qd2 Qd7 5.O-O-O O-O-O
    label: 'Queenside castled (both)',
    fen: '2kr1bnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/2KR1BNR w - - 8 6',
  },
  oppositeWKbQ: {
    // 1.Nf3 d5 2.g3 Nc6 3.Bg2 Bf5 4.O-O Qd7 5.h3 O-O-O
    label: 'Opposite castling — White kingside, Black queenside',
    fen: '2kr1bnr/pppqpppp/2n5/3p1b2/8/5NPP/PPPPPPB1/RNBQ1RK1 w - - 1 6',
  },
  oppositeWQbK: {
    // 1.d4 Nf6 2.Nc3 g6 3.Bf4 Bg7 4.Qd2 O-O 5.O-O-O
    label: 'Opposite castling — White queenside, Black kingside',
    fen: 'rnbq1rk1/ppppppbp/5np1/8/3P1B2/2N5/PPPQPPPP/2KR1BNR b - - 5 5',
  },
};
