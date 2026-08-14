import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreHand,
  bonusEligible,
  RULESETS,
  cardsDealt,
  MERMAID_BONUS,
  PIRATE_BONUS,
  MAX_PIRATES,
  MERMAID_DICE,
} from '../js/rules.js';

const standard = RULESETS.standard;
const entry = (bid, tricks, extra = {}) => ({
  bid,
  tricks,
  mermaid: false,
  pirates: 0,
  ...extra,
});

// --- Component-derived constants -------------------------------------------

test('the box holds one Skull King die, two Mermaids and three Pirates', () => {
  // The pirate cap is the fix the old app needs: it allowed 5, but only three
  // Pirate dice exist, so +90 is the ceiling.
  assert.equal(MAX_PIRATES, 3);
  assert.equal(MERMAID_DICE, 2);
  assert.equal(MERMAID_BONUS, 50);
  assert.equal(PIRATE_BONUS, 30);
});

// --- Bonuses require an exact bid -------------------------------------------
// Rulebook: "Allerdings ist dies nur möglich, wenn der Spieler es schafft, genau
// so viele Stiche zu bekommen, wie er angesagt hat."

test('a mermaid capture adds 50 on an exact bid', () => {
  assert.equal(
    scoreHand(entry(2, 2, { mermaid: true }), cardsDealt(4), standard),
    40 + 50
  );
});

test('each captured pirate adds 30 on an exact bid', () => {
  assert.equal(
    scoreHand(entry(2, 2, { pirates: 1 }), cardsDealt(4), standard),
    40 + 30
  );
  assert.equal(
    scoreHand(entry(2, 2, { pirates: 3 }), cardsDealt(4), standard),
    40 + 90
  );
});

test('a missed bid earns no bonus points at all', () => {
  // Bid 2, took 3: -10. The claimed bonuses must be ignored entirely, not added
  // to the penalty.
  assert.equal(
    scoreHand(entry(2, 3, { mermaid: true, pirates: 3 }), cardsDealt(5), standard),
    -10
  );
});

test('pirates are capped at the three dice in the box', () => {
  const capped = scoreHand(entry(2, 2, { pirates: 99 }), cardsDealt(4), standard);
  assert.equal(capped, 40 + 3 * PIRATE_BONUS);
});

test('a negative pirate count cannot drain points', () => {
  assert.equal(
    scoreHand(entry(2, 2, { pirates: -5 }), cardsDealt(4), standard),
    40
  );
});

// --- You cannot capture in a trick you never won ---------------------------
// The old app allowed a made nil to bank +50. Physically impossible: winning no
// tricks means capturing nothing.

test('a made nil earns no capture bonus', () => {
  assert.equal(
    scoreHand(entry(0, 0, { mermaid: true, pirates: 3 }), cardsDealt(6), standard),
    60
  );
});

test('bonuses are ineligible on a made nil', () => {
  assert.equal(bonusEligible(entry(0, 0)), false);
});

test('bonuses are ineligible on a missed bid', () => {
  assert.equal(bonusEligible(entry(3, 2)), false);
  assert.equal(bonusEligible(entry(0, 2)), false);
});

test('bonuses are eligible on an exact bid that won tricks', () => {
  assert.equal(bonusEligible(entry(1, 1)), true);
  assert.equal(bonusEligible(entry(4, 4)), true);
});

test('bonuses are ineligible while an entry is incomplete', () => {
  assert.equal(bonusEligible({ bid: 2, tricks: null }), false);
  assert.equal(bonusEligible({ bid: null, tricks: null }), false);
});
