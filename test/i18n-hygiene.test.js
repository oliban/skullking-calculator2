import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not the working directory, so the check cannot pass
// simply because it was run from somewhere that has no js/ directory.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Spec §6: all user-visible copy lives in i18n.js. Every prototype leaked
// hardcoded Swedish into chrome that then ignored the language switch, so this
// is enforced rather than remembered.
//
// Scope, deliberately:
//  - Comments may be in any language. Only string literals are copy.
//  - A literal is copy if it contains a non-ASCII LETTER. Symbols and glyphs
//    ("·", "✦", "⚙", "—", emoji) are not translatable and are allowed inline;
//    treating them as copy would push punctuation into the message tables and
//    teach everyone to ignore this test.
//  - Known blind spot: Swedish prose that happens to be pure ASCII ("Pirat 3")
//    slips through. Nothing cheap catches that, so it stays a review concern.

const ALLOWED = new Set(['i18n.js', 'personas.js']);

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Strip comments so their prose does not trip the check. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** String and template literals, naively but adequately for our own source. */
function stringLiterals(src) {
  return [
    ...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
    ...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
    ...src.matchAll(/`((?:[^`\\]|\\.)*)`/g),
  ].map((m) => m[1]);
}

/** Every shipped .js file: the modules, plus the service worker at the root. */
function shippedFiles() {
  const files = jsFiles(join(ROOT, 'js'));
  const sw = join(ROOT, 'sw.js');
  try {
    statSync(sw);
    files.push(sw);
  } catch {
    // Not written yet.
  }
  return files;
}

test('the hygiene check is actually looking at files', () => {
  // Without this, a bad path would make the check below vacuously green.
  assert.ok(shippedFiles().length >= 4, 'expected to find the js/ modules');
});

test('no user-facing copy outside i18n.js and personas.js', () => {
  const offenders = [];

  for (const path of shippedFiles()) {
    if (ALLOWED.has(path.split('/').pop())) continue;
    for (const literal of stringLiterals(stripComments(readFileSync(path, 'utf8')))) {
      if (/[^\x00-\x7F]/u.test(literal) && /\p{L}/u.test(literal.replace(/[\x00-\x7F]/g, ''))) {
        offenders.push({ path, literal });
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'non-ASCII string literals found outside i18n.js:\n' +
      offenders.map((o) => `  ${o.path}: ${JSON.stringify(o.literal)}`).join('\n')
  );
});
