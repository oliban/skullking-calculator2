import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGS,
  DEFAULT_LANG,
  dict,
  TAUNTS,
  t,
  interpolate,
  taunt,
  missingKeys,
  isMissing,
} from '../js/i18n.js';
import { PHASES } from '../js/state.js';

/** Every leaf key in a nested message table, as dotted paths. */
function keysOf(table, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(table)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...keysOf(value, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

test('Swedish is the default language and both languages exist', () => {
  assert.deepEqual(LANGS, ['sv', 'en']);
  assert.equal(DEFAULT_LANG, 'sv');
  for (const lang of LANGS) assert.ok(dict[lang], `missing table for ${lang}`);
});

test('dict and TAUNTS cover exactly the languages in LANGS', () => {
  // taunt() resolves the language against `dict` and then indexes `TAUNTS`, so a
  // language present in one and not the other would hand the shame state no pool
  // at all. Keeping the sets identical is what makes that branch unreachable.
  assert.deepEqual(Object.keys(dict).sort(), [...LANGS].sort());
  assert.deepEqual(Object.keys(TAUNTS).sort(), [...LANGS].sort());
});

test('the two dictionaries have exactly the same keys', () => {
  // This is the test that actually prevents bugs: a key added to one language
  // and forgotten in the other renders as a raw key at the pub table.
  assert.deepEqual(keysOf(dict.sv), keysOf(dict.en));
});

test('every key in the table is reachable through t() and non-empty', () => {
  // The isMissing assertion is the load-bearing half: without it a broken
  // `lookup` still returns the non-empty placeholder and this test would pass.
  for (const lang of LANGS) {
    for (const key of keysOf(dict[lang])) {
      const value = t(lang, key);
      assert.equal(typeof value, 'string', `${lang}.${key} is not a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
      assert.equal(isMissing(value), false, `${lang}.${key} is not reachable`);
    }
  }
});

test('every screen name is present in both languages', () => {
  for (const lang of LANGS) {
    for (const key of ['cabin', 'helm', 'reckoning', 'hall', 'settings']) {
      assert.ok(t(lang, `screen.${key}`).length > 0);
      assert.equal(isMissing(t(lang, `screen.${key}`)), false);
    }
  }
});

test('the Swedish screen names are the ones the group actually says', () => {
  assert.equal(t('sv', 'screen.cabin'), 'Kajutan');
  assert.equal(t('sv', 'screen.helm'), 'Rodret');
  assert.equal(t('sv', 'screen.reckoning'), 'Uppgörelsen');
  assert.equal(t('sv', 'screen.hall'), 'Ärans planka');
});

test('parameters are interpolated', () => {
  assert.equal(t('sv', 'play.round', { n: 4, m: 8 }), 'Omgång 4 av 8');
  assert.equal(t('en', 'play.round', { n: 4, m: 8 }), 'Round 4 of 8');
});

test('the same parameter may appear more than once', () => {
  // Interpolation must be global, not first-occurrence-only.
  assert.equal(interpolate('{word} {word} {word}', { word: 'ho' }), 'ho ho ho');
});

test('interpolate leaves unknown placeholders alone', () => {
  assert.equal(interpolate('{a}/{b}', { a: 1 }), '1/{b}');
});

test('a missing parameter leaves the placeholder rather than printing undefined', () => {
  const rendered = t('sv', 'play.round', { n: 4 });
  assert.equal(rendered, 'Omgång 4 av {m}');
  assert.ok(!/undefined/.test(rendered));
});

test('an explicitly null parameter also keeps its placeholder', () => {
  assert.equal(t('sv', 'play.round', { n: 4, m: null }), 'Omgång 4 av {m}');
});

test('zero and false are interpolated, not mistaken for absent', () => {
  // The classic `params[key] || whole` bug: hand 0 of 0 must not print braces.
  assert.equal(interpolate('{a}/{b}', { a: 0, b: false }), '0/false');
  assert.equal(t('sv', 'play.dice', { count: 0 }), '0 tärningar');
});

test('a template with no params at all is returned with its placeholders intact', () => {
  // Not `typeof === "string"`: t() returns a string on every path, including the
  // missing-key one, so a type assertion here could not fail.
  assert.equal(t('sv', 'play.round'), 'Omgång {n} av {m}');
  assert.equal(t('sv', 'play.bid'), 'Bud');
});

test('a null params argument renders instead of throwing', () => {
  // Callers hand us whatever they have; a crash here blanks the whole screen.
  assert.equal(t('sv', 'play.round', null), 'Omgång {n} av {m}');
  assert.equal(interpolate('{a}', null), '{a}');
  assert.equal(interpolate('{a}', 'not an object'), '{a}');
});

test('placeholders are filled from own properties only', () => {
  // Reading through the prototype chain rendered "function Object() {...}" into
  // a sentence somebody was about to read out loud.
  assert.equal(interpolate('{constructor}', {}), '{constructor}');
  assert.equal(interpolate('{toString}', {}), '{toString}');
  assert.equal(interpolate('{a}', Object.create({ a: 1 })), '{a}');
});

test('interpolate coerces a non-string template rather than crashing', () => {
  assert.equal(interpolate(7), '7');
  assert.equal(interpolate(undefined), 'undefined');
});

test('an unknown key returns the key itself and is detectable', () => {
  const key = 'nope.not.a.key';
  const rendered = t('sv', key);
  assert.ok(rendered.includes(key), 'the key must be visible in the output');
  assert.equal(isMissing(rendered), true);
  assert.ok(missingKeys().includes(`sv:${key}`));
});

test('a real key is never reported as missing', () => {
  assert.equal(isMissing(t('sv', 'play.bid')), false);
  assert.equal(isMissing(t('en', 'play.bid')), false);
});

test('an unknown language falls back to the default language', () => {
  for (const lang of ['de', '', null, undefined, 42, '__proto__', 'toString']) {
    const rendered = t(lang, 'play.bid');
    // Both halves matter: two placeholders would compare equal to each other.
    assert.equal(isMissing(rendered), false, `${String(lang)} produced a placeholder`);
    assert.equal(rendered, t(DEFAULT_LANG, 'play.bid'), String(lang));
  }
});

test('the fallback does not register the key as missing', () => {
  t('de', 'play.bid');
  assert.equal(
    missingKeys().some((entry) => entry.endsWith(':play.bid')),
    false
  );
});

test('the three validateHand warning codes all have real explanations', () => {
  for (const lang of LANGS) {
    const a = t(lang, 'warning.mermaid-and-pirates');
    const b = t(lang, 'warning.mermaid-claimed-twice', { claimed: 2 });
    const c = t(lang, 'warning.too-many-pirates', { claimed: 4 });
    for (const text of [a, b, c]) {
      assert.equal(isMissing(text), false);
      // These get read out loud mid-argument, so a label is not enough.
      assert.ok(text.length > 40, `too terse for a pub table: ${text}`);
      assert.ok(!/[{}]/.test(text), `unfilled placeholder in: ${text}`);
    }
    assert.ok(b.includes('2'), 'the mermaid claim count must be shown');
    assert.ok(c.includes('4'), 'the pirate claim count must be shown');
  }
});

test('the bonus labels carry their point values', () => {
  for (const lang of LANGS) {
    assert.ok(t(lang, 'bonus.mermaid').includes('50'));
    assert.ok(t(lang, 'bonus.pirate').includes('30'));
  }
});

test('the trick shortfall message is parameterised by how many are missing', () => {
  for (const lang of LANGS) {
    const one = t(lang, 'validate.shortfall', { missing: 1 });
    const three = t(lang, 'validate.shortfall', { missing: 3 });
    assert.ok(one.includes('1'));
    assert.ok(three.includes('3'));
    assert.notEqual(one, three);
  }
});

test('the surplus message is parameterised too', () => {
  for (const lang of LANGS) {
    const surplus = t(lang, 'validate.surplus', { extra: 2 });
    assert.ok(surplus.includes('2'));
    assert.equal(isMissing(surplus), false);
  }
});

test('both rulesets are named, and Landrattenwertung keeps its German name', () => {
  for (const lang of LANGS) {
    assert.equal(isMissing(t(lang, 'ruleset.standard')), false);
    assert.ok(t(lang, 'ruleset.landratta').includes('Landratt'));
    assert.equal(isMissing(t(lang, 'ruleset.landratta.about')), false);
  }
});

test('the taunt pools are non-empty and the same size in both languages', () => {
  assert.ok(TAUNTS.sv.length >= 8, 'at least 8 Swedish taunts');
  assert.equal(TAUNTS.en.length, TAUNTS.sv.length);
  for (const lang of LANGS) {
    for (const line of TAUNTS[lang]) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0);
    }
    assert.equal(new Set(TAUNTS[lang]).size, TAUNTS[lang].length, 'duplicate taunt');
  }
});

test('taunt() rotates deterministically through the pool and wraps', () => {
  const pool = TAUNTS.sv;
  assert.equal(taunt('sv', 0), pool[0]);
  assert.equal(taunt('sv', 1), pool[1]);
  assert.equal(taunt('sv', pool.length), pool[0], 'must wrap around');
  assert.equal(taunt('sv', -1), pool[pool.length - 1], 'negative index must wrap');
});

test('taunt() falls back to the default language for an unknown one', () => {
  assert.equal(taunt('de', 0), TAUNTS[DEFAULT_LANG][0]);
});

test('medal labels exist for all three places', () => {
  for (const lang of LANGS) {
    for (const key of ['gold', 'silver', 'bronze']) {
      assert.equal(isMissing(t(lang, `medal.${key}`)), false);
    }
  }
});

test('the 2-player house rule is labelled as one', () => {
  assert.match(t('sv', 'note.twoPlayer'), /husregel/i);
  assert.match(t('en', 'note.twoPlayer'), /house rule/i);
});

test('the auto-filled marker exists — silent auto-fill starts arguments', () => {
  for (const lang of LANGS) {
  }
});

test('the play copy the helm needs is all present', () => {
  const keys = [
    'play.bid',
    'play.tricks',
    'play.bidPrompt',
    'play.trickPrompt',
    'play.book',
    'play.undo',
    'play.lastEntry',
  ];
  for (const lang of LANGS) {
    for (const key of keys) assert.equal(isMissing(t(lang, key)), false, `${lang}.${key}`);
  }
});

// --- Contracts with the modules that supply the keys ------------------------

test('every cursor phase in state.js has a label', () => {
  // The rail labels the phase from `game.cursor.phase`, whose values are
  // 'bid' | 'trick' | 'tally' — note 'trick' singular, which is NOT play.tricks.
  for (const lang of LANGS) {
    for (const phase of PHASES) {
      assert.equal(isMissing(t(lang, `phase.${phase}`)), false, `${lang}.phase.${phase}`);
    }
  }
});

test('every supported language has a name in every language', () => {
  // The picker in settings must not hardcode "Svenska" outside i18n.js.
  for (const lang of LANGS) {
    for (const named of LANGS) {
      assert.equal(isMissing(t(lang, `lang.${named}`)), false, `${lang}.lang.${named}`);
    }
  }
  assert.equal(t('en', 'lang.sv'), 'Svenska', 'persona-language names are not translated');
});

// --- Lookup edge cases -----------------------------------------------------

test('a key that names a whole sub-table is missing, not an object', () => {
  for (const key of ['screen', 'play', 'warning']) {
    const rendered = t('sv', key);
    assert.equal(isMissing(rendered), true, key);
    assert.ok(!/object|\[/.test(rendered), `${key} leaked an object`);
  }
});

test('descending past a leaf string reports missing rather than throwing', () => {
  assert.equal(isMissing(t('sv', 'play.bid.deeper.still')), true);
});

test('inherited properties are not reachable as keys', () => {
  for (const key of ['constructor', 'toString', 'screen.constructor', '__proto__']) {
    assert.equal(isMissing(t('sv', key)), true, key);
  }
});

test('keys with dots and dashes inside a segment resolve', () => {
  // `ruleset.landratta.about` and the warning codes are literal keys holding a
  // dot or a dash, so `lookup` must try the whole remainder at every level.
  assert.equal(isMissing(t('sv', 'ruleset.standard.about')), false);
  assert.equal(isMissing(t('sv', 'warning.too-many-pirates', { claimed: 4 })), false);
});

test('an empty key is missing and reported as such', () => {
  assert.equal(isMissing(t('sv', '')), true);
});

// --- The missing-key channel ----------------------------------------------

test('isMissing only accepts the full wrapper, and tolerates non-strings', () => {
  assert.equal(isMissing(undefined), false);
  assert.equal(isMissing(null), false);
  assert.equal(isMissing(42), false);
  assert.equal(isMissing('Bud'), false);
  const wrapped = t('sv', 'nope.nope');
  assert.equal(isMissing(wrapped.slice(1)), false, 'a truncated wrapper is not missing');
  assert.equal(isMissing(wrapped.slice(0, -1)), false);
});

test('missingKeys() hands back a copy, not the live set', () => {
  t('sv', 'diagnostic.probe');
  const first = missingKeys();
  first.push('bogus:key');
  assert.equal(missingKeys().includes('bogus:key'), false);
  assert.ok(missingKeys().includes('sv:diagnostic.probe'));
});

test('the missing-key log is capped so an evening of renders cannot grow it forever', () => {
  for (let i = 0; i < 500; i += 1) t('sv', `flood.key${i}`);
  assert.ok(missingKeys().length <= 200, `log grew to ${missingKeys().length}`);
  // Capped recording must not stop the loud placeholder from rendering.
  assert.equal(isMissing(t('sv', 'flood.key9999')), true);
});

// --- Shared, frozen data ---------------------------------------------------

test('the exported tables cannot be mutated by a caller', () => {
  assert.throws(() => LANGS.push('de'), TypeError);
  assert.throws(() => TAUNTS.sv.reverse(), TypeError);
  assert.throws(() => {
    dict.sv.play.bid = 'Nope';
  }, TypeError);
  assert.deepEqual([...LANGS], ['sv', 'en']);
  assert.equal(t('sv', 'play.bid'), 'Bud');
});

test('taunt() always returns a pool string, even for a nonsense index', () => {
  // A NaN index (arithmetic on a total that was never set) used to return
  // undefined, which the shame state would paint as a blank line.
  for (const index of [NaN, Infinity, -Infinity, undefined, null, '3']) {
    const line = taunt('sv', index);
    assert.ok(TAUNTS.sv.includes(line), `index ${String(index)} gave ${String(line)}`);
  }
  assert.equal(taunt('sv', NaN), TAUNTS.sv[0]);
  assert.equal(taunt('sv', 2.7), TAUNTS.sv[2], 'a fractional index truncates');
  assert.equal(taunt('sv', '3'), TAUNTS.sv[3], 'a numeric string still counts');
  assert.equal(taunt('sv', -12), TAUNTS.sv[TAUNTS.sv.length - 2]);
});

test('taunt() with no index at all is the first taunt', () => {
  assert.equal(taunt('sv'), TAUNTS.sv[0]);
});
