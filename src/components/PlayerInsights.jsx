// A player's CLAMP, Tactics and Openings — the player page's tabs from Chess
// Arcade.
//
// Chess Arcade's own Game History tabs (public/arcade, scripts/sync-arcade.mjs),
// over this player's games. CLAMP and Tactics: what was marked in Game Review —
// CLAMP letters on moves, tactics found or missed — counted, by letter and by
// tactic, by phase, colour and speed, with every marked move as a board; they
// read the analysis each game already has (lib/gameReviewBridge insightGames).
// Openings: every game with moves, sorted by the openings it's based on —
// picked for this player, White and Black, from any library — handed to Chess
// Arcade straight (lib/openingsBasis). A game or a moment opens in Game
// Review, at that move; a chapter opens in the Library. Like every Chess
// Arcade tab here, it wears Repertoire Lab's theme (lib/arcadeLook).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ARCADE_REVIEW_URL } from '../lib/arcadeBuild';
import { insightGames } from '../lib/gameReviewBridge';
import {
  basisFor, arcadeRepertoire, openingsGames, basisSummary,
} from '../lib/openingsBasis';
import { useArcadeLook } from '../lib/arcadeLook';
import OpeningsBasisPicker from './OpeningsBasisPicker';

export default function PlayerInsights({ player, view, onOpenGame }) {
  const { state } = useStore();
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(900);
  const [picking, setPicking] = useState(false);
  const openings = view === 'openings';
  const data = useMemo(() => (openings ? openingsGames(player) : insightGames(player)), [player, openings]);
  const basis = useMemo(() => (openings ? basisFor(state.openings, player) : null), [openings, state.openings, player]);
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
      // A chapter in the Openings tab: there, in the Library; a line's Learn
      // or Practice: that line, in Learn or Practice.
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

  // The repertoire first (Openings), then this player's games and the tab
  // asked for — again whenever any of them changes.
  useEffect(() => {
    if (!ready) return;
    if (openings) api()?.repertoire?.(repertoire);
    api()?.history?.(data.games, view);
  }, [ready, data, view, repertoire]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = openings ? data.games.length : data.games.filter((g) => (view === 'tactics' ? g.tactics : g.clamp)).length;
  const sum = openings ? basisSummary(state.openings, basis.ids, state.players) : null;
  return (
    <div className="pi-wrap">
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
          {view === 'clamp' && `No CLAMP letters on ${player.name}’s games yet.`}
          {!openings && ' Open a game with “Send to Game Review” and mark its moves there — they’re counted here.'}
        </p>
      )}
      <div className="pi-frame-box" style={{ display: shown ? 'block' : 'none' }}>
        <iframe
          ref={frameRef}
          className="pi-frame"
          title={`${player.name}’s ${openings ? 'openings' : view === 'tactics' ? 'tactics' : 'CLAMP'}`}
          src={ARCADE_REVIEW_URL}
          style={{ height }}
        />
        {!ready && <div className="gr-loading">Loading…</div>}
      </div>
      {picking && <OpeningsBasisPicker player={player} onClose={() => setPicking(false)} />}
    </div>
  );
}
