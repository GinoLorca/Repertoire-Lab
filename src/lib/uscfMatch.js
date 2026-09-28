// Lining up the games recorded in the app — scoresheets typed in, scanned,
// or pasted — with the rounds US Chess rated. Pure.
//
// US Chess knows, for each round of each rated section: the date range of
// the section, the round number, the colour, the result and the opponent
// (name, ID, rating). A game recorded here may know any of those, or none
// (a scanned scoresheet saved without its details). So each game is scored
// against each played round of a section it could belong to:
//
//   must agree    its date falls in the section's dates (a day either side);
//                 its colour and result, where both sides know them
//   strong        the same round number; the opponent's surname
//   supporting    the opponent's rating close to the one US Chess used; the
//                 event's name sharing words with the section's
//
// and rounds and games are paired one to one, best score first. A pairing is
//   'linked'     confirmed by someone (the game carries meta.uscfRef)
//   'matched'    confident — the round or the opponent agrees, nothing
//                disagrees, and nothing else fits as well
//   'suggested'  plausible — worth asking about
// A linked game whose colour or result disagrees with US Chess is flagged.

import { PLAYED } from './uscfHistory';

// "202609070223:5:3" — one round of one rated section.
export const roundKey = (sectionKeyOrEvent, sectionOrRound, round) => (round == null
  ? `${sectionKeyOrEvent}:${sectionOrRound}`
  : `${sectionKeyOrEvent}:${sectionOrRound}:${round}`);

const DAY = 86400000;
const toDay = (iso) => (iso ? Date.parse(`${iso}T12:00:00Z`) : NaN);

// Names compared without case, accents, punctuation or order ("Crawford,
// Elliott" and "ELLIOTT CRAWFORD" are the same person).
export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((t) => t.length > 1);
}

// How well a name written on a scoresheet fits a US Chess opponent: 2 for the
// surname and a first name or initial, 1 for the surname alone, 0 otherwise.
export function nameFit(written, first, last) {
  const w = nameTokens(written);
  if (!w.length) return 0;
  const lastT = nameTokens(last);
  if (!lastT.length || !lastT.every((t) => w.includes(t))) return 0;
  const firstT = nameTokens(first);
  const rest = w.filter((t) => !lastT.includes(t));
  const initialOk = firstT.length && (rest.some((t) => firstT.includes(t))
    || String(written).match(new RegExp(`\\b${firstT[0][0]}\\.?\\b`, 'i')));
  return initialOk ? 2 : 1;
}

const wordsOf = (s) => new Set(nameTokens(s).filter((t) => t.length > 2 && !/^(the|and|for|section|under|open|chess|rated|annual)$/.test(t)));

const parseRound = (r) => {
  const m = String(r ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
};

const OUTCOME_OF = { W: 'win', L: 'loss', D: 'draw' };

// The game's own result from the player's side: 'win' | 'loss' | 'draw' | null.
function gameOutcome(game) {
  const { result, color } = game.meta ?? {};
  if (!result || result === '*') return null;
  if (result === '½-½' || result === '1/2-1/2') return 'draw';
  if (color !== 'white' && color !== 'black') return null;
  return (result === '1-0') === (color === 'white') ? 'win' : 'loss';
}

// The opponent as written on the game: the side that isn't the player's, or
// — colour unknown — both names, to be tried in turn.
function writtenOpponents(game) {
  const m = game.meta ?? {};
  if (m.color === 'white') return [{ name: m.black, elo: m.blackElo }];
  if (m.color === 'black') return [{ name: m.white, elo: m.whiteElo }];
  return [{ name: m.white, elo: m.whiteElo }, { name: m.black, elo: m.blackElo }];
}

// Could this game have been played in a rated section at all? Over-the-board
// games, and games with no details saying otherwise.
export function isCandidateGame(game) {
  const m = game.meta ?? {};
  // "Neither (someone else's game)" — scouting, not one of their rounds.
  if (m.color === 'none') return false;
  return !m.eventType || m.eventType === 'otb' || m.eventType === 'other';
}

// One game against one played round: { score, contradicts, reasons, strong,
// nameClash }. `contradicts` is a colour or result that disagrees; a date
// far outside the section rules the pair out (score -1).
export function scorePair(game, section, round) {
  const meta = game.meta ?? {};
  const reasons = [];
  let score = 0;
  let strong = false;
  // Date.
  const start = toDay(section.start ?? section.end);
  const end = toDay(section.end ?? section.start);
  if (meta.date) {
    const d = toDay(meta.date);
    if (d >= start - DAY && d <= end + DAY) {
      score += 2;
      reasons.push('date');
    } else if (d > end && d <= end + 14 * DAY) {
      // Typed in afterwards — the editor dates a new game today.
      reasons.push('dated later');
    } else {
      return { score: -1, contradicts: false, reasons: ['date'], strong: false, nameClash: false };
    }
  } else {
    // No game date: the day it was saved, if it was soon after.
    const saved = Number(game.date);
    if (!(saved >= start - DAY && saved <= end + 14 * DAY)) {
      return { score: -1, contradicts: false, reasons: ['date'], strong: false, nameClash: false };
    }
    score += 0.5;
    reasons.push('saved soon after');
  }
  let contradicts = false;
  // Colour and result, where both sides know them.
  if (meta.color === 'white' || meta.color === 'black') {
    if (round.color && round.color !== meta.color) contradicts = true;
    else if (round.color) { score += 1; reasons.push('colour'); }
  }
  const outcome = gameOutcome(game);
  if (outcome) {
    if (OUTCOME_OF[round.result] !== outcome) contradicts = true;
    else { score += 1; reasons.push('result'); }
  }
  // Round number.
  const r = parseRound(meta.round);
  if (r != null) {
    if (r === round.round) { score += 3; strong = true; reasons.push('round'); } else score -= 1;
  }
  // Opponent.
  const opps = writtenOpponents(game);
  let bestName = 0;
  let eloOk = false;
  for (const o of opps) {
    bestName = Math.max(bestName, nameFit(o.name, round.oppFirst, round.oppLast));
    const elo = Number(String(o.elo ?? '').replace(/[^\d]/g, ''));
    if (elo && round.oppPre != null && Math.abs(elo - round.oppPre) <= 75) eloOk = true;
  }
  // An opponent named on the game who isn't the one US Chess paired.
  const nameClash = !bestName && opps.some((o) => nameTokens(o.name).length);
  if (bestName) { score += bestName === 2 ? 4 : 3; strong = true; reasons.push('opponent'); } else if (nameClash) score -= 2;
  if (eloOk) { score += 1; reasons.push('rating'); }
  // Event name.
  const ours = wordsOf(meta.event);
  if (ours.size) {
    const theirs = wordsOf(`${section.eventName} ${section.sectionName}`);
    const shared = [...ours].filter((w) => theirs.has(w)).length;
    if (shared) { score += Math.min(2, shared); reasons.push('event'); }
  }
  return {
    score, contradicts, reasons, strong, nameClash,
  };
}

// Pair a player's games with the rounds of their loaded sections.
//   history, standings — lib/uscfHistory.js
//   games              — the player's games
// Returns {
//   rounds: { [roundKey]: { state, gameId, score, reasons, conflict } },
//   games:  { [gameId]: roundKey },
//   unmatched: [gameId]   — candidate games dated in no loaded section
//   played, recorded      — played rounds, and how many have a game
// }
export function matchGames(history, standings, games) {
  const rounds = {};
  const byGame = {};
  const candidates = (games ?? []).filter(isCandidateGame);
  const sections = (history?.sections ?? []).filter((s) => standings?.[s.key]);
  const playedRounds = [];
  for (const s of sections) {
    for (const r of standings[s.key].rounds) {
      if (PLAYED.has(r.result)) playedRounds.push({ section: s, round: r, key: roundKey(s.key, r.round) });
    }
  }
  const allKeys = new Set(playedRounds.map((p) => p.key));

  // Confirmed links first: they stand whatever the scores say.
  for (const g of candidates) {
    const ref = g.meta?.uscfRef;
    if (!ref || !allKeys.has(ref) || rounds[ref]) continue;
    const p = playedRounds.find((x) => x.key === ref);
    const s = scorePair(g, p.section, p.round);
    // Flagged only for a colour or result US Chess disagrees with.
    rounds[ref] = { state: 'linked', gameId: g.id, score: s.score, reasons: s.reasons, conflict: s.contradicts };
    byGame[g.id] = ref;
  }

  // Everything else, scored, best first, one to one.
  const pairs = [];
  for (const g of candidates) {
    if (byGame[g.id] || g.meta?.uscfRef) continue;
    const refused = new Set(String(g.meta?.uscfNot ?? '').split(/\s+/).filter(Boolean));
    // A game with no date has nothing to tell one round of a section from
    // another: turned down for one, it isn't from that section at all.
    const noDate = !g.meta?.date;
    const refusedSections = new Set([...refused].map((k) => k.split(':').slice(0, 2).join(':')));
    for (const p of playedRounds) {
      if (rounds[p.key] || refused.has(p.key)) continue;
      if (noDate && refusedSections.has(p.section.key)) continue;
      const s = scorePair(g, p.section, p.round);
      if (s.score < 0 || s.contradicts) continue;
      pairs.push({ game: g, p, ...s });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const pair of pairs) {
    if (byGame[pair.game.id] || rounds[pair.p.key]) continue;
    // Confident only when it's the round's clear best and the game's too.
    const rivals = pairs.filter((x) => x !== pair && x.score === pair.score
      && (x.p.key === pair.p.key || x.game.id === pair.game.id)
      && !byGame[x.game.id] && !rounds[x.p.key]);
    const hasMeta = Boolean(pair.game.meta?.date);
    // Confident needs the game's own date in the section, the round or the
    // opponent agreeing, and no opponent named who isn't the one paired.
    const confident = pair.reasons.includes('date') && pair.strong && !pair.nameClash && !rivals.length;
    const plausible = pair.reasons.includes('colour') || pair.reasons.includes('result')
      || pair.reasons.includes('opponent') || pair.reasons.includes('round')
      || (!hasMeta && pair.reasons.includes('saved soon after'));
    if (!confident && !plausible) continue;
    rounds[pair.p.key] = {
      state: confident ? 'matched' : 'suggested',
      gameId: pair.game.id,
      score: pair.score,
      reasons: pair.reasons,
      conflict: false,
    };
    byGame[pair.game.id] = pair.p.key;
  }

  // Candidate games no round took, dated where no loaded section was.
  const unmatched = candidates.filter((g) => !byGame[g.id]).map((g) => g.id);
  const recorded = playedRounds.filter((p) => rounds[p.key] && rounds[p.key].state !== 'suggested').length;
  return { rounds, games: byGame, unmatched, played: playedRounds.length, recorded };
}

// What confirming a pairing writes on the game: the link, and any details
// the game was missing, from US Chess. `player`: { name, rating (their
// rating going into the event), timeControl (the section's) }.
export function confirmMeta(game, section, round, player) {
  const m = game.meta ?? {};
  const me = player?.name ?? '';
  const myElo = player?.rating != null ? String(player.rating) : '';
  const color = m.color === 'white' || m.color === 'black' ? m.color : round.color;
  const result = m.result && m.result !== '*' ? m.result : (() => {
    if (round.result === 'D') return '½-½';
    if (!color) return m.result ?? '';
    const whiteWon = (round.result === 'W') === (color === 'white');
    return whiteWon ? '1-0' : '0-1';
  })();
  const oppName = round.oppName ?? '';
  const oppElo = round.oppPre != null ? String(round.oppPre) : '';
  const fill = (v, x) => (v && String(v).trim() ? v : x);
  const out = {
    uscfRef: roundKey(section.key, round.round),
    ...(round.oppId ? { uscfOpp: round.oppId } : {}),
    eventType: fill(m.eventType, 'otb'),
    event: fill(m.event, section.eventName),
    round: fill(m.round, String(round.round)),
    date: fill(m.date, section.end ?? ''),
    color: fill(m.color && m.color !== 'none' ? m.color : '', color ?? ''),
    result: fill(m.result && m.result !== '*' ? m.result : '', result),
    ...(player?.timeControl ? { timeControl: fill(m.timeControl, player.timeControl) } : {}),
  };
  if (color === 'white') {
    out.white = fill(m.white, me);
    out.black = fill(m.black, oppName);
    out.blackElo = fill(m.blackElo, oppElo);
    if (myElo) out.whiteElo = fill(m.whiteElo, myElo);
  } else if (color === 'black') {
    out.black = fill(m.black, me);
    out.white = fill(m.white, oppName);
    out.whiteElo = fill(m.whiteElo, oppElo);
    if (myElo) out.blackElo = fill(m.blackElo, myElo);
  }
  // What this link filled in, so undoing it can take it back out again.
  const filled = {};
  for (const [k, v] of Object.entries(out)) {
    if (!k.startsWith('uscf') && v !== '' && v !== (m[k] ?? '')) filled[k] = v;
  }
  out.uscfFilled = JSON.stringify(filled);
  // A pairing turned down before, for this round, no longer applies.
  const refused = String(m.uscfNot ?? '').split(/\s+/).filter((k) => k && k !== out.uscfRef);
  out.uscfNot = refused.join(' ');
  return out;
}

// What turning a suggestion down writes: that round, remembered as not this game.
export function refuseMeta(game, key) {
  const refused = new Set(String(game.meta?.uscfNot ?? '').split(/\s+/).filter(Boolean));
  refused.add(key);
  return { uscfNot: [...refused].join(' ') };
}

// What undoing a confirmed pairing writes: no link, and not that round again.
// The details the link filled in go with it — unless they've been edited
// since.
export function unlinkMeta(game) {
  const m = game.meta ?? {};
  const key = m.uscfRef;
  const refused = new Set(String(m.uscfNot ?? '').split(/\s+/).filter(Boolean));
  if (key) refused.add(key);
  const out = { uscfRef: '', uscfOpp: '', uscfNot: [...refused].join(' '), uscfFilled: '' };
  let filled = {};
  try { filled = JSON.parse(m.uscfFilled || '{}') ?? {}; } catch { filled = {}; }
  for (const [k, v] of Object.entries(filled)) if (m[k] === v) out[k] = '';
  return out;
}
