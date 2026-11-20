// What each card in Coaches Corner (and in Games) says under the name: the
// record, how many openings the games fall into, how many are off-beat.
//
// The list used to work that out for every card on every redraw — a whole
// index of the library built per card, every game played out twice — which is
// what made it slower with each line, student and game added. Now a card's
// line is worked out once and kept until its games, or the lines they're
// checked against, change. And the list never waits for it: a card whose
// positions aren't worked out yet (lib/positions — just after the app opens,
// usually) shows its record, and gets the rest as they arrive.
import { useEffect, useState } from 'react';
import { positionIndexFor, bookLineParts } from '../lib/repertoire';
import { playerSummary, playerRecord } from '../lib/games';
import { settleSmall } from '../lib/positions';
import { requestWarm, onWarmed } from '../lib/positionsWarm';

const NONE = [];
const itemsOf = new WeakMap(); // a card's games → what lib/positions is asked for
const kept = new WeakMap(); // a card's games → { index, openings, categories, summary }

// A game is named from the normal start, whatever it was set up from — as it
// always was (lib/games classifyGame).
export function gameItems(games) {
  if (!Array.isArray(games)) return NONE;
  let items = itemsOf.get(games);
  if (!items) {
    items = games.map((g) => ({ moves: g.moves }));
    itemsOf.set(games, items);
  }
  return items;
}

function summaryOf(player, index, state) {
  const was = kept.get(player.games);
  if (was && was.index === index && was.openings === state.openings && was.categories === state.categories) {
    return was.summary;
  }
  const summary = playerSummary(player, index, state);
  kept.set(player.games, {
    index, openings: state.openings, categories: state.categories, summary,
  });
  return summary;
}

// players: the cards shown. studentBooks: each card is checked against its
// own lines too (Coaches Corner), not only yours. `on`: the list is on
// screen. Returns a Map: card id → { record, openings, offbeat, ready } —
// openings and offbeat null until ready.
export function useCardSummaries(players, state, { studentBooks, source, on = true }) {
  const [, redraw] = useState(0);
  const cards = [];
  // Asked once per redraw, not once per card: your lines are every card's.
  // (A few missing — a line or a game just added — are worked out on the
  // spot: a card's counts don't blink over one new game.)
  const partDone = new Map();
  const done = (part) => {
    if (!partDone.has(part)) partDone.set(part, settleSmall(part));
    return partDone.get(part);
  };
  let waiting = false;
  if (on) {
    for (const player of players) {
      const book = { studentId: studentBooks ? player.id : null, source };
      const parts = bookLineParts(state.openings, book);
      const games = gameItems(player.games);
      const ready = parts.every(done) && settleSmall(games);
      if (!ready) waiting = true;
      cards.push({
        player, book, parts, games, ready,
      });
    }
  }
  // What's still to work out is asked for ahead of everything else: lines
  // before games (every card needs the lines), in the order the cards are
  // shown — and again when the library changes while some are still to come.
  useEffect(() => {
    if (!waiting) return undefined;
    const lines = new Set();
    const games = [];
    for (const c of cards) {
      for (const part of c.parts) lines.add(part);
      games.push(c.games);
    }
    requestWarm([...lines, ...games].flat());
    return onWarmed(() => redraw((n) => n + 1));
    // cards is this redraw's reading of the three below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, state.openings, state.players, source]);

  const out = new Map();
  for (const c of cards) {
    if (c.ready) {
      const s = summaryOf(c.player, positionIndexFor(state.openings, c.book), state);
      out.set(c.player.id, { ...s, ready: true });
    } else {
      out.set(c.player.id, {
        record: playerRecord(c.player.games), openings: null, offbeat: null, ready: false,
      });
    }
  }
  return out;
}
