/**
 * Pirate personas — a name plus an emoji per player.
 *
 * The personas are the app's voice (spec §6), so the names stay Swedish in both
 * languages: "Rödskägg" is a name, not copy, and is never translated. This is
 * one of only two modules allowed to hold non-ASCII string literals.
 *
 * Pure: no DOM, no globals. Randomness is injected so tests are deterministic —
 * a uniqueness bug driven by real `Math.random` shows up once every few hundred
 * games and never in CI.
 */

/**
 * The pool personas are dealt from. Names and emoji are both unique within the
 * pool, which is what lets a 6-player game get six distinct pirates without any
 * repair pass. The old app carried 20; 30 keeps a 6-player crew feeling fresh
 * across an evening of games.
 *
 * @type {ReadonlyArray<{name: string, emoji: string}>}
 */
export const PERSONAS = Object.freeze([
  // Frozen deeply at the end of the literal — a shallow freeze leaves the
  // entries writable, and `PERSONAS[0].name = x` would poison every later deal.
  { name: 'Svartskägg', emoji: '☠️' },
  { name: 'Kapten Krok', emoji: '🪝' },
  { name: 'Skräck-Roberts', emoji: '🦜' },
  { name: 'Blod-Jack', emoji: '⚓' },
  { name: 'Stormöga Stina', emoji: '⚔️' },
  { name: 'Envoyé Erik', emoji: '🗺️' },
  { name: 'Järn-Jenny', emoji: '👑' },
  { name: 'Guld-Gustav', emoji: '💎' },
  { name: 'Röda Rakel', emoji: '🦑' },
  { name: 'Pesten Petter', emoji: '🦀' },
  { name: 'Havs-Hanna', emoji: '💰' },
  { name: 'Dödskalle-Danne', emoji: '🧭' },
  { name: 'Blixt-Berit', emoji: '💣' },
  { name: 'Kölhalar-Kalle', emoji: '🌴' },
  { name: 'Salta Sara', emoji: '🌊' },
  { name: 'Mördar-Mats', emoji: '⛵' },
  { name: 'Våghals-Vera', emoji: '🏴‍☠️' },
  { name: 'Tjär-Torsten', emoji: '👀' },
  { name: 'Skräckens Sigrid', emoji: '🔑' },
  { name: 'Enögda Einar', emoji: '🗡️' },
  { name: 'Krutgumman Kajsa', emoji: '🧨' },
  { name: 'Hajtand-Harald', emoji: '🦈' },
  { name: 'Sjöormen Sixten', emoji: '🐍' },
  { name: 'Bläckfisk-Bengt', emoji: '🐙' },
  { name: 'Grogg-Greta', emoji: '🍺' },
  { name: 'Papegoj-Pelle', emoji: '🪙' },
  { name: 'Skattkarta-Karin', emoji: '🏝️' },
  { name: 'Fiskmås-Frida', emoji: '🦅' },
  { name: 'Ankar-Agnes', emoji: '⛓️' },
  { name: 'Stormvind-Sten', emoji: '🌪️' },
].map(Object.freeze));

// Everything a player may pick in the emoji picker. Pirate and nautical first so
// the top of the picker matches the app's voice; the rest exists because people
// want to be a cat. Deduped at module load — the old app's hand-written list had
// 👑 and 💣 twice, which quietly made two picker cells behave as one.
const EXTRA_EMOJI = [
  // nautical / piratical
  '🚢', '🛶', '🪸', '🐚', '🦞', '🐠', '🐡', '🐳', '🐋', '🐬',
  '🦭', '🐊', '🪼', '🧜', '🧜‍♀️', '🧜‍♂️', '🏴', '🔱', '🪃', '🛟',
  '🧭', '🕳️', '🗝️', '📜', '🕯️', '🔭', '🥃', '🍾', '🪵', '🪢',
  '⛈️', '🌩️', '🌫️', '🌅', '🌙', '⭐', '🧿', '🎣', '🥂', '🪝',
  // faces and moods
  '😀', '😎', '😂', '🥳', '🤩', '🤯', '🥶', '😱', '😈', '👻',
  '👽', '🤖', '👾', '🤡', '🫡', '🤠', '🥴', '😤', '🙈', '💀',
  // hats, gear, oddments
  '🎩', '🧢', '🎓', '🎭', '🪖', '🥊', '🛡️', '⚙️', '🔨', '🪓',
  '🎲', '🃏', '🎯', '🏆', '🥇', '🔥', '💫', '💥', '❤️', '🖤',
  // beasts
  '🐵', '🐶', '🐺', '🦊', '🐱', '🦁', '🐯', '🐴', '🦄', '🦓',
  '🐮', '🐷', '🐭', '🐹', '🐰', '🐻', '🐼', '🐸', '🦇', '🐝',
];

/**
 * The picker's pool. Every persona emoji appears here, so a dealt player can
 * always re-select the emoji they started with.
 *
 * @type {ReadonlyArray<string>}
 */
export const SELECTABLE_EMOJI = Object.freeze([
  ...new Set([...PERSONAS.map((p) => p.emoji), ...EXTRA_EMOJI]),
]);

/**
 * Fisher-Yates on a copy, using the injected random source.
 *
 * The index is clamped to 0..i. `Math.random` never returns 1, but the random
 * source is a public injection point, and a source that returns 1 (or NaN, or
 * anything out of range) would otherwise index past the end and leave `undefined`
 * holes in the deck — which surfaced as a crash in `dealPersonas`, not as a bad
 * shuffle.
 */
function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const roll = random();
    const raw = Number.isFinite(roll) ? Math.floor(roll * (i + 1)) : 0;
    const j = Math.min(Math.max(raw, 0), i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal `count` personas with unique names AND unique emoji.
 *
 * `random` is a 0..1 function, injected so tests can seed it. The pool is
 * shuffled rather than sampled, which makes uniqueness structural for any crew
 * up to `PERSONAS.length` instead of something a repair pass has to fix
 * afterwards (the old app's `ensureUniqueEmojis`).
 *
 * Past the end of the pool — which no legal crew size reaches, but callers can
 * ask for — names cycle with a numeric suffix ("Svartskägg 2") and emoji are
 * drawn from `SELECTABLE_EMOJI`. Both stay unique. A count larger than the emoji
 * supply throws instead of inventing junk values like the old app's "❓3", which
 * rendered as a broken tile in the rail.
 *
 * @param {number} count how many personas to hand out; must be an integer, and a
 *   count of 0 or less deals nobody rather than throwing
 * @param {{random?: () => number}} [options]
 * @throws {TypeError} on a non-integer count
 * @throws {RangeError} on a count past the emoji supply
 * @returns {Array<{name: string, emoji: string}>} fresh objects, safe to edit
 */
export function dealPersonas(count, { random = Math.random } = {}) {
  // A fractional or non-numeric count used to slip through the loop bound and
  // hand back `Math.ceil(count)` personas, so `dealPersonas(2.5)` seated three
  // players. A crew size is always an integer; anything else is a caller bug.
  if (!Number.isInteger(count)) {
    throw new TypeError(`crew size must be an integer, got ${String(count)}`);
  }
  if (count <= 0) return [];
  if (count > SELECTABLE_EMOJI.length) {
    throw new RangeError(
      `crew of ${count} exceeds the emoji supply of ${SELECTABLE_EMOJI.length}`
    );
  }

  const deck = shuffled(PERSONAS, random);
  const spareEmoji = shuffled(SELECTABLE_EMOJI, random);
  const usedEmoji = new Set();
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const base = deck[i % deck.length];
    const cycle = Math.floor(i / deck.length);
    const name = cycle === 0 ? base.name : `${base.name} ${cycle + 1}`;

    let emoji = base.emoji;
    if (usedEmoji.has(emoji)) {
      // `usedEmoji` holds `i` emoji, all drawn from SELECTABLE_EMOJI, and the
      // guard above caps `count` at that pool's size — so a free spare always
      // exists and this cannot come back undefined.
      emoji = spareEmoji.find((candidate) => !usedEmoji.has(candidate));
    }
    usedEmoji.add(emoji);
    out.push({ name, emoji });
  }

  return out;
}

/**
 * Is `emoji` already worn by one of `players`?
 *
 * `exceptId` is the player currently editing: without it the picker greys out
 * the very emoji you are already wearing, which reads as a bug.
 *
 * @param {Array<{id: string, emoji: string}>} players
 * @param {string} emoji
 * @param {string} [exceptId]
 * @returns {boolean}
 */
export function isEmojiTaken(players, emoji, exceptId = null) {
  return players.some((p) => p.id !== exceptId && p.emoji === emoji);
}

/**
 * Rename and/or re-emoji one player. Returns a NEW players array.
 *
 * Throws on a blank name, a blank emoji or a clashing emoji rather than silently
 * keeping the old value: an edit that appears to do nothing sends the user
 * tapping again, and the caller needs a reason to show. Names and emoji are both
 * trimmed; duplicate *names* are allowed (two people may both want to be
 * Svartskägg), duplicate emoji are not, because the rail identifies players by
 * emoji alone.
 *
 * An omitted field is left alone; a present-but-invalid one throws.
 *
 * @param {Array<{id: string, name: string, emoji: string}>} players
 * @param {string} id
 * @param {{name?: string, emoji?: string}} patch
 * @returns {Array<{id: string, name: string, emoji: string}>}
 */
export function renamePlayer(players, id, { name, emoji } = {}) {
  const target = players.find((p) => p.id === id);
  if (!target) throw new Error(`no player with id ${id}`);

  let nextName = target.name;
  if (name !== undefined) {
    // Coercing used to turn a null name into the literal string "null" and a
    // number into its digits, both of which then rendered as a real pirate name.
    if (typeof name !== 'string') throw new TypeError('name must be a string');
    nextName = name.trim();
    if (nextName.length === 0) throw new Error('name must not be blank');
  }

  let nextEmoji = target.emoji;
  if (emoji !== undefined) {
    // A blank emoji used to be accepted, which left an empty rail chip — and the
    // rail identifies players by emoji alone, so that player becomes anonymous.
    if (typeof emoji !== 'string') throw new TypeError('emoji must be a string');
    const trimmed = emoji.trim();
    if (trimmed.length === 0) throw new Error('emoji must not be blank');
    if (isEmojiTaken(players, trimmed, id)) {
      throw new Error('emoji already taken by another player');
    }
    nextEmoji = trimmed;
  }

  return players.map((p) =>
    p.id === id ? { ...p, name: nextName, emoji: nextEmoji } : { ...p }
  );
}
