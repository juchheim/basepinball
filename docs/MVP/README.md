# Rally Ball — MVP Planning

*Game name chosen in M3 ([naming](naming.md)). "BasePinball" was the working title and is still
the repository name.*

BasePinball is a browser-based 3D pinball game that keeps score like baseball. The table is a real
shot-fan pinball machine: orbits, two ramps, a pop-bumper nest, drop targets, spinners and
slingshots. Its scoring follows baseball:

- **Out:** a missed shot that drops into one of the seven fielder saucers guarding the gaps between
  shots, or any drain.
- **Hit:** a shot that gets through to a hit device, which decides **single, double, triple or home
  run**.

Runners appear on the board, move around the bases and score runs. Play 9 innings and score as many
runs as you can.

> Status: **Planning, v0.2** (2026-10-10). No code yet. Every number in these docs is a starting
> value and will be tuned in the whitebox milestone.

## Documents

| # | Document | What it covers |
|---|----------|----------------|
| 01 | [Game Design](01-game-design.md) | Rules, the at-bat state machine, rallies, base running, pitching, feature goals (Hot Bat, Steal), game flow, controls, difficulty targets |
| 02 | [Playfield Design](02-playfield-design.md) | Shot-fan layout, element list with v1 coordinates, shot map and flow loops, device specs, deviations from standard pinball |
| 03 | [Physics](03-physics.md) | The custom pinball physics engine: model, colliders, flippers, CCD, determinism, parameters, feel tests |
| 04 | [Technical Architecture](04-technical-architecture.md) | Stack, module layout, switch/coil/lamp event model, table data format, performance budgets, deployment, future backend |
| 05 | [Art & Animation](05-art-and-animation.md) | Art direction, materials, lighting, ball rendering, camera, vector-first asset pipeline and raster-replacement contract, animation list |
| 06 | [Audio](06-audio.md) | Sound design, mix layers, Web Audio implementation, sourcing and licensing |
| 07 | [Roadmap & Scope](07-roadmap-and-scope.md) | MVP scope (P0/P1/P2), milestones with exit criteria, risks, acceptance criteria, open questions |
| M0 | [M0 Report](m0-report.md) | Physics spike results, Rapier comparison, go/no-go recommendation, feel-review checklist |
| M3 | [M3 Report](m3-report.md) | Art pass: asset pipeline, playfield art, standees, stadium, lighting, quality tiers |
| M4 | [M4 Report](m4-report.md) | Presentation: synthesised audio (SFX, crowd, organ), lamp shows, figure animation, particles, stadium reactions |
| M5 | [M5 Report](m5-report.md) | Settings, touch and gamepad controls, landscape, lifetime stats, P1 polish, acceptance-criteria status |
| QA | [QA checklist](qa-checklist.md) | The manual pass for acceptance criteria 1-3 on each browser and device |
| — | [Naming](naming.md) | Final game name candidates |
| M2 | [M2 Report](m2-report.md) | Rules engine, pitching, game flow, sim bot and balance report |
| M1 | [M1 Report](m1-report.md) | Whitebox table: shot map, ramp threshold, stuck-ball search, layout changes, sandbox controls |
| — | [assets/playfield-layout-v1-generated.svg](assets/playfield-layout-v1-generated.svg) | Playfield layout generated from the table data (authoritative) |
| — | [assets/playfield-layout-v1.svg](assets/playfield-layout-v1.svg) | Original hand-drawn concept layout |

## Decisions

| Topic | Decision |
|-------|----------|
| Physics | **Custom engine built just for pinball** (TypeScript, fixed 1 kHz step). A spike in M0 confirms the feel. |
| Rendering | **Three.js WebGPU renderer** with automatic WebGL2 fallback. Vite + TypeScript. Preact for the HUD and menus. |
| Playfield | **Real pinball first:** a classic shot fan with left and right orbits (spinners), a left ramp, a center pop nest ("the Gap"), a right ramp, top lanes, drop and standup banks, slings, in/outlanes, kickback. Baseball is the scoring layer. |
| Fielders | **7 saucers** in the gaps between shots and at the orbit approaches. Missing your shot gets you caught. |
| Hits | Single = front pops in the Gap. Double = back pops in the Gap. Triple = orbit corner kickers. Home run = left ramp, "Over the Wall." |
| At-bat flow | Each plate appearance normally starts with a **pitch** from the mound. After a hit the ball stays live, and swinging at it starts the next batter's plate appearance right away (a **rally**). |
| Drains | **Every drain is an out**, in every state. After a hit, a saucer catch before the re-swing is *not* an out (the ball goes back to the pitcher). The center drain is a strikeout and the outlanes are a foul out. A kickback can save the left outlane. |
| Base running | Runners advance by the **value of the hit**. **Steals** come from the right ramp when lit. **Hot Bat** adds +1 base to the next non-HR hit and carries across innings. |
| Runners | Visual only. They run in lit basepath channels under the playfield glass. |
| Pitcher | The mound delivers every pitch, so it is never an out hole. The catcher is the drain. |
| Platforms | Desktop and mobile (keyboard, touch, gamepad). The board is designed in portrait. |
| Art | Night-game realism, vector-first assets with a raster-replacement contract |
| Audio | Full SFX and crowd, original organ stingers. No announcer. |
| Scores | Runs are the score. Local high scores only. No backend in the MVP. |
| Session | 8–12 min per game, 3–5 runs for an average player |
| Naming | The final game name and identity are decided during the art milestone (M3) |
| Placeholder team | *The Tilt City Silverballs* of *Plunger Park* |
| Hosting | Vercel (static). Any future backend goes on Cloudflare Workers. Repo: `git@github.com:juchheim/basepinball.git` |

## Open questions

See [07-roadmap-and-scope.md § Open questions](07-roadmap-and-scope.md#open-questions).
