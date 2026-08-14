import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_KEY_H,
  MAX_ACTION_H,
  MIN_KEY_H,
  keyHeight,
  padColumns,
} from '../js/ui/pad.js';

// --- Columns ---------------------------------------------------------------

test('the pad never exceeds three rows', () => {
  // Hand 8 is this game's widest case: 9 value keys.
  for (let keys = 2; keys <= 11; keys += 1) {
    const cols = padColumns(keys);
    assert.ok(
      Math.ceil(keys / cols) <= 3,
      `${keys} keys in ${cols} columns needs ${Math.ceil(keys / cols)} rows`
    );
  }
});

test('the pad prefers wide keys, using the fewest columns that fit', () => {
  assert.equal(padColumns(2), 3);
  assert.equal(padColumns(3), 3);
  assert.equal(padColumns(9), 3);
  // 10+ keys need a fourth column to stay within three rows.
  assert.equal(padColumns(10), 4);
});

// --- Key height ------------------------------------------------------------

test('keys fill the space they are given, below the cap', () => {
  assert.equal(keyHeight(120, 1), 120);
  // Two rows share the box minus one gap: (250 - 10) / 2.
  assert.equal(keyHeight(250, 2, 10), 120);
  // Three rows, two gaps: (346 - 20) / 3 = 108.67 -> 108.
  assert.equal(keyHeight(346, 3, 10), 108);
});

test('keys are capped so they stay in the thumb zone', () => {
  // Without a cap, a tall phone and a two-key hand produce 600px slabs: the
  // pad would fill the whole stage instead of sitting under the thumb, which is
  // the entire point of welding it to the bottom.
  assert.equal(keyHeight(900, 1), MAX_KEY_H);
  assert.ok(MAX_KEY_H <= 150, 'a key taller than 150px is a slab, not a key');
});

test('keys have a floor so a short phone stays tappable', () => {
  // Apple's minimum comfortable target is 44px; below that, thumbs miss.
  assert.equal(keyHeight(60, 3), MIN_KEY_H);
  assert.ok(MIN_KEY_H >= 44);
});

test('action keys are capped lower than number keys', () => {
  // "Book the hand" and "Undo" are read, not aimed at repeatedly, so they do
  // not need the same target size and should not dominate the screen.
  assert.equal(keyHeight(900, 1, 10, MAX_ACTION_H), MAX_ACTION_H);
  assert.ok(MAX_ACTION_H < MAX_KEY_H);
});

test('the cap is not applied when the space is genuinely smaller', () => {
  assert.equal(keyHeight(100, 1), 100);
});
