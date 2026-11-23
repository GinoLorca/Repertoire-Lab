import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Chess } from 'chess.js';
import { useSettings } from '../store';
import { checkedKingSquare, CHECK_STYLE, LAST_MOVE_STYLE } from '../lib/legalMoves';
import { piecesFor, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardBadgeStyle, boardBadgeTint, BADGE_BY_ID } from '../lib/badges';
import { suitSquareStyles, suitPick as suitPickOf } from '../lib/suitMarks';
import { usePressed } from '../lib/usePressed';
import { boardColors, boardPieces } from '../lib/theme';
import BoardArrows, { cell } from './BoardArrows';
import { TelestratorLayer } from './Telestrator';
import { useHoldToDraw, swallowClickAt, HOLD_SLOP } from './useHoldToDraw';
import {
  PENS, comboMatchesEvent, defaultPen, isComboKey, shortcutKey,
} from '../lib/shortcuts';
import { skinId } from '../lib/skins';
import {
  profileOf, drawArrow, drawSquare, applyColors, colorOfNext, squareMarkStyle, reviewPenColor,
} from '../lib/arrowProfiles';
import { watchHeldKeys, heldKeys, markDrawn } from '../lib/penHold';
import { liftable, lateDrop, dropSquare } from '../lib/grab';
import { useCarry } from './useCarry';

export const DEFAULT_SQUARE_LIGHT = '#c6d3e1';
export const DEFAULT_SQUARE_DARK = '#4a6a8f';

const BOARD_THEME = {
  customDarkSquareStyle: { backgroundColor: DEFAULT_SQUARE_DARK },
  customLightSquareStyle: { backgroundColor: DEFAULT_SQUARE_LIGHT },
};

// react-chessboard picks its drag backend with `"ontouchstart" in window`.
// An iPad reports touch support, so it gets the touch backend — which ignores
// mouse and trackpad input, leaving a Magic Keyboard cursor unable to drag.
// Using the touch backend WITH enableMouseEvents makes both work at once.
export const isTouchCapable = typeof window !== 'undefined' && 'ontouchstart' in window;
const dndProps = isTouchCapable
  ? {
    customDndBackend: TouchBackend,
    // A piece drag starts once a finger has travelled as far as gives up a
    // hold to draw (useHoldToDraw), so a finger resting on a square is never
    // both lifting a piece and drawing from it. (Where a piece comes first
    // there's no hold to give up on one that can be lifted: DrawableBoard's
    // `skip`.)
    customDndBackendOptions: { enableMouseEvents: true, delayTouchStart: 0, touchSlop: HOLD_SLOP },
  }
  : {};

// The pen keys held right now (lib/shortcuts — the analysis board's keys,
// Settings → Shortcuts — and, in the Game Review arrow profile, a colour's
// first letter: lib/arrowProfiles), watched once for every board on the page
// (lib/penHold): hold one while right-dragging and the arrow, or the
// highlight, is in that colour. Reading it means a mark is being drawn, so the
// letters held are marked as having drawn (a shortcut on one then doesn't fire).
function heldPen(settings, e) {
  markDrawn();
  const review = reviewPenColor(profileOf(settings), heldKeys());
  if (review) return review;
  for (const pen of PENS) {
    const key = shortcutKey(settings, pen.shortcutId);
    if (!key) continue;
    if (isComboKey(key) ? (e && comboMatchesEvent(key, e)) : heldKeys().has(key)) return pen.value;
  }
  return null;
}

// A highlighted square, the way the analysis board draws one (stronger, with
// a halo, while an arrow colour profile is on). A longhand colour, not the
// `background` shorthand, so a badge's glyph on the same square survives.
const highlightStyle = (base, color, profile) => {
  const { background: _shorthand, ...rest } = base ?? {};
  return { ...rest, ...squareMarkStyle(color, profile) };
};
const NO_DRAWING = { arrows: [], squares: {} };
// The position a board shows, as a FEN — for Strategic arrow colours.
const fenOf = (position) => (position === 'start'
  ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  : typeof position === 'string' ? position : null);

// Uptown Express: the board's ranks and files as subway line signs — a
// white number or letter on a disc of its line's colour, as Chess Arcade
// draws them. There they sit in a strip outside the board; here they take
// the corners the board's own coordinates use (numbers top-left down the
// left edge, letters bottom-right along the bottom), so they're drawn as a
// layer over the board instead of through react-chessboard's notation,
// which has one style for both.
const LINE_COLOR = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e',
  4: '#00933c', 5: '#00933c', 6: '#00933c',
  7: '#b933ad', 8: '#b933ad',
  a: '#0039a6', c: '#0039a6', e: '#0039a6',
  b: '#ff6319', d: '#ff6319', f: '#ff6319',
  g: '#6cbe45', h: '#6cbe45',
};

function LineSigns({ boardWidth, orientation, scale = 1 }) {
  const sq = boardWidth / 8;
  // About a quarter of a square — Chess Arcade's proportion — kept legible
  // on a small board and not oversized on a big one; bigger with Settings'
  // coordinate size (never past two fifths of a square).
  const size = Math.round(Math.min(20 * scale, sq * 0.4, Math.max(9, sq * 0.24 * scale)));
  const inset = Math.max(1.5, sq * 0.045);
  const black = orientation === 'black';
  const ranks = black ? '12345678' : '87654321'; // top to bottom
  const files = black ? 'hgfedcba' : 'abcdefgh'; // left to right
  const sign = (label, left, top) => (
    <span
      key={label}
      className="line-sign"
      style={{
        left, top, width: size, height: size, fontSize: Math.round(size * 0.62), background: LINE_COLOR[label],
      }}
    >
      {label.toUpperCase()}
    </span>
  );
  return (
    <div className="line-signs" aria-hidden="true">
      {[...ranks].map((r, i) => sign(r, inset, i * sq + inset))}
      {[...files].map((f, i) => sign(f, (i + 1) * sq - inset - size, boardWidth - inset - size))}
    </div>
  );
}

// Bigger coordinates (Settings → The board → Coordinate size): the board's own
// letters and numbers in the same corners and colours — light lettering on a
// dark square, dark on a light one — at 1.5× or 2× their size. A layer of
// their own: react-chessboard sets one style for both and places them by a
// padding worked out for its own size. Normal keeps react-chessboard's.
export const COORD_SCALE = { normal: 1, large: 1.5, xl: 2 };
export const coordScaleOf = (settings) => COORD_SCALE[settings?.coordSize] ?? 1;
function BoardCoords({
  boardWidth, orientation, scale, light, dark,
}) {
  const sq = boardWidth / 8;
  const size = (boardWidth / 48) * scale;
  const pad = sq * 0.05;
  const black = orientation === 'black';
  const ranks = black ? '12345678' : '87654321'; // top to bottom
  const files = black ? 'hgfedcba' : 'abcdefgh'; // left to right
  const dark1 = (f, r) => ('abcdefgh'.indexOf(f) + Number(r)) % 2 === 1; // a1 dark
  const leftFile = files[0];
  const bottomRank = ranks[7];
  return (
    <div className="board-coords" aria-hidden="true" style={{ fontSize: size }}>
      {[...ranks].map((r, i) => (
        <span key={r} style={{ left: pad, top: i * sq + pad * 0.6, color: dark1(leftFile, r) ? light : dark }}>{r}</span>
      ))}
      {[...files].map((f, i) => (
        <span key={f} style={{ right: boardWidth - (i + 1) * sq + pad, bottom: pad * 0.4, color: dark1(f, bottomRank) ? light : dark }}>{f}</span>
      ))}
    </div>
  );
}

const squareAtPoint = (x, y) => document.elementFromPoint(x, y)
  ?.closest?.('[data-square]')?.getAttribute('data-square') ?? null;

// The rank numbers and file letters, stroked so they hold up on any theme.
// react-chessboard already draws each one in the OPPOSITE square's colour —
// light lettering on a dark square, dark on a light one — so `currentColor`
// is exactly the dark-or-light-depending-on-the-background stroke wanted
// here, without a per-theme value anywhere. It matters most on the boards
// that carry a texture: a 7px glyph sitting on Game Boy's dot grid or
// Hustler's marble veining had nothing separating it from the pattern.
// The stroke thickens the glyph; the shadow lifts it off the square.
const NOTATION_STYLE = {
  WebkitTextStroke: '0.35px currentColor',
  textShadow: '0 0 1.5px currentColor',
  fontWeight: 700,
};

// Shared board: consistent theme, input handling that works with a mouse, a
// trackpad and a touchscreen, and the king in check marked in red wherever a
// board appears — analysis, practice, compare, the line viewer.
//
// `ownArrows` (on unless a view says otherwise) gives every board right-drag
// arrows drawn by BoardArrows — which bends a knight's at a right angle the
// way chess.com does. react-chessboard has an arrow layer of its own, on by
// default, but it draws every arrow as a straight line between two centres:
// that was the orange arrow cutting diagonally across a knight move, and no
// change to our renderer could reach it. It's off from here on, so arrows come
// from one place.
// The marks that sit on top of everything drawn on a square — a move's badge
// disc (top right of the square it landed on) and its CLAMP letters from Game
// Review (lib/reviewOnBoard): discs in the bottom-left corner of the squares
// they're about, or of the square the piece moved to, side by side, smaller
// three or more to a square; theirs dark, ringed in the letter's colour — as
// Chess Arcade draws them. On their own layer above the arrows (10) and under
// the telestrator's ink (40), so an arrow across the square never buries them.
const FILES = 'abcdefgh';
function squareBox(square, size, orientation) {
  const f = FILES.indexOf(square?.[0]);
  const r = Number(square?.[1]);
  if (f < 0 || !(r >= 1 && r <= 8)) return null;
  const col = orientation === 'black' ? 7 - f : f;
  const row = orientation === 'black' ? r - 1 : 8 - r;
  return {
    left: col * size, top: row * size, width: size, height: size,
  };
}
function BoardTopMarks({
  badgeSquare, badge, clampAt, boardWidth, orientation,
}) {
  const size = boardWidth / 8;
  const b = badge ? BADGE_BY_ID[badge] : null;
  const badgeBox = b ? squareBox(badgeSquare, size, orientation) : null;
  return (
    <div className="board-top-marks" aria-hidden="true">
      {badgeBox && (
        <div className="board-top-sq" style={badgeBox}>
          <span className={`board-badge-disc board-badge-${b.id}`} style={{ background: b.color, fontSize: size * 0.17 }}>
            {b.symbol}
          </span>
        </div>
      )}
      {Object.entries(clampAt ?? {}).map(([sq, list]) => {
        const box = squareBox(sq, size, orientation);
        if (!box || !list?.length) return null;
        const many = list.length > 2;
        const d = size * (many ? 0.28 : 0.36);
        return (
          <div key={sq} className="board-top-sq" style={box}>
            <span className="board-clamp-box" style={{ gap: size * 0.03 }}>
              {list.map((c) => (
                <span
                  key={c.letter}
                  className={`board-clamp-disc${c.theirs ? ' theirs' : ''}`}
                  style={{
                    width: d,
                    height: d,
                    fontSize: size * (many ? 0.16 : 0.19),
                    ...(c.theirs
                      ? { boxShadow: `inset 0 0 0 ${size * 0.045}px ${c.color}, 0 0 0 1.5px rgba(255,255,255,.9), 0 1px 3px rgba(0,0,0,.4)` }
                      : { background: c.color }),
                  }}
                >
                  {c.letter}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Board({
  position, customSquareStyles, lastMove, badge, clampAt = null, suitPick = null, pickAtPress = null, ownArrows = true, marks = null, telestrator = true, liftFirst, eagerBegin = false, nativeDrag = false, ...rest
}) {
  // (Only the settings: the board isn't drawn again for the library changing
  // round it — a move's autosave, a sync. `state.settings` below is this.)
  const settings = useSettings();
  const state = useMemo(() => ({ settings }), [settings]);
  // What's right-clicked onto this board (see DrawableBoard): its arrows and
  // squares, in the arrow colour profile's colours (lib/arrowProfiles.js).
  // Kept here so the squares go into the squares' own styles, under the
  // pieces, like everything else drawn on a square.
  const [drawing, setDrawing] = useState(NO_DRAWING);
  const profile = profileOf(state.settings);
  // A switch of profile recolours what's drawn.
  const profileSeen = useRef(profile);
  useEffect(() => {
    if (profileSeen.current === profile) return;
    profileSeen.current = profile;
    setDrawing((d) => applyColors(d, fenOf(position), profile));
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const markCheck = state.settings.checkHighlight !== false;
  const markLast = state.settings.lastMoveHighlight !== false;
  const markBadge = state.settings.showBoardBadges !== false;
  const sized = typeof rest.boardWidth === 'number';

  // A Chess Arcade skin brings its own board and pieces; Custom falls through
  // to the colours picked in Settings, and then to the built-in pair. The set
  // is the one picked for this theme, else the theme's own (lib/theme
  // boardPieces).
  const chosen = boardColors(state.settings);
  const squareLight = chosen.squareLight ?? DEFAULT_SQUARE_LIGHT;
  const squareDark = chosen.squareDark ?? DEFAULT_SQUARE_DARK;
  const look = boardPieces(state.settings);
  // Only hand react-chessboard a custom set when it differs from its own, so an
  // untouched board keeps the package's pieces exactly as they were. The map
  // is the same one for the same look (piecesFor): a new one would remount all
  // 32 pieces and kill the move animation.
  const customPieces = (look.set === 'default' && look.light === DEFAULT_PIECE_LIGHT && look.dark === DEFAULT_PIECE_DARK)
    ? undefined
    : piecesFor(look);

  // Court Cards, on a board whose view marks a pick (`pickAtPress`: the
  // analysis board, Learn and Practice): a pressed piece wears its suit, and
  // its captures their corner pips, with the press itself (lib/pressed) —
  // the view's own pick only comes when the pointer is let go. The board
  // alone redraws for it; in every other theme it doesn't redraw at all.
  const pressedSquare = usePressed(pickAtPress && skinId(state.settings) === 'cards' ? String(rest.id ?? 0) : null);
  const pressPick = useMemo(() => {
    if (!pressedSquare || typeof position !== 'string') return null;
    try {
      return suitPickOf(position === 'start' ? new Chess() : new Chess(position), pressedSquare, { captures: pickAtPress?.captures !== false, set: look.set });
    } catch { return null; }
  }, [pressedSquare, position, pickAtPress?.captures, look.set]);

  const styles = useMemo(() => {
    let out = customSquareStyles;

    // Where the move came from and where it went, the way chess.com marks it.
    // Underneath everything else, so a hint or a selection still reads on top.
    if (markLast && lastMove?.from && lastMove?.to) {
      out = {
        [lastMove.from]: { ...LAST_MOVE_STYLE },
        [lastMove.to]: { ...LAST_MOVE_STYLE },
        ...out,
      };
    }

    // A coach's badge on the move that was just played — the same "landed on
    // this square" spot the last-move wash uses, so the two combine rather
    // than compete: the badge's own colour replaces the plain yellow tint,
    // and its glyph sits over the corner. Precedence is against the CALLER's
    // own style for that square specifically (a live "wrong move" flash, a
    // picked-square highlight) — not against `out`, which by this point
    // already has the plain last-move wash folded in and would make the
    // badge look like it's losing to a decoration it's meant to replace.
    let badged = null;
    if (markBadge && badge && lastMove?.to) {
      // Sized: the tint here, the disc on the top layer (BoardTopMarks).
      const badgeStyle = sized ? boardBadgeTint(badge) : boardBadgeStyle(badge);
      const callerStyle = customSquareStyles?.[lastMove.to];
      if (badgeStyle) {
        out = { ...out, [lastMove.to]: { ...badgeStyle, ...(callerStyle ?? {}) } };
        badged = lastMove.to;
      }
    }

    if (markCheck && typeof position === 'string') {
      let square = null;
      try { square = checkedKingSquare(new Chess(position)); } catch { square = null; }
      // Anything the caller put on that square stays on top of the glow.
      if (square) out = { ...out, [square]: { ...CHECK_STYLE, ...(out?.[square] ?? {}) } };
    }

    // Drawn just now, so on top.
    for (const [sq, color] of Object.entries(drawing.squares)) {
      out = { ...out, [sq]: highlightStyle(out?.[sq], color, profile) };
    }

    // Court Cards' suit marks for a pick (lib/suitMarks.js): custom properties
    // on the picked square and its capture squares, added to whatever those
    // squares already wear (a last move's gilt edge, a check, a badge), so a
    // pick restyles those squares alone. Only Court Cards hands one in. (A
    // piece being pressed is the pick meanwhile: `pressPick`, below.)
    const pick = pressPick ?? suitPick;
    if (pick) {
      const marked = suitSquareStyles(pick, {
        orientation: rest.boardOrientation === 'black' ? 'black' : 'white',
        notation: rest.showBoardNotation !== false,
        badge: badged,
      });
      for (const [sq, add] of Object.entries(marked)) out = { ...out, [sq]: { ...(out?.[sq] ?? {}), ...add } };
    }
    return out;
  }, [markCheck, markLast, markBadge, lastMove?.from, lastMove?.to, badge, position, customSquareStyles, drawing.squares, profile,
    suitPick, pressPick, rest.boardOrientation, rest.showBoardNotation, sized]);

  const orientation = rest.boardOrientation === 'black' ? 'black' : 'white';

  // ---------- A piece in the air ----------
  //
  // (What follows is for a board still on the library's own drag-and-drop —
  // the Board Editor. The others carry their pieces themselves: `carryOn`,
  // further down, and components/useCarry.)
  //
  // Two things the board library gets wrong about a piece let go while
  // another is still sliding, both of which a quick player meets all the
  // time (the reply comes as you reach for your next piece):
  //   · it won't take the drop at all — its drop handler returns before
  //     asking anyone, and the piece goes back to where it came from;
  //   · just after the slide, it asks about the wrong square: a sliding piece
  //     belongs to the square it left until it lands, so a recapture let go
  //     under the capturer was asked about as a move to the capturer's old
  //     square — a wrong move, counted against you.
  // So each drag is followed here: where the piece was let go, and whether
  // the board was asked about it. Asked, the answer is for the square the
  // pointer was really on (lib/grab dropSquare); not asked, the question is
  // put now (lateDrop), and the view's answer changes the position, which
  // cuts the slide short, as an outside move arriving mid-slide always has.
  //
  // The three handlers below are the same functions for the board's whole
  // life and read the view's own from `view`: react-chessboard keeps the
  // ones it was given when a piece last moved, so a view's handler would
  // otherwise act on what was true then.
  const view = useRef({});
  view.current = {
    id: String(rest.id ?? 0),
    onPieceDrop: rest.onPieceDrop,
    onPieceDragBegin: rest.onPieceDragBegin,
    onPieceDragEnd: rest.onPieceDragEnd,
    onPromotionCheck: rest.onPromotionCheck,
    premoves: Boolean(rest.arePremovesAllowed),
  };
  // { piece, from, at (where it was let go), last (where it was last seen),
  //   off (called off), asked, answer, stop }
  const carried = useRef(null);
  const grab = useMemo(() => {
    // As this board's drag backend hears of it. Let go: a finger or a mouse
    // button coming up (touch screens), a native drag's drop (anywhere
    // else). A drag that ends without one was called off — Escape; a touch
    // the system took back — and that's not a move, whatever square the
    // pointer was over. On the way: only a touch screen's backend can be
    // ended by something other than the pointer that's carrying.
    const RELEASE = isTouchCapable ? ['touchend', 'mouseup'] : ['drop'];
    const WATCH = isTouchCapable ? [...RELEASE, 'touchcancel', 'touchmove', 'mousemove'] : RELEASE;
    const follow = (e) => {
      const c = carried.current;
      if (!c) return;
      let p = e;
      if (e.type.startsWith('touch')) {
        // Only the finger carrying the piece. A touch's events come from
        // where it began — the square the piece was lifted off; another
        // finger on the board says nothing about where this one is.
        const began = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
        if (began?.closest?.('[data-square]')?.getAttribute('data-square') !== c.from) return;
        if (e.type === 'touchcancel') { c.off = true; return; }
        p = e.changedTouches?.[0];
      }
      if (typeof p?.clientX !== 'number') return;
      c.last = { x: p.clientX, y: p.clientY };
      if (RELEASE.includes(e.type)) c.at = c.last;
    };
    // The square of this board at a point — the square itself, not whatever
    // is on top of it (a piece sliding across, the marks drawn over it).
    const squareUnder = ({ x, y }) => document.elementsFromPoint(x, y).find((n) => (
      n.hasAttribute?.('data-square')
      && n.closest('[data-boardid]')?.getAttribute('data-boardid') === view.current.id
    ))?.getAttribute('data-square') ?? null;
    const letGo = () => {
      const c = carried.current;
      carried.current = null;
      c?.stop();
      return c;
    };
    return {
      letGo,
      onPieceDragBegin: (piece, square) => {
        letGo();
        if (typeof window !== 'undefined') {
          // On the window, first in line: before the backend ends the drag.
          const opts = { capture: true, passive: true };
          WATCH.forEach((type) => window.addEventListener(type, follow, opts));
          carried.current = {
            piece, from: square, at: null, last: null, off: false, asked: false, answer: false,
            stop: () => WATCH.forEach((type) => window.removeEventListener(type, follow, opts)),
          };
        }
        view.current.onPieceDragBegin?.(piece, square);
      },
      // (Three named arguments: react-chessboard only asks a function that takes some.)
      onPieceDrop: (from, to, piece) => {
        const play = (sq) => (view.current.onPieceDrop ? view.current.onPieceDrop(from, sq, piece) : true);
        const c = carried.current;
        if (!c) return play(to);
        // One drop, one answer: the library asks once for every square it
        // takes the piece to be over.
        if (c.asked) return c.answer;
        if (c.off) return false;
        const target = dropSquare({
          from,
          asked: to,
          released: c.at ? squareUnder(c.at) : undefined,
          over: c.last ? squareUnder(c.last) : undefined,
        });
        if (!target) return false;
        c.asked = true;
        c.answer = play(target);
        return c.answer;
      },
      onPieceDragEnd: (piece, square) => {
        const c = letGo();
        try {
          if (!c?.at || !view.current.onPieceDrop) return;
          const drop = lateDrop({
            from: c.from,
            to: squareUnder(c.at),
            piece: c.piece,
            asked: c.asked,
            released: !c.off,
            promotes: view.current.onPromotionCheck ?? undefined,
            premoves: view.current.premoves,
          });
          if (drop) view.current.onPieceDrop(drop.from, drop.to, drop.piece);
        } finally {
          // The drop first, then the end of the drag: the order the library keeps.
          view.current.onPieceDragEnd?.(piece, square);
        }
      },
    };
  }, []);
  useEffect(() => () => { grab.letGo(); }, [grab]);
  // A press here would lift a piece (lib/grab): the board lets pieces be
  // dragged, there's one on the square, and it's one the board lets go.
  const canLift = (sq) => liftable(sq, {
    position, draggable: rest.arePiecesDraggable, isDraggablePiece: rest.isDraggablePiece,
  });
  // Whether a finger on such a piece always lifts it, or — rested a moment —
  // draws from it. Learn and Practice say so themselves (`liftFirst`): there
  // your own piece always comes up. Any other board whose pieces move (Browse
  // as a tree) goes by Settings → Analysis, "Hold a piece to draw an arrow
  // from it", as the analysis board does: on unless switched off.
  const pieceFirst = liftFirst ?? state.settings.holdDrawFromPieces === false;

  // Pieces are carried by the app itself (components/useCarry) on every
  // board where a view moves them and settles promotions itself — Learn and
  // Practice, the analysis board, Browse as a tree: claimed at the touch,
  // with the pointer from the first pixel. The library's drag-and-drop,
  // which waited and trailed, is switched off there. The Board Editor keeps
  // it (`nativeDrag`: its tray and its bin are the library's), as does a
  // board with no host of its own to listen on.
  const carryOn = sized && telestrator && !nativeDrag && Boolean(rest.onPieceDrop) && Boolean(rest.onPromotionCheck);
  const hostRef = useRef(null);
  // (`eagerBegin`: the view is told of a lift the moment it's certain, not
  // when the pointer first rests — Learn and Practice, where the lift brings
  // the reply on and the drop is judged after it.)
  const { instant } = useCarry(carryOn, hostRef, {
    id: view.current.id, position, canLift, pieceFirst, eager: eagerBegin, view,
  });

  // Uptown Express's coordinates are line signs (LineSigns above), on any
  // board with a size to draw them at; the board's own step aside for them.
  const coordScale = coordScaleOf(state.settings);
  const lineSigns = sized && rest.showBoardNotation !== false && skinId(state.settings) === 'uptown';
  // Bigger coordinates: a layer of their own (BoardCoords), the board's step aside.
  const bigCoords = sized && !lineSigns && rest.showBoardNotation !== false && coordScale !== 1;
  const signs = lineSigns ? <LineSigns boardWidth={rest.boardWidth} orientation={orientation} scale={coordScale} />
    : bigCoords ? (
      <BoardCoords boardWidth={rest.boardWidth} orientation={orientation} scale={coordScale} light={squareLight} dark={squareDark} />
    ) : null;

  const board = (
    <Chessboard
      {...BOARD_THEME}
      customLightSquareStyle={{ backgroundColor: squareLight }}
      customDarkSquareStyle={{ backgroundColor: squareDark }}
      customPieces={customPieces}
      customNotationStyle={NOTATION_STYLE}
      areArrowsAllowed={false}
      {...dndProps}
      position={position}
      customSquareStyles={styles}
      {...rest}
      {...(lineSigns || bigCoords ? { showBoardNotation: false } : {})}
      onPieceDragBegin={grab.onPieceDragBegin}
      onPieceDragEnd={grab.onPieceDragEnd}
      {...(rest.onPieceDrop ? { onPieceDrop: grab.onPieceDrop } : {})}
      // Carried by the app: nothing for the library to drag — and a piece
      // just put down is there, not slid over from where it was.
      {...(carryOn ? { arePiecesDraggable: false } : {})}
      {...(instant ? { animationDuration: 0 } : {})}
    />
  );

  // Nothing to draw on: a board with no width of its own (the piece editor,
  // the theme preview in Settings) can't host a correctly sized overlay, and
  // wouldn't want arrows anyway.
  const drawn = (!ownArrows || !sized) ? board : (
    <DrawableBoard
      boardWidth={rest.boardWidth}
      orientation={orientation}
      position={position}
      marks={marks}
      settings={state.settings}
      profile={profile}
      drawing={drawing}
      setDrawing={setDrawing}
      canLift={pieceFirst ? canLift : null}
    >
      {board}
      {signs}
    </DrawableBoard>
  );
  // A board without the arrow layer carries the signs itself.
  const ownSigns = !ownArrows && signs;
  const hasBadge = Boolean(lastMove?.to && badge && BADGE_BY_ID[badge]);
  const top = sized && markBadge && (hasBadge || Object.keys(clampAt ?? {}).length) ? (
    <BoardTopMarks
      badgeSquare={lastMove?.to}
      badge={hasBadge ? badge : null}
      clampAt={clampAt}
      boardWidth={rest.boardWidth}
      orientation={orientation}
    />
  ) : null;
  if (!sized || !telestrator) {
    return ownSigns || top
      ? <div className="line-sign-host" style={{ position: 'relative', width: rest.boardWidth, height: rest.boardWidth }}>{drawn}{ownSigns}{top}</div>
      : drawn;
  }

  // The telestrator's ink (components/Telestrator.jsx) sits over every sized
  // board; it's invisible and lets everything through until it's switched on.
  return (
    <div ref={hostRef} className="tele-host" style={{ position: 'relative', width: rest.boardWidth, height: rest.boardWidth }}>
      {drawn}
      {ownSigns}
      {top}
      <TelestratorLayer
        boardWidth={rest.boardWidth}
        orientation={orientation}
        positionKey={typeof position === 'string' ? position : JSON.stringify(position ?? '')}
      />
    </div>
  );
}

// Given the same things, it isn't drawn again: a view redrawing for something
// that isn't the board's (the engine's next line, a note being typed) leaves
// its sixty-four squares and their pieces as they are. A view gets that by
// handing it the same functions and objects from one redraw to the next
// (the analysis board does); one that makes them afresh is redrawn as before.
export default React.memo(Board);

// Right-drag to draw an arrow, right-drag the same pair again to take it away;
// right-click one square to highlight it; left-click the board to clear the
// lot — the gestures everyone already knows from lichess and chess.com. On a
// touch screen, a finger held on a square stands in for the right button
// (useHoldToDraw): hold, then drag for an arrow, or lift for a highlight; a
// tap clears. The click that clears does only that — no piece picked up. In
// the pen you've set as the default (Settings), or whichever pen's key is
// held: the analysis board's keys, so a red arrow and a green one, or squares
// in two colours, sit side by side. Kept here rather than in each view so
// Practice, Learn and the line viewer get it too; Analysis opts out, having
// its own pen with saved marks.
//
// `marks` turns it into a place to draw ones that are kept — a line's arrows,
// saved on its moves: { arrows (the saved ones, drawn), pen (colour of the
// one being drawn), onArrow(from, to, held), onSquare(sq, held), tapToDraw }
// — `held` the colour of a pen key held, or null. Then a right-drag gives
// onArrow, a right-click on one square onSquare, and with `tapToDraw` (a
// touch screen has no right button) a tap on one square and then another is
// an arrow, the same square twice a highlight.
function DrawableBoard({
  boardWidth, orientation, position, marks, settings, profile, drawing, setDrawing, canLift, children,
}) {
  const [pending, setPending] = useState(null); // { from, to, color } while dragging
  const [held, setHeld] = useState(null); // the same, for a finger held to draw
  const hostRef = useRef(null);
  const [tapFrom, setTapFrom] = useState(null); // tap-to-draw: the first square
  // A finger down in tap-to-draw: { id, sq, x, y }. It counts as a tap when it
  // lifts where it landed — a scroll or a pinch that starts on the board
  // draws nothing.
  const tapRef = useRef(null);
  const editing = Boolean(marks?.onArrow);
  useEffect(watchHeldKeys, []);
  const restPen = editing ? (marks.pen ?? defaultPen(settings).value) : defaultPen(settings).value;
  const optsFor = (e) => ({
    held: heldPen(settings, e), pen: restPen, profile, fen: fenOf(position),
  });
  // The colour the arrow following the pointer will be drawn in.
  const colorNow = (e, from, to) => {
    const o = optsFor(e);
    if (editing || from === to) return o.held ?? restPen;
    return colorOfNext(drawing, from, to, o) ?? o.held ?? restPen;
  };
  const hasDrawing = drawing.arrows.length > 0 || Object.keys(drawing.squares).length > 0;

  // A new position means the drawing was about the old one.
  useEffect(() => {
    setDrawing((d) => (d.arrows.length || Object.keys(d.squares).length ? NO_DRAWING : d));
    setPending(null);
    setHeld(null);
    setTapFrom(null);
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!marks?.tapToDraw) setTapFrom(null); }, [marks?.tapToDraw]);

  // A finger held on a square draws (see useHoldToDraw). Only this board's
  // squares: a Before & After pair sits side by side.
  const ownSquareAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest?.('[data-square]');
    return el && hostRef.current?.contains(el) ? el.getAttribute('data-square') : null;
  };
  const hold = useHoldToDraw({
    squareAt: ownSquareAt,
    // Where a piece comes first (`canLift` — Learn and Practice, and other
    // boards when holding a piece to draw is switched off): a finger on a
    // piece that's about to be picked up is picking it up, however long it
    // rests — not the start of a drawing. (A pencil still draws from
    // anywhere; so does a finger held on an empty square, or on a piece
    // that can't be moved.) What's drawn goes as the piece comes up, as it
    // does on a click.
    skip: (sq, e) => {
      if (e.pointerType !== 'touch' || !canLift?.(sq)) return false;
      if (!editing && hasDrawing) setDrawing(NO_DRAWING);
      return true;
    },
    onHold: (from) => {
      tapRef.current = null; // not a tap-to-draw tap as well
      setHeld({ from, to: from, color: colorNow(null, from, from) });
    },
    onMove: (from, to) => setHeld({ from, to, color: colorNow(null, from, to) }),
    onDone: (from, to) => {
      setHeld(null);
      if (editing) {
        if (to !== from) marks.onArrow(from, to, heldPen(settings, null));
        else marks.onSquare(from, heldPen(settings, null));
        return;
      }
      const o = optsFor(null);
      setDrawing((d) => (to === from ? drawSquare(d, from, o) : drawArrow(d, from, to, o)));
    },
    onCancel: () => setHeld(null),
    // A tap clears what's drawn here, and that's all it does.
    onTap: (sq, ev) => {
      if (editing || !hasDrawing) return;
      setDrawing(NO_DRAWING);
      swallowClickAt(ev.clientX, ev.clientY);
    },
  });

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse') hold.onPointerDown(e);
    if (e.button === 2) {
      const from = squareAtPoint(e.clientX, e.clientY);
      if (from) { e.preventDefault(); setPending({ from, to: from, color: colorNow(e, from, from) }); }
    } else if (e.button === 0 && editing && marks.tapToDraw) {
      // A second finger makes it a pinch, not a tap.
      if (!e.isPrimary) { tapRef.current = null; return; }
      const sq = squareAtPoint(e.clientX, e.clientY);
      if (!sq) return;
      e.preventDefault();
      tapRef.current = { id: e.pointerId, sq, x: e.clientX, y: e.clientY };
    } else if (e.button === 0 && hasDrawing && e.pointerType === 'mouse') {
      // A click clears, and does only that. (A finger clears when it lifts
      // from a tap — put down, it may be starting another arrow.)
      setDrawing(NO_DRAWING);
      swallowClickAt(e.clientX, e.clientY);
    }
  };

  const onPointerMove = (e) => {
    const t = tapRef.current;
    if (t && t.id === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) tapRef.current = null;
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY) ?? pending.to;
    const color = colorNow(e, pending.from, to);
    if (to !== pending.to || color !== pending.color) setPending((p) => ({ ...p, to, color }));
  };

  const onPointerUp = (e) => {
    const t = tapRef.current;
    tapRef.current = null;
    if (t && t.id === e.pointerId && editing && marks.tapToDraw
      && squareAtPoint(e.clientX, e.clientY) === t.sq) {
      if (!tapFrom) { setTapFrom(t.sq); return; }
      setTapFrom(null);
      if (t.sq === tapFrom) marks.onSquare(t.sq, heldPen(settings, e));
      else marks.onArrow(tapFrom, t.sq, heldPen(settings, e));
      return;
    }
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY) ?? pending.to;
    const { from } = pending;
    setPending(null);
    if (editing) {
      if (to && to !== from) marks.onArrow(from, to, heldPen(settings, e));
      else if (from) marks.onSquare(from, heldPen(settings, e));
      return;
    }
    if (!from || !to) return;
    // The same mark again takes it off; in another colour, recolours it —
    // the others stay.
    const o = optsFor(e);
    setDrawing((d) => (to === from ? drawSquare(d, from, o) : drawArrow(d, from, to, o)));
  };

  const drag = held ?? pending;
  const live = drag && drag.to !== drag.from
    ? [[drag.from, drag.to, drag.color]]
    : [];
  const pen = restPen;
  const size = boardWidth / 8;
  // The square a tap-to-draw arrow starts from, or a held finger's.
  const startSq = held?.from ?? tapFrom;
  const tapCell = startSq ? cell(startSq, orientation) : null;

  return (
    <div
      ref={hostRef}
      className="board-draw-host"
      style={{ position: 'relative', width: boardWidth, height: boardWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { setPending(null); tapRef.current = null; }}
      onPointerCancel={() => { setPending(null); tapRef.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <BoardArrows
        arrows={[...(marks?.arrows ?? []), ...drawing.arrows, ...live]}
        boardWidth={boardWidth}
        orientation={orientation}
        halo={profile !== 'default'}
      />
      {tapCell && (
        <div
          className="draw-tap-from"
          style={{
            left: tapCell.x * size, top: tapCell.y * size, width: size, height: size, borderColor: held?.color ?? pen,
          }}
        />
      )}
    </div>
  );
}

export { BOARD_THEME };
