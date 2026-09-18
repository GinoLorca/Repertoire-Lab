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
  { id: 'flipBoard', label: 'Flip the board', default: 'x' },
  { id: 'toggleEngine', label: 'Start or stop the engine', default: 'e' },
  { id: 'toggleArrows', label: 'Engine arrows on / off', default: 'a' },
  { id: 'toggleLines', label: 'Engine lines on / off', default: 'l' },
  { id: 'toggleEvalBar', label: 'Evaluation bar on / off', default: 'b' },
  { id: 'toggleCheckHighlight', label: 'Highlight the king in check', default: 'k' },
  { id: 'toggleDrawMode', label: 'Drawing mode', default: 'd' },
  { id: 'switchExplorer', label: 'Switch Engine / Explorer', default: 'o' },
  { id: 'penGreen', label: 'Hold to draw green', default: 'z' },
  { id: 'penRed', label: 'Hold to draw red', default: 'r' },
  { id: 'penBlue', label: 'Hold to draw blue', default: 'f' },
  { id: 'penYellow', label: 'Hold to draw yellow', default: 'c' },
  // Pressed once, not held — jumps into the Nth alternative tried at the
  // move you're standing on and marks that whole line (see alternativesAt
  // and branchRootOf in lib/moveTree.js). The same key again clears the
  // colour and steps back out to the game.
  { id: 'highlightGreen', label: 'Top alternative to this move — jump in, mark it green', default: '1' },
  { id: 'highlightBlue', label: 'Second alternative — jump in, mark it blue', default: '2' },
  { id: 'highlightYellow', label: 'Third alternative — jump in, mark it yellow', default: '3' },
  // Jumps back to wherever the trunk was last stood on, however many
  // variations (nested or not) deep `head` currently is — see
  // lastMainLineAncestor in lib/moveTree.js. A dedicated key rather than
  // relying on ← alone: stepping back one move at a time out of a long or
  // doubly-nested line to find the actual game again is exactly the
  // tedium this exists to skip.
  { id: 'backToMainLine', label: 'Jump back to the actual game, out of any variation', default: '9' },
];

// A numpad digit's own `code` never changes, but the `key` it reports does:
// with Num Lock off a numeric keypad sends navigation keys instead of digits
// (1→End, 2→ArrowDown, 3→PageDown, 4→ArrowLeft, 6→ArrowRight, 7→Home,
// 8→ArrowUp, 9→PageUp). That's normal keyboard behaviour, not a fault — but
// it means anything reading `key` alone sees a numpad press as Home/End/an
// arrow, and both the shortcut lookup and the Settings rebinder have to go
// through `code` first to get the digit the key is labelled with.
const NUMPAD_DIGITS = {
  Numpad0: '0', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4',
  Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9',
};

// What a keydown should be treated as: the numpad's printed digit when it
// came from the numpad, otherwise the key exactly as reported.
export function eventKey(e) {
  return NUMPAD_DIGITS[e.code] ?? e.key;
}

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

export const isPenShortcut = (id) => id.startsWith('pen');

// A pen binding can be a plain letter ('z') or — since Option and Control
// sit right under the fingers already on the mouse/trackpad hand — a pure
// modifier chord with no letter at all ('alt', 'ctrl+alt', …). Combo keys
// are stored as their modifier names joined by '+', always in this order.
export const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'];
const MODIFIER_GLYPH = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
const MODIFIER_KEY_NAMES = { Control: 'ctrl', Alt: 'alt', Shift: 'shift', Meta: 'meta' };

// 'Alt' (a keydown/keyup event's e.key while pressing the Option key itself)
// -> 'alt', or undefined for a regular key.
export function modifierToken(eventKey) {
  return MODIFIER_KEY_NAMES[eventKey];
}

export function isComboKey(key) {
  return !!key && key.split('+').every((p) => MODIFIER_ORDER.includes(p));
}

// Whether the modifiers held on a mouse/pointer event exactly match a combo
// binding — exact, not "at least", so 'alt' and 'ctrl+alt' stay distinct
// even though one's modifiers are a subset of the other's.
export function comboMatchesEvent(key, e) {
  const parts = key.split('+');
  return MODIFIER_ORDER.every((m) => {
    const held = m === 'ctrl' ? e.ctrlKey : m === 'alt' ? e.altKey : m === 'shift' ? e.shiftKey : e.metaKey;
    return parts.includes(m) === !!held;
  });
}

// 'z' -> 'Z'; 'ctrl+alt' -> '⌃⌥' (Mac modifier order, no separator needed —
// the glyphs read fine run together, the way macOS itself shows them).
export function formatShortcutKey(key) {
  if (!key) return '';
  if (isComboKey(key)) {
    const parts = key.split('+');
    return MODIFIER_ORDER.filter((m) => parts.includes(m)).map((m) => MODIFIER_GLYPH[m]).join('');
  }
  return key.toUpperCase();
}
