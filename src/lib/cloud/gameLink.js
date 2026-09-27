// Games shared between a coach and a linked student.
//
// A coach types in a game a student played — the paper scoresheet got lost,
// the coach's copy is the only one — and it belongs in the student's own
// account as much as on the coach's card. The reverse too: a game the student
// adds in their own app shows up on their coach's card for them.
//
// The shape of it:
//
//   · One game, one id, in both accounts. Nothing is ever re-numbered on the
//     way across, which is the only thing that stops the same game piling up
//     as copies.
//   · Only an account's owner ever writes that account. A coach's change
//     travels as a small patch through the existing deliveries collection —
//     already published, so nothing here needs a rules change — and the
//     student's own app applies it, inside its own sync, in the same push
//     that records it.
//   · A patch says, per field, what the coach last saw there and what it
//     should now be. The student's app changes a field only if it still
//     holds what the coach saw — compare-and-set — so a coach can fill in
//     and correct, but never overwrite something the student changed.
//   · Games the student adds reach the coach the other way round: the coach
//     can already read the student's account, and the coach's app folds the
//     student's games into their card under the same ids.
//   · Nothing a person wrote is ever deleted from their account by the other
//     one. A coach removing a game from their card leaves the student's copy
//     alone; a game the student deleted is never pushed back into their
//     account; and a game the coach typed in stays on the coach's card even
//     if the student deletes their copy. Only the coach's mirror of the
//     student's OWN game follows a deletion.
//
// Everything in this file is pure — no Firestore, no React — so all of it is
// covered by tests/gameLink.test.mjs.
import { hashOf } from './shape';
import { BADGE_BY_ID } from '../badges';
import { defaultMonsterId } from '../monsters';

// ---------------------------------------------------------------------------
// What's shared and what isn't
// ---------------------------------------------------------------------------

// The game itself: what was played, and the scoresheet details around it.
export const SHARED_TOP = ['name', 'date', 'moves'];
export const SHARED_META = [
  'white', 'whiteElo', 'black', 'blackElo', 'event', 'eventType', 'round',
  'result', 'color', 'date', 'timeControl', 'flags',
];
// Keyed maps travel one key at a time — a comment on move 14 is its own
// field — so two people annotating different moves never collide.
export const SHARED_MAPS = ['comments', 'badges', 'annotations'];

// Never sent, and never overwritten by the other side: each person's own
// notes, tags, filing and scoresheet photo stay theirs. Listed for the
// record and for the tests; the code shares only what's named above.
export const PRIVATE = ['meta.photo', 'meta.categoryId', 'meta.notes', 'tags', 'updatedAt'];

const EMPTY = '∅';
export const CARD_BUDGET = 700000;

// ---------------------------------------------------------------------------
// Paths and values
// ---------------------------------------------------------------------------

// JSON with object keys sorted, so a value hashes the same however it was
// built — and after a round trip through Firestore, which doesn't promise
// key order.
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

const isEmpty = (v) => v == null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).every((k) => v[k] === undefined));

// A value's fingerprint. Every kind of "nothing" — missing, null, '', [] and
// {} — is the same nothing, because the two accounts don't agree on which
// one an untouched field happens to hold.
export const ph = (v) => (isEmpty(v) ? EMPTY : hashOf(stableStringify(v)));

const split = (p) => {
  const i = p.indexOf(':');
  return i < 0 ? [p, null] : [p.slice(0, i), p.slice(i + 1)];
};

// The Studio variation tree and its highlighted branches go together, as one
// opaque unit: a tree's node ids are only meaningful inside that tree, so it
// is replaced whole, never merged node by node.
export function getPath(g, p) {
  const [head, key] = split(p);
  if (head === 'tree') {
    if (g?.tree === undefined && g?.variationHighlights === undefined) return undefined;
    return { tree: g.tree ?? null, variationHighlights: g.variationHighlights ?? null };
  }
  if (head === 'meta') return g?.meta?.[key];
  if (SHARED_MAPS.includes(head)) return g?.[head]?.[key];
  return g?.[head];
}

// Immutable. Setting a path to any kind of nothing removes it rather than
// writing a null that the other side would read as a change.
export function setPath(g, p, value) {
  const [head, key] = split(p);
  const out = { ...g };
  const empty = isEmpty(value);
  if (head === 'tree') {
    if (empty) { delete out.tree; delete out.variationHighlights; } else {
      if (value.tree == null) delete out.tree; else out.tree = value.tree;
      if (value.variationHighlights == null) delete out.variationHighlights;
      else out.variationHighlights = value.variationHighlights;
    }
    return out;
  }
  if (head === 'meta' || SHARED_MAPS.includes(head)) {
    const container = { ...(g?.[head] ?? {}) };
    if (empty) delete container[key]; else container[key] = value;
    out[head] = container;
    return out;
  }
  if (empty) delete out[head]; else out[head] = value;
  return out;
}

// Every shared path a game has a value at. Maps contribute one path per key.
export function pathsOf(g) {
  const paths = [...SHARED_TOP, ...SHARED_META.map((k) => `meta:${k}`), 'tree'];
  for (const m of SHARED_MAPS) for (const k of Object.keys(g?.[m] ?? {})) paths.push(`${m}:${k}`);
  return paths;
}

// The fingerprint of every non-empty shared field — what "the other side's
// copy, as last seen" is recorded as.
export function hashesOf(g) {
  const out = {};
  for (const p of pathsOf(g)) {
    const h = ph(getPath(g, p));
    if (h !== EMPTY) out[p] = h;
  }
  return out;
}

// A game with only its shared fields, for the coach's mirrored copy of a
// student game: the student's own notes, tags, filing and photo don't cross.
export function sharedCopy(g) {
  let out = { id: g.id, name: g.name ?? 'Game', date: g.date ?? null, moves: g.moves ?? [], meta: {}, comments: {}, badges: {} };
  for (const p of pathsOf(g)) out = setPath(out, p, getPath(g, p));
  if (out.date == null) delete out.date;
  return out;
}

// ---------------------------------------------------------------------------
// Coach side: what to send
// ---------------------------------------------------------------------------

// Everything shared that differs from what the coach last saw in the
// student's account. Cumulative against that baseline, so the newest patch
// always stands on its own — an older one lost in transit costs nothing.
export function buildPatch(coachGame) {
  const base = coachGame.link?.base ?? {};
  const paths = new Set([...pathsOf(coachGame), ...Object.keys(base)]);
  const from = {};
  const set = {};
  const pending = [];
  for (const p of paths) {
    const v = getPath(coachGame, p);
    const h = ph(v);
    const b = base[p] ?? EMPTY;
    if (h === b) continue;
    pending.push(p);
    from[p] = b;
    set[p] = isEmpty(v) ? null : v;
  }
  return { patch: { from, set }, pending };
}

export const patchHash = (patch) => hashOf(stableStringify(patch));

// Whether a game on a linked card has something to send right now.
export function needsSend(coachGame, { linkActive }) {
  const link = coachGame.link;
  if (!link || link.gone || !linkActive) return false;
  // The student's own game: the coach sees it, and can annotate their copy,
  // but nothing goes back — see applyCoachGames, which would refuse it.
  if (link.origin === 'student') return false;
  // A photo-only game — the scoresheet snapped, moves not typed yet — waits:
  // an empty game in someone else's account helps nobody.
  if (!(coachGame.moves?.length > 0)) return false;
  const { patch, pending } = buildPatch(coachGame);
  if (pending.length === 0) return false;
  return patchHash(patch) !== link.sent?.ph;
}

// Strictly increasing per game, and never behind anything the student's
// account has already recorded — so a patch built on another of the coach's
// devices can't be mistaken for an old one.
export function nextRev(now, sentRev = 0, studentRev = 0) {
  return Math.max(now, sentRev + 1, studentRev + 1);
}

// ---------------------------------------------------------------------------
// Patches on the wire
// ---------------------------------------------------------------------------

const PATH_RE = /^(name|date|moves|tree|meta:[a-zA-Z]{1,20}|comments:(?:-1|\d{1,4})|badges:\d{1,4}|annotations:[^\u0000]{1,120})$/;
const POISON = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_PATCH = 900000;

function poisoned(v) {
  if (v === null || typeof v !== 'object') return false;
  for (const k of Object.keys(v)) {
    if (POISON.has(k) || poisoned(v[k])) return true;
  }
  return false;
}

function validValue(p, v) {
  if (v === null) return true;
  const [head, key] = split(p);
  switch (head) {
    case 'name': return typeof v === 'string' && v.length <= 300;
    case 'date': return typeof v === 'number' && Number.isFinite(v);
    case 'moves': return Array.isArray(v) && v.length <= 1000
      && v.every((m) => typeof m === 'string' && m.length > 0 && m.length <= 12);
    case 'comments': return typeof v === 'string' && v.length <= 5000;
    case 'badges': return typeof v === 'string' && Boolean(BADGE_BY_ID[v]);
    case 'annotations': return typeof v === 'object' && stableStringify(v).length <= 20000;
    case 'tree': return typeof v === 'object' && !Array.isArray(v);
    case 'meta':
      if (!SHARED_META.includes(key)) return false;
      if (key === 'flags') return Array.isArray(v) && v.length <= 50 && v.every((f) => typeof f === 'string' && f.length <= 60);
      return (typeof v === 'string' && v.length <= 500) || (typeof v === 'number' && Number.isFinite(v));
    default: return false;
  }
}

// A delivery's patch, checked before anything touches the student's games.
// It arrived from another account; nothing in it is trusted until it passes.
export function parsePatch(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_PATCH) return null;
  let patch;
  try { patch = JSON.parse(raw); } catch { return null; }
  if (!patch || typeof patch !== 'object' || poisoned(patch)) return null;
  const { from, set } = patch;
  if (!from || typeof from !== 'object' || !set || typeof set !== 'object') return null;
  for (const [p, v] of Object.entries(set)) {
    if (!PATH_RE.test(p) || !validValue(p, v)) return null;
    if (typeof from[p] !== 'string') return null;
  }
  return { from, set };
}

export const validGameId = (id) => typeof id === 'string' && /^[a-z0-9]{6,24}$/.test(id);

// ---------------------------------------------------------------------------
// Student side: applying what a coach sent
// ---------------------------------------------------------------------------

const isSelf = (p) => (p.kind ?? 'self') === 'self';
// How big a section will be as a Firestore document. Pictures don't count:
// they're lifted out to their own documents on the way up (see blobs.js), so
// a scoresheet photo's megabytes never touch the 1 MiB limit — and counting
// them made a photo-heavy section look full, sending every new game to an
// overflow section and stopping the student's games reaching the coach.
const sizeOf = (x) => JSON.stringify(x, (k, v) => (
  typeof v === 'string' && v.startsWith('data:') ? 'data:' : v
)).length;

function newSection(id, name) {
  return {
    id,
    name,
    kind: 'self',
    profile: { uscf: '', fide: '', chesscom: '', lichess: '', rating: '' },
    avatar: { kind: 'monster', variant: defaultMonsterId(id) },
    games: [],
  };
}

function locate(players, gameId) {
  for (let i = 0; i < players.length; i += 1) {
    const j = (players[i].games ?? []).findIndex((g) => g.id === gameId);
    if (j >= 0) return { pi: i, gi: j };
  }
  return null;
}

// Applies coach game deliveries to the student's state.
//
//   deliveries — already filtered to ones the student has consented to (from
//                a coach with an active link, or accepted by hand), each
//                { id, fromUid, fromName, gameId, rev, resend, patch }
//   ledger     — the account-wide record of which games coaches have put
//                here: { games: { [gameId]: { c, r, at } } }. It's what
//                stops a game the student deleted from ever coming back.
//
// Returns the new state, the ledger entries to write in the same push, the
// delivery ids that are done with (every outcome consumes — a delivery is
// never applied twice or left to be retried forever), and what happened to
// each, for the "Gino added a game" note.
export function applyCoachGames(state, deliveries, { studentUid, ledger, now }) {
  let players = state.players ?? [];
  const ledgerWrites = {};
  const consumed = [];
  const outcomes = [];
  const known = { ...(ledger?.games ?? {}) };

  const ordered = [...deliveries].sort((a, b) => (a.gameId === b.gameId
    ? a.rev - b.rev
    : String(a.gameId).localeCompare(String(b.gameId))));

  for (const d of ordered) {
    consumed.push(d.id);
    const C = d.fromUid;
    const result = (outcome, extra = {}) => outcomes.push({
      deliveryId: d.id, gameId: d.gameId, outcome, fromName: d.fromName ?? '', ...extra,
    });

    const patch = validGameId(d.gameId) && Number.isFinite(d.rev) ? parsePatch(d.patch) : null;
    if (!patch) { result('invalid'); continue; }

    const at = locate(players, d.gameId);

    if (at) {
      const section = players[at.pi];
      // An id that belongs to one of the student's OWN coaching sections is
      // not a game about them. Leave it alone.
      if (!isSelf(section)) { result('refused'); continue; }
      const g = section.games[at.gi];
      // Only a game this coach put here can be corrected by them. A link is
      // opened by the coach alone, with no approval step, so "linked" can't
      // be what lets someone rewrite a game the student wrote themselves —
      // their own games are theirs, and a coach sees them read-only.
      if (g.addedBy?.uid !== C) { result('refused'); continue; }
      const mine = g.coach?.[C];
      if ((mine?.rev ?? 0) >= d.rev) { result('stale'); continue; }

      let next = g;
      const h = { ...(mine?.h ?? {}) };
      const prev = { ...(g.coachPrev ?? {}) };
      let changed = false;
      for (const [p, value] of Object.entries(patch.set)) {
        const cur = ph(getPath(next, p));
        const to = ph(value);
        const from = patch.from[p] ?? EMPTY;
        const coachSet = h[p];
        if (cur === to) { h[p] = to; continue; }
        if (cur === from || (coachSet !== undefined && cur === coachSet)) {
          // What the student had, so the correction can be undone from their
          // side: their own latest value (null if the field was empty), and
          // never a value a coach put there — replacing the coach's own
          // earlier correction keeps what the student had before that one.
          if (cur !== coachSet) {
            const old = getPath(next, p);
            prev[p] = isEmpty(old) ? null : old;
          }
          next = setPath(next, p, value);
          h[p] = to;
          changed = true;
        }
        // Anything else is a field the student changed since the coach last
        // saw it. Theirs stands.
      }
      next = { ...next, coach: { ...(g.coach ?? {}), [C]: { rev: d.rev, h } } };
      if (Object.keys(prev).length) next.coachPrev = prev;
      // updatedAt deliberately untouched: the student's own later edits must
      // still win a clash between the student's own devices.
      players = players.map((pl, i) => (i === at.pi
        ? { ...pl, games: pl.games.map((x, j) => (j === at.gi ? next : x)) }
        : pl));
      ledgerWrites[d.gameId] = { c: C, r: d.rev, at: now };
      known[d.gameId] = ledgerWrites[d.gameId];
      result(changed ? 'applied' : 'unchanged', { name: gameSummary(next) });
      continue;
    }

    // Not here. If a coach put it here before, the student deleted it — and
    // it stays deleted, unless the coach deliberately sent it again.
    if (known[d.gameId] && !d.resend) { result('gone'); continue; }
    if (!(Array.isArray(patch.set.moves) && patch.set.moves.length > 0)) { result('invalid'); continue; }

    let g = { id: d.gameId, name: 'Game', moves: [], comments: {}, badges: {}, date: now, meta: {} };
    const h = {};
    for (const [p, value] of Object.entries(patch.set)) {
      g = setPath(g, p, value);
      h[p] = ph(value);
    }
    if (!g.meta) g.meta = {};
    // Every list of games sorts by date; one without would sort as NaN.
    if (typeof g.date !== 'number') g.date = now;
    g = {
      ...g,
      addedBy: { uid: C, name: d.fromName ?? '' },
      coach: { [C]: { rev: d.rev, h } },
      updatedAt: d.rev,
    };

    // Into their first own section with room. A student who has none gets
    // one — kind 'self' from the start, so no "what is this section?"
    // prompt appears — and one that's full gets a section for this coach.
    let target = players.findIndex((pl) => isSelf(pl) && sizeOf(pl) < CARD_BUDGET);
    if (target < 0) {
      const anySelf = players.some(isSelf);
      const section = anySelf
        ? newSection(`coach-${C}`, `From ${d.fromName || 'your coach'}`)
        : newSection(`mygames-${studentUid}`, 'My games');
      const existing = players.findIndex((pl) => pl.id === section.id);
      if (existing >= 0) target = existing;
      else { players = [...players, section]; target = players.length - 1; }
    }
    players = players.map((pl, i) => (i === target ? { ...pl, games: [...(pl.games ?? []), g] } : pl));
    ledgerWrites[d.gameId] = { c: C, r: d.rev, at: now };
    known[d.gameId] = ledgerWrites[d.gameId];
    result('inserted', { name: gameSummary(g) });
  }

  // Belt and braces: one game, one place.
  const seen = new Set();
  const deduped = players.map((pl) => {
    const games = (pl.games ?? []).filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    return games.length === (pl.games ?? []).length ? pl : { ...pl, games };
  });
  if (deduped.some((pl, i) => pl !== players[i])) players = deduped;

  // Same object back when nothing changed, so a delivery that was stale or
  // refused doesn't make the app redraw and re-save everything.
  const touched = players !== (state.players ?? []);
  return {
    state: touched ? { ...state, players } : state,
    ledgerWrites,
    consumed,
    outcomes,
  };
}

// The student's "undo" for a coach's corrections: every field that still
// holds what a coach put there goes back to what the student had. A field the
// student has edited since is theirs already, and is left exactly as it is.
export function undoCoachChanges(game) {
  if (!game.coachPrev) return game;
  const coachValues = Object.values(game.coach ?? {}).map((c) => c?.h ?? {});
  let out = game;
  for (const [p, v] of Object.entries(game.coachPrev)) {
    const cur = ph(getPath(out, p));
    if (coachValues.some((h) => h[p] === cur)) out = setPath(out, p, v);
  }
  const next = { ...out };
  delete next.coachPrev;
  return next;
}

// ---------------------------------------------------------------------------
// Coach side: folding the student's games into the card
// ---------------------------------------------------------------------------

const hasPrivate = (g) => Boolean(g.meta?.photo || g.meta?.categoryId || g.meta?.notes
  || (Array.isArray(g.tags) && g.tags.length));

// A coach game from before the link and a student game that are plainly the
// same game: identical moves, long enough not to be a coincidence, the same
// date where both have one, and no shared field where they disagree.
function joinable(c, s) {
  const cm = c.moves ?? [];
  const sm = s.moves ?? [];
  if (cm.length < 10 || cm.length !== sm.length || cm.some((m, i) => m !== sm[i])) return false;
  const cd = c.meta?.date;
  const sd = s.meta?.date;
  if (cd && sd && cd !== sd) return false;
  for (const p of new Set([...pathsOf(c), ...pathsOf(s)])) {
    const a = getPath(c, p);
    const b = getPath(s, p);
    if (!isEmpty(a) && !isEmpty(b) && ph(a) !== ph(b)) return false;
  }
  return true;
}

// Folds the student's own games into the coach's card for them.
//
//   card      — the coach's player record for this student
//   games     — the student's games, from their own sections only
//   complete  — the snapshot came from the server, not a cache: only then
//               can a game's absence mean the student removed it
//   ledger    — the student's coachGames ledger, as read
//
// Returns the card (the same object if nothing changed — the caller skips a
// dispatch on that), and any games that didn't fit the card's size budget.
export function mergeLinkedGames(card, {
  studentUid, coachUid, games, complete, ledger, now,
}) {
  const hidden = card.hiddenLinkedGames ?? {};
  let list = card.games ?? [];
  let changed = false;
  // The first time a card is folded together with the student's account,
  // everything they already had comes across at once — that's history, not
  // news. Only games arriving after that are marked new for the coach.
  const primed = Boolean(card.linkPrimed);
  const overflow = [];
  const studentById = new Map(games.map((s) => [s.id, s]));

  // Pre-link duplicates, matched one-to-one in both directions.
  const unlinked = list.filter((c) => !c.link && !studentById.has(c.id));
  const candidates = new Map();
  for (const s of games) {
    if (hidden[s.id] || list.some((c) => c.id === s.id)) continue;
    const m = unlinked.filter((c) => joinable(c, s));
    if (m.length === 1) candidates.set(s.id, m[0]);
  }
  const claimed = new Map();
  for (const [sid, c] of candidates) claimed.set(c.id, (claimed.get(c.id) ?? []).concat(sid));

  for (const s of games) {
    if (hidden[s.id]) continue;
    const idx = list.findIndex((c) => c.id === s.id);
    const studentRev = Math.max(s.coach?.[coachUid]?.rev ?? 0, ledger?.games?.[s.id]?.r ?? 0);

    if (idx < 0) {
      const dup = candidates.get(s.id);
      if (dup && claimed.get(dup.id)?.length === 1) {
        // Joined: the student's id, each shared field from the student's
        // copy where it has one and the coach's otherwise, the coach's
        // private fields untouched. Fields the coach filled in are left
        // pending and go out as patches that can only fill blanks.
        let joined = { ...dup, id: s.id };
        for (const p of new Set([...pathsOf(dup), ...pathsOf(s)])) {
          const sv = getPath(s, p);
          if (!isEmpty(sv)) joined = setPath(joined, p, sv);
        }
        joined.link = { uid: studentUid, origin: 'student', base: hashesOf(s), seen: true, sent: null };
        list = list.filter((c) => c.id !== dup.id).concat(joined);
        changed = true;
        continue;
      }
      if (sizeOf({ ...card, games: list }) + sizeOf(s) > CARD_BUDGET) { overflow.push(s); continue; }
      const copy = sharedCopy(s);
      copy.updatedAt = s.updatedAt ?? now;
      copy.link = { uid: studentUid, origin: 'student', base: hashesOf(s), seen: true, sent: null };
      // A game the student added since the coach last looked: the bell.
      if (primed) copy.link.unseen = now;
      list = [copy, ...list];
      changed = true;
      continue;
    }

    const c = list[idx];
    const link = c.link ?? { uid: studentUid, base: {}, seen: false, sent: null };
    const base = { ...(link.base ?? {}) };
    let next = c;
    let lost = [...(link.lost ?? [])];
    for (const p of new Set([...pathsOf(c), ...pathsOf(s), ...Object.keys(base)])) {
      const r = ph(getPath(s, p));
      const l = ph(getPath(next, p));
      const b = base[p] ?? EMPTY;
      if (r === b) continue; // they haven't changed it; the coach's value stands
      if (link.origin === 'student') {
        // Their own game: whatever they change is the game. The coach's own
        // edits to their copy of it were never going anywhere.
        next = setPath(next, p, getPath(s, p));
        base[p] = r;
        continue;
      }
      if (l === r) { base[p] = r; continue; } // already agree
      if (link.sent?.h?.[p] === r) {
        // What they hold is what the coach last sent — their app applied it —
        // and the coach has changed it again since (or back). The coach's
        // value stands, and the next patch starts from what they now have.
        base[p] = r;
        continue;
      }
      if (l === b) { // only they changed it
        next = setPath(next, p, getPath(s, p));
        base[p] = r;
        continue;
      }
      if (link.sent?.h?.[p] === l && studentRev >= (link.sent?.rev ?? Infinity)) {
        // Their app has seen the coach's version of this field and kept its
        // own: the student's value wins, and the coach is told.
        next = setPath(next, p, getPath(s, p));
        base[p] = r;
        if (!lost.includes(p)) lost.push(p);
      }
      // Otherwise the coach's change is still on its way. Leave it.
    }
    for (const p of Object.keys(base)) if (base[p] === EMPTY) delete base[p];
    // Seen in their account right now, so whatever marked it gone is over —
    // and a "Send again" has done its job.
    const nextLink = { ...link, base, seen: true };
    delete nextLink.gone;
    delete nextLink.resend;
    if (lost.length) nextLink.lost = lost; else delete nextLink.lost;
    if (next !== c || stableStringify(nextLink) !== stableStringify(c.link ?? null)) {
      next = { ...next, link: nextLink };
      list = list.map((x, i) => (i === idx ? next : x));
      changed = true;
    }
  }

  // Games on the card that the student's account no longer has. Only a
  // complete (server) snapshot can say that — a cache can simply be behind.
  if (complete) {
    const missing = list.filter((c) => c.link?.uid === studentUid && !c.link.gone
      // A game being sent again is expected to be absent until it lands.
      && !c.link.resend
      && !studentById.has(c.id)
      && (c.link.seen || ledger?.games?.[c.id]));
    const linkedCount = list.filter((c) => c.link?.uid === studentUid).length;
    // One snapshot removing a lot at once is more likely a glitch than a
    // student clearing out their games. Nothing is removed then — only
    // marked, for the coach to decide.
    // A student deleting one or two of their own games is ordinary; three or
    // more at once, and most of what's linked, is the pattern of a snapshot
    // that came back short.
    const tooMany = missing.length > 5 || (missing.length >= 3 && missing.length > linkedCount / 2);
    if (missing.length) {
      const drop = new Set();
      list = list.map((c) => {
        if (!missing.includes(c)) return c;
        // Their own game, untouched here, deleted there: the mirror follows.
        // A game the coach typed in is the coach's record too — it stays on
        // the card, marked, however the student's account changes.
        const theirs = !c.link.sent && !c.link.resend;
        const clean = buildPatch(c).pending.length === 0 && !hasPrivate(c);
        if (theirs && clean && !tooMany) { drop.add(c.id); return c; }
        return { ...c, link: { ...c.link, gone: true } };
      }).filter((c) => !drop.has(c.id));
      changed = true;
    }
  }

  if (!changed && primed) return { card, overflow };
  return { card: { ...card, games: list, linkPrimed: true }, overflow };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

// One word for where a game on a linked card stands.
export function gameLinkStatus(game, { linkActive, inFlight, failed }) {
  const link = game.link;
  if (!link) return 'only-card';
  if (!linkActive) return 'link-ended';
  if (link.gone) return 'gone';
  if (failed) return 'failed';
  if (!(game.moves?.length > 0)) return 'needs-moves';
  if (inFlight) return 'sending';
  const { patch, pending } = buildPatch(game);
  if (link.lost?.length) return 'kept-theirs';
  if (link.origin === 'student') return 'theirs';
  if (pending.length) return patchHash(patch) === link.sent?.ph ? 'waiting' : 'queued';
  return 'in-account';
}

export function gameSummary(game) {
  const m = game.meta ?? {};
  const players = m.white || m.black ? `${m.white || '?'} vs ${m.black || '?'}` : (game.name || 'Game');
  const bits = [players];
  if (m.event) bits.push(m.round ? `${m.event} R${m.round}` : m.event);
  return bits.join(' · ');
}

// Games on linked cards that arrived from the student since the coach last
// opened that card — what the coach's bell counts.
export function unseenStudentGames(players) {
  const out = [];
  for (const card of players ?? []) {
    if (card.kind !== 'student') continue;
    for (const g of card.games ?? []) {
      if (g.link?.unseen) out.push({ card, game: g, at: g.link.unseen });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
