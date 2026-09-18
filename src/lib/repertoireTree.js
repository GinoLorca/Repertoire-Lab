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
