# Rally Ball

A browser-based 3D pinball game scored like baseball. The repository is `basepinball`, from the
working title. Planning docs live in [docs/MVP](docs/MVP/README.md).

**Status:** 1.0.0 release candidate (M6). See the [M6 report](docs/MVP/m6-report.md) for what's
left before launch, and [how to play](https://basepinball.vercel.app/#how-to-play).

## Develop

Requires Node 20.19+.

```bash
npm install
npm run dev          # the game at http://localhost:5173 (?debug: tuning panel; ?webgl: WebGL2 backend)
npm test             # physics feel suite + unit tests
npm run bench:rapier # reference comparison against Rapier
npm run layout:svg   # regenerate the playfield schematic from the table data
npm run simbot -- 30 average   # play 30 games headlessly and print the balance report
npm run art          # regenerate the editable SVG art from the table data (see assets-src/README.md)
npm run build        # typecheck + production build to dist/
```

## Layout

| Path | Contents |
|------|----------|
| `src/physics` | Custom pinball physics engine (fixed 1 kHz step, deterministic) |
| `src/table` | Table definitions (data-driven geometry and devices) |
| `src/render` | Three.js WebGPU renderer (WebGL2 fallback) and table meshes |
| `src/app`, `src/input`, `src/debug` | Fixed-step loop, error handling, input (keyboard, touch, gamepad, motion), tuning panel |
| `src/fx`, `src/audio` | Presentation director, lamp shows, particles, springs; synthesised audio (SFX, crowd, organ) |
| `tests/physics` | Feel suite (tunneling, energy, cradle, flipper shots, devices, performance) and v1 table acceptance (shot map, ramps, stuck balls) |
| `src/rules` | Baseball rules engine (state machine, base running, pitching director) |
| `src/sim` | Headless sim bot |
| `src/ui`, `src/storage` | Preact HUD, menus, settings, how to play; high scores, settings, lifetime stats |
| `tools` | Layout exporter (table data → SVG), balance report |
