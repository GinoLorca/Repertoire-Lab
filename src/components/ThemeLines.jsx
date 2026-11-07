// A collection: a theme ("bishop trapping plan", "traps to remember") put on
// lines from anywhere in one repertoire — yours, or a student's. A theme is a
// tag on each line, so it shows in Collections with Learn and Practice, and
// travels with the lines when they're sent.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { allTags } from './TagEditor';

const preview = (v, plies = 8) => {
  const moves = v.moves ?? [];
  if (v.startFen) return moves.slice(0, plies).join(' ') + (moves.length > plies ? ' …' : '');
  return moves.slice(0, plies).map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(' ')
    + (moves.length > plies ? ' …' : '');
};

export default function ThemeLines({
  openings, ownerId = null, ownerName, initialTag = '', onClose,
}) {
  const { state, dispatch } = useStore();
  useBackGuard(true, onClose);
  const [tag, setTag] = useState(initialTag);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  // A small repertoire (a student's, say) opens all the way; a big one doesn't.
  const [open, setOpen] = useState(() => {
    const chapters = openings.flatMap((o) => o.chapters);
    const out = {};
    if (openings.length <= 2) for (const o of openings) out[o.id] = true;
    if (chapters.length <= 3) for (const c of chapters) out[c.id] = true;
    return out;
  });
  const fixed = Boolean(initialTag);
  const name = tag.trim();
  // That repertoire's own themes only — a student's are kept apart from yours.
  const suggestions = useMemo(() => allTags(state, { ownerId }), [state, ownerId]);

  // In the theme already — the line, its chapter or its opening carries it.
  const inIt = (o, c, v) => Boolean(name) && [o.tags, c.tags, v.tags].some((t) => (t ?? []).includes(name));
  const q = query.trim().toLowerCase();
  const fits = (c, v) => !q || v.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    || preview(v, 40).toLowerCase().includes(q);
  const tree = openings.map((o) => ({
    o,
    chapters: o.chapters.map((c) => ({ c, lines: c.variations.filter((v) => fits(c, v)) })).filter((x) => x.lines.length),
  })).filter((t) => t.chapters.length);

  const key = (c, v) => `${c.id}|${v.id}`;
  const setMany = (keys, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });
  const Tri = ({ keys }) => {
    const hits = keys.filter((k) => selected.has(k)).length;
    const st = !keys.length || hits === 0 ? 'none' : hits === keys.length ? 'all' : 'some';
    return (
      <input
        type="checkbox"
        disabled={!keys.length}
        checked={st === 'all'}
        ref={(el) => { if (el) el.indeterminate = st === 'some'; }}
        onChange={() => setMany(keys, st !== 'all')}
        onClick={(e) => e.stopPropagation()}
      />
    );
  };
  const free = (o, lines, c) => lines.filter((v) => !inIt(o, c, v)).map((v) => key(c, v));
  const items = openings.flatMap((o) => o.chapters.flatMap((c) => c.variations
    .filter((v) => selected.has(key(c, v)) && !inIt(o, c, v))
    .map((v) => ({ openingId: o.id, chapterId: c.id, variationId: v.id }))));

  const save = () => {
    dispatch({ type: 'tagLines', tag: name, items });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal curate-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{fixed ? `Add lines to “${initialTag}”` : `New collection${ownerName ? ` for ${ownerName}` : ''}`}</h3>
        <p className="hint">
          A theme to remember — like “bishop trapping plan” — on lines from anywhere in
          {ownerName ? ` ${ownerName}’s` : ' your'} repertoire. It shows here with Learn and
          Practice{ownerName ? `, and in ${ownerName}’s app once you send the openings` : ''}.
        </p>
        {!fixed && (
          <>
            <input
              type="text"
              autoFocus
              list="theme-suggestions"
              value={tag}
              placeholder="Collection name — e.g. Traps to remember"
              onChange={(e) => setTag(e.target.value)}
            />
            <datalist id="theme-suggestions">
              {suggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </>
        )}
        <div className="curate-bar">
          <input
            type="search"
            value={query}
            placeholder="Search lines, chapters or moves"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="share-list share-tree curate-tree">
          {tree.length === 0 && (
            <p className="muted-note curate-empty">{q ? 'Nothing matches that.' : 'There are no lines here yet.'}</p>
          )}
          {tree.map(({ o, chapters }) => (
            <div key={o.id} className="tree-opening">
              <div className="tree-row" onClick={() => setOpen((x) => ({ ...x, [o.id]: !x[o.id] }))}>
                <button type="button" className="tree-caret">{q || open[o.id] ? '▾' : '▸'}</button>
                <Tri keys={chapters.flatMap(({ c, lines }) => free(o, lines, c))} />
                <span className="tree-name"><strong>{o.name}</strong></span>
                <span className="muted-note">{chapters.reduce((n, x) => n + x.lines.length, 0)}</span>
              </div>
              {(q || open[o.id]) && chapters.map(({ c, lines }) => (
                <div key={c.id} className="tree-chapter">
                  <div className="tree-row" onClick={() => setOpen((x) => ({ ...x, [c.id]: !x[c.id] }))}>
                    <button type="button" className="tree-caret">{q || open[c.id] ? '▾' : '▸'}</button>
                    <Tri keys={free(o, lines, c)} />
                    <span className="tree-name">{c.name}</span>
                    <span className="muted-note">{lines.length}</span>
                  </div>
                  {(q || open[c.id]) && lines.map((v) => {
                    const there = inIt(o, c, v);
                    return (
                      <label key={v.id} className={`tree-row tree-line${there ? ' is-there' : ''}`}>
                        <input
                          type="checkbox"
                          disabled={there}
                          checked={there || selected.has(key(c, v))}
                          onChange={() => setMany([key(c, v)], !selected.has(key(c, v)))}
                        />
                        <span className="tree-name">
                          {v.name}
                          <span className="curate-moves">{preview(v)}</span>
                        </span>
                        {there && <span className="muted-note">in it</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!name || !items.length} onClick={save}>
            {fixed ? 'Add' : 'Create'} · {items.length} line{items.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
