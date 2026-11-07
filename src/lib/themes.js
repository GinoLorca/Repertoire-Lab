// The themes in use, for autocomplete. Given an owner — null for your own
// repertoire, a student's card id for theirs — only that repertoire's: a
// student's themes are theirs, kept apart from yours (the same name on both
// is two themes, one each). Without one, everything, games' tags too.
export function allTags(state, { ownerId } = {}) {
  const set = new Set();
  const scoped = ownerId !== undefined;
  for (const o of state.openings) {
    if (scoped && (o.ownerId ?? null) !== ownerId) continue;
    (o.tags ?? []).forEach((t) => set.add(t));
    for (const c of o.chapters) {
      (c.tags ?? []).forEach((t) => set.add(t));
      for (const v of c.variations) (v.tags ?? []).forEach((t) => set.add(t));
    }
  }
  if (!scoped) {
    for (const p of state.players ?? []) {
      for (const g of p.games) (g.tags ?? []).forEach((t) => set.add(t));
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
