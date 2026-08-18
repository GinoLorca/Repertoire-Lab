// A fixed vocabulary for flagging what went wrong (or should be remembered)
// in a game — deliberately separate from the repertoire's free-form Themes.
// Scanning ten of a student's games for a common pattern only works if
// "blunder" is always spelled "blunder" — a curated list of one-click chips
// beats retyping a label slightly differently each time.

export const GAME_FLAGS = [
  { id: 'blunder', label: 'Blunder', color: '#e5534b' },
  { id: 'missedMate', label: 'Missed mate', color: '#e5534b' },
  { id: 'hungMate', label: 'Hung mate', color: '#e5534b' },
  { id: 'missedTactic', label: 'Missed tactic / fork', color: '#e8b339' },
  { id: 'hungMaterial', label: 'Hung material', color: '#e8b339' },
  { id: 'timeTrouble', label: 'Time trouble', color: '#3b9cff' },
  { id: 'notation', label: 'Notation issue', color: '#8a8f98' },
];

export function flagLabel(id) {
  return GAME_FLAGS.find((f) => f.id === id)?.label ?? id;
}

export function flagColor(id) {
  return GAME_FLAGS.find((f) => f.id === id)?.color ?? '#8a8f98';
}
