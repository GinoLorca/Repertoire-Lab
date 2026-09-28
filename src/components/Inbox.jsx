import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { cloudConfigured } from '../lib/cloud/config';
import { watchAuth } from '../lib/cloud/auth';
import {
  watchInbox, acceptDelivery, dismissDelivery, markRead, applyDelivery,
} from '../lib/cloud/share';
import { watchStudentLinks, endLink } from '../lib/cloud/links';
import { BellIcon, CheckIcon } from './Icons';
import { useCloud } from '../lib/cloud/useCloud';
import { unseenStudentGames, gameSummary } from '../lib/cloud/gameLink';
import { openPlayerCard } from '../lib/openPlayer';
import { unseenReviews } from '../lib/cloud/reviews';
import { openReview } from './ReviewReader';

const stamp = (t) => {
  const ms = t?.toMillis ? t.toMillis() : t;
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
};

// A link is live the instant a coach opens it — there's nothing to approve,
// so the only thing worth flagging here is one this device hasn't shown
// yet. Purely local: it doesn't gate access, it just stops the bell nagging
// about a coach the student has already seen.
const SEEN_KEY = 'repertoire-lab-seen-links';
const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
};
const markSeen = (ids) => {
  try {
    const seen = readSeen();
    ids.forEach((id) => seen.add(id));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* private browsing, storage full — not worth failing over */ }
};

// The bell, and what's behind it. Anything a coach has sent, or a new coach
// link opened on this account, shows up here without the student doing
// anything — no file to find, no import to run, and nothing to approve.
export default function Inbox() {
  const { state, dispatch } = useStore();
  const cloud = useCloud();
  const [uid, setUid] = useState(null);
  const [items, setItems] = useState([]);
  const [links, setLinks] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let stop = () => {};
    watchAuth((u) => setUid(u?.uid ?? null)).then((fn) => { stop = fn; });
    return () => stop();
  }, []);

  useEffect(() => {
    if (!uid) { setItems([]); setLinks([]); return undefined; }
    let stopInbox = () => {};
    let stopLinks = () => {};
    watchInbox(uid, setItems).then((fn) => { stopInbox = fn; });
    watchStudentLinks(uid, setLinks).then((fn) => { stopLinks = fn; });
    return () => { stopInbox(); stopLinks(); };
  }, [uid]);

  if (!cloudConfigured || !uid) return null;

  // A game from a coach this account is linked to is applied on its own, by
  // the sync — it doesn't wait here to be clicked, and it doesn't ring the
  // bell. A game from anyone else does wait: it's a stranger offering to put
  // something in this account, and that's the student's call.
  const activeCoaches = new Set(links.filter((l) => l.status === 'active').map((l) => l.coachUid));
  // A coach's review (v2) is never offered for accepting: it's applied from a
  // linked coach, and one from anyone else is simply not shown.
  const shown = items.filter((d) => !(d.kind === 'game' && (activeCoaches.has(d.fromUid) || d.v === 2)));
  // A game counts as taken only when the student took it here — see
  // eligibleGameDelivery: the sender can write acceptedAt themselves.
  const taken = (d) => (d.kind === 'game' ? cloud.isGameConsented(d.id) : Boolean(d.acceptedAt));
  const waiting = shown.filter((d) => !taken(d) && !d.dismissedAt);
  // The coach's side of the bell: games linked students added since the coach
  // last opened their card.
  const studentGames = unseenStudentGames(state?.players);
  // The student's side: a coach's review of one of their games, or new notes
  // on a game a coach typed in for them — until they read it.
  const reviews = unseenReviews(state?.players);
  const seen = readSeen();
  const newLinks = links.filter((l) => !seen.has(l.id));
  const count = waiting.length + newLinks.length + studentGames.length + reviews.length;

  const accept = async (delivery) => {
    setBusy(delivery.id);
    try {
      // A game is applied by the sync, the same careful way a linked coach's
      // is (see gameLink.js) — accepting just says yes to it.
      if (delivery.kind === 'game') {
        cloud.acceptGameDelivery(delivery.id);
        return;
      }
      // Merged with the same rules as everything else: the student's own
      // progress on lines they already had is never rolled back.
      dispatch({ type: 'hydrate', state: applyDelivery(state, delivery) });
      await acceptDelivery(delivery.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        className={`nav-icon${count ? ' has-unread' : ''}`}
        title={count ? `${count} waiting` : 'Nothing new'}
        aria-label={count ? `Inbox, ${count} waiting` : 'Inbox'}
        onClick={() => {
          setOpen((o) => !o);
          waiting.filter((d) => !d.readAt).forEach((d) => markRead(d.id).catch(() => {}));
          if (links.length) markSeen(links.map((l) => l.id));
        }}
      >
        <BellIcon size={17} />
        {count > 0 && <span className="unread-dot">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div className="viewer-overlay" onClick={() => setOpen(false)}>
          <div className="modal inbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-head"><h2>Sent to you</h2></div>

            {links.map((l) => (
              <div key={l.id} className={`inbox-item${seen.has(l.id) ? ' done' : ' unread'}`}>
                <div className="inbox-head">
                  <strong>{l.coachName || 'A coach'}</strong>
                  <span className="practiced-pill"><CheckIcon size={12} /> Linked</span>
                </div>
                <div className="muted-note">
                  Can see your games, repertoire and ratings, and can add games to your Games — marked
                  “Added by …”. Can't change anything you've edited, or delete anything. Until you end it.
                </div>
                <div className="settings-row">
                  <button
                    className="small ghost"
                    disabled={busy === l.id}
                    onClick={async () => {
                      if (!window.confirm(`Stop letting ${l.coachName || 'this coach'} see your account?`)) return;
                      setBusy(l.id);
                      try { await endLink(l.id); } finally { setBusy(null); }
                    }}
                  >
                    End link
                  </button>
                </div>
              </div>
            ))}

            {studentGames.map(({ card, game, at }) => (
              <div key={game.id} className="inbox-item unread">
                <div className="inbox-head">
                  <strong>{card.name}</strong>
                  <span className="muted-note">added a game · {new Date(at).toLocaleDateString()}</span>
                </div>
                <div className="muted-note">{gameSummary(game)} · {game.moves.length} moves</div>
                <div className="settings-row">
                  <button className="primary small" onClick={() => { setOpen(false); openPlayerCard(card); }}>
                    Open
                  </button>
                  <button
                    className="small ghost"
                    onClick={() => dispatch({ type: 'markLinkedGamesSeen', cardId: card.id })}
                  >
                    Mark seen
                  </button>
                </div>
              </div>
            ))}

            {reviews.map((r) => (
              <div key={`${r.gameId}:${r.coachUid}`} className="inbox-item unread">
                <div className="inbox-head">
                  <strong>{r.by || 'Your coach'}</strong>
                  <span className="muted-note">
                    {r.kind === 'own' ? 'added notes to' : 'reviewed'} your game · {new Date(r.at).toLocaleDateString()}
                  </span>
                </div>
                <div className="muted-note">{r.name}</div>
                <div className="settings-row">
                  <button
                    className="primary small"
                    onClick={() => { setOpen(false); openReview({ gameId: r.gameId, coachUid: r.coachUid }); }}
                  >
                    Read
                  </button>
                  <button
                    className="small ghost"
                    onClick={() => dispatch({
                      type: 'markReviewSeen', gameId: r.gameId, coachUid: r.coachUid, rev: r.rev,
                    })}
                  >
                    Mark seen
                  </button>
                </div>
              </div>
            ))}

            {shown.length === 0 && links.length === 0 && studentGames.length === 0 && reviews.length === 0 && (
              <p className="hint">
                Nothing yet. When a coach sends you an opening or a new line, it lands here.
              </p>
            )}
            {shown.map((d) => (
              <div key={d.id} className={`inbox-item${taken(d) ? ' done' : ''}`}>
                <div className="inbox-head">
                  <strong>{d.fromName || 'A coach'}</strong>
                  <span className="muted-note">{stamp(d.sentAt)}</span>
                </div>
                <div className="muted-note">{d.summary}</div>
                {d.message && <p className="inbox-message">“{d.message}”</p>}
                <div className="settings-row">
                  {taken(d) ? (
                    <span className="practiced-pill">
                      {d.kind === 'game' ? 'Adding to your Games…' : 'Added to your repertoire'}
                    </span>
                  ) : (
                    <>
                      <button
                        className="primary"
                        disabled={busy === d.id}
                        onClick={() => accept(d)}
                      >
                        {busy === d.id ? 'Adding…' : (d.kind === 'game' ? 'Add to my Games' : 'Add to my repertoire')}
                      </button>
                      <button className="small ghost" onClick={() => dismissDelivery(d.id)}>
                        Not now
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
