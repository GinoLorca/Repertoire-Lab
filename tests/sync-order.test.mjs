// Order across devices: the three ways a rearrangement on the Mac failed to
// reach the iPad, each reproduced through the real sync engine first.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncNow } from '../src/lib/cloud/sync.js';
import { asDevice, resetServer } from './fakes/firebase.mjs';
import { resetDevices } from './fakes/idb.mjs';
beforeEach(() => { resetServer(); resetDevices(); });
const v = (id) => ({ id, name: id, moves: ['d4'] });
const st = (vars, openings = null) => ({
  openings: openings ?? [{ id: 'o1', name: 'Jobava', chapters: [{ id: 'c1', name: 'Main', variations: vars.map(v) }] }],
  players: [], labEntries: [], categories: [], playlists: [], savedPositions: [], settings: {},
});
const order = (s) => s.openings[0].chapters[0].variations.map((x) => x.id).join('');
const withVars = (s, ids) => ({ ...s, openings: s.openings.map((o) => ({ ...o, chapters: o.chapters.map((c) => ({ ...c, variations: ids.map((id) => c.variations.find((x) => x.id === id) ?? v(id)) })) })) });
async function pair(initial) {
  let mac = (await asDevice('mac', () => syncNow(initial))).state;
  let ipad = (await asDevice('ipad', () => syncNow({ ...initial, openings: [] }))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  return { mac, ipad };
}
test('plain reorder Mac → iPad', async () => {
  let { mac, ipad } = await pair(st(['a', 'b', 'c']));
  mac = withVars(mac, ['c', 'a', 'b']);
  await asDevice('mac', () => syncNow(mac));
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  assert.equal(order(ipad), 'cab');
});
test('Mac reorders while iPad adds a variation', async () => {
  let { mac, ipad } = await pair(st(['a', 'b', 'c']));
  mac = withVars(mac, ['c', 'a', 'b']);
  ipad = withVars(ipad, ['a', 'b', 'c', 'd']);
  await asDevice('mac', () => syncNow(mac));
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  assert.equal(order(ipad), 'cabd');
});
test('iPad on the careful path (first sync after update) does not undo the Mac reorder', async () => {
  let { mac, ipad } = await pair(st(['a', 'b', 'c']));
  mac = withVars(mac, ['c', 'a', 'b']);
  await asDevice('mac', () => syncNow(mac));
  const { syncGen, ...stale } = ipad; void syncGen;
  ipad = (await asDevice('ipad', () => syncNow(stale))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  assert.equal(order(ipad), 'cab', 'iPad takes it');
  assert.equal(order(mac), 'cab', 'and the Mac keeps it');
});
test('opening order Mac → iPad', async () => {
  const o = (id) => ({ id, name: id, chapters: [] });
  let { mac, ipad } = await pair(st([], [o('x1'), o('x2'), o('x3')]));
  assert.equal(ipad.openings.map((x) => x.id).join(), 'x1,x2,x3', 'a new device gets the right order');
  mac = { ...mac, openings: [mac.openings[2], mac.openings[0], mac.openings[1]] };
  await asDevice('mac', () => syncNow(mac));
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  assert.equal(ipad.openings.map((x) => x.id).join(), 'x3,x1,x2');
});
