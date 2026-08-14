import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame,
  currentHand,
  setEntry,
  commitHand,
  totals,
  isFinished,
  handScores,
} from '../js/state.js';

const crew = () => [
  { name: 'Rodskagg', emoji: 'A' },
  { name: 'Blackhand', emoji: 'B' },
  { name: 'Hajen', emoji: 'C' },
];

/** Fill a whole hand so it can be committed. `spec` is [[bid, tricks], ...]. */
function fill(game, spec) {
  return spec.reduce(
    (g, [bid, tricks], seat) =>
      setEntry(setEntry(g, seat, { bid }), seat, { tricks }),
    game
  );
}

test('a new game seats the crew in order and starts at hand 1', () => {
  const g = newGame({ players: crew() });
  assert.equal(g.players.length, 3);
  assert.deepEqual(
    g.players.map((p) => p.seat),
    [0, 1, 2]
  );
  assert.equal(g.cursor.hand, 1);
  assert.equal(g.cursor.phase, 'bid');
  assert.equal(g.cursor.seat, 0);
});

test('a new game plays the hand count for its crew size', () => {
  assert.equal(newGame({ players: crew() }).totalHands, 8);
  assert.equal(
    newGame({ players: [...crew(), {}, {}, {}] }).totalHands,
    6
  );
});

test('every player gets a distinct id', () => {
  const ids = newGame({ players: crew() }).players.map((p) => p.id);
  assert.equal(new Set(ids).size, 3);
});

test('a new game scores zero for everyone', () => {
  const g = newGame({ players: crew() });
  assert.deepEqual(Object.values(totals(g)), [0, 0, 0]);
});

test('the first hand deals one die', () => {
  const g = newGame({ players: crew() });
  assert.equal(currentHand(g).n, 1);
  assert.equal(currentHand(g).dice, 1);
});

test('an uncommitted hand does not count toward totals', () => {
  const g = fill(newGame({ players: crew() }), [
    [1, 1],
    [0, 0],
    [0, 0],
  ]);
  assert.deepEqual(Object.values(totals(g)), [0, 0, 0]);
});

test('committing a hand scores it', () => {
  const g = commitHand(
    fill(newGame({ players: crew() }), [
      [1, 1],
      [0, 0],
      [0, 0],
    ])
  );
  // Seat 0 bid 1 and made it: +20. Seats 1 and 2 made nil in hand 1: +10 each.
  assert.deepEqual(Object.values(totals(g)), [20, 10, 10]);
});

test('committing advances to the next hand and resets the cursor', () => {
  const g = commitHand(
    fill(newGame({ players: crew() }), [
      [1, 1],
      [0, 0],
      [0, 0],
    ])
  );
  assert.equal(g.cursor.hand, 2);
  assert.equal(g.cursor.phase, 'bid');
  assert.equal(g.cursor.seat, 0);
  assert.equal(currentHand(g).dice, 2);
});

test('a hand whose tricks do not sum to the dice dealt cannot be committed', () => {
  // Hand 1 deals one die, so exactly one trick exists. Two winners is impossible.
  const bad = fill(newGame({ players: crew() }), [
    [1, 1],
    [1, 1],
    [0, 0],
  ]);
  assert.throws(() => commitHand(bad), /trick/i);
});

test('an incomplete hand cannot be committed', () => {
  const g = setEntry(newGame({ players: crew() }), 0, { bid: 1 });
  assert.throws(() => commitHand(g), /incomplete|complete/i);
});

test('totals always equal the sum of the per-hand scores', () => {
  let g = newGame({ players: crew() });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  g = commitHand(fill(g, [[1, 0], [1, 2], [0, 0]]));

  const summed = {};
  for (const p of g.players) summed[p.id] = 0;
  for (const hand of g.hands) {
    if (!hand.committed) continue;
    const scored = handScores(g, hand);
    for (const p of g.players) summed[p.id] += scored[p.id];
  }
  assert.deepEqual(totals(g), summed);
});

test('setEntry does not mutate the game it was given', () => {
  const before = newGame({ players: crew() });
  const snapshot = JSON.stringify(before);
  setEntry(before, 0, { bid: 1 });
  assert.equal(JSON.stringify(before), snapshot);
});

test('a game is finished only after its last hand is committed', () => {
  let g = newGame({ players: crew() });
  assert.equal(isFinished(g), false);
  for (let hand = 1; hand <= g.totalHands; hand += 1) {
    assert.equal(isFinished(g), false, `finished early at hand ${hand}`);
    const dice = currentHand(g).dice;
    // Seat 0 takes every trick; the others bid and take nothing.
    g = commitHand(fill(g, [[dice, dice], [0, 0], [0, 0]]));
  }
  assert.equal(isFinished(g), true);
});

// --- Scores are derived, never stored --------------------------------------
// Spec §3.2: hands store raw inputs only. If a committed hand cached its points,
// switching ruleset would leave the old ones in place — and a game restored from
// storage would trust whatever numbers were on disk.

test('switching ruleset recomputes already-committed hands', () => {
  let g = newGame({ players: crew(), ruleset: 'standard' });
  // Seat 0 bids 1 and misses by taking 0; the others make nil. Under the
  // standard rules that is -10; under Landrattenwertung a missed bid is 0.
  g = commitHand(fill(g, [[1, 0], [0, 0], [1, 1]]));
  assert.equal(totals(g).p1, -10);

  const forgiving = { ...g, ruleset: 'landratta' };
  assert.equal(
    totals(forgiving).p1,
    0,
    'a committed hand must be rescored when the ruleset changes'
  );
});

test('a hand carries no cached score field', () => {
  let g = newGame({ players: crew() });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  const hand = g.hands.find((h) => h.n === 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(hand, 'scores'),
    false,
    'committed hands must not cache points'
  );
});

test('handScores reports a committed hand for display', () => {
  let g = newGame({ players: crew() });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  assert.deepEqual(handScores(g, g.hands[0]), { p1: 20, p2: 10, p3: 10 });
});

test('handScores reports zero for an uncommitted hand', () => {
  const g = fill(newGame({ players: crew() }), [[1, 1], [0, 0], [0, 0]]);
  assert.deepEqual(handScores(g, g.hands[0]), { p1: 0, p2: 0, p3: 0 });
});
