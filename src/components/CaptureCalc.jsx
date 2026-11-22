// The Capture Calculator's card (lib/captureCalc): where it started, the moves
// of the sequence with what each one took, the balance with a two-sided bar,
// what changed hands, and whether the trades are finished — Chess Arcade's
// card, in this app's look. Drawn from props only (no store), so it renders
// in a test: tests/captureCalc.test.mjs.
//
// Under the count, the engine's view of the same position (`engine`: { now,
// before }, lib/useCalcEval): who stands better, on a bar like the count's —
// because being up two pawns and being better are not the same thing, and
// where they part ways the card says so in a sentence.
//
// "Hide the count" (for students: work it out in your head first) hides the
// points, the balance, the bar, the engine's view, what changed hands and the verdict until
// "Show the count" (the moves and the status line stay); it's remembered on
// this device only (localStorage, never the synced settings).
import React, { useEffect, useRef } from 'react';
import {
  moveWhat, movePoints, balanceText, tookText, promotedText, statusText, verdictText,
  evalText, evalNumber, evalShare, evalVersusCount,
} from '../lib/captureCalc';

const HIDE_KEY = 'rl.captureCalc.hideCount';
export function readHideCount() {
  try { return globalThis.localStorage?.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
export function writeHideCount(on) {
  try {
    if (on) globalThis.localStorage?.setItem(HIDE_KEY, '1');
    else globalThis.localStorage?.removeItem(HIDE_KEY);
  } catch { /* private browsing: just this time, then */ }
}

// The bar's half is full at this many points either way.
const BAR_FULL = 10;

export default function CaptureCalc({
  line, count, start, you = null, hidden = false, onHide, onGo, onDone, onKeep = null, keyName = '',
  compact = false, engine = null,
}) {
  const moves = line?.moves ?? [];
  const at = count?.at ?? 0;
  // The move the board is on stays in view in a long sequence — scrolled
  // inside the list only, never the page.
  const listRef = useRef(null);
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector('.calc-move.current');
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight;
  }, [at, moves.length]);
  if (!count) return null;
  const bal = count.balance;
  const fill = (Math.min(Math.abs(bal), BAR_FULL) / BAR_FULL) * 50;
  const verdict = verdictText(count);
  const keyHint = keyName ? ` (${keyName})` : '';
  // The engine's score for the position the board is on, and for the start.
  const score = engine?.now ?? null;
  const share = evalShare(score);
  // (Only once something has changed hands: before that there is no count
  // to set against it.)
  const versus = count.events > 0 ? evalVersusCount(bal, score, you) : null;
  return (
    <section className={`panel calc-panel${compact ? ' compact' : ''}`} aria-label="Capture Calculator">
      <div className="calc-head">
        <h3>Capture Calculator</h3>
        <span className="spacer" />
        <button type="button" className="small" title={`Turn off the Capture Calculator${keyHint}`} onClick={onDone}>
          Done
        </button>
      </div>
      <button
        type="button"
        className={`calc-start${at === 0 ? ' current' : ''}`}
        aria-current={at === 0 ? 'step' : undefined}
        onClick={() => onGo?.(0)}
      >
        {start}
      </button>
      {moves.length > 0 ? (
        <ol className="calc-moves" ref={listRef}>
          {moves.map((m, i) => {
            const what = moveWhat(m);
            const cls = [
              'calc-move',
              i === at - 1 ? 'current' : '',
              i >= at ? 'ahead' : '',
              what ? 'took' : '',
            ].filter(Boolean).join(' ');
            return (
              <li key={i}>
                <button
                  type="button"
                  className={cls}
                  aria-current={i === at - 1 ? 'step' : undefined}
                  onClick={() => onGo?.(i + 1)}
                >
                  <span className="calc-san">{m.label}</span>
                  <span className="calc-what">{what}</span>
                  <span className="calc-pts">{hidden ? '' : movePoints(m)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="calc-hint">Play moves for both sides on the board.</p>
      )}
      <div className="calc-count">
        {hidden ? (
          <p className="calc-hidden-note">Count hidden: work it out in your head first.</p>
        ) : (
          <>
            <div className="calc-balance" aria-live="polite">{balanceText(bal, you)}</div>
            <div className="calc-bar" aria-hidden="true">
              <span className="calc-bar-side">{you === 'white' ? 'White (you)' : 'White'}</span>
              <span className="calc-bar-track">
                {bal !== 0 && (
                  <span
                    className={`calc-bar-fill ${bal > 0 ? 'w' : 'b'}`}
                    style={bal > 0 ? { right: '50%', width: `${fill}%` } : { left: '50%', width: `${fill}%` }}
                  />
                )}
                <span className="calc-bar-mid" />
              </span>
              <span className="calc-bar-side">{you === 'black' ? 'Black (you)' : 'Black'}</span>
            </div>
          </>
        )}
      </div>
      {engine && !hidden && (
        <div className="calc-eval">
          <div className="calc-eval-head">
            <span className="calc-eval-tag">Engine</span>
            {score ? (
              <>
                <strong aria-live="polite">{evalText(score, you)}</strong>
                <span className="calc-eval-num">{evalNumber(score)}</span>
              </>
            ) : (
              <span className="calc-eval-wait">working it out…</span>
            )}
          </div>
          <div className="calc-bar calc-bar-eval" aria-hidden="true">
            <span className="calc-bar-side">{you === 'white' ? 'White (you)' : 'White'}</span>
            <span className="calc-bar-track">
              {score && Math.abs(share - 50) >= 0.5 && (
                <span
                  className={`calc-bar-fill ${share > 50 ? 'w' : 'b'}`}
                  style={share > 50 ? { right: '50%', width: `${share - 50}%` } : { left: '50%', width: `${50 - share}%` }}
                />
              )}
              <span className="calc-bar-mid" />
            </span>
            <span className="calc-bar-side">{you === 'black' ? 'Black (you)' : 'Black'}</span>
          </div>
          {versus && <div className="calc-eval-versus">{versus}</div>}
          {at > 0 && engine.before && (
            <div className="calc-eval-before">
              Before these moves: {evalText(engine.before, you).replace(/^About/, 'about')} ({evalNumber(engine.before)}).
            </div>
          )}
        </div>
      )}
      {count.events > 0 && !hidden && (
        <div className="calc-took">
          {[tookText('w', count, you), promotedText('w', count, you), tookText('b', count, you), promotedText('b', count, you)]
            .filter(Boolean).map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      <p className="calc-status">
        {statusText(count)}
        {verdict && !hidden && <> <strong>{verdict}</strong></>}
      </p>
      <div className="calc-actions">
        <button type="button" className="small" onClick={() => onHide?.(!hidden)}>
          {hidden ? 'Show the count' : 'Hide the count'}
        </button>
        {onKeep && moves.length > 0 && (
          <button
            type="button"
            className="small"
            title="Keep these moves on the board as a side line"
            onClick={onKeep}
          >
            Keep as a side line
          </button>
        )}
      </div>
    </section>
  );
}
