import React, { useEffect, useRef, useState } from 'react';
import { useBackGuard } from '../lib/backGuard';

// Every tag currently in use anywhere, for autocomplete.
export function allTags(state) {
  const set = new Set();
  for (const o of state.openings) {
    (o.tags ?? []).forEach((t) => set.add(t));
    for (const c of o.chapters) {
      (c.tags ?? []).forEach((t) => set.add(t));
      for (const v of c.variations) (v.tags ?? []).forEach((t) => set.add(t));
    }
  }
  for (const p of state.players ?? []) {
    for (const g of p.games) (g.tags ?? []).forEach((t) => set.add(t));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function TagChips({ tags, onClick, max }) {
  if (!tags?.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  return (
    <span className="tag-chips">
      {shown.map((t) => (
        <span
          key={t}
          className={`tag-chip${onClick ? ' clickable' : ''}`}
          onClick={onClick ? (e) => { e.stopPropagation(); onClick(t); } : undefined}
        >
          {t}
        </span>
      ))}
      {max && tags.length > max && <span className="tag-chip more">+{tags.length - max}</span>}
    </span>
  );
}

// Small popover for adding/removing tags on one item.
export default function TagEditor({ title, tags, suggestions, onChange, onClose }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const current = tags ?? [];
  useBackGuard(true, onClose);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const add = (tag) => {
    const t = tag.trim();
    if (!t || current.includes(t)) { setDraft(''); return; }
    onChange([...current, t]);
    setDraft('');
  };

  // Typing a name and pressing Done should save it — not everyone hits Enter
  // first, and silently dropping the text loses the tag.
  const commitAndClose = () => {
    if (draft.trim()) add(draft);
    onClose();
  };

  const remove = (tag) => onChange(current.filter((t) => t !== tag));

  const unused = (suggestions ?? [])
    .filter((t) => !current.includes(t))
    .filter((t) => !draft.trim() || t.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 10);

  return (
    <div className="modal-overlay" onClick={commitAndClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <h3>Themes — {title}</h3>
        <p className="hint">
          Themes group anything across your repertoire — “bishop trapping plan”, “needs work”,
          “tournament prep”. You can then search or practice a whole theme at once.
        </p>

        <div className="tag-current">
          {current.length === 0 && <span className="muted-note">No themes yet.</span>}
          {current.map((t) => (
            <span key={t} className="tag-chip removable">
              {t}
              <button onClick={() => remove(t)} title="Remove theme">✕</button>
            </span>
          ))}
        </div>

        <div className="tag-add-row">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="Type a name, e.g. bishop trapping plan"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(draft); }
              if (e.key === 'Backspace' && !draft && current.length) remove(current[current.length - 1]);
            }}
          />
          <button className="primary" disabled={!draft.trim()} onClick={() => add(draft)}>Add</button>
        </div>

        {unused.length > 0 && (
          <div className="tag-suggest">
            <span className="muted-note">Existing:</span>
            {unused.map((t) => (
              <button key={t} className="tag-chip clickable" onClick={() => add(t)}>{t}</button>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="primary" onClick={commitAndClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
