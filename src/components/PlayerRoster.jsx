import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import SendToStudent from './SendToStudent';
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
import Avatar from '../components/Avatar';
import ScoresheetPhoto from '../components/ScoresheetPhoto';
import { flagLabel, flagColor } from '../lib/gameFlags';
import TagEditor, { TagChips, allTags } from './TagEditor';
import { useBackGuard } from '../lib/backGuard';
import { uid } from '../store';
import {
  addLinkedStudent, watchCoachLinks, endLink,
} from '../lib/cloud/links';
import {
  BookIcon, PencilIcon, PlayIcon, TagIcon, SearchIcon, FolderIcon, AlertIcon, ClockIcon, StarIcon,
  CameraIcon, FlaskIcon, SendIcon, UsersIcon, LinkIcon, TargetIcon, CapIcon,
} from '../components/Icons';
import { useMe } from '../lib/cloud/useMe';
import { useGameLink } from './GameLinkProvider';
import { parseMarks, withText } from '../lib/marks';
import PlayerDashboard from './PlayerDashboard';
import { confirmMeta } from '../lib/uscfMatch';
import { openReview } from './ReviewReader';
import { reviewsOf, reviewHash } from '../lib/cloud/reviews';
import { parseDoc, docFromGame, docIsEmpty } from '../lib/analysisDoc';
import { seedFor } from '../lib/studioSeed';

// The handles a player is known by, with whatever live ratings we last fetched
// for them, shown compactly wherever they're useful.
function ProfileLine({ profile }) {
  const p = profile ?? {};
  const live = p.ratings ?? {};
  const best = (r, keys) => keys.map((k) => r?.[k]).find((v) => v);
  const withRating = (label, rating) => (rating ? `${label} (${rating})` : label);
  const bits = [
    // Their account, under the real name the card leads with.
    p.accountName && `@${p.accountName}`,
    p.rating && `rating ${p.rating}`,
    p.uscf && withRating(`USCF ${p.uscf}`, best(live.uscf, ['regular', 'quick', 'blitz'])),
    p.fide && `FIDE ${p.fide}`,
    p.chesscom && withRating(`chess.com/${p.chesscom}`, best(live.chesscom, ['rapid', 'blitz', 'bullet'])),
    p.lichess && withRating(`lichess/${p.lichess}`, best(live.lichess, ['rapid', 'blitz', 'bullet'])),
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return <div className="profile-line">{bits.join(' · ')}</div>;
}

// Where a student goes to school — and plays on its chess team (the
// profile's School). On their card and at the top of their page.
function SchoolLine({ profile }) {
  const school = String(profile?.school ?? '').trim();
  if (!school) return null;
  return (
    <div className="school-line" title="School — and its chess team">
      <CapIcon size={13} /> {school}
      <span className="muted-note"> · chess team</span>
    </div>
  );
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

// Where a game stands between a coach's card and a linked student's account,
// in words — and the one thing to do about it, where there is one.
const LINK_COPY = {
  'only-card': { text: 'Only on your card', action: ['send', 'Send'] },
  queued: { text: 'Queued — sends when you’re online' },
  sending: { text: 'Sending…' },
  waiting: { text: (n) => `Waiting for ${n}’s app` },
  'in-account': { text: (n) => `In ${n}’s account`, ok: true },
  theirs: { text: (n) => `From ${n}’s app`, ok: true },
  'kept-theirs': { text: (n) => `${n} had already changed this — kept theirs`, action: ['dismiss', 'OK'] },
  gone: { text: (n) => `Removed from ${n}’s account`, action: ['resend', 'Send again'] },
  failed: { text: 'Couldn’t send', action: ['retry', 'Retry'], bad: true },
  'needs-moves': { text: 'Add the moves to send it' },
  'link-ended': { text: 'Link ended' },
  'duplicate-card': { text: (n) => `${n}’s games are kept on your other card for them` },
};

function LinkPill({ status, name, onAction }) {
  const copy = LINK_COPY[status];
  if (!copy) return null;
  const text = typeof copy.text === 'function' ? copy.text(name) : copy.text;
  return (
    <span className={`link-pill${copy.ok ? ' ok' : ''}${copy.bad ? ' bad' : ''}`}>
      {text}
      {copy.action && (
        <button className="link-pill-btn" onClick={() => onAction(copy.action[0])}>{copy.action[1]}</button>
      )}
    </span>
  );
}

// The review button on a game's row. The student: their coach's review of
// the game, or the coach's notes on a game they typed in (lib/cloud/reviews),
// with a dot until read. The coach, on a student's card: a preview of what
// the student reads, and how far it has got.
function reviewActionFor(game, player, players) {
  if ((player.kind ?? 'self') === 'self') {
    const list = reviewsOf(game);
    if (!list.length) return null;
    const unseen = list.some((r) => (r.rev ?? 0) > (game.reviewSeen?.[r.coachUid]?.rev ?? 0));
    return {
      label: `${list[0].by || 'Coach'}’s review`,
      title: 'Read the review — the notes, badges and arrows, with the engine alongside',
      primary: unseen,
      unseen,
      onOpen: () => openReview({ gameId: game.id, coachUid: list[0].coachUid }),
    };
  }
  if (player.kind !== 'student') return null;
  // Worth a button: a review of the student's own game, or notes, badges,
  // drawings or variations on a game the coach typed in. Cheap — what it
  // looks like is only worked out when it's opened.
  const reviewMode = game.link?.origin === 'student' && Boolean(player.profile?.linkedUid)
    && game.link.uid === player.profile.linkedUid;
  const has = (m) => Object.keys(m ?? {}).length > 0;
  const worth = reviewMode
    ? Boolean(game.review?.body)
    : has(game.comments) || has(game.badges) || has(game.annotations) || Boolean(game.tree);
  if (!worth) return null;
  const link = game.link;
  let status = null;
  if (reviewMode && link) {
    const sent = link.reviewSent;
    const theirs = link.theirReview;
    const saved = game.review.savedAt ?? 0;
    const same = sent?.ph === reviewHash(game.review.body);
    if (sent?.failed && same) status = 'Too big to send';
    else if (!same) status = saved > (sent?.savedAt ?? 0) ? 'Sending…' : 'Not sent — save in Studio';
    else if (theirs?.refused && theirs.refused >= (sent.rev ?? 0)) status = 'Their games list is full';
    else if (theirs?.removed) status = 'Removed by them';
    else if (sent.rev && (theirs?.seen ?? 0) >= sent.rev) status = 'Read ✓';
    else if (sent.rev && (theirs?.rev ?? 0) >= sent.rev) status = 'Delivered';
    else status = 'Sent';
  }
  return {
    label: 'Preview',
    title: `What ${player.name} reads: your notes, badges and arrows, with the engine alongside`,
    status,
    onOpen: () => {
      // As Studio would open it (lib/studioSeed): the same review, and the
      // student's own notes to show beside it.
      const seed = seedFor(players, { playerId: player.id, gameId: game.id });
      if (!seed) return;
      const doc = seed.reviewMode ? parseDoc(seed.body) : docFromGame(game);
      if (!doc || docIsEmpty(doc)) return;
      openReview({
        gameId: game.id, preview: true, doc, game, by: 'You', theirNotes: seed.theirNotes,
      });
    },
  };
}

function GameRow({
  game, playerId, category, index, state, onAnalyze, onGameStudio, onView, onEdit, onSetCategory, onSetPhoto,
  onDelete, onScan, onEditTags, onTagClick, linkStatus, partnerName, onLinkAction, review,
}) {
  const m = game.meta ?? {};
  const res = resultFor(game);
  const match = category.match;
  const options = useMemo(() => categoryOptions(state), [state]);
  const [openInfo, setOpenInfo] = useState(false);
  // A photo archived for later — grabbed in a hurry, moves not typed in yet.
  const unscanned = game.moves.length === 0 && !!m.photo;
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
        <span className="mb-caption">{unscanned ? 'Photo only' : `${game.moves.length} moves`}</span>
      </button>
      <div className="game-card-main">
      <div className="game-card-top">
        <GameHeader game={game} />
        <span style={{ flex: 1 }} />
        <ScoresheetPhoto photo={m.photo} onChange={onSetPhoto} />
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
        {unscanned && (
          <span className="scoresheet-unscanned"><AlertIcon size={12} /> Not yet scanned</span>
        )}
        {linkStatus && <LinkPill status={linkStatus} name={partnerName} onAction={onLinkAction} />}
        {/* The student's side: a game their coach put here, and a way back
            from a coach's corrections. */}
        {game.link?.unseen && <span className="link-pill new">New</span>}
        {game.addedBy && (
          <span className="link-pill ok">Added by {game.addedBy.name || 'your coach'}</span>
        )}
        {game.coachPrev && onLinkAction && (
          <span className="link-pill">
            Corrected by {game.addedBy?.name || 'your coach'}
            <button className="link-pill-btn" onClick={() => onLinkAction('undo')}>Undo</button>
          </span>
        )}
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
        {m.flags?.length > 0 && (
          <span className="flag-picker">
            {m.flags.map((f) => (
              <span key={f} className="flag-chip active" style={{ background: flagColor(f), borderColor: flagColor(f) }}>
                {flagLabel(f)}
              </span>
            ))}
          </span>
        )}
        <TagChips tags={game.tags} onClick={onTagClick} max={4} />
        <button className={`tag-btn small${game.tags?.length ? ' on' : ''}`} title="Tag this game" onClick={onEditTags}>
          <TagIcon size={13} />
        </button>
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
        {unscanned ? (
          <button
            className="learn-btn primary"
            title="Read the moves off this photo — checked line by line before it's saved"
            onClick={onScan}
          >
            <CameraIcon size={14} /> Scan this photo
          </button>
        ) : (
          <>
            {/* A coach's review: the student reads it; the coach previews
                what the student sees, and where it has got to. */}
            {review && (
              <>
                {review.status && <span className="link-pill review-status">{review.status}</span>}
                <button
                  className={`learn-btn${review.primary ? ' primary' : ' ghost'}${review.unseen ? ' has-dot' : ''}`}
                  title={review.title}
                  onClick={review.onOpen}
                >
                  <BookIcon size={14} /> {review.label}
                </button>
              </>
            )}
            {onGameStudio && (
              <button
                className="learn-btn ghost"
                title="Open this game in Studio to badge moves and write notes — saved straight onto this game, so they're there next time you come back to it"
                onClick={onGameStudio}
              >
                <FlaskIcon size={14} /> Send to studio
              </button>
            )}
            <button
              className="learn-btn primary"
              title="Open this game on the analysis board with Stockfish and the explorer"
              onClick={onAnalyze}
            >
              <PlayIcon size={14} /> Send to analysis board
            </button>
          </>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}

function PlayerPage({
  player, rosterTitle, onBack, onAnalyze, onGameStudio, onScan, onEditProfile, onOpenLibrary, onOpenCollections,
  initialTab = null, onTabChange,
}) {
  const { state, dispatch } = useStore();
  const [viewingGameId, setViewingGameId] = useState(null);
  const [editing, setEditing] = useState(null); // 'new' | game | { isNew, meta } (prefilled)
  // Opens on the dashboard when there's a US Chess ID — unless the student
  // has sent games not yet seen, which are what the bell brought you for.
  const [tab, setTab] = useState(() => {
    if (initialTab === 'games' || initialTab === 'dashboard') return initialTab; // from a link
    return String(player.profile?.uscf ?? '').replace(/\D/g, '') && !player.games.some((g) => g.link?.unseen)
      ? 'dashboard' : 'games';
  });
  // The tab is part of the page's address (/coaches/<card>/games).
  useEffect(() => { onTabChange?.(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from a player's page returns to the section list rather than the app's
  // home screen. (The editor registers its own guard, which wins while open.)
  useBackGuard(true, onBack);
  // The same "line" shape onAnalyze and onGameStudio both expect — gameId/
  // playerId are what let the analysis board (Studio especially) edit this
  // exact game's badges and notes in place, not just display a snapshot.
  const lineFor = (game, extra) => ({
    name: game.name,
    moves: game.moves,
    comments: game.comments,
    badges: game.badges,
    annotations: game.annotations,
    tree: game.tree,
    variationHighlights: game.variationHighlights,
    meta: game.meta,
    date: game.date,
    ownerId: player.kind === 'student' ? player.id : null,
    gameId: game.id,
    playerId: player.id,
    ...extra,
  });
  const [color, setColor] = useState('all');
  const [cat, setCat] = useState('all');
  const [where, setWhere] = useState('all');
  const [query, setQuery] = useState('');
  const [taggingGameId, setTaggingGameId] = useState(null);

  // A student's own book, not yours — so their games are matched (and
  // Analyze pulls up) against what you've actually taught them.
  const myOpenings = useMemo(
    () => state.openings.filter(
      (o) => (o.ownerId ?? null) === (player.kind === 'student' ? player.id : null),
    ),
    [state.openings, player.kind, player.id],
  );
  const index = useMemo(() => buildPositionIndex(myOpenings), [myOpenings]);
  // What's on offer to send: the lines built for this student, and the coach's
  // own repertoire — a coach teaching their own openings shouldn't have to
  // copy them into the student's file first just to send them.
  const sendable = useMemo(() => {
    const theirs = myOpenings;
    const mine = state.openings.filter((o) => (o.ownerId ?? null) === null);
    // An opening with no lines in it can't be sent, so it shouldn't count
    // towards whether there's anything to send.
    return [...theirs, ...mine].filter(
      (o) => o.chapters.some((c) => (c.variations ?? []).length > 0),
    );
  }, [myOpenings, state.openings]);
  const viewingGame = player.games.find((g) => g.id === viewingGameId);

  // Favorites and themes the coach has starred/tagged inside this student's
  // own repertoire — a quick "what are they working on" summary.
  const favCount = useMemo(() => myOpenings.reduce((n, o) => n + o.chapters.reduce(
    (cn, c) => cn + c.variations.filter((v) => v.starred || c.starred || o.starred).length, 0,
  ), 0), [myOpenings]);
  const themeCount = useMemo(() => new Set(myOpenings.flatMap((o) => [
    ...(o.tags ?? []),
    ...o.chapters.flatMap((c) => [...(c.tags ?? []), ...c.variations.flatMap((v) => v.tags ?? [])]),
  ])).size, [myOpenings]);

  // Ratings go stale on their own; one press asks all three sites again.
  // Sending lines to this student's own app. `me` is the signed-in coach;
  // without an account there's nobody to send as, so the button stays hidden
  // and the file-based study pack in Settings remains the way.
  const [sending, setSending] = useState(false);
  const me = useMe();

  // Linking to this student's real account.
  const [coachLinks, setCoachLinks] = useState([]);
  useEffect(() => {
    if (!me?.uid) { setCoachLinks([]); return undefined; }
    let stop = () => {};
    watchCoachLinks(me.uid, setCoachLinks).then((fn) => { stop = fn; });
    return () => stop();
  }, [me?.uid]);
  const linkedUid = player.profile?.linkedUid ?? null;
  const link = linkedUid ? coachLinks.find((l) => l.studentUid === linkedUid) : null;
  const linked = !!link;
  const [linkName, setLinkName] = useState(player.profile?.accountName ?? '');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const gameLink = useGameLink();
  // New games from the student are marked seen when the coach leaves the
  // card — so the "New" pill is there to see while they're looking at it.
  useEffect(() => () => dispatch({ type: 'markLinkedGamesSeen', cardId: player.id }), [player.id, dispatch]);

  const linkNow = async () => {
    setLinkError(null);
    setLinking(true);
    try {
      const { student, seed } = await addLinkedStudent(me, linkName);
      // Their own profile fills in whatever the coach hasn't already typed
      // by hand — never overwriting notes already on this section.
      dispatch({
        type: 'updatePlayer',
        playerId: player.id,
        // The name the coach already gave this card stays; a blank one takes
        // their real name.
        name: player.name?.trim() ? undefined : seed.realName || undefined,
        // (Key by key: a field left blank on the card doesn't wipe theirs.)
        profile: {
          ...(seed.profile ?? {}),
          ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v != null)),
          linkedUid: student.uid,
          accountName: student.name,
        },
      });
      setLinkName('');
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinking(false);
    }
  };

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
        category.variation?.name, game.moves.join(' '), (game.tags ?? []).join(' '),
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
        <Avatar avatar={player.avatar} seed={player.id} size={44} />
        <div className="player-title">
          <h1>{player.name}</h1>
          <SchoolLine profile={player.profile} />
        </div>
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

      {/* Anything about the link with their account that needs doing shows
          on both tabs. */}
      {linked && (() => {
        // Games on this card from before the link: nothing sends them on its
        // own — the coach may not want every old note going to the student —
        // so they're offered in one tap.
        // Includes games tied to an account this card was linked to before.
        const cardOnly = gameLink.primaryCardFor(linkedUid) === player.id
          ? player.games.filter((g) => (!g.link || g.link.uid !== linkedUid) && g.moves.length > 0)
          : [];
        const access = gameLink.cards[linkedUid]?.state;
        const failedHere = player.games.some((g) => gameLink.failed[g.id]);
        if (!cardOnly.length && access !== 'no-access' && !failedHere) return null;
        return (
          <div className="scope-card" style={{ cursor: 'default', background: 'var(--card)', display: 'block' }}>
            {access === 'no-access' && (
              <p className="hint" style={{ margin: '0 0 6px' }}>
                Can't see {player.name}'s account right now — the link may have ended. Nothing has been
                removed from this card.
              </p>
            )}
            {cardOnly.length > 0 && (
              <div className="settings-row" style={{ margin: 0 }}>
                <span className="muted-note" style={{ flex: 1 }}>
                  {cardOnly.length} game{cardOnly.length === 1 ? ' is' : 's are'} only on your card, from before
                  you linked {player.name}'s account.
                </span>
                <button
                  className="small primary"
                  onClick={() => dispatch({
                    type: 'shareGamesWithStudent', cardId: player.id, gameIds: cardOnly.map((g) => g.id),
                  })}
                >
                  <SendIcon size={14} /> Send to {player.name}'s account
                </button>
              </div>
            )}
            {failedHere && (
              <div className="settings-row" style={{ margin: '6px 0 0' }}>
                <span className="muted-note" style={{ flex: 1, color: 'var(--red)' }}>
                  {gameLink.paused ?? 'Some games couldn’t be sent.'}
                </span>
                <button className="small" onClick={() => gameLink.retry()}>Retry</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* A card with a US Chess ID opens on its dashboard; the games are a tab
          away. (Chosen once per visit — switching stays put.) */}
      <div className="player-tabs" role="tablist" aria-label="Player page">
        <button role="tab" aria-selected={tab === 'dashboard'} className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>
          <TargetIcon size={15} /> Dashboard
        </button>
        <button role="tab" aria-selected={tab === 'games'} className={tab === 'games' ? 'on' : ''} onClick={() => setTab('games')}>
          Games <span className="muted-note">{player.games.length}</span>
        </button>
      </div>

      {tab === 'dashboard' && (
        <PlayerDashboard
          player={player}
          index={index}
          onOpenGame={(gameId) => setViewingGameId(gameId)}
          // The same hand-off as the Games tab's "Send to analysis board".
          onAnalyzeGame={(gameId) => {
            const game = player.games.find((g) => g.id === gameId);
            if (game?.moves?.length) onAnalyze(lineFor(game, { subtitle: categoryOf(game, index, state)?.label }));
          }}
          onEditProfile={onEditProfile}
          // A fresh look-up brings the card's own rating line up to date.
          onRatings={(uscf) => dispatch({
            type: 'updatePlayer',
            playerId: player.id,
            profile: { ...(player.profile ?? {}), ratings: { ...(player.profile?.ratings ?? {}), uscf } },
          })}
          onAddGame={(section, round, asPlayed) => {
            // The game as US Chess has it — event, round, date, colour, result
            // and opponent — with only the moves left to type.
            const meta = confirmMeta({ meta: {} }, section, round, asPlayed);
            setEditing({ isNew: true, moves: [], comments: {}, badges: {}, meta: { ...meta, uscfNot: undefined } });
          }}
        />
      )}

      {tab === 'games' && (
        <>

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
            {me && sendable.length > 0 && (
              <button
                className="small primary"
                title={`Pick openings, chapters or single lines and send them straight to ${player.name}'s app`}
                onClick={() => setSending(true)}
              >
                <SendIcon size={14} /> Send
              </button>
            )}
            <button className="small" onClick={() => onOpenLibrary(player.id)}>
              {myOpenings.length === 0 ? 'Build it' : 'Open in Library'}
            </button>
          </div>
        )}

        {player.kind === 'student' && (
          <div className="scope-card" style={{ cursor: 'default', background: 'var(--card)' }}>
            <div className="scope-info">
              <h3><StarIcon size={15} /> Collections</h3>
              <div className="sub">
                {favCount === 0 && themeCount === 0
                  ? 'Nothing starred or themed for them yet'
                  : `${favCount} favorite line${favCount === 1 ? '' : 's'} · ${themeCount} theme${themeCount === 1 ? '' : 's'}`}
                {' · '}star or tag any of their lines in the Library, right where you build them
              </div>
            </div>
            <button className="small" onClick={() => onOpenCollections(player.id)}>
              Open in Collections
            </button>
          </div>
        )}

        {player.kind === 'student' && me && (
          <div className="scope-card" style={{ cursor: 'default', background: 'var(--card)' }}>
            <div className="scope-info">
              <h3><UsersIcon size={15} /> Their account</h3>
              <div className="sub">
                {linked
                  ? `Linked — games ${player.name} adds in their own app appear below, and games you add
                    here go to their account too.`
                  : `The games and profile above are just your own notes on ${player.name}. Link their
                    account instead and this becomes the real thing — instantly, and they can end it
                    any time.`}
              </div>
              {linkError && <div className="muted-note" style={{ color: 'var(--red)' }}>{linkError}</div>}
            </div>
            {!linked && (
              <>
                <input
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="their account name"
                  style={{ maxWidth: 160 }}
                />
                <button className="small primary" disabled={linking || !linkName.trim()} onClick={linkNow}>
                  {linking ? 'Linking…' : <><LinkIcon size={14} /> Link account</>}
                </button>
              </>
            )}
            {linked && (
              <button
                className="small ghost danger"
                onClick={() => {
                  if (window.confirm(`Stop seeing ${player.name}'s real account?`)) endLink(link.id);
                }}
              >
                End link
              </button>
            )}
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
                placeholder="Search players, events, notes, moves, tags…"
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
            review={reviewActionFor(game, player, state.players)}
            onEdit={() => setEditing(game)}
            onView={() => setViewingGameId(game.id)}
            onAnalyze={() => onAnalyze(lineFor(game, { subtitle: category.label }))}
            onGameStudio={onGameStudio && (() => onGameStudio(lineFor(game, { subtitle: category.label })))}
            onSetCategory={(categoryId) => dispatch({
              type: 'setGameCategory', playerId: player.id, gameId: game.id, categoryId,
            })}
            onSetPhoto={(photo) => dispatch({
              type: 'setGamePhoto', playerId: player.id, gameId: game.id, photo,
            })}
            onScan={() => onScan({
              playerId: player.id,
              gameId: game.id,
              gameName: game.name,
              photo: game.meta?.photo,
            })}
            onDelete={() => {
              const ask = game.link
                ? `Remove "${game.name}" from your card? It stays in ${player.name}'s account.`
                : `Delete "${game.name}"?`;
              if (window.confirm(ask)) {
                dispatch({ type: 'deleteGame', playerId: player.id, gameId: game.id });
                // Anything of it not yet picked up by their app never arrives.
                if (game.link) gameLink.withdraw(game.id);
              }
            }}
            onEditTags={() => setTaggingGameId(game.id)}
            onTagClick={(t) => setQuery(t)}
            linkStatus={linked ? gameLink.statusOf(player, game) : null}
            partnerName={player.name}
            onLinkAction={(what) => {
              if (what === 'send') dispatch({ type: 'shareGamesWithStudent', cardId: player.id, gameIds: [game.id] });
              if (what === 'resend') dispatch({ type: 'resendLinkedGame', cardId: player.id, gameId: game.id });
              if (what === 'dismiss') dispatch({ type: 'dismissLinkLost', cardId: player.id, gameId: game.id });
              if (what === 'retry') gameLink.retry(game.id);
              if (what === 'undo') dispatch({ type: 'undoCoachChanges', playerId: player.id, gameId: game.id });
            }}
          />
        ))}

        </>
      )}

      {sending && me && (
        <SendToStudent
          openings={sendable}
          from={me}
          student={player}
          // Typed once, then remembered on the student's own record — a coach
          // sending every week shouldn't have to look it up every week.
          savedScreenName={player.profile?.accountName || player.profile?.screenName || ''}
          onSaveScreenName={(screenName) => dispatch({
            type: 'updatePlayer',
            playerId: player.id,
            profile: { ...(player.profile ?? {}), screenName, accountName: screenName },
          })}
          onClose={() => setSending(false)}
        />
      )}

      {taggingGameId && (() => {
        const target = player.games.find((g) => g.id === taggingGameId);
        if (!target) return null;
        return (
          <TagEditor
            title={target.name}
            tags={target.tags}
            suggestions={allTags(state)}
            onChange={(tags) => dispatch({ type: 'setGameTags', playerId: player.id, gameId: target.id, tags })}
            onClose={() => setTaggingGameId(null)}
          />
        );
      })()}

      {editing && (
        <GameEditor
          initial={editing === 'new' ? null : editing}
          state={state}
          onClose={() => setEditing(null)}
          player={player}
          linkedTo={linked ? player.name : null}
          onSave={(game) => {
            if (editing === 'new') dispatch({ type: 'addGame', playerId: player.id, game });
            else if (editing.isNew) {
              // Added from a rated round on the dashboard: linked to it.
              const link = editing.meta?.uscfRef
                ? { uscfRef: editing.meta.uscfRef, ...(editing.meta.uscfOpp ? { uscfOpp: editing.meta.uscfOpp } : {}) }
                : {};
              dispatch({ type: 'addGame', playerId: player.id, game: { ...game, meta: { ...game.meta, ...link } } });
            } else dispatch({ type: 'updateGame', playerId: player.id, gameId: editing.id, game });
            setEditing(null);
          }}
        />
      )}

      {viewingGame && (
        <VariationViewer
          variation={viewingGame}
          orientation={viewingGame.meta?.color === 'black' ? 'black' : 'white'}
          onClose={() => setViewingGameId(null)}
          onSetBadge={(ply, badge) => dispatch({
            type: 'setGameMoveBadge', playerId: player.id, gameId: viewingGame.id, ply, badge,
          })}
          // The viewer edits a note's words only — the move's arrows and any
          // [%clk]/[%eval] a Lichess game carries stay on it, unless what was
          // typed brings arrows of its own. (Analysis sends the whole raw
          // comment, codes and all, so the store itself doesn't merge.)
          onSaveComment={(ply, text) => {
            const typed = String(text ?? '').trim();
            const own = parseMarks(typed);
            dispatch({
              type: 'setGameMoveComment',
              playerId: player.id,
              gameId: viewingGame.id,
              ply,
              text: own.cal.length || own.csl.length ? typed : withText(viewingGame.comments?.[ply], typed),
            });
          }}
          // The whole game, as the card's own "Send to analysis board" sends
          // it: without its tree, arrows and coloured variations, a Save on
          // the board would have written the game back without them.
          onAnalyze={(g) => {
            setViewingGameId(null);
            onAnalyze(lineFor(g));
          }}
        />
      )}
    </div>
  );
}

// Landing: one section per person — either just you (Games) or each student
// (Coaches). Shared by both tabs; `kind` picks which half of state.players
// shows and colours the copy.
// A request to open one person's card, left by the bell before the roster
// is on screen (see openPlayerCard in lib/openPlayer.js).
function takePendingOpen(kind) {
  const want = window.__repertoireOpenPlayer;
  if (!want || want.kind !== kind) return null;
  window.__repertoireOpenPlayer = null;
  return want.id;
}

export default function PlayerRoster({
  kind, title, subtitle, addLabel, emptyLabel, onAnalyze, onGameStudio, onScan, onOpenLibrary, onOpenCollections,
  onOpenStudio, routePlayer = null, onPlayerChange,
}) {
  const { state, dispatch } = useStore();
  // Opened straight from the bell ("Parker added a game → Open"), or from a
  // link to the person's page (/coaches/<card>).
  const [pendingId] = useState(() => takePendingOpen(kind));
  const [openPlayerId, setOpenPlayerId] = useState(pendingId ?? routePlayer?.id ?? null);
  // The page's tab, for its address. From the bell it's the games just added.
  const [tab, setTab] = useState(pendingId ? 'games' : (routePlayer?.tab ?? null));
  useEffect(() => {
    const on = () => { const id = takePendingOpen(kind); if (id) { setOpenPlayerId(id); setTab('games'); } };
    window.addEventListener('repertoire-open-player', on);
    return () => window.removeEventListener('repertoire-open-player', on);
  }, [kind]);
  // The address last seen or told — so the two effects below can tell a real
  // change of address (Back, Forward, a link pasted in) from the echo of our
  // own report. Without it, opening from the bell (card open, address not yet
  // caught up) had each effect undo the other, forever.
  const routeSeen = useRef(routePlayer?.id ?? null);
  useEffect(() => {
    const want = routePlayer?.id ?? null;
    if (want === routeSeen.current) return;
    routeSeen.current = want;
    if (want !== openPlayerId) {
      setOpenPlayerId(want);
      setTab(routePlayer?.tab ?? null);
    }
  }, [routePlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // …and tell the address where we are.
  useEffect(() => {
    const next = openPlayerId ? { id: openPlayerId, tab: tab === 'games' ? 'games' : null } : null;
    if ((next?.id ?? null) !== (routePlayer?.id ?? null) || (next?.tab ?? null) !== (routePlayer?.tab ?? null)) {
      routeSeen.current = next?.id ?? null;
      onPlayerChange?.(next);
    }
  }, [openPlayerId, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [manageCats, setManageCats] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null); // 'new' | player
  // Adding a student two ways: type in what you know by hand (the roster
  // this app has always had), or point at their real account name and get
  // everything — repertoire, games, USCF ID, rating — instantly, live.
  const me = useMe();
  const [addMode, setAddMode] = useState(null); // null | 'choose' | 'account'
  const [linkName, setLinkName] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(null);

  useBackGuard(manageCats, () => setManageCats(false));
  useBackGuard(!!addMode, () => setAddMode(null));

  const addByAccount = async () => {
    setLinkError(null);
    setLinking(true);
    try {
      const { student, seed } = await addLinkedStudent(me, linkName);
      const id = uid();
      dispatch({
        type: 'addPlayer',
        id,
        kind,
        // The card leads with their real name when their account has one;
        // until then, the account name stands in.
        name: seed.realName || student.name || linkName.trim(),
        profile: { ...(seed.profile ?? {}), linkedUid: student.uid, accountName: student.name || linkName.trim() },
        avatar: seed.avatar ?? undefined,
      });
      setAddMode(null);
      setLinkName('');
      setOpenPlayerId(id);
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinking(false);
    }
  };

  const players = state.players.filter((p) => (p.kind ?? 'self') === kind);
  const openPlayer = players.find((p) => p.id === openPlayerId);
  // A link to a card this account doesn't have (someone else's, or one not
  // synced here yet — it opens if it arrives).
  const missingLink = openPlayerId && !openPlayer ? openPlayerId : null;

  if (openPlayer) {
    return (
      <>
        <PlayerPage
          key={openPlayer.id}
          player={openPlayer}
          rosterTitle={title}
          initialTab={tab}
          onTabChange={setTab}
          onBack={() => { setOpenPlayerId(null); setTab(null); }}
          onAnalyze={onAnalyze}
          onGameStudio={onGameStudio}
          onScan={onScan}
          onEditProfile={() => setEditingPlayer(openPlayer)}
          onOpenLibrary={onOpenLibrary}
          onOpenCollections={onOpenCollections}
        />
        {editingPlayer && (
          <PlayerEditor
            initial={editingPlayer === 'new' ? null : editingPlayer}
            kind={editingPlayer === 'new' ? kind : editingPlayer.kind}
            onClose={() => setEditingPlayer(null)}
            onSave={(name, profile, avatar) => {
              dispatch({ type: 'updatePlayer', playerId: editingPlayer.id, name, profile, avatar });
              setEditingPlayer(null);
            }}
          />
        )}
      </>
    );
  }



  return (
    <div className="page">
      {missingLink && (
        <div className="scope-card" style={{ cursor: 'default', background: 'var(--card)', display: 'block' }}>
          <p className="hint" style={{ margin: 0 }}>
            That link is for a {kind === 'student' ? 'student' : 'section'} who isn’t on this account
            {' '}— it opens here if they sync in.{' '}
            <button className="small ghost" onClick={() => { setOpenPlayerId(null); setTab(null); }}>Dismiss</button>
          </p>
        </div>
      )}
      <div className="page-head">
        <h1>{title}</h1>
        <span style={{ flex: 1 }} />
        {kind === 'self' && (
          <button onClick={() => setManageCats(true)}>
            <TagIcon size={15} /> Categories
          </button>
        )}
        {kind === 'student' && onOpenStudio && (
          <button
            className="ghost"
            title="A blank analysis board for building study material — badge and annotate any move, then save it to the Lab or straight into a student's chapter"
            onClick={onOpenStudio}
          >
            <FlaskIcon size={15} /> Studio
          </button>
        )}
        <button
          className="primary"
          onClick={() => (kind === 'student' ? setAddMode('choose') : setEditingPlayer('new'))}
        >
          {addLabel}
        </button>
      </div>
      <p className="roster-subtitle">{subtitle}</p>

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
          <div key={player.id} className="scope-card" onClick={() => { setOpenPlayerId(player.id); setTab(null); }}>
            <Avatar avatar={player.avatar} seed={player.id} size={48} />
            <div className="scope-info">
              <h3>{player.name}</h3>
              <SchoolLine profile={player.profile} />
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
          kind={editingPlayer === 'new' ? kind : editingPlayer.kind}
          onClose={() => setEditingPlayer(null)}
          onSave={(name, profile, avatar, id) => {
            if (editingPlayer === 'new') dispatch({ type: 'addPlayer', id, name, profile, avatar, kind });
            else dispatch({ type: 'updatePlayer', playerId: editingPlayer.id, name, profile, avatar });
            setEditingPlayer(null);
          }}
        />
      )}

      {addMode === 'choose' && (
        <div className="modal-overlay" onClick={() => setAddMode(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add a student</h3>
            <div className="cat-manage-row" style={{ cursor: 'pointer' }} onClick={() => { setAddMode(null); setEditingPlayer('new'); }}>
              <PencilIcon size={15} />
              <div style={{ flex: 1 }}>
                <strong>Type it in by hand</strong>
                <div className="muted-note">Name, USCF ID, rating — your own notes, same as always.</div>
              </div>
            </div>
            <div className="cat-manage-row" style={{ cursor: me ? 'pointer' : 'default', opacity: me ? 1 : 0.5 }} onClick={() => me && setAddMode('account')}>
              <LinkIcon size={15} />
              <div style={{ flex: 1 }}>
                <strong>Link their account</strong>
                <div className="muted-note">
                  {me
                    ? "Type their account name — you'll see their real openings, games, USCF ID and rating instantly."
                    : 'Sign in first — linking needs a coach account to link as.'}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setAddMode(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {addMode === 'account' && (
        <div className="modal-overlay" onClick={() => setAddMode(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Link their account</h3>
            <p className="hint">
              Their account name — the one in their Settings → Account. This opens instantly: no
              approval needed, though they can end it from their own account whenever they like.
            </p>
            <label className="field-row">
              <span>Account name</span>
              <input
                autoFocus
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="e.g. wavy-jr"
                onKeyDown={(e) => { if (e.key === 'Enter' && linkName.trim()) addByAccount(); }}
              />
            </label>
            {linkError && <p className="hint" style={{ color: 'var(--red)' }}>{linkError}</p>}
            <div className="modal-actions">
              <button onClick={() => setAddMode(null)}>Cancel</button>
              <button className="primary" disabled={linking || !linkName.trim()} onClick={addByAccount}>
                {linking ? 'Linking…' : 'Link account'}
              </button>
            </div>
          </div>
        </div>
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
