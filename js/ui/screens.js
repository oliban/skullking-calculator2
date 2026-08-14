/**
 * The sheets that are not the pad: cabin (setup), reckoning, hall of fame,
 * settings, emoji picker.
 *
 * Each returns an element the caller mounts into #sheet. All of them open below
 * the rail, so the totals stay visible.
 */

import { MAX_PLAYERS, MIN_PLAYERS, handsFor } from '../rules.js';
import { standings, totals } from '../state.js';
import { SELECTABLE_EMOJI, isEmojiTaken } from '../personas.js';
import { LANGS, t } from '../i18n.js';

function heading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function button(label, { className = 'btn', onClick } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  if (onClick) b.onclick = onClick;
  return b;
}

/**
 * Cabin: crew size, the crew themselves, and the button that starts the voyage.
 */
export function renderCabin(draft, {
  lang,
  resumable,
  onChange,
  onStart,
  onResume,
  onPickEmoji,
  onShuffle,
  onSettings,
}) {
  const wrap = document.createElement('div');
  wrap.append(heading(t(lang, 'screen.cabin')));

  if (resumable) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button(t(lang, 'cabin.resume'), { className: 'btn primary', onClick: onResume })
    );
    wrap.append(actions);
  }

  // Crew size stepper. Two big round taps beats a dropdown of six numbers.
  const stepper = document.createElement('div');
  stepper.className = 'stepper';
  stepper.append(
    button('−', {
      onClick: () => onChange(Math.max(MIN_PLAYERS, draft.length - 1)),
    })
  );
  // The count and its label are siblings: nesting the label inside the number
  // made the number's textContent unreadable to anything reading the DOM.
  const nWrap = document.createElement('div');
  const n = document.createElement('div');
  n.className = 'n';
  n.textContent = String(draft.length);
  const unit = document.createElement('div');
  unit.className = 'unit';
  unit.textContent = t(lang, 'cabin.crewSize');
  nWrap.append(n, unit);
  stepper.append(nWrap);
  stepper.append(
    button('+', {
      onClick: () => onChange(Math.min(MAX_PLAYERS, draft.length + 1)),
    })
  );
  wrap.append(stepper);

  // How long this crew plays, and why. The hand count is not obvious and is the
  // rule most people get wrong.
  const note = document.createElement('p');
  note.className = 'lede';
  note.textContent = t(lang, 'note.handCount', {
    hands: handsFor(draft.length),
    players: draft.length,
  });
  wrap.append(note);

  if (draft.length < 3) {
    const house = document.createElement('p');
    house.className = 'warn';
    house.textContent = t(lang, 'note.twoPlayer');
    wrap.append(house);
  }

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  draft.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'crew-row';

    const em = document.createElement('button');
    em.type = 'button';
    em.className = 'em';
    em.textContent = player.emoji;
    em.onclick = () => onPickEmoji(index);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = player.name;
    input.maxLength = 18;
    input.spellcheck = false;
    input.oninput = () => {
      player.name = input.value;
    };

    row.append(em, input);
    scroller.append(row);
  });
  wrap.append(scroller);

  const actions = document.createElement('div');
  actions.className = 'actions';
  // Settings live here and nowhere else: mid-hand there is nothing worth changing,
  // and a gear on the play screen is one more thing to hit by accident.
  actions.append(
    button('\u2699', { className: 'btn quiet cog', onClick: onSettings }),
    button(t(lang, 'cabin.shuffleCrew'), { className: 'btn quiet', onClick: onShuffle }),
    button(t(lang, 'cabin.startVoyage'), { className: 'btn primary', onClick: onStart })
  );
  wrap.append(actions);

  return wrap;
}

/** Emoji picker. A grid of taps; ones another pirate holds are greyed out. */
export function renderEmojiPicker(draft, index, { lang, onPick, onClose }) {
  const wrap = document.createElement('div');
  wrap.append(heading(draft[index].name));

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';

  // draft rows have no ids, so compare by index rather than by id.
  const others = draft.filter((_, i) => i !== index);
  for (const emoji of SELECTABLE_EMOJI) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    if (isEmojiTaken(others, emoji)) b.classList.add('taken');
    b.onclick = () => onPick(emoji);
    grid.append(b);
  }
  scroller.append(grid);
  wrap.append(scroller);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(button(t(lang, 'common.cancel'), { className: 'btn quiet', onClick: onClose }));
  wrap.append(actions);
  return wrap;
}

/** The reckoning: podium, the rest, and what to do next. */
export function renderReckoning(game, { lang, onAgain, onHall }) {
  const wrap = document.createElement('div');
  wrap.append(heading(t(lang, 'reckoning.title')));

  const ranked = standings(game);
  const byId = new Map(game.players.map((p) => [p.id, p]));
  const winners = ranked.filter((row) => row.rank === 1);

  const lede = document.createElement('p');
  lede.className = 'lede';
  lede.textContent =
    winners.length > 1
      ? t(lang, 'reckoning.winnerTie', {
          names: winners.map((w) => byId.get(w.playerId).name).join(', '),
        })
      : t(lang, 'reckoning.winner', {
          emoji: byId.get(winners[0].playerId).emoji,
          name: byId.get(winners[0].playerId).name,
        });
  wrap.append(lede);

  // Podium for the top three ranks, in 1-2-3 order.
  const podium = document.createElement('div');
  podium.className = 'podium';
  ranked.slice(0, 3).forEach((row, i) => {
    const player = byId.get(row.playerId);
    const place = document.createElement('div');
    place.className = `place p${i + 1}`;
    const em = document.createElement('div');
    em.className = 'em';
    em.textContent = player.emoji;
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = player.name;
    const pts = document.createElement('div');
    pts.className = 'pts';
    pts.textContent = String(row.total);
    place.append(em, nm, pts);
    podium.append(place);
  });
  wrap.append(podium);

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  for (const row of ranked.slice(3)) {
    const player = byId.get(row.playerId);
    const line = document.createElement('div');
    line.className = 'rest-row';
    const em = document.createElement('div');
    em.textContent = player.emoji;
    const nm = document.createElement('div');
    nm.textContent = player.name;
    const pts = document.createElement('div');
    pts.className = 'pts';
    pts.textContent = String(row.total);
    line.append(em, nm, pts);
    scroller.append(line);
  }
  wrap.append(scroller);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    button(t(lang, 'reckoning.toHall'), { className: 'btn quiet', onClick: onHall }),
    button(t(lang, 'reckoning.playAgain'), { className: 'btn primary', onClick: onAgain })
  );
  wrap.append(actions);
  return wrap;
}

/** Hall of fame, keyed on pirate name across all games ever played here. */
export function renderHall(hall, { lang, onClose }) {
  const wrap = document.createElement('div');
  wrap.append(heading(t(lang, 'hall.title')));

  const rows = Object.values(hall).sort(
    (a, b) => b.wins - a.wins || b.bestGame - a.bestGame
  );

  const scroller = document.createElement('div');
  scroller.className = 'scroller';

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t(lang, 'hall.empty');
    scroller.append(empty);
  } else {
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'hall-row';
      const nm = document.createElement('div');
      nm.textContent = row.name;
      const pts = document.createElement('div');
      pts.className = 'pts';
      pts.textContent = `${row.wins}×\u{1F947}`;
      const meta = document.createElement('div');
      meta.className = 'meta';
      // These keys are bare labels, so the value is appended rather than
      // interpolated.
      meta.textContent = [
        `${t(lang, 'hall.games')} ${row.gamesPlayed}`,
        `${t(lang, 'hall.best')} ${row.bestGame}`,
        `${t(lang, 'hall.worst')} ${row.worstGame}`,
      ].join(' · ');
      line.append(document.createElement('div'), nm, pts, meta);
      scroller.append(line);
    }
    const merged = document.createElement('p');
    merged.className = 'about';
    merged.textContent = t(lang, 'hall.mergedNames');
    scroller.append(merged);
  }

  wrap.append(scroller);
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(button(t(lang, 'common.back'), { className: 'btn', onClick: onClose }));
  wrap.append(actions);
  return wrap;
}

/** Settings: language, ruleset, and a way out of a stuck game. */
export function renderSettings(settings, { lang, onLang, onRuleset, onReset, onClose }) {
  const wrap = document.createElement('div');
  wrap.append(heading(t(lang, 'settings.title')));

  const scroller = document.createElement('div');
  scroller.className = 'scroller';

  const langBlock = document.createElement('div');
  langBlock.className = 'setting';
  const langLabel = document.createElement('span');
  langLabel.className = 'label';
  langLabel.textContent = t(lang, 'settings.language');
  const langSeg = document.createElement('div');
  langSeg.className = 'segmented';
  for (const code of LANGS) {
    const b = button(t(lang, `lang.${code}`), {
      className: `${settings.lang === code ? 'on' : ''}`,
      onClick: () => onLang(code),
    });
    langSeg.append(b);
  }
  langBlock.append(langLabel, langSeg);
  scroller.append(langBlock);

  const ruleBlock = document.createElement('div');
  ruleBlock.className = 'setting';
  const ruleLabel = document.createElement('span');
  ruleLabel.className = 'label';
  ruleLabel.textContent = t(lang, 'settings.ruleset');
  const ruleSeg = document.createElement('div');
  ruleSeg.className = 'segmented';
  for (const id of ['standard', 'landratta']) {
    ruleSeg.append(
      button(t(lang, `ruleset.${id}`), {
        className: `${settings.ruleset === id ? 'on' : ''}`,
        onClick: () => onRuleset(id),
      })
    );
  }
  const about = document.createElement('p');
  about.className = 'about';
  about.textContent = t(lang, `ruleset.${settings.ruleset}.about`);
  ruleBlock.append(ruleLabel, ruleSeg, about);
  scroller.append(ruleBlock);

  wrap.append(scroller);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    button(t(lang, 'settings.reset'), { className: 'btn quiet', onClick: onReset }),
    button(t(lang, 'common.back'), { className: 'btn primary', onClick: onClose })
  );
  wrap.append(actions);
  return wrap;
}
