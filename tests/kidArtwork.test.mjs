// Students' openings wear kid cards, never the coach's artwork —
// src/lib/kidArtwork.js, and what's sent to a student's app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kidArtwork, kidArtSvg, kidArtForStudents, isKidArt } from '../src/lib/kidArtwork.js';
import { deliveryPayload } from '../src/lib/cloud/share.js';

const TAROT = { medium: 'data:image/jpeg;base64,AAAA', small: 'data:image/jpeg;base64,BBBB' };

test('a kid card: the name, a monster from the name, as artwork', () => {
  const a = kidArtwork('Caro-Kann');
  assert.ok(isKidArt(a));
  assert.match(a.medium, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.equal(a.small, a.medium);
  const svg = kidArtSvg('Caro-Kann');
  assert.match(svg, />Caro-Kann<\/text>/);
  const body = (svg) => svg.match(/fill="(#[0-9a-f]{6})" opacity="0\.32"/)[1];
  assert.equal(body(kidArtSvg('Caro-Kann')), body(kidArtSvg(' caro-kann ')), 'same name, same monster');
  // Long names split in two; awkward characters are escaped.
  assert.equal((kidArtSvg('Jobava London System').match(/<text /g) ?? []).length, 2);
  assert.match(kidArtSvg('Bird & <Friends>'), /Bird &amp;<\/text><text [^>]*>&lt;Friends&gt;/);
  assert.ok(!isKidArt(TAROT));
});

test('once: students’ copies get kid cards; yours stay as they are', () => {
  const openings = [
    { id: 'mine', name: 'Caro-Kann', ownerId: null, artwork: TAROT, courses: [{ id: 'c', name: 'Lifetime', artwork: TAROT }] },
    { id: 'parker', name: 'Caro-Kann', ownerId: 'p1', artwork: TAROT, courses: [{ id: 'c2', name: 'Lifetime', artwork: TAROT }, { id: 'c3', name: 'Bare', artwork: null }] },
    { id: 'none', name: 'Slav', ownerId: 'p1', artwork: null },
    { id: 'kid', name: 'London', ownerId: 'p2', artwork: kidArtwork('London') },
  ];
  const out = kidArtForStudents(openings);
  assert.equal(out[0], openings[0], 'your own: untouched');
  assert.ok(isKidArt(out[1].artwork) && /Caro-Kann/.test(decodeURIComponent(out[1].artwork.medium)));
  assert.ok(isKidArt(out[1].courses[0].artwork));
  assert.equal(out[1].courses[1].artwork, null, 'a cover that wasn’t there stays empty');
  assert.ok(isKidArt(out[2].artwork), 'one with none gets its card');
  assert.equal(out[3], openings[3], 'already a kid card: unchanged');
  assert.equal(kidArtForStudents(out), out, 'run again: nothing to do');
});

test('what a student’s app receives: a kid card, never the coach’s picture', () => {
  const [o] = deliveryPayload([{
    id: 'x', name: 'Caro-Kann', color: 'black', ownerId: 'p1', artwork: TAROT,
    courses: [{ id: 'c', name: 'Lifetime', artwork: TAROT }], chapters: [],
  }]);
  assert.ok(isKidArt(o.artwork));
  assert.ok(!JSON.stringify(o).includes('image/jpeg'));
  assert.equal(o.courses[0].artwork, null);
});
