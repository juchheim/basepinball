# 07 — Roadmap & Scope

## 1. MVP definition

> A single-player, 9-inning BasePinball game that plays in modern desktop and mobile browsers. It has
> realistic pinball physics, the baseball rules described in [01](01-game-design.md), the playfield
> in [02](02-playfield-design.md), night-game visuals with polished animation, full SFX and crowd
> audio, and local high scores. It is deployed as a static site on Vercel.

## 2. Feature priorities

**P0: must ship.** **P1: should ship** (cut only to protect the date or quality). **P2: post-MVP.**

| Area | P0 | P1 | P2 |
|------|----|----|----|
| Rules | 9 innings, outs (saucers + every drain), 4 hit types, base running by hit value, rallies, Hot Bat (B-A-T drops), kickback (R-B-I), tilt, ball search | STEAL (R-U-N → right ramp), skill shot, Rally Cap | Walks, sacrifice flies, double plays, full playable opponent half-innings, extra innings, combos |
| Pitching | Pitch delivery from the mound, FB/CH, fairness validation | Curveball magnet, difficulty curve by inning | Pitcher fatigue, closer in the 9th, named pitchers |
| Physics | Custom engine, every listed device (incl. drop targets, standups, spinners), feel suite passing, nudge | Golden replays in CI | Cross-engine determinism, multiball |
| Playfield | Full v1 shot-fan layout (orbits, two ramps, the Gap pop nest, drops, standups, 7 fielder saucers) tuned in whitebox | Lit-shot chasers | Upper-right flipper, captive ball, moving fielders ("defensive shift"), multiball |
| Visuals | PBR table, chrome ball with dynamic reflections, stadium diorama, lamps and bloom, quality tiers | Lights-on intro, attract mode camera, crowd animation | Raster art replacement pass, replays with free camera |
| Animation | Mechanical animations, fielder catch and throw, runners under glass, outcome callouts, HR celebration | Near-miss dives, 7th-inning stretch, pitcher windup detail | Cutscene-quality inning transitions |
| Audio | Mechanical SFX, ball roll, crowd bed + reactions, core organ stingers | Crowd intensity model, full stinger set | Announcer voice |
| Platforms | Desktop keyboard, mobile touch (portrait), auto-pause | Gamepad, landscape mobile layout, motion nudge | PWA install / offline, Steam/desktop wrapper |
| Meta | Local high scores (top 10), box score | Lifetime stats, settings (remap, reduced motion, HUD scale) | Global leaderboard (CF Workers + D1), daily challenge, achievements |
| Accessibility | Labelled hit types, flash cap, volume sliders | Reduced motion, remapping, large HUD | Practice slow-motion mode, Rookie mode |

## 2.1 Requested post-release feature: local Vs AI

The single-player wording above records the original v1 MVP and remains accurate for that release.
The requested post-release addition keeps **Single Player** and adds **Vs AI** to the initial
screen. In Vs AI, the human plays the normal pinball half-inning; after each human inning, the
opponent's baseball score for that inning is simulated locally. The player chooses Easy, Medium or
Hard. This is local play and requires no online opponent, account or backend. The opponent does not
play the pinball table, and this feature is distinct from implementing full head-to-head multiplayer
with alternating pinball half-innings.

The original MVP priorities and milestones below are historical scope; this addition is tracked as a
post-M6 enhancement rather than silently rewriting the released MVP. Its acceptance requires both
modes to be selectable from the initial screen, all three AI difficulties to affect opponent scoring,
and a complete nine-inning result to show both line scores and the winner (or a tie).

## 3. Milestones and exit criteria

Milestones are ordered by dependency. The schedule is set after M0, once physics risk is known.

### M0: Foundations & physics spike

- Repo setup (git init, Vite + TypeScript, lint, Vitest), Vercel project with preview deploys.
- Three.js renderer with the WebGPU → WebGL2 fallback checked on iOS Safari, Android Chrome and
  desktop.
- Physics core: ball, slope, walls, posts, rubbers, **two flippers**, one sling, one pop bumper, one
  fielder saucer, one drop target. Fixed 1 kHz loop with interpolation, timestamped input.
- Debug panel and physics visualiser.
- Rapier reference benchmark (flipper scenario only).
- **Exit:** physics suite tests 1–4 pass. The product owner and a pinball-literate tester sign off
  that cradle, post pass, live catch and drop catch feel right. Physics CPU is < 1 ms per frame on a
  mid-range phone. A **go / no-go decision on the custom engine** is recorded.

### M1: Whitebox table

> **Status:** built. Automated exit criteria pass; the feel review is pending. See the
> [M1 report](m1-report.md).

- The full v1 layout from `TableDef`: every device, both ramps, wireforms, orbits, spinners, drops,
  standups, mound VUK and pitch kicker, magnet, kickback, plunger, sensors.
- Grey materials. Simple lamps as colored discs.
- Layout exporter → SVG schematic.
- **Exit:** every shot in the [shot map](02-playfield-design.md#4-shot-map) is makeable. The saucer
  capture curve and ramp threshold tests pass. No stuck-ball hotspots in 30 minutes of play.

### M2: Rules & playable game

> **Status:** built. See the [M2 report](m2-report.md).

- Rules engine (state machine, base running, pitching director, rallies, Hot Bat, Steal, kickback,
  Rally Cap, tilt).
- Basic HUD (line score, outs, bases), game flow from title through the box score, local high scores.
- Headless **sim bot** and balance report.
- **Exit:** all rules unit tests pass (every cell of the event-resolution table). A complete
  9-inning greybox game is playable on desktop and mobile. The sim bot's "average" profile is
  within ±25 % of the [tuning targets](01-game-design.md#8-difficulty-and-tuning-targets).

### M3: Art pass + final name

> **Status:** first art pass built and named (Rally Ball, renamed **Steel Diamond** in M6); visual sign-off is pending.
> See the [M3 report](m3-report.md).

- **Final game name and identity are chosen during this milestone.** Name candidates are explored
  alongside the playfield and backboard art, and the name, logo and team identity are locked by
  the end of M3.
- Playfield SVG art and the slot pipeline (SVG → KTX2), standees, stadium diorama, materials, ball
  reflections, lighting, bloom and grading, quality tiers + adaptive controller.
- **Exit:** visual target review signed off by the product owner. Performance budgets are met on the
  device matrix.

### M4: Animation, FX & audio

> **Status:** built; listening and feel review pending. See the [M4 report](m4-report.md).

- Everything in the P0 animation catalog, the lamp show system, particles, the audio engine, the
  full SFX set, crowd and organ.
- **Exit:** every presentation event has visual and audio feedback. No presentation ever blocks a
  live ball. The flash-frequency check passes.

### M5: Mobile, polish & tuning

> **Status:** built; device checks and playtests pending. See the [M5 report](m5-report.md).

- Touch controls polish, landscape layouts, gamepad, settings, accessibility options, P1 features.
- Final balance tuning with playtest data. Load-time optimisation.
- **Exit:** acceptance criteria in § 5 pass.

### M6: Release

> **Status:** released as **1.0.0** (2026-10-11). Device QA and a professional trademark search are
> still open. See the [M6 report](m6-report.md).

- Browser and device QA matrix, error handling (context loss, storage failures), production deploy
  on Vercel, short "how to play" page.

## 4. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Physics feel falls short | Critical | M0 spike with a clear go/no-go gate. Deep tuning tooling. The feel suite runs on every change. Rapier fallback path. |
| Fielder saucers frustrate players (too many "cheap" outs) | High | Tune capture with emergent physics plus the sim bot. Keep saucers in the gaps between shots, not in shot paths. Each out callout shows its position ("6-3") so outs feel earned. Near-miss animations show how close the ball came. |
| Mobile GPU and thermal limits | High | Quality tiers, adaptive scaling, KTX2 textures, merged static geometry, no per-insert real lights |
| iOS Safari quirks (audio unlock, WebGPU maturity, viewport) | Medium | Test from M0. WebGL2 fallback forced in CI smoke tests. |
| Vector art looks flat next to "realistic" goals | Medium | Lean on materials, lighting, clear coat and bloom. The raster-override contract allows a later upgrade with no code change. |
| Rules unclear at pinball speed | Medium | Strong, immediate feedback (callouts, lamps, sounds). How-to-play screen. Playtest with non-pinball players. |
| Scope creep (baseball has endless rules) | Medium | P0/P1/P2 discipline. New rules go to P2 unless they fix a fun problem. |
| Unfair drains (every drain is an out) | High | Automated pitch validator. Drain-exit metrics for pops, slings and ramp and orbit returns (< 5 % straight down the middle). Kickback. Tuned inlane feeds. |
| Asset licensing | Low–Medium | CC0/OFL-only policy and the license manifest |

## 5. MVP acceptance criteria

1. A complete 9-inning game plays from the title screen to the high score table on: Chrome, Safari,
   Firefox and Edge desktop; iOS Safari; Android Chrome.
2. All of these are correct: outs (7 fielder saucers, every drain), strikeouts, foul outs, singles, doubles, triples,
   HRs, base running, run scoring, inning transitions, rallies, tilt. This is verified by unit tests
   and a manual checklist.
3. The physics feel suite passes. The pinball-skill feel targets (cradle, post pass, live catch, drop
   catch, tap pass) can be done on desktop and mobile.
4. At the Medium tier on a mid-range phone, 60 fps holds for ≥ 95 % of frames during play. Desktop at
   High holds ≥ 95 % at the display rate (60/120).
5. A median game for first-time players takes 6–9 minutes (playtest of at least 5 people).
   (Revised from 8–12 minutes in M6: short games suit pinball and phones.)
6. No stuck-ball soft locks in 50 consecutive sim-bot games. Ball search and rescue always recovers.
7. Local high scores and settings persist across reloads and fail safely in private mode.
8. The first playable download is < 15 MB (Medium), and time to interactive is < 5 s on fast 4G.
9. Every third-party asset is listed with a compatible license.

## Open questions

None open right now.

Resolved:

- Saucer catch before a re-swing: **not an out**. See [01 § 4.3](01-game-design.md#43-event-resolution-table).
- Hot Bat: +1 base on the next non-HR hit, carries across innings. See
  [01 § 4.8.1](01-game-design.md#481-hot-bat-in-detail).
- Rally Cap lights Hot Bat.
- The right ramp is the Steal ramp.
- Placeholder team: *the Tilt City Silverballs* of *Plunger Park*.
