import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateHand, cardsDealt } from '../js/rules.js';

const e = (bid, tricks, extra = {}) => ({
  bid,
  tricks,
  mermaid: false,
  pirates: 0,
  ...extra,
});

// Tricks in a hand must sum to the dice dealt — every trick is won by someone.
// This catches the most common data-entry error, and the old app had no check
// at all.

test('a hand whose tricks sum to the dice dealt is complete', () => {
  const r = validateHand([e(1, 2), e(0, 1), e(2, 1)], cardsDealt(4));
  assert.equal(r.complete, true);
  assert.equal(r.ok, true);
  assert.equal(r.shortfall, 0);
});

test('a hand missing tricks reports the shortfall', () => {
  const r = validateHand([e(1, 1), e(0, 1), e(2, 1)], cardsDealt(4));
  assert.equal(r.ok, false);
  assert.equal(r.shortfall, 1);
});

test('a hand with too many tricks reports a negative shortfall', () => {
  const r = validateHand([e(1, 2), e(0, 2), e(2, 2)], cardsDealt(4));
  assert.equal(r.ok, false);
  assert.equal(r.shortfall, -2);
});

test('an unfinished hand is incomplete rather than invalid', () => {
  // Nobody has entered tricks yet — that is not an error, just not commitable.
  const r = validateHand([e(1, null), e(0, null)], cardsDealt(3));
  assert.equal(r.complete, false);
  assert.equal(r.ok, false);
});

test('a hand with a missing bid is incomplete', () => {
  const r = validateHand([e(1, 1), e(null, 2)], cardsDealt(3));
  assert.equal(r.complete, false);
});

test('bids are not required to sum to anything', () => {
  // Everyone may bid the maximum; only tricks are constrained.
  const r = validateHand([e(4, 2), e(4, 1), e(4, 1)], cardsDealt(4));
  assert.equal(r.ok, true);
});

// --- Warnings: legal to enter, worth a second look -------------------------

test('one player taking both bonus kinds in a hand warns', () => {
  // If a Mermaid beat the Skull King, the Skull King did not win that trick, so
  // the same player cannot also have captured a pirate with it.
  const r = validateHand(
    [e(2, 2, { mermaid: true, pirates: 1 }), e(1, 2), e(0, 0)],
    cardsDealt(4)
  );
  assert.equal(r.ok, true, 'still commitable — a warning, not a block');
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].code, 'mermaid-and-pirates');
  assert.equal(r.warnings[0].seat, 0);
});

test('two players both claiming the mermaid warns', () => {
  // Only one Skull King die exists, so it can only be captured once per hand.
  const r = validateHand(
    [e(1, 1, { mermaid: true }), e(1, 1, { mermaid: true }), e(2, 2)],
    cardsDealt(4)
  );
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'mermaid-claimed-twice'));
});

test('more than three pirates across the table warns', () => {
  // Three Pirate dice exist; the table cannot capture four.
  const r = validateHand(
    [e(1, 1, { pirates: 2 }), e(1, 1, { pirates: 2 }), e(2, 2)],
    cardsDealt(4)
  );
  const w = r.warnings.find((x) => x.code === 'too-many-pirates');
  assert.ok(w, 'expected a too-many-pirates warning');
  // The UI needs the actual count to phrase the message.
  assert.equal(w.claimed, 4);
});

test('a clean hand produces no warnings', () => {
  const r = validateHand(
    [e(1, 1, { mermaid: true }), e(1, 1, { pirates: 2 }), e(2, 2)],
    cardsDealt(4)
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
});

test('bonuses on an ineligible entry are not warned about', () => {
  // A missed bid earns nothing, so stale bonus flags are harmless noise rather
  // than a contradiction to raise with the table.
  const r = validateHand(
    [e(2, 3, { mermaid: true, pirates: 3 }), e(1, 1)],
    cardsDealt(4)
  );
  assert.deepEqual(r.warnings, []);
});
