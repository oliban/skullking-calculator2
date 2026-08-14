/**
 * The tally: the whole hand at a glance before it is booked, plus bonus entry.
 *
 * This is where The Helm answers "who bid what?" in full. It opens below the
 * rail, so the running totals stay on screen the entire time.
 */

import {
  MAX_PIRATES,
  MERMAID_BONUS,
  PIRATE_BONUS,
  bonusEligible,
  scoreHand,
  validateHand,
} from '../rules.js';
import { currentHand, entriesInSeatOrder, rulesetOf } from '../state.js';
import { t } from '../i18n.js';

/** One pirate's line: emoji, name, bud·stick, points, and a bonus button. */
function tallyRow(game, player, { lang, onBonus }) {
  const hand = currentHand(game);
  const entry = hand.entries[player.id];
  const ruleset = rulesetOf(game);
  const points = scoreHand(entry, hand.dice, ruleset);

  const row = document.createElement('div');
  row.className = 'tally-row';

  const em = document.createElement('div');
  em.className = 'em';
  em.textContent = player.emoji;

  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = player.name;

  const call = document.createElement('div');
  call.className = 'call';
  call.textContent = `${entry.bid ?? '·'} · ${entry.tricks ?? '·'}`;

  const pts = document.createElement('div');
  pts.className = `pts ${points > 0 ? 'up' : points < 0 ? 'down' : ''}`;
  pts.textContent = points > 0 ? `+${points}` : String(points);

  row.append(em, nm, call, pts);

  // Bonus UI is silent until there is something to say.
  //
  // Nothing is printed for a row with no bonus — no "no bonuses" line, no
  // explanation of why a row is ineligible. Eligible rows get a small "+" mark
  // to tap; rows that HAVE a bonus print it. Anything else is noise on a screen
  // where the crew list has to fit six players without scrolling.
  if (!ruleset.bonuses || !bonusEligible(entry)) return row;

  const claimed = (entry.mermaid ? MERMAID_BONUS : 0) + entry.pirates * PIRATE_BONUS;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = claimed > 0 ? 'bonus-badge on' : 'bonus-badge';
  btn.textContent = claimed > 0 ? `+${claimed}` : '+';
  btn.title = t(lang, 'bonus.title');
  btn.setAttribute('aria-label', t(lang, 'bonus.title'));
  btn.onclick = () => onBonus(player);
  row.append(btn);

  return row;
}

/**
 * The tally sheet. Returns the element; the caller mounts it.
 *
 * The commit and undo buttons live IN HERE, not on the pad. The sheet covers the
 * stage, so a pad button underneath it is invisible and untappable — which the
 * first version got wrong and synthetic clicks happily hid.
 */
export function renderTally(game, { lang, onBonus, onEdit, onBook, onUndo }) {
  const hand = currentHand(game);
  const check = validateHand(entriesInSeatOrder(game, hand), hand.dice);

  const wrap = document.createElement('div');

  const title = document.createElement('h2');
  title.textContent = t(lang, 'play.tally');
  wrap.append(title);

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  for (const player of game.players) {
    const row = tallyRow(game, player, { lang, onBonus });
    // Tapping a row's numbers jumps back to editing that player, so a correction
    // does not mean undoing everyone after them.
    row.querySelector('.call').onclick = () => onEdit(player.seat);
    scroller.append(row);
  }
  wrap.append(scroller);

  if (!check.ok && check.complete) {
    const note = document.createElement('p');
    note.className = 'shortfall';
    note.textContent =
      check.shortfall > 0
        ? t(lang, 'validate.shortfall', { missing: check.shortfall })
        : t(lang, 'validate.surplus', { extra: -check.shortfall });
    wrap.append(note);
  }

  for (const warning of check.warnings) {
    const box = document.createElement('p');
    box.className = 'warn';
    const who =
      warning.seat === null ? '' : `${game.players[warning.seat].name}: `;
    box.textContent = who + t(lang, `warning.${warning.code}`, warning);
    wrap.append(box);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'btn quiet';
  undoBtn.textContent = t(lang, 'play.undo');
  undoBtn.onclick = onUndo;

  const bookBtn = document.createElement('button');
  bookBtn.type = 'button';
  bookBtn.className = 'btn primary';
  bookBtn.textContent = t(lang, 'play.book');
  bookBtn.disabled = !check.ok;
  bookBtn.onclick = onBook;

  actions.append(undoBtn, bookBtn);
  wrap.append(actions);

  return { element: wrap, check };
}

/** Bonus entry for one pirate: a toggle and a 0-3 stepper. */
export function renderBonus(game, player, { lang, onChange, onClose }) {
  const hand = currentHand(game);
  const entry = hand.entries[player.id];

  const wrap = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = `${player.emoji} ${player.name}`;
  wrap.append(title);

  const lede = document.createElement('p');
  lede.className = 'lede';
  lede.textContent = t(lang, 'bonus.title');
  wrap.append(lede);

  const scroller = document.createElement('div');
  scroller.className = 'scroller';

  // Mermaid takes the Skull King: one toggle. Only one Skull King die exists, so
  // this can happen at most once in a hand, table-wide.
  const mermaid = document.createElement('div');
  mermaid.className = 'bonus-line';
  const mWhat = document.createElement('div');
  mWhat.className = 'what';
  mWhat.textContent = t(lang, 'bonus.mermaid');
  const mPts = document.createElement('div');
  mPts.className = 'pts';
  mPts.textContent = `+${MERMAID_BONUS}`;
  const mBtn = document.createElement('button');
  mBtn.type = 'button';
  mBtn.className = `toggle${entry.mermaid ? ' on' : ''}`;
  mBtn.textContent = entry.mermaid ? '✓' : ' ';
  mBtn.onclick = () => onChange({ mermaid: !entry.mermaid });
  mermaid.append(mWhat, mPts, mBtn);
  scroller.append(mermaid);

  // Skull King takes pirates: 0-3, because the box holds three Pirate dice.
  const pirates = document.createElement('div');
  pirates.className = 'bonus-line';
  const pWhat = document.createElement('div');
  pWhat.className = 'what';
  pWhat.textContent = t(lang, 'bonus.pirate');
  const pSub = document.createElement('small');
  pSub.textContent = t(lang, 'bonus.pirateCount', { count: MAX_PIRATES });
  pWhat.append(pSub);

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'step';
  minus.textContent = '−';
  minus.onclick = () =>
    onChange({ pirates: Math.max(0, entry.pirates - 1) });

  const count = document.createElement('div');
  count.className = 'count';
  count.textContent = String(entry.pirates);

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'step';
  plus.textContent = '+';
  plus.onclick = () =>
    onChange({ pirates: Math.min(MAX_PIRATES, entry.pirates + 1) });

  pirates.append(pWhat, minus, count, plus);
  scroller.append(pirates);
  wrap.append(scroller);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn primary';
  done.textContent = t(lang, 'common.ok');
  done.onclick = onClose;
  actions.append(done);
  wrap.append(actions);

  return wrap;
}
