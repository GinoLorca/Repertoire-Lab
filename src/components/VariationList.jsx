import React, { memo, useEffect, useRef } from 'react';
import { isPracticed, isDue } from '../lib/srs';
import { CheckIcon, ClockIcon } from './Icons';

// The ring beside the chapter name: how much of it is learned and practiced.
function ProgressRing({ done, total, size = 38 }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" title={`${done} of ${total} practiced`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fill"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{pct}%</span>
    </span>
  );
}

// Where each line stands, as one glyph.
function StatusDot({ variation, done }) {
  if (done) return <span className="vl-dot done" title="Finished this session"><CheckIcon size={11} /></span>;
  if (isPracticed(variation)) return <span className="vl-dot practiced" title="Learned and practiced"><CheckIcon size={11} /></span>;
  if (isDue(variation)) return <span className="vl-dot due" title="Due for review"><ClockIcon size={11} /></span>;
  if (variation.learned) return <span className="vl-dot learning" title="Taught, not yet recalled cleanly" />;
  return <span className="vl-dot" title="Not started" />;
}

// The session's lines down the side, the way a course lists its chapter — so
// you can see what's coming and jump straight to any of it.
//
// Memoised: this is the widest part of the practice screen to re-render, and it
// only changes when the session moves on, not on every keystroke of state.
function VariationList({
  items, currentId, doneIds, onPick, open, onToggle, heading, subheading, artwork,
}) {
  const listRef = useRef(null);
  const activeRef = useRef(null);

  // Keep the line you're on in view as the session moves through the list.
  useEffect(() => {
    const box = listRef.current;
    const el = activeRef.current;
    if (!box || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - (box.clientHeight - el.offsetHeight) / 2), behavior: 'instant' });
    }
  }, [currentId]);

  const total = items.length;
  const done = items.filter((it) => doneIds.has(it.variation.id) || isPracticed(it.variation)).length;

  if (!open) {
    return (
      <button className="vl-reopen" title="Show the list of lines" onClick={onToggle}>
        »
      </button>
    );
  }

  return (
    <aside className="variation-list">
      <div className="vl-head">
        {artwork && <img className="vl-art" src={artwork} alt="" />}
        <div className="vl-head-text">
          <strong>{heading}</strong>
          {subheading && <span className="muted-note">{subheading}</span>}
        </div>
        <button className="vl-collapse" title="Hide this list" onClick={onToggle}>«</button>
      </div>

      <div className="vl-chapter">
        <span className="vl-chapter-name">{items[0]?.chapter?.name ?? 'Session'}</span>
        <ProgressRing done={done} total={total} />
      </div>

      <div className="vl-items" ref={listRef}>
        {items.map((it) => {
          const active = it.variation.id === currentId;
          return (
            <button
              key={it.variation.id}
              ref={active ? activeRef : null}
              className={`vl-item${active ? ' active' : ''}`}
              title={it.variation.name}
              onClick={() => onPick(it)}
            >
              <span className="vl-name">{it.variation.name}</span>
              <StatusDot variation={it.variation} done={doneIds.has(it.variation.id)} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default memo(VariationList);
