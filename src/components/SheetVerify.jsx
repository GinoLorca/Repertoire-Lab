import React, { useEffect, useMemo, useRef, useState } from 'react';
import Board from '../components/Board';
import { validateSequence, fenAfter, toScoresheetRows } from '../lib/gameEdit';
import { PrevIcon, NextIcon, AlertIcon, CheckIcon } from './Icons';

// Reading a handwritten scoresheet is a line-by-line job: the row you're on in
// the transcription and the same row on the photo have to be in front of you at
// once. This lays the two out side by side and keeps them in step — arrow keys
// walk down the sheet, and the photo scrolls itself to the line you're on.

const statusClass = (row) => {
  if (!row) return 'empty';
  if (row.status === 'ok') return 'ok';
  if (row.status === 'illegal') return 'bad';
  if (row.status === 'blocked') return 'blocked';
  return 'unknown';
};

// A single move as a coloured chip, editable in place.
function MoveChip({ row, index, selected, onSelect, onChange }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  if (index === null || index === undefined) return <span className="sv-chip empty" />;

  if (editing) {
    return (
      <span className="sv-chip editing">
        <input
          ref={inputRef}
          defaultValue={row?.status === 'unknown' ? '' : (row?.raw ?? '')}
          placeholder="move"
          onBlur={(e) => { setEditing(false); onChange(index, e.target.value.trim()); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { setEditing(false); onChange(index, e.target.value.trim()); }
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
        />
      </span>
    );
  }

  return (
    <button
      className={`sv-chip ${statusClass(row)}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(index)}
      onDoubleClick={() => setEditing(true)}
      title={row?.status === 'ok' ? row.san : 'Double-click to correct'}
    >
      {row ? (row.status === 'ok' ? row.san : (row.raw || '—')) : '—'}
    </button>
  );
}

export default function SheetVerify({
  photos, moves, onChangeMove, selected, onSelect, boardWidth, suggestions, onUseSuggestion,
}) {
  const rows = useMemo(() => validateSequence(moves), [moves]);
  const sheetRows = useMemo(() => toScoresheetRows(rows), [rows]);
  const laneRef = useRef(null);
  const rowRefs = useRef([]);

  // Where row 1 and the last row of a column sit on the photo, as fractions of
  // its height, and how the sheet is laid out. Most tournament sheets run two
  // columns — 1–20 down the left, 21–40 down the right.
  const [calib, setCalib] = useState({
    top: 0.30, bottom: 0.97, rows: 20, columns: 2,
  });
  const [photoIndex, setPhotoIndex] = useState(0);

  const selectedRow = Math.floor(selected / 2);
  // Which column the current row is in, and how far down that column it sits.
  const perColumn = Math.max(1, calib.rows);
  const column = calib.columns === 2 ? Math.min(1, Math.floor(selectedRow / perColumn)) : 0;
  const rowInColumn = calib.columns === 2 ? selectedRow % perColumn : selectedRow;

  // Keep the selected row in view in the transcription lane.
  useEffect(() => {
    const el = rowRefs.current[selectedRow];
    const lane = laneRef.current;
    if (!el || !lane) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < lane.scrollTop || bottom > lane.scrollTop + lane.clientHeight) {
      lane.scrollTo({ top: Math.max(0, top - (lane.clientHeight - el.offsetHeight) / 2), behavior: 'instant' });
    }
  }, [selectedRow]);

  // The band on the photo for the current row, and the scroll that centres it.
  const span = Math.max(0.001, (calib.bottom - calib.top) / Math.max(1, perColumn - 1));
  const bandTop = calib.top + span * rowInColumn;
  const photoWrapRef = useRef(null);
  const imgRef = useRef(null);
  useEffect(() => {
    const wrap = photoWrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalHeight) return;
    const y = bandTop * img.clientHeight;
    wrap.scrollTo({ top: Math.max(0, y - wrap.clientHeight / 2), behavior: 'instant' });
  }, [bandTop, photoIndex]);

  const boardFen = useMemo(() => {
    const row = rows[selected];
    if (row && row.status !== 'ok' && row.fenBefore) return row.fenBefore;
    return fenAfter(rows, Math.min(selected + 1, rows.length));
  }, [rows, selected]);

  const problems = rows.filter((r) => r.status === 'illegal' || r.status === 'unknown').length;

  return (
    <div className="sheet-verify">
      <div className="sv-board">
        <Board
          id="sheet-verify"
          position={boardFen}
          arePiecesDraggable={false}
          boardWidth={boardWidth}
        />
        <div className="sv-board-note">
          {rows[selected]?.status === 'ok'
            ? <>Position after <strong>{Math.floor(selected / 2) + 1}{selected % 2 === 0 ? '.' : '…'}{rows[selected].san}</strong></>
            : <>Position before move <strong>{Math.floor(selected / 2) + 1}{selected % 2 === 0 ? '.' : '…'}</strong></>}
        </div>
        <div className="sv-step">
          <button className="small" title="Previous move (←)" onClick={() => onSelect(Math.max(0, selected - 1))}>
            <PrevIcon size={15} />
          </button>
          <span className="muted-note">move {selected + 1} of {rows.length}</span>
          <button className="small" title="Next move (→)" onClick={() => onSelect(Math.min(rows.length - 1, selected + 1))}>
            <NextIcon size={15} />
          </button>
        </div>
        <div className={`sv-status${problems ? ' bad' : ' ok'}`}>
          {problems
            ? <><AlertIcon size={13} /> {problems} move{problems === 1 ? '' : 's'} to check</>
            : <><CheckIcon size={13} /> every move reads as legal</>}
        </div>
      </div>

      <div className="sv-lane" ref={laneRef}>
        {sheetRows.map(({ n, whiteIndex, blackIndex }, i) => (
          <div
            key={n}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={`sv-row${selectedRow === i ? ' current' : ''}`}
          >
            <span className="sv-num">{n}</span>
            <MoveChip
              row={rows[whiteIndex]}
              index={whiteIndex}
              selected={selected === whiteIndex}
              onSelect={onSelect}
              onChange={onChangeMove}
            />
            <MoveChip
              row={blackIndex !== null ? rows[blackIndex] : null}
              index={blackIndex}
              selected={selected === blackIndex}
              onSelect={onSelect}
              onChange={onChangeMove}
            />
          </div>
        ))}
      </div>

      <div className="sv-photo">
        <div className="sv-photo-head">
          {photos.length > 1 && (
            <span className="sv-pages">
              {photos.map((_, i) => (
                <button
                  key={i}
                  className={`small${photoIndex === i ? ' primary' : ''}`}
                  onClick={() => setPhotoIndex(i)}
                >
                  {i + 1}
                </button>
              ))}
            </span>
          )}
          <span className="muted-note">line {selectedRow + 1}</span>
        </div>
        <div className="sv-photo-wrap" ref={photoWrapRef}>
          <img ref={imgRef} src={photos[photoIndex]} alt="scoresheet" />
          <span
            className="sv-band"
            style={{
              top: `${bandTop * 100}%`,
              height: `${span * 100}%`,
              left: calib.columns === 2 && column === 1 ? '50%' : 0,
              right: calib.columns === 2 && column === 0 ? '50%' : 0,
            }}
          />
        </div>
        <div className="sv-calib">
          <span className="muted-note">Line up the band with the sheet:</span>
          <label>
            first row
            <input
              type="range" min="0" max="0.5" step="0.005"
              value={calib.top}
              onChange={(e) => setCalib((c) => ({ ...c, top: Number(e.target.value) }))}
            />
          </label>
          <label>
            last row
            <input
              type="range" min="0.5" max="1" step="0.005"
              value={calib.bottom}
              onChange={(e) => setCalib((c) => ({ ...c, bottom: Number(e.target.value) }))}
            />
          </label>
          <label>
            rows per column
            <input
              type="number" min="5" max="80"
              value={calib.rows}
              onChange={(e) => setCalib((c) => ({ ...c, rows: Number(e.target.value) || 20 }))}
            />
          </label>
          <label>
            layout
            <select
              value={calib.columns}
              onChange={(e) => setCalib((c) => ({ ...c, columns: Number(e.target.value) }))}
            >
              <option value={1}>One column</option>
              <option value={2}>Two columns</option>
            </select>
          </label>
        </div>
      </div>

      {suggestions?.length > 0 && (
        <div className="sv-suggest">
          <strong>Looks like:</strong>
          {suggestions.map((s) => (
            <button key={s} className="small" onClick={() => onUseSuggestion(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
