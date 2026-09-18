// Every place in the app that's worth linking to, as a URL.
//
// The app is one page with a `view` in state, so the address bar used to say
// "/" wherever you were — nothing could be sent to anyone. These routes give
// each section, and each sub-mode inside a section, an address of its own:
// paste /analysis/editor into a message and it opens there.
//
// Paths rather than #hashes, because they read like addresses and because
// nothing has to change to serve them: the service worker already answers
// every navigation with the cached shell (see public/sw.js), and netlify.toml
// has the matching SPA rewrite for a first visit with no worker installed.
//
// The internal view name and the URL are deliberately allowed to differ — the
// Collections tab is `groups` in the code for historical reasons, and there's
// no reason to make a link say so.
const VIEW_PATHS = [
  ['library', 'library'],
  ['groups', 'collections'],
  ['import', 'import'],
  ['practice', 'practice'],
  ['games', 'games'],
  ['analysis', 'analysis'],
  ['coaches', 'coaches'],
  ['settings', 'settings'],
];

const PATH_TO_VIEW = Object.fromEntries(VIEW_PATHS.map(([view, path]) => [path, view]));
const VIEW_TO_PATH = Object.fromEntries(VIEW_PATHS);

// The sub-modes each section is willing to take from a URL. Anything else in
// that position is ignored rather than trusted — a link is an input like any
// other, and a bad one should land you on the section, not in a broken state.
export const SUB_VIEWS = {
  analysis: ['engine', 'compare', 'editor'],
  settings: ['account', 'appearance', 'themes', 'board', 'trainer', 'analysis', 'keyboard', 'explorer', 'sounds'],
};

// A chapter is addressed by the two ids it actually needs. They're stable for
// a given repertoire — they survive Backup/Restore — so a chapter link works
// across your own devices, though not on someone else's data.
export function pathFor({ view, sub, chapterNav } = {}) {
  if (view === 'chapter' && chapterNav?.openingId && chapterNav?.chapterId) {
    return `/chapter/${chapterNav.openingId}/${chapterNav.chapterId}`;
  }
  const base = VIEW_TO_PATH[view];
  if (!base) return '/';
  if (sub && SUB_VIEWS[view]?.includes(sub)) return `/${base}/${sub}`;
  return `/${base}`;
}

export function parsePath(pathname = '/') {
  const [head, a, b] = String(pathname).replace(/^\/+|\/+$/g, '').split('/');
  if (!head) return { view: 'library' };
  if (head === 'chapter') {
    return a && b ? { view: 'chapter', chapterNav: { openingId: a, chapterId: b } } : { view: 'library' };
  }
  const view = PATH_TO_VIEW[head];
  if (!view) return { view: 'library' };
  return { view, sub: SUB_VIEWS[view]?.includes(a) ? a : null };
}

// The tab strip's own labels, for the "copy a link to here" button.
export const SECTION_LABEL = {
  library: 'Library',
  groups: 'Collections',
  import: 'Import',
  practice: 'Practice',
  games: 'Games',
  analysis: 'Analysis',
  coaches: 'Coaches Corner',
  settings: 'Settings',
  chapter: 'this chapter',
};
