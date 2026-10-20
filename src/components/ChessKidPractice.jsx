import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fetchIcn } from '../lib/ratings';
import {
  DEFAULT_GOAL, accuracy, icnStale, schoolName, tone, weekByWeek,
} from '../lib/icn';
import { cardHasRoom } from '../lib/cloud/reviews';
import { bytesOf } from '../lib/cloud/gameLink';
import { AlertIcon, CheckIcon, ClockIcon, PencilIcon } from './Icons';

// A student's ChessKid practice — puzzles, PLW, lessons and workouts — from
// their school's ICN stats page (lib/icn.js), on their Coaches Corner page:
//
//   ChessKidPractice  the section at the top of their Dashboard
//   IcnChip           puzzle accuracy on their card in the list
//   useIcnRefresh     keeps the numbers on linked cards no more than a few
//                     hours old; the latest are saved on the card, so every
//                     device has them, offline too
//
// The card's link is profile.icn = { school, name, goal? } (set in the
// player editor); the numbers, profile.icnStats.

const linkOf = (card) => (card?.profile?.icn?.school && card.profile.icn.name ? card.profile.icn : null);
export const goalOf = (card) => card?.profile?.icn?.goal ?? DEFAULT_GOAL;

// Cards being asked about right now, so the list and a student's page open
// together ask once.
const asking = new Map();
function refreshCard(card, playersRef, dispatch) {
  const link = linkOf(card);
  if (!link) return Promise.resolve(null);
  if (asking.has(card.id)) return asking.get(card.id);
  const job = fetchIcn(link.school, link.name)
    .then((stats) => {
      const now = playersRef.current.find((p) => p.id === card.id);
      if (!now || linkOf(now)?.school !== link.school) return stats; // relinked meanwhile
      // Kept on the card only while it has room in the cloud; the page still
      // shows them.
      const grow = bytesOf(stats) - bytesOf(now.profile?.icnStats ?? null);
      if (grow <= 0 || cardHasRoom(now, grow)) {
        dispatch({ type: 'updatePlayer', playerId: card.id, profile: { icnStats: stats } });
      }
      return stats;
    })
    .finally(() => asking.delete(card.id));
  asking.set(card.id, job);
  return job;
}

// Linked cards whose numbers are a few hours old get the latest, quietly.
export function useIcnRefresh(players) {
  const { dispatch } = useStore();
  const playersRef = useRef(players);
  playersRef.current = players;
  const due = players.filter((p) => linkOf(p) && icnStale(p.profile?.icnStats)).map((p) => p.id).join(',');
  useEffect(() => {
    if (!due) return;
    for (const p of playersRef.current) {
      if (due.split(',').includes(p.id)) refreshCard(p, playersRef, dispatch).catch(() => { /* the page says why */ });
    }
  }, [due, dispatch]);
}

const pctText = (x) => (x == null ? '—' : `${Math.round(x)}%`);
const TONE_LABEL = { good: 'At goal', near: 'Close to goal', low: 'Below goal' };

// "2026-10-18 23:00" (ICN's own clock) as "Oct 18, 11 PM".
function icnWhen(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return m[4] ? `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })}` : day;
}

// The Monday this week started on, as 'YYYY-MM-DD' — to tell this week's row.
function thisMonday(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const weekLabel = (start) => {
  if (start === thisMonday()) return 'This week so far';
  const [y, m, d] = start.split('-').map(Number);
  return `Week of ${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};

function StatusIcon({ t, size = 14 }) {
  return t === 'good' ? <CheckIcon size={size} /> : <AlertIcon size={size} />;
}

// Puzzle accuracy on a card in the list, coloured by how it sits against
// the student's goal — with an icon and words, never the colour alone.
export function IcnChip({ card }) {
  const s = card?.profile?.icnStats;
  if (!linkOf(card) || !s) return null;
  const acc = accuracy(s.correct, s.attempted);
  if (acc == null) return null;
  const goal = goalOf(card);
  const t = tone(acc, goal);
  return (
    <span
      className={`icn-chip ${t}`}
      title={`ChessKid puzzles: ${s.correct} of ${s.attempted} correct — ${TONE_LABEL[t].toLowerCase()} (${goal}%) · ICN ${schoolName(s.school)}`}
    >
      <StatusIcon t={t} size={12} /> Puzzles {pctText(acc)}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="icn-tile">
      <span className="icn-tile-label">{label}</span>
      <span className="icn-tile-value">{value ?? '—'}</span>
      {sub && <span className="icn-tile-sub">{sub}</span>}
    </div>
  );
}

export default function ChessKidPractice({ player, onEditProfile }) {
  const { state, dispatch } = useStore();
  const playersRef = useRef(state.players);
  playersRef.current = state.players;
  const link = linkOf(player);
  const saved = player.profile?.icnStats ?? null;
  // A card too full to keep them still shows what was just read.
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const stats = fresh && (!saved || fresh.fetchedAt > saved.fetchedAt) ? fresh : saved;

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setFresh(await refreshCard(player, playersRef, dispatch));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const linkKey = link ? `${link.school}|${link.name}` : '';
  useEffect(() => {
    setFresh(null);
    if (link && icnStale(player.profile?.icnStats)) refresh();
  }, [linkKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!link) {
    if (player.profile?.icnOff) return null;
    return (
      <div className="icn-invite">
        <span>
          <strong>ChessKid practice</strong>
          <span className="muted-note"> — link {player.name}’s ICN stats page to follow their puzzles, PLW, lessons and workouts.</span>
        </span>
        {onEditProfile && <button type="button" className="small" onClick={onEditProfile}><PencilIcon size={13} /> Link</button>}
        <button
          type="button"
          className="small ghost"
          title="Not at an ICN school — don’t ask again (the profile can still link one)"
          aria-label="Not at an ICN school"
          onClick={() => dispatch({ type: 'updatePlayer', playerId: player.id, profile: { icnOff: true } })}
        >
          ✕
        </button>
      </div>
    );
  }

  const goal = goalOf(player);
  const acc = stats ? accuracy(stats.correct, stats.attempted) : null;
  const t = tone(acc, goal);
  const weeks = stats ? weekByWeek(stats.weeks) : [];
  const updated = icnWhen(stats?.icnUpdated);

  return (
    <section className="dash-card icn-practice" aria-label="ChessKid practice">
      <div className="dash-head icn-head">
        <h3>ChessKid practice</h3>
        <span className="muted-note">
          {schoolName(link.school)} · ICN{stats?.grade ? ` · ${stats.grade} grade` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="small ghost"
          disabled={busy}
          title="Read the latest from ICN (the Chess Club Tracker reads it each morning)"
          onClick={refresh}
        >
          <ClockIcon size={14} /> {busy ? 'Reading…' : (updated ? `ICN ${updated}` : 'Refresh')}
        </button>
        {onEditProfile && (
          <button type="button" className="small ghost" title="Change the school, name or goal" aria-label="Edit the ICN link" onClick={onEditProfile}>
            <PencilIcon size={14} />
          </button>
        )}
      </div>
      {error && (
        <p className="icn-error"><AlertIcon size={13} /> {error}{stats ? ' Showing the last numbers read.' : ''}</p>
      )}
      {!stats && !error && <p className="muted-note">Reading {link.name}’s numbers from ICN…</p>}
      {stats && (
        <>
          <div className="icn-hero">
            <div className="icn-hero-top">
              <div className="icn-hero-fig">
                <span className="icn-hero-num">{pctText(acc)}</span>
                <span className="icn-hero-label">Puzzle accuracy this season</span>
              </div>
              {t && (
                <span className={`icn-status ${t}`}>
                  <StatusIcon t={t} /> {TONE_LABEL[t]} · {goal}%
                </span>
              )}
            </div>
            <div
              className={`icn-meter ${t ?? ''}`}
              role="meter"
              aria-label="Puzzle accuracy"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={acc ?? 0}
              aria-valuetext={`${pctText(acc)}, goal ${goal}%`}
              title={`${stats.correct} of ${stats.attempted} correct — goal ${goal}%`}
            >
              <span className="icn-meter-fill" style={{ width: `${Math.min(100, acc ?? 0)}%` }} />
              <span className="icn-meter-goal" style={{ left: `${goal}%` }}>
                <span className="icn-meter-goal-label">Goal {goal}%</span>
              </span>
            </div>
            <p className="icn-hero-note">
              {stats.correct ?? 0} of {stats.attempted ?? 0} puzzles correct
              {acc != null && acc < goal && goal < 100 && stats.attempted
                ? ` — ${Math.max(0, Math.ceil(((goal / 100) * stats.attempted - stats.correct) / (1 - goal / 100)))} right in a row would reach ${goal}%`
                : ''}
            </p>
          </div>

          <div className="icn-tiles">
            <Tile label="PLW this week" value={stats.plw} sub={stats.plwYtd != null ? `${stats.plwYtd} this season` : null} />
            <Tile label="Lessons" value={stats.lessons} sub="last 7 days" />
            <Tile label="Workouts" value={stats.workouts} sub="last 7 days" />
            <Tile label="ChessKid rating" value={stats.rating} sub={stats.level || null} />
          </div>

          {weeks.length > 0 && (
            <div className="icn-weeks-wrap">
              <table className="icn-weeks">
                <caption>Week by week</caption>
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col">Puzzles</th>
                    <th scope="col">Accuracy</th>
                    <th scope="col">PLW</th>
                    <th scope="col">Lessons</th>
                    <th scope="col">Workouts</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const wt = tone(w.accuracy, goal);
                    return (
                      <tr key={w.week}>
                        <th scope="row">{weekLabel(w.start)}</th>
                        <td>{w.attempted ? `${w.correct} of ${w.attempted}` : 'none'}</td>
                        <td className={wt ? `icn-acc ${wt}` : ''}>
                          {w.accuracy == null ? '—' : <><StatusIcon t={wt} size={12} /> {pctText(w.accuracy)}</>}
                        </td>
                        <td>{w.plw ?? '—'}</td>
                        <td>{w.lessons ?? '—'}</td>
                        <td>{w.workouts ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted-note icn-weeks-note">Lessons and workouts are ICN’s last-7-days counts as of each week’s latest reading.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
