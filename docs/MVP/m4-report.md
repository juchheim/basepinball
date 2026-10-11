# M4 Report: Animation, FX & Audio

Status as of 2026-10-11, branch `m4-fx`, stacked on `m3-art`.

## Exit criteria

| Criterion ([07 § M4](07-roadmap-and-scope.md#m4-animation-fx--audio)) | Status |
|---|---|
| Every presentation event has visual and audio feedback | ✅ Enforced by `tests/fx/director.test.ts`. Every rules event type, every playfield switch, and the flipper and nudge buttons are covered. A new event type fails to compile until it is presented. |
| No presentation ever blocks a live ball | ✅ The director only reads the game. Celebrations run alongside play, and the rules and physics never wait on them. |
| Flash-frequency check passes | ✅ `tests/fx/lampShows.test.ts` checks every lamp show: no lamp flashes more than 3 times in any one-second window (WCAG 2.3.1). |
| Listening and feel review by you | ⏳ |

## What's new

**The presentation director** (`src/fx/director.ts`) turns these inputs into all the presentation:
- physics switches
- ball impacts
- rules events
- button presses

It plays sound, lamp shows, figure animation, particles, crowd and scoreboard reactions, and camera
shake. Its outputs go through one interface, so tests can check coverage.

**Audio** (`src/audio/`): Web Audio, all synthesised (see [06 § 3.1](06-audio.md#31-as-built-m4)).

- **Engine:**
  - buses for master, mechanical, stadium, music and UI, with a soft limiter
  - a 24-voice limit with per-sound caps (e.g. 3 pops at once); mechanical sounds win when busy
  - stereo pan from the ball's x position, and a quieter, duller sound toward the top of the table
  - the crowd dips (ducks) under organ stingers
  - pause fades out over 150 ms and suspends the AudioContext
  - **M** mutes; volumes are saved
- **Mechanical sounds:**
  - flipper up and down (played from the button press, for no added latency)
  - slings, three pop-bumper voices, kickers, drop targets and their reset, standups
  - spinner ticks, saucer catch, pitch release, the curveball magnet hum
  - drain rattle, plunger, kickback, ramp gates, rollovers, nudge, tilt buzz, ball-search coil pulses
- **Ball sounds:**
  - impacts by material: metal and wire ping, wood knock, plastic tick, glass tink, rubber thud, landings
  - a continuous rolling sound that crossfades between playfield, plastic ramp and wireform
- **Crowd:**
  - a murmur bed driven by an intensity level (runners in scoring position, rally, late innings, two outs)
  - cheers scaled by hit type, the home-run roar with whistles and applause, groans, an "ooh" when
    the ball heads down an outlane, rally clapping
- **Organ:** a tonewheel-style synth with percussion and tremolo. Original stingers:
  - inning start, rally riff, home-run fanfare, strikeout, side retired
  - 7th-inning stretch waltz, game over, high score

**Lamp shows** (`src/fx/lampShows.ts`) are data: chase, pulse, fill and solid patterns on lamp
groups, layered over the rules' lamps by priority.
- **Shows:** game start (lights on), hit, home run, steal, rally, Hot Bat, skill shot, strikeout,
  side retired, tilt (the lamps die), game over, and an attract-mode loop on the title screen.
- **Reduced motion** (`prefers-reduced-motion`) swaps every show for a single gentle sweep. It also
  turns off camera shake and cuts the fireworks to one.

**Mechanical animation** (springs with a solenoid-like snap, overshoot and settle):
- pop rings pull down
- sling rubbers kick out
- kicker faces flex
- standups rock back
- drop targets snap down with a bounce and pop back up past level on reset

**Figures** (`src/render/figures.ts`): standees on spring rigs, leaned back slightly so they read from the camera.
- **Pitcher:** winds up during the 1.5 s windup (rocks back, coils) and whips forward on release.
- **Fielders:**
  - **on a catch:** snap up with a dirt or grass puff, then throw back to the mound; a glowing ball
    streak arcs to the pitcher
  - **near miss:** a fast ball skimming within 15 mm of the rim makes them dive toward it
  - **on a home run:** they hop
- **Catcher and umpire** stand on the apron:
  - strikeout: the umpire punches out and the catcher's mitt pops
  - foul out and fielder outs: the umpire signals
  - steals: the umpire calls it safe
- **Runners:**
  - they sprint the basepaths in the glass channels with a bobbing run cycle, about 0.4 s a base
  - crossing home sets off a gold plate burst
  - steals move the lead runner; at the end of an inning they shrink away
  - they resync to the rules' bases whenever nobody is running

**Stadium:**
- **Fireworks** burst over the stands either side of the scoreboard: 5 for a home run, and 2 plus the
  runs scored (up to 12) at game over.
- **The LED scoreboard** shows big messages:
  - INNING n
  - HOME RUN
  - TRIPLE!
  - K
  - FOUL OUT
  - SAFE!
  - SKILL SHOT
  - FINAL
- **The crowd** bounces with excitement.
- **The light towers** warm up with a flicker and a relay clunk at game start (the key lights rise
  with them). They sit dimmed in attract mode.

**Camera:** a small shake on nudges, tilt warnings and the kickback. There are no other camera moves.

## Simplified or deferred (vs the 05 § 9 catalog)

| Catalog item | M4 | Plan |
|---|---|---|
| HR flag on the scoreboard roof | "HOME RUN" on the scoreboard, plus fireworks and the lamp show | Add if wanted |
| Cinematic camera accents (HR push-in, inning sweep, attract orbit, lights-on flyover) | Not built. Only the nudge shake. | M5 polish, behind reduced motion |
| Rally crowd cards, 7th-inning crowd wave | The crowd bounces; the stretch has its own organ waltz | M5 |
| Runner slides and steal dirt spray | Runners sprint and bob, with no slide | M5 |
| Spinner motion blur, flipper rubber flex, sling vertex bend | The sling rubber moves as a whole | M5 if visible at play distance |
| Volume sliders | M mutes; volumes are saved but there is no settings screen | M5 (settings) |
| Recorded samples | All synthesised | Replace individual recipes with CC0 samples if listening review asks |

## Needs you

1. **Listen** with sound on. In particular:
   - Is the mix right: flippers vs crowd vs organ?
   - Do any sounds feel fake enough to want a recorded sample instead?
   - Do the organ stingers feel like a ballpark?
2. **Watch** a few innings: are the figures and the shows fun or distracting?
