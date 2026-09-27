// Consent for games in the inbox — src/lib/cloud/share.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleGameDelivery } from '../src/lib/cloud/share.js';

const d = (extra = {}) => ({ id: 'd1', kind: 'game', v: 1, fromUid: 'x', ...extra });

test('a game from a linked coach applies on its own', () => {
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach' }), new Set(['coach'])), true);
});

test('a stranger can\'t make their own game count as accepted', () => {
  assert.equal(eligibleGameDelivery(d({ acceptedAt: { seconds: 1 } }), new Set()), false);
});

test('a game the student accepted on this device applies', () => {
  assert.equal(eligibleGameDelivery(d(), new Set(), new Set(['d1'])), true);
});

test('dismissed, unknown kinds and future versions never apply', () => {
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', dismissedAt: 1 }), new Set(['coach'])), false);
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', kind: 'lines' }), new Set(['coach'])), false);
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', v: 2 }), new Set(['coach'])), false);
});
