# Efficiency audit: detailed findings

See [README.md](README.md) for the summary, ranking and measurement plan. Paths are relative to
the repository root. "Visual cost" means what a player could see change.

---

## Per-frame GPU work today (reconstructed from the code)

Medium is the default tier for every phone, Safari and the WebGL2 renderer
([quality.ts:116-124](../../../src/render/quality.ts)). This is what one displayed frame costs on
Medium and on High:

| Work                                   | Medium (`reflectionSize 64`, every 2 frames, 1 shadow light 1024²) | High (`128`, every frame, 2 shadow lights 2048²) |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Reflection cube faces (full scene)     | 3 on average                                                         | 6                                                |
| PMREM rebuild of the reflection cube   | every other frame                                                    | every frame                                      |
| Shadow-map passes                      | ~4 (1 light × (1 main + ~3 cube faces))                              | ~14 (2 lights × 7 renders)                       |
| Main scene pass (MRT: colour + emissive, both RGBA16F) | 1                                                    | 1                                                |
| Bloom (high-pass + 5-mip blur + composite, at ½ res) | ~12 small passes                                       | ~12 small passes                                 |
| Grade/output pass + FXAA pass          | 2 full-screen                                                        | 2 full-screen                                    |

The main view, which is what the player sees, is only a small part of this.

---

## F1. Shadow maps are re-rendered on every render call

**Where:** [stage.ts:100-117](../../../src/render/stage.ts) (two `castShadow` key lights);
the reflection cube in [tableView.ts:408-417](../../../src/render/tableView.ts).
In three: `node_modules/three/src/nodes/lighting/ShadowNode.js` `updateBefore()` and
`ShadowBaseNode` (`updateBeforeType = NodeUpdateType.RENDER`).

**Why it costs:** In three r186, `ShadowNode.updateBefore` runs once per `renderer.render()` call
(the update type is `RENDER`, keyed on `renderId`). It redraws the shadow map whenever
`shadow.autoUpdate` is true, which is the default. Its per-camera de-duplication uses `frameId`,
and `Renderer._renderScene` increments `frameId` on every call (`nodeFrame.update()`), so it never
de-duplicates. `CubeCamera.update` makes six `renderer.render` calls, and each one redraws every
shadow map, before the post pipeline's scene pass redraws them again. On High that is
**14 shadow passes of a 2048² depth map a frame**. Each pass draws every shadow-casting mesh,
including the alpha-tested standees.

**Fix:** set `light.shadow.autoUpdate = false` on both key lights. Set `light.shadow.needsUpdate = true`
once per frame, just before `stage.render()` (after `view.updateReflections`). The cube faces then
reuse the previous frame's shadow map. If shadows are not needed in the reflection at all, the
cube camera can render with those lights' `castShadow` temporarily off, but that changes shaders
and recompiles them, so prefer the `needsUpdate` route.

**Visual cost:** none. Shadows in a 64–128 px reflection on a 27 mm ball are one frame old.

**Confidence:** High (read in the three source). Confirm by counting shadow render-target binds,
or by watching `renderer.info.render.calls` fall.

---

## F2. The ball's dynamic reflection is a second (and third) renderer

**Where:** [tableView.ts:393-417](../../../src/render/tableView.ts) (`setReflections`,
`updateReflections`), [main.tsx:780](../../../src/main.tsx), tiers in
[quality.ts:31-90](../../../src/render/quality.ts). In three: `CubeCamera.update` sets
`renderTarget.texture.needsPMREMUpdate = true`. `EnvironmentNode` wraps `envMap` in
`pmremTexture()`, and `PMREMNode.updateBefore` rebuilds the PMREM whenever `pmremVersion` changes.

**Why it costs:**

1. **Six full-scene renders per update.** The cube camera's far plane is 5 m, so each face draws
   everything: the stadium, 900–2200 crowd instances, 600 stars, stands, light shafts, the
   ground, both particle systems, standees and transparent ramps. Each face is a full
   forward-lit PBR pass with clear-coat materials, so it is about as costly per draw as the main
   view.
2. **A PMREM rebuild on every update.** The ball uses `envMap`, so three filters the dynamic cube
   into a PMREM (cube-UV) texture each time it changes. This is a chain of blur passes across all
   mip levels. For a mirror ball (`roughness: 0.04`,
   [tableView.ts:144](../../../src/render/tableView.ts)), almost all of that blurred output is
   never sampled.
3. **It runs when it doesn't need to.** It updates whenever the ball is visible, including a ball
   resting on the plunger during attract mode and (on pause) every frame while nothing moves.

**Fixes (each is independent; together they remove most of the cost):**

- **Limit what the cube sees.** Put the stadium (crowd, stars, stands, shafts, ground, flashes,
  fireworks) and the particle systems on a separate layer, and leave that layer out of the six
  cube cameras' `layers`. The ball still mirrors lamps, rails, flippers, pops and the backboard.
  The rest is sub-pixel in a 64–128 px cube.
- **Shorten the far plane** from 5 m to about 1.5 m, so the backboard is still reflected but
  nothing behind it is drawn.
- **Round-robin the faces.** Render 1–2 faces a frame instead of all six (a manual loop over
  `renderer.setRenderTarget(target, face)`), so the full cube refreshes every 3–6 frames. At
  pinball speeds that is not visible on a 27 mm ball, and it spreads the cost evenly instead of in
  spikes.
- **Skip the PMREM rebuild.** For a near-mirror, sample the cube directly with a custom TSL node
  on the ball material (`cubeTexture(target.texture, reflectVector)`) instead of going through
  `envMap`, which forces PMREM. Mix it with the static `scene.environment` contribution if needed.
  This removes the blur chain entirely.
- **Only update when the image would change.** Skip when the ball has moved less than about 2 mm
  since the last update and no lamp state changed, and skip whenever `loop.paused` is set.
- **Per-tier policy:** Medium at 64 px every 4th frame with round-robin; High at 128 px every 2nd
  frame. Low already uses the static environment.

**Visual cost:** none to negligible with layers, the shorter far plane and the skip rules. Round-
robin adds a 2–5-frame lag to the reflection, which is not noticeable on a fast, tiny mirror
sphere. Compare screenshots of the ball on the plunger and under the pops.

**Confidence:** High for the mechanism. Size: measure with `renderer.info`. This is probably the
largest single GPU cost on mobile.

---

## F3. No frame-rate cap

**Where:** [main.tsx:717-735](../../../src/main.tsx) (the `requestAnimationFrame(tick)` loop).

**Why it costs:** rAF runs at the display's refresh rate: 90/120 Hz on most current Android
phones, ProMotion iPads and Macs, and high-refresh laptop panels. iOS Safari on ProMotion iPhones
caps rAF at 60 by default, but other browsers and devices don't. At 120 Hz every cost in this
document doubles. Physics doesn't care, because it runs at a fixed 1 kHz with timestamped
inputs ([loop.ts](../../../src/app/loop.ts)), so draws above 60 buy only extra smoothness.

**Fix:** a frame limiter in `tick`. Keep requesting rAF, but skip `frame()` when less than about
15.5 ms has passed since the last drawn frame (use a small tolerance so 60 Hz displays never skip).
Physics catches up through the fixed loop as it already does. Add a Settings option, "Frame rate:
60 (saves battery) / Max", that defaults to 60 on mobile and on battery-powered laptops and to Max
on desktop.

**Visual cost:** none on 60 Hz displays. On 120 Hz displays, motion is a little less smooth when
capped, which is why it is a setting.

**Confidence:** High.

---

## F4. Full-rate rendering on static screens

**Where:** [main.tsx:739-823](../../../src/main.tsx) runs the whole frame whatever the screen is.
Panels in [App.tsx](../../../src/ui/App.tsx) (pause, settings, how-to, game over, scores). The
backdrop blur is at [style.css:547-548](../../../src/style.css).

**Why it costs:** while paused (`loop.paused`), the 3D scene is frozen except for stadium
details: the marquee chase, camera flashes, tower flicker. The game still redraws everything,
including the reflection cube (F2) and all its passes, 60–120 times a second. The `.panel` glass
uses `backdrop-filter: blur(10px) saturate(1.3)` over the WebGPU canvas. Because the canvas
changes every frame, the compositor recomputes the blur every frame at full resolution, which
is costly on mobile GPUs. Players often leave a game paused, so this can be a lot of battery
time.

**Fix:** render on demand when nothing is live.

- **Paused / settings / how-to / game over / scores:** draw one frame on entering the screen, then
  stop calling `stage.render()`. Keep the input poll and the UI running. WebGPU and WebGL canvases
  keep their last presented image. If the marquee should keep chasing behind the pause menu,
  redraw at about 10–15 fps instead of stopping.
- **The watchdog** must skip checks while rendering is intentionally stopped. `CanvasProbe` can
  only read the drawing buffer in the same task as a draw ([resilience.ts:101-103](../../../src/app/resilience.ts)),
  so probing a canvas that was not drawn this frame can return a false "blank" and escalate to a
  rebuild or the WebGL2 fallback. Only probe right after a deliberate redraw.
- The resume countdown already re-syncs the loop, so physics needs no change.

**Visual cost:** none (the 3D scene is static there). The blur then costs nothing per frame,
since the content under it no longer changes.

**Confidence:** High.

---

## F5. The watchdog reads the whole frame back twice a second

**Where:** [resilience.ts:91-117](../../../src/app/resilience.ts) (`CanvasProbe`), called every
30 frames from [main.tsx:811](../../../src/main.tsx).

**Why it costs:** `hasContent()` draws the WebGPU/WebGL canvas into a 2D context created with
`willReadFrequently: true`, which forces a CPU-backed canvas. To draw a GPU canvas into a CPU
canvas, the browser must finish all queued GPU work and copy the **full-resolution** frame to
system memory before scaling it to 8×8. That is a pipeline stall and a copy of several MB, every
0.5 s for the whole session. On tile-based mobile GPUs a forced flush also breaks the
CPU/GPU overlap, which can show up as a hitch every half-second.

**Fix (keep the watchdog, it earns its place):**

- **Back off once healthy:** check every 0.5 s for the first ~10 s after start-up, a quality change,
  a resize or a recovery. After that, check every 5 s. Return to the fast rate as soon as a check
  fails.
- Drop `willReadFrequently` on the probe context, so the browser can scale on the GPU and read back
  only 8×8 pixels. Check on Safari that this still detects the blank state it was built for.
- Optionally probe only on the backends where the blank-canvas bug has been seen (Safari / WebGPU).

**Visual cost:** none. Recovery from a blank canvas takes longer once the game has been healthy
for a while (~5–10 s instead of ~1–4 s), which is acceptable for a rare fault.

**Confidence:** High for the mechanism; the cost per probe varies by browser, so measure it.

---

## F6. Attract mode is as costly as play

**Where:** [main.tsx:276-283](../../../src/main.tsx) (`attract`), orbit at
[main.tsx:768-770](../../../src/main.tsx) and [stage.ts:352-366](../../../src/render/stage.ts).

**Why it costs:** the title screen runs the full pipeline, including the reflection cube for a
ball that is sitting still on the plunger, behind a blurred `.panel` (F4). It also runs 1 kHz
physics for that resting ball (F17). The title screen can stay up for a long time while the player
reads or looks away.

**Fix:** on top of F2 (skip reflection updates for a resting ball) and F3 (60 Hz cap), draw
attract mode at 30 fps on the Medium and Low tiers. The slow orbit (0.15 rad/s), the lamp chases
and the marquee all still read well at 30. Also consider pausing attract after about 2 minutes
with no input (stop rendering, as in F4, and resume on any input), as cabinets dim their attract
shows.

**Visual cost:** minor (30 fps orbit) on lower tiers only; none on High.

**Confidence:** High.

---

## F7. The playfield fragment shader does avoidable math on the largest surface

**Where:** [tableView.ts:66-99](../../../src/render/tableView.ts) (`GI_POOLS`,
`playfieldMaterial`).

**Why it costs:** the playfield covers most of the screen. Its `colorNode` evaluates seven
Gaussian pools (`exp(-dot(d,d))` each), three `smoothstep`s and several `mix`es per pixel. This is
on top of the clear-coat PBR, two shadow lookups (5 PCF taps each) and environment lighting.
Everything except the `giLevel` uniform is static.

**Fix:** bake the static parts into a small two-channel texture (for example 128×256, RG8 or
RG16F): R = `shade` (the edge and top falloff), G = the sum of the pools. The shader becomes
`gi = vec3(R * mix(0.4, 1, giLevel)) + warm * G * giLevel`, which is one texture fetch instead of
seven `exp`s. Generate it at load on a 2D canvas or with a one-off GPU pass.

**Visual cost:** none (the gradients are smooth; a bilinear 128×256 map reproduces them exactly).

**Confidence:** Medium. The saving is real, but its share of the frame depends on the GPU.

---

## F8. The crowd bounce runs on the CPU

**Where:** [stadium.ts:265-290](../../../src/render/stadium.ts) (`tick`, the bounce loop).

**Why it costs:** after every hit, `energy` decays at 0.25/s, so the loop runs for up to about
4 s per hit, plus the 7th-inning wave. Each frame it copies and edits all 900–2200 instance
matrices with a `sin` and an `exp` per fan, then uploads the whole instance buffer (up to about
140 KB a frame). In an active game it runs for a large share of play time.

**Fix:** move the hop and the wave to the vertex shader, as the marquee already does
([stadium.ts:674-693](../../../src/render/stadium.ts)). Add uniforms `energy`, `clock` and `waveX`.
Derive the per-fan phase from `instanceIndex` and read the base x from the instance matrix
(`positionWorld` or the matrix's translation column). Compute
`z += max(0, sin(clock*(5+phase*3)+phase*6.28))*0.005*energy + exp(-dx²)*0.012`. The instance
buffer then never changes after `setCrowd`.

**Visual cost:** none (same formula).

**Confidence:** High.

---

## F9. Audio burns power while muted or idle

**Where:** [engine.ts:83-117, 172-188](../../../src/audio/engine.ts),
[sfx.ts:403-416](../../../src/audio/sfx.ts) (`RollSound.update`),
[crowd.ts:50-57](../../../src/audio/crowd.ts) (`setIntensity`), called every frame from
[director.ts:440-450](../../../src/fx/director.ts) and [main.tsx:757-758](../../../src/main.tsx).

**Why it costs:**

- **Muted** (`M`, or master volume 0) only sets the master gain to 0. The `AudioContext` keeps
  running: two looping noise beds with LFOs, the roll loop with three filters, and the compressor.
  The audio thread wakes every few milliseconds (it uses the `interactive` latency hint) for
  output nobody hears.
- **Automation spam:** `RollSound.update` calls `setTargetAtTime` five times per frame, and
  `Crowd.setIntensity` twice per frame, whether or not the value changed. That is about 420
  automation events a second at 60 Hz and about 840 at 120 Hz, each inserted into the audio
  thread's timeline.

**Fix:**

- When muted or at master volume 0, suspend the context (`ctx.suspend()`, the same path as
  pause). Resume when sound is turned back on. A bus at 0 (for example, crowd volume 0) can stop
  its sources.
- Only schedule a new target when it differs meaningfully from the last one sent: for example,
  gain by more than 0.01, filter frequency by more than 2 %, or pan by more than 0.02. Crowd
  intensity changes only on game events, so compare it to the last value and return early.
- When no ball is live (attract, paused, between balls), set the roll layers to 0 once and stop
  updating.

**Visual cost:** none. **Audio cost:** none. Keep `latencyHint: 'interactive'`, because the
flipper sounds need it.

**Confidence:** High.

---

## F10. HUD and CSS repaint more than they need to

**Where:** [main.tsx:772-777](../../../src/main.tsx) (`snapshot.value = snap` every 100 ms),
[game.ts:723-747](../../../src/rules/game.ts) (`snapshot()` builds a fresh object),
`Hud` in [App.tsx:83](../../../src/ui/App.tsx), [style.css:613-624](../../../src/style.css)
(`cta-glow`).

**Why it costs:**

- `snapshot()` returns a new object every time, so the signal always fires and the HUD re-renders
  and re-diffs 10 times a second, even when nothing changed. Glowing chips and `drop-shadow`
  filters make each repaint costlier.
- `cta-glow` (on the title screen's "Press Enter or tap to play") animates `box-shadow`, and
  `.cta` also has a `text-shadow`. Animating `box-shadow` repaints on the main thread every frame,
  over the canvas.

**Fix:**

- Have `GameRules` keep a `version` counter that it bumps whenever any snapshot field changes.
  Only publish when the version differs (or shallow-compare the fields).
- For the glow, animate the `opacity` of a `::after` pseudo-element that carries the
  `box-shadow`, which is compositor-only. `pulse` already animates only opacity, which is fine.

**Visual cost:** none.

**Confidence:** High.

---

## F11. Per-frame allocations (GC hitches)

**Why it costs:** garbage collection on mobile Safari and Chrome can pause the main thread for
5–20 ms, which shows as a dropped frame in the middle of play. The allocations below happen every
frame, or 1000 times a second where marked.

| Where | What is allocated |
| ----- | ----------------- |
| [main.tsx:746-748](../../../src/main.tsx), [game.ts:750](../../../src/rules/game.ts) | `rules.lamps()` builds a ~30-key object with template-string keys |
| [main.tsx:747](../../../src/main.tsx), [lampShows.ts:258-270](../../../src/fx/lampShows.ts) | `overrides()` builds 2 `Map`s, and `evaluate()` 1 more per running show |
| [main.tsx:754, 774](../../../src/main.tsx) | `rules.snapshot()` (object + `walkHit` array), twice on HUD frames |
| [tableView.ts:496-497](../../../src/render/tableView.ts) | `new Quaternion()` ×2 |
| [tableView.ts:549](../../../src/render/tableView.ts) | `new Matrix4()` in `updateTrail` |
| [stadium.ts:725](../../../src/render/stadium.ts), [stadium.ts:273](../../../src/render/stadium.ts) | `new Matrix4()` in `tickFlashes` (every frame) and in the bounce loop |
| [stage.ts:355-358](../../../src/render/stage.ts), [stage.ts:370](../../../src/render/stage.ts) | `clone()` ×2 and `new Vector3` per frame in attract orbit and shake |
| [figures.ts](../../../src/render/figures.ts) `pathPoint` | `clone()` per running runner |
| [main.tsx:255](../../../src/main.tsx) (1 kHz) | `world.balls.find(...)` closure in `afterStep` |

**Fix:** hoist scratch objects to fields or module scope. Make `lamps()` fill a reused object
and `overrides()` fill reused maps, then clear them. Compute the snapshot once per frame and reuse
it for the HUD. Only call `lamps()`/`overrides()` when the rules state or a show actually changed
(the shows know their own step times).

**Visual cost:** none.

**Confidence:** High for the allocations; how much GC they cause depends on the device.

---

## F12. Material uniforms rewritten every frame

**Where:** [tableView.ts:475-485](../../../src/render/tableView.ts) (light loop),
[main.tsx:748, 762-763](../../../src/main.tsx).

**Why it costs:** every lamp, pop cap, target and halo (about 70 materials) gets
`emissiveIntensity` or `opacity` written every frame, even when the value is unchanged (most lamps
are steady most of the time). Each changed material uniform means a buffer write before drawing.
`setLamp` is called for every lamp every frame too.

**Fix:** compare before assigning (`if (m.emissiveIntensity !== v) m.emissiveIntensity = v`). Skip
lights whose `level` is 0 and whose mode is not `blink` once they have settled.

**Visual cost:** none. **Confidence:** Medium (depends on how three batches uniform uploads).

---

## F13. Draw calls that could be merged or instanced

**Where:** [stadium.ts](../../../src/render/stadium.ts) `buildCabinet`, `buildGround`,
`buildTowers` and `buildSky`, and the lamp and pop builders in
[tableView.ts:695-722, 929-963](../../../src/render/tableView.ts).

**Why it costs:** each draw call costs CPU (bind groups, pipeline state) in every pass that draws
it: main, shadows and up to six cube faces. Examples:

- **Tower bulbs:** 12 separate meshes sharing one material → 1.
- **Stand tiers:** 7 boxes sharing one material → 1.
- **Cabinet rails, trims, pinstripes, legs, body sides and front:** about 15 meshes across 4
  materials → about 4.
- **Lamps:** 22 inserts and 22 halos, each with its own material for intensity. They could be one
  `InstancedMesh` for circle inserts, one for arrows and one for halos, with per-instance colour
  and an intensity attribute driven from `view.update` (6 pop halos too). That is about 50 draw
  calls → 3–4.

**Fix:** merge the static stadium pieces with `mergeGeometries`, as `TableView.flushStatic` already
does for the table. Instance the lamps. This roughly halves the scene's draw calls (an estimate:
confirm with `renderer.info.render.calls`).

**Visual cost:** none. **Effort:** stadium merge is small; lamp instancing is medium.

---

## F14. FXAA at Retina pixel ratios

**Where:** [stage.ts:173-187](../../../src/render/stage.ts), `fxaa: true` on Medium and High in
[quality.ts](../../../src/render/quality.ts).

**Why it costs:** FXAA needs its input in a texture, so it adds an extra full-resolution target
write and a full-screen pass with about nine taps per pixel. At an effective pixel ratio of 2 or
more, edge aliasing is already hard to see, so it adds little.

**Fix:** turn FXAA on only when the pixel ratio actually applied (after the tier cap and pixel
budget) is below about 1.75. Changing it rebuilds the post chain (`setPost`), so decide it at
start-up and from Settings only, never live.

**Visual cost:** negligible on Retina phones; check thin wire rails and ramp edges in a
screenshot comparison. **Confidence:** Medium.

---

## F15. Scene pass bandwidth (MRT)

**Where:** [stage.ts:130-139](../../../src/render/stage.ts).

**Why it costs:** the scene pass writes two full-resolution RGBA16F targets (colour + emissive for
selective bloom), which is 16 bytes a pixel before any overdraw from the transparent ramps,
halos, shafts and particles. On tile-based mobile GPUs, bandwidth like this is a main driver of
power use.

**Options (each needs a visual check):**

- Store the emissive target in 8-bit (scaled, for example by ÷8, and unpacked in the bloom
  input). The emissive buffer only feeds a blurred bloom, so 8-bit precision is enough. Check the
  MRT texture `type` options in three r186.
- Or drop the emissive MRT on Medium and feed the bloom from a luminance threshold on the colour
  target, which the `glint` term already half does. This changes the look: bright white plastics
  would glow too. Only consider it if measurements show bandwidth is the bottleneck.

**Confidence:** Medium. Measure first; this is the riskiest change to the look.

---

## F16. Adaptive quality ignores sustained load, thermals and battery

**Where:** [quality.ts:135-165](../../../src/render/quality.ts).

**Why it matters:** the controller steps down only when the median frame is slower than ~33 ms
(under 30 fps), and never steps up. A phone that holds 60 fps at Medium keeps drawing at full cost
until it heats up and throttles, at which point the player sees jank before any step down. Frame
time at vsync also hides GPU headroom: 16.7 ms looks the same whether the GPU is 30 % or 95 % busy.

**Options:**

- On mobile, also step down (resolution only, as now) when the median stays above ~20 ms (under
  ~50 fps) for 5 s or more. That catches thermal throttling before it becomes visible.
- Where `timestamp-query` is available, use measured GPU time rather than frame time.
- Add a **Battery saver** setting that combines the 60 Hz cap (F3), the Medium tier, reflections
  updated every 4–6 frames, and 30 fps attract. On Chromium, `navigator.getBattery()` could
  suggest it when the device is unplugged and below 20 %.

**Visual cost:** a policy choice, made by the player. **Confidence:** Medium.

---

## F17. Physics runs at full rate while nothing moves

**Where:** [loop.ts:48-80](../../../src/app/loop.ts), [world.ts:537-561](../../../src/physics/world.ts).

**Why it costs:** 1000 steps a second (about 16 per frame), each with two collision passes,
while the ball rests on the plunger in attract mode or sits in a saucer. The physics test budget
is under 20 µs per step on a dev machine, so at about 3–5× slower on a phone this is roughly
1–1.5 ms of CPU per frame for no change.

**Fix:** a "sleep" fast path. If every ball is at rest (speed below about 1 mm/s), either parked
or resting in the plunger lane, no flipper is moving or pressed, no input is queued, and no
device timer is pending, advance `simWall` and `world.time` without calling `step()`. Any input or
rules event wakes it. Be conservative: rules timers read `world.time`, so time must still advance.

**Visual cost:** none. **Confidence:** High for the cost; take care with timer-driven devices.

---

## F18. Smaller items

- **Gamepad polling** ([input.ts:206](../../../src/input/input.ts)): `navigator.getGamepads()` runs
  every frame. Start polling only after a `gamepadconnected` event, or after any `getGamepads()`
  call has returned a pad.
- **Emissive-only objects on lit materials:** scoreboard, backboard, camera flashes, particles and
  marquee bulbs use `MeshStandardMaterial` with a black base colour and an emissive map. The
  flashes and particles get nothing from lighting. Caveat: selective bloom reads the `emissive`
  MRT output, so an unlit replacement must still write emissive (for example, a
  `MeshBasicNodeMaterial` with an explicit emissive MRT output). Check the bloom before and after.
- **Shadow casters:** small parts such as the pivot, the plunger and the drop-target plates cast
  into a 1024–2048 map where their shadows are a few texels. Check which casters' shadows are
  actually visible, and turn `castShadow` off for the rest. This changes nothing visually if
  chosen carefully.
- **Bloom:** five mip levels at ½ resolution. Four levels on Medium would save a few small
  passes, but it changes the glow's reach, so only do it after a side-by-side comparison.
- **Trail:** 24 instanced spheres rebuilt every frame while the ball is fast. This is cheap, but
  the matrix allocation (F11) is avoidable.
- **Shadow PCF:** in r186 it is a 5-tap Vogel disk per light, which is fine. No change needed.
- **Texture sizes:** the playfield at 2048 px (4096 only on Ultra) and the standee atlas at
  600 px are already sensible.
