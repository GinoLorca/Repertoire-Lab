// Study mode's reading of a line: runs of moves and the notes after them, the
// arrows a note draws, and the moves a note mentions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarks, studySegments, marksAt, noteParts, resolveSequence, resolveNote, fenAfter, lastMoveAfter, moveNumber,
} from '../src/lib/studyText.js';

const LINE = ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3', 'Nc6', 'Nc3', 'Bg4', 'Bb5', 'e6', 'h3', 'Bxf3', 'Qxf3', 'Nf6',
  'Bg5', 'Be7', 'O-O-O', 'Rc8', 'Rhe1', 'O-O'];

test('arrows and highlighted squares from a Lichess/Chessable comment, and the text without them', () => {
  const m = parseMarks('Watch the e5 square [%cal Gf3e5,Rc6e5] [%csl Ye5] and [%clk 0:05:00] the knight');
  assert.equal(m.text, 'Watch the e5 square and the knight');
  assert.deepEqual(m.arrows, [['f3', 'e5', '#2ecc71'], ['c6', 'e5', '#e5534b']]);
  assert.deepEqual(m.squares, { e5: 'rgba(232, 179, 57, 0.55)' });
  assert.deepEqual(parseMarks('[%cal Ge2e4]').text, '', 'only marks: no text');
});

test('the line as a book reads it: moves up to a note, then the note; Black\'s move numbered when it opens a run', () => {
  const segs = studySegments(['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Nf3'], {
    4: 'The Exchange Variation.',
    6: '[%cal Gf3e5]', // arrows only — nothing to read, so no break in the moves
  });
  assert.deepEqual(segs.map((s) => (s.kind === 'note' ? `[${s.text}]` : s.moves.map((m) => `${m.number ?? ''}${m.san}`).join(' '))), [
    '1.e4 c6 2.d4 d5 3.exd5',
    '[The Exchange Variation.]',
    '3...cxd5 4.Nf3',
  ]);
  assert.equal(moveNumber(5), '3...');
});

test('the board draws the marks of the note on the move just played, and only that one', () => {
  const comments = { 4: 'x [%cal Gd4d5]' };
  assert.deepEqual(marksAt(comments, 5).arrows, [['d4', 'd5', '#2ecc71']]);
  assert.deepEqual(marksAt(comments, 6).arrows, []);
  assert.deepEqual(marksAt(comments, 0).arrows, []);
});

test('moves mentioned in a note: numbered sequences, bare replies, and loose piece moves', () => {
  const parts = noteParts('note 11...a6? is the motif to watch out for - 12.Bxc6+ Rxc6 13.Bxf6 and Nxd5 ideas');
  const seqs = parts.filter((p) => p.kind === 'seq').map((p) => p.moves.map((m) => `${m.ply}:${m.san}`).join(' '));
  assert.deepEqual(seqs, ['21:a6?', '22:Bxc6+ 23:Rxc6 24:Bxf6']);
  const loose = parts.filter((p) => p.kind === 'loose');
  assert.deepEqual(loose.map((p) => [p.text, p.square]), [['Nxd5', 'd5']]);
  assert.equal(parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'seq' ? p.moves.map((m) => m.text).join(' ') : p.text)).join(''),
    'note 11...a6? is the motif to watch out for - 12.Bxc6+ Rxc6 13.Bxf6 and Nxd5 ideas'.replace(/ /g, (s) => s), 'nothing lost');
});

test('sequences written the book way: "3... cxd5 4. Nf3", the ellipsis character, and a move number that doesn\'t follow breaks the run', () => {
  assert.deepEqual(noteParts('after 3... cxd5 4. Nf3 Nc6').filter((p) => p.kind === 'seq')[0].moves.map((m) => m.ply), [5, 6, 7]);
  assert.deepEqual(noteParts('3… cxd5').filter((p) => p.kind === 'seq')[0].moves[0].ply, 5);
  const two = noteParts('1.e4 c6 5.Nf3').filter((p) => p.kind === 'seq');
  assert.equal(two.length, 2);
  assert.equal(noteParts('Qa4 is not a4, and 12 moves is not a move').filter((p) => p.kind !== 'text').map((p) => p.text).join(','), 'Qa4');
});

test('a sequence plays from where it branches off the line — or where the one before it in the note stopped', () => {
  const [first, second] = resolveNote(LINE, noteParts('note 11...a6? — 12.Bxc6+ Rxc6 13.Bxf6')).filter((p) => p.kind === 'seq');
  assert.deepEqual(first.line.path, ['a6']);
  assert.equal(first.line.base.length, 21);
  assert.deepEqual(second.line.path, ['Bxc6+', 'Rxc6', 'Bxf6'], 'played after 11...a6, not after the 11...O-O of the line');
  assert.equal(second.line.base.length, 22);
  assert.equal(second.line.base[21], 'a6');
  assert.ok(fenAfter([...second.line.base, ...second.line.path]));
});

test('from the start of the game, and a sequence that can\'t be played', () => {
  const s = resolveSequence([], noteParts('1.e4 c6 2.Nf3 d5 3.exd5')[0].moves);
  assert.deepEqual(s, { base: [], path: ['e4', 'c6', 'Nf3', 'd5', 'exd5'], playable: 5 });
  assert.equal(resolveSequence(LINE, noteParts('4.Qa4')[0].moves), null);
  assert.equal(resolveSequence(['e4'], noteParts('20.Nf3')[0].moves), null, 'beyond the end of the line');
});

test('the last move\'s squares, and an illegal line', () => {
  assert.deepEqual(lastMoveAfter(['e4', 'c6']), { from: 'c7', to: 'c6' });
  assert.equal(lastMoveAfter([]), null);
  assert.equal(fenAfter(['e4', 'e4']), null);
});

// ---------- From the review ----------

const seqs = (note) => resolveNote(LINE, noteParts(note)).filter((p) => p.kind === 'seq');

test('an alternative in brackets branches off the sequence it interrupts, and the sequence carries on after it', () => {
  const [main, alt, rest] = seqs('11...a6 12.Bxc6+ (12.Bd3 b5) 12...Rxc6 13.Bxf6');
  assert.deepEqual(main.line.path, ['a6', 'Bxc6+']);
  assert.equal(alt.depth, 1);
  assert.deepEqual(alt.line.base.slice(-1), ['a6'], 'played after 11...a6, not after the line\'s 11...O-O');
  assert.deepEqual(alt.line.path, ['Bd3', 'b5']);
  assert.deepEqual(rest.line.base.slice(-2), ['a6', 'Bxc6+'], 'resumes after 12.Bxc6+, not after the bracket\'s 12.Bd3');
  assert.deepEqual(rest.line.path, ['Rxc6', 'Bxf6']);
});

test('"Instead 12.Bd3" branches off the sequence before it at its own move', () => {
  const [, instead] = seqs('11...a6 12.Bxc6+ Rxc6. Instead 12.Bd3 b5 is calmer');
  assert.deepEqual(instead.line.base.slice(-1), ['a6']);
  assert.deepEqual(instead.line.path, ['Bd3', 'b5']);
});

test('one bad move in a sequence only stops the moves after it', () => {
  // 14.Rxd5 is an author slip: the d4 pawn is in the way.
  const [s] = seqs('12.Bxf6 Bxf6 13.Nxd5 exd5 14.Rxd5');
  assert.equal(s.line.playable, 4);
  assert.deepEqual(s.line.path, ['Bxf6', 'Bxf6', 'Nxd5', 'exd5']);
});

test('more of the ways books write moves', () => {
  const plies = (note) => noteParts(note).filter((p) => p.kind === 'seq').map((p) => p.moves.map((m) => `${m.ply}:${m.san}`).join(' '));
  assert.deepEqual(plies('12. ... Rxc6 13.Bxf6'), ['23:Rxc6 24:Bxf6']);
  assert.deepEqual(plies('12..Rxc6'), ['23:Rxc6']);
  assert.deepEqual(plies('10.0-0-0 Rc8'), ['18:0-0-0 19:Rc8']);
  assert.deepEqual(plies('either 12.Bxc6/12.Bxf6'), ['22:Bxc6', '22:Bxf6']);
  assert.deepEqual(noteParts('...Rxc6 is the idea').filter((p) => p.kind === 'loose').map((p) => p.text), ['Rxc6']);
  const [castle] = seqs('10.0-0-0 Rc8');
  assert.deepEqual(castle.line.path, ['O-O-O', 'Rc8'], 'zeros read as castling');
  assert.equal(noteParts('12.Nf3-d2').filter((p) => p.kind === 'seq').length, 0, 'long algebraic isn\'t misread as a numbered move');
});

test('a sequence that restates the line is played on the line', () => {
  const [s] = seqs('After 10.O-O-O Rc8 White is ready');
  assert.equal(s.line.base.length, 18);
  assert.deepEqual(s.line.path, ['O-O-O', 'Rc8']);
});

