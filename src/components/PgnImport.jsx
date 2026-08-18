import React, { useMemo, useRef, useState } from 'react';
import { pgnTextToEntries } from '../lib/pgnImport';
import { useBackGuard } from '../lib/backGuard';
import { UploadIcon, ClipboardIcon, AlertIcon } from './Icons';

// One selectable line, shared by the flat (chapter) and grouped (course)
// layouts below.
function ImportRow({ entry: e, skip, setSkip, names, setNames }) {
  return (
    <label className={`import-row${skip[e.id] ? ' off' : ''}`}>
      <input
        type="checkbox"
        checked={!skip[e.id]}
        onChange={(ev) => setSkip((s) => ({ ...s, [e.id]: !ev.target.checked }))}
      />
      <input
        type="text"
        className="import-name"
        value={names[e.id] ?? e.name}
        onChange={(ev) => setNames((n) => ({ ...n, [e.id]: ev.target.value }))}
      />
      <span className="import-moves">
        {e.moves.slice(0, 8).join(' ')}{e.moves.length > 8 ? '…' : ''}
        <span className="muted-note"> · {e.moves.length} moves</span>
      </span>
      {!e.ok && (
        <span className="import-warn" title={`Stopped at ${e.failedToken}`}>
          <AlertIcon size={13} /> cut short
        </span>
      )}
    </label>
  );
}

// Group entries by their PGN Event tag, in first-seen order — one group per
// chapter a course-mode import will create.
function groupByEvent(entries) {
  const byEvent = new Map();
  for (const e of entries) {
    const key = e.event || 'Imported';
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(e);
  }
  return [...byEvent.entries()].map(([name, es]) => ({ name, entries: es }));
}

// Add lines straight into one chapter, or — given a course instead of a
// chapter — drop in a whole course PGN and get one chapter per distinct
// Event automatically, so a Chessable-style export doesn't need a trip
// through the Import wizard and a chapter built by hand for every line.
// Same parser either way.
export default function PgnImport({ chapterName, courseName, onAdd, onClose }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [drop, setDrop] = useState(false);
  const [skip, setSkip] = useState({}); // entries you've unticked
  const [names, setNames] = useState({}); // renamed before they go in
  const fileRef = useRef(null);
  useBackGuard(true, onClose);

  const byCourse = !!courseName;
  const entries = useMemo(() => pgnTextToEntries(text), [text]);
  const chosen = entries.filter((e) => !skip[e.id] && e.moves.length > 0);
  const entryGroups = useMemo(() => (byCourse ? groupByEvent(entries) : null), [byCourse, entries]);
  const chosenGroups = useMemo(() => (byCourse ? groupByEvent(chosen) : null), [byCourse, chosen]);

  const readFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    setSkip({});
  };

  const toVariation = (e) => ({
    name: (names[e.id] ?? e.name).trim() || 'Variation',
    moves: e.moves,
    comments: e.comments,
  });

  const add = () => {
    if (byCourse) {
      onAdd(chosenGroups.map((g) => ({ name: g.name, variations: g.entries.map(toVariation) })));
    } else {
      onAdd(chosen.map(toVariation));
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pgn-import" onClick={(e) => e.stopPropagation()}>
        <h3>{byCourse ? `Import PGN for “${courseName}”` : `Add lines to “${chapterName}”`}</h3>
        <p className="hint">
          {byCourse
            ? 'A .pgn file for the whole course — each distinct Event becomes its own chapter here, '
              + 'with that game\'s lines inside it. One without an Event tag lands in a single "Imported" chapter.'
            : 'A .pgn file, or moves pasted straight in. Each game becomes a variation and nested '
              + 'variations are split into their own lines.'}
        </p>

        <div
          className={`dropzone${drop ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrop(true); }}
          onDragLeave={() => setDrop(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrop(false);
            readFile(e.dataTransfer.files?.[0]);
          }}
        >
          <UploadIcon size={20} />
          <strong>{fileName ?? 'Choose a .pgn file'}</strong>
          <span className="muted-note">or drop one here</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pgn,.txt"
            hidden
            onChange={(e) => { readFile(e.target.files[0]); e.target.value = ''; }}
          />
        </div>

        <label className="paste-label">
          <span><ClipboardIcon size={14} /> …or paste the moves</span>
          <textarea
            rows={5}
            placeholder="1.d4 d5 2.Nc3 Nf6 3.Bf4 …"
            value={text}
            onChange={(e) => { setText(e.target.value); setFileName(null); }}
          />
        </label>

        {text.trim() && (
          entries.length === 0 ? (
            <div className="import-warn"><AlertIcon size={14} /> No legal moves found in that text.</div>
          ) : (
            <>
              <div className="import-count">
                <strong>{chosen.length}</strong> of {entries.length} line{entries.length === 1 ? '' : 's'} selected
                {byCourse && (
                  <span className="muted-note">
                    {' '}· {chosenGroups.length} chapter{chosenGroups.length === 1 ? '' : 's'}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button className="small ghost" onClick={() => setSkip({})}>All</button>
                <button
                  className="small ghost"
                  onClick={() => setSkip(Object.fromEntries(entries.map((e) => [e.id, true])))}
                >
                  None
                </button>
              </div>
              {byCourse ? (
                <div className="import-groups">
                  {entryGroups.map((g) => (
                    <div key={g.name} className="import-group">
                      <div className="import-group-head">
                        {g.name} <span className="muted-note">→ new chapter</span>
                      </div>
                      <div className="import-list">
                        {g.entries.map((e) => (
                          <ImportRow key={e.id} entry={e} skip={skip} setSkip={setSkip} names={names} setNames={setNames} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="import-list">
                  {entries.map((e) => (
                    <ImportRow key={e.id} entry={e} skip={skip} setSkip={setSkip} names={names} setNames={setNames} />
                  ))}
                </div>
              )}
            </>
          )
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0} onClick={add}>
            {byCourse
              ? `Import ${chosenGroups.length} chapter${chosenGroups.length === 1 ? '' : 's'}`
              : (chosen.length === 1 ? 'Add 1 variation' : `Add ${chosen.length || ''} variations`.replace('  ', ' '))}
          </button>
        </div>
      </div>
    </div>
  );
}
