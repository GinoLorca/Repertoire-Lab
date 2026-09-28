import React, { useEffect, useMemo, useRef, useState } from 'react';
import { estimateRating, establishedFloor, absoluteFloor } from '../lib/uscfEstimate';
import { PLAYED } from '../lib/uscfHistory';
import { tidyName } from '../lib/uscf';

// "What if": the rating an event would leave them on, by US Chess's own
// formula (lib/uscfEstimate.js) — for the tournament coming up, or checked
// against one already rated, to see how close the estimate runs.
//
// `start`: { rating, games, floor } going in (the live figure by default).
// `sections`/`standings`: the history, so a rated event can be loaded.
// `incoming`: an opponent sent over from scouting ({ name, rating, system, n }),
// handed back through `onConsumed` once it's in the list.

const signed = (n) => (n == null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`);
const SCORE = { W: 1, D: 0.5, L: 0 };
let seq = 0;
const row = (rating = '', result = 'W', name = '') => ({ id: (seq += 1), rating: String(rating ?? ''), result, name });
const eventTitle = (name) => tidyName(name).replace(/\bNy\b/g, 'NY');
const str = (v) => (v != null ? String(v) : '');

// The floor in force going into an event already rated — not today's, which
// only ever rises: 200 under the best established rating before it (from 1200
// up), or else the absolute floor the wins, draws and 3-game events before it
// had built (counted from the crosstables loaded).
function floorBefore(section, sections, standings, sys) {
  const earlier = sections.filter((x) => x.end && section.end && x.end < section.end && x.records[sys]?.post != null);
  const established = earlier
    .filter((x) => !(x.records[sys].provisionalGames > 0 && x.records[sys].provisionalGames < 26))
    .map((x) => x.records[sys].post);
  const level = establishedFloor(established.length ? Math.max(...established) : null);
  if (level != null) return level;
  let wins = 0; let draws = 0; let events = 0;
  for (const x of earlier) {
    const st = standings[x.key];
    if (!st || st.system !== sys || st.online) continue;
    const played = st.rounds.filter((r) => PLAYED.has(r.result));
    wins += played.filter((r) => r.result === 'W').length;
    draws += played.filter((r) => r.result === 'D').length;
    if (played.length >= 3) events += 1;
  }
  return absoluteFloor({ wins, draws, events });
}

export default function EstimatorBox({
  start, sections, standings, incoming, onConsumed, system,
}) {
  const [rating, setRating] = useState(str(start.rating));
  const [games, setGames] = useState(str(start.games));
  const [floor, setFloor] = useState(str(start.floor));
  const [rows, setRows] = useState(() => [row()]);
  const [loaded, setLoaded] = useState(null); // a rated event loaded to check against
  // Once the rating, games or floor are typed over (or an event is loaded),
  // they're the user's; until then they follow the record as it refreshes —
  // the kept copy shows first, and a fresh one can land a moment later.
  const own = useRef(false);
  useEffect(() => {
    if (own.current) return;
    setRating(str(start.rating));
    setGames(str(start.games));
    setFloor(str(start.floor));
  }, [start.rating, start.games, start.floor]);
  const reset = () => {
    own.current = false;
    setRating(str(start.rating));
    setGames(str(start.games));
    setFloor(str(start.floor));
    setRows([row()]);
    setLoaded(null);
  };

  // An opponent from scouting joins the list (replacing an empty first row) —
  // once, and only if their rating is in this estimator's system.
  useEffect(() => {
    if (!incoming) return;
    onConsumed?.();
    if (incoming.system && incoming.system !== system) return;
    setLoaded(null);
    setRows((rs) => {
      const blank = rs.length === 1 && !rs[0].rating;
      const next = row(incoming.rating, 'W', incoming.name);
      return blank ? [next] : [...rs, next];
    });
  }, [incoming?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const num = (v) => (String(v).trim() === '' ? null : Number(v));
  const estimate = useMemo(() => estimateRating({
    rating: num(rating),
    games: num(games),
    floor: num(floor),
    // Online systems have no over-the-board floor credit.
    online: loaded ? Boolean(loaded.online) : String(system ?? '').startsWith('O'),
    // The Regular side of a dual-rated event moves more slowly above 2200.
    dualRegular: Boolean(loaded?.dualRegular),
    results: rows.filter((r) => String(r.rating).trim() !== '' || r.unrated)
      .map((r) => ({ opp: r.unrated ? null : num(r.rating), score: SCORE[r.result], id: r.oppId ?? null })),
  }), [rating, games, floor, rows, loaded, system]);

  const loadEvent = (key) => {
    const s = sections.find((x) => x.key === key);
    const st = standings[key];
    if (!s || !st) return;
    const sys = st.system;
    const rec = s.records[sys] ?? {};
    const played = st.rounds.filter((r) => PLAYED.has(r.result));
    own.current = true;
    setRating(String(rec.preExact ?? rec.pre ?? ''));
    // Games before the event, where US Chess says (a provisional count).
    setGames(rec.provisionalGames != null ? String(Math.max(0, rec.provisionalGames - played.length)) : '');
    setFloor(st.online ? '' : String(floorBefore(s, sections, standings, sys)));
    // The opponents' ratings after the event: US Chess rates in passes, and
    // the second pass measures each player against the opponents' first-pass
    // results — the after-event figures are the nearest thing to those.
    setRows(played.map((r) => {
      const opp = r.oppPostExact ?? r.oppPost ?? r.oppPreExact ?? r.oppPre;
      return { ...row(opp ?? '', r.result, r.oppName ?? ''), oppId: r.oppId, unrated: opp == null };
    }));
    setLoaded({
      key,
      name: eventTitle(s.eventName),
      pre: rec.pre,
      post: rec.post,
      online: st.online,
      dualRegular: s.system === 'D' && sys === 'R',
    });
  };

  const update = (id, patch) => { setLoaded(null); setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); };
  // Only events rated in this estimator's system: a dual-rated event's
  // crosstable is read on its Regular side, so it checks the Regular rating.
  const want = system ?? 'R';
  const checkable = sections.filter((s) => standings[s.key]?.system === want && s.records[want]);

  return (
    <section className="dash-card estimator">
      <header className="dash-head">
        <h3>Rating estimator</h3>
        <span className="muted-note">US Chess’s formula — an estimate; the real one can differ by a point or two</span>
      </header>

      <div className="est-inputs">
        <label>Rating going in<input type="number" inputMode="numeric" value={rating} onChange={(e) => { own.current = true; setLoaded(null); setRating(e.target.value); }} /></label>
        <label>Rated games so far<input type="number" inputMode="numeric" placeholder="26+" value={games} onChange={(e) => { own.current = true; setLoaded(null); setGames(e.target.value); }} /></label>
        <label>Floor<input type="number" inputMode="numeric" placeholder="100" value={floor} onChange={(e) => { own.current = true; setFloor(e.target.value); }} /></label>
        {checkable.length > 0 && (
          <label className="grow">
            Check against a rated event
            <select value={loaded?.key ?? ''} onChange={(e) => e.target.value && loadEvent(e.target.value)}>
              <option value="">Pick one…</option>
              {checkable.map((s) => <option key={s.key} value={s.key}>{s.end} · {eventTitle(s.eventName)}</option>)}
            </select>
          </label>
        )}
      </div>

      <ul className="est-rows">
        {rows.map((r, i) => (
          <li key={r.id}>
            <span className="est-n">{i + 1}</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder={r.unrated ? 'unrated' : 'Opponent rating'}
              aria-label={`Opponent ${i + 1} rating`}
              value={r.unrated ? '' : r.rating}
              disabled={r.unrated}
              onChange={(e) => update(r.id, { rating: e.target.value })}
            />
            <span className="est-seg" role="group" aria-label={`Result against opponent ${i + 1}`}>
              {['W', 'D', 'L'].map((x) => (
                <button key={x} type="button" className={`${x}${r.result === x ? ' on' : ''}`} onClick={() => update(r.id, { result: x })}>{x}</button>
              ))}
            </span>
            {r.name && <span className="muted-note est-name">{r.name}</span>}
            <button type="button" className="small ghost" aria-label="Remove" onClick={() => { setLoaded(null); setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : [row()])); }}>✕</button>
          </li>
        ))}
      </ul>
      <div className="est-actions">
        <button type="button" className="small ghost" onClick={() => { setLoaded(null); setRows((rs) => [...rs, row()]); }}>+ Add an opponent</button>
        <button type="button" className="small ghost" onClick={reset} title="Back to the rating, games and floor they have now, with no opponents">Start over</button>
      </div>

      <div className="est-result">
        {estimate?.post != null ? (
          <>
            <div>
              <span className="dash-label">Estimated rating</span>
              <span className="dash-big">{estimate.post}</span>
              {estimate.change != null
                ? <span className={`dash-delta ${estimate.change >= 0 ? 'up' : 'down'}`}>{signed(estimate.change)}</span>
                : <span className="dash-sub">first rating</span>}
            </div>
            <ul className="est-facts">
              <li>Score <b>{estimate.score}</b> of {estimate.games}{estimate.expected != null && <> · expected <b>{Math.round(estimate.expected * 10) / 10}</b></>}</li>
              {estimate.performance != null && <li>Performance <b>{estimate.performance}</b></li>}
              <li>{estimate.method === 'special' ? 'Provisional formula' : 'Standard formula'}{estimate.K != null && <> · K <b>{Math.round(estimate.K * 10) / 10}</b></>}{estimate.bonus ? <> · bonus <b>+{Math.round(estimate.bonus * 10) / 10}</b></> : null}</li>
              {estimate.floored && <li>Held up by the rating floor ({Math.round(estimate.floor)})</li>}
              {estimate.skipped > 0 && <li className="muted-note">{estimate.skipped} game{estimate.skipped === 1 ? '' : 's'} against unrated opponents left out (US Chess rates them first)</li>}
            </ul>
            {loaded && loaded.post != null && (
              <p className="est-check">
                US Chess gave <b>{loaded.post}</b> after {loaded.name} — the estimate is {estimate.post === loaded.post
                  ? 'spot on'
                  : `${Math.abs(estimate.post - loaded.post)} point${Math.abs(estimate.post - loaded.post) === 1 ? '' : 's'} ${estimate.post > loaded.post ? 'high' : 'low'}`}
                {' '}<span className="muted-note">(worked from the opponents’ ratings after the event — US Chess rates everyone in two passes)</span>
              </p>
            )}
          </>
        ) : (
          <p className="muted-note">{estimate?.message ?? 'Enter a rating going in and at least one opponent.'}</p>
        )}
      </div>
      {system && system !== 'R' && <p className="muted-note">Figures are for the {system === 'Q' ? 'quick' : system === 'B' ? 'blitz' : 'selected'} rating.</p>}
    </section>
  );
}
