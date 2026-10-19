import React, { useEffect, useMemo, useState } from 'react';
import Board from './Board';
import { MomentPip, ROLE_LABEL } from './MomentsPanel';
import { useStore } from '../store';
import { boardColors } from '../lib/theme';
import { pieceImage, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { drawnSquareStyle } from '../lib/reviewText';
import {
  SLOTS, placeAt, placeLabel, defaultTitle, movesText, slotScore, swing, boardChange, materialLabel,
} from '../lib/moments';

// A moment's boards side by side (lib/moments): the Before, the After and —
// when there is one — the Better, each with its own drawings and Stockfish's
// score. On the After and the Better, a faded piece stands wherever one stood
// at the Before and has gone since, and what's arrived is outlined: what
// changed, at a glance. Too narrow for that (a phone), one board at a time
// with a switch above it.
//
// Used on the analysis board (in place of its own board) and by Present.

const SLOT_HEX = { before: '#e8b339', after: '#3b9cff', better: '#2ecc71' };
const GAP = 12;

// The squares a board shows: what was drawn on that position, then — on an
// After or a Better — the faded pieces left behind and the outlined arrivals.
export function momentSquareStyles({ drawn, change, slot, light, dark }) {
  const out = {};
  for (const [sq, colour] of Object.entries(drawn?.squares ?? {})) out[sq] = drawnSquareStyle(colour);
  if (!change) return out;
  const standing = new Set(change.arrived.map((a) => a.square));
  for (const { square, piece } of change.left) {
    // Only where the square is empty now — under a piece, a ghost is noise.
    if (standing.has(square)) continue;
    const img = pieceImage(piece, light, dark, 0.32);
    if (img) {
      out[square] = {
        ...(out[square] ?? {}),
        backgroundImage: `url("${img}")`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      };
    }
  }
  for (const { square } of change.arrived) {
    const shadow = `inset 0 0 0 2px ${SLOT_HEX[slot]}b3`;
    const prev = out[square]?.boxShadow;
    out[square] = { ...(out[square] ?? {}), boxShadow: prev ? `${prev}, ${shadow}` : shadow };
  }
  return out;
}

// Everything one of a moment's boards needs, worked out once per moment.
export function useMomentPlaces(moment, baseFen) {
  return useMemo(() => {
    const before = placeAt(baseFen, moment.before);
    const out = {};
    for (const slot of SLOTS) {
      const path = moment[slot];
      const place = path && placeAt(baseFen, path);
      if (!place) continue;
      out[slot] = {
        ...place,
        path,
        change: slot !== 'before' && before ? boardChange(before.fen, place.fen) : null,
      };
    }
    return out;
  }, [moment, baseFen]);
}

// One board of a moment, with its heading and what changed under it.
// Present uses the rest: `label` for the move it's on while the game is
// replayed, `scored` and `showDrawn` off until the After is revealed,
// `animate` so a replayed move slides.
export function MomentBoard({
  moment, n, slot, place, baseFen, annotations, orientation, width, hidden = false, onReveal, onPick,
  label, scored = true, showDrawn = true, animate = false,
}) {
  const { state } = useStore();
  const colours = boardColors(state.settings);
  const light = colours.pieceLight ?? DEFAULT_PIECE_LIGHT;
  const dark = colours.pieceDark ?? DEFAULT_PIECE_DARK;
  const drawn = showDrawn ? annotations?.[place.fen] : null;
  const styles = useMemo(
    () => momentSquareStyles({ drawn, change: place.change, slot, light, dark }),
    [drawn, place.change, slot, light, dark],
  );
  const tone = slot !== 'before' ? swing(moment, baseFen, slot)?.tone : null;
  const m = place.change?.material;
  return (
    <figure className={`moment-board ${slot}`} style={{ width }}>
      <figcaption className="moment-board-head">
        <MomentPip role={slot} n={n} />
        <span className="moment-board-label">{ROLE_LABEL[slot]}</span>
        <span className="moment-board-move">{label ?? placeLabel(place.path, baseFen)}</span>
        {scored && !hidden && (
          <span className={`moment-score${tone ? ` ${tone}` : ''}`}>{slotScore(moment, slot, baseFen)}</span>
        )}
      </figcaption>
      <div className="moment-board-frame" style={{ width, height: width }}>
        <Board
          id={`moment-${slot}`}
          position={place.fen}
          boardWidth={width}
          boardOrientation={orientation}
          arePiecesDraggable={false}
          lastMove={place.lastMove}
          customSquareStyles={styles}
          marks={{ arrows: drawn?.arrows ?? [] }}
          animationDuration={animate ? 300 : 0}
        />
        {hidden && (
          <button type="button" className="moment-board-cover" onClick={onReveal}>
            <span className="moment-board-cover-q">?</span>
            <span>What happens next?</span>
            <span className="moment-board-cover-tap">Tap — or press → — to reveal</span>
          </button>
        )}
      </div>
      {((m && !hidden) || onPick) && (
        <div className="moment-board-foot">
          {m && !hidden && (
            <span className="moment-board-change muted-note">
              {m.from === m.to ? materialLabel(m.to) : `${materialLabel(m.from)} → ${materialLabel(m.to)}`}
            </span>
          )}
          {onPick && (
            <button
              type="button"
              className="small ghost moment-board-pick"
              title="Back to the one board, on this position"
              onClick={() => onPick(place.path)}
            >
              Go here
            </button>
          )}
        </div>
      )}
    </figure>
  );
}

export default function MomentBoards({
  moment, n, baseFen, annotations, orientation, width, narrow, onClose, onPick, onPresent,
}) {
  const places = useMomentPlaces(moment, baseFen);
  const slots = SLOTS.filter((s) => places[s]);
  const [tab, setTab] = useState('after');
  useEffect(() => { if (!places[tab]) setTab('after'); }, [places, tab]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = narrow ? [places[tab] ? tab : 'after'] : slots;
  const each = narrow ? width : Math.floor((width - GAP * (shown.length - 1)) / shown.length / 8) * 8;
  const title = moment.title?.trim() || defaultTitle(moment, baseFen);

  return (
    // The analysis board draws on whatever square a pointer lands on: kept
    // from reaching it, so a right-drag here doesn't mark up the board hidden
    // underneath.
    <div
      className="moment-boards"
      style={{ width }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="moment-boards-head">
        <span className="moment-boards-title">{n}. {title}</span>
        <span style={{ flex: 1 }} />
        {onPresent && (
          <button type="button" className="small primary" onClick={onPresent} title="Show it to the room, full screen">
            Present
          </button>
        )}
        <button type="button" className="small" onClick={onClose} title="Back to the one board (Esc)">
          One board
        </button>
      </div>
      {narrow && (
        <div className="moment-tabs" role="tablist">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              className={tab === s ? 'active' : ''}
              onClick={() => setTab(s)}
            >
              <MomentPip role={s} n={n} /> {ROLE_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <div className="moment-boards-row" style={{ gap: GAP }}>
        {shown.map((s) => (
          <MomentBoard
            key={s}
            moment={moment}
            n={n}
            slot={s}
            place={places[s]}
            baseFen={baseFen}
            annotations={annotations}
            orientation={orientation}
            width={each}
            onPick={onPick}
          />
        ))}
      </div>
      <p className="moment-boards-between">
        <MomentPip role="before" n={n} /> → <MomentPip role="after" n={n} />{' '}
        {movesText(moment.before, moment.after, baseFen, { max: 12 })}
      </p>
      {moment.note?.trim() && <p className="moment-note">{moment.note.trim()}</p>}
      <p className="muted-note moment-legend">
        Faded pieces stood there at the Before; outlined squares are where pieces have arrived since.
      </p>
    </div>
  );
}
