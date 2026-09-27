// The sync engine's own edges, as user stories: the real engine
// (src/lib/cloud/sync.js + merge3.js + shape.js) run by simulated devices —
// a Mac, an iPad and an iPhone, all signed in to the same account — against
// one shared in-memory Firestore (tests/fakes/).
//
// The question every test asks is the one the user asked: a change made on
// one device — a line added, a list rearranged, a comment removed, a theme
// picked — does it arrive on the others, and does it STAY there, whichever
// path the merge takes?
//
//   · the ordinary three-way merge (a state carrying its sync's stamp)
//   · the careful path (a state without the current stamp: the first sync
//     after an app update, a window that fell behind another window, an iPad
//     relaunched from a state saved before its last sync finished)
//   · the two-way first sync (a device with no baseline at all)
//   · offline, in flight, three devices at once, and settings.
//
// Two modelling choices, both to make the fake behave like the real thing:
//
//   1. Real Firestore returns a collection's documents in document-ID order.
//      The fake's Map returns them in first-write order, which hides every
//      bug where order depends on it. `sync()` below re-sorts the fake's
//      documents by path before each sync, which is exactly Firestore's order.
//   2. Two real syncs never happen in the same millisecond. `sync()` waits a
//      couple of ms first, so settings timestamps behave as they would.
//
// store.jsx is JSX and can't be imported under plain Node, so the reducer
// cases these stories use are mirrored below verbatim (see `reduce`).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncNow } from '../src/lib/cloud/sync.js';
import { foldInFlight } from '../src/lib/cloud/merge3.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';
import {
  asDevice, resetServer, server, hold, setOffline,
} from './fakes/firebase.mjs';
import { resetDevices, set as idbSet } from './fakes/idb.mjs';
import { markPreUpdate, isPreUpdate, downgradeStorage } from './fakes/legacy.mjs';

beforeEach(() => { resetServer(); resetDevices(); });

// ---------------------------------------------------------------------------
// The reducer, mirrored from src/store.jsx (helpers and cases copied as-is)
// ---------------------------------------------------------------------------

// store.jsx `uid`
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// store.jsx "Ordering helpers"
const swap = (arr, i, j) => {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
function moveInArray(arr, id, dir) {
  const i = arr.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  return swap(arr, i, j);
}
const groupKey = (c) => `${c.section ?? ''}|${c.subsection ?? ''}`;
function moveChapterInGroup(chapters, chapterId, dir) {
  const i = chapters.findIndex((c) => c.id === chapterId);
  if (i < 0) return chapters;
  const key = groupKey(chapters[i]);
  for (let j = i + dir; j >= 0 && j < chapters.length; j += dir) {
    if (groupKey(chapters[j]) === key) return swap(chapters, i, j);
  }
  return chapters;
}
function orderedGroups(chapters) {
  const groups = [];
  const index = new Map();
  for (const c of chapters) {
    const key = groupKey(c);
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ key, items: [] });
    }
    groups[index.get(key)].items.push(c);
  }
  return groups;
}
function moveGroup(chapters, key, dir) {
  const groups = orderedGroups(chapters);
  const i = groups.findIndex((g) => g.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= groups.length) return chapters;
  return swap(groups, i, j).flatMap((g) => g.items);
}
// store.jsx `mapOpening` / `mapChapter`
function mapOpening(state, openingId, fn) {
  return { ...state, openings: state.openings.map((o) => (o.id === openingId ? fn(o) : o)) };
}
function mapChapter(state, openingId, chapterId, fn) {
  return mapOpening(state, openingId, (o) => ({
    ...o,
    chapters: o.chapters.map((c) => (c.id === chapterId ? fn(c) : c)),
  }));
}

// store.jsx `reduce`, the cases these stories dispatch — same names, same
// bodies. Anything not mirrored throws rather than silently doing nothing.
function reduce(state, action) {
  switch (action.type) {
    case 'addCourse': {
      const course = { id: action.id ?? uid(), name: action.name, artwork: null, collapsed: true };
      return mapOpening(state, action.openingId, (o) => ({ ...o, courses: [...(o.courses ?? []), course] }));
    }
    case 'moveCourse':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: moveInArray(o.courses ?? [], action.courseId, action.dir),
      }));
    case 'addOpening': {
      const opening = {
        id: action.id ?? uid(),
        name: action.name,
        color: action.color ?? 'white',
        ownerId: action.ownerId ?? null,
        chapters: [],
      };
      return { ...state, openings: [...state.openings, opening] };
    }
    case 'moveOpening':
      return { ...state, openings: moveInArray(state.openings, action.openingId, action.dir) };
    case 'moveChapter':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: moveChapterInGroup(o.chapters, action.chapterId, action.dir),
      }));
    case 'moveSection':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: moveGroup(o.chapters, action.key, action.dir),
      }));
    case 'moveVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: moveInArray(c.variations, action.variationId, action.dir),
      }));
    case 'addChapter': {
      const chapter = {
        id: action.id ?? uid(),
        name: action.name,
        section: action.section ?? null,
        subsection: action.section ? (action.subsection ?? null) : null,
        courseId: action.courseId ?? null,
        variations: [],
      };
      return mapOpening(state, action.openingId, (o) => ({ ...o, chapters: [...o.chapters, chapter] }));
    }
    case 'renameChapter':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({ ...c, name: action.name }));
    case 'deleteChapter':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: o.chapters.filter((c) => c.id !== action.chapterId),
      }));
    case 'addVariations': {
      const fresh = action.variations.map((v) => ({
        id: uid(),
        name: v.name || 'Variation',
        moves: v.moves,
        comments: v.comments ?? {},
        badges: v.badges ?? {},
        learned: false,
        srs: null,
      }));
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: [...c.variations, ...fresh],
      }));
    }
    case 'deleteVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.filter((v) => v.id !== action.variationId),
      }));
    case 'renameVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, name: action.name } : v)),
      }));
    case 'setMoveComment':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => {
          if (v.id !== action.variationId) return v;
          const comments = { ...(v.comments ?? {}) };
          if (action.text?.trim()) comments[action.moveIndex] = action.text.trim();
          else delete comments[action.moveIndex];
          return { ...v, comments };
        }),
      }));
    case 'addToPlaylist':
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => {
          if (p.id !== action.playlistId) return p;
          if (p.items.some((it) => it.variationId === action.variationId)) return p;
          return {
            ...p,
            items: [...p.items, {
              openingId: action.openingId, chapterId: action.chapterId, variationId: action.variationId,
            }],
          };
        }),
      };
    case 'movePlaylistItem':
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => {
          if (p.id !== action.playlistId) return p;
          const i = p.items.findIndex((it) => it.variationId === action.variationId);
          const j = i + action.dir;
          if (i < 0 || j < 0 || j >= p.items.length) return p;
          const items = [...p.items];
          [items[i], items[j]] = [items[j], items[i]];
          return { ...p, items };
        }),
      };
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    default:
      throw new Error(`reducer case not mirrored in this test: ${action.type}`);
  }
}
const act = (state, ...actions) => actions.reduce(reduce, state);

// The actions, as the app's views dispatch them (ChapterView, Library,
// PlaylistPicker, Settings).
const A = {
  moveVariation: (variationId, dir, chapterId = 'c1') => ({ type: 'moveVariation', openingId: 'o1', chapterId, variationId, dir }),
  moveChapter: (chapterId, dir) => ({ type: 'moveChapter', openingId: 'o1', chapterId, dir }),
  moveSection: (key, dir) => ({ type: 'moveSection', openingId: 'o1', key, dir }),
  moveOpening: (openingId, dir) => ({ type: 'moveOpening', openingId, dir }),
  moveCourse: (courseId, dir) => ({ type: 'moveCourse', openingId: 'o1', courseId, dir }),
  movePlaylistItem: (variationId, dir) => ({ type: 'movePlaylistItem', playlistId: 'pl1', variationId, dir }),
  addVariation: (name, chapterId = 'c1') => ({
    type: 'addVariations', openingId: 'o1', chapterId, variations: [{ name, moves: ['d4', 'd5', 'Nc3', 'Nf6', 'Bg5'] }],
  }),
  addChapter: (name, section = 'Core') => ({ type: 'addChapter', openingId: 'o1', name, section }),
  addOpening: (name) => ({ type: 'addOpening', name, color: 'black' }),
  addCourse: (name) => ({ type: 'addCourse', openingId: 'o1', name }),
  addToPlaylist: (variationId, chapterId) => ({ type: 'addToPlaylist', playlistId: 'pl1', openingId: 'o1', chapterId, variationId }),
  renameVariation: (variationId, name) => ({ type: 'renameVariation', openingId: 'o1', chapterId: 'c1', variationId, name }),
  renameChapter: (chapterId, name) => ({ type: 'renameChapter', openingId: 'o1', chapterId, name }),
  deleteVariation: (variationId) => ({ type: 'deleteVariation', openingId: 'o1', chapterId: 'c1', variationId }),
  deleteChapter: (chapterId) => ({ type: 'deleteChapter', openingId: 'o1', chapterId }),
  comment: (variationId, moveIndex, text, chapterId = 'c1') => ({
    type: 'setMoveComment', openingId: 'o1', chapterId, variationId, moveIndex, text,
  }),
  settings: (settings) => ({ type: 'setSettings', settings }),
};

// ---------------------------------------------------------------------------
// The library, the devices, and what the user looks at
// ---------------------------------------------------------------------------

const V = (id, name, moves, extra = {}) => ({
  id, name, moves, comments: {}, badges: {}, learned: false, srs: null, ...extra,
});

// One account's library, in the shape the reducer builds: an opening with two
// courses, three chapters in two sections, a playlist.
function library() {
  return {
    openings: [
      {
        id: 'o1',
        name: 'Jobava London',
        color: 'white',
        ownerId: null,
        courses: [
          { id: 'k1', name: 'Course A', artwork: null, collapsed: true },
          { id: 'k2', name: 'Course B', artwork: null, collapsed: true },
        ],
        chapters: [
          {
            id: 'c1', name: 'Main line', section: 'Core', subsection: null, courseId: 'k1',
            variations: [
              V('v1', 'A', ['d4', 'd5', 'Nc3', 'Nf6', 'Bf4'], { comments: { 2: 'The Jobava move' } }),
              V('v2', 'B', ['d4', 'd5', 'Nc3', 'Bf5']),
              V('v3', 'C', ['d4', 'd5', 'Nc3', 'e6']),
            ],
          },
          {
            id: 'c2', name: 'Sidelines', section: 'Core', subsection: null, courseId: 'k1',
            variations: [V('w1', 'W', ['d4', 'Nf6', 'Nc3'])],
          },
          {
            id: 'c3', name: 'Early c5', section: 'Other', subsection: null, courseId: null,
            variations: [V('x1', 'X', ['d4', 'c5'])],
          },
        ],
      },
      { id: 'o2', name: 'Caro-Kann', color: 'black', ownerId: null, chapters: [] },
      { id: 'o3', name: "King's Indian", color: 'black', ownerId: null, chapters: [] },
    ],
    players: [],
    categories: [],
    playlists: [{
      id: 'pl1',
      name: 'Warm-up',
      shuffle: false,
      items: ['v1', 'v2', 'v3'].map((variationId) => ({ openingId: 'o1', chapterId: 'c1', variationId })),
    }],
    labEntries: [],
    analysisDraft: null,
    savedPositions: [],
    settings: { ...DEFAULT_SETTINGS, skin: 'bauhaus' },
  };
}

// A fresh install: store.jsx emptyState(), hydrated with the default settings
// the way StoreProvider does on a first run.
const freshInstall = () => ({
  openings: [], players: [], categories: [], playlists: [], labEntries: [],
  analysisDraft: null, savedPositions: [], settings: { ...DEFAULT_SETTINGS },
});

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Real Firestore's order for a collection: by document id.
function firestoreOrder() {
  const entries = [...server.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  server.clear();
  for (const [k, v] of entries) server.set(k, v);
}

// One sync on one device, the result carried forward as the app does.
async function sync(device, state, options) {
  await pause(2);
  firestoreOrder();
  if (isPreUpdate(state)) await downgradeStorage(device);
  return (await asDevice(device, () => syncNow(state, options))).state;
}

// The first sync after an app update: the saved state carries no stamp.
const afterUpdate = (state) => markPreUpdate(state);

// Every named device signed in and fully synced with the Mac's library.
async function inSync(names = ['mac', 'ipad']) {
  const d = {};
  d.mac = await sync('mac', library());
  for (const n of names.filter((x) => x !== 'mac')) d[n] = await sync(n, freshInstall());
  for (const n of names) d[n] = await sync(n, d[n]);
  return d;
}

// What the person sees.
const opening = (st, id = 'o1') => st.openings.find((o) => o.id === id);
const chapter = (st, id = 'c1') => opening(st).chapters.find((c) => c.id === id);
const names = (list) => (list ?? []).map((x) => x.name);
const variations = (st, c = 'c1') => names(chapter(st, c)?.variations);
const chapters = (st) => names(opening(st).chapters);
const openings = (st) => names(st.openings);
const courses = (st) => names(opening(st).courses);
const playlist = (st) => st.playlists.find((p) => p.id === 'pl1').items.map((it) => it.variationId);
const variation = (st, id, c = 'c1') => chapter(st, c)?.variations.find((v) => v.id === id);

// ---------------------------------------------------------------------------
// 1. Every change, every path
//
// For each change: Mac → iPad, iPad → Mac, Mac → an iPad whose next sync is
// its first after an update (careful path), and Mac → a brand-new iPhone
// signing in (two-way first sync). Each also checks the change is still on
// the device that made it after the other device's sync — "arrived, then got
// pushed back over" is the failure the user saw.
// ---------------------------------------------------------------------------

const CHANGES = [
  {
    what: 'moves a variation to the top of its chapter',
    make: (st) => act(st, A.moveVariation('v3', -1), A.moveVariation('v3', -1)),
    see: (st, who) => assert.deepEqual(variations(st), ['C', 'A', 'B'], who),
  },
  {
    what: 'moves a chapter up within its section',
    make: (st) => act(st, A.moveChapter('c2', -1)),
    see: (st, who) => assert.deepEqual(chapters(st), ['Sidelines', 'Main line', 'Early c5'], who),
  },
  {
    what: 'moves a whole section up',
    make: (st) => act(st, A.moveSection('Other|', -1)),
    see: (st, who) => assert.deepEqual(chapters(st), ['Early c5', 'Main line', 'Sidelines'], who),
  },
  {
    what: 'moves an opening up the Library',
    make: (st) => act(st, A.moveOpening('o3', -1)),
    see: (st, who) => assert.deepEqual(openings(st), ['Jobava London', "King's Indian", 'Caro-Kann'], who),
  },
  {
    what: 'moves a course up inside an opening',
    make: (st) => act(st, A.moveCourse('k2', -1)),
    see: (st, who) => assert.deepEqual(courses(st), ['Course B', 'Course A'], who),
  },
  {
    what: 'moves a line up a playlist',
    make: (st) => act(st, A.movePlaylistItem('v3', -1)),
    see: (st, who) => assert.deepEqual(playlist(st), ['v1', 'v3', 'v2'], who),
  },
  {
    what: 'adds a variation',
    make: (st) => act(st, A.addVariation('D')),
    see: (st, who) => assert.deepEqual(variations(st), ['A', 'B', 'C', 'D'], who),
  },
  {
    what: 'adds a chapter',
    make: (st) => act(st, A.addChapter('Anti-Jobava')),
    see: (st, who) => assert.deepEqual(chapters(st), ['Main line', 'Sidelines', 'Early c5', 'Anti-Jobava'], who),
  },
  {
    what: 'adds an opening',
    make: (st) => act(st, A.addOpening('Scandinavian')),
    see: (st, who) => assert.deepEqual(openings(st), ['Jobava London', 'Caro-Kann', "King's Indian", 'Scandinavian'], who),
  },
  {
    what: 'renames a variation',
    make: (st) => act(st, A.renameVariation('v1', 'A — 3...Nf6')),
    see: (st, who) => assert.equal(variation(st, 'v1').name, 'A — 3...Nf6', who),
  },
  {
    what: 'deletes a variation',
    make: (st) => act(st, A.deleteVariation('v2')),
    see: (st, who) => assert.deepEqual(variations(st), ['A', 'C'], who),
  },
  {
    what: 'deletes a chapter',
    make: (st) => act(st, A.deleteChapter('c2')),
    see: (st, who) => assert.deepEqual(chapters(st), ['Main line', 'Early c5'], who),
  },
  {
    what: 'clears a move comment',
    make: (st) => act(st, A.comment('v1', 2, '')),
    see: (st, who) => assert.deepEqual(variation(st, 'v1').comments ?? {}, {}, who),
  },
];

for (const change of CHANGES) {
  test(`Mac ${change.what}; both sync; the iPad sees it and the Mac keeps it`, async () => {
    const d = await inSync();
    d.mac = await sync('mac', change.make(d.mac));
    change.see(d.mac, 'the Mac, after its own sync');
    d.ipad = await sync('ipad', d.ipad);
    change.see(d.ipad, 'the iPad');
    d.mac = await sync('mac', d.mac);
    change.see(d.mac, 'the Mac, after the iPad synced');
  });

  test(`iPad ${change.what}; both sync; the Mac sees it and the iPad keeps it`, async () => {
    const d = await inSync();
    d.ipad = await sync('ipad', change.make(d.ipad));
    change.see(d.ipad, 'the iPad, after its own sync');
    d.mac = await sync('mac', d.mac);
    change.see(d.mac, 'the Mac');
    d.ipad = await sync('ipad', d.ipad);
    change.see(d.ipad, 'the iPad, after the Mac synced');
  });

  test(`Mac ${change.what}; the iPad's first sync after an app update (no syncGen) sees it and doesn't undo it`, async () => {
    const d = await inSync();
    d.mac = await sync('mac', change.make(d.mac));
    d.ipad = await sync('ipad', afterUpdate(d.ipad));
    change.see(d.ipad, 'the iPad, on the careful path');
    d.mac = await sync('mac', d.mac);
    change.see(d.mac, 'the Mac, after the iPad\'s careful sync');
    d.ipad = await sync('ipad', d.ipad);
    change.see(d.ipad, 'the iPad, a sync later');
  });

  test(`Mac ${change.what}; a brand-new iPhone signing in (no baseline) sees it`, async () => {
    const d = await inSync();
    d.mac = await sync('mac', change.make(d.mac));
    const iphone = await sync('iphone', freshInstall());
    change.see(iphone, 'the new iPhone');
    d.mac = await sync('mac', d.mac);
    change.see(d.mac, 'the Mac, after the iPhone joined');
  });
}

// ---------------------------------------------------------------------------
// 2. A reorder on one device and an addition on another, same list, same time
// ---------------------------------------------------------------------------

const CLASHES = [
  {
    list: 'variations',
    mac: (st) => act(st, A.moveVariation('v3', -1), A.moveVariation('v3', -1)),
    ipad: (st) => act(st, A.addVariation('D')),
    see: (st, who) => assert.deepEqual(variations(st), ['C', 'A', 'B', 'D'], who),
  },
  {
    list: 'chapters',
    mac: (st) => act(st, A.moveChapter('c2', -1)),
    ipad: (st) => act(st, A.addChapter('Anti-Jobava')),
    see: (st, who) => assert.deepEqual(chapters(st), ['Sidelines', 'Main line', 'Early c5', 'Anti-Jobava'], who),
  },
  {
    list: 'sections',
    mac: (st) => act(st, A.moveSection('Other|', -1)),
    ipad: (st) => act(st, A.addChapter('Anti-Jobava')),
    see: (st, who) => assert.deepEqual(chapters(st), ['Early c5', 'Main line', 'Sidelines', 'Anti-Jobava'], who),
  },
  {
    list: 'openings',
    mac: (st) => act(st, A.moveOpening('o3', -1)),
    ipad: (st) => act(st, A.addOpening('Scandinavian')),
    see: (st, who) => assert.deepEqual(openings(st), ['Jobava London', "King's Indian", 'Caro-Kann', 'Scandinavian'], who),
  },
  {
    list: 'courses',
    mac: (st) => act(st, A.moveCourse('k2', -1)),
    ipad: (st) => act(st, A.addCourse('Course C')),
    see: (st, who) => assert.deepEqual(courses(st), ['Course B', 'Course A', 'Course C'], who),
  },
  {
    list: 'playlist lines',
    mac: (st) => act(st, A.movePlaylistItem('v3', -1)),
    ipad: (st) => act(st, A.addToPlaylist('w1', 'c2')),
    see: (st, who) => assert.deepEqual(playlist(st), ['v1', 'v3', 'v2', 'w1'], who),
  },
];

for (const clash of CLASHES) {
  for (const first of ['mac', 'ipad']) {
    const second = first === 'mac' ? 'ipad' : 'mac';
    test(`${clash.list}: Mac rearranges while the iPad adds one, ${first === 'mac' ? 'Mac' : 'iPad'} syncs first — both changes land on both`, async () => {
      const d = await inSync();
      d.mac = clash.mac(d.mac);
      d.ipad = clash.ipad(d.ipad);
      d[first] = await sync(first, d[first]);
      d[second] = await sync(second, d[second]);
      d[first] = await sync(first, d[first]);
      clash.see(d.mac, 'the Mac');
      clash.see(d.ipad, 'the iPad');
    });
  }
}

test('variations: a deletion on the Mac and a reorder on the iPad, either sync order — both land', async () => {
  for (const first of ['mac', 'ipad']) {
    resetServer(); resetDevices();
    const second = first === 'mac' ? 'ipad' : 'mac';
    const d = await inSync();
    d.mac = act(d.mac, A.deleteVariation('v1'));
    d.ipad = act(d.ipad, A.moveVariation('v3', -1)); // A C B
    d[first] = await sync(first, d[first]);
    d[second] = await sync(second, d[second]);
    d[first] = await sync(first, d[first]);
    assert.deepEqual(variations(d.mac), ['C', 'B'], `the Mac (${first} first)`);
    assert.deepEqual(variations(d.ipad), ['C', 'B'], `the iPad (${first} first)`);
  }
});

// ---------------------------------------------------------------------------
// 3. Both devices rearrange the same list, differently
//
// Decided outcome: the rearrangement that reaches the account LAST wins as a
// whole (the same "this device, where the person is looking" rule the merge
// uses for any other clash), the two devices end up showing the SAME order,
// and nothing is lost or doubled.
// ---------------------------------------------------------------------------

test('variations rearranged differently on Mac and iPad: both devices converge on the later one, nothing lost or doubled', async () => {
  const d = await inSync();
  d.mac = act(d.mac, A.moveVariation('v3', -1), A.moveVariation('v3', -1)); // C A B
  d.ipad = act(d.ipad, A.moveVariation('v1', 1)); // B A C
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  assert.deepEqual(variations(d.ipad), ['B', 'A', 'C'], 'the iPad synced its order last');
  assert.deepEqual(variations(d.mac), variations(d.ipad), 'and the Mac shows the same');
});

test('openings rearranged differently on Mac and iPad: both devices converge on the later one', async () => {
  const d = await inSync();
  d.mac = act(d.mac, A.moveOpening('o3', -1)); // Jobava, KID, Caro
  d.ipad = act(d.ipad, A.moveOpening('o1', 1)); // Caro, Jobava, KID
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.deepEqual(openings(d.ipad), ['Caro-Kann', 'Jobava London', "King's Indian"]);
  assert.deepEqual(openings(d.mac), openings(d.ipad));
});

// ---------------------------------------------------------------------------
// 4. Three devices, three different changes, every sync order
// ---------------------------------------------------------------------------

const PERMUTATIONS = [
  ['mac', 'ipad', 'iphone'], ['mac', 'iphone', 'ipad'], ['ipad', 'mac', 'iphone'],
  ['ipad', 'iphone', 'mac'], ['iphone', 'mac', 'ipad'], ['iphone', 'ipad', 'mac'],
];

for (const order of PERMUTATIONS) {
  test(`three devices, three changes to the same chapter, synced ${order.join(' → ')}: all three end up on all three`, async () => {
    const d = await inSync(['mac', 'ipad', 'iphone']);
    // Mac: rearranges the Main line and annotates a sideline.
    d.mac = act(d.mac, A.moveVariation('v3', -1), A.moveVariation('v3', -1), A.comment('w1', 1, 'Mac note', 'c2'));
    // iPad: adds a line to the Main line and renames a chapter.
    d.ipad = act(d.ipad, A.addVariation('D'), A.renameChapter('c2', 'Sidelines (iPad)'));
    // iPhone: deletes a line from the Main line and moves an opening up.
    d.iphone = act(d.iphone, A.deleteVariation('v2'), A.moveOpening('o3', -1));
    for (let round = 0; round < 2; round += 1) {
      for (const dev of order) d[dev] = await sync(dev, d[dev]);
    }
    for (const dev of order) {
      assert.deepEqual(variations(d[dev]), ['C', 'A', 'D'], `${dev}: Mac's order, iPad's line, iPhone's deletion`);
      assert.equal(chapter(d[dev], 'c2').name, 'Sidelines (iPad)', `${dev}: iPad's rename`);
      assert.equal(variation(d[dev], 'w1', 'c2').comments[1], 'Mac note', `${dev}: Mac's comment`);
      assert.deepEqual(openings(d[dev]), ['Jobava London', "King's Indian", 'Caro-Kann'], `${dev}: iPhone's opening order`);
    }
  });
}

// ---------------------------------------------------------------------------
// 5. Offline, and in flight
// ---------------------------------------------------------------------------

test('the iPad is offline while the Mac edits and rearranges; the iPad edits too; back online, everything lands on both', async () => {
  const d = await inSync();
  setOffline(true);
  const ipadOffline = act(d.ipad, A.addVariation('D'), A.moveChapter('c2', -1));
  const attempt = await asDevice('ipad', () => syncNow(ipadOffline));
  setOffline(false);
  assert.equal(attempt.offline, true);
  assert.equal(attempt.state, ipadOffline, 'offline, the iPad\'s work is left exactly as it was');

  d.mac = await sync('mac', act(d.mac,
    A.renameVariation('v1', 'A — 3...Nf6'), A.moveVariation('v3', -1), A.moveVariation('v3', -1), A.deleteChapter('c3')));
  d.ipad = await sync('ipad', attempt.state);
  d.mac = await sync('mac', d.mac);
  for (const [who, st] of [['iPad', d.ipad], ['Mac', d.mac]]) {
    assert.deepEqual(variations(st), ['C', 'A — 3...Nf6', 'B', 'D'], `${who}: Mac's rename and order, iPad's line`);
    assert.deepEqual(chapters(st), ['Sidelines', 'Main line'], `${who}: iPad's chapter move, Mac's deletion`);
  }
});

test('in flight: a line added on the iPad while a sync bringing the Mac\'s reorder runs — both kept, and the next sync doesn\'t undo the reorder', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.moveVariation('v3', -1), A.moveVariation('v3', -1)));
  // useCloud.js run(): the sync starts from `started`; the person keeps working.
  const started = d.ipad;
  await pause(2);
  firestoreOrder();
  const result = await asDevice('ipad', () => syncNow(started));
  const now = act(started, A.addVariation('D'));
  d.ipad = foldInFlight(started, now, result.state);
  assert.deepEqual(variations(d.ipad), ['C', 'A', 'B', 'D'], 'on screen right after the sync');
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.deepEqual(variations(d.ipad), ['C', 'A', 'B', 'D'], 'the iPad');
  assert.deepEqual(variations(d.mac), ['C', 'A', 'B', 'D'], 'the Mac');
});

test('in flight: a reorder on the iPad while a sync bringing the Mac\'s new line runs — both kept', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.addVariation('D')));
  const started = d.ipad;
  await pause(2);
  firestoreOrder();
  const result = await asDevice('ipad', () => syncNow(started));
  const now = act(started, A.moveVariation('v3', -1), A.moveVariation('v3', -1));
  d.ipad = foldInFlight(started, now, result.state);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.deepEqual(variations(d.ipad), ['C', 'A', 'B', 'D'], 'the iPad');
  assert.deepEqual(variations(d.mac), ['C', 'A', 'B', 'D'], 'the Mac');
});

// ---------------------------------------------------------------------------
// 6. The careful path, where it really happens
//
// Besides "first sync after an update", a state older than its account's
// baseline is what an iPad or iPhone relaunches with whenever iOS discards
// the app after a sync finished but before the 400 ms debounced save of the
// new syncGen ran (store.jsx) — and what a second window on the Mac holds
// after the first window syncs. Neither may undo anything.
// ---------------------------------------------------------------------------

async function relaunchedIpad(change, see) {
  const d = await inSync();
  const savedBeforeSync = d.ipad; // what the iPad's storage still holds
  d.mac = await sync('mac', change(d.mac));
  d.ipad = await sync('ipad', d.ipad);
  see(d.ipad, 'the iPad receives it');
  // iOS discards the app before the new stamp is saved; it relaunches from
  // the older state and syncs.
  d.ipad = await sync('ipad', savedBeforeSync);
  see(d.ipad, 'the relaunched iPad');
  d.mac = await sync('mac', d.mac);
  see(d.mac, 'the Mac, after the relaunched iPad synced');
}

test('an iPad relaunched from a state saved before its last sync doesn\'t undo the Mac\'s reorder', async () => {
  await relaunchedIpad(
    (st) => act(st, A.moveVariation('v3', -1), A.moveVariation('v3', -1)),
    (st, who) => assert.deepEqual(variations(st), ['C', 'A', 'B'], who),
  );
});

test('an iPad relaunched from a state saved before its last sync doesn\'t undo the Mac\'s rename', async () => {
  await relaunchedIpad(
    (st) => act(st, A.renameVariation('v1', 'A — 3...Nf6')),
    (st, who) => assert.equal(variation(st, 'v1').name, 'A — 3...Nf6', who),
  );
});

test('an iPad relaunched from a state saved before its last sync doesn\'t bring back a variation the Mac deleted', async () => {
  await relaunchedIpad(
    (st) => act(st, A.deleteVariation('v2')),
    (st, who) => assert.deepEqual(variations(st), ['A', 'C'], who),
  );
});

test('an iPad relaunched from a state saved before its last sync doesn\'t bring back a comment the Mac cleared', async () => {
  await relaunchedIpad(
    (st) => act(st, A.comment('v1', 2, '')),
    (st, who) => assert.deepEqual(variation(st, 'v1').comments ?? {}, {}, who),
  );
});

test('careful path: the iPad\'s first sync after an update, with a line of its own added, keeps the Mac\'s reorder AND its own line', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.moveVariation('v3', -1), A.moveVariation('v3', -1)));
  d.ipad = await sync('ipad', afterUpdate(act(d.ipad, A.addVariation('D'))));
  d.mac = await sync('mac', d.mac);
  assert.deepEqual(variations(d.ipad), ['C', 'A', 'B', 'D'], 'the iPad');
  assert.deepEqual(variations(d.mac), ['C', 'A', 'B', 'D'], 'the Mac');
});

// `afterUpdate` models coming from bb384a3 (an unkeyed sync record AND an
// unkeyed baseline). Builds before it — everything up to 981500f, e.g. the
// Sep 25 builds — kept the sync record but no baseline at all, so their first
// sync after the update has no ancestor and takes the two-way path, with only
// the record's id lists to go on for deletions.
async function fromBuildWithoutBaseline(device, state) {
  await downgradeStorage(device);
  await asDevice(device, () => idbSet('repertoire-lab-sync-base-v1', null));
  const { syncGen, ...unstamped } = state;
  void syncGen;
  return unstamped;
}

test('first sync after updating from a build that kept no baseline: the Mac\'s reorder, rename, deletions and cleared comment all show on the iPad and stay on the Mac', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac,
    A.moveVariation('v3', -1), A.moveVariation('v3', -1), A.renameVariation('v1', 'A — 3...Nf6'),
    A.deleteVariation('v2'), A.comment('v1', 2, ''), A.deleteChapter('c3')));
  d.ipad = await sync('ipad', await fromBuildWithoutBaseline('ipad', d.ipad));
  d.mac = await sync('mac', d.mac);
  for (const [who, st] of [['the iPad', d.ipad], ['the Mac', d.mac]]) {
    assert.deepEqual(chapters(st), ['Main line', 'Sidelines'], `${who}: chapter deletion`);
    assert.equal(variation(st, 'v1').name, 'A — 3...Nf6', `${who}: rename`);
    assert.deepEqual(variations(st), ['C', 'A — 3...Nf6'], `${who}: order and variation deletion`);
    assert.deepEqual(variation(st, 'v1').comments ?? {}, {}, `${who}: cleared comment`);
  }
});

test('two windows open on the Mac: a sync in one window that changed nothing doesn\'t make a rename in the other window vanish', async () => {
  const d = await inSync();
  let windowA = d.mac;
  let windowB = d.mac;
  windowA = await sync('mac', windowA); // window A comes to the front: "up to date"
  windowB = await sync('mac', act(windowB, A.renameVariation('v1', 'A — 3...Nf6')));
  assert.equal(variation(windowB, 'v1').name, 'A — 3...Nf6', 'window B keeps the rename just typed');
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(variation(d.ipad, 'v1').name, 'A — 3...Nf6', 'and it reaches the iPad');
  void windowA;
});

test('two windows open on the Mac: a sync in one window that changed nothing doesn\'t make a reorder in the other window vanish', async () => {
  const d = await inSync();
  let windowA = d.mac;
  let windowB = d.mac;
  windowA = await sync('mac', windowA);
  windowB = await sync('mac', act(windowB, A.moveVariation('v3', -1), A.moveVariation('v3', -1)));
  assert.deepEqual(variations(windowB), ['C', 'A', 'B'], 'window B keeps the order just set');
  d.ipad = await sync('ipad', d.ipad);
  assert.deepEqual(variations(d.ipad), ['C', 'A', 'B'], 'and it reaches the iPad');
  void windowA;
});

// ---------------------------------------------------------------------------
// 7. Order the cloud itself has to keep
// ---------------------------------------------------------------------------

test('openings stay in the order you put them, even though Firestore hands them back sorted by id', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.moveOpening('o3', -1)));
  d.mac = await sync('mac', d.mac); // nothing changed here
  assert.deepEqual(openings(d.mac), ['Jobava London', "King's Indian", 'Caro-Kann'], 'a no-change sync keeps the order');
  const iphone = await sync('iphone', freshInstall());
  assert.deepEqual(openings(iphone), ['Jobava London', "King's Indian", 'Caro-Kann'], 'and a new device gets it');
});

test('a lists document written by an app from before opening order was stored doesn\'t shuffle anyone\'s openings', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.moveOpening('o3', -1)));
  d.ipad = await sync('ipad', d.ipad);
  assert.deepEqual(openings(d.ipad), ['Jobava London', "King's Indian", 'Caro-Kann'], 'setup: the iPad has the order');
  // The iPhone, still on the previous version (a stale service worker),
  // edits a playlist: its lists document is written whole, without `order`.
  const path = 'users/student1/singletons/lists';
  const { order, ...previousVersion } = server.get(path);
  void order;
  server.set(path, previousVersion);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.deepEqual(openings(d.ipad), ['Jobava London', "King's Indian", 'Caro-Kann'], 'the iPad');
  assert.deepEqual(openings(d.mac), ['Jobava London', "King's Indian", 'Caro-Kann'], 'the Mac');
});

test('an old app strips the order before the iPad has seen it: the Mac\'s next sync puts it back, so the iPad and a new iPhone get it', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.moveOpening('o3', -1)));
  // An iPhone on a build from before the order was kept rewrites the lists
  // document whole — before the iPad has synced at all.
  const path = 'users/student1/singletons/lists';
  const { order, ...previousVersion } = server.get(path);
  void order;
  server.set(path, previousVersion);
  d.mac = await sync('mac', d.mac);
  assert.ok(server.get(path).order, 'the Mac wrote the order back');
  d.ipad = await sync('ipad', d.ipad);
  assert.deepEqual(openings(d.ipad), ['Jobava London', "King's Indian", 'Caro-Kann'], 'the iPad');
  const iphone = await sync('iphone', freshInstall());
  assert.deepEqual(openings(iphone), ['Jobava London', "King's Indian", 'Caro-Kann'], 'a new iPhone');
});

test('two-way first sync: an iPad that already holds an older copy of the library (restored from a backup) signs in — the account\'s newer order wins, its own new line is kept, the Mac\'s reorder is not undone', async () => {
  const d = await inSync(['mac']);
  d.mac = await sync('mac', act(d.mac, A.moveVariation('v3', -1), A.moveVariation('v3', -1), A.moveChapter('c2', -1)));
  // The iPad's copy: the library as it was when the backup was made, plus a
  // line added on the iPad since.
  const restored = act({ ...library(), settings: { ...DEFAULT_SETTINGS } }, A.addVariation('D'));
  d.ipad = await sync('ipad', restored);
  d.mac = await sync('mac', d.mac);
  for (const [who, st] of [['iPad', d.ipad], ['Mac', d.mac]]) {
    assert.deepEqual(variations(st), ['C', 'A', 'B', 'D'], `${who}: variations`);
    assert.deepEqual(chapters(st), ['Sidelines', 'Main line', 'Early c5'], `${who}: chapters`);
  }
});

// ---------------------------------------------------------------------------
// 8. Settings (theme etc.) — one object, with its own rules (sync.js
// mergeSettings): changed here since the last sync → this device wins; never
// synced here → this device keeps its own; untouched factory settings → take
// the account's; otherwise take the cloud's only if it's newer.
// ---------------------------------------------------------------------------

test('settings: Mac picks a theme; the iPad gets it, and the Mac keeps it', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.settings({ skin: 'hustler' })));
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.equal(d.ipad.settings.skin, 'hustler', 'the iPad');
  assert.equal(d.mac.settings.skin, 'hustler', 'the Mac');
});

test('settings: iPad picks a theme; the Mac gets it, and the iPad keeps it', async () => {
  const d = await inSync();
  d.ipad = await sync('ipad', act(d.ipad, A.settings({ skin: 'hustler' })));
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(d.mac.settings.skin, 'hustler', 'the Mac');
  assert.equal(d.ipad.settings.skin, 'hustler', 'the iPad');
});

test('settings: Mac picks a theme; the iPad\'s first sync after an update (no syncGen) gets it', async () => {
  const d = await inSync();
  d.mac = await sync('mac', act(d.mac, A.settings({ skin: 'hustler' })));
  d.ipad = await sync('ipad', afterUpdate(d.ipad));
  d.mac = await sync('mac', d.mac);
  assert.equal(d.ipad.settings.skin, 'hustler', 'the iPad');
  assert.equal(d.mac.settings.skin, 'hustler', 'the Mac');
});

test('settings: the same setting changed on both — they converge on the one synced last', async () => {
  const d = await inSync();
  d.mac = act(d.mac, A.settings({ skin: 'hustler' }));
  d.ipad = act(d.ipad, A.settings({ skin: 'custom' }));
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  assert.equal(d.ipad.settings.skin, 'custom', 'the iPad synced last');
  assert.equal(d.mac.settings.skin, 'custom', 'and the Mac follows');
});

test('settings: different settings changed on each device at the same time — both changes reach both', async () => {
  const d = await inSync();
  d.mac = act(d.mac, A.settings({ skin: 'hustler' }));
  d.ipad = act(d.ipad, A.settings({ volume: 0.4 }));
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  d.mac = await sync('mac', d.mac);
  d.ipad = await sync('ipad', d.ipad);
  for (const [who, st] of [['Mac', d.mac], ['iPad', d.ipad]]) {
    assert.equal(st.settings.skin, 'hustler', `${who}: the Mac's theme`);
    assert.equal(st.settings.volume, 0.4, `${who}: the iPad's volume`);
  }
});

test('settings: switching the theme back to the default on the Mac sticks, and reaches the iPad', async () => {
  const d = await inSync();
  // The account wears 'bauhaus'; every other setting is at its default.
  d.mac = await sync('mac', act(d.mac, A.settings({ skin: DEFAULT_SETTINGS.skin })));
  assert.equal(d.mac.settings.skin, DEFAULT_SETTINGS.skin, 'the Mac keeps what was just picked');
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(d.ipad.settings.skin, DEFAULT_SETTINGS.skin, 'the iPad gets it');
});

// The whole-object rules (mergeSettings) still decide on the careful path —
// here, the Mac's own first sync after an update — so they're checked there.
test('settings: a theme picked on the Mac just before its first sync after an update sticks, and reaches the iPad', async () => {
  const d = await inSync();
  d.mac = await sync('mac', afterUpdate(act(d.mac, A.settings({ skin: 'hustler' }))));
  assert.equal(d.mac.settings.skin, 'hustler', 'the Mac keeps what was just picked');
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(d.ipad.settings.skin, 'hustler', 'the iPad gets it');
});

test('settings: switching back to the default theme on the Mac just before its first sync after an update sticks, and reaches the iPad', async () => {
  const d = await inSync();
  d.mac = await sync('mac', afterUpdate(act(d.mac, A.settings({ skin: DEFAULT_SETTINGS.skin }))));
  assert.equal(d.mac.settings.skin, DEFAULT_SETTINGS.skin, 'the Mac keeps what was just picked');
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(d.ipad.settings.skin, DEFAULT_SETTINGS.skin, 'the iPad gets it');
});

test('settings: a theme picked on the Mac while the iPad is mid-sync still reaches the iPad', async () => {
  const d = await inSync();
  // The iPad has something to push (so its sync commits), and the Mac's theme
  // lands after the iPad has read the cloud but before it has finished.
  let atCommit;
  const ipadHasRead = new Promise((r) => { atCommit = r; });
  let release;
  const macHasSynced = new Promise((r) => { release = r; });
  hold('ipad', async () => { atCommit(); await macHasSynced; });
  await pause(2);
  firestoreOrder();
  const ipadSync = asDevice('ipad', () => syncNow(act(d.ipad, A.renameVariation('v2', 'B — 3...Bf5'))));
  await ipadHasRead;
  d.mac = await sync('mac', act(d.mac, A.settings({ skin: 'hustler' })));
  release();
  d.ipad = (await ipadSync).state;
  // The Mac's write woke the iPad (the pulse); it syncs again.
  d.ipad = await sync('ipad', d.ipad);
  d.ipad = await sync('ipad', d.ipad);
  assert.equal(d.ipad.settings.skin, 'hustler', 'the Mac\'s theme reached the iPad');
  d.mac = await sync('mac', d.mac);
  assert.equal(variation(d.mac, 'v2').name, 'B — 3...Bf5', 'and the iPad\'s rename reached the Mac');
});

test('settings (documented): a brand-new install takes the account\'s look', async () => {
  const d = await inSync(['mac']);
  const iphone = await sync('iphone', freshInstall());
  assert.equal(iphone.settings.skin, 'bauhaus');
  assert.equal(d.mac.settings.skin, 'bauhaus');
});

test('settings (documented): a device that already has its own look keeps it when it first signs in', async () => {
  await inSync(['mac']);
  const ipadWithLook = { ...freshInstall(), settings: { ...DEFAULT_SETTINGS, skin: 'custom', volume: 0.5 } };
  const ipad = await sync('ipad', ipadWithLook);
  assert.equal(ipad.settings.skin, 'custom');
});

test('settings: an iPad signing in for the first time with its own look doesn\'t repaint the Mac (signing in is not a change)', async () => {
  let d = await inSync(['mac']);
  const ipadWithLook = { ...freshInstall(), settings: { ...DEFAULT_SETTINGS, skin: 'custom', volume: 0.5 } };
  const ipad = await sync('ipad', ipadWithLook);
  d = { ...d, ipad };
  d.mac = await sync('mac', d.mac);
  assert.equal(d.mac.settings.skin, 'bauhaus', 'the Mac keeps the look it had');
  assert.equal(d.ipad.settings.skin, 'custom', 'the iPad keeps its own');
});
