import React, { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import EvalBar from './EvalBar';
import { Engine } from '../lib/engine';
import { gameOverScore } from '../lib/gameReview';
import { fen4 } from '../lib/startPos';

// The review reader's evaluation bar: its own engine, searching one line, so
// only the bar re-renders as scores come in — never the reader's text. A
// score is kept by position for as long as the reader is open, so stepping
// back shows it at once, and a finished game (mate, stalemate) is scored
// without asking the engine, which has nothing to say about it.
const DEPTH = 16;
const SHOWN_FROM = 6; // shallower than this is noise worth waiting past

export default function LiveEvalBar({ fen, flipped = false, height }) {
  const engineRef = useRef(null);
  const cache = useRef(new Map());
  const fenRef = useRef(fen);
  const [score, setScore] = useState(null);

  useEffect(() => {
    const engine = new Engine({ multiPV: 1 });
    engineRef.current = engine;
    const off = engine.onInfo((info) => {
      if (info.multipv !== 1 || !info.fen) return;
      const key = fen4(info.fen);
      const known = cache.current.get(key);
      if (!known || info.depth >= known.depth) cache.current.set(key, { score: info.score, depth: info.depth });
      if (key === fen4(fenRef.current) && info.depth >= SHOWN_FROM) setScore(info.score);
    });
    // Nothing to think about while the app is out of sight.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') engine.stop();
      else engine.analyze(fenRef.current, { depth: DEPTH });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      off();
      engine.quit();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    fenRef.current = fen;
    let chess = null;
    try { chess = new Chess(fen); } catch { setScore(null); return; }
    if (chess.isGameOver()) {
      engineRef.current?.stop();
      setScore(gameOverScore(chess));
      return;
    }
    const known = cache.current.get(fen4(fen));
    setScore(known && known.depth >= SHOWN_FROM ? known.score : null);
    if (!known || known.depth < DEPTH) engineRef.current?.analyze(fen, { depth: DEPTH });
  }, [fen]);

  return <EvalBar score={score} height={height} running={score != null} flipped={flipped} />;
}
