// Game Review — the analysis screen's fifth tab.
//
// The review itself is Chess Arcade's (public/arcade, brought in by
// scripts/sync-arcade.mjs), in a frame on this page: its review and grades,
// badges, CLAMP letters, tactics and their sounds, side lines and their
// highlights, the Notes card and its links to moves, the engine and the
// explorer, all exactly as Chess Arcade has them. This screen is what goes
// around it: which game is open (one of your games or a student's, a pasted
// PGN, a .pgn file), and keeping what's written in the review.
//
// What the review writes is kept on the game itself (game.gameReview — see
// lib/gameReviewBridge), the moment Chess Arcade saves it: so it syncs to your
// other devices with the game, and travels to a linked student the way the
// rest of a game's analysis does. A pasted game keeps it here until it's
// saved to someone's Games, and takes it along when it is.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, uid } from '../store';
import { ARCADE_REVIEW_URL } from '../lib/arcadeBuild';
import {
  arcadeId, tempArcadeId, arcadeGame, cleanRecords, sameRecords, fromArchive, recordsFor,
  writesReviewLayer, withGameReview,
} from '../lib/gameReviewBridge';
import {
  readPgnFiles, indexGames, openGame, searchGames, gameRecord, alreadyIn,
} from '../lib/pgnArchive';
import { sideFromNames } from '../lib/pov';
import { UploadIcon, DownloadIcon, FolderIcon } from '../components/Icons';

// The analysis screen's tabs, as AnalysisView draws them (Game Review last).
const TABS = [
  ['engine', 'Engine'],
  ['compare', 'Compare lines', 'Put two similar lines side by side and see exactly where they part'],
  ['editor', 'Board Editor'],
  ['studio', 'Studio', 'Annotate games and lessons for students — a board of its own, kept as you left it'],
  ['review', 'Game Review', 'Chess Arcade’s game review — badges, CLAMP, tactics and notes, saved onto the game'],
];

const LIST_MAX = 300;
const FULL_KEY = 'rl.gameReview.full';

function findGame(players, playerId, gameId) {
  const player = players.find((p) => p.id === playerId);
  const game = player?.games?.find((g) => g.id === gameId);
  return game ? { player, game } : null;
}

const dateLabel = (d) => {
  const t = typeof d === 'number' ? d : Date.parse(d ?? '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};

export default function GameReviewView({ open, onOpen, onBoard }) {
  const { state, dispatch } = useStore();
  const frameRef = useRef(null);
  const wrapRef = useRef(null);
  const fileRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(640);
  const [pasteOpen, setPasteOpen] = useState(!open);
  const [pgnText, setPgnText] = useState('');
  const [list, setList] = useState(null); // { name, games } — a file or paste with several games
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // Full screen: the review over the whole window, the app's top bar too —
  // exactly the room Chess Arcade has on its own. Remembered on this device.
  const [full, setFull] = useState(() => {
    try { return localStorage.getItem(FULL_KEY) === '1'; } catch { return false; }
  });
  const setFullKept = (on) => {
    setFull(on);
    try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch { /* not kept: fine */ }
  };

  // What's open: one of the games in your sections, or a pasted one.
  const saved = open?.gameId ? findGame(state.players, open.playerId, open.gameId) : null;
  const temp = !saved && open?.temp ? open.temp : null;
  const caId = saved ? arcadeId(saved.game.id) : temp?.id ?? null;
  const source = saved?.game ?? temp?.game ?? null;
  const records = useMemo(
    () => (saved ? recordsFor(saved.game, saved.player) : temp?.records ?? null),
    [saved?.game, saved?.player?.kind, temp?.records], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const side = saved ? (saved.game.meta?.color || null) : sideFromNames(temp?.game?.meta, state.players);
  const fullOn = full && Boolean(caId);
  useEffect(() => {
    if (!fullOn) return undefined;
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = was; };
  }, [fullOn]);

  // The latest of all that, for the frame's messages and for leaving.
  const live = useRef({});
  live.current = {
    saved, temp, caId, open, records,
  };

  const api = () => {
    try { return frameRef.current?.contentWindow?.__rlReview ?? null; } catch { return null; }
  };

  // What the review holds for the game now, onto the game (or the pasted
  // game, until it's saved): your own copy, or — a student's own game — your
  // review of it, sent to them when you leave the game (publish).
  const layerDirty = useRef(null); // { playerId, gameId, body } written but not sent
  const publishLayer = () => {
    const d = layerDirty.current;
    if (!d) return;
    layerDirty.current = null;
    dispatch({ type: 'setGameReview', ...d, publish: true });
  };
  const pull = ({ publish = false } = {}) => {
    const a = api();
    const L = live.current;
    if (a && L.caId && a.current() === L.caId) {
      const rec = cleanRecords(a.records(L.caId));
      if (L.saved && !sameRecords(rec, L.records)) {
        const stamped = rec ? { ...rec, at: Date.now() } : null;
        const { player, game } = L.saved;
        if (writesReviewLayer(game, player)) {
          const body = withGameReview(game.review?.body, game, stamped);
          dispatch({ type: 'setGameReview', playerId: player.id, gameId: game.id, body, publish: false });
          layerDirty.current = { playerId: player.id, gameId: game.id, body };
        } else {
          dispatch({
            type: 'setGameReviewRecords', playerId: player.id, gameId: game.id, records: stamped,
          });
        }
      } else if (L.temp && !sameRecords(rec, L.temp.records)) {
        onOpen({ ...L.open, temp: { ...L.temp, records: rec ? { ...rec, at: Date.now() } : null } });
      }
    }
    if (publish) publishLayer();
  };
  const pullRef = useRef(pull);
  pullRef.current = pull;

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== 'rl-review') return;
      if (d.type === 'ready') setReady(true);
      if (d.type === 'change') pullRef.current();
    };
    window.addEventListener('message', onMessage);
    // Closing the app or switching away: what's being typed is saved first.
    const keep = () => { api()?.flush(); pullRef.current({ publish: true }); };
    const onVisibility = () => { if (document.hidden) keep(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', keep);
    return () => {
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', keep);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the tab: the same, while the frame is still there to ask.
  useLayoutEffect(() => () => { api()?.flush(); pullRef.current({ publish: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A different game: what was being written on the last one is kept, then
  // this one's saved review goes in and it opens.
  const openedRef = useRef(null);
  useEffect(() => {
    const a = api();
    if (!ready || !a || !caId || !source) return;
    if (openedRef.current === caId) return;
    openedRef.current = caId;
    a.load(caId, records ?? {});
    a.open(arcadeGame(source, caId, { side }));
  }, [ready, caId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The game's review changed somewhere else — another device, the student —
  // while it's open here: it goes in, and the review opens again at the same move.
  useEffect(() => {
    const a = api();
    if (!ready || !a || !caId || openedRef.current !== caId) return;
    if (!sameRecords(cleanRecords(a.records(caId)), records)) a.load(caId, records ?? {});
  }, [records]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame takes the rest of the screen, under the tabs and the import row
  // — which stay in view, so the other tabs are always one click away. Chess
  // Arcade sizes its board to the height it's given; on a desktop that row is
  // kept to one thin line for it (styles.css), and Full screen gives it all.
  useLayoutEffect(() => {
    const fit = () => {
      const box = wrapRef.current?.getBoundingClientRect();
      const top = box ? box.top + window.scrollY : 0;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setHeight(Math.max(520, Math.round(vh - Math.max(0, top) - 10)));
    };
    fit();
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
    };
  }, [pasteOpen, list, error, Boolean(caId)]);

  // ---------- opening games ----------
  // What was being written on the game that's open is kept first.
  const leaveGame = () => { api()?.flush(); pull({ publish: true }); };
  const openSaved = (playerId, gameId) => {
    leaveGame();
    setError(null);
    setList(null);
    setPasteOpen(false);
    onOpen({ playerId, gameId });
  };
  const openItem = (item) => {
    const entry = openGame(item);
    if (!entry.moves?.length) {
      setError(`${item.name} ${entry.unusable ?? 'has no moves'} — it can’t be reviewed.`);
      return;
    }
    leaveGame();
    setError(null);
    setList(null);
    setPasteOpen(false);
    onOpen({
      temp: {
        id: tempArcadeId(), item: { ...item, entry: undefined }, entry, game: fromArchive(item, entry), records: null,
      },
    });
  };
  const openFiles = (name, files) => {
    const games = indexGames(files);
    if (!games.length) { setError(`No games found in ${name}.`); return; }
    if (games.length === 1) { openItem(games[0]); return; }
    setQuery('');
    setList({ name, games });
  };
  const loadPaste = () => {
    if (!pgnText.trim()) return;
    openFiles('the pasted text', [{ name: 'Pasted PGN', text: pgnText }]);
    setPgnText('');
  };
  const upload = async (file) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const read = readPgnFiles(file.name, new Uint8Array(await file.arrayBuffer()));
      if (read.error) throw new Error(read.error);
      if (!read.files.length) throw new Error(`There are no PGN files in ${file.name}.`);
      openFiles(file.name, read.files);
    } catch (err) {
      setError(err.message || 'That file couldn’t be read.');
    } finally {
      setBusy(false);
    }
  };

  // Every game in your sections with moves, newest first, for the picker.
  const sections = useMemo(() => state.players
    .map((p) => ({
      player: p,
      games: (p.games ?? []).filter((g) => g.moves?.length)
        .slice().sort((a, b) => (b.date ?? 0) - (a.date ?? 0)),
    }))
    .filter((s) => s.games.length), [state.players]);

  const shown = list ? searchGames(list.games, query) : [];
  const title = saved
    ? `${saved.game.name}${saved.player ? ` · ${saved.player.name}` : ''}`
    : temp ? temp.game.name : '';

  return (
    <div className="analysis-view game-review-view">
      <div className="page-head analysis-head">
        <h1>Analysis</h1>
        <div className="mode-tabs">
          {TABS.map(([tab, label, tip]) => (
            <button
              key={tab}
              type="button"
              className={tab === 'review' ? 'active' : undefined}
              title={tip}
              onClick={() => { if (tab !== 'review') onBoard(tab); }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="gr-bar">
        <button className={`small${pasteOpen ? ' primary' : ''}`} onClick={() => setPasteOpen((o) => !o)}>
          <UploadIcon size={14} /> Paste PGN
        </button>
        <button
          className="small"
          disabled={busy}
          title="A .pgn file, or a .zip of them"
          onClick={() => fileRef.current?.click()}
        >
          <FolderIcon size={14} /> {busy ? 'Reading…' : 'Upload a PGN file…'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,.txt,.zip,application/zip,application/x-zip-compressed,application/x-chess-pgn"
          hidden
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }}
        />
        {sections.length > 0 && (
          <select
            className="gr-pick"
            aria-label="Open one of your games"
            value={saved ? `${saved.player.id}|${saved.game.id}` : ''}
            onChange={(e) => {
              const [pid, gid] = e.target.value.split('|');
              if (pid && gid) openSaved(pid, gid);
            }}
          >
            <option value="">Your games and your students’…</option>
            {sections.map(({ player, games }) => (
              <optgroup key={player.id} label={player.name}>
                {games.map((g) => (
                  <option key={g.id} value={`${player.id}|${g.id}`}>
                    {g.name}{dateLabel(g.date) ? ` · ${dateLabel(g.date)}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {title && (
          <span className="gr-title" title={title}>
            {title}
            {temp && <span className="muted-note"> · not saved</span>}
          </span>
        )}
        {caId && (
          <button
            className="small"
            title="The review over the whole window, like Chess Arcade on its own"
            onClick={() => setFullKept(true)}
          >
            ⤢ Full screen
          </button>
        )}
        {temp && (
          <button
            className="small primary"
            title="Keep this game, and everything written in its review, in your Games or a student’s"
            onClick={() => setSaving(true)}
          >
            <DownloadIcon size={14} /> Save game
          </button>
        )}
        </div>
      </div>

      {pasteOpen && (
        <div className="pgn-paste-row gr-paste">
          <textarea
            rows={3}
            className="pgn-paste-textarea"
            placeholder="Paste a PGN — headers and all, or just the moves (1.e4 c6 2.Nc3 d5 …)"
            value={pgnText}
            onChange={(e) => { setPgnText(e.target.value); setError(null); }}
          />
          <button className="small primary" disabled={!pgnText.trim()} onClick={loadPaste}>Review</button>
        </div>
      )}

      {error && <p className="muted-note study-error gr-error">{error}</p>}

      {list && (
        <div className="gr-list">
          <div className="gr-list-head">
            <strong>{list.games.length.toLocaleString()} games in {list.name}</strong>
            <input
              type="search"
              placeholder="Find a player, event or date…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="small ghost" aria-label="Close the list" onClick={() => setList(null)}>✕</button>
          </div>
          <div className="gr-list-rows">
            {shown.slice(0, LIST_MAX).map((g) => (
              <button key={g.id} type="button" className="gr-list-row" onClick={() => openItem(g)}>
                <span>{g.name}</span>
                <span className="muted-note">{[g.result, g.event, g.round && `round ${g.round}`, g.date].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            {shown.length > LIST_MAX && <p className="muted-note">Showing {LIST_MAX} of {shown.length.toLocaleString()} — search to narrow it down.</p>}
            {shown.length === 0 && <p className="muted-note">No games match that.</p>}
          </div>
        </div>
      )}

      {!caId && !list && (
        <p className="gr-empty muted-note">
          Paste a PGN, upload a .pgn file, or pick one of your games above — or use
          “Send to Game Review” on any game in Games or Coaches Corner.
          Everything you write in the review is saved onto the game.
        </p>
      )}

      <div
        ref={wrapRef}
        className={`gr-frame-wrap${fullOn ? ' gr-full' : ''}`}
        style={{ display: caId ? 'block' : 'none' }}
      >
        <iframe
          ref={frameRef}
          className="gr-frame"
          title="Game Review"
          src={ARCADE_REVIEW_URL}
          style={fullOn ? undefined : { height }}
          allow="clipboard-write"
        />
        {!ready && caId && <div className="gr-loading">Loading Game Review…</div>}
        {fullOn && (
          <button type="button" className="small gr-exit-full" onClick={() => setFullKept(false)}>
            ✕ Exit full screen
          </button>
        )}
      </div>

      {saving && temp && (
        <SaveGame
          temp={temp}
          state={state}
          onClose={() => setSaving(false)}
          onSave={(playerId, record) => {
            api()?.flush();
            const now = cleanRecords(api()?.records(caId));
            const kept = now && !sameRecords(now, temp.records) ? { ...now, at: Date.now() } : temp.records;
            const player = state.players.find((p) => p.id === playerId);
            const existing = player?.games?.find((g) => alreadyIn({ games: [g] }, record));
            if (existing) {
              if (kept && !existing.gameReview) {
                dispatch({
                  type: 'setGameReviewRecords', playerId, gameId: existing.id, records: kept,
                });
              }
              onOpen({ playerId, gameId: existing.id });
            } else {
              const id = uid();
              dispatch({
                type: 'addGame', playerId, game: { ...record, id, gameReview: kept ?? undefined },
              });
              onOpen({ playerId, gameId: id });
            }
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

// Whose game a pasted one is: a section of yours, or a student's.
function SaveGame({
  temp, state, onClose, onSave,
}) {
  const guess = state.players.find((p) => {
    const m = temp.game.meta ?? {};
    return [p.name, p.profile?.chesscom, p.profile?.lichess].filter(Boolean)
      .some((n) => [m.white, m.black].some((x) => x && String(x).trim().toLowerCase() === String(n).trim().toLowerCase()));
  });
  const [playerId, setPlayerId] = useState(guess?.id ?? state.players[0]?.id ?? '');
  const section = state.players.find((p) => p.id === playerId);
  const record = section ? gameRecord(temp.item, temp.entry, section) : null;
  const own = state.players.filter((p) => (p.kind ?? 'self') === 'self');
  const students = state.players.filter((p) => p.kind === 'student');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Save game</h3>
        {state.players.length === 0 ? (
          <p className="hint">Games live in sections — one for you, one per student. Add one in Games first.</p>
        ) : (
          <>
            <p className="hint">
              {temp.game.name} — and everything written in its review. Whose game is it?
            </p>
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              {own.length > 0 && (
                <optgroup label="Games">
                  {own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              )}
              {students.length > 0 && (
                <optgroup label="Coaches">
                  {students.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              )}
            </select>
            {section && !record && (
              <p className="hint">Games start from the normal position — this one is set up from a position, so it can’t be saved as a game.</p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!record} onClick={() => onSave(playerId, record)}>Save</button>
        </div>
      </div>
    </div>
  );
}
