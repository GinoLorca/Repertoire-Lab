// The real sync engine (src/lib/cloud/sync.js), run by several simulated
// devices against one shared in-memory Firestore (tests/fakes/). This is
// where the races live that no single-device test can see.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncNow } from '../src/lib/cloud/sync.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';
import { buildPatch } from '../src/lib/cloud/gameLink.js';
import {
  server, hold, resetServer, asDevice, log,
} from './fakes/firebase.mjs';
import { resetDevices } from './fakes/idb.mjs';

beforeEach(() => { resetServer(); resetDevices(); });

const game = (id, extra = {}) => ({
  id, name: id, moves: ['e4', 'e5'], date: 1, meta: {}, comments: {}, badges: {}, updatedAt: 1, ...extra,
});
const base = () => ({
  openings: [], labEntries: [], categories: [], playlists: [], savedPositions: [],
  settings: { ...DEFAULT_SETTINGS, skin: 'bauhaus' },
  players: [{ id: 'p1', name: 'My games', kind: 'self', games: [game('gamex01'), game('gamey01')] }],
});
const games = (st) => st.players.flatMap((p) => p.games);
const find = (st, id) => games(st).find((g) => g.id === id);
const edit = (st, id, fn) => ({
  ...st,
  players: st.players.map((p) => ({ ...p, games: p.games.map((g) => (g.id === id ? fn(g) : g)) })),
});

// Two devices, both synced up with each other.
async function twoDevicesInSync() {
  let phone = (await asDevice('phone', () => syncNow(base()))).state;
  let laptop = (await asDevice('laptop', () => syncNow(base()))).state;
  phone = (await asDevice('phone', () => syncNow(phone))).state;
  laptop = (await asDevice('laptop', () => syncNow(laptop))).state;
  return { phone, laptop };
}

// Makes the two devices' next syncs overlap exactly: both read the cloud,
// then the phone writes, then the laptop tries to write what it read before
// the phone's write landed.
function overlapNextSyncs() {
  let laptopRead;
  let phoneWrote;
  const laptopHasRead = new Promise((r) => { laptopRead = r; });
  const phoneHasWritten = new Promise((r) => { phoneWrote = r; });
  hold('phone', async () => { await laptopHasRead; setTimeout(phoneWrote, 5); });
  hold('laptop', async () => { laptopRead(); await phoneHasWritten; });
}

test('two devices syncing at the same moment both keep their unsynced work', async () => {
  const { phone, laptop } = await twoDevicesInSync();
  const phoneEdited = edit(phone, 'gamex01', (g) => ({ ...g, meta: { notes: 'from the phone' }, updatedAt: 50 }));
  const laptopEdited = edit(laptop, 'gamey01', (g) => ({ ...g, meta: { notes: 'from the laptop' }, updatedAt: 60 }));

  overlapNextSyncs();
  const [p, l] = await Promise.all([
    asDevice('phone', () => syncNow(phoneEdited)),
    asDevice('laptop', () => syncNow(laptopEdited)),
  ]);

  // What the cloud ends up holding, read back by a third device.
  const fresh = (await asDevice('tablet', () => syncNow({ ...base(), players: [] }))).state;
  assert.equal(find(fresh, 'gamex01').meta.notes, 'from the phone', 'the phone\'s edit survived');
  assert.equal(find(fresh, 'gamey01').meta.notes, 'from the laptop', 'the laptop\'s edit survived');
  assert.equal(find(l.state, 'gamex01').meta.notes, 'from the phone', 'and the laptop now has the phone\'s too');
  assert.ok(p.state);
  assert.ok(log.some((line) => line.startsWith('laptop committed')), 'the laptop did write, after merging');
});

test('a deletion on one device and an edit on the other, at the same moment, both land', async () => {
  const { phone, laptop } = await twoDevicesInSync();
  const phoneDeleted = { ...phone, players: phone.players.map((pl) => ({ ...pl, games: pl.games.filter((g) => g.id !== 'gamey01') })) };
  const laptopEdited = edit(laptop, 'gamex01', (g) => ({ ...g, name: 'renamed on the laptop', updatedAt: 70 }));

  overlapNextSyncs();
  await Promise.all([
    asDevice('phone', () => syncNow(phoneDeleted)),
    asDevice('laptop', () => syncNow(laptopEdited)),
  ]);

  const fresh = (await asDevice('tablet', () => syncNow({ ...base(), players: [] }))).state;
  assert.equal(find(fresh, 'gamey01'), undefined, 'the deleted game stayed deleted');
  assert.equal(find(fresh, 'gamex01').name, 'renamed on the laptop');
});

test('an edit made here survives the next sync (the bug the three-way merge fixed)', async () => {
  const { phone } = await twoDevicesInSync();
  const edited = edit(phone, 'gamex01', (g) => ({ ...g, meta: { notes: 'typed just now' }, updatedAt: 80 }));
  const after = (await asDevice('phone', () => syncNow(edited))).state;
  assert.equal(find(after, 'gamex01').meta.notes, 'typed just now');
});

// --- a coach's game, arriving on two of the student's devices at once ------

const COACH = 'coach1';
function coachDelivery(id, rev) {
  const g = {
    id, name: 'Round 3', moves: ['d4', 'd5', 'c4'], date: 5, comments: {}, badges: {},
    meta: { white: 'Parker', black: 'Smith' }, link: { uid: 'student1', base: {}, seen: false, sent: null },
  };
  const deliveryId = `lg_${COACH}_${id}_${rev}`;
  server.set(`deliveries/${deliveryId}`, { kind: 'game', v: 1, toUid: 'student1', fromUid: COACH });
  return {
    id: deliveryId, fromUid: COACH, fromName: 'Gino', gameId: id, rev, resend: false,
    kind: 'game', v: 1, patch: JSON.stringify(buildPatch(g).patch),
  };
}

test('a coach\'s game arriving on two devices at once is added once — and neither device loses its own work', async () => {
  const { phone, laptop } = await twoDevicesInSync();
  const d = coachDelivery('coachgame1', 1_800_000_000_000);
  const phoneEdited = edit(phone, 'gamex01', (g) => ({ ...g, meta: { notes: 'phone note' }, updatedAt: 90 }));
  const laptopEdited = edit(laptop, 'gamey01', (g) => ({ ...g, meta: { notes: 'laptop note' }, updatedAt: 91 }));

  overlapNextSyncs();
  await Promise.all([
    asDevice('phone', () => syncNow(phoneEdited, { inbound: [d] })),
    asDevice('laptop', () => syncNow(laptopEdited, { inbound: [d] })),
  ]);

  const fresh = (await asDevice('tablet', () => syncNow({ ...base(), players: [] }))).state;
  assert.equal(games(fresh).filter((g) => g.id === 'coachgame1').length, 1, 'exactly one copy of the coach\'s game');
  assert.equal(find(fresh, 'coachgame1').addedBy.name, 'Gino');
  assert.equal(find(fresh, 'gamex01').meta.notes, 'phone note');
  assert.equal(find(fresh, 'gamey01').meta.notes, 'laptop note');
  assert.equal(server.has(`deliveries/${d.id}`), false, 'and the delivery was cleared once it was in');
  assert.ok(server.get('users/student1/singletons/coachGames').games.coachgame1, 'the ledger records it');
});

test('a coach\'s game the student deleted never comes back, even if the delivery is seen again', async () => {
  const { phone } = await twoDevicesInSync();
  const d = coachDelivery('coachgame2', 1_800_000_000_001);
  let st = (await asDevice('phone', () => syncNow(phone, { inbound: [d] }))).state;
  assert.ok(find(st, 'coachgame2'));
  st = { ...st, players: st.players.map((pl) => ({ ...pl, games: pl.games.filter((g) => g.id !== 'coachgame2') })) };
  st = (await asDevice('phone', () => syncNow(st))).state;
  const again = coachDelivery('coachgame2', 1_800_000_000_002);
  st = (await asDevice('phone', () => syncNow(st, { inbound: [again] }))).state;
  assert.equal(find(st, 'coachgame2'), undefined);
});

// ---------------------------------------------------------------------------
// Found in review: the sync engine's own edges
// ---------------------------------------------------------------------------

import { setOffline, signInAs } from './fakes/firebase.mjs';
import { get as idbGet } from './fakes/idb.mjs';

const full = () => ({
  ...base(),
  openings: [{ id: 'op1', name: 'Jobava', chapters: [{ id: 'ch1', name: 'Main', variations: [{ id: 'v1', name: 'L', moves: ['d4'] }] }] }],
});

test('"Reset this device" while signed in never wipes the account — the next sync brings it back', async () => {
  let mac = (await asDevice('mac', () => syncNow(full()))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  // Reset: an empty library, as DataSection hands it over (no sync stamp).
  const reset = { ...base(), players: [], openings: [] };
  const after = (await asDevice('mac', () => syncNow(reset))).state;
  assert.equal(games(after).length, 2, 'the games came back');
  assert.equal(after.openings.length, 1, 'and the openings');
  const cloud = (await asDevice('ipad', () => syncNow({ ...base(), players: [] }))).state;
  assert.equal(cloud.openings.length, 1, 'and nothing was deleted from the account');
});

test('a tab that fell behind another tab never deletes the other tab\'s new work', async () => {
  const staleTab = (await asDevice('mac', () => syncNow(base()))).state;
  let freshTab = (await asDevice('mac', () => syncNow(staleTab))).state;
  // The fresh tab adds a game and syncs; the stale tab still holds the old
  // library, stamped with an older sync.
  freshTab = { ...freshTab, players: freshTab.players.map((p) => ({ ...p, games: [...p.games, game('newgame1')] })) };
  freshTab = (await asDevice('mac', () => syncNow(freshTab))).state;
  const staleOut = (await asDevice('mac', () => syncNow(staleTab))).state;
  assert.ok(find(staleOut, 'newgame1'), 'the stale tab picks the new game up');
  const cloud = (await asDevice('ipad', () => syncNow({ ...base(), players: [] }))).state;
  assert.ok(find(cloud, 'newgame1'), 'and it is still in the account');
});

test('signing out and back in resumes properly: a deletion made meanwhile elsewhere stays deleted', async () => {
  let mac = (await asDevice('mac', () => syncNow(base()))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  let ipad = (await asDevice('ipad', () => syncNow({ ...base(), players: [] }))).state;
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  signInAs(null); // the Mac signs out
  // Meanwhile the iPad deletes a game.
  ipad = { ...ipad, players: ipad.players.map((p) => ({ ...p, games: p.games.filter((g) => g.id !== 'gamey01') })) };
  await asDevice('ipad', () => { signInAs('student1'); return syncNow(ipad); });
  // The Mac signs back in, with its library as it was.
  signInAs('student1');
  const back = (await asDevice('mac', () => syncNow(mac))).state;
  assert.equal(find(back, 'gamey01'), undefined, 'the iPad\'s deletion is not undone');
});

test('a different account signing in here never gets the previous account\'s library', async () => {
  let mine = (await asDevice('mac', () => syncNow(base()))).state;
  mine = (await asDevice('mac', () => syncNow(mine))).state;
  signInAs('someoneelse');
  const theirs = (await asDevice('mac', () => syncNow(mine))).state;
  assert.equal(games(theirs).length, 0, 'their (empty) account is what shows');
  assert.equal([...server.keys()].filter((k) => k.startsWith('users/someoneelse/players/')).length, 0,
    'and nothing of mine went into their account');
  const stash = await asDevice('mac', () => idbGet('repertoire-lab-stash:student1'));
  assert.equal(games(stash).length, 2, 'my library was set aside on this device, not lost');
});

test('a picture removed on one device stays removed on the other', async () => {
  const pic = `data:image/jpeg;base64,${'A'.repeat(400)}`;
  const withPhoto = edit(base(), 'gamex01', (g) => ({ ...g, meta: { photo: pic } }));
  let mac = (await asDevice('mac', () => syncNow(withPhoto))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  let ipad = (await asDevice('ipad', () => syncNow({ ...base(), players: [] }))).state;
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  assert.equal(find(ipad, 'gamex01').meta.photo, pic, 'the photo reached the iPad');
  mac = edit(mac, 'gamex01', (g) => ({ ...g, meta: { ...g.meta, photo: null }, updatedAt: 200 }));
  await asDevice('mac', () => syncNow(mac));
  ipad = (await asDevice('ipad', () => syncNow(ipad))).state;
  assert.equal(find(ipad, 'gamex01').meta.photo ?? null, null, 'removed on the Mac, removed on the iPad');
});

test('offline, a sync writes nothing and changes nothing', async () => {
  let mac = (await asDevice('mac', () => syncNow(base()))).state;
  mac = (await asDevice('mac', () => syncNow(mac))).state;
  const before = JSON.stringify([...server.entries()]);
  setOffline(true);
  const edited = edit(mac, 'gamex01', (g) => ({ ...g, name: 'offline edit', updatedAt: 300 }));
  const out = await asDevice('mac', () => syncNow(edited));
  setOffline(false);
  assert.equal(out.offline, true);
  assert.equal(out.state, edited, 'the local work is untouched');
  assert.equal(JSON.stringify([...server.entries()]), before, 'and nothing was written');
  const online = (await asDevice('mac', () => syncNow(edited))).state;
  assert.equal(find(online, 'gamex01').name, 'offline edit', 'back online, it goes up');
});

test('a read the server refuses (the daily quota, say) is an error, not "offline" — and the next sync still sends the work', async () => {
  const { failNextRead } = await import('./fakes/firebase.mjs');
  const lib = { openings: [{ id: 'o1', name: 'Jobava', chapters: [{ id: 'c1', name: 'Main', variations: [{ id: 'v1', name: 'A', moves: ['d4'] }] }] }], players: [], labEntries: [], categories: [], playlists: [], savedPositions: [], settings: {} };
  const first = await asDevice('ipad', () => syncNow(lib));
  const edited = { ...first.state, openings: [{ ...first.state.openings[0], name: 'Jobava London' }] };
  failNextRead('resource-exhausted');
  await assert.rejects(asDevice('ipad', () => syncNow(edited)), (err) => err.code === 'resource-exhausted');
  const again = await asDevice('ipad', () => syncNow(edited));
  assert.equal(again.offline, undefined);
  const mac = await asDevice('mac', () => syncNow({ ...lib, openings: [] }));
  assert.equal(mac.state.openings[0].name, 'Jobava London');
});

