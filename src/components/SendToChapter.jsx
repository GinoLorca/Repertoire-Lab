import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { planSend } from '../lib/chapterTransfer';

// Lines sent to another chapter, anywhere in the same repertoire (yours, or
// the one student's): Copy leaves them here as well, Move takes them out of
// here. Opened from a line's right-click / ⋯ menu (one line) or Select mode
// (the ticked ones). `onSent({ mode, count, skipped, openingId, chapterId,
// name })` once they've gone.
export default function SendToChapter({
  opening, chapter, ids, onClose, onSent,
}) {
  const { state, dispatch } = useStore();
  useBackGuard(true, onClose);
  const [query, setQuery] = useState('');
  const [dest, setDest] = useState(null); // { openingId, chapterId }
  const owner = opening.ownerId ?? null;
  const lines = chapter.variations.filter((v) => ids.includes(v.id));

  // Every other chapter in this repertoire, by opening, this opening first.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.openings
      .filter((o) => (o.ownerId ?? null) === owner)
      .sort((a, b) => (b.id === opening.id) - (a.id === opening.id))
      .map((o) => ({
        opening: o,
        chapters: o.chapters.filter((c) => !(o.id === opening.id && c.id === chapter.id)
          && (!q || `${o.name} ${c.section ?? ''} ${c.subsection ?? ''} ${c.name}`.toLowerCase().includes(q))),
      }))
      .filter((g) => g.chapters.length);
  }, [state.openings, owner, opening.id, chapter.id, query]);

  const from = { openingId: opening.id, chapterId: chapter.id };
  const plan = dest ? planSend(state.openings, { from, to: dest, ids }) : null;
  const destChapter = dest && state.openings.find((o) => o.id === dest.openingId)?.chapters.find((c) => c.id === dest.chapterId);
  const n = plan?.lines.length ?? 0;
  const send = (mode) => {
    dispatch({ type: 'sendToChapter', from, to: dest, ids, mode });
    onSent({ mode, count: n, skipped: plan.skipped.length, ...dest, name: destChapter.name });
  };
  const s = (k) => (k === 1 ? '' : 's');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal send-sub send-chapter" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Send {lines.length} line{s(lines.length)} to another chapter</h3>
        <ul className="send-chapter-lines">
          {lines.slice(0, 5).map((v) => <li key={v.id}>{v.name}</li>)}
          {lines.length > 5 && <li className="muted-note">…and {lines.length - 5} more</li>}
        </ul>
        <div className="send-sub-section">
          <div className="send-sub-label">To</div>
          <input
            type="text"
            placeholder="Search chapters…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="send-chapter-list" role="radiogroup" aria-label="Destination chapter">
            {groups.map(({ opening: o, chapters }) => (
              <div key={o.id} className="send-chapter-group">
                <div className="send-chapter-opening">{o.name}</div>
                {chapters.map((c) => {
                  const on = dest?.openingId === o.id && dest?.chapterId === c.id;
                  return (
                    <label key={c.id} className={`send-sub-dest send-chapter-dest${on ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name="send-chapter"
                        checked={on}
                        onChange={() => setDest({ openingId: o.id, chapterId: c.id })}
                      />
                      <span className="send-chapter-name">
                        {[c.section, c.subsection].filter(Boolean).map((x) => <span key={x} className="muted-note">{x} ▸ </span>)}
                        {c.name}
                      </span>
                      <span className="muted-note">{c.variations.length} line{s(c.variations.length)}</span>
                    </label>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 && <div className="empty-note">No chapter matches “{query}”.</div>}
          </div>
        </div>
        {plan && plan.skipped.length > 0 && (
          <p className="hint">
            {plan.skipped.length === lines.length
              ? `“${destChapter.name}” already has ${lines.length === 1 ? 'this line' : 'all of these'} — nothing to send.`
              : `${plan.skipped.length} of these ${plan.skipped.length === 1 ? 'is' : 'are'} already in “${destChapter.name}” (same moves) and will be left out.`}
          </p>
        )}
        <p className="hint">
          <strong>Copy</strong> keeps {lines.length === 1 ? 'it' : 'them'} here as well; {lines.length === 1 ? 'the copy starts' : 'the copies start'} unlearned there.
          {' '}<strong>Move</strong> takes {lines.length === 1 ? 'it' : 'them'} out of this chapter, progress and all.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button disabled={!n} onClick={() => send('copy')}>Copy{n ? ` ${n}` : ''}</button>
          <button className="primary" disabled={!n} onClick={() => send('move')}>Move{n ? ` ${n}` : ''}</button>
        </div>
      </div>
    </div>
  );
}
