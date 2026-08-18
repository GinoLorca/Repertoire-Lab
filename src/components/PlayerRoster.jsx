import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { buildPositionIndex, moveLabel } from '../lib/repertoire';
import {
  categoryOf, categoryOptions, playerRecord, resultFor, EVENT_TYPES, OFFBEAT, tidyEvent,
} from '../lib/games';
import MoveText from '../components/MoveText';
import MiniBoard from '../components/MiniBoard';
import { lineFens } from '../lib/pgn';
import { fetchUscf, fetchChesscom, fetchLichess } from '../lib/ratings';
import VariationViewer from '../components/VariationViewer';
import GameEditor from '../components/GameEditor';
import PlayerEditor from '../components/PlayerEditor';
import { useBackGuard } from '../lib/backGuard';
import {
  BookIcon, PencilIcon, PlayIcon, TagIcon, SearchIcon, FolderIcon, AlertIcon, ClockIcon,
} from '../components/Icons';

// The handles a player is known by, with whatever live ratings we last fetched
// for them, shown compactly wherever they're useful.
function ProfileLine({ profile }) {
  const p = profile ?? {};
  const live = p.ratings ?? {};
  const best = (r, keys) => keys.map((k) => r?.[k]).find((v) => v);
  const withRating = (label, rating) => (rating ? `${label} (${rating})` : label);
  const bits = [
    p.rating && `rating ${p.rating}`,
    p.uscf && withRating(`USCF ${p.uscf}`, best(live.uscf, ['regular', 'quick', 'blitz'])),
    p.fide && `FIDE ${p.fide}`,
    p.chesscom && withRating(`chess.com/${p.chesscom}`, best(live.chesscom, ['rapid', 'blitz', 'bullet'])),
    p.lichess && withRating(`lichess/${p.lichess}`, best(live.lichess, ['rapid', 'blitz', 'bullet'])),
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return <div className="profile-line">{bits.join(' · ')}</div>;
}

const eventLabel = (type) => EVENT_TYPES.find((t) => t.value === type)?.label ?? 'Over the board';
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// The chess.com-style header block: both players with ratings, and the result
// between them.
function GameHeader({ game }) {
  const m = game.meta ?? {};
  const res = resultFor(game);
  const side = (name, elo, isMine) => (
    <span className={`gh-player${isMine ? ' mine' : ''}`}>
      <strong>{name || '—'}</strong>
      {elo ? <span className="gh-elo">{elo}</span> : null}
    </span>
  );
  return (
    <div className="game-header">
      <span className="gh-side white" title="White">
        <span className="gh-disc white" />
        {side(m.white, m.whiteElo, m.color === 'white')}
      </span>
      <span className={`gh-result ${res.kind}`}>{m.result && m.result !== '*' ? m.result : '·'}</span>
      <span className="gh-side black" title="Black">
        <span className="gh-disc black" />
        {side(m.black, m.blackElo, m.color === 'black')}
      </span>
    </div>
  );
}

function GameRow({
  game, playerId, category, index, state, onAnalyze, onView, onEdit, onSetCategory, onDelete,
}) {
  const m = game.meta ?? {};
  const res = resultFor(game);
  const match = category.match;
  const options = useMemo(() => categoryOptions(state), [state]);
  const [openInfo, setOpenInfo] = useState(false);
  // The position the game finished in, for the thumbnail.
  const finalFen = useMemo(() => {
    const fens = lineFens(game.moves);
    return fens[fens.length - 1];
  }, [game.moves]);

  return (
    <div className={`game-card${res.kind !== 'none' ? ` res-${res.kind}` : ''}`}>
      <div className="game-card-body">
      <button
        className="mini-board-btn"
        title="Step through this game"
        onClick={onView}
      >
        <MiniBoard
          fen={finalFen}
          orientation={m.color === 'black' ? 'black' : 'white'}
          size={112}
        />
        <span className="mb-caption">{game.moves.length} moves</span>
      </button>
      <div className="game-card-main">
      <div className="game-card-top">
        <GameHeader game={game} />
        <span style={{ flex: 1 }} />
        <button className="small ghost" title="Game details" onClick={() => setOpenInfo((o) => !o)}>
          {openInfo ? 'Hide info' : 'Info'}
        </button>
        <button className="small ghost" title="Edit game" onClick={onEdit}>
          <PencilIcon size={15} />
        </button>
        <button className="small ghost danger" title="Delete game" onClick={onDelete}>✕</button>
      </div>

      <div className="game-meta-row">
        {res.kind !== 'none' && <span className={`result-pill ${res.kind}`}>{res.label}</span>}
        <span>{fmtDate(game.date)}</span>
        <span>{eventLabel(m.eventType)}</span>
        {tidyEvent(m.event, m.eventType) && <span>· {tidyEvent(m.event, m.eventType)}</span>}
        {m.round && <span>· round {m.round}</span>}
        {m.timeControl && <span>· {m.timeControl}</span>}
        {m.color && m.color !== 'none' && <span>· you had {m.color}</span>}
        <span>· {game.moves.length} moves</span>
      </div>

      <div className="game-cat-row">
        <span className={`cat-chip ${category.kind}`} title={category.auto ? 'Recognised from your repertoire' : 'You filed this one here'}>
          {category.kind === 'offbeat' ? <AlertIcon size={12} /> : <FolderIcon size={12} />}
          {category.label}
          {category.auto ? '' : ' (manual)'}
        </span>
        {match?.variation && (
          <span className="muted-note">
            {match.transposed ? 'transposed into' : 'follows'} <strong>{match.variation.name}</strong>
            {` · ${match.bookPly} moves deep`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <select
          className="cat-select"
          value={m.categoryId ?? ''}
          title="File this game under a different opening or one of your own categories"
          onChange={(e) => onSetCategory(e.target.value || null)}
        >
          <option value="">Automatic</option>
          {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      <div className="variation-moves" title="Click to step through the game" onClick={onView}>
        <MoveText moves={game.moves.slice(0, 24)} comments={game.comments} />
        {game.moves.length > 24 && <span className="muted-note">…</span>}
      </div>

      {openInfo && (
        <div className="game-info-box">
          <div className="gi-grid">
            <div><span>White</span><strong>{m.white || '—'}{m.whiteElo ? ` (${m.whiteElo})` : ''}</strong></div>
            <div><span>Black</span><strong>{m.black || '—'}{m.blackElo ? ` (${m.blackElo})` : ''}</strong></div>
            <div><span>Result</span><strong>{m.result && m.result !== '*' ? m.result : 'unfinished'}</strong></div>
            <div><span>Your colour</span><strong>{m.color && m.color !== 'none' ? m.color : '—'}</strong></div>
            <div><span>Date</span><strong>{fmtDate(game.date)}</strong></div>
            <div><span>Where</span><strong>{eventLabel(m.eventType)}</strong></div>
            <div><span>Event</span><strong>{tidyEvent(m.event, m.eventType) || '—'}</strong></div>
            <div><span>Round</span><strong>{m.round || '—'}</strong></div>
            <div><span>Time control</span><strong>{m.timeControl || '—'}</strong></div>
            <div><span>Opening</span><strong>{category.label}</strong></div>
          </div>
          {match?.deviation && (
            <div className="muted-note">
              Left the repertoire at {moveLabel(match.deviation.atPly)}{match.deviation.played}.
            </div>
          )}
          <div className="gi-notes">
            <span>Notes</span>
            <p>{m.notes ? m.notes : <em className="muted-note">No notes yet — use the pencil to add some.</em>}</p>
          </div>
        </div>
      )}

      <div className="row-foot">
        {m.notes && !openInfo && <span className="muted-note gi-peek">“{m.notes.slice(0, 90)}{m.notes.length > 90 ? '…' : ''}”</span>}
        <span style={{ flex: 1 }} />
        <button
          className="learn-btn primary"
          title="Open this game on the analysis board with Stockfish and the explorer"
          onClick={onAnalyze}
        >
          <PlayIcon size={14} /> Send to analysis board
        </button>
      </div>
      </div>
      </div>
    </div>
  );
}

function PlayerPage({
  player, rosterTitle, onBack, onAnalyze, onEditProfile, onOpenLibrary,
}) {
  const { state, dispatch } = useStore();
  const [viewingGameId, setViewingGameId] = useState(null);
  const [editing, setEditing] = useState(null); // 'new' | game

  // Back from a player's page returns to the section list rather than the app's
  // home screen. (The editor registers its own guard, which wins while open.)
  useBackGuard(true, onBack);
  const [color, setColor] = useState('all');
  const [cat, setCat] = useState('all');
  const [where, setWhere] = useState('all');
  const [query, setQuery] = useState('');

  // A student's own book, not yours — so their games are matched (and
  // Analyze pulls up) against what you've actually taught them.
  const myOpenings = useMemo(
    () => state.openings.filter(
      (o) => (o.ownerId ?? null) === (player.kind === 'student' ? player.id : null),
    ),
    [state.openings, player.kind, player.id],
  );
  const index = useMemo(() => buildPositionIndex(myOpenings), [myOpenings]);
  const viewingGame = player.games.find((g) => g.id === viewingGameId);

  // Ratings go stale on their own; one press asks all three sites again.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const p = player.profile ?? {};
  const hasIds = !!(p.uscf || p.chesscom || p.lichess);
  const refreshRatings = async () => {
    setRefreshing(true);
    setRefreshError(null);
    const ratings = { ...(p.ratings ?? {}) };
    const problems = [];
    const jobs = [
      p.uscf && ['uscf', () => fetchUscf(p.uscf)],
      p.chesscom && ['chesscom', () => fetchChesscom(p.chesscom)],
      p.lichess && ['lichess', () => fetchLichess(p.lichess)],
    ].filter(Boolean);
    await Promise.all(jobs.map(async ([key, run]) => {
      try { ratings[key] = await run(); } catch (err) { problems.push(err.message); }
    }));
    dispatch({ type: 'updatePlayer', playerId: player.id, profile: { ...p, ratings } });
    setRefreshError(problems.join(' '));
    setRefreshing(false);
  };

  // Classify every game once, then filter.
  const rows = useMemo(() => player.games
    .map((game) => ({ game, category: categoryOf(game, index, state) }))
    .sort((a, b) => b.game.date - a.game.date), [player.games, index, state]);

  const filtered = rows.filter(({ game, category }) => {
    const m = game.meta ?? {};
    if (color !== 'all' && (m.color ?? 'none') !== color) return false;
    if (cat !== 'all' && category.id !== cat) return false;
    if (where !== 'all' && (m.eventType ?? 'otb') !== where) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      const hay = [
        game.name, m.white, m.black, m.event, m.notes, category.label,
        category.variation?.name, game.moves.join(' '),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Category tallies for the filter dropdown and the summary strip.
  const byCategory = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const entry = map.get(row.category.id) ?? { label: row.category.label, count: 0, kind: row.category.kind };
      entry.count += 1;
      map.set(row.category.id, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [rows]);

  const record = playerRecord(filtered.map((r) => r.game));

  return (
    <div className="page">
      <div className="breadcrumb">
        <a onClick={onBack}>{rosterTitle}</a>
        <span>▸</span>
        <span>{player.name}</span>
      </div>

      <div className="page-head">
        <h1>{player.name}</h1>
        <span style={{ flex: 1 }} />
        {hasIds && (
          <button
            disabled={refreshing}
            title="Look their ratings up again — US Chess, Chess.com and Lichess"
            onClick={refreshRatings}
          >
            {refreshing ? 'Refreshing…' : <><ClockIcon size={15} /> Refresh ratings</>}
          </button>
        )}
        <button onClick={onEditProfile}><PencilIcon size={15} /> Profile</button>
        <button className="primary" onClick={() => setEditing('new')}>+ Add game</button>
      </div>

      <ProfileLine profile={player.profile} />
      {refreshError && <div className="muted-note"><AlertIcon size={13} /> {refreshError}</div>}

      {player.kind === 'student' && (
        <div className="scope-card" style={{ cursor: 'default', background: 'var(--card)' }}>
          <div className="scope-info">
            <h3><BookIcon size={15} /> Repertoire</h3>
            <div className="sub">
              {myOpenings.length === 0
                ? "Nothing built for them yet"
                : `${myOpenings.length} opening${myOpenings.length === 1 ? '' : 's'} — ${
                  myOpenings.map((o) => o.name).join(', ')}`}
              {' · '}shows automatically when you analyze one of their games below
            </div>
          </div>
          <button className="small" onClick={() => onOpenLibrary(player.id)}>
            {myOpenings.length === 0 ? 'Build it' : 'Open in Library'}
          </button>
        </div>
      )}

      {player.games.length > 0 && (
        <div className="player-summary">
          <div className="ps-record">
            <strong>{record.wins}</strong>W <strong>{record.draws}</strong>D <strong>{record.losses}</strong>L
            {record.other > 0 && <span className="muted-note"> · {record.other} unscored</span>}
          </div>
          <span className="muted-note">
            {filtered.length} of {player.games.length} games shown · {byCategory.length} categor
            {byCategory.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
      )}

      {player.games.length > 0 && (
        <div className="game-filters">
          <span className="gf-search">
            <SearchIcon size={15} />
            <input
              type="text"
              value={query}
              placeholder="Search players, events, notes, moves…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <select value={color} onChange={(e) => setColor(e.target.value)} title="Filter by the colour you had">
            <option value="all">Either colour</option>
            <option value="white">I had White</option>
            <option value="black">I had Black</option>
            <option value="none">Someone else's game</option>
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} title="Filter by opening / variation">
            <option value="all">All openings</option>
            {byCategory.map(([id, entry]) => (
              <option key={id} value={id}>{entry.label} ({entry.count})</option>
            ))}
          </select>
          <select value={where} onChange={(e) => setWhere(e.target.value)} title="Filter by where the game was played">
            <option value="all">Anywhere</option>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {(color !== 'all' || cat !== 'all' || where !== 'all' || query) && (
            <button
              className="small ghost"
              onClick={() => { setColor('all'); setCat('all'); setWhere('all'); setQuery(''); }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {player.games.length === 0 && (
        <div className="empty-note">
          No games yet. Press <strong>+ Add game</strong> to type one in from a scoresheet or paste a
          PGN — or save one straight off the analysis board.
        </div>
      )}

      {player.games.length > 0 && filtered.length === 0 && (
        <div className="empty-note">No games match those filters.</div>
      )}

      {filtered.map(({ game, category }) => (
        <GameRow
          key={game.id}
          game={game}
          playerId={player.id}
          category={category}
          state={state}
          onEdit={() => setEditing(game)}
          onView={() => setViewingGameId(game.id)}
          onAnalyze={() => onAnalyze({
            name: game.name,
            moves: game.moves,
            meta: game.meta,
            date: game.date,
            subtitle: category.label,
            ownerId: player.kind === 'student' ? player.id : null,
          })}
          onSetCategory={(categoryId) => dispatch({
            type: 'setGameCategory', playerId: player.id, gameId: game.id, categoryId,
          })}
          onDelete={() => {
            if (window.confirm(`Delete "${game.name}"?`)) {
              dispatch({ type: 'deleteGame', playerId: player.id, gameId: game.id });
            }
          }}
        />
      ))}

      {editing && (
        <GameEditor
          initial={editing === 'new' ? null : editing}
          state={state}
          onClose={() => setEditing(null)}
          player={player}
          onSave={(game) => {
            if (editing === 'new') dispatch({ type: 'addGame', playerId: player.id, game });
            else dispatch({ type: 'updateGame', playerId: player.id, gameId: editing.id, game });
            setEditing(null);
          }}
        />
      )}

      {viewingGame && (
        <VariationViewer
          variation={viewingGame}
          orientation={viewingGame.meta?.color === 'black' ? 'black' : 'white'}
          onClose={() => setViewingGameId(null)}
          onAnalyze={(g) => {
            setViewingGameId(null);
            onAnalyze({
              name: g.name,
              moves: g.moves,
              meta: g.meta,
              date: g.date,
              ownerId: player.kind === 'student' ? player.id : null,
            });
          }}
        />
      )}
    </div>
  );
}

// Landing: one section per person — either just you (Games) or each student
// (Coaches). Shared by both tabs; `kind` picks which half of state.players
// shows and colours the copy.
export default function PlayerRoster({
  kind, title, subtitle, addLabel, emptyLabel, onAnalyze, onOpenLibrary,
}) {
  const { state, dispatch } = useStore();
  const [openPlayerId, setOpenPlayerId] = useState(null);
  const [manageCats, setManageCats] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null); // 'new' | player

  useBackGuard(manageCats, () => setManageCats(false));

  const players = state.players.filter((p) => (p.kind ?? 'self') === kind);
  const openPlayer = players.find((p) => p.id === openPlayerId);

  if (openPlayer) {
    return (
      <>
        <PlayerPage
          player={openPlayer}
          rosterTitle={title}
          onBack={() => setOpenPlayerId(null)}
          onAnalyze={onAnalyze}
          onEditProfile={() => setEditingPlayer(openPlayer)}
          onOpenLibrary={onOpenLibrary}
        />
        {editingPlayer && (
          <PlayerEditor
            initial={editingPlayer === 'new' ? null : editingPlayer}
            onClose={() => setEditingPlayer(null)}
            onSave={(name, profile) => {
              dispatch({ type: 'updatePlayer', playerId: editingPlayer.id, name, profile });
              setEditingPlayer(null);
            }}
          />
        )}
      </>
    );
  }



  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <span style={{ flex: 1 }} />
        {kind === 'self' && (
          <button onClick={() => setManageCats(true)}>
            <TagIcon size={15} /> Categories
          </button>
        )}
        <button className="primary" onClick={() => setEditingPlayer('new')}>{addLabel}</button>
      </div>
      <p style={{ color: 'var(--muted)', marginTop: -8 }}>{subtitle}</p>

      {players.length === 0 && (
        <div className="empty-note">{emptyLabel}</div>
      )}

      {players.map((player) => {
        const myOpenings = state.openings.filter(
          (o) => (o.ownerId ?? null) === (kind === 'student' ? player.id : null),
        );
        const index = buildPositionIndex(myOpenings);
        const record = playerRecord(player.games);
        const cats = new Set(player.games.map((g) => categoryOf(g, index, state).id));
        const offbeat = player.games.filter((g) => categoryOf(g, index, state).id === OFFBEAT).length;
        return (
          <div key={player.id} className="scope-card" onClick={() => setOpenPlayerId(player.id)}>
            <div className="scope-info">
              <h3>{player.name}</h3>
              <div className="sub">
                {player.games.length} game{player.games.length === 1 ? '' : 's'}
                {player.games.length > 0 && (
                  <> · {record.wins}W {record.draws}D {record.losses}L · {cats.size} opening
                    {cats.size === 1 ? '' : 's'}
                    {offbeat > 0 ? ` · ${offbeat} off-beat` : ''}
                  </>
                )}
              </div>
              <ProfileLine profile={player.profile} />
            </div>
            <button
              className="small ghost"
              title="Edit this player's profile"
              onClick={(e) => { e.stopPropagation(); setEditingPlayer(player); }}
            >
              <PencilIcon size={15} />
            </button>
            <button
              className="small ghost danger"
              title="Delete section and its games"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete "${player.name}" and its ${player.games.length} games?`)) {
                  dispatch({ type: 'deletePlayer', playerId: player.id });
                }
              }}
            >
              ✕
            </button>
          </div>
        );
      })}

      {editingPlayer && (
        <PlayerEditor
          initial={editingPlayer === 'new' ? null : editingPlayer}
          onClose={() => setEditingPlayer(null)}
          onSave={(name, profile) => {
            if (editingPlayer === 'new') dispatch({ type: 'addPlayer', name, profile, kind });
            else dispatch({ type: 'updatePlayer', playerId: editingPlayer.id, name, profile });
            setEditingPlayer(null);
          }}
        />
      )}

      {manageCats && (
        <div className="modal-overlay" onClick={() => setManageCats(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>My categories</h3>
            <p className="hint">
              Shelves for openings your repertoire doesn't cover — “1.b4 nonsense”, “Anti-Sicilians”,
              “King's Indian Attack”. Any game can be filed into one by hand.
            </p>
            {(state.categories ?? []).length === 0 && (
              <div className="muted-note">None yet.</div>
            )}
            {(state.categories ?? []).map((c) => (
              <div key={c.id} className="cat-manage-row">
                <FolderIcon size={15} />
                <strong style={{ flex: 1 }}>{c.name}</strong>
                <button
                  className="small ghost"
                  title="Rename"
                  onClick={() => {
                    const name = window.prompt('Category name:', c.name);
                    if (name?.trim()) dispatch({ type: 'renameCategory', categoryId: c.id, name: name.trim() });
                  }}
                >
                  <PencilIcon size={14} />
                </button>
                <button
                  className="small ghost danger"
                  title="Delete — games filed here go back to automatic"
                  onClick={() => dispatch({ type: 'deleteCategory', categoryId: c.id })}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="modal-actions">
              <button
                onClick={() => {
                  const name = window.prompt('New category name:');
                  if (name?.trim()) dispatch({ type: 'addCategory', name: name.trim() });
                }}
              >
                + New category
              </button>
              <button className="primary" onClick={() => setManageCats(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
