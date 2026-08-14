import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handsFor, cardsDealt, DICE_IN_BAG } from '../js/rules.js';

// The rulebook, under "Spielende":
//   "Das Spiel endet bei 3-4 Spielern nach 8 Durchgängen, bei 5 Spielern nach 7
//    Durchgängen und bei 6 Spielern nach 6 Durchgängen."

test('3 and 4 players play 8 hands', () => {
  assert.equal(handsFor(3), 8);
  assert.equal(handsFor(4), 8);
});

test('5 players play 7 hands', () => {
  assert.equal(handsFor(5), 7);
});

test('6 players play 6 hands', () => {
  assert.equal(handsFor(6), 6);
});

test('2 players play 8 hands as a house rule', () => {
  // Not an official mode — the box says 3-6. We follow the 3-4 player length.
  assert.equal(handsFor(2), 8);
});

test('player counts outside 2-6 are rejected', () => {
  // 7 players is physically impossible: hand 6 alone would need 7*6 = 42 dice,
  // and the box holds 36. There are also only 6 screens.
  assert.throws(() => handsFor(7), /player/i);
  assert.throws(() => handsFor(1), /player/i);
});

test('hand n deals n dice', () => {
  assert.equal(cardsDealt(1), 1);
  assert.equal(cardsDealt(6), 6);
  assert.equal(cardsDealt(8), 8);
});

test('every hand count fits inside the 36-dice bag', () => {
  // This is the constraint that forces the 7- and 6-hand reductions. If a future
  // change to handsFor breaks the arithmetic, that is a rules bug, not a taste
  // question — so it is asserted rather than commented.
  assert.equal(DICE_IN_BAG, 36);
  for (const players of [2, 3, 4, 5, 6]) {
    const finalHand = handsFor(players);
    assert.ok(
      players * cardsDealt(finalHand) <= DICE_IN_BAG,
      `${players} players x hand ${finalHand} needs ` +
        `${players * cardsDealt(finalHand)} dice, bag holds ${DICE_IN_BAG}`
    );
  }
});

test('6 players in the final hand empties the bag exactly', () => {
  assert.equal(6 * cardsDealt(handsFor(6)), DICE_IN_BAG);
});

test('one more hand than allowed would overflow the bag at 5 and 6 players', () => {
  for (const players of [5, 6]) {
    const oneMore = handsFor(players) + 1;
    assert.ok(
      players * cardsDealt(oneMore) > DICE_IN_BAG,
      `${players} players could have played hand ${oneMore}`
    );
  }
});
