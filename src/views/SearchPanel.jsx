import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { movetextToLines, validateLine } from '../lib/pgn';
import { rankVariationsByMoves, moveLabel } from '../lib/repertoire';
import MoveText from '../components/MoveText';
import { TagChips } from '../components/TagEditor';
import { SearchIcon, PawnIcon, StarIcon } from '../components/Icons';
import { useBackGuard } from '../lib/backGuard';

// Case-insensitive subsequence match, so "advfr" finds "Advance French".
function fuzzy(needle, haystack) {
  const n = needle.toLowerCase().trim();
  const h = (haystack ?? '').toLowerCase();
  if (!n) return 0;
  if (h.includes(n)) return h.startsWith(n) ? 3 : 2;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return 1;
  }
  return 0;
}

function Hit({ crumbs, title, children, onOpen }) {
  return (
    <div className="search-hit" onClick={onOpen}>
      <div className="search-crumbs">{crumbs.join(' ▸ ')}</div>
      <div className="search-title">{title}</div>
      {children}
    </div>
  );
}

export default function SearchPanel({ onClose, onOpenChapter, onAnalyze }) {
  const { state } = useStore();
  const [mode, setMode] = useState('names');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all'); // all | chapters | variations
  const [movesText, setMovesText] = useState('');
  const inputRef = useRef(null);

  useBackGuard(true, onClose);

  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---------- Name search ----------
  const nameHits = useMemo(() => {
    if (mode !== 'names' || !query.trim()) return { chapters: [], variations: [], openings: [] };
    const openings = [];
    const chapters = [];
    const variations = [];
    // "#plan" or the Tags scope restricts matching to tags / nicknames only.
    const tagsOnly = scope === 'tags' || query.trim().startsWith('#');
    const q = query.trim().replace(/^#/, '');
    const nameScore = (text) => (tagsOnly ? 0 : fuzzy(q, text));

    for (const opening of state.openings) {
      const openingTags = opening.tags ?? [];
      const oScore = Math.max(
        nameScore(opening.name),
        ...openingTags.map((t) => (fuzzy(q, t) ? 3 : 0)),
      );
      if (oScore) openings.push({ opening, score: oScore });

      for (const chapter of opening.chapters) {
        // Tags inherit downwards: an opening's tag belongs to everything inside it.
        const chapterTags = [...new Set([...openingTags, ...(chapter.tags ?? [])])];
        if (scope !== 'variations') {
          // A chapter matches on its own name, its section, or any of its tags.
          const score = Math.max(
            nameScore(chapter.name),
            !tagsOnly && fuzzy(q, chapter.section) ? 1 : 0,
            !tagsOnly && fuzzy(q, chapter.subsection) ? 1 : 0,
            ...chapterTags.map((t) => (fuzzy(q, t) ? 2 : 0)),
          );
          if (score) chapters.push({ opening, chapter, score });
        }
        if (scope !== 'chapters') {
          for (const variation of chapter.variations) {
            const varTags = [...new Set([...chapterTags, ...(variation.tags ?? [])])];
            const score = Math.max(
              nameScore(variation.name),
              ...varTags.map((t) => (fuzzy(q, t) ? 2 : 0)),
            );
            if (score) variations.push({ opening, chapter, variation, score, tags: varTags });
          }
        }
      }
    }
    const bySc = (a, b) => b.score - a.score;
    return {
      openings: openings.sort(bySc).slice(0, 6),
      chapters: chapters.sort(bySc).slice(0, 25),
      variations: variations.sort(bySc).slice(0, 40),
    };
  }, [mode, query, scope, state.openings]);

  // Every tag in use, with how many variations it covers — shown as shortcuts.
  const tagCloud = useMemo(() => {
    const counts = new Map();
    for (const o of state.openings) {
      for (const c of o.chapters) {
        for (const v of c.variations) {
          const tags = new Set([...(o.tags ?? []), ...(c.tags ?? []), ...(v.tags ?? [])]);
          for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, n]) => ({ tag, n }));
  }, [state.openings]);

  // ---------- Move / PGN search ----------
  const moveSearch = useMemo(() => {
    if (mode !== 'moves' || !movesText.trim()) return null;
    const lines = movetextToLines(movesText);
    if (!lines.length) return { error: 'No moves found in that text.' };
    const parsed = validateLine(lines[0].moves);
    if (parsed.moves.length === 0) {
      return { error: `Couldn't read a legal line — stuck at "${parsed.failedToken}".` };
    }
    return {
      moves: parsed.moves,
      partial: !parsed.ok ? parsed.failedToken : null,
      results: rankVariationsByMoves(parsed.moves, state.openings).slice(0, 25),
    };
  }, [mode, movesText, state.openings]);

  const open = (openingId, chapterId) => { onOpenChapter(openingId, chapterId); onClose(); };

  const totalNames = nameHits.openings.length + nameHits.chapters.length + nameHits.variations.length;

  return (
    <div className="modal-overlay search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-head">
          <div className="tabs">
            <button className={mode === 'names' ? 'active' : ''} onClick={() => setMode('names')}>
              <SearchIcon size={15} /> Names
            </button>
            <button className={mode === 'moves' ? 'active' : ''} onClick={() => setMode('moves')}>
              <PawnIcon size={15} /> By moves / PGN
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        {mode === 'names' ? (
          <>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="Search openings, chapters and variations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="settings-row">
              {[
                ['all', 'Everything'],
                ['chapters', 'Chapters only'],
                ['variations', 'Variations only'],
                ['tags', 'Themes only'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  className={`small${scope === v ? ' primary' : ''}`}
                  onClick={() => setScope(v)}
                >
                  {label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              {query.trim() && <span className="muted-note">{totalNames} match{totalNames === 1 ? '' : 'es'}</span>}
            </div>

            <div className="search-results">
              {!query.trim() && (
                <>
                  <div className="muted-note">
                    Type to search. Matching is loose — “tart” finds “Tartakower Variation”, and chapters
                    also match on the section they sit in. Start with <strong>#</strong> to search themes
                    and nicknames only.
                  </div>
                  {tagCloud.length > 0 && (
                    <div className="tag-suggest" style={{ marginTop: 12 }}>
                      <span className="muted-note">Your themes:</span>
                      {tagCloud.map(({ tag, n }) => (
                        <button
                          key={tag}
                          className="tag-chip clickable"
                          onClick={() => { setScope('tags'); setQuery(tag); }}
                        >
                          {tag} <span className="tag-count">{n}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {query.trim() && totalNames === 0 && (
                <div className="empty-note">Nothing matched “{query}”.</div>
              )}

              {nameHits.openings.map(({ opening }) => (
                <Hit
                  key={opening.id}
                  crumbs={['Opening']}
                  title={opening.name}
                  onOpen={onClose}
                >
                  <div className="muted-note">
                    {opening.chapters.length} chapters ·{' '}
                    {opening.chapters.reduce((a, c) => a + c.variations.length, 0)} variations
                  </div>
                </Hit>
              ))}

              {nameHits.chapters.map(({ opening, chapter }) => (
                <Hit
                  key={chapter.id}
                  crumbs={[opening.name, chapter.section, chapter.subsection].filter(Boolean)}
                  title={chapter.name}
                  onOpen={() => open(opening.id, chapter.id)}
                >
                  <div className="muted-note">{chapter.variations.length} variations</div>
                </Hit>
              ))}

              {nameHits.variations.map(({ opening, chapter, variation, tags }) => (
                <Hit
                  key={variation.id}
                  crumbs={[opening.name, chapter.name].filter(Boolean)}
                  title={variation.name}
                  onOpen={() => open(opening.id, chapter.id)}
                >
                  <div className="search-moves">
                    {variation.starred && <StarIcon size={13} filled className="star-inline" />}
                    <MoveText moves={variation.moves.slice(0, 16)} />
                    {variation.moves.length > 16 && <span className="muted-note">…</span>}
                  </div>
                  <TagChips tags={tags} max={4} />
                </Hit>
              ))}
            </div>
          </>
        ) : (
          <>
            <textarea
              ref={inputRef}
              rows={4}
              className="search-input"
              placeholder="Paste moves or a PGN — e.g. 1.e4 c6 2.d4 d5 3.Nc3 dxe4"
              value={movesText}
              onChange={(e) => setMovesText(e.target.value)}
            />

            <div className="search-results">
              {!movesText.trim() && (
                <div className="muted-note">
                  Paste a game or a line and it finds the variations in your repertoire that follow it
                  furthest — matched by position, so a different move order still lines up.
                </div>
              )}
              {moveSearch?.error && <div className="status-line"><span className="status-bad">✗ {moveSearch.error}</span></div>}

              {moveSearch?.moves && (
                <>
                  <div className="search-parsed">
                    Searching <strong>{moveSearch.moves.length}</strong> moves:{' '}
                    <MoveText moves={moveSearch.moves.slice(0, 20)} />
                    {moveSearch.partial && (
                      <span className="status-busy"> · ignored from “{moveSearch.partial}”</span>
                    )}
                  </div>

                  {moveSearch.results.length === 0 && (
                    <div className="empty-note">No variation in your repertoire starts this way.</div>
                  )}

                  {moveSearch.results.map(({ opening, chapter, variation, depth, exact, coversInput, divergesAt, played, book }) => (
                    <Hit
                      key={variation.id}
                      crumbs={[opening.name, chapter.section, chapter.subsection, chapter.name].filter(Boolean)}
                      title={variation.name}
                      onOpen={() => open(opening.id, chapter.id)}
                    >
                      <div className="search-moves">
                        <MoveText moves={variation.moves.slice(0, 18)} currentIndex={depth - 1} />
                        {variation.moves.length > 18 && <span className="muted-note">…</span>}
                      </div>
                      <div className="status-line">
                        {exact ? (
                          <span className="status-ok">✓ Exact match</span>
                        ) : coversInput ? (
                          <span className="status-ok">
                            ✓ Follows all {depth} moves, then continues with {book}
                          </span>
                        ) : book ? (
                          <span className="status-busy">
                            Matches {depth} move{depth === 1 ? '' : 's'} · you played{' '}
                            <strong>{moveLabel(divergesAt)}{played}</strong>, repertoire plays <strong>{book}</strong>
                          </span>
                        ) : (
                          // The stored line simply runs out before your game does.
                          <span className="status-ok">
                            ✓ Matches all {depth} moves of this variation — your line carries on from{' '}
                            <strong>{moveLabel(divergesAt)}{played}</strong>
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        <button
                          className="small"
                          onClick={(e) => { e.stopPropagation(); onAnalyze({ name: variation.name, moves: moveSearch.moves }); onClose(); }}
                        >
                          Analyze
                        </button>
                      </div>
                    </Hit>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
