// A player's CLAMP, Tactics, Openings and Positions — the player page's tabs
// from Chess Arcade.
//
// Chess Arcade's own Game History tabs (public/arcade, scripts/sync-arcade.mjs),
// over this player's games. CLAMP and Tactics: what was marked in Game Review —
// CLAMP letters on moves, tactics found or missed — counted, by letter and by
// tactic, by phase, colour and speed, with every marked move as a board; they
// read the analysis each game already has (lib/gameReviewBridge insightGames).
// Openings: every game with moves, sorted by the openings it's based on —
// picked for this player, White and Black, from any library — handed to Chess
// Arcade straight (lib/openingsBasis). Positions: the same games and the same
// repertoire, by the pawn structures they reach (with each structure's own
// page) and by a position set up on a board — with a copy of Chess Arcade that
// has it (lib/positionsTab). A game or a moment opens in Game Review, at that
// move; a chapter opens in the Library. Like every Chess Arcade tab here, it
// wears Repertoire Lab's theme (lib/arcadeLook).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ARCADE_REVIEW_URL } from '../lib/arcadeBuild';
import { insightGames } from '../lib/gameReviewBridge';
import {
  basisFor, arcadeRepertoire, openingsGames, basisSummary,
} from '../lib/openingsBasis';
import { useArcadeLook, onArcadeArrows } from '../lib/arcadeLook';
import { useBackGuard } from '../lib/backGuard';
import {
  askFind, takeFind, keepPlace, takePlace, TAB_NAMES,
} from '../lib/positionsTab';
import OpeningsBasisPicker from './OpeningsBasisPicker';

// fill: the player page is full screen — the frame takes the room under the
// tabs and scrolls what it shows itself (styles.css, .pi-wrap.fill), instead
// of standing as tall as its page inside one that scrolls.
// onFindGames: "Find games with…" on a board in another of these tabs — the
// page goes to Positions, which takes what was asked for (lib/positionsTab).
export default function PlayerInsights({
  player, view, onOpenGame, onFindGames, fill = false,
}) {
  const { state, dispatch } = useStore();
  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  // Back from a game opened in Positions: there as it was, and as tall (the
  // page scrolls back down to it).
  const [start] = useState(() => (view === 'positions' ? takePlace(player.id) : null));
  const startRef = useRef(start?.place ?? null);
  const [height, setHeight] = useState(start?.height ?? 900);
  const [picking, setPicking] = useState(false);
  const openings = view === 'openings';
  const positions = view === 'positions';
  const every = openings || positions; // every game with moves, sorted by a repertoire
  const data = useMemo(() => (every ? openingsGames(player) : insightGames(player)), [player, every]);
  const basis = useMemo(() => (every ? basisFor(state.openings, player) : null), [every, state.openings, player]);
  const repertoire = useMemo(
    () => (basis ? arcadeRepertoire(state.openings, basis.ids, state.players) : null),
    [basis, state.openings, state.players],
  );
  const live = useRef(data);
  live.current = data;
  const openRef = useRef(onOpenGame);
  openRef.current = onOpenGame;

  const api = () => {
    try { return frameRef.current?.contentWindow?.__rlReview ?? null; } catch { return null; }
  };
  useArcadeLook(api, ready);

  // A board in the tab (Play it out from a position): the frame has the whole
  // window while it's up, as Game Review does. Its own link back, Esc and the
  // phone's Back all put the tab back as it was.
  const [board, setBoard] = useState(false);
  useBackGuard(board, () => { if (!api()?.back?.()) setBoard(false); });
  useEffect(() => {
    if (!board) return undefined;
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!api()?.back?.()) setBoard(false);
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = was; window.removeEventListener('keydown', onKey); };
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = useRef({});
  now.current = { player, fill, height, onFindGames };
  // A structure's page opens at its top, and Back goes back to where you were:
  // the frame is as tall as what it shows, so it's this page that scrolls.
  const listY = useRef(null);
  const onPage = (d) => {
    if (now.current.fill) return; // the frame scrolls itself, and sees to it
    if (d.to === 'top') {
      if (!d.from) listY.current = window.scrollY;
      const box = frameRef.current?.parentElement;
      if (box && box.getBoundingClientRect().top < 62) box.scrollIntoView({ block: 'start' });
      return;
    }
    const y = listY.current;
    listY.current = null;
    if (y == null) return;
    let tries = 15;
    const put = () => {
      window.scrollTo(0, y);
      tries -= 1;
      if (tries > 0 && Math.abs(window.scrollY - y) > 2) setTimeout(put, 60);
    };
    put();
  };
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== 'rl-review') return;
      if (d.type === 'ready') setReady(true);
      // As tall as Chess Arcade's page, so the player page scrolls as one.
      if (d.type === 'height' && d.h > 0) setHeight(Math.max(600, Math.min(30000, Math.round(d.h))));
      if (d.type === 'openGame') {
        const gameId = live.current.byArcadeId.get(d.gid);
        if (gameId) {
          keepPlace(now.current.player.id, d.place, now.current.height);
          openRef.current?.(gameId, d.opts ?? null);
        }
      }
      if (d.type === 'board') setBoard(Boolean(d.on));
      if (d.type === 'page') onPageRef.current(d);
      if (d.type === 'findPosition' && askFind(now.current.player.id, d)) now.current.onFindGames?.();
      // A chapter in the Openings tab: there, in the Library; a line's Learn
      // or Practice: that line, in Learn or Practice.
      onArcadeArrows(d, dispatch, settingsRef.current);
      if (d.type === 'openChapter' && d.openingId && d.chapterId) {
        window.dispatchEvent(new CustomEvent('repertoire-open-line', {
          detail: {
            openingId: d.openingId,
            chapterId: d.chapterId,
            variationId: d.line ?? null,
            practice: d.go === 'practice',
            learn: d.go === 'learn' && Boolean(d.line),
          },
        }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // The repertoire first (Openings, Positions), then this player's games and
  // the tab asked for — again whenever any of them changes. Positions also
  // takes what Game Review asked it to find, or the place it was left at.
  useEffect(() => {
    if (!ready) return;
    if (every) api()?.repertoire?.(repertoire);
    const find = positions ? takeFind(player.id) : null;
    api()?.history?.(data.games, view, find ? null : startRef.current);
    startRef.current = null;
    if (find) api()?.find?.(find.fen, find.flip, find.sub);
  }, [ready, data, view, repertoire]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling itself, another tab starts at its top (the frame is the same
  // one for all four, and would otherwise keep the last tab's place).
  const tabRef = useRef(view);
  useEffect(() => {
    if (!fill || !ready || tabRef.current === view) return;
    tabRef.current = view;
    try { frameRef.current?.contentWindow?.scrollTo(0, 0); } catch { /* frame gone */ }
  }, [fill, ready, view]);

  // (Positions has its library of structures to show before there's a game.)
  const shown = positions ? 1 : openings ? data.games.length : data.games.filter((g) => (view === 'tactics' ? g.tactics : g.clamp || g.blunder)).length;
  const sum = openings ? basisSummary(state.openings, basis.ids, state.players) : null;
  return (
    <div className={`pi-wrap${fill ? ' fill' : ''}`}>
      {openings && (
        <div className="basis-bar">
          <span className="basis-bar-label">Based on</span>
          {basis.ids.length === 0 ? (
            <span className="muted-note">no openings yet — games are grouped by their moves only</span>
          ) : (
            <span className="basis-bar-list">
              {sum.white.length > 0 && <span><span className="color-dot white" /> {sum.white.join(', ')}</span>}
              {sum.black.length > 0 && <span><span className="color-dot black" /> {sum.black.join(', ')}</span>}
              {!basis.picked && <span className="muted-note">(the default)</span>}
            </span>
          )}
          <button type="button" className="small" onClick={() => setPicking(true)}>Change</button>
        </div>
      )}
      {shown === 0 && (
        <p className="muted-note pi-empty">
          {openings && `No games with moves on ${player.name}’s card yet. Add or import their games and they’re sorted here.`}
          {view === 'tactics' && `No tactics marked on ${player.name}’s games yet.`}
          {view === 'clamp' && `No CLAMP letters or ?? badges on ${player.name}’s games yet.`}
          {!openings && ' Open a game with “Send to Game Review” and mark its moves there — they’re counted here.'}
        </p>
      )}
      <div className={`pi-frame-box${board ? ' board' : ''}`} style={{ display: shown ? 'block' : 'none', ...(board && !fill ? { height } : {}) }}>
        <iframe
          ref={frameRef}
          className="pi-frame"
          title={`${player.name}’s ${TAB_NAMES[view] ?? 'CLAMP'}`}
          src={ARCADE_REVIEW_URL}
          style={fill ? undefined : { height }}
        />
        {!ready && <div className="gr-loading">Loading…</div>}
      </div>
      {picking && <OpeningsBasisPicker player={player} onClose={() => setPicking(false)} />}
    </div>
  );
}
