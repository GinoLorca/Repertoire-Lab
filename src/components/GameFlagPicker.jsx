import React, { useState } from 'react';
import { GAME_FLAGS } from '../lib/gameFlags';

// One-click toggle chips for the fixed flag vocabulary, plus room for a
// custom one-off — no popover, no autocomplete, nothing shared with the
// repertoire's Themes. Click a chip to add or remove it from the game.
export default function GameFlagPicker({ flags, onChange }) {
  const current = flags ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const toggle = (id) => onChange(
    current.includes(id) ? current.filter((f) => f !== id) : [...current, id],
  );

  const commitDraft = () => {
    const v = draft.trim();
    if (v && !current.includes(v)) onChange([...current, v]);
    setDraft('');
    setAdding(false);
  };

  // Anything on the game that isn't one of the presets was typed in by hand.
  const custom = current.filter((f) => !GAME_FLAGS.some((g) => g.id === f));

  return (
    <div className="flag-picker">
      {GAME_FLAGS.map((f) => (
        <button
          key={f.id}
          className={`flag-chip${current.includes(f.id) ? ' active' : ''}`}
          style={current.includes(f.id) ? { background: f.color, borderColor: f.color } : undefined}
          onClick={() => toggle(f.id)}
        >
          {f.label}
        </button>
      ))}
      {custom.map((f) => (
        <button key={f} className="flag-chip active" title="Click to remove" onClick={() => toggle(f)}>
          {f}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          className="flag-add-input"
          value={draft}
          placeholder="Custom flag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
            if (e.key === 'Escape') { setDraft(''); setAdding(false); }
          }}
          onBlur={commitDraft}
        />
      ) : (
        <button className="flag-chip add" onClick={() => setAdding(true)}>+ Custom</button>
      )}
    </div>
  );
}
