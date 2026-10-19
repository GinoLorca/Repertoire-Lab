import React, { useEffect, useRef, useState } from 'react';
import { uid } from '../store';
import { Engine } from '../lib/engine';
import { scoreOf } from '../lib/gameReview';
import {
  SLOTS, MAX_MOMENTS, MAX_TITLE, MAX_MOMENT_NOTE, canFollow, canBeBetter, inGameOrder, fenAt, placeLabel,
  defaultTitle, movesText, slotScore, swing, carryMarks, canCarry,
} from '../lib/moments';
import { CameraIcon, PlayIcon } from './Icons';

// Studio's Before & After (lib/moments): mark the position that mattered,
// then where it led — and, where there was something better, where that
// would have gone. Each moment is a card here; the move list marks its moves
// with the same numbered pips.

export const ROLE_LABEL = { before: 'Before', after: 'After', better: 'Better' };

// A moment's marker: its number, in a ring for the Before, filled blue for
// the After and green for the Better — the same everywhere it's drawn.
export function MomentPip({ role, n }) {
  return (
    <span className={`moment-pip ${role}`} title={`Moment ${n} · ${ROLE_LABEL[role]}`}>{n}</span>
  );
}

const samePath = (a, b) => Boolean(a && b) && a.length === b.length && a.every((s, i) => s === b[i]);

// Stockfish's score at each of a moment's places, worked out once, one at a
// time, on an engine of its own — the board's live one is busy with whatever
// is on the board. Stored on the moment, so a student's app never needs to.
const DEPTH = 14;
function useMomentScores({ moments, setMoments, baseFen, enabled }) {
  const engineRef = useRef(null);
  const busyRef = useRef(false);
  const failedRef = useRef(new Set()); // not tried again while this board is open
  const aliveRef = useRef(true);
  const [tick, setTick] = useState(0);
  useEffect(() => () => {
    aliveRef.current = false;
    engineRef.current?.quit();
    engineRef.current = null;
  }, []);
  useEffect(() => {
    if (!enabled || busyRef.current) return;
    let job = null;
    for (const m of moments) {
      for (const slot of SLOTS) {
        const path = m[slot];
        const key = path && `${m.id}|${slot}|${path.join(' ')}`;
        if (path && !m.evals?.[slot] && !failedRef.current.has(key)) { job = { id: m.id, slot, path, key }; break; }
      }
      if (job) break;
    }
    if (!job) return;
    const fen = fenAt(baseFen, job.path);
    if (!fen) { failedRef.current.add(job.key); setTick((t) => t + 1); return; }
    busyRef.current = true;
    if (!engineRef.current) engineRef.current = new Engine({ multiPV: 1 });
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), 20000); });
    Promise.race([scoreOf(engineRef.current, fen, DEPTH), late]).then((score) => {
      clearTimeout(timer);
      busyRef.current = false;
      if (!aliveRef.current) return;
      if (score === 'late' || !score) {
        failedRef.current.add(job.key);
        // Stuck on this one: a fresh engine for the next.
        engineRef.current?.quit();
        engineRef.current = null;
      } else {
        setMoments((list) => list.map((m) => (m.id === job.id && samePath(m[job.slot], job.path)
          ? { ...m, evals: { ...(m.evals ?? {}), [job.slot]: score } }
          : m)));
      }
      setTick((t) => t + 1);
    });
  }, [moments, enabled, baseFen, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Score at the Before → at the After (and the Better), coloured by how it went
// for the side whose move it was.
export function ScoreSwing({ moment, baseFen }) {
  const after = swing(moment, baseFen, 'after');
  const better = moment.better ? swing(moment, baseFen, 'better') : null;
  return (
    <span className="moment-scores">
      <span className={`moment-score${after ? ` ${after.tone}` : ''}`} title="Stockfish: at the Before → at the After (White’s side)">
        {slotScore(moment, 'before', baseFen)} → {slotScore(moment, 'after', baseFen)}
      </span>
      {moment.better && (
        <span className={`moment-score better-score${better ? ` ${better.tone}` : ''}`} title="Stockfish at the Better">
          Better {slotScore(moment, 'better', baseFen)}
        </span>
      )}
    </span>
  );
}

export default function MomentsPanel({
  moments, setMoments, tree, headPath, baseFen, annotations, setAnnotations, onGo, onOpen, openNow, onPresent,
  editable = true,
}) {
  const [pending, setPending] = useState(null); // the Before, waiting for its After
  const [openId, setOpenId] = useState(null);
  useMomentScores({ moments, setMoments, baseFen, enabled: editable });
  const hasMoves = (tree?.children?.length ?? 0) > 0;
  if (!hasMoves && moments.length === 0) return null;

  const full = moments.length >= MAX_MOMENTS;
  const update = (id, fn) => setMoments((list) => inGameOrder(list.map((m) => {
    if (m.id !== id) return m;
    const next = fn(m);
    // An After moved onto the Better's line leaves no Better to compare with.
    if (next.better && !canBeBetter(next, next.better)) {
      delete next.better;
      if (next.evals) {
        next.evals = { ...next.evals };
        delete next.evals.better;
      }
    }
    return next;
  })));
  const setSlot = (id, slot, path) => update(id, (m) => {
    const evals = { ...(m.evals ?? {}) };
    delete evals[slot];
    const next = { ...m, evals };
    if (path) next[slot] = path; else delete next[slot];
    return next;
  });
  const addMoment = () => {
    const m = { id: uid(), before: pending, after: headPath };
    setMoments((list) => inGameOrder([...list, m]));
    setPending(null);
    setOpenId(m.id);
  };
  const remove = (m, n) => {
    if (!window.confirm(`Delete moment ${n} — ${m.title || defaultTitle(m, baseFen)}?`)) return;
    setMoments((list) => list.filter((x) => x.id !== m.id));
    if (openId === m.id) setOpenId(null);
  };
  const carry = (m) => {
    const from = fenAt(baseFen, m.before);
    setAnnotations((all) => {
      let next = carryMarks(all, from, fenAt(baseFen, m.after));
      if (m.better) next = carryMarks(next, from, fenAt(baseFen, m.better));
      return next;
    });
  };

  return (
    <section className="moments-panel" aria-label="Before and After">
      <div className="moments-head">
        <CameraIcon size={14} />
        <span className="moments-title">Before &amp; After</span>
        {moments.length > 0 && <span className="moments-count">{moments.length}</span>}
        <span style={{ flex: 1 }} />
        {onPresent && moments.length > 0 && (
          <button
            type="button"
            className="small primary"
            title="Show them to the room, full screen — a clicker, or the arrow keys, steps through"
            onClick={() => onPresent(Math.max(0, moments.findIndex((m) => m.id === openId)))}
          >
            <PlayIcon size={13} /> Present
          </button>
        )}
      </div>

      {editable && (pending ? (
        <div className="moments-pending">
          <p className="hint">
            <span className="moment-pip before pending">B</span>
            {' '}Before: <strong>{placeLabel(pending, baseFen)}</strong>. Now step on to where it shows — later in the
            game, or down a line — and set the After there.
          </p>
          <div className="moments-actions">
            <button
              type="button"
              className="small primary"
              disabled={!canFollow(pending, headPath)}
              title={canFollow(pending, headPath) ? 'Where the Before led' : 'Step forward from the Before first'}
              onClick={addMoment}
            >
              Set After here
            </button>
            <button type="button" className="small ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="moments-actions">
          <button
            type="button"
            className="small"
            disabled={full || !hasMoves}
            title={full ? `Up to ${MAX_MOMENTS} moments on one game` : 'Make the position on the board a Before — the critical moment'}
            onClick={() => setPending(headPath)}
          >
            <span className="moment-pip before">B</span> Set Before here
          </button>
          {moments.length === 0 && (
            <span className="muted-note moments-intro">
              Mark a critical position, then where it led. They’re shown side by side, with what changed.
            </span>
          )}
        </div>
      ))}

      {moments.map((m, i) => {
        const n = i + 1;
        const open = openId === m.id;
        const named = m.title?.trim();
        const title = named || defaultTitle(m, baseFen);
        const here = (path) => samePath(path, headPath);
        const fromFen = fenAt(baseFen, m.before);
        const carryable = editable && (canCarry(annotations, fromFen, fenAt(baseFen, m.after))
          || (m.better && canCarry(annotations, fromFen, fenAt(baseFen, m.better))));
        return (
          <div key={m.id} className={`moment-card${open ? ' open' : ''}`}>
            <button
              type="button"
              className="moment-summary"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : m.id)}
            >
              <span className={`moment-name${named ? '' : ' untitled'}`}>{n}. {title}</span>
              <span className="moment-places">
                <MomentPip role="before" n={n} /> {placeLabel(m.before, baseFen)}
                {' → '}<MomentPip role="after" n={n} /> {placeLabel(m.after, baseFen)}
                {m.better && <>{' · '}<MomentPip role="better" n={n} /> {placeLabel(m.better, baseFen)}</>}
              </span>
              <ScoreSwing moment={m} baseFen={baseFen} />
            </button>

            {open && (
              <div className="moment-body">
                {onOpen && (
                  <button
                    type="button"
                    className={`small${openNow === m.id ? '' : ' primary'} moment-open`}
                    onClick={() => onOpen(openNow === m.id ? null : m.id)}
                  >
                    {openNow === m.id ? 'Back to one board' : 'Side by side'}
                  </button>
                )}
                <div className="moment-jumps">
                  {SLOTS.filter((slot) => m[slot]).map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={`small ghost moment-jump${here(m[slot]) ? ' here' : ''}`}
                      title={`Put the board on the ${ROLE_LABEL[slot]}`}
                      onClick={() => onGo(m[slot])}
                    >
                      <MomentPip role={slot} n={n} /> {ROLE_LABEL[slot]}
                    </button>
                  ))}
                </div>
                <p className="muted-note moment-between">{movesText(m.before, m.after, baseFen)}</p>
                {editable ? (
                  <>
                    <input
                      type="text"
                      className="moment-title-input"
                      value={m.title ?? ''}
                      maxLength={MAX_TITLE}
                      placeholder={`Title — e.g. “${defaultTitle(m, baseFen)} gives up d5 for good”`}
                      aria-label="Title"
                      onChange={(e) => update(m.id, (x) => ({ ...x, title: e.target.value }))}
                    />
                    <textarea
                      rows={3}
                      className="annotate-textarea"
                      value={m.note ?? ''}
                      maxLength={MAX_MOMENT_NOTE}
                      placeholder="What changed, and why it still matters here"
                      aria-label="What changed"
                      onChange={(e) => update(m.id, (x) => ({ ...x, note: e.target.value }))}
                    />
                    <div className="moments-actions">
                      {canFollow(m.before, headPath) && !here(m.after) && !canBeBetter(m, headPath) && (
                        <button type="button" className="small" onClick={() => setSlot(m.id, 'after', headPath)}>
                          Move After here
                        </button>
                      )}
                      {canBeBetter(m, headPath) && !here(m.better) && (
                        <button
                          type="button"
                          className="small"
                          title="Where the game should have gone from the Before"
                          onClick={() => setSlot(m.id, 'better', headPath)}
                        >
                          <MomentPip role="better" n={n} /> {m.better ? 'Move Better here' : 'Set Better here'}
                        </button>
                      )}
                      {m.better && (
                        <button type="button" className="small ghost" onClick={() => setSlot(m.id, 'better', null)}>
                          Remove Better
                        </button>
                      )}
                      {carryable && (
                        <button
                          type="button"
                          className="small"
                          title="Copy the Before’s arrows and squares onto the After (and the Better) — what’s still there"
                          onClick={() => carry(m)}
                        >
                          Carry marks forward
                        </button>
                      )}
                      <button type="button" className="small ghost danger" onClick={() => remove(m, n)}>
                        Delete
                      </button>
                    </div>
                    {!m.better && (
                      <p className="muted-note moment-tip">
                        To add a Better: from the Before, play the move that should have been played, step to where it
                        leads, and set it here.
                      </p>
                    )}
                  </>
                ) : (
                  m.note && <p className="moment-note">{m.note}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
