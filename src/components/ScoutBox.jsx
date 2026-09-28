import React, { useEffect, useMemo, useRef, useState } from 'react';
import RatingChart from './RatingChart';
import { searchMembers, historyFor } from '../lib/uscfClient';
import {
  SYSTEM_NAME, standing, ratingSeries, validMemberId,
} from '../lib/uscfHistory';
import { expectedScore } from '../lib/uscfStats';
import { tidyName } from '../lib/uscf';
import { SearchIcon } from './Icons';

// Scouting an opponent: who they are on US Chess, where their rating is
// going, what they've played lately — and, against the player whose
// dashboard this is, their history together and what a game between them
// would be expected to bring.
//
// `games`: the dashboard player's rated games (lib/uscfStats ratedGames), for
// the head-to-head — worked out from crosstables already loaded, no extra
// requests. `mine(system)`: the player's own figures in a system ({ shown, … }
// or null). `atStake(oppRating, system)`: the rating change a win, draw or loss
// would bring ({ W, D, L } or null), from the estimator. `scoutNonce` changes
// with every pick, so picking the same person again (after a failed fetch,
// say) asks again.

const signed = (n) => (n == null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`);
const eventTitle = (name) => tidyName(name).replace(/\bNy\b/g, 'NY');

export default function ScoutBox({
  scoutId, scoutNonce, onScout, games, system, mine, myName, atStake, onEstimate,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [them, setThem] = useState(null);
  const [loading, setLoading] = useState(false);
  const pick = useRef(scoutNonce);
  pick.current = scoutNonce;

  // Someone picked (typed in, chosen from a search, or clicked in a round).
  useEffect(() => {
    if (!scoutId) { setThem(null); return undefined; }
    let alive = true;
    setLoading(true);
    setError(null);
    historyFor(scoutId)
      .then((h) => { if (alive) setThem(h); })
      .catch((err) => { if (alive) { setThem(null); setError(err.message); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scoutId, scoutNonce]);

  const find = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    setError(null);
    if (!q) return;
    if (validMemberId(q.replace(/\s/g, ''))) { setResults(null); onScout(q.replace(/\s/g, '')); return; }
    setSearching(true);
    setResults(null);
    const before = pick.current;
    try {
      const found = await searchMembers(q);
      setResults(found);
      // One match opens it — unless someone else was picked while this ran.
      if (found.length === 1 && pick.current === before) onScout(found[0].id);
    } catch (err) {
      setError(err.message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const where = useMemo(() => (them ? standing(them) : {}), [them]);
  const sys = where[system] ? system : (where.R ? 'R' : Object.keys(where)[0]);
  const w = where[sys] ?? {};
  const series = useMemo(() => (them ? ratingSeries(them, sys) : []), [them, sys]);
  const recent = (them?.sections ?? []).slice(0, 5);
  const together = useMemo(
    () => (scoutId ? (games ?? []).filter((g) => g.oppId === scoutId).reverse() : []),
    [games, scoutId],
  );
  const tally = together.reduce((t, g) => ({ ...t, [g.result]: (t[g.result] ?? 0) + 1 }), {});
  const theirRating = w.live ?? w.official ?? null;
  // Like with like: their rating against the player's in the same system.
  const me = sys ? mine?.(sys) : null;
  const expected = me && theirRating != null ? expectedScore(me.shown, theirRating) : null;
  const stake = me && theirRating != null ? atStake?.(theirRating, sys) : null;

  return (
    <section className="dash-card scout">
      <header className="dash-head">
        <h3>Scout an opponent</h3>
        <span className="muted-note">by US Chess ID or name — or tap an opponent in a round</span>
      </header>
      <form className="scout-form" onSubmit={find}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 16416245 or Elliott Crawford"
          aria-label="US Chess ID or name"
        />
        <button type="submit" disabled={searching || !query.trim()}>
          <SearchIcon size={14} /> {searching ? 'Looking…' : 'Find'}
        </button>
      </form>
      {error && <p className="muted-note scout-error">{error}</p>}
      {results && results.length !== 1 && (
        results.length === 0 ? <p className="muted-note">No US Chess member by that name.</p> : (
          <ul className="scout-results">
            {results.map((m) => (
              <li key={m.id}>
                <button type="button" className={m.id === scoutId ? 'on' : ''} onClick={() => onScout(m.id)}>
                  <strong>{m.name}</strong>
                  <span className="muted-note">
                    {m.state ?? ''} · {['R', 'Q', 'B'].filter((s) => m.ratings[s] != null).map((s) => `${s} ${m.ratings[s]}`).join(' · ') || 'unrated'} · ID {m.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {loading && <p className="muted-note"><span className="dash-spinner small" /> Fetching their record…</p>}
      {them && !loading && (
        <div className="scout-card">
          <div className="scout-top">
            <div>
              <div className="scout-name">{them.name}</div>
              <div className="dash-chips">
                <a className="dash-chip" href={`https://ratings.uschess.org/player/${them.id}`} target="_blank" rel="noreferrer">ID {them.id}</a>
                {them.state && <span className="dash-chip">{them.state}</span>}
                {them.rank != null && <span className="dash-chip">#{them.rank.toLocaleString()} in the US</span>}
              </div>
            </div>
            <div className="scout-rating">
              <span className="dash-label">{SYSTEM_NAME[sys] ?? 'Rating'}</span>
              <span className="dash-mid">{theirRating ?? '—'}</span>
              <span className="dash-sub">
                {w.change != null ? <>{signed(w.change)} last event · </> : null}peak {w.peak ?? '—'}
              </span>
            </div>
          </div>

          {series.length > 1 && <RatingChart series={series} peak={w.peak} height={150} label={`${them.name}'s rating`} />}

          <div className="scout-grid">
            <div>
              <div className="dash-subhead">Against {myName}</div>
              {together.length ? (
                <>
                  <p className="scout-h2h">
                    <b className="w">{tally.W ?? 0}</b>–<b className="d">{tally.D ?? 0}</b>–<b className="l">{tally.L ?? 0}</b>
                    <span className="muted-note"> in {together.length} rated game{together.length === 1 ? '' : 's'}</span>
                  </p>
                  <ul className="dash-list">
                    {together.slice(0, 5).map((g) => (
                      <li key={`${g.key}:${g.round}`}>
                        <span>{eventTitle(g.eventName)} <span className="muted-note">R{g.round} · {g.date}</span></span>
                        <span className={`dash-res ${g.result}`}>{g.result === 'W' ? 'Won' : g.result === 'L' ? 'Lost' : 'Drew'}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="muted-note">They haven’t met in a rated game (in the events loaded).</p>}
              {expected != null && (
                <div className="scout-next">
                  <div className="dash-subhead">A game now</div>
                  <p>
                    {myName} expected to score <b>{Math.round(expected * 100)}%</b>
                    <span className="muted-note"> ({me.shown} vs {theirRating}{sys !== system ? `, ${SYSTEM_NAME[sys] ?? sys} ratings` : ''})</span>
                  </p>
                  {stake && (
                    <p className="scout-stake">
                      <span>Win <b className="w">{signed(stake.W)}</b></span>
                      <span>Draw <b className="d">{signed(stake.D)}</b></span>
                      <span>Loss <b className="l">{signed(stake.L)}</b></span>
                      <span className="muted-note">est.</span>
                    </p>
                  )}
                  {onEstimate && sys === system && (
                    <button className="small ghost" type="button" onClick={() => onEstimate({ name: them.name, rating: theirRating, system: sys })}>
                      Add to the estimator
                    </button>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="dash-subhead">Lately</div>
              {recent.length ? (
                <ul className="dash-list">
                  {recent.map((s) => {
                    const r = s.records[sys] ?? Object.values(s.records)[0] ?? {};
                    const change = r.pre != null && r.post != null ? r.post - r.pre : null;
                    return (
                      <li key={s.key}>
                        <span>{eventTitle(s.eventName)} <span className="muted-note">{s.end}</span></span>
                        <span className={`dash-gap ${(change ?? 0) >= 0 ? 'up' : 'down'}`}>{r.post ?? '—'} {change != null ? signed(change) : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted-note">No rated events.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
