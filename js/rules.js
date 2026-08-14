/**
 * Rules for Skull King: Das Würfelspiel (Schmidt Spiele, art. 49316).
 *
 * Pure. No DOM, no globals, no imports. Every rule in this file is traceable to
 * the official rulebook — see docs/superpowers/specs/ for the quotes.
 *
 * NOTE: this is the DICE game, not the Grandpa Beck's card game. There are no
 * card suits, no 14-capture bonuses, no Tigress and no Loot. If you are about to
 * add one of those, you are working from the wrong rulebook.
 */

/** Dice in the cloth bag. All dice return to it between hands. */
export const DICE_IN_BAG = 36;

/** Officially 3-6 players. We allow 2 as a house rule. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/**
 * Hands ("Durchgänge") played, by player count.
 *
 * Rulebook: 8 for 3-4 players, 7 for 5, 6 for 6. The 5- and 6-player
 * reductions are forced by the 36-dice bag; the 8-hand ceiling at 3-4 players
 * is the designer's chosen game length, not a supply limit.
 */
export function handsFor(playerCount) {
  if (
    !Number.isInteger(playerCount) ||
    playerCount < MIN_PLAYERS ||
    playerCount > MAX_PLAYERS
  ) {
    throw new RangeError(
      `player count must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`
    );
  }
  if (playerCount === 6) return 6;
  if (playerCount === 5) return 7;
  return 8;
}

/** Hand n deals n dice to each player, so the hand is n tricks long. */
export function cardsDealt(handNumber) {
  return handNumber;
}

// --- Bonuses ---------------------------------------------------------------
// Only two exist in the dice game, and both are gated on hitting the bid
// exactly. The caps come from the physical dice, not from taste.

/** A Mermaid skull capturing the Skull King's skull. */
export const MERMAID_BONUS = 50;
/** The Skull King's skull capturing a Pirate skull, per pirate. */
export const PIRATE_BONUS = 30;

/** Three Pirate dice exist, so +90 is the ceiling. The old app allowed 5. */
export const MAX_PIRATES = 3;

/**
 * Special dice in the box: 1 Skull King, 3 Pirates, 2 Mermaids.
 *
 * Kept because they are what the caps above are derived FROM, not decoration.
 * Note the asymmetry that makes the mermaid bonus cap 1 rather than 2: there
 * are two Mermaid dice, but only one Skull King for them to capture, so the +50
 * can be earned at most once per hand no matter how many mermaids are out.
 */
export const SKULL_KING_DICE = 1;
export const PIRATE_DICE = 3;
export const MERMAID_DICE = 2;
/** The +50 is capped by the Skull King, not by the mermaids. */
export const MAX_MERMAID_CAPTURES = SKULL_KING_DICE;

/**
 * Can this entry earn capture bonuses?
 *
 * Requires an exact bid AND at least one trick won — you cannot capture
 * anything in a trick you never won, so a made nil earns nothing. The old app
 * gated only on the exact bid and would happily bank +50 on a nil.
 */
export function bonusEligible(entry) {
  const { bid, tricks } = entry;
  if (!Number.isInteger(bid) || !Number.isInteger(tricks)) return false;
  return bid === tricks && tricks > 0;
}

/**
 * Scoring variants. The rules live in data so that the official simplified
 * variant is a config choice rather than a branch through the scorer.
 */
export const RULESETS = {
  /** The standard "Punktevergabe" from the rulebook. */
  standard: {
    id: 'standard',
    hitPerTrick: 20,
    nilPerDie: 10,
    missPerTrickOff: 10,
    nilMissPerDie: 10,
    bonuses: true,
  },

  /**
   * "Landrattenwertung" — the simplified variant printed in the rulebook. An
   * ordinary missed bid costs nothing, and no capture bonuses are awarded. The
   * nil penalty survives; only ordinary misses are forgiven.
   */
  landratta: {
    id: 'landratta',
    hitPerTrick: 20,
    nilPerDie: 10,
    missPerTrickOff: 0,
    nilMissPerDie: 10,
    bonuses: false,
  },
};

/**
 * Check a hand before it is committed.
 *
 * Returns {complete, ok, shortfall, warnings}:
 *  - `complete` — every seat has a bid and a trick count
 *  - `ok`       — complete AND the tricks sum to the dice dealt; safe to commit
 *  - `shortfall`— dice dealt minus tricks entered; negative means too many
 *  - `warnings` — legal to enter but physically odd; surfaced, never blocking,
 *                 because players record what happened, not what we expect.
 *                 Each carries a `code` for i18n to phrase — no prose in here.
 *
 * Trick sums are a hard gate: every trick in a hand is won by somebody, so the
 * total is fixed. The old app had no check and would happily commit an
 * impossible hand.
 */
export function validateHand(entries, dice) {
  const complete = entries.every(
    (e) => Number.isInteger(e.bid) && Number.isInteger(e.tricks)
  );
  const tricks = entries.reduce(
    (sum, e) => sum + (Number.isInteger(e.tricks) ? e.tricks : 0),
    0
  );
  const shortfall = dice - tricks;
  const warnings = [];

  entries.forEach((entry, seat) => {
    if (!bonusEligible(entry)) return;
    const pirates = Math.max(entry.pirates | 0, 0);
    if (entry.mermaid && pirates > 0) {
      warnings.push({ seat, code: 'mermaid-and-pirates' });
    }
  });

  const mermaidClaims = entries.filter(
    (e) => bonusEligible(e) && e.mermaid
  ).length;
  if (mermaidClaims > 1) {
    warnings.push({ seat: null, code: 'mermaid-claimed-twice', claimed: mermaidClaims });
  }

  const piratesClaimed = entries.reduce(
    (sum, e) => sum + (bonusEligible(e) ? Math.max(e.pirates | 0, 0) : 0),
    0
  );
  if (piratesClaimed > MAX_PIRATES) {
    warnings.push({ seat: null, code: 'too-many-pirates', claimed: piratesClaimed });
  }

  return { complete, ok: complete && shortfall === 0, shortfall, warnings };
}

/** Bonus points earned by an entry, or 0 when it is not eligible. */
function bonusPoints(entry, ruleset) {
  if (!ruleset.bonuses || !bonusEligible(entry)) return 0;
  const pirates = Math.min(Math.max(entry.pirates | 0, 0), MAX_PIRATES);
  return (entry.mermaid ? MERMAID_BONUS : 0) + pirates * PIRATE_BONUS;
}

/**
 * Score one player's hand.
 *
 * `entry` is {bid, tricks, mermaid, pirates}; `dice` is the dice dealt this hand
 * (never the hand index, so variable-length variants stay a data change).
 *
 * Returns 0 for an incomplete entry, so a hand in progress can be summed safely.
 */
export function scoreHand(entry, dice, ruleset = RULESETS.standard) {
  const { bid, tricks } = entry;
  if (!Number.isInteger(bid) || !Number.isInteger(tricks)) return 0;

  const hit = bid === tricks;
  let points;

  if (bid === 0) {
    // A nil is scored against the dice dealt, and the penalty is FLAT — taking
    // one trick and taking three are the same miss.
    points = hit ? ruleset.nilPerDie * dice : -ruleset.nilMissPerDie * dice;
  } else if (!hit) {
    points = -ruleset.missPerTrickOff * Math.abs(bid - tricks);
  } else {
    points = ruleset.hitPerTrick * bid + bonusPoints(entry, ruleset);
  }

  // Never hand back -0; it would render as "-0" on the score rail.
  return points === 0 ? 0 : points;
}
