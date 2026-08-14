/**
 * Game state and transitions. Pure — no DOM, no globals, no rendering.
 *
 * Two invariants carry the whole design:
 *
 *  1. Hands store RAW INPUTS only (bid, tricks, bonus flags). Scores are always
 *     derived by summing `scoreHand` over committed hands. That makes undo a
 *     cursor rewind rather than a points refund, which is where the prototype
 *     had its nastiest bug: undoing from the final screen double-counted.
 *
 *  2. Every function returns a NEW game object. Callers never mutate state, so
 *     history snapshots stay trustworthy.
 */

import {
  RULESETS,
  cardsDealt,
  handsFor,
  scoreHand,
  validateHand,
} from './rules.js';

const PHASES = ['bid', 'trick', 'tally'];

/** A blank entry for one player in one hand. */
function blankEntry() {
  return { bid: null, tricks: null, mermaid: false, pirates: 0 };
}

/** A fresh, uncommitted hand. */
function blankHand(n, players) {
  const entries = {};
  for (const p of players) entries[p.id] = blankEntry();
  return { n, dice: cardsDealt(n), committed: false, entries };
}

/**
 * Start a game.
 *
 * `players` is [{name, emoji}] in seating order. Seat order is fixed for the
 * whole game — the score rail depends on positions never moving.
 */
export function newGame({ players, ruleset = 'standard', lang = 'sv', id } = {}) {
  const seated = players.map((p, seat) => ({
    id: p.id ?? `p${seat + 1}`,
    name: p.name ?? '',
    emoji: p.emoji ?? '',
    seat,
  }));

  return {
    id: id ?? `g${seated.length}-${seated.map((p) => p.id).join('')}`,
    createdAt: null, // stamped by storage; kept out of here so state stays pure
    lang,
    ruleset,
    players: seated,
    totalHands: handsFor(seated.length),
    hands: [blankHand(1, seated)],
    cursor: { hand: 1, phase: 'bid', seat: 0 },
  };
}

/** The ruleset object this game is scored with. */
export function rulesetOf(game) {
  return RULESETS[game.ruleset] ?? RULESETS.standard;
}

/** The hand the cursor is on. */
export function currentHand(game) {
  return game.hands.find((h) => h.n === game.cursor.hand) ?? null;
}

/** The player sitting at a seat. */
export function playerAt(game, seat) {
  return game.players.find((p) => p.seat === seat) ?? null;
}

/** Entries for a hand, in seat order. */
export function entriesInSeatOrder(game, hand) {
  return game.players.map((p) => hand.entries[p.id]);
}

function clone(game) {
  return structuredClone(game);
}

/**
 * Update one player's entry in the current hand.
 *
 * `patch` is a partial entry, e.g. {bid: 3} or {mermaid: true}. Returns a new
 * game; the original is untouched.
 */
export function setEntry(game, seat, patch) {
  const next = clone(game);
  const hand = currentHand(next);
  if (!hand || hand.committed) return next;

  const player = playerAt(next, seat);
  if (!player) return next;

  Object.assign(hand.entries[player.id], patch);
  return next;
}

/**
 * Commit the current hand and move to the next.
 *
 * Committing records nothing but the flag: points are always derived, so there
 * is no cached number to go stale when the ruleset changes or to be trusted when
 * a game is restored from disk.
 *
 * Throws rather than silently refusing, because committing is an explicit
 * action — a caller that reaches this with a bad hand has a bug, and the UI
 * gates the button on `validateHand` before ever calling it.
 */
export function commitHand(game) {
  const hand = currentHand(game);
  if (!hand) throw new Error('no hand to commit');
  if (hand.committed) throw new Error('hand already committed');

  const entries = entriesInSeatOrder(game, hand);
  const check = validateHand(entries, hand.dice);
  if (!check.complete) throw new Error('hand is incomplete');
  if (!check.ok) {
    throw new Error(
      `tricks must sum to ${hand.dice}, off by ${check.shortfall}`
    );
  }

  const next = clone(game);
  const committing = currentHand(next);
  committing.committed = true;

  if (committing.n < next.totalHands) {
    const following = committing.n + 1;
    if (!next.hands.some((h) => h.n === following)) {
      next.hands.push(blankHand(following, next.players));
    }
    next.cursor = { hand: following, phase: 'bid', seat: 0 };
  } else {
    next.cursor = { hand: committing.n, phase: 'tally', seat: 0 };
  }

  return next;
}

// --- Cursor navigation -----------------------------------------------------
// The Helm auto-advances: one tap per player, no tap spent choosing whom you
// are entering. The cursor is (hand, phase, seat) and moves in one direction at
// a time, so `back` is exactly the inverse of `advance`.

/** Move to the next slot: through the crew, then bid -> trick -> tally. */
export function advance(game) {
  const next = clone(game);
  const { phase, seat } = next.cursor;
  const lastSeat = next.players.length - 1;

  if (phase === 'tally') return next;

  if (seat < lastSeat) {
    next.cursor.seat = seat + 1;
    return next;
  }

  next.cursor.phase = phase === 'bid' ? 'trick' : 'tally';
  next.cursor.seat = next.cursor.phase === 'tally' ? lastSeat : 0;
  return next;
}

/** The inverse of `advance`. Stops at the first slot rather than wrapping. */
export function back(game) {
  const next = clone(game);
  const { phase, seat } = next.cursor;
  const lastSeat = next.players.length - 1;

  if (phase === 'tally') {
    next.cursor.phase = 'trick';
    next.cursor.seat = lastSeat;
    return next;
  }

  if (seat > 0) {
    next.cursor.seat = seat - 1;
    return next;
  }

  if (phase === 'trick') {
    next.cursor.phase = 'bid';
    next.cursor.seat = lastSeat;
  }
  return next;
}

/** Tricks already claimed in a hand, ignoring one seat if asked. */
function tricksClaimed(game, hand, exceptSeat = null) {
  return game.players.reduce((sum, p) => {
    if (p.seat === exceptSeat) return sum;
    const t = hand.entries[p.id].tricks;
    return sum + (Number.isInteger(t) ? t : 0);
  }, 0);
}

/**
 * Values the pad should offer for the slot under the cursor.
 *
 * Bids run 0..dice. Tricks are additionally capped by what is still unclaimed,
 * so the pad cannot be used to enter an arithmetically impossible hand — the sum
 * can fall short, which `validateHand` catches, but it can never overshoot.
 *
 * Every player enters their own trick count. Nothing is inferred for the last
 * seat: a number the app assigned on someone's behalf is a number nobody agreed
 * to, and it caused an argument exactly once per game.
 */
export function legalValues(game) {
  const hand = currentHand(game);
  if (!hand) return [];

  const all = Array.from({ length: hand.dice + 1 }, (_, i) => i);
  if (game.cursor.phase !== 'trick') return all;

  const spare = hand.dice - tricksClaimed(game, hand, game.cursor.seat);
  return all.filter((v) => v <= spare);
}

/**
 * Step back one action.
 *
 * On a committed hand this un-commits it, which refunds the points exactly
 * because scores are derived rather than accumulated. Otherwise it clears the
 * entry behind the cursor and moves there.
 */
export function undo(game) {
  const hand = currentHand(game);

  if (hand && hand.committed) {
    const next = clone(game);
    const reopened = currentHand(next);
    reopened.committed = false;
    next.cursor = { hand: reopened.n, phase: 'tally', seat: next.players.length - 1 };
    return next;
  }

  // From the tally, step back into entry WITHOUT erasing anything.
  //
  // "Undo" here means "let me back in to change something", not "delete the last
  // number". Erasing it meant that correcting a DIFFERENT player left two blanks,
  // so changing one value was not enough to return to the summary. Leaving the
  // values intact also keeps the hand commitable throughout a correction, which is
  // what lets the UI offer a direct route back to booking.
  if (game.cursor.phase === 'tally' && hand && !hand.committed) {
    const next = clone(game);
    next.cursor = { hand: hand.n, phase: 'trick', seat: next.players.length - 1 };
    return next;
  }

  // At the very start of a hand, reopen the previous one instead.
  const atStart = game.cursor.phase === 'bid' && game.cursor.seat === 0;
  if (atStart && game.cursor.hand > 1) {
    const previous = game.hands.find((h) => h.n === game.cursor.hand - 1);
    if (previous) {
      const next = clone(game);
      next.hands = next.hands.filter((h) => h.n <= previous.n);
      const reopened = currentHandOf(next, previous.n);
      reopened.committed = false;
      next.cursor = { hand: previous.n, phase: 'tally', seat: next.players.length - 1 };
      return next;
    }
  }

  const target = back(game);
  const field = target.cursor.phase === 'bid' ? 'bid' : 'tricks';
  const player = playerAt(target, target.cursor.seat);
  const targetHand = currentHand(target);
  if (targetHand && player && !targetHand.committed) {
    targetHand.entries[player.id][field] = null;
  }
  return target;
}

function currentHandOf(game, n) {
  return game.hands.find((h) => h.n === n);
}

/**
 * Players ranked by total, highest first, tie-aware.
 *
 * Rank is "one plus the number of strictly better totals", so ties share a rank
 * and a medal. Sorting and then assigning by array position silently hands out
 * gold and silver for identical scores, which the prototype did.
 */
export function standings(game) {
  const scores = totals(game);
  const rows = game.players
    .map((p) => ({ playerId: p.id, seat: p.seat, total: scores[p.id] }))
    .sort((a, b) => b.total - a.total || a.seat - b.seat);

  // No medals while everyone is level: before the first hand is booked the whole
  // crew is on zero, and four gold pips says nothing.
  const allLevel = rows.every((row) => row.total === rows[0].total);

  const medals = ['gold', 'silver', 'bronze'];
  return rows.map((row) => {
    const better = rows.filter((other) => other.total > row.total).length;
    const rank = better + 1;
    return {
      ...row,
      rank,
      medal: allLevel ? null : (medals[rank - 1] ?? null),
    };
  });
}

/**
 * Points each player scored in one hand, keyed by player id.
 *
 * Zero for an uncommitted hand, so a hand in progress can be displayed and
 * summed without special-casing. Derived on demand — see the module header.
 */
export function handScores(game, hand) {
  const ruleset = rulesetOf(game);
  const out = {};
  for (const p of game.players) {
    out[p.id] = hand.committed
      ? scoreHand(hand.entries[p.id], hand.dice, ruleset)
      : 0;
  }
  return out;
}

/** Cumulative totals, keyed by player id. Derived, never stored. */
export function totals(game) {
  const out = {};
  for (const p of game.players) out[p.id] = 0;
  for (const hand of game.hands) {
    if (!hand.committed) continue;
    const scored = handScores(game, hand);
    for (const p of game.players) out[p.id] += scored[p.id];
  }
  return out;
}

/** Has the last hand been committed? */
export function isFinished(game) {
  const last = game.hands.find((h) => h.n === game.totalHands);
  return Boolean(last && last.committed);
}

export { PHASES };
