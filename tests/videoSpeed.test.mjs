// How fast a chapter's video plays — src/lib/videoSpeed.js, and what the
// YouTube and Vimeo players say back (src/lib/videoSpots.js).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEEDS, NORMAL_SPEED, nearestSpeed, stepSpeed, speedLabel, speedName,
  youTubeSpeed, vimeoSpeed, readSpeed, keepSpeed,
} from '../src/lib/videoSpeed.js';
import { readYouTube, readVimeo, VIMEO_LISTEN } from '../src/lib/videoSpots.js';

let stored;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => stored.get(k) ?? null,
      setItem: (k, v) => stored.set(k, String(v)),
      removeItem: (k) => stored.delete(k),
    },
  });
});

test('several steps slower and several faster, normal among them', () => {
  assert.ok(SPEEDS.includes(NORMAL_SPEED));
  assert.ok(SPEEDS.filter((s) => s < 1).length >= 3, 'more than one way to slow down');
  assert.ok(SPEEDS.filter((s) => s > 1).length >= 3, 'and to speed up');
  assert.deepEqual([...SPEEDS].sort((a, b) => a - b), SPEEDS, 'in order');
});

test('one step at a time, stopping at either end', () => {
  assert.equal(stepSpeed(1, -1), 0.75);
  assert.equal(stepSpeed(1, 1), 1.25);
  assert.equal(stepSpeed(0.25, -1), 0.25, 'no slower than the slowest');
  assert.equal(stepSpeed(2, 1), 2, 'no faster than the fastest');
  let r = 2;
  const down = [];
  for (let i = 0; i < SPEEDS.length - 1; i += 1) { r = stepSpeed(r, -1); down.push(r); }
  assert.deepEqual(down, [...SPEEDS].reverse().slice(1), 'all the way down, through every step');
});

test('any rate a player reports lands on a step', () => {
  assert.equal(nearestSpeed(0.8), 0.75);
  assert.equal(nearestSpeed(1.6), 1.5);
  assert.equal(nearestSpeed(3), 2);
  assert.equal(nearestSpeed(0.1), 0.25);
  for (const junk of [0, -1, NaN, undefined, null, 'fast']) assert.equal(nearestSpeed(junk), 1, String(junk));
  assert.equal(speedLabel(1.5), '1.5×');
  assert.equal(speedName(1), '1× · normal');
  assert.equal(speedName(0.5), '0.5×');
});

test('what a YouTube and a Vimeo player are sent', () => {
  const yt = JSON.parse(youTubeSpeed(1.5));
  assert.deepEqual([yt.event, yt.func, yt.args], ['command', 'setPlaybackRate', [1.5]]);
  assert.deepEqual(JSON.parse(vimeoSpeed(0.5)), { method: 'setPlaybackRate', value: 0.5 }, 'Vimeo’s player.js message');
  assert.deepEqual(JSON.parse(youTubeSpeed(9)).args, [2], 'never a rate that isn’t a step');
});

test('…and what they say back', () => {
  assert.deepEqual(readYouTube({ event: 'infoDelivery', info: { playbackRate: 1.5 } }), { rate: 1.5 });
  assert.deepEqual(
    readYouTube(JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12, playbackRate: 0.5, playerState: 1 } })),
    { at: 12, playing: true, rate: 0.5 },
  );
  assert.equal(readYouTube({ event: 'infoDelivery', info: { playbackRate: 0 } }), null);
  assert.deepEqual(readVimeo({ event: 'playbackratechange', data: { playbackRate: 2 } }), { rate: 2 });
  assert.equal(readVimeo({ event: 'playbackratechange', data: {} }), null);
  // Vimeo's answer to being told: the speed it took, or that it won't.
  assert.deepEqual(readVimeo(JSON.stringify({ method: 'setPlaybackRate', value: 0.75 })), { rate: 0.75 });
  assert.deepEqual(
    readVimeo({ event: 'error', data: { method: 'setPlaybackRate', name: 'RangeError', message: 'out of range' } }),
    { rateRefused: 'RangeError' },
  );
  assert.deepEqual(readVimeo({ event: 'error', data: { method: 'setPlaybackRate' } }), { rateRefused: 'Error' });
  assert.equal(readVimeo({ event: 'error', data: { method: 'play', name: 'NotAllowedError' } }), null, 'another error isn’t about speed');
  assert.equal(readVimeo({ method: 'getDuration', value: 600 }), null);
  // …and what it always said still reads the same.
  assert.deepEqual(readVimeo({ event: 'timeupdate', data: { seconds: 12, duration: 600 } }), { at: 12, dur: 600 });
  assert.deepEqual(readVimeo({ event: 'ready' }), { ready: true });
  assert.ok(VIMEO_LISTEN.some((m) => JSON.parse(m).value === 'playbackratechange'), 'Vimeo is asked to say when its speed changes');
});

test('the speed is remembered on this device; normal needs no remembering', () => {
  assert.equal(readSpeed(), 1);
  keepSpeed(0.75);
  assert.equal(readSpeed(), 0.75);
  assert.equal(stored.size, 1);
  keepSpeed(1);
  assert.equal(stored.size, 0);
  assert.equal(readSpeed(), 1);
  stored.set('rl.video.speed', 'nonsense');
  assert.equal(readSpeed(), 1);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } },
  });
  keepSpeed(1.5);
  assert.equal(readSpeed(), 1, 'storage that refuses: just for now, then');
});
