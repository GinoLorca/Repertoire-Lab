// A fingerprint of everything sync cares about — "has anything changed since
// the last sync?", asked on every change to the state.
//
// It used to be answered by turning the whole library to text and hashing it,
// every time: each move stepped through on a board, each keystroke in a note,
// paid for every line, game, photo and cover in the account. But the store
// replaces what changes and keeps the rest (the very same objects), so each
// piece — an opening, a section, a game, the settings — is read once and
// remembered by the object it was read from: a change re-reads only what it
// replaced, and a change to nothing that syncs (the board in front of you)
// re-reads nothing.
//
// Two states that say the same thing give the same fingerprint, as before —
// a sync's result is all new objects, and matches the state it came from.
// `fresh` reads everything again regardless (useCloud does, now and then, on
// the way out of the app): a piece changed without being replaced would
// otherwise never be seen.
//
// tests/fingerprint.test.mjs
import { hashOf } from './shape';

const read = new WeakMap(); // a piece of the state → its hash

const text = (x) => JSON.stringify(x) ?? '';

function piece(x, fresh) {
  if (x === null || typeof x !== 'object') return hashOf(text(x));
  let h = fresh ? undefined : read.get(x);
  if (h === undefined) {
    h = hashOf(text(x));
    read.set(x, h);
  }
  return h;
}

// A section (a card and its games): the card itself, and each game on its
// own — one game's change re-reads that game, not every game beside it.
function section(p, fresh) {
  if (p === null || typeof p !== 'object' || !Array.isArray(p.games)) return piece(p, fresh);
  let h = fresh ? undefined : read.get(p);
  if (h === undefined) {
    const { games, ...rest } = p;
    h = hashOf(`${text(rest)}:${games.map((g) => piece(g, fresh)).join('.')}`);
    read.set(p, h);
  }
  return h;
}

function list(items, each, fresh) {
  if (!Array.isArray(items)) return piece(items, fresh);
  let h = fresh ? undefined : read.get(items);
  if (h === undefined) {
    h = items.map((x) => each(x, fresh)).join('.');
    read.set(items, h);
  }
  return h;
}

// What sync cares about. The analysis draft is excluded on purpose (it's the
// board in front of you on this device) and so is anything else that isn't
// part of the record. Kept in step with syncableJson in store.jsx.
export function syncableHash(state, { fresh = false } = {}) {
  return hashOf([
    list(state?.openings, piece, fresh),
    list(state?.players, section, fresh),
    list(state?.categories, piece, fresh),
    list(state?.playlists, piece, fresh),
    list(state?.labEntries, piece, fresh),
    list(state?.savedPositions, piece, fresh),
    piece(state?.settings, fresh),
  ].join('|'));
}
