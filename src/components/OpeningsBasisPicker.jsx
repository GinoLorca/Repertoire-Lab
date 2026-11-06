// What a player's Openings tab is based on: openings for White and for Black,
// as many of each as you like, from your own library and any student's — a
// course kept under one student can sort another's games too. Kept on the
// player's card (setOpeningsBasis), so it's the same on every device.
import React, { useState } from 'react';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { basisFor, defaultBasis, ownerLabel } from '../lib/openingsBasis';

const lineCount = (o) => (o.chapters ?? []).reduce((n, c) => n + (c.variations?.length ?? 0), 0);

export default function OpeningsBasisPicker({ player, onClose }) {
  const { state, dispatch } = useStore();
  useBackGuard(true, onClose);
  const [picked, setPicked] = useState(() => new Set(basisFor(state.openings, player).ids));
  const flip = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Whose library: this player's, yours, then other students' — each a group.
  const owners = [
    player.kind === 'student' ? player.id : null,
    null,
    ...state.players.filter((p) => p.kind === 'student' && p.id !== player.id).map((p) => p.id),
  ].filter((v, i, a) => a.indexOf(v) === i);
  const groupName = (ownerId) => (ownerId === null ? 'My library'
    : ownerId === player.id ? `${player.name}’s` : ownerLabel({ ownerId }, state.players));
  const side = (color) => owners.map((ownerId) => ({
    ownerId,
    list: state.openings.filter((o) => (o.ownerId ?? null) === ownerId && (o.color === 'black' ? 'black' : 'white') === color),
  })).filter((g) => g.list.length);
  const save = (ids) => {
    dispatch({ type: 'setOpeningsBasis', playerId: player.id, ids });
    onClose();
  };
  // Back to the default: it follows their openings as they change, where a
  // pick stays as picked.
  const offerDefault = basisFor(state.openings, player).picked || (() => {
    const d = defaultBasis(state.openings, player);
    return !(d.length === picked.size && d.every((id) => picked.has(id)));
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal basis-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{player.name}’s Openings tab: based on</h3>
        <p className="hint">
          Every game of {player.name}’s is sorted by these openings, move by move, so you see which
          lines they reach, where they leave them, and how those games go. Pick as many for White and
          for Black as you like — from your library or any student’s.
        </p>
        <div className="basis-cols">
          {['white', 'black'].map((color) => (
            <div key={color} className="basis-col">
              <div className="basis-col-head">
                <span className={`color-dot ${color}`} /> {color === 'white' ? 'White' : 'Black'}
              </div>
              {side(color).length === 0 && <p className="muted-note">No {color} openings anywhere yet.</p>}
              {side(color).map(({ ownerId, list }) => (
                <div key={ownerId ?? 'me'} className="basis-group">
                  <div className="basis-group-name">{groupName(ownerId)}</div>
                  {list.map((o) => (
                    <label key={o.id} className={`basis-item${picked.has(o.id) ? ' on' : ''}`}>
                      <input type="checkbox" checked={picked.has(o.id)} onChange={() => flip(o.id)} />
                      <span className="basis-name">{o.name}</span>
                      <span className="muted-note">{lineCount(o)} line{lineCount(o) === 1 ? '' : 's'}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          {offerDefault && (
            <button
              type="button"
              className="ghost basis-default"
              title={player.kind === 'student'
                ? `${player.name}’s own openings and yours of the same name`
                : 'Your whole library'}
              onClick={() => save(null)}
            >
              Use the default
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={() => save([...picked])}>
            Save · {picked.size} opening{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
