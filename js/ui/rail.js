/**
 * The brass rail: every player's running total, always visible.
 *
 * Chips are ordered by SEAT and never re-sorted by rank. "Anna is the third
 * chip" is muscle memory worth more than showing the leader first, and a rail
 * that reorders itself mid-game makes people tap the wrong pirate.
 */

import { bonusEligible } from '../rules.js';
import { standings, totals, currentHand } from '../state.js';
import { t, taunt } from '../i18n.js';
import { colorForSeat } from '../palette.js';

const MEDAL_PIP = { gold: '\u{1F947}', silver: '\u{1F948}', bronze: '\u{1F949}' };

/** Chip markup for one player. Built fresh; the rail is small enough. */
function chip(game, player, rank, total, lang, shamed, tauntIndex, onPick) {
  // A button, not a div: tapping a pirate jumps straight to re-entering their
  // number, which is how you fix a mis-heard bid without undoing everyone after
  // them.
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'chip';
  el.dataset.seat = String(player.seat);
  if (onPick) el.onclick = () => onPick(player.seat);

  // The player's own colour. Same seat, same colour, every hand — this is how
  // you find your row without reading a name.
  const color = colorForSeat(player.seat);
  el.dataset.color = color.id;
  el.style.setProperty('--pc', color.base);
  el.style.setProperty('--pc-bright', color.bright);

  if (game.cursor.phase !== 'tally' && game.cursor.seat === player.seat) {
    el.classList.add('ask');
  }
  if (shamed) {
    el.classList.add('shame');
    // The taunt is the tooltip rather than visible text: at 6 players there is
    // no room, and the wobble already says it.
    el.title = taunt(lang, tauntIndex);
  }

  const em = document.createElement('div');
  em.className = 'em';
  em.textContent = player.emoji;
  el.append(em);

  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = player.name;
  el.append(nm);

  const pts = document.createElement('div');
  pts.className = 'total';
  pts.textContent = String(total);
  el.append(pts);

  el.append(callLine(game, player));

  if (rank.medal) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.textContent = MEDAL_PIP[rank.medal];
    pip.title = t(lang, `medal.${rank.medal}`);
    el.append(pip);
  }

  return el;
}

/**
 * The bud/stick line for the hand in progress.
 *
 * This is the addition to the prototyped design: without it, The Helm gives you
 * no way to see what anyone bid until the tally, so "wait, what did I bid?"
 * needed a hidden swipe. Four characters of rail solve it.
 */
function callLine(game, player) {
  const line = document.createElement('div');
  line.className = 'call';

  const hand = currentHand(game);
  if (!hand) return line;

  const entry = hand.entries[player.id];
  const bid = entry.bid;
  const tricks = entry.tricks;

  if (!Number.isInteger(bid)) {
    const dash = document.createElement('span');
    dash.className = 'pending';
    dash.textContent = '·';
    line.append(dash);
    return line;
  }

  const shown = document.createElement('span');
  if (Number.isInteger(tricks)) {
    shown.className = bid === tricks ? 'hit' : 'miss';
    shown.textContent = `${bid}·${tricks}`;
    if (bid === tricks && bonusEligible(entry)) {
      const extra = (entry.mermaid ? 1 : 0) + (entry.pirates > 0 ? 1 : 0);
      if (extra > 0) shown.textContent += '✦';
    }
  } else {
    shown.className = 'pending';
    shown.textContent = `${bid}·`;
  }
  line.append(shown);
  return line;
}

/**
 * Repaint the rail.
 *
 * `tauntIndex` rotates the shaming line so it changes between hands rather than
 * nagging with the same insult all game.
 */
export function renderRail(
  root,
  game,
  { lang, tauntIndex = 0, handLabel = '', onPickSeat = null, onOpenTally = null } = {}
) {
  const scores = totals(game);
  const ranked = standings(game);
  const byId = new Map(ranked.map((row) => [row.playerId, row]));

  // Shame the player who is BOTH last and negative. Being last with a positive
  // score is just losing; being negative is the thing worth ribbing about.
  const lowest = Math.min(...ranked.map((r) => r.total));
  const anyPlayed = game.hands.some((h) => h.committed);

  // Which hand we are on, in the header: it belongs with the standings rather
  // than with the question, because it is state, not a prompt.
  // A button only when there is somewhere to go: once the hand is fully entered,
  // this is the way back to the booking screen after a correction.
  const handLine = document.createElement(onOpenTally ? 'button' : 'div');
  handLine.className = 'rail-hand';
  handLine.textContent = handLabel;
  if (onOpenTally) {
    handLine.type = 'button';
    handLine.classList.add('ready');
    handLine.onclick = onOpenTally;
  }

  const chips = document.createElement('div');
  chips.className = 'rail-chips';
  chips.append(
    ...game.players.map((p) =>
      chip(
        game,
        p,
        byId.get(p.id) ?? { medal: null },
        scores[p.id],
        lang,
        anyPlayed && scores[p.id] < 0 && scores[p.id] === lowest,
        tauntIndex + p.seat,
        onPickSeat
      )
    )
  );

  root.className = `crew-${game.players.length}`;
  root.replaceChildren(handLine, chips);
}
