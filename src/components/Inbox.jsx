import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { cloudConfigured } from '../lib/cloud/config';
import { watchAuth } from '../lib/cloud/auth';
import {
  watchInbox, acceptDelivery, dismissDelivery, markRead, applyDelivery,
} from '../lib/cloud/share';
import { watchStudentLinks, endLink } from '../lib/cloud/links';
import { BellIcon, CheckIcon } from './Icons';

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

  const waiting = items.filter((d) => !d.acceptedAt && !d.dismissedAt);
  const seen = readSeen();
  const newLinks = links.filter((l) => !seen.has(l.id));
  const count = waiting.length + newLinks.length;

  const accept = async (delivery) => {
    setBusy(delivery.id);
    try {
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
                  Can see your real games, repertoire and ratings — read-only, until you end it.
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

            {items.length === 0 && links.length === 0 && (
              <p className="hint">
                Nothing yet. When a coach sends you an opening or a new line, it lands here.
              </p>
            )}
            {items.map((d) => (
              <div key={d.id} className={`inbox-item${d.acceptedAt ? ' done' : ''}`}>
                <div className="inbox-head">
                  <strong>{d.fromName || 'A coach'}</strong>
                  <span className="muted-note">{stamp(d.sentAt)}</span>
                </div>
                <div className="muted-note">{d.summary}</div>
                {d.message && <p className="inbox-message">“{d.message}”</p>}
                <div className="settings-row">
                  {d.acceptedAt ? (
                    <span className="practiced-pill">Added to your repertoire</span>
                  ) : (
                    <>
                      <button
                        className="primary"
                        disabled={busy === d.id}
                        onClick={() => accept(d)}
                      >
                        {busy === d.id ? 'Adding…' : 'Add to my repertoire'}
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
