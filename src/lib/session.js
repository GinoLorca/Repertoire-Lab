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
//   nav      — the screen (App.jsx): view, section, player, chapter, scroll
//              position
//   boards   — what's on the analysis board and on Studio's (App.jsx): each
//              one's line or game and Lab entry — kept whatever screen the
//              app reopens on, so neither board empties itself
//   practice — a practice session's queue and how far through it (PracticeView)
//   editor   — the Board Editor's unsaved set-up (BoardEditor)
// Each board's own work is kept in the store: the analysis board's in
// analysisSessionDraft and the blank board's analysisDraft, Studio's in
// studioSessionDraft and studioDraft.

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

// ---------- Analysis and Studio, two boards ----------
//
// Studio was once a setting on the one analysis board, and what was on the
// board went with it: a session saved then has the board's line and Lab
// entry in `nav`, and `coachStudio` saying whether it was Studio. Whatever
// was on that board belongs to the board it was.
const NO_BOARDS = {
  analysisLine: null, analysisLabId: null, studioLine: null, studioLabId: null,
};
export function boardsFromNav(nav) {
  if (!nav) return { ...NO_BOARDS };
  const on = { line: nav.analysisLine ?? null, labId: nav.analysisLabId ?? null };
  return nav.coachStudio
    ? { ...NO_BOARDS, studioLine: on.line, studioLabId: on.labId }
    : { ...NO_BOARDS, analysisLine: on.line, analysisLabId: on.labId };
}

// The analysis screen's tab in such a session: Studio's own, when Studio
// was the board on screen.
export function subFromNav(nav) {
  if (!nav) return null;
  if (nav.coachStudio && nav.view === 'analysis' && !nav.sub) return 'studio';
  return nav.sub ?? null;
}

// The store's drafts from before the split (no studioDraft yet): the one
// board's drafts are Studio's when Studio was that board — the blank one's
// only when Studio was blank. Null once they're split.
export function splitDrafts(saved, nav) {
  if (!saved || 'studioDraft' in saved) return null;
  const studio = Boolean(nav?.coachStudio);
  const blankStudio = studio && !nav.analysisLine && !nav.analysisLabId;
  return {
    analysisDraft: blankStudio ? null : saved.analysisDraft ?? null,
    studioDraft: blankStudio ? saved.analysisDraft ?? null : null,
    analysisSessionDraft: studio ? null : saved.analysisSessionDraft ?? null,
    studioSessionDraft: studio ? saved.analysisSessionDraft ?? null : null,
  };
}
