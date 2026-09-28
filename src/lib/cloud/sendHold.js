// While Studio is open on a game, that game's changes wait here instead of
// going to the student two seconds after every pause in typing: the student
// hears about the analysis once, when the coach saves or leaves the board,
// not as a string of half-written notes. In memory only — a reload drops the
// hold, and whatever's pending goes out as normal.
const held = new Set();
// Saved while still open: the next send goes out, and the hold carries on.
const once = new Set();

export const holdSends = (gameId) => { held.add(gameId); };

// A send pass, once the save just dispatched has reached the store — the
// provider reads the store as last rendered, so asking straight away would
// send what was there before the save.
const passSoon = () => {
  if (typeof window !== 'undefined') setTimeout(() => window.dispatchEvent(new Event('repertoire-send-now')), 60);
};

export function releaseSends(gameId) {
  held.delete(gameId);
  once.delete(gameId);
  passSoon();
}

// Save pressed with the board still open: the next pass sends it — asked for
// here, since the autosave may already have stored everything and nothing
// would change to start one — and the hold carries on after it.
export function sendOnce(gameId) {
  if (held.has(gameId)) once.add(gameId);
  passSoon();
}

export const sendsHeld = (gameId) => held.has(gameId) && !once.has(gameId);

// The provider sent it: back to holding.
export const sentNow = (gameId) => { once.delete(gameId); };
