// Openings, chapters, courses and sections: every change the Library can make
// to the shape of a repertoire, made on one device and synced to the others
// through the REAL sync engine (src/lib/cloud/sync.js) against the shared
// in-memory Firestore in tests/fakes/.
//
// Changes are made with the app's own reducer: the reducer section of
// src/store.jsx is loaded from the file as it is (it has no JSX in it), so what
// reaches syncNow is exactly what the app would hand it — the same immutable
// updates, the same ids. Each story names the reducer case it dispatches.
//
// Every change is told four ways:
//   · Mac → iPad             the Mac makes it, both sync, the iPad has it
//   · iPad → Mac             the other way round
//   · iPad just updated      the iPad's state has no sync stamp (syncGen), so
//                            the sync that brings the change takes the
//                            careful path (sync.js:509)
//   · Mac just updated       the change itself is made on a state with no
//                            sync stamp
// and each device is checked after every sync, not just the first — a change
// that arrives and is then undone by the next round trip is caught too. A new
// iPhone signing in at the end shows what the account itself holds.
//
// Collapse state — an opening, a course or a section open or shut — is
// treated as part of the library and SHOULD sync. It lives on the opening and
// course records themselves (store.jsx:438, :471, :524), it's how the coach
// has organised the shelves, and the ask is that every change made on one
// device carries over. (Unlike analysisDraft, which shape.js deliberately
// keeps per device, nothing about a collapsed shelf fights with what the
// person is doing on the other screen.)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncNow } from '../src/lib/cloud/sync.js';
import { foldInFlight } from '../src/lib/cloud/merge3.js';
import { hashOf } from '../src/lib/cloud/shape.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';
import { mergeLinkedGames, undoCoachChanges } from '../src/lib/cloud/gameLink.js';
import { defaultMonsterId } from '../src/lib/monsters.js';
import { asDevice, resetServer, server } from './fakes/firebase.mjs';
import { resetDevices } from './fakes/idb.mjs';
import { markPreUpdate, isPreUpdate, downgradeStorage } from './fakes/legacy.mjs';

// ---------------------------------------------------------------------------
// The app's own reducer and emptyState, straight from src/store.jsx.
// ---------------------------------------------------------------------------

const { reducer, emptyState } = (() => {
  const src = readFileSync(new URL('../src/store.jsx', import.meta.url), 'utf8');
  const cut = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `store.jsx no longer has "${from}" … "${to}" — update the loader`);
    return src.slice(a, b);
  };
  const uidLine = src.match(/^export const uid = .+;$/m)?.[0];
  assert.ok(uidLine, 'store.jsx no longer exports uid');
  const body = [
    uidLine.replace(/^export /, ''),
    cut('export function emptyState()', '// Kept for reference').replace(/^export /, ''),
    cut('// ---------- Reducer ----------', '// ---------- Context / persistence ----------'),
    'return { reducer, emptyState };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('DEFAULT_SETTINGS', 'mergeLinkedGames', 'undoCoachChanges', 'defaultMonsterId', 'foldInFlight', body)(
    DEFAULT_SETTINGS, mergeLinkedGames, undoCoachChanges, defaultMonsterId, foldInFlight,
  );
})();

// ---------------------------------------------------------------------------
// A device: its in-memory library, changed only through the reducer, and
// synced the way useCloud.js's run() does it (useCloud.js:81-109): the result
// folded over anything done meanwhile, then hydrated — or, when nothing of
// substance changed, only the new sync stamp recorded.
// ---------------------------------------------------------------------------

// useCloud.js:16-20.
const syncableHash = (state) => hashOf(JSON.stringify({
  openings: state?.openings, players: state?.players, categories: state?.categories,
  playlists: state?.playlists, labEntries: state?.labEntries,
  savedPositions: state?.savedPositions, settings: state?.settings,
}));

// Firestore lists a collection in document-id order. The fake lists it in the
// order documents were first written. When set, the fake is re-sorted before
// every sync so it answers the way the real thing does.
let firestoreIdOrder = false;
function sortServerLikeFirestore() {
  const entries = [...server.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  server.clear();
  for (const [k, v] of entries) server.set(k, v);
}

class Device {
  constructor(storage, label, state = emptyState()) {
    this.storage = storage; // which browser's IndexedDB it uses (two windows share one)
    this.label = label;
    this.state = reducer(null, { type: 'hydrate', state });
  }

  do(action) { this.state = reducer(this.state, action); return this; }

  async sync() {
    if (firestoreIdOrder) sortServerLikeFirestore();
    let started = this.state;
    if (this.preUpdate || isPreUpdate(started)) {
      this.preUpdate = false;
      await downgradeStorage(this.storage);
      const { syncGen: _gone, ...rest } = this.state;
      this.state = rest;
      started = rest;
    }
    const result = await asDevice(this.storage, () => syncNow(started));
    assert.ok(!result.offline, `${this.label} was unexpectedly offline`);
    const now = this.state;
    const next = foldInFlight(started, now, result.state);
    if (syncableHash(now) !== syncableHash(next)) this.state = reducer(now, { type: 'hydrate', state: next });
    else if (next.syncGen !== now.syncGen) this.state = reducer(now, { type: 'setSyncGen', syncGen: next.syncGen });
    return result;
  }

  // The first sync after an update: the library as loaded, with no stamp from
  // a sync this build made.
  // Remembered on the device, not on the state: every change made after
  // this produces a new state object, which wouldn't carry a mark.
  justUpdated() {
    this.state = markPreUpdate(this.state);
    this.preUpdate = true;
    return this;
  }
}

beforeEach(() => { resetServer(); resetDevices(); firestoreIdOrder = false; });

// ---------------------------------------------------------------------------
// The coach's library, built on the Mac with the same actions the Library uses.
// ---------------------------------------------------------------------------

const line = (name, moves) => ({ name, moves });

function buildLibrary(mac) {
  mac.do({ type: 'addPlayer', id: 'p-parker', name: 'Parker', kind: 'student' });

  mac.do({ type: 'addOpening', id: 'o-london', name: 'London System', color: 'white' });
  mac.do({ type: 'addOpening', id: 'o-caro', name: 'Caro-Kann', color: 'black' });
  mac.do({ type: 'addOpening', id: 'o-jobava', name: 'Jobava London', color: 'white' });
  mac.do({ type: 'addOpening', id: 'o-parker-sicilian', name: 'Sicilian', color: 'black', ownerId: 'p-parker' });
  mac.do({ type: 'toggleOpeningStar', openingId: 'o-london' }); // starred, for "unstar"
  mac.do({ type: 'toggleOpeningCollapse', openingId: 'o-jobava' }); // collapsed, for "expand"

  mac.do({ type: 'addCourse', openingId: 'o-caro', id: 'k-shankland', name: 'Shankland Caro' }); // collapsed by default
  mac.do({ type: 'addCourse', openingId: 'o-caro', id: 'k-moser', name: 'Moser Caro' });
  mac.do({ type: 'toggleCourseCollapse', openingId: 'o-caro', courseId: 'k-moser' }); // open, for "collapse"

  const ch = (id, name, extra = {}) => mac.do({ type: 'addChapter', openingId: 'o-caro', id, name, ...extra });
  ch('c-advance', 'Advance', { section: 'Mainlines', courseId: 'k-shankland' });
  ch('c-exchange', 'Exchange', { section: 'Mainlines', courseId: 'k-shankland' });
  ch('c-panov', 'Panov', { section: 'Mainlines', courseId: 'k-moser' });
  ch('c-fantasy', 'Fantasy', { section: 'Sidelines', courseId: 'k-moser' });
  ch('c-twoknights', 'Two Knights', { section: 'Sidelines', subsection: 'Rare' });
  ch('c-misc', 'Odds and ends');
  mac.do({ type: 'toggleGroupCollapse', openingId: 'o-caro', key: 'open:Sidelines' }); // open, for "close"

  const lines = (chapterId, ...vs) => mac.do({ type: 'addVariations', openingId: 'o-caro', chapterId, variations: vs });
  lines('c-advance', line('Short System', ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3']),
    line('Tal Variation', ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4']));
  lines('c-exchange', line('Carlsbad', ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3']));
  lines('c-panov', line('Main', ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4']));
  lines('c-fantasy', line('3...dxe4', ['e4', 'c6', 'd4', 'd5', 'f3', 'dxe4']));
  lines('c-twoknights', line('3...Bg4', ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'Bg4']));
  lines('c-misc', line('2.c4', ['e4', 'c6', 'c4']));

  mac.do({ type: 'addChapter', openingId: 'o-london', id: 'c-london-main', name: 'Main line' });
  mac.do({ type: 'addVariations', openingId: 'o-london', chapterId: 'c-london-main', variations: [line('vs KID', ['d4', 'Nf6', 'Bf4'])] });
  mac.do({ type: 'addChapter', openingId: 'o-jobava', id: 'c-jobava-main', name: 'Main line' });
  mac.do({ type: 'addVariations', openingId: 'o-jobava', chapterId: 'c-jobava-main', variations: [line('Nc3 Bf4', ['d4', 'd5', 'Nc3', 'Nf6', 'Bf4'])] });
  mac.do({ type: 'addChapter', openingId: 'o-parker-sicilian', id: 'c-parker-najdorf', name: 'Najdorf' });
  mac.do({ type: 'addChapter', openingId: 'o-parker-sicilian', id: 'c-parker-dragon', name: 'Dragon' });
  mac.do({ type: 'addVariations', openingId: 'o-parker-sicilian', chapterId: 'c-parker-najdorf', variations: [line('6.Be3', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3'])] });
  mac.do({ type: 'addVariations', openingId: 'o-parker-sicilian', chapterId: 'c-parker-dragon', variations: [line('Yugoslav', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3'])] });
  return mac;
}

// The Mac builds the library and syncs; the iPad signs in with an empty one
// and gets it; each syncs once more, so both are settled on the three-way path.
async function macAndIpadInSync() {
  const mac = buildLibrary(new Device('mac', 'Mac'));
  await mac.sync();
  const ipad = new Device('ipad', 'iPad');
  await ipad.sync();
  await mac.sync();
  await ipad.sync();
  return { mac, ipad };
}

// ---------------------------------------------------------------------------
// Looking things up
// ---------------------------------------------------------------------------

const opening = (st, id) => st.openings.find((o) => o.id === id);
const chapter = (st, oid, cid) => opening(st, oid)?.chapters.find((c) => c.id === cid);
const chapterIds = (st, oid) => opening(st, oid)?.chapters.map((c) => c.id);
const course = (st, oid, kid) => (opening(st, oid)?.courses ?? []).find((k) => k.id === kid);
const courseIds = (st, oid) => (opening(st, oid)?.courses ?? []).map((k) => k.id);
const sections = (st, oid) => opening(st, oid)?.chapters.map((c) => [c.id, c.section ?? null, c.subsection ?? null]);
const docExists = (col, id) => server.has(`users/student1/${col}/${id}`);

// ---------------------------------------------------------------------------
// The stories. `observe` picks out what the change is about; whatever the
// changing device shows right after making the change is what every device
// must show after every sync.
// ---------------------------------------------------------------------------

const STORIES = [
  // ----- Openings ----------------------------------------------------------
  {
    title: 'adds an opening with a chapter and a line — addOpening/addChapter/addVariations (store.jsx:454, :556, :574)',
    change: (d) => {
      d.do({ type: 'addOpening', id: 'o-scandi', name: 'Scandinavian', color: 'black' });
      d.do({ type: 'addChapter', openingId: 'o-scandi', id: 'c-scandi-main', name: 'Qxd5' });
      d.do({ type: 'addVariations', openingId: 'o-scandi', chapterId: 'c-scandi-main', variations: [line('3.Nc3 Qa5', ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'])] });
    },
    observe: (st) => {
      const o = opening(st, 'o-scandi');
      return o && {
        name: o.name, color: o.color, ownerId: o.ownerId ?? null, last: st.openings.at(-1).id,
        chapters: o.chapters.map((c) => [c.id, c.name, c.variations.map((v) => v.name)]),
      };
    },
  },
  {
    title: 'renames an opening — renameOpening (store.jsx:467)',
    change: (d) => d.do({ type: 'renameOpening', openingId: 'o-caro', name: 'Caro-Kann Defence' }),
    observe: (st) => opening(st, 'o-caro')?.name,
  },
  {
    title: 'deletes an opening — deleteOpening (store.jsx:554)',
    change: (d) => d.do({ type: 'deleteOpening', openingId: 'o-jobava' }),
    observe: (st) => ({
      opening: Boolean(opening(st, 'o-jobava')),
      chapter: st.openings.some((o) => o.chapters.some((c) => c.id === 'c-jobava-main')),
    }),
    cloud: () => {
      assert.equal(docExists('openings', 'o-jobava'), false, 'the opening document is still in the account');
      assert.equal(docExists('chapters', 'c-jobava-main'), false, 'its chapter document is still in the account');
    },
  },
  {
    title: 'moves an opening up the list — moveOpening (store.jsx:500)',
    change: (d) => d.do({ type: 'moveOpening', openingId: 'o-jobava', dir: -1 }),
    observe: (st) => st.openings.map((o) => o.id),
  },
  {
    title: 'sets which side an opening is for — setOpeningColor (store.jsx:469)',
    change: (d) => d.do({ type: 'setOpeningColor', openingId: 'o-london', color: 'black' }),
    observe: (st) => opening(st, 'o-london')?.color,
  },
  {
    title: 'stars an opening — toggleOpeningStar (store.jsx:1006)',
    change: (d) => d.do({ type: 'toggleOpeningStar', openingId: 'o-caro' }),
    observe: (st) => Boolean(opening(st, 'o-caro')?.starred),
  },
  {
    title: 'unstars an opening — toggleOpeningStar (store.jsx:1006)',
    change: (d) => d.do({ type: 'toggleOpeningStar', openingId: 'o-london' }),
    observe: (st) => Boolean(opening(st, 'o-london')?.starred),
  },
  {
    title: 'tags an opening — setOpeningTags (store.jsx:988)',
    change: (d) => d.do({ type: 'setOpeningTags', openingId: 'o-caro', tags: ['solid', 'main repertoire'] }),
    observe: (st) => opening(st, 'o-caro')?.tags ?? [],
  },
  {
    title: 'collapses an opening — toggleOpeningCollapse (store.jsx:471)',
    change: (d) => d.do({ type: 'toggleOpeningCollapse', openingId: 'o-caro' }),
    observe: (st) => Boolean(opening(st, 'o-caro')?.collapsed),
  },
  {
    title: 'expands a collapsed opening — toggleOpeningCollapse (store.jsx:471)',
    change: (d) => d.do({ type: 'toggleOpeningCollapse', openingId: 'o-jobava' }),
    observe: (st) => Boolean(opening(st, 'o-jobava')?.collapsed),
  },

  // ----- Chapters ----------------------------------------------------------
  {
    title: 'adds a chapter to a section and a course — addChapter/addVariations (store.jsx:556, :574)',
    change: (d) => {
      d.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-accel', name: 'Accelerated Panov', section: 'Mainlines', courseId: 'k-moser' });
      d.do({ type: 'addVariations', openingId: 'o-caro', chapterId: 'c-accel', variations: [line('2.c4', ['e4', 'c6', 'c4', 'd5'])] });
    },
    observe: (st) => opening(st, 'o-caro')?.chapters.map((c) => [c.id, c.name, c.section ?? null, c.courseId ?? null, c.variations.length]),
  },
  {
    title: 'renames a chapter — renameChapter (store.jsx:567)',
    change: (d) => d.do({ type: 'renameChapter', openingId: 'o-caro', chapterId: 'c-exchange', name: 'Exchange (Carlsbad)' }),
    observe: (st) => chapter(st, 'o-caro', 'c-exchange')?.name,
  },
  {
    title: 'deletes a chapter — deleteChapter (store.jsx:569)',
    change: (d) => d.do({ type: 'deleteChapter', openingId: 'o-caro', chapterId: 'c-panov' }),
    observe: (st) => chapterIds(st, 'o-caro'),
    cloud: () => assert.equal(docExists('chapters', 'c-panov'), false, 'the chapter document is still in the account'),
  },
  {
    title: 'moves a chapter up within its section — moveChapter (store.jsx:502; chapterOrder on the opening doc)',
    change: (d) => d.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 }),
    observe: (st) => chapterIds(st, 'o-caro'),
  },
  {
    title: 'moves a chapter down within its section — moveChapter (store.jsx:502)',
    change: (d) => d.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: 1 }),
    observe: (st) => chapterIds(st, 'o-caro'),
  },
  {
    title: 'stars a chapter — toggleChapterStar (store.jsx:1004)',
    change: (d) => d.do({ type: 'toggleChapterStar', openingId: 'o-caro', chapterId: 'c-fantasy' }),
    observe: (st) => Boolean(chapter(st, 'o-caro', 'c-fantasy')?.starred),
  },
  {
    title: 'tags a chapter — setChapterTags (store.jsx:990)',
    change: (d) => d.do({ type: 'setChapterTags', openingId: 'o-caro', chapterId: 'c-fantasy', tags: ['sharp'] }),
    observe: (st) => chapter(st, 'o-caro', 'c-fantasy')?.tags ?? [],
  },
  {
    title: 'moves a chapter to another section — setChapterSection (store.jsx:475)',
    change: (d) => d.do({ type: 'setChapterSection', openingId: 'o-caro', chapterId: 'c-fantasy', section: 'Mainlines', subsection: null }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'moves a chapter into a brand-new section and sub-section — setChapterSection (store.jsx:475)',
    change: (d) => d.do({ type: 'setChapterSection', openingId: 'o-caro', chapterId: 'c-misc', section: 'Gambits', subsection: 'Early c4' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'takes a chapter out of its section — setChapterSection (store.jsx:475)',
    change: (d) => d.do({ type: 'setChapterSection', openingId: 'o-caro', chapterId: 'c-twoknights', section: '' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'moves a chapter to another course — setChapterCourse (store.jsx:449)',
    change: (d) => d.do({ type: 'setChapterCourse', openingId: 'o-caro', chapterId: 'c-panov', courseId: 'k-shankland' }),
    observe: (st) => chapter(st, 'o-caro', 'c-panov')?.courseId ?? null,
  },
  {
    title: 'takes a chapter out of its course — setChapterCourse (store.jsx:449)',
    change: (d) => d.do({ type: 'setChapterCourse', openingId: 'o-caro', chapterId: 'c-advance', courseId: '' }),
    observe: (st) => chapter(st, 'o-caro', 'c-advance')?.courseId ?? null,
  },

  // ----- Sections ----------------------------------------------------------
  {
    title: 'renames a section — renameSection (store.jsx:517)',
    change: (d) => d.do({ type: 'renameSection', openingId: 'o-caro', from: 'Sidelines', to: 'Offbeat lines' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'deletes a section, keeping its chapters — renameSection to nothing (store.jsx:517)',
    change: (d) => d.do({ type: 'renameSection', openingId: 'o-caro', from: 'Sidelines', to: '' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'moves a section up — moveSection (store.jsx:507)',
    change: (d) => d.do({ type: 'moveSection', openingId: 'o-caro', key: 'Sidelines|', dir: -1 }),
    observe: (st) => chapterIds(st, 'o-caro'),
  },
  {
    title: 'nests a section under another — nestSection (store.jsx:532)',
    change: (d) => d.do({ type: 'nestSection', openingId: 'o-caro', from: 'Sidelines', under: 'Mainlines' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'promotes a sub-section to a section — unnestSubsection (store.jsx:540)',
    change: (d) => d.do({ type: 'unnestSubsection', openingId: 'o-caro', section: 'Sidelines', subsection: 'Rare' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'renames a sub-section — renameSubsection (store.jsx:547)',
    change: (d) => d.do({ type: 'renameSubsection', openingId: 'o-caro', section: 'Sidelines', from: 'Rare', to: 'Rarely seen' }),
    observe: (st) => sections(st, 'o-caro'),
  },
  {
    title: 'opens a section — toggleGroupCollapse (store.jsx:524)',
    change: (d) => d.do({ type: 'toggleGroupCollapse', openingId: 'o-caro', key: 'open:Mainlines' }),
    observe: (st) => opening(st, 'o-caro')?.collapsedGroups ?? {},
  },
  {
    title: 'closes an open section — toggleGroupCollapse (store.jsx:524)',
    change: (d) => d.do({ type: 'toggleGroupCollapse', openingId: 'o-caro', key: 'open:Sidelines' }),
    observe: (st) => opening(st, 'o-caro')?.collapsedGroups ?? {},
  },

  // ----- Courses -----------------------------------------------------------
  {
    title: 'adds a course — addCourse (store.jsx:411)',
    change: (d) => d.do({ type: 'addCourse', openingId: 'o-caro', id: 'k-bologan', name: 'Bologan Caro' }),
    observe: (st) => (opening(st, 'o-caro')?.courses ?? []).map((k) => [k.id, k.name, Boolean(k.collapsed)]),
  },
  {
    title: 'renames a course — renameCourse (store.jsx:418)',
    change: (d) => d.do({ type: 'renameCourse', openingId: 'o-caro', courseId: 'k-moser', name: 'Moser Caro (2024)' }),
    observe: (st) => course(st, 'o-caro', 'k-moser')?.name,
  },
  {
    title: 'deletes a course, keeping its chapters — deleteCourse (store.jsx:424)',
    change: (d) => d.do({ type: 'deleteCourse', openingId: 'o-caro', courseId: 'k-moser' }),
    observe: (st) => ({
      courses: courseIds(st, 'o-caro'),
      chapters: opening(st, 'o-caro')?.chapters.map((c) => [c.id, c.courseId ?? null]),
    }),
  },
  {
    title: 'moves a course up — moveCourse (store.jsx:444)',
    change: (d) => d.do({ type: 'moveCourse', openingId: 'o-caro', courseId: 'k-moser', dir: -1 }),
    observe: (st) => courseIds(st, 'o-caro'),
  },
  {
    title: 'expands a course — toggleCourseCollapse (store.jsx:438)',
    change: (d) => d.do({ type: 'toggleCourseCollapse', openingId: 'o-caro', courseId: 'k-shankland' }),
    observe: (st) => Boolean(course(st, 'o-caro', 'k-shankland')?.collapsed),
  },
  {
    title: 'collapses an open course — toggleCourseCollapse (store.jsx:438)',
    change: (d) => d.do({ type: 'toggleCourseCollapse', openingId: 'o-caro', courseId: 'k-moser' }),
    observe: (st) => Boolean(course(st, 'o-caro', 'k-moser')?.collapsed),
  },

  // ----- A student's openings vs the coach's own ---------------------------
  {
    title: 'adds an opening for a student — addOpening with ownerId (store.jsx:454)',
    change: (d) => {
      d.do({ type: 'addOpening', id: 'o-parker-italian', name: 'Italian', color: 'white', ownerId: 'p-parker' });
      d.do({ type: 'addChapter', openingId: 'o-parker-italian', id: 'c-parker-giuoco', name: 'Giuoco Pianissimo' });
    },
    observe: (st) => ({
      theirs: st.openings.filter((o) => o.ownerId === 'p-parker').map((o) => [o.id, o.name, o.chapters.map((c) => c.id)]),
      mine: st.openings.filter((o) => (o.ownerId ?? null) === null).map((o) => o.id),
    }),
  },
  {
    title: 'renames a student\'s opening — renameOpening (store.jsx:467)',
    change: (d) => d.do({ type: 'renameOpening', openingId: 'o-parker-sicilian', name: 'Sicilian Najdorf & Dragon' }),
    observe: (st) => ({ name: opening(st, 'o-parker-sicilian')?.name, ownerId: opening(st, 'o-parker-sicilian')?.ownerId }),
  },
  {
    title: 'deletes a student\'s opening — deleteOpening (store.jsx:554)',
    change: (d) => d.do({ type: 'deleteOpening', openingId: 'o-parker-sicilian' }),
    observe: (st) => ({
      theirs: st.openings.filter((o) => o.ownerId === 'p-parker').map((o) => o.id),
      mine: st.openings.filter((o) => (o.ownerId ?? null) === null).map((o) => o.id),
    }),
    cloud: () => assert.equal(docExists('openings', 'o-parker-sicilian'), false, 'the opening document is still in the account'),
  },
  {
    title: 'reorders a student\'s chapters — moveChapter (store.jsx:502)',
    change: (d) => d.do({ type: 'moveChapter', openingId: 'o-parker-sicilian', chapterId: 'c-parker-dragon', dir: -1 }),
    observe: (st) => chapterIds(st, 'o-parker-sicilian'),
  },
  {
    title: 'hands the Advance lines to a student, leaving the coach\'s own untouched — copyOpeningsToPlayers (store.jsx:234)',
    change: (d) => d.do({
      type: 'copyOpeningsToPlayers',
      playerIds: ['p-parker'],
      variationIds: chapter(d.state, 'o-caro', 'c-advance').variations.map((v) => v.id),
    }),
    observe: (st) => ({
      theirs: st.openings.filter((o) => o.ownerId === 'p-parker').map((o) => ({
        id: o.id,
        name: o.name,
        courses: (o.courses ?? []).map((k) => k.name),
        chapters: o.chapters.map((c) => ({
          id: c.id,
          name: c.name,
          course: (o.courses ?? []).find((k) => k.id === c.courseId)?.name ?? null,
          lines: c.variations.map((v) => v.name),
        })),
      })),
      coach: {
        ownerId: opening(st, 'o-caro')?.ownerId ?? null,
        chapters: opening(st, 'o-caro')?.chapters.map((c) => [c.id, c.variations.map((v) => v.id)]),
      },
    }),
  },

  // ----- Several changes in one sitting ------------------------------------
  {
    title: 'reorders chapters and adds a new one in the same sitting — moveChapter + addChapter (store.jsx:502, :556)',
    change: (d) => {
      d.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 });
      d.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-accel', name: 'Accelerated Panov', section: 'Mainlines' });
    },
    observe: (st) => chapterIds(st, 'o-caro'),
  },
  {
    title: 'renames an opening and reorders its chapters in the same sitting — renameOpening + moveChapter (store.jsx:467, :502)',
    change: (d) => {
      d.do({ type: 'renameOpening', openingId: 'o-caro', name: 'Caro-Kann Defence' });
      d.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 });
    },
    observe: (st) => ({ name: opening(st, 'o-caro')?.name, chapters: chapterIds(st, 'o-caro') }),
  },
];

const VARIANTS = [
  { tag: 'Mac → iPad', from: 'mac' },
  { tag: 'iPad → Mac', from: 'ipad' },
  { tag: 'Mac → iPad, iPad just updated (its state has no sync stamp)', from: 'mac', stripTo: true },
  { tag: 'Mac → iPad, made on a Mac just updated (its state has no sync stamp)', from: 'mac', stripFrom: true },
];

const show = (v) => JSON.stringify(v);

async function runStory({ change, observe, cloud }, { from, stripFrom = false, stripTo = false }) {
  const devices = await macAndIpadInSync();
  const src = devices[from];
  const dst = devices[from === 'mac' ? 'ipad' : 'mac'];

  if (stripFrom) src.justUpdated();
  const before = observe(src.state);
  change(src);
  const expected = observe(src.state);
  assert.notDeepEqual(expected, before, 'test bug: the change did not change anything');

  // Every device, after every sync. Collected rather than stopping at the
  // first, so a change that arrives late or is undone later shows as such.
  const problems = [];
  const expect = (dev, when) => {
    const got = observe(dev.state);
    try { assert.deepEqual(got, expected); } catch {
      problems.push(`${dev.label} ${when}: has ${show(got)}\n      expected ${show(expected)}`);
    }
  };

  await src.sync();
  expect(src, 'after syncing its change');
  if (stripTo) dst.justUpdated();
  await dst.sync();
  expect(dst, 'after its next sync');
  await src.sync();
  expect(src, 'after syncing again');
  await dst.sync();
  expect(dst, 'after syncing again');
  const iphone = new Device('iphone', 'a new iPhone');
  await iphone.sync();
  expect(iphone, 'signing in afterwards');
  if (cloud) {
    try { cloud(); } catch (err) { problems.push(`the account: ${err.message}`); }
  }
  if (problems.length) assert.fail(`\n${problems.join('\n')}`);
}

for (const story of STORIES) {
  for (const variant of VARIANTS) {
    test(`${variant.tag}: ${story.title}`, () => runStory(story, variant));
  }
}

// ---------------------------------------------------------------------------
// Two devices changing the same opening before either has synced. The Mac
// syncs first, then the iPad, then each once more.
// ---------------------------------------------------------------------------

async function bothChangeThenSync(macChange, ipadChange, observe, expected) {
  const { mac, ipad } = await macAndIpadInSync();
  macChange(mac);
  ipadChange(ipad);
  const problems = [];
  const expect = (dev, when) => {
    const got = observe(dev.state);
    try { assert.deepEqual(got, expected); } catch {
      problems.push(`${dev.label} ${when}: has ${show(got)}\n      expected ${show(expected)}`);
    }
  };
  await mac.sync();
  await ipad.sync();
  expect(ipad, 'after syncing');
  await mac.sync();
  expect(mac, 'after syncing again');
  await ipad.sync();
  expect(ipad, 'after syncing again');
  const iphone = new Device('iphone', 'a new iPhone');
  await iphone.sync();
  expect(iphone, 'signing in afterwards');
  if (problems.length) assert.fail(`\n${problems.join('\n')}`);
}

test('Mac moves a chapter up while the iPad adds a chapter to the same opening: both land, in the Mac\'s order', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 }),
  (ipad) => ipad.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-accel', name: 'Accelerated Panov' }),
  (st) => chapterIds(st, 'o-caro'),
  ['c-exchange', 'c-advance', 'c-panov', 'c-fantasy', 'c-twoknights', 'c-misc', 'c-accel'],
));

test('Mac moves a chapter up while the iPad deletes another chapter of the same opening: both land', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 }),
  (ipad) => ipad.do({ type: 'deleteChapter', openingId: 'o-caro', chapterId: 'c-misc' }),
  (st) => chapterIds(st, 'o-caro'),
  ['c-exchange', 'c-advance', 'c-panov', 'c-fantasy', 'c-twoknights'],
));

test('Mac moves a section up while the iPad adds a chapter to the same opening: both land, in the Mac\'s order', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveSection', openingId: 'o-caro', key: 'Sidelines|', dir: -1 }),
  (ipad) => ipad.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-accel', name: 'Accelerated Panov' }),
  (st) => chapterIds(st, 'o-caro'),
  ['c-fantasy', 'c-advance', 'c-exchange', 'c-panov', 'c-twoknights', 'c-misc', 'c-accel'],
));

test('Mac moves a course up while the iPad adds a course to the same opening: both land, in the Mac\'s order', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveCourse', openingId: 'o-caro', courseId: 'k-moser', dir: -1 }),
  (ipad) => ipad.do({ type: 'addCourse', openingId: 'o-caro', id: 'k-bologan', name: 'Bologan Caro' }),
  (st) => courseIds(st, 'o-caro'),
  ['k-moser', 'k-shankland', 'k-bologan'],
));

test('Mac moves a chapter up while the iPad collapses that opening: both land', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 }),
  (ipad) => ipad.do({ type: 'toggleOpeningCollapse', openingId: 'o-caro' }),
  (st) => ({ chapters: chapterIds(st, 'o-caro'), collapsed: Boolean(opening(st, 'o-caro').collapsed) }),
  { chapters: ['c-exchange', 'c-advance', 'c-panov', 'c-fantasy', 'c-twoknights', 'c-misc'], collapsed: true },
));

test('Mac moves a chapter up while the iPad renames another chapter: both land', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 }),
  (ipad) => ipad.do({ type: 'renameChapter', openingId: 'o-caro', chapterId: 'c-panov', name: 'Panov-Botvinnik' }),
  (st) => ({ chapters: chapterIds(st, 'o-caro'), panov: chapter(st, 'o-caro', 'c-panov').name }),
  { chapters: ['c-exchange', 'c-advance', 'c-panov', 'c-fantasy', 'c-twoknights', 'c-misc'], panov: 'Panov-Botvinnik' },
));

test('Mac renames an opening while the iPad stars and tags it: all three land', () => bothChangeThenSync(
  (mac) => mac.do({ type: 'renameOpening', openingId: 'o-caro', name: 'Caro-Kann Defence' }),
  (ipad) => ipad.do({ type: 'toggleOpeningStar', openingId: 'o-caro' }).do({ type: 'setOpeningTags', openingId: 'o-caro', tags: ['solid'] }),
  (st) => ({ name: opening(st, 'o-caro').name, starred: Boolean(opening(st, 'o-caro').starred), tags: opening(st, 'o-caro').tags ?? [] }),
  { name: 'Caro-Kann Defence', starred: true, tags: ['solid'] },
));

// Two chapters added at the same moment have no "right" order between them —
// what matters is that both are kept and every device shows the same one.
test('both devices add a chapter to the same opening: both are kept, and every device agrees on the order', async () => {
  const { mac, ipad } = await macAndIpadInSync();
  const before = chapterIds(mac.state, 'o-caro');
  mac.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-from-mac', name: 'From the Mac' });
  ipad.do({ type: 'addChapter', openingId: 'o-caro', id: 'c-from-ipad', name: 'From the iPad' });
  await mac.sync();
  await ipad.sync();
  await mac.sync();
  await ipad.sync();
  const iphone = new Device('iphone', 'a new iPhone');
  await iphone.sync();
  const orders = {
    mac: chapterIds(mac.state, 'o-caro'), ipad: chapterIds(ipad.state, 'o-caro'), iphone: chapterIds(iphone.state, 'o-caro'),
  };
  assert.deepEqual(new Set(orders.mac), new Set([...before, 'c-from-mac', 'c-from-ipad']), 'both new chapters are on the Mac');
  assert.deepEqual(orders.mac.slice(0, before.length), before, 'the existing chapters kept their order');
  assert.deepEqual(orders.ipad, orders.mac, 'the iPad shows the same order as the Mac');
  assert.deepEqual(orders.iphone, orders.mac, 'and so does a new device');
});

// ---------------------------------------------------------------------------
// The careful path doing more than keeping the other device's work waiting.
// ---------------------------------------------------------------------------

test('iPad just updated and collapses the Caro-Kann while the Mac reorders its chapters: the Mac\'s order is not undone', async () => {
  const { mac, ipad } = await macAndIpadInSync();
  mac.do({ type: 'moveChapter', openingId: 'o-caro', chapterId: 'c-exchange', dir: -1 });
  await mac.sync();
  const macOrder = chapterIds(mac.state, 'o-caro');
  ipad.justUpdated();
  ipad.do({ type: 'toggleOpeningCollapse', openingId: 'o-caro' });
  await ipad.sync();
  await mac.sync();
  await ipad.sync();
  assert.deepEqual(chapterIds(mac.state, 'o-caro'), macOrder, 'the Mac lost its own reorder');
  assert.deepEqual(chapterIds(ipad.state, 'o-caro'), macOrder, 'the iPad never got the Mac\'s order');
  assert.equal(Boolean(opening(mac.state, 'o-caro').collapsed), true, 'and the iPad\'s collapse reached the Mac');
});

// A deletion on the Mac and a practice session on the iPad in the chapter it
// deleted. Deleting wins (merge3.js says so for the three-way path), so the
// chapter must stay gone — however the iPad's sync goes.
async function practiseInDeletedChapter({ ipadJustUpdated }) {
  const { mac, ipad } = await macAndIpadInSync();
  mac.do({ type: 'deleteChapter', openingId: 'o-caro', chapterId: 'c-panov' });
  await mac.sync();
  if (ipadJustUpdated) ipad.justUpdated();
  const v = chapter(ipad.state, 'o-caro', 'c-panov').variations[0];
  // recordPractice (store.jsx:617): the iPad's user drills the Panov line.
  ipad.do({ type: 'recordPractice', openingId: 'o-caro', chapterId: 'c-panov', variationId: v.id, srs: { level: 1, due: 2e12, lastReview: 1.9e12 } });
  await ipad.sync();
  await mac.sync();
  await ipad.sync();
  const iphone = new Device('iphone', 'a new iPhone');
  await iphone.sync();
  const has = (dev) => chapterIds(dev.state, 'o-caro').includes('c-panov');
  assert.deepEqual(
    { mac: has(mac), ipad: has(ipad), iphone: has(iphone), cloudDoc: docExists('chapters', 'c-panov') },
    { mac: false, ipad: false, iphone: false, cloudDoc: false },
  );
}

test('the iPad practises a line in the chapter the Mac just deleted: the chapter stays deleted everywhere', () => practiseInDeletedChapter({ ipadJustUpdated: false }));

test('iPad just updated and practises a line in the chapter the Mac just deleted: the chapter stays deleted everywhere', () => practiseInDeletedChapter({ ipadJustUpdated: true }));

test('two Mac windows: a rename made in the window whose sync was overtaken by the other window still reaches the iPad', async () => {
  const { mac, ipad } = await macAndIpadInSync();
  // A second window of the app in the same browser — same storage, same
  // library, same sync stamp.
  const window2 = new Device('mac', 'Mac window 2', mac.state);
  // The first window syncs again (it came to the front, or heard a pulse):
  // the account's baseline in this browser moves on.
  await mac.sync();
  window2.do({ type: 'renameOpening', openingId: 'o-caro', name: 'Caro-Kann Defence' });
  await window2.sync();
  assert.equal(opening(window2.state, 'o-caro').name, 'Caro-Kann Defence', 'the rename was undone in the window it was made in');
  await ipad.sync();
  assert.equal(opening(ipad.state, 'o-caro').name, 'Caro-Kann Defence', 'the iPad never got the rename');
});

// ---------------------------------------------------------------------------
// The order of the openings themselves, with the cloud answering in document-
// id order the way Firestore does (the fake otherwise answers in the order
// documents were first written, which hides this).
// ---------------------------------------------------------------------------

test('the coach\'s opening order stays put across syncs when the cloud lists openings by document id, as Firestore does', async () => {
  firestoreIdOrder = true;
  const arranged = ['o-london', 'o-caro', 'o-jobava', 'o-parker-sicilian'];
  const mac = buildLibrary(new Device('mac', 'Mac'));
  assert.deepEqual(mac.state.openings.map((o) => o.id), arranged);
  await mac.sync();
  await mac.sync();
  const macAfter = mac.state.openings.map((o) => o.id);
  const ipad = new Device('ipad', 'iPad');
  await ipad.sync();
  const ipadAfter = ipad.state.openings.map((o) => o.id);
  assert.deepEqual({ mac: macAfter, ipad: ipadAfter }, { mac: arranged, ipad: arranged });
});

// ---------------------------------------------------------------------------
// The Reorder sheet: a whole chapter rearranged in one change.
// ---------------------------------------------------------------------------

const lineNames = (st, cid) => chapter(st, 'o-caro', cid).variations.map((x) => x.name);
const reorderByName = (dev, cid, names) => {
  const vars = chapter(dev.state, 'o-caro', cid).variations;
  dev.do({ type: 'setVariationOrder', openingId: 'o-caro', chapterId: cid, ids: names.map((n) => vars.find((x) => x.name === n).id) });
};

test('Reorder sheet: the Mac rearranges a whole chapter while the iPad adds a line to it — the new order and the new line both land', async () => {
  const { mac, ipad } = await macAndIpadInSync();
  for (const n of ['Bayonet', 'Van der Wiel']) {
    mac.do({ type: 'addVariations', openingId: 'o-caro', chapterId: 'c-advance', variations: [line(n, ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'g4'])] });
  }
  await mac.sync();
  await ipad.sync();
  await mac.sync();
  reorderByName(mac, 'c-advance', ['Van der Wiel', 'Tal Variation', 'Short System', 'Bayonet']);
  ipad.do({ type: 'addVariations', openingId: 'o-caro', chapterId: 'c-advance', variations: [line('Botvinnik-Carls', ['e4', 'c6', 'd4', 'd5', 'e5', 'c5'])] });
  await mac.sync();
  await ipad.sync();
  await mac.sync();
  const iphone = new Device('iphone', 'a new iPhone');
  await iphone.sync();
  const want = ['Van der Wiel', 'Tal Variation', 'Short System', 'Bayonet', 'Botvinnik-Carls'];
  assert.deepEqual(lineNames(ipad.state, 'c-advance'), want, 'iPad');
  assert.deepEqual(lineNames(mac.state, 'c-advance'), want, 'Mac');
  assert.deepEqual(lineNames(iphone.state, 'c-advance'), want, 'a new iPhone');
});

test('Reorder sheet: a line the sheet didn\'t list keeps its place at the end; the same order changes nothing', () => {
  const mac = buildLibrary(new Device('mac', 'Mac'));
  mac.do({ type: 'addVariations', openingId: 'o-caro', chapterId: 'c-advance', variations: [line('Bayonet', ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'g4'])] });
  const vars = chapter(mac.state, 'o-caro', 'c-advance').variations;
  const byName = (n) => vars.find((x) => x.name === n).id;
  // The sheet opened before Bayonet arrived: it lists only the first two.
  mac.do({ type: 'setVariationOrder', openingId: 'o-caro', chapterId: 'c-advance', ids: [byName('Tal Variation'), byName('Short System')] });
  assert.deepEqual(lineNames(mac.state, 'c-advance'), ['Tal Variation', 'Short System', 'Bayonet']);
  const before = mac.state;
  mac.do({ type: 'setVariationOrder', openingId: 'o-caro', chapterId: 'c-advance', ids: chapter(before, 'o-caro', 'c-advance').variations.map((x) => x.id) });
  assert.equal(chapter(mac.state, 'o-caro', 'c-advance'), chapter(before, 'o-caro', 'c-advance'), 'no change, no new chapter object');
});

test('a sync landing just after an edit keeps the edit: the fold happens in the reducer, against the state as it is', () => {
  const mac = buildLibrary(new Device('mac', 'Mac'));
  const started = mac.state;
  // What the sync brings back: the iPad renamed the London.
  const synced = { ...started, syncGen: 'g2', openings: started.openings.map((o) => (o.id === 'o-london' ? { ...o, name: 'London (iPad)' } : o)) };
  // Meanwhile, here: the Caro-Kann renamed, dispatched but — as far as the
  // sync's caller could tell — not yet rendered.
  mac.do({ type: 'renameOpening', openingId: 'o-caro', name: 'Caro-Kann Defence' });
  mac.do({ type: 'syncResult', started, synced });
  assert.equal(opening(mac.state, 'o-london').name, 'London (iPad)', 'the other device\'s change');
  assert.equal(opening(mac.state, 'o-caro').name, 'Caro-Kann Defence', 'and the edit made while it synced');
  const before = mac.state;
  mac.do({ type: 'syncResult', started: before, synced: { ...before, syncGen: 'g3' } });
  assert.equal(mac.state.syncGen, 'g3');
  assert.equal(mac.state.openings, before.openings, 'nothing new: the library isn\'t replaced, so no view restarts');
});

