# 05 — Art & Animation

## 1. Visual target

> **A real, premium pinball machine playing a night game.** The player looks down at a glossy
> playfield that *is* a miniature ballpark: manicured grass under clear coat, chalk lines, a clay
> infield, chrome rails reflecting stadium light towers. Beyond the backboard the diorama continues:
> outfield wall, scoreboard, packed stands, haze in the light beams, a night sky.

**Realism comes from:** physically based materials, a mirror-chrome ball with live reflections,
believable light falloff and bloom on lamps, soft multi-light shadows, and mechanical animation that
behaves like real solenoids (fast attack, slight overshoot, settle).

**Fun comes from:** expressive fielder and runner standees, punchy light shows, fireworks, crowd
reactions, and kinetic scoreboard typography.

### 1.1 Palette

| Role | Color (approx.) |
|------|-----------------|
| Night sky / cabinet shadows | Navy-black `#0B1020` → `#141B33` |
| Outfield grass (two-tone mowing stripes) | `#2E6B34` / `#367A3C` |
| Infield clay | `#B4683C` |
| Chalk lines and bases | `#F4F1E8` |
| Stadium light (tungsten-LED white) | `#FFF4DC` |
| Hit colors | 1B ivory `#F4EFE1` · 2B blue `#3D8BFD` · 3B amber `#FF9F1C` · HR red `#FF3B3B` |
| Out / defense accents | Glove leather `#8A5A2B`, team navy, chalk |
| Team (*the Tilt City Silverballs*, placeholder; home park *Plunger Park*) | Navy, chrome silver, lamplight gold `#F2B33D` |

All teams, logos, players and stadium names are **fictional**. No league marks or real likenesses.

## 2. Scene composition

- **Cabinet:** side rails (wood with chrome trim), lockdown bar at the bottom edge (desktop view),
  apron (printed metal), shooter lane, glass (a faint reflection layer with dust and smudge texture,
  subtle and toggleable).
- **Playfield:** the ballpark art (see § 5), lamps, rubbers, posts, standees, ramp, wireform.
- **Backboard and beyond:** the outfield wall (padded, with distance markers "330 · 375 · 400"),
  an in-world **LED scoreboard** above center field (line score, outs, bases, "AT BAT"), two pairs of
  **light towers**, stands with instanced crowd cards, flags, and a night sky with light haze.
- **Light beams:** fake volumetric cones from the light towers (additive meshes with noise), only in
  the backboard region so they never cover the playfield.

## 3. Materials

| Surface | Material notes |
|---------|----------------|
| Playfield | `MeshPhysicalMaterial` (or a TSL equivalent): printed albedo, **clear coat 1.0** with low clear-coat roughness, subtle micro-scratch normal (Ultra), insert cutouts that show lit plastic beneath |
| Inserts | Translucent colored plastic, emissive driven by the lamp controller, plus a soft glow decal on the surrounding playfield |
| Ball | Metalness 1, roughness 0.03–0.06, **dynamic environment reflection** (§ 4), faint scratches/fingerprint roughness map that rotates with the ball so spin is visible |
| Chrome (rails, posts, wireforms, lockdown bar) | Metalness 1, roughness 0.1–0.2, environment-mapped |
| Rubbers | Black or white satin, roughness 0.6, slight specular |
| Plastics / standees | Printed acrylic: art on the front face, clear 3 mm edges with an edge-glow term |
| Pop bumper caps | Translucent colored plastic lit from within, printed label |
| Ramp | Clear acrylic: Fresnel reflection + environment + tinted thin-film color. True transmission only on Ultra. |
| Basepath windows | Clear glass with a refraction-like distortion of the runner channel below and a slight blue tint |
| Wood (cabinet) | Lacquered wood, anisotropic-ish highlights |

## 4. Ball rendering

The ball is the focus of attention for the entire game. It must look like real chrome steel.

- **Reflections:** a dynamic `CubeCamera` follows the ball and renders the scene without the ball.
  Resolution and update rate depend on the quality tier ([04 § 6](04-technical-architecture.md#6-quality-tiers-and-performance-budgets)).
  The Low tier uses a prefiltered static environment map captured from the table.
- **Shadows:** one or two real-time shadow-casting lights (the stadium "key" lights) plus a soft
  contact shadow, giving the multiple soft shadows of real pinball GI.
- **Motion:** above ~5 m/s, a subtle velocity-aligned stretch or short trail (per-object, not
  full-screen motion blur), so fast balls stay readable at 60 Hz.
- **Spin:** the roughness pattern rotates with the physics orientation quaternion.
- **On ramps and wireforms:** reflections pick up the chrome rails. The ball's contact shadow is cast
  onto the ramp surface.

## 5. Asset pipeline: vector first, raster replaceable

You may replace any generated art with raster art later. The pipeline is built around **texture
slots** with a fixed contract.

### 5.1 Slot registry

Each visual texture is a named slot in `assets-src/slots.json`:

```
slot id         playfield.base
size            4096 × 8192 (UV = playfield mm × 7.0 px/mm, origin bottom-left)
color space     sRGB
alpha           none
layers          base, lines, decals, insert-mask
source          assets-src/svg/playfield.base.svg
override        assets-src/raster/playfield.base.png   (wins if present)
outputs         public/tex/playfield.base.{ktx2, webp}
```

**Rules:**

- The SVG sources use the **same coordinate system** as the table definition (mm, scaled). The
  layout exporter generates a guide layer showing every hole, post, insert and wall, so art lines up
  with geometry.
- To replace art, drop a PNG with the same slot name, size and UV layout into `assets-src/raster/`
  and rebuild. Nothing else changes.
- Normal and roughness maps are optional per slot (`playfield.base.normal`, `.rough`).

### 5.2 Build steps

1. Rasterise the SVG at slot size with `resvg`. If a raster override exists, use it instead.
2. Generate mipmaps. Encode **KTX2** (UASTC for the playfield and UI-critical art, ETC1S for crowd
   and background) plus a WebP fallback.
3. Write a manifest with content hashes, so assets can be cached immutably.

### 5.3 Geometry

- **Procedural from the table definition** ([04 § 5](04-technical-architecture.md#5-table-definition-data-driven)):
  walls (extruded outlines with beveled top edges), posts, rubbers (fitted around post groups),
  flippers, pop bumpers, slings, ramps (lofted along splines), wireforms (tubes along splines), the
  mound hump and saucers, drop and standup targets, spinners.
- **Standees:** fielder, pitcher, runner and umpire figures are **extruded from SVG outlines** into
  3 mm acrylic, with art printed on the front. This is fully vector-native and authentically pinball.
  Articulated standees (pitcher arm and leg, fielder glove arm) are built from multiple pivoting parts.
- **Stadium:** generated modular meshes (stands, light towers, scoreboard frame, wall). These can be
  replaced later with authored glTF files (`assets-src/models/*.glb`) under the same slot idea.
- **Environment lighting:** a night-time HDRI for image-based lighting. It is either a CC0 HDRI
  (e.g. Poly Haven; license checked at time of use and recorded in `assets-src/LICENSES.md`) or
  rendered from our own stadium scene.

## 6. Lighting

- **Key lights:** 2 shadow-casting directional/spot lights representing the light towers (left and
  right), plus a dim fill. Low tier uses 1 shadow light for the ball only.
- **GI and inserts:** many small lights. They are not real dynamic lights (too expensive on mobile)
  but emissive surfaces + **additive glow decals** projected onto the playfield, with intensity driven
  by the lamp controller. This gives the "hundreds of bulbs" look cheaply.
- **Bloom** picks up everything emissive: inserts, pop caps, scoreboard LEDs, fireworks.
- **Color grading:** an AgX tone map, then a night-game LUT (cool shadows, warm highlights).

## 7. Camera

- **Player view (default):** fixed, from slightly above and behind the lockdown bar, as in classic
  desktop pinball sims. The FOV and pitch are tuned so the whole playfield is visible with the
  flippers large at the bottom. Separate presets exist for portrait and landscape.
- **No camera motion during a live ball**, except the small nudge shake.
- **Dead-ball moments only:** short cinematic accents such as a push-in on the scoreboard for a HR,
  the inning-change sweep, the attract-mode orbit and the lights-on flyover. They are always
  interruptible and disabled by reduced motion.

## 8. HUD and UI

- **Scoreboard style:** an LED dot-matrix ballpark scoreboard, rendered both in-world (canvas texture
  on the CF scoreboard) and as a HUD element.
  - Portrait: compact line score bar at the top (inning, outs, bases mini-diamond, runs).
  - Landscape: a full side panel with the line score 1–9 and R/H.
- **Callouts:** large, short (≤ 1.2 s) kinetic text: "SINGLE!", "DOUBLE!", "TRIPLE!", "HOME RUN!",
  "OUT — 6-3", "STRIKEOUT", "FOUL OUT", "RALLY ×3", "HOT BAT". They appear in the upper half of the
  screen and never cover the lower playfield during a live ball.
- **Type:** a condensed display face for the scoreboard and callouts (e.g. Oswald or Bebas Neue, OFL),
  plus a dot-matrix shader font for LED elements and Inter for menus. All from Google Fonts or
  self-hosted OFL fonts.
- **Menus:** title/attract overlay, settings, how-to-play (one illustrated screen showing the
  mapping), pause, box score, initials entry, high score table.

## 9. Animation catalog

Mechanical animations must feel like solenoids: **attack in about 15–30 ms, small overshoot, settle**.
Character animations use toy-like squash and wobble.

| Element | Trigger | Animation | Duration |
|---------|---------|-----------|----------|
| Flippers | Input | Physics-driven (no keyframes). The rubber flexes subtly on impact. | Live |
| Slingshots | Switch | Kicker arm strikes, the rubber band deforms (vertex bend), a lamp flash | ~80 ms |
| Pop bumpers | Switch | Ring pulls down, the cap flashes with a color-specific glow, the skirt wobbles | ~120 ms |
| Corner kickers | Switch | Rubber flex plus housing flash, the amber "3B" decal pulses | ~150 ms |
| Drop targets (B-A-T) | Switch | Target snaps down with a slight bounce, letter insert lights. On completion, a "HOT BAT" flame or heat shimmer on the bat icon. Reset pops all three up together. | 60 ms down / 150 ms reset |
| Standups (R-U-N) | Switch | The face flexes back and the letter lights. On completion, the STEAL arrow on the right ramp starts chasing. | ~100 ms |
| Spinners | Ball passes under | Physics-driven spin with motion blur on the plate. Spin count flashes on the orbit arrow. | Live |
| Steal | Right ramp with STEAL lit | The lead runner breaks early and slides into the next bag under the glass, with dirt-spray particles. "SAFE!" callout and the umpire safe signal. | ~1 s |
| HR gate / flag | Ramp crest | The gate flap spins. A red flag pops up on the scoreboard roof. | 1.5 s |
| Fielder saucer catch | Capture | Fielder standee "snaps": glove arm up, lean, dirt or grass puff, ball sinks | ~400 ms |
| Fielder throw | After catch | Throws to the mound with an arm whip. A ball streak arcs to the mound (visual only), and the VUK pop is synced. | ~700 ms |
| Near-miss dive | Ball passes within 15 mm of a saucer at speed | The fielder leans or dives toward the ball, then recovers | ~500 ms |
| Pitcher windup | Pitch staged | Leg kick, arm cock, release synced to the kicker impulse, follow-through | 0.8–1.2 s |
| Pitch-type tell | Before release | Mound lamp FB/CH/CB lights with a quick pulse | 0.6 s |
| Runners | Hit / run | Sprint between bases in the under-glass channel (bobbing standee run cycle), slide into bags on extra-base hits, home plate burst on scoring | Hit-dependent, ~0.4 s per base |
| Run scored | Runner crosses home | Home plate insert burst, scoreboard digit roll, crowd swell | 1 s |
| Strikeout | Center drain | Catcher's mitt graphic "pops," umpire standee on the apron punches out, "K" on scoreboard | 1.2 s |
| Foul out | Outlane | Umpire signals the out, outlane lamps sweep | 1 s |
| Rally build | Rally n ≥ 2 | Rally meter climbs, crowd cards stand up, organ riff at n ≥ 3 | Ongoing |
| Home run | HR gate | Ramp LED chase, light show sweep to center, fireworks over the backboard (GPU particles), scoreboard "HOME RUN" animation, all runners trot home in sequence | 3–4 s (runners and fireworks continue while the ball returns to play) |
| Inning end | 3rd out | Out lamps flash, runners jog off to the dugout, line score update, light sweep | 2 s |
| 7th-inning stretch | Before inning 7 | Crowd wave across the stands, organ interlude | 4 s (skippable) |
| Lights-on intro | Game start | Light tower banks switch on with a clunk, GI warms up (bulb-style ramp), crowd swell | 4 s (skippable) |
| Attract mode | Idle | Looping lamp shows, slow orbit camera, scoreboard high scores | Loop |
| Game over | After the 9th | "FINAL" on the scoreboard, fireworks scaled to runs scored | 4 s |

### 9.1 Systems

- **Timeline/tween engine** (in-house, lightweight): springs and easing for mechanical motion, plus
  sequence composition for celebrations.
- **Lamp show system:** data-driven shows (keyframed lamp groups with priority layers). Shows are
  authored as data, not code. Flash frequency is capped for photosensitivity
  ([01 § 9](01-game-design.md#9-accessibility)).
- **Particles:** GPU-instanced (fireworks, dirt and grass puffs, confetti, camera-flash sparkles).
  Budgets scale with the quality tier.
- **Presentation priority:** gameplay-critical feedback (outcome callout, base lamps) always plays.
  Decorative layers drop first when animations overlap or performance drops.
- **Never block play:** celebrations run *in parallel* with live-ball rallies and never freeze
  physics. The only exceptions are dead-ball sequences (inning end, game over).
