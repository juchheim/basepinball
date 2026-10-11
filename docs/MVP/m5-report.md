# M5 Report: Mobile, Polish & Tuning

Status as of 2026-10-11, branch `m5-polish`, stacked on `m4-fx`.

## What's new

**Settings** (title screen or pause menu → Settings), saved in `localStorage`:
- **Sound:** sliders for master, machine, crowd and organ, plus mute (also the **M** key)
- **Display:**
  - quality: Auto (the adaptive controller) or a fixed Low, Medium, High or Ultra
  - HUD size: Normal or Large
  - reduced motion: System, On or Off. On means no camera shake, no attract sway, gentle lamp
    shows and a single firework.
- **Controls:**
  - key remapping: click an action, press a key (Esc cancels). A key bound to one action is taken
    off any other. There's a "Reset keys" button.
  - vibration on or off
  - "Shake phone to nudge" (asks for motion permission on iOS)
- **Storage:** damaged or partial data keeps what is valid. Private mode or a full quota fall back
  to defaults without errors.

**Touch:**
- **Plunger:** drag the knob (lower-right corner) down to set the launch strength, then let go.
  Holding it without dragging still pulls back all the way, as before.
- **Nudge:** a quick flick in the top 30 % of the screen nudges the table that way. The design's
  two-finger flick is impractical while both thumbs hold flippers.
- **Pause:** an on-screen button, top right (top left in landscape, clear of the plunger).

**Gamepad** (standard mapping):
- **Buttons:** LB/LT and RB/RT flip, A plunges, Start pauses.
- **Sticks:** pulling the right stick down sets the plunger pull (let go to launch); a flick of the
  left stick nudges.
- **Rumble:** on flips, pops and slings, outs and hits (harder for a home run).
- **Phone vibration (Android):** on flips and outs.

**Pause:**
- **Resume countdown:** resuming counts 3-2-1 before the physics restarts.
- **Auto-pause:** the game pauses when the window loses focus, as well as when the tab is hidden.
  Held flippers are released.

**Landscape layout:** the HUD becomes a side panel left of the table. The full line score (1-9,
R, H) appears top right, as on the ballpark board.

**Lifetime stats** (P1): games played, best game, total home runs, batting average and longest
rally. They show on the title and high-score screens and are saved per device.

**P1 polish:**
- **Attract mode:** the camera sways slowly round the table under the attract lamp show.
- **Lights-on intro:** at game start the camera settles into the player view as the towers and key
  lights come up.
- **7th-inning stretch:** the crowd does the wave across the stands, with the organ waltz.

**Load time:** the debug tuning panel (Tweakpane) now loads only with `?debug`. That takes 151 KB
(31 KB compressed) off every player's download.

**Physics:** the plunger can be held part-way (`setPlungerPull`). It eases toward the target at the
normal pull rate.

## Acceptance criteria ([07 § 5](07-roadmap-and-scope.md#5-mvp-acceptance-criteria))

| # | Criterion | Status |
|---|---|---|
| 1 | A full 9-inning game on Chrome, Safari, Firefox and Edge desktop, iOS Safari, Android Chrome | ⏳ Chrome desktop and a phone-sized viewport checked here. The rest need devices: [QA checklist](qa-checklist.md). |
| 2 | Rules correct (outs, K, foul outs, hits, base running, runs, innings, rallies, tilt) | ✅ Unit tests (34 rules tests and the sim bot). ⏳ The manual pass in the QA checklist. |
| 3 | Physics feel suite passes; feel targets doable on desktop and mobile | ✅ The suite passes. ⏳ Feel targets on a phone. |
| 4 | 60 fps for ≥ 95 % of frames: Medium on a mid-range phone, High on desktop | ✅ Desktop (WebGPU, High): 60 fps with M4 effects running. ⏳ A real mid-range phone. |
| 5 | A median first-time game takes 8-12 minutes (≥ 5 playtesters) | ⚠️ See "Needs you". The sim bot plays a game in 5.4-5.7 minutes of game time, including all pauses (routes, windup, inning breaks). |
| 6 | No stuck-ball soft locks in 50 consecutive sim-bot games; ball search and rescue always recover | ✅ 50/50 games (average bot) and 50/50 (rookie bot), 0 rescues needed. The rescue fallback is tested on its own. |
| 7 | High scores and settings persist and fail safely in private mode | ✅ `tests/storage/*` covers a round trip, damaged data and throwing storage, for settings, lifetime stats and high scores. |
| 8 | First playable download < 15 MB (Medium); time to interactive < 5 s on fast 4G | ✅ Medium downloads about 1.7 MB (about 0.86 MB compressed): JS 1.11 MB (317 KB gz), 2048 px playfield 329 KB, standees 56 KB, font 88 KB. That is about 1 s at 9 Mbps, plus renderer start-up. ⏳ Measure on a real 4G phone. |
| 9 | Every third-party asset listed with a compatible license | ✅ [assets-src/LICENSES.md](../../assets-src/LICENSES.md). The Oswald OFL text now ships next to the font. |

## Not done in M5

- **Lit-shot chasers** (P1 playfield): lit shots still blink their single arrow. A true chaser
  needs extra arrow inserts on the playfield art.
- **Balance tuning from playtest data:** there is no playtest data yet (criterion 5).
- **Device-only checks:** real-phone frame rate, touch feel and iOS motion permission, the QA
  checklist rows, and real 4G load time.

## Needs you

1. **Game length (criterion 5).** Sim-bot games are about 5.5 minutes of game time. Human games
   will run longer (plunging, reading the windup, pausing), but probably not 8-12 minutes. Options:
   - **Accept a shorter game.** Change the target to about 6-9 minutes. Pinball games are short,
     and this suits mobile.
   - **Lengthen innings without changing the rules feel.** For example, slightly lower drain-out
     odds via outlane and inlane tuning, so more PAs per game.
   - **Wait for playtests.** Measure 5+ first-time players before deciding.
2. **Devices:** run the [QA checklist](qa-checklist.md) on an iPhone and an Android phone. In
   particular, check touch feel, the drag plunger, the flick nudge, and frame rate at Medium.
3. **Settings review:** are the options and wording right?
