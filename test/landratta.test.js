import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreHand, RULESETS, cardsDealt } from '../js/rules.js';

// "Landrattenwertung" — the simplified variant printed in the rulebook. Nothing
// ever goes negative on a missed bid, and there are no capture bonuses.

const landratta = RULESETS.landratta;
const entry = (bid, tricks, extra = {}) => ({
  bid,
  tricks,
  mermaid: false,
  pirates: 0,
  ...extra,
});

test('an exact bid still scores 20 per trick', () => {
  assert.equal(scoreHand(entry(3, 3), cardsDealt(5), landratta), 60);
});

test('a missed bid scores zero instead of going negative', () => {
  assert.equal(scoreHand(entry(3, 1), cardsDealt(5), landratta), 0);
  assert.equal(scoreHand(entry(1, 4), cardsDealt(5), landratta), 0);
});

test('a made nil still scores 10 per die', () => {
  assert.equal(scoreHand(entry(0, 0), cardsDealt(4), landratta), 40);
});

test('a missed nil still loses 10 per die', () => {
  // The nil penalty survives the simplification — only ordinary missed bids
  // are forgiven.
  assert.equal(scoreHand(entry(0, 2), cardsDealt(6), landratta), -60);
});

test('capture bonuses are not awarded at all', () => {
  assert.equal(
    scoreHand(entry(2, 2, { mermaid: true, pirates: 3 }), cardsDealt(4), landratta),
    40
  );
});

test('the standard ruleset is unaffected by the variant existing', () => {
  assert.equal(scoreHand(entry(3, 1), cardsDealt(5), RULESETS.standard), -20);
});
