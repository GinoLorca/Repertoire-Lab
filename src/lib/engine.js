import { Chess } from 'chess.js';

// Wrapper around the Stockfish 16 (single-threaded WASM) web worker.
export class Engine {
  constructor() {
    this.worker = new Worker('/stockfish/stockfish-nnue-16-single.js');
    this.listeners = new Set();
    // The position being searched right now, and the one queued behind it. A
    // search has to be stopped and its `bestmove` collected before the next
    // `position` command, or the engine keeps reporting on the old position —
    // which reads as moves that don't exist on the board.
    this.currentFen = null;
    this.pendingFen = null;
    this.searching = false;
    this.readyResolve = null;
    this.ready = new Promise((resolve) => { this.readyResolve = resolve; });

    this.worker.onmessage = (e) => this.handleMessage(String(e.data));
    this.worker.onerror = (e) => console.error('Stockfish worker error:', e.message || e);

    this.send('uci');
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  handleMessage(line) {
    if (line === 'uciok') {
      this.send('setoption name MultiPV value 3');
      this.send('setoption name Use NNUE value true');
      this.send('isready');
      return;
    }
    if (line === 'readyok') {
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    if (line.startsWith('bestmove')) {
      this.searching = false;
      this.startNext();
      return;
    }
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const info = this.parseInfo(line);
      if (info) this.listeners.forEach((cb) => cb(info));
    }
  }

  // Start the queued search, if one is waiting and the engine is free.
  startNext() {
    if (this.searching || !this.pendingFen) return;
    this.currentFen = this.pendingFen;
    this.pendingFen = null;
    this.searching = true;
    this.send(`position fen ${this.currentFen}`);
    this.send('go depth 24');
  }

  parseInfo(line) {
    const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
    const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
    const cpMatch = line.match(/\bscore cp (-?\d+)/);
    const mateMatch = line.match(/\bscore mate (-?\d+)/);
    const pvMatch = line.match(/\bpv (.+)$/);
    if (!pvMatch || (!cpMatch && !mateMatch)) return null;
    const uciMoves = pvMatch[1].trim().split(/\s+/);

    // Convert score to White's perspective.
    const fen = this.currentFen;
    const whiteToMove = !fen || fen.split(' ')[1] === 'w';
    const sign = whiteToMove ? 1 : -1;
    const score = cpMatch
      ? { type: 'cp', value: Number(cpMatch[1]) * sign }
      : { type: 'mate', value: Number(mateMatch[1]) * sign };

    // Convert PV to SAN.
    const sans = [];
    if (fen) {
      const chess = new Chess(fen);
      for (const uci of uciMoves.slice(0, 12)) {
        try {
          const mv = chess.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci[4] || undefined,
          });
          if (!mv) break;
          sans.push(mv.san);
        } catch {
          break;
        }
      }
    }
    // The position this line belongs to, so the board can ignore anything that
    // arrives late for a position you've already moved on from.
    return { depth, multipv, score, sans, firstUci: uciMoves[0], fen };
  }

  onInfo(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async analyze(fen) {
    await this.ready;
    this.pendingFen = fen;
    // Whatever is running is about to be replaced; `bestmove` starts the new
    // one. Stepping through a game quickly just keeps replacing what's queued.
    if (this.searching) this.send('stop');
    else this.startNext();
  }

  stop() {
    this.pendingFen = null;
    if (this.searching) this.send('stop');
  }

  quit() {
    this.send('quit');
    this.worker.terminate();
  }
}

export function formatScore(score) {
  if (!score) return '—';
  if (score.type === 'mate') return `#${score.value}`;
  const pawns = score.value / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}
