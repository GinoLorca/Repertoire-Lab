import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import { movetextToLines, validateLine } from './lib/pgn';
import { setCustomSounds, setVolume, setSoundSkin, primeSounds } from './lib/sound';
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
  moveTimer: false, // put a clock on each move in Learn and Practice
  moveTimerSeconds: 15, // …and how long you get before the move plays itself
  checkHighlight: true, // red glow under a king that's in check
  lastMoveHighlight: true, // pale mark on the squares of the move just played
  showLegalMoves: true, // dots on the squares a picked piece can go to
  showChapterVideos: true, // the video block at the top of a chapter's page
  showBoardBadges: true, // a badged move's coloured square + glyph, on the board itself
  showMoveListBadges: true, // …and the small glyph next to the move in a move list or note
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
  // Which palette the whole app wears — one of the themes, or 'custom' for
  // this app's own colours plus whatever's set below. Tournament Felt is what
  // a new account opens on: it's the one that looks like the game.
  //
  // This is the default for a FRESH install only. An app that has been used
  // before keeps what it's wearing, including the plain 'custom' look that
  // used to be the default — see the hydrate below, which pins it there. A
  // person who has never chosen a theme shouldn't have one chosen for them by
  // an update.
  skin: 'felt',
  skinWallpaper: true, // the chosen theme's own page background, behind everything
  // Your own picture behind the app, as a data URL, keyed by theme — each
  // theme shows its own, or the wallpaper it shipped with. `background` below
  // is the single pre-per-theme picture, read as Custom's; see backgroundFor.
  backgrounds: {},
  background: null,
  backgroundVeil: 70, // how much of the theme colour is laid over it, 0–95%
  surfaceOpacity: 100, // how solid cards and panels are over that picture, 40–100%
  boardOpacity: 100, // …and the board itself, on its own control
  squareLight: null, // board colours; null means the built-in pair
  squareDark: null,
  pieceLight: null, // piece inks; null means the built-in black-and-white set
  pieceDark: null,
  lightFrom: 7, // hour the light theme starts under 'auto'
  darkFrom: 19, // hour the dark theme starts under 'auto'
};

export function emptyState() {
  return {
    openings: [],
    players: [],
    // Your own game categories, for openings the repertoire doesn't cover.
    categories: [],
    // Hand-picked practice sets, cutting across whatever openings/chapters
    // the lines actually live in — see the Playlists cases below.
    playlists: [],
    // The Lab: saved analysis sessions — notes, the moves, and the arrows and
    // highlights drawn on each position. Independent of the repertoire, but a
    // session started from a repertoire line remembers where it came from.
    labEntries: [],
    // The Analysis board's unsaved, in-progress session — see 'setAnalysisDraft'.
    analysisDraft: null,
    // Board Editor positions saved for reuse — an endgame set up for a class,
    // a recurring structure, whatever's worth not rebuilding by hand again.
    savedPositions: [],
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
        playlists: action.state.playlists ?? [],
        labEntries: action.state.labEntries ?? [],
      };
    // ---------- Handing a repertoire to students ----------
    // A coach's students often play the coach's own lines. This copies chosen
    // openings onto one or more students, with the moves and the teaching
    // intact but the progress reset — recall is the student's own, and
    // inheriting someone else's schedule would tell the trainer they already
    // know lines they've never seen.
    //
    // Openings and chapters already there by name are merged into rather than
    // duplicated, so re-sending an updated repertoire tops it up instead of
    // leaving two copies side by side.
    case 'copyOpeningsToPlayers': {
      // The selection is a set of individual lines, which is the finest thing a
      // coach might want to hand over — one line, a chapter's worth, or a whole
      // opening are all just different sized sets of the same unit.
      const wanted = new Set(action.variationIds ?? []);
      if (wanted.size === 0) return state;

      // A real copy, not a shared reference. The arrays and objects inside a
      // variation have to be cloned too: spreading the variation alone would
      // leave the student's moves, comments and badges pointing at the coach's,
      // so editing one repertoire could reach into the other. The two are
      // separate from this moment on — nothing done to either side touches the
      // other again.
      const fresh = (variation) => ({
        ...variation,
        id: uid(),
        moves: [...(variation.moves ?? [])],
        comments: { ...(variation.comments ?? {}) },
        badges: { ...(variation.badges ?? {}) },
        tags: [...(variation.tags ?? [])],
        learned: false,
        srs: null,
        starred: false,
      });
      const freshChapter = (chapter, courseIds) => ({
        ...chapter,
        id: uid(),
        tags: [...(chapter.tags ?? [])],
        courseId: chapter.courseId ? (courseIds.get(chapter.courseId) ?? null) : null,
        variations: chapter.variations.map(fresh),
        starred: false,
      });
      const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

      let openings = state.openings;
      for (const targetId of action.playerIds) {
        // Only the openings that actually hold a selected line, trimmed to just
        // those lines.
        const sources = openings
          .filter((o) => (o.ownerId ?? null) === null)
          .map((o) => ({
            ...o,
            chapters: o.chapters
              .map((c) => ({ ...c, variations: c.variations.filter((v) => wanted.has(v.id)) }))
              .filter((c) => c.variations.length > 0),
          }))
          .filter((o) => o.chapters.length > 0);

        for (const source of sources) {
          const existing = openings.find((o) => (o.ownerId ?? null) === targetId
            && sameName(o.name, source.name));

          const courseIds = new Map();
          if (!existing) {
            const courses = (source.courses ?? []).map((c) => {
              const id = uid();
              courseIds.set(c.id, id);
              return { ...c, id, artwork: c.artwork ? { ...c.artwork } : null };
            });
            openings = [...openings, {
              ...source,
              id: uid(),
              ownerId: targetId,
              tags: [...(source.tags ?? [])],
              artwork: source.artwork ? { ...source.artwork } : null,
              starred: false,
              courses,
              chapters: source.chapters.map((ch) => freshChapter(ch, courseIds)),
            }];
            continue;
          }

          // Courses the student doesn't have yet, so a chapter arriving under
          // one still lands in the right place.
          const addedCourses = [];
          for (const c of source.courses ?? []) {
            const match = (existing.courses ?? []).find((e) => sameName(e.name, c.name));
            if (match) { courseIds.set(c.id, match.id); continue; }
            const id = uid();
            courseIds.set(c.id, id);
            addedCourses.push({ ...c, id, artwork: c.artwork ? { ...c.artwork } : null });
          }

          // Chapter by chapter: a chapter they don't have arrives whole; one
          // they do have gains only the lines whose names aren't in it yet.
          // Anything they've already got is left exactly as it is, so a
          // student's own work on a line is never overwritten by a re-send.
          const newChapters = [];
          let chapters = existing.chapters;
          for (const ch of source.chapters) {
            const mine = chapters.find((c) => sameName(c.name, ch.name));
            if (!mine) { newChapters.push(freshChapter(ch, courseIds)); continue; }
            const have = new Set(mine.variations.map((v) => v.name.trim().toLowerCase()));
            const missing = ch.variations.filter((v) => !have.has(v.name.trim().toLowerCase()));
            if (missing.length === 0) continue;
            chapters = chapters.map((c) => (c.id === mine.id
              ? { ...c, variations: [...c.variations, ...missing.map(fresh)] }
              : c));
          }

          openings = openings.map((o) => (o.id === existing.id ? {
            ...o,
            courses: [...(o.courses ?? []), ...addedCourses],
            chapters: [...chapters, ...newChapters],
          } : o));
        }
      }
      return { ...state, openings };
    }
    case 'importOpeningsForPlayer': {
      const arriving = action.openings.map((o) => {
        const courseIds = new Map();
        const courses = (o.courses ?? []).map((c) => {
          const id = uid();
          courseIds.set(c.id, id);
          return { ...c, id };
        });
        return {
          ...o,
          id: uid(),
          ownerId: action.playerId,
          courses,
          chapters: (o.chapters ?? []).map((ch) => ({
            ...ch,
            id: uid(),
            courseId: ch.courseId ? (courseIds.get(ch.courseId) ?? null) : null,
            variations: (ch.variations ?? []).map((v) => ({
              ...v,
              id: uid(),
              moves: [...(v.moves ?? [])],
              comments: { ...(v.comments ?? {}) },
              badges: { ...(v.badges ?? {}) },
            })),
          })),
        };
      });
      return { ...state, openings: [...state.openings, ...arriving] };
    }
    // Badge one move of one variation — the glyph a coach puts on a move.
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
    // (Move comments already have their own case further down — see
    // 'setMoveComment', which keys on moveIndex.)
    // ---------- The Lab (saved analysis sessions) ----------
    case 'saveLabEntry': {
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
    case 'deleteLabEntry':
      return { ...state, labEntries: (state.labEntries ?? []).filter((e) => e.id !== action.id) };
    case 'renameLabEntry':
      return {
        ...state,
        labEntries: (state.labEntries ?? []).map((e) => (
          e.id === action.id ? { ...e, title: action.title, updatedAt: new Date().toISOString() } : e)),
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
    // The video at the top of a chapter. `video` is metadata only (see
    // lib/videoStore.js for the actual file) — set to null to remove it. The
    // caller is responsible for deleting the stored blob first, since the
    // reducer has no way to run that async cleanup itself.
    case 'setChapterVideo':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        video: action.video,
      }));
    // The moment in that video where a variation's explanation starts. Clears
    // on its own if the video is ever removed — a stray timestamp with
    // nothing to seek in is silently ignored rather than tracked as an error.
    case 'setVariationTimestamp':
      return mapChapter(state, action.openingId, action.chapterId, (c) => ({
        ...c,
        variations: c.variations.map((v) => (
          v.id === action.variationId ? { ...v, videoTimestamp: action.seconds } : v)),
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
    // ---------- Playlists (hand-picked practice sets, cutting across
    // whatever openings/chapters the lines actually live in) ----------
    case 'addPlaylist': {
      const name = action.name.trim();
      if (!name) return state;
      const playlist = { id: action.id ?? uid(), name, items: [], shuffle: false };
      return { ...state, playlists: [...(state.playlists ?? []), playlist] };
    }
    case 'renamePlaylist':
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId ? { ...p, name: action.name } : p)),
      };
    case 'deletePlaylist':
      return { ...state, playlists: (state.playlists ?? []).filter((p) => p.id !== action.playlistId) };
    case 'setPlaylistShuffle':
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId ? { ...p, shuffle: action.shuffle } : p)),
      };
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
    case 'removeFromPlaylist':
      return {
        ...state,
        playlists: (state.playlists ?? []).map((p) => (
          p.id === action.playlistId
            ? { ...p, items: p.items.filter((it) => it.variationId !== action.variationId) }
            : p)),
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
    case 'setGameCategory':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), categoryId: action.categoryId } }
          : g)),
      }));
    // Quick in-context editing from the analysis board — what a coach jots
    // down while going over a game with a student. Notes are free text;
    // flags are a fixed, separate vocabulary (blunder, hung mate, time
    // trouble…) — see lib/gameFlags.js — deliberately not the repertoire's
    // free-form Themes, so scanning several games for a common pattern
    // means comparing the same handful of words every time, not whatever
    // synonym got typed that day.
    case 'setGameNotes':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), notes: action.notes } }
          : g)),
      }));
    // A game's own per-move comment/badge — the same idea as a repertoire
    // variation's, so editing one from its own viewer works the same way
    // wherever the moves came from.
    case 'setGameMoveComment':
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
    case 'setGameMoveBadge':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => {
          if (g.id !== action.gameId) return g;
          const badges = { ...(g.badges ?? {}) };
          if (action.badge) badges[action.ply] = action.badge;
          else delete badges[action.ply];
          return { ...g, badges };
        }),
      }));
    // The whole result of a Game Review in one go, rather than one dispatch
    // per move — badges keyed by ply, replacing whatever badges (hand-placed
    // or from an earlier review) were there before.
    case 'setGameBadges':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, badges: action.badges } : g)),
      }));
    // The whole comment map in one go — "Save changes" in Studio, alongside
    // setGameBadges above, rather than one dispatch per note.
    case 'setGameComments':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, comments: action.comments } : g)),
      }));
    // Arrows and square highlights drawn on the board, keyed by FEN the same
    // way a Lab entry's are — a game had nowhere to keep these until "Save
    // changes" gave it one.
    case 'setGameAnnotations':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, annotations: action.annotations } : g)),
      }));
    // The full move tree, alongside the flat `moves` every other feature
    // (the card preview, opening match, VariationViewer) already relies on —
    // this is purely additive, so it's the one thing "Save changes" writes
    // that nothing but Studio itself ever reads back. Set only once a game
    // actually has a variation worth keeping: without it, reopening in
    // Studio just rebuilds a trunk-only tree from `moves` as it always has.
    // variationHighlights rides along on the same dispatch since a
    // highlighted branch is meaningless without the tree it points into —
    // saving one without the other would leave them able to drift apart.
    case 'setGameTree':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, tree: action.tree, variationHighlights: action.variationHighlights }
          : g)),
      }));
    case 'setGameFlags':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), flags: action.flags } }
          : g)),
      }));
    // Free-form themes on a game, same idea (and the same TagEditor) as a
    // repertoire opening/chapter/variation's — search matches them too, so
    // "tag every game where the student missed a fork" makes them findable
    // as a set later.
    case 'setGameTags':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId ? { ...g, tags: action.tags } : g)),
      }));
    // A photo of the scoresheet — quick to grab in the moment (or for a game
    // there's no time to sit down and analyze), for reference later even
    // when there isn't time to enter and analyze the whole thing.
    case 'setGamePhoto':
      return mapPlayer(state, action.playerId, (p) => ({
        ...p,
        games: p.games.map((g) => (g.id === action.gameId
          ? { ...g, meta: { ...(g.meta ?? {}), photo: action.photo } }
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
        badges: action.game.badges ?? {},
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
    // Whatever's on the Analysis board right now, unsaved — so a backgrounded
    // tab that iOS reloads from scratch (a real risk on a phone or iPad,
    // switching apps mid-session) comes back exactly where it was instead of
    // a blank board. Overwritten on every change; cleared once the session
    // is explicitly saved to the Lab or abandoned with Reset.
    case 'setAnalysisDraft':
      return { ...state, analysisDraft: action.draft };
    case 'savePosition':
      return {
        ...state,
        savedPositions: [
          { id: action.id ?? uid(), name: action.name, fen: action.fen, createdAt: new Date().toISOString() },
          ...(state.savedPositions ?? []),
        ],
      };
    case 'deletePosition':
      return { ...state, savedPositions: (state.savedPositions ?? []).filter((p) => p.id !== action.id) };
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
      const settings = { ...DEFAULT_SETTINGS, ...(base.settings ?? {}) };
      // There was a time before themes, and a state saved then has no `skin`
      // at all. Filling that gap from the defaults would hand a theme to
      // someone who never picked one — which is exactly what they'd notice on
      // opening the app one morning. An install with history gets what it has
      // always had; only a first run gets the new default.
      if (saved && base.settings?.skin === undefined) settings.skin = 'custom';
      dispatch({ type: 'hydrate', state: { ...base, settings } });
      setLoaded(true);
    })();
  }, []);

  // Keep the audio layer in step with whatever sounds are configured — both
  // your own uploads and the set that came with the chosen theme.
  useEffect(() => {
    if (state?.settings) setCustomSounds(state.settings.customSounds);
  }, [state?.settings?.customSounds]);

  useEffect(() => {
    setSoundSkin(state?.settings?.skin);
    // Decode the new set now rather than on the first move that needs it.
    // Priming already runs when a session opens, but that happens before this
    // effect has told the audio layer which theme is on, so without this the
    // first themed move of the app's life arrives behind a fetch.
    primeSounds().catch(() => { /* no audio yet — the first play will fetch */ });
  }, [state?.settings?.skin]);

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

  // The 400ms debounce above is fine while the app stays open, but iOS can
  // (and does) suspend or fully discard a backgrounded tab/home-screen app
  // within that window — a move played right before switching apps, locking
  // the screen, or letting the device sleep would otherwise vanish with no
  // pending write to fall back on. `visibilitychange` fires reliably the
  // instant the page is hidden (app-switch, screen lock, sleep); `pagehide`
  // covers the same moment on browsers that skip it. Both flush immediately
  // instead of waiting on the timer, using a ref so this listener — set up
  // once — always writes whatever state is current, not what was current
  // when it was registered.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!loaded) return undefined;
    const flush = () => {
      clearTimeout(saveTimer.current);
      set(STORAGE_KEY, stateRef.current).catch((err) => console.error('Failed to save state:', err));
    };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [loaded]);

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
