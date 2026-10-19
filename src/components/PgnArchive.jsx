import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useBackGuard } from '../lib/backGuard';
import { cardHasRoom } from '../lib/cloud/reviews';
import { bytesOf } from '../lib/cloud/gameLink';
import {
  searchGames, openGame, gameRecord, alreadyIn, sideIn,
} from '../lib/pgnArchive';
import { CheckIcon, SearchIcon } from './Icons';

// The games in an uploaded PGN or .zip (lib/pgnArchive): find one, put it on
// the board — or tick some and file them into a Games section, a tournament's
// worth for a student in one go.

const SHOWN = 300; // rows drawn at once; a search narrows the rest

// The section most of the ticked games were played by — a student's
// tournament download lands in that student's games without being asked.
function likelySection(players, items) {
  let best = null;
  let most = 0;
  for (const p of players) {
    const n = items.filter((g) => sideIn(p, g.white, g.black)).length;
    if (n > most) { most = n; best = p; }
  }
  return best ?? players.find((p) => (p.kind ?? 'self') === 'self') ?? players[0] ?? null;
}

export default function ArchiveDialog({
  archive, openId, onOpen, onClose,
}) {
  const { state, dispatch } = useStore();
  useBackGuard(true, onClose);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [chosenSection, setChosenSection] = useState(null);
  const [report, setReport] = useState(null);
  const matches = useMemo(() => searchGames(archive.games, query), [archive.games, query]);
  const shown = matches.slice(0, SHOWN);
  const pickedItems = useMemo(() => archive.games.filter((g) => picked.has(g.id)), [archive.games, picked]);
  const section = state.players.find((p) => p.id === chosenSection)
    ?? likelySection(state.players, pickedItems.length ? pickedItems : matches.slice(0, 50));

  const toggle = (id) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allShownPicked = shown.length > 0 && shown.every((g) => picked.has(g.id));
  const pickShown = () => setPicked((s) => {
    const next = new Set(s);
    for (const g of shown) { if (allShownPicked) next.delete(g.id); else next.add(g.id); }
    return next;
  });

  // Into the section, one game at a time: not a set-up position or a game
  // with no moves, not one already there, and not past what the section's
  // card can hold in the cloud — the rest is counted and said.
  const save = () => {
    if (!section || !pickedItems.length) return;
    const counts = {
      saved: 0, there: 0, notGames: 0, full: 0,
    };
    const added = [];
    let extra = 0;
    for (const item of pickedItems) {
      const rec = gameRecord(item, openGame(item), section);
      if (!rec) { counts.notGames += 1; continue; }
      if (alreadyIn({ games: [...(section.games ?? []), ...added] }, rec)) { counts.there += 1; continue; }
      const bytes = bytesOf(rec) + 300; // and the id, link and such the store adds
      if (!cardHasRoom(section, extra + bytes)) { counts.full += 1; continue; }
      dispatch({ type: 'addGame', playerId: section.id, game: rec });
      added.push(rec);
      extra += bytes;
      counts.saved += 1;
    }
    setReport({ ...counts, name: section.name });
    setPicked(new Set());
  };

  const files = archive.files > 1 ? ` · ${archive.files} files` : '';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal archive-modal"
        role="dialog"
        aria-label={`Games in ${archive.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="archive-head">
          <h3>{archive.name}</h3>
          <span className="muted-note">
            {archive.games.length.toLocaleString()} game{archive.games.length === 1 ? '' : 's'}{files}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="small ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {(archive.skipped.length > 0 || archive.truncated) && (
          <p className="hint archive-note">
            {archive.truncated && 'Only the first 60 MB of games were read — split the file to see the rest. '}
            {archive.skipped.length > 0 && `Left out ${archive.skipped.length} file${archive.skipped.length === 1 ? '' : 's'} that ${archive.skipped.length === 1 ? 'isn’t' : 'aren’t'} PGN (${archive.skipped.slice(0, 3).join(', ')}${archive.skipped.length > 3 ? '…' : ''}).`}
          </p>
        )}
        <label className="archive-search">
          <SearchIcon size={15} />
          <input
            type="text"
            value={query}
            placeholder="Search players, event, round, date, opening…"
            aria-label="Search the games"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="archive-tools">
          <button type="button" className="small ghost" disabled={!shown.length} onClick={pickShown}>
            {allShownPicked ? 'Untick these' : `Tick ${shown.length === matches.length ? 'all' : 'these'} ${shown.length.toLocaleString()}`}
          </button>
          {picked.size > 0 && (
            <button type="button" className="small ghost" onClick={() => setPicked(new Set())}>Clear ({picked.size})</button>
          )}
          <span style={{ flex: 1 }} />
          <span className="muted-note">
            {matches.length > SHOWN
              ? `Showing ${SHOWN} of ${matches.length.toLocaleString()} — search to narrow`
              : `${matches.length.toLocaleString()} shown`}
          </span>
        </div>
        <div className="archive-list" role="list">
          {shown.map((g) => (
            <div key={g.id} role="listitem" className={`archive-row${g.id === openId ? ' current' : ''}${picked.has(g.id) ? ' picked' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(g.id)}
                aria-label={`Tick ${g.name}`}
                onChange={() => toggle(g.id)}
              />
              <button type="button" className="archive-open" title="Put this game on the board" onClick={() => onOpen(g)}>
                <span className="archive-players">
                  {g.white || '?'}{g.whiteElo && <span className="archive-elo"> {g.whiteElo}</span>}
                  {' – '}
                  {g.black || '?'}{g.blackElo && <span className="archive-elo"> {g.blackElo}</span>}
                </span>
                <span className="archive-result">{g.result}</span>
                <span className="archive-meta muted-note">
                  {[g.event, g.round && `R${g.round}`, g.date, archive.files > 1 && g.file].filter(Boolean).join(' · ') || g.name}
                </span>
              </button>
            </div>
          ))}
          {!shown.length && <p className="muted-note archive-empty">No games match “{query}”.</p>}
        </div>
        {report && (
          <p className="archive-report" role="status">
            <CheckIcon size={14} /> Saved {report.saved} to {report.name}’s games.
            {report.there > 0 && ` ${report.there} ${report.there === 1 ? 'was' : 'were'} already there.`}
            {report.notGames > 0 && ` ${report.notGames} can’t be a game record (set up from a position, or no moves) — load ${report.notGames === 1 ? 'it' : 'them'} onto the board instead.`}
            {report.full > 0 && ` ${report.full} didn’t fit — ${report.name}’s card is full.`}
          </p>
        )}
        <div className="archive-save">
          {state.players.length === 0 ? (
            <span className="muted-note">Add a section in Games to save games into it.</span>
          ) : (
            <>
              <span>Save {picked.size || ''} ticked to</span>
              <select value={section?.id ?? ''} onChange={(e) => setChosenSection(e.target.value)} aria-label="Games section">
                {state.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{(p.kind ?? 'self') === 'student' ? ' (student)' : ''}</option>
                ))}
              </select>
              <button type="button" className="small primary" disabled={!picked.size || !section} onClick={save}>
                Save to Games
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
