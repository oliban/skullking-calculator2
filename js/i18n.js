/**
 * Swedish and English copy. Swedish is the default — the group is Swedish and
 * the pirate personas are the app's voice.
 *
 * This file and personas.js are the ONLY places user-visible strings may live;
 * test/i18n-hygiene.test.js enforces that. Pure: no DOM, no imports.
 *
 * Keys are dotted paths into a nested table. Nesting is for reading comfort
 * only — `t()` flattens it, and the parity test walks it, so adding a key to
 * one language and forgetting the other fails the suite instead of shipping a
 * raw key to the pub table.
 */

/** Supported languages, in menu order. Frozen: it is shared with every caller. */
export const LANGS = Object.freeze(['sv', 'en']);

/** Swedish, per spec §6. */
export const DEFAULT_LANG = 'sv';

/**
 * Wrapper around a key we could not find. Loud on purpose: an empty string
 * looks like a styling bug, whereas ⟦play.bid⟧ on screen names the fix.
 */
const MISSING_OPEN = '⟦';
const MISSING_CLOSE = '⟧';

/**
 * Keys asked for and not found, as "lang:key". Diagnostic, not state.
 *
 * Capped: the app runs for a whole evening without a reload, and a key built
 * from data (a persona name, a hand number) inside a render loop would otherwise
 * grow this set forever. Past the cap we stop recording; `t` still renders the
 * loud placeholder, which is the part the pub table sees.
 */
const MAX_MISSING = 200;
const missing = new Set();

const table = {
  sv: {
    screen: {
      cabin: 'Kajutan',
      helm: 'Rodret',
      reckoning: 'Uppgörelsen',
      hall: 'Ärans planka',
      settings: 'Inställningar',
    },

    cabin: {
      crewSize: 'Hur många är vi?',
      crewSizeUnit: '{count} pirater',
      startVoyage: 'Kasta loss',
      resume: 'Fortsätt förra seglatsen',
      newGame: 'Ny seglats',
      shuffleCrew: 'Byt pirater',
    },

    play: {
      bid: 'Bud',
      tricks: 'Stick',
      round: 'Omgång {n} av {m}',
      // The pad has no name label — the glowing rail chip says whose turn it is.
      bidPrompt: 'Hur många stick tar du?',
      trickPrompt: 'Hur många stick tog du?',
      // The bid is shown back during the trick phase: eight hands in, nobody
      // remembers what they announced, and the answer decides the score.
      said: 'bjöd {bid}',
      saidNil: 'bjöd noll',
      phaseBid: 'Buden',
      phaseTricks: 'Sticken',
      book: 'Bokför omgången',
      booked: 'Bokförd',
      undo: 'Ångra',
      // Spec §4.2: silent auto-fill causes exactly one argument per game.
      lastEntry: 'senast: {emoji} {name} {value} (tryck = ångra)',
      tally: 'Kontrollera omgången',
      dice: '{count} tärningar',
    },

    // Keyed by the cursor phase values in state.js ('bid' | 'trick' | 'tally')
    // so `t(lang, 'phase.' + game.cursor.phase)` always resolves. The phase is
    // 'trick' (singular) while the column heading is `play.tricks`; without this
    // table the rail label for the trick phase renders as a raw key.
    phase: {
      bid: 'Bud',
      trick: 'Stick',
      tally: 'Kontroll',
    },

    // Language names, deliberately NOT translated: a picker shows each language
    // in its own tongue. Same pair in both tables so the parity test holds.
    lang: {
      sv: 'Svenska',
      en: 'English',
    },

    bonus: {
      title: 'Bonusar',
      mermaid: 'Sjöjungfrun tar Skull King (+50)',
      pirate: 'Skull King tar en pirat (+30 styck)',
      pirateCount: 'Pirater: {count}',
      none: 'Inga bonusar',
      ineligible: 'Bonus kräver exakt bud och minst ett stick.',
      ineligibleNil: 'Ett lyckat nollbud ger ingen bonus — du vann inget stick.',
      ineligibleRuleset: 'Landrattenwertung har inga bonusar.',
    },

    warning: {
      // These are read out loud mid-argument, so they explain WHY, not just what.
      'mermaid-and-pirates':
        'Samma pirat har både tagit Skull King med sjöjungfrun och låtit Skull King ta pirater. Det går inte i samma omgång: slog sjöjungfrun Skull King så vann Skull King inte det sticket. Bokförs ändå om ni är säkra.',
      'mermaid-claimed-twice':
        'Sjöjungfru-bonusen är hävdad av {claimed} pirater. Det finns bara en Skull King-tärning, så bara en enda kan ha tagit den under hela omgången. Någon minns fel.',
      'too-many-pirates':
        'Ni har bokfört {claimed} tillfångatagna pirater. Det finns bara tre pirattärningar i påsen, så fler än tre kan inte fångas i en omgång. Bonusen räknas ändå bara för tre.',
    },

    validate: {
      shortfall: 'Det fattas {missing} stick. Alla stick vinns av någon.',
      surplus: '{extra} stick för många. Räkna om — antalet stick är låst.',
      incomplete: 'Alla har inte lagt bud och stick än.',
      ok: 'Omgången stämmer.',
    },

    ruleset: {
      standard: 'Standardpoäng',
      'standard.about':
        'Rulebokens vanliga poäng: rätt bud ger 20 per stick, fel bud kostar 10 per stick fel.',
      landratta: 'Landrattenwertung',
      'landratta.about':
        'Rulebokens förenklade variant: fel bud kostar ingenting och inga bonusar delas ut. Nollbud fungerar som vanligt.',
    },

    medal: {
      gold: 'Guld',
      silver: 'Silver',
      bronze: 'Brons',
      shame: 'Skamvrån',
      lead: 'Leder',
      tied: 'Delad plats',
    },

    reckoning: {
      title: 'Uppgörelsen',
      winner: '{emoji} {name} tar hela bytet!',
      winnerTie: 'Delad seger: {names}',
      points: '{points} poäng',
      bestHand: 'Bästa omgång: {points}',
      playAgain: 'En seglats till',
      toHall: 'Till Ärans planka',
    },

    hall: {
      title: 'Ärans planka',
      empty: 'Ingen har seglat in här än.',
      games: 'Seglatser',
      wins: 'Segrar',
      best: 'Bästa',
      worst: 'Sämsta',
      lastPlayed: 'Senast: {date}',
      mergedNames: 'Samma namn räknas som samma pirat, hur många kvällar det än tar.',
    },

    settings: {
      title: 'Inställningar',
      language: 'Språk',
      ruleset: 'Poängvariant',
      reset: 'Rensa allt',
      resetConfirm: 'Rensa spel och Ärans planka? Det går inte att ångra.',
    },

    note: {
      twoPlayer: '2 pirater är en husregel — står inte i regelboken. Vi kör 8 omgångar.',
      officialRange: 'Regelboken är gjord för 3–6 pirater.',
      handCount: '{players} pirater seglar {hands} omgångar.',
    },

    common: {
      cancel: 'Avbryt',
      ok: 'Klart',
      back: 'Tillbaka',
      yes: 'Ja',
      no: 'Nej',
    },
  },

  en: {
    screen: {
      cabin: 'The Cabin',
      helm: 'The Helm',
      reckoning: 'The Reckoning',
      hall: 'Hall of Fame',
      settings: 'Settings',
    },

    cabin: {
      crewSize: 'How many of us?',
      crewSizeUnit: '{count} pirates',
      startVoyage: 'Cast off',
      resume: 'Resume the last voyage',
      newGame: 'New voyage',
      shuffleCrew: 'Reshuffle the crew',
    },

    play: {
      bid: 'Bid',
      tricks: 'Tricks',
      round: 'Round {n} of {m}',
      bidPrompt: 'How many tricks will you take?',
      trickPrompt: 'How many tricks did you take?',
      said: 'bid {bid}',
      saidNil: 'bid nil',
      phaseBid: 'The bids',
      phaseTricks: 'The tricks',
      book: 'Book the round',
      booked: 'Booked',
      undo: 'Undo',
      lastEntry: 'last: {emoji} {name} {value} (tap = undo)',
      tally: 'Check the round',
      dice: '{count} dice',
    },

    phase: {
      bid: 'Bid',
      trick: 'Trick',
      tally: 'Check',
    },

    lang: {
      sv: 'Svenska',
      en: 'English',
    },

    bonus: {
      title: 'Bonuses',
      mermaid: 'Mermaid takes the Skull King (+50)',
      pirate: 'Skull King takes a pirate (+30 each)',
      pirateCount: 'Pirates: {count}',
      none: 'No bonuses',
      ineligible: 'A bonus needs an exact bid and at least one trick.',
      ineligibleNil: 'A made nil earns no bonus — you won no trick to capture in.',
      ineligibleRuleset: 'Landrattenwertung awards no bonuses.',
    },

    warning: {
      'mermaid-and-pirates':
        'The same pirate both took the Skull King with a mermaid and let the Skull King capture pirates. That cannot happen in one round: if the mermaid beat the Skull King, the Skull King did not win that trick. Book it anyway if you are sure.',
      'mermaid-claimed-twice':
        'The mermaid bonus is claimed by {claimed} pirates. There is only one Skull King die, so only one of them can have captured it in the whole round. Somebody remembers wrong.',
      'too-many-pirates':
        'You have booked {claimed} captured pirates. Only three pirate dice exist in the bag, so no more than three can be caught in a round. The bonus still counts three at most.',
    },

    validate: {
      shortfall: '{missing} tricks are missing. Every trick is won by somebody.',
      surplus: '{extra} tricks too many. Count again — the trick total is fixed.',
      incomplete: 'Not everyone has entered a bid and a trick count yet.',
      ok: 'The round adds up.',
    },

    ruleset: {
      standard: 'Standard scoring',
      'standard.about':
        "The rulebook's ordinary scoring: an exact bid pays 20 per trick, a wrong bid costs 10 per trick off.",
      landratta: 'Landrattenwertung',
      'landratta.about':
        "The rulebook's simplified variant: a wrong bid costs nothing and no bonuses are awarded. Nil bids work as usual.",
    },

    medal: {
      gold: 'Gold',
      silver: 'Silver',
      bronze: 'Bronze',
      shame: 'The corner of shame',
      lead: 'Leading',
      tied: 'Tied',
    },

    reckoning: {
      title: 'The Reckoning',
      winner: '{emoji} {name} takes the whole haul!',
      winnerTie: 'Shared victory: {names}',
      points: '{points} points',
      bestHand: 'Best round: {points}',
      playAgain: 'One more voyage',
      toHall: 'To the Hall of Fame',
    },

    hall: {
      title: 'Hall of Fame',
      empty: 'Nobody has sailed in here yet.',
      games: 'Voyages',
      wins: 'Wins',
      best: 'Best',
      worst: 'Worst',
      lastPlayed: 'Last played: {date}',
      mergedNames: 'The same name counts as the same pirate, however many nights it takes.',
    },

    settings: {
      title: 'Settings',
      language: 'Language',
      ruleset: 'Scoring variant',
      reset: 'Clear everything',
      resetConfirm: 'Clear the game and the Hall of Fame? This cannot be undone.',
    },

    note: {
      twoPlayer: '2 pirates is a house rule — not in the rulebook. We play 8 rounds.',
      officialRange: 'The rulebook is written for 3-6 pirates.',
      handCount: '{players} pirates sail {hands} rounds.',
    },

    common: {
      cancel: 'Cancel',
      ok: 'Done',
      back: 'Back',
      yes: 'Yes',
      no: 'No',
    },
  },
};

/** Freeze a nested plain-object/array tree in place. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * The message tables. Frozen, because every module reads from this one object:
 * a caller that "just tweaks" a label, or a test that patches one and forgets to
 * restore it, would change the copy for the rest of the session.
 */
export const dict = deepFreeze(table);

/**
 * Playful taunts for the shaming state (spec §4.6). Warm ribbing in the spirit
 * of the old app's "Usel är du!" — never cruel, and the two pools are kept the
 * same length so the UI can rotate by index in either language.
 *
 * Frozen: the shame state rotates by index and must stay deterministic, so
 * nobody gets to shuffle the pool in place.
 */
export const TAUNTS = deepFreeze({
  sv: [
    'Usel är du!',
    'Sjöjungfrurna skrattar åt dig.',
    'Din skattkista är full av sand.',
    'Papegojan har slutat hälsa.',
    'Du bjuder som en landkrabba.',
    'Kaptenen har lagt undan din ranson.',
    'Ännu en omgång i länsvattnet.',
    'Till och med Skull King tycker synd om dig.',
    'Håll i röret, någon måste ju göra det.',
    'Du seglar bakåt, men med stil.',
  ],
  en: [
    'Wretched, you are!',
    'The mermaids are laughing at you.',
    'Your treasure chest is full of sand.',
    'The parrot has stopped saying hello.',
    'You bid like a landlubber.',
    'The captain has set your ration aside.',
    'Another round down in the bilge water.',
    'Even the Skull King feels sorry for you.',
    'Hold the helm, somebody has to.',
    'You are sailing backwards, but with style.',
  ],
});

/** A language we have a table for, falling back to Swedish. */
function resolveLang(lang) {
  return Object.prototype.hasOwnProperty.call(dict, lang) ? lang : DEFAULT_LANG;
}

/**
 * Fill `{name}` placeholders. Unknown placeholders are LEFT IN PLACE rather
 * than replaced with "undefined" — a visible `{name}` is a bug report, while
 * "undefined" mid-sentence just looks broken.
 *
 * Only OWN properties count. Reading through the prototype chain meant
 * `{constructor}` rendered "function Object() { [native code] }" into a sentence
 * a player was about to read out loud. A null `params` is treated as no params
 * rather than throwing, because callers pass whatever they have.
 */
export function interpolate(template, params) {
  const source = params === null || typeof params !== 'object' ? {} : params;
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return whole;
    const value = source[key];
    // 0 and false are legitimate values; only absence keeps the placeholder.
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Walk a dotted path into the nested table. Returns undefined if absent. */
function lookup(table, key) {
  // Warning codes contain dashes and ruleset "about" keys contain a dot, so try
  // the whole remainder as a literal key at every level before descending.
  let node = table;
  const parts = key.split('.');
  for (let i = 0; i < parts.length; i += 1) {
    if (node === null || typeof node !== 'object') return undefined;
    const rest = parts.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(node, rest)) return node[rest];
    node = node[parts[i]];
  }
  // Reaching here means the final segment was not an own key: not found.
  return undefined;
}

/**
 * Look up `key` in `lang` and interpolate `params`.
 *
 * An unknown key returns the key wrapped in ⟦⟧ — visible on screen, matched by
 * `isMissing`, and recorded in `missingKeys()` — because silently rendering an
 * empty string is how the prototypes shipped blank buttons.
 */
export function t(lang, key, params) {
  const resolved = resolveLang(lang);
  const message = lookup(dict[resolved], key);
  if (typeof message !== 'string') {
    if (missing.size < MAX_MISSING) missing.add(`${resolved}:${key}`);
    return MISSING_OPEN + key + MISSING_CLOSE;
  }
  return interpolate(message, params);
}

/** Was this rendered string a missing-key placeholder? */
export function isMissing(rendered) {
  return (
    typeof rendered === 'string' &&
    rendered.startsWith(MISSING_OPEN) &&
    rendered.endsWith(MISSING_CLOSE)
  );
}

/** Every "lang:key" asked for and not found so far. For dev surfacing. */
export function missingKeys() {
  return [...missing];
}

/**
 * The taunt at `index`, wrapping in both directions so callers can just keep
 * incrementing a counter (or hand us a hand number) without bookkeeping.
 *
 * Always returns a string. A non-finite index (NaN from an arithmetic slip on a
 * missing total, Infinity) used to index past the pool and return `undefined`,
 * which the shame state would have painted as a blank line; it now reads as 0.
 */
export function taunt(lang, index = 0) {
  // resolveLang is keyed on `dict`; the test suite asserts that `dict` and
  // `TAUNTS` cover exactly the same languages, so this always finds a pool.
  const pool = TAUNTS[resolveLang(lang)];
  const n = pool.length;
  const wanted = Math.trunc(Number(index));
  const i = Number.isFinite(wanted) ? wanted : 0;
  return pool[((i % n) + n) % n];
}
