/**
 * One colour per seat.
 *
 * The colour is how you recognise whose turn it is without reading a name: the
 * active player's colour washes the whole play surface, so the screen itself
 * tells you who is being asked. That only works if the mapping is STABLE —
 * seat 0 is always the same colour, in every hand and every game.
 *
 * All six are picked to sit inside the lantern-lit palette (nothing neon, nothing
 * that fights the brass) while staying distinguishable from each other on the
 * dark deck — including for the common red/green confusions, which is why the
 * set leans on brightness and hue family rather than red-vs-green alone.
 */

/**
 * `base`   — the chip border and accents
 * `bright` — text and the active glow
 * `wash`   — the low-alpha tint painted across the play surface
 */
export const PLAYER_COLORS = Object.freeze(
  [
    // Brass sits LAST on purpose: it is the app's own chrome colour, so a brass
    // player reads as a player with no colour at all and their surface wash is
    // invisible. The first four — the common crew size — are unmistakable.
    { id: 'teal', base: '#4f9a94', bright: '#8fd3cd', wash: 'rgba(79, 154, 148, 0.17)' },
    { id: 'rose', base: '#c4626b', bright: '#eb9aa1', wash: 'rgba(196, 98, 107, 0.17)' },
    { id: 'leaf', base: '#7fa653', bright: '#b8dc8a', wash: 'rgba(127, 166, 83, 0.17)' },
    { id: 'sky', base: '#6f97c9', bright: '#a8c7ef', wash: 'rgba(111, 151, 201, 0.17)' },
    { id: 'plum', base: '#9a72b8', bright: '#c9a8e2', wash: 'rgba(154, 114, 184, 0.18)' },
    { id: 'brass', base: '#d9a13c', bright: '#f2c877', wash: 'rgba(217, 161, 60, 0.16)' },
  ].map(Object.freeze)
);

/**
 * The colour for a seat.
 *
 * Wraps rather than failing on an unexpected index: a chip painted with a
 * repeated colour is a cosmetic problem, a chip painted with `undefined` is a
 * broken screen.
 */
export function colorForSeat(seat) {
  const index = Number.isInteger(seat) ? seat : 0;
  const wrapped = ((index % PLAYER_COLORS.length) + PLAYER_COLORS.length) %
    PLAYER_COLORS.length;
  return PLAYER_COLORS[wrapped];
}
