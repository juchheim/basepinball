# M2 Report: Rules & Playable Game

Status as of 2026-10-10, branch `m2-rules`, stacked on `m1-whitebox`.

## Exit criteria

| Criterion ([07 § M2](07-roadmap-and-scope.md#m2-rules--playable-game)) | Status |
|---|---|
| Rules engine: state machine, base running, pitching director, rallies, Hot Bat, Steal, kickback, Rally Cap, tilt | ✅ [`src/rules/`](../../src/rules) |
| Basic HUD, game flow from title through the box score, local high scores | ✅ Title → play → pause → final box score → initials → high-score table |
| Headless sim bot and balance report | ✅ `npm run simbot -- 30 average` |
| All rules unit tests pass (every cell of the event-resolution table) | ✅ 24 rules tests + 7 pitch-fairness tests |
| A complete 9-inning game is playable on desktop and mobile | ✅ Played to the final out in the browser, high score saved. ⏳ Mobile check on a real phone. |
| Sim bot "average" profile within ±25 % of the tuning targets | ✅ Runs, hit rate, hit mix and rallies are on target. ❌ Drain-vs-fielder outs (open question below). |

## What's in it

- **Rules engine** (`src/rules/game.ts`): a pure, deterministic state machine. It takes physics
  switch events, flipper buttons and sim time, drives the table through a `Machine` interface (like
  coil drivers), and reports `RulesEvent`s for the HUD, lamps and later sound. It implements:
  - the at-bat state machine and the event-resolution table ([01 § 4.2–4.3](01-game-design.md))
  - base running by hit value
  - Hot Bat (B-A-T, skill shot, Rally Cap): +1 base on the next non-HR hit, carries across innings
  - Steal (R-U-N standups, then the right ramp): the lead runner advances; stealing home scores
  - kickback (relit by R-B-I) and the skill shot with flipper-button lane change
  - rallies and Rally Cap
  - tilt: 2 warnings, then flippers die and the PA is an out
  - ball search after 6 s and rescue with a re-pitch after 15 s, skipped while you cradle
- **Pitching director** (`src/rules/pitching.ts`): fastball, changeup and curveball, mixed by
  inning, each telegraphed by its mound lamp. The curveball breaks about 20 mm via a magnet pulse.
  **Every template is verified by physics simulation** to land mid-bat (25–75 %) without touching
  anything first, and to drain if you don't swing.
- **Game UI** (Preact, `src/ui/`):
  - HUD: inning, outs, base diamond, runs, hits, plus chips for Hot Bat, Steal, rally, the pitch
    type, tilt warnings and the skill-shot lane
  - outcome callouts ("DOUBLE!", "OUT! Caught by SS (6)", "SIDE RETIRED")
  - title, pause, final box score, initials entry and high-score table
- **Lamps** follow the rules: base inserts, Hot Bat and Steal (blinking at 2.5 Hz, under the 3 Hz
  photosensitivity cap), R-B-I lanes with a blinking skill lane, target letters, rally meter, and
  pitch-type lamps.
- **High scores** (`src/storage/highscores.ts`): top 10 in localStorage. Ranked by runs, then hits,
  then HRs, then date. Survives corrupt or unavailable storage.
- **Sim bot** (`src/sim/bot.ts`): plays full games with physics and rules at about 1 game per
  second. It predicts time-to-contact, flips with timing noise, and sometimes catches and cradles.

`?debug` gives the tuning panel, perf overlay and debug keys. `?table=m0` gives the M0 test table
in free play.

## Balance (30 games per profile)

| Metric | Target | Rookie | **Average** | Expert |
|---|---|---|---|---|
| Runs per game (median) | 3–5 (4) | 5.0 (5) | **4.7 (4)** | 3.6 (4) |
| Hit rate | ≈ 30 % | 30.3 % | **30.5 %** | 25.6 % |
| Hit mix 1B/2B/3B/HR | 55/25/8/12 | 54/22/6/18 | **54.5/23.9/8.1/13.5** | 52/23/8/17 |
| Drain outs / PA | ≤ 25 % | 57 % | **55 %** | 59 % |
| Fielder outs / PA | most common | 12 % | **14 %** | 15 % |
| Rally PAs | 15–25 % | 22.5 % | **25.6 %** | 20.7 % |
| PA per game | ≈ 40 | 38.7 | **38.9** | 36.3 |
| Sim game length | 8–12 min incl. presentation | 5.0 | **5.1** | 5.1 |
| Ball rescues per game | < 0.05 | 0 | **0** | 0 |

**A note on the bot "skill" profiles:** the bot does not aim. It reacts with more or less timing
noise. Less noise does not mean better results: the timing noise spreads its shots around, while
"perfect" timing repeats the same, often catchable, shot. So "expert" scores less. The **average**
profile is the balancing reference. A bot that aims from the cradle (using the M1 shot map) is a
possible M5 addition.

**Balance changes made in M2** (details in [02 § 10](02-playfield-design.md#10-m1-whitebox-changes-v11)):
- **Dead "glove" backstops:** fielder outs doubled.
- **Saucer skim speed** 1.6 m/s.
- **Triples need a clean orbit shot**, entered within 1 s of the swing. Slingshot ricochets
  previously made triples 25 % of hits.

## Open questions for you

1. **Drains vs fielder outs.** With every drain an out, drains are 55 % of plate appearances and
   fielder catches 14 %. The original target was "fielder outs most common". Options:
   - **(a) Accept it.** It's pinball: the drain is the big threat, and fielders punish missed shots.
   - **(b) Bigger, deader gloves.** Pushes fielder outs up, but also cuts hits, so we would rebalance
     elsewhere.
   - **(c) Lower outlane drains**, for example by keeping the kickback lit more often.

   My recommendation is **(a)** for now, then revisit after your playtest.
2. **Game length.** Bot games take about 5 sim minutes. Real players cradle, aim and pause, so
   human games will run longer. Your first few full games will tell us whether to add presentation
   time (celebrations, inning transitions) toward the 8–12 minute target.

## Try it

Run `npm run dev` or use the Vercel preview of this branch. Press **Enter** (or tap) to start.

- **Flippers:** Shift or ← →
- **Plunger:** hold ↓ or Enter, then release
- **Nudge:** Z, `/` and Space
- **Pause:** Esc or P

The leadoff of each inning is a plunge. Watch the HUD's skill-shot chip and change lanes with the
flippers before the ball arrives.
