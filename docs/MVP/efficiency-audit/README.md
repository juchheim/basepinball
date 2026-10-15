# Efficiency audit: frame rate and battery

Audit date: 2026-10-15 · branch `bullpen-reliever` @ `2c3f782` · three r186 (WebGPU renderer, TSL)

**Goal:** raise frame rate and cut power draw, mainly on phones where the game drains the battery
fast, without giving up visual quality. This is an audit only: no code was changed. Each finding
in [findings.md](findings.md) gives the code location, why it costs power, a proposed fix, what
the fix does to visuals, effort, and how confident the finding is.

## Status

- **F1, F2:** done (`3071e5b`).
- **F3–F6:** done, with these differences from the findings:
  - Frame pacing lives in `src/app/pacing.ts`, with a new Settings option: Frame rate (Auto / 60 / Max).
  - The menus draw at 10 fps rather than stopping entirely.
  - F5 keeps `willReadFrequently` until the probe can be tested on Safari without it.
  - F6's idle shutdown of attract mode after 2 minutes is not done.
- **F7, F8:** done.
  - F7: the GI is baked into a 128×256 half-float texture. The rendered frame matches the original
    to a mean of 0.0015/255.
  - F8: the crowd's bounce and wave run in its vertex shader. They match the old CPU motion within
    capture noise.
- **F9, F10:** done.
  - F9: muted audio (or master volume at 0) suspends the audio context. The roll loop and crowd bed
    only schedule changes.
  - F10: the HUD gets a snapshot only when it changed. The title button's glow animates
    `opacity` instead of `box-shadow`.
  - Left out: stopping a bus's sources when that bus alone is at 0.
- **F11, F13, F16:** done.
  - F11: the frame loop no longer allocates. Lamp state, lamp shows, scratch vectors and
    matrices are reused, and the game snapshot is built ~10 times a second.
  - F13: the lamp inserts and halos are batched into three instanced meshes (`src/render/lampBatch.ts`),
    and the static stadium parts are merged. Medium draws went from 242 to 154 a frame, and the
    image is unchanged apart from the clock-driven marquee.
  - F16: on phones, quality steps down after about 5 s under 50 fps. There's a new Settings option,
    Battery saver: Medium quality at most, 60 fps at most, a 30 fps title screen and a slower
    reflection refresh.
  - Partly from F12: a light's material is only written when its intensity changes.
  - Left out of F16: GPU-timestamp measurement and the `getBattery()` suggestion.
- **F14, F15, F17, F18:** open.

## Headline

Most of the GPU work each frame does not go into the image the player sees. On the default
**Medium** tier (every phone, Safari, and WebGL2), and more so on **High**:

1. **Every `renderer.render()` call redraws the shadow maps** (F1). three r186 updates shadow
   maps once per render *call*, not once per frame, and the ball's reflection cube camera makes six
   render calls. On High that is about 7 scene renders × 2 shadow lights = **~14 shadow-map passes
   a frame**, where 2 would do. On Medium it is about 4 a frame, where 1 would do.
2. **The ball's dynamic reflection re-renders the whole scene six times and re-filters it**
   (F2). Each update draws all six cube faces, including the 900–2200-figure crowd, the stands,
   stars and particles. It then triggers a **full PMREM regeneration**, which is dozens of extra
   blur passes, because `CubeCamera.update` sets `needsPMREMUpdate`. High does this every frame and
   Medium every other frame, even when the ball is parked on the plunger in attract mode. On mobile
   this is probably costlier than drawing the main view.
3. **Rendering never slows down.** The game draws at the display's full refresh rate (120 Hz on
   many Android phones, iPads and laptops) and keeps doing so on the pause, settings, how-to-play
   and game-over screens, where nothing in the 3D scene needs to move. Those screens also have a
   `backdrop-filter: blur` panel over a canvas that changes every frame, so the blur is recomputed
   every frame too (F3, F4).
4. **The blank-canvas watchdog reads the whole frame back to the CPU twice a second** (F5). That
   means a GPU→CPU sync stall and a full-resolution copy every 0.5 s for the whole session.

Fixing those four has no visible cost and should give most of the available gain. Everything
else is a smaller, steady drain: per-frame allocations and GC pauses, a CPU-animated crowd, audio
automation spam, and HUD re-renders.

## Ranked findings

Impact is the estimated share of per-frame GPU or CPU work, or of idle power. Confidence:
**High** = confirmed in the source (ours or three's); **Medium** = mechanism confirmed, size
needs measuring.

| #   | Finding                                                                                                  | Impact      | Visual cost                        | Effort | Conf.  |
| --- | -------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------- | ------ | ------ |
| F1  | Shadow maps re-rendered on every render call (×7 on High, ×4 on Medium)                                  | **Very high** | None                             | S      | High   |
| F2  | Ball reflection: 6 full-scene faces + PMREM rebuild per update; whole stadium included                   | **Very high** | None to negligible               | M      | High   |
| F3  | No frame-rate cap: 120 Hz rendering on high-refresh displays                                             | **High**    | None at 60; optional "120 Hz" toggle | S      | High   |
| F4  | Full-rate rendering on pause, settings, how-to and game-over screens (and blur recomputed under panels)    | **High** (idle) | None                           | S–M    | High   |
| F5  | Watchdog reads back the full canvas 2×/s (GPU sync stall)                                                | Medium–High | None                               | S      | High   |
| F6  | Attract mode renders at full rate with the reflection cube refreshing for a parked ball                    | Medium–High | None to minor                      | S      | High   |
| F7  | Playfield shader evaluates 7 `exp()` GI pools and shading curves per pixel on the largest surface         | Medium      | None (bake to a texture)           | S–M    | Medium |
| F8  | Crowd bounce animated on the CPU: 2200 matrices rebuilt and uploaded every frame for ~4 s after each hit | Medium      | None (move to vertex shader)       | M      | High   |
| F9  | Audio: context runs while muted; ~7 `setTargetAtTime` calls per frame regardless of change               | Medium (idle) | None                             | S      | High   |
| F10 | HUD signal republished 10×/s with a fresh object; `box-shadow` keyframe animation repaints every frame    | Low–Medium  | None                               | S      | High   |
| F11 | Per-frame allocations (snapshots, lamp maps, quaternions, matrices, vectors) → GC hitches               | Low–Medium  | None                               | S–M    | High   |
| F12 | ~70 material uniforms rewritten every frame, changed or not                                              | Low         | None                               | S      | Medium |
| F13 | Draw calls: ~25 unmerged static stadium meshes; ~50 lamp/halo meshes with one material each              | Low–Medium  | None                               | M      | Medium |
| F14 | FXAA (extra full-screen pass + target) also runs at Retina pixel ratios, where it adds little            | Low–Medium  | Negligible at DPR ≥ 2 (verify)     | S      | Medium |
| F15 | MRT scene pass writes two full-res RGBA16F targets (bandwidth on tiled mobile GPUs)                     | Medium      | Needs care                         | M–L    | Medium |
| F16 | Adaptive quality only steps down below ~30 fps and never considers thermals or battery                   | Medium (long sessions) | Policy choice           | M      | Medium |
| F17 | Physics runs 1000 steps/s while everything is at rest (attract, ball on plunger)                         | Low         | None                               | S–M    | High   |
| F18 | Smaller items: gamepad polling with no pad, emissive-only lit materials, shadow casters, bloom mips      | Low         | None to minor                      | S      | Medium |

## Suggested order

1. **Measure a baseline first** (see below), so each change can be credited.
2. **F1 + F2 together.** They interact: once the cube camera stops triggering shadow updates and
   PMREM rebuilds, the remaining reflection cost becomes clear. This is the biggest single win for
   the least visual risk.
3. **F3 + F4 + F6:** frame pacing (a 60 Hz cap, on-demand rendering on static screens, a lighter
   attract mode). This is the biggest battery win in menus and idle time.
4. **F5:** watchdog backoff.
5. **F9, F10, F11, F12:** small, independent, low-risk CPU cleanups. Do them together.
6. **F7, F8:** move work off the per-pixel path and off the CPU.
7. **F13–F18** as time allows, each checked against a before/after screenshot.

## What is already good (keep it)

- Physics runs at a fixed step, apart from the frame rate, with timestamped inputs
  ([loop.ts](../../../src/app/loop.ts)), so capping or skipping frames does not change gameplay or
  flipper timing.
- MSAA is off below Ultra; the canvas itself has no MSAA; pixel count is capped per tier.
- Static table geometry is merged per material; the marquee chase is animated on the GPU.
- Scoreboard canvas redraws only when its contents change; the HUD is throttled to 10 Hz.
- The game pauses on blur and on a hidden tab; audio fades and suspends; `requestAnimationFrame`
  stops when the tab is hidden.
- Live quality steps change only resolution and crowd size, so they never trigger a shader
  recompile.

## How to measure

Collect these before and after each change, on at least one iPhone (Safari, WebGPU), one Android
phone with a 90/120 Hz screen (Chrome), and a laptop on battery:

- **Frame rate and CPU frame time:** the `?debug` overlay already shows fps and physics µs.
  Add `renderer.info.render.calls`, `renderer.info.render.triangles` and the number of
  `renderer.render` calls per frame. For F1 and F2, the render-call count is the clearest sign of
  improvement.
- **GPU time:** Chrome DevTools → Performance (GPU track); Safari Web Inspector → Timelines →
  Rendering Frames. On WebGPU, `timestamp-query` (if available) can time each pass.
- **Power:** use the same scenario every time (5 min of attract, 10 min of play, 5 min paused) at
  fixed screen brightness, with the battery % recorded before and after. On a Mac, use Activity
  Monitor → Energy Impact for the browser tab. On iOS, use Xcode Instruments → Energy Log with the
  device attached. On Android, use `adb shell dumpsys batterystats` or Perfetto (GPU frequency
  and CPU time).
- **Thermals:** note the fps after 15 minutes of continuous play. Throttling, not peak fps, is what
  players notice on phones.
