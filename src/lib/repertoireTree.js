// Every variation in a chapter, folded into one tree of moves.
//
// The lines in a chapter are stored flat — each one a full move list from move
// one — which is what Practice needs but hides how they relate. Nearly all of
// them share a long trunk and only part company somewhere in the middle, so
// merging them on shared prefixes turns a list of near-identical rows into the
// shape the repertoire actually has.
//
// Shape: { san, key, children, lines, ends } where `lines` is every variation
// id that plays through this move and `ends` the ones that finish on it. The
// root carries no move and holds every line.

export function mergeVariations(variations = []) {
  const root = {
    san: null, key: 'root', children: [], lines: [], ends: [],
  };
  for (const v of variations) {
    let node = root;
    node.lines.push(v.id);
    (v.moves ?? []).forEach((san, i) => {
      let child = node.children.find((c) => c.san === san);
      if (!child) {
        child = {
          san, key: `${node.key}>${i}:${san}`, children: [], lines: [], ends: [],
        };
        node.children.push(child);
      }
      child.lines.push(v.id);
      node = child;
    });
    node.ends.push(v.id);
  }
  return root;
}

// Where a node sits in the move numbering. `depth` is how many moves have been
// played to reach it, so the root is 0 and its children are White's first.
export const moveNumberAt = (depth) => Math.floor((depth - 1) / 2) + 1;
export const isWhiteAt = (depth) => depth % 2 === 1;

// The first place below `node` where the lines running through it disagree —
// what you'd have to walk past to learn anything new. Returns the nodes in
// between so a single click can skip a shared run of moves rather than making
// you tap through eight forced replies.
export function runToNextBranch(node) {
  const out = [];
  let n = node;
  while (n.children.length === 1 && n.ends.length === 0) {
    [n] = n.children;
    out.push(n);
  }
  return out;
}

// ---------- Playing a move on the board ----------

// A move as the chapter spells it and as chess.js does, compared without the
// check sign or a "!" — "Bxc6+" and "Bxc6" are the same move.
const bare = (san) => String(san ?? '').replace(/[+#!?]+$/, '');

// A move made on the board at `node` (the position `fen`, `depth` moves in):
//   { child }                      — the chapter plays it: go down that branch
//   { offBook: { san, theirs } }   — legal, but not in the chapter; `theirs`
//                                    are the moves the chapter plays here
//   null                           — not a legal move from there
// `from`/`to` are squares; castling can be dragged king-two-squares, and a
// promotion goes to whichever piece the chapter promotes to.
export function treeMove(Chess, node, fen, depth, from, to) {
  let options = [];
  try {
    options = new Chess(fen).moves({ square: from, verbose: true }).filter((m) => m.to === to);
  } catch { options = []; }
  if (!options.length) return null;
  const child = node.children.find((c) => options.some((m) => bare(m.san) === bare(c.san)));
  if (child) return { child };
  const label = (san) => `${moveNumberAt(depth + 1)}${isWhiteAt(depth + 1) ? '.' : '…'}${san}`;
  const san = (options.find((m) => !m.promotion || m.promotion === 'q') ?? options[0]).san;
  return { offBook: { san: label(san), theirs: node.children.map((c) => label(c.san)) } };
}

// The squares a picked piece can go to and stay in the chapter.
export function treeTargets(Chess, node, fen, from) {
  let options = [];
  try { options = new Chess(fen).moves({ square: from, verbose: true }); } catch { options = []; }
  return [...new Set(options
    .filter((m) => node.children.some((c) => bare(c.san) === bare(m.san)))
    .map((m) => m.to))];
}
