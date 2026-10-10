# M0 Report: Foundations & Physics Spike

Status as of 2026-10-10, branch `m0-foundations`.

## Exit criteria

| Criterion ([07 § 3](07-roadmap-and-scope.md#m0-foundations--physics-spike)) | Status |
|---|---|
| Repo, Vite + TypeScript, lint, Vitest | ✅ Done. CI workflow runs typecheck, lint, tests and build. |
| Vercel project with preview deploys | ⏳ `vercel.json` is ready. The project still needs to be linked to your Vercel account (needs your go-ahead). |
| Three.js WebGPU → WebGL2 fallback | ✅ Both backends run at 60 fps in desktop Chrome (`?webgl` forces the fallback). ⏳ iOS Safari and Android Chrome still to check on real devices, using the preview URL. |
| Physics core: ball, slope, walls, posts, rubbers, 2 flippers, sling, pop, fielder saucer (+ drop target) | ✅ Done |
| Fixed 1 kHz loop, interpolation, timestamped input | ✅ Done |
| Debug panel + physics visualiser | ✅ Tweakpane tuning panel (persists per browser, exports JSON), collider overlay, slow motion, pause, click-drag ball throw |
| Rapier reference benchmark | ✅ `npm run bench:rapier` (results below) |
| Physics suite tests 1–4 pass | ✅ |
| Physics CPU < 1 ms/frame on mid-range phone | ✅ on desktop (≈ 15–40 µs/frame). ⏳ To confirm on a phone. |
| Feel sign-off by you + a pinball-literate tester | ⏳ **Needs you.** See the feel review below. |
| Go / no-go on the custom engine recorded | ⏳ Recommendation: **GO** (below). Final after the feel review. |

## Automated results

`npm test` gives 18 tests passing.

| Suite | Result |
|---|---|
| 1. No tunneling | 2–20 m/s at 7 angles into walls, 5 mm posts and drop targets, and 2–16 m/s into a moving flipper (5 contact points × 4 flip timings): never inside or through. |
| 2. Energy sanity | 40 random 4 s runs with actuators off: total energy (ball + flipper) never increases. |
| 3. Cradle stability | Left and right: drift < 0.5 mm over 10 s. |
| 4. Flipper shots | Bit-for-bit repeatable. 3.2–4.1 m/s from rest. Exit angle sweeps smoothly from 93° (near the pivot) to 77° (near the tip). Left and right mirror exactly. |
| Devices | Pop kicks at kick speed. Sling fires only above its threshold. Drop target falls. Saucer captures a slow ball while a fast one skims across. Drain works. |
| Determinism | `dsin`/`dcos` match `Math` to 1e-15 using only IEEE basic ops. The seeded RNG is reproducible. Lint blocks `Math.sin/cos/pow/random` inside `src/physics`. |
| Performance | ≈ **2 µs per physics step** (Node), ≈ 35 µs per 60 Hz frame. The budget is 1,000 µs. |

## Rapier comparison (`npm run bench:rapier`)

Rapier is a well-built general-purpose engine. Its flipper is a kinematic body driven through the
same angle profile as ours.

| Scenario | Rapier | Ours | Note |
|---|---|---|---|
| Shot from rest, 30 % along the bat | 4.46 m/s @ 90° | 3.51 m/s @ 93° | Rapier's kinematic bat has infinite mass, so the ball never slows it. Ours does, as a real bat does. |
| Shot from rest, 60 % | 6.59 m/s @ 89° | 4.08 m/s @ 90° | |
| Shot from rest, 85 % | 6.75 m/s @ 77° | 3.24 m/s @ 77° | |
| Cradle drift, 10 s | 0.02 mm | < 0.5 mm | Both stable |
| 20 m/s into a 3 mm wall | 0/5 through (CCD) | 0 through | Both robust |
| Cost per step | ≈ 6.9 µs (2-collider scene) | ≈ 2 µs (full test table) | |

**Takeaway:** Rapier would work for basic robustness. The case for the custom engine is what it
lets us model and control:

- finite flipper inertia, and bats that are rigid against their stops
- velocity-dependent rubber restitution
- dish-shaped saucers whose captures emerge from the physics
- per-device kick logic
- bit-identical determinism across engines (needed later for leaderboard replay checks)
- about 3× lower cost, and no WASM payload

**Recommendation: GO on the custom engine.** Confirm it after the feel review.

## Feel review (needs you)

Run it locally:

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Use `?webgl` to force WebGL2.

**Controls:** Shift, ←/→ or A/L flip. Space gives a new ball. Click-drag on the table throws a
ball. R resets the drop target. C shows colliders. P pauses. `[` and `]` slow time down or speed it
up. On touch, the left and right halves of the screen flip.

**Try each of these and note anything that feels off:**

1. **Cradle:** catch and hold the ball on a raised flipper.
2. **Post pass:** let the ball bounce off one flipper over to the other.
3. **Drop catch:** drop a cradled ball and catch it again.
4. **Live catch:** absorb an incoming ball with a well-timed flip.
5. **Tap pass:** a tiny flip to pass the ball across.
6. **Shot strength:** are flipper shots too weak or too strong? Try `coil N·m` in the panel.
7. **Rubber liveliness:** slings, posts and the pop. Are they too bouncy or too dead?
8. **Saucer:** does a soft shot drop in while a hard one skims across?

Tuning changes persist in your browser. **Copy params JSON** exports them so I can make them the
new defaults.

## Not in M0 (planned)

- Nudge and tilt, plunger, ramps and wireforms, spinners, standups (M1)
- Art, ball reflections from a dynamic cube map, real lighting (M3)
- Sound (M4)
