/**
 * Wiring. Owns the one mutable reference to the game and decides what is on
 * screen; every module it calls is pure or renders into a node it is handed.
 *
 * The whole app is one render function driven by state, because The Helm has no
 * partial updates worth optimising — a rail of six chips and a pad of nine keys
 * repaint faster than any diffing would.
 */

import { handsFor, validateHand } from './rules.js';
import {
  advance,
  back,
  commitHand,
  currentHand,
  entriesInSeatOrder,
  isFinished,
  legalValues,
  playerAt,
  setEntry,
  undo,
} from './state.js';
import { newGame } from './state.js';
import { dealPersonas } from './personas.js';
import { t } from './i18n.js';
import { colorForSeat } from './palette.js';
import {
  clearGame,
  hasResumableGame,
  loadGame,
  loadHallOfFame,
  loadSettings,
  recordGame,
  saveGame,
  saveSettings,
} from './storage.js';
import { renderRail } from './ui/rail.js';
import { renderPad } from './ui/pad.js';
import { renderBonus, renderTally } from './ui/tally.js';
import {
  renderCabin,
  renderEmojiPicker,
  renderHall,
  renderReckoning,
  renderSettings,
} from './ui/screens.js';

const railEl = document.getElementById('rail');
const promptEl = document.getElementById('prompt');
const padEl = document.getElementById('pad');
const sheetEl = document.getElementById('sheet');

/** UI state that is not game state: which sheet is open, and on whose behalf. */
const ui = {
  settings: loadSettings(),
  game: null,
  draft: null,
  sheet: 'cabin', // cabin | emoji | tally | bonus | reckoning | hall | settings | null
  sheetArg: null,
  tauntIndex: 0,
};

const lang = () => ui.settings.lang;

// --- Chrome ----------------------------------------------------------------

function openSheet(name, arg = null) {
  ui.sheet = name;
  ui.sheetArg = arg;
  render();
}

function closeSheet() {
  ui.sheet = null;
  ui.sheetArg = null;
  render();
}

/** Light haptic on iOS where available; silently absent elsewhere. */
function tick() {
  navigator.vibrate?.(8);
}

// --- Crew drafting ---------------------------------------------------------

function draftCrew(size) {
  const dealt = dealPersonas(size);
  // `dealt` is kept so that blanking the name field falls back to the pirate we
  // dealt, rather than to an invented label that would need translating.
  return dealt.map((p) => ({ name: p.name, emoji: p.emoji, dealt: p.name }));
}

function resizeDraft(size) {
  const next = draftCrew(size);
  // Keep names the user already edited, so changing the crew size does not wipe
  // the typing they just did.
  for (let i = 0; i < Math.min(size, ui.draft.length); i += 1) {
    next[i] = ui.draft[i];
  }
  ui.draft = next;
  render();
}

function startVoyage() {
  const players = ui.draft.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name.trim() || p.dealt,
    emoji: p.emoji,
  }));
  ui.game = newGame({
    players,
    ruleset: ui.settings.ruleset,
    lang: lang(),
    id: `g${Date.now()}`,
  });
  ui.sheet = null;
  persist();
  render();
}

function persist() {
  if (ui.game) saveGame(ui.game);
}

// --- Entry ----------------------------------------------------------------

/** Record a tapped value for the seat under the cursor, then walk on. */
function pick(value) {
  // Last line of defence: nothing but a real tapped integer may enter a hand.
  if (!Number.isInteger(value)) return;
  const { phase, seat } = ui.game.cursor;
  const field = phase === 'bid' ? 'bid' : 'tricks';

  ui.game = setEntry(ui.game, seat, { [field]: value });

  const before = ui.game.cursor.phase;
  ui.game = advance(ui.game);

  // Every seat answers for itself, the last one included. Nothing is inferred:
  // a number the app assigned on somebody's behalf is a number nobody agreed to.
  //
  // As soon as the hand is COMPLETE, go to the tally — whichever phase the cursor
  // happens to be in. Checking only the trick phase stranded you after correcting
  // an earlier entry: the hand was already full, but the cursor kept walking the
  // remaining seats and re-tapping them overwrote numbers people had given.
  if (handIsComplete(ui.game)) {
    ui.game = { ...ui.game, cursor: { ...ui.game.cursor, phase: 'tally' } };
  }

  if (ui.game.cursor.phase === 'tally') {
    ui.sheet = 'tally';
  } else if (before !== ui.game.cursor.phase) {
    // Phase swap: slide the pad so the change of question is felt, not just read.
    padEl.classList.add('slide');
    setTimeout(() => padEl.classList.remove('slide'), 10);
  }

  tick();
  persist();
  render();
}

function stepBack() {
  ui.game = undo(ui.game);
  if (ui.game.cursor.phase !== 'tally') ui.sheet = null;
  persist();
  render();
}

function book() {
  const hand = currentHand(ui.game);
  const check = validateHand(entriesInSeatOrder(ui.game, hand), hand.dice);
  // The button is disabled unless this passes, and the tally states the problem
  // inline; reaching here means a stale click, so just decline it.
  if (!check.ok) return;

  ui.game = commitHand(ui.game);
  ui.tauntIndex += 1;
  ui.sheet = isFinished(ui.game) ? 'reckoning' : null;

  if (isFinished(ui.game)) {
    recordGame(ui.game);
    clearGame();
  } else {
    persist();
  }
  tick();
  render();
}

/** Has every seat given both a bid and a trick count for the current hand? */
function handIsComplete(game) {
  const hand = currentHand(game);
  if (!hand || hand.committed) return false;
  return validateHand(entriesInSeatOrder(game, hand), hand.dice).complete;
}

/**
 * Re-enter one pirate's number.
 *
 * Reached by tapping their chip on the rail, or their numbers on the tally. It
 * clears the value and parks the cursor on them, so a mis-heard number costs one
 * tap plus the correction instead of undoing everyone who came after.
 *
 * Which value gets cleared follows the phase: while bidding it is the bid,
 * otherwise the trick count — which is what a correction at the tally almost
 * always means ("no, he actually took two").
 */
function reenter(seat) {
  const hand = currentHand(ui.game);
  if (!hand || hand.committed) return;

  // The value is NOT cleared: the pad shows what they said, and tapping any key
  // overwrites it. That keeps the hand complete throughout, so one change is
  // always enough to get back to the summary — and if you opened this by mistake,
  // the header's round label takes you back without altering anybody.
  const phase = ui.game.cursor.phase === 'bid' ? 'bid' : 'trick';
  ui.game = { ...ui.game, cursor: { hand: hand.n, phase, seat } };
  ui.sheet = null;
  tick();
  persist();
  render();
}

// --- Render ---------------------------------------------------------------

function renderPrompt() {
  promptEl.replaceChildren();
  if (!ui.game) return;

  const hand = currentHand(ui.game);
  const { phase, seat } = ui.game.cursor;

  // The hand counter lives in the header now. What stays here is the phase,
  // named outright: the two questions read almost the same at a glance, and
  // answering the wrong one silently corrupts the hand.
  if (phase !== 'tally') {
    const handLine = document.createElement('div');
    handLine.className = 'hand';
    const tag = document.createElement('span');
    tag.className = 'phase-tag';
    tag.dataset.phase = phase;
    tag.textContent = t(lang(), phase === 'bid' ? 'play.bid' : 'play.tricks');
    handLine.append(tag);
    promptEl.append(handLine);
  }

  const ask = document.createElement('div');
  ask.className = 'ask';
  if (phase !== 'tally') {
    const who = playerAt(ui.game, seat);
    const b = document.createElement('b');
    b.textContent = who.name;
    ask.append(
      b,
      document.createTextNode(
        ' — ' + t(lang(), phase === 'bid' ? 'play.bidPrompt' : 'play.trickPrompt')
      )
    );
  }
  promptEl.append(ask);

  // What this player announced. Only in the trick phase, where it is the number
  // you are being measured against.
  if (phase === 'trick') {
    const who = playerAt(ui.game, seat);
    const bid = hand.entries[who.id].bid;
    if (Number.isInteger(bid)) {
      const said = document.createElement('div');
      said.className = 'said';
      said.textContent = t(lang(), bid === 0 ? 'play.saidNil' : 'play.said', { bid });
      promptEl.append(said);
    }
  }

  // The undo ghost: what was entered last, tappable to take it back.
  const ghost = document.createElement('button');
  ghost.type = 'button';
  ghost.className = 'ghost';
  const previous = back(ui.game);
  const prevPlayer = playerAt(previous, previous.cursor.seat);
  const prevEntry = currentHand(previous)?.entries[prevPlayer?.id];
  const prevField = previous.cursor.phase === 'bid' ? 'bid' : 'tricks';
  const sameSlot =
    previous.cursor.phase === phase && previous.cursor.seat === seat;
  if (prevEntry && Number.isInteger(prevEntry[prevField]) && !sameSlot) {
    ghost.textContent = t(lang(), 'play.lastEntry', {
      emoji: prevPlayer.emoji,
      name: prevPlayer.name,
      value: prevEntry[prevField],
    });
    ghost.onclick = stepBack;
  }
  promptEl.append(ghost);
}

function renderStage() {
  const stage = document.getElementById('stage');

  if (!ui.game) {
    padEl.replaceChildren();
    stage.removeAttribute('data-phase');
    return;
  }

  const hand = currentHand(ui.game);
  // Drives the surface change between the two questions. Declaring what you will
  // take and reporting what you did take are different acts, and the screen says
  // so: bare deck for the promise, ledger parchment for the reckoning.
  stage.dataset.phase = ui.game.cursor.phase;

  // During the tally the sheet covers the stage, so the pad is cleared rather
  // than painted with controls nobody can reach.
  if (ui.game.cursor.phase === 'tally') {
    padEl.replaceChildren();
    padEl.onclick = null;
    return;
  }

  // Reserve the prompt band, plus the bottom safe area and the pad's padding;
  // the rest is the pad's to divide among its rows.
  const stageEl = document.getElementById('stage');
  const promptMin = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--prompt-h'),
    10
  ) || 80;
  const bottomPad = padEl.getBoundingClientRect().width > 0
    ? parseInt(getComputedStyle(padEl).paddingBottom, 10) || 0
    : 44;

  const phase = ui.game.cursor.phase;
  const asking = playerAt(ui.game, ui.game.cursor.seat);
  const announced = asking ? hand.entries[asking.id].bid : null;

  renderPad(padEl, {
    values: Array.from({ length: hand.dice + 1 }, (_, i) => i),
    legal: legalValues(ui.game),
    zeroLabel: null,
    onPick: pick,
    available: Math.max(120, stageEl.clientHeight - promptMin - bottomPad - 12),
    phase,
    // Ring the value this player bid, but only while asking what they took.
    highlight: phase === 'trick' && Number.isInteger(announced) ? announced : null,
  });
}

function renderSheet() {
  if (!ui.sheet) {
    sheetEl.hidden = true;
    sheetEl.replaceChildren();
    return;
  }

  let content = null;

  switch (ui.sheet) {
    case 'cabin':
      if (!ui.draft) ui.draft = draftCrew(4);
      content = renderCabin(ui.draft, {
        lang: lang(),
        resumable: hasResumableGame(),
        onChange: resizeDraft,
        onStart: startVoyage,
        onResume: () => {
          ui.game = loadGame();
          ui.sheet = ui.game && isFinished(ui.game) ? 'reckoning' : null;
          render();
        },
        onPickEmoji: (index) => openSheet('emoji', index),
        onShuffle: () => {
          ui.draft = draftCrew(ui.draft.length);
          render();
        },
        onSettings: () => openSheet('settings'),
      });
      break;

    case 'emoji':
      content = renderEmojiPicker(ui.draft, ui.sheetArg, {
        lang: lang(),
        onPick: (emoji) => {
          ui.draft[ui.sheetArg].emoji = emoji;
          openSheet('cabin');
        },
        onClose: () => openSheet('cabin'),
      });
      break;

    case 'tally': {
      const { element } = renderTally(ui.game, {
        lang: lang(),
        onBonus: (player) => openSheet('bonus', player.id),
        onEdit: reenter,
        onBook: book,
        onUndo: stepBack,
      });
      content = element;
      break;
    }

    case 'bonus': {
      const player = ui.game.players.find((p) => p.id === ui.sheetArg);
      content = renderBonus(ui.game, player, {
        lang: lang(),
        onChange: (patch) => {
          ui.game = setEntry(ui.game, player.seat, patch);
          persist();
          render();
        },
        onClose: () => openSheet('tally'),
      });
      break;
    }

    case 'reckoning':
      content = renderReckoning(ui.game, {
        lang: lang(),
        onAgain: () => {
          // Keep the crew: the same people almost always play again.
          ui.draft = ui.game.players.map((p) => ({ name: p.name, emoji: p.emoji }));
          ui.game = null;
          openSheet('cabin');
        },
        onHall: () => openSheet('hall'),
      });
      break;

    case 'hall':
      content = renderHall(loadHallOfFame(), {
        lang: lang(),
        onClose: () => openSheet(ui.game ? 'reckoning' : 'cabin'),
      });
      break;

    case 'settings':
      content = renderSettings(ui.settings, {
        lang: lang(),
        onLang: (code) => {
          ui.settings = { ...ui.settings, lang: code };
          saveSettings(ui.settings);
          document.documentElement.lang = code;
          render();
        },
        onRuleset: (id) => {
          ui.settings = { ...ui.settings, ruleset: id };
          saveSettings(ui.settings);
          // Applies to the game in progress too: totals are derived, so the
          // hands already played rescore immediately.
          if (ui.game) ui.game = { ...ui.game, ruleset: id };
          persist();
          render();
        },
        onReset: () => {
          clearGame();
          ui.game = null;
          ui.draft = null;
          openSheet('cabin');
        },
        onClose: () => openSheet('cabin'),
      });
      break;

    default:
      break;
  }

  sheetEl.replaceChildren(content);
  sheetEl.hidden = false;
}

/**
 * Tint the play surface with the active player's colour.
 *
 * This is the "whose turn is it" signal doing real work: the background itself
 * changes, so it is answerable from across the table and without reading.
 */
function paintActiveColor() {
  const root = document.getElementById('app');
  const active =
    ui.game && ui.game.cursor.phase !== 'tally'
      ? colorForSeat(ui.game.cursor.seat)
      : null;

  if (!active) {
    root.style.removeProperty('--active-wash');
    root.style.removeProperty('--active-base');
    root.style.removeProperty('--active-bright');
    root.removeAttribute('data-active-color');
    return;
  }
  root.style.setProperty('--active-wash', active.wash);
  root.style.setProperty('--active-base', active.base);
  root.style.setProperty('--active-bright', active.bright);
  root.dataset.activeColor = active.id;
}

function render() {
  paintActiveColor();
  if (ui.game) {
    const hand = currentHand(ui.game);
    renderRail(railEl, ui.game, {
      lang: lang(),
      tauntIndex: ui.tauntIndex,
      handLabel: hand
        ? t(lang(), 'play.round', { n: hand.n, m: ui.game.totalHands })
        : '',
      onPickSeat: reenter,
      // Tapping the round label is the explicit way back to the booking screen
      // once everything has been entered.
      onOpenTally: handIsComplete(ui.game) ? () => openSheet('tally') : null,
    });
    renderPrompt();
    renderStage();
  } else {
    railEl.replaceChildren();
    promptEl.replaceChildren();
    padEl.replaceChildren();
  }
  renderSheet();
}

// --- Boot ----------------------------------------------------------------

document.documentElement.lang = lang();

if (hasResumableGame()) {
  ui.game = loadGame();
  ui.sheet = ui.game ? null : 'cabin';
  if (ui.game && ui.game.cursor.phase === 'tally') ui.sheet = 'tally';
} else {
  ui.sheet = 'cabin';
}

// Sanity: a loaded game whose crew size no longer matches its hand count means
// the payload predates a rules fix. Better to start fresh than to play a game
// that ends at the wrong time.
if (ui.game && ui.game.totalHands !== handsFor(ui.game.players.length)) {
  ui.game = null;
  ui.sheet = 'cabin';
  clearGame();
}

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is a bonus; failing to register must not break play.
    });
  });
}
