import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import { useStore } from '../store';
import {
  schedule, isDue, dueCount, unlearnedCount, practicedCount, dueLabel,
} from '../lib/srs';
import { celebrate, warmUpConfetti } from '../lib/celebrate';
import { playMoveSound, playEventSound, primeSounds } from '../lib/sound';
import MoveText from '../components/MoveText';
import { useViewportWidth } from '../components/useViewportWidth';
import TagEditor, { TagChips, allTags } from '../components/TagEditor';
import VariationList from '../components/VariationList';
import MoveNote, { noteFor } from '../components/MoveNote';
import MoveTimer from '../components/MoveTimer';
import LegalDots from '../components/LegalDots';
import PromotionPicker from '../components/PromotionPicker';
import { lastMoveOf } from '../lib/legalMoves';
import { badgeAt } from '../lib/badges';
import BoardArrows from '../components/BoardArrows';
import { useBackGuard } from '../lib/backGuard';
import {
  BookIcon, TagIcon, StarIcon, SoundOnIcon, SoundOffIcon, ClockIcon, CommentIcon,
  SkipStartIcon, SkipEndIcon, PrevIcon, NextIcon, BulbIcon, TargetIcon, CheckIcon, AlertIcon,
  PlayIcon, CapIcon, FolderIcon, MonitorIcon,
} from '../components/Icons';
import PlaylistPicker from '../components/PlaylistPicker';

// Position key: piece placement + side to move + castling + en passant.
const fen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');

const DRILL_REPS = 3;

// How fast the trainer plays. `reply` is the pause before the other side
// answers, `anim` how long a piece takes to slide, `advance` the beat between
// drill repeats.
export const TRAINER_PACE = {
  fast: { reply: 450, anim: 150, advance: 850 },
  medium: { reply: 900, anim: 260, advance: 1400 },
  slow: { reply: 1600, anim: 400, advance: 2200 },
};

// "4." for White's 4th move, "4…" for Black's — how a move is named in text.
const plyLabel = (ply) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'}`;

// Build the session queue. Item kinds:
//   'learn'    — teach phase (moves shown) then a recall run; mistakes queue repairs
//   'practice' — recall only, no previews
//   'spot'     — one repeat of a single move that was missed, from the position
//                just before it; DRILL_REPS of these per missed move
//   'drill'    — a whole-line run; queued once after the spot drills to finish off
// Fisher-Yates — used for a playlist set to shuffle, so the order is
// genuinely random each run rather than array.sort's uneven bias.
function shuffleArray(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function collectItems(state, scope) {
  // A playlist is an explicit, ordered pick of specific lines from anywhere
  // in the repertoire — resolved directly, not scanned/filtered like every
  // other scope below. Lines removed since the playlist was built are
  // skipped rather than breaking the whole thing.
  if (scope?.playlistId) {
    const playlist = (state.playlists ?? []).find((p) => p.id === scope.playlistId);
    if (!playlist) return [];
    const resolved = playlist.items
      .map(({ openingId, chapterId, variationId }) => {
        const opening = state.openings.find((o) => o.id === openingId);
        const chapter = opening?.chapters.find((c) => c.id === chapterId);
        const variation = chapter?.variations.find((v) => v.id === variationId);
        return variation ? { opening, chapter, variation } : null;
      })
      .filter(Boolean);
    const ordered = scope.shuffle ? shuffleArray(resolved) : resolved;
    // A line already learned is drilled from memory; anything not yet
    // learned is taught first, same as it would be anywhere else.
    return ordered.map((it) => ({ ...it, kind: it.variation.learned ? 'practice' : 'learn' }));
  }

  const items = [];
  // A scope naming a specific opening/chapter/variation is unambiguous
  // regardless of who owns it. A broad one (the whole repertoire, every
  // favorite, everything tagged X) isn't — without this it would silently
  // mix a student's chapters into your own practice queue, and vice versa.
  // Yours (ownerId null) unless the scope says otherwise, e.g. Collections'
  // per-student "Practice" buttons.
  const broad = !(scope?.openingId || scope?.chapterId || scope?.chapterIds || scope?.variationId);
  const wantOwner = scope?.ownerId ?? null;
  for (const opening of state.openings) {
    if (broad && (opening.ownerId ?? null) !== wantOwner) continue;
    if (scope?.openingId && opening.id !== scope.openingId) continue;
    for (const chapter of opening.chapters) {
      if (scope?.chapterId && chapter.id !== scope.chapterId) continue;
      // A section / sub-section practice run passes several chapter ids.
      if (scope?.chapterIds && !scope.chapterIds.includes(chapter.id)) continue;
      for (const variation of chapter.variations) {
        if (scope?.variationId && variation.id !== scope.variationId) continue;
        // A star on the opening or chapter counts for everything inside it.
        if (scope?.starred && !(variation.starred || chapter.starred || opening.starred)) continue;
        if (scope?.tag) {
          // A tag anywhere up the chain counts — opening, chapter or variation.
          const tags = [...(opening.tags ?? []), ...(chapter.tags ?? []), ...(variation.tags ?? [])];
          if (!tags.includes(scope.tag)) continue;
        }
        items.push({ opening, chapter, variation });
      }
    }
  }
  const withKind = (it, kind) => ({ ...it, kind });

  // Starting on one variation shouldn't end the session when it's done —
  // carry on through the rest of the chapter from that point.
  if (scope?.variationId) {
    const kind = scope.mode ?? 'practice';
    const chapterItems = [];
    for (const opening of state.openings) {
      for (const chapter of opening.chapters) {
        if (!chapter.variations.some((v) => v.id === scope.variationId)) continue;
        for (const variation of chapter.variations) {
          chapterItems.push({ opening, chapter, variation });
        }
      }
    }
    const start = chapterItems.findIndex((it) => it.variation.id === scope.variationId);
    return chapterItems.slice(Math.max(0, start)).map((it) => withKind(it, kind));
  }
  if (scope?.mode === 'learn') {
    return items.filter((it) => !it.variation.learned).map((it) => withKind(it, 'learn'));
  }
  const due = items.filter((it) => isDue(it.variation));
  const fresh = items.filter((it) => !it.variation.learned);
  if (scope?.mode === 'practice') {
    const queue = [...due, ...fresh].map((it) => withKind(it, 'practice'));
    if (queue.length === 0 && (scope?.chapterId || scope?.chapterIds)) {
      const rest = items.filter((it) => it.variation.learned && !isDue(it.variation));
      queue.push(...rest.map((it) => withKind(it, 'practice')));
    }
    return queue;
  }
  // Default mixed session (Practice tab): due lines are recalled, new lines are taught.
  return [
    ...due.map((it) => withKind(it, 'practice')),
    ...fresh.map((it) => withKind(it, 'learn')),
  ];
}

// Chapters belonging to one course. `null` means the whole opening and
// NO_COURSE the chapters that were never filed under one.
const NO_COURSE = '__none';
const chaptersOf = (opening, courseId) => {
  if (courseId === null || courseId === undefined) return opening.chapters;
  if (courseId === NO_COURSE) return opening.chapters.filter((c) => !c.courseId);
  return opening.chapters.filter((c) => c.courseId === courseId);
};

const tally = (chapters) => chapters.reduce((acc, c) => ({
  due: acc.due + dueCount(c),
  fresh: acc.fresh + unlearnedCount(c),
  practiced: acc.practiced + practicedCount(c),
  total: acc.total + c.variations.length,
}), { due: 0, fresh: 0, practiced: 0, total: 0 });

// What's waiting, in words: due reviews first, then anything never learned.
function WorkNote({ t }) {
  if (t.total === 0) return <div className="sub">No lines yet</div>;
  const bits = [];
  if (t.due) bits.push(`${t.due} due`);
  if (t.fresh) bits.push(`${t.fresh} new`);
  return (
    <div className="sub">
      {bits.length ? bits.join(' · ') : `all ${t.total} up to date`}
      {t.total > 0 && <span className="muted-note"> · {t.practiced}/{t.total} practiced</span>}
    </div>
  );
}

// An opening with courses in it asks which author you mean, from a sheet that
// rises out of the bottom of the screen.
function CourseSheet({ opening, onPick, onClose }) {
  useBackGuard(true, onClose);
  const courses = opening.courses ?? [];
  const loose = chaptersOf(opening, NO_COURSE);

  const row = (key, artwork, title, chapters) => {
    const t = tally(chapters);
    return (
      <button key={key} className="sheet-row" onClick={() => onPick(key === 'all' ? null : key)}>
        {artwork ? <img className="scope-art small" src={artwork} alt="" /> : <span className="scope-art small blank"><CapIcon size={18} /></span>}
        <span className="sheet-row-text">
          <strong>{title}</strong>
          <WorkNote t={t} />
          <span className="muted-note">{chapters.length} chapter{chapters.length === 1 ? '' : 's'}</span>
        </span>
        <span className={`big-num${t.due === 0 ? ' zero' : ''}`}>{t.due || t.fresh || 0}</span>
      </button>
    );
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grab" aria-hidden="true" />
        <h3>{opening.name}</h3>
        <p className="hint">Whose course do you want to work on?</p>
        {courses.map((c) => row(c.id, c.artwork?.small, c.name, chaptersOf(opening, c.id)))}
        {loose.length > 0 && row(NO_COURSE, null, 'Not in a course', loose)}
        {row('all', opening.artwork?.small, `Everything in ${opening.name}`, opening.chapters)}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// One opening (or one author's course inside it), chapter by chapter, with what
// each one owes you today.
function ChapterPicker({ opening, courseId, onPractice, onBack }) {
  useBackGuard(true, onBack);
  const course = (opening.courses ?? []).find((c) => c.id === courseId);
  const chapters = chaptersOf(opening, courseId);
  const t = tally(chapters);
  // Due work first, then chapters with new lines, then everything else.
  const sorted = [...chapters].sort((a, b) => (dueCount(b) - dueCount(a))
    || (unlearnedCount(b) - unlearnedCount(a))
    || 0);
  const title = course?.name ?? (courseId === NO_COURSE ? 'Chapters without a course' : opening.name);
  const ids = chapters.map((c) => c.id);

  return (
    <div className="page">
      <div className="breadcrumb">
        <a onClick={onBack}>Practice</a>
        <span>▸</span>
        <span>{opening.name}</span>
        {course && <><span>▸</span><span>{course.name}</span></>}
      </div>
      <div className="page-head">
        {(course?.artwork?.small || opening.artwork?.small) && (
          <img className="scope-art" src={course?.artwork?.small ?? opening.artwork.small} alt="" />
        )}
        <h1>{title}</h1>
        <span style={{ flex: 1 }} />
        <button
          className="primary"
          disabled={t.total === 0}
          title="Every chapter here, due reviews first"
          onClick={() => onPractice({ openingId: opening.id, chapterIds: ids, mode: 'practice' })}
        >
          <PlayIcon size={15} /> Practice all{t.due ? ` (${t.due} due)` : ''}
        </button>
      </div>

      <div className="practice-summary">
        <WorkNote t={t} />
        {t.due === 0 && t.fresh === 0 && t.total > 0 && (
          <span className="muted-note">
            Nothing is due — picking a chapter still drills it whenever you like.
          </span>
        )}
      </div>

      {sorted.map((chapter) => {
        const due = dueCount(chapter);
        const fresh = unlearnedCount(chapter);
        // When nothing is due, say when the first line comes back.
        const soonest = chapter.variations
          .filter((v) => v.learned && v.srs?.due)
          .reduce((min, v) => (min === null || v.srs.due < min ? v.srs.due : min), null);
        const next = soonest === null ? null : dueLabel({ learned: true, srs: { due: soonest } });
        return (
          <div
            key={chapter.id}
            className={`scope-card chapter-scope${due ? ' has-due' : ''}`}
            onClick={() => chapter.variations.length
              && onPractice({ openingId: opening.id, chapterId: chapter.id, mode: 'practice' })}
          >
            <div className="scope-info">
              <h3>
                {chapter.name}
                {chapter.section && <span className="sub-chip">{chapter.section}</span>}
              </h3>
              <WorkNote t={{
                due, fresh, practiced: practicedCount(chapter), total: chapter.variations.length,
              }}
              />
              {due === 0 && fresh === 0 && next && (
                <div className="muted-note"><ClockIcon size={12} /> next review {next}</div>
              )}
            </div>
            <span className={`big-num${due === 0 ? ' zero' : ''}`}>{due || fresh || 0}</span>
          </div>
        );
      })}

      {chapters.length === 0 && (
        <div className="empty-note">No chapters here yet.</div>
      )}
    </div>
  );
}

function ScopePicker({ state, onPick, onBrowse, onOpenPlaylists }) {
  const allQueue = collectItems(state, null);
  const playlistCount = (state.playlists ?? []).length;
  return (
    <div className="page">
      <div className="page-head"><h1>Practice</h1></div>
      <div className="scope-card" onClick={() => allQueue.length && onPick(null)}>
        <div className="scope-info">
          <h3>Everything due &amp; new</h3>
          <div className="sub">Due reviews are quizzed; brand-new variations are taught first</div>
        </div>
        <span className={`big-num${allQueue.length === 0 ? ' zero' : ''}`}>{allQueue.length}</span>
      </div>
      <div className="scope-card" onClick={onOpenPlaylists}>
        <div className="scope-info">
          <h3><FolderIcon size={15} /> Playlists</h3>
          <div className="sub">Hand-pick lines from anywhere in your repertoire into a set of your own</div>
        </div>
        <span className={`big-num${playlistCount === 0 ? ' zero' : ''}`}>{playlistCount}</span>
        <span className="scope-chevron" aria-hidden="true">›</span>
      </div>
      {(() => {
        const starred = collectItems(state, { starred: true, mode: 'practice' }).length;
        if (!starred) return null;
        return (
          <div className="scope-card" onClick={() => onPick({ starred: true, mode: 'practice' })}>
            <div className="scope-info">
              <h3><StarIcon size={15} filled /> Favorites</h3>
              <div className="sub">Everything you've starred — lines, chapters and openings</div>
            </div>
            <span className="big-num">{starred}</span>
          </div>
        );
      })()}

      {(() => {
        // One row per tag in use, so a "plan" can be drilled on its own.
        const counts = new Map();
        for (const o of state.openings) {
          for (const c of o.chapters) {
            for (const v of c.variations) {
              for (const t of new Set([...(o.tags ?? []), ...(c.tags ?? []), ...(v.tags ?? [])])) {
                counts.set(t, (counts.get(t) ?? 0) + 1);
              }
            }
          }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, n]) => (
          <div key={tag} className="scope-card" onClick={() => onPick({ tag, mode: 'practice' })}>
            <div className="scope-info">
              <h3><TagIcon size={15} /> {tag}</h3>
              <div className="sub">Everything tagged “{tag}”</div>
            </div>
            <span className="big-num">{n}</span>
          </div>
        ));
      })()}

      {state.openings.map((o) => {
        const n = collectItems(state, { openingId: o.id }).length;
        const courses = (o.courses ?? []).length;
        return (
          <div
            key={o.id}
            className="scope-card"
            title={courses ? 'Choose a course, then a chapter' : 'See what each chapter owes you'}
            onClick={() => onBrowse(o.id)}
          >
            {o.artwork && <img className="scope-art" src={o.artwork.small} alt="" />}
            <div className="scope-info">
              <h3>{o.name}</h3>
              <div className="sub">
                {o.chapters.length} chapter{o.chapters.length === 1 ? '' : 's'}
                {courses > 0 && ` · ${courses} course${courses === 1 ? '' : 's'}`}
                {' · '}you play {o.color}
              </div>
            </div>
            <span className={`big-num${n === 0 ? ' zero' : ''}`}>{n}</span>
            <span className="scope-chevron" aria-hidden="true">›</span>
          </div>
        );
      })}
      {allQueue.length === 0 && (
        <div className="empty-note">Nothing due right now — import more lines or come back later.</div>
      )}
    </div>
  );
}

export default function PracticeView({ scope, onScopeChange, onExit, onAnalyze }) {
  const { state, dispatch } = useStore();
  const [queue, setQueue] = useState(null);
  // Choosing what to practice: an opening opens its course sheet (when it has
  // courses), and picking one lands on that course's chapters.
  const [sheetFor, setSheetFor] = useState(null); // opening id
  const [browse, setBrowse] = useState(null); // { openingId, courseId }
  const [viewingPlaylists, setViewingPlaylists] = useState(false);
  const [qi, setQi] = useState(0);
  const [ply, setPly] = useState(0);
  const [phase, setPhase] = useState('run'); // 'teach' | 'run'
  const [mistakes, setMistakes] = useState(0); // wrong moves in the run phase
  const [teachSlips, setTeachSlips] = useState(0); // wrong moves while copying shown moves
  const [attempts, setAttempts] = useState(0);
  // Which moves of this line were played wrong — each one earns spot drills.
  const [wrongPlies, setWrongPlies] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [results, setResults] = useState([]);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookPly, setBookPly] = useState(0);
  const [flipped, setFlipped] = useState(false); // F turns the board round
  // Guards the end-of-line handling so it runs once per item, after the board settles.
  const finishingRef = useRef(false);
  const [pickedSquare, setPickedSquare] = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null); // {from, to, color} awaiting a piece choice
  const [tagOpen, setTagOpen] = useState(false);
  // Timed moves: when the clock expires the move plays itself. `deadline` is
  // null whenever the board isn't actually waiting on you.
  const [deadline, setDeadline] = useState(null);
  // The move the clock played for you, so its note can be called out rather
  // than sliding past like any other.
  const [timedOutPly, setTimedOutPly] = useState(null);
  // A wrong move is shown by flying a copy of the piece to the square you
  // picked and slingshotting it home. The board itself never moves, so there's
  // no waiting on the board library to catch up.
  const [wrongMove, setWrongMove] = useState(null); // { from, to, html, phase }
  // Measured width of the layout row. Sizing the board from window.innerWidth
  // overflows a phone: the overflow widens the visual viewport, which feeds
  // back into an even wider board. The container never grows, so it's honest.
  const [layoutEl, setLayoutEl] = useState(null);
  const [layoutW, setLayoutW] = useState(0);
  // Non-null while looking back over moves already played this line.
  const [reviewPly, setReviewPly] = useState(null);
  const boardRef = useRef(null);
  const prevPlyRef = useRef(0);
  const touchRef = useRef(null);
  const viewportWidth = useViewportWidth();
  const soundOn = state.settings.soundEnabled ?? true;
  const showLegal = state.settings.showLegalMoves !== false;
  const hintsOn = !!state.settings.hints;
  // Only the drill repeats run back to back, and Settings can stop even those.
  const autoAdvance = !state.settings.pauseAtEnd;
  const timedMoves = !!state.settings.moveTimer;
  const moveTimerMs = Math.max(2, state.settings.moveTimerSeconds ?? 15) * 1000;
  // How quickly the trainer plays the other side and moves the pieces. A coach
  // watching a student wants time to talk over the moves; on your own you want
  // it out of the way.
  const pace = TRAINER_PACE[state.settings.trainerSpeed] ?? TRAINER_PACE.fast;

  useEffect(() => {
    if (!layoutEl || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setLayoutW(entry.contentRect.width));
    ro.observe(layoutEl);
    setLayoutW(layoutEl.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [layoutEl]);

  // Build the confetti canvas up front so the celebration at the end of a line
  // starts instantly instead of a beat after the card.
  useEffect(() => { warmUpConfetti(); primeSounds(); }, []);

  // Back closes the cheat sheet before it leaves the session.
  useBackGuard(bookOpen, () => setBookOpen(false));
  // A session started from the chapter list goes back to that list, not out of
  // Practice altogether — you're usually working down it.
  const cameFromList = !!browse && !!scope;
  useBackGuard(cameFromList && !bookOpen, () => onScopeChange(false));
  const leaveSession = () => (cameFromList ? onScopeChange(false) : onExit());

  const resetPerItem = (item) => {
    finishingRef.current = false; // a new item can finish again
    setPickedSquare(null);
    setReviewPly(null);
    // A spot drill opens on the position right before the move that was missed.
    setPly(item?.kind === 'spot' ? item.spotPly : 0);
    setMistakes(0);
    setTeachSlips(0);
    setWrongPlies([]);
    setAttempts(0);
    setCompleted(false);
    setWrongMove(null);
    setTimedOutPly(null);
    setFeedback(item?.kind === 'spot'
      ? { type: 'hint', text: `The move you missed — ${plyLabel(item.spotPly)}?` }
      : null);
    setPhase(item?.kind === 'learn' ? 'teach' : 'run');
  };

  // Build the queue once when scope is chosen (not reactively, so SRS updates
  // mid-session don't reshuffle it).
  useEffect(() => {
    if (scope !== undefined && scope !== false) {
      const items = collectItems(state, scope);
      setQueue(items);
      setQi(0);
      setResults([]);
      resetPerItem(items[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const current = queue?.[qi];
  const moves = current?.variation.moves ?? [];
  const userIsWhite = current?.opening.color === 'white';
  // The board faces the side you play; X turns it round (chess.com's key).
  const orientation = (userIsWhite ? 'white' : 'black') === 'white'
    ? (flipped ? 'black' : 'white')
    : (flipped ? 'white' : 'black');

  // The queue holds snapshots taken when the session started, so stars and tags
  // edited mid-session have to be read back out of the store to show up.
  const shown = useMemo(() => {
    if (!current) return null;
    return state.openings
      .find((o) => o.id === current.opening.id)?.chapters
      .find((c) => c.id === current.chapter.id)?.variations
      .find((v) => v.id === current.variation.id) ?? current.variation;
  }, [current, state.openings]);

  const game = useMemo(() => {
    const c = new Chess();
    // Clamped: a ply past the end of the line would throw on an undefined move
    // and take the whole session down with it.
    for (let i = 0; i < Math.min(ply, moves.length); i += 1) c.move(moves[i]);
    return c;
  }, [current, ply]); // eslint-disable-line react-hooks/exhaustive-deps

  const userTurn = current ? (game.turn() === 'w') === userIsWhite : false;

  // A spot drill is over as soon as its one move is played; everything else
  // runs to the end of the line.
  const endPly = current?.kind === 'spot'
    ? Math.min(current.spotPly + 1, moves.length)
    : moves.length;

  // Play a sound whenever the board advances by one move (user or opponent).
  useEffect(() => {
    const prev = prevPlyRef.current;
    prevPlyRef.current = ply;
    if (!current || !soundOn) return;
    if (ply === prev + 1 && ply > 0) playMoveSound(moves[ply - 1]);
  }, [ply]); // eslint-disable-line react-hooks/exhaustive-deps

  // ← / → walk back over the moves already played in this line. You can only
  // look as far forward as the live position, so nothing is ever spoiled.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || bookOpen) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setReviewPly((r) => Math.max(0, (r ?? ply) - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setReviewPly((r) => (r === null || r + 1 >= ply ? null : r + 1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setReviewPly(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, ply, bookOpen]);

  const reviewing = reviewPly !== null;
  const reviewFen = useMemo(() => {
    if (!reviewing) return null;
    const c = new Chess();
    for (let i = 0; i < reviewPly; i += 1) c.move(moves[i]);
    return c.fen();
  }, [reviewing, reviewPly, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arm the move clock only while the board is genuinely waiting on you: not
  // while the trainer is replying, not while a wrong move is flying home, and
  // not while you're reading the cheat sheet or stepping back through the line.
  // Each of those re-arms it at full time when you come back, so nothing runs
  // down behind a panel you had open.
  useEffect(() => {
    if (!timedMoves || !current) {
      setDeadline(null);
      return;
    }
    const waitingOnYou = userTurn && !completed && !reviewing && !bookOpen
      && !wrongMove && !!moves[ply];
    setDeadline(waitingOnYou ? Date.now() + moveTimerMs : null);
  }, [timedMoves, moveTimerMs, current, userTurn, completed, reviewing, bookOpen,
    wrongMove, ply, moves.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cheat-sheet ("book") preview position — independent of the practice board.
  const bookFen = useMemo(() => {
    const c = new Chess();
    for (let i = 0; i < Math.min(bookPly, moves.length); i += 1) c.move(moves[i]);
    return c.fen();
  }, [bookPly, current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the book jumps its preview to the current practice position.
  useEffect(() => {
    if (bookOpen) setBookPly(ply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookOpen, current?.variation.id]);

  // Arrow keys drive the book preview while it's open.
  useEffect(() => {
    if (!bookOpen || !current) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setBookPly((p) => Math.max(0, p - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setBookPly((p) => Math.min(moves.length, p + 1)); }
      else if (e.key === 'Escape') setBookOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookOpen, current, moves.length]);

  // Every position in the repertoire (for the side being practiced), so an
  // "off-line" move that reaches a position from another repertoire line —
  // an alternative correct move or a transposition — is accepted in practice.
  const positionIndex = useMemo(() => {
    const map = new Map();
    if (!current) return map;
    for (const opening of state.openings) {
      if (opening.color !== current.opening.color) continue;
      for (const chapter of opening.chapters) {
        for (const variation of chapter.variations) {
          const c = new Chess();
          for (let i = 0; i < variation.moves.length; i += 1) {
            try { c.move(variation.moves[i]); } catch { break; }
            const key = fen4(c.fen());
            if (!map.has(key)) map.set(key, []);
            map.get(key).push({ opening, chapter, variation, ply: i + 1 });
          }
        }
      }
    }
    return map;
  }, [state.openings, current?.opening.color]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent auto-play, teach→recall transition, and end-of-line handling.
  useEffect(() => {
    if (!current || completed) return undefined;
    if (ply >= endPly) {
      if (phase === 'teach') {
        setPhase('run');
        setPly(0);
        setAttempts(0);
        setFeedback({ type: 'hint', text: 'Now play the whole line from the start — from memory.' });
        return undefined;
      }
      if (finishingRef.current) return undefined;
      finishingRef.current = true;
      // Let the last piece finish sliding before any of this runs. The card,
      // the sound and the confetti all land together on a settled board —
      // starting them mid-slide is what made the final piece jump to its
      // square instead of moving there.
      const finish = () => {
      const totalMistakes = teachSlips + mistakes;
      // A spot drill is just one isolated move, not a real pass at the line —
      // it never touches the schedule. But the drill rep that CLOSES a repair
      // pass runs the whole variation again, same as a fresh full run, and a
      // clean one is exactly the moment "still learning" should clear — leave
      // it out and a slip you already fixed sits stuck as "learning" until an
      // unrelated review timer happens to come due, which is what showed up as
      // a chapter never actually reaching 100% despite everything in it having
      // been drilled correctly.
      const fullRun = current.kind === 'learn' || current.kind === 'practice';
      const closingDrill = current.kind === 'drill';
      if (fullRun || closingDrill) {
        const record = {
          type: 'recordPractice',
          openingId: current.opening.id,
          chapterId: current.chapter.id,
          variationId: current.variation.id,
          // The closing drill runs after the original attempt's own dispatch
          // (below) has already landed in the store — schedule off `shown`,
          // the live variation, not `current.variation`, the snapshot frozen
          // when this queue was built; that snapshot predates the mistake this
          // drill is repairing, so scheduling off it would silently discard
          // the lapse that mistake just recorded.
          srs: schedule(closingDrill ? shown.srs : current.variation.srs, totalMistakes === 0),
        };
        // Written on the next frame, after the card has painted. Updating the
        // store re-renders everything under it — with a repertoire of several
        // hundred lines that is long enough to be felt as a pause at the end of
        // every variation, and none of it is needed to show the card.
        requestAnimationFrame(() => dispatch(record));
      }
      // Repair only the moves that actually went wrong: DRILL_REPS reps of each
      // missed move, then a single run of the whole line to tie it together.
      const spots = fullRun ? [...new Set(wrongPlies)].sort((a, b) => a - b) : [];
      if (fullRun) {
        const base = {
          opening: current.opening,
          chapter: current.chapter,
          variation: current.variation,
        };
        const repairs = spots.length > 0
          ? [
            ...spots.flatMap((spotPly) => Array.from({ length: DRILL_REPS }, (_, i) => ({
              ...base, kind: 'spot', spotPly, rep: i + 1,
            }))),
            { ...base, kind: 'drill', rep: 1, final: true },
          ]
          : [];
        // This run's mistakes replace the last one's. Learn again / Practice
        // again replay the same queue slot, so without this the drills from the
        // earlier attempt stay queued behind it — stacking duplicates when you
        // slip twice, and, after a clean replay, leaving a repair sitting there
        // that the finish bar then announces instead of the next line.
        setQueue((q) => {
          const rest = q.slice(qi + 1);
          let stale = 0;
          while (stale < rest.length
            && (rest[stale].kind === 'spot' || rest[stale].kind === 'drill')
            && rest[stale].variation.id === current.variation.id) stale += 1;
          if (stale === 0 && repairs.length === 0) return q;
          return [...q.slice(0, qi + 1), ...repairs, ...rest.slice(stale)];
        });
      }
      setResults((r) => [...r, {
        name: current.variation.name,
        variationId: current.variation.id,
        mistakes: totalMistakes,
        kind: current.kind,
        rep: current.rep,
        spotPly: current.spotPly,
      }]);
      setCompleted(true);
      // The complete sound and the confetti both mark finishing something, not
      // every repetition: a clean line first time, or the full run that closes
      // out a set of repairs. The spot-drill reps in between pass quietly —
      // otherwise "line complete" fires on every one of the DRILL_REPS retries.
      //
      // Fired straight away, with the card: the confetti canvas and its worker
      // were built when the session opened (warmUpConfetti), so starting a
      // burst no longer costs anything and the two land together.
      const closedRepairs = current.kind === 'drill';
      if (fullRun || closedRepairs) {
        if (soundOn) playEventSound('complete');
        if (totalMistakes === 0) celebrate(boardRef.current, 1);
      }
      const spotWord = spots.length === 1 ? 'move' : 'moves';
      setFeedback({
        type: totalMistakes === 0 ? 'good' : 'hint',
        text: current.kind === 'spot'
          ? `${plyLabel(current.spotPly)}${moves[current.spotPly]} — rep ${current.rep} of ${DRILL_REPS}.`
          : current.kind === 'drill'
            ? (totalMistakes === 0 ? 'Clean run — mistake practice done.' : `Full run done — ${totalMistakes} slip${totalMistakes === 1 ? '' : 's'}.`)
            : spots.length > 0
              ? `${spots.length} ${spotWord} missed — ${DRILL_REPS} reps of each coming up, then one full run.`
              : totalMistakes === 0 ? 'Perfect!' : `Done — ${totalMistakes} mistake${totalMistakes === 1 ? '' : 's'}.`,
      });
      };

      // Wait for the board to actually stop moving rather than guessing how
      // long that takes: a slower device, a bigger repertoire or a busy frame
      // all stretch the slide, and finishing early is what put the card and the
      // confetti on top of a piece still on its way to its square.
      const stillSliding = () => {
        const el = boardRef.current;
        if (!el) return false;
        return [...el.querySelectorAll('[data-piece]')].some((piece) => {
          const t = getComputedStyle(piece).transform;
          return t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
        });
      };
      const startedAt = performance.now();
      let raf = 0;
      let stillFrames = 0;
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        finish();
      };
      // requestAnimationFrame stops firing in a hidden tab, so the 900ms ceiling
      // below is only a ceiling while the app is on screen. Background the app
      // exactly as a line ends and the card would never arrive. This makes the
      // ceiling real; whichever path gets there first wins, and `done` keeps the
      // ending from running twice.
      const ceiling = setTimeout(settle, 950);
      const tick = () => {
        const waited = performance.now() - startedAt;
        // A short grace period first, so we don't declare it settled before the
        // animation has begun; and a ceiling, so nothing can hold the card up.
        if (waited < 900) {
          if (waited < 70 || stillSliding()) {
            stillFrames = 0;
            raf = requestAnimationFrame(tick);
            return;
          }
          // The board library drops the piece into its square a frame or two
          // after the slide ends. Wait for that, or the celebration lands in
          // the gap and the piece looks like it arrives afterwards.
          stillFrames += 1;
          if (stillFrames < 4) {
            raf = requestAnimationFrame(tick);
            return;
          }
        }
        // The board is settled — finish immediately. The last move stays lit on
        // its squares while the card is up, so it can be read without the
        // ending being held back for it.
        settle();
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(ceiling);
        finishingRef.current = false;
      };
    }
    if (!userTurn) {
      // The reply that ends the line comes back quickly: the pause exists to
      // give you time to read the opponent's move before answering it, and
      // there's nothing left to answer. Waiting the full beat here is the lag
      // you feel between your last move and the card.
      //
      // Not while teaching, though: there the last reply is the run-up to
      // "now play it from memory", and rushing it makes the hand-off jarring.
      const lastOfLine = ply + 1 >= endPly && phase !== 'teach';
      // Never shorter than the piece animation plus a margin: land the next
      // position while the previous move is still sliding and the board snaps
      // instead of moving, which looks like a piece appearing out of nowhere.
      const quick = pace.anim + 40;
      const t = setTimeout(() => setPly((p) => p + 1), lastOfLine ? quick : pace.reply);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ply, current, userTurn, completed, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (index) => {
    if (!queue || index < 0 || index >= queue.length) return;
    setQi(index);
    resetPerItem(queue[index]);
  };

  const nextVariation = () => {
    // Stepping past the last item is what shows the session summary, so this
    // deliberately allows qi to run one past the end.
    const next = queue?.[qi + 1];
    setQi((i) => i + 1);
    resetPerItem(next);
  };

  // The two finish-bar retries, forcing the phase resetPerItem would
  // otherwise pick from the item's own kind — which for a just-learned item
  // (kind 'learn') is 'teach' either way, making both buttons behave
  // identically right when it matters most (the line you just learned).
  const learnAgain = () => {
    resetPerItem(current);
    setPhase('teach'); // moves shown again first
  };
  const practiceAgain = () => {
    resetPerItem(current);
    setPhase('run'); // straight to blind recall — the actual test
  };

  // Move straight on when a line is finished, rather than dropping out of the
  // session. A short pause leaves time to read the result and see the confetti.
  useEffect(() => {
    if (!completed || !autoAdvance) return undefined;
    if (qi + 1 >= (queue?.length ?? 0)) return undefined;
    // Repetitions flow into each other; every change of exercise waits for a
    // press. Starting the repairs, starting the closing full run and leaving it
    // all replay the line from move 1, so moving on unasked reads as the app
    // deciding for you.
    // Only one drill repetition rolling into the next happens on its own.
    // Finishing a variation always stops on the card — being moved to the next
    // line before you've read the result is the thing nobody wants.
    if (!(current?.kind === 'spot' && queue[qi + 1]?.kind === 'spot')) return undefined;
    // Drill repeats run back to back; a finished line gets a beat longer so the
    // result and the confetti register.
    const wait = pace.advance;
    const t = setTimeout(nextVariation, wait);
    return () => clearTimeout(t);
  }, [completed, autoAdvance, qi, queue?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ↑ / ↓ step between variations; ← / → review moves inside the current one.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || bookOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const settings = (patch) => dispatch({ type: 'setSettings', settings: patch });
      if (e.key === 'ArrowUp') { e.preventDefault(); goTo(qi - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goTo(qi + 1); }
      // The board keys work the same here as on the analysis board — F flips
      // (X is freed up there for the hold-to-draw-blue pen shortcut).
      else if (e.key === 'f' || e.key === 'F') setFlipped((f) => !f);
      else if (e.key === 'k' || e.key === 'K') settings({ checkHighlight: state.settings.checkHighlight === false });
      else if (e.key === 'h' || e.key === 'H') setAttempts((a) => Math.max(a, 2));
      else if (e.key === 'b' || e.key === 'B') setBookOpen((o) => !o);
      else if (e.key === 'l' || e.key === 'L') settings({ practiceList: state.settings.practiceList === false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, qi, queue?.length, bookOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Run the flight with the Web Animations API so the ghost is removed exactly
  // when it lands — never part way — with a timer only as a safety net.
  const ghostRef = useRef(null);
  useEffect(() => {
    if (!wrongMove) return undefined;
    const el = ghostRef.current;
    const { home, away } = wrongMove;
    const at = (p) => `translate(${p.x}px, ${p.y}px)`;
    let anim = null;
    if (el?.animate) {
      anim = el.animate(
        [
          { transform: at(home), offset: 0, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
          { transform: at(away), offset: 0.34, easing: 'linear' },
          { transform: at(away), offset: 0.5, easing: 'cubic-bezier(0.34, 1.8, 0.5, 1)' },
          { transform: at(home), offset: 1 },
        ],
        { duration: 320, fill: 'forwards' },
      );
      anim.onfinish = () => setWrongMove(null);
    }
    // If animations are paused (a background tab), don't strand the ghost.
    const safety = setTimeout(() => setWrongMove(null), 700);
    return () => {
      clearTimeout(safety);
      if (anim) anim.cancel();
    };
  }, [wrongMove]);

  // The real piece hides while its double is away, so there's never two of it.
  useEffect(() => {
    const el = wrongMove
      && boardRef.current?.querySelector(`[data-square="${wrongMove.from}"] [data-piece]`);
    if (el) el.style.visibility = 'hidden';
    return () => {
      if (el) el.style.visibility = '';
      // You can play on while the copy is still in the air, so make sure no
      // piece is ever left invisible.
      boardRef.current?.querySelectorAll('[data-piece]').forEach((p) => {
        if (p.style.visibility === 'hidden') p.style.visibility = '';
      });
    };
  }, [wrongMove?.from, !!wrongMove]); // eslint-disable-line react-hooks/exhaustive-deps

  if (scope === undefined || scope === false) {
    const opening = state.openings.find((o) => o.id === (browse?.openingId ?? sheetFor));
    if (browse && opening) {
      return (
        <ChapterPicker
          opening={opening}
          courseId={browse.courseId}
          onBack={() => setBrowse(null)}
          onPractice={(s) => onScopeChange(s)}
        />
      );
    }
    if (viewingPlaylists) {
      return (
        <PlaylistPicker
          state={state}
          dispatch={dispatch}
          onPractice={(s) => onScopeChange(s)}
          onBack={() => setViewingPlaylists(false)}
        />
      );
    }
    return (
      <>
        <ScopePicker
          state={state}
          onPick={(s) => onScopeChange(s ?? {})}
          onOpenPlaylists={() => setViewingPlaylists(true)}
          onBrowse={(openingId) => {
            const o = state.openings.find((x) => x.id === openingId);
            // Straight to the chapters when there's only one author involved.
            if ((o?.courses ?? []).length === 0) setBrowse({ openingId, courseId: null });
            else setSheetFor(openingId);
          }}
        />
        {sheetFor && opening && (
          <CourseSheet
            opening={opening}
            onClose={() => setSheetFor(null)}
            onPick={(courseId) => {
              setSheetFor(null);
              setBrowse({ openingId: opening.id, courseId });
            }}
          />
        )}
      </>
    );
  }
  if (!queue) return <div className="page"><div className="empty-note">Loading…</div></div>;

  if (!current) {
    return (
      <div className="page">
        <div className="page-head"><h1>Session complete</h1></div>
        <div className="practice-status">
          {results.length === 0 ? (
            <p>Nothing to practice in this selection.</p>
          ) : (
            <>
              <h3>{results.length} run{results.length === 1 ? '' : 's'} completed</h3>
              {results.map((r, i) => (
                <div key={i} className="sub">
                  {r.mistakes === 0 ? <CheckIcon size={14} className="done-tick" /> : <AlertIcon size={14} className="warn-tick" />} {r.name}
                  {r.kind === 'spot' ? ` (spot ${plyLabel(r.spotPly)} · ${r.rep}/${DRILL_REPS})` : ''}
                  {r.kind === 'drill' ? ' (full run)' : ''} — {r.mistakes} mistake{r.mistakes === 1 ? '' : 's'}
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 14 }}>
            <button className="primary" onClick={leaveSession}>
              {cameFromList ? 'Back to the chapter list' : 'Back to library'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const expectedSan = moves[ply];

  // The move just played is marked by the board itself (see Board.jsx).
  const lastMove = reviewing ? null : lastMoveOf(Chess, moves, ply);

  // Teach preview (green, always shows the move) and recall hints (amber,
  // after failed attempts / hint button).
  let squares = {};
  let arrows = [];
  if (userTurn && !completed && expectedSan) {
    try {
      const clone = new Chess(game.fen());
      const mv = clone.move(expectedSan);
      if (phase === 'teach') {
        squares = {
          ...squares,
          [mv.from]: { background: 'rgba(46, 204, 113, 0.55)' },
          [mv.to]: { background: 'rgba(46, 204, 113, 0.35)' },
        };
        arrows = [[mv.from, mv.to, '#2ecc71']];
      } else if (hintsOn && attempts >= 2) {
        squares = { ...squares, [mv.from]: { background: 'rgba(232, 179, 57, 0.65)' } };
        if (attempts >= 3) squares[mv.to] = { background: 'rgba(232, 179, 57, 0.45)' };
      }
    } catch { /* ignore */ }
  }

  // A non-expected move that reaches a position occurring in another
  // repertoire line is accepted (practice runs only — while learning or
  // drilling a specific line, stick to it).
  const findTransposition = (resultFen) => {
    if (current.kind !== 'practice') return null;
    const hits = positionIndex.get(fen4(resultFen)) ?? [];
    const usable = hits.filter(
      (h) => !(h.variation.id === current.variation.id && h.ply <= ply),
    );
    const score = (h) =>
      (h.variation.id === current.variation.id ? 4 : 0) +
      (h.chapter.id === current.chapter.id ? 2 : 0) +
      (h.opening.id === current.opening.id ? 1 : 0);
    return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
  };

  const markWrong = (p) => setWrongPlies((w) => (w.includes(p) ? w : [...w, p]));

  // Copy the piece that was moved so a double can fly to the wrong square, and
  // work out the flight now — mid-flight re-renders must not disturb it.
  const flashWrong = (from, to) => {
    const el = boardRef.current?.querySelector(`[data-square="${from}"] [data-piece]`);
    const size = boardWidth / 8;
    const at = (square) => {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      return userIsWhite
        ? { x: file * size, y: (7 - rank) * size }
        : { x: (7 - file) * size, y: rank * size };
    };
    const home = at(from);
    const away = at(to);
    setWrongMove({
      from, to, size, home, away, html: el?.outerHTML ?? '', at: Date.now(),
    });
  };


  // The clock ran out. Play the move rather than leaving the board stuck: the
  // point of timing a session is that it keeps moving, and watching the answer
  // played — with the author's note on it — is the teaching moment.
  const onTimeUp = () => {
    setDeadline(null);
    const san = moves[ply];
    if (!san || !userTurn || completed) return;
    setPickedSquare(null);
    setAttempts(0);
    // While teaching, the move is already drawn on the board — running out of
    // time there is slowness, not a failed recall, so it costs nothing. In the
    // recall phases it counts like any other miss and earns its spot drill.
    if (phase !== 'teach') {
      setMistakes((m) => m + 1);
      markWrong(ply);
    }
    setTimedOutPly(ply);
    setPly((p) => p + 1); // the move sound follows from the ply advancing
    setFeedback({ type: 'hint', text: `Time — ${san} played for you` });
  };

  // Tap/click a piece then its destination — works with a trackpad, a mouse
  // or a finger, and doesn't depend on drag support at all.
  const onSquareClick = (square) => {
    if (!userTurn || completed) return;
    if (pickedSquare) {
      const played = onPieceDrop(pickedSquare, square);
      setPickedSquare(played ? null : (game.get(square) ? square : null));
      return;
    }
    const piece = game.get(square);
    if (piece && (piece.color === 'w') === userIsWhite) setPickedSquare(square);
  };

  // Split out from onPieceDrop so a promotion pick — which arrives on its own
  // tap, after the drop that triggered the picker — can play the same move
  // once the piece is actually known, instead of always defaulting to queen.
  const commitMove = (from, to, promotion) => {
    setPendingPromotion(null);
    const clone = new Chess(game.fen());
    let mv = null;
    try { mv = clone.move({ from, to, promotion: promotion ?? 'q' }); } catch { mv = null; }
    if (!mv) return false;
    if (mv.san === expectedSan) {
      setPly((p) => p + 1);
      setAttempts(0);
      setTimedOutPly(null); // you've moved on; the clock's note can go
      if (soundOn) playEventSound('correct');
      setFeedback({ type: 'good', text: 'Correct!' });
      return true;
    }
    if (phase === 'teach') {
      if (soundOn) playEventSound('wrong');
      setTeachSlips((m) => m + 1);
      markWrong(ply);
      flashWrong(mv.from, mv.to);
      setFeedback({ type: 'bad', text: `Play the highlighted move: ${expectedSan}` });
      return false; // the board never moves; the ghost shows what you played
    }
    const hit = findTransposition(clone.fen());
    if (hit) {
      const sameLine = hit.variation.id === current.variation.id;
      setQueue((q) => q
        .map((it, idx) => (idx === qi
          ? { opening: hit.opening, chapter: hit.chapter, variation: hit.variation, kind: 'practice' }
          : it))
        .filter((it, idx) => idx === qi || it.variation.id !== hit.variation.id));
      setPly(hit.ply);
      setAttempts(0);
      setFeedback({
        type: 'good',
        text: sameLine
          ? `${mv.san} transposes ahead in this line`
          : `${mv.san} is also in your repertoire — continuing in “${hit.variation.name}”`,
      });
      return true;
    }
    if (soundOn) playEventSound('wrong');
    setMistakes((m) => m + 1);
    markWrong(ply);
    setAttempts((a) => a + 1);
    // Let the piece land so you see what you played, then put it back.
    flashWrong(mv.from, mv.to);
    const giveAway = hintsOn && attempts + 1 >= 3;
    setFeedback({
      type: giveAway ? 'hint' : 'bad',
      text: giveAway ? `The move is ${expectedSan}` : `${mv.san} isn't the move here — try again`,
    });
    return false;
  };

  const onPieceDrop = (from, to) => {
    if (!userTurn || completed) return false;
    setPickedSquare(null);
    let needsChoice = false;
    try {
      needsChoice = game.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
    } catch { needsChoice = false; }
    if (needsChoice) {
      setPendingPromotion({ from, to, color: game.turn() });
      return false; // the board waits; the picker decides which piece lands
    }
    return commitMove(from, to);
  };

  const kindTag = current.kind === 'spot'
    ? {
      cls: 'phase-drill',
      text: `Spot drill ${current.rep} of ${DRILL_REPS} — move ${plyLabel(current.spotPly)}`,
    }
    : current.kind === 'drill'
    ? {
      cls: 'phase-drill',
      text: current.final ? 'Final run — the whole line, once' : `Drill ${current.rep} of ${DRILL_REPS}`,
    }
    : phase === 'teach'
      ? { cls: 'phase-teach', text: 'Learn — copy the shown moves' }
      : current.kind === 'learn'
        ? { cls: 'phase-recall', text: 'Recall — from memory' }
        : { cls: 'phase-practice', text: 'Practice' };

  // The lines of this session, once each — the repair items that get spliced in
  // belong to a line that's already listed.
  const listItems = [];
  const seenIds = new Set();
  for (const item of queue) {
    if (seenIds.has(item.variation.id)) continue;
    seenIds.add(item.variation.id);
    listItems.push(item);
  }
  const doneIds = new Set(results.map((r) => r.variationId).filter(Boolean));
  const courseName = (current.opening.courses ?? [])
    .find((c) => c.id === current.chapter.courseId)?.name ?? null;
  // A shuffled playlist is meant to be a surprise, one line at a time — the
  // list would spoil what's coming up next, so it doesn't get a place here
  // at all (not even collapsed), regardless of the viewport-width case below.
  const isShuffledPlaylist = !!(scope?.playlistId && scope?.shuffle);
  // The list only earns its place when the board and the status panel still
  // have room — below this it squeezes the panel down to a one-word-per-line
  // column, which is worse than not having the list at all.
  const showList = viewportWidth >= 1180 && !isShuffledPlaylist;
  const listOpen = showList && state.settings.practiceList !== false;
  // Share the row out deliberately: the list, then the card that names the line
  // and reads out the coaching, then whatever's left is the board. Sizing the
  // board first is what pushed the card onto its own row underneath.
  const SIDE_MIN = 330; // .practice-side's floor, plus a little breathing room
  const GAP = listOpen ? 18 : 26;
  const listW = listOpen ? 244 : (showList ? 34 : 0);
  const rowFits = viewportWidth >= 900; // below this the card sits under the board
  const avail = Math.floor(layoutW || viewportWidth - 48);
  const forBoard = rowFits
    ? avail - listW - (listW ? GAP : 0) - SIDE_MIN - GAP
    : avail;
  // Tall boards need the same treatment vertically, and whole squares only.
  const tallCap = Math.max(280, (typeof window === 'undefined' ? 900 : window.innerHeight) - 210);
  const boardWidth = Math.floor(
    Math.max(240, Math.min(720, forBoard, tallCap)) / 8,
  ) * 8;

  // After a mistake the queue holds repairs of this same line — a spot drill of
  // each missed move, then one full run. What comes next isn't a new variation,
  // so it shouldn't claim to be.
  const upcoming = queue[qi + 1];
  const retryNext = !!upcoming
    && (upcoming.kind === 'spot' || upcoming.kind === 'drill')
    && upcoming.variation.id === current.variation.id;
  // Part-way through the repairs for a line you missed: the single-move reps.
  // The full run that closes them out is not "mid-repair" — that one ends with
  // the bar, and waits there for you to press Next variation.
  const inRetry = current.kind === 'spot';
  const closingRun = current.kind === 'drill';
  // Everything except one repetition rolling into the next stops for a press,
  // so the bar has to be there to press.
  const nextIsClosingRun = upcoming?.kind === 'drill';
  const waitsHere = closingRun || nextIsClosingRun || (retryNext && !inRetry);

  return (
    <div className="page wide">
      <div className="breadcrumb">
        <a onClick={leaveSession}>{cameFromList ? 'Chapters' : 'Exit practice'}</a>
        <span>▸</span>
        <span>{current.opening.name} · {current.chapter.name}</span>
        <span style={{ flex: 1 }} />
        {onAnalyze && (
          <button
            className="small ghost"
            title="Open this variation on the analysis board with Stockfish and the explorer"
            onClick={() => onAnalyze({
              name: current.variation.name,
              subtitle: `${current.opening.name} — ${current.chapter.name}`,
              moves: current.variation.moves,
              ownerId: current.opening.ownerId ?? null,
              comments: current.variation.comments,
              badges: current.variation.badges,
            })}
          >
            <MonitorIcon size={14} /> Send to analysis
          </button>
        )}
      </div>
      <div className={`practice-layout${listOpen ? ' with-list' : ''}`} ref={setLayoutEl}>
        {showList && (
          <VariationList
            items={listItems}
            currentId={current.variation.id}
            doneIds={doneIds}
            open={listOpen}
            onToggle={() => dispatch({ type: 'setSettings', settings: { practiceList: !listOpen } })}
            heading={current.opening.name}
            subheading={courseName}
            artwork={current.opening.artwork?.small}
            onPick={(item) => {
              const i = queue.findIndex((q) => q.variation.id === item.variation.id);
              if (i >= 0) goTo(i);
            }}
          />
        )}
        <div className="practice-board" ref={boardRef}>
          <div className="board-stack" style={{ width: boardWidth, height: boardWidth }}>
          <Board
            id="practice"
            position={reviewing ? reviewFen : game.fen()}
            boardOrientation={orientation}
            onPieceDrop={onPieceDrop}
            onSquareClick={onSquareClick}
            onPieceDragBegin={(piece, square) => setPickedSquare(square)}
            onPieceDragEnd={() => setPickedSquare(null)}
            onPromotionCheck={() => false}
            arePiecesDraggable={userTurn && !completed && !reviewing && !wrongMove}
            customSquareStyles={reviewing
              ? {}
              : wrongMove
                ? {
                  [wrongMove.from]: { background: 'rgba(229, 83, 75, 0.45)' },
                  [wrongMove.to]: {
                    background: 'rgba(229, 83, 75, 0.7)',
                    boxShadow: 'inset 0 0 0 3px var(--red)',
                  },
                }
                : (pickedSquare
                  ? { ...squares, [pickedSquare]: { background: 'rgba(59, 156, 255, 0.5)' } }
                  : squares)}
            lastMove={lastMove}
            // Sourced only from the variation's own saved badges — Learn and
            // Practice never run an engine at all, so there's nothing live
            // that could ever generate a badge here. What a coach pre-edited
            // is what shows; recall itself is never auto-graded.
            badge={badgeAt(current.variation.badges, ply - 1)?.id}
            animationDuration={pace.anim}
            boardWidth={boardWidth}
          />
          {pendingPromotion && (
            <PromotionPicker
              square={pendingPromotion.to}
              color={pendingPromotion.color}
              boardWidth={boardWidth}
              orientation={orientation}
              onPick={(piece) => commitMove(pendingPromotion.from, pendingPromotion.to, piece)}
              onCancel={() => setPendingPromotion(null)}
            />
          )}
          {/* Knight moves bend at a right angle here too, matching Analysis. */}
          <BoardArrows
            arrows={wrongMove ? [] : arrows}
            boardWidth={boardWidth}
            orientation={orientation}
          />
          {/* Above the arrows, so a dot is never split by a shaft crossing it. */}
          {showLegal && !wrongMove && !reviewing && (
            <LegalDots
              game={game}
              square={pickedSquare}
              boardWidth={boardWidth}
              orientation={orientation}
            />
          )}
          {wrongMove && (
            <div
              key={wrongMove.at}
              ref={ghostRef}
              className="wrong-ghost"
              style={{
                width: wrongMove.size,
                height: wrongMove.size,
                transform: `translate(${wrongMove.home.x}px, ${wrongMove.home.y}px)`,
              }}
              dangerouslySetInnerHTML={{ __html: wrongMove.html }}
            />
          )}
          </div>
          {reviewing && (
            <div className="review-bar" style={{ maxWidth: boardWidth }}>
              <span>
                Reviewing move {reviewPly} of {ply}
                {reviewPly > 0 && ` · ${Math.floor((reviewPly - 1) / 2) + 1}${(reviewPly - 1) % 2 === 0 ? '.' : '…'}${moves[reviewPly - 1]}`}
              </span>
              <span style={{ flex: 1 }} />
              <button className="small" onClick={() => setReviewPly((r) => Math.max(0, r - 1))}><PrevIcon size={15} /></button>
              <button
                className="small"
                onClick={() => setReviewPly((r) => (r + 1 > ply ? (completed ? r : null) : r + 1))}
              >
                <NextIcon size={15} />
              </button>
              <button className="small primary" onClick={() => setReviewPly(null)}>
                {completed ? 'Done' : 'Back to play'}
              </button>
            </div>
          )}
          {/* Nothing moves on by itself except one drill repeat into the next,
              so there's no "moving on…" notice to give any more. */}
          {/* Repairs run one into the next on their own — a bar between every
              rep is just something flashing under the board. It comes back if
              you've asked practice to pause, since then it's the way on. */}
          {completed && (!inRetry || !autoAdvance || waitsHere) && (
            <div className="finish-bar" style={{ maxWidth: boardWidth }}>
              <button
                title="Study the line — the cheat sheet, at your own pace, with no testing"
                onClick={() => setBookOpen(true)}
              >
                <BookIcon size={15} /> Study
              </button>
              <button
                title="See the moves again first, then recall them without a preview"
                onClick={learnAgain}
              >
                <CapIcon size={15} /> Learn again
              </button>
              <button
                title="Straight to blind recall, no preview — one more go"
                onClick={practiceAgain}
              >
                <SkipStartIcon size={15} /> Practice again
              </button>
              <button className="primary" onClick={nextVariation}>
                {qi + 1 >= queue.length
                  ? 'Finish session'
                  : (
                    <>
                      {/* Say what the press actually starts. A spot drill is one
                          move, not the line over again — naming it stops the
                          button reading as "you failed, go back to the top". */}
                      {nextIsClosingRun ? 'Full run — the whole line'
                        : retryNext
                          ? `Drill ${plyLabel(upcoming.spotPly)}${moves[upcoming.spotPly] ?? ''}`
                          : 'Next variation'}
                      {' '}<NextIcon size={15} />
                    </>
                  )}
              </button>
            </div>
          )}
        </div>
        <div className="practice-side">
          <div className="practice-status">
            <div className="practice-title-row">
              <button
                className={`star-btn${shown.starred ? ' on' : ''}`}
                title={shown.starred ? 'Remove from favorites' : 'Mark as a favorite'}
                onClick={() => dispatch({
                  type: 'toggleStar',
                  openingId: current.opening.id,
                  chapterId: current.chapter.id,
                  variationId: current.variation.id,
                })}
              >
                <StarIcon size={17} filled={shown.starred} />
              </button>
              <h3>{shown.name}</h3>
              <span className="row-icons">
              <button
                className={`ghost small book-btn${soundOn ? '' : ' muted'}`}
                title={soundOn ? 'Move sounds on (click to mute)' : 'Move sounds off (click to unmute)'}
                onClick={() => {
                  const next = !soundOn;
                  dispatch({ type: 'setSettings', settings: { soundEnabled: next } });
                  if (next) playMoveSound('e4'); // audible confirmation (click = unlock gesture)
                }}
              >
                {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
              </button>
              <button
                className={`ghost small book-btn${shown.tags?.length ? ' active' : ''}`}
                title="Themes for this variation — group it under a theme like “bishop trapping plan”"
                onClick={() => setTagOpen(true)}
              >
                <TagIcon />
              </button>
              <button
                className={`ghost small book-btn${bookOpen ? ' active' : ''}`}
                title="Cheat sheet — see the move order and step through it"
                onClick={() => setBookOpen((o) => !o)}
              >
                <BookIcon />
              </button>
              </span>
            </div>
            <div className="sub" style={{ margin: '6px 0' }}>
              <span className={`phase-tag ${kindTag.cls}`}>{kindTag.text}</span>
            </div>
            <TagChips tags={shown.tags} max={4} />
            <div className="sub variation-nav">
              <button className="small ghost" disabled={qi === 0} title="Previous variation (up arrow)" onClick={() => goTo(qi - 1)}><PrevIcon size={15} /></button>
              <span>Variation {qi + 1} of {queue.length}</span>
              <button className="small ghost" disabled={qi + 1 >= queue.length} title="Next variation (down arrow)" onClick={() => goTo(qi + 1)}><NextIcon size={15} /></button>
              <span>· you play {userIsWhite ? 'White' : 'Black'} · move {Math.min(ply + 1, moves.length)} / {moves.length}</span>
            </div>
            <div className="progress-track" style={{ margin: '10px 0' }}>
              <div className="progress-fill" style={{ width: `${(ply / moves.length) * 100}%` }} />
            </div>
            {timedMoves && (
              <MoveTimer deadline={deadline} duration={moveTimerMs} onExpire={onTimeUp} />
            )}
            <div className={`feedback ${feedback?.type ?? ''}`}>
              {feedback?.text ?? (userTurn
                ? (phase === 'teach' ? `▶ Play ${expectedSan} (shown on the board)` : 'Your move…')
                : ' ')}
            </div>
          </div>
          {bookOpen && (() => {
            const stepBook = (d) => setBookPly((p) => Math.min(moves.length, Math.max(0, p + d)));
            return (
              <div className="book-panel">
                {/* Swiping the little board steps the line — the phone equivalent of ← / →. */}
                <div
                  className="book-board"
                  onTouchStart={(e) => { touchRef.current = e.touches[0].clientX; }}
                  onTouchEnd={(e) => {
                    const dx = e.changedTouches[0].clientX - (touchRef.current ?? 0);
                    if (Math.abs(dx) > 35) stepBook(dx < 0 ? 1 : -1);
                  }}
                >
                  <Board
                    id="book"
                    position={bookFen}
                    boardOrientation={orientation}
                    arePiecesDraggable={false}
                    boardWidth={230}
                  />
                  <div className="book-controls">
                    <button title="Start" disabled={bookPly === 0} onClick={() => setBookPly(0)}><SkipStartIcon size={17} /></button>
                    <button title="Previous move" disabled={bookPly === 0} onClick={() => stepBook(-1)}><PrevIcon size={17} /></button>
                    <span className="book-count">{bookPly} / {moves.length}</span>
                    <button title="Next move" disabled={bookPly >= moves.length} onClick={() => stepBook(1)}><NextIcon size={17} /></button>
                    <button title="End" disabled={bookPly >= moves.length} onClick={() => setBookPly(moves.length)}><SkipEndIcon size={17} /></button>
                  </div>
                </div>
                <div className="book-moves">
                  <div>
                    <MoveText
                      moves={moves}
                      comments={current.variation.comments}
                      currentIndex={bookPly - 1}
                      onClickMove={(i) => setBookPly(i + 1)}
                    />
                  </div>
                  {(() => {
                    const note = noteFor(current.variation.comments, moves, bookPly);
                    return note ? <MoveNote {...note} /> : null;
                  })()}
                  <div className="book-foot">
                    <span className="muted-note">Tap a move, swipe the board, or use the arrows / arrow keys</span>
                    <button className="small" onClick={() => setBookOpen(false)}>Close</button>
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            // What the course says about this move — the note stays up while
            // you play on, dimmed, so the point of the line isn't lost after a
            // single move. Only during the teach phase: once you're being
            // tested (recall or practice), the answer shouldn't be on screen.
            //
            // A move the clock played for you is the exception. Its answer has
            // already been given away, so withholding the reason for it just
            // wastes the one moment the explanation is worth reading. It stays
            // up until you play your own next move.
            const note = noteFor(current.variation.comments, moves, ply);
            const fromClock = timedOutPly != null && note?.index === timedOutPly;
            if (phase !== 'teach' && !fromClock) return null;
            return note ? <MoveNote {...note} highlight={fromClock} /> : null;
          })()}
          <div className="practice-moves-played">
            <MoveText moves={moves.slice(0, ply)} comments={current.variation.comments} />
            {ply === 0 && <span style={{ color: 'var(--muted)' }}>Moves appear here as they're played.</span>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {!completed && (
              <>
                {phase !== 'teach' && (
                  <button onClick={() => setAttempts((a) => Math.max(a, 2))}><BulbIcon size={15} /> Hint</button>
                )}
                <button
                  onClick={() => {
                    if (!expectedSan) return; // never step past the end of the line
                    if (phase !== 'teach') setMistakes((m) => m + 1);
                    markWrong(ply);
                    setPly((p) => Math.min(p + 1, moves.length));
                    setAttempts(0);
                    setFeedback({ type: 'hint', text: `${expectedSan} was played for you` });
                  }}
                >
                  Skip move
                </button>
              </>
            )}
            <span style={{ flex: 1 }} />
            <button className="ghost" onClick={nextVariation}>Skip variation</button>
          </div>
        </div>
      </div>

      {tagOpen && (
        <TagEditor
          title={shown.name}
          tags={shown.tags}
          suggestions={allTags(state)}
          onClose={() => setTagOpen(false)}
          onChange={(tags) => dispatch({
            type: 'setVariationTags',
            openingId: current.opening.id,
            chapterId: current.chapter.id,
            variationId: current.variation.id,
            tags,
          })}
        />
      )}
    </div>
  );
}
