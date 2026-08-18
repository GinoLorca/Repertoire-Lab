import React, { useEffect, useMemo, useRef, useState } from 'react';
import Board from '../components/Board';
import { useStore, uid } from '../store';
import { validateSequence, fenAfter, summarize, toScoresheetRows } from '../lib/gameEdit';
import { buildPositionIndex, bookMovesAt } from '../lib/repertoire';
import { useViewportWidth } from '../components/useViewportWidth';
import { BookIcon, AlertIcon } from '../components/Icons';
import SheetVerify from '../components/SheetVerify';

// One editable cell of the scoresheet-style table.
function MoveCell({ row, index, selected, onSelect, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!row) return <td className="mv-cell empty" />;

  const commit = (value) => {
    setEditing(false);
    if (value !== undefined && value !== row.raw) onChange(index, value);
  };

  const cls = [
    'mv-cell',
    row.status === 'ok' ? 'ok' : '',
    row.status === 'illegal' ? 'bad' : '',
    row.status === 'unknown' ? 'unknown' : '',
    row.status === 'blocked' ? 'blocked' : '',
    selected ? 'selected' : '',
  ].filter(Boolean).join(' ');

  if (editing) {
    return (
      <td className={cls}>
        <input
          ref={inputRef}
          className="mv-input"
          defaultValue={row.status === 'unknown' ? '' : row.raw}
          placeholder="move"
          onBlur={(e) => commit(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.target.value.trim());
            if (e.key === 'Escape') setEditing(false);
          }}
          onChange={(e) => setDraft(e.target.value)}
        />
        {row.legal.length > 0 && (
          <div className="mv-suggest">
            {row.legal
              .filter((s) => !draft || s.toLowerCase().startsWith(draft.toLowerCase()))
              .slice(0, 6)
              .map((s) => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); commit(s); }}>{s}</button>
              ))}
          </div>
        )}
      </td>
    );
  }

  return (
    <td
      className={cls}
      onClick={() => onSelect(index)}
      onDoubleClick={() => setEditing(true)}
      title={row.status === 'ok' ? 'Click to view, double-click to edit' : undefined}
    >
      <span className="mv-text">
        {row.status === 'ok' ? row.san : (row.raw || '—')}
      </span>
      <button
        className="mv-edit"
        title="Edit this move"
        onClick={(e) => { e.stopPropagation(); setDraft(''); setEditing(true); }}
      >
        ✎
      </button>
    </td>
  );
}

export default function VerifyView({ draft, onCancel, onAnalyze, onSaved }) {
  const { state, dispatch } = useStore();
  const [moves, setMoves] = useState(draft.moves);
  const [name, setName] = useState(draft.name || 'Scoresheet game');
  const [selected, setSelected] = useState(draft.moves.length);
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [playerSel, setPlayerSel] = useState(state.players[0]?.id ?? '');
  const [newPlayerName, setNewPlayerName] = useState('');
  const viewportWidth = useViewportWidth();

  const positionIndex = useMemo(() => buildPositionIndex(state.openings), [state.openings]);
  const rows = useMemo(() => validateSequence(moves), [moves]);
  const stats = useMemo(() => summarize(rows), [rows]);
  const sheetRows = useMemo(() => toScoresheetRows(rows), [rows]);

  // When a move can't be read, the move your own repertoire plays here is by
  // far the most likely intention — surface it ahead of look-alike guesses.
  const bookSuggestions = useMemo(() => {
    const row = rows[selected];
    if (!row || row.status === 'ok' || row.status === 'blocked' || !row.fenBefore) return [];
    return bookMovesAt(positionIndex, row.fenBefore).map((b) => b.san);
  }, [rows, selected, positionIndex]);

  // First problem drives the "jump to issue" affordance.
  const firstProblem = rows.findIndex((r) => r.status === 'illegal' || r.status === 'unknown');

  useEffect(() => {
    if (firstProblem >= 0) setSelected(firstProblem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boardFen = useMemo(() => {
    const row = rows[selected];
    if (row && row.status !== 'ok' && row.fenBefore) return row.fenBefore;
    return fenAfter(rows, Math.min(selected + 1, rows.length));
  }, [rows, selected]);

  const changeMove = (index, value) => {
    setMoves((ms) => {
      const next = [...ms];
      if (value === '') next.splice(index, 1);
      else next[index] = value;
      return next;
    });
  };

  const truncateHere = (index) => setMoves((ms) => ms.slice(0, index));
  const addMove = () => {
    setMoves((ms) => [...ms, '??']);
    setSelected(moves.length);
  };

  const applyText = () => {
    const tokens = textDraft
      .replace(/(\d+)\s*\.+\s*/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t));
    setMoves(tokens);
    setTextMode(false);
  };

  // Only the verified prefix is worth committing.
  const verifiedMoves = rows.filter((r) => r.status === 'ok').map((r) => r.san);

  const saveToGames = () => {
    let playerId = playerSel;
    if (playerSel === '__new') {
      playerId = uid();
      dispatch({ type: 'addPlayer', id: playerId, name: newPlayerName.trim() });
    }
    dispatch({ type: 'addGame', playerId, game: { name, moves: verifiedMoves } });
    onSaved();
  };

  const canSave = verifiedMoves.length > 0
    && (playerSel === '__new' ? newPlayerName.trim() : playerSel);

  const boardWidth = viewportWidth >= 1100 ? 380 : Math.min(340, viewportWidth - 60);
  // A photographed scoresheet gets the line-by-line review; a screenshot import
  // keeps the table it already had.
  const sheetMode = !!draft.handwritten && (draft.photos?.length ?? 0) > 0;

  // ← / → walk the moves, ↑ / ↓ jump a whole row, so a sheet can be checked
  // without leaving the keyboard.
  useEffect(() => {
    if (!sheetMode) return undefined;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const last = Math.max(0, rows.length - 1);
      if (e.key === 'ArrowLeft') { e.preventDefault(); setSelected((i) => Math.max(0, i - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSelected((i) => Math.min(last, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(0, i - 2)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(last, i + 2)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetMode, rows.length]);

  return (
    <div className="page wide">
      <div className="breadcrumb">
        <a onClick={onCancel}>Import</a>
        <span>▸</span>
        <span>Verify moves</span>
      </div>

      <div className="page-head">
        <h1>Verify the moves</h1>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 240 }}
          placeholder="Game name"
        />
      </div>

      <div className={`verify-banner ${stats.clean ? 'clean' : 'attention'}`}>
        {stats.clean ? (
          <>✓ All {stats.total} moves read as legal. Check them against the photo, then commit.</>
        ) : (
          <>
            <AlertIcon size={14} className="warn-tick" /> <strong>{stats.problems + stats.blocked}</strong> of {stats.total} moves need attention
            {stats.blocked > 0 && ' (everything after the first problem can’t be checked until it’s fixed)'}.
            {firstProblem >= 0 && (
              <button className="small" style={{ marginLeft: 10 }} onClick={() => setSelected(firstProblem)}>
                Jump to first issue
              </button>
            )}
          </>
        )}
      </div>

      {sheetMode ? (
        <SheetVerify
          photos={draft.photos}
          moves={moves}
          onChangeMove={changeMove}
          selected={selected}
          onSelect={setSelected}
          boardWidth={boardWidth}
          suggestions={rows[selected] && rows[selected].status !== 'ok' && rows[selected].status !== 'blocked'
            ? [...bookSuggestions, ...rows[selected].suggestions.filter((x) => !bookSuggestions.includes(x))]
            : []}
          onUseSuggestion={(san) => changeMove(selected, san)}
        />
      ) : (
      <div className="verify-layout">
        <div className="verify-photo">
          {draft.photos?.length > 0 ? (
            draft.photos.map((src, i) => <img key={i} src={src} alt="scoresheet" />)
          ) : (
            <div className="muted-note">No photo attached.</div>
          )}
        </div>

        <div className="verify-board">
          <Board
            id="verify"
            position={boardFen}
            arePiecesDraggable={false}
            boardWidth={boardWidth}
          />
          <div className="muted-note" style={{ textAlign: 'center', marginTop: 8 }}>
            {rows[selected]?.status === 'ok'
              ? `Position after ${Math.floor(selected / 2) + 1}${selected % 2 === 0 ? '.' : '…'}${rows[selected].san}`
              : 'Position before the selected move'}
          </div>
        </div>

        <div className="verify-moves">
          <div className="verify-toolbar">
            <button className="small" onClick={() => { setTextDraft(moves.join(' ')); setTextMode((t) => !t); }}>
              {textMode ? 'Back to table' : 'Edit as text'}
            </button>
            <button className="small" onClick={addMove}>+ Add move</button>
            <span style={{ flex: 1 }} />
            <span className="muted-note">Click a move to view · ✎ to edit</span>
          </div>

          {textMode ? (
            <>
              <textarea
                rows={8}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="1.e4 c6 2.d4 d5 …"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button className="primary" onClick={applyText}>Apply</button>
              </div>
            </>
          ) : (
            <table className="sheet-table">
              <thead>
                <tr><th>#</th><th>White</th><th>Black</th><th /></tr>
              </thead>
              <tbody>
                {sheetRows.map(({ n, whiteIndex, blackIndex }) => (
                  <tr key={n}>
                    <td className="sheet-num">{n}</td>
                    <MoveCell
                      row={rows[whiteIndex]}
                      index={whiteIndex}
                      selected={selected === whiteIndex}
                      onSelect={setSelected}
                      onChange={changeMove}
                    />
                    <MoveCell
                      row={blackIndex !== null ? rows[blackIndex] : null}
                      index={blackIndex}
                      selected={selected === blackIndex}
                      onSelect={setSelected}
                      onChange={changeMove}
                    />
                    <td className="sheet-actions">
                      <button
                        className="small ghost"
                        title="The game ends here — delete this move and everything after"
                        onClick={() => truncateHere(whiteIndex)}
                      >
                        ✂
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rows[selected] && rows[selected].status !== 'ok' && rows[selected].status !== 'blocked' && (
            <div className="verify-suggest">
              {bookSuggestions.length > 0 && (
                <>
                  <strong className="book-hint"><BookIcon size={14} /> Your repertoire plays:</strong>
                  {bookSuggestions.map((s) => (
                    <button key={s} className="small primary" onClick={() => changeMove(selected, s)}>{s}</button>
                  ))}
                  <span className="sep" />
                </>
              )}
              <strong>Looks like:</strong>
              {rows[selected].suggestions
                .filter((s) => !bookSuggestions.includes(s))
                .map((s) => (
                  <button key={s} className="small" onClick={() => changeMove(selected, s)}>{s}</button>
                ))}
              <span className="muted-note">
                — or ✎ the cell and type to search all {rows[selected].legal.length} legal moves
              </span>
            </div>
          )}
        </div>
      </div>
      )}

      <div className="assign-bar verify-commit">
        <div className="verify-count">
          <strong>{verifiedMoves.length}</strong> verified move{verifiedMoves.length === 1 ? '' : 's'} ready
        </div>
        <label>
          Save to
          <select value={playerSel} onChange={(e) => setPlayerSel(e.target.value)}>
            <option value="">Don't save</option>
            {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__new">+ New group…</option>
          </select>
        </label>
        {playerSel === '__new' && (
          <label className="grow">
            New group name
            <input
              type="text"
              placeholder="e.g. My games, Student: Alex"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
            />
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onCancel}>Discard</button>
        {sheetMode && (
          <button
            title="Send the moves through as they were read and fix anything on the analysis board"
            onClick={() => onAnalyze({ name, moves: rows.filter((r) => r.status === 'ok').map((r) => r.san) })}
          >
            Skip checking
          </button>
        )}
        <button disabled={!canSave} onClick={saveToGames}>Save to Games</button>
        <button
          className="primary"
          disabled={verifiedMoves.length === 0}
          onClick={() => {
            if (canSave) saveToGames();
            onAnalyze({ name, moves: verifiedMoves });
          }}
        >
          ✓ Commit &amp; Analyze
        </button>
      </div>
    </div>
  );
}
