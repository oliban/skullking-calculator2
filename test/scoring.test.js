import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreHand, RULESETS, cardsDealt } from '../js/rules.js';

const standard = RULESETS.standard;

/** A hand entry with no bonuses claimed. */
const entry = (bid, tricks, extra = {}) => ({
  bid,
  tricks,
  mermaid: false,
  pirates: 0,
  ...extra,
});

// --- The four worked examples printed in the rulebook -----------------------
// These are the load-bearing tests. If any of them break, the app is scoring a
// different game.

test('rulebook example: bid 3, made 3, scores +60', () => {
  assert.equal(scoreHand(entry(3, 3), cardsDealt(3), standard), 60);
});

test('rulebook example: bid 5, won 1, scores -40', () => {
  assert.equal(scoreHand(entry(5, 1), cardsDealt(5), standard), -40);
});

test('rulebook example: made nil in hand 4 scores +40', () => {
  assert.equal(scoreHand(entry(0, 0), cardsDealt(4), standard), 40);
});

test('rulebook example: missed nil in hand 6 taking 2 tricks scores -60', () => {
  assert.equal(scoreHand(entry(0, 2), cardsDealt(6), standard), -60);
});

// --- Base scoring ----------------------------------------------------------

test('an exact non-zero bid scores 20 per trick', () => {
  assert.equal(scoreHand(entry(1, 1), cardsDealt(1), standard), 20);
  assert.equal(scoreHand(entry(2, 2), cardsDealt(4), standard), 40);
  assert.equal(scoreHand(entry(8, 8), cardsDealt(8), standard), 160);
});

test('a missed bid loses 10 per trick of deviation', () => {
  assert.equal(scoreHand(entry(3, 2), cardsDealt(5), standard), -10);
  assert.equal(scoreHand(entry(3, 5), cardsDealt(5), standard), -20);
});

test('overshooting and undershooting by the same amount score the same', () => {
  const under = scoreHand(entry(4, 2), cardsDealt(6), standard);
  const over = scoreHand(entry(4, 6), cardsDealt(6), standard);
  assert.equal(under, over);
  assert.equal(under, -20);
});

test('a made nil scores 10 per die dealt, so it grows with the hand', () => {
  assert.equal(scoreHand(entry(0, 0), cardsDealt(1), standard), 10);
  assert.equal(scoreHand(entry(0, 0), cardsDealt(8), standard), 80);
});

// --- The flat missed-nil penalty -------------------------------------------
// The single most commonly mis-implemented rule in Skull King calculators.
// Rulebook: "...ist es somit egal, ob er dann einen oder beispielsweise drei
// Stiche bekommt." A naive -10 x tricks would give -10/-20/-30 here.

test('a missed nil is flat, however many tricks were taken', () => {
  for (const tricks of [1, 2, 3, 4, 5, 6]) {
    assert.equal(
      scoreHand(entry(0, tricks), cardsDealt(6), standard),
      -60,
      `bid 0 taking ${tricks} tricks in hand 6 must score -60`
    );
  }
});

test('a missed nil scales with the hand, not the tricks taken', () => {
  assert.equal(scoreHand(entry(0, 1), cardsDealt(2), standard), -20);
  assert.equal(scoreHand(entry(0, 1), cardsDealt(8), standard), -80);
});
