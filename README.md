# BasePinball

A browser-based 3D pinball game scored like baseball. Planning docs live in [docs/MVP](docs/MVP/README.md).

**Current milestone:** M2, rules and playable game. See the [M2 report](docs/MVP/m2-report.md) (and the [M1](docs/MVP/m1-report.md) and [M0](docs/MVP/m0-report.md) reports).

## Develop

Requires Node 20.19+.

```bash
npm install
npm run dev          # the game at http://localhost:5173 (?debug: tuning panel; ?webgl: WebGL2 backend)
npm test             # physics feel suite + unit tests
npm run bench:rapier # reference comparison against Rapier
npm run layout:svg   # regenerate the playfield schematic from the table data
npm run simbot -- 30 average   # play 30 games headlessly and print the balance report
npm run build        # typecheck + production build to dist/
```

## Layout

| Path | Contents |
|------|----------|
| `src/physics` | Custom pinball physics engine (fixed 1 kHz step, deterministic) |
| `src/table` | Table definitions (data-driven geometry and devices) |
| `src/render` | Three.js WebGPU renderer (WebGL2 fallback) and table meshes |
| `src/app`, `src/input`, `src/debug` | Fixed-step loop, timestamped input, tuning panel |
| `tests/physics` | Feel suite (tunneling, energy, cradle, flipper shots, devices, performance) and v1 table acceptance (shot map, ramps, stuck balls) |
| `src/rules` | Baseball rules engine (state machine, base running, pitching director) |
| `src/sim` | Headless sim bot |
| `src/ui`, `src/storage` | Preact HUD and menus; local high scores |
| `tools` | Layout exporter (table data → SVG), balance report |
