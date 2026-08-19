import { Chess } from 'chess.js';
import React, { useEffect, useMemo, useState } from 'react';
import Board from '../components/Board';
import { lastMoveOf } from '../lib/legalMoves';
import { badgeAt } from '../lib/badges';
import BoardArrows from '../components/BoardArrows';
import { useStore } from '../store';
import { useViewportWidth } from '../components/useViewportWidth';
import {
  diverge, siblingsOf, allVariations, fensFor, moveSquares, plyLabel,
} from '../lib/compare';
import { movetextToLines, validateLine } from '../lib/pgn';
import MoveText from '../components/MoveText';
import {
  PrevIcon, NextIcon, SkipStartIcon, SkipEndIcon, TargetIcon, PlayIcon, PencilIcon,
} from '../components/Icons';

const SIDE_COLOR = { a: '#3b9cff', b: '#e8b339' };

// Turn pasted text into a comparable line. Accepts a bare move list or a full
// PGN; the first line of a PGN with branches is the one used.
function parsePasted(text, side, name) {
  const lines = movetextToLines(text);
  if (!lines.length) return { error: 'No moves found in that text.' };
  const parsed = validateLine(lines[0].moves);
  if (parsed.moves.length === 0) {
    return { error: `Couldn't read a legal line — stuck at “${parsed.failedToken}”.` };
  }
  return {
    warning: parsed.ok ? null : `Ignored everything from “${parsed.failedToken}”.`,
    item: {
      pasted: true,
      opening: { id: `paste-${side}`, name: 'Pasted', color: 'white' },
      chapter: { id: `paste-${side}`, name: 'typed in by hand' },
      variation: {
        id: `paste-${side}`,
        name: name?.trim() || `Pasted line ${side.toUpperCase()}`,
        moves: parsed.moves,
        comments: lines[0].comments ?? {},
        tags: [],
      },
    },
  };
}

function PasteModal({ side, initial, onUse, onClose }) {
  const [text, setText] = useState(initial?.pasted ? initial.variation.moves.join(' ') : '');
  const [name, setName] = useState(initial?.pasted ? initial.variation.name : '');
  const result = useMemo(() => (text.trim() ? parsePasted(text, side, name) : null), [text, side, name]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3>Line {side.toUpperCase()} — type or paste moves</h3>
        <p className="hint">
          Paste a PGN or just the moves, e.g. <code>1.d4 d5 2.Nc3 Nf6 3.Bf4</code>. It doesn't have to be
          in your repertoire — this is for comparing anything against anything.
        </p>
        <textarea
          rows={5}
          autoFocus
          value={text}
          placeholder="1.d4 d5 2.Nc3 Nf6 3.Bf4 Bf5 4.Nb5 Na6 5.e3 c6…"
          onChange={(e) => setText(e.target.value)}
        />
        <input
          type="text"
          value={name}
          placeholder={`Name (optional) — defaults to “Pasted line ${side.toUpperCase()}”`}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="status-line" style={{ minHeight: 24 }}>
          {result?.error && <span className="status-bad">✗ {result.error}</span>}
          {result?.item && (
            <span className="status-ok">
              ✓ {result.item.variation.moves.length} moves read
              {result.warning ? ` · ${result.warning}` : ''}
            </span>
          )}
        </div>
        {result?.item && (
          <div className="cmp-paste-preview">
            <MoveText moves={result.item.variation.moves.slice(0, 24)} />
            {result.item.variation.moves.length > 24 && <span className="muted-note"> …</span>}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!result?.item} onClick={() => onUse(result.item)}>
            Use as line {side.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// Picker for one side: a repertoire line, or something typed in by hand.
function LinePicker({ side, choices, value, onChange, label, onPaste }) {
  const index = choices.findIndex((c) => c.variation.id === value?.variation.id);
  const step = (d) => {
    if (!choices.length) return;
    const next = (index + d + choices.length) % choices.length;
    onChange(choices[next]);
  };
  const isPasted = !!value?.pasted;
  return (
    <div className={`cmp-picker side-${side}`}>
      <span className="cmp-side-tag" style={{ background: SIDE_COLOR[side] }}>{label}</span>
      <button className="small ghost" title="Previous line" onClick={() => step(-1)} disabled={!choices.length || isPasted}>
        <PrevIcon size={15} />
      </button>
      {isPasted ? (
        <span className="cmp-pasted-name" title={value.variation.moves.join(' ')}>
          {value.variation.name}
          <span className="muted-note"> · {value.variation.moves.length} moves</span>
        </span>
      ) : (
        <select
          value={value?.variation.id ?? ''}
          onChange={(e) => {
            const hit = choices.find((c) => c.variation.id === e.target.value);
            if (hit) onChange(hit);
          }}
        >
          {choices.length === 0 && <option value="">No lines available</option>}
          {choices.map((c) => (
            <option key={c.variation.id} value={c.variation.id}>
              {c.variation.name} — {c.chapter.name}
            </option>
          ))}
        </select>
      )}
      <button className="small ghost" title="Next line" onClick={() => step(1)} disabled={!choices.length || isPasted}>
        <NextIcon size={15} />
      </button>
      <button
        className={`small${isPasted ? ' primary' : ''}`}
        title="Type or paste moves to compare a line that isn't in your repertoire"
        onClick={onPaste}
      >
        <PencilIcon size={13} /> {isPasted ? 'Edit' : 'Paste'}
      </button>
      {isPasted && (
        <button className="small ghost" title="Back to picking a repertoire line" onClick={() => onChange(choices[0] ?? null)}>
          ✕
        </button>
      )}
    </div>
  );
}

// Notation with the shared opening greyed out, the splitting move boxed, and
// everything after it in that side's colour.
function SplitMoves({ moves, at, side, ply, onJump }) {
  const nodes = [];
  for (let i = 0; i < moves.length; i += 1) {
    const isWhite = i % 2 === 0;
    if (isWhite) nodes.push(<span key={`n${i}`} className="cmp-num">{i / 2 + 1}.</span>);
    const cls = i < at ? 'shared' : i === at ? 'split' : 'after';
    nodes.push(
      <span
        key={i}
        className={`cmp-mv ${cls}${i === ply - 1 ? ' current' : ''}`}
        style={i >= at ? { color: SIDE_COLOR[side] } : undefined}
        onClick={() => onJump(i + 1)}
      >
        {moves[i]}
      </span>,
    );
  }
  return <div className="cmp-moves">{nodes}</div>;
}

function Side({ side, item, at, ply, boardWidth, onJump, onAnalyze }) {
  const key = (item?.variation.moves ?? []).join(' ');
  const fens = useMemo(() => fensFor(item?.variation.moves ?? []), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const moves = item?.variation.moves ?? [];
  const shownPly = Math.min(ply, moves.length);
  const split = moveSquares(moves, at);
  // Once past the split, keep the diverging move drawn so the difference stays
  // on screen while you walk further down the line.
  const arrows = shownPly > at && split
    ? [[split.from, split.to, SIDE_COLOR[side]]]
    : [];
  const squares = shownPly > at && split
    ? { [split.to]: { boxShadow: `inset 0 0 0 3px ${SIDE_COLOR[side]}` } }
    : {};

  return (
    <div className={`cmp-side side-${side}`}>
      <div className="cmp-side-head">
        <span className="cmp-side-tag" style={{ background: SIDE_COLOR[side] }}>{side.toUpperCase()}</span>
        <strong title={item?.variation.name}>{item?.variation.name ?? '—'}</strong>
        <span className="muted-note" title={item?.chapter.name}>{item?.chapter.name}</span>
        <span style={{ flex: 1 }} />
        {item && (
          <button className="small ghost" title="Open this line in the engine" onClick={() => onAnalyze(item.variation)}>
            <PlayIcon size={13} /> Analyze
          </button>
        )}
      </div>
      <div className="cmp-board" style={{ width: boardWidth }}>
        <div style={{ position: 'relative', width: boardWidth, height: boardWidth }}>
          <Board
            id={`cmp-${side}`}
            position={fens[shownPly] ?? fens[fens.length - 1]}
            lastMove={lastMoveOf(Chess, moves, Math.min(shownPly, moves.length))}
            badge={badgeAt(item?.variation.badges, Math.min(shownPly, moves.length) - 1)?.id}
            arePiecesDraggable={false}
            areArrowsAllowed={false}
            customSquareStyles={squares}
            boardOrientation={item?.opening.color === 'black' ? 'black' : 'white'}
            boardWidth={boardWidth}
          />
          <BoardArrows arrows={arrows} boardWidth={boardWidth} orientation={item?.opening.color === 'black' ? 'black' : 'white'} />
        </div>
      </div>
      <div className="cmp-line-meta">
        {shownPly >= moves.length && moves.length > 0
          ? <span className="muted-note">end of line · {moves.length} moves</span>
          : <span className="muted-note">{shownPly} of {moves.length} moves played</span>}
      </div>
      <SplitMoves moves={moves} at={at} side={side} ply={shownPly} onJump={onJump} />
    </div>
  );
}

export default function CompareView({ onAnalyze }) {
  const { state } = useStore();
  const everything = useMemo(() => allVariations(state.openings), [state.openings]);
  const [a, setA] = useState(() => everything[0] ?? null);
  const [b, setB] = useState(null);
  const [ply, setPly] = useState(0);
  const [pasting, setPasting] = useState(null); // 'a' | 'b'
  const viewportWidth = useViewportWidth();

  // B defaults to whichever line follows A the longest — the most instructive
  // comparison, and the one you almost always want.
  const siblings = useMemo(() => siblingsOf(a, state.openings), [a, state.openings]);
  useEffect(() => {
    if (!a) return;
    // A hand-typed line on either side is left exactly as entered.
    if (b?.pasted || a?.pasted) return;
    if (!b || b.variation.id === a.variation.id || !siblings.some((s) => s.variation.id === b.variation.id)) {
      setB(siblings[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, siblings]);

  const split = useMemo(() => diverge(a?.variation, b?.variation), [a, b]);
  const maxPly = split.maxLen;

  // Land on the interesting moment rather than the start.
  const aKey = (a?.variation.moves ?? []).join(' ');
  const bKey = (b?.variation.moves ?? []).join(' ');
  useEffect(() => { setPly(Math.min(split.at + 1, maxPly)); }, [aKey, bKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPly((p) => Math.max(0, p - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setPly((p) => Math.min(maxPly, p + 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const i = siblings.findIndex((s) => s.variation.id === b?.variation.id);
        const next = siblings[(i + (e.key === 'ArrowDown' ? 1 : -1) + siblings.length) % siblings.length];
        if (next) setB(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxPly, siblings, b]);

  // Both boards are sized from the column they actually sit in, measured. A
  // width guessed from the window can exceed the card, and then each side gets
  // squeezed by a slightly different amount — which is how two boards meant to
  // be identical end up different sizes.
  const [gridEl, setGridEl] = useState(null);
  const [colW, setColW] = useState(0);
  useEffect(() => {
    if (!gridEl || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => {
      const side = gridEl.querySelector('.cmp-side');
      // The inside of a card: its own width less padding and border.
      if (side) setColW(side.clientWidth - 28);
    };
    const ro = new ResizeObserver(read);
    ro.observe(gridEl);
    read();
    return () => ro.disconnect();
  }, [gridEl]);

  // Whole squares only: a board width that isn't a multiple of 8 leaves the
  // last file and rank a fraction wider than the rest, which reads as the board
  // being slightly out of square on the right.
  const squares = (w) => Math.max(160, Math.floor(w / 8) * 8);
  const boardWidth = squares(Math.min(460, colW || Math.min(440, viewportWidth - 70)));

  if (everything.length < 2) {
    return (
      <div className="page">
        <div className="empty-note">
          Compare needs at least two variations — import a few lines first.
        </div>
      </div>
    );
  }

  const beforeSplit = ply <= split.at;

  return (
    <div className="page wide">
      <div className="cmp-pickers">
        <LinePicker
          side="a"
          label="A"
          choices={everything}
          value={a}
          onChange={setA}
          onPaste={() => setPasting('a')}
        />
        <LinePicker
          side="b"
          label="B"
          choices={siblings.length ? siblings : everything}
          value={b}
          onChange={setB}
          onPaste={() => setPasting('b')}
        />
      </div>

      {/* The headline: where these two lines stop agreeing. */}
      <div className={`cmp-banner${beforeSplit ? ' same' : ''}`}>
        {split.contained ? (
          <>
            <TargetIcon size={17} />
            <span>
              These lines never disagree — one is the first <strong>{split.at}</strong> moves of the other.
            </span>
          </>
        ) : (
          <>
            <TargetIcon size={17} />
            <span>
              {split.at === 0 ? (
                <>These lines differ from the very first move:</>
              ) : (
                <>
                  Identical for <strong>{split.at}</strong> move{split.at === 1 ? '' : 's'} — then, on move{' '}
                  <strong>{Math.floor(split.at / 2) + 1}</strong>{' '}
                  ({split.at % 2 === 0 ? 'White' : 'Black'} to play), they part:
                </>
              )}
            </span>
            <span className="cmp-split-move" style={{ color: SIDE_COLOR.a, borderColor: SIDE_COLOR.a }}>
              A {plyLabel(split.at)}{split.aMove}
            </span>
            <span className="cmp-vs">vs</span>
            <span className="cmp-split-move" style={{ color: SIDE_COLOR.b, borderColor: SIDE_COLOR.b }}>
              B {plyLabel(split.at)}{split.bMove}
            </span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button className="small primary" onClick={() => setPly(split.at + 1)}>
          <TargetIcon size={13} /> Jump to the split
        </button>
      </div>

      <div className="cmp-scrub">
        <button title="Start" onClick={() => setPly(0)} disabled={ply === 0}><SkipStartIcon size={16} /></button>
        <button title="Back one move" onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>
          <PrevIcon size={16} />
        </button>
        <input
          type="range"
          min={0}
          max={maxPly}
          value={ply}
          onChange={(e) => setPly(Number(e.target.value))}
          style={{ '--split-pct': `${maxPly ? (split.at / maxPly) * 100 : 0}%` }}
        />
        <button title="Forward one move" onClick={() => setPly((p) => Math.min(maxPly, p + 1))} disabled={ply >= maxPly}>
          <NextIcon size={16} />
        </button>
        <button title="End" onClick={() => setPly(maxPly)} disabled={ply >= maxPly}><SkipEndIcon size={16} /></button>
        <span className="cmp-ply">
          {beforeSplit
            ? <span className="cmp-state same">same position</span>
            : <span className="cmp-state diff">lines have split</span>}
          <span className="muted-note">
            {' · '}
            {ply === 0
              ? 'start'
              : ply <= split.at
                ? `after ${plyLabel(ply - 1)}${a?.variation.moves[ply - 1] ?? ''}`
                : `move ${Math.floor((ply - 1) / 2) + 1}`}
            {' · '}step {ply} of {maxPly}
          </span>
        </span>
      </div>

      <div className="cmp-grid" ref={setGridEl}>
        <Side side="a" item={a} at={split.at} ply={ply} boardWidth={boardWidth} onJump={setPly} onAnalyze={onAnalyze} />
        <Side side="b" item={b} at={split.at} ply={ply} boardWidth={boardWidth} onJump={setPly} onAnalyze={onAnalyze} />
      </div>

      {pasting && (
        <PasteModal
          side={pasting}
          initial={pasting === 'a' ? a : b}
          onClose={() => setPasting(null)}
          onUse={(item) => {
            if (pasting === 'a') setA(item); else setB(item);
            setPasting(null);
          }}
        />
      )}

      <div className="muted-note cmp-help">
        Left / right arrows step both lines together · up / down cycle line B through the variations
        that follow A the longest · click any move to jump there · use <strong>Paste</strong> on either
        side to compare a line that isn't in your repertoire.
      </div>
    </div>
  );
}
