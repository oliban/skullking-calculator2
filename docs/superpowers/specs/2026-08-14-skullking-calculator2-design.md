# Skull King Poängräknare — iPhone-first rewrite

**Date:** 2026-08-14
**Status:** Approved design, ready for implementation planning
**Supersedes:** `../skullking-calculator` (the original)

## 1. What we are building

A score calculator for **Skull King: Das Würfelspiel** — a rewrite of an existing
working app, with a new iPhone-first UI, verified rules, and persistence.

The old app works and its scoring is essentially correct. This is not a rescue
mission; it is a UI replacement plus three small rule fixes plus two new
features.

### Goals

1. **iPhone-first.** One-handed use at a pub table, drinks in the way.
2. **The running score is visible at all times.** Never scrolled away, never
   behind a tap.
3. **Quick-tap number entry.** The old app used `<select>` dropdowns; those cost
   roughly 3–4 interactions per value. Tap-pads cost one.
4. **No scrolling to record a hand.** At 4 players and at 6. This is a hard
   constraint, not a preference.
5. **Cozy pirate.** Warm lantern-lit tavern — brass, worn wood, candlelight.
   Not grim, not skull-and-crossbones edgy.

### Non-goals

- Not a rules engine for the Skull King *card* game. Different product,
  different scoring, explicitly out of scope (see §2).
- No accounts, no server, no sync. Everything is local to the device.
- No live play assistance — this counts points, it does not referee tricks.

## 2. The game, and a correction worth recording

The physical game is **Skull King: Das Würfelspiel**, Schmidt Spiele article
**49316**, 2015, designed by Manfred Reindl. Multilingual DE/EN/FR/IT rulebook,
German lead. Dark blue box. Components: **36 dice**, 6 player screens, 1 cloth
bag, 1 score pad. **3–6 players.**

This is a *dice* game, not the Grandpa Beck's *card* game. During design, a
research pass mistakenly analysed the card game and produced confident,
wrong conclusions — parrot/chest/map suits, "14-capture" bonuses, mermaid worth
40, "always 10 rounds for 2–8 players". **None of that applies.** It is recorded
here only so nobody re-imports it later. If an implementer finds themselves
reading about card suits or Tigress or Loot, they are on the wrong product.

The rules below come from the official Schmidt Spiele rulebook PDF.

### 2.1 Structure

In hand *n*, each player blind-draws *n* dice from the shared bag and hides them
behind their screen. The hand is then *n* tricks long, so legal bids are `0..n`.
All dice return to the bag between hands.

Number of hands, printed verbatim in the rulebook under *Spielende*:

> "Das Spiel endet bei 3-4 Spielern nach 8 Durchgängen, bei 5 Spielern nach 7
> Durchgängen und bei 6 Spielern nach 6 Durchgängen."

| Players | Hands | Why |
|---|---|---|
| 3 | 8 | designer's ceiling (24 of 36 dice used) |
| 4 | 8 | designer's ceiling (32 of 36) |
| 5 | 7 | **forced** — hand 8 needs 5×8 = 40 > 36 |
| 6 | 6 | **forced** — hand 6 uses exactly 36; hand 7 needs 42 |
| 2 | 8 | **house rule** — not in the official rulebook |

The 5- and 6-player reductions are arithmetic necessities of the 36-dice bag.
The 8-hand ceiling at 3–4 players is a game-length choice, not a supply limit
(4 players could physically reach hand 9). Both are real printed rules.

7+ players is impossible: 7×6 = 42 > 36, and there are only 6 screens.

### 2.2 Scoring

Let `n` = hand number, `cardsDealt` = dice dealt this hand (= `n`), `b` = bid,
`t` = tricks won.

| Case | Score |
|---|---|
| `b > 0` and `t == b` | `+20 × b` |
| `t != b` and `b > 0` | `-10 × abs(t - b)` — direction irrelevant |
| `b == 0` and `t == 0` | `+10 × cardsDealt` |
| `b == 0` and `t > 0` | `-10 × cardsDealt`, **flat** |

The flat missed-nil penalty is the most commonly mis-implemented rule in every
Skull King calculator. The rulebook is explicit:

> "Macht ein Spieler die Ansage 'Keinen Stich' und erweist sie sich als falsch,
> ist es somit egal, ob er dann einen oder beispielsweise drei Stiche bekommt."

Bid 0 in hand 6 and take 3 tricks: **−60, not −180.** The old app gets this
right; do not "fix" it.

Rulebook worked examples, to be used verbatim as test cases:

- bid 3, made 3 → **+60**
- bid 5, won 1 (difference 4) → **−40**
- nil in hand 4, made → **+40**
- nil in hand 6, took 2 tricks → **−60**

### 2.3 Bonuses

Awarded **only when the bid was hit exactly**:

> "Allerdings ist dies nur möglich, wenn der Spieler es schafft, genau so viele
> Stiche zu bekommen, wie er angesagt hat."

| Bonus | Points | Cap per hand |
|---|---|---|
| Mermaid skull captures the Skull King's skull | **+50** | 1 (one Skull King die exists) |
| Skull King's skull captures a Pirate skull | **+30 each** | **3** (three Pirate dice exist) |

Additional constraints, derived from the components:

- A player needs `t > 0` to earn any capture bonus — you cannot capture in a
  trick you never won. A made *nil* therefore earns no bonus.
- The mermaid +50 is exclusive table-wide within a hand.
- The same player cannot take both the +50 and a +30 in one hand: if a Mermaid
  beat the Skull King, the Skull King did not win that trick.
- A special die only acts as its character when it rolls a **skull**; a white
  flag is worth 0. Drawing the Skull King die guarantees nothing.

**There is no gold-coin bonus.** The coins printed on the Skull King and Mermaid
skull faces are a visual marker that those dice *can* earn bonuses, nothing
more.

### 2.4 Official simplified variant — Landrattenwertung

Printed in the rulebook, offered as a toggle:

- Correct bid: `+20 × t`
- **Wrong bid: 0** (never negative)
- Correct nil: `+10 × cardsDealt`; missed nil: `-10 × cardsDealt`
- **No capture bonuses at all**

### 2.5 Fixes relative to the old app

| Rule | Old app | Correct |
|---|---|---|
| Pirate bonus cap | 5 | **3** — only three Pirate dice exist |
| Player range | 2–6 | 3–6 official; 2 kept, **labelled a house rule** |
| Mermaid + pirate in one hand | silently summed | soft warning (impossible in one trick) |
| Bonus on a made nil | allowed | blocked — requires `t > 0` |
| Landrattenwertung | absent | available as a toggle |

Verified **correct** in the old app and carried over unchanged: the four base
scoring cases including the flat missed-nil, the +50/+30 values, the exact-bid
bonus gate, and the 8/7/6 hand counts.

## 3. Architecture

Vanilla HTML/CSS/JS, ES modules loaded directly by Safari. No build step, no
framework, no dependencies. Deployable by copying the directory.

```
index.html
css/               theme.css, helm.css, screens.css
js/rules.js        pure scoring. no DOM, no globals, no imports
js/state.js        game state + transitions. no DOM
js/storage.js      localStorage: autosave + hall of fame
js/personas.js     pirate name/emoji pool, unique assignment
js/i18n.js         sv/en dictionaries
js/ui/rail.js      the brass score rail
js/ui/pad.js       the tap-pad
js/ui/tally.js     pre-commit review + bonus entry
js/ui/screens.js   cabin / helm / reckoning / hall of fame / settings
js/app.js          wiring
sw.js  manifest.webmanifest  icons/
tools/make-icons.sh
test/              node --test
```

`rules.js` and `state.js` must not touch the DOM. That boundary is what makes
the scoring testable, and the old app's scoring being right for four years is
evidence the boundary pays.

### 3.1 Module contracts

**`rules.js`** — pure, the whole rulebook:

```js
export const RULESETS = { standard, landratta }
export function handsFor(playerCount)            // → 8|7|6
export function cardsDealt(handNumber)           // → handNumber
export function scoreHand(entry, cardsDealt, ruleset)   // → number
export function bonusEligible(entry)             // → bool
export function validateHand(entries, cardsDealt)// → {ok, shortfall, warnings}
```

`scoreHand` takes `{bid, tricks, mermaid, pirates}`. Everything keys off
`cardsDealt`, never the hand index — free now, and it means a variable-length
variant is a data change rather than a rewrite.

**`state.js`** — transitions, no rendering:

```js
export function newGame({players, ruleset, lang})
export function setEntry(game, seat, field, value)
export function advance(game)  /  export function back(game)
export function commitHand(game)
export function undo(game)
export function totals(game)                     // → {playerId: number}
export function standings(game)                   // → ranked, tie-aware
```

### 3.2 Data model

```js
game = {
  id, createdAt, lang, ruleset,
  players: [{id, name, emoji, seat}],
  hands: [{
    n, cardsDealt, committed,
    entries: {playerId: {bid, tricks, mermaid, pirates, autoFilled}}
  }],
  cursor: {hand, phase, seat}     // phase: 'bid' | 'trick' | 'tally'
}
```

Hands are **append-only and store raw inputs only** — never computed scores.
Totals are always derived by summing `scoreHand` over committed hands.

This matters: it makes undo a cursor rewind instead of a points refund. The
prototype's worst bug was undo-from-finale double-counting, which is
structurally impossible when scores are derived.

Hall of fame is stored separately, keyed on the normalised (trimmed,
case-folded) pirate name:

```js
hallOfFame = {[nameKey]: {
  name, gamesPlayed, wins, bestGame, worstGame, bestHand, totalPoints, lastPlayed
}}
```

Name collisions **merge deliberately** — if two people both play as "Rödskägg"
on different nights, that is one running rivalry, which is the point of the
feature.

## 4. The Helm — UI

Chosen from three prototyped directions. A purpose-built input device rather
than a document: a fixed score rail welded to the top, a large tap-pad in the
thumb zone, nothing scrollable between them.

### 4.1 Layout

Fixed-height flex column, `height: 100dvh`, `overflow: hidden`. No scroll
gesture exists to trigger accidentally.

```
┌──────────────────────────────────┐
│ status bar / safe-area-inset-top │
├──────────────────────────────────┤
│ ▛▀▀ B R A S S   R A I L  ▀▀▀▜   │  fixed, ~112pt
│ ┌──────┐┌──────┐╔══════╗┌──────┐│  one chip per player
│ │🦜  🥇││🐙  🥉│║ 💀   ║│🦀 🪣 ││  ordered by SEAT
│ │  88  ││  41  ║║  72  ║│ −10  ││  total (odometer)
│ │ 3·3  ││ 2·1  ║║ —    ║│ 0·2  ││  bud·stick this hand
│ └──────┘└──────┘╚══▲═══╝└──────┘│
├──────────────────────────────────┤
│  ⚓ Omgång 4/8 · B U D      ⚙︎  │
│      Hur många stick tar du?     │
│   ⌐ senast: 🐙 bjöd 3 (tryck=ångra)
│  ╔══════╗╔══════╗╔══════╗╔═════╗│
│  ║  0   ║║  1   ║║  2   ║║  3  ║│  thumb zone
│  ╚══════╝╚══════╝╚══════╝╚═════╝│  ~46% of height
├──────────────────────────────────┤
│ home-indicator safe-area         │
└──────────────────────────────────┘
```

Rail chips are ordered by **seat, never by rank**, so positions never move —
"Anna is always the third chip" is muscle memory worth protecting. The chip for
the player currently being asked lifts and gains a lantern glow, so the rail
doubles as the turn indicator and the pad needs no name label.

**The `bud·stick` line is an addition to the prototype.** The Helm's one real
weakness was that mid-hand you could not see what anyone bid without an
undiscoverable swipe. A small second line on each chip closes that at the cost
of ~18pt of rail height, and makes "wait, what did I bid?" answerable without
leaving the pad.

### 4.2 Flow

Bid for the whole crew (auto-advance, one tap each) → tricks for the whole crew
→ tally → book the hand. Roughly **9 taps for a 4-player hand**, against ~24–32
with the old dropdowns.

- The last player's tricks auto-fill from the remainder, **visibly marked as
  auto**, with one-tap override. Silent auto-fill causes an argument exactly
  once per game; the marker is not optional.
- Undo steps back one entry. Long-press a rail chip to jump-edit that player.
- Illegal pad keys are inert, not hidden — the pad's shape stays stable.

### 4.3 Tap-pad sizing

Key count is `cardsDealt + 1`, so 2 keys in hand 1 up to 9 in hand 8. Rows and
key height are derived from the count and computed **synchronously** — the
prototype's pad overflowed on first paint because sizing waited for a
`requestAnimationFrame`. `overflow: hidden` as a backstop.

### 4.4 Bonus entry

An in-row overlay on the tally, never a full-screen modal, so the rail is never
covered. Mermaid is a toggle; pirates a 0–3 stepper. Both disabled when
`bonusEligible()` is false, with the reason shown rather than a dead control.

### 4.5 Screens

**Kajutan** (setup: crew size, personas) → **Rodret** (play) →
**Uppgörelsen** (reckoning: podium, voyage stats) → **Ärans planka** (hall of
fame). Settings as a sheet.

Only Rodret carries the no-scroll constraint. Hall of fame is a lookup list and
may scroll.

### 4.6 Cozy, concretely

Warm lantern palette — brass, worn plank, parchment, candle amber, wine for the
shame state. Type from fonts that ship with iOS (Copperplate / Baskerville /
Iowan Old Style stacks) with sensible fallbacks. Texture from CSS gradients and
inline SVG only.

Animation is transform/opacity only. Layered gradients plus blend modes on a
scrolling surface is a known iOS repaint trap; texture is painted once on fixed
pseudo-elements behind content. **If a real iPhone drops frames, the grain
overlay is the first thing cut** — the design must survive without it.

Medals 🥇🥈🥉 on the current top three, tie-aware. Negative or last place gets a
cozy shame state: barnacle-grey disc, a distinct pip, a slow wobble, and
rotating Swedish taunts in the spirit of the old app's "Usel är du!" — warm
ribbing, never cruel. **Players keep their own emoji when shamed**; replacing it
made shamed players indistinguishable in the prototype.

## 5. Persistence

Autosave to localStorage on every tap, not just every commit — a killed Safari
mid-hand must lose nothing. On load, an unfinished game offers to resume.

Hall of fame is written **once, at the reckoning**, never mid-game, so an
abandoned game does not pollute the stats.

Storage is versioned (`schemaVersion`) with a migration hook, and every read is
defensive: corrupt or unparseable state must start a fresh game rather than
break the app.

## 6. Internationalisation

Swedish and English, toggleable, persisted. Swedish is the default — the group
is Swedish and the pirate personas are the app's voice.

All user-visible strings live in `i18n.js`. The prototypes each leaked hardcoded
Swedish into chrome that ignored the language switch; the lint check is that no
`.js` file outside `i18n.js` and `personas.js` contains a non-ASCII string
literal. `<html lang>` tracks the selection.

Persona names are Swedish-flavoured in both languages — "Rödskägg" does not
become "Redbeard". They are names, not copy.

## 7. PWA

`manifest.webmanifest` (standalone, portrait, dark theme colour), icons at 180 /
192 / 512, and `apple-mobile-web-app-*` meta so Add to Home Screen opens
fullscreen without Safari chrome.

Service worker: cache-first for the app shell, since the app is fully offline by
nature. Cache name carries a version; activation clears old caches. The app must
work with the network off — that is the normal condition at a pub table.

Icons are generated from an SVG by `tools/make-icons.sh` so they are
reproducible rather than binary blobs of unknown origin.

## 8. Testing

`node --test`, zero dependencies.

**`rules.js` is developed test-first.** It is the part where being wrong is
invisible until game night, and it is where the old app's four-year correctness
came from.

- Scoring truth table across all four base cases
- The four rulebook worked examples verbatim (§2.2)
- The flat missed-nil rule, explicitly: nil in hand 6 taking 1, 2 and 3 tricks
  all score −60
- Bonus gating: only on exact hits; blocked when `tricks == 0`; pirates capped
  at 3
- Landrattenwertung: wrong bids score 0, no bonuses
- `handsFor`: 8/8/7/6 for 3/4/5/6, and the 2-player house rule
- `validateHand`: trick sums, shortfall reporting, the mermaid/pirate warning
- `state.js`: commit/undo round-trips to identical totals; totals always equal
  the sum of per-hand scores
- Hall of fame aggregation, including name-collision merging

UI is verified by hand on a real iPhone. The one thing worth automating is the
height budget — a headless check at 390×844 asserting that nothing in the entry
path scrolls or clips at 4, 5 and 6 players. Every prototype violated this in a
way arithmetic alone did not catch.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Vertical budget is tight at 6 players | Measured budget per crew size, enforced by an automated check, not by eye |
| Auto-advance is unforgiving when someone changes their bid mid-sequence | Undo, tappable ghost of the last entry, long-press-to-jump-edit |
| Auto-filled last trick can encode a number nobody claimed | Visible auto marker + one-tap override |
| iOS repaint jank from layered texture | Transform/opacity only; grain is the first cut |
| Small iPhones (SE, 13 mini) cannot hold the full layout | Degraded tier: shorter rail, smaller keys — explicitly a fallback, not a compromise to the main design |
| Rules regressions from the card game creeping back in | §2 records the wrong turn; rulebook examples are permanent tests |

## 10. Open, deliberately

- The 2-player house rule's hand count is assumed to be 8. Unverifiable — it is
  not an official mode.
- Whether the group wants Landrattenwertung surfaced or buried in settings.
  Defaulting to buried.
