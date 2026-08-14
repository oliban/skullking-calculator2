import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame,
  currentHand,
  setEntry,
  commitHand,
  advance,
  back,
  undo,
  standings,
  totals,
  legalValues,
  entriesInSeatOrder,
} from '../js/state.js';

import { validateHand } from '../js/rules.js';

const crew = () => [
  { name: 'Rodskagg', emoji: 'A' },
  { name: 'Blackhand', emoji: 'B' },
  { name: 'Hajen', emoji: 'C' },
];

const at = (g) => `${g.cursor.phase}/${g.cursor.seat}`;

/** Enter every bid then every trick, as the pad does. `spec` is [[bid, tricks]]. */
function fillHand(game, spec) {
  let g = game;
  spec.forEach(([bid], seat) => {
    g = setEntry(g, seat, { bid });
  });
  spec.forEach(([, tricks], seat) => {
    g = setEntry(g, seat, { tricks });
  });
  return { ...g, cursor: { ...g.cursor, phase: 'tally', seat: spec.length - 1 } };
}

// --- Auto-advance ----------------------------------------------------------
// The Helm walks the crew for you: one tap per player, no tap spent selecting
// who you are entering.

test('advance walks the crew through the bid phase', () => {
  let g = newGame({ players: crew() });
  assert.equal(at(g), 'bid/0');
  g = advance(g);
  assert.equal(at(g), 'bid/1');
  g = advance(g);
  assert.equal(at(g), 'bid/2');
});

test('advance moves from the last bid to the first trick', () => {
  let g = newGame({ players: crew() });
  g = advance(advance(advance(g)));
  assert.equal(at(g), 'trick/0');
});

test('advance from the last trick reaches the tally', () => {
  let g = newGame({ players: crew() });
  for (let i = 0; i < 6; i += 1) g = advance(g);
  assert.equal(g.cursor.phase, 'tally');
});

test('advance stops at the tally rather than wrapping around', () => {
  let g = newGame({ players: crew() });
  for (let i = 0; i < 20; i += 1) g = advance(g);
  assert.equal(g.cursor.phase, 'tally');
});

test('back retraces the same path', () => {
  let g = newGame({ players: crew() });
  g = advance(advance(advance(g)));
  assert.equal(at(g), 'trick/0');
  g = back(g);
  assert.equal(at(g), 'bid/2');
});

test('back from the very start stays put', () => {
  const g = newGame({ players: crew() });
  assert.equal(at(back(g)), 'bid/0');
});

// --- Legal values ----------------------------------------------------------

test('bids run from zero to the dice dealt', () => {
  const g = newGame({ players: crew() });
  assert.deepEqual(legalValues(g), [0, 1]);
});

test('the pad widens as hands grow', () => {
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 1 }), 0, { tricks: 1 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 0 }), 2, { tricks: 0 })
  );
  assert.deepEqual(legalValues(g), [0, 1, 2]);
});

test('trick values are capped by what is still unclaimed', () => {
  // Hand 2 deals two dice. Once seat 0 has claimed both tricks, nobody else can
  // claim any.
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 1 }), 0, { tricks: 1 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 0 }), 2, { tricks: 0 })
  );
  for (let i = 0; i < 3; i += 1) g = advance(g); // into the trick phase
  g = setEntry(g, 0, { tricks: 2 });
  g = advance(g);
  assert.deepEqual(legalValues(g), [0]);
});

// --- Nothing is inferred ---------------------------------------------------
// Every player reports their own tricks, the last one included. An earlier
// version filled in the final seat from the remainder; a number the app assigned
// on somebody's behalf is a number nobody agreed to.

test('the last seat is not filled in from the remainder', () => {
  let g = newGame({ players: crew() });
  for (let i = 0; i < 3; i += 1) g = advance(g);
  g = setEntry(g, 0, { tricks: 0 });
  g = setEntry(g, 1, { tricks: 0 });
  // One die dealt and nobody has claimed it, so seat 2 must have taken it — and
  // it stays blank until seat 2 says so.
  assert.equal(currentHand(g).entries.p3.tricks, null);
});

test('a hand is not commitable until every seat has reported', () => {
  let g = newGame({ players: crew() });
  g = setEntry(g, 0, { bid: 0 });
  g = setEntry(g, 1, { bid: 0 });
  g = setEntry(g, 2, { bid: 1 });
  g = setEntry(g, 0, { tricks: 0 });
  g = setEntry(g, 1, { tricks: 0 });
  assert.throws(() => commitHand(g), /incomplete|complete/i);
});

test('an entry a player never made cannot be conjured by advancing', () => {
  let g = newGame({ players: crew() });
  for (let i = 0; i < 6; i += 1) g = advance(g);
  for (const p of g.players) {
    assert.equal(currentHand(g).entries[p.id].tricks, null);
  }
});

// --- Undo ------------------------------------------------------------------

test('undo clears the most recent entry and steps the cursor back', () => {
  let g = newGame({ players: crew() });
  g = setEntry(g, 0, { bid: 1 });
  g = advance(g);
  g = undo(g);
  assert.equal(at(g), 'bid/0');
  assert.equal(currentHand(g).entries.p1.bid, null);
});

test('undo un-commits a hand and refunds its points exactly', () => {
  let g = newGame({ players: crew() });
  const before = totals(g);
  const filled = setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
    0, { bid: 1 }), 0, { tricks: 1 }),
    1, { bid: 0 }), 1, { tricks: 0 }),
    2, { bid: 0 }), 2, { tricks: 0 });
  g = commitHand(filled);
  assert.notDeepEqual(totals(g), before);

  g = undo(g);
  assert.deepEqual(totals(g), before, 'points must be fully refunded');
  assert.equal(g.cursor.hand, 1);
  assert.equal(currentHand(g).committed, false);
});

test('un-committing preserves the entries that were made', () => {
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 1, mermaid: false }), 0, { tricks: 1 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 0 }), 2, { tricks: 0 })
  );
  g = undo(g);
  assert.equal(currentHand(g).entries.p1.bid, 1);
  assert.equal(currentHand(g).entries.p1.tricks, 1);
});

test('repeated undo never produces a negative or stuck state', () => {
  let g = newGame({ players: crew() });
  g = setEntry(g, 0, { bid: 1 });
  for (let i = 0; i < 20; i += 1) g = undo(g);
  assert.equal(at(g), 'bid/0');
  assert.deepEqual(Object.values(totals(g)), [0, 0, 0]);
});

// --- Standings -------------------------------------------------------------

test('standings rank by total, highest first', () => {
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 1 }), 0, { tricks: 1 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 1 }), 2, { tricks: 0 })
  );
  const s = standings(g);
  assert.equal(s[0].playerId, 'p1');
  assert.equal(s[0].total, 20);
  assert.equal(s[0].rank, 1);
  assert.equal(s[2].playerId, 'p3');
  assert.equal(s[2].total, -10);
});

test('tied players share a rank and a medal', () => {
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 0 }), 0, { tricks: 0 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 1 }), 2, { tricks: 1 })
  );
  const s = standings(g);
  // Seat 2 made 1 trick for +20; seats 0 and 1 made nil for +10 each.
  assert.equal(s[0].rank, 1);
  assert.equal(s[1].rank, 2);
  assert.equal(s[2].rank, 2, 'a tie must not silently award second and third');
  assert.equal(s[1].medal, s[2].medal);
});

test('standings keep seat order as a stable tiebreak', () => {
  const g = newGame({ players: crew() });
  const s = standings(g);
  assert.deepEqual(
    s.map((row) => row.playerId),
    ['p1', 'p2', 'p3']
  );
  assert.ok(s.every((row) => row.rank === 1));
});

test('nobody wears a medal while the whole crew is level', () => {
  // Before the first hand is booked everyone is on zero. Handing out gold to all
  // four says nothing, and three gold pips on a rail looks like a bug.
  const g = newGame({ players: crew() });
  assert.deepEqual(
    standings(g).map((row) => row.medal),
    [null, null, null]
  );
});

test('medals appear as soon as the crew is not level', () => {
  let g = newGame({ players: crew() });
  g = commitHand(
    setEntry(setEntry(setEntry(setEntry(setEntry(setEntry(g,
      0, { bid: 1 }), 0, { tricks: 1 }),
      1, { bid: 0 }), 1, { tricks: 0 }),
      2, { bid: 0 }), 2, { tricks: 0 })
  );
  const s = standings(g);
  assert.equal(s[0].medal, 'gold');
  assert.ok(s[1].medal);
});

// --- Correcting from the summary -------------------------------------------
// Undo at the summary means "let me back in to change something", not "erase the
// last number". Erasing it meant that correcting a DIFFERENT player left two
// blanks, so one change was not enough to get back to the summary.

test('undo from the tally returns to entry without erasing anything', () => {
  let g = newGame({ players: crew() });
  g = fillHand(g, [[0, 0], [0, 0], [1, 1]]);
  assert.equal(g.cursor.phase, 'tally');

  g = undo(g);
  assert.equal(g.cursor.phase, 'trick');
  assert.equal(g.cursor.seat, 2, 'lands on the last seat entered');
  // Every value is still there, so changing exactly one thing completes the hand.
  for (const p of g.players) {
    assert.ok(Number.isInteger(currentHand(g).entries[p.id].bid));
    assert.ok(Number.isInteger(currentHand(g).entries[p.id].tricks));
  }
});

test('a hand stays complete while a correction is in progress', () => {
  let g = newGame({ players: crew() });
  g = fillHand(g, [[0, 0], [0, 0], [1, 1]]);
  g = undo(g);
  // Nothing was erased, so the hand is still commitable — which is what lets the
  // header offer a way straight back to booking.
  assert.doesNotThrow(() => commitHand(g));
});

test('changing one value after undo is enough to complete the hand', () => {
  let g = newGame({ players: crew() });
  g = fillHand(g, [[0, 0], [0, 0], [1, 1]]);
  g = undo(g);
  // Seat 2 re-reports the same trick; the hand is complete and valid again.
  g = setEntry(g, 2, { tricks: 1 });
  const hand = currentHand(g);
  const check = validateHand(entriesInSeatOrder(g, hand), hand.dice);
  assert.equal(check.complete, true);
  assert.equal(check.ok, true);
});
