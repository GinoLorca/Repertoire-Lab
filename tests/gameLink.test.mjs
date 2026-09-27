// Games shared between a coach and a linked student — src/lib/cloud/gameLink.js.
// Grouped by the promise each test holds the code to: S for the student's
// account, C for the coach's card, P for patches, and a round-trip
// simulation at the end that runs both sides against each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCoachGames, mergeLinkedGames, buildPatch, needsSend, nextRev, parsePatch,
  patchHash, ph, hashesOf, getPath, stableStringify, undoCoachChanges, gameLinkStatus,
} from '../src/lib/cloud/gameLink.js';
import { encodeForStore, decodeFromStore } from '../src/lib/cloud/shape.js';

const S = 'studentuid';
const C = 'coachuid';
const NOW = 1_800_000_000_000;
const moves = (n = 12) => Array.from({ length: n }, (_, i) => (i % 2 ? 'e5' : 'e4'));

const game = (id, extra = {}) => ({
  id, name: 'Game', moves: moves(), comments: {}, badges: {}, date: 100,
  meta: { white: 'Parker', black: 'Smith', result: '1-0' }, ...extra,
});
const self = (games, id = 'me') => ({ id, name: 'My games', kind: 'self', games });
const studentState = (players) => ({ players, openings: [], settings: {} });

// A coach game as it would sit on a linked card, and the delivery its patch
// would travel in.
const linked = (g, link = {}) => ({ ...g, link: { uid: S, base: {}, seen: false, sent: null, ...link } });
const delivery = (coachGame, { rev = NOW, id = `lg_${coachGame.id}_${rev}`, resend = false } = {}) => ({
  id, fromUid: C, fromName: 'Gino', gameId: coachGame.id, rev, resend,
  patch: JSON.stringify(buildPatch(coachGame).patch),
});
// A game the coach put in the student's account earlier — the only kind a
// coach may later correct.
const fromCoach = (g) => ({ ...g, addedBy: { uid: C, name: 'Gino' }, coach: { [C]: { rev: 1, h: hashesOf(g) } } });
const apply = (state, ds, ledger = { games: {} }) => applyCoachGames(state, ds, { studentUid: S, ledger, now: NOW });
const allGames = (st) => st.players.flatMap((p) => p.games);

// ---------------------------------------------------------------------------
// S — the student's account
// ---------------------------------------------------------------------------

test('S: a coach game arrives in the student\'s own games, same id, marked as added by the coach', () => {
  const cg = linked(game('abc123'));
  const out = apply(studentState([self([])]), [delivery(cg)]);
  const g = allGames(out.state)[0];
  assert.equal(g.id, 'abc123');
  assert.deepEqual(g.moves, cg.moves);
  assert.equal(g.meta.white, 'Parker');
  assert.deepEqual(g.addedBy, { uid: C, name: 'Gino' });
  assert.equal(out.outcomes[0].outcome, 'inserted');
  assert.equal(out.ledgerWrites.abc123.c, C);
  assert.deepEqual(out.consumed, [`lg_abc123_${NOW}`]);
});

test('S1: applying never removes a game or a section', () => {
  const st = studentState([self([game('mine01')]), { id: 'kid', kind: 'student', games: [game('kid001')] }]);
  const out = apply(st, [delivery(linked(game('abc123')))]);
  assert.equal(out.state.players.length, 2);
  assert.ok(allGames(out.state).some((g) => g.id === 'mine01'));
  assert.ok(allGames(out.state).some((g) => g.id === 'kid001'));
});

test('S2: a field the student changed since the coach last saw it is never overwritten', () => {
  const original = game('abc123', { meta: { white: 'Parker', black: 'Smith', result: '1-0' } });
  // The coach last saw result 1-0 and changes it to 0-1; the student had
  // meanwhile corrected it to ½-½.
  const coachGame = linked({ ...original, meta: { ...original.meta, result: '0-1' } }, { base: hashesOf(original) });
  const studentGame = fromCoach({ ...original, meta: { ...original.meta, result: '1/2-1/2' } });
  studentGame.coach[C].h = hashesOf(original);
  const out = apply(studentState([self([studentGame])]), [delivery(coachGame)]);
  assert.equal(allGames(out.state)[0].meta.result, '1/2-1/2');
});

test('S2: a field the student left alone takes the coach\'s correction', () => {
  const original = game('abc123');
  const coachGame = linked({ ...original, meta: { ...original.meta, black: 'Smithson' } }, { base: hashesOf(original) });
  const out = apply(studentState([self([fromCoach(original)])]), [delivery(coachGame)]);
  assert.equal(allGames(out.state)[0].meta.black, 'Smithson');
  assert.equal(out.outcomes[0].outcome, 'applied');
});

test('S3: the student\'s notes, tags, category, photo and updatedAt are never touched', () => {
  const original = game('abc123', {
    meta: { white: 'Parker', black: 'Smith', notes: 'mine', photo: 'data:x', categoryId: 'cat' },
    tags: ['tournament'], updatedAt: 42,
  });
  const coachGame = linked({ ...original, meta: { ...original.meta, black: 'Smithson', notes: 'COACH NOTES' }, tags: ['coach'] }, { base: hashesOf(original) });
  const g = allGames(apply(studentState([self([{ ...fromCoach(original), updatedAt: 42 }])]), [delivery(coachGame)]).state)[0];
  assert.equal(g.meta.notes, 'mine');
  assert.equal(g.meta.photo, 'data:x');
  assert.equal(g.meta.categoryId, 'cat');
  assert.deepEqual(g.tags, ['tournament']);
  assert.equal(g.updatedAt, 42);
  assert.equal(g.meta.black, 'Smithson');
});

test('S4: applying the same delivery twice changes nothing the second time', () => {
  const d = delivery(linked(game('abc123')));
  const once = apply(studentState([self([])]), [d]);
  const twice = apply(once.state, [d], { games: once.ledgerWrites });
  assert.equal(twice.state, once.state);
  assert.equal(twice.outcomes[0].outcome, 'stale');
});

test('S5: rev 2 then rev 1 lands the same as rev 2 alone', () => {
  const base = game('abc123');
  const v2 = linked({ ...base, name: 'v2' });
  const v1 = linked({ ...base, name: 'v1' });
  const both = apply(studentState([self([])]), [delivery(v2, { rev: NOW + 2 }), delivery(v1, { rev: NOW + 1 })]);
  const alone = apply(studentState([self([])]), [delivery(v2, { rev: NOW + 2 })]);
  assert.equal(allGames(both.state)[0].name, allGames(alone.state)[0].name);
});

test('S6: a game the student deleted is never brought back — unless the coach sends it again on purpose', () => {
  const cg = linked(game('abc123'));
  const ledger = { games: { abc123: { c: C, r: NOW - 5, at: NOW - 5 } } };
  const gone = apply(studentState([self([])]), [delivery(cg)], ledger);
  assert.equal(allGames(gone.state).length, 0);
  assert.equal(gone.outcomes[0].outcome, 'gone');
  const resent = apply(studentState([self([])]), [delivery(cg, { resend: true })], ledger);
  assert.equal(allGames(resent.state).length, 1);
});

test('S7: an id that lives in one of the student\'s own coaching sections is refused', () => {
  const st = studentState([self([]), { id: 'kid', kind: 'student', games: [game('abc123')] }]);
  const out = apply(st, [delivery(linked(game('abc123', { name: 'hijack' })))]);
  assert.equal(out.outcomes[0].outcome, 'refused');
  assert.equal(out.state, st);
});

test('S8: a student with no section of their own gets exactly one "My games", kind self', () => {
  const out = apply(studentState([]), [delivery(linked(game('abc123'))), delivery(linked(game('def456')))]);
  assert.equal(out.state.players.length, 1);
  assert.equal(out.state.players[0].id, `mygames-${S}`);
  assert.equal(out.state.players[0].kind, 'self');
  assert.equal(out.state.players[0].games.length, 2);
});

test('S8: a full section overflows into one for this coach', () => {
  const full = self([game('big001', { comments: { 1: 'x'.repeat(4000) } })]);
  full.games = Array.from({ length: 200 }, (_, i) => game(`big${String(i).padStart(3, '0')}`, { comments: { 1: 'x'.repeat(4000) } }));
  const out = apply(studentState([full]), [delivery(linked(game('abc123')))]);
  assert.ok(out.state.players.some((p) => p.id === `coach-${C}` && p.games[0].id === 'abc123'));
});

// The student fixed the opponent's name themselves (Smyth); the coach, having
// seen that, corrects it to Smithson.
const studentFixed = () => {
  const original = fromCoach(game('abc123'));
  const theirs = { ...original, meta: { ...original.meta, black: 'Smyth' } };
  const coachGame = linked({ ...theirs, meta: { ...theirs.meta, black: 'Smithson' } }, { base: hashesOf(theirs) });
  return { theirs, coachGame };
};

test('S9: a coach correction can be undone, back to the student\'s own value', () => {
  const { theirs, coachGame } = studentFixed();
  const g = allGames(apply(studentState([self([theirs])]), [delivery(coachGame)]).state)[0];
  assert.equal(g.meta.black, 'Smithson');
  assert.equal(g.coachPrev['meta:black'], 'Smyth');
  const undone = undoCoachChanges(g);
  assert.equal(undone.meta.black, 'Smyth');
  assert.equal(undone.coachPrev, undefined);
});

test('S9: undo never wipes something the student changed after the correction', () => {
  const { theirs, coachGame } = studentFixed();
  const g = allGames(apply(studentState([self([theirs])]), [delivery(coachGame)]).state)[0];
  const editedAgain = { ...g, meta: { ...g.meta, black: 'Smithers' } };
  assert.equal(undoCoachChanges(editedAgain).meta.black, 'Smithers');
});

test('S9: a second correction still remembers the student\'s own value, not the coach\'s first one', () => {
  const { theirs, coachGame } = studentFixed();
  const once = allGames(apply(studentState([self([theirs])]), [delivery(coachGame)]).state)[0];
  const again = linked({ ...once, meta: { ...once.meta, black: 'Smithsonian' } }, { base: hashesOf(once) });
  const twice = allGames(apply(studentState([self([once])]), [delivery(again, { rev: NOW + 5 })]).state)[0];
  assert.equal(twice.meta.black, 'Smithsonian');
  assert.equal(twice.coachPrev['meta:black'], 'Smyth');
});

test('S11: a coach can never change a game the student wrote themselves', () => {
  const theirOwn = game('abc123', { meta: { white: 'Parker', black: 'Smith', result: '1-0' } });
  const attempt = linked({ ...theirOwn, meta: { ...theirOwn.meta, result: '0-1' } }, { base: hashesOf(theirOwn) });
  const out = apply(studentState([self([theirOwn])]), [delivery(attempt)]);
  assert.equal(out.outcomes[0].outcome, 'refused');
  assert.equal(allGames(out.state)[0].meta.result, '1-0');
});

test('S10: malformed, poisoned and oversized patches are rejected and consumed', () => {
  const bad = (patch, extra = {}) => ({
    id: `x${Math.random()}`, fromUid: C, fromName: 'G', gameId: 'abc123', rev: NOW, patch, ...extra,
  });
  const cases = [
    bad('not json'),
    bad(JSON.stringify({ from: {}, set: { 'meta:notes': 'private field' } })),
    bad(JSON.stringify({ from: { moves: '∅' }, set: { moves: ['e4', 5] } })),
    bad('{"from":{"__proto__":{"x":1}},"set":{}}'),
    bad(JSON.stringify({ from: { moves: '∅' }, set: { moves: moves() } }), { gameId: '../../etc' }),
    bad('x'.repeat(900001)),
  ];
  const out = apply(studentState([self([])]), cases);
  assert.equal(allGames(out.state).length, 0);
  assert.ok(out.outcomes.every((o) => o.outcome === 'invalid'));
  assert.equal(out.consumed.length, cases.length);
});

test('S: a photo-only game (no moves) is never inserted', () => {
  const photoOnly = linked(game('abc123', { moves: [] }));
  const out = apply(studentState([self([])]), [delivery(photoOnly)]);
  assert.equal(allGames(out.state).length, 0);
});

// ---------------------------------------------------------------------------
// C — the coach's card
// ---------------------------------------------------------------------------

const card = (games, extra = {}) => ({
  id: 'card1', name: 'Parker', kind: 'student', profile: { linkedUid: S }, games, ...extra,
});
const mirror = (c, games, extra = {}) => mergeLinkedGames(c, {
  studentUid: S, coachUid: C, games, complete: true, ledger: { games: {} }, now: NOW, ...extra,
});

test('C: a game the student added shows up on the coach\'s card, same id', () => {
  const s = game('stu001', { meta: { white: 'Parker', black: 'Lee', notes: 'student private' } });
  const out = mirror(card([]), [s]);
  const g = out.card.games[0];
  assert.equal(g.id, 'stu001');
  assert.equal(g.meta.black, 'Lee');
  assert.equal(g.meta.notes, undefined, 'the student\'s private notes don\'t cross');
  assert.equal(gameLinkStatus(g, { linkActive: true }), 'theirs');
});

test('C1: the coach\'s private fields are never changed by the student\'s copy', () => {
  const s = game('stu001');
  const first = mirror(card([]), [s]).card;
  const withNotes = card(first.games.map((g) => ({ ...g, meta: { ...g.meta, notes: 'coach only', photo: 'data:p' }, tags: ['x'] })));
  const edited = { ...s, meta: { ...s.meta, black: 'Changed' } };
  const g = mirror(withNotes, [edited]).card.games[0];
  assert.equal(g.meta.notes, 'coach only');
  assert.equal(g.meta.photo, 'data:p');
  assert.deepEqual(g.tags, ['x']);
  assert.equal(g.meta.black, 'Changed');
});

test('C2: nothing changed → the same card object comes back', () => {
  const s = game('stu001');
  const once = mirror(card([]), [s]).card;
  assert.equal(mirror(once, [s]).card, once);
});

test('C3: folding the student\'s games in never creates something new to send (no echo)', () => {
  const s = game('stu001');
  const once = mirror(card([]), [s]).card;
  assert.equal(buildPatch(once.games[0]).pending.length, 0);
  const edited = { ...s, meta: { ...s.meta, result: '0-1' } };
  const twice = mirror(once, [edited]).card;
  assert.equal(buildPatch(twice.games[0]).pending.length, 0);
  assert.equal(needsSend(twice.games[0], { linkActive: true }), false);
});

test('C4: a student deleting their own game takes it off the card — but only from a complete snapshot', () => {
  const s = game('stu001');
  const once = mirror(card([]), [s]).card;
  assert.equal(mirror(once, [], { complete: false }).card.games.length, 1, 'a cache can just be behind');
  assert.equal(mirror(once, []).card.games.length, 0);
});

test('C4: a game the coach typed in stays on the card when the student deletes it — marked', () => {
  const cg = linked(game('coa001'), { seen: true, sent: { rev: NOW, ph: 'x', h: {} } });
  const out = mirror(card([cg]), []);
  assert.equal(out.card.games.length, 1);
  assert.equal(out.card.games[0].link.gone, true);
  assert.equal(gameLinkStatus(out.card.games[0], { linkActive: true }), 'gone');
});

test('C4: a snapshot that would remove lots at once only marks them', () => {
  const ss = Array.from({ length: 8 }, (_, i) => game(`stu00${i}`));
  const once = mirror(card([]), ss).card;
  const out = mirror(once, []);
  assert.equal(out.card.games.length, 8);
  assert.ok(out.card.games.every((g) => g.link.gone));
});

test('C4: a game with the coach\'s own notes on it is marked, never removed', () => {
  const s = game('stu001');
  const once = mirror(card([]), [s]).card;
  const annotated = card(once.games.map((g) => ({ ...g, meta: { ...g.meta, notes: 'my notes' } })));
  const out = mirror(annotated, []);
  assert.equal(out.card.games.length, 1);
  assert.equal(out.card.games[0].link.gone, true);
});

test('C5: games past the card\'s size budget are listed, not stuffed in', () => {
  const huge = Array.from({ length: 300 }, (_, i) => game(`s${String(i).padStart(5, '0')}`, { comments: { 1: 'x'.repeat(3000) } }));
  const out = mirror(card([]), huge);
  assert.ok(out.overflow.length > 0);
  assert.ok(JSON.stringify(out.card).length < 800000);
});

test('C6: a game the coach removed from the card is never re-imported', () => {
  const s = game('stu001');
  const out = mirror(card([], { hiddenLinkedGames: { stu001: NOW } }), [s]);
  assert.equal(out.card.games.length, 0);
});

test('C7: an exact pre-link duplicate is joined, not doubled — and no non-empty value changes', () => {
  const coachCopy = game('old001', { meta: { white: 'Parker', black: 'Smith', result: '1-0', notes: 'coach notes', event: 'Club Open' } });
  const studentCopy = game('stu001', { meta: { white: 'Parker', black: 'Smith', result: '1-0' } });
  const out = mirror(card([coachCopy]), [studentCopy]).card;
  assert.equal(out.games.length, 1);
  const g = out.games[0];
  assert.equal(g.id, 'stu001');
  assert.equal(g.meta.notes, 'coach notes');
  assert.equal(g.meta.event, 'Club Open', 'the coach\'s extra detail is kept on the card');
  assert.equal(needsSend(g, { linkActive: true }), false, 'but it\'s the student\'s game: nothing is sent into it');
  assert.equal(gameLinkStatus(g, { linkActive: true }), 'theirs');
});

test('C7: games that merely look alike are never joined', () => {
  const coachCopy = game('old001', { moves: moves(8) });
  const studentCopy = game('stu001', { moves: moves(8) });
  assert.equal(mirror(card([coachCopy]), [studentCopy]).card.games.length, 2, 'too short to be sure');
  const conflicting = game('old002', { meta: { white: 'Parker', black: 'Jones' } });
  assert.equal(mirror(card([conflicting]), [studentCopy]).card.games.length, 2, 'they disagree about a field');
});

// ---------------------------------------------------------------------------
// P — patches
// ---------------------------------------------------------------------------

test('P1: a patch never carries anything private', () => {
  const g = linked(game('abc123', { meta: { white: 'P', notes: 'secret', photo: 'data:x', categoryId: 'c' }, tags: ['t'] }));
  const raw = JSON.stringify(buildPatch(g).patch);
  assert.ok(!/secret|data:x|categoryId|"tags"|notes/.test(raw));
});

test('P2: photo-only games and private-only edits send nothing', () => {
  assert.equal(needsSend(linked(game('abc123', { moves: [] })), { linkActive: true }), false);
  const g = game('abc123');
  const synced = linked(g, { base: hashesOf(g) });
  const privateEdit = { ...synced, meta: { ...synced.meta, notes: 'only mine' }, tags: ['x'] };
  assert.equal(needsSend(privateEdit, { linkActive: true }), false);
});

test('P2: nothing is sent while the link isn\'t active, or twice for the same patch', () => {
  const g = linked(game('abc123'));
  assert.equal(needsSend(g, { linkActive: false }), false);
  assert.equal(needsSend(g, { linkActive: true }), true);
  const sent = { ...g, link: { ...g.link, sent: { rev: NOW, ph: patchHash(buildPatch(g).patch), h: {} } } };
  assert.equal(needsSend(sent, { linkActive: true }), false);
});

test('P3: revisions strictly increase', () => {
  assert.ok(nextRev(100, 100, 50) > 100);
  assert.ok(nextRev(100, 50, 200) > 200);
  assert.equal(nextRev(1000, 5, 5), 1000);
});

test('P4: a value\'s fingerprint survives Firestore\'s encoding and key order', () => {
  const value = { tree: { root: { children: [['n1', 'n2']] } }, variationHighlights: { n1: 'green' } };
  const round = decodeFromStore(JSON.parse(JSON.stringify(encodeForStore(value))));
  assert.equal(ph(round), ph(value));
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.equal(ph(null), ph(''));
  assert.equal(ph([]), ph({}));
});

test('P: the patch survives being sent and parsed', () => {
  const g = linked(game('abc123', { comments: { 3: 'good move' }, badges: { 3: 'best' } }));
  const parsed = parsePatch(JSON.stringify(buildPatch(g).patch));
  assert.ok(parsed);
  assert.equal(parsed.set['comments:3'], 'good move');
});

test('P: a game with a starting-position comment (key -1, a PGN\'s intro and its arrows) still reaches the student', () => {
  const g = linked(game('abc123', { comments: { [-1]: 'The idea [%cal Ge2e4]', 3: 'good move [%csl Ye5]' } }));
  const parsed = parsePatch(JSON.stringify(buildPatch(g).patch));
  assert.ok(parsed);
  assert.equal(parsed.set['comments:-1'], 'The idea [%cal Ge2e4]');
  const out = apply(studentState([self([])]), [delivery(g)]);
  assert.equal(out.outcomes[0].outcome, 'inserted');
  assert.equal(allGames(out.state)[0].comments[-1], 'The idea [%cal Ge2e4]');
  assert.equal(allGames(out.state)[0].comments[3], 'good move [%csl Ye5]');
  // …and only -1: anything else below zero is still refused.
  assert.equal(parsePatch(JSON.stringify({ ...buildPatch(g).patch, set: { 'comments:-2': 'x' } })), null);
});

// ---------------------------------------------------------------------------
// Round trip: both sides, against each other
// ---------------------------------------------------------------------------

// A little world: the coach's card, one student account (two devices would
// share it through ordinary sync, which merge3 already covers), a mailbox
// and the ledger. `coachSend` mails every pending patch; `studentSync`
// applies the mail; `coachSees` folds the student's account back in.
function world(initialStudentGames = []) {
  const w = {
    card: card([]),
    student: studentState([self(initialStudentGames)]),
    ledger: { games: {} },
    mailbox: [],
    clock: NOW,
  };
  w.coachSend = () => {
    w.card = {
      ...w.card,
      games: w.card.games.map((g) => {
        if (!needsSend(g, { linkActive: true })) return g;
        const studentGame = allGames(w.student).find((x) => x.id === g.id);
        const studentRev = Math.max(studentGame?.coach?.[C]?.rev ?? 0, w.ledger.games[g.id]?.r ?? 0);
        w.clock += 1;
        const rev = nextRev(w.clock, g.link.sent?.rev ?? 0, studentRev);
        const { patch } = buildPatch(g);
        w.mailbox.push({
          id: `lg_${C}_${g.id}_${rev}`, fromUid: C, fromName: 'Gino', gameId: g.id, rev,
          resend: Boolean(g.link.resend), patch: JSON.stringify(patch),
        });
        const h = Object.fromEntries(Object.entries(patch.set).map(([p, v]) => [p, ph(v)]));
        return { ...g, link: { ...g.link, sent: { rev, ph: patchHash(patch), h } } };
      }),
    };
  };
  w.studentSync = () => {
    const out = applyCoachGames(w.student, w.mailbox, { studentUid: S, ledger: w.ledger, now: w.clock });
    w.student = out.state;
    w.ledger = { games: { ...w.ledger.games, ...out.ledgerWrites } };
    w.mailbox = w.mailbox.filter((d) => !out.consumed.includes(d.id));
    return out;
  };
  w.coachSees = () => {
    w.card = mergeLinkedGames(w.card, {
      studentUid: S, coachUid: C, games: allGames(w.student), complete: true, ledger: w.ledger, now: w.clock,
    }).card;
  };
  w.cycle = () => { w.coachSend(); w.studentSync(); w.coachSees(); };
  w.coachGame = (id) => w.card.games.find((g) => g.id === id);
  w.studentGame = (id) => allGames(w.student).find((g) => g.id === id);
  w.editCoach = (id, fn) => { w.card = { ...w.card, games: w.card.games.map((g) => (g.id === id ? fn(g) : g)) }; };
  w.editStudent = (id, fn) => {
    w.student = { ...w.student, players: w.student.players.map((p) => ({ ...p, games: p.games.map((g) => (g.id === id ? fn(g) : g)) })) };
  };
  return w;
}

test('round trip: the coach adds a game → it reaches the student → both agree, nothing left to send', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.cycle();
  assert.ok(w.studentGame('abc123'));
  assert.equal(gameLinkStatus(w.coachGame('abc123'), { linkActive: true }), 'in-account');
  w.cycle();
  assert.equal(w.mailbox.length, 0);
  assert.equal(allGames(w.student).length, 1);
});

test('round trip: both sides edit different fields — both edits end up on both sides', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.cycle();
  w.editCoach('abc123', (g) => ({ ...g, meta: { ...g.meta, event: 'Club Open' } }));
  w.editStudent('abc123', (g) => ({ ...g, meta: { ...g.meta, round: '3' } }));
  w.cycle(); w.cycle();
  assert.equal(w.studentGame('abc123').meta.event, 'Club Open');
  assert.equal(w.studentGame('abc123').meta.round, '3');
  assert.equal(w.coachGame('abc123').meta.event, 'Club Open');
  assert.equal(w.coachGame('abc123').meta.round, '3');
  assert.equal(w.mailbox.length, 0);
});

test('round trip: both sides change the same field — the student\'s value wins everywhere, and the coach is told', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.cycle();
  w.editStudent('abc123', (g) => ({ ...g, meta: { ...g.meta, result: '1/2-1/2' } }));
  w.editCoach('abc123', (g) => ({ ...g, meta: { ...g.meta, result: '0-1' } }));
  w.cycle(); w.cycle();
  assert.equal(w.studentGame('abc123').meta.result, '1/2-1/2');
  assert.equal(w.coachGame('abc123').meta.result, '1/2-1/2');
  assert.ok(w.coachGame('abc123').link.lost?.includes('meta:result'));
});

test('round trip: the student deletes the coach\'s game → a later coach edit doesn\'t bring it back; Send again does', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.cycle();
  w.student = studentState([self([])]);
  w.coachSees();
  assert.equal(w.coachGame('abc123').link.gone, true);
  w.editCoach('abc123', (g) => ({ ...g, meta: { ...g.meta, event: 'edited' }, link: { ...g.link, gone: false } }));
  w.coachSend(); w.studentSync();
  assert.equal(w.studentGame('abc123'), undefined);
  w.editCoach('abc123', (g) => ({ ...g, link: { uid: S, base: {}, seen: false, sent: null, resend: true } }));
  w.cycle();
  assert.ok(w.studentGame('abc123'));
});

test('round trip: the student adds a game → it shows on the card, and nothing is sent back', () => {
  const w = world([game('stu001')]);
  w.cycle();
  assert.ok(w.coachGame('stu001'));
  assert.equal(w.mailbox.length, 0);
  w.cycle();
  assert.equal(w.mailbox.length, 0);
});

test('round trip: deliveries arriving out of order still end at the newest', () => {
  const w = world();
  w.card = card([linked(game('abc123', { name: 'first' }))]);
  w.coachSend();
  w.editCoach('abc123', (g) => ({ ...g, name: 'second' }));
  w.coachSend();
  w.mailbox.reverse();
  w.studentSync();
  assert.equal(w.studentGame('abc123').name, 'second');
});

test('round trip: the same delivery applied by two of the student\'s devices → one game', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.coachSend();
  const mail = [...w.mailbox];
  const deviceA = applyCoachGames(w.student, mail, { studentUid: S, ledger: w.ledger, now: NOW });
  const deviceB = applyCoachGames(w.student, mail, { studentUid: S, ledger: w.ledger, now: NOW });
  // The devices then sync with each other; merge3 is exercised elsewhere, so
  // here it's enough that both produced the same game under the same id.
  assert.equal(allGames(deviceA.state).length, 1);
  assert.equal(getPath(allGames(deviceA.state)[0], 'moves').length, getPath(allGames(deviceB.state)[0], 'moves').length);
  assert.equal(allGames(deviceA.state)[0].id, allGames(deviceB.state)[0].id);
});

// ---------------------------------------------------------------------------
// Found in review
// ---------------------------------------------------------------------------

test('review: a coach who changes a field back after sending it — the change back goes too', () => {
  const w = world();
  w.card = card([linked(game('abc123', { meta: { white: 'Parker', black: 'Smith', result: '1-0' } }))]);
  w.cycle();
  // The coach changes the result, it's sent, and before the student's app
  // picks it up the coach changes it back.
  w.editCoach('abc123', (g) => ({ ...g, meta: { ...g.meta, result: '0-1' } }));
  w.coachSend();
  w.editCoach('abc123', (g) => ({ ...g, meta: { ...g.meta, result: '1-0' } }));
  w.studentSync(); // applies the 0-1 patch
  w.coachSees();
  assert.equal(w.coachGame('abc123').meta.result, '1-0', 'the coach\'s card keeps the coach\'s latest value');
  w.cycle(); w.cycle();
  assert.equal(w.studentGame('abc123').meta.result, '1-0', 'and the student\'s account follows it back');
  assert.equal(w.mailbox.length, 0);
});

test('review: "Send again" isn\'t cancelled by the next snapshot while it\'s on its way', () => {
  const w = world();
  w.card = card([linked(game('abc123'))]);
  w.cycle();
  w.student = studentState([self([])]); // the student deleted it
  w.coachSees();
  w.editCoach('abc123', (g) => ({ ...g, link: { uid: S, base: {}, seen: false, sent: null, resend: true } }));
  w.coachSend();
  w.coachSees(); // a snapshot arrives before their app has applied it
  assert.notEqual(w.coachGame('abc123').link.gone, true, 'not marked removed while the resend is in transit');
  w.studentSync();
  w.coachSees();
  assert.ok(w.studentGame('abc123'), 'it arrives');
  assert.equal(w.coachGame('abc123').link.resend, undefined, 'and the resend is spent once it\'s there');
});

// ---------------------------------------------------------------------------
// The coach's bell
// ---------------------------------------------------------------------------
import { unseenStudentGames } from '../src/lib/cloud/gameLink.js';

test('bell: the games a student already had when the link was made are not news', () => {
  const first = mirror(card([]), [game('old001'), game('old002')]).card;
  assert.equal(unseenStudentGames([first]).length, 0);
  assert.equal(first.linkPrimed, true);
});

test('bell: a game the student adds after that is', () => {
  const first = mirror(card([]), [game('old001')]).card;
  const next = mirror(first, [game('old001'), game('new001')]).card;
  const news = unseenStudentGames([next]);
  assert.equal(news.length, 1);
  assert.equal(news[0].game.id, 'new001');
  assert.equal(news[0].card.id, 'card1');
});

test('bell: a game the coach added and the student received is not news for the coach', () => {
  const primedCard = mirror(card([]), []).card;
  const w = world();
  w.card = { ...primedCard, games: [linked(game('abc123'))] };
  w.cycle(); w.cycle();
  assert.equal(unseenStudentGames([w.card]).length, 0);
});
