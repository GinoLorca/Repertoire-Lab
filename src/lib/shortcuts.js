// Rebindable single-key shortcuts for the analysis board. Defaults follow
// chess.com/lichess conventions where one exists; every id here can be
// remapped in Settings → Keyboard, stored as settings.shortcuts[id].

export const PENS = [
  { id: 'green', shortcutId: 'penGreen', name: 'Green', value: '#2ecc71' },
  { id: 'red', shortcutId: 'penRed', name: 'Red', value: '#e5534b' },
  { id: 'blue', shortcutId: 'penBlue', name: 'Blue', value: '#3b9cff' },
  { id: 'yellow', shortcutId: 'penYellow', name: 'Yellow', value: '#e8b339' },
];

// Pen keys are HELD during a drag to draw in that colour for that one arrow —
// not pressed-once to switch a persistent selection. Whichever pen is
// settings.defaultPen (see defaultPen() below) is what you get holding
// nothing, so its own key here is just a redundant alternate route to the
// same colour, not the only way to reach it.
export const SHORTCUTS = [
  { id: 'flipBoard', label: 'Flip the board', default: 'f' },
  { id: 'toggleEngine', label: 'Start or stop the engine', default: 'e' },
  { id: 'toggleArrows', label: 'Engine arrows on / off', default: 'a' },
  { id: 'toggleLines', label: 'Engine lines on / off', default: 'l' },
  { id: 'toggleEvalBar', label: 'Evaluation bar on / off', default: 'b' },
  { id: 'toggleCheckHighlight', label: 'Highlight the king in check', default: 'k' },
  { id: 'toggleDrawMode', label: 'Drawing mode', default: 'd' },
  { id: 'switchExplorer', label: 'Switch Engine / Explorer', default: 'o' },
  { id: 'penGreen', label: 'Hold to draw green', default: 'z' },
  { id: 'penRed', label: 'Hold to draw red', default: 'r' },
  { id: 'penBlue', label: 'Hold to draw blue', default: 'x' },
  { id: 'penYellow', label: 'Hold to draw yellow', default: 'c' },
];

export function shortcutKey(settings, id) {
  const bound = settings?.shortcuts?.[id];
  if (bound) return bound.toLowerCase();
  return (SHORTCUTS.find((s) => s.id === id)?.default ?? '').toLowerCase();
}

// Lowercased-key → action-id, rebuilt whenever bindings change. If two
// actions somehow land on the same key the later one wins — the Settings
// editor prevents this by swapping instead of overwriting.
export function shortcutMap(settings) {
  const map = {};
  for (const s of SHORTCUTS) map[shortcutKey(settings, s.id)] = s.id;
  return map;
}

// The pen used when you draw without holding any of the keys above.
export function defaultPen(settings) {
  const id = settings?.defaultPen ?? 'green';
  return PENS.find((p) => p.id === id) ?? PENS[0];
}
