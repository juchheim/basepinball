# Manual QA checklist

Acceptance criteria 1-3 ([07 § 5](07-roadmap-and-scope.md#5-mvp-acceptance-criteria)) need a
person at each browser and device. Run this list once per row of the matrix and note the result.

| Browser / device | Tester | Date | Result |
|---|---|---|---|
| Chrome desktop | | | |
| Safari desktop | | | |
| Firefox desktop | | | |
| Edge desktop | | | |
| iOS Safari (iPhone) | | | |
| Android Chrome | | | |

## 1. A whole game

- [ ] The title screen loads in under 5 s on a fast 4G connection, with the attract lamps and camera sway.
- [ ] Press Enter or tap: the lights come up, INNING 1 shows, and the ball is on the plunger.
- [ ] Play nine innings to FINAL, then the box score, then initials, then the high-score table, then back to the title.
- [ ] Reload: the high score and lifetime stats are still there.
- [ ] In a private or incognito window, a full game still plays. Nothing is remembered, and there are no errors.

## 2. Rules, each seen at least once

- [ ] **Fielder out:** the ball settles in each of the 7 saucers. The callout names the position, and the umpire signals.
- [ ] **Strikeout:** a pitch drains down the middle. You see K on the scoreboard, the umpire punches out, and the organ plays.
- [ ] **Foul out:** a drain within 2 s of an outlane.
- [ ] **Hits:**
  - [ ] Single and double: the Gap pops.
  - [ ] Triple: a clean orbit shot into the corner kicker.
  - [ ] Home run: the left ramp, then fireworks, the HR show and the roar.
- [ ] **Runners:**
  - [ ] Runners move by the hit value and cross home.
  - [ ] Runs show on the scoreboard and HUD.
- [ ] **Steal:**
  - [ ] Get a runner on, then shoot the right ramp: SAFE!
  - [ ] Spell W-A-L-K on the standup bank at the lower right: the batter walks to first, forced runners advance. The letters stay lit across innings.
  - [ ] An unlit right ramp spots a letter.
- [ ] **Hot Bat:** B-A-T all down, then the next hit gains a base.
- [ ] **Rally:** a re-flip after a hit continues, and the rally count climbs.
- [ ] **Tilt:**
  - [ ] Two warnings, then TILT.
  - [ ] The lamps die and the flippers stop.
  - [ ] The next PA is normal.
- [ ] **Inning change:** 3 outs, then SIDE RETIRED, the runners clear and the next inning starts.
- [ ] **7th-inning stretch:** the waltz plays and the crowd does the wave.

## 3. Feel and controls

- [ ] Cradle, post pass, live catch, drop catch and tap pass are all possible (see 03 § 10).
- [ ] **Keyboard:** the flippers respond instantly, nudge works, and too much nudging warns, then tilts.
- [ ] **Touch:**
  - [ ] Both flippers can be held at once.
  - [ ] Dragging the plunger knob sets the launch strength.
  - [ ] A flick near the top nudges.
  - [ ] The pause button works.
  - [ ] No page scroll or zoom.
- [ ] **Gamepad:**
  - [ ] Bumpers and triggers flip, A plunges, and the right stick pulls the plunger.
  - [ ] Start pauses, and a left-stick flick nudges.
  - [ ] Rumble works.
- [ ] **Pause:**
  - [ ] Esc, P, Start or the button pause the game.
  - [ ] Switching tabs or windows auto-pauses it.
  - [ ] Resume counts down 3-2-1.
- [ ] **Settings:**
  - [ ] The volume sliders and mute (M) work.
  - [ ] Quality changes take effect.
  - [ ] Large HUD.
  - [ ] Reduced motion: no shake, no sway, gentle shows.
  - [ ] A remapped key works and survives a reload.
- [ ] **Landscape (phone and desktop):** the HUD is on the side, the line score is top right, and the table is fully visible.
- [ ] **Frame rate:** 60 fps on a mid-range phone at Medium. Check with `?debug` for the readout.
