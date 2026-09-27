// US Chess ratings — src/lib/uscf.js and netlify/functions/uscf.mjs. The
// fixtures are the real shape ratings-api.uschess.org returned for a student.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUscf } from '../src/lib/uscf.js';
import handler from '../netlify/functions/uscf.mjs';

const member = {
  id: '32473012', firstName: 'Zhengze Joseph', lastName: 'Liu', expirationDate: '2027-06-30', status: 'Active',
  ratings: [
    { rating: 1081, ratingSystem: 'R', isProvisional: false },
    { rating: 1059, ratingSystem: 'Q', isProvisional: false },
    { ratingSystem: 'B', isProvisional: true },
    { ratingSystem: 'OR', isProvisional: true },
  ],
};
const section = (endDate, name, r, q) => ({
  endDate, event: { name },
  ratingRecords: [
    { ratingSource: 'R', preRating: r[0], postRating: r[1] },
    { ratingSource: 'Q', preRating: q[0], postRating: q[1] },
  ],
});
// Deliberately out of order: the newest must win regardless.
const sections = { items: [
  section('2026-08-14', 'ICN Midtown Week 7', [1072, 1081], [1048, 1059]),
  section('2026-08-28', 'ICN Midtown Week 9', [1081, 1240], [1059, 1215]),
  section('2026-08-01', 'Summer Series', [1031, 1072], [1011, 1048]),
] };

test('live ratings come from the most recent rated event', () => {
  const out = normalizeUscf(member, sections);
  assert.equal(out.regular, 1240);
  assert.equal(out.quick, 1215);
  assert.deepEqual(out.lastEvent, { name: 'ICN Midtown Week 9', date: '2026-08-28' });
});

test('the official figure is kept alongside when it trails', () => {
  const out = normalizeUscf(member, sections);
  assert.equal(out.regularOfficial, 1081);
  assert.equal(out.quickOfficial, 1059);
});

test('name, expiry and unrated systems', () => {
  const out = normalizeUscf(member, sections);
  assert.equal(out.name, 'Zhengze Joseph Liu');
  assert.equal(out.expires, '2027-06-30');
  assert.equal(out.blitz, null, 'provisional with no number is unrated, not 0');
});

test('no event history: the official ratings stand', () => {
  const out = normalizeUscf(member, null);
  assert.equal(out.regular, 1081);
  assert.equal(out.regularOfficial, undefined);
});

test('no member: nothing', () => {
  assert.equal(normalizeUscf({}, null), null);
});

// --- the function -----------------------------------------------------------

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const respond = (status, body) => new Response(JSON.stringify(body), { status });

test('function: returns live ratings with a CORS header', async () => {
  globalThis.fetch = async (url) => (String(url).endsWith('/sections') ? respond(200, sections) : respond(200, member));
  const res = await handler(new Request('https://x/.netlify/functions/uscf?id=32473012'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal((await res.json()).regular, 1240);
});

test('function: an unknown ID says so', async () => {
  globalThis.fetch = async () => respond(404, {});
  const res = await handler(new Request('https://x/.netlify/functions/uscf?id=99999999'));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /no member/);
});

test('function: a bad ID never leaves the server', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return respond(200, member); };
  const res = await handler(new Request('https://x/.netlify/functions/uscf?id=12'));
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test('function: US Chess unreachable → a clear error, not a crash', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  const res = await handler(new Request('https://x/.netlify/functions/uscf?id=32473012'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /network down/);
});
