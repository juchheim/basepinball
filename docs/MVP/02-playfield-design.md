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
5. **Side walls** (y ≈ 420–620): **B-A-T** drop-target bank (left wall), **R-U-N** standup bank
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
| 4 | **Right ramp: "Steal" ramp** | Left | **Feature shot. Does not end the PA.** When STEAL is lit, the lead runner advances one base (stealing home scores). The wireform returns the ball to the **right inlane**. | 2B and RF flank the entrance |
| 5 | **Right orbit** (spinner) | Left | **TRIPLE** at the top-right corner kicker. The ball loops and drains down the left orbit. | 1B side saucer, RF |
| 6 | **B-A-T drop bank** (left wall) | Right | Feature: completing the bank lights **HOT BAT** (the next hit gains +1 base) | — |
| 7 | **R-U-N standups** (right wall) | Left | Feature: completing the bank lights **STEAL** on the right ramp | — |
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
| `standups.RUN` | 3 standup targets | right wall, y = 440 / 475 / 510 | Lights STEAL |
| `saucer.3B` | Fielder saucer, half recessed into the left wall | (40, 600) | Sits in the left orbit approach. A strong orbit shot skims it. |
| `saucer.1B` | Fielder saucer, half recessed into the right wall | (510, 600) | Mirror of 3B |
| `orbit.L` / `orbit.R` | Orbit lanes | x 0–45 / 505–550, mouths at y = 680 | Spinners at y = 760. One-way gate at the shooter lane exit. |
| `saucer.LF` | Fielder saucer | (85, 750) | Between the left orbit and the left ramp |
| `ramp.HR` | Left ramp, "Over the Wall" | entrance (142, 790), 52 mm wide | HR gate at the crest (75, 1010). Wireform to the left inlane. |
| `saucer.SS` | Fielder saucer | (200, 765) | Between the left ramp and the Gap |
| `gap.mouth` | The Gap entrance | x 240–310 at y = 805 | Funnel walls into the nest |
| `pop.1B.L` / `.R` | Singles pop bumpers | (230, 875) / (320, 875) | Front pair. Ivory caps, "1B". |
| `saucer.CF` | Fielder saucer in the Gap throat | (275, 910) | Between and just behind the singles |
| `pop.2B.L` / `.R` | Doubles pop bumpers | (225, 985) / (325, 985) | Back pair. Blue caps, "2B". |
| `saucer.2B` | Fielder saucer | (350, 765) | Between the Gap and the right ramp |
| `ramp.STEAL` | Right ramp | entrance (408, 790), 52 mm wide | Crest at (475, 1010). Wireform to the right inlane. |
| `saucer.RF` | Fielder saucer | (465, 750) | Between the right ramp and the right orbit |
| `kicker.3B.L` / `.R` | Corner kicker bumpers (triples) | arch corners ≈ (40, 1060) / (545, 1060) | Amber kicking rubber. Kicks the ball onward around the arch. |
| `lanes.RBI` | Top rollover lanes | x = 245 / 275 / 305, y 1075–1125 | Drop into the back of the Gap. Lane change with the flipper buttons. |
| `shooter` | Shooter lane + plunger | x 550–590, plunger at (570, 40) | Leadoff launch and skill shot |

**Fielders (7 saucers):** 3B and 1B on the walls at the orbit approaches; LF, SS, 2B and RF in the
gaps of the shot fan; CF in the throat of the Gap. The pitcher (mound) and catcher (drain) are the
battery.

### 5.1 Optional / later elements (reserved space)

- **Upper-right flipper** (P2) at about (470, 620), aimed up-left at the left ramp and LF. It is a
  classic "second chance at the big shot" element (*Twilight Zone*, *Funhouse*). Space is reserved
  in the right wall region above the R-U-N standups.
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
| R-U-N standups | Each lights a letter. All three → **STEAL** lit on the right ramp. Letters reset at the inning change. |
| Right ramp ("Steal") | With STEAL lit: the lead runner who can advance moves up one base. Stealing home scores a run. Then STEAL goes unlit. When unlit, the shot is still a flow shot (crowd, lights, combo potential). |
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
| Feature | B-A-T letters, R-U-N letters, HOT BAT, STEAL, R-B-I lanes |
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
| B-A-T / R-U-N banks | Spread along the side walls at y 440–510 | **Continuous banks with a backstop**, on the side walls below the funnels (y ≈ 520–600), each facing the far flipper |
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
