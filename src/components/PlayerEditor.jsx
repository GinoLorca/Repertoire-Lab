import React, { useEffect, useRef, useState } from 'react';
import { useBackGuard } from '../lib/backGuard';
import {
  fetchUscf, fetchChesscom, fetchLichess, fetchIcn, findIcn, ratingAge,
} from '../lib/ratings';
import {
  ICN_SCHOOLS, DEFAULT_GOAL, accuracy, schoolName,
} from '../lib/icn';
import { AlertIcon, CheckIcon, PencilIcon, SearchIcon } from './Icons';
import { uid } from '../store';
import { defaultMonsterId } from '../lib/monsters';
import Avatar from './Avatar';
import AvatarPicker from './AvatarPicker';

const EMPTY = {
  uscf: '', fide: '', chesscom: '', lichess: '', rating: '', accountName: '', school: '',
};

// Look a rating up as soon as an ID or handle is typed, then keep it. `ready`
// says the value is worth a lookup at all; the wait lets you finish typing.
function useLookup(value, ready, fetcher, saved) {
  const [state, setState] = useState(saved ? { status: 'done', data: saved } : { status: 'idle' });
  const asked = useRef(null);

  useEffect(() => {
    if (!ready) { setState({ status: 'idle' }); return undefined; }
    if (asked.current === value) return undefined;
    const timer = setTimeout(async () => {
      asked.current = value;
      setState({ status: 'loading' });
      try {
        setState({ status: 'done', data: await fetcher(value) });
      } catch (err) {
        setState({ status: 'error', message: err.message, suggestions: err.suggestions ?? [] });
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready]);

  return state;
}

function LiveLine({ state, render }) {
  if (state.status === 'loading') return <span className="live-rating loading">looking up…</span>;
  if (state.status === 'error') {
    return <span className="live-rating bad"><AlertIcon size={12} /> {state.message}</span>;
  }
  if (state.status !== 'done' || !state.data) return null;
  return (
    <span className="live-rating good">
      <CheckIcon size={12} /> {render(state.data)}
      <span className="muted-note"> · {ratingAge(state.data.fetchedAt)}</span>
    </span>
  );
}

const nums = (pairs) => pairs.filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');

// Who a section belongs to: their name plus the handles and IDs their games
// turn up under, so imported games can be matched to them later.
export default function PlayerEditor({
  initial, onSave, onClose, kind = initial?.kind ?? 'self',
}) {
  const isStudent = kind === 'student';
  const [name, setName] = useState(initial?.name ?? '');
  const [profile, setProfile] = useState({ ...EMPTY, ...(initial?.profile ?? {}) });
  const set = (key) => (e) => setProfile((p) => ({ ...p, [key]: e.target.value }));
  // A brand-new player needs an id up front so its avatar (picked now, saved
  // on submit) is seeded from the id it'll actually end up with.
  const [id] = useState(() => initial?.id ?? uid());
  const [avatar, setAvatar] = useState(initial?.avatar ?? { kind: 'monster', variant: defaultMonsterId(id) });
  const [pickingAvatar, setPickingAvatar] = useState(false);
  useBackGuard(true, onClose);

  const saved = profile.ratings ?? {};
  const uscfId = profile.uscf.replace(/\D/g, '');
  const uscf = useLookup(uscfId, uscfId.length >= 6, fetchUscf, saved.uscf);
  const chesscom = useLookup(profile.chesscom.trim(), !!profile.chesscom.trim(), fetchChesscom, saved.chesscom);
  const lichess = useLookup(profile.lichess.trim(), !!profile.lichess.trim(), fetchLichess, saved.lichess);

  // A student's ChessKid practice, from their school's ICN stats page
  // (lib/icn.js): the school, and their name as the page has it — the card's
  // own name until one is typed.
  const icn = profile.icn ?? {};
  const setIcn = (patch) => setProfile((p) => ({ ...p, icn: { ...(p.icn ?? {}), ...patch } }));
  const icnWho = String(icn.name || name).trim();
  const icnKey = icn.school && icnWho ? `${icn.school}|${icnWho}` : '';
  const wasIcn = initial?.profile?.icn;
  const icnSame = Boolean(wasIcn?.school) && icnKey === `${wasIcn.school}|${String(wasIcn.name ?? '').trim()}`;
  const icnLook = useLookup(
    icnKey,
    isStudent && Boolean(icnKey),
    (k) => { const [school, ...rest] = k.split('|'); return fetchIcn(school, rest.join('|')); },
    icnSame ? profile.icnStats : null,
  );
  const [finding, setFinding] = useState(null); // { status, matches }
  const findOnIcn = async () => {
    setFinding({ status: 'loading', matches: [] });
    try {
      const matches = await findIcn(name);
      if (matches.length === 1) setIcn({ school: matches[0].school, name: matches[0].name });
      setFinding({ status: 'done', matches });
    } catch (err) {
      setFinding({ status: 'error', message: err.message, matches: [] });
    }
  };

  // A US Chess record knows their name and FIDE-style regular rating — fill the
  // blanks in for them, never overwrite something typed by hand.
  useEffect(() => {
    if (uscf.status !== 'done' || !uscf.data) return;
    setProfile((p) => ({
      ...p,
      rating: p.rating || (uscf.data.regular ? String(uscf.data.regular) : p.rating),
    }));
    // A student with no name typed yet gets the one on their US Chess card,
    // without the middle name.
    const fromCard = uscf.data.shortName ?? uscf.data.name;
    if (isStudent && fromCard) setName((n) => n || fromCard);
  }, [uscf.status, uscf.data]);

  const live = {
    ...(uscf.status === 'done' && uscf.data ? { uscf: uscf.data } : {}),
    ...(chesscom.status === 'done' && chesscom.data ? { chesscom: chesscom.data } : {}),
    ...(lichess.status === 'done' && lichess.data ? { lichess: lichess.data } : {}),
  };
  // A lookup still running (or failed) when Save is pressed keeps the
  // rating already saved for that site — as long as its ID didn't change.
  const was = initial?.profile ?? {};
  const same = (key, now) => now && now === String(was[key] ?? '').trim();
  const kept = {
    ...(saved.uscf && uscfId && uscfId === String(was.uscf ?? '').replace(/\D/g, '') ? { uscf: saved.uscf } : {}),
    ...(saved.chesscom && same('chesscom', profile.chesscom.trim()) ? { chesscom: saved.chesscom } : {}),
    ...(saved.lichess && same('lichess', profile.lichess.trim()) ? { lichess: saved.lichess } : {}),
  };
  // Saved under the name as ICN spells it, once found, so it's found again.
  const icnFound = icnLook.status === 'done' && icnLook.data;
  const goal = Number(icn.goal);
  const icnSaved = isStudent && icn.school ? {
    icn: {
      school: icn.school,
      name: icnFound ? icnLook.data.name : icnWho,
      ...(goal >= 1 && goal <= 100 ? { goal: Math.round(goal) } : {}),
    },
    icnStats: icnFound ? icnLook.data : (icnSame ? profile.icnStats ?? null : null),
  } : { icn: null, icnStats: null };
  const save = () => onSave(name.trim(), {
    ...profile, school: (profile.school ?? '').trim(), ratings: { ...kept, ...live }, ...icnSaved,
  }, avatar, id);

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal player-editor" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? 'Edit player' : 'New player section'}</h3>
        <p className="hint">
          One section per person — yourself, then each student. The IDs are optional; they let a game
          be tied to the right player when you paste a PGN, and ratings are looked up as you type.
        </p>

        <button
          type="button"
          className="avatar-pick-btn"
          title="Change avatar"
          onClick={() => setPickingAvatar(true)}
        >
          <Avatar avatar={avatar} seed={id} size={68} />
          <span className="avatar-pick-badge"><PencilIcon size={12} /></span>
        </button>

        <div className="game-fields">
          <label>
            {isStudent ? 'Real name' : 'Name'}
            <input
              type="text"
              autoFocus
              value={name}
              placeholder={isStudent ? 'e.g. Alex Rivera' : 'e.g. "My games" or "Alex Rivera"'}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }}
            />
          </label>
          {/* Their Repertoire Lab account name, alongside the real one: the
              card shows the real name, and this is what links it to their
              own app. Fixed once linked — the link is to that account. */}
          {isStudent && (
            <label>
              Account name
              <input
                type="text"
                value={profile.accountName ?? ''}
                placeholder="their Repertoire Lab account name"
                disabled={Boolean(profile.linkedUid)}
                title={profile.linkedUid ? 'Linked to this account' : ''}
                onChange={set('accountName')}
              />
            </label>
          )}
          {/* Where they go to school — and play on its chess team. Shown on
              their card and at the top of their page. */}
          {isStudent && (
            <label className="wide">
              School
              <input
                type="text"
                value={profile.school ?? ''}
                maxLength={120}
                placeholder="the school they attend and play on the chess team for"
                onChange={set('school')}
              />
            </label>
          )}
          <label>
            Rating
            <input type="text" inputMode="numeric" value={profile.rating} placeholder="e.g. 1850" onChange={set('rating')} />
          </label>
          <label className="wide">
            US Chess ID
            <input type="text" inputMode="numeric" value={profile.uscf} placeholder="8 digits" onChange={set('uscf')} />
            <LiveLine
              state={uscf}
              render={(d) => {
                const now = nums([['reg', d.regular], ['quick', d.quick], ['blitz', d.blitz]]) || 'unrated';
                // Live: after their latest rated event, which the official
                // list catches up with later.
                const after = d.lastEvent?.name ? ` · after ${d.lastEvent.name}` : '';
                const official = d.regularOfficial ? ` (official ${d.regularOfficial})` : '';
                return `${d.name ?? 'member'} — ${now}${official}${after}`;
              }}
            />
          </label>
          <label>
            FIDE ID
            <input type="text" inputMode="numeric" value={profile.fide} placeholder="optional" onChange={set('fide')} />
          </label>
          <label className="wide">
            Chess.com
            <input type="text" value={profile.chesscom} placeholder="username" onChange={set('chesscom')} />
            <LiveLine
              state={chesscom}
              render={(d) => nums([['rapid', d.rapid], ['blitz', d.blitz], ['bullet', d.bullet]]) || 'no rated games'}
            />
          </label>
          <label className="wide">
            Lichess
            <input type="text" value={profile.lichess} placeholder="username" onChange={set('lichess')} />
            <LiveLine
              state={lichess}
              render={(d) => nums([['rapid', d.rapid], ['blitz', d.blitz], ['bullet', d.bullet]]) || 'no rated games'}
            />
          </label>
          {isStudent && (
            <div className="wide icn-link">
              <span className="icn-link-title">ChessKid practice <span className="muted-note">— their school’s ICN stats page</span></span>
              <div className="icn-link-row">
                <select
                  value={icn.school ?? ''}
                  aria-label="ICN school"
                  onChange={(e) => { setIcn({ school: e.target.value }); setFinding(null); }}
                >
                  <option value="">Not on an ICN page</option>
                  {ICN_SCHOOLS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {icn.school ? (
                  <input
                    type="text"
                    value={icn.name ?? ''}
                    placeholder={name.trim() || 'their name as ICN lists it'}
                    aria-label="Name on the ICN page"
                    onChange={(e) => setIcn({ name: e.target.value })}
                  />
                ) : (
                  <button type="button" className="small" disabled={!name.trim() || finding?.status === 'loading'} onClick={findOnIcn}>
                    <SearchIcon size={14} /> {finding?.status === 'loading' ? 'Looking…' : 'Find on ICN'}
                  </button>
                )}
                {icn.school && (
                  <label className="icn-goal">
                    Goal
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={icn.goal ?? ''}
                      placeholder={String(DEFAULT_GOAL)}
                      aria-label="Puzzle accuracy goal, percent"
                      onChange={(e) => setIcn({ goal: e.target.value.replace(/\D/g, '') })}
                    />
                    %
                  </label>
                )}
              </div>
              {!icn.school && finding?.status === 'done' && (
                finding.matches.length === 0
                  ? <span className="live-rating bad"><AlertIcon size={12} /> No “{name.trim()}” on any ICN school page — pick the school and type the name as ICN has it.</span>
                  : finding.matches.length > 1 && (
                    <span className="icn-picks">
                      {finding.matches.map((m) => (
                        <button key={`${m.school}|${m.name}`} type="button" className="small ghost" onClick={() => setIcn({ school: m.school, name: m.name })}>
                          {m.name} · {schoolName(m.school)}{m.grade ? ` · ${m.grade}` : ''}
                        </button>
                      ))}
                    </span>
                  )
              )}
              {finding?.status === 'error' && <span className="live-rating bad"><AlertIcon size={12} /> {finding.message}</span>}
              {icn.school && icnLook.status === 'error' && icnLook.suggestions?.length > 0 && (
                <span className="icn-picks">
                  <span className="muted-note">Did you mean</span>
                  {icnLook.suggestions.map((n) => (
                    <button key={n} type="button" className="small ghost" onClick={() => setIcn({ name: n })}>{n}</button>
                  ))}
                </span>
              )}
              {icn.school && (
                <LiveLine
                  state={icnLook}
                  render={(d) => `${d.name}${d.grade ? ` · ${d.grade}` : ''} — puzzles ${d.correct ?? 0} of ${d.attempted ?? 0}${accuracy(d.correct, d.attempted) != null ? ` (${Math.round(accuracy(d.correct, d.attempted))}%)` : ''} · PLW ${d.plw ?? 0} this week`}
                />
              )}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={save}>
            {initial ? 'Save changes' : 'Create section'}
          </button>
        </div>
      </div>
    </div>
    {pickingAvatar && (
      <AvatarPicker
        current={avatar}
        onPick={setAvatar}
        onClose={() => setPickingAvatar(false)}
      />
    )}
    </>
  );
}
