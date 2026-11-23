// Several videos in one chapter — src/lib/chapterVideos.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  videosOf, hasVideo, videoOfLine, linkLine, addVideo, replaceVideo, removeVideo,
  withVideoCloud, withVideoTitle, lineBetween, gatherVideos,
  videoSource, videoLabel, videoPoster, frontFor, keepFront,
} from '../src/lib/chapterVideos.js';

const A = { id: 'vidA', kind: 'file', name: 'London — Simon.mp4', size: 10 };
const B = { id: 'dQw4w9WgXcQ', kind: 'youtube' };
const C = { id: '76979871', kind: 'vimeo' };
const line = (id, extra = {}) => ({ id, name: id, moves: ['d4'], ...extra });
const chapter = (videos, lines = []) => {
  const c = { id: 'ch', name: 'Mainline', variations: lines };
  if (videos.length) c.video = videos[0];
  if (videos.length > 1) c.moreVideos = videos.slice(1);
  return c;
};
const links = (c) => Object.fromEntries(c.variations.map((v) => [v.id, v.videoTimestamp == null
  ? null
  : [v.videoTimestamp, v.videoId ?? null]]));

// A browser's storage, for which video is in front.
let stored;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
  });
});

test('a chapter’s videos: the first where it always was, the rest beside it, none twice', () => {
  assert.deepEqual(videosOf({}), []);
  assert.deepEqual(videosOf(null), []);
  assert.deepEqual(videosOf({ video: null }), []);
  assert.deepEqual(videosOf({ video: A }), [A], 'a chapter from before this: its one video');
  assert.deepEqual(videosOf(chapter([A, B, C])), [A, B, C]);
  assert.deepEqual(videosOf({ video: A, moreVideos: [B, A, B, null, 'x', {}] }), [A, B], 'a copy isn’t a second video');
  assert.deepEqual(videosOf({ video: null, moreVideos: [B] }), [B], 'the first taken out by an older app: the next leads');
  assert.equal(hasVideo({ video: A }), true);
  assert.equal(hasVideo({ moreVideos: [] }), false);
});

test('the first video is added exactly as a chapter’s one video always was', () => {
  const c = addVideo(chapter([], [line('l1')]), A);
  assert.deepEqual(c.video, A);
  assert.equal('moreVideos' in c, false, 'nothing new is stored for one video');
  assert.equal(addVideo(c, A), c, 'the same one again changes nothing');
  assert.equal(addVideo(c, null), c);
  assert.equal(addVideo(c, { kind: 'file' }), c, 'nothing without an id');
});

test('a link says which video it’s in; one made before there were several means the first', () => {
  const c = chapter([A, B], [line('old', { videoTimestamp: 30 }), line('inB', { videoTimestamp: 12, videoId: B.id }), line('none'), line('gone', { videoTimestamp: 5, videoId: 'nope' })]);
  assert.equal(videoOfLine(c, c.variations[0]), A);
  assert.equal(videoOfLine(c, c.variations[1]), B);
  assert.equal(videoOfLine(c, c.variations[2]), null, 'not linked');
  assert.equal(videoOfLine(c, c.variations[3]), null, 'its video isn’t in the chapter');
  assert.equal(videoOfLine(chapter([]), c.variations[0]), null, 'no video to be in');
  // One video: a link is to it, whatever it was named for.
  assert.equal(videoOfLine(chapter([B]), c.variations[3]), B);

  const linked = linkLine(line('l'), 95.4, B.id);
  assert.deepEqual([linked.videoTimestamp, linked.videoId], [95.4, B.id]);
  assert.equal('videoId' in linkLine(linked, 40), false, 'linked with no video named: the first');
  const un = linkLine(linked, null);
  assert.equal('videoTimestamp' in un, false);
  assert.equal('videoId' in un, false);
  const plain = line('p');
  assert.equal(linkLine(plain, null), plain, 'nothing to unlink: the same line');
});

test('adding a second video: the links already there say they’re in the first', () => {
  const one = chapter([A], [line('l1', { videoTimestamp: 30 }), line('l2'), line('l3', { videoTimestamp: 8, videoId: 'left-by-an-old-app' })]);
  const two = addVideo(one, B);
  assert.deepEqual(two.video, A, 'the first stays the first');
  assert.deepEqual(two.moreVideos, [B]);
  assert.deepEqual(links(two), { l1: [30, A.id], l2: null, l3: [8, A.id] });
  const three = addVideo(two, C);
  assert.deepEqual(videosOf(three), [A, B, C]);
  assert.equal(three.variations, two.variations, 'a third changes no line');
});

test('replacing a video: it takes the old one’s place, and its lines’ moments', () => {
  const c = chapter([A, B], [line('a', { videoTimestamp: 30, videoId: A.id }), line('b', { videoTimestamp: 12, videoId: B.id }), line('old', { videoTimestamp: 3 })]);
  const A2 = { id: 'vidA2', kind: 'file', name: 'better.mp4' };
  const r = replaceVideo(c, A.id, A2);
  assert.deepEqual(videosOf(r), [A2, B]);
  assert.deepEqual(links(r), { a: [30, A2.id], b: [12, B.id], old: [3, A2.id] });
  const r2 = replaceVideo(c, B.id, C);
  assert.deepEqual(videosOf(r2), [A, C], 'in its own place, not the front');
  assert.deepEqual(links(r2), { a: [30, A.id], b: [12, C.id], old: [3, null] });
  // The chapter's one video, replaced: links that never named it still don't.
  const single = chapter([A], [line('l', { videoTimestamp: 30 }), line('n', { videoTimestamp: 4, videoId: A.id })]);
  const s = replaceVideo(single, A.id, A2);
  assert.deepEqual(s.video, A2);
  assert.equal('moreVideos' in s, false);
  assert.deepEqual(links(s), { l: [30, null], n: [4, A2.id] });
  // Replaced by one the chapter already has: that one, once.
  assert.deepEqual(videosOf(replaceVideo(c, A.id, B)), [B]);
  // Not there to replace: added.
  assert.deepEqual(videosOf(replaceVideo(c, 'nope', C)), [A, B, C]);
});

test('removing one of several: its lines lose their link, the others keep theirs', () => {
  const c = chapter([A, B, C], [
    line('a', { videoTimestamp: 30, videoId: A.id }), line('b', { videoTimestamp: 12, videoId: B.id }),
    line('old', { videoTimestamp: 3 }), line('dead', { videoTimestamp: 9, videoId: 'nope' }), line('none'),
  ]);
  const noB = removeVideo(c, B.id);
  assert.deepEqual(videosOf(noB), [A, C]);
  assert.deepEqual(links(noB), { a: [30, A.id], b: null, old: [3, A.id], dead: null, none: null });
  const noA = removeVideo(c, A.id);
  assert.deepEqual(noA.video, B, 'the next one leads');
  assert.deepEqual(noA.moreVideos, [C]);
  assert.deepEqual(links(noA), { a: null, b: [12, B.id], old: null, dead: null, none: null });
  // Down to one: stored as a chapter's one video always was.
  const last = removeVideo(removeVideo(c, A.id), C.id);
  assert.deepEqual(last.video, B);
  assert.equal('moreVideos' in last, false);
  assert.equal(removeVideo(c, 'nope'), c);
});

test('removing the only video keeps the moments, for a replacement', () => {
  const c = chapter([A], [line('l', { videoTimestamp: 30, videoId: A.id }), line('m', { videoTimestamp: 7 })]);
  const none = removeVideo(c, A.id);
  assert.equal(none.video, null);
  assert.equal(hasVideo(none), false);
  assert.equal(none.variations[0].videoTimestamp, 30);
  assert.equal(videoOfLine(none, none.variations[0]), null, 'nothing to watch meanwhile');
  const again = addVideo(none, B);
  assert.deepEqual(links(again), { l: [30, null], m: [7, null] }, 'the replacement takes them up');
  assert.equal(videoOfLine(again, again.variations[0]), B);
});

test('a video’s name and its place in the cloud, by id — wherever it sits', () => {
  const c = chapter([A, B]);
  const named = withVideoTitle(c, B.id, '  Simon’s   course ');
  assert.equal(named.moreVideos[0].title, 'Simon’s course');
  assert.equal(named.video, A);
  assert.equal('title' in withVideoTitle(named, B.id, '  ').moreVideos[0], false, 'emptied: no name');
  assert.equal(withVideoTitle(c, 'nope', 'x'), c);
  const up = withVideoCloud(c, A.id, { path: 'users/u/videos/vidA', size: 10 });
  assert.deepEqual(up.video.cloud, { path: 'users/u/videos/vidA', size: 10 });
  assert.deepEqual(withVideoCloud(c, B.id, { path: 'p' }).moreVideos[0].cloud, { path: 'p' });
  assert.equal(withVideoCloud(c, 'gone-by-the-time-it-uploaded', { path: 'p' }), c);
  // A long name is cut; a one-video chapter stays a one-video chapter.
  assert.equal(withVideoTitle(chapter([A]), A.id, 'x'.repeat(200)).video.title.length, 80);
  assert.equal('moreVideos' in withVideoTitle(chapter([A]), A.id, 'Part 1'), false);
});

test('a line moved to another chapter keeps its moment only where its video is too', () => {
  const from = chapter([A, B]);
  const inB = line('l', { videoTimestamp: 12, videoId: B.id });
  assert.deepEqual(lineBetween(inB, from, chapter([B])), { id: 'l', name: 'l', moves: ['d4'], videoTimestamp: 12 }, 'its one video there: no need to name it');
  assert.equal(lineBetween(inB, from, chapter([C, B])).videoId, B.id);
  assert.equal('videoTimestamp' in lineBetween(inB, from, chapter([A])), false, 'that film isn’t there');
  assert.equal('videoTimestamp' in lineBetween(inB, from, null), false, 'a new chapter has none');
  const old = line('o', { videoTimestamp: 30 });
  assert.equal(lineBetween(old, chapter([A]), chapter([A])), old, 'the same one video: untouched');
  assert.equal(lineBetween(old, chapter([A]), chapter([B, A])).videoId, A.id, 'now it has to say which');
  const plain = line('p');
  assert.equal(lineBetween(plain, from, null), plain);
});

test('chapters becoming one: every video comes along, every line stays in its own', () => {
  const one = chapter([A], [line('a', { videoTimestamp: 30 })]);
  const two = { ...chapter([B, C], [line('b', { videoTimestamp: 12 }), line('c', { videoTimestamp: 5, videoId: C.id })]), id: 'ch2' };
  const bare = { id: 'ch3', variations: [line('x', { videoTimestamp: 9 }), line('y')] };
  const g = gatherVideos([one, two, bare]);
  assert.deepEqual(g.videos, [A, B, C]);
  assert.deepEqual(g.line(one.variations[0], one).videoId, A.id);
  assert.deepEqual(g.line(two.variations[0], two).videoId, B.id);
  assert.deepEqual(g.line(two.variations[1], two).videoId, C.id);
  assert.equal('videoTimestamp' in g.line(bare.variations[0], bare), false);
  assert.equal(g.line(bare.variations[1], bare), bare.variations[1]);
  const merged = g.onto({ id: 'guide', variations: [] });
  assert.deepEqual([merged.video, merged.moreVideos], [A, [B, C]]);
  // The same video in two of them: once.
  assert.deepEqual(gatherVideos([one, { ...one, id: 'copy' }]).videos, [A]);
  // None anywhere: the chapter is left exactly as it is.
  const none = { id: 'guide', variations: [] };
  assert.equal(gatherVideos([bare]).onto(none), none);
});

test('what to call a video; a still for one that isn’t playing', () => {
  assert.equal(videoLabel({ ...A, title: 'Simon’s course' }, 0), 'Simon’s course');
  assert.equal(videoLabel(A, 0), 'London — Simon', 'an uploaded file: its name, without the extension');
  assert.equal(videoLabel(B, 1), 'Video 2');
  assert.equal(videoLabel({ id: 'f', kind: 'file', name: `${'x'.repeat(80)}.mov` }, 0).length, 48);
  assert.equal(videoSource(B), 'YouTube');
  assert.equal(videoSource(A), 'Uploaded video');
  assert.equal(videoSource({}), 'Video');
  assert.equal(videoPoster(B), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(videoPoster(A), null);
  assert.equal(videoPoster({ kind: 'youtube', id: '"><script>' }), null, 'only a real YouTube id goes in a URL');
});

test('which video is in front is remembered per chapter, on this device', () => {
  assert.equal(frontFor('ch', []), null);
  assert.equal(frontFor('ch', [A, B]), A.id, 'nothing remembered: the first');
  keepFront('ch', B.id);
  assert.equal(frontFor('ch', [A, B]), B.id);
  assert.equal(frontFor('other', [A, B]), A.id, 'another chapter has its own');
  assert.equal(frontFor('ch', [A, C]), A.id, 'the remembered one has gone: the first');
  keepFront('ch', null);
  assert.equal(frontFor('ch', [A, B]), A.id);
  // Storage that refuses (a private window) is no reason to fail.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } },
  });
  keepFront('ch', B.id);
  assert.equal(frontFor('ch', [A, B]), A.id);
});
