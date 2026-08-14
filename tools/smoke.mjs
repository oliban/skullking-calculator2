#!/usr/bin/env node
/**
 * Browser smoke test: plays a full game and asserts the constraints that only a
 * real layout engine can check.
 *
 * Spec §8: the one UI thing worth automating is the height budget. Every
 * prototype violated "nothing scrolls" in a way arithmetic alone did not catch,
 * because the overflow depended on font metrics and on when sizing ran.
 *
 * Drives Chrome over CDP using Node's built-in WebSocket, so this stays a
 * zero-dependency project. Not part of `npm test` (it needs Chrome and a
 * server); run it with `npm run smoke`.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { once } from 'node:events';

const ROOT = resolve(import.meta.dirname, '..');
const CHROME =
  process.env.CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** iPhone 14/15/16 logical viewport. The design target. */
const VIEWPORTS = [
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone SE', width: 375, height: 667 },
];

const CREW_SIZES = [4, 6];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

// --- Static server ---------------------------------------------------------

async function serve() {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(
      /^(\.\.[/\\])+/,
      ''
    );
    const path = join(ROOT, rel === '/' ? 'index.html' : rel);
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

// --- CDP -------------------------------------------------------------------

async function launchChrome(port) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      '--user-data-dir=' + join(process.env.TMPDIR ?? '/tmp', `sk-smoke-${process.pid}`),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  // Wait for the debugging endpoint rather than sleeping a guessed interval.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { chrome, ws: (await res.json()).webSocketDebuggerUrl };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Chrome did not expose a debugging port');
}

/** Minimal CDP client: send(method, params) -> result. */
function cdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  let sessionId = null;

  const ready = new Promise((res, rej) => {
    socket.onopen = res;
    socket.onerror = rej;
  });

  const listeners = new Set();

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: no } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) no(new Error(`${msg.error.message}`));
      else ok(msg.result);
      return;
    }
    // Events. Subscribing to these is the whole point: an uncaught exception in
    // render() leaves a blank screen that DOM assertions happily call "fine".
    if (msg.method) for (const fn of listeners) fn(msg);
  };

  async function send(method, params = {}, useSession = true) {
    await ready;
    const id = nextId++;
    const payload = { id, method, params };
    if (useSession && sessionId) payload.sessionId = sessionId;
    socket.send(JSON.stringify(payload));
    return new Promise((ok, no) => pending.set(id, { resolve: ok, reject: no }));
  }

  return {
    send,
    async attach(targetUrl) {
      const { targetId } = await send('Target.createTarget', { url: targetUrl }, false);
      const attached = await send(
        'Target.attachToTarget',
        { targetId, flatten: true },
        false
      );
      sessionId = attached.sessionId;
      return targetId;
    },
    on: (fn) => listeners.add(fn),
    close: () => socket.close(),
  };
}

// --- The test ---------------------------------------------------------------

const failures = [];
function check(ok, label) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failures.push(label);
  }
}

/**
 * Runs in the page. Plays a whole game by clicking only live keys, asserting
 * after every single tap that nothing overflows and every total is visible.
 */
const PLAY = `
(async () => {
  const out = { taps: 0, problems: [], handsPlayed: 0, finalSeen: false, phasesSeen: [], saidSeen: 0, phaseLook: {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vv = () => ({ w: innerWidth, h: innerHeight });

  function inspect(where) {
    const doc = document.documentElement;
    if (doc.scrollHeight > doc.clientHeight + 1) {
      out.problems.push(where + ': document scrolls (' + doc.scrollHeight + ' > ' + doc.clientHeight + ')');
    }
    if (doc.scrollWidth > doc.clientWidth + 1) {
      out.problems.push(where + ': document scrolls horizontally');
    }
    // The pad must never overflow its own box.
    const pad = document.getElementById('pad');
    if (pad && pad.scrollHeight > pad.clientHeight + 1) {
      out.problems.push(where + ': pad overflows (' + pad.scrollHeight + ' > ' + pad.clientHeight + ')');
    }
    // Every key fully inside the viewport AND actually reachable by a finger.
    // Geometry alone is not enough: an invisible overlay leaves every rect
    // perfect while making the whole pad untappable, and synthetic .click()
    // calls sail straight through it.
    for (const key of pad ? pad.querySelectorAll('.key') : []) {
      const r = key.getBoundingClientRect();
      const label = key.textContent.trim();
      if (r.top < -1 || r.bottom > vv().h + 1) {
        out.problems.push(where + ': key "' + label + '" outside viewport (top ' + Math.round(r.top) + ', bottom ' + Math.round(r.bottom) + ')');
      }
      // Only LIVE keys are hit-tested. Inert keys carry pointer-events:none on
      // purpose, so the pad is legitimately the topmost hit for them.
      if (!key.classList.contains('dead')) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || (hit !== key && !key.contains(hit))) {
          out.problems.push(where + ': live key "' + label + '" is covered by ' + (hit ? (hit.id || hit.className || hit.tagName) : 'nothing'));
        }
      }
    }
    // The prompt must be reachable/visible too.
    const promptAsk = document.querySelector('#prompt .hand');
    if (promptAsk) {
      const r = promptAsk.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit.id === 'sheet') out.problems.push(where + ': prompt covered by the sheet');
    }
    // Every total visible and non-empty. Constraint 2.
    const chips = document.querySelectorAll('#rail .chip');
    if (chips.length === 0) out.problems.push(where + ': rail empty');
    for (const chip of chips) {
      const total = chip.querySelector('.total');
      const r = chip.getBoundingClientRect();
      if (!total || total.textContent.trim() === '') {
        out.problems.push(where + ': a chip has no visible total');
      }
      if (r.bottom <= 0 || r.top >= vv().h) {
        out.problems.push(where + ': a chip is off screen');
      }
      // Nothing may cover the rail — that is the whole promise of The Helm.
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (mid && !chip.contains(mid) && mid !== chip) {
        out.problems.push(where + ': rail chip covered by ' + (mid.id || mid.className || mid.tagName));
      }
    }
    // Any enabled button in an open sheet must be reachable by a finger.
    const openSheet = document.getElementById('sheet');
    if (openSheet && !openSheet.hidden) {
      for (const b of openSheet.querySelectorAll('.btn:not([disabled])')) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || (hit !== b && !b.contains(hit))) {
          out.problems.push(where + ': sheet button "' + b.textContent.trim() + '" covered by ' + (hit ? (hit.id || hit.className || hit.tagName) : 'nothing'));
        }
      }
    }
    // Unsubstituted i18n placeholders anywhere on screen.
    const text = document.body.innerText || '';
    const leak = text.match(/\\{[a-zA-Z]+\\}/g);
    if (leak) out.problems.push(where + ': untranslated placeholder ' + [...new Set(leak)].join(','));
    // Nothing may float over the play surface. The user asked for no popups, and
    // an overlay covering the pad was a real bug here once.
    if (document.getElementById('toast')) {
      out.problems.push(where + ': a toast element exists');
    }

    // The two questions must not look identical: the pad advertises its phase,
    // and the trick phase echoes the bid the player announced.
    const pad2 = document.getElementById('pad');
    if (pad2 && pad2.children.length && pad2.dataset.phase) {
      if (!out.phasesSeen.includes(pad2.dataset.phase)) out.phasesSeen.push(pad2.dataset.phase);
      // Record how each phase LOOKS. The two questions must not be
      // distinguishable only by their wording, which nobody re-reads by hand six.
      const stage2 = document.getElementById('stage');
      const firstKey = pad2.querySelector('.key');
      if (firstKey) {
        out.phaseLook[pad2.dataset.phase] = [
          getComputedStyle(stage2).backgroundImage.slice(0, 90),
          getComputedStyle(firstKey).borderRadius,
          getComputedStyle(firstKey).color,
        ].join(' | ');
      }
      if (pad2.dataset.phase === 'trick') {
        const said = document.querySelector('#prompt .said');
        if (!said || !said.textContent.trim()) {
          out.problems.push(where + ': trick phase does not show the announced bid');
        } else {
          out.saidSeen += 1;
          if (!/\\d|noll|nil/i.test(said.textContent)) {
            out.problems.push(where + ': bid echo has no number: ' + said.textContent);
          }
        }
        // The bid value should be findable on the pad.
        if (!pad2.querySelector('.key.target')) {
          out.problems.push(where + ': trick pad does not mark the announced bid');
        }
      }
    }

    // The tally's columns must line up down the page regardless of which rows
    // carry a bonus badge — each row is its own grid, so this is easy to break.
    const rows = [...document.querySelectorAll('#sheet .tally-row')];
    if (rows.length > 1) {
      const lefts = rows.map((r) => Math.round(r.querySelector('.pts').getBoundingClientRect().left));
      if (new Set(lefts).size !== 1) {
        out.problems.push(where + ': tally score column is ragged (' + lefts.join(',') + ')');
      }
      const callLefts = rows.map((r) => Math.round(r.querySelector('.call').getBoundingClientRect().left));
      if (new Set(callLefts).size !== 1) {
        out.problems.push(where + ': tally bud/stick column is ragged (' + callLefts.join(',') + ')');
      }
    }

    // "No bonuses" must never be printed; only actual bonuses are shown.
    const sheetText = (document.getElementById('sheet')?.innerText ?? '').toLowerCase();
    if (sheetText.includes('inga bonusar') || sheetText.includes('no bonuses')) {
      out.problems.push(where + ': printed a "no bonuses" line');
    }

    // Each player must carry a distinct colour so the active one is obvious.
    const chipColors = [...document.querySelectorAll('#rail .chip')].map((c) => c.dataset.color);
    if (chipColors.length && new Set(chipColors).size !== chipColors.length) {
      out.problems.push(where + ': two players share a colour: ' + chipColors.join(','));
    }

    // No <select> or number input: entry must be taps only.
    if (document.querySelector('#stage select, #stage input[type=number]')) {
      out.problems.push(where + ': found a dropdown or number input in the entry path');
    }
  }

  // Start the voyage from the cabin.
  const start = [...document.querySelectorAll('#sheet .btn')].find((b) => b.classList.contains('primary'));
  if (!start) { out.problems.push('no start button'); return out; }
  start.click();
  await sleep(60);
  inspect('hand 1 bid');

  for (let guard = 0; guard < 400; guard += 1) {
    const sheet = document.getElementById('sheet');
    const sheetOpen = !sheet.hidden;

    if (sheetOpen) {
      const heading = sheet.querySelector('h2')?.textContent ?? '';
      // The reckoning: podium present.
      if (sheet.querySelector('.podium')) { out.finalSeen = true; inspect('reckoning'); break; }

      // The tally: book the hand. The button lives inside the sheet.
      inspect('tally ' + heading);
      const bookKey = [...sheet.querySelectorAll('.btn.primary')].find((b) => !b.disabled);
      if (bookKey) {
        bookKey.click();
        out.handsPlayed += 1;
        await sleep(60);
        inspect('after booking hand ' + out.handsPlayed);
        continue;
      }
      // Tally open but not bookable: bail rather than spin.
      const rows = [...sheet.querySelectorAll('.tally-row')].map((r) =>
        (r.querySelector('.nm')?.textContent ?? '?') + '=' + (r.querySelector('.call')?.textContent ?? '?')
      );
      const short = sheet.querySelector('.shortfall')?.textContent ?? '(no shortfall note)';
      out.problems.push('tally not bookable: ' + heading + ' | ' + rows.join(' ') + ' | ' + short);
      break;
    }

    const live = [...document.querySelectorAll('#pad .key:not(.dead)')].filter((k) => k.dataset.value !== undefined);
    if (live.length === 0) { out.problems.push('no live keys and no sheet open'); break; }

    // Nothing is auto-filled any more, so the tester has to make the tricks add
    // up itself. Legal trick values are capped at what is still unclaimed, so the
    // highest legal key for the LAST pending seat is exactly the remainder.
    const pad3 = document.getElementById('pad');
    const pending = [...document.querySelectorAll('#rail .chip .call')]
      .filter((c) => /\u00b7$/.test(c.textContent.trim())).length;
    const lastSeatOfTricks = pad3.dataset.phase === 'trick' && pending <= 1;

    // Otherwise bid unpredictably so hits and misses both happen, deterministically.
    const pickIndex = lastSeatOfTricks ? live.length - 1 : out.taps % live.length;
    live[pickIndex].click();
    out.taps += 1;
    await sleep(18);
    inspect('tap ' + out.taps);
  }

  return out;
})()
`;


/**
 * A hand whose tricks do not add up must be impossible to book.
 *
 * This is the safety net that replaced the auto-fill: nothing is inferred, so the
 * only thing standing between a mis-counted hand and a wrong score is this
 * refusal. Asserted in the real browser, against the real button.
 */
const SHORT_HAND = `
(async () => {
  const out = { steps: [], problems: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tapValue = async (v) => {
    const key = [...document.querySelectorAll('#pad .key:not(.dead)')]
      .find((k) => k.dataset.value === String(v));
    if (!key) { out.problems.push('no live key for ' + v); return false; }
    key.click(); await sleep(25); return true;
  };

  document.querySelector('#sheet .btn.primary').click();
  await sleep(70);

  const crew = document.querySelectorAll('#rail .chip').length;
  // Hand 1 deals one die, so exactly one trick exists at the table.
  for (let i = 0; i < crew; i += 1) await tapValue(0);      // everyone bids nil
  for (let i = 0; i < crew; i += 1) await tapValue(0);      // and nobody claims it
  await sleep(90);

  const sheet = document.getElementById('sheet');
  if (sheet.hidden) { out.problems.push('tally never opened'); return out; }

  const book = [...sheet.querySelectorAll('.btn.primary')][0];
  out.bookDisabled = Boolean(book && book.disabled);
  // A refused button must also READ as refused.
  out.bookLooksDisabled = book
    ? Number(getComputedStyle(book).opacity) < 0.75
    : false;
  out.shortfallShown = Boolean(sheet.querySelector('.shortfall'));
  out.shortfallText = sheet.querySelector('.shortfall')?.textContent ?? '';

  // Now correct it by tapping the pirate's numbers, and claim the trick.
  const firstRow = sheet.querySelector('.tally-row .call');
  if (firstRow) { firstRow.click(); await sleep(70); }
  out.reenterOpenedPad = document.getElementById('sheet').hidden === true;
  await tapValue(1);
  await sleep(90);

  const sheet2 = document.getElementById('sheet');
  const book2 = [...sheet2.querySelectorAll('.btn.primary')][0];
  out.bookEnabledAfterFix = Boolean(book2 && !book2.disabled);
  return out;
})()
`;


/**
 * After a correction you must be able to get back to booking.
 *
 * The reported bug: correct an EARLY entry once the hand is already full, and the
 * cursor kept walking the remaining seats — re-tapping them overwrote numbers
 * people had given, and there was no route back to the booking screen.
 */
const CORRECTION = `
(async () => {
  const out = { steps: [], problems: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tally = () => {
    const sh = document.getElementById('sheet');
    return !sh.hidden && Boolean(sh.querySelector('.tally-row'));
  };
  const tap = async (v) => {
    const key = [...document.querySelectorAll('#pad .key:not(.dead)')]
      .find((k) => k.dataset.value === String(v));
    if (!key) { out.problems.push('no live key ' + v); return false; }
    key.click(); await sleep(30); return true;
  };

  document.querySelector('#sheet .btn.primary').click();
  await sleep(70);
  const crew = document.querySelectorAll('#rail .chip').length;

  // Hand 1: everyone bids nil, the last pirate takes the only trick.
  for (let i = 0; i < crew; i += 1) await tap(0);
  for (let i = 0; i < crew - 1; i += 1) await tap(0);
  await tap(1);
  await sleep(90);
  out.reachedTally = tally();

  // --- Correct the FIRST pirate (not the last one entered) ----------------
  const firstCall = document.querySelector('#sheet .tally-row .call');
  firstCall.click();
  await sleep(80);
  out.padOpenedForCorrection = document.getElementById('sheet').hidden === true;
  out.correctingSeat = document.querySelector('#prompt .ask b')?.textContent ?? '';

  // Re-enter that pirate's trick count. The hand is complete again immediately,
  // so we must land back on the tally without walking anybody else.
  await tap(0);
  await sleep(110);
  out.backAtTallyAfterCorrection = tally();

  // --- Now via ÅNGRA, then correct, then back ----------------------------
  if (tally()) {
    const undoBtn = [...document.querySelectorAll('#sheet .btn')]
      .find((b) => !b.classList.contains('primary') && !b.classList.contains('cog'));
    undoBtn.click();
    await sleep(90);
    out.undoLeftTally = document.getElementById('sheet').hidden === true;

    // Instead of re-entering, jump back via the header's round label.
    const label = document.querySelector('.rail-hand');
    out.labelIsButtonWhileIncomplete = label && label.tagName === 'BUTTON';

    await tap(1);
    await sleep(110);
    out.backAtTallyAfterUndo = tally();
  }

  // --- The header label as an explicit route back ------------------------
  if (tally()) {
    const chip = document.querySelectorAll('#rail .chip')[0];
    chip.click();
    await sleep(80);
    await tap(0);
    await sleep(110);
    const label2 = document.querySelector('.rail-hand');
    out.labelTappableWhenComplete = label2 && label2.tagName === 'BUTTON';
    // Close the tally and prove the label reopens it.
    if (label2 && label2.tagName === 'BUTTON') {
      label2.click();
      await sleep(80);
      out.labelReopensTally = tally();
    }
  }
  return out;
})()
`;

async function run() {
  const { server, port } = await serve();
  const debugPort = 9500 + (process.pid % 400);
  const { chrome, ws } = await launchChrome(debugPort);
  const client = cdp(ws);

  try {
    await client.attach('about:blank');

    // Anything the page throws or logs as an error lands here.
    const collector = [];
    client.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        collector.push(
          'exception: ' +
            (d.exception?.description ?? d.text ?? 'unknown') +
            ' @' + (d.url ?? '?') + ':' + (d.lineNumber ?? '?')
        );
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        collector.push(
          'console.error: ' +
            msg.params.args.map((a) => a.description ?? a.value ?? '?').join(' ')
        );
      }
    });

    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.enable');

    // Run the refusal check once, on the design target.
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await new Promise((r) => setTimeout(r, 700));
    await client.send('Runtime.evaluate', { expression: 'localStorage.clear(); location.reload();' });
    await new Promise((r) => setTimeout(r, 800));

    console.log('\nA hand that does not add up');
    const short = (
      await client.send('Runtime.evaluate', {
        expression: SHORT_HAND, awaitPromise: true, returnByValue: true,
      })
    ).result.value ?? {};
    check(short.bookDisabled === true, 'booking is refused when tricks are missing');
    check(short.bookLooksDisabled === true, 'the refused button looks refused');
    check(short.shortfallShown === true, `the shortfall is stated (${short.shortfallText.trim()})`);
    check(short.reenterOpenedPad === true, 'tapping a pirate re-opens their entry');
    check(short.bookEnabledAfterFix === true, 'booking is allowed once it adds up');
    check((short.problems ?? []).length === 0, 'no problems during the refusal check');
    for (const pr of short.problems ?? []) console.log(`       - ${pr}`);

    // The correction round-trip, once.
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    await new Promise((r) => setTimeout(r, 600));
    await client.send('Runtime.evaluate', { expression: 'localStorage.clear(); location.reload();' });
    await new Promise((r) => setTimeout(r, 800));

    console.log('\nCorrecting an entry and getting back to booking');
    const corr = (
      await client.send('Runtime.evaluate', {
        expression: CORRECTION, awaitPromise: true, returnByValue: true,
      })
    ).result.value ?? {};
    check(corr.reachedTally === true, 'the hand reaches the tally');
    check(corr.padOpenedForCorrection === true, 'tapping a pirate opens their entry');
    check(corr.backAtTallyAfterCorrection === true, 'back at booking after correcting an EARLY entry');
    check(corr.undoLeftTally === true, 'undo returns to entry');
    check(corr.backAtTallyAfterUndo === true, 'back at booking after undo + re-entry');
    check(corr.labelReopensTally === true, 'the header round label reopens booking');
    check((corr.problems ?? []).length === 0, 'no problems during the correction check');
    for (const pr of corr.problems ?? []) console.log(`       - ${pr}`);

    for (const viewport of VIEWPORTS) {
      for (const crew of CREW_SIZES) {
        console.log(`\n${viewport.name} ${viewport.width}x${viewport.height}, ${crew} pirates`);

        await client.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 3,
          mobile: true,
        });

        const errors = [];
        collector.length = 0;
        // Fresh storage each run so a resumable game does not change the flow.
        await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
        await new Promise((r) => setTimeout(r, 700));
        await client.send('Runtime.evaluate', {
          expression: 'localStorage.clear(); location.reload();',
        });
        await new Promise((r) => setTimeout(r, 800));

        // Set the crew size by clicking the stepper.
        const set = await client.send('Runtime.evaluate', {
          expression: `(() => {
            // Re-query every iteration: each tap re-renders the cabin, which
            // detaches the buttons found by a previous query.
            const step = (i) => document.querySelectorAll('#sheet .stepper .btn')[i].click();
            const n = () => Number(document.querySelector('#sheet .stepper .n').textContent.trim());
            let guard = 0;
            while (n() < ${crew} && guard++ < 10) step(1);
            while (n() > ${crew} && guard++ < 20) step(0);
            return n();
          })()`,
          returnByValue: true,
        });
        check(set.result.value === crew, `crew size set to ${crew} (got ${set.result.value})`);

        const played = await client.send('Runtime.evaluate', {
          expression: PLAY,
          awaitPromise: true,
          returnByValue: true,
        });
        const result = played.result.value ?? {};

        check(result.handsPlayed > 0, `played hands (${result.handsPlayed})`);
        check(
          (result.phasesSeen ?? []).includes('bid') && (result.phasesSeen ?? []).includes('trick'),
          `both phases rendered (${(result.phasesSeen ?? []).join(', ')})`
        );
        check(result.saidSeen > 0, `bid echoed on trick screens (${result.saidSeen}x)`);
        const look = result.phaseLook ?? {};
        check(
          Boolean(look.bid && look.trick && look.bid !== look.trick),
          'the two phases look different (surface, key shape, ink)'
        );
        check(result.finalSeen === true, 'reached the reckoning');
        const problems = [...new Set(result.problems ?? [])];
        check(problems.length === 0, `no layout/copy problems (${problems.length})`);
        for (const problem of problems.slice(0, 12)) console.log(`       - ${problem}`);
        const uniqueErrors = [...new Set(collector)];
        check(uniqueErrors.length === 0, `no page errors (${uniqueErrors.length})`);
        for (const e of uniqueErrors.slice(0, 6)) console.log(`       - ${e}`);
        errors.push(...uniqueErrors);
      }
    }
  } finally {
    client.close();
    chrome.kill();
    server.close();
  }

  console.log(
    failures.length === 0
      ? '\nSMOKE PASS'
      : `\nSMOKE FAIL (${failures.length})\n` + failures.map((f) => ` - ${f}`).join('\n')
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
