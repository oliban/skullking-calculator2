/**
 * Persistence: the autosaved game in progress, the cross-game hall of fame, and
 * the two settings that outlive a game (language and ruleset).
 *
 * Three ideas carry this module.
 *
 *  1. THE BACKEND IS INJECTED. Every function takes `store`, defaulting to
 *     `globalThis.localStorage`. Tests pass a Map-backed fake, so persistence is
 *     testable under plain `node --test` with no jsdom and no browser.
 *
 *  2. EVERY READ IS DEFENSIVE. Corrupt JSON, a missing key, a schema version
 *     from a future build, a payload whose shape is wrong, or a backend that
 *     throws must all resolve to "start fresh". A pub-table app that boots into
 *     a broken screen is worse than one that lost a game.
 *
 *  3. EVERY WRITE MAY FAIL. Safari in private mode throws on `setItem` because
 *     its quota is zero. Writes therefore return a boolean and never throw: a
 *     failed autosave must not take down the game in progress.
 *
 * Values are wrapped in an envelope {schemaVersion, payload} so that a future
 * shape change is a migration rather than a data loss.
 */

import { PHASES, handScores, isFinished, standings, totals } from './state.js';

/** Bump when a stored payload's shape changes, and extend `migrate`. */
export const SCHEMA_VERSION = 1;

/** Namespaced so we can share the origin with anything else later. */
export const STORAGE_KEYS = {
  game: 'skullking2.game',
  hallOfFame: 'skullking2.hallOfFame',
  settings: 'skullking2.settings',
};

/** Swedish by default: the group is Swedish and the personas are the voice. */
export const DEFAULT_SETTINGS = Object.freeze({
  lang: 'sv',
  ruleset: 'standard',
});

const LANGS = new Set(['sv', 'en']);
const RULESET_IDS = new Set(['standard', 'landratta']);

/**
 * How many finished game ids we remember for `recordGame` deduplication.
 *
 * Bounded so the hall of fame cannot grow without limit over years of play.
 * Only the most recent ids matter — a game recorded 200 games ago is not about
 * to be recorded again.
 */
const RECORDED_IDS_KEPT = 200;

// --- Envelope + migration --------------------------------------------------

/**
 * Bring a stored envelope up to the current schema.
 *
 * Returns the payload, or `null` when the envelope cannot be understood — a
 * missing version, or a version from a build newer than this one. Downgrades
 * are not guessable, so we start fresh rather than misread data.
 *
 * There is nothing to migrate yet. The hook exists anyway so that the first
 * real shape change is an edit here rather than a decision about where such
 * code should live, taken under pressure.
 */
export function migrate(envelope) {
  if (!isPlainObject(envelope)) return null;
  const version = envelope.schemaVersion;
  if (!Number.isInteger(version) || version < 1) return null;
  if (version > SCHEMA_VERSION) return null; // written by a newer build

  let payload = envelope.payload;
  // Future migrations chain here, e.g.:
  //   if (version < 2) payload = upgrade1to2(payload);
  return payload === undefined ? null : payload;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A usable backend? */
function usable(store) {
  return Boolean(store) && typeof store.getItem === 'function';
}

/**
 * The platform store, or null when there isn't one.
 *
 * Deliberately gated on `window` rather than on `localStorage` existing. Node 25
 * ships an experimental `globalThis.localStorage`, so probing for it directly
 * would (a) emit a `--localstorage-file` warning and (b) let real, shared,
 * on-disk state leak between concurrently-executing test files — which is
 * exactly the kind of intermittent red that only shows up in CI. This module is
 * for the browser; under Node the answer is "no store".
 */
function defaultStore() {
  if (typeof globalThis.window === 'undefined') return null;
  try {
    return globalThis.localStorage;
  } catch {
    // Safari throws on access when storage is disabled entirely.
    return null;
  }
}

/**
 * Read and unwrap one key. Never throws — returns `null` on any problem,
 * including a backend that throws (private mode, disabled storage, SecurityError).
 */
function read(store, key) {
  if (!usable(store)) return null;
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw === '') return null;

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrate(envelope);
}

/** Wrap and write one key. Returns whether it landed; never throws. */
function write(store, key, payload) {
  if (!usable(store) || typeof store.setItem !== 'function') return false;
  try {
    store.setItem(key, JSON.stringify({ schemaVersion: SCHEMA_VERSION, payload }));
    return true;
  } catch {
    // Quota exceeded (Safari private mode) or storage disabled. The caller keeps
    // playing; only the safety net is gone.
    return false;
  }
}

/** Remove one key. Never throws. */
function drop(store, key) {
  if (!usable(store) || typeof store.removeItem !== 'function') return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// --- The game in progress --------------------------------------------------

/**
 * Does this payload look like a game from state.js?
 *
 * Deliberately structural rather than exhaustive: enough to be sure the rest of
 * the app can navigate it without throwing, without re-implementing state.js's
 * invariants here. Anything that fails becomes a fresh game.
 */
function looksLikeGame(g) {
  if (!isPlainObject(g)) return false;

  if (!Array.isArray(g.players) || g.players.length === 0) return false;
  if (
    !g.players.every(
      (p) => isPlainObject(p) && typeof p.id === 'string' && p.id !== '' && Number.isInteger(p.seat)
    )
  ) {
    return false;
  }
  // Duplicate ids would make `entries` ambiguous and duplicate seats would make
  // `playerAt` pick the wrong chair; both are unnavigable, so both start fresh.
  if (new Set(g.players.map((p) => p.id)).size !== g.players.length) return false;
  if (new Set(g.players.map((p) => p.seat)).size !== g.players.length) return false;

  if (!Number.isInteger(g.totalHands) || g.totalHands < 1) return false;

  if (!Array.isArray(g.hands) || g.hands.length === 0) return false;
  if (
    !g.hands.every(
      (h) =>
        isPlainObject(h) &&
        Number.isInteger(h.n) &&
        h.n >= 1 &&
        h.n <= g.totalHands &&
        Number.isInteger(h.dice) &&
        h.dice >= 1 &&
        isPlainObject(h.entries) &&
        // Every seated player needs an entry: the UI writes into
        // `entries[playerId]` without creating it, so a hole throws on the first
        // tap rather than at load.
        g.players.every((p) => isPlainObject(h.entries[p.id]))
    )
  ) {
    return false;
  }
  if (new Set(g.hands.map((h) => h.n)).size !== g.hands.length) return false;

  // The cursor must address something that exists. A cursor pointing past the
  // hands leaves `currentHand` null, which strands the app on a game it cannot
  // advance or commit — exactly the broken screen a fresh game is better than.
  const c = g.cursor;
  if (!isPlainObject(c)) return false;
  if (!g.hands.some((h) => h.n === c.hand)) return false;
  if (!PHASES.includes(c.phase)) return false;
  if (!Number.isInteger(c.seat) || c.seat < 0 || c.seat >= g.players.length) return false;

  return true;
}

/**
 * Autosave the game in progress.
 *
 * Called on every tap, not just every commit — a Safari killed mid-hand must
 * lose nothing. `createdAt` is stamped here rather than in state.js, which stays
 * pure and clock-free; an existing stamp is preserved.
 *
 * Returns true when the write landed. The game object is never mutated.
 */
export function saveGame(game, store = defaultStore(), { now = Date.now } = {}) {
  if (!looksLikeGame(game)) return false;
  const stamped =
    game.createdAt == null ? { ...game, createdAt: now() } : game;
  return write(store, STORAGE_KEYS.game, stamped);
}

/** The autosaved game, or `null` when there is nothing trustworthy to resume. */
export function loadGame(store = defaultStore()) {
  const payload = read(store, STORAGE_KEYS.game);
  return looksLikeGame(payload) ? payload : null;
}

/** Forget the autosave. Called when a game is abandoned or the reckoning is done. */
export function clearGame(store = defaultStore()) {
  return drop(store, STORAGE_KEYS.game);
}

/**
 * Is there a game worth offering to resume?
 *
 * A finished game is not resumable — its reckoning has been shown and its stats
 * banked, so offering it again would only invite a second recording attempt.
 */
export function hasResumableGame(store = defaultStore()) {
  const game = loadGame(store);
  if (!game) return false;
  try {
    return !isFinished(game);
  } catch {
    return false;
  }
}

// --- Hall of fame ----------------------------------------------------------

/**
 * The key a player's stats live under: trimmed and case-folded.
 *
 * Collisions merge ON PURPOSE (spec §3.2). Two people playing as "Rödskägg" on
 * different nights are one running rivalry, which is the whole point of the
 * feature. NFC normalisation is applied so that a decomposed "o" + combining
 * diaeresis keys the same as a precomposed "ö".
 */
export function nameKey(name) {
  return String(name ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase();
}

function blankRow(name) {
  return {
    name,
    gamesPlayed: 0,
    wins: 0,
    bestGame: null,
    worstGame: null,
    bestHand: null,
    totalPoints: 0,
    lastPlayed: null,
  };
}

/** A finite number, or the fallback. JSON turns NaN and Infinity into null. */
function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** A finite number or null — the "no games yet" state for the extremes. */
function numOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Coerce one stored row into the documented shape.
 *
 * This is not paranoia for its own sake: `recordGame` folds a game into whatever
 * it reads with `+=` and `Math.max`, so a single junk field (a row that is a
 * number, a `totalPoints` of `null` from a NaN that was serialised) would turn
 * every future total into NaN and stay that way forever. Sanitising on read is
 * the only place that can be stopped once.
 */
function sanitiseRow(raw, fallbackName) {
  const source = isPlainObject(raw) ? raw : {};
  const name = typeof source.name === 'string' && source.name.trim() !== ''
    ? source.name
    : fallbackName;
  return {
    name,
    gamesPlayed: Math.max(0, Math.trunc(num(source.gamesPlayed, 0))),
    wins: Math.max(0, Math.trunc(num(source.wins, 0))),
    bestGame: numOrNull(source.bestGame),
    worstGame: numOrNull(source.worstGame),
    bestHand: numOrNull(source.bestHand),
    totalPoints: num(source.totalPoints, 0),
    lastPlayed: numOrNull(source.lastPlayed),
  };
}

/**
 * Read and write rows by key without going through the prototype chain.
 *
 * A pirate is free to call themselves "__proto__" or "constructor". Plain
 * property access would then find something truthy on `Object.prototype` and
 * merge a game into it, and plain assignment to "__proto__" would set the map's
 * prototype instead of storing a row — the hall would look empty and every
 * subsequent read would be corrupt. `hasOwn` plus `defineProperty` keeps a name
 * a name.
 */
function getRow(map, key) {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function setRow(map, key, row) {
  Object.defineProperty(map, key, {
    value: row,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Does this payload look like a hall of fame we wrote? */
function readHallOfFameState(store) {
  const payload = read(store, STORAGE_KEYS.hallOfFame);
  if (!isPlainObject(payload) || !isPlainObject(payload.players)) {
    // Missing or corrupt: start a fresh hall rather than refuse to record.
    return { players: {}, recordedGameIds: [] };
  }
  const players = {};
  for (const [key, row] of Object.entries(payload.players)) {
    if (key === '') continue; // an unnamed row is not a pirate anyone can look up
    setRow(players, key, sanitiseRow(row, key));
  }
  return {
    players,
    recordedGameIds: Array.isArray(payload.recordedGameIds)
      ? payload.recordedGameIds.filter((id) => typeof id === 'string')
      : [],
  };
}

/**
 * The hall of fame, keyed by normalised name. `{}` when there is nothing, or
 * when what is there cannot be read.
 */
export function loadHallOfFame(store = defaultStore()) {
  return readHallOfFameState(store).players;
}

/**
 * Fold a finished game into the hall of fame. Written once, at the reckoning.
 *
 * Returns {recorded, reason, hallOfFame}. Refusals, all silent and non-fatal:
 *  - 'invalid'          — not a game object
 *  - 'no-id'            — no id, so it could not be deduplicated
 *  - 'unfinished'       — an abandoned game must not pollute cross-game stats
 *  - 'already-recorded' — idempotent per game id; the reckoning screen can be
 *                         re-entered, and undo can walk back into a finished
 *                         game and re-finish it, so double-counting is a matter
 *                         of when rather than if
 *  - 'write-failed'     — quota or disabled storage; the stats are lost, the
 *                         game is not
 */
export function recordGame(
  game,
  store = defaultStore(),
  { now = Date.now } = {}
) {
  const current = readHallOfFameState(store);
  const refuse = (reason) => ({ recorded: false, reason, hallOfFame: current.players });

  if (!looksLikeGame(game)) return refuse('invalid');
  if (typeof game.id !== 'string' || game.id === '') return refuse('no-id');

  let finished;
  let finalTotals;
  let ranked;
  try {
    finished = isFinished(game);
    if (!finished) return refuse('unfinished');
    finalTotals = totals(game);
    ranked = standings(game);
  } catch {
    return refuse('invalid');
  }

  if (current.recordedGameIds.includes(game.id)) return refuse('already-recorded');

  const at = now();
  const players = structuredClone(current.players);
  const winners = new Set(ranked.filter((r) => r.rank === 1).map((r) => r.playerId));

  // Seats are grouped by name key first, so one game counts as one game played
  // even if two chairs carry the same name. Folding seat by seat would have read
  // back the row it had just written and charged the name twice for one night.
  const seatsByKey = new Map();
  for (const player of game.players) {
    const key = nameKey(player.name);
    // An empty name has no plank to hang on, and every unnamed player would
    // merge into one meaningless row. Skip rather than invent a name.
    if (key === '') continue;
    if (!seatsByKey.has(key)) seatsByKey.set(key, []);
    seatsByKey.get(key).push(player);
  }

  for (const [key, seats] of seatsByKey) {
    // The last spelling wins the display name, so a rename shows up on the plank
    // while the merged history is kept.
    const display = String(seats.at(-1).name ?? '').trim();
    const existing = getRow(players, key);
    const row = existing
      ? { ...existing, name: display || existing.name }
      : blankRow(display);

    row.gamesPlayed += 1;
    if (seats.some((p) => winners.has(p.id))) row.wins += 1;
    row.lastPlayed = row.lastPlayed == null ? at : Math.max(row.lastPlayed, at);

    for (const player of seats) {
      const finalScore = num(finalTotals[player.id], 0);
      row.totalPoints += finalScore;
      row.bestGame = row.bestGame == null ? finalScore : Math.max(row.bestGame, finalScore);
      row.worstGame = row.worstGame == null ? finalScore : Math.min(row.worstGame, finalScore);

      // Best single hand. Committed hands carry their own scores (state.js
      // freezes them at commit), so this reads them rather than re-deriving the
      // rulebook.
      for (const hand of game.hands) {
        if (!hand.committed) continue;
        const handScore = handScores(game, hand)[player.id];
        if (!Number.isFinite(handScore)) continue;
        row.bestHand = row.bestHand == null ? handScore : Math.max(row.bestHand, handScore);
      }
    }

    setRow(players, key, row);
  }

  const recordedGameIds = [...current.recordedGameIds, game.id].slice(-RECORDED_IDS_KEPT);
  const ok = write(store, STORAGE_KEYS.hallOfFame, { players, recordedGameIds });
  if (!ok) return { recorded: false, reason: 'write-failed', hallOfFame: current.players };

  return { recorded: true, reason: null, hallOfFame: players };
}

// --- Settings --------------------------------------------------------------

/**
 * Persist language and ruleset. Partial patches are fine; anything unknown is
 * dropped rather than stored, so a bad value cannot survive a reload.
 */
export function saveSettings(settings, store = defaultStore()) {
  // A patch value we do not recognise is DROPPED, not applied. Merging it in and
  // then sanitising would silently reset a perfectly good stored setting back to
  // the default — a bad value must not be able to undo a good one.
  const patch = isPlainObject(settings) ? settings : {};
  const clean = sanitiseSettings({
    ...loadSettings(store),
    ...(LANGS.has(patch.lang) ? { lang: patch.lang } : {}),
    ...(RULESET_IDS.has(patch.ruleset) ? { ruleset: patch.ruleset } : {}),
  });
  return write(store, STORAGE_KEYS.settings, clean);
}

/** Settings, falling back to the defaults for anything missing or unknown. */
export function loadSettings(store = defaultStore()) {
  return sanitiseSettings(read(store, STORAGE_KEYS.settings));
}

function sanitiseSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    lang: LANGS.has(source.lang) ? source.lang : DEFAULT_SETTINGS.lang,
    ruleset: RULESET_IDS.has(source.ruleset) ? source.ruleset : DEFAULT_SETTINGS.ruleset,
  };
}
