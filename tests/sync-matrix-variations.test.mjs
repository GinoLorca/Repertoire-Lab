// Variations inside chapters, across the Mac, the iPad and the iPhone.
//
// The report this answers: "when variations are added on Mac [they should]
// transfer over to the iPad/iPhone version of the app. And vice versa" and
// "I've rearranged the order of variations on my Mac but the re-ordering
// didn't transfer over to my iPad."
//
// Every test here is a user story run through the REAL sync engine
// (src/lib/cloud/sync.js → merge3.js → shape.js) by simulated devices sharing
// one in-memory Firestore (tests/fakes/). Each change is applied the way the
// app applies it: through a faithful copy of the store.jsx reducer case that
// the app dispatches for it (cited next to each case below).
//
// The matrix runs every change four ways:
//   · Mac → iPad          both devices stamped (ordinary three-way merge)
//   · iPad → Mac          the reverse direction
//   · after an update, receiving: the iPad's first sync carries no syncGen
//   · after an update, sending:   the Mac's first sync carries no syncGen
// and in each one checks the receiver, the sender after it syncs again (the
// change must not be undone by what the receiver pushed back), the third
// device, and a brand-new device signing in (= what the account now holds).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncNow } from '../src/lib/cloud/sync.js';
import { foldInFlight } from '../src/lib/cloud/merge3.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';
import { schedule } from '../src/lib/srs.js';
import { asDevice, resetServer, hold } from './fakes/firebase.mjs';
import { resetDevices } from './fakes/idb.mjs';
import { markPreUpdate, isPreUpdate, downgradeStorage } from './fakes/legacy.mjs';

beforeEach(() => { resetServer(); resetDevices(); });

// ---------------------------------------------------------------------------
// The reducer, mirrored exactly from src/store.jsx (it's JSX; node can't
// import it). Same immutable updates, same id scheme.
// ---------------------------------------------------------------------------

// store.jsx:11
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// store.jsx:90-102
function mapOpening(state, openingId, fn) {
  return { ...state, openings: state.openings.map((o) => (o.id === openingId ? fn(o) : o)) };
}
function mapChapter(state, openingId, chapterId, fn) {
  return mapOpening(state, openingId, (o) => ({
    ...o,
    chapters: o.chapters.map((c) => (c.id === chapterId ? fn(c) : c)),
  }));
}

// store.jsx:106-117
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

function reduce(state, action) {
  switch (action.type) {
    // store.jsx:373-383
    case 'setMoveBadge':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => {
          if (v.id !== action.variationId) return v;
          const badges = { ...(v.badges ?? {}) };
          if (action.badge) badges[action.ply] = action.badge;
          else delete badges[action.ply];
          return { ...v, badges };
        }),
      }));
    // store.jsx:494-499
    case 'setVariationTimestamp':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (
          v.id === action.variationId ? { ...v, videoTimestamp: action.seconds } : v)),
      }));
    // store.jsx:512-516 — what ChapterView's "Move up" / "Move down" dispatch
    // (ChapterView.jsx:477-478, 601-608). The only reorder the app has.
    case 'moveVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: moveInArray(c.variations, action.variationId, action.dir),
      }));
    // store.jsx:574-588 — PGN import, Analysis "Save line to chapter",
    // ImportView, Library (ChapterView.jsx:722, AnalysisView.jsx:2027, …)
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
    // store.jsx:589-593
    case 'deleteVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.filter((v) => v.id !== action.variationId),
      }));
    // store.jsx:594-600 (ChapterView.jsx:47, bulk select → delete)
    case 'deleteVariations': {
      const gone = new Set(action.variationIds);
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.filter((v) => !gone.has(v.id)),
      }));
    }
    // store.jsx:601-605
    case 'renameVariation':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, name: action.name } : v)),
      }));
    // store.jsx:606-616
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
    // store.jsx:617-622 (PracticeView.jsx:701, srs from lib/srs.js schedule())
    case 'recordPractice':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) =>
          v.id === action.variationId ? { ...v, learned: true, srs: action.srs } : v),
      }));
    // store.jsx:992-996
    case 'setVariationTags':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, tags: action.tags } : v)),
      }));
    // store.jsx:997-1001
    case 'toggleStar':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, starred: !v.starred } : v)),
      }));
    default:
      throw new Error(`reducer case not mirrored in this test: ${action.type}`);
  }
}
const act = (state, ...actions) => actions.reduce(reduce, state);

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const O = 'op1';
const FANTASY = ['e4', 'c6', 'd4', 'd5', 'f3', 'dxe4', 'fxe4', 'e5'];
const ADVANCE = ['e4', 'c6', 'd4', 'd5', 'e5'];
const OLD_SRS = {
  level: 3, due: 1_700_600_000_000, interval: 259_200_000, reviews: 3, successes: 3, lapses: 0,
  lastReview: 1_700_000_000_000, lastResult: 'pass',
};
const V = (id, name, moves, extra = {}) => ({
  id, name, moves, comments: {}, badges: {}, learned: false, srs: null, ...extra,
});
const CH = (id, name, variations) => ({
  id, name, section: null, subsection: null, courseId: null, variations,
});

function macLibrary() {
  return {
    openings: [{
      id: O,
      name: 'Caro-Kann',
      color: 'black',
      ownerId: null,
      chapters: [
        CH('ch1', '4a) Caro-Kann: Fantasy Variation', [
          V('v1', 'Fantasy: 5.dxe5', [...FANTASY, 'dxe5', 'Qh4+'],
            { comments: { 4: 'The Fantasy: 3.f3' }, badges: { 7: 'good' } }),
          V('v2', 'Fantasy: 5.Nf3 with 7.Bxf7+', [...FANTASY, 'Nf3', 'Bg4', 'Bc4', 'Nd7', 'Bxf7+', 'Kxf7'],
            { starred: true, tags: ['sharp'] }),
          V('v3', 'Fantasy: 5.Nf3 with 7.c3', [...FANTASY, 'Nf3', 'Bg4', 'Bc4', 'Nd7', 'c3', 'Bd6']),
          V('v4', 'Fantasy: 5.Nf3 with 7.O-O', [...FANTASY, 'Nf3', 'Bg4', 'Bc4', 'Nd7', 'O-O', 'Ngf6'],
            { learned: true, srs: OLD_SRS }),
        ]),
        CH('ch2', '4b) Caro-Kann: Advance', [
          V('v5', 'Advance: 3...Bf5 4.Nf3', [...ADVANCE, 'Bf5', 'Nf3', 'e6']),
          V('v6', 'Advance: 3...c5', [...ADVANCE, 'c5', 'dxc5', 'e6']),
          V('v7', 'Advance: 3...Bf5 4.h4', [...ADVANCE, 'Bf5', 'h4', 'h5']),
        ]),
      ],
    }],
    players: [],
    labEntries: [],
    categories: [],
    playlists: [],
    savedPositions: [],
    analysisDraft: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}
// An iPad / iPhone signing in for the first time.
const freshInstall = () => ({ ...macLibrary(), openings: [] });

const chapter = (st, cid) => st.openings.find((o) => o.id === O)?.chapters.find((c) => c.id === cid);
const variation = (st, cid, vid) => chapter(st, cid)?.variations.find((v) => v.id === vid);
const byName = (st, cid, name) => chapter(st, cid)?.variations.find((v) => v.name === name);
const order = (st, cid) => (chapter(st, cid)?.variations ?? []).map((v) => v.id).join(' ');
const names = (st, cid) => (chapter(st, cid)?.variations ?? []).map((v) => v.name);
// "First sync after an update": the state carries no sync stamp.
const unstamped = (st) => markPreUpdate(st);
const eq = (actual, expected, what) => assert.deepEqual(
  actual, expected, `${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
);
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

const DEVICES = ['mac', 'ipad', 'iphone'];
const NAME = { mac: 'Mac', ipad: 'iPad', iphone: 'iPhone', fresh: 'a new device' };

// One sync on a device, carrying its previous result forward.
async function sync(d, dev, st = d[dev], options) {
  if (isPreUpdate(st)) await downgradeStorage(dev);
  d[dev] = (await asDevice(dev, () => syncNow(st, options))).state;
  return d[dev];
}
// What the account now holds, as a brand-new device signing in sees it.
const cloudView = async () => (await asDevice('fresh', () => syncNow(freshInstall()))).state;

// The Mac builds the library; the iPad and iPhone sign in and receive it;
// then everyone syncs once more, so every device holds a stamped state and a
// baseline — the ordinary day-to-day situation.
async function allInSync() {
  const d = {};
  await sync(d, 'mac', macLibrary());
  await sync(d, 'ipad', freshInstall());
  await sync(d, 'iphone', freshInstall());
  for (const dev of DEVICES) await sync(d, dev); // eslint-disable-line no-await-in-loop
  for (const dev of DEVICES) {
    eq(order(d[dev], 'ch1'), 'v1 v2 v3 v4', `setup: ${dev} ch1`);
    assert.ok(d[dev].syncGen, `setup: ${dev} carries a sync stamp`);
  }
  return d;
}

// Every device (and the account) must satisfy `check`; failures are collected
// so one run says exactly which devices are wrong.
async function expectEverywhere(d, check, label = '') {
  const problems = [];
  const see = (who, st) => {
    try { check(st); } catch (e) { problems.push(`${label}${who}: ${e.message}`); }
  };
  for (const dev of DEVICES) see(NAME[dev], d[dev]);
  see(NAME.fresh, await cloudView());
  if (problems.length) assert.fail(problems.join('\n'));
}

// Makes two devices' next syncs overlap exactly: both read the cloud, then
// `first` commits, then `second` tries to commit what it read before.
function overlapNextSyncs(first, second) {
  let secondRead;
  let firstWrote;
  const secondHasRead = new Promise((r) => { secondRead = r; });
  const firstHasWritten = new Promise((r) => { firstWrote = r; });
  hold(first, async () => { await secondHasRead; setTimeout(firstWrote, 5); });
  hold(second, async () => { secondRead(); await firstHasWritten; });
}

// ---------------------------------------------------------------------------
// The matrix: one change, synced four ways
// ---------------------------------------------------------------------------

const inCh = (chapterId, type, extra) => ({ type, openingId: O, chapterId, ...extra });
const BASE_CH1 = ['Fantasy: 5.dxe5', 'Fantasy: 5.Nf3 with 7.Bxf7+', 'Fantasy: 5.Nf3 with 7.c3', 'Fantasy: 5.Nf3 with 7.O-O'];
const BASE_CH2 = ['Advance: 3...Bf5 4.Nf3', 'Advance: 3...c5', 'Advance: 3...Bf5 4.h4'];

const CHANGES = [
  {
    does: 'saves a new line into the chapter',
    sees: 'the new line, at the end of the chapter, with its moves, comment and badge',
    apply: (st) => act(st, inCh('ch1', 'addVariations', {
      variations: [{
        name: 'Fantasy: 5.Be3', moves: [...FANTASY, 'Be3', 'exd4'], comments: { 8: 'Keeps the tension' }, badges: { 8: 'great' },
      }],
    })),
    check: (st) => {
      eq(names(st, 'ch1'), [...BASE_CH1, 'Fantasy: 5.Be3'], 'ch1 lines');
      const v = byName(st, 'ch1', 'Fantasy: 5.Be3');
      eq(v.moves, [...FANTASY, 'Be3', 'exd4'], 'new line moves');
      eq(v.comments[8], 'Keeps the tension', 'new line comment');
      eq(v.badges[8], 'great', 'new line badge');
    },
  },
  {
    does: 'imports two lines from a PGN into the second chapter',
    sees: 'both lines, in import order, at the end of that chapter',
    apply: (st) => act(st, inCh('ch2', 'addVariations', {
      variations: [
        { name: 'Advance: 3...c5 4.c3', moves: [...ADVANCE, 'c5', 'c3'] },
        { name: 'Advance: 3...c5 4.Nf3', moves: [...ADVANCE, 'c5', 'Nf3'] },
      ],
    })),
    check: (st) => eq(names(st, 'ch2'), [...BASE_CH2, 'Advance: 3...c5 4.c3', 'Advance: 3...c5 4.Nf3'], 'ch2 lines'),
  },
  {
    does: 'renames a line',
    sees: 'the new name',
    apply: (st) => act(st, inCh('ch1', 'renameVariation', { variationId: 'v3', name: 'Main line: 7.c3 Bd6' })),
    check: (st) => eq(variation(st, 'ch1', 'v3')?.name, 'Main line: 7.c3 Bd6', 'v3 name'),
  },
  {
    // No reducer case edits an existing variation's moves today (grep: nothing
    // in store.jsx writes v.moves outside addVariations/copy). This holds the
    // engine to it for when one exists, with the same immutable shape.
    does: 'edits the moves of a line (engine-level: no reducer case exists yet)',
    sees: 'the new moves',
    apply: (st) => mapChapter(st, O, 'ch1', (c) => ({
      ...c,
      variations: c.variations.map((v) => (v.id === 'v4'
        ? { ...v, moves: [...FANTASY, 'Nf3', 'Bg4', 'Bc4', 'Nd7', 'O-O', 'Ngf6', 'Re1'] } : v)),
    })),
    check: (st) => eq(variation(st, 'ch1', 'v4')?.moves, [...FANTASY, 'Nf3', 'Bg4', 'Bc4', 'Nd7', 'O-O', 'Ngf6', 'Re1'], 'v4 moves'),
  },
  {
    does: 'adds a comment to a move',
    sees: 'the comment',
    apply: (st) => act(st, inCh('ch1', 'setMoveComment', { variationId: 'v3', moveIndex: 12, text: 'Critical: c3 supports d4' })),
    check: (st) => eq(variation(st, 'ch1', 'v3')?.comments?.[12], 'Critical: c3 supports d4', 'v3 comment on move 12'),
  },
  {
    does: 'edits an existing comment',
    sees: 'the edited comment',
    apply: (st) => act(st, inCh('ch1', 'setMoveComment', { variationId: 'v1', moveIndex: 4, text: 'The Fantasy: 3.f3!?' })),
    check: (st) => eq(variation(st, 'ch1', 'v1')?.comments?.[4], 'The Fantasy: 3.f3!?', 'v1 comment on move 4'),
  },
  {
    does: 'clears a comment',
    sees: 'the comment gone',
    apply: (st) => act(st, inCh('ch1', 'setMoveComment', { variationId: 'v1', moveIndex: 4, text: '' })),
    check: (st) => eq(variation(st, 'ch1', 'v1')?.comments?.[4], undefined, 'v1 comment on move 4'),
  },
  {
    does: 'badges a move',
    sees: 'the badge',
    apply: (st) => act(st, inCh('ch1', 'setMoveBadge', { variationId: 'v3', ply: 12, badge: 'brilliant' })),
    check: (st) => eq(variation(st, 'ch1', 'v3')?.badges?.[12], 'brilliant', 'v3 badge on ply 12'),
  },
  {
    does: 'removes a badge',
    sees: 'the badge gone',
    apply: (st) => act(st, inCh('ch1', 'setMoveBadge', { variationId: 'v1', ply: 7, badge: null })),
    check: (st) => eq(variation(st, 'ch1', 'v1')?.badges?.[7], undefined, 'v1 badge on ply 7'),
  },
  {
    does: 'stars a line',
    sees: 'it starred',
    apply: (st) => act(st, inCh('ch1', 'toggleStar', { variationId: 'v3' })),
    check: (st) => eq(Boolean(variation(st, 'ch1', 'v3')?.starred), true, 'v3 starred'),
  },
  {
    does: 'unstars a line',
    sees: 'it unstarred',
    apply: (st) => act(st, inCh('ch1', 'toggleStar', { variationId: 'v2' })),
    check: (st) => eq(Boolean(variation(st, 'ch1', 'v2')?.starred), false, 'v2 starred'),
  },
  {
    does: 'tags a line',
    sees: 'the tag',
    apply: (st) => act(st, inCh('ch1', 'setVariationTags', { variationId: 'v3', tags: ['bishop attacking plan'] })),
    check: (st) => eq(variation(st, 'ch1', 'v3')?.tags, ['bishop attacking plan'], 'v3 tags'),
  },
  {
    does: 'changes a line\'s tags',
    sees: 'the new tags',
    apply: (st) => act(st, inCh('ch1', 'setVariationTags', { variationId: 'v2', tags: ['sharp', 'gambit'] })),
    check: (st) => eq(variation(st, 'ch1', 'v2')?.tags, ['sharp', 'gambit'], 'v2 tags'),
  },
  {
    does: 'sets a line\'s video timestamp',
    sees: 'the timestamp',
    apply: (st) => act(st, inCh('ch1', 'setVariationTimestamp', { variationId: 'v1', seconds: 95 })),
    check: (st) => eq(variation(st, 'ch1', 'v1')?.videoTimestamp, 95, 'v1 videoTimestamp'),
  },
  {
    does: 'practises a new line cleanly',
    sees: 'it learned, with that review scheduled',
    apply: (st) => act(st, inCh('ch1', 'recordPractice', { variationId: 'v3', srs: schedule(variation(st, 'ch1', 'v3').srs, true) })),
    check: (st) => {
      const v = variation(st, 'ch1', 'v3');
      eq(v?.learned, true, 'v3 learned');
      eq([v?.srs?.level, v?.srs?.reviews, v?.srs?.lastResult], [1, 1, 'pass'], 'v3 srs level/reviews/result');
    },
  },
  {
    does: 'lapses on a learned line (its level drops)',
    sees: 'the lapse — the newer review, even though its level is lower',
    apply: (st) => act(st, inCh('ch1', 'recordPractice', { variationId: 'v4', srs: schedule(variation(st, 'ch1', 'v4').srs, false) })),
    check: (st) => {
      const v = variation(st, 'ch1', 'v4');
      eq(v?.learned, true, 'v4 learned');
      eq([v?.srs?.level, v?.srs?.lapses, v?.srs?.reviews], [1, 1, 4], 'v4 srs level/lapses/reviews');
    },
  },
  {
    does: 'deletes a line',
    sees: 'it gone, and the rest untouched',
    apply: (st) => act(st, inCh('ch1', 'deleteVariation', { variationId: 'v2' })),
    check: (st) => eq(order(st, 'ch1'), 'v1 v3 v4', 'ch1 order'),
  },
  {
    does: 'bulk-deletes two lines',
    sees: 'both gone',
    apply: (st) => act(st, inCh('ch1', 'deleteVariations', { variationIds: ['v1', 'v3'] })),
    check: (st) => eq(order(st, 'ch1'), 'v2 v4', 'ch1 order'),
  },
  {
    does: 'moves a line up one place',
    sees: 'the new order',
    apply: (st) => act(st, inCh('ch1', 'moveVariation', { variationId: 'v3', dir: -1 })),
    check: (st) => eq(order(st, 'ch1'), 'v1 v3 v2 v4', 'ch1 order'),
  },
  {
    does: 'moves the first line down to the bottom (three "Move down"s)',
    sees: 'the new order',
    apply: (st) => act(st, ...[1, 2, 3].map(() => inCh('ch1', 'moveVariation', { variationId: 'v1', dir: 1 }))),
    check: (st) => eq(order(st, 'ch1'), 'v2 v3 v4 v1', 'ch1 order'),
  },
  {
    does: 'reorders the second chapter',
    sees: 'the new order there, and the first chapter unchanged',
    apply: (st) => act(st, inCh('ch2', 'moveVariation', { variationId: 'v7', dir: -1 })),
    check: (st) => {
      eq(order(st, 'ch2'), 'v5 v7 v6', 'ch2 order');
      eq(order(st, 'ch1'), 'v1 v2 v3 v4', 'ch1 order');
    },
  },
  {
    // The app has no "move to chapter" action; the way to do it is Analyse →
    // Save line to chapter (addVariations into the other chapter) and then
    // delete the original (deleteVariation).
    does: 'moves a line to another chapter (save it there, delete the original)',
    sees: 'it in the new chapter and gone from the old one',
    apply: (st) => {
      const v = variation(st, 'ch1', 'v4');
      return act(
        st,
        inCh('ch2', 'addVariations', { variations: [{ name: v.name, moves: v.moves, comments: v.comments, badges: v.badges }] }),
        inCh('ch1', 'deleteVariation', { variationId: 'v4' }),
      );
    },
    check: (st) => {
      eq(order(st, 'ch1'), 'v1 v2 v3', 'ch1 order');
      eq(names(st, 'ch2'), [...BASE_CH2, 'Fantasy: 5.Nf3 with 7.O-O'], 'ch2 lines');
    },
  },
];

const VARIANTS = [
  { label: 'Mac → iPad', from: 'mac', to: 'ipad' },
  { label: 'iPad → Mac', from: 'ipad', to: 'mac' },
  { label: 'after an update, iPad receiving (unstamped)', from: 'mac', to: 'ipad', unstamp: 'to' },
  { label: 'after an update, Mac sending (unstamped)', from: 'mac', to: 'ipad', unstamp: 'from' },
];

async function story(change, { from, to, unstamp }) {
  const d = await allInSync();
  let sent = change.apply(d[from]);
  if (unstamp === 'from') sent = unstamped(sent);
  await sync(d, from, sent);
  await sync(d, to, unstamp === 'to' ? unstamped(d[to]) : d[to]);

  const problems = [];
  const see = (who, st) => {
    try { change.check(st); } catch (e) { problems.push(`${who}: ${e.message}`); }
  };
  see(`${NAME[to]} after its sync`, d[to]);
  // It sticks: whatever the receiver pushed back must not undo it here.
  await sync(d, from);
  see(`${NAME[from]} after syncing again`, d[from]);
  const third = DEVICES.find((x) => x !== from && x !== to);
  await sync(d, third);
  see(NAME[third], d[third]);
  see(NAME.fresh, await cloudView());
  if (problems.length) {
    // Diagnostic only: is it late, or lost?
    await sync(d, to);
    let later = 'still does not have it';
    try { change.check(d[to]); later = 'then has it (one sync late)'; } catch { /* lost */ }
    assert.fail(`${problems.join('\n')}\n→ on its next sync, the ${NAME[to]} ${later}`);
  }
}

for (const change of CHANGES) {
  for (const v of VARIANTS) {
    const sender = NAME[v.from];
    const receiver = NAME[v.to];
    test(`[${v.label}] ${sender} ${change.does}; both sync; ${receiver} (and iPhone) see ${change.sees}`,
      () => story(change, v));
  }
}

// ---------------------------------------------------------------------------
// Two devices, different variations of the same chapter, between syncs
// ---------------------------------------------------------------------------

function macWork(st) {
  return act(
    st,
    inCh('ch1', 'renameVariation', { variationId: 'v1', name: 'Mac: 5.dxe5 Qh4+' }),
    inCh('ch1', 'recordPractice', { variationId: 'v1', srs: schedule(null, true) }),
    inCh('ch1', 'setMoveComment', { variationId: 'v3', moveIndex: 13, text: 'Mac note' }),
  );
}
function ipadWork(st) {
  return act(
    st,
    inCh('ch1', 'setMoveComment', { variationId: 'v2', moveIndex: 12, text: 'iPad note' }),
    inCh('ch1', 'toggleStar', { variationId: 'v4' }),
    inCh('ch1', 'setVariationTags', { variationId: 'v4', tags: ['iPad tag'] }),
    inCh('ch1', 'setMoveBadge', { variationId: 'v2', ply: 10, badge: 'blunder' }),
  );
}
function bothWorkLanded(st) {
  eq(variation(st, 'ch1', 'v1')?.name, 'Mac: 5.dxe5 Qh4+', 'v1 name (Mac)');
  eq(variation(st, 'ch1', 'v1')?.learned, true, 'v1 learned (Mac)');
  eq(variation(st, 'ch1', 'v3')?.comments?.[13], 'Mac note', 'v3 comment (Mac)');
  eq(variation(st, 'ch1', 'v2')?.comments?.[12], 'iPad note', 'v2 comment (iPad)');
  eq(variation(st, 'ch1', 'v2')?.badges?.[10], 'blunder', 'v2 badge (iPad)');
  eq(Boolean(variation(st, 'ch1', 'v4')?.starred), true, 'v4 starred (iPad)');
  eq(variation(st, 'ch1', 'v4')?.tags, ['iPad tag'], 'v4 tags (iPad)');
  eq(order(st, 'ch1'), 'v1 v2 v3 v4', 'ch1 order');
}

test('Mac edits lines 1 and 3 while the iPad edits lines 2 and 4 of the same chapter; Mac syncs first; all of it lands everywhere', async () => {
  const d = await allInSync();
  d.mac = macWork(d.mac);
  d.ipad = ipadWork(d.ipad);
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, bothWorkLanded);
});

test('Mac edits lines 1 and 3 while the iPad edits lines 2 and 4 of the same chapter; iPad syncs first; all of it lands everywhere', async () => {
  const d = await allInSync();
  d.mac = macWork(d.mac);
  d.ipad = ipadWork(d.ipad);
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, bothWorkLanded);
});

test('Mac and iPad edit different lines of the same chapter and sync at the very same moment; all of it lands everywhere', async () => {
  const d = await allInSync();
  const mac = macWork(d.mac);
  const ipad = ipadWork(d.ipad);
  overlapNextSyncs('mac', 'ipad');
  const [m, i] = await Promise.all([
    asDevice('mac', () => syncNow(mac)),
    asDevice('ipad', () => syncNow(ipad)),
  ]);
  d.mac = m.state;
  d.ipad = i.state;
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, bothWorkLanded);
});

test('Mac saves a new line into a chapter while the iPad deletes a different line of it; both land everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'addVariations', { variations: [{ name: 'Mac new line', moves: [...FANTASY, 'Be3'] }] }));
  d.ipad = act(d.ipad, inCh('ch1', 'deleteVariation', { variationId: 'v2' }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(names(st, 'ch1'),
    ['Fantasy: 5.dxe5', 'Fantasy: 5.Nf3 with 7.c3', 'Fantasy: 5.Nf3 with 7.O-O', 'Mac new line'], 'ch1 lines'));
});

test('Mac and iPad each save a new line into the same chapter; both lines kept, in the same order on every device', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'addVariations', { variations: [{ name: 'Mac line', moves: [...FANTASY, 'Be3'] }] }));
  d.ipad = act(d.ipad, inCh('ch1', 'addVariations', { variations: [{ name: 'iPad line', moves: [...FANTASY, 'Nc3'] }] }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  const expected = names(d.mac, 'ch1');
  await expectEverywhere(d, (st) => {
    eq(names(st, 'ch1').slice(0, 4), BASE_CH1, 'ch1 original lines');
    eq([...names(st, 'ch1').slice(4)].sort(), ['Mac line', 'iPad line'].sort(), 'ch1 new lines');
    eq(names(st, 'ch1'), expected, 'same order as the Mac');
  });
});

test('Mac renames a line while the iPad comments and badges the SAME line; both edits land everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'renameVariation', { variationId: 'v1', name: 'Renamed on Mac' }));
  d.ipad = act(
    d.ipad,
    inCh('ch1', 'setMoveComment', { variationId: 'v1', moveIndex: 9, text: 'iPad: Qh4+ is forced' }),
    inCh('ch1', 'setMoveBadge', { variationId: 'v1', ply: 9, badge: 'best' }),
  );
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    const v = variation(st, 'ch1', 'v1');
    eq(v?.name, 'Renamed on Mac', 'v1 name');
    eq(v?.comments?.[9], 'iPad: Qh4+ is forced', 'v1 comment 9');
    eq(v?.comments?.[4], 'The Fantasy: 3.f3', 'v1 original comment');
    eq(v?.badges?.[9], 'best', 'v1 badge 9');
  });
});

test('Mac and iPad comment on different moves of the SAME line; both comments land everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'setMoveComment', { variationId: 'v3', moveIndex: 10, text: 'Mac: Bc4 aims at f7' }));
  d.ipad = act(d.ipad, inCh('ch1', 'setMoveComment', { variationId: 'v3', moveIndex: 12, text: 'iPad: c3 props d4' }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    eq(variation(st, 'ch1', 'v3')?.comments?.[10], 'Mac: Bc4 aims at f7', 'v3 comment 10');
    eq(variation(st, 'ch1', 'v3')?.comments?.[12], 'iPad: c3 props d4', 'v3 comment 12');
  });
});

test('Mac and iPad each add a DIFFERENT tag to the same line between syncs; both tags land everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'setVariationTags', { variationId: 'v2', tags: ['sharp', 'from the Mac'] }));
  d.ipad = act(d.ipad, inCh('ch1', 'setVariationTags', { variationId: 'v2', tags: ['sharp', 'from the iPad'] }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq([...(variation(st, 'ch1', 'v2')?.tags ?? [])].sort(),
    ['from the Mac', 'from the iPad', 'sharp'].sort(), 'v2 tags'));
});

test('Mac and iPad both practise the same line; learned everywhere, and the newer review\'s schedule wins', async () => {
  const d = await allInSync();
  const macSrs = schedule(null, true);
  d.mac = act(d.mac, inCh('ch1', 'recordPractice', { variationId: 'v3', srs: macSrs }));
  await pause(5);
  const ipadSrs = schedule(null, false); // later, and a slip
  d.ipad = act(d.ipad, inCh('ch1', 'recordPractice', { variationId: 'v3', srs: ipadSrs }));
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    eq(variation(st, 'ch1', 'v3')?.learned, true, 'v3 learned');
    eq(variation(st, 'ch1', 'v3')?.srs?.lastReview, ipadSrs.lastReview, 'v3 srs is the newer (iPad) review');
  });
});

test('Mac deletes a line while the iPad practises it; the deletion stands everywhere and the line never comes back', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'deleteVariation', { variationId: 'v3' }));
  d.ipad = act(d.ipad, inCh('ch1', 'recordPractice', { variationId: 'v3', srs: schedule(null, true) }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(order(st, 'ch1'), 'v1 v2 v4', 'ch1 order'));
});

// ---------------------------------------------------------------------------
// Reordering against other work in the same chapter (the user's report)
// ---------------------------------------------------------------------------

const macMovesV3Up = (st) => act(st, inCh('ch1', 'moveVariation', { variationId: 'v3', dir: -1 }));
const ipadPractisesV4 = (st) => act(st, inCh('ch1', 'recordPractice', { variationId: 'v4', srs: schedule(variation(st, 'ch1', 'v4').srs, true) }));
const reorderAndPracticeLanded = (st) => {
  eq(order(st, 'ch1'), 'v1 v3 v2 v4', 'ch1 order (Mac\'s reorder)');
  eq(variation(st, 'ch1', 'v4')?.srs?.reviews, 4, 'v4 practised on the iPad (reviews)');
};

test('Mac reorders a chapter while the iPad practises a line in it; Mac syncs first; both survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  d.ipad = ipadPractisesV4(d.ipad);
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('Mac reorders a chapter while the iPad practises a line in it; iPad syncs first; both survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  d.ipad = ipadPractisesV4(d.ipad);
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('Mac reorders a chapter while the iPad practises a line in it, and they sync at the very same moment; both survive everywhere', async () => {
  const d = await allInSync();
  const mac = macMovesV3Up(d.mac);
  const ipad = ipadPractisesV4(d.ipad);
  overlapNextSyncs('mac', 'ipad');
  const [m, i] = await Promise.all([
    asDevice('mac', () => syncNow(mac)),
    asDevice('ipad', () => syncNow(ipad)),
  ]);
  d.mac = m.state;
  d.ipad = i.state;
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('iPad reorders a chapter while the Mac practises a line in it; iPad syncs first; both survive everywhere', async () => {
  const d = await allInSync();
  d.ipad = act(d.ipad, inCh('ch1', 'moveVariation', { variationId: 'v4', dir: -1 }));
  d.mac = act(d.mac, inCh('ch1', 'recordPractice', { variationId: 'v1', srs: schedule(null, true) }));
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    eq(order(st, 'ch1'), 'v1 v2 v4 v3', 'ch1 order (iPad\'s reorder)');
    eq(variation(st, 'ch1', 'v1')?.learned, true, 'v1 practised on the Mac');
  });
});

test('[after an update] Mac reorders a chapter; the iPad, which practised a line in that chapter, makes its first (unstamped) sync; both survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  d.ipad = ipadPractisesV4(d.ipad);
  await sync(d, 'mac');
  await sync(d, 'ipad', unstamped(d.ipad));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('Mac reorders a chapter and syncs; meanwhile the iPad saved a new line into that chapter; the reorder AND the new line survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  d.ipad = act(d.ipad, inCh('ch1', 'addVariations', { variations: [{ name: 'iPad new line', moves: [...FANTASY, 'Nc3'] }] }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(names(st, 'ch1'), [
    'Fantasy: 5.dxe5', 'Fantasy: 5.Nf3 with 7.c3', 'Fantasy: 5.Nf3 with 7.Bxf7+', 'Fantasy: 5.Nf3 with 7.O-O', 'iPad new line',
  ], 'ch1 lines'));
});

test('iPad saves a new line into a chapter and syncs; meanwhile the Mac reordered that chapter; the reorder AND the new line survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  d.ipad = act(d.ipad, inCh('ch1', 'addVariations', { variations: [{ name: 'iPad new line', moves: [...FANTASY, 'Nc3'] }] }));
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(names(st, 'ch1'), [
    'Fantasy: 5.dxe5', 'Fantasy: 5.Nf3 with 7.c3', 'Fantasy: 5.Nf3 with 7.Bxf7+', 'Fantasy: 5.Nf3 with 7.O-O', 'iPad new line',
  ], 'ch1 lines'));
});

test('Mac moves a line to the top of a chapter and syncs; meanwhile the iPad deleted a different line there; the reorder AND the deletion survive everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, ...[1, 2].map(() => inCh('ch1', 'moveVariation', { variationId: 'v3', dir: -1 })));
  d.ipad = act(d.ipad, inCh('ch1', 'deleteVariation', { variationId: 'v1' }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(order(st, 'ch1'), 'v3 v2 v4', 'ch1 order'));
});

test('Mac and iPad reorder the same chapter differently; every device ends up with one and the same order, no line lost or doubled', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'moveVariation', { variationId: 'v2', dir: -1 }));
  d.ipad = act(d.ipad, inCh('ch1', 'moveVariation', { variationId: 'v4', dir: -1 }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  const agreed = order(d.mac, 'ch1');
  await expectEverywhere(d, (st) => {
    eq(order(st, 'ch1').split(' ').sort().join(' '), 'v1 v2 v3 v4', 'ch1 lines');
    eq(order(st, 'ch1'), agreed, 'same order as the Mac');
  });
});

test('Mac reorders twice with a sync in between; the iPad follows both', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  await sync(d, 'mac');
  await sync(d, 'ipad');
  eq(order(d.ipad, 'ch1'), 'v1 v3 v2 v4', 'iPad after the first reorder');
  d.mac = act(d.mac, inCh('ch1', 'moveVariation', { variationId: 'v4', dir: -1 }));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(order(st, 'ch1'), 'v1 v3 v4 v2', 'ch1 order'));
});

// ---------------------------------------------------------------------------
// Work done while a sync is in flight (useCloud.js:81-105 → foldInFlight)
// ---------------------------------------------------------------------------

// Mirrors useCloudEngine.run: sync from `started`, the app keeps going to
// `now`, and the result is folded back in.
async function syncWhileWorking(d, dev, work) {
  const started = d[dev];
  const result = await asDevice(dev, () => syncNow(started));
  const now = work(started);
  d[dev] = foldInFlight(started, now, result.state);
  return d[dev];
}

test('the Mac reorders a chapter while a sync bringing the iPad\'s practice is in flight; both survive everywhere', async () => {
  const d = await allInSync();
  d.ipad = ipadPractisesV4(d.ipad);
  await sync(d, 'ipad');
  await syncWhileWorking(d, 'mac', macMovesV3Up);
  await sync(d, 'mac'); // the quiet timer's follow-up sync
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('the iPad practises a line while a sync bringing the Mac\'s reorder is in flight; both survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  await sync(d, 'mac');
  await syncWhileWorking(d, 'ipad', ipadPractisesV4);
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, reorderAndPracticeLanded);
});

test('the iPad saves a new line while a sync bringing the Mac\'s reorder of that chapter is in flight; the reorder AND the new line survive everywhere', async () => {
  const d = await allInSync();
  d.mac = macMovesV3Up(d.mac);
  await sync(d, 'mac');
  await syncWhileWorking(d, 'ipad', (st) => act(st, inCh('ch1', 'addVariations', {
    variations: [{ name: 'iPad new line', moves: [...FANTASY, 'Nc3'] }],
  })));
  await sync(d, 'ipad');
  await sync(d, 'mac');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => eq(names(st, 'ch1'), [
    'Fantasy: 5.dxe5', 'Fantasy: 5.Nf3 with 7.c3', 'Fantasy: 5.Nf3 with 7.Bxf7+', 'Fantasy: 5.Nf3 with 7.O-O', 'iPad new line',
  ], 'ch1 lines'));
});

// ---------------------------------------------------------------------------
// The unstamped receiver that ALSO changed something in the same chapter: its
// chapter document no longer matches what it last pushed, so it goes up whole
// ---------------------------------------------------------------------------

test('[after an update] Mac deletes a line; the iPad, which practised another line in that chapter, makes its first (unstamped) sync; the deletion stands everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'deleteVariation', { variationId: 'v2' }));
  d.ipad = ipadPractisesV4(d.ipad);
  await sync(d, 'mac');
  await sync(d, 'ipad', unstamped(d.ipad));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    eq(order(st, 'ch1'), 'v1 v3 v4', 'ch1 order');
    eq(variation(st, 'ch1', 'v4')?.srs?.reviews, 4, 'v4 practised on the iPad (reviews)');
  });
});

test('[after an update] Mac clears a comment; the iPad, which starred another line in that chapter, makes its first (unstamped) sync; the comment stays cleared everywhere', async () => {
  const d = await allInSync();
  d.mac = act(d.mac, inCh('ch1', 'setMoveComment', { variationId: 'v1', moveIndex: 4, text: '' }));
  d.ipad = act(d.ipad, inCh('ch1', 'toggleStar', { variationId: 'v3' }));
  await sync(d, 'mac');
  await sync(d, 'ipad', unstamped(d.ipad));
  await sync(d, 'mac');
  await sync(d, 'ipad');
  await sync(d, 'iphone');
  await expectEverywhere(d, (st) => {
    eq(variation(st, 'ch1', 'v1')?.comments?.[4], undefined, 'v1 comment on move 4');
    eq(Boolean(variation(st, 'ch1', 'v3')?.starred), true, 'v3 starred on the iPad');
  });
});
