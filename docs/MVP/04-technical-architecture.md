# 04 — Technical Architecture

## 1. Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript** (strict) | Type safety across physics, rules and table data |
| Build / dev server | **Vite** | Fast hot reload (including table-data hot reload), static output for Vercel |
| Rendering | **Three.js**, `WebGPURenderer` with automatic **WebGL2 fallback**. The version is pinned in M0. | Largest ecosystem, physically based rendering (PBR) materials, the TSL node system for custom shaders and post-processing, and a small runtime |
| Post-processing | Three.js TSL post nodes: bloom, AgX tone mapping, a color-grading LUT, FXAA/SMAA, vignette | Shared code path for WebGPU and WebGL2 |
| Physics | **Custom pinball engine** (TypeScript) | See [03-physics](03-physics.md) |
| UI (HUD, menus) | **Preact + @preact/signals**, as a DOM overlay | Small (~5 KB). DOM text is crisp and accessible. Stays out of the render hot path. |
| Audio | **Web Audio API** with a thin in-house wrapper | Sample-accurate control, ball-roll modulation, ducking. See [06-audio](06-audio.md). |
| Input | Keyboard, Pointer Events, Gamepad API, optional DeviceMotion | |
| Persistence | `localStorage` (versioned JSON) | High scores, settings, lifetime stats |
| Dev tools | Tweakpane (parameter panel), stats overlay, physics debug renderer | Dev builds only |
| Tests | **Vitest** (unit, physics scenarios, golden replays), **Playwright** (smoke tests, frame-time checks in headless Chromium) | |
| Lint / format | ESLint + Prettier (or Biome; decided in M0) | |
| Asset pipeline | `@resvg/resvg-js` (SVG → PNG), KTX2/Basis compression (`toktx` / `basisu`), `gltf-transform` | See [05](05-art-and-animation.md) |
| Hosting | **Vercel**, static | Preview deploy for every branch/PR |
| Backend | **None in MVP** | Future: Cloudflare Workers + D1 (see § 10) |

### Alternatives considered

- **Babylon.js:** excellent, and includes Havok, but we are not using a general physics engine. It is
  also heavier. Three.js plus custom physics is leaner.
- **PlayCanvas:** strong, but editor-centric. The data-driven table definition is easier to manage in
  plain code.
- **React Three Fiber:** good for scene composition, but the game loop and hot paths should not go
  through React reconciliation. Preact is used only for 2D UI.
- **WebGPU-only:** too risky across browsers and older phones. Three.js falls back to WebGL2
  automatically, so we write once.

## 2. High-level architecture

```
          ┌────────────┐   timestamped inputs
 Input ──▶│ InputHub   │───────────────────────┐
          └────────────┘                       ▼
                                   ┌──────────────────────┐
                                   │  Sim (fixed 1 kHz)   │
          coil commands ──────────▶│  Physics engine      │
          (kick, pitch, magnet)    │  + device models     │
                                   └─────────┬────────────┘
                                             │ switch events (id, t)
                                             ▼
                                   ┌──────────────────────┐
                                   │  Rules engine        │  pure TS state machine
                                   │  (baseball game)     │  (no rendering, no DOM)
                                   └─────────┬────────────┘
             ┌──────────────────┬────────────┼─────────────────┐
             ▼                  ▼            ▼                 ▼
      Lamp controller     FX / Anim      Audio engine      UI store (signals)
      (shows, inserts)    director       (SFX, crowd)      → Preact HUD/menus
             └──────────────────┴─────┬──────┘
                                      ▼
                          Renderer (display rate, interpolated)
```

### 2.1 Switch / coil / lamp model

The software mirrors real pinball hardware design (a switch matrix feeding a rules computer that
drives coils and lamps):

- **Switches:** physics devices emit `SwitchEvent { id, closed, simTime }`. Examples: `pop.1B.a`,
  `saucer.SS`, `drain.center`, `gate.HR`, `flipper.L.eos`, `swing.L`.
- **Rules:** the rules engine consumes switch events in time order and updates game state (state
  machine in [01 § 4.2](01-game-design.md#42-ball-states-at-bat-state-machine)).
- **Coils:** the rules issue `CoilCommand`s back to the sim: `vuk.mound.fire`, `pitch.fire(template)`,
  `kickback.fire`, `magnet.curve.profile(...)`, `ball.capture(saucerId)`, `ball.serve(shooter)`.
- **Lamps and shows:** the rules issue lamp states and named show triggers. The lamp controller
  layers shows by priority.
- **Presentation events:** the rules emit high-level events (`HIT{type}`, `OUT{pos}`, `RUN_SCORED`,
  `RALLY{n}`, `INNING_END`, …). The FX director, audio and UI subscribe to them.

Benefits: the rules engine is pure and fully unit-testable without graphics. The sim bot can run
physics and rules headless in Node at hundreds of times real-time. Presentation is decoupled from
logic.

### 2.2 Local Vs AI mode

The start menu selects Single Player or Vs AI. Vs AI alternates top and bottom halves in the same
`GameRules` and `World`: a physics-driven bot operates the AI's top half, then the human plays the
bottom half. `GameRules` tracks batting side and independent team stats while preserving the usual
rules and physics event path. Easy, Medium and Hard vary the bot's reaction likelihood, response
delay, and cradling. A missed reaction stays a miss instead of causing a delayed paddle press. The
same bot controller is also used by the headless balance simulator. This is local play; no network
service or backend is required, and it is not online multiplayer.

## 3. Game loop

- `requestAnimationFrame` drives frames. Each frame:
  1. Drain the input queue and timestamp each event in simulation time.
  2. Run *N* fixed 1 ms physics steps, applying inputs and coil commands at their exact step.
  3. Dispatch switch events → rules → coil, lamp and presentation events.
  4. Update animations and the lamp controller (on display time).
  5. Render with interpolation α = accumulator / step.
- High-refresh displays (120/144 Hz) are supported natively. Physics is independent of frame rate.
- `visibilitychange` / `blur` → auto-pause. On resume: a 3-2-1 countdown, then the clock is reset (no
  catch-up burst).

## 4. Module layout (proposed)

```
src/
  app/            bootstrap, loop, scene manager, pause, settings
  core/           math (incl. deterministic trig), seeded RNG, event bus, timing
  physics/        engine, ball, colliders, broadphase, materials, devices (flipper, pop, sling,
                  saucer, drop target, standup, spinner, gate, magnet, kicker), ccd, debug
  table/          table definition schema + BasePinball table data (layout, devices, lamps, switches)
  rules/          baseball game state machine, base running, pitching director, rally, stats
  render/         renderer setup, quality tiers, materials, table mesh builders (procedural),
                  ball renderer (env reflections), stadium environment, post FX, camera rigs
  fx/             animation director, timelines, particles (fireworks, dust), standee animations,
                  runner-under-glass controller, lamp controller + light shows
  audio/          engine, buses, ball-roll model, crowd intensity model, organ synth, sound bank
  input/          keyboard, pointer/touch zones, gamepad, nudge gestures, remapping
  ui/             Preact HUD (scoreboard, callouts), menus, high score entry, settings, how-to-play
  storage/        versioned localStorage repos (settings, highscores, lifetime stats)
assets-src/       SVG sources, raster overrides, audio sources, licenses
public/           built/compressed assets (generated)
tools/            asset build (svg→ktx2), table→svg layout exporter, headless sim bot, pitch validator
tests/            vitest suites (physics scenarios, rules, golden replays), playwright smoke
docs/             these documents
```

## 5. Table definition (data-driven)

One typed `TableDef` (a TypeScript module that serialises to JSON) is the **single source of truth**
for:

- **Geometry:** walls, arcs, posts, rubbers, ramps and wireforms (as splines), dishes, with materials.
- **Devices:** flippers, pops, slings, saucers, drop and standup targets, spinners, gates, kickers, magnets, sensors, each with tunables.
- **Switch and coil IDs** (shared names with the rules engine).
- **Lamps:** insert positions, shapes and colors.
- **Visual bindings:** which mesh builder and material each element uses, and art slot names.

Consumers:

1. **Physics builder** → colliders.
2. **Render builder** → procedural meshes (walls extruded from outlines, posts, rubbers fitted
   around posts, ramps lofted along splines, wireform tubes, standees extruded from SVG outlines).
3. **Layout exporter** → an SVG schematic (keeps
   [the playfield layout SVG](assets/playfield-layout-v1.svg) in sync with the real data, and serves
   as a texture-UV reference for the playfield artist).
4. **Rules** → names and topology (which saucer is which fielder, and so on).

Editing the table data during development triggers a hot reload: the table rebuilds without
reloading the page, and the ball and game state are kept where possible.

## 6. Quality tiers and performance budgets

**Tiers:** `Low`, `Medium`, `High`, `Ultra`. The starting tier comes from a quick GPU probe
(renderer string + a short benchmark on first load, cached). An **adaptive controller** steps down
when frame time stays above budget for 3 s, and steps up only after a sustained stable period.

| Feature | Low | Medium | High | Ultra |
|---------|-----|--------|------|-------|
| Render scale (DPR cap) | 1.0 | 1.5 | 2.0 | native |
| Shadow-casting lights | 1 (ball only) | 2 | 2 | 3 |
| Ball env reflection | Static env map | Dynamic cube 64 px @ 30 Hz | 128 px @ 60 Hz | 256 px every frame |
| Bloom | Half-res, 3 mips | Half-res, 5 mips | Full | Full + lens dirt |
| Playfield texture | 2048×4096 | 4096×8192 (or 2 × 4096² tiles) | 4096×8192 | 4096×8192 + detail normal |
| Crowd | Static | Instanced cards | Animated cards | Animated + camera flashes |
| Antialiasing | FXAA | SMAA | SMAA / MSAA 4× | MSAA 4× |

**Budgets:**

| Metric | Target |
|--------|--------|
| Frame rate | 60 fps on a mid-range phone (iPhone 12 / Pixel 6 class) at Medium. 120 fps on desktop at High. |
| Physics CPU | < 1 ms per frame (1 ball) |
| Main-thread script per frame | < 4 ms (excluding physics) on mid-range mobile |
| Draw calls | < 150 (the static table is merged; instancing for repeated parts) |
| GPU memory | < 256 MB on mobile tiers |
| JS bundle | < 400 KB gzipped (excluding assets) |
| First playable download | < 15 MB at Medium. Higher tiers stream extra textures after play starts. |
| Time to interactive | < 5 s on fast 4G / mid-range phone |

## 7. Platform specifics

- **Supported browsers:** latest two versions of Chrome, Edge, Firefox and Safari (macOS and iOS).
  WebGPU is used when available. WebGL2 is the baseline.
- **Mobile Safari:** unlock the AudioContext on the first gesture. Use `touch-action: none` on the
  game canvas. Size the layout from `visualViewport`. Handle the address bar resizing the viewport.
  On iOS, ask for DeviceMotion permission only if the player turns on motion nudge.
- **Orientation:** portrait is the primary layout. On mobile in landscape, the playfield is centered
  with side panels (scoreboard, controls hint). Desktop is landscape by default, with a scoreboard
  panel. Fullscreen is offered where the platform supports it.
- **Context loss:** handle `webglcontextlost` / device loss by pausing, rebuilding GPU resources from
  the table definition, then resuming.

## 8. Persistence schema (localStorage)

| Key | Contents |
|-----|----------|
| `bp.v1.settings` | Volumes, quality tier override, key bindings, reduced motion, HUD scale, nudge options |
| `bp.v1.highscores` | Top 10: `{initials, runs, hits, hr, date, durationSec, buildVersion}` |
| `bp.v1.stats` | Lifetime aggregates |
| `bp.v1.lastReplay` (P2) | Seed + compressed input log of the last game |

Every value is versioned and goes through a migration function. Invalid JSON is reset safely.
Storage errors (private mode, quota) are caught, and the game still runs without saving.

## 9. Testing strategy

- **Rules (unit):** every cell of the event-resolution table in [01 § 4.3](01-game-design.md#43-event-resolution-table),
  base running, inning transitions, rally counting, Rally Cap, Hot Bat, tilt.
- **Physics (scenario):** the suite in [03 § 9](03-physics.md#9-feel-and-validation-suite).
- **Golden replays:** deterministic games with expected outcome sequences.
- **Sim bot (balance):** a headless Node runner plays thousands of games with a parameterised bot
  ("rookie", "average", "expert" flip timing and aim noise). It reports the metrics in
  [01 § 8](01-game-design.md#8-difficulty-and-tuning-targets). It runs on demand and in CI nightly
  (later).
- **Playwright smoke:** the app boots on Chromium and WebKit, a game starts, and the WebGL2 fallback
  path works (WebGPU forced off).
- **Manual device matrix** before release: iPhone (recent + ~4 years old), Android mid-range,
  macOS Safari, Windows Chrome/Firefox, a gamepad.

## 10. Deployment and backend

### MVP (frontend only)

- **Vercel** project, framework preset "Vite", output `dist/`.
- `vercel.json`: long-term immutable cache headers for hashed assets, correct MIME types for `.ktx2`
  and `.wasm` (if any), and a SPA fallback to `index.html`.
- Preview deployments for every branch.
- No secrets, no environment variables required.
- Optional, privacy-friendly Vercel Web Analytics (page views only). No gameplay telemetry in the MVP.
- **The project is not yet a git repository.** Initialising the repo and connecting it to Vercel is
  a step in M0.

### Post-MVP backend (sketch): Cloudflare Workers

- **Global leaderboard:** Worker + **D1** (SQLite). `POST /scores` takes `{initials, runs, stats,
  seed, inputLog, build}`.
- **Anti-cheat:** the Worker re-simulates the submitted input log with the *same physics package*
  and checks the score. This needs the cross-engine determinism in [03 § 8](03-physics.md#8-determinism)
  and fits within Worker CPU limits for a 10-minute game, which must be verified. Before that, use
  rate limiting and plausibility checks.
- **Daily challenge:** a shared seed for the pitch sequence each day, stored in KV.
- **Online multiplayer (future):** Durable Objects for turn-based head-to-head (alternating
  playable half-innings). This is separate from the local Vs AI mode described in § 2.2.
- **Koyeb** only if a requirement ever exceeds what Workers can do (for example, long-running
  processes).
