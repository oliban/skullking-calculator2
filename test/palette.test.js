import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_PLAYERS } from '../js/rules.js';
import { PLAYER_COLORS, colorForSeat } from '../js/palette.js';

test('there is a colour for every seat the game allows', () => {
  assert.ok(PLAYER_COLORS.length >= MAX_PLAYERS);
});

test('a seat always gets the same colour', () => {
  // Stability is the point: the colour is how you recognise a player at a
  // glance, so it must not shuffle between hands or between games.
  for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
    assert.deepEqual(colorForSeat(seat), colorForSeat(seat));
    assert.equal(colorForSeat(seat), PLAYER_COLORS[seat]);
  }
});

test('every seat gets a distinct colour', () => {
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => colorForSeat(i));
  assert.equal(new Set(seats.map((c) => c.base)).size, MAX_PLAYERS);
});

test('colours wrap rather than returning nothing for an unexpected seat', () => {
  // Defensive: a bad seat index must still paint something, because a chip with
  // no colour is worse than a repeated colour.
  assert.equal(colorForSeat(MAX_PLAYERS).base, PLAYER_COLORS[0].base);
  assert.ok(colorForSeat(-1));
  assert.ok(colorForSeat(undefined));
});

test('every colour defines the three roles the UI paints with', () => {
  for (const color of PLAYER_COLORS) {
    assert.match(color.base, /^#[0-9a-f]{6}$/i, `base: ${color.base}`);
    assert.match(color.bright, /^#[0-9a-f]{6}$/i, `bright: ${color.bright}`);
    assert.match(color.wash, /^rgba?\(/, `wash: ${color.wash}`);
    assert.ok(color.id, 'each colour needs a stable id for CSS hooks');
  }
});

test('colour ids are unique and CSS-safe', () => {
  const ids = PLAYER_COLORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});
