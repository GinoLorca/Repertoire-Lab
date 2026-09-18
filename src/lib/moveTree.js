// A game as a tree, so an alternative played from an earlier move is kept as a
// variation instead of throwing away what came after — the way Lichess and
// chess.com record analysis.
//
// Shape: { id, san, children: [node] }. `children[0]` is the main continuation;
// the rest are variations, in the order they were added. The root carries no
// move and always has id 'root'.

let seq = 0;
const nid = () => `n${(seq += 1)}`;

export const newRoot = () => ({ id: 'root', san: null, children: [] });

// A plain list of moves becomes a trunk with no branches.
export function makeTree(sans = []) {
  const root = newRoot();
  let node = root;
  for (const san of sans) {
    const child = { id: nid(), san, children: [] };
    node.children.push(child);
    node = child;
  }
  return root;
}

export function findNode(root, id) {
  if (!id || id === 'root') return root;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    for (const c of n.children) stack.push(c);
  }
  return null;
}

// Root → node, without the root itself. Empty when the node is the root.
export function nodePath(root, id) {
  const out = [];
  const walk = (node, trail) => {
    if (node.id === id) { out.push(...trail); return true; }
    return node.children.some((c) => walk(c, [...trail, c]));
  };
  walk(root, []);
  return out;
}

// The main continuation from a node: keep taking the first child.
export function mainLineFrom(node) {
  const out = [];
  let n = node;
  while (n?.children?.length) {
    n = n.children[0];
    out.push(n);
  }
  return out;
}

// Everything currently on the board: how you got to `id`, then how the line
// carries on from there.
export function lineThrough(root, id) {
  const head = findNode(root, id) ?? root;
  return [...nodePath(root, head.id), ...mainLineFrom(head)];
}

// Structural edits copy the nodes they touch, so React sees a new tree.
function edit(root, fn) {
  const clone = (n) => ({ ...n, children: n.children.map(clone) });
  const copy = clone(root);
  fn(copy);
  return copy;
}

// Play `san` after `parentId`. Repeating a move that's already there follows it
// rather than adding a duplicate branch.
export function addMove(root, parentId, san) {
  let id = null;
  const next = edit(root, (copy) => {
    const parent = findNode(copy, parentId) ?? copy;
    const existing = parent.children.find((c) => c.san === san);
    if (existing) { id = existing.id; return; }
    const node = { id: nid(), san, children: [] };
    parent.children.push(node);
    id = node.id;
  });
  return { tree: next, nodeId: id };
}

// Make this variation the main line, all the way up to the first move.
export function promote(root, id) {
  return edit(root, (copy) => {
    const trail = nodePath(copy, id); // nodes root→id, in the copy
    let parent = copy;
    for (const step of trail) {
      const i = parent.children.findIndex((c) => c.id === step.id);
      if (i > 0) {
        const [pick] = parent.children.splice(i, 1);
        parent.children.unshift(pick);
      }
      parent = parent.children[0];
    }
  });
}

// Promote one level only: swap this branch with its immediate main line.
export function promoteOne(root, id) {
  return edit(root, (copy) => {
    const trail = nodePath(copy, id);
    if (trail.length === 0) return;
    const parent = trail.length > 1 ? trail[trail.length - 2] : copy;
    const i = parent.children.findIndex((c) => c.id === id);
    if (i > 0) {
      const [pick] = parent.children.splice(i, 1);
      parent.children.splice(i - 1, 0, pick);
    }
  });
}

// Cut this move and everything after it.
export function removeNode(root, id) {
  return edit(root, (copy) => {
    const trail = nodePath(copy, id);
    if (trail.length === 0) return;
    const parent = trail.length > 1 ? trail[trail.length - 2] : copy;
    parent.children = parent.children.filter((c) => c.id !== id);
  });
}

// Drop every variation, keeping only the main line.
export function keepMainLineOnly(root) {
  return edit(root, (copy) => {
    let n = copy;
    while (n.children.length) {
      n.children = [n.children[0]];
      [n] = n.children;
    }
  });
}

export const hasVariations = (root) => {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.children.length > 1) return true;
    for (const c of n.children) stack.push(c);
  }
  return false;
};

// Is this node on the main line from the root?
export function isMainLine(root, id) {
  let n = root;
  while (n.children.length) {
    [n] = n.children;
    if (n.id === id) return true;
  }
  return false;
}

// The variation `id` belongs to, at its topmost level — the first node on
// the way there (walking down from the root) that isn't its parent's main
// continuation, i.e. where this line first diverges from whatever it
// branched off of. A highlight always lives on this id, never on some node
// deeper inside the branch, so "the whole row" has one consistent owner
// regardless of which move within it was actually clicked or is current.
// Returns null for a node that's on the main line the entire way — there's
// no variation there to highlight.
export function branchRootOf(root, id) {
  const trail = nodePath(root, id);
  let parent = root;
  for (const node of trail) {
    const i = parent.children.findIndex((c) => c.id === node.id);
    if (i > 0) return node.id;
    parent = node;
  }
  return null;
}

// "Back to the main game" from anywhere — including several variations deep,
// or inside a variation-of-a-variation, where stepping out with ← one move
// at a time gets tedious. Walks the same root→id path branchRootOf does, but
// stops one node earlier: at the last one still on the trunk, right before
// the first divergence, rather than at the divergence itself. A node that
// was on the main line the whole way (branchRootOf would return null) just
// returns its own id back — already on the trunk, nowhere to jump to.
export function lastMainLineAncestor(root, id) {
  const trail = nodePath(root, id);
  let parent = root;
  let last = root;
  for (const node of trail) {
    const i = parent.children.findIndex((c) => c.id === node.id);
    if (i > 0) break;
    last = node;
    parent = node;
  }
  return last.id;
}

// The alternatives on offer from where the board is standing — "instead of
// this, I could have played…" — in a stable order, so the 1st is always the
// 1st however you arrived. Always children[1..] of the relevant branch
// point, never children[0]: that first child IS the continuation being
// offered alternatives TO, not an alternative to itself.
//
// Which node is the branch point depends on where `id` sits, and both cases
// have to work because both are places you naturally stand:
//   - On the blundered move itself (its parent already holds the
//     alternatives as siblings) — parent is the branch point.
//   - On the move just BEFORE it, having stepped up to the decision — the
//     alternatives hang off `id` itself, so it is the branch point.
export function alternativesAt(root, id) {
  const trail = nodePath(root, id);
  const node = trail.length > 0 ? trail[trail.length - 1] : root;
  const parent = trail.length > 1 ? trail[trail.length - 2] : root;
  const branchPoint = (parent.children ?? []).length > 1 ? parent : node;
  return (branchPoint.children ?? []).slice(1);
}
