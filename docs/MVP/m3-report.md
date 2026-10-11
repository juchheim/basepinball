# M3 Report: Art Pass + Naming

Status as of 2026-10-10, branch `m3-art`, stacked on `m2-rules`. This is the **first art pass**,
built for your visual review.

## Exit criteria

| Criterion ([07 § M3](07-roadmap-and-scope.md#m3-art-pass--final-name)) | Status |
|---|---|
| Final game name and identity, decided alongside the art | ✅ **Rally Ball** ([naming.md](naming.md)). Trademark check still to do before launch. |
| Playfield SVG art and the slot pipeline | ✅ Art is generated from the table data. A raster override wins. Output is WebP at 2048 and 4096 px. KTX2 is deferred (below). |
| Standees | ✅ Printed-acrylic figures behind all 7 fielders and on the mound (catcher, umpire and runner are drawn for M4) |
| Stadium diorama | ✅ Backboard with the outfield wall, live LED scoreboard, light towers, stands with an instanced crowd, night sky |
| Materials, ball reflections, lighting, bloom, grading | ✅ See below |
| Quality tiers + adaptive controller | ✅ low / medium / high / ultra; steps down when frames stay slow |
| Visual sign-off by you | ⏳ |
| Performance budgets on the device matrix | ✅ Desktop: 60 fps at high (WebGPU) and medium (WebGL2). ⏳ Real phones. |

## What changed visually

- **Playfield art** ([tools/art/playfield.ts](../../tools/art/playfield.ts)): the ballpark at night,
  printed on the playfield:
  - grass with mowing stripes
  - the warning track along the arch and down the orbits, with the yellow home-run line and
    "PLUNGER PARK · HOME OF THE TILT CITY SILVERBALLS"
  - distance markers, and the dark "batter's eye" behind the Gap
  - the infield diamond with glass basepath channels, bases, mound, batter's boxes and foul lines
  - leather glove rings with scorebook numbers ("SS 6"), and printed shot arrows (TRIPLE, HOME
    RUN, 1B · 2B, STEAL)
  - feature labels, the catcher's mitt, and print grain
- **Clear-coated playfield**: a physical material with a glossy coat over the print.
- **Night lighting**:
  - the key lights shine from the two light towers
  - a soft player-side fill stands in for the cabinet's general illumination
  - the reflection environment is a dark sky with HDR tower light banks, so the clear coat and
    chrome reflect darkness and bright lights, as they would in a ballpark
- **Chrome ball** with **live reflections**: a cube camera follows the ball (128 px every frame at
  high, 64 px every other frame at medium, static at low).
- **Grading**: AgX tone mapping, +8 % saturation, soft vignette. Bloom stays selective (emissive
  surfaces only).
- **Cabinet**: lacquered wood side rails with chrome trim, the lockdown bar, and the apron.
- **Stadium**: the backboard art is back-lit like a translite. The LED scoreboard shows the line
  score, R/H, outs and runners, or the title between games. Light towers, stepped stands with a
  crowd (300–4,000 figures by tier), and stars.
- **Text**: the Oswald display font (OFL) is bundled for the UI, scoreboard and printed art.

## The asset pipeline (docs/MVP/05 § 5)

- `npm run art` generates the editable SVG sources (`assets-src/svg/`) from the table data.
- `npm run assets` rasterises each slot to `public/tex/` as WebP at every tier size, with
  content-hashed file names and a manifest. It runs automatically before `dev` and `build`, and
  so on Vercel.
- **Raster replacement:** a PNG in `assets-src/raster/<slot>.png` replaces the vector art with no
  code change. Slot sizes and layouts are in [assets-src/README.md](../../assets-src/README.md).
- **Deferred to M5:** KTX2 / Basis GPU compression. No encoder is available for this toolchain yet,
  and WebP is small to download but large in GPU memory. The 4096 px playfield is therefore only
  used at the high and ultra tiers. Phones (medium) get 2048 px.

## Quality tiers

| | Low | Medium (phones) | High (desktop) | Ultra |
|---|---|---|---|---|
| Pixel-ratio cap | 1 | 1.5 | 2 | 3 |
| Shadow lights | 0 | 1 × 1024 | 2 × 2048 | 2 × 2048 |
| Ball reflections | static | 64 px every other frame | 128 px | 256 px |
| Bloom | off | on | on | on |
| Playfield texture | 2048 | 2048 | 4096 | 4096 |
| Crowd | 300 | 900 | 2,200 | 4,000 |

The starting tier is medium on touch or small screens and high otherwise. `?quality=` forces a
tier. When the median frame over about 2 s is slower than about 48 fps, the controller steps down
one tier. Stalls (tab switches, loading) are ignored.

## Playtest fixes (after the first feel review)

- **Pitches slowed down.** In M2 the fastball reached the bat in about 0.13 s, too fast to react
  to. Now:
  - fastball 0.42–0.56 m/s, about 0.33–0.40 s to the bat
  - change-up 0.28–0.34 m/s, about 0.45–0.49 s
  - curveball 0.36–0.46 m/s, with a gentler magnet pulse

  Aim points are recalibrated by speed, and the fairness tests still pass, including a new
  "at least 0.3 s to react" check. See [01 § 4.6](01-game-design.md#46-pitching).
- **Pre-pitch indicator.** A 1.5 s windup (was 0.8 s):
  - the mound lamp for the pitch type blinks
  - a mid-field panel shows the pitch type and an arrow to the target flipper
  - its countdown bar empties at release, then "PITCH!" flashes
  - it pauses with the game
- **Stuck balls.** One sim game in 30 never finished: the ball was wedged on a fielder's lip bar,
  and the ball search looped forever. The fixes are:
  - the upper fielders' lip bars are now small offset posts
  - the ramps have skirts down to the playfield
  - a rescue follows three failed searches
  - the stuck-ball test now runs on the v1 table

  See [02 § 10](02-playfield-design.md#m3-playtest-fixes-stuck-balls).
- **Balance after the changes** (`npm run simbot -- 30 average`):
  - 30/30 games complete
  - 4.7 runs per game
  - 30.6 % hit rate
  - fielder outs 16.5 % of PAs (was 12 %)

  The rookie profile scores 4.5 runs.

## Needs you

1. ~~Pick the name~~: **Rally Ball** (decided).
2. **Pitch feel:** are the slower pitches and the windup indicator right? Speeds and the windup
   length are single numbers to tune.
3. **Visual review** of the preview, especially:
   - overall mood: too dark or too bright?
   - the playfield art's readability
   - the standees
   - the stadium
4. **Phone check:** frame rate and look at the medium tier.
