import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PERSONAS,
  SELECTABLE_EMOJI,
  dealPersonas,
  isEmojiTaken,
  renamePlayer,
} from '../js/personas.js';

/**
 * A deterministic stand-in for Math.random: walks a fixed list of 0..1 values
 * and wraps. Nothing here may depend on real randomness, or a uniqueness bug
 * shows up once every few hundred games and never in CI.
 */
function seeded(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/**
 * A tiny LCG, so the uniqueness sweep below explores many different shuffles
 * while still failing identically on every machine and every run. Using
 * `Math.random` for that sweep meant a green run proved nothing about the next
 * one.
 */
function lcg(seed) {
  let s = (seed * 2654435761) % 4294967296;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const names = (list) => list.map((p) => p.name);
const emoji = (list) => list.map((p) => p.emoji);
const allUnique = (values) => new Set(values).size === values.length;

test('the persona pool is big enough for a 6-player game to feel varied', () => {
  assert.ok(PERSONAS.length >= 24, `pool has only ${PERSONAS.length}`);
});

test('the persona pool itself has unique names and unique emoji', () => {
  assert.ok(allUnique(names(PERSONAS)), 'duplicate persona name');
  assert.ok(allUnique(emoji(PERSONAS)), 'duplicate persona emoji');
});

test('every persona has a non-empty name and a single-value emoji', () => {
  for (const p of PERSONAS) {
    assert.equal(typeof p.name, 'string');
    assert.ok(p.name.trim().length > 0);
    assert.equal(typeof p.emoji, 'string');
    assert.ok(p.emoji.length > 0);
  }
});

test('the selectable emoji pool is larger than the persona pool and deduped', () => {
  assert.ok(SELECTABLE_EMOJI.length > PERSONAS.length);
  assert.ok(allUnique(SELECTABLE_EMOJI), 'duplicate selectable emoji');
});

test('every persona emoji can also be picked in the picker', () => {
  // Otherwise a dealt player cannot re-choose their own starting emoji.
  for (const p of PERSONAS) {
    assert.ok(SELECTABLE_EMOJI.includes(p.emoji), `missing from picker: ${p.emoji}`);
  }
});

test('dealPersonas hands out the number asked for', () => {
  for (let count = 2; count <= 6; count += 1) {
    assert.equal(dealPersonas(count).length, count);
  }
});

test('dealt personas have unique names and unique emoji at 2..6 players', () => {
  for (let count = 2; count <= 6; count += 1) {
    // Many seeds, because a collision bug is probabilistic by nature - but fixed
    // seeds, so a failure reproduces instead of haunting one run in a hundred.
    for (let seed = 1; seed <= 200; seed += 1) {
      const dealt = dealPersonas(count, { random: lcg(seed) });
      assert.ok(allUnique(names(dealt)), `duplicate name at ${count}p seed ${seed}`);
      assert.ok(allUnique(emoji(dealt)), `duplicate emoji at ${count}p seed ${seed}`);
      assert.ok(
        dealt.every((p) => p.name.length > 0 && p.emoji.length > 0),
        `blank persona at ${count}p seed ${seed}`
      );
    }
  }
});

test('a crew of 2..6 is dealt straight from the pool, never from the spare emoji', () => {
  // The spare-emoji repair path only exists past pool exhaustion. If a legal crew
  // size reaches it, the shuffle has stopped being a shuffle.
  const poolEmoji = new Set(emoji(PERSONAS));
  for (let count = 2; count <= 6; count += 1) {
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const p of dealPersonas(count, { random: lcg(seed) })) {
        assert.ok(poolEmoji.has(p.emoji), `off-pool emoji at ${count}p: ${p.emoji}`);
      }
    }
  }
});

test('dealPersonas is deterministic for a given random source', () => {
  const values = [0.11, 0.73, 0.42, 0.05, 0.9, 0.37, 0.64];
  const a = dealPersonas(4, { random: seeded(values) });
  const b = dealPersonas(4, { random: seeded(values) });
  assert.deepEqual(a, b);
});

test('dealPersonas actually shuffles rather than returning the pool head', () => {
  const front = dealPersonas(4, { random: () => 0 });
  const back = dealPersonas(4, { random: () => 0.999999 });
  assert.notDeepEqual(front, back);
});

test('dealPersonas does not mutate PERSONAS', () => {
  const snapshot = JSON.stringify(PERSONAS);
  dealPersonas(6, { random: seeded([0.9, 0.1, 0.5]) });
  assert.equal(JSON.stringify(PERSONAS), snapshot);
});

test('dealt personas are copies, so editing one leaves the pool alone', () => {
  const dealt = dealPersonas(1, { random: () => 0 });
  dealt[0].name = 'MUTATED';
  assert.ok(!names(PERSONAS).includes('MUTATED'));
});

test('dealPersonas stays unique past the end of the pool', () => {
  const count = PERSONAS.length + 7;
  const dealt = dealPersonas(count, { random: seeded([0.3, 0.8, 0.05]) });
  assert.equal(dealt.length, count);
  assert.ok(allUnique(names(dealt)), 'duplicate name past pool exhaustion');
  assert.ok(allUnique(emoji(dealt)), 'duplicate emoji past pool exhaustion');
});

test('dealPersonas suffixes recycled names with the cycle number', () => {
  // Built from the pool rather than written out, because this file must stay
  // ASCII (spec 6) and every persona name is Swedish.
  const dealt = dealPersonas(PERSONAS.length + 1, { random: () => 0.5 });
  const recycled = dealt[PERSONAS.length];
  const base = names(dealt).slice(0, PERSONAS.length);
  assert.ok(base.includes(recycled.name.replace(/ 2$/, '')), 'not a pool name');
  assert.match(recycled.name, / 2$/);
});

test('dealPersonas refuses a crew larger than the emoji supply', () => {
  assert.throws(() => dealPersonas(SELECTABLE_EMOJI.length + 1), /emoji/i);
});

test('dealPersonas fills the entire emoji supply without running dry', () => {
  // The exact boundary: one more throws, so this is the largest legal crew and
  // the last spare emoji has to be found. An off-by-one in the guard or in the
  // spare lookup leaves the final player with an undefined emoji.
  const dealt = dealPersonas(SELECTABLE_EMOJI.length, { random: lcg(9) });
  assert.equal(dealt.length, SELECTABLE_EMOJI.length);
  assert.ok(allUnique(emoji(dealt)), 'duplicate emoji at full supply');
  assert.ok(allUnique(names(dealt)), 'duplicate name at full supply');
  for (const p of dealt) assert.equal(typeof p.emoji, 'string');
  assert.ok(
    dealt.every((p) => p.emoji.length > 0),
    'a player was dealt a blank emoji'
  );
});

test('dealPersonas returns nothing for a non-positive count', () => {
  assert.deepEqual(dealPersonas(0), []);
  assert.deepEqual(dealPersonas(-3), []);
});

test('dealPersonas refuses a non-integer count instead of rounding it up', () => {
  // 2.5 used to seat three players, because only the loop bound saw the value.
  assert.throws(() => dealPersonas(2.5), TypeError);
  assert.throws(() => dealPersonas('4'), TypeError);
  assert.throws(() => dealPersonas(NaN), TypeError);
  assert.throws(() => dealPersonas(Infinity), TypeError);
  assert.throws(() => dealPersonas(undefined), TypeError);
});

test('a random source that returns 1 still deals a valid crew', () => {
  // Math.random never returns 1, but the source is injected, and an unclamped
  // Fisher-Yates index put undefined holes in the deck rather than shuffling badly.
  for (const random of [() => 1, () => 1.5, () => -0.2, () => NaN]) {
    const dealt = dealPersonas(6, { random });
    assert.equal(dealt.length, 6);
    assert.ok(allUnique(emoji(dealt)));
    assert.ok(
      dealt.every((p) => typeof p.name === 'string' && p.name.length > 0),
      'undefined persona from an out-of-range random source'
    );
  }
});

test('the pool entries are frozen, not just the array', () => {
  // A shallow freeze leaves the entries writable, so one stray assignment would
  // rename that pirate for every later game in the session.
  assert.throws(() => {
    PERSONAS[0].name = 'Hijacked';
  }, TypeError);
  assert.ok(!names(PERSONAS).includes('Hijacked'));
});

// --- The picker ------------------------------------------------------------

const crew = () => [
  { id: 'p1', name: 'Ann', emoji: 'A', seat: 0 },
  { id: 'p2', name: 'Bo', emoji: 'B', seat: 1 },
  { id: 'p3', name: 'Cid', emoji: 'C', seat: 2 },
];

test('an emoji held by someone is taken', () => {
  assert.equal(isEmojiTaken(crew(), 'B'), true);
});

test('an emoji nobody holds is free', () => {
  assert.equal(isEmojiTaken(crew(), 'Z'), false);
});

test('a player does not block their own emoji', () => {
  // Without exceptId the picker greys out the very emoji you already wear.
  assert.equal(isEmojiTaken(crew(), 'B', 'p2'), false);
  assert.equal(isEmojiTaken(crew(), 'A', 'p2'), true);
});

test('an unknown exceptId blocks nothing extra', () => {
  assert.equal(isEmojiTaken(crew(), 'A', 'nobody'), true);
});

test('nothing is taken in an empty crew', () => {
  assert.equal(isEmojiTaken([], 'A'), false);
  assert.equal(isEmojiTaken([], 'A', 'p1'), false);
});

// --- Renaming --------------------------------------------------------------

test('renamePlayer returns a new array and leaves the original alone', () => {
  const before = crew();
  const snapshot = JSON.stringify(before);
  const after = renamePlayer(before, 'p2', { name: 'Bosse' });
  assert.notEqual(after, before);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(after[1].name, 'Bosse');
});

test('renamePlayer can change the emoji alone', () => {
  const after = renamePlayer(crew(), 'p1', { emoji: 'Z' });
  assert.equal(after[0].emoji, 'Z');
  assert.equal(after[0].name, 'Ann');
});

test('renamePlayer trims the name', () => {
  const after = renamePlayer(crew(), 'p1', { name: '  Anna  ' });
  assert.equal(after[0].name, 'Anna');
});

test('renamePlayer keeps an unchanged emoji, which the player already holds', () => {
  const after = renamePlayer(crew(), 'p3', { name: 'Cidde', emoji: 'C' });
  assert.equal(after[2].emoji, 'C');
});

test('renamePlayer rejects an emoji another player holds', () => {
  assert.throws(() => renamePlayer(crew(), 'p1', { emoji: 'B' }), /emoji/i);
});

test('renamePlayer rejects a blank or whitespace-only name', () => {
  assert.throws(() => renamePlayer(crew(), 'p1', { name: '' }), /name/i);
  assert.throws(() => renamePlayer(crew(), 'p1', { name: '   ' }), /name/i);
});

test('renamePlayer rejects a non-string name rather than coercing it', () => {
  // Coercion turned null into the literal name "null" and 7 into "7", both of
  // which then sat on the rail looking deliberate.
  for (const name of [null, 7, {}, []]) {
    assert.throws(() => renamePlayer(crew(), 'p1', { name }), /name/i);
  }
  assert.equal(renamePlayer(crew(), 'p1', { name: 'Ann' })[0].name, 'Ann');
});

test('renamePlayer rejects a blank emoji, which would erase a rail chip', () => {
  // The rail identifies players by emoji alone, so an empty one is anonymity.
  for (const emojiValue of ['', '   ', null, 7]) {
    assert.throws(() => renamePlayer(crew(), 'p1', { emoji: emojiValue }), /emoji/i);
  }
});

test('renamePlayer trims the emoji and honours the trimmed clash', () => {
  assert.equal(renamePlayer(crew(), 'p1', { emoji: ' Z ' })[0].emoji, 'Z');
  assert.throws(() => renamePlayer(crew(), 'p1', { emoji: ' B ' }), /taken/i);
});

test('renamePlayer with no patch copies the crew unchanged', () => {
  const before = crew();
  const after = renamePlayer(before, 'p2');
  assert.notEqual(after, before);
  assert.notEqual(after[1], before[1]);
  assert.deepEqual(after, before);
});

test('renamePlayer rejects an unknown player id', () => {
  assert.throws(() => renamePlayer(crew(), 'p9', { name: 'Ghost' }), /p9/);
});

test('renamePlayer leaves every other player untouched', () => {
  const after = renamePlayer(crew(), 'p2', { name: 'Bosse', emoji: 'Z' });
  assert.deepEqual(after[0], crew()[0]);
  assert.deepEqual(after[2], crew()[2]);
});
