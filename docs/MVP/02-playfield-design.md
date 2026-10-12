# 02 — Playfield Design

**The board is a real pinball machine first and a baseball field second.** It uses the vocabulary of
a classic 1990s-style "shot fan" layout:

- left and right orbits with spinners
- two ramps with wireform returns
- a pop-bumper nest fed by top rollover lanes
- a drop-target bank and a standup bank on the side walls
- slingshots, inlanes, outlanes, a kickback and a skill-shot plunger

Baseball is layered on top. **Fielders are saucers placed in the gaps between shots**, so a missed
shot is an out and a made shot is a hit. "Hit 'em where they ain't" becomes "hit your shots."

Schematics:
- [assets/playfield-layout-v1-generated.svg](assets/playfield-layout-v1-generated.svg), generated
  from the table data by `npm run layout:svg`. **This is the authoritative layout.**
- [assets/playfield-layout-v1.svg](assets/playfield-layout-v1.svg), the original hand-drawn
  concept, kept for reference.

> **Source of truth: [`src/table/v1Table.ts`](../../src/table/v1Table.ts).** The M1 whitebox
> changed several positions in the catalog below. § 10 lists every change and why. Where the
> catalog and the code disagree, the code wins.

## 1. Design approach

**Lessons borrowed from the classics:**

- **Shot fan.** The upper playfield has five major shots spread across it: left orbit, left ramp,
  center, right ramp, right orbit. This pattern is used by most beloved late-90s Williams/Bally
  tables (*Medieval Madness*, *Attack from Mars*, *Monster Bash*) and by modern Stern tables.
- **Cross-shooting.** Each flipper's best shots are on the opposite side. The ramps return to
  inlanes, which feeds flow and combos.
- **Pops in a nest fed by top lanes.** A plunge or a full orbit drops through the top lanes into
  the bumpers for a burst of chaos.
- **Open mid-playfield with insert arrows.** The middle of the board is clear travel space, covered
  in lit arrows pointing at each shot.
- **Side-wall target banks** (drops on one side, standups on the other) give secondary goals.

**The baseball twist:** fielder saucers sit *between* the shots and at the orbit approaches. Every
major shot is flanked by fielders, so accuracy is everything. Feature shots (drops, standups, the
right ramp) do not end the plate appearance. They build toward rewards, just as feature targets do in
regular pinball.

## 2. Dimensions and coordinate system

| Property | Value |
|----------|-------|
| Playfield | **590 × 1170 mm** (≈ 23.25 × 46 in, widebody class) |
| Playable width | x = 0–550 mm. The shooter lane is x = 550–590 mm. |
| Slope | **6.5°** (tunable 6.0–7.0°) |
| Coordinates | Origin at the bottom-left (apron end). **+x** points right, **+y** points up the table, **+z** points up out of the playfield. Units are mm. |
| Ball | 27 mm diameter (1-1/16 in), ≈ 80 g steel |
| Glass height | ≈ 90 mm (the physics ceiling; ramps fit under it) |
| Wall height | 25–30 mm |

## 3. Zones (bottom to top)

1. **Apron** (y < 110): inning ladder, OUT lamps, catcher's mitt drain art, umpire standee.
2. **Flipper zone** (y ≈ 110–240): flippers, center drain, home plate art.
3. **Lower sides** (y ≈ 140–380): slingshots ("dugouts"), inlanes, outlanes, left kickback.
4. **Infield art and mound** (y ≈ 220–480): a printed diamond with **basepath windows** (runners
   under glass), and the mound pitch saucer at its center. This is the one baseball-literal area,
   and it reads as playfield art, not obstacles.
5. **Side walls** (y ≈ 420–620): **B-A-T** drop-target bank (left wall), **W-A-L-K** standup bank
   (right wall), 3B and 1B side saucers at the orbit approaches.
6. **Open mid-field** (y ≈ 480–700): travel space with insert arrows aimed at every shot.
7. **Shot fan** (y ≈ 680–810): left orbit, LF, left ramp, SS, **the Gap** mouth, 2B, right ramp,
   RF, right orbit.
8. **The Gap** (y ≈ 805–1030): the center pop-bumper nest (singles in front, doubles behind, CF
   saucer in its throat).
9. **Top** (y > 1030): R-B-I rollover lanes, the orbit arch, corner kicker bumpers (triples),
   ramp crests, the shooter lane exit.

## 4. Shot map

| # | Shot | Natural flipper | Result | Flanked / guarded by |
|---|------|-----------------|--------|----------------------|
| 1 | **Left orbit** (spinner) | Right | **TRIPLE.** The ball strikes the top-left corner kicker, loops the arch, and drops through the R-B-I lanes into the Gap. | 3B side saucer on the approach (catches weak shots), LF on the inside |
| 2 | **Left ramp: "Over the Wall"** | Right | **HOME RUN** at the crest gate. The wireform returns the ball to the **left inlane**, setting up a rally. | LF and SS flank the entrance. A missed ramp rolls back toward them. |
| 3 | **The Gap** (center pop nest) | Either | **SINGLE** (front pops) or **DOUBLE** (back pops). A slow, straight-up-the-middle ball can drop into the **CF** saucer in the throat. | SS and 2B flank the mouth. CF is inside. |
| 4 | **Right ramp: "Steal" ramp** | Left | **Feature shot. Does not end the PA.** With a runner on, the lead runner advances one base (stealing home scores); Its mouth is **70 mm** (the HR ramp's is 52), so the cheaper award is the easier shot. Teal-tinted plastic (the HR ramp is red), so it doesn't read as a second home-run ramp. The wireform returns the ball to the **right inlane**. | 2B and RF flank the entrance |
| 5 | **Right orbit** (spinner) | Left | **TRIPLE** at the top-right corner kicker. The ball loops and drains down the left orbit. | 1B side saucer, RF |
| 6 | **B-A-T drop bank** (left wall) | Right | Feature: completing the bank lights **HOT BAT** (the next hit gains +1 base) | — |
| 7 | **W-A-L-K standups** (lower right, out from the wall) | Left | Feature: four letters; spelling WALK walks the batter (the letters persist through innings) | — |
| — | **R-B-I top lanes** | Plunge / orbit | Skill shot (Hot Bat). Completing all three lights the kickback. | — |

**Difficulty ladder:** singles come from the widest shot (the Gap mouth). Doubles need a hard,
accurate shot into the Gap. Triples need a clean, strong orbit past the corner saucers. A home run
needs the hardest shot, the ramp. A missed ramp often rolls back into LF or SS.

**Flow loops** (what makes the table fun to play):

- **HR → rally:** the left ramp feeds the left flipper, which has the right ramp and right orbit
  lined up.
- **Steal → ramp:** the right ramp feeds the right flipper, which has the left ramp (HR) lined up.
  "Steal, then go deep."
- **Orbit → pops:** a full orbit shot ends in the Gap for a cosmetic bumper burst before the ball
  comes back down.
- **Combos:** making shots in quick succession (for example orbit → ramp) produce crowd and light
  combos. Combo awards are post-MVP.

## 5. Element catalog (v1)

| ID | Element | Position (mm) | Notes |
|----|---------|---------------|-------|
| `flipper.L` / `flipper.R` | Main flippers | pivots (175, 175) / (375, 175) | 80 mm. Rest −30°. ≈ 55° stroke. Tip gap ≈ 60 mm. |
| `drain.center` | Catcher's mitt | below y ≈ 120, x 245–305 | **Out (strikeout).** |
| `sling.L` / `sling.R` | Slingshots ("dugouts") | tris (106,280)(106,372)(158,251) / mirror at x = 550 − x | Kicking rubbers |
| `lane.out.L` / `.R` | Outlanes | x 0–40 / 510–550, tops at y ≈ 380 | **Out (foul out).** |
| `lane.in.L` / `.R` | Inlanes | 34 mm channel between the divider and the inlane guide, both running at the flipper rest angle (−30°) | **The divider ends on the flipper's top tangent point,** tucked over the base, so its surface continues into the bat. M0 found that a divider ending below the pivot leaves a notch where the ball stalls. Ramp wireforms feed these lanes. |
| `kickback.L` | Kickback | (20, 140) | Lit at game start. Relit by R-B-I. |
| `mound` | Pitch saucer (VUK + kicker) + pitcher post | (275, 355) | Pitches every PA. Never an out. |
| `magnet.curve` | Curveball magnet | (275, 270), under the playfield | |
| `art.diamond` | Diamond with basepath windows | home (275,230) · 1B (400,355) · 2B (275,480) · 3B (150,355) | Flat and visual only. Runners move under the glass. |
| `drops.BAT` | 3-bank drop targets | left wall, y = 440 / 475 / 510 | Stay down while Hot Bat is lit and reset when it is used. A partly completed bank resets at the inning change. |
| `standups.WALK` | 4 standup targets, 26 mm each, end to end on a diagonal facing the left flipper (104 mm long) with a backstop | from (482, 445) up and left to about (413, 523). **W is the left-most plate and K the right-most**, so it reads W-A-L-K left to right as the player sees it. | Spelling WALK walks the batter. Its lamps sit behind it. |
| `saucer.3B` | Fielder saucer, half recessed into the left wall | (40, 600) | Sits in the left orbit approach. A strong orbit shot skims it. |
| `saucer.1B` | Fielder saucer, half recessed into the right wall | (510, 600) | Mirror of 3B |
| `orbit.L` / `orbit.R` | Orbit lanes | x 0–45 / 505–550, mouths at y = 680 | Spinners at y = 760. One-way gate at the shooter lane exit. |
| `saucer.LF` | Fielder saucer | (85, 750) | Between the left orbit and the left ramp |
| `ramp.HR` | Left ramp, "Over the Wall" | entrance (142, 790), 52 mm wide | HR gate at the crest (75, 1010). Wireform to the left inlane. |
| `saucer.SS` | Fielder saucer | (200, 765) | Between the left ramp and the Gap |
| `gap.mouth` | The Gap entrance | x 240–310 at y = 805 | Funnel walls into the nest |
| `pop.OF.L` / `.R` | Outfield bumpers (mint caps) | (105, 660) / (445, 660), 17 mm, a mirror pair | Score no hit; feed HUSTLE. Soft kick (0.8 m/s; the Gap pops' is 3.4). |
| `hustle.1`-`.5` | HUSTLE meter lamps | (243 + 16 i, 612) | One lamp per three bumper hits after a hit |
| `pop.1B.L` / `.R` | Singles pop bumpers | (230, 875) / (320, 875) | Front pair. Ivory caps, "1B". |
| `saucer.CF` | Fielder saucer in the Gap throat | (275, 910) | Between and just behind the singles |
| `pop.2B.L` / `.R` | Doubles pop bumpers | (225, 985) / (325, 985) | Back pair. Blue caps, "2B". |
| `saucer.2B` | Fielder saucer | (348, 745) | Between the Gap and the right ramp (20 mm further down the table than SS, to make room for the wider ramp mouth) |
| `ramp.STEAL` | Right ramp | entrance (408, 790), 70 mm wide | Crest at (475, 1010). Wireform to the right inlane. |
| `saucer.RF` | Fielder saucer | (465, 730) | Between the right ramp and the right orbit (moved down 20 mm, as 2B) |
| `kicker.3B.L` / `.R` | Corner kicker bumpers (triples) | arch corners ≈ (40, 1060) / (545, 1060) | Amber kicking rubber. Kicks the ball onward around the arch. |
| `lanes.RBI` | Top rollover lanes | x = 245 / 275 / 305, y 1075–1125 | Drop into the back of the Gap. Lane change with the flipper buttons. |
| `shooter` | Shooter lane + plunger | x 550–590, plunger at (570, 40) | Leadoff launch and skill shot |

**Fielders (7 saucers):** 3B and 1B on the walls at the orbit approaches; LF, SS, 2B and RF in the
gaps of the shot fan; CF in the throat of the Gap. The pitcher (mound) and catcher (drain) are the
battery.

### 5.1 Optional / later elements (reserved space)

- **Upper-right flipper** (P2) at about (470, 620), aimed up-left at the left ramp and LF. It is a
  classic "second chance at the big shot" element (*Twilight Zone*, *Funhouse*). Space is reserved
  in the right wall region above the 1B saucer.
- **Captive ball** (P2), for example a "bullpen" captive ball on the right side.
- **Combo shots** and **multiball** (P2).

## 6. Device specifications

### 6.1 Fielder saucers (out holes)

A **saucer-style dish** backed by the fielder standee, whose base forms the rubber-faced back lip.
The open side faces the main flow (toward the flippers).

| Parameter | v1 |
|-----------|----|
| Inner diameter | 40 mm (ball is 27 mm) |
| Depth | 7 mm (tune 5–9) |
| Back lip | Standee base, 12 mm, rubber-faced |
| Capture rule | Emergent physics. The ball must settle in the dish (speed < 0.15 m/s, inside radius, ≥ 40 ms). |
| Side saucers (3B/1B) | Half recessed into the wall. They catch slow balls running along the wall into an orbit. Fast orbit shots skim across. |
| On capture | The ball is removed (subway). Fielder catch-and-throw animation. The ball returns to the mound. |

**Gameplay feel:** a shot that clips the post between two shots and dies falls into the nearby
saucer, which reads naturally as "hit right at the fielder." Slow, weak shots are the most at risk.
Fast shots that only graze a saucer skim across it.

### 6.2 Hit devices

| Hit | Device | Behaviour |
|-----|--------|-----------|
| Single | Front pair of pop bumpers in the Gap (ivory, "1B") | The first pop contact during `IN_PLAY` is a single. Later contacts are cosmetic. |
| Double | Back pair of pop bumpers in the Gap (blue, "2B") | Reached by a strong, straight shot that skims the CF saucer, or that threads between a single and CF. |
| Triple | Corner kicker bumpers at the arch corners (amber, "3B") | Kicks the ball onward around the orbit. Switch on contact. |
| Home run | Left ramp crest gate (red ramp, "HR" flag) | Gate switch = HR. The wireform returns the ball to the left inlane. |

### 6.3 Feature devices

| Device | Behaviour |
|--------|-----------|
| B-A-T drop bank | Each drop scores a crowd cheer. All three down → **HOT BAT** lit (see [01 § 4.8.1](01-game-design.md#481-hot-bat-in-detail)). The bank stays down while Hot Bat is lit and resets when it is used. A partly completed bank resets at the inning change. |
| W-A-L-K standups | Each lights a letter. All four → a **walk** for the batter. Letters persist through innings until the word is spelled. |
| Right ramp ("Steal") | The arrow blinks while a runner is on. A shot steals: the lead runner who can advance moves up one base, and stealing home scores a run. With the bases empty, it is a flow shot only (crowd, lights, combo potential). |
| Spinners (both orbits) | Cosmetic plus crowd excitement. Spin count feeds the presentation. |
| R-B-I top lanes | Skill shot (the lit lane during the leadoff launch = Hot Bat). Completing R, B and I relights the kickback. |
| Kickback | Kicks an outlane ball back into play before it drains (one use per lighting) |

### 6.4 Mound and pitch delivery

As before: the ball arrives by **virtual subway**, a **VUK** pops it into the mound cup, the pitcher
winds up, and a **kicker** aims it at a flipper's sweet zone. The **magnet** bends curveballs. When
no pitch is staged, a flush plate closes the cup, so the mound is a gentle hump with a thin pitcher
post.

### 6.5 Other standard devices

Slingshots, inlane and outlane rollovers, an orbit opto switch at each orbit mouth, a one-way gate
at the shooter exit, and an analog plunger (a full plunge makes the full orbit; a soft plunge drops
into the top lanes).

## 7. Lamps and inserts

| Group | Lamps |
|-------|-------|
| Shot arrows (mid-field) | One per shot, colored by result: orbit = amber (3B), left ramp = red (HR), Gap = ivory/blue, right ramp = teal (STEAL), plus lit-state chasers |
| Bases (diamond art) | 1B, 2B, 3B, home plate (run flash) |
| Apron | Inning ladder 1–9, OUTS ×3, Kickback |
| Feature | B-A-T letters, W-A-L-K letters, HOT BAT, STEAL (arrow), R-B-I lanes |
| Mound | FB / CH / CB pitch telegraph |
| Rally | 5-step rally meter in the mid-field |
| Hit devices | Pop caps, corner kicker housings, ramp LEDs |
| GI | Warm white strings along the walls, plus stadium-light "spots" |

## 8. Deviations from standard pinball (and why)

1. **Saucers are defenders.** In most tables, saucers are targets. Here, seven of them punish missed
   shots. They sit where posts and dead space usually are: in the gaps of the shot fan, at the orbit
   approaches, and in the throat of the pop nest.
2. **Pitches come from mid-playfield**, so every plate appearance is a fresh, readable duel.
3. **Runners under glass** in the printed diamond. They are visible but never in the ball's way.
4. **Every drain is an out.** Outlanes are "foul outs," and the center drain is a strikeout.

## 9. Whitebox iteration checklist

Measure each layout revision (playtests + headless sim bot):

- Success rate of each shot from a cradle and from a moving ball, plus the capture rate of each
  flanking saucer on misses.
- Gap outcome split (single / double / CF) vs entry speed and angle.
- Ramp rollback rate and where rollbacks end up.
- Pop and sling exits that go straight down the middle (target < 5 %). With every drain an out, this
  matters even more.
- Stuck-ball hotspots (heat map of rest positions).
- The metrics in [01 § Difficulty and tuning targets](01-game-design.md#8-difficulty-and-tuning-targets).

## 10. M1 whitebox changes (v1.1)

Every change below was found by the automated shot map or stuck-ball search in M1. Details are in
the [M1 report](m1-report.md).

| Area | v1 (planned) | v1.1 (as built) |
|---|---|---|
| Orbit mouths | Open at y = 680 | Open at y = 700, with a **funnel** below each one that steers returning balls back into play |
| B-A-T / W-A-L-K banks | Spread along the side walls at y 440–510 | **Continuous banks with a backstop**, on the side walls below the funnels (y ≈ 520–600), each facing the far flipper |
| 3B / 1B saucers | (40, 600) / (510, 600), in the orbit approach | (25, 478) / (525, 478), low on the side walls, lip into the wall |
| The Gap | Singles (230/320, 875), doubles (225/325, 985), CF at (275, 910) with a back lip | **Singles (233/317, 868)** flank a 40 mm centre channel. **Doubles (247/303, 992)** at the back. **CF (275, 918)** in the channel with no lip. |
| Mound + pitcher | Raised hump with a collidable pitcher post | **Visual only.** Pitches still come from the mound spot (275, 345). |
| HR / Steal ramps | Crest at (75, 1010), straight wire | Rounded crest at ≈ (100, 1030). Ramp tapers 52 → 32 mm, with 40 mm side walls. 39 mm-radius U-turn that descends all the way. Six-rail wire with a flared entry. |
| Top lanes | y 1075–1125 | **y 1060–1100**, so the orbit loop clears the guide posts |
| Corner kickers | Rubber chord across each arch corner | **Flush with the arch**, low-bounce face. Placed where each orbit's ball meets the arch (not mirror images: the right orbit is inside the shooter lane). |
| Shooter exit | Flat one-way gate | **Sloped** gate: returning balls roll off into the right orbit |
| Lower playfield | — | Caps join each inlane-guide post to its slingshot's top post |

### M2 balance changes

| Area | Change | Why |
|---|---|---|
| Fielder backstops | Dead, grippy "glove" material (restitution 0.12–0.2, friction 0.5) | Rubber backstops bounced misses back to the flippers. Fielder outs doubled (7 % → 15 %). |
| Saucer skim speed | 1.1 → 1.6 m/s | More moderately fast misses are caught |
| Triples | Counted only for a clean orbit shot (orbit entered within 1 s of the swing) | Slingshot ricochets wandering up an orbit made triples 25 % of hits. Now 8 %. |


### M3 playtest fixes (stuck balls)

The stuck-ball test had only ever run on the M0 test table. Run on the v1 table, it found two kinds
of ledge. In the sim bot, one game in 30 never finished because of them.

| Area | Change | Why |
|---|---|---|
| LF, SS, 2B, RF backstops | The straight 36 mm lip bar is now a small round post (5 mm radius), offset so a ball-wide gap (≥ 27.5 mm) stays open on both sides to the neighbouring posts, guides and ramp walls | The top of each bar was a flat shelf, and its ends formed pockets with the ramp-entrance posts and orbit guides. Fielder outs did not drop (16.5 % of PAs). |
| Ramps | Skirts from the ramp floor edges, and across the far end, down to the playfield | A ball could slide under a ramp's side and wedge beneath the floor |
| Rules | After three failed ball searches, the ball is rescued | Each search kick moved the ball, which reset the idle timer, so a ball wedged in place was searched for forever and never rescued |

A ball that lands within about 1° of the very top of a round post can balance there, held by
rolling resistance. This is rare (1 in about 1,300 drops in a dense scan), and the first ball search
knocks it off.

### Steal changes (post-M6)

Playtest feedback: steals were harder than a home run though worth less. Measured with the bot:
the right ramp was made as often as the HR ramp (about 1.8 times a game), but steals were 0.13 a
game, because a make needed a lit STEAL (three R-U-N hits) and a runner on base.

| Area | Change | Result |
|---|---|---|
| Rules | The right ramp steals directly whenever a runner is on; no lighting. (A **double steal** from R-U-N was tried and then retired when R-U-N became W-A-L-K, below.) Unlit right-ramp shots no longer spot letters. | 0.6-0.8 steals a game from the rule change alone |
| Steal ramp mouth | 52 → **70 mm**, guard posts moved out. The 2B and RF saucers moved 20 mm down the table (and their glove posts 2 mm out) so every guard post keeps a ball-wide (≥ 27.5 mm) gap and no notch can hold a ball. A first try at 56 mm was not visibly wider and gained only 40 %. | The make window is about 2.2× the HR ramp's (grid test: 45 → 99 makes); from real flipper shots the steal ramp is made about 70 % more often than the HR ramp. The HR ramp is unchanged. |

**Result (sim bot, 60 games each):** steals 1.55 a game (average profile) and 1.9 (rookie), against
1.7-2.2 home runs. Runs per game rose from about 4.6 to 5.4 (average) and 6.0 (rookie), above the
3-5 target, because steals move runners and steals of home score; fielder outs fell from 16 % to
about 13.6 % of PAs. If the extra runs are too many, the levers are the pitch speed, the
steal-home award, or tightening the Gap. The bot does not aim, so a person aiming at the ramp
with a runner on should steal more.

### W-A-L-K (replaces R-U-N)

The R-U-N bank had no job once steals needed no lighting, so it became **W-A-L-K**: four standups,
and spelling the word walks the batter (first base, forced runners advance, the bases loaded forces
in a run). Not a hit, so no H and no change to the hit rate. The letters **persist through
innings** until the word is spelled.

| Area | Change | Result |
|---|---|---|
| Bank | Three 26 mm plates on the wall → four **26 mm** plates **out in the open** at the lower right, facing the left flipper. First tried as four 19.5 mm plates flush on the wall (a fourth full plate would not fit beside the right funnel post), which playtesting found too hard to reach: the paddles hit the bank on 8 % of flip timings, and the middle letters A and L got only 3-5 hits each. Lamps `lamp.standup.W/A/L/K` now sit behind the bank; the `lamp.steal` insert is gone, replaced by a printed WALK sign. | **Sweep of 20+ layouts in the simulation** (position, angle and plate size, scored by flip timings that reach each letter): the chosen layout is hit on **19 %** of timings (47 of 248), with W, A, L, K getting 11, 9, 10 and 17 hits, and the steal ramp (13), HR ramp (7) and orbit (7) shots unchanged. Drains do not rise (31 vs 33). Stuck-ball scans and the "every shot is makeable" check pass. |
| Rules | `walk()` in `src/rules/bases.ts`; `stats.walks` (BB in the box score); event `walk`. A walk works in any live state and does not end or restart the plate appearance. | |
| Letters | Persist across innings (a decision by the product owner). | |

**Result (sim bot, 80 games each, average profile):** steals 2.1 and walks 2.3 a game (the bot does
not aim; it had 0.5 walks a game with the wall-hugging bank). Runs per game are about **5.5**
(average) and 5.1 (rookie), above the 3-5 target: steals and walks both put runners on and move
them. If that is too many runs, the levers are the pitch speed, the steal-home award, the walk
reward, or tightening the Gap. Fielder outs are 17 % of PAs.

**Showing progress (playtest follow-up):** it was hard to tell which letters had been hit. A hit
letter now glows three ways: the **plate** itself, a **lit pad** on the playfield in front of it
(dark until hit, like an insert), and a **W-A-L-K tracker in the HUD** (lit boxes for hit letters).
All three come from the rules' letter state, so they persist through innings and clear when the
word is spelled (the four plates flash as the walk is awarded).

### Bumpers that matter: outfield bumpers and HUSTLE

Playtest feedback: more bumpers, somewhere other than the Gap for the ball to bang around, and
banging that actually matters. Until now, once a hit landed the Gap pops did nothing at all.

| Area | Change | Result |
|---|---|---|
| Bumpers | Two **outfield bumpers** in the mid-field, a **mirror-symmetric pair** at (105, 660) and (445, 660), 17 mm, mint caps. Playtest feedback: the pair should look balanced and not block anything important. The first pair, at (130, 610) and (430, 640), was lopsided (30 mm apart in height) and cost about 2 home-run-ramp and 2 steal-ramp shots. The symmetric pair was chosen by sweeping 12 symmetric layouts, then 9 more around the best, scoring each by how far the HR, steal, orbit, W-A-L-K and Gap shot counts moved from the no-bumper table. Pairs further in (x = 125 or 145) cut the HR and steal ramps by up to half, and a pair at y = 570-630 cut the orbits to 0-3. | **30 % of flipper shots touch a bumper**, and the shots that matter are unchanged: Gap 29 (28 without bumpers), HR ramp 7 (7), steal ramp 13 (13), orbit 8 (7), W-A-L-K bank 48 (47). They sit on one line flanking the HOME RUN, Gap and STEAL arrows, clear of every ramp mouth, saucer and lane. The two orbit arrows moved into their lanes so no printed arrow is near a cap. |
| Meter | **HUSTLE**: while the ball is live after a hit, every bumper hit counts (the Gap pops too, which used to be decoration). 15 hits fill it; five lamps, and a chip in the HUD. Full: every runner takes an extra base. | 1.4 payouts a game for the bot. |
| Counting | At most one hit per 0.4 s, and only after a hit. | Counting every contact paid out about 14 times a game: a ball ricocheting through the nest's four pops makes dozens of contacts in a second or two. Counting hits before the result (46 a game for the bot) would have paid out about 7 times a game, so those just deflect the ball. |
| Strength | Outfield bumpers kick at **0.8 m/s** (a per-bumper `kick` override; the Gap pops stay at 3.4). Softened from 1.5 after playtesting. | At full strength the bumpers kept balls alive and fed the Gap: hit rate 30 → 37 %, **runs per game 5.5 → 9.5**. Runs per game for the average bot by kick: 3.4 → 9.5, 2.2 → 7.2, 1.5 → 6.4, 1.1 → 6.6, **0.8 → 5.8**. |

**Result (sim bot, 100 games each, symmetric pair, kick 0.8):** average profile 5.8 runs, hit rate
30 %, 1.3 HUSTLE payouts, 1.5 steals and 2.2 walks a game; rookie 5.3 runs (median 4), hit rate 28 %,
1.1 HUSTLE, 1.6 steals, 1.9 walks. Before softening (kick 1.5) it was 6.4 and 6.8 runs, because once
the bumpers stopped clipping any shot, steals and walks came back to full strength. If the bumpers
now feel too gentle, raise `kick` (each +0.5 m/s adds roughly 1 run a game); the pitch speed and the
Gap are other levers.

**Not done:** a lead-off meter that builds steals from bumper hits, the infield base bumper, and
bumper-fed Hot Bat. All three were options in the plan.

### Pitching from the Stretch: the mound's ramp-and-bumper

Playtest feedback: a runner on base should change the table, and the pitcher should look like he
knows it. With a runner on, the pitcher goes to the stretch and a half disc rises on the mound.
It sinks again when the bases are empty. `pop.mound` in `src/table/v1Table.ts`; the shape is built by
`src/table/rampBumper.ts`, which both the physics and the renderer use.

| Area | Change | Result |
|---|---|---|
| Shape | A half disc of radius 30 mm and 8 mm tall on the back half of the mound. Its **straight edge faces the flippers and is a ramp**: a shot rides up it and flies off the back, airborne. Its **rounded back is a pop bumper wall** (kick 2.0 m/s) that kicks a ball coming down the table or in from the side, and counts toward HUSTLE. | 29 % of flipper shots touch it; 43 of 176 shots that cross the mound go over the ramp, none higher than 27 mm. HR ramp 8 (7 without it), steal ramp 16 (13), Gap 1B 72 (86), Gap 2B 6 (10), orbits 9 and 6 (4 and 4). |
| Rises and sinks | Up while a runner is on base, down when the bases are empty (`Machine.setMoundBumper`, synced every step from the bases). It never rises under a ball, and drops out of the way of each pitch (the ball is released from the mound), rising again once the ball has gone. | |
| Alert | **FROM THE STRETCH** callout and scoreboard, with the bumper flashing, 1.6 s after it rises (so it does not cover the hit's own callout), and not at all if the bases clear first. | |
| One-way wall | The wall acts only on a ball outside the half disc. A ball riding the ramp rolls off the back edge; the wall is the slab's side. | Without this the wall stopped balls still on the ramp. |
| Tall lower walls | The lane guides, slings, caps and lane-top posts are 80 mm tall (slings take an optional `height`); the straight side rails and the shooter-lane separator are 85 mm. | A ball thrown off the ramp comes down in the lower half. With 25 mm walls it dropped in over a guide, or into the sealed pocket behind a sling, and sat wedged: 8 to 10 ball searches in 40 games. Now 0 in 60. |

**Why not a taller or a lower ramp.** A ball leaves the ramp with a speed that grows with its slope. A
ramp of 2 mm hardly touched any shot and could not be seen; at 8 mm a hard shot is thrown about 30
mm up, which the tall lower walls now absorb. A first, rounder shape (a cone with the bumper over
only part of the rim) bounced 41 % of the shots that crossed the mound off its flanks.

**Ball search fix.** A ball resting against a sling was kicked by every search, which fired the sling,
which counted as progress and reset the search count, so it was never rescued. A switch within 2 s of
a search no longer counts.

**Result (sim bot, average profile, 100 games):** 6.4 runs a game (the target is now 5-7), hit rate
29 %, 1.6 steals, 1.6 HUSTLE payouts, 0 ball rescues.

The mound's id is still `pop.mound`; the seventh-inning scoreboard also says STRETCH!, which is a
different stretch.

### More orbit spinners

Playtest feedback: more of the spinning plates in the orbit lanes. Each orbit now has **five
spinners** (y = 760, 800, 830, 860 and 890 mm) instead of one, on the straight run between the
entry switch and the top curve, so a ball looping an orbit sets off a rattling string of whirrs.
They are cosmetic: a spinner scores nothing and the rules ignore it; it only spins, sounds and
costs the ball 3 % of its speed per plate.

| Check | Result |
|---|---|
| Orbit shots (248 flipper shots) | 9 and 6, as before |
| Sim bot, 100 games | 5.7 runs, 14.6 % of hits are triples (14.7 % before), 0 ball rescues |
| Stuck-ball scan, 1,200 random balls | 0 (one spacing, 765 / 835 / 865 / 895, left a ball balanced on the left fielder's lip post once; every other spacing tried gave 0) |

### Spin bonus: a reward for plunging hard

Playtest feedback: a reward for a hard plunge, the other plunge choice at the top of each inning
(the soft one, into the lit top lane, is the skill shot).

Before this, the rewards in play before a first swing or with nobody on were the skill shot (HOT
BAT), the R-B-I lanes (relight the kickback), the B-A-T drops (HOT BAT) and W-A-L-K (a completed
word walks the batter). HUSTLE, rallies, steals and the Stretch all need a hit or a runner first.

| Area | Change | Result |
|---|---|---|
| Trigger | At least **four different left-orbit spinner plates** spun after the leadoff plunge and before the first swing, once an inning (`SPIN_BONUS_PLATES`, `src/rules/game.ts`). | From the physics: a pull of about 0.55 and up runs the whole arch and the five left plates; 0.44-0.50 is the skill-shot window (at most three plates, though a bounce can reach four); about 0.40 falls back and rolls down the right orbit, spinning only the right plates, which does not count. |
| Reward | **+2 HUSTLE hits** (`SPIN_BONUS_HUSTLE`), with a SPIN BONUS callout, scoreboard message and a blink of the HUSTLE lamps. | The sim bot plunges hard, so it earns the bonus in 94 % of innings. Runs by size (100 games): none 5.7, **+2 6.1**, +3 6.4. HUSTLE payouts 1.3, **2.3**, 2.8 a game. +2 keeps scoring near the middle of the 5-7 target. |
| Risk | None added. A hard plunge with no flipper input drains and is a strikeout, as before. | Plunges of 0.65 and up drain unless the flippers act. |

The right-orbit route is excluded on purpose: a gentle plunge that happens to roll down the right orbit
is not a hard plunge. If the bonus feels too automatic (the bot never plunges softly), tighten the
trigger (all five plates, or a faster ball) or lower the reward to +1 (6.1 runs, 1.8 payouts).
