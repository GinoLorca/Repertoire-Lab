// Where you left off in a chapter's video — src/lib/videoSpots.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spotFor, newerSpot, resumeAt, withSpot, MAX_SPOTS,
  deviceSpot, saveDeviceSpot, forgetDeviceCache, spotOf, readYouTube, readVimeo,
} from '../src/lib/videoSpots.js';
import { embedSrc } from '../src/lib/videoLinks.js';

// A browser's storage, for the device copy.
let stored;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) },
  });
  forgetDeviceCache();
});

test('a spot worth keeping: past the first few seconds, short of the end', () => {
  assert.equal(spotFor(3, 600, 1), null, 'too early to matter');
  assert.deepEqual(spotFor(754.6, 1800, 1), { at: 754, dur: 1800, t: 1 });
  assert.deepEqual(spotFor(120, NaN, 1), { at: 120, t: 1 }, 'length unknown: still kept');
  assert.equal(spotFor(1790, 1800, 1), null, 'the last few seconds: watched');
  assert.equal(spotFor(undefined, 100), null);
});

test('the newer copy wins, a cleared one included', () => {
  const old = { at: 100, t: 1 };
  const fresh = { at: 300, t: 2 };
  assert.equal(newerSpot(old, fresh), fresh);
  assert.equal(newerSpot(fresh, old), fresh);
  assert.equal(newerSpot(null, old), old);
  assert.equal(newerSpot(undefined, undefined), null);
  const cleared = { at: null, t: 3 };
  assert.equal(resumeAt(newerSpot(fresh, cleared)), null, 'finished since: start from the beginning');
  assert.equal(resumeAt(fresh), 300);
});

test('the map keeps the newest, clears with a marker', () => {
  let m = withSpot({}, 'a', { at: 10, t: 1 });
  m = withSpot(m, 'b', null, 5);
  assert.deepEqual(m, { a: { at: 10, t: 1 }, b: { at: null, t: 5 } });
  let big = {};
  for (let i = 0; i < MAX_SPOTS + 5; i += 1) big = withSpot(big, `v${i}`, { at: 10, t: i });
  assert.equal(Object.keys(big).length, MAX_SPOTS);
  assert.ok(!('v0' in big) && 'v204' in big, 'the oldest go');
  assert.equal(withSpot(m, '', { at: 1, t: 1 }), m, 'no key: unchanged');
});

test('this device\'s copy survives a restart; the newer of it and the synced one is used', () => {
  saveDeviceSpot('vid1', { at: 400, t: 10 });
  forgetDeviceCache(); // the app restarts
  assert.deepEqual(deviceSpot('vid1'), { at: 400, t: 10 });
  assert.equal(resumeAt(spotOf('vid1', { vid1: { at: 200, t: 5 } })), 400, 'this device is newer');
  assert.equal(resumeAt(spotOf('vid1', { vid1: { at: 900, t: 20 } })), 900, 'the iPad is newer');
  assert.equal(resumeAt(spotOf('vid2', {})), null);
  // Storage that refuses: nothing kept, nothing thrown.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } } });
  forgetDeviceCache();
  assert.doesNotThrow(() => saveDeviceSpot('vid3', { at: 50, t: 1 }));
  assert.equal(resumeAt(spotOf('vid9', undefined)), null);
});

test('YouTube says where it is', () => {
  assert.deepEqual(readYouTube('{"event":"infoDelivery","info":{"currentTime":81.2,"duration":600}}'), { at: 81.2, dur: 600 });
  assert.deepEqual(readYouTube({ event: 'infoDelivery', info: { playerState: 2, currentTime: 90 } }), { at: 90, paused: true });
  assert.deepEqual(readYouTube('{"event":"onStateChange","info":0}'), { ended: true });
  assert.equal(readYouTube('{"event":"onReady"}'), null);
  assert.equal(readYouTube('not json'), null);
  assert.equal(readYouTube(42), null);
});

test('Vimeo says where it is', () => {
  assert.deepEqual(readVimeo('{"event":"ready"}'), { ready: true });
  assert.deepEqual(readVimeo({ event: 'timeupdate', data: { seconds: 12.5, duration: 300, percent: 0.04 } }), { at: 12.5, dur: 300 });
  assert.deepEqual(readVimeo({ event: 'pause', data: { seconds: 40 } }), { at: 40, paused: true });
  assert.deepEqual(readVimeo('{"event":"ended","data":{"seconds":300,"duration":300}}'), { at: 300, dur: 300, ended: true });
  assert.equal(readVimeo({ event: 'volumechange' }), null);
  assert.equal(readVimeo({ method: 'getCurrentTime' }), null);
});

test('a YouTube embed asks to report its position; Vimeo\'s is unchanged', () => {
  assert.equal(embedSrc({ kind: 'youtube', id: 'abcdefghijk' }, 61.9), 'https://www.youtube.com/embed/abcdefghijk?start=61');
  assert.equal(embedSrc({ kind: 'youtube', id: 'abcdefghijk' }, 0, { origin: 'https://lab.example' }),
    'https://www.youtube.com/embed/abcdefghijk?start=0&enablejsapi=1&origin=https%3A%2F%2Flab.example');
  assert.equal(embedSrc({ kind: 'vimeo', id: '123' }, 30, { origin: 'https://lab.example' }), 'https://player.vimeo.com/video/123#t=30s');
});
