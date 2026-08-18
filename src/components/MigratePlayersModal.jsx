import React, { useState } from 'react';
import { useStore } from '../store';

// Existing players predate the self/student split (Games vs. Coaches) — ask
// once which of them is you, so both tabs start out sorted right. No skip:
// an unmarked player would otherwise vanish from both tabs, since neither
// filters it in.
export default function MigratePlayersModal() {
  const { state, dispatch } = useStore();
  const unset = state.players.filter((p) => !p.kind);
  const [kinds, setKinds] = useState(() => Object.fromEntries(unset.map((p) => [p.id, 'student'])));

  if (unset.length === 0) return null;

  const save = () => {
    for (const p of unset) {
      dispatch({ type: 'setPlayerKind', playerId: p.id, kind: kinds[p.id] ?? 'student' });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h3>Which of these is you?</h3>
        <p className="hint">
          Games now keeps just your own play; a new Coaches tab holds your students. Mark yourself
          below — everyone else becomes a student. Either can be changed later from that person's
          profile.
        </p>
        {unset.map((p) => (
          <div key={p.id} className="settings-row">
            <strong style={{ flex: 1 }}>{p.name}</strong>
            <div className="tabs" style={{ margin: 0 }}>
              <button
                className={kinds[p.id] === 'self' ? 'active' : ''}
                onClick={() => setKinds((k) => ({ ...k, [p.id]: 'self' }))}
              >
                Me
              </button>
              <button
                className={kinds[p.id] !== 'self' ? 'active' : ''}
                onClick={() => setKinds((k) => ({ ...k, [p.id]: 'student' }))}
              >
                Student
              </button>
            </div>
          </div>
        ))}
        <div className="modal-actions">
          <button className="primary" onClick={save}>Done</button>
        </div>
      </div>
    </div>
  );
}
