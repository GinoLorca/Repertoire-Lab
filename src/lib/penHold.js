// The letters held down right now, watched once for the whole app — the pen
// keys every board reads while you draw (lib/shortcuts' pens, and Game
// Review's letters, lib/arrowProfiles) — and which of them a mark was drawn
// with since they went down.
//
// That second part is Chess Arcade's rule for a letter that is both a pen
// and a shortcut (in the Game Review arrow profile, B and O on the analysis
// board, B in Practice): the shortcut waits for the key's release, and fires
// only when nothing was drawn while it was held. Hold B and drag: a blue
// arrow, and the eval bar stays as it was. Tap B: the eval bar.

// A Mac and an iPad never report the release of a letter pressed with Command:
// after Cmd+R the R stayed "held", and every mark came out red whatever letter
// was down (2026-11-24). So a letter with Command isn't held, Command lets every
// letter go, and a new letter takes the older one's place: one whose release
// was missed can't outlive the next. Releases go by the physical key (with
// Option down, a letter's release has another name).

const held = new Set();
const byCode = new Map(); // physical key -> the name it went down with
const used = new Set();
const waiting = new Map(); // key -> what its release does, unless it drew
let watching = false;

const typing = (e) => {
  const t = e.target;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || Boolean(t?.isContentEditable);
};
// An autofill's keydown can come with no key at all.
const nameOf = (e) => String(e.key ?? '').toLowerCase();
const isLetter = (k) => /^[a-z0-9]$/.test(k);
const dropLetters = () => { for (const k of [...held]) if (isLetter(k)) held.delete(k); };

export function watchHeldKeys() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = nameOf(e);
    if (k === 'meta') { dropLetters(); waiting.clear(); }
    if (e.metaKey && k.length === 1) return;
    if (!held.has(k)) {
      used.delete(k);
      if (isLetter(k)) dropLetters();
    }
    held.add(k);
    if (e.code) byCode.set(e.code, k);
  });
  window.addEventListener('keyup', (e) => {
    const k = byCode.get(e.code) ?? nameOf(e);
    byCode.delete(e.code);
    if (k === 'meta') dropLetters();
    held.delete(k);
    held.delete(nameOf(e));
    const fn = waiting.get(k);
    waiting.delete(k);
    if (fn && !used.has(k)) fn();
  });
  // A key let go in another app would otherwise stay "held".
  window.addEventListener('blur', () => { held.clear(); byCode.clear(); waiting.clear(); });
}

// The letters held now (lowercased).
export const heldKeys = () => held;

// A mark was just drawn (or is being drawn): every letter held drew it.
export function markDrawn() {
  for (const k of held) used.add(k);
}

// A shortcut on a pen letter: run `fn` when `key` is let go, if nothing was
// drawn while it was held. A repeat of the key while held changes nothing.
export function onRelease(key, fn) {
  watchHeldKeys();
  waiting.set(String(key).toLowerCase(), fn);
}

// For the tests: as if the page had just loaded.
export function resetHeldKeys() {
  held.clear(); byCode.clear(); used.clear(); waiting.clear();
}
