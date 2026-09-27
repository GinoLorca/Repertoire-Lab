import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useStore } from '../store';
import { useMe } from '../lib/cloud/useMe';
import { watchCoachLinks, watchLinkedPlayers, watchCoachLedger } from '../lib/cloud/links';
import { sendGamePatch, withdrawGameDeliveries } from '../lib/cloud/share';
import {
  buildPatch, needsSend, nextRev, patchHash, ph, gameLinkStatus, gameSummary,
} from '../lib/cloud/gameLink';

// The coach's half of games shared with linked students. Headless, mounted
// once for the whole app (inside CloudProvider), so it works on every screen
// — not only while a student's page happens to be open.
//
// Two jobs:
//   · keep a live view of each linked student's own games and fold them into
//     the coach's card for that student (the student → coach direction)
//   · send the coach's additions and corrections to the student's account,
//     as patches through the deliveries mailbox (coach → student)
//
// The rules for both live in lib/cloud/gameLink.js, and are tested there.
// This file only wires them to Firestore and to the store.

const GameLinkContext = createContext(null);

// A pause after the last edit before sending, so typing out a scoresheet
// goes as one patch rather than forty.
const SEND_AFTER_MS = 2000;

export function GameLinkProvider({ children }) {
  const { state, dispatch } = useStore();
  const me = useMe();
  const [links, setLinks] = useState([]);
  // Per student: 'live' | 'no-access' (the link ended, or rules refuse),
  // plus the games too big to fit on the card and the latest ledger.
  const [cards, setCards] = useState({});
  const [inFlight, setInFlight] = useState(() => new Set());
  const [failed, setFailed] = useState({}); // gameId → message
  const [paused, setPaused] = useState(null); // a reason, once a send is refused
  const ledgers = useRef({}); // studentUid → ledger, for the next revision number

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!me?.uid) { setLinks([]); return undefined; }
    let stop = () => {};
    watchCoachLinks(me.uid, setLinks).then((fn) => { stop = fn; });
    return () => stop();
  }, [me?.uid]);

  const activeStudents = useMemo(
    () => new Set(links.filter((l) => l.status === 'active').map((l) => l.studentUid)),
    [links],
  );

  // One card per linked student — the first, if there are ever two.
  const linkedCards = useMemo(() => {
    const seen = new Set();
    return (state?.players ?? []).filter((p) => {
      const S = p.kind === 'student' ? p.profile?.linkedUid : null;
      if (!S || seen.has(S)) return false;
      seen.add(S);
      return true;
    });
  }, [state?.players]);
  const cardKey = linkedCards.map((p) => `${p.id}:${p.profile.linkedUid}`).join('|');
  const primaryCard = useMemo(
    () => new Map(linkedCards.map((p) => [p.profile.linkedUid, p.id])),
    [linkedCards],
  );

  // Student → coach: a live listener per linked student.
  useEffect(() => {
    if (!me?.uid) return undefined;
    const stops = [];
    for (const card of linkedCards) {
      const S = card.profile.linkedUid;
      if (!activeStudents.has(S)) continue;
      let ledger = { games: {} };
      let latest = null;
      const fold = () => {
        if (!latest) return;
        dispatch({
          type: 'mergeLinkedGames',
          cardId: card.id,
          input: {
            studentUid: S, coachUid: me.uid, games: latest.games, complete: latest.complete, ledger, now: Date.now(),
          },
        });
      };
      watchCoachLedger(S, (l) => {
        ledger = l?.games ? l : { games: {} };
        ledgers.current[S] = ledger;
        fold();
      }).then((fn) => stops.push(fn));
      watchLinkedPlayers(S, (snap) => {
        latest = snap;
        setCards((c) => ({ ...c, [S]: { ...(c[S] ?? {}), state: 'live' } }));
        fold();
      }, (err) => {
        // The student ended the link, or the rules in Firebase refuse this
        // read. Nothing is removed from the card either way.
        setCards((c) => ({ ...c, [S]: { ...(c[S] ?? {}), state: 'no-access', error: err?.code } }));
      }).then((fn) => stops.push(fn));
    }
    return () => stops.forEach((fn) => fn());
    // cardKey stands in for linkedCards: re-subscribe when the set of linked
    // cards changes, not every time a game on one of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.uid, cardKey, activeStudents, dispatch]);

  // Coach → student: send whatever's pending, a moment after it settles.
  const sendPending = useCallback(async () => {
    if (!me?.uid || paused) return;
    for (const card of linkedCards) {
      const S = card.profile.linkedUid;
      const linkActive = activeStudents.has(S);
      const live = stateRef.current.players.find((p) => p.id === card.id);
      for (const g of live?.games ?? []) {
        // A game tied to some other account — this card was linked to
        // someone else before — never goes to this one.
        if (g.link?.uid !== S) continue;
        if (!needsSend(g, { linkActive })) continue;
        const { patch } = buildPatch(g);
        const deliveryKey = `${g.id}:${patchHash(patch)}`;
        if (inFlight.has(deliveryKey)) continue;
        const ledgerRev = ledgers.current[S]?.games?.[g.id]?.r ?? 0;
        const rev = nextRev(Date.now(), g.link.sent?.rev ?? 0, ledgerRev);
        setInFlight((s) => new Set(s).add(deliveryKey));
        // Not awaited by anything on screen: offline, this resolves only
        // once there's signal again, and the game shows as queued until then.
        sendGamePatch({
          to: { uid: S, name: card.name },
          from: me,
          gameId: g.id,
          rev,
          resend: Boolean(g.link.resend),
          patch,
          summary: gameSummary(g),
        }).then(() => {
          const h = Object.fromEntries(Object.entries(patch.set).map(([p, v]) => [p, ph(v)]));
          dispatch({
            type: 'markLinkSent', cardId: card.id, gameId: g.id, sent: { rev, ph: patchHash(patch), h },
          });
          setFailed((f) => { const n = { ...f }; delete n[g.id]; return n; });
        }).catch((err) => {
          setFailed((f) => ({ ...f, [g.id]: err.message }));
          // A refusal from the rules will refuse the next one too; stop
          // until the coach presses Retry, instead of hammering it.
          if (/rules/.test(err.message)) setPaused(err.message);
        }).finally(() => {
          setInFlight((s) => { const n = new Set(s); n.delete(deliveryKey); return n; });
        });
      }
    }
  }, [me, paused, linkedCards, activeStudents, inFlight, dispatch]);

  const sendRef = useRef(sendPending);
  sendRef.current = sendPending;

  useEffect(() => {
    if (!me?.uid || linkedCards.length === 0) return undefined;
    const t = setTimeout(() => sendRef.current(), SEND_AFTER_MS);
    return () => clearTimeout(t);
  }, [state?.players, me?.uid, linkedCards.length, activeStudents]);

  // Leaving the app, or coming back online, sends right away rather than
  // waiting out the pause.
  useEffect(() => {
    const now = () => sendRef.current();
    const onHide = () => { if (document.visibilityState === 'hidden') now(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', now);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', now);
    };
  }, []);

  const retry = useCallback((gameId) => {
    setPaused(null);
    setFailed((f) => { const n = { ...f }; if (gameId) delete n[gameId]; else return {}; return n; });
    setTimeout(() => sendRef.current(), 0);
  }, []);

  // A linked game removed from the coach's card: anything of it not yet
  // picked up is withdrawn, so it never arrives.
  const withdraw = useCallback((gameId) => {
    if (me?.uid) withdrawGameDeliveries(me.uid, gameId).catch(() => {});
  }, [me?.uid]);

  const value = useMemo(() => ({
    me,
    links,
    cards,
    inFlight,
    failed,
    paused,
    retry,
    withdraw,
    isLinkActive: (studentUid) => activeStudents.has(studentUid),
    statusOf: (card, game) => {
      const S = card?.profile?.linkedUid;
      if (!S) return null;
      // Two cards linked to the same student: only the first one is kept in
      // step with their account, and this says so rather than leaving games
      // here "queued" forever.
      if (primaryCard.get(S) !== card.id) return 'duplicate-card';
      if (game.link && game.link.uid !== S) return 'only-card';
      const sending = [...inFlight].some((k) => k.startsWith(`${game.id}:`));
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return gameLinkStatus(game, {
        linkActive: activeStudents.has(S),
        // Offline, a send is only queued: Firestore holds it until there's
        // signal, and "Sending…" for an hour would be a lie.
        inFlight: sending && !offline,
        failed: failed[game.id],
      });
    },
    primaryCardFor: (S) => primaryCard.get(S) ?? null,
  }), [me, links, cards, inFlight, failed, paused, retry, withdraw, activeStudents, primaryCard]);

  return <GameLinkContext.Provider value={value}>{children}</GameLinkContext.Provider>;
}

const OFF = {
  me: null,
  links: [],
  cards: {},
  inFlight: new Set(),
  failed: {},
  paused: null,
  retry: () => {},
  withdraw: () => {},
  isLinkActive: () => false,
  statusOf: () => null,
  primaryCardFor: () => null,
};

export function useGameLink() {
  return useContext(GameLinkContext) ?? OFF;
}
