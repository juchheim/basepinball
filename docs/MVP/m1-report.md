# M1 Report: Whitebox Table

Status as of 2026-10-10, branch `m1-whitebox`, stacked on `m0-foundations`.

## Exit criteria

| Criterion ([07 § M1](07-roadmap-and-scope.md#m1-whitebox-table)) | Status |
|---|---|
| Full v1 layout from `TableDef`: every device, ramps, wireforms, orbits, mound VUK and pitch kicker, magnet, kickback, plunger, sensors | ✅ [`src/table/v1Table.ts`](../../src/table/v1Table.ts) |
| Grey materials, lamps as coloured discs | ✅ Live in the sandbox (`npm run dev`) |
| Layout exporter → SVG schematic | ✅ `npm run layout:svg` writes [playfield-layout-v1-generated.svg](assets/playfield-layout-v1-generated.svg) |
| Every shot in the shot map is makeable | ✅ Automated test: both orbits, both ramps, single and double in the Gap, both target banks, from the flippers |
| Saucer capture and ramp threshold tests pass | ✅ HR ramp make threshold ≈ **1.53 m/s** at the entrance. Every made ramp returns to the left inlane (1.8–4.5 m/s tested). |
| No stuck-ball hotspots in 30 minutes of play | ✅ 2 × 1,000 random balls (two seeds), each played until it drained, was caught, or 30 s passed, with flippers idle, flicking or held: **0 stuck**. A 200-ball version runs in the test suite. |
| Your feel review of the full table | ⏳ Needs you (below) |

## New physics (see [03-physics](03-physics.md))

- **3D geometry:** ramps are triangle surfaces with side walls. Wireforms are six capsule rails (two
  cradling the ball, one on each side, two above). A ball can roll under an elevated ramp and over
  playfield walls.
- **Devices:**
  - one-way gate (sloped shooter-lane exit)
  - spinners
  - line switches: rollovers, optos, ramp gates
  - standup targets
  - orbit corner kickers: the switch closes on any contact, the boost fires only on a firm hit
  - curveball magnet
  - kickback
  - analog plunger
  - nudge, with a simulated tilt bob (a damped pendulum)
- **Saucer skim:** above 1.1 m/s a ball skims over a fielder saucer instead of dropping in. A real
  ball spans most of the hole and barely dips at speed. Modelling the dip with a sharp rim threw
  fast balls 5 cm into the air.
- **Pop bumpers** also fire under a ball resting against the skirt, as real ones do.
- **Performance:** ≈ 1.2 µs per physics step on the full table, about 20 µs per 60 Hz frame (the
  budget is 1,000 µs).

## What the whitebox changed in the layout

Each change was found by the automated shot map or stuck-ball search, then fixed the way real
tables solve the same problem.

| Problem found | Fix |
|---|---|
| Balls coming back down an orbit ran down the side wall and parked on targets and saucer lips | **Orbit funnels**: below each orbit mouth the wall angles in and steers returning balls back into play |
| Free-standing B-A-T / R-U-N banks in the mid-field blocked the ramp and orbit shots | Banks moved to the **side walls below the funnels**, facing the far flipper |
| Wall targets stacked one above another formed notches a ball could sit in | Each bank is now **one continuous face with a backstop**, like a real bank |
| A dead-centre ball slipped between the two singles; doubles were almost unreachable | **The Gap redesigned:** singles flank a 40 mm centre channel. A ball that threads it meets a double at the back. A weak ball in the channel drops into **CF**. |
| The pitcher post and the mound hump knocked centre shots off line | **Mound and pitcher are visual only** for now (see open questions) |
| The HR wire ramp's U-turn was too tight (rails pinched) and climbed uphill | 39 mm-radius U-turn that **descends all the way**. Flared rail entry. Ramp tapers to centre the ball. |
| Balls launched off the steep ramp crest into the wire's top rails | **Rounded crest** (slope eases from 13° to 4°) |
| A ball entering a ramp at a steep angle could hop its 25 mm side wall into the sealed space underneath | **40 mm ramp side walls** |
| The orbit loop clipped the top-lane guide posts | Top lanes lowered for 30 mm clearance |
| A ball could rest on the shooter-lane exit gate | Gate sloped so balls roll off into the right orbit |
| A rubber corner kicker bounced balls off the arch instead of round it | Kickers sit flush in the arch with a low-bounce face |
| Ledges at the back of the Gap; a V between the inlane-guide and slingshot posts | Back walls sloped toward the lane opening; posts capped |
| Ball wedged between a pop and a wall without triggering it | Pops fire on resting pressure |

## Shot map (automated, 2 ms flip timing steps)

Balls fed down each inlane and pitched from the mound. Counts are the number of flip timings, out
of 86 to 161 per row, that produced each result first.

| Feed | Orbits | HR ramp | Steal ramp | Gap 1B / 2B | Drops / standups | Saucers | Drain / no result |
|---|---|---|---|---|---|---|---|
| Left inlane | 3 | 8 | 6 | 9 / 4 | 11 / 18 | 3 | 99 |
| Right inlane | 4 | 6 | 8 | 9 / 4 | 19 / 11 | 2 | 98 |
| Left pitch | 5 | 1 | 1 | 8 / 3 | 11 / 11 | 4 | 42 |
| Right pitch | 4 | 1 | 1 | 8 / 3 | 15 / 11 | 2 | 41 |

**Takeaways for M2 tuning:**
- Ramp timing windows are narrow (about 10–15 ms), as on real tables.
- Orbits are the hardest shot, so triples are rare.
- Pitched balls rarely make the ramps. They arrive fast and close to the flipper, so a player will
  usually catch and cradle first, then aim (a rally-style shot).
- The pitch speeds and targets get proper tuning with the pitching director in M2.

## Sandbox controls (`npm run dev`, or the Vercel preview)

| Action | Keys | Touch |
|---|---|---|
| Flippers | Shift, ←/→, A/L | Left / right half of the screen |
| Plunger | Hold ↓ or Enter, release | Hold the lower-right corner |
| Nudge left / right / forward | Z / `/` / Space | — |
| New ball on the plunger | B | Panel button |
| Pitch from the mound | K | Panel button |
| Throw a ball | Click-drag on the table | — |
| Colliders, pause, slow motion | C, P, `[` `]` | Panel |

The M0 test table is still available at `?table=m0`.

**Things to try:**
- **Skill shot:** a 45–50 % plunge drops into R-B-I. Stronger plunges loop the orbit.
- **Ramps:** do the HR and Steal ramps feel makeable but earned?
- **The Gap:** up the middle for a double, either side for a single.
- **Target banks:** shoot each bank from the far flipper.
- **Saucer skim:** soft shots should drop into the saucers, while firm ones skim over.
- **Nudge:** three quick nudges should give a tilt warning.

## Open questions for you

1. **Mound and pitcher:** they are visual only right now, because as physical obstacles they
   deflected centre shots. Keep them that way, or make the pitcher a small deflector?
2. **Skill shot difficulty:** the R-B-I plunge window is about 45–50 % of a full pull. Narrower
   (harder) or wider?
