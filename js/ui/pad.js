/**
 * The tap-pad. Quick-tap number entry — the thing that replaces the old app's
 * dropdowns, which cost 3-4 interactions per value against this pad's one.
 *
 * Sizing is SYNCHRONOUS. The prototype computed key height in a
 * requestAnimationFrame, so a wide hand rendered once at the fallback height and
 * clipped its top row before settling. Anything that decides layout must run
 * before the first paint, not after it.
 */

const MAX_ROWS = 3;

/**
 * Key height bounds.
 *
 * The cap matters more than it looks. Without it, a two-key hand on a tall phone
 * produced 600px keys: the pad swelled to fill the whole stage, which destroys
 * the reason it is welded to the bottom edge in the first place. Keys belong in
 * the thumb arc, and slack above them is correct, not wasted.
 *
 * The floor is Apple's comfortable-target guidance plus a little; below it,
 * thumbs miss at a pub table.
 */
export const MAX_KEY_H = 132;
export const MIN_KEY_H = 48;
/** Actions are read and pressed once, so they need less reach than numbers. */
export const MAX_ACTION_H = 76;

/**
 * Columns for a given number of value keys.
 *
 * Keeps keys as large as possible while never exceeding MAX_ROWS. Hand 8 is the
 * widest case in this game: 9 value keys, which is 4 columns and 3 rows.
 */
export function padColumns(keyCount) {
  for (const cols of [3, 4, 5, 6]) {
    if (Math.ceil(keyCount / cols) <= MAX_ROWS) return cols;
  }
  return 6;
}

/**
 * Key height for the available box, bounded by MIN_KEY_H and `max`.
 *
 * Returned rather than assigned so the caller can set it before appending —
 * see the note about synchronous sizing above.
 */
export function keyHeight(availablePx, rows, gapPx = 10, max = MAX_KEY_H) {
  const usable = availablePx - gapPx * (rows - 1);
  return Math.min(max, Math.max(MIN_KEY_H, Math.floor(usable / rows)));
}

function valueKey(value, { dead, span, isZero, zeroLabel, target }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'key';
  btn.dataset.value = String(value);
  if (dead) btn.classList.add('dead');
  if (isZero) btn.classList.add('zero');
  // The value this player bid. Ringing it turns "what did I say again?" into a
  // glance, and makes the common case (you made your bid) a single obvious tap.
  if (target) btn.classList.add('target');
  if (span > 1) btn.classList.add(`span-${Math.min(span, 4)}`);
  if (dead) btn.disabled = true;

  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = String(value);
  btn.append(lbl);

  if (isZero && zeroLabel) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = zeroLabel;
    btn.append(sub);
  }
  return btn;
}

/**
 * Paint the pad.
 *
 * `values` are every value the hand allows; `legal` are the ones tappable right
 * now. Illegal keys are rendered inert rather than removed, so the pad keeps its
 * shape as a hand fills up and muscle memory keeps working.
 */
export function renderPad(root, {
  values,
  legal,
  zeroLabel,
  onPick,
  available,
  phase = 'bid',
  highlight = null,
}) {
  const cols = padColumns(values.length);
  const rows = Math.ceil(values.length / cols);
  const gap = 10;

  root.style.setProperty('--pad-cols', String(cols));
  // Drives the phase-specific styling: asking what you WILL take and what you
  // DID take must not look like the same screen, or people answer the wrong one.
  root.dataset.phase = phase;

  // The pad is sized to its content and anchored to the bottom, rather than
  // stretched to fill. Filling left a dead zone of several hundred pixels
  // between the question and the keys, which reads as an unfinished screen;
  // now that slack belongs to the prompt, which centres in it.
  const box = available ?? root.clientHeight ?? 0;
  if (box > 0) {
    const h = keyHeight(box, rows, gap);
    root.style.setProperty('--key-h', `${h}px`);
    root.style.height = `${rows * h + (rows - 1) * gap}px`;
  }

  const legalSet = new Set(legal);
  const remainder = values.length % cols;
  const keys = values.map((value, i) => {
    // The final key stretches across any leftover columns so the grid has no
    // hole. The prototype filled that hole with a phase-jumping shortcut key,
    // which was reachable mid-bid and could strand the hand.
    const isLast = i === values.length - 1;
    const span = isLast && remainder !== 0 ? cols - remainder + 1 : 1;
    return valueKey(value, {
      dead: !legalSet.has(value),
      span,
      isZero: value === 0,
      zeroLabel,
      target: highlight !== null && value === highlight,
    });
  });

  root.replaceChildren(...keys);

  // Touch devices fire :active unreliably (and drop it during scroll-intent
  // detection), so the pressed state is driven explicitly. This is what makes a
  // tap feel like it landed rather than like it might have.
  root.onpointerdown = (event) => {
    const key = event.target.closest('.key');
    if (key && !key.classList.contains('dead')) key.classList.add('press');
  };
  const release = (event) => {
    const key = event.target.closest?.('.key');
    if (key) key.classList.remove('press');
    else for (const k of root.querySelectorAll('.press')) k.classList.remove('press');
  };
  root.onpointerup = release;
  root.onpointercancel = release;
  root.onpointerleave = release;

  root.onclick = (event) => {
    const key = event.target.closest('.key');
    if (!key || key.classList.contains('dead')) return;
    // A key with no value is an action button, not a number. This guard matters
    // because committing a hand re-renders the pad DURING the click: the same
    // event then bubbles into this freshly-attached handler, and the target is
    // the now-detached action button. Without the check that became
    // `onPick(Number(undefined))` -> NaN, which silently wrote NaN into the next
    // hand's first bid and skipped that player's turn.
    const raw = key.dataset.value;
    if (raw === undefined) return;
    onPick(Number(raw));
  };
}

/** Paint a row of action keys instead of numbers (used by the tally). */
export function renderActions(root, actions) {
  root.style.setProperty('--pad-cols', String(Math.min(actions.length, 2)));
  const box = root.clientHeight || root.getBoundingClientRect().height;
  const rows = Math.ceil(actions.length / Math.min(actions.length, 2));
  if (box > 0) {
    root.style.setProperty(
      '--key-h',
      `${keyHeight(box - 16, rows, 10, MAX_ACTION_H)}px`
    );
  }

  root.replaceChildren(
    ...actions.map((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `key act${action.primary ? ' book' : ''}`;
      btn.textContent = action.label;
      btn.onclick = (event) => {
        // Keep the click out of the pad's number handler, which may be
        // re-attached by the re-render this action triggers.
        event.stopPropagation();
        action.onPick();
      };
      if (action.disabled) {
        btn.classList.add('dead');
        btn.disabled = true;
      }
      return btn;
    })
  );
  root.onclick = null;
}
