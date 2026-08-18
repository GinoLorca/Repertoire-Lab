import React, { useMemo, useState } from 'react';
import { useBackGuard } from '../lib/backGuard';
import {
  FolderIcon, PlayIcon, ShuffleIcon, PencilIcon,
} from './Icons';

// One playlist, open for editing: rename, shuffle on/off, reorder, remove,
// and a search box to pull in lines from anywhere in your own repertoire.
function PlaylistEditor({ playlist, state, dispatch, onPractice, onBack }) {
  const [query, setQuery] = useState('');
  useBackGuard(true, onBack);

  const items = useMemo(() => playlist.items
    .map(({ openingId, chapterId, variationId }) => {
      const opening = state.openings.find((o) => o.id === openingId);
      const chapter = opening?.chapters.find((c) => c.id === chapterId);
      const variation = chapter?.variations.find((v) => v.id === variationId);
      return variation ? { opening, chapter, variation } : null;
    })
    .filter(Boolean), [playlist.items, state.openings]);

  const inPlaylist = new Set(playlist.items.map((it) => it.variationId));
  // Search only ever offers your own lines, not a student's — same as the
  // rest of Practice, which stays personal by default.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rows = [];
    for (const opening of state.openings) {
      if ((opening.ownerId ?? null) !== null) continue;
      for (const chapter of opening.chapters) {
        for (const variation of chapter.variations) {
          if (inPlaylist.has(variation.id)) continue;
          const hay = `${variation.name} ${chapter.name} ${opening.name}`.toLowerCase();
          if (hay.includes(q)) rows.push({ opening, chapter, variation });
        }
      }
    }
    return rows.slice(0, 25);
  }, [query, state.openings, playlist.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (row) => dispatch({
    type: 'addToPlaylist',
    playlistId: playlist.id,
    openingId: row.opening.id,
    chapterId: row.chapter.id,
    variationId: row.variation.id,
  });

  return (
    <div className="page">
      <div className="breadcrumb">
        <a onClick={onBack}>Playlists</a>
        <span>▸</span>
        <span>{playlist.name}</span>
      </div>

      <div className="page-head">
        <h1>{playlist.name}</h1>
        <button
          className="small ghost"
          title="Rename this playlist"
          onClick={() => {
            const name = window.prompt('Playlist name:', playlist.name);
            if (name?.trim()) dispatch({ type: 'renamePlaylist', playlistId: playlist.id, name: name.trim() });
          }}
        >
          <PencilIcon size={14} />
        </button>
        <span style={{ flex: 1 }} />
        <label className={`shuffle-toggle${playlist.shuffle ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={!!playlist.shuffle}
            onChange={(e) => dispatch({
              type: 'setPlaylistShuffle', playlistId: playlist.id, shuffle: e.target.checked,
            })}
          />
          <ShuffleIcon size={15} /> Shuffle
        </label>
        <button
          className="primary"
          disabled={items.length === 0}
          onClick={() => onPractice({ playlistId: playlist.id, shuffle: playlist.shuffle, mode: 'practice' })}
        >
          <PlayIcon size={15} /> Play{items.length ? ` (${items.length})` : ''}
        </button>
      </div>
      <p className="hint">
        {playlist.shuffle
          ? 'Shuffled — a fresh random order every time you press Play.'
          : 'In order, top to bottom — reorder with the arrows below.'}
        {' '}Each line is taught first if you haven't learned it yet, otherwise recalled from memory.
      </p>

      {items.length === 0 && (
        <div className="empty-note">Nothing added yet — search below to pull in lines from your repertoire.</div>
      )}

      {items.map(({ opening, chapter, variation }, i) => (
        <div key={variation.id} className="scope-card" style={{ cursor: 'default' }}>
          <div className="scope-info">
            <h3>{variation.name}</h3>
            <div className="sub">{opening.name} · {chapter.name}</div>
          </div>
          <span className="reorder">
            <button
              className="small ghost"
              disabled={i === 0}
              title="Move up"
              onClick={() => dispatch({
                type: 'movePlaylistItem', playlistId: playlist.id, variationId: variation.id, dir: -1,
              })}
            >
              ▲
            </button>
            <button
              className="small ghost"
              disabled={i === items.length - 1}
              title="Move down"
              onClick={() => dispatch({
                type: 'movePlaylistItem', playlistId: playlist.id, variationId: variation.id, dir: 1,
              })}
            >
              ▼
            </button>
          </span>
          <button
            className="small ghost danger"
            title="Remove from this playlist"
            onClick={() => dispatch({ type: 'removeFromPlaylist', playlistId: playlist.id, variationId: variation.id })}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="settings-section open" style={{ marginTop: 18 }}>
        <div className="settings-body">
          <input
            type="text"
            placeholder="Search your repertoire to add lines…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.map((row) => (
            <div key={row.variation.id} className="scope-card" style={{ cursor: 'default' }}>
              <div className="scope-info">
                <h3>{row.variation.name}</h3>
                <div className="sub">{row.opening.name} · {row.chapter.name}</div>
              </div>
              <button className="small" onClick={() => add(row)}>+ Add</button>
            </div>
          ))}
          {query.trim() && results.length === 0 && (
            <div className="empty-note">No matching lines (or they're already in this playlist).</div>
          )}
        </div>
      </div>
    </div>
  );
}

// The list of playlists — hand-picked practice sets, cutting across
// whatever openings/chapters the lines actually live in.
export default function PlaylistPicker({ state, dispatch, onPractice, onBack }) {
  const [openId, setOpenId] = useState(null);
  const playlists = state.playlists ?? [];
  const open = playlists.find((p) => p.id === openId);

  if (open) {
    return (
      <PlaylistEditor
        playlist={open}
        state={state}
        dispatch={dispatch}
        onPractice={onPractice}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <a onClick={onBack}>Practice</a>
        <span>▸</span>
        <span>Playlists</span>
      </div>
      <div className="page-head">
        <h1>Playlists</h1>
        <button
          className="primary"
          onClick={() => {
            const name = window.prompt('Playlist name:');
            if (name?.trim()) dispatch({ type: 'addPlaylist', name: name.trim() });
          }}
        >
          + New playlist
        </button>
      </div>
      <p className="hint">
        Hand-pick specific lines — whatever you're honing right now — into a set you can play
        straight through, in order or shuffled, regardless of which opening or chapter they live in.
      </p>

      {playlists.length === 0 && (
        <div className="empty-note">No playlists yet. Make one to start pulling lines into it.</div>
      )}

      {playlists.map((p) => (
        <div key={p.id} className="scope-card" onClick={() => setOpenId(p.id)}>
          <div className="scope-info">
            <h3><FolderIcon size={15} /> {p.name}</h3>
            <div className="sub">
              {p.items.length} line{p.items.length === 1 ? '' : 's'}
              {p.shuffle && <> · <ShuffleIcon size={12} /> shuffled</>}
            </div>
          </div>
          <button
            className="small ghost danger"
            title="Delete this playlist"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete the playlist "${p.name}"? The lines themselves are untouched.`)) {
                dispatch({ type: 'deletePlaylist', playlistId: p.id });
              }
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
