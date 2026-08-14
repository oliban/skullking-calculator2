import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  migrate,
  saveGame,
  loadGame,
  clearGame,
  hasResumableGame,
  loadHallOfFame,
  nameKey,
  recordGame,
  saveSettings,
  loadSettings,
} from '../js/storage.js';

import {
  newGame,
  currentHand,
  setEntry,
  commitHand,
  totals,
  standings,
  isFinished,
} from '../js/state.js';

// --- Test doubles ----------------------------------------------------------
// A Map-backed stand-in for localStorage. The whole reason storage.js takes an
// injected backend is so this file needs no jsdom and no browser.

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Safari private mode: setItem throws once the (zero) quota is exceeded. */
function throwingStore() {
  const store = fakeStore();
  store.setItem = () => {
    throw new DOMException('QuotaExceededError');
  };
  return store;
}

/** A store already holding `payload` under `key`, wrapped in a live envelope. */
function storeWith(key, payload, schemaVersion = SCHEMA_VERSION) {
  return fakeStore({ [key]: JSON.stringify({ schemaVersion, payload }) });
}

const crew = () => [
  { name: 'Rödskägg', emoji: 'A' },
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

/** Play a game to the end, with `winner` taking every trick of every hand. */
function playOut(game, winner = 0) {
  let g = game;
  while (!isFinished(g)) {
    const dice = currentHand(g).dice;
    const spec = g.players.map((p) =>
      p.seat === winner ? [dice, dice] : [0, 0]
    );
    g = commitHand(fill(g, spec));
  }
  return g;
}

// --- Versioning ------------------------------------------------------------

test('the schema is versioned and the migration hook exists', () => {
  assert.equal(typeof SCHEMA_VERSION, 'number');
  assert.ok(SCHEMA_VERSION >= 1);
  // Nothing to migrate yet: a current-version envelope passes through as-is.
  const payload = { hello: 'sailor' };
  assert.deepEqual(migrate({ schemaVersion: SCHEMA_VERSION, payload }), payload);
});

test('migrate refuses a version it does not understand', () => {
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION + 99, payload: {} }), null);
  assert.equal(migrate({ payload: {} }), null);
  assert.equal(migrate(null), null);
  // A version that is not a whole number >= 1 is not a version we ever wrote.
  assert.equal(migrate({ schemaVersion: 0, payload: {} }), null);
  assert.equal(migrate({ schemaVersion: -1, payload: {} }), null);
  assert.equal(migrate({ schemaVersion: 1.5, payload: {} }), null);
  assert.equal(migrate({ schemaVersion: '1', payload: {} }), null);
  // An envelope with no payload at all carries nothing to migrate.
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION }), null);
  // Not an envelope.
  assert.equal(migrate([{ schemaVersion: SCHEMA_VERSION, payload: {} }]), null);
  assert.equal(migrate('sailor'), null);
});

test('migrate passes a falsy-but-present payload through', () => {
  // `0` and `false` are legitimate payloads; only `undefined` means "nothing".
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION, payload: 0 }), 0);
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION, payload: false }), false);
  assert.equal(migrate({ schemaVersion: SCHEMA_VERSION, payload: null }), null);
});

// --- Game round-trip -------------------------------------------------------

test('a game mid-hand survives a save/load round-trip', () => {
  const store = fakeStore();
  let g = newGame({ players: crew(), id: 'g-mid' });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  // Half of hand 2 entered: bids in, one trick count in, cursor mid-flight.
  g = setEntry(g, 0, { bid: 2 });
  g = setEntry(g, 1, { bid: 0 });
  g = setEntry(g, 2, { bid: 1, tricks: 1 });

  assert.equal(saveGame(g, store), true);
  const back = loadGame(store);

  assert.deepEqual(back.players, g.players);
  assert.deepEqual(back.cursor, g.cursor);
  assert.deepEqual(back.hands, g.hands);
  assert.deepEqual(totals(back), totals(g));
  assert.equal(currentHand(back).entries[g.players[2].id].tricks, 1);
});

test('saveGame stamps createdAt without mutating the game it was given', () => {
  const store = fakeStore();
  const g = newGame({ players: crew(), id: 'g-stamp' });
  const snapshot = JSON.stringify(g);

  saveGame(g, store, { now: () => 12345 });
  assert.equal(JSON.stringify(g), snapshot);
  assert.equal(loadGame(store).createdAt, 12345);
});

test('saveGame keeps a createdAt the game already carries', () => {
  const store = fakeStore();
  const g = { ...newGame({ players: crew(), id: 'g-keep' }), createdAt: 999 };
  saveGame(g, store, { now: () => 12345 });
  assert.equal(loadGame(store).createdAt, 999);
});

test('clearGame removes the autosave', () => {
  const store = fakeStore();
  saveGame(newGame({ players: crew(), id: 'g-clear' }), store);
  assert.notEqual(loadGame(store), null);
  clearGame(store);
  assert.equal(loadGame(store), null);
  assert.equal(hasResumableGame(store), false);
});

// --- Defensive reads -------------------------------------------------------

test('a missing key loads as no game rather than throwing', () => {
  const store = fakeStore();
  assert.equal(loadGame(store), null);
  assert.equal(hasResumableGame(store), false);
});

test('corrupt JSON loads as no game rather than throwing', () => {
  const store = fakeStore({ [STORAGE_KEYS.game]: '{"payload": {oh no' });
  assert.equal(loadGame(store), null);
  assert.equal(hasResumableGame(store), false);
});

test('an unknown schema version loads as no game rather than throwing', () => {
  const store = fakeStore({
    [STORAGE_KEYS.game]: JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 99,
      payload: newGame({ players: crew(), id: 'g-future' }),
    }),
  });
  assert.equal(loadGame(store), null);
  assert.equal(hasResumableGame(store), false);
});

test('a payload that is not shaped like a game loads as no game', () => {
  for (const payload of [
    null,
    42,
    'pirate',
    {},
    [],
    { players: 'nope', hands: [], cursor: {} },
    { players: [], hands: [], cursor: {} },
    { players: [{ id: 'p1', seat: 0 }], hands: 'nope', cursor: {} },
    { players: [{ id: 'p1', seat: 0 }], hands: [], cursor: null },
  ]) {
    assert.equal(
      loadGame(storeWith(STORAGE_KEYS.game, payload)),
      null,
      `accepted ${JSON.stringify(payload)}`
    );
  }
});

// The rejections above are the easy ones. These are the near-misses: payloads
// that pass a shallow shape check but that the rest of the app cannot navigate.
// Each mutates one field of a genuinely valid saved game, so the case is a
// statement about that field and nothing else.

/** A real autosave payload, exactly as it comes back out of the store. */
function savedPayload() {
  const store = fakeStore();
  let g = newGame({ players: crew(), id: 'g-shape' });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  g = setEntry(g, 0, { bid: 2 });
  saveGame(g, store, { now: () => 7 });
  return JSON.parse(store.map.get(STORAGE_KEYS.game)).payload;
}

/** Mutate one thing about a valid payload and see whether it survives a load. */
function loadMutated(mutate) {
  const payload = savedPayload();
  mutate(payload);
  return loadGame(storeWith(STORAGE_KEYS.game, payload));
}

test('the baseline payload the near-miss cases mutate does load', () => {
  // Without this, every rejection below could be passing for the wrong reason.
  const back = loadMutated(() => {});
  assert.notEqual(back, null);
  assert.equal(back.id, 'g-shape');
});

test('a game whose cursor points at no hand loads as no game', () => {
  // currentHand() would be null: the app could neither enter nor commit, which
  // is the stranded-on-a-broken-screen case a fresh game beats.
  assert.equal(loadMutated((g) => { g.cursor.hand = 99; }), null);
  assert.equal(loadMutated((g) => { g.cursor.hand = '2'; }), null);
  assert.equal(loadMutated((g) => { delete g.cursor.hand; }), null);
});

test('a game with an unknown cursor phase loads as no game', () => {
  assert.equal(loadMutated((g) => { g.cursor.phase = 'plunder'; }), null);
  assert.equal(loadMutated((g) => { delete g.cursor.phase; }), null);
});

test('a game whose cursor sits at a seat nobody occupies loads as no game', () => {
  assert.equal(loadMutated((g) => { g.cursor.seat = 3; }), null);
  assert.equal(loadMutated((g) => { g.cursor.seat = -1; }), null);
  assert.equal(loadMutated((g) => { g.cursor.seat = 1.5; }), null);
});

test('a game with no totalHands loads as no game', () => {
  // totalHands drives isFinished and the hand ladder; without it the game can
  // never end.
  assert.equal(loadMutated((g) => { delete g.totalHands; }), null);
  assert.equal(loadMutated((g) => { g.totalHands = 0; }), null);
  assert.equal(loadMutated((g) => { g.totalHands = 8.5; }), null);
});

test('a game with a hand beyond totalHands loads as no game', () => {
  // The cursor is moved along with it, so this rejection is about the hand
  // number alone and not about a dangling cursor.
  assert.equal(loadMutated((g) => { g.hands[1].n = 99; g.cursor.hand = 99; }), null);
  assert.equal(loadMutated((g) => { g.hands[0].n = 0; }), null);
});

test('a game with two hands claiming the same number loads as no game', () => {
  assert.equal(loadMutated((g) => { g.hands[1].n = 1; g.cursor.hand = 1; }), null);
});

test('a hand with no dice count loads as no game', () => {
  assert.equal(loadMutated((g) => { delete g.hands[0].dice; }), null);
  assert.equal(loadMutated((g) => { g.hands[0].dice = 0; }), null);
});

test('a stale cached score on disk is ignored rather than trusted', () => {
  // Scores are derived from the raw entries (spec §3.2), so a payload carrying a
  // `scores` field — written by an older build, or tampered with — must not be
  // able to change anyone's total. This is the pay-off for not caching points.
  const loaded = loadMutated((g) => {
    g.hands[0].scores = { p1: 99999 };
  });
  assert.notEqual(loaded, null, 'an unknown extra field must not reject the game');
  assert.equal(
    totals(loaded).p1,
    totals(loadMutated(() => {})).p1,
    'the bogus cached score must have no effect'
  );
  // And the derived value is the real one: seat 0 bid 1 and made it in hand 1.
  assert.equal(totals(loaded).p1, 20);
});

test('a hand missing an entry for a seated player loads as no game', () => {
  // setEntry writes into entries[playerId] without creating it, so a hole here
  // throws on the very first tap.
  assert.equal(loadMutated((g) => { delete g.hands[1].entries[g.players[2].id]; }), null);
  assert.equal(loadMutated((g) => { g.hands[1].entries[g.players[2].id] = null; }), null);
  assert.equal(loadMutated((g) => { g.hands[1].entries = {}; }), null);
});

test('a game with duplicate player ids or seats loads as no game', () => {
  assert.equal(loadMutated((g) => { g.players[1].id = g.players[0].id; }), null);
  assert.equal(loadMutated((g) => { g.players[1].seat = g.players[0].seat; }), null);
  assert.equal(loadMutated((g) => { g.players[1].id = ''; }), null);
  assert.equal(loadMutated((g) => { delete g.players[1].seat; }), null);
});

test('a game that fails the shape check is not autosaved either', () => {
  // Same gate on the way in as on the way out, so a broken in-memory game cannot
  // overwrite a good autosave.
  const store = fakeStore();
  saveGame(newGame({ players: crew(), id: 'g-good' }), store);
  assert.equal(saveGame({ id: 'g-bad', players: [], hands: [], cursor: {} }, store), false);
  assert.equal(loadGame(store).id, 'g-good');
});

test('a store handing back something that is not a string reads as nothing', () => {
  const store = fakeStore();
  store.getItem = () => ({ schemaVersion: SCHEMA_VERSION, payload: { lang: 'en' } });
  assert.equal(loadGame(store), null);
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);

  const empty = fakeStore();
  empty.getItem = () => '';
  assert.equal(loadGame(empty), null);
  assert.deepEqual(loadHallOfFame(empty), {});
});

test('a store that throws on read loads as no game', () => {
  const store = fakeStore();
  store.getItem = () => {
    throw new Error('blocked');
  };
  assert.equal(loadGame(store), null);
  assert.deepEqual(loadHallOfFame(store), {});
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
});

test('a store that throws on removeItem reports failure instead of throwing', () => {
  const store = fakeStore();
  saveGame(newGame({ players: crew(), id: 'g-stuck' }), store);
  store.removeItem = () => {
    throw new DOMException('SecurityError');
  };
  assert.equal(clearGame(store), false);
});

test('a half-implemented backend is treated as no backend', () => {
  // Not hypothetical: some privacy shims expose a localStorage-shaped object with
  // only the reads wired up.
  const readOnly = fakeStore();
  delete readOnly.setItem;
  delete readOnly.removeItem;
  assert.equal(saveGame(newGame({ players: crew(), id: 'g-ro' }), readOnly), false);
  assert.equal(saveSettings({ lang: 'en' }, readOnly), false);
  assert.equal(clearGame(readOnly), false);

  const writeOnly = fakeStore();
  delete writeOnly.getItem;
  assert.equal(loadGame(writeOnly), null);
  assert.equal(saveGame(newGame({ players: crew(), id: 'g-wo' }), writeOnly), false);
  assert.deepEqual(loadSettings(writeOnly), DEFAULT_SETTINGS);
});

test('an absent storage backend degrades quietly', () => {
  assert.equal(loadGame(undefined), null);
  assert.equal(saveGame(newGame({ players: crew(), id: 'g-none' }), undefined), false);
  assert.equal(hasResumableGame(undefined), false);
  assert.deepEqual(loadHallOfFame(undefined), {});
  assert.doesNotThrow(() => clearGame(undefined));
});

// --- Failing writes --------------------------------------------------------

test('a store that throws on write reports failure instead of breaking the game', () => {
  const store = throwingStore();
  const g = newGame({ players: crew(), id: 'g-quota' });
  assert.equal(saveGame(g, store), false);
  // The game object is untouched and still playable.
  assert.equal(currentHand(g).n, 1);
  assert.doesNotThrow(() => saveSettings({ lang: 'en' }, store));
  assert.equal(saveSettings({ lang: 'en' }, store), false);
});

test('recordGame reports a failed write instead of throwing', () => {
  const store = throwingStore();
  const g = playOut(newGame({ players: crew(), id: 'g-quota-2' }));
  const result = recordGame(g, store);
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'write-failed');
});

// --- hasResumableGame ------------------------------------------------------

test('hasResumableGame is true only for an unfinished saved game', () => {
  const fresh = fakeStore();
  assert.equal(hasResumableGame(fresh), false);

  const mid = fakeStore();
  let g = newGame({ players: crew(), id: 'g-resume' });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));
  saveGame(g, mid);
  assert.equal(hasResumableGame(mid), true);

  const done = fakeStore();
  saveGame(playOut(newGame({ players: crew(), id: 'g-done' })), done);
  assert.equal(hasResumableGame(done), false);
});

// --- Hall of fame ----------------------------------------------------------

test('the hall of fame starts empty', () => {
  assert.deepEqual(loadHallOfFame(fakeStore()), {});
});

test('corrupt hall of fame data reads as empty', () => {
  assert.deepEqual(loadHallOfFame(fakeStore({ [STORAGE_KEYS.hallOfFame]: 'nope{' })), {});
  assert.deepEqual(
    loadHallOfFame(
      fakeStore({
        [STORAGE_KEYS.hallOfFame]: JSON.stringify({
          schemaVersion: SCHEMA_VERSION + 99,
          payload: { rodskagg: { name: 'x' } },
        }),
      })
    ),
    {}
  );
  assert.deepEqual(
    loadHallOfFame(
      fakeStore({
        [STORAGE_KEYS.hallOfFame]: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          payload: 'not an object',
        }),
      })
    ),
    {}
  );
});

test('recording a finished game aggregates one row per player', () => {
  const store = fakeStore();
  const g = playOut(newGame({ players: crew(), id: 'g-1' }), 0);
  const scores = totals(g);
  const winnerId = standings(g)[0].playerId;

  const result = recordGame(g, store, { now: () => 1000 });
  assert.equal(result.recorded, true);

  const hof = loadHallOfFame(store);
  assert.equal(Object.keys(hof).length, 3);

  const row = hof['rödskägg'];
  assert.equal(row.name, 'Rödskägg');
  assert.equal(row.gamesPlayed, 1);
  // Seat 0 took every trick of every hand, so seat 0 is the winner outright:
  // 20 x dice per hand over 8 hands is 720 against 360 for a made nil each hand.
  assert.equal(g.players[0].id, winnerId);
  assert.equal(scores[winnerId], 720);
  assert.equal(row.wins, 1);
  assert.equal(row.totalPoints, 720);
  assert.equal(row.bestGame, 720);
  assert.equal(row.worstGame, 720);
  assert.equal(row.lastPlayed, 1000);
  // Seat 0 won every trick of hand 8: 8 bid, 8 made -> +160, the best hand.
  assert.equal(row.bestHand, 160);

  // The losers are recorded too, and their best hand is the made nil in hand 8.
  assert.equal(hof['blackhand'].wins, 0);
  assert.equal(hof['blackhand'].totalPoints, 360);
  assert.equal(hof['blackhand'].bestHand, 80);

  // What the call returns is what the next load will see.
  assert.deepEqual(result.hallOfFame, hof);
});

test('a tie for first records a win for everyone tied', () => {
  // Hands 1+4+6+7 = 2+3+5+8 = 18 dice, so seats 0 and 1 finish level: 20x18 for
  // the hands they sweep plus 10x18 for their made nils, 540 each. Counting only
  // standings()[0] would hand out one win, which is the prototype's medal bug.
  const store = fakeStore();
  const seat0Sweeps = new Set([1, 4, 6, 7]);
  let g = newGame({ players: crew(), id: 'g-tie' });
  while (!isFinished(g)) {
    const hand = currentHand(g);
    const sweeper = seat0Sweeps.has(hand.n) ? 0 : 1;
    const spec = g.players.map((p) =>
      p.seat === sweeper ? [hand.dice, hand.dice] : [0, 0]
    );
    g = commitHand(fill(g, spec));
  }

  const scores = totals(g);
  assert.equal(scores[g.players[0].id], 540);
  assert.equal(scores[g.players[1].id], 540);

  recordGame(g, store, { now: () => 5 });
  const hof = loadHallOfFame(store);
  assert.equal(hof['rödskägg'].wins, 1);
  assert.equal(hof['blackhand'].wins, 1);
  assert.equal(hof['hajen'].wins, 0);
});

test('the hall of fame aggregates across two games', () => {
  const store = fakeStore();
  const a = playOut(newGame({ players: crew(), id: 'g-a' }), 0);
  const b = playOut(newGame({ players: crew(), id: 'g-b' }), 1);
  recordGame(a, store, { now: () => 1000 });
  recordGame(b, store, { now: () => 2000 });

  const hof = loadHallOfFame(store);
  const red = hof['rödskägg'];
  const black = hof['blackhand'];

  assert.equal(red.gamesPlayed, 2);
  assert.equal(black.gamesPlayed, 2);
  assert.equal(red.wins, 1);
  assert.equal(black.wins, 1);
  assert.equal(red.totalPoints, totals(a)[a.players[0].id] + totals(b)[b.players[0].id]);
  assert.equal(red.bestGame, Math.max(totals(a)[a.players[0].id], totals(b)[b.players[0].id]));
  assert.equal(red.worstGame, Math.min(totals(a)[a.players[0].id], totals(b)[b.players[0].id]));
  assert.equal(red.lastPlayed, 2000);
});

test('the same name on different nights merges into one rivalry', () => {
  const store = fakeStore();
  const a = playOut(newGame({ players: crew(), id: 'g-c' }), 0);
  const b = playOut(
    newGame({
      players: [
        { name: '  RÖDSKÄGG  ', emoji: 'Z' },
        { name: 'Kraken', emoji: 'Y' },
        { name: 'Muren', emoji: 'X' },
      ],
      id: 'g-d',
    }),
    1
  );
  recordGame(a, store, { now: () => 1000 });
  recordGame(b, store, { now: () => 2000 });

  const hof = loadHallOfFame(store);
  assert.equal(Object.keys(hof).length, 5, Object.keys(hof).join(','));
  assert.equal(hof['rödskägg'].gamesPlayed, 2);
  // The display name follows the most recent spelling, trimmed.
  assert.equal(hof['rödskägg'].name, 'RÖDSKÄGG');
});

test('recordGame is idempotent per game id', () => {
  const store = fakeStore();
  const g = playOut(newGame({ players: crew(), id: 'g-once' }), 0);

  assert.equal(recordGame(g, store).recorded, true);
  const second = recordGame(g, store);
  assert.equal(second.recorded, false);
  assert.equal(second.reason, 'already-recorded');

  const hof = loadHallOfFame(store);
  assert.equal(hof['rödskägg'].gamesPlayed, 1);
  assert.equal(hof['rödskägg'].totalPoints, totals(g)[g.players[0].id]);
});

test('recordGame refuses an unfinished game', () => {
  const store = fakeStore();
  let g = newGame({ players: crew(), id: 'g-abandoned' });
  g = commitHand(fill(g, [[1, 1], [0, 0], [0, 0]]));

  const result = recordGame(g, store);
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'unfinished');
  assert.deepEqual(loadHallOfFame(store), {});
});

test('recordGame refuses a game with no id, since it could not be deduplicated', () => {
  const store = fakeStore();
  const g = playOut(newGame({ players: crew(), id: 'g-noid' }), 0);
  const result = recordGame({ ...g, id: '' }, store);
  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'no-id');
  assert.deepEqual(loadHallOfFame(store), {});
});

test('recordGame refuses junk instead of throwing', () => {
  const store = fakeStore();
  for (const junk of [null, 42, {}, { id: 'x', players: [] }]) {
    const result = recordGame(junk, store);
    assert.equal(result.recorded, false, JSON.stringify(junk));
  }
  assert.deepEqual(loadHallOfFame(store), {});
});

test('a corrupt hall of fame is replaced rather than blocking a recording', () => {
  const store = fakeStore({ [STORAGE_KEYS.hallOfFame]: 'garbage{' });
  const g = playOut(newGame({ players: crew(), id: 'g-rebuild' }), 0);
  assert.equal(recordGame(g, store).recorded, true);
  assert.equal(loadHallOfFame(store)['rödskägg'].gamesPlayed, 1);
});

test('a failed write leaves the hall of fame it could not extend intact', () => {
  const store = fakeStore();
  const a = playOut(newGame({ players: crew(), id: 'g-keep-a' }), 0);
  recordGame(a, store, { now: () => 1000 });
  const before = loadHallOfFame(store);

  store.setItem = () => {
    throw new DOMException('QuotaExceededError');
  };
  const b = playOut(newGame({ players: crew(), id: 'g-keep-b' }), 1);
  const result = recordGame(b, store);

  assert.equal(result.reason, 'write-failed');
  // The reported hall is the one still on disk, not the one that never landed.
  assert.deepEqual(result.hallOfFame, before);
  assert.equal(result.hallOfFame['rödskägg'].gamesPlayed, 1);
});

test('the dedup list is capped, and forgetting is the only way a game returns', () => {
  const older = Array.from({ length: 400 }, (_, i) => `ancient-${i}`);
  const store = storeWith(STORAGE_KEYS.hallOfFame, {
    players: {},
    recordedGameIds: older,
  });
  const g = playOut(newGame({ players: crew(), id: 'g-capped' }), 0);
  assert.equal(recordGame(g, store).recorded, true);

  const kept = JSON.parse(store.map.get(STORAGE_KEYS.hallOfFame)).payload.recordedGameIds;
  assert.ok(kept.length <= 200, `kept ${kept.length}`);
  // The newest id is what dedup actually needs, so it must be the one retained.
  assert.equal(kept.at(-1), 'g-capped');
  assert.equal(kept.includes('ancient-0'), false);
  assert.equal(kept.includes('ancient-399'), true);
  // Still deduplicated within the window.
  assert.equal(recordGame(g, store).reason, 'already-recorded');
});

test('non-string dedup ids are discarded rather than carried forward', () => {
  const store = storeWith(STORAGE_KEYS.hallOfFame, {
    players: {},
    recordedGameIds: [42, null, { id: 'g-old' }, 'g-old'],
  });
  const g = playOut(newGame({ players: crew(), id: 'g-new' }), 0);
  assert.equal(recordGame(g, store).recorded, true);

  const kept = JSON.parse(store.map.get(STORAGE_KEYS.hallOfFame)).payload.recordedGameIds;
  // Junk is dropped on the way through rather than kept forever inside the cap.
  assert.deepEqual(kept, ['g-old', 'g-new']);
});

test('a dedup list that is not a list reads as no recorded games', () => {
  const store = storeWith(STORAGE_KEYS.hallOfFame, {
    players: {},
    recordedGameIds: 'not an array',
  });
  const g = playOut(newGame({ players: crew(), id: 'g-nolist' }), 0);
  assert.equal(recordGame(g, store).recorded, true);
  assert.equal(recordGame(g, store).reason, 'already-recorded');
});

test('junk rows in a stored hall of fame are coerced, not merged into', () => {
  // Without a sanitising read, `row.gamesPlayed += 1` on a row that is a number
  // yields NaN and the row stays NaN for the rest of the app's life.
  const store = storeWith(STORAGE_KEYS.hallOfFame, {
    players: {
      'rödskägg': 42,
      blackhand: { name: 'Blackhand', gamesPlayed: 'lots', totalPoints: null, wins: -3 },
      hajen: { name: 'Hajen', bestGame: 'huge', lastPlayed: 'yesterday' },
      '': { name: 'nobody', gamesPlayed: 9 },
    },
  });

  const loaded = loadHallOfFame(store);
  assert.equal(loaded['rödskägg'].gamesPlayed, 0);
  assert.equal(loaded['rödskägg'].name, 'rödskägg'); // the key is the last resort
  assert.equal(loaded.blackhand.gamesPlayed, 0);
  assert.equal(loaded.blackhand.totalPoints, 0);
  assert.equal(loaded.blackhand.wins, 0);
  assert.equal(loaded.hajen.bestGame, null);
  assert.equal(loaded.hajen.lastPlayed, null);
  assert.equal(Object.hasOwn(loaded, ''), false);

  const g = playOut(newGame({ players: crew(), id: 'g-junk-rows' }), 0);
  assert.equal(recordGame(g, store, { now: () => 3000 }).recorded, true);
  const hof = loadHallOfFame(store);
  for (const key of ['rödskägg', 'blackhand', 'hajen']) {
    assert.equal(hof[key].gamesPlayed, 1, key);
    assert.equal(Number.isFinite(hof[key].totalPoints), true, key);
    assert.equal(Number.isFinite(hof[key].bestHand), true, key);
    assert.equal(hof[key].lastPlayed, 3000, key);
  }
  assert.equal(hof['rödskägg'].totalPoints, 720);
});

test('a pirate named after an Object.prototype key is still just a name', () => {
  // Plain property access would find something truthy on the prototype and merge
  // into it, and plain assignment to "__proto__" would set the map's prototype
  // instead of storing a row.
  const store = fakeStore();
  const players = [
    { name: '__proto__', emoji: 'A' },
    { name: 'constructor', emoji: 'B' },
    { name: 'toString', emoji: 'C' },
  ];
  const g = playOut(newGame({ players, id: 'g-proto' }), 0);
  assert.equal(recordGame(g, store, { now: () => 4000 }).recorded, true);

  const hof = loadHallOfFame(store);
  // Keys are case-folded, so "toString" files under "tostring".
  assert.deepEqual(Object.keys(hof).sort(), ['__proto__', 'constructor', 'tostring']);
  for (const key of ['__proto__', 'constructor', 'tostring']) {
    const row = Object.getOwnPropertyDescriptor(hof, key).value;
    assert.equal(row.gamesPlayed, 1, key);
    assert.equal(Number.isFinite(row.totalPoints), true, key);
  }
  assert.equal(Object.getOwnPropertyDescriptor(hof, '__proto__').value.totalPoints, 720);
  // The map itself was not re-prototyped on the way through storage.
  assert.equal(Object.getPrototypeOf(hof), Object.prototype);

  // And it survives a second recording, which is where a poisoned map shows up.
  const g2 = playOut(newGame({ players, id: 'g-proto-2' }), 0);
  assert.equal(recordGame(g2, store, { now: () => 5000 }).recorded, true);
  const again = loadHallOfFame(store);
  assert.equal(Object.getOwnPropertyDescriptor(again, '__proto__').value.gamesPlayed, 2);
});

test('an unnamed player is skipped rather than filed under the empty name', () => {
  const store = fakeStore();
  const players = [
    { name: '   ', emoji: 'A' },
    { name: 'Kraken', emoji: 'B' },
    { name: 'Muren', emoji: 'C' },
  ];
  const g = playOut(newGame({ players, id: 'g-unnamed' }), 0);
  assert.equal(recordGame(g, store).recorded, true);

  const hof = loadHallOfFame(store);
  assert.deepEqual(Object.keys(hof).sort(), ['kraken', 'muren']);
  // Not merely hidden on the way back out — never written in the first place.
  const stored = JSON.parse(store.map.get(STORAGE_KEYS.hallOfFame)).payload.players;
  assert.deepEqual(Object.keys(stored).sort(), ['kraken', 'muren']);
});

test('two chairs sharing one name still count as one game played', () => {
  // The merge is by name (spec 3.2), so the name plays once per game however
  // many chairs it occupies. Folding seat by seat would read back the row just
  // written and charge the night twice.
  const store = fakeStore();
  const players = [
    { name: 'Kraken', emoji: 'A' },
    { name: 'kraken', emoji: 'B' },
    { name: 'Muren', emoji: 'C' },
  ];
  const g = playOut(newGame({ players, id: 'g-twins' }), 0);
  recordGame(g, store, { now: () => 6000 });

  const hof = loadHallOfFame(store);
  assert.deepEqual(Object.keys(hof).sort(), ['kraken', 'muren']);
  assert.equal(hof.kraken.gamesPlayed, 1);
  assert.equal(hof.kraken.wins, 1); // seat 0 swept; the name won
  // Both chairs' points land on the one row: 720 for the sweeper, 360 for the nil.
  assert.equal(hof.kraken.totalPoints, 1080);
  assert.equal(hof.kraken.bestGame, 720);
  assert.equal(hof.kraken.worstGame, 360);
});

// "R\u00f6dsk\u00e4gg" spelled with combining diaereses instead of precomposed
// letters -- what a paste from another device can hand us.
const DECOMPOSED_RED = 'Ro\u0308dska\u0308gg';

test('nameKey folds case, surrounding space and unicode composition', () => {
  assert.equal(nameKey('  R\u00f6dsk\u00e4gg '), nameKey('R\u00d6DSK\u00c4GG'));
  // Decomposed o + combining diaeresis keys the same as the precomposed letter.
  assert.notEqual(DECOMPOSED_RED, 'R\u00f6dsk\u00e4gg'); // different code points
  assert.equal(nameKey(DECOMPOSED_RED), nameKey('R\u00f6dsk\u00e4gg'));
  assert.equal(nameKey(null), '');
  assert.equal(nameKey(undefined), '');
  assert.equal(nameKey(7), '7');
});

test('a decomposed name merges with its precomposed self', () => {
  const store = fakeStore();
  const a = playOut(newGame({ players: crew(), id: 'g-nfc-a' }), 0);
  const b = playOut(
    newGame({
      players: [
        { name: 'Rödskägg', emoji: 'Z' },
        { name: 'Kraken', emoji: 'Y' },
        { name: 'Muren', emoji: 'X' },
      ],
      id: 'g-nfc-b',
    }),
    0
  );
  recordGame(a, store, { now: () => 1000 });
  recordGame(b, store, { now: () => 2000 });
  assert.equal(loadHallOfFame(store)['rödskägg'].gamesPlayed, 2);
});

// --- Settings --------------------------------------------------------------

test('settings default to Swedish and the standard ruleset', () => {
  assert.deepEqual(loadSettings(fakeStore()), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.lang, 'sv');
  assert.equal(DEFAULT_SETTINGS.ruleset, 'standard');
});

test('settings round-trip', () => {
  const store = fakeStore();
  assert.equal(saveSettings({ lang: 'en', ruleset: 'landratta' }, store), true);
  assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'landratta' });
});

test('a partial settings save keeps the defaults for what it omits', () => {
  const store = fakeStore();
  saveSettings({ lang: 'en' }, store);
  assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'standard' });
});

test('a partial settings save keeps what is already stored', () => {
  const store = fakeStore();
  saveSettings({ lang: 'en', ruleset: 'landratta' }, store);
  saveSettings({ lang: 'sv' }, store);
  assert.deepEqual(loadSettings(store), { lang: 'sv', ruleset: 'landratta' });
});

test('an unrecognised patch value is dropped, not applied over a good one', () => {
  // Merging the junk in and sanitising afterwards would reset the stored value to
  // the default: a bad value must not be able to undo a good one.
  const store = fakeStore();
  saveSettings({ lang: 'en', ruleset: 'landratta' }, store);
  saveSettings({ lang: 'klingon' }, store);
  assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'landratta' });
  saveSettings({ ruleset: 'pirate-poker' }, store);
  assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'landratta' });
});

test('settings keys we do not own are never stored', () => {
  const store = fakeStore();
  saveSettings({ lang: 'en', crewSize: 6, theme: 'dark' }, store);
  assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'standard' });
  assert.deepEqual(JSON.parse(store.map.get(STORAGE_KEYS.settings)).payload, {
    lang: 'en',
    ruleset: 'standard',
  });
});

test('saveSettings survives being handed something that is not a patch', () => {
  const store = fakeStore();
  saveSettings({ lang: 'en' }, store);
  for (const junk of [null, undefined, 42, 'en', ['en']]) {
    assert.equal(saveSettings(junk, store), true, JSON.stringify(junk) ?? 'undefined');
    assert.deepEqual(loadSettings(store), { lang: 'en', ruleset: 'standard' });
  }
});

test('unknown settings values fall back to the defaults', () => {
  const store = fakeStore();
  saveSettings({ lang: 'klingon', ruleset: 'pirate-poker' }, store);
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);
});

test('settings values written by something else are sanitised on read', () => {
  // A readable envelope holding unreadable values: the shape check passed, so
  // only sanitising on the way out keeps 'klingon' from reaching <html lang>.
  const store = storeWith(STORAGE_KEYS.settings, {
    lang: 'klingon',
    ruleset: 42,
    grog: true,
  });
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS);

  const partial = storeWith(STORAGE_KEYS.settings, { ruleset: 'landratta' });
  assert.deepEqual(loadSettings(partial), { lang: 'sv', ruleset: 'landratta' });

  assert.deepEqual(loadSettings(storeWith(STORAGE_KEYS.settings, 'landratta')), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings(storeWith(STORAGE_KEYS.settings, null)), DEFAULT_SETTINGS);
});

test('corrupt settings read as the defaults', () => {
  assert.deepEqual(loadSettings(fakeStore({ [STORAGE_KEYS.settings]: '{{{' })), DEFAULT_SETTINGS);
  assert.deepEqual(
    loadSettings(
      fakeStore({
        [STORAGE_KEYS.settings]: JSON.stringify({
          schemaVersion: SCHEMA_VERSION + 99,
          payload: { lang: 'en' },
        }),
      })
    ),
    DEFAULT_SETTINGS
  );
});
