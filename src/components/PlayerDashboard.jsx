import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import RatingChart from './RatingChart';
import ScoutBox from './ScoutBox';
import EstimatorBox from './EstimatorBox';
import { estimateRating } from '../lib/uscfEstimate';
import {
  SYSTEM_NAME, standing, ratingSeries, mainSystem, PLAYED, ratingSummary,
} from '../lib/uscfHistory';
import { cachedHistory, fetchHistory, fetchStandings } from '../lib/uscfClient';
import {
  ratedGames, sectionSummary, splits, form, highlights, opponents,
} from '../lib/uscfStats';
import {
  matchGames, roundKey, confirmMeta, refuseMeta, unlinkMeta, isCandidateGame,
} from '../lib/uscfMatch';
import { tidyName } from '../lib/uscf';
import { categoryOf, resultFor } from '../lib/games';
import { ratingAge } from '../lib/ratings';
import {
  AlertIcon, CheckIcon, ClockIcon, PlayIcon, TargetIcon, PencilIcon, MonitorIcon,
} from './Icons';

// A player's US Chess dashboard — the rated history their card's USCF ID
// points at, with the games recorded in the app lined up against it.
//
// The same page for a student's card (a coach, on any of their devices) and
// for your own: everything comes from US Chess (public) and the card's own
// games, so nothing needs a student's account to be open.

const STALE_MS = 10 * 60 * 1000;
const RESULT_LABEL = {
  W: 'Win', L: 'Loss', D: 'Draw', FW: 'Forfeit win', FL: 'Forfeit loss', BF: 'Bye (1 pt)', BH: 'Bye (½ pt)', U: 'Not paired', '?': '—',
};
const RUN_WORD = { W: ['win', 'wins'], L: ['loss', 'losses'], D: ['draw', 'draws'] };
const CHIP = {
  W: 'W', L: 'L', D: 'D', FW: 'F', FL: 'F', BF: 'B', BH: '½', U: '–', '?': '?',
};
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const signed = (n) => (n == null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`);
const eventTitle = (name) => tidyName(name).replace(/\bNy\b/g, 'NY').replace(/\bUs\b/g, 'US');
const dateRange = (a, b) => {
  const fmt = (iso, withYear) => {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  };
  if (!a || a === b) return fmt(b ?? a, true);
  return `${fmt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmt(b, true)}`;
};
const ordinal = (n) => {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'];
  return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
};

function useUscf(id) {
  const [history, setHistory] = useState(null);
  const [standings, setStandings] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [loadingRounds, setLoadingRounds] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      const kept = nonce === 0 ? await cachedHistory(id) : null;
      if (!alive) return;
      if (kept) { setHistory(kept); setStatus('ready'); }
      if (kept && Date.now() - (kept.fetchedAt ?? 0) < STALE_MS) return;
      try {
        const fresh = await fetchHistory(id, { fresh: nonce > 0 });
        if (alive) { setHistory(fresh); setStatus('ready'); }
      } catch (err) {
        if (!alive) return;
        setError(err.message);
        if (!kept) setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [id, nonce]);

  // Every section's crosstable — the kept ones at once, the rest fetched.
  // Refresh asks again for any that failed.
  const [failed, setFailed] = useState([]);
  const stamp = (history?.sections ?? []).map((s) => `${s.key}=${JSON.stringify(s.records)}`).join(',');
  useEffect(() => {
    const sections = history?.sections ?? [];
    if (!sections.length) return undefined;
    let alive = true;
    setLoadingRounds(true);
    fetchStandings(id, sections, {
      onBatch: (partial) => { if (alive) setStandings(partial); },
      stop: () => !alive,
    })
      .then((r) => { if (alive) setFailed(r.failed); })
      .finally(() => { if (alive) setLoadingRounds(false); });
    return () => { alive = false; };
  }, [id, stamp, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    history, standings, status, error, loadingRounds, failed, refresh: () => setNonce((n) => n + 1),
  };
}

export default function PlayerDashboard({
  player, index, onOpenGame, onAnalyzeGame, onAddGame, onEditProfile, onRatings,
}) {
  const id = String(player.profile?.uscf ?? '').replace(/\D/g, '');
  if (!id) {
    return (
      <div className="dash-empty">
        <TargetIcon size={28} />
        <h3>Add a US Chess ID to see the rated history</h3>
        <p className="muted-note">
          Every rated tournament, the rating after each, and round-by-round results — with the games
          recorded here lined up against them.
        </p>
        <button className="primary" onClick={onEditProfile}><PencilIcon size={15} /> Add US Chess ID</button>
      </div>
    );
  }
  // Keyed by the ID: another player (or an edited ID) starts afresh, never
  // with the last one's record on screen.
  return (
    <Dashboard
      key={id}
      id={id}
      player={player}
      index={index}
      onOpenGame={onOpenGame}
      onAnalyzeGame={onAnalyzeGame}
      onAddGame={onAddGame}
      onRatings={onRatings}
    />
  );
}

function Dashboard({
  id, player, index, onOpenGame, onAnalyzeGame, onAddGame, onRatings,
}) {
  const { state, dispatch } = useStore();
  const {
    history, standings, status, error, loadingRounds, failed, refresh,
  } = useUscf(id);

  // Freshly fetched: the card's own rating line catches up too.
  const saved = player.profile?.ratings?.uscf;
  useEffect(() => {
    if (!history?.fetchedAt || !onRatings) return;
    if (saved?.fetchedAt && saved.fetchedAt >= history.fetchedAt) return;
    const summary = ratingSummary(history);
    const same = saved && ['regular', 'quick', 'blitz', 'regularOfficial', 'quickOfficial', 'blitzOfficial']
      .every((k) => (saved[k] ?? null) === (summary[k] ?? null));
    if (!same) onRatings(summary);
  }, [history?.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [system, setSystem] = useState(null);
  // An opponent being scouted ({ id, n }): `n` makes a second pick of the
  // same person a new request, so a fetch that failed can be tried again.
  const [scoutPick, setScoutPick] = useState(null);
  const pickScout = (oppId) => setScoutPick(oppId ? { id: oppId, n: Date.now() } : null);
  const [toEstimate, setToEstimate] = useState(null); // an opponent sent from scouting
  const [open, setOpen] = useState(null); // expanded section key
  const [showAll, setShowAll] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const where = useMemo(() => standing(history, today), [history, today]);
  const systems = Object.keys(where).filter((s) => ['R', 'Q', 'B', 'OR', 'OQ', 'OB'].includes(s));
  const sys = system && where[system] ? system : (systems.includes('R') ? 'R' : systems[0]);
  const series = useMemo(() => ratingSeries(history, sys), [history, sys]);
  const games = useMemo(() => ratedGames(history, standings), [history, standings]);
  const stats = useMemo(() => splits(games), [games]);
  const recent = useMemo(() => form(games), [games]);
  const best = useMemo(() => highlights(games), [games]);
  const rivals = useMemo(() => opponents(games).filter((o) => o.games > 1).slice(0, 5), [games]);
  const match = useMemo(() => matchGames(history, standings, player.games), [history, standings, player.games]);
  const gameById = useMemo(() => new Map(player.games.map((g) => [g.id, g])), [player.games]);
  const recordedSections = useMemo(() => new Set(Object.entries(match.rounds)
    .filter(([, r]) => r.state !== 'suggested')
    .map(([k]) => k.split(':').slice(0, 2).join(':'))), [match]);

  // The newest event opens by default, once its rounds are in.
  const newest = history?.sections?.[0]?.key ?? null;
  const expanded = open === null ? newest : open;

  if (status === 'loading' && !history) {
    return <div className="dash-loading"><span className="dash-spinner" /> Fetching the US Chess record for {id}…</div>;
  }
  if (status === 'error' && !history) {
    return (
      <div className="dash-empty">
        <AlertIcon size={24} />
        <h3>Couldn’t load US Chess ID {id}</h3>
        <p className="muted-note">{error}</p>
        <button onClick={refresh}>Try again</button>
      </div>
    );
  }

  const w = where[sys] ?? {};
  const sysName = SYSTEM_NAME[sys] ?? 'Rating';
  // Rated games so far, for the estimator: known while provisional (US
  // Chess counts them); established players are "26+", where the count
  // no longer matters below about 1900.
  const gamesIn = (x) => (x?.provisional && x.provisionalGames != null ? x.provisionalGames : null);
  const startGames = gamesIn(w);
  // Their own figures in one system, for scouting — which has to compare an
  // opponent's rating with theirs in the same system.
  const mine = (s) => {
    const x = where[s];
    const rating = x?.liveExact ?? x?.live ?? x?.official;
    if (rating == null) return null;
    return {
      rating, shown: x.live ?? x.official, games: gamesIn(x), floor: x.floor, online: s.startsWith('O'),
    };
  };
  const noEvents = !history.sections.length;
  const sections = history.sections;
  const shown = showAll ? sections : sections.slice(0, 6);
  const act = (gameId, meta) => dispatch({ type: 'updateGame', playerId: player.id, gameId, game: { meta } });
  // Who they were going into that event, for the details filled in.
  const asPlayed = (section) => ({
    name: player.name,
    rating: section.records[mainSystem(section)]?.pre ?? null,
    timeControl: standings[section.key]?.timeControl ?? null,
  });
  const confirm = (section, round, gameId) => {
    const g = gameById.get(gameId);
    if (g) act(gameId, confirmMeta(g, section, round, asPlayed(section)));
  };
  const refuse = (key, gameId) => {
    const g = gameById.get(gameId);
    if (g) act(gameId, refuseMeta(g, key));
  };
  const scout = (oppId) => {
    pickScout(oppId);
    requestAnimationFrame(() => document.getElementById('dash-scout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const unlink = (gameId) => {
    const g = gameById.get(gameId);
    if (g) act(gameId, unlinkMeta(g));
  };
  const spare = player.games.filter((g) => isCandidateGame(g) && !match.games[g.id]);
  const expiresSoon = history.expires && (Date.parse(history.expires) - Date.now()) < 60 * 86400000;
  const lapsed = !history.status || /^none$/i.test(history.status)
    || (history.expires && Date.parse(history.expires) < Date.now());
  const provisional = w.provisional && w.provisionalGames != null;

  // What a coach (or the player) should notice first.
  const notes = [];
  const loaded = sections.filter((x) => standings[x.key]).length;
  if (loadingRounds && loaded < sections.length) {
    notes.push({ kind: 'info', text: `Counting ${loaded} of ${sections.length} events so far — US Chess sends a long record a little at a time` });
  }
  if (match.played > match.recorded) notes.push({ kind: 'todo', text: `${match.played - match.recorded} rated game${match.played - match.recorded === 1 ? '' : 's'} with no game recorded here` });
  const trapCount = games.slice(-10).filter((g) => g.result === 'L' && g.gap != null && g.gap <= -100).length;
  if (trapCount >= 2) notes.push({ kind: 'warn', text: `${trapCount} of the last 10 games lost to players 100+ lower` });
  const lastSection = sections[0] && standings[sections[0].key] ? sectionSummary(sections[0], standings[sections[0].key]) : null;
  if (lastSection?.performance != null && w.live != null && lastSection.games >= 3) {
    notes.push({
      kind: lastSection.performance >= (sections[0].records[mainSystem(sections[0])]?.pre ?? w.live) ? 'good' : 'info',
      text: `Played about ${lastSection.performance} strength at ${eventTitle(sections[0].eventName)} (est.)`,
    });
  }
  if (recent.bounceBack && recent.bounceBack.of >= 3) {
    notes.push({ kind: 'info', text: `Won ${recent.bounceBack.wins} of ${recent.bounceBack.of} games after a loss` });
  }

  return (
    <div className="dash">
      {/* ---------- Where they stand ---------- */}
      <section className="dash-hero">
        <div className="dash-hero-top">
          <div>
            <div className="dash-eyebrow">US Chess</div>
            <h2 className="dash-name">{history.name ?? player.name}</h2>
            <div className="dash-chips">
              <a className="dash-chip" href={`https://ratings.uschess.org/player/${history.id}`} target="_blank" rel="noreferrer">ID {history.id}</a>
              {history.state && <span className="dash-chip">{history.state}</span>}
              <span className={`dash-chip${expiresSoon || lapsed ? ' warn' : ''}`}>
                {lapsed ? 'Membership lapsed' : history.status}
                {history.expires ? ` · ${lapsed ? 'expired' : 'until'} ${history.expires.slice(0, 7)}` : ''}
              </span>
              {history.rank != null && <span className="dash-chip">#{history.rank.toLocaleString()} in the US</span>}
              {history.stateRank != null && history.state && <span className="dash-chip">#{history.stateRank.toLocaleString()} in {history.state}</span>}
            </div>
          </div>
          <div className="dash-hero-actions">
            {systems.length > 1 && (
              <div className="dash-seg" role="tablist" aria-label="Rating system">
                {systems.map((s) => (
                  <button key={s} role="tab" aria-selected={s === sys} className={s === sys ? 'on' : ''} onClick={() => { setSystem(s); setToEstimate(null); }}>
                    {SYSTEM_NAME[s]}
                  </button>
                ))}
              </div>
            )}
            <button className="small ghost" onClick={refresh} title="Fetch the latest from US Chess">
              <ClockIcon size={14} /> {ratingAge(history.fetchedAt) ?? 'Refresh'}
            </button>
          </div>
        </div>

        <div className="dash-ratings">
          <div className="dash-rating live">
            <span className="dash-label">Live {sysName.toLowerCase()}</span>
            <span className="dash-big">{w.live ?? '—'}</span>
            {w.change != null && (
              <span className={`dash-delta ${w.change >= 0 ? 'up' : 'down'}`}>{signed(w.change)}</span>
            )}
            <span className="dash-sub">{w.liveEvent ? `after ${eventTitle(w.liveEvent)}` : 'no rated events yet'}</span>
          </div>
          <div className="dash-rating">
            <span className="dash-label">Official list</span>
            <span className="dash-mid">{w.official ?? '—'}</span>
            <span className="dash-sub">{w.official != null && w.live != null && w.official !== w.live ? 'the published figure — trails the latest event' : 'published rating'}</span>
          </div>
          {w.next != null && (
            <div className="dash-rating">
              <span className="dash-label">Next list · {w.nextDate?.slice(0, 7)}</span>
              <span className="dash-mid">{w.next}</span>
              <span className="dash-sub">already published</span>
            </div>
          )}
          <div className="dash-rating">
            <span className="dash-label">Peak</span>
            <span className="dash-mid">{w.peak ?? '—'}</span>
            <span className="dash-sub">{w.peakDate ?? ''}{w.floor ? ` · floor ${w.floor}` : ''}</span>
          </div>
        </div>
        {provisional && (
          <div className="dash-prov" title="A US Chess rating is provisional until 26 games have been rated">
            <span>Provisional — {w.provisionalGames} of 26 games rated</span>
            <span className="dash-prov-bar"><span style={{ width: `${Math.min(100, (w.provisionalGames / 26) * 100)}%` }} /></span>
          </div>
        )}
        {error && <div className="muted-note"><AlertIcon size={13} /> Showing the saved copy — {error}</div>}
      </section>

      {noEvents && (
        <div className="dash-empty">
          <h3>No rated games yet</h3>
          <p className="muted-note">The first rated tournament will show up here — the rating after it, and every round.</p>
        </div>
      )}

      {/* ---------- The rating over time ---------- */}
      {!noEvents && (
      <section className="dash-card">
        <header className="dash-head">
          <h3>{sysName} rating</h3>
          <span className="muted-note">{series.length} rated event{series.length === 1 ? '' : 's'} · ringed where games are recorded here</span>
        </header>
        <RatingChart
          series={series}
          marked={recordedSections}
          peak={w.peak}
          label={`${sysName} rating`}
          onPick={(key) => {
            setOpen(key);
            // An older event than the six listed: list them all.
            if (!shown.some((x) => x.key === key)) setShowAll(true);
            requestAnimationFrame(() => document.getElementById(`dash-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
        />
      </section>
      )}

      {/* ---------- At a glance ---------- */}
      {!noEvents && (
      <section className="dash-tiles">
        <div className="dash-tile">
          <span className="dash-label">Rated games</span>
          <span className="dash-mid">{stats.all.games}</span>
          <span className="dash-wdl"><b className="w">{stats.all.W}</b>–<b className="d">{stats.all.D}</b>–<b className="l">{stats.all.L}</b></span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Score</span>
          <span className="dash-mid">{pct(stats.all.pct)}</span>
          <span className="dash-sub">{stats.all.rated ? `${signed(Math.round((stats.all.ratedPoints - stats.all.expected) * 10) / 10)} vs expected` : ''}</span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Events</span>
          <span className="dash-mid">{sections.length}</span>
          <span className="dash-sub">{sections.length ? `since ${sections[sections.length - 1].start?.slice(0, 4)}` : ''}</span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Recorded here</span>
          <span className="dash-mid">{match.recorded}<small>/{match.played}</small></span>
          <span className="dash-meter"><span style={{ width: `${match.played ? (match.recorded / match.played) * 100 : 0}%` }} /></span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Form</span>
          <span className="dash-form">
            {recent.last.length ? recent.last.map((g, i) => <span key={i} className={`dash-dot ${g.result}`} title={`${RESULT_LABEL[g.result]} vs ${g.oppName}`} />) : <span className="muted-note">—</span>}
          </span>
          <span className="dash-sub">
            {recent.current ? `${recent.current.length} ${RUN_WORD[recent.current.result][recent.current.length > 1 ? 1 : 0]} in a row` : ''}
          </span>
        </div>
      </section>
      )}

      {notes.length > 0 && (
        <ul className="dash-notes">
          {notes.map((n, i) => <li key={i} className={n.kind}>{n.text}</li>)}
        </ul>
      )}

      {/* ---------- Tournaments, round by round ---------- */}
      {!noEvents && (
      <section className="dash-card">
        <header className="dash-head">
          <h3>Rated tournaments</h3>
          {loadingRounds && <span className="muted-note"><span className="dash-spinner small" /> loading rounds…</span>}
        </header>
        <div className="dash-events">
          {shown.map((s) => (
            <EventRow
              key={s.key}
              section={s}
              standing={standings[s.key]}
              match={match}
              gameById={gameById}
              spare={spare}
              open={expanded === s.key}
              onToggle={() => setOpen(expanded === s.key ? '' : s.key)}
              loading={loadingRounds}
              failed={failed.includes(s.key)}
              onRetry={refresh}
              onScout={scout}
              onOpenGame={onOpenGame}
              onAnalyzeGame={onAnalyzeGame}
              onAddGame={(sec, round) => onAddGame(sec, round, asPlayed(sec))}
              onConfirm={confirm}
              onRefuse={refuse}
              onUnlink={unlink}
              index={index}
              state={state}
            />
          ))}
        </div>
        {sections.length > 6 && (
          <button className="small ghost dash-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show the latest 6' : `Show all ${sections.length} events`}
          </button>
        )}
      </section>
      )}

      {/* ---------- Scouting, and what's at stake ---------- */}
      <div id="dash-scout">
        <ScoutBox
          scoutId={scoutPick?.id ?? null}
          scoutNonce={scoutPick?.n}
          onScout={pickScout}
          games={games}
          system={sys}
          mine={mine}
          myName={player.name}
          atStake={(oppRating, s) => {
            const me = mine(s);
            if (!me) return null;
            const base = {
              rating: me.rating, games: me.games, floor: me.floor, online: me.online,
            };
            const change = (score) => estimateRating({ ...base, results: [{ opp: oppRating, score }] })?.change ?? null;
            const W = change(1);
            return W == null ? null : { W, D: change(0.5), L: change(0) };
          }}
          onEstimate={(opp) => {
            setToEstimate({ ...opp, n: Date.now() });
            requestAnimationFrame(() => document.getElementById('dash-estimator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
        />
      </div>
      {(w.live ?? w.official) != null && (
        <div id="dash-estimator">
          <EstimatorBox
            key={sys}
            start={{ rating: w.liveExact ?? w.live ?? w.official, games: startGames, floor: w.floor }}
            sections={sections}
            standings={standings}
            incoming={toEstimate}
            onConsumed={() => setToEstimate(null)}
            system={sys}
          />
        </div>
      )}

      {/* ---------- Coaching splits ---------- */}
      {stats.all.games > 0 && (
        <section className="dash-grid">
          <div className="dash-card">
            <header className="dash-head"><h3>Against the field</h3><span className="muted-note">opponent vs their rating</span></header>
            <Splits rows={stats.byGap} empty="No rated opponents yet." />
            {stats.unrated.games > 0 && <p className="muted-note">Plus {stats.unrated.games} game{stats.unrated.games === 1 ? '' : 's'} against unrated players.</p>}
            {stats.beforeRated.games > 0 && <p className="muted-note">And {stats.beforeRated.games} from before they had a rating.</p>}
          </div>
          <div className="dash-card">
            <header className="dash-head"><h3>By colour</h3></header>
            <Splits rows={stats.byColor} />
            {stats.byTime.length > 1 && (
              <>
                <header className="dash-head sub"><h3>By time control</h3></header>
                <Splits rows={stats.byTime} />
              </>
            )}
          </div>
          <div className="dash-card">
            <header className="dash-head"><h3>Standout results</h3></header>
            <Highlight title="Biggest upsets" games={best.upsets} empty="No wins against higher-rated players yet." />
            <Highlight title="Costly losses" games={best.traps} empty="No losses to lower-rated players." />
            {rivals.length > 0 && (
              <>
                <div className="dash-subhead">Played most</div>
                <ul className="dash-list">
                  {rivals.map((o) => (
                    <li key={o.id}><span>{o.name}</span><span className="dash-wdl"><b className="w">{o.W}</b>–<b className="d">{o.D}</b>–<b className="l">{o.L}</b></span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      <OpeningsInRatedGames match={match} gameById={gameById} index={index} state={state} />

      {spare.length > 0 && (
        <section className="dash-card">
          <header className="dash-head">
            <h3>Recorded games not in a rated event</h3>
            <span className="muted-note">{spare.length} over-the-board game{spare.length === 1 ? '' : 's'}</span>
          </header>
          <ul className="dash-list spare">
            {spare.slice(0, 12).map((g) => {
              const newestEnd = sections[0]?.end;
              const d = g.meta?.date ?? (g.date ? new Date(g.date).toISOString().slice(0, 10) : null);
              const why = !g.meta?.date ? 'no date on it — open it to add the event details'
                : newestEnd && d > newestEnd ? 'played after the latest rated event — may be awaiting rating'
                  : 'an unrated or club game, or its details don’t match a round';
              return (
                <li key={g.id}>
                  <button className="link" onClick={() => onOpenGame(g.id)}>{g.name}</button>
                  <span className="muted-note">{d ?? ''} · {why}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Splits({ rows, empty }) {
  const any = rows.some((r) => r.games > 0);
  if (!any) return <p className="muted-note">{empty ?? '—'}</p>;
  return (
    <ul className="dash-splits">
      {rows.map((r) => (
        <li key={r.id} className={r.games ? '' : 'none'}>
          <span className="dash-split-label">{r.label}</span>
          <span className="dash-bar" aria-hidden="true">
            {r.games > 0 && (
              <>
                <span className="w" style={{ flex: r.W }} />
                <span className="d" style={{ flex: r.D }} />
                <span className="l" style={{ flex: r.L }} />
              </>
            )}
          </span>
          <span className="dash-split-num">{r.games ? `${pct(r.pct)} · ${r.W}–${r.D}–${r.L}` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function Highlight({ title, games, empty }) {
  return (
    <>
      <div className="dash-subhead">{title}</div>
      {games.length ? (
        <ul className="dash-list">
          {games.map((g) => (
            <li key={`${g.key}:${g.round}`}>
              <span>{g.oppName} <span className="muted-note">({g.oppPre})</span></span>
              <span className={`dash-gap ${g.gap > 0 ? 'up' : 'down'}`}>{signed(g.gap)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted-note">{empty}</p>}
    </>
  );
}

function EventRow({
  section, standing: st, match, gameById, spare, open, onToggle, onOpenGame, onAnalyzeGame, onAddGame,
  onConfirm, onRefuse, onUnlink, loading, failed, onRetry, onScout,
}) {
  const sys = mainSystem(section);
  const rec = section.records[sys] ?? {};
  const change = rec.pre != null && rec.post != null ? rec.post - rec.pre : null;
  const sum = st ? sectionSummary(section, st) : null;
  const rounds = st?.rounds ?? [];
  const played = rounds.filter((r) => PLAYED.has(r.result));
  const recorded = played.filter((r) => {
    const m = match.rounds[roundKey(section.key, r.round)];
    return m && m.state !== 'suggested';
  }).length;
  return (
    <div className={`dash-event${open ? ' open' : ''}`} id={`dash-sec-${section.key}`}>
      <button className="dash-event-head" onClick={onToggle} aria-expanded={open}>
        <span className="dash-event-date">{dateRange(section.start, section.end)}</span>
        <span className="dash-event-name">
          <strong>{eventTitle(section.eventName)}</strong>
          <span className="muted-note">
            {section.sectionName}
            {st?.timeControl ? ` · ${st.timeControl}` : ''}
            {st?.place ? ` · ${ordinal(st.place)} of ${st.field}` : ''}
          </span>
        </span>
        <span className="dash-chips-row" aria-label="Rounds">
          {rounds.length ? rounds.map((r) => {
            const m = match.rounds[roundKey(section.key, r.round)];
            return (
              <span
                key={r.round}
                className={`dash-rchip ${r.result}${m && m.state !== 'suggested' ? ' rec' : ''}`}
                title={`Round ${r.round}: ${RESULT_LABEL[r.result]}${r.oppName ? ` vs ${r.oppName}` : ''}${m && m.state !== 'suggested' ? ' — game recorded' : ''}`}
              >
                {CHIP[r.result]}
              </span>
            );
          }) : <span className="muted-note">{loading ? '…' : ''}</span>}
        </span>
        <span className="dash-event-score">
          {sum ? <>{sum.points}<small>/{rounds.length}</small></> : ''}
        </span>
        <span className="dash-event-rating">
          {rec.post ?? '—'}
          {change != null && <span className={`dash-delta small ${change >= 0 ? 'up' : 'down'}`}>{signed(change)}</span>}
        </span>
      </button>

      {open && (
        <div className="dash-event-body">
          {!st && (loading || !failed) ? (
            <p className="muted-note"><span className="dash-spinner small" /> Loading the rounds…</p>
          ) : !st ? (
            <p className="muted-note">
              <AlertIcon size={13} /> Couldn’t load the rounds from US Chess.{' '}
              <button className="small ghost" onClick={onRetry}>Try again</button>
            </p>
          ) : (
            <>
              <div className="dash-event-facts">
                {sum?.performance != null && <span>Performance <b>{sum.performance}</b> <small>est.</small></span>}
                {sum?.avgOpp != null && <span>Average opponent <b>{sum.avgOpp}</b></span>}
                {sum?.expected != null && <span>Expected <b>{Math.round(sum.expected * 10) / 10}</b> · scored <b>{sum.ratedPoints}</b> <small>vs rated opponents</small></span>}
                {played.length > 0 && <span>Recorded here <b>{recorded}/{played.length}</b></span>}
                <a href={`https://ratings.uschess.org/event/${section.eventId}?section=${section.section}`} target="_blank" rel="noreferrer">Crosstable on US Chess ↗</a>
              </div>
              <table className="dash-rounds">
                <thead>
                  <tr><th>Rd</th><th>Opponent</th><th>Result</th><th className="hide-narrow">Expected</th><th>Game</th></tr>
                </thead>
                <tbody>
                  {rounds.map((r) => (
                    <RoundRow
                      key={r.round}
                      section={section}
                      round={r}
                      myPre={rec.pre}
                      m={match.rounds[roundKey(section.key, r.round)]}
                      gameById={gameById}
                      spare={spare}
                      onOpenGame={onOpenGame}
                      onAnalyzeGame={onAnalyzeGame}
                      onAddGame={onAddGame}
                      onScout={onScout}
                      onConfirm={onConfirm}
                      onRefuse={onRefuse}
                      onUnlink={onUnlink}
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RoundRow({
  section, round: r, myPre, m, gameById, spare, onOpenGame, onAnalyzeGame, onAddGame, onConfirm, onRefuse, onUnlink, onScout,
}) {
  const key = roundKey(section.key, r.round);
  const played = PLAYED.has(r.result);
  const expected = played && myPre != null && r.oppPre != null
    ? 1 / (1 + 10 ** ((r.oppPre - myPre) / 400)) : null;
  const game = m ? gameById.get(m.gameId) : null;
  const [picking, setPicking] = useState(false);
  return (
    <tr className={played ? '' : 'quiet'}>
      <td className="dash-rd">{r.round}</td>
      <td>
        {r.oppName ? (
          <span className="dash-opp">
            <span className={`dash-side ${r.color ?? ''}`} title={r.color ? `Played ${r.color}` : ''} />
            {r.oppId && onScout
              ? <button type="button" className="link" title={`Scout ${r.oppName}`} onClick={() => onScout(r.oppId)}>{r.oppName}</button>
              : r.oppName}
            {r.oppPre != null && <span className="muted-note"> {r.oppPre}</span>}
          </span>
        ) : <span className="muted-note">{RESULT_LABEL[r.result]}</span>}
      </td>
      <td><span className={`dash-res ${r.result}`}>{r.oppName ? RESULT_LABEL[r.result] : ''}</span></td>
      <td className="hide-narrow">{expected != null ? pct(expected) : ''}</td>
      <td className="dash-game-cell">
        {!played ? null : game && m.state !== 'suggested' ? (
          <span className="dash-game">
            <button className="small" onClick={() => onOpenGame(game.id)} title={game.name}>
              <PlayIcon size={12} /> Open
            </button>
            {/* A photo not yet scanned has no moves to analyse (its Scan is on the Games tab). */}
            {onAnalyzeGame && game.moves?.length > 0 && (
              <button
                className="small"
                onClick={() => onAnalyzeGame(game.id)}
                title="Send this game to the analysis board — the engine, the explorer and your repertoire"
              >
                <MonitorIcon size={12} /> Send to analysis
              </button>
            )}
            {m.conflict
              ? <span className="dash-flag warn" title="The game’s colour or result disagrees with US Chess"><AlertIcon size={12} /> check result</span>
              : <span className="dash-flag ok"><CheckIcon size={12} /> {m.state === 'linked' ? 'linked' : 'matched'}</span>}
            <button
              className="small ghost"
              title="This isn’t the game"
              aria-label="This isn’t the game"
              onClick={() => (m.state === 'linked' ? onUnlink(game.id) : onRefuse(key, game.id))}
            >
              ✕
            </button>
          </span>
        ) : game ? (
          <span className="dash-game suggest">
            <span className="muted-note">Is it “{game.name}”?</span>
            <button className="small primary" onClick={() => onConfirm(section, r, game.id)}>Yes</button>
            <button className="small ghost" onClick={() => onRefuse(key, game.id)}>No</button>
          </span>
        ) : picking ? (
          <span className="dash-game">
            <select
              autoFocus
              defaultValue=""
              onChange={(e) => { if (e.target.value) onConfirm(section, r, e.target.value); setPicking(false); }}
              onBlur={() => setPicking(false)}
            >
              <option value="">Which game?</option>
              {spare.map((g) => <option key={g.id} value={g.id}>{g.name}{g.meta?.date ? ` · ${g.meta.date}` : ''}</option>)}
            </select>
          </span>
        ) : (
          <span className="dash-game missing">
            <span className="muted-note">not recorded</span>
            <button
              className="small ghost"
              title="Add this game — the event, round, colour, result and opponent filled in"
              onClick={() => onAddGame(section, r)}
            >
              + Add
            </button>
            {spare.length > 0 && <button className="small ghost" onClick={() => setPicking(true)}>Link…</button>}
          </span>
        )}
      </td>
    </tr>
  );
}

// What they played in their rated games, from the games recorded here.
function OpeningsInRatedGames({ match, gameById, index, state }) {
  const rows = useMemo(() => {
    const by = new Map();
    for (const m of Object.values(match.rounds)) {
      if (m.state === 'suggested') continue;
      const g = gameById.get(m.gameId);
      if (!g || !g.moves?.length) continue;
      const cat = categoryOf(g, index, state);
      const id = cat?.id ?? 'none';
      const row = by.get(id) ?? { id, label: cat?.label ?? 'Not filed', kind: cat?.kind, W: 0, D: 0, L: 0, games: 0 };
      const res = resultFor(g).kind;
      row.games += 1;
      if (res === 'win') row.W += 1; else if (res === 'draw') row.D += 1; else if (res === 'loss') row.L += 1;
      by.set(id, row);
    }
    return [...by.values()].sort((a, b) => b.games - a.games);
  }, [match, gameById, index, state]);
  if (!rows.length) return null;
  return (
    <section className="dash-card">
      <header className="dash-head">
        <h3>Openings in rated games</h3>
        <span className="muted-note">from the {rows.reduce((t, r) => t + r.games, 0)} rated games recorded here</span>
      </header>
      <ul className="dash-splits">
        {rows.map((r) => (
          <li key={r.id} className={r.kind === 'offbeat' ? 'offbeat' : ''}>
            <span className="dash-split-label">{r.label}</span>
            <span className="dash-bar" aria-hidden="true">
              <span className="w" style={{ flex: r.W }} /><span className="d" style={{ flex: r.D }} /><span className="l" style={{ flex: r.L }} />
            </span>
            <span className="dash-split-num">{r.games} · {r.W}–{r.D}–{r.L}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

