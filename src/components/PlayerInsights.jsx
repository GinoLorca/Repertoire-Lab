// A player's CLAMP and Tactics — the player page's third and fourth tabs.
//
// Chess Arcade's own two Game History tabs (public/arcade, scripts/sync-arcade.mjs),
// over this player's games: what was marked in Game Review — CLAMP letters on
// moves, tactics found or missed — counted, by letter and by tactic, by phase,
// colour and speed, with every marked move as a board. Nothing new is kept:
// it reads the analysis each game already has (lib/gameReviewBridge
// insightGames). A game or a moment opens in Game Review, at that move.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ARCADE_REVIEW_URL } from '../lib/arcadeBuild';
import { insightGames } from '../lib/gameReviewBridge';

export default function PlayerInsights({ player, view, onOpenGame }) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(900);
  const data = useMemo(() => insightGames(player), [player]);
  const live = useRef(data);
  live.current = data;
  const openRef = useRef(onOpenGame);
  openRef.current = onOpenGame;

  const api = () => {
    try { return frameRef.current?.contentWindow?.__rlReview ?? null; } catch { return null; }
  };

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
        if (gameId) openRef.current?.(gameId, d.opts ?? null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // This player's games, and the tab asked for — again whenever either changes.
  useEffect(() => {
    if (ready) api()?.history?.(data.games, view);
  }, [ready, data, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const marked = data.games.filter((g) => (view === 'tactics' ? g.tactics : g.clamp)).length;
  return (
    <div className="pi-wrap">
      {marked === 0 && (
        <p className="muted-note pi-empty">
          {view === 'tactics'
            ? `No tactics marked on ${player.name}’s games yet.`
            : `No CLAMP letters on ${player.name}’s games yet.`}
          {' '}Open a game with “Send to Game Review” and mark its moves there — they’re counted here.
        </p>
      )}
      <div className="pi-frame-box" style={{ display: marked ? 'block' : 'none' }}>
        <iframe
          ref={frameRef}
          className="pi-frame"
          title={view === 'tactics' ? `${player.name}’s tactics` : `${player.name}’s CLAMP`}
          src={ARCADE_REVIEW_URL}
          style={{ height }}
        />
        {!ready && <div className="gr-loading">Loading…</div>}
      </div>
    </div>
  );
}
