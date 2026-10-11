# M3 Report: Art Pass + Naming

Status as of 2026-10-10, branch `m3-art`, stacked on `m2-rules`. This is the **first art pass**,
built for your visual review.

## Exit criteria

| Criterion ([07 § M3](07-roadmap-and-scope.md#m3-art-pass--final-name)) | Status |
|---|---|
| Final game name and identity, decided alongside the art | ⏳ Candidates in [naming.md](naming.md). **Needs your pick.** |
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

## Needs you

1. **Pick the name** (see [naming.md](naming.md)). My recommendation is *Extra Innings*, with
   *Plunger Park* as a fallback. Check trademarks before locking it in.
2. **Visual review** of the preview, especially:
   - overall mood: too dark or too bright?
   - the playfield art's readability
   - the standees
   - the stadium
3. **Phone check:** frame rate and look at the medium tier.
