import React, { useEffect, useRef, useState } from 'react';
import { useBackGuard } from '../lib/backGuard';
import { fetchUscf, fetchChesscom, fetchLichess, ratingAge } from '../lib/ratings';
import { AlertIcon, CheckIcon, PencilIcon } from './Icons';
import { uid } from '../store';
import { defaultMonsterId } from '../lib/monsters';
import Avatar from './Avatar';
import AvatarPicker from './AvatarPicker';

const EMPTY = { uscf: '', fide: '', chesscom: '', lichess: '', rating: '' };

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
        setState({ status: 'error', message: err.message });
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
export default function PlayerEditor({ initial, onSave, onClose }) {
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

  // A US Chess record knows their name and FIDE-style regular rating — fill the
  // blanks in for them, never overwrite something typed by hand.
  useEffect(() => {
    if (uscf.status !== 'done' || !uscf.data) return;
    setProfile((p) => ({
      ...p,
      rating: p.rating || (uscf.data.regular ? String(uscf.data.regular) : p.rating),
    }));
  }, [uscf.status, uscf.data]);

  const live = {
    ...(uscf.status === 'done' && uscf.data ? { uscf: uscf.data } : {}),
    ...(chesscom.status === 'done' && chesscom.data ? { chesscom: chesscom.data } : {}),
    ...(lichess.status === 'done' && lichess.data ? { lichess: lichess.data } : {}),
  };
  const save = () => onSave(name.trim(), { ...profile, ratings: live }, avatar, id);

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
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
            Name
            <input
              type="text"
              autoFocus
              value={name}
              placeholder='e.g. "My games" or "Alex Rivera"'
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save(); }}
            />
          </label>
          <label>
            Rating
            <input type="text" inputMode="numeric" value={profile.rating} placeholder="e.g. 1850" onChange={set('rating')} />
          </label>
          <label className="wide">
            US Chess ID
            <input type="text" inputMode="numeric" value={profile.uscf} placeholder="8 digits" onChange={set('uscf')} />
            <LiveLine
              state={uscf}
              render={(d) => `${d.name ?? 'member'} — ${nums([['reg', d.regular], ['quick', d.quick], ['blitz', d.blitz]]) || 'unrated'}`}
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
