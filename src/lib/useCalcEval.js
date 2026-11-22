// The engine's score for the Capture Calculator: the position its board is
// on, and the one it started from (lib/captureCalc, "The engine's view").
//
// With the board's own engine running, the position on the board is already
// being searched: its score is taken as it comes (`live`), and remembered —
// so the start, which was on the board when the calculator was turned on, is
// usually known without asking anyone. Whatever is still missing (the engine
// is off; the first capture was played before the start had a score) is
// searched by a small engine of this hook's own: one line, sixteen deep,
// started only when there is something to ask and gone with the calculator.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Engine } from './engine';
import { gameOverScore } from './gameReview';
import { fen4 } from './startPos';

const DEPTH = 16;
const SHOWN_FROM = 10; // shallower than this jumps about too much to print

const overScore = (fen) => {
  try {
    const chess = new Chess(fen);
    return chess.isGameOver() ? { ...gameOverScore(chess), over: true } : null;
  } catch { return null; }
};

// on: the calculator is on (and its count is shown)
// fen / startFen: the position on its board, and where it started
// mainOn: the board's own engine is searching `fen`
// live: that engine's first line for it ({ score, depth, fen }), or null
export function useCalcEval(on, fen, startFen, mainOn = false, live = null) {
  const cache = useRef(new Map());
  const engineRef = useRef(null);
  const want = useRef({});
  want.current = { on, fen, startFen, mainOn };
  const [, redraw] = useState(0);

  const known = (f) => {
    if (!f) return null;
    const got = cache.current.get(fen4(f));
    return got && got.depth >= SHOWN_FROM ? got : null;
  };
  const keep = (f, score, depth) => {
    const key = fen4(f);
    const had = cache.current.get(key);
    if (had && had.depth > depth) return false;
    cache.current.set(key, { score, depth });
    return true;
  };

  // What this hook's own engine should be searching, if anything.
  const next = () => {
    const w = want.current;
    if (!w.on) return null;
    const list = w.mainOn ? [w.startFen] : [w.fen, w.startFen];
    return list.find((f) => f && !overScore(f) && (cache.current.get(fen4(f))?.depth ?? 0) < DEPTH) ?? null;
  };
  const ask = () => {
    const f = next();
    if (!f) { engineRef.current?.stop(); return; }
    if (!engineRef.current) {
      const engine = new Engine({ multiPV: 1 });
      engineRef.current = engine;
      engine.onInfo((info) => {
        if (info.multipv !== 1 || !info.fen) return;
        if (!keep(info.fen, info.score, info.depth)) return;
        const key = fen4(info.fen);
        const w = want.current;
        if (info.depth >= SHOWN_FROM && (key === fen4(w.fen ?? '') || key === fen4(w.startFen ?? ''))) redraw((n) => n + 1);
        // Deep enough: on to whatever else is wanted.
        if (info.depth >= DEPTH && engine.asked !== next()) ask();
      });
    }
    if (engineRef.current.asked === f) return;
    engineRef.current.asked = f;
    engineRef.current.analyze(f, { depth: DEPTH });
  };

  // The board's own engine, as its lines come in.
  const liveDepth = live?.depth ?? 0;
  useEffect(() => {
    if (!on || !live?.fen || !live.score || fen4(live.fen) !== fen4(fen ?? '')) return;
    if (keep(live.fen, live.score, live.depth) && live.depth >= SHOWN_FROM) redraw((n) => n + 1);
  }, [on, fen, live?.fen, liveDepth, live?.score?.value, live?.score?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (on) ask();
    else if (engineRef.current) { engineRef.current.asked = null; engineRef.current.stop(); }
  }, [on, fen, startFen, mainOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    engineRef.current?.quit();
    engineRef.current = null;
  }, []);

  if (!on) return null;
  const read = (f) => (f ? overScore(f) ?? known(f)?.score ?? null : null);
  return { now: read(fen), before: read(startFen) };
}
