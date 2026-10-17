// Where you are, kept on this device — so the app reopens on the same screen,
// with the same work in front of you, however it was closed underneath you.
//
// iOS throws a home-screen app out of memory whenever something else needs
// the room (a call, the camera, a dozen other apps), and when you come back
// it starts the app again from its front door. A new build reloading itself,
// and pull-to-refresh, are fresh starts too. None of those is you closing the
// app, and a web app can't tell any of them from you swiping it away — so it
// always picks up where you were. The Repertoire Lab logo is the way back to
// a fresh start (it goes to the Library, and that becomes where you are).
//
// localStorage rather than IndexedDB: it's read synchronously, so the very
// first frame can already be the screen you left, not a flash of the Library.
// It's this device's own — never synced — so the iPad and the iPhone don't
// pull each other to different screens.
//
// Parts, each written by whoever owns it:
//   nav      — the screen (App.jsx): view, section, player, chapter, the line
//              or game on the analysis board, scroll position
//   practice — a practice session's queue and how far through it (PracticeView)
//   editor   — the Board Editor's unsaved set-up (BoardEditor)
// The analysis board's own work is kept in the store (analysisSessionDraft),
// alongside the blank board's analysisDraft.

const KEY = 'repertoire-lab-session-v1';

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full or blocked: nothing to keep */ }
}

export const loadSession = () => readAll();

export function saveSessionPart(name, value) {
  const all = readAll();
  if (value == null) delete all[name];
  else all[name] = { ...value, at: Date.now() };
  writeAll(all);
}

// Whether to reopen the saved screen. A launch at the front door (iOS
// relaunching the app, or opening it fresh) or at the very address that was
// saved (a reload, an update) picks up where you were. Any other address is
// a link someone opened on purpose, and that wins.
export function shouldRestore(savedPath, pathname) {
  if (!savedPath) return false;
  const here = String(pathname || '/');
  return here === '/' || here === '' || here === savedPath;
}

// A part that may only be picked up by the screen the app reopened on, once:
// a practice session reopened after iOS closed the app resumes, but pressing
// Practice on the same chapter tomorrow starts a new one. App marks it when it
// reopens a screen; the screen takes it on its first mount.
const pending = new Set();
export const markBootResume = (part) => { pending.add(part); };
export function takeBootResume(part) {
  if (!pending.has(part)) return false;
  pending.delete(part);
  return true;
}

// The analysis board's identity, for its saved work: the same game (in
// Studio or plain analysis), Lab entry or repertoire line comes back with
// what was on the board; a different one starts from its own source.
export function analysisSourceKey(line, lab, studio) {
  if (lab?.id) return `lab:${lab.id}`;
  if (!line) return null;
  if (line.gameId && line.playerId) return `game:${line.playerId}:${line.gameId}:${studio ? 'studio' : 'plain'}`;
  return `line:${line.startFen ?? ''}|${(line.moves ?? []).join(' ')}|${line.name ?? ''}`;
}
