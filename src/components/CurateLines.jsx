// Lines from anywhere in the coach's own repertoire into one chapter of a
// student's opening — other chapters, other courses — for a curated chapter
// like a "Quickstarter Guide". The copying is lib/curate.js's curateInto:
// fresh progress for the student, nothing they already have twice.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { lineKey, sameName } from '../lib/curate';

// "1.d4 d5 2.Bf4 Nf6 …" — enough of a line to tell it from its neighbours.
function preview(v, plies = 8) {
  const moves = v.moves ?? [];
  if (v.startFen) return moves.slice(0, plies).join(' ') + (moves.length > plies ? ' …' : '');
  const out = [];
  moves.slice(0, plies).forEach((m, i) => out.push(i % 2 === 0 ? `${i / 2 + 1}.${m}` : m));
  return out.join(' ') + (moves.length > plies ? ' …' : '');
}

export default function CurateLines({ opening, chapter, studentName, onClose, onDone }) {
  const { state, dispatch } = useStore();
  useBackGuard(true, onClose);

  const mine = state.openings.filter((o) => (o.ownerId ?? null) === null);
  const matching = mine.filter((o) => sameName(o.name, opening.name));
  const [showAll, setShowAll] = useState(matching.length === 0);
  const sources = showAll ? [...matching, ...mine.filter((o) => !matching.includes(o))] : matching;

  // What the student already has anywhere in this opening: shown, not offered.
  const have = useMemo(
    () => new Set(opening.chapters.flatMap((c) => c.variations.map(lineKey))),
    [opening],
  );
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => (matching[0] ? { [`o:${matching[0].id}`]: true } : {}));
  const toggleOpen = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const q = query.trim().toLowerCase();
  const fits = (c, v) => !q || v.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    || (v.moves ?? []).join(' ').toLowerCase().includes(q) || preview(v, 40).toLowerCase().includes(q);

  // opening → course → chapter → lines, each step only where there's a line to show.
  const tree = sources.map((o) => {
    const chapters = o.chapters
      .map((c) => ({ c, lines: c.variations.filter((v) => fits(c, v)) }))
      .filter((x) => x.lines.length);
    const courses = (o.courses ?? []).map((course) => ({
      course, chapters: chapters.filter((x) => x.c.courseId === course.id),
    }));
    const loose = chapters.filter((x) => !(o.courses ?? []).some((course) => course.id === x.c.courseId));
    const groups = [...courses, ...(loose.length ? [{ course: null, chapters: loose }] : [])]
      .filter((g) => g.chapters.length);
    return { o, groups, count: chapters.reduce((n, x) => n + x.lines.length, 0) };
  }).filter((t) => t.count);

  const pickable = (lines) => lines.filter((v) => !have.has(lineKey(v))).map((v) => v.id);
  const setMany = (ids, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  const Tri = ({ ids }) => {
    const hits = ids.filter((id) => selected.has(id)).length;
    const st = !ids.length || hits === 0 ? 'none' : hits === ids.length ? 'all' : 'some';
    return (
      <input
        type="checkbox"
        disabled={!ids.length}
        checked={st === 'all'}
        ref={(el) => { if (el) el.indeterminate = st === 'some'; }}
        onChange={() => setMany(ids, st !== 'all')}
        onClick={(e) => e.stopPropagation()}
      />
    );
  };
  // While searching, everything with a hit is open.
  const isOpen = (key) => Boolean(q) || Boolean(open[key]);

  // In the order they sit in your repertoire, whatever order they were ticked.
  const ordered = sources.flatMap((o) => o.chapters.flatMap((c) => c.variations.map((v) => v.id)))
    .filter((id) => selected.has(id));
  const fromChapters = new Set(sources.flatMap((o) => o.chapters
    .filter((c) => c.variations.some((v) => selected.has(v.id))).map((c) => c.id))).size;

  const add = () => {
    dispatch({ type: 'curateLines', toOpeningId: opening.id, toChapterId: chapter.id, variationIds: ordered });
    onDone?.(ordered.length);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal curate-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Lines for “{chapter.name}”</h3>
        <p className="hint">
          Pick lines from anywhere in your {matching.length ? opening.name : 'repertoire'} — any
          course, any chapter. They’re copied into {studentName ? `${studentName}’s` : 'the'} chapter
          with their moves, notes and arrows, and fresh progress. Editing either copy never touches
          the other.
        </p>
        <div className="curate-bar">
          <input
            type="search"
            value={query}
            placeholder="Search lines, chapters or moves"
            onChange={(e) => setQuery(e.target.value)}
          />
          {matching.length > 0 && mine.length > matching.length && (
            <label className="curate-all">
              <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} />
              All my openings
            </label>
          )}
        </div>
        <div className="share-list share-tree curate-tree">
          {tree.length === 0 && (
            <p className="muted-note curate-empty">
              {q ? 'Nothing matches that.' : `There are no lines in your own ${opening.name} yet.`}
            </p>
          )}
          {tree.map(({ o, groups, count }) => {
            const oKey = `o:${o.id}`;
            const oIds = pickable(groups.flatMap((g) => g.chapters.flatMap((x) => x.lines)));
            return (
              <div key={o.id} className="tree-opening">
                <div className="tree-row" onClick={() => toggleOpen(oKey)}>
                  <button type="button" className="tree-caret">{isOpen(oKey) ? '▾' : '▸'}</button>
                  <Tri ids={oIds} />
                  <span className="tree-name"><strong>{o.name}</strong></span>
                  <span className="muted-note">{count}</span>
                </div>
                {isOpen(oKey) && groups.map(({ course, chapters }) => {
                  const gKey = `g:${o.id}:${course?.id ?? '-'}`;
                  const inner = chapters.map(({ c, lines }) => {
                    const cKey = `c:${c.id}`;
                    return (
                      <div key={c.id} className="tree-chapter">
                        <div className="tree-row" onClick={() => toggleOpen(cKey)}>
                          <button type="button" className="tree-caret">{isOpen(cKey) ? '▾' : '▸'}</button>
                          <Tri ids={pickable(lines)} />
                          <span className="tree-name">{c.name}</span>
                          <span className="muted-note">{lines.length}</span>
                        </div>
                        {isOpen(cKey) && lines.map((v) => {
                          const there = have.has(lineKey(v));
                          return (
                            <label key={v.id} className={`tree-row tree-line${there ? ' is-there' : ''}`}>
                              <input
                                type="checkbox"
                                disabled={there}
                                checked={there || selected.has(v.id)}
                                onChange={() => setMany([v.id], !selected.has(v.id))}
                              />
                              <span className="tree-name">
                                {v.name}
                                <span className="curate-moves">{preview(v)}</span>
                              </span>
                              {there && <span className="muted-note">already there</span>}
                            </label>
                          );
                        })}
                      </div>
                    );
                  });
                  // A course is a step of its own only when the opening has courses.
                  if (!(o.courses ?? []).length) return <React.Fragment key={gKey}>{inner}</React.Fragment>;
                  return (
                    <div key={gKey} className="tree-chapter">
                      <div className="tree-row" onClick={() => toggleOpen(gKey)}>
                        <button type="button" className="tree-caret">{isOpen(gKey) ? '▾' : '▸'}</button>
                        <Tri ids={pickable(chapters.flatMap((x) => x.lines))} />
                        <span className="tree-name"><em>{course ? course.name : 'Not in a course'}</em></span>
                        <span className="muted-note">{chapters.reduce((n, x) => n + x.lines.length, 0)}</span>
                      </div>
                      {isOpen(gKey) && <div className="curate-course">{inner}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="share-summary">
          <span className="muted-note">
            {ordered.length === 0
              ? 'Tick the lines you want in this chapter.'
              : `${ordered.length} line${ordered.length === 1 ? '' : 's'} from ${fromChapters} chapter${fromChapters === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!ordered.length} onClick={add}>
            Add {ordered.length || ''} line{ordered.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
