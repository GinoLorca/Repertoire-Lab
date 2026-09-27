// Sync matrix: games, players, categories, playlists, Lab entries and saved
// Board Editor positions.
//
// Every change a person can make to these, as a user story run through the
// REAL sync engine (src/lib/cloud/sync.js) by simulated devices sharing one
// in-memory Firestore (tests/fakes/):
//
//   · Mac makes the change, both sync, the iPad has it           [three-way]
//   · the iPad makes it, both sync, the Mac has it               [three-way]
//   · the device making it is on its first sync after an update  [careful path, author]
//     (its state carries no syncGen)
//   · the device receiving it is on its first sync after an update
//     (its state carries no syncGen)                             [careful path, receiver]
//
// and then the change has to STAY: the author syncs again after the receiver
// did (it hears the receiver's pulse in the app), and a brand-new iPhone
// signing in has to see it too.
//
// Changes are applied through a line-for-line mirror of the app's reducer
// (src/store.jsx — JSX, so node can't import it); each mirrored case is
// marked with the store.jsx case it copies. Reorders that have no reducer
// action in the app (players, categories, playlists, Lab entries, saved
// positions, games inside a player) are applied directly to the array, the
// way a drag would, and say so in their name.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncNow } from '../src/lib/cloud/sync.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';
import { defaultMonsterId } from '../src/lib/monsters.js';
import { asDevice, resetServer, server } from './fakes/firebase.mjs';
import { resetDevices } from './fakes/idb.mjs';
import { markPreUpdate, isPreUpdate, downgradeStorage } from './fakes/legacy.mjs';

beforeEach(() => { resetServer(); resetDevices(); });

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

// Real Firestore hands back a collection's documents ordered by document id;
// the fake hands them back in the order they were first written. Sorted
// before every sync so the engine sees what production would show it — ids
// in the fixture are chosen so that id order is NOT the library's order.
function firestoreOrder() {
  const entries = [...server.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  server.clear();
  for (const [k, v] of entries) server.set(k, v);
}

async function sync(device, state, options) {
  firestoreOrder();
  if (isPreUpdate(state)) await downgradeStorage(device);
  const out = await asDevice(device, () => syncNow(state, options));
  assert.ok(!out.offline, `${device} synced online`);
  return out.state;
}

// The first sync after an update (or a relaunch before the last sync's stamp
// was saved): the state carries no syncGen, so the engine takes the careful
// path — mergeState(undefined, local, remote, 'remote') with no deletions.
const stripGen = (st) => markPreUpdate(st);

const NAMES = { mac: 'Mac', ipad: 'iPad', iphone: 'iPhone' };

// ---------------------------------------------------------------------------
// A mirror of the reducer (src/store.jsx), for the cases this file exercises
// ---------------------------------------------------------------------------

// store.jsx `uid`
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// store.jsx `mapPlayer`
function mapPlayer(state, playerId, fn) {
  return { ...state, players: state.players.map((p) => (p.id === playerId ? fn(p) : p)) };
}

// store.jsx `GAME_EDITS`
const GAME_EDITS = new Set([
  'setGameCategory', 'setGameNotes', 'setGameMoveComment', 'setGameMoveBadge',
  'setGameBadges', 'setGameComments', 'setGameAnnotations', 'setGameTree',
  'setGameFlags', 'setGameTags', 'setGamePhoto', 'moveGameToPlayer',
  'addGame', 'updateGame', 'renameGame', 'undoCoachChanges',
]);

// store.jsx `stampEditedGames`
function stampEditedGames(before, after) {
  if (before === after || !after?.players) return after;
  const old = new Map();
  for (const p of before?.players ?? []) for (const g of p.games ?? []) old.set(g.id, g);
  const now = Date.now();
  let changed = false;
  const players = after.players.map((p) => {
    let touched = false;
    const games = (p.games ?? []).map((g) => {
      if (old.get(g.id) === g) return g;
      touched = true;
      return { ...g, updatedAt: now };
    });
    if (!touched) return p;
    changed = true;
    return { ...p, games };
  });
  return changed ? { ...after, players } : after;
}

// store.jsx `reducer`
function dispatch(state, action) {
  const next = reduce(state, action);
  return GAME_EDITS.has(action.type) ? stampEditedGames(state, next) : next;
}

// store.jsx `reduce` — only the cases below; each copied from its case.
function reduce(state, action) {
  switch (action.type) {
    case 'saveLabEntry': { // store.jsx case 'saveLabEntry'
      const existing = (state.labEntries ?? []).find((e) => e.id === action.entry.id);
      const now = new Date().toISOString();
      if (existing) {
        return {
          ...state,
          labEntries: state.labEntries.map((e) => (
            e.id === action.entry.id ? { ...e, ...action.entry, updatedAt: now } : e)),
        };
      }
      return {
        ...state,
        labEntries: [{ ...action.entry, createdAt: now, updatedAt: now }, ...(state.labEntries ?? [])],
      };
    }
    case 'deleteLabEntry': // store.jsx case 'deleteLabEntry'
      return { ...state, labEntries: (state.labEntries ?? []).filter((e) => e.id !== action.id) };
    case 'renameLabEntry': // store.jsx case 'renameLabEntry'
      return {
        ...state,
        labEntries: (state.labEntries ?? []).map((e) => (
          e.id === action.id ? { ...e, title: action.title, updatedAt: new Date().toISOString() } : e)),
      };
    case 'addCategory': { // store.jsx case 'addCategory'
      const name = action.name.trim();
      if (!name) return state;
      return { ...state, categories: [...(state.categories ?? []), { id: uid(), name }] };
    }
    case 'renameCategory': // store.jsx case 'renameCategory'
      return {
        ...state,
        categories: (state.categories ?? []).map((c) => (
          c.id === action.categoryId ? { ...c, name: action.name } : c)),
      };
    case 'deleteCategory': // store.jsx case 'deleteCategory'
      return {
        ...state,
        categories: (state.categories ?? []).filter((c) => c.id !== action.categoryId),
        players: state.players.map((p) => ({
          ...p,
          games: p.games.map((g) => (g.meta?.categoryId === `custom:${action.categoryId}`
            ? { ...g, meta: { ...g.meta, categoryId: null } }
            : g)),
        })),
      };
    case 'addPlaylist': { // store.jsx case 'addPlaylist'
      const name = action.name.trim();
      if (!name) return state;
      const playlist = { id: action.id ?? uid(), name, items: [], shuffle: false };
      return { ...state, playlists: [...(state.playlists ?? []), playlist] };
    }
    case 'renamePlaylist': // store.jsx case 'renamePlaylist'
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId ? { ...p, name: action.name } : p)),
      };
    case 'deletePlaylist': // store.jsx case 'deletePlaylist'
      return { ...state, playlists: (state.playlists ?? []).filter((p) => p.id !== action.playlistId) };
    case 'setPlaylistShuffle': // store.jsx case 'setPlaylistShuffle'
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId ? { ...p, shuffle: action.shuffle } : p)),
      };
    case 'addToPlaylist': // store.jsx case 'addToPlaylist'
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
    case 'removeFromPlaylist': // store.jsx case 'removeFromPlaylist'
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId
            ? { ...p, items: p.items.filter((it) => it.variationId !== action.variationId) }
            : p)),
      };
    case 'movePlaylistItem': // store.jsx case 'movePlaylistItem'
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
    case 'setGameCategory': // store.jsx case 'setGameCategory'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), categoryId: action.categoryId } }
          : g)),
      }));
    case 'setGameNotes': // store.jsx case 'setGameNotes'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), notes: action.notes } }
          : g)),
      }));
    case 'setGameMoveComment': // store.jsx case 'setGameMoveComment'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => {
          if (g.id !== action.gameId) return g;
          const comments = { ...(g.comments ?? {}) };
          if (action.text?.trim()) comments[action.ply] = action.text.trim();
          else delete comments[action.ply];
          return { ...g, comments };
        }),
      }));
    case 'setGameFlags': // store.jsx case 'setGameFlags'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), flags: action.flags } }
          : g)),
      }));
    case 'setGameTags': // store.jsx case 'setGameTags'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, tags: action.tags } : g)),
      }));
    case 'setGamePhoto': // store.jsx case 'setGamePhoto'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), photo: action.photo } }
          : g)),
      }));
    case 'moveGameToPlayer': { // store.jsx case 'moveGameToPlayer'
      const from = state.players.find((p) => p.id === action.fromPlayerId);
      const game = from?.games.find((g) => g.id === action.gameId);
      if (!game) return state;
      return {
        ...state,
        players: state.players.map((p) => {
          if (p.id === action.fromPlayerId) {
            return { ...p, games: p.games.filter((g) => g.id !== action.gameId) };
          }
          if (p.id === action.toPlayerId) return { ...p, games: [...p.games, game] };
          return p;
        }),
      };
    }
    case 'addPlayer': { // store.jsx case 'addPlayer'
      const id = action.id ?? uid();
      const player = {
        id,
        name: action.name,
        kind: action.kind ?? 'self',
        profile: action.profile ?? { uscf: '', fide: '', chesscom: '', lichess: '', rating: '' },
        avatar: action.avatar ?? { kind: 'monster', variant: defaultMonsterId(id) },
        games: [],
      };
      return { ...state, players: [...state.players, player] };
    }
    case 'updatePlayer': // store.jsx case 'updatePlayer'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        name: action.name ?? p.name,
        profile: { ...(p.profile ?? {}), ...(action.profile ?? {}) },
        avatar: action.avatar ?? p.avatar,
      }));
    case 'renamePlayer': // store.jsx case 'renamePlayer'
      return mapPlayer(state, action.playerId, (p) => ({ ...p, name: action.name }));
    case 'setPlayerKind': // store.jsx case 'setPlayerKind'
      return mapPlayer(state, action.playerId, (p) => ({ ...p, kind: action.kind }));
    case 'deletePlayer': // store.jsx case 'deletePlayer'
      return { ...state, players: state.players.filter((p) => p.id !== action.playerId) };
    case 'addGame': { // store.jsx case 'addGame'
      const game = {
        id: uid(),
        name: action.game.name || 'Game',
        moves: action.game.moves,
        comments: action.game.comments ?? {},
        badges: action.game.badges ?? {},
        date: action.game.date ?? Date.now(),
        meta: action.game.meta ?? null,
      };
      return mapPlayer(state, action.playerId, (p) => {
        const linkedUid = p.kind === 'student' ? p.profile?.linkedUid : null;
        const next = linkedUid
          ? { ...game, link: { uid: linkedUid, base: {}, seen: false, sent: null } }
          : game;
        return { ...p, games: [...p.games, next] };
      });
    }
    case 'updateGame': // store.jsx case 'updateGame'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => {
          if (g.id !== action.gameId) return g;
          return {
            ...g,
            ...action.game,
            meta: action.game.meta ? { ...(g.meta ?? {}), ...action.game.meta } : g.meta,
          };
        }),
      }));
    case 'renameGame': // store.jsx case 'renameGame'
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, name: action.name } : g)),
      }));
    case 'deleteGame': // store.jsx case 'deleteGame'
      return mapPlayer(state, action.playerId, (p) => {
        const doomed = p.games.find((g) => g.id === action.gameId);
        const next = { ...p, games: p.games.filter((g) => g.id !== action.gameId) };
        if (doomed?.link) {
          next.hiddenLinkedGames = { ...(p.hiddenLinkedGames ?? {}), [action.gameId]: Date.now() };
        }
        return next;
      });
    case 'savePosition': // store.jsx case 'savePosition'
      return {
        ...state,
        savedPositions: [
          { id: action.id ?? uid(), name: action.name, fen: action.fen, createdAt: new Date().toISOString() },
          ...(state.savedPositions ?? []),
        ],
      };
    case 'deletePosition': // store.jsx case 'deletePosition'
      return { ...state, savedPositions: (state.savedPositions ?? []).filter((p) => p.id !== action.id) };
    default:
      throw new Error(`reducer mirror has no case for ${action.type}`);
  }
}

// ---------------------------------------------------------------------------
// The library both devices start from
// ---------------------------------------------------------------------------

// Ids are picked so that sorting them (what Firestore does to a collection)
// gives a different order from the library's own: z…, a…, m….
const game = (id, name, extra = {}) => ({
  id,
  name,
  moves: ['e4', 'c6', 'd4', 'd5'],
  comments: { 1: 'Caro!' },
  badges: {},
  date: 1_700_000_000_000,
  meta: { white: 'Me', black: 'Opponent', result: '1/2-1/2' },
  updatedAt: 1,
  ...extra,
});
const profile = (extra = {}) => ({ uscf: '', fide: '', chesscom: '', lichess: '', rating: '', ...extra });
const item = (variationId) => ({ openingId: 'op_ck', chapterId: 'ch_ck', variationId });
const variation = (id, name) => ({
  id, name, moves: ['e4', 'c6', 'd4', 'd5'], comments: {}, learned: false, srs: null,
});
const labEntry = (id, title, stamp) => ({
  id,
  title,
  note: '',
  baseFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves: ['e4', 'c5'],
  tree: null,
  // A board arrow is [from, to, colour]: an array inside an array, which
  // Firestore refuses unless shape.js boxes it.
  annotations: { start: { arrows: [['e2', 'e4', 'green']], squares: {} } },
  moveBadges: {},
  moveNotes: {},
  variationHighlights: {},
  coach: false,
  source: null,
  createdAt: stamp,
  updatedAt: stamp,
});
const position = (id, name, fen) => ({ id, name, fen, createdAt: '2026-02-01T00:00:00.000Z' });

function library() {
  return {
    openings: [{
      id: 'op_ck',
      name: 'Caro-Kann',
      color: 'black',
      ownerId: null,
      chapters: [{
        id: 'ch_ck',
        name: 'Main line',
        variations: [
          variation('va_one', 'Classical'), variation('va_two', 'Advance'),
          variation('va_three', 'Exchange'), variation('va_four', 'Fantasy'),
        ],
      }],
    }],
    players: [
      {
        id: 'pz_self',
        name: 'My games',
        kind: 'self',
        profile: profile(),
        avatar: { kind: 'monster', variant: 'blip' },
        games: [
          game('gz_one', 'Club night R1', { meta: { white: 'Me', black: 'Opp', categoryId: 'custom:ca_gam' } }),
          game('ga_two', 'Club night R2'),
          game('gm_three', 'Blitz vs Sam'),
        ],
      },
      {
        id: 'pa_alice',
        name: 'alice_chess',
        kind: 'student',
        profile: profile({ lichess: 'alice_chess' }),
        avatar: { kind: 'monster', variant: 'snorf' },
        games: [game('gk_alice', 'Alice — Round 1'), game('gb_alice', 'Alice — Round 2')],
      },
      {
        id: 'pm_bob',
        name: 'bobby99',
        kind: 'student',
        profile: profile({ chesscom: 'bobby99' }),
        avatar: { kind: 'monster', variant: 'puddle' },
        games: [],
      },
    ],
    categories: [{ id: 'cz_end', name: 'Endgames' }, { id: 'ca_gam', name: 'Gambits' }, { id: 'cm_tac', name: 'Tactics' }],
    playlists: [
      { id: 'lz_warm', name: 'Warm-up', items: [item('va_one'), item('va_two'), item('va_three')], shuffle: false },
      { id: 'la_drill', name: 'Drill', items: [item('va_four')], shuffle: false },
      { id: 'lm_mix', name: 'Mix', items: [], shuffle: true },
    ],
    labEntries: [
      labEntry('ez_one', 'Najdorf idea', '2026-01-03T00:00:00.000Z'),
      labEntry('ea_two', 'Rook ending', '2026-01-02T00:00:00.000Z'),
      labEntry('em_three', 'Sac on f7', '2026-01-01T00:00:00.000Z'),
    ],
    analysisDraft: null,
    savedPositions: [
      position('sz_luc', 'Lucena', '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1'),
      position('sa_phi', 'Philidor', '4k3/8/8/8/8/r7/3PK3/7R b - - 0 1'),
      position('sm_opp', 'Opposition', '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1'),
    ],
    settings: { ...DEFAULT_SETTINGS, skin: 'bauhaus' },
  };
}

// A device that has never had anything on it.
const blank = () => ({
  openings: [], players: [], categories: [], playlists: [], labEntries: [], savedPositions: [],
  analysisDraft: null, settings: { ...DEFAULT_SETTINGS },
});

// The Mac starts the account; the iPad signs in; both sync once more so each
// has a baseline and a state stamped with it — the everyday situation.
async function inSync() {
  let mac = await sync('mac', library());
  let ipad = await sync('ipad', blank());
  mac = await sync('mac', mac);
  ipad = await sync('ipad', ipad);
  return { mac, ipad };
}

// ---------------------------------------------------------------------------
// Looking at a library
// ---------------------------------------------------------------------------

const ids = (arr) => (arr ?? []).map((x) => x.id);
const allGames = (st) => st.players.flatMap((p) => p.games.map((g) => ({ ...g, owner: p.id })));
const findGame = (st, id) => allGames(st).find((g) => g.id === id);
const player = (st, id) => st.players.find((p) => p.id === id);
const playlist = (st, id) => st.playlists.find((p) => p.id === id);
const itemIds = (st, id) => (playlist(st, id)?.items ?? []).map((it) => it.variationId);

// Things that must hold after every sync whatever the change was: no record
// twice in a list, and no game under two players at once.
function intact(st, who) {
  for (const key of ['players', 'categories', 'playlists', 'labEntries', 'savedPositions']) {
    const list = ids(st[key]);
    assert.equal(new Set(list).size, list.length, `${who}: a record appears twice in ${key}: ${list.join(', ')}`);
  }
  const gameIds = allGames(st).map((g) => g.id);
  const twice = gameIds.filter((id, i) => gameIds.indexOf(id) !== i);
  assert.deepEqual(twice, [], `${who}: game(s) filed under two players at once`);
}

// ---------------------------------------------------------------------------
// The changes
// ---------------------------------------------------------------------------
//
// Each is { area, does, sees, make() }: make() returns a fresh { apply, check }
// so a change that mints an id (addGame, addCategory…) can check for it.

const CHANGES = [
  // ------------------------------------------------------------- games ---
  {
    area: 'games',
    does: 'adds a game to their own games',
    sees: 'the new game, under My games, at the end',
    make() {
      let id;
      return {
        apply(st) {
          const next = dispatch(st, {
            type: 'addGame',
            playerId: 'pz_self',
            game: { name: 'Tuesday blitz', moves: ['d4', 'd5', 'c4'], date: 1_800_000_000_000, meta: { white: 'Me', black: 'Kim' } },
          });
          id = player(next, 'pz_self').games.at(-1).id;
          return next;
        },
        check(st, who) {
          const g = findGame(st, id);
          assert.ok(g, `${who} has the new game`);
          assert.equal(g.name, 'Tuesday blitz');
          assert.deepEqual(g.moves, ['d4', 'd5', 'c4']);
          assert.equal(g.owner, 'pz_self');
          assert.equal(player(st, 'pz_self').games.at(-1).id, id, `${who}: it's last in the list`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'adds a game to a student (Coaches Corner)',
    sees: 'the new game on Alice\'s card',
    make() {
      let id;
      return {
        apply(st) {
          const next = dispatch(st, {
            type: 'addGame',
            playerId: 'pa_alice',
            game: { name: 'Alice — Round 3', moves: ['e4', 'e5', 'Nf3'], date: 1_800_000_000_001 },
          });
          id = player(next, 'pa_alice').games.at(-1).id;
          return next;
        },
        check(st, who) {
          const g = findGame(st, id);
          assert.ok(g, `${who} has Alice's new game`);
          assert.equal(g.owner, 'pa_alice');
          assert.equal(g.name, 'Alice — Round 3');
          assert.deepEqual(ids(player(st, 'pa_alice').games), ['gk_alice', 'gb_alice', id]);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'edits a game in the game editor (updateGame)',
    sees: 'the edited name, moves and scoresheet fields, other meta kept',
    make() {
      return {
        apply: (st) => dispatch(st, {
          type: 'updateGame',
          playerId: 'pz_self',
          gameId: 'ga_two',
          game: { name: 'Club night R2 (corrected)', moves: ['e4', 'c6', 'Nc3', 'd5'], meta: { event: 'Club champs', result: '1-0' } },
        }),
        check(st, who) {
          const g = findGame(st, 'ga_two');
          assert.equal(g.name, 'Club night R2 (corrected)', `${who}: name`);
          assert.deepEqual(g.moves, ['e4', 'c6', 'Nc3', 'd5'], `${who}: moves`);
          assert.equal(g.meta.event, 'Club champs', `${who}: meta.event`);
          assert.equal(g.meta.result, '1-0', `${who}: meta.result`);
          assert.equal(g.meta.white, 'Me', `${who}: untouched meta kept`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'writes notes on a game',
    sees: 'the notes',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'setGameNotes', playerId: 'pa_alice', gameId: 'gk_alice', notes: 'Missed Nxe5 on move 12' }),
        check: (st, who) => assert.equal(findGame(st, 'gk_alice').meta?.notes, 'Missed Nxe5 on move 12', `${who}: notes`),
      };
    },
  },
  {
    area: 'games',
    does: 'tags a game and flags a blunder',
    sees: 'the tags and flags',
    make() {
      return {
        apply(st) {
          const a = dispatch(st, { type: 'setGameTags', playerId: 'pz_self', gameId: 'gz_one', tags: ['fork', 'time trouble'] });
          return dispatch(a, { type: 'setGameFlags', playerId: 'pz_self', gameId: 'gz_one', flags: ['blunder'] });
        },
        check(st, who) {
          const g = findGame(st, 'gz_one');
          assert.deepEqual(g.tags, ['fork', 'time trouble'], `${who}: tags`);
          assert.deepEqual(g.meta.flags, ['blunder'], `${who}: flags`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'files a game under a custom category',
    sees: 'the game in that category',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'setGameCategory', playerId: 'pz_self', gameId: 'ga_two', categoryId: 'custom:cz_end' }),
        check: (st, who) => assert.equal(findGame(st, 'ga_two').meta.categoryId, 'custom:cz_end', `${who}: categoryId`),
      };
    },
  },
  {
    area: 'games',
    does: 'comments on one move of a game and deletes the comment on another',
    sees: 'the new comment there and the deleted one gone',
    make() {
      return {
        apply(st) {
          const a = dispatch(st, { type: 'setGameMoveComment', playerId: 'pz_self', gameId: 'gz_one', ply: 3, text: 'Better was c5' });
          return dispatch(a, { type: 'setGameMoveComment', playerId: 'pz_self', gameId: 'gz_one', ply: 1, text: '' });
        },
        check(st, who) {
          assert.deepEqual(findGame(st, 'gz_one').comments, { 3: 'Better was c5' }, `${who}: comments`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'renames a game',
    sees: 'the new name',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'renameGame', playerId: 'pa_alice', gameId: 'gb_alice', name: 'Alice — Round 2 (the comeback)' }),
        check: (st, who) => assert.equal(findGame(st, 'gb_alice').name, 'Alice — Round 2 (the comeback)', `${who}: name`),
      };
    },
  },
  {
    area: 'games',
    does: 'adds a scoresheet photo to a game',
    sees: 'the photo',
    make() {
      const pic = `data:image/jpeg;base64,${'Q'.repeat(600)}`;
      return {
        apply: (st) => dispatch(st, { type: 'setGamePhoto', playerId: 'pz_self', gameId: 'gm_three', photo: pic }),
        check: (st, who) => assert.equal(findGame(st, 'gm_three').meta?.photo, pic, `${who}: photo`),
      };
    },
  },
  {
    area: 'games',
    does: 'deletes a game',
    sees: 'the game gone, the rest untouched',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deleteGame', playerId: 'pz_self', gameId: 'ga_two' }),
        check(st, who) {
          assert.equal(findGame(st, 'ga_two'), undefined, `${who}: the deleted game is gone`);
          assert.deepEqual(ids(player(st, 'pz_self').games), ['gz_one', 'gm_three'], `${who}: the others stay, in order`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'moves a game from My games to a student (moveGameToPlayer)',
    sees: 'the game under Alice only, at the end',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'moveGameToPlayer', gameId: 'gm_three', fromPlayerId: 'pz_self', toPlayerId: 'pa_alice' }),
        check(st, who) {
          assert.deepEqual(ids(player(st, 'pz_self').games), ['gz_one', 'ga_two'], `${who}: gone from My games`);
          assert.deepEqual(ids(player(st, 'pa_alice').games), ['gk_alice', 'gb_alice', 'gm_three'], `${who}: on Alice's card, last`);
        },
      };
    },
  },
  {
    area: 'games',
    does: 'rearranges the games inside a player (no reducer action exists; mirrors a drag directly)',
    sees: 'the same game order',
    make() {
      return {
        apply: (st) => mapPlayer(st, 'pz_self', (p) => ({ ...p, games: [p.games[2], p.games[0], p.games[1]] })),
        check: (st, who) => assert.deepEqual(ids(player(st, 'pz_self').games), ['gm_three', 'gz_one', 'ga_two'], `${who}: game order`),
      };
    },
  },

  // ----------------------------------------------------------- players ---
  {
    area: 'players',
    does: 'adds a student',
    sees: 'the new student, last in the list',
    make() {
      const id = uid();
      return {
        apply: (st) => dispatch(st, {
          type: 'addPlayer', id, name: 'Charlie Park', kind: 'student', profile: profile({ uscf: '12345678' }),
        }),
        check(st, who) {
          const p = player(st, id);
          assert.ok(p, `${who} has the new student`);
          assert.equal(p.name, 'Charlie Park');
          assert.equal(p.kind, 'student');
          assert.equal(p.profile.uscf, '12345678');
          assert.equal(ids(st.players).at(-1), id, `${who}: added at the end`);
        },
      };
    },
  },
  {
    area: 'players',
    does: 'edits a student\'s profile: real name, ids, avatar and refreshed ratings',
    sees: 'every edited field',
    make() {
      return {
        apply: (st) => dispatch(st, {
          type: 'updatePlayer',
          playerId: 'pa_alice',
          name: 'Alice Nguyen',
          profile: { uscf: '30001234', ratings: { lichess: { rapid: 1650, at: 1_800_000_000_000 } } },
          avatar: { kind: 'monster', variant: 'grumble' },
        }),
        check(st, who) {
          const p = player(st, 'pa_alice');
          assert.equal(p.name, 'Alice Nguyen', `${who}: name`);
          assert.equal(p.profile.uscf, '30001234', `${who}: uscf`);
          assert.equal(p.profile.lichess, 'alice_chess', `${who}: untouched profile field kept`);
          assert.deepEqual(p.profile.ratings, { lichess: { rapid: 1650, at: 1_800_000_000_000 } }, `${who}: ratings`);
          assert.deepEqual(p.avatar, { kind: 'monster', variant: 'grumble' }, `${who}: avatar`);
        },
      };
    },
  },
  {
    area: 'players',
    does: 'gives a student a photo avatar',
    sees: 'the photo',
    make() {
      const pic = `data:image/png;base64,${'P'.repeat(500)}`;
      return {
        apply: (st) => dispatch(st, { type: 'updatePlayer', playerId: 'pm_bob', avatar: { kind: 'photo', data: pic } }),
        check: (st, who) => assert.deepEqual(player(st, 'pm_bob').avatar, { kind: 'photo', data: pic }, `${who}: avatar`),
      };
    },
  },
  {
    area: 'players',
    does: 'renames a player',
    sees: 'the new name',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'renamePlayer', playerId: 'pm_bob', name: 'Bob Smith' }),
        check: (st, who) => assert.equal(player(st, 'pm_bob').name, 'Bob Smith', `${who}: name`),
      };
    },
  },
  {
    area: 'players',
    does: 'moves a student over to their own games tab (setPlayerKind)',
    sees: 'the new kind',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'setPlayerKind', playerId: 'pm_bob', kind: 'self' }),
        check: (st, who) => assert.equal(player(st, 'pm_bob').kind, 'self', `${who}: kind`),
      };
    },
  },
  {
    area: 'players',
    does: 'deletes a student',
    sees: 'the student and their games gone',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deletePlayer', playerId: 'pa_alice' }),
        check(st, who) {
          assert.equal(player(st, 'pa_alice'), undefined, `${who}: the student is gone`);
          assert.equal(findGame(st, 'gk_alice'), undefined, `${who}: and their games`);
          assert.deepEqual(ids(st.players), ['pz_self', 'pm_bob'], `${who}: the others stay, in order`);
        },
      };
    },
  },
  {
    area: 'players',
    does: 'rearranges the players (no reducer action exists; mirrors a drag directly)',
    sees: 'the same player order',
    make() {
      return {
        apply: (st) => ({ ...st, players: [st.players[2], st.players[0], st.players[1]] }),
        check: (st, who) => assert.deepEqual(ids(st.players), ['pm_bob', 'pz_self', 'pa_alice'], `${who}: player order`),
      };
    },
  },

  // -------------------------------------------------------- categories ---
  {
    area: 'categories',
    does: 'adds a category',
    sees: 'the new category, last',
    make() {
      let id;
      return {
        apply(st) {
          const next = dispatch(st, { type: 'addCategory', name: '  Rook endings ' });
          id = next.categories.at(-1).id;
          return next;
        },
        check(st, who) {
          assert.equal(st.categories.find((c) => c.id === id)?.name, 'Rook endings', `${who} has the new category`);
          assert.equal(ids(st.categories).at(-1), id, `${who}: last`);
        },
      };
    },
  },
  {
    area: 'categories',
    does: 'renames a category',
    sees: 'the new name',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'renameCategory', categoryId: 'cz_end', name: 'Endgame technique' }),
        check: (st, who) => assert.equal(st.categories.find((c) => c.id === 'cz_end')?.name, 'Endgame technique', `${who}: name`),
      };
    },
  },
  {
    area: 'categories',
    does: 'deletes a category',
    sees: 'the category gone and its games back to automatic',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deleteCategory', categoryId: 'ca_gam' }),
        check(st, who) {
          assert.deepEqual(ids(st.categories), ['cz_end', 'cm_tac'], `${who}: category gone`);
          assert.equal(findGame(st, 'gz_one').meta.categoryId ?? null, null, `${who}: its game falls back to automatic`);
        },
      };
    },
  },
  {
    area: 'categories',
    does: 'rearranges the categories (no reducer action exists; mirrors a drag directly)',
    sees: 'the same category order',
    make() {
      return {
        apply: (st) => ({ ...st, categories: [st.categories[2], st.categories[0], st.categories[1]] }),
        check: (st, who) => assert.deepEqual(ids(st.categories), ['cm_tac', 'cz_end', 'ca_gam'], `${who}: category order`),
      };
    },
  },

  // --------------------------------------------------------- playlists ---
  {
    area: 'playlists',
    does: 'adds a playlist',
    sees: 'the new playlist, last',
    make() {
      const id = uid();
      return {
        apply: (st) => dispatch(st, { type: 'addPlaylist', id, name: 'Before the tournament' }),
        check(st, who) {
          assert.deepEqual(playlist(st, id), { id, name: 'Before the tournament', items: [], shuffle: false }, `${who} has it`);
          assert.equal(ids(st.playlists).at(-1), id, `${who}: last`);
        },
      };
    },
  },
  {
    area: 'playlists',
    does: 'renames a playlist',
    sees: 'the new name',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'renamePlaylist', playlistId: 'la_drill', name: 'Daily drill' }),
        check: (st, who) => assert.equal(playlist(st, 'la_drill')?.name, 'Daily drill', `${who}: name`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'deletes a playlist',
    sees: 'the playlist gone',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deletePlaylist', playlistId: 'la_drill' }),
        check: (st, who) => assert.deepEqual(ids(st.playlists), ['lz_warm', 'lm_mix'], `${who}: playlist gone`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'turns shuffle on for a playlist',
    sees: 'shuffle on',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'setPlaylistShuffle', playlistId: 'lz_warm', shuffle: true }),
        check: (st, who) => assert.equal(playlist(st, 'lz_warm').shuffle, true, `${who}: shuffle`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'adds a line to a playlist',
    sees: 'the line in the playlist, last',
    make() {
      return {
        apply: (st) => dispatch(st, {
          type: 'addToPlaylist', playlistId: 'la_drill', openingId: 'op_ck', chapterId: 'ch_ck', variationId: 'va_one',
        }),
        check: (st, who) => assert.deepEqual(itemIds(st, 'la_drill'), ['va_four', 'va_one'], `${who}: items`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'removes a line from a playlist',
    sees: 'the line gone from the playlist',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'removeFromPlaylist', playlistId: 'lz_warm', variationId: 'va_two' }),
        check: (st, who) => assert.deepEqual(itemIds(st, 'lz_warm'), ['va_one', 'va_three'], `${who}: items`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'moves a line up inside a playlist (movePlaylistItem)',
    sees: 'the same item order',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'movePlaylistItem', playlistId: 'lz_warm', variationId: 'va_three', dir: -1 }),
        check: (st, who) => assert.deepEqual(itemIds(st, 'lz_warm'), ['va_one', 'va_three', 'va_two'], `${who}: item order`),
      };
    },
  },
  {
    area: 'playlists',
    does: 'rearranges the playlists (no reducer action exists; mirrors a drag directly)',
    sees: 'the same playlist order',
    make() {
      return {
        apply: (st) => ({ ...st, playlists: [st.playlists[2], st.playlists[0], st.playlists[1]] }),
        check: (st, who) => assert.deepEqual(ids(st.playlists), ['lm_mix', 'lz_warm', 'la_drill'], `${who}: playlist order`),
      };
    },
  },

  // -------------------------------------------------------------- Lab ---
  {
    area: 'lab',
    does: 'saves a new Lab session (with arrows and a move tree)',
    sees: 'the new session at the top, arrows and tree intact',
    make() {
      const id = uid();
      // Deep enough that shape.js has to JSON-box it for Firestore.
      let tree = null;
      for (let i = 0; i < 16; i += 1) tree = { san: `m${i}`, children: tree ? [tree] : [] };
      const entry = {
        ...labEntry(id, 'London vs …Bf5', undefined),
        moves: ['d4', 'd5', 'Bf4', 'Bf5'],
        tree,
        annotations: { a: { arrows: [['f1', 'd3', 'red'], ['c2', 'c4', 'blue']], squares: { d5: 'yellow' } } },
        source: { name: 'London', gameId: null, playerId: null },
      };
      delete entry.createdAt;
      delete entry.updatedAt;
      return {
        apply: (st) => dispatch(st, { type: 'saveLabEntry', entry }),
        check(st, who) {
          const e = st.labEntries.find((x) => x.id === id);
          assert.ok(e, `${who} has the new session`);
          assert.equal(e.title, 'London vs …Bf5');
          assert.deepEqual(e.annotations.a.arrows, [['f1', 'd3', 'red'], ['c2', 'c4', 'blue']], `${who}: arrows`);
          assert.deepEqual(e.tree, tree, `${who}: move tree`);
          assert.equal(ids(st.labEntries)[0], id, `${who}: at the top`);
        },
      };
    },
  },
  {
    area: 'lab',
    does: 'saves changes to an existing Lab session',
    sees: 'the updated note and moves',
    make() {
      return {
        apply(st) {
          const old = st.labEntries.find((e) => e.id === 'ea_two');
          return dispatch(st, { type: 'saveLabEntry', entry: { ...old, note: 'Cut the king off first', moves: ['Ra1', 'Kd7'] } });
        },
        check(st, who) {
          const e = st.labEntries.find((x) => x.id === 'ea_two');
          assert.equal(e.note, 'Cut the king off first', `${who}: note`);
          assert.deepEqual(e.moves, ['Ra1', 'Kd7'], `${who}: moves`);
          assert.deepEqual(ids(st.labEntries), ['ez_one', 'ea_two', 'em_three'], `${who}: stays where it was`);
        },
      };
    },
  },
  {
    area: 'lab',
    does: 'renames a Lab session',
    sees: 'the new title',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'renameLabEntry', id: 'em_three', title: 'The f7 sacrifice' }),
        check: (st, who) => assert.equal(st.labEntries.find((e) => e.id === 'em_three')?.title, 'The f7 sacrifice', `${who}: title`),
      };
    },
  },
  {
    area: 'lab',
    does: 'deletes a Lab session',
    sees: 'the session gone',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deleteLabEntry', id: 'ez_one' }),
        check: (st, who) => assert.deepEqual(ids(st.labEntries), ['ea_two', 'em_three'], `${who}: session gone`),
      };
    },
  },
  {
    area: 'lab',
    does: 'rearranges the Lab sessions (no reducer action exists; mirrors a drag directly)',
    sees: 'the same Lab order',
    make() {
      return {
        apply: (st) => ({ ...st, labEntries: [st.labEntries[2], st.labEntries[0], st.labEntries[1]] }),
        check: (st, who) => assert.deepEqual(ids(st.labEntries), ['em_three', 'ez_one', 'ea_two'], `${who}: Lab order`),
      };
    },
  },

  // --------------------------------------------------- saved positions ---
  {
    area: 'positions',
    does: 'saves a Board Editor position',
    sees: 'the new position at the top',
    make() {
      const id = uid();
      return {
        apply: (st) => dispatch(st, { type: 'savePosition', id, name: 'Vancura', fen: '8/8/8/8/8/1r6/P3K3/k6R w - - 0 1' }),
        check(st, who) {
          const p = st.savedPositions.find((x) => x.id === id);
          assert.ok(p, `${who} has the new position`);
          assert.equal(p.fen, '8/8/8/8/8/1r6/P3K3/k6R w - - 0 1');
          assert.equal(ids(st.savedPositions)[0], id, `${who}: at the top`);
        },
      };
    },
  },
  {
    area: 'positions',
    does: 'deletes a saved position',
    sees: 'the position gone',
    make() {
      return {
        apply: (st) => dispatch(st, { type: 'deletePosition', id: 'sa_phi' }),
        check: (st, who) => assert.deepEqual(ids(st.savedPositions), ['sz_luc', 'sm_opp'], `${who}: position gone`),
      };
    },
  },
  {
    area: 'positions',
    does: 'rearranges the saved positions (no reducer action exists; mirrors a drag directly)',
    sees: 'the same position order',
    make() {
      return {
        apply: (st) => ({ ...st, savedPositions: [st.savedPositions[2], st.savedPositions[0], st.savedPositions[1]] }),
        check: (st, who) => assert.deepEqual(ids(st.savedPositions), ['sm_opp', 'sz_luc', 'sa_phi'], `${who}: position order`),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// The paths every change goes down
// ---------------------------------------------------------------------------

const PATHS = [
  { tag: 'three-way', author: 'mac', receiver: 'ipad' },
  { tag: 'three-way', author: 'ipad', receiver: 'mac' },
  { tag: 'careful path: author on its first sync after an update', author: 'mac', receiver: 'ipad', stripAuthor: true },
  { tag: 'careful path: receiver on its first sync after an update', author: 'mac', receiver: 'ipad', stripReceiver: true },
];

test('setup: the iPad gets the whole library from the Mac, in the Mac\'s order', async () => {
  const { mac, ipad } = await inSync();
  for (const key of ['players', 'categories', 'playlists', 'labEntries', 'savedPositions']) {
    assert.deepEqual(ipad[key], library()[key], `iPad ${key}`);
    assert.deepEqual(mac[key], library()[key], `Mac ${key}`);
  }
  intact(ipad, 'iPad');
});

for (const change of CHANGES) {
  for (const path of PATHS) {
    const A = NAMES[path.author];
    const R = NAMES[path.receiver];
    const who = path.stripAuthor ? `${A} (first sync after an update)` : A;
    const recv = path.stripReceiver ? `${R} (first sync after an update)` : R;
    test(`[${change.area}] ${who} ${change.does}, both sync → ${recv} sees ${change.sees} [${path.tag}]`, async () => {
      const devices = await inSync();
      const { apply, check } = change.make();

      let author = apply(devices[path.author]);
      if (path.stripAuthor) author = stripGen(author);
      check(author, `${A} before syncing (sanity: the mirrored action did what it should)`);
      author = await sync(path.author, author);
      intact(author, `${A} after its own sync`);
      check(author, `${A} right after its own sync`);

      let receiver = devices[path.receiver];
      if (path.stripReceiver) receiver = stripGen(receiver);
      receiver = await sync(path.receiver, receiver);
      intact(receiver, R);
      check(receiver, R);

      // It has to stay: the author hears the receiver's sync and syncs again,
      // and a new device signing in gets the account as it now is.
      author = await sync(path.author, author);
      intact(author, `${A} after ${R} synced`);
      check(author, `${A} after ${R} synced`);
      const iphone = await sync('iphone', blank());
      intact(iphone, 'a new iPhone');
      check(iphone, 'a new iPhone signing in');
    });
  }
}

// ---------------------------------------------------------------------------
// Both devices change something before either syncs
// ---------------------------------------------------------------------------

async function bothChangeThenSync(macChange, ipadChange) {
  const { mac, ipad } = await inSync();
  let m = await sync('mac', macChange(mac));
  let i = await sync('ipad', ipadChange(ipad));
  m = await sync('mac', m);
  i = await sync('ipad', i);
  const iphone = await sync('iphone', blank());
  return { mac: m, ipad: i, iphone };
}

test('[games] Mac and iPad each add a game to Alice before either syncs → both games on every device', async () => {
  const add = (name) => (st) => dispatch(st, { type: 'addGame', playerId: 'pa_alice', game: { name, moves: ['c4'] } });
  const out = await bothChangeThenSync(add('From the Mac'), add('From the iPad'));
  for (const [dev, st] of Object.entries(out)) {
    intact(st, dev);
    const names = player(st, 'pa_alice').games.map((g) => g.name);
    assert.ok(names.includes('From the Mac'), `${dev} has the Mac's game`);
    assert.ok(names.includes('From the iPad'), `${dev} has the iPad's game`);
  }
});

test('[games] Mac writes notes on a game while the iPad tags the same game → both on every device', async () => {
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'setGameNotes', playerId: 'pz_self', gameId: 'gz_one', notes: 'Mac notes' }),
    (st) => dispatch(st, { type: 'setGameTags', playerId: 'pz_self', gameId: 'gz_one', tags: ['iPad tag'] }),
  );
  for (const [dev, st] of Object.entries(out)) {
    assert.equal(findGame(st, 'gz_one').meta.notes, 'Mac notes', `${dev}: the Mac's notes`);
    assert.deepEqual(findGame(st, 'gz_one').tags, ['iPad tag'], `${dev}: the iPad's tags`);
  }
});

test('[games] Mac moves a game to Alice while the iPad writes notes on it (Mac syncs first) → the game is on Alice\'s card with the notes', async () => {
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'moveGameToPlayer', gameId: 'gm_three', fromPlayerId: 'pz_self', toPlayerId: 'pa_alice' }),
    (st) => dispatch(st, { type: 'setGameNotes', playerId: 'pz_self', gameId: 'gm_three', notes: 'Written on the iPad' }),
  );
  for (const [dev, st] of Object.entries(out)) {
    intact(st, dev);
    const g = findGame(st, 'gm_three');
    assert.equal(g?.owner, 'pa_alice', `${dev}: the game is on Alice's card`);
    assert.equal(g?.meta?.notes, 'Written on the iPad', `${dev}: with the iPad's notes`);
  }
});

test('[games] the iPad writes notes on a game while the Mac moves it to Alice (iPad syncs first) → the game is on Alice\'s card with the notes', async () => {
  const { mac, ipad } = await inSync();
  let i = await sync('ipad', dispatch(ipad, { type: 'setGameNotes', playerId: 'pz_self', gameId: 'gm_three', notes: 'Written on the iPad' }));
  let m = await sync('mac', dispatch(mac, { type: 'moveGameToPlayer', gameId: 'gm_three', fromPlayerId: 'pz_self', toPlayerId: 'pa_alice' }));
  i = await sync('ipad', i);
  m = await sync('mac', m);
  const iphone = await sync('iphone', blank());
  for (const [dev, st] of Object.entries({ mac: m, ipad: i, iphone })) {
    intact(st, dev);
    const g = findGame(st, 'gm_three');
    assert.equal(g?.owner, 'pa_alice', `${dev}: the game is on Alice's card`);
    assert.equal(g?.meta?.notes, 'Written on the iPad', `${dev}: with the iPad's notes`);
  }
});

test('[playlists] Mac reorders the Warm-up playlist while the iPad adds a line to it → both on every device', async () => {
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'movePlaylistItem', playlistId: 'lz_warm', variationId: 'va_three', dir: -1 }),
    (st) => dispatch(st, { type: 'addToPlaylist', playlistId: 'lz_warm', openingId: 'op_ck', chapterId: 'ch_ck', variationId: 'va_four' }),
  );
  for (const [dev, st] of Object.entries(out)) {
    assert.deepEqual(itemIds(st, 'lz_warm'), ['va_one', 'va_three', 'va_two', 'va_four'], `${dev}: the Mac's order and the iPad's line`);
  }
});

test('[playlists] Mac removes a line from a playlist while the iPad adds another to it → both on every device', async () => {
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'removeFromPlaylist', playlistId: 'lz_warm', variationId: 'va_one' }),
    (st) => dispatch(st, { type: 'addToPlaylist', playlistId: 'lz_warm', openingId: 'op_ck', chapterId: 'ch_ck', variationId: 'va_four' }),
  );
  for (const [dev, st] of Object.entries(out)) {
    assert.deepEqual(itemIds(st, 'lz_warm'), ['va_two', 'va_three', 'va_four'], `${dev}: the Mac's removal and the iPad's line`);
  }
});

test('[categories] Mac renames a category while the iPad adds one → both on every device', async () => {
  let added;
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'renameCategory', categoryId: 'cz_end', name: 'Endgame technique' }),
    (st) => { const next = dispatch(st, { type: 'addCategory', name: 'Openings' }); added = next.categories.at(-1).id; return next; },
  );
  for (const [dev, st] of Object.entries(out)) {
    assert.equal(st.categories.find((c) => c.id === 'cz_end').name, 'Endgame technique', `${dev}: the rename`);
    assert.ok(st.categories.some((c) => c.id === added), `${dev}: the new category`);
  }
});

test('[positions + lab] Mac saves a position and the iPad saves a Lab session before either syncs → both on every device', async () => {
  const out = await bothChangeThenSync(
    (st) => dispatch(st, { type: 'savePosition', id: 'snew_mac', name: 'From the Mac', fen: '8/8/8/8/8/8/8/K6k w - - 0 1' }),
    (st) => dispatch(st, { type: 'saveLabEntry', entry: { ...labEntry('enew_ipad', 'From the iPad'), createdAt: undefined, updatedAt: undefined } }),
  );
  for (const [dev, st] of Object.entries(out)) {
    assert.equal(ids(st.savedPositions)[0], 'snew_mac', `${dev}: the Mac's position, on top`);
    assert.equal(ids(st.labEntries)[0], 'enew_ipad', `${dev}: the iPad's session, on top`);
  }
});
