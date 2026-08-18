import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { movetextToLines, validateLine } from './lib/pgn';
import { setCustomSounds, setVolume } from './lib/sound';
import { defaultMonsterId } from './lib/monsters';

const STORAGE_KEY = 'repertoire-lab-state-v1';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------- Seed data (Caro-Kann Fantasy chapter from the reference screenshots) ----------

function seedVariation(name, movetext) {
  const line = movetextToLines(movetext)[0] ?? { moves: [], comments: {} };
  const result = validateLine(line.moves);
  return {
    id: uid(),
    name,
    moves: result.ok ? result.moves : [],
    comments: line.comments ?? {},
    learned: false,
    srs: null,
  };
}

// Defaults for anything the Settings tab controls. Merged over a restored
// state so an older backup gains new settings instead of missing them.
export const DEFAULT_SETTINGS = {
  anthropicKey: '',
  geminiKey: '',
  ocrEngine: 'tesseract',
  scoresheetEngine: 'claude',
  soundEnabled: true,
  volume: 1,
  pauseAtEnd: false, // wait at the end of a line instead of moving straight on
  practiceList: true, // the session's lines listed beside the practice board
  trainerSpeed: 'fast', // 'fast' | 'medium' | 'slow' — how quickly the trainer plays
  checkHighlight: true, // red glow under a king that's in check
  lastMoveHighlight: true, // pale mark on the squares of the move just played
  showLegalMoves: true, // dots on the squares a picked piece can go to
  hints: false, // reveal the answer's squares after repeated wrong tries
  evalBar: true, // the vertical engine evaluation beside the analysis board
  engineLines: true, // Stockfish's candidate lines under the board
  engineArrows: true, // draw the engine's suggestions on the board
  arrowBest: true, // …the first choice
  arrowSecond: true, // …the second
  arrowThird: true, // …the third
  engineAuto: true, // start Stockfish as soon as the analysis board opens
  bookMoves: true, // your own lines shown above the engine's on the board
  theme: 'dark', // 'dark' | 'light' | 'auto' (auto follows the time of day)
  lightFrom: 7, // hour the light theme starts under 'auto'
  darkFrom: 19, // hour the dark theme starts under 'auto'
};

export function emptyState() {
  return {
    openings: [],
    players: [],
    // Your own game categories, for openings the repertoire doesn't cover.
    categories: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

// Kept for reference — the app now starts empty so it's ready to share.
// eslint-disable-next-line no-unused-vars
function demoState() {
  return {
    openings: [
      {
        id: uid(),
        name: 'Caro-Kann',
        color: 'black',
        chapters: [
          {
            id: uid(),
            name: '4a) Caro-Kann: Fantasy Variation',
            variations: [
              seedVariation('Caro-Kann Fantasy Variation: 5.dxe5',
                '1.e4 c6 2.d4 d5 3.f3 dxe4 4.fxe4 e5 5.dxe5 Qh4+'),
              seedVariation('Caro-Kann Fantasy Variation: 5.Nf3 with 7.Bxf7+',
                '1.e4 c6 2.d4 d5 3.f3 dxe4 4.fxe4 e5 5.Nf3 Bg4 6.Bc4 Nd7 7.Bxf7+ Kxf7 8.Ng5+ Qxg5 9.Bxg5 Bxd1 10.Kxd1 exd4'),
              seedVariation('Caro-Kann Fantasy Variation: 5.Nf3 with 7.c3',
                '1.e4 c6 2.d4 d5 3.f3 dxe4 4.fxe4 e5 5.Nf3 Bg4 6.Bc4 Nd7 7.c3 Bd6 8.Qb3 Qe7 9.Qxb7 Rb8 10.Qxc6 Bxf3 11.gxf3 Ngf6'),
              seedVariation('Caro-Kann Fantasy Variation: 5.Nf3 with 7.O-O',
                '1.e4 c6 2.d4 d5 3.f3 dxe4 4.fxe4 e5 5.Nf3 Bg4 6.Bc4 Nd7 7.O-O Ngf6 8.dxe5 Bxf3 9.Qxf3 Nxe5 10.Qb3 Qd4+ 11.Kh1 Qxc4 12.Qxc4 Nxc4'),
            ].filter((v) => v.moves.length > 0),
          },
        ],
      },
    ],
    players: [],
    settings: { anthropicKey: '', ocrEngine: 'tesseract' },
  };
}

// ---------- Reducer ----------

function findOpening(state, openingId) {
  return state.openings.find((o) => o.id === openingId);
}

function mapOpening(state, openingId, fn) {
  return {
    ...state,
    openings: state.openings.map((o) => (o.id === openingId ? fn(o) : o)),
  };
}

function mapChapter(state, openingId, chapterId, fn) {
  return mapOpening(state, openingId, (o) => ({
    ...o,
    chapters: o.chapters.map((c) => (c.id === chapterId ? fn(c) : c)),
  }));
}

// ---------- Ordering helpers ----------

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

// Chapters live in one flat array but display grouped by section/sub-section,
// so a chapter only moves past its neighbours inside the same group.
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

// Groups keep first-appearance order; moving one shifts its whole block.
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

function mapPlayer(state, playerId, fn) {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? fn(p) : p)),
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'hydrate':
      // Older saved states may predate newer top-level fields.
      return {
        ...action.state,
        players: action.state.players ?? [],
        categories: action.state.categories ?? [],
      };
    // ---------- Courses (a repertoire by one author, inside an opening) ----------
    case 'addCourse': {
      const course = { id: action.id ?? uid(), name: action.name, artwork: null, collapsed: true };
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: [...(o.courses ?? []), course],
      }));
    }
    case 'renameCourse':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: (o.courses ?? []).map((c) => (
          c.id === action.courseId ? { ...c, name: action.name } : c)),
      }));
    case 'deleteCourse':
      // The chapters stay; they just come back out to the opening's top level.
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: (o.courses ?? []).filter((c) => c.id !== action.courseId),
        chapters: o.chapters.map((c) => (
          c.courseId === action.courseId ? { ...c, courseId: null } : c)),
      }));
    case 'setCourseArtwork':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: (o.courses ?? []).map((c) => (
          c.id === action.courseId ? { ...c, artwork: action.artwork } : c)),
      }));
    case 'toggleCourseCollapse':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: (o.courses ?? []).map((c) => (
          c.id === action.courseId ? { ...c, collapsed: !c.collapsed } : c)),
      }));
    case 'moveCourse':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        courses: moveInArray(o.courses ?? [], action.courseId, action.dir),
      }));
    case 'setChapterCourse':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        courseId: action.courseId || null,
      }));
    case 'addOpening': {
      const opening = {
        id: action.id ?? uid(),
        name: action.name,
        color: action.color ?? 'white',
        // null = your own; a student's player id = built for them. Whichever
        // scope the Library was showing when you hit "+ Add Opening" decides
        // this — see Library.jsx.
        ownerId: action.ownerId ?? null,
        chapters: [],
      };
      return { ...state, openings: [...state.openings, opening] };
    }
    case 'renameOpening':
      return mapOpening(state, action.openingId, (o) => ({ ...o, name: action.name }));
    case 'setOpeningColor':
      return mapOpening(state, action.openingId, (o) => ({ ...o, color: action.color }));
    case 'toggleOpeningCollapse':
      return mapOpening(state, action.openingId, (o) => ({ ...o, collapsed: !o.collapsed }));
    case 'setOpeningArtwork':
      return mapOpening(state, action.openingId, (o) => ({ ...o, artwork: action.artwork }));
    case 'setChapterSection':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        section: action.section || null,
        // Sub-sections only make sense inside a section.
        subsection: action.section ? (action.subsection ?? c.subsection ?? null) : null,
      }));
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
    case 'renameSection':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: o.chapters.map((c) => (c.section === action.from
          ? { ...c, section: action.to || null, subsection: action.to ? c.subsection : null }
          : c)),
      }));
    case 'toggleGroupCollapse':
      return mapOpening(state, action.openingId, (o) => {
        const collapsed = { ...(o.collapsedGroups ?? {}) };
        if (collapsed[action.key]) delete collapsed[action.key];
        else collapsed[action.key] = true;
        return { ...o, collapsedGroups: collapsed };
      });
    // Turn a whole top-level section into a sub-section of another one.
    case 'nestSection':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: o.chapters.map((c) => (c.section === action.from
          ? { ...c, section: action.under, subsection: action.from }
          : c)),
      }));
    // Promote a sub-section back to being its own section.
    case 'unnestSubsection':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: o.chapters.map((c) => (c.section === action.section && c.subsection === action.subsection
          ? { ...c, section: action.subsection, subsection: null }
          : c)),
      }));
    case 'renameSubsection':
      return mapOpening(state, action.openingId, (o) => ({
        ...o,
        chapters: o.chapters.map((c) => (c.section === action.section && c.subsection === action.from
          ? { ...c, subsection: action.to || null }
          : c)),
      }));
    case 'deleteOpening':
      return { ...state, openings: state.openings.filter((o) => o.id !== action.openingId) };
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
    case 'deleteVariations': {
      const gone = new Set(action.variationIds);
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.filter((v) => !gone.has(v.id)),
      }));
    }
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
    case 'recordPractice':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) =>
          v.id === action.variationId ? { ...v, learned: true, srs: action.srs } : v),
      }));
    case 'addCategory': {
      const name = action.name.trim();
      if (!name) return state;
      return { ...state, categories: [...(state.categories ?? []), { id: uid(), name }] };
    }
    case 'renameCategory':
      return {
        ...state,
        categories: (state.categories ?? []).map((c) => (
          c.id === action.categoryId ? { ...c, name: action.name } : c)),
      };
    case 'deleteCategory':
      return {
        ...state,
        categories: (state.categories ?? []).filter((c) => c.id !== action.categoryId),
        // Games filed under it fall back to automatic classification.
        players: state.players.map((p) => ({
          ...p,
          games: p.games.map((g) => (g.meta?.categoryId === `custom:${action.categoryId}`
            ? { ...g, meta: { ...g.meta, categoryId: null } }
            : g)),
        })),
      };
    case 'setGameCategory':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), categoryId: action.categoryId } }
          : g)),
      }));
    case 'moveGameToPlayer': {
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
    case 'addPlayer': {
      const id = action.id ?? uid();
      const player = {
        id,
        name: action.name,
        // 'self' (your own games) or 'student' (Coaches tab). Defaults to
        // 'self' for the ad-hoc "+ New group" spots that don't ask.
        kind: action.kind ?? 'self',
        // Who this person is elsewhere — used to fill in game details later.
        profile: action.profile ?? { uscf: '', fide: '', chesscom: '', lichess: '', rating: '' },
        // { kind: 'monster', variant } or { kind: 'photo', data }. Defaults to
        // a monster picked stably from their id — see lib/monsters.js.
        avatar: action.avatar ?? { kind: 'monster', variant: defaultMonsterId(id) },
        games: [],
      };
      return { ...state, players: [...state.players, player] };
    }
    case 'updatePlayer':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        name: action.name ?? p.name,
        profile: { ...(p.profile ?? {}), ...(action.profile ?? {}) },
        avatar: action.avatar ?? p.avatar,
      }));
    case 'renamePlayer':
      return mapPlayer(state, action.playerId, (p) => ({ ...p, name: action.name }));
    // Set from the one-time migration prompt (existing players predate the
    // self/student split) and from the Coaches/Games "move to the other tab"
    // action.
    case 'setPlayerKind':
      return mapPlayer(state, action.playerId, (p) => ({ ...p, kind: action.kind }));
    case 'deletePlayer':
      // Openings this student owned aren't deleted with them — they'd just be
      // silently unreachable otherwise. They stay in state.openings, orphaned
      // (ownerId pointing at a gone player), until reassigned or removed by
      // hand from the Library.
      return { ...state, players: state.players.filter((p) => p.id !== action.playerId) };
    case 'addGame': {
      const game = {
        id: uid(),
        name: action.game.name || 'Game',
        moves: action.game.moves,
        comments: action.game.comments ?? {},
        date: action.game.date ?? Date.now(),
        // OTB details worth keeping with a digitised scoresheet.
        meta: action.game.meta ?? null,
      };
      return mapPlayer(state, action.playerId, (p) => ({ ...p, games: [...p.games, game] }));
    }
    case 'updateGame':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, ...action.game } : g)),
      }));
    case 'renameGame':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, name: action.name } : g)),
      }));
    case 'deleteGame':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.filter((g) => g.id !== action.gameId),
      }));
    // ---------- Tags & favorites ----------
    // Tags work the same way at every level; a tag on a variation doubles as
    // the "nickname" that groups it with others ("bishop attacking plan").
    case 'setOpeningTags':
      return mapOpening(state, action.openingId, (o) => ({ ...o, tags: action.tags }));
    case 'setChapterTags':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({ ...c, tags: action.tags }));
    case 'setVariationTags':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, tags: action.tags } : v)),
      }));
    case 'toggleStar':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (v.id === action.variationId ? { ...v, starred: !v.starred } : v)),
      }));
    // Openings and chapters can be starred too; starring a container marks
    // everything inside it as a favorite for practice and for the Collections tab.
    case 'toggleChapterStar':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({ ...c, starred: !c.starred }));
    case 'toggleOpeningStar':
      return mapOpening(state, action.openingId, (o) => ({ ...o, starred: !o.starred }));
    case 'renameTag':
      return {
        ...state,
        openings: state.openings.map((o) => ({
          ...o,
          tags: (o.tags ?? []).map((t) => (t === action.from ? action.to : t)),
          chapters: o.chapters.map((c) => ({
            ...c,
            tags: (c.tags ?? []).map((t) => (t === action.from ? action.to : t)),
            variations: c.variations.map((v) => ({
              ...v,
              tags: (v.tags ?? []).map((t) => (t === action.from ? action.to : t)),
            })),
          })),
        })),
      };
    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    default:
      return state;
  }
}

// ---------- Context / persistence ----------

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      let saved = null;
      try { saved = await get(STORAGE_KEY); } catch { saved = null; }
      const base = saved ?? emptyState();
      dispatch({
        type: 'hydrate',
        state: { ...base, settings: { ...DEFAULT_SETTINGS, ...(base.settings ?? {}) } },
      });
      setLoaded(true);
    })();
  }, []);

  // Keep the audio layer in step with whatever sounds are configured.
  useEffect(() => {
    if (state?.settings) setCustomSounds(state.settings.customSounds);
  }, [state?.settings?.customSounds]);

  useEffect(() => {
    if (state?.settings) setVolume(state.settings.volume ?? 1);
  }, [state?.settings?.volume]);

  useEffect(() => {
    if (!loaded || !state) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      set(STORAGE_KEY, state).catch((err) => console.error('Failed to save state:', err));
    }, 400);
  }, [state, loaded]);

  if (!loaded || !state) {
    return <div className="loading-screen">Loading…</div>;
  }
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

// The fallback keeps a missing provider (only really possible mid hot-reload)
// from taking the whole app down while destructuring.
const NO_STORE = { state: null, dispatch: () => {} };

export function useStore() {
  return useContext(StoreContext) ?? NO_STORE;
}

export function useOpening(openingId) {
  const { state } = useStore();
  return findOpening(state, openingId);
}
